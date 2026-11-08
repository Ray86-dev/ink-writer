//! Sign-in, refresh and sign-out for the ChatGPT plan route.

use std::time::Duration;

use serde::Serialize;
use serde_json::{Value, json};
use url::Url;

use super::idtoken;
use crate::ctx::Ctx;
use crate::loopback::{Decision, Loopback, WaitError};
use crate::pkce::Attempt;
use crate::store::TokenSet;
use crate::stream::{ApiError, request_id};

pub const DYNAMIC_CLIENT: &str = "dynamic_agent_client";
pub const AGENT_NAME: &str = "Ink Writer";
pub const SCOPES: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
pub const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
pub const RESOURCE: &str = "https://api.openai.com/v1";
pub const CALLBACK_PATH: &str = "/auth/callback";

const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
/// The docs ask for a refresh near expiry, without naming a margin.
const REFRESH_MARGIN_SECS: u64 = 120;
/// Refresh errors after which the docs say to drop the tokens and sign in again.
const TERMINAL_REFRESH_ERRORS: [&str; 6] = [
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
];

pub enum AuthMode {
    Registration,
    Reauth {
        client_id: String,
        id_token_hint: Option<String>,
    },
}

impl AuthMode {
    fn label(&self) -> &'static str {
        match self {
            Self::Registration => "registration",
            Self::Reauth { .. } => "reauthorization",
        }
    }
}

pub fn authorize_url(
    auth_base: &str,
    mode: &AuthMode,
    host_id: &str,
    redirect_uri: &str,
    attempt: &Attempt,
) -> Result<String, String> {
    let mut url = Url::parse(&format!("{auth_base}/api/accounts/authorize")).map_err(|e| e.to_string())?;
    {
        let mut q = url.query_pairs_mut();
        match mode {
            AuthMode::Registration => {
                q.append_pair("client_id", DYNAMIC_CLIENT);
                q.append_pair("agent_name_hint", AGENT_NAME);
            }
            AuthMode::Reauth { client_id, id_token_hint } => {
                q.append_pair("client_id", client_id);
                if let Some(hint) = id_token_hint {
                    q.append_pair("id_token_hint", hint);
                }
            }
        }
        q.append_pair("ext_agent_host_id", host_id);
        q.append_pair("response_type", "code");
        q.append_pair("redirect_uri", redirect_uri);
        q.append_pair("scope", SCOPES);
        q.append_pair("resource", RESOURCE);
        q.append_pair("state", &attempt.state);
        q.append_pair("nonce", &attempt.nonce);
        q.append_pair("code_challenge_method", "S256");
        q.append_pair("code_challenge", &attempt.challenge);
    }
    Ok(url.into())
}

#[derive(Debug, PartialEq, Eq)]
pub struct CallbackOk {
    pub code: String,
    pub client_id: String,
    pub callback_had_client_id: bool,
    pub scope: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum CallbackError {
    /// Not from this attempt. The listener keeps waiting.
    StateMismatch,
    OAuth { error: String, description: Option<String> },
    MissingCode,
    /// A new registration's callback must carry the issued client ID.
    RegistrationIncomplete,
    ClientMismatch,
}

/// Checks `state` before anything else in the callback, as the docs require.
pub fn parse_callback(query: &str, expected_state: &str, mode: &AuthMode) -> Result<CallbackOk, CallbackError> {
    let get = |name: &str| {
        url::form_urlencoded::parse(query.as_bytes())
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.into_owned())
    };
    if get("state").as_deref() != Some(expected_state) {
        return Err(CallbackError::StateMismatch);
    }
    if let Some(error) = get("error") {
        return Err(CallbackError::OAuth {
            error,
            description: get("error_description"),
        });
    }
    let code = get("code").filter(|c| !c.is_empty()).ok_or(CallbackError::MissingCode)?;
    let returned = get("client_id").filter(|c| !c.is_empty());
    let callback_had_client_id = returned.is_some();
    let client_id = match mode {
        AuthMode::Registration => match returned {
            // The placeholder must never be mistaken for an issued ID.
            Some(id) if id != DYNAMIC_CLIENT => id,
            _ => return Err(CallbackError::RegistrationIncomplete),
        },
        AuthMode::Reauth { client_id, .. } => match returned {
            Some(id) if id != *client_id => return Err(CallbackError::ClientMismatch),
            _ => client_id.clone(),
        },
    };
    Ok(CallbackOk {
        code,
        client_id,
        callback_had_client_id,
        scope: get("scope"),
    })
}

