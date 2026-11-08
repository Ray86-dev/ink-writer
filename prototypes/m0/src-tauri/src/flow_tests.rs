//! End-to-end flows against a local mock server: real sockets, real JSON, a real
//! RSA-signed ID token. The test plays the browser.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use url::Url;

use crate::chatgpt::idtoken::test_support as jwt;
use crate::chatgpt::{api, auth};
use crate::ctx::{Ctx, Endpoints};
use crate::probes;
use crate::report::ProbeStatus;
use crate::store::{Store, TokenSet};
use crate::stream::Terminal;
use crate::{contract, ollama, openrouter};

const ISSUED: &str = "oaiapp_test123";
const FULL_SCOPE: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

#[derive(Clone, Debug)]
struct Seen {
    method: String,
    path: String,
    body: String,
    authorization: Option<String>,
}

impl Seen {
    fn form(&self) -> HashMap<String, String> {
        url::form_urlencoded::parse(self.body.as_bytes()).into_owned().collect()
    }

    fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap_or(Value::Null)
    }
}

enum Reply {
    Json(u16, Value),
    /// Chunked body. `complete: false` cuts the connection mid-transfer.
    Stream { chunks: Vec<Vec<u8>>, complete: bool },
}

type Handler = Arc<dyn Fn(&Seen) -> Reply + Send + Sync>;

struct Mock {
    base: String,
    seen: Arc<Mutex<Vec<Seen>>>,
}

impl Mock {
    async fn start(handler: impl Fn(&Seen) -> Reply + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let handler: Handler = Arc::new(handler);
        let log = seen.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                let handler = handler.clone();
                let log = log.clone();
                tokio::spawn(async move {
                    let Some(req) = read_request(&mut sock).await else {
                        return;
                    };
                    log.lock().unwrap().push(req.clone());
                    write_reply(&mut sock, handler(&req)).await;
                });
            }
        });
        Self { base, seen }
    }

    fn requests_to(&self, path: &str) -> Vec<Seen> {
        self.seen
            .lock()
            .unwrap()
            .iter()
            .filter(|s| s.path.starts_with(path))
            .cloned()
            .collect()
    }
}

async fn read_request(sock: &mut tokio::net::TcpStream) -> Option<Seen> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        let n = sock.read(&mut chunk).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break p + 4;
        }
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut first = head.lines().next()?.split_whitespace();
    let method = first.next()?.to_string();
    let path = first.next()?.to_string();
    let header = |name: &str| {
        head.lines().find_map(|l| {
            let (k, v) = l.split_once(':')?;
            k.eq_ignore_ascii_case(name).then(|| v.trim().to_string())
        })
    };
    let len: usize = header("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    while buf.len() < header_end + len {
        let n = sock.read(&mut chunk).await.ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    Some(Seen {
        method,
        path,
        body: String::from_utf8_lossy(&buf[header_end..]).to_string(),
        authorization: header("authorization"),
    })
}

async fn write_reply(sock: &mut tokio::net::TcpStream, reply: Reply) {
    match reply {
        Reply::Json(status, body) => {
            let body = body.to_string();
            let head = format!(
                "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nopenai-request-id: req_1\r\nx-ratelimit-remaining: 7\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = sock.write_all(head.as_bytes()).await;
            let _ = sock.write_all(body.as_bytes()).await;
        }
        Reply::Stream { chunks, complete } => {
            let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nopenai-request-id: req_2\r\n\r\n";
            let _ = sock.write_all(head.as_bytes()).await;
            for c in chunks {
                let _ = sock.write_all(format!("{:x}\r\n", c.len()).as_bytes()).await;
                let _ = sock.write_all(&c).await;
                let _ = sock.write_all(b"\r\n").await;
                let _ = sock.flush().await;
            }
            if complete {
                let _ = sock.write_all(b"0\r\n\r\n").await;
            }
        }
    }
    let _ = sock.shutdown().await;
}

struct Fixture {
    ctx: Arc<Ctx>,
    _dir: tempfile::TempDir,
}

fn fixture(base: &str) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::with_key(dir.path(), [9u8; 32]);
    let endpoints = Endpoints {
        auth_base: base.into(),
        api_base: format!("{base}/v1"),
        openrouter_base: base.into(),
        ollama_base: base.into(),
    };
    Fixture {
        ctx: Arc::new(Ctx::new(store, endpoints).unwrap()),
        _dir: dir,
    }
}

fn seed_session(ctx: &Ctx, expires_in: u64) {
    ctx.store
        .update_state(|s| s.chatgpt_client_id = Some(ISSUED.into()))
        .unwrap();
    ctx.store
        .update_vault(|v| {
            v.chatgpt = Some(TokenSet {
                access_token: "access-old".into(),
                refresh_token: "refresh-old".into(),
                id_token: jwt::sign(&jwt::claims(ISSUED, "n")),
                expires_at_unix: crate::now_unix() + expires_in,
                scope: FULL_SCOPE.into(),
            })
        })
        .unwrap();
}

