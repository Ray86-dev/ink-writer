//! PKCE (RFC 7636, S256) and the random values for each OAuth attempt.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};

pub fn random_token(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("OS random source unavailable");
    URL_SAFE_NO_PAD.encode(buf)
}

pub fn challenge_s256(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// Fresh values for one authorization attempt. Never reused.
pub struct Attempt {
    pub state: String,
    pub nonce: String,
    pub verifier: String,
    pub challenge: String,
}

impl Attempt {
    pub fn new() -> Self {
        // 64 bytes encode to 86 characters, inside RFC 7636's 43..=128 range.
        let verifier = random_token(64);
        Self {
            state: random_token(32),
            nonce: random_token(32),
            challenge: challenge_s256(&verifier),
            verifier,
        }
    }
}

impl Default for Attempt {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_rfc_7636_vector() {
        assert_eq!(
            challenge_s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifier_uses_the_allowed_alphabet_and_length() {
        let a = Attempt::new();
        assert!((43..=128).contains(&a.verifier.len()));
        assert!(
            a.verifier
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        );
    }

    #[test]
    fn each_attempt_is_fresh() {
        let (a, b) = (Attempt::new(), Attempt::new());
        assert_ne!(a.state, b.state);
        assert_ne!(a.nonce, b.nonce);
        assert_ne!(a.verifier, b.verifier);
    }
}