pub fn scope_grants_plan(scope: &str) -> bool {
    scope.split_whitespace().any(|s| s == PLAN_SCOPE)
}

/// Parsed token endpoint reply. No `Debug`, so it can't end up in a log.
struct TokenReply {
    access_token: String,
    refresh_token: Option<String>,
    id_token: Option<String>,
    expires_in: u64,
    scope: Option<String>,
    token_type: Option<String>,
    earliest_refresh_at: Option<Value>,
    field_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TokenError {
    pub http_status: Option<u16>,
    pub code: Option<String>,
    pub message: Option<String>,
    pub request_id: Option<String>,
    /// The token endpoint's error shape isn't documented, so M0 keeps it whole.
    pub raw_body: Option<String>,
}

impl TokenError {
    fn transport(message: String) -> Self {
        Self {
            http_status: None,
            code: None,
            message: Some(message),
            request_id: None,
            raw_body: None,
        }
    }

    pub fn is_terminal(&self) -> bool {
        self.code
            .as_deref()
            .is_some_and(|c| TERMINAL_REFRESH_ERRORS.contains(&c))
    }
}

async fn post_token(ctx: &Ctx, form: &[(&str, &str)]) -> Result<TokenReply, TokenError> {
    let url = format!("{}/api/accounts/oauth/token", ctx.endpoints.auth_base);
    let resp = ctx
        .http
        .post(url)
        .header("accept", "application/json")
        .form(form)
        .send()
        .await
        .map_err(|e| TokenError::transport(e.to_string()))?;
    let status = resp.status();
    let rid = request_id(resp.headers());
    let body = resp
        .text()
        .await
        .map_err(|e| TokenError::transport(e.to_string()))?;
    let fail = |api: ApiError| TokenError {
        http_status: Some(status.as_u16()),
        code: api.code,
        message: api.message,
        request_id: rid.clone(),
        raw_body: (!status.is_success()).then(|| crate::stream::truncate(&body)),
    };
    if !status.is_success() {
        return Err(fail(ApiError::from_body(&body)));
    }
    let v: Value = serde_json::from_str(&body).map_err(|_| {
        fail(ApiError {
            message: Some("token response is not JSON".into()),
            ..ApiError::default()
        })
    })?;
    let text = |name: &str| v.get(name).and_then(Value::as_str).map(str::to_string);
    let access_token = text("access_token").ok_or_else(|| {
        fail(ApiError {
            message: Some("token response has no access_token".into()),
            ..ApiError::default()
        })
    })?;
    let mut field_names: Vec<String> = v
        .as_object()
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();
    field_names.sort();
    Ok(TokenReply {
        access_token,
        refresh_token: text("refresh_token"),
        id_token: text("id_token"),
        expires_in: v.get("expires_in").and_then(Value::as_u64).unwrap_or(0),
        scope: text("scope"),
        token_type: text("token_type"),
        earliest_refresh_at: v.get("earliest_refresh_at").cloned(),
        field_names,
    })
}

/// Evidence for the decision record. Holds no token and no identity: the client
/// ID appears only as its prefix, tokens only as their sizes.
#[derive(Debug, Clone, Serialize)]
pub struct LoginEvidence {
    pub mode: &'static str,
    pub port: u16,
    pub client_id_prefix: String,
    pub callback_had_client_id: bool,
    pub callback_scope: Option<String>,
    pub token_scope: Option<String>,
    pub plan_enabled: bool,
    pub token_type: Option<String>,
    pub expires_in: u64,
    pub earliest_refresh_at: Option<Value>,
    pub token_response_fields: Vec<String>,
    pub id_token_claims: Vec<String>,
    pub account_changed: bool,
    pub sizes_bytes: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoginFailure {
    pub stage: &'static str,
    pub mode: &'static str,
    pub port: Option<u16>,
    pub http_status: Option<u16>,
    pub code: Option<String>,
    pub message: String,
    pub request_id: Option<String>,
    pub callback_scope: Option<String>,
    pub callback_had_client_id: Option<bool>,
    pub raw_error_body: Option<String>,
}

fn prefix(client_id: &str) -> String {
    client_id.split('_').next().unwrap_or("").chars().take(12).collect()
}

/// Full sign-in. `open_browser` is injected so tests can play the browser.
pub async fn login(
    ctx: &Ctx,
    port: Option<u16>,
    open_browser: impl FnOnce(&str) -> Result<(), String>,
) -> Result<LoginEvidence, LoginFailure> {
    let store = |e: String| LoginFailure {
        stage: "store",
        mode: "unknown",
        port: None,
        http_status: None,
        code: None,
        message: e,
        request_id: None,
        callback_scope: None,
        callback_had_client_id: None,
        raw_error_body: None,
    };
    let host_id = ctx.store.host_id().map_err(store)?;
    let saved_client = ctx.store.state().map_err(store)?.chatgpt_client_id;
    let previous = ctx.store.vault().map_err(store)?.chatgpt;
    let mode = match saved_client {
        Some(client_id) => AuthMode::Reauth {
            client_id,
            id_token_hint: previous.as_ref().map(|t| t.id_token.clone()),
        },
        None => AuthMode::Registration,
    };
    let label = mode.label();

    let fail = |stage: &'static str, port: Option<u16>, message: String| LoginFailure {
        stage,
        mode: label,
        port,
        http_status: None,
        code: None,
        message,
        request_id: None,
        callback_scope: None,
        callback_had_client_id: None,
        raw_error_body: None,
    };