/// A sign-in server. The nonce is captured from the authorize URL, as the real
/// one would, and placed in the ID token.
fn auth_handler(nonce: Arc<Mutex<String>>, scope: &'static str) -> impl Fn(&Seen) -> Reply + Send + Sync {
    move |req: &Seen| match req.path.as_str() {
        "/api/accounts/oauth/token" => {
            let client = req.form().get("client_id").cloned().unwrap_or_default();
            let n = nonce.lock().unwrap().clone();
            Reply::Json(
                200,
                json!({
                    "access_token": "access-1", "refresh_token": "refresh-1",
                    "id_token": jwt::sign(&jwt::claims(&client, &n)),
                    "token_type": "Bearer", "expires_in": 3600, "scope": scope,
                    "earliest_refresh_at": 12345,
                }),
            )
        }
        "/.well-known/jwks.json" => Reply::Json(200, jwt::key().jwks.clone()),
        other => Reply::Json(404, json!({ "error": { "message": other } })),
    }
}

/// Plays the browser: records the URL and hits the callback with `extra` query.
fn browser(
    extra: &'static str,
    nonce: Arc<Mutex<String>>,
    captured: Arc<Mutex<HashMap<String, String>>>,
) -> impl FnOnce(&str) -> Result<(), String> {
    move |url: &str| {
        let q: HashMap<String, String> = Url::parse(url).unwrap().query_pairs().into_owned().collect();
        *nonce.lock().unwrap() = q["nonce"].clone();
        let target = format!("{}?state={}{extra}", q["redirect_uri"], q["state"]);
        *captured.lock().unwrap() = q;
        tokio::spawn(async move {
            let _ = reqwest::get(target).await;
        });
        Ok(())
    }
}

#[tokio::test]
async fn first_sign_in_registers_validates_and_stores() {
    let nonce = Arc::new(Mutex::new(String::new()));
    let mock = Mock::start(auth_handler(nonce.clone(), FULL_SCOPE)).await;
    let f = fixture(&mock.base);
    let captured = Arc::new(Mutex::new(HashMap::new()));

    let (result, path) = probes::chatgpt_login(
        &f.ctx,
        None,
        browser(
            "&code=code-1&client_id=oaiapp_test123&scope=openid",
            nonce,
            captured.clone(),
        ),
    )
    .await;

    assert_eq!(result.status, ProbeStatus::Ok, "{result:?}");
    let q = captured.lock().unwrap().clone();
    assert_eq!(q["client_id"], "dynamic_agent_client");
    assert_eq!(q["agent_name_hint"], "Ink Writer");
    assert!(q["ext_agent_host_id"].starts_with("urn:uuid:"));
    assert!(q["redirect_uri"].starts_with("http://127.0.0.1:"));
    assert!(q["redirect_uri"].ends_with("/auth/callback"));

    let exchange = &mock.requests_to("/api/accounts/oauth/token")[0];
    assert_eq!(exchange.method, "POST");
    let form = exchange.form();
    assert_eq!(form["grant_type"], "authorization_code");
    assert_eq!(form["client_id"], ISSUED, "must use the issued ID, not the placeholder");
    assert_eq!(form["code"], "code-1");
    assert_eq!(form["redirect_uri"], q["redirect_uri"]);
    assert_eq!(form["resource"], "https://api.openai.com/v1");
    assert_eq!(crate::pkce::challenge_s256(&form["code_verifier"]), q["code_challenge"]);

    assert_eq!(f.ctx.store.state().unwrap().chatgpt_client_id.as_deref(), Some(ISSUED));
    let tokens = f.ctx.store.vault().unwrap().chatgpt.unwrap();
    assert_eq!(tokens.access_token, "access-1");

    let written = std::fs::read_to_string(path.unwrap()).unwrap();
    for secret in ["access-1", "refresh-1", &tokens.id_token, ISSUED, "person@example.com", "user-1"] {
        assert!(!written.contains(secret), "report leaked {secret}");
    }
    assert!(written.contains("\"oaiapp\""));
    assert!(written.contains("12345"), "earliest_refresh_at is evidence");
    assert!(written.contains("\"email\""), "claim names are evidence");
}

#[tokio::test]
async fn later_sign_in_reuses_the_issued_client_and_host() {
    let nonce = Arc::new(Mutex::new(String::new()));
    let mock = Mock::start(auth_handler(nonce.clone(), FULL_SCOPE)).await;
    let f = fixture(&mock.base);
    seed_session(&f.ctx, 3600);
    let host = f.ctx.store.host_id().unwrap();
    let captured = Arc::new(Mutex::new(HashMap::new()));

    let (result, _) = probes::chatgpt_login(
        &f.ctx,
        None,
        browser("&code=code-2", nonce, captured.clone()),
    )
    .await;

    assert_eq!(result.status, ProbeStatus::Ok, "{result:?}");
    assert_eq!(result.details["mode"], "reauthorization");
    assert_eq!(result.details["callback_had_client_id"], false);
    let q = captured.lock().unwrap().clone();
    assert_eq!(q["client_id"], ISSUED);
    assert_eq!(q["ext_agent_host_id"], host);
    assert!(q.contains_key("id_token_hint"));
    assert!(!q.contains_key("agent_name_hint"));
}

