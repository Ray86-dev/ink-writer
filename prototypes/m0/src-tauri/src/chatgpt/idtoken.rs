//! ID token validation: signature, issuer, audience, nonce and expiry.

use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use serde_json::{Map, Value};

pub const ISSUER: &str = "https://auth.openai.com";

/// Only claim names leave this module for reports. Values such as the email
/// stay out of them.
#[derive(Debug)]
pub struct Validated {
    pub sub: String,
    pub claim_names: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum IdTokenError {
    Malformed(String),
    UnknownKey,
    Invalid(String),
    NonceMismatch,
    BadSid,
    MissingClaim(&'static str),
}

impl std::fmt::Display for IdTokenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Malformed(m) => write!(f, "malformed ID token: {m}"),
            Self::UnknownKey => write!(f, "ID token signed with a key that's not in the JWKS"),
            Self::Invalid(m) => write!(f, "ID token rejected: {m}"),
            Self::NonceMismatch => write!(f, "ID token nonce doesn't match this attempt"),
            Self::BadSid => write!(f, "ID token sid claim is present but not a non-empty string"),
            Self::MissingClaim(c) => write!(f, "ID token lacks the {c} claim"),
        }
    }
}

pub fn validate(
    id_token: &str,
    jwks: &Value,
    client_id: &str,
    expected_nonce: &str,
) -> Result<Validated, IdTokenError> {
    let header = decode_header(id_token).map_err(|e| IdTokenError::Malformed(e.to_string()))?;
    let kid = header.kid.ok_or(IdTokenError::UnknownKey)?;
    let key = find_key(jwks, &kid)?;

    // Pinned to RS256, the only algorithm in OpenAI's discovery document. The
    // header's own `alg` is never trusted, which rules out `none` and HS256.
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[ISSUER]);
    validation.set_audience(&[client_id]);
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    validation.leeway = 5;

    let data = decode::<Map<String, Value>>(id_token, &key, &validation)
        .map_err(|e| IdTokenError::Invalid(e.to_string()))?;
    let claims = data.claims;

    if claims.get("iat").and_then(Value::as_u64).is_none() {
        return Err(IdTokenError::MissingClaim("iat"));
    }
    if claims.get("nonce").and_then(Value::as_str) != Some(expected_nonce) {
        return Err(IdTokenError::NonceMismatch);
    }
    if let Some(sid) = claims.get("sid") {
        if sid.as_str().is_none_or(str::is_empty) {
            return Err(IdTokenError::BadSid);
        }
    }
    let sub = claims
        .get("sub")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or(IdTokenError::MissingClaim("sub"))?
        .to_string();
    let mut claim_names: Vec<String> = claims.keys().cloned().collect();
    claim_names.sort();
    Ok(Validated { sub, claim_names })
}

fn find_key(jwks: &Value, kid: &str) -> Result<DecodingKey, IdTokenError> {
    let jwk = jwks
        .get("keys")
        .and_then(Value::as_array)
        .and_then(|keys| keys.iter().find(|k| k.get("kid").and_then(Value::as_str) == Some(kid)))
        .ok_or(IdTokenError::UnknownKey)?;
    let n = jwk.get("n").and_then(Value::as_str);
    let e = jwk.get("e").and_then(Value::as_str);
    match (n, e) {
        (Some(n), Some(e)) => {
            DecodingKey::from_rsa_components(n, e).map_err(|err| IdTokenError::Malformed(err.to_string()))
        }
        _ => Err(IdTokenError::UnknownKey),
    }
}

#[cfg(test)]
pub mod test_support {
    use base64::Engine;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
    use rsa::pkcs8::{EncodePrivateKey, LineEnding};
    use rsa::traits::PublicKeyParts;
    use serde_json::{Value, json};
    use std::sync::OnceLock;

    pub const KID: &str = "test-kid";

    pub struct TestKey {
        pub pem: String,
        pub jwks: Value,
    }