    let listener = Loopback::bind(port.unwrap_or(0))
        .await
        .map_err(|e| fail("listener", port, e.to_string()))?;
    let port = listener.port;
    let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
    let attempt = Attempt::new();
    let url = authorize_url(&ctx.endpoints.auth_base, &mode, &host_id, &redirect_uri, &attempt)
        .map_err(|e| fail("authorize_url", Some(port), e))?;
    // The URL may hold id_token_hint: it goes to the browser and nowhere else.
    open_browser(&url).map_err(|e| fail("browser", Some(port), e))?;

    let callback = listener
        .wait(CALLBACK_PATH, LOGIN_TIMEOUT, |query| {
            match parse_callback(query, &attempt.state, &mode) {
                Err(CallbackError::StateMismatch) => Decision::KeepWaiting,
                other => Decision::Done(other),
            }
        })
        .await
        .map_err(|e| {
            let message = match e {
                WaitError::Timeout => "no callback arrived in time".to_string(),
                WaitError::Io(m) => m,
            };
            fail("callback", Some(port), message)
        })?;
    let callback = callback.map_err(|e| {
        let (code, message) = match e {
            CallbackError::OAuth { error, description } => {
                (Some(error), description.unwrap_or_default())
            }
            other => (None, format!("{other:?}")),
        };
        LoginFailure {
            code,
            ..fail("callback", Some(port), message)
        }
    })?;

    // Saved before the exchange: if the code fails, the docs say to retry with
    // the issued ID, not to register again.
    let client_id = callback.client_id.clone();
    ctx.store
        .update_state(|s| s.chatgpt_client_id = Some(client_id.clone()))
        .map_err(|e| fail("store", Some(port), e))?;

    let reply = post_token(
        ctx,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", &client_id),
            ("code", &callback.code),
            ("code_verifier", &attempt.verifier),
            ("redirect_uri", &redirect_uri),
            ("resource", RESOURCE),
        ],
    )
    .await
    .map_err(|e| LoginFailure {
        stage: "token_exchange",
        mode: label,
        port: Some(port),
        http_status: e.http_status,
        code: e.code,
        message: e.message.unwrap_or_default(),
        request_id: e.request_id,
        callback_scope: callback.scope.clone(),
        callback_had_client_id: Some(callback.callback_had_client_id),
        // The server may echo what it received: none of it belongs in a report.
        raw_error_body: e.raw_body.map(|b| {
            b.replace(&callback.code, "[code]")
                .replace(&attempt.verifier, "[verifier]")
                .replace(&client_id, "[client_id]")
        }),
    })?;

    let id_token = reply
        .id_token
        .clone()
        .ok_or_else(|| fail("id_token", Some(port), "token response has no id_token".into()))?;
    let refresh_token = reply
        .refresh_token
        .clone()
        .ok_or_else(|| fail("token_exchange", Some(port), "token response has no refresh_token".into()))?;

    let jwks = fetch_jwks(ctx)
        .await
        .map_err(|e| fail("jwks", Some(port), e))?;
    let validated = idtoken::validate(&id_token, &jwks, &client_id, &attempt.nonce)
        .map_err(|e| fail("id_token", Some(port), e.to_string()))?;

    let account_changed = match &previous {
        Some(p) => previous_sub(&p.id_token).is_some_and(|sub| sub != validated.sub),
        None => false,
    };