#[tokio::test]
async fn a_token_response_without_the_plan_scope_disables_inference() {
    let nonce = Arc::new(Mutex::new(String::new()));
    let mock = Mock::start(auth_handler(nonce.clone(), "openid profile email")).await;
    let f = fixture(&mock.base);
    // The callback claims the scope: only the token response may be believed.
    let (result, _) = probes::chatgpt_login(
        &f.ctx,
        None,
        browser(
            "&code=c&client_id=oaiapp_test123&scope=chatgpt.tokens.use.direct",
            nonce,
            Arc::new(Mutex::new(HashMap::new())),
        ),
    )
    .await;

    assert_eq!(result.status, ProbeStatus::Failed);
    assert_eq!(result.details["plan_enabled"], false);
    // The sign-in itself is kept.
    assert!(f.ctx.store.vault().unwrap().chatgpt.is_some());
    assert_eq!(
        auth::access_token(&f.ctx).await.unwrap_err(),
        auth::SessionError::PlanDisabled
    );
    let (report, _) = probes::run_chatgpt(&f.ctx, "m", &mut |_| {}).await;
    assert!(report.results.iter().all(|r| r.status == ProbeStatus::Skipped));
    assert!(mock.requests_to("/v1/").is_empty(), "no inference may be attempted");
}

#[tokio::test]
async fn an_id_token_with_the_wrong_nonce_stores_nothing() {
    // The server signs a nonce unrelated to this attempt.
    let wrong = Arc::new(Mutex::new("not-this-attempt".to_string()));
    let mock = Mock::start(auth_handler(wrong, FULL_SCOPE)).await;
    let f = fixture(&mock.base);
    let (result, _) = probes::chatgpt_login(
        &f.ctx,
        None,
        browser(
            "&code=c&client_id=oaiapp_test123",
            Arc::new(Mutex::new(String::new())),
            Arc::new(Mutex::new(HashMap::new())),
        ),
    )
    .await;

    assert_eq!(result.status, ProbeStatus::Failed);
    assert_eq!(result.details["stage"], "id_token");
    assert!(f.ctx.store.vault().unwrap().chatgpt.is_none());
    // Kept: the docs retry with the issued ID rather than registering again.
    assert_eq!(f.ctx.store.state().unwrap().chatgpt_client_id.as_deref(), Some(ISSUED));
}

#[tokio::test]
async fn access_denied_never_reaches_the_token_endpoint() {
    let nonce = Arc::new(Mutex::new(String::new()));
    let mock = Mock::start(auth_handler(nonce.clone(), FULL_SCOPE)).await;
    let f = fixture(&mock.base);
    let (result, _) = probes::chatgpt_login(
        &f.ctx,
        None,
        browser("&error=access_denied", nonce, Arc::new(Mutex::new(HashMap::new()))),
    )
    .await;
    assert_eq!(result.status, ProbeStatus::Failed);
    assert_eq!(result.error_code.as_deref(), Some("access_denied"));
    assert!(mock.requests_to("/api/accounts/oauth/token").is_empty());
}