    /// Generated at test time so no private key sits in the repository.
    pub fn key() -> &'static TestKey {
        static KEY: OnceLock<TestKey> = OnceLock::new();
        KEY.get_or_init(|| {
            let private = rsa::RsaPrivateKey::new(&mut rsa::rand_core::OsRng, 2048).unwrap();
            let pem = private.to_pkcs8_pem(LineEnding::LF).unwrap().to_string();
            let n = URL_SAFE_NO_PAD.encode(private.n().to_bytes_be());
            let e = URL_SAFE_NO_PAD.encode(private.e().to_bytes_be());
            let jwks = json!({ "keys": [{ "kid": KID, "kty": "RSA", "alg": "RS256", "use": "sig", "n": n, "e": e }] });
            TestKey { pem, jwks }
        })
    }

    pub fn sign(claims: &Value) -> String {
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some(KID.into());
        let key = EncodingKey::from_rsa_pem(key().pem.as_bytes()).unwrap();
        encode(&header, claims, &key).unwrap()
    }

    pub fn claims(client_id: &str, nonce: &str) -> Value {
        let now = crate::now_unix();
        json!({
            "iss": super::ISSUER, "aud": [client_id], "sub": "user-1", "nonce": nonce,
            "iat": now, "exp": now + 3600, "sid": "s-1", "email": "person@example.com"
        })
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;
    use jsonwebtoken::{EncodingKey, Header, encode};
    use serde_json::json;

    const CLIENT: &str = "oaiapp_test";
    const NONCE: &str = "nonce-1";

    fn validate_claims(c: &Value) -> Result<Validated, IdTokenError> {
        validate(&sign(c), &key().jwks, CLIENT, NONCE)
    }

    #[test]
    fn accepts_a_correct_token_and_exposes_only_names() {
        let v = validate_claims(&claims(CLIENT, NONCE)).unwrap();
        assert_eq!(v.sub, "user-1");
        assert!(v.claim_names.contains(&"email".to_string()));
        assert!(!format!("{v:?}").contains("person@example.com"));
    }

    #[test]
    fn rejects_a_wrong_nonce() {
        let r = validate_claims(&claims(CLIENT, "other"));
        assert_eq!(r.unwrap_err(), IdTokenError::NonceMismatch);
    }

    #[test]
    fn rejects_the_dynamic_client_as_audience() {
        let r = validate_claims(&claims("dynamic_agent_client", NONCE));
        assert!(matches!(r.unwrap_err(), IdTokenError::Invalid(_)));
    }

    #[test]
    fn rejects_another_issuer() {
        let mut c = claims(CLIENT, NONCE);
        c["iss"] = json!("https://evil.example");
        assert!(matches!(validate_claims(&c).unwrap_err(), IdTokenError::Invalid(_)));
    }

    #[test]
    fn rejects_an_expired_token_past_the_leeway() {
        let mut c = claims(CLIENT, NONCE);
        c["exp"] = json!(crate::now_unix() - 60);
        assert!(matches!(validate_claims(&c).unwrap_err(), IdTokenError::Invalid(_)));
    }

    #[test]
    fn requires_iat_and_a_valid_sid() {
        let mut c = claims(CLIENT, NONCE);
        c.as_object_mut().unwrap().remove("iat");
        assert_eq!(validate_claims(&c).unwrap_err(), IdTokenError::MissingClaim("iat"));

        let mut c = claims(CLIENT, NONCE);
        c["sid"] = json!("");
        assert_eq!(validate_claims(&c).unwrap_err(), IdTokenError::BadSid);
    }

    #[test]
    fn rejects_an_hs256_token_forged_with_public_material() {
        // Classic algorithm confusion: sign with the public modulus as HMAC key.
        let secret = key().jwks["keys"][0]["n"].as_str().unwrap();
        let mut header = Header::new(Algorithm::HS256);
        header.kid = Some(KID.into());
        let forged = encode(
            &header,
            &claims(CLIENT, NONCE),
            &EncodingKey::from_secret(secret.as_bytes()),
        )
        .unwrap();
        assert!(validate(&forged, &key().jwks, CLIENT, NONCE).is_err());
    }

    #[test]
    fn rejects_an_unknown_key_id() {
        let token = sign(&claims(CLIENT, NONCE));
        let r = validate(&token, &json!({ "keys": [] }), CLIENT, NONCE);
        assert_eq!(r.unwrap_err(), IdTokenError::UnknownKey);
    }

    #[test]
    fn rejects_garbage() {
        let r = validate("not-a-jwt", &key().jwks, CLIENT, NONCE);
        assert!(matches!(r.unwrap_err(), IdTokenError::Malformed(_)));
    }
}