    // The granted scope comes from the token response, not the callback.
    let scope = reply.scope.clone().unwrap_or_default();
    let plan_enabled = scope_grants_plan(&scope);
    let sizes = json!({
        "access_token": reply.access_token.len(),
        "refresh_token": refresh_token.len(),
        "id_token": id_token.len(),
        "windows_credential_blob_limit": 2560,
    });
    let tokens = TokenSet {
        access_token: reply.access_token.clone(),
        refresh_token,
        id_token,
        expires_at_unix: crate::now_unix() + reply.expires_in,
        scope,
    };
    ctx.store
        .update_vault(|v| v.chatgpt = Some(tokens))
        .map_err(|e| fail("store", Some(port), e))?;

    Ok(LoginEvidence {
        mode: label,
        port,
        client_id_prefix: prefix(&client_id),
        callback_had_client_id: callback.callback_had_client_id,
        callback_scope: callback.scope,
        token_scope: reply.scope,
        plan_enabled,
        token_type: reply.token_type,
        expires_in: reply.expires_in,
        earliest_refresh_at: reply.earliest_refresh_at,
        token_response_fields: reply.field_names,
        id_token_claims: validated.claim_names,
        account_changed,
        sizes_bytes: sizes,
    })
}

/// Reads `sub` from a token that was validated when it was stored.
fn previous_sub(id_token: &str) -> Option<String> {
    use base64::Engine;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let payload = URL_SAFE_NO_PAD.decode(id_token.split('.').nth(1)?).ok()?;
    let v: Value = serde_json::from_slice(&payload).ok()?;
    v.get("sub")?.as_str().map(str::to_string)
}

async fn fetch_jwks(ctx: &Ctx) -> Result<Value, String> {
    let url = format!("{}/.well-known/jwks.json", ctx.endpoints.auth_base);
    let resp = ctx.http.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("JWKS request returned {}", resp.status()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionError {
    NotSignedIn,
    /// Signed in without the plan scope. Never fall through to another
    /// billing route from here: SPEC §6 and rule 10.
    PlanDisabled,
    SessionExpired { code: String },
    RefreshFailed { message: String },
    Store(String),
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotSignedIn => write!(f, "no ChatGPT session"),
            Self::PlanDisabled => write!(f, "this sign-in doesn't allow ChatGPT plan usage"),
            Self::SessionExpired { code } => write!(f, "session ended ({code}): sign in again"),
            Self::RefreshFailed { message } => write!(f, "refresh failed: {message}"),
            Self::Store(m) => write!(f, "store error: {m}"),
        }
    }
}