#[tokio::test]
async fn an_invalid_grant_on_exchange_is_reported_with_its_request_id() {
    let mock = Mock::start(|_| {
        Reply::Json(400, json!({ "error": "invalid_grant", "error_description": "used" }))
    })
    .await;
    let f = fixture(&mock.base);
    let (result, _) = probes::chatgpt_login(
        &f.ctx,
        None,
        browser(
            "&code=auth-code-long-enough&client_id=oaiapp_test123",
            Arc::new(Mutex::new(String::new())),
            Arc::new(Mutex::new(HashMap::new())),
        ),
    )
    .await;
    assert_eq!(result.error_code.as_deref(), Some("invalid_grant"));
    assert_eq!(result.http_status, Some(400));
    assert_eq!(result.request_id.as_deref(), Some("req_1"));
    assert_eq!(result.details["raw_error_body"], r#"{"error":"invalid_grant","error_description":"used"}"#);
}

#[tokio::test]
async fn after_invalid_grant_the_retry_uses_the_issued_client_as_documented() {
    let first = Mock::start(|_| Reply::Json(400, json!({ "error": "invalid_grant" }))).await;
    let f = fixture(&first.base);
    let (result, path) = probes::chatgpt_login(
        &f.ctx,
        None,
        browser(
            "&code=the-secret-code&client_id=oaiapp_test123&scope=openid+email",
            Arc::new(Mutex::new(String::new())),
            Arc::new(Mutex::new(HashMap::new())),
        ),
    )
    .await;
    assert_eq!(result.details["stage"], "token_exchange");
    assert_eq!(result.details["mode"], "registration");
    assert_eq!(result.details["callback_scope"], "openid email");
    assert_eq!(result.details["callback_had_client_id"], true);
    let written = std::fs::read_to_string(path.unwrap()).unwrap();
    assert!(!written.contains("the-secret-code"));
    assert!(!written.contains(ISSUED), "the failure report keeps the issued ID out too");

    // The issued ID survived the failure, so the next attempt doesn't register again.
    assert_eq!(f.ctx.store.state().unwrap().chatgpt_client_id.as_deref(), Some(ISSUED));
    let captured = Arc::new(Mutex::new(HashMap::new()));
    let (retry, _) = probes::chatgpt_login(
        &f.ctx,
        None,
        browser("&code=c2", Arc::new(Mutex::new(String::new())), captured.clone()),
    )
    .await;
    assert_eq!(retry.details["mode"], "reauthorization");
    let q = captured.lock().unwrap().clone();
    assert_eq!(q["client_id"], ISSUED);
    assert!(!q.contains_key("agent_name_hint"));
    assert!(!q.contains_key("id_token_hint"), "no earlier sign-in to hint at");
}

#[tokio::test]
async fn a_server_echo_of_the_code_is_scrubbed_from_the_failure_report() {
    let mock = Mock::start(|req| {
        let code = req.form().get("code").cloned().unwrap_or_default();
        let verifier = req.form().get("code_verifier").cloned().unwrap_or_default();
        Reply::Json(400, json!({ "error": "invalid_grant", "code_was": code, "verifier_was": verifier, "client": ISSUED }))
    })
    .await;
    let f = fixture(&mock.base);
    let (result, _) = probes::chatgpt_login(
        &f.ctx,
        None,
        browser(
            "&code=echoed-code&client_id=oaiapp_test123",
            Arc::new(Mutex::new(String::new())),
            Arc::new(Mutex::new(HashMap::new())),
        ),
    )
    .await;
    let raw = result.details["raw_error_body"].as_str().unwrap();
    assert!(raw.contains("[code]") && raw.contains("[verifier]") && raw.contains("[client_id]"));
    assert!(!raw.contains("echoed-code"));
}

#[tokio::test]
async fn near_expiry_refreshes_rotates_and_saves_everything_together() {
    let mock = Mock::start(|_| {
        Reply::Json(
            200,
            json!({ "access_token": "access-new", "refresh_token": "refresh-new", "expires_in": 3600, "scope": FULL_SCOPE }),
        )
    })
    .await;
    let f = fixture(&mock.base);
    seed_session(&f.ctx, 10);
    let old_id = f.ctx.store.vault().unwrap().chatgpt.unwrap().id_token;

    assert_eq!(auth::access_token(&f.ctx).await.unwrap(), "access-new");

    let form = mock.requests_to("/api/accounts/oauth/token")[0].form();
    assert_eq!(form["grant_type"], "refresh_token");
    assert_eq!(form["client_id"], ISSUED);
    assert_eq!(form["refresh_token"], "refresh-old");
    assert_eq!(form["resource"], "https://api.openai.com/v1");
    assert!(!form.contains_key("scope"), "omitting scope keeps the grant");

    let saved = f.ctx.store.vault().unwrap().chatgpt.unwrap();
    assert_eq!(saved.refresh_token, "refresh-new");
    assert_eq!(saved.access_token, "access-new");
    assert_eq!(saved.id_token, old_id, "kept when the refresh omits it");
    assert!(saved.expires_at_unix > crate::now_unix() + 3000);
}

#[tokio::test]
async fn a_fresh_token_causes_no_refresh() {
    let mock = Mock::start(|_| Reply::Json(500, json!({}))).await;
    let f = fixture(&mock.base);
    seed_session(&f.ctx, 3600);
    assert_eq!(auth::access_token(&f.ctx).await.unwrap(), "access-old");
    assert!(mock.requests_to("/api/accounts/oauth/token").is_empty());
}

#[tokio::test]
async fn concurrent_callers_share_one_rotating_refresh() {
    let mock = Mock::start(|_| {
        Reply::Json(
            200,
            json!({ "access_token": "access-new", "refresh_token": "refresh-new", "expires_in": 3600, "scope": FULL_SCOPE }),
        )
    })
    .await;
    let f = fixture(&mock.base);
    seed_session(&f.ctx, 10);
    let (a, b, c) = tokio::join!(
        auth::access_token(&f.ctx),
        auth::access_token(&f.ctx),
        auth::access_token(&f.ctx)
    );
    assert_eq!(a.unwrap(), "access-new");
    assert_eq!(b.unwrap(), "access-new");
    assert_eq!(c.unwrap(), "access-new");
    assert_eq!(mock.requests_to("/api/accounts/oauth/token").len(), 1);
}

#[tokio::test]
async fn a_terminal_refresh_error_drops_tokens_but_keeps_client_and_host() {
    let mock = Mock::start(|_| Reply::Json(400, json!({ "error": "refresh_token_reused" }))).await;
    let f = fixture(&mock.base);
    seed_session(&f.ctx, 10);
    let host = f.ctx.store.host_id().unwrap();

    let e = auth::access_token(&f.ctx).await.unwrap_err();
    assert_eq!(
        e,
        auth::SessionError::SessionExpired {
            code: "refresh_token_reused".into()
        }
    );
    assert!(f.ctx.store.vault().unwrap().chatgpt.is_none());
    assert_eq!(f.ctx.store.state().unwrap().chatgpt_client_id.as_deref(), Some(ISSUED));
    assert_eq!(f.ctx.store.host_id().unwrap(), host);
}

#[tokio::test]
async fn a_temporary_refresh_failure_keeps_the_session() {
    let mock = Mock::start(|_| Reply::Json(503, json!({ "detail": "down" }))).await;
    let f = fixture(&mock.base);
    seed_session(&f.ctx, 10);
    assert!(matches!(
        auth::access_token(&f.ctx).await.unwrap_err(),
        auth::SessionError::RefreshFailed { .. }
    ));
    assert!(f.ctx.store.vault().unwrap().chatgpt.is_some());
}

#[tokio::test]
async fn sign_out_clears_tokens_only_after_a_confirmed_revocation() {
    let refused = Mock::start(|_| Reply::Json(500, json!({}))).await;
    let f = fixture(&refused.base);
    seed_session(&f.ctx, 3600);
    assert!(auth::sign_out(&f.ctx).await.is_err());
    assert!(f.ctx.store.vault().unwrap().chatgpt.is_some());

    let accepted = Mock::start(|_| Reply::Json(200, json!({}))).await;
    let g = fixture(&accepted.base);
    seed_session(&g.ctx, 3600);
    auth::sign_out(&g.ctx).await.unwrap();
    assert!(g.ctx.store.vault().unwrap().chatgpt.is_none());
    assert_eq!(g.ctx.store.state().unwrap().chatgpt_client_id.as_deref(), Some(ISSUED));
    let form = accepted.requests_to("/api/accounts/oauth/revoke")[0].form();
    assert_eq!(form["token"], "refresh-old");
    assert_eq!(form["token_type_hint"], "refresh_token");
    assert_eq!(form["client_id"], ISSUED);
}

fn sse(events: &[Value]) -> Vec<u8> {
    events
        .iter()
        .map(|e| format!("event: {}\ndata: {e}\n\n", e["type"].as_str().unwrap_or("")))
        .collect::<String>()
        .into_bytes()
}

fn completed_events(text: &str) -> Vec<Value> {
    vec![
        json!({ "type": "response.created" }),
        json!({ "type": "response.output_text.delta", "delta": text }),
        json!({ "type": "response.completed", "response": { "usage": { "total_tokens": 9 }, "output": [] } }),
    ]
}

#[tokio::test]
async fn streams_deltas_split_inside_a_multibyte_character() {
    let bytes = sse(&completed_events("añoranza"));
    let at = bytes.windows(2).position(|w| w == "ñ".as_bytes()).unwrap() + 1;
    let chunks = vec![bytes[..at].to_vec(), bytes[at..].to_vec()];
    let mock = Mock::start(move |_| Reply::Stream {
        chunks: chunks.clone(),
        complete: true,
    })
    .await;
    let f = fixture(&mock.base);
    let mut seen = String::new();
    let o = api::stream_responses(&f.ctx, "tok", &api::body_rewrite("m", "s"), &mut |d| seen.push_str(d)).await;
    assert!(o.succeeded(), "{o:?}");
    assert_eq!(seen, "añoranza");
    assert_eq!(o.request_id.as_deref(), Some("req_2"));
    let req = &mock.requests_to("/v1/responses")[0];
    assert_eq!(req.authorization.as_deref(), Some("Bearer tok"));
    assert_eq!(req.json()["store"], false);
}

#[tokio::test]
async fn a_dropped_connection_is_interrupted_and_keeps_the_partial_draft() {
    let bytes = sse(&[json!({ "type": "response.output_text.delta", "delta": "Texto a medias" })]);
    let mock = Mock::start(move |_| Reply::Stream {
        chunks: vec![bytes.clone()],
        complete: false,
    })
    .await;
    let f = fixture(&mock.base);
    let o = api::stream_responses(&f.ctx, "t", &api::body_rewrite("m", "s"), &mut |_| {}).await;
    assert_eq!(o.terminal, Terminal::Interrupted);
    assert!(!o.succeeded());
    assert_eq!(o.text, "Texto a medias");
    assert!(o.error.is_some());
}

#[tokio::test]
async fn a_clean_end_without_a_terminal_event_is_not_success() {
    let bytes = sse(&[json!({ "type": "response.output_text.delta", "delta": "x" })]);
    let mock = Mock::start(move |_| Reply::Stream {
        chunks: vec![bytes.clone()],
        complete: true,
    })
    .await;
    let f = fixture(&mock.base);
    let o = api::stream_responses(&f.ctx, "t", &api::body_rewrite("m", "s"), &mut |_| {}).await;
    assert_eq!(o.terminal, Terminal::Interrupted);
}

#[tokio::test]
async fn usage_limit_stops_the_battery_and_the_rest_is_skipped() {
    let mock = Mock::start(|req| match req.path.as_str() {
        "/v1/models" => Reply::Json(200, json!({ "models": [{ "slug": "m", "display_name": "M", "visibility": "list", "extra": 1 }] })),
        _ => Reply::Json(
            429,
            json!({ "error": { "code": "subscription_sharing_usage_limit_exceeded", "message": "limit" } }),
        ),
    })
    .await;
    let f = fixture(&mock.base);
    seed_session(&f.ctx, 3600);
    let mut streamed = Vec::new();
    let (report, path) = probes::run_chatgpt(&f.ctx, "m", &mut |r| streamed.push(r.probe.clone())).await;

    assert_eq!(mock.requests_to("/v1/responses").len(), 1, "no retry after the limit");
    let status = |name: &str| report.results.iter().find(|r| r.probe == name).unwrap();
    assert_eq!(status("models").status, ProbeStatus::Ok);
    assert_eq!(status("stream_rewrite").status, ProbeStatus::Rejected);
    assert_eq!(status("stream_rewrite").http_status, Some(429));
    assert_eq!(status("web_search").status, ProbeStatus::Skipped);
    assert_eq!(status("refresh").status, ProbeStatus::Skipped);
    assert_eq!(streamed.len(), report.results.len());
    assert!(path.unwrap().exists());
    assert_eq!(status("models").details["first_model_fields"][0], "display_name");
}

/// Replies to each probe body the way the real route might.
fn happy_responses(req: &Seen) -> Reply {
    let extraction = json!({
        "entities": [{ "name": "Marta", "type": "person", "aliases": [] }],
        "facts": [{ "entity": "Marta", "attribute": "ojos", "value": "verdes", "quote": "los ojos verdes de su madre", "story_time": null }],
        "relations": []
    })
    .to_string();
    let body = req.json();
    match req.path.as_str() {
        "/v1/models" => Reply::Json(200, json!({ "models": [{ "slug": "m", "display_name": "M", "visibility": "list" }] })),
        "/api/accounts/oauth/token" => Reply::Json(
            200,
            json!({ "access_token": "access-2", "refresh_token": "refresh-2", "expires_in": 3600, "scope": FULL_SCOPE, "earliest_refresh_at": 99 }),
        ),
        "/v1/responses" => {
            if body.get("temperature").is_some() {
                return Reply::Json(400, json!({ "error": { "code": "subscription_sharing_unsupported_capability", "param": "temperature" } }));
            }
            if body["input"].to_string().contains("\"system\"") {
                return Reply::Json(400, json!({ "error": { "code": "invalid_request", "param": "input" } }));
            }
            let output = if body.get("tools").is_some_and(|t| t[0]["type"] == "web_search") {
                json!([
                    { "type": "web_search_call", "action": { "type": "search", "sources": [{ "type": "url", "url": "https://fuente.example" }] } },
                    { "type": "message", "content": [{ "type": "output_text", "text": "Dato.", "annotations": [{ "type": "url_citation", "url": "https://fuente.example", "title": "F" }] }] }
                ])
            } else if body.get("tools").is_some() || body["input"][0]["type"] == "additional_tools" {
                json!([{ "type": "function_call", "name": "report_extraction", "arguments": extraction }])
            } else if body.get("text").is_some() {
                json!([{ "type": "message", "content": [{ "type": "output_text", "text": extraction, "annotations": [] }] }])
            } else {
                json!([{ "type": "message", "content": [{ "type": "output_text", "text": "Borrador secreto", "annotations": [] }] }])
            };
            Reply::Stream {
                chunks: vec![sse(&[json!({ "type": "response.completed", "response": { "output": output } })])],
                complete: true,
            }
        }
        _ => Reply::Json(404, json!({})),
    }
}

#[tokio::test]
async fn the_full_battery_passes_and_its_report_holds_only_metadata() {
    let mock = Mock::start(happy_responses).await;
    let f = fixture(&mock.base);
    seed_session(&f.ctx, 3600);
    let (report, path) = probes::run_chatgpt(&f.ctx, "m", &mut |_| {}).await;

    let status = |name: &str| report.results.iter().find(|r| r.probe == name).unwrap().status;
    for name in [
        "models",
        "stream_rewrite",
        "structured_text_format",
        "tool_forced_top_level",
        "tool_namespace_required",
        "tool_namespace_named",
        "tool_additional_tools",
        "web_search",
        "refresh",
    ] {
        assert_eq!(status(name), ProbeStatus::Ok, "{name}");
    }
    assert_eq!(status("reject_temperature"), ProbeStatus::Rejected);
    assert_eq!(status("reject_system_message"), ProbeStatus::Rejected);

    // The real token sent is never written, nor is scene text or model output.
    let written = std::fs::read_to_string(path.unwrap()).unwrap();
    let scene = contract::scene(contract::REWRITE_SCENE).text;
    for forbidden in ["access-old", "refresh-old", "access-2", "refresh-2", "Borrador secreto", "los ojos verdes", &scene] {
        assert!(!written.contains(forbidden), "report leaked {forbidden}");
    }
    assert!(written.contains("https://fuente.example"), "cited sources are evidence");
    assert_eq!(f.ctx.store.vault().unwrap().chatgpt.unwrap().refresh_token, "refresh-2");
}

#[tokio::test]
async fn an_openrouter_sign_in_stores_the_key_and_reports_only_a_prefix() {
    let mock = Mock::start(|_| Reply::Json(200, json!({ "key": "sk-or-v1-secret", "user_id": "user_1" }))).await;
    let f = fixture(&mock.base);
    let captured = Arc::new(Mutex::new(HashMap::new()));
    let cap = captured.clone();
    let (result, path) = probes::openrouter_login(&f.ctx, move |url| {
        let q: HashMap<String, String> = Url::parse(url).unwrap().query_pairs().into_owned().collect();
        let target = format!("{}?code=code-9&state={}", q["callback_url"], q["state"]);
        *cap.lock().unwrap() = q;
        tokio::spawn(async move {
            let _ = reqwest::get(target).await;
        });
        Ok(())
    })
    .await;

    assert_eq!(result.status, ProbeStatus::Ok, "{result:?}");
    let exchange = mock.requests_to("/api/v1/auth/keys")[0].json();
    assert_eq!(exchange["code"], "code-9");
    assert_eq!(exchange["code_challenge_method"], "S256");
    let verifier = exchange["code_verifier"].as_str().unwrap();
    assert_eq!(crate::pkce::challenge_s256(verifier), captured.lock().unwrap()["code_challenge"]);
    assert_eq!(f.ctx.store.vault().unwrap().openrouter_key.as_deref(), Some("sk-or-v1-secret"));
    let written = std::fs::read_to_string(path.unwrap()).unwrap();
    assert!(!written.contains("sk-or-v1-secret"));
    assert!(written.contains("sk-or-v1"));
}

#[tokio::test]
async fn openrouter_ignores_comments_and_catches_a_mid_stream_error() {
    let ok = ": OPENROUTER PROCESSING\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"Hola\"}}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
    let mock = Mock::start(move |_| Reply::Stream {
        chunks: vec![ok.as_bytes().to_vec()],
        complete: true,
    })
    .await;
    let f = fixture(&mock.base);
    let o = openrouter::stream_chat(&f.ctx, "k", &openrouter::body_rewrite("m", "s"), &mut |_| {}).await;
    assert!(o.succeeded(), "{o:?}");
    assert_eq!(o.text, "Hola");

    let bad = "data: {\"choices\":[{\"delta\":{\"content\":\"par\"}}]}\n\ndata: {\"error\":{\"code\":502,\"message\":\"down\"},\"choices\":[{\"delta\":{},\"finish_reason\":\"error\"}]}\n\ndata: [DONE]\n\n";
    let mock = Mock::start(move |_| Reply::Stream {
        chunks: vec![bad.as_bytes().to_vec()],
        complete: true,
    })
    .await;
    let f = fixture(&mock.base);
    let o = openrouter::stream_chat(&f.ctx, "k", &openrouter::body_rewrite("m", "s"), &mut |_| {}).await;
    assert_eq!(o.terminal, Terminal::Failed);
    assert_eq!(o.http_status, Some(200));
    assert_eq!(o.error_code(), Some("502"));
}

#[tokio::test]
async fn without_credits_the_openrouter_battery_stops_early() {
    let mock = Mock::start(|req| match req.path.as_str() {
        "/api/v1/models" => Reply::Json(200, json!({ "data": [{ "id": "x/y", "supported_parameters": ["structured_outputs"] }] })),
        _ => Reply::Json(402, json!({ "error": { "code": 402, "message": "Insufficient credits" } })),
    })
    .await;
    let f = fixture(&mock.base);
    f.ctx.store.update_vault(|v| v.openrouter_key = Some("k".into())).unwrap();
    let (report, _) = probes::run_openrouter(&f.ctx, "x/y", true, &mut |_| {}).await;
    assert_eq!(mock.requests_to("/api/v1/chat/completions").len(), 1);
    assert!(mock.requests_to("/api/v1/responses").is_empty(), "no paid search after a 402");
    let search = report.results.iter().find(|r| r.probe == "web_search_responses_api").unwrap();
    assert_eq!(search.status, ProbeStatus::Skipped);
}

#[tokio::test]
async fn openrouter_web_search_never_runs_unless_requested() {
    let chunk = b"data: {\"choices\":[{\"delta\":{\"content\":\"x\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
    let mock = Mock::start(move |req| match req.path.as_str() {
        "/api/v1/models" => Reply::Json(200, json!({ "data": [{ "id": "x/y" }] })),
        "/api/v1/key" => Reply::Json(200, json!({ "data": { "usage": 0.5, "limit": null, "label": "sk-or-v1-preview", "is_free_tier": true } })),
        _ => Reply::Stream {
            chunks: vec![chunk.to_vec()],
            complete: true,
        },
    })
    .await;
    let f = fixture(&mock.base);
    f.ctx.store.update_vault(|v| v.openrouter_key = Some("k".into())).unwrap();
    let (report, path) = probes::run_openrouter(&f.ctx, "x/y", false, &mut |_| {}).await;

    assert!(mock.requests_to("/api/v1/responses").is_empty());
    let chat = mock.requests_to("/api/v1/chat/completions");
    assert_eq!(chat.len(), 2, "only the rewrite and the structured probe");
    assert!(chat.iter().all(|r| r.json().get("tools").is_none()));
    for name in ["web_search_responses_api", "web_search_chat_completions"] {
        let r = report.results.iter().find(|r| r.probe == name).unwrap();
        assert_eq!(r.status, ProbeStatus::Skipped, "{name}");
    }
    let spend = report.results.iter().find(|r| r.probe == "key_spend").unwrap();
    assert_eq!(spend.details["after"]["usage"], 0.5);
    assert_eq!(spend.details["after"]["is_free_tier"], true);
    let written = std::fs::read_to_string(path.unwrap()).unwrap();
    assert!(!written.contains("sk-or-v1-preview"), "the key's own description stays out");
}

#[tokio::test]
async fn ollama_streams_ndjson_and_checks_the_contract() {
    let reply = |text: &str| {
        let content = serde_json::to_string(text).unwrap();
        format!(
            "{{\"message\":{{\"role\":\"assistant\",\"content\":{content}}},\"done\":false}}\n{{\"message\":{{\"role\":\"assistant\",\"content\":\"\"}},\"done\":true,\"done_reason\":\"stop\",\"eval_count\":3}}\n"
        )
        .into_bytes()
    };
    let extraction = reply(r#"{"entities":[{"name":"Tomás","type":"person","aliases":[]}],"facts":[],"relations":[{"from":"Tomás","to":"Marta","label":"hermano de","quote":"Tomás, su hermano"}]}"#);
    let rewrite = reply("Reescrito");
    let mock = Mock::start(move |req| match req.path.as_str() {
        "/api/tags" => Reply::Json(200, json!({ "models": [{ "name": "m:1", "size": 5, "details": { "family": "f" } }] })),
        "/api/version" => Reply::Json(200, json!({ "version": "0.40" })),
        "/api/chat" if req.json().get("format").is_some() => Reply::Stream {
            chunks: vec![extraction.clone()],
            complete: true,
        },
        "/api/chat" => Reply::Stream {
            chunks: vec![rewrite.clone()],
            complete: true,
        },
        _ => Reply::Json(404, json!({})),
    })
    .await;
    let f = fixture(&mock.base);
    let (report, _) = probes::run_ollama(&f.ctx, None, &mut |_| {}).await;
    assert_eq!(report.model.as_deref(), Some("m:1"));
    let by = |name: &str| report.results.iter().find(|r| r.probe == name).unwrap();
    assert_eq!(by("server").status, ProbeStatus::Ok);
    assert_eq!(by("server").details["models_installed"], 1);
    assert_eq!(by("stream_rewrite").status, ProbeStatus::Ok);
    assert_eq!(by("structured_format").status, ProbeStatus::Ok);
    assert_eq!(by("structured_format").details["contract"]["quotes_literal"], 1);
    assert_eq!(by("web_search").status, ProbeStatus::Skipped);
}

#[tokio::test]
async fn the_ollama_report_names_only_the_model_under_test() {
    let done = br#"{"message":{"content":"x"},"done":true,"done_reason":"stop"}
"#;
    let mock = Mock::start(move |req| match req.path.as_str() {
        "/api/tags" => Reply::Json(200, json!({ "models": [{ "name": "under-test" }, { "name": "private-model" }] })),
        "/api/version" => Reply::Json(200, json!({ "version": "0.40" })),
        _ => Reply::Stream {
            chunks: vec![done.to_vec()],
            complete: true,
        },
    })
    .await;
    let f = fixture(&mock.base);
    let (_, path) = probes::run_ollama(&f.ctx, Some("under-test"), &mut |_| {}).await;
    let written = std::fs::read_to_string(path.unwrap()).unwrap();
    assert!(written.contains("under-test"));
    assert!(!written.contains("private-model"));
}

#[tokio::test]
async fn ollama_not_running_is_reported_without_a_failure_cascade() {
    // Binds and immediately frees a port, so nothing answers on it.
    let free = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let base = format!("http://127.0.0.1:{}", free.local_addr().unwrap().port());
    drop(free);
    let f = fixture(&base);
    assert!(ollama::server(&f.ctx).await.is_err());
    let (report, path) = probes::run_ollama(&f.ctx, Some("m"), &mut |_| {}).await;
    assert_eq!(report.results[0].probe, "server");
    assert_eq!(report.results[0].status, ProbeStatus::Failed);
    assert!(report.results[1..].iter().all(|r| r.status == ProbeStatus::Skipped));
    assert!(path.unwrap().exists());
    let o = ollama::stream_chat(&f.ctx, &ollama::body_rewrite("m", "s"), &mut |_| {}).await;
    assert_eq!(o.terminal, Terminal::Unreachable);
}