/// Valid access token, refreshing first if it's near expiry.
pub async fn access_token(ctx: &Ctx) -> Result<String, SessionError> {
    let _serialized = ctx.refresh_lock.lock().await;
    let vault = ctx.store.vault().map_err(SessionError::Store)?;
    let tokens = vault.chatgpt.ok_or(SessionError::NotSignedIn)?;
    if !scope_grants_plan(&tokens.scope) {
        return Err(SessionError::PlanDisabled);
    }
    if crate::now_unix() + REFRESH_MARGIN_SECS < tokens.expires_at_unix {
        return Ok(tokens.access_token);
    }
    match refresh_locked(ctx, &tokens).await {
        Ok((new, _)) => Ok(new.access_token),
        Err(e) if e.is_terminal() => {
            ctx.store
                .update_vault(|v| v.chatgpt = None)
                .map_err(SessionError::Store)?;
            Err(SessionError::SessionExpired {
                code: e.code.unwrap_or_default(),
            })
        }
        // Network or server trouble: keep the session for a later retry.
        Err(e) => Err(SessionError::RefreshFailed {
            message: e.message.unwrap_or_else(|| "unknown".into()),
        }),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RefreshEvidence {
    pub refresh_token_rotated: bool,
    pub id_token_returned: bool,
    pub scope_unchanged: bool,
    pub expires_in: u64,
    pub earliest_refresh_at: Option<Value>,
    pub token_response_fields: Vec<String>,
}

/// Refreshes now, regardless of expiry. The M0 probe uses this to see rotation.
pub async fn force_refresh(ctx: &Ctx) -> Result<RefreshEvidence, TokenError> {
    let _serialized = ctx.refresh_lock.lock().await;
    let tokens = ctx
        .store
        .vault()
        .map_err(TokenError::transport)?
        .chatgpt
        .ok_or_else(|| TokenError::transport("no ChatGPT session".into()))?;
    refresh_locked(ctx, &tokens).await.map(|(_, evidence)| evidence)
}

async fn refresh_locked(ctx: &Ctx, tokens: &TokenSet) -> Result<(TokenSet, RefreshEvidence), TokenError> {
    let client_id = ctx
        .store
        .state()
        .map_err(TokenError::transport)?
        .chatgpt_client_id
        .ok_or_else(|| TokenError::transport("no issued client ID saved".into()))?;
    // `scope` is omitted on purpose, which keeps the original grant.
    let reply = post_token(
        ctx,
        &[
            ("grant_type", "refresh_token"),
            ("client_id", &client_id),
            ("refresh_token", &tokens.refresh_token),
            ("resource", RESOURCE),
        ],
    )
    .await?;
    let new = TokenSet {
        access_token: reply.access_token.clone(),
        refresh_token: reply
            .refresh_token
            .clone()
            .unwrap_or_else(|| tokens.refresh_token.clone()),
        id_token: reply.id_token.clone().unwrap_or_else(|| tokens.id_token.clone()),
        expires_at_unix: crate::now_unix() + reply.expires_in,
        scope: reply.scope.clone().unwrap_or_else(|| tokens.scope.clone()),
    };
    let evidence = RefreshEvidence {
        refresh_token_rotated: new.refresh_token != tokens.refresh_token,
        id_token_returned: reply.id_token.is_some(),
        scope_unchanged: new.scope == tokens.scope,
        expires_in: reply.expires_in,
        earliest_refresh_at: reply.earliest_refresh_at,
        token_response_fields: reply.field_names,
    };
    // All the fields change together, in one atomic write.
    let saved = new.clone();
    ctx.store
        .update_vault(|v| v.chatgpt = Some(saved))
        .map_err(TokenError::transport)?;
    Ok((new, evidence))
}

/// Revokes the refresh token. Local tokens go only once revocation is confirmed;
/// the client ID and the host ID stay, as the docs say.
pub async fn sign_out(ctx: &Ctx) -> Result<(), TokenError> {
    let _serialized = ctx.refresh_lock.lock().await;
    let tokens = ctx.store.vault().map_err(TokenError::transport)?.chatgpt;
    let Some(tokens) = tokens else {
        return Ok(());
    };
    let client_id = ctx
        .store
        .state()
        .map_err(TokenError::transport)?
        .chatgpt_client_id
        .ok_or_else(|| TokenError::transport("no issued client ID saved".into()))?;
    let resp = ctx
        .http
        .post(format!("{}/api/accounts/oauth/revoke", ctx.endpoints.auth_base))
        .form(&[
            ("token", tokens.refresh_token.as_str()),
            ("token_type_hint", "refresh_token"),
            ("client_id", client_id.as_str()),
        ])
        .send()
        .await
        .map_err(|e| TokenError::transport(e.to_string()))?;
    let status = resp.status();
    let rid = request_id(resp.headers());
    if !status.is_success() {
        let api = ApiError::from_body(&resp.text().await.unwrap_or_default());
        return Err(TokenError {
            http_status: Some(status.as_u16()),
            code: api.code,
            message: api.message,
            request_id: rid,
            raw_body: None,
        });
    }
    ctx.store
        .update_vault(|v| v.chatgpt = None)
        .map_err(TokenError::transport)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn query(url: &str) -> HashMap<String, String> {
        Url::parse(url).unwrap().query_pairs().into_owned().collect()
    }

    fn attempt() -> Attempt {
        Attempt {
            state: "st".into(),
            nonce: "no".into(),
            verifier: "ve".into(),
            challenge: "ch".into(),
        }
    }

    fn reauth(hint: Option<&str>) -> AuthMode {
        AuthMode::Reauth {
            client_id: "oaiapp_x".into(),
            id_token_hint: hint.map(str::to_string),
        }
    }

    const BASE: &str = "https://auth.openai.com";
    const REDIRECT: &str = "http://127.0.0.1:1455/auth/callback";

    #[test]
    fn registration_url_carries_every_documented_parameter() {
        let url = authorize_url(BASE, &AuthMode::Registration, "urn:uuid:h", REDIRECT, &attempt()).unwrap();
        assert!(url.starts_with("https://auth.openai.com/api/accounts/authorize?"));
        let q = query(&url);
        for (k, v) in [
            ("client_id", "dynamic_agent_client"),
            ("agent_name_hint", "Ink Writer"),
            ("ext_agent_host_id", "urn:uuid:h"),
            ("response_type", "code"),
            ("redirect_uri", REDIRECT),
            ("scope", SCOPES),
            ("resource", "https://api.openai.com/v1"),
            ("state", "st"),
            ("nonce", "no"),
            ("code_challenge_method", "S256"),
            ("code_challenge", "ch"),
        ] {
            assert_eq!(q.get(k).map(String::as_str), Some(v), "{k}");
        }
        assert!(!q.contains_key("id_token_hint"));
    }

    #[test]
    fn reauthorization_uses_the_issued_client_and_drops_the_name_hint() {
        let url = authorize_url(BASE, &reauth(Some("idt")), "urn:uuid:h", REDIRECT, &attempt()).unwrap();
        let q = query(&url);
        assert_eq!(q["client_id"], "oaiapp_x");
        assert_eq!(q["id_token_hint"], "idt");
        assert_eq!(q["ext_agent_host_id"], "urn:uuid:h");
        assert!(!q.contains_key("agent_name_hint"));
    }

    #[test]
    fn state_is_checked_before_anything_else() {
        let r = parse_callback("state=bad&error=access_denied", "st", &AuthMode::Registration);
        assert_eq!(r.unwrap_err(), CallbackError::StateMismatch);
        let r = parse_callback("code=c&client_id=oaiapp_x", "st", &AuthMode::Registration);
        assert_eq!(r.unwrap_err(), CallbackError::StateMismatch);
    }

    #[test]
    fn access_denied_is_reported_after_state_passes() {
        let r = parse_callback("state=st&error=access_denied", "st", &AuthMode::Registration);
        assert_eq!(
            r.unwrap_err(),
            CallbackError::OAuth {
                error: "access_denied".into(),
                description: None
            }
        );
    }

    #[test]
    fn registration_needs_a_real_issued_client_id() {
        let ok = parse_callback(
            "code=c&state=st&client_id=oaiapp_x&scope=a+b",
            "st",
            &AuthMode::Registration,
        )
        .unwrap();
        assert_eq!(ok.client_id, "oaiapp_x");
        assert!(ok.callback_had_client_id);
        assert_eq!(ok.scope.as_deref(), Some("a b"));

        for query in ["code=c&state=st", "code=c&state=st&client_id=dynamic_agent_client"] {
            let r = parse_callback(query, "st", &AuthMode::Registration);
            assert_eq!(r.unwrap_err(), CallbackError::RegistrationIncomplete, "{query}");
        }
    }

    #[test]
    fn reauthorization_keeps_the_saved_client_and_rejects_another() {
        let ok = parse_callback("code=c&state=st", "st", &reauth(None)).unwrap();
        assert_eq!(ok.client_id, "oaiapp_x");
        assert!(!ok.callback_had_client_id);

        let same = parse_callback("code=c&state=st&client_id=oaiapp_x", "st", &reauth(None));
        assert!(same.is_ok());

        let other = parse_callback("code=c&state=st&client_id=oaiapp_y", "st", &reauth(None));
        assert_eq!(other.unwrap_err(), CallbackError::ClientMismatch);
    }

    #[test]
    fn a_callback_without_a_code_is_an_error() {
        let r = parse_callback("state=st&client_id=oaiapp_x", "st", &AuthMode::Registration);
        assert_eq!(r.unwrap_err(), CallbackError::MissingCode);
    }

    #[test]
    fn plan_scope_must_match_a_whole_word() {
        assert!(scope_grants_plan("openid chatgpt.tokens.use.direct email"));
        assert!(!scope_grants_plan("openid chatgpt.tokens.use.direct.extra"));
        assert!(!scope_grants_plan(""));
    }

    #[test]
    fn terminal_refresh_errors_match_the_documented_list() {
        let err = |code: &str| TokenError {
            http_status: Some(400),
            code: Some(code.into()),
            message: None,
            request_id: None,
            raw_body: None,
        };
        for code in TERMINAL_REFRESH_ERRORS {
            assert!(err(code).is_terminal(), "{code}");
        }
        assert!(!err("invalid_client").is_terminal());
        assert!(!TokenError::transport("network down".into()).is_terminal());
    }

    #[test]
    fn client_prefix_never_exposes_the_full_id() {
        assert_eq!(prefix("oaiapp_abcdef123"), "oaiapp");
    }
}
