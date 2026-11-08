//! OpenRouter: OAuth PKCE, model list and Chat Completions streaming.

use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{Value, json};
use url::Url;

use crate::chatgpt::api::collect_items;
use crate::contract;
use crate::ctx::Ctx;
use crate::lines::SseParser;
use crate::loopback::{Decision, Loopback, WaitError};
use crate::pkce::Attempt;
use crate::stream::{ApiError, StreamOutcome, Terminal, citation_from, read_chunks, request_id};

const CALLBACK_PATH: &str = "/callback";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
/// Keeps each test cheap on the user's own credits. Reasoning counts against
/// it: a real run at 1500 ended on `length` before writing any output.
const MAX_TOKENS: u32 = 4000;

pub fn auth_url(base: &str, callback_url: &str, attempt: &Attempt) -> Result<String, String> {
    let mut url = Url::parse(&format!("{base}/auth")).map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("callback_url", callback_url)
        .append_pair("code_challenge", &attempt.challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &attempt.state)
        .append_pair("key_label", "Ink Writer M0");
    Ok(url.into())
}

#[derive(Debug, PartialEq, Eq)]
pub enum CallbackResult {
    Code(String),
    Denied(String),
}

/// The docs say `state` is echoed unchanged except on denial. A denial thus
/// can't be checked against it; a code always must.
pub fn parse_callback(query: &str, expected_state: &str) -> Option<CallbackResult> {
    let get = |name: &str| {
        url::form_urlencoded::parse(query.as_bytes())
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.into_owned())
    };
    if let Some(error) = get("error") {
        return Some(CallbackResult::Denied(error));
    }
    if get("state").as_deref() != Some(expected_state) {
        return None;
    }
    get("code").filter(|c| !c.is_empty()).map(CallbackResult::Code)
}

#[derive(Debug, Clone, Serialize)]
pub struct LoginEvidence {
    pub port: u16,
    pub key_prefix: String,
    pub user_id_present: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoginFailure {
    pub stage: &'static str,
    pub http_status: Option<u16>,
    pub code: Option<String>,
    pub message: String,
    pub request_id: Option<String>,
}

pub async fn login(
    ctx: &Ctx,
    open_browser: impl FnOnce(&str) -> Result<(), String>,
) -> Result<LoginEvidence, LoginFailure> {
    let fail = |stage: &'static str, message: String| LoginFailure {
        stage,
        http_status: None,
        code: None,
        message,
        request_id: None,
    };
    let listener = Loopback::bind(0)
        .await
        .map_err(|e| fail("listener", e.to_string()))?;
    let port = listener.port;
    // The listener is on 127.0.0.1; "localhost" is the form the guide documents.
    let callback_url = format!("http://localhost:{port}{CALLBACK_PATH}");
    let attempt = Attempt::new();
    let url = auth_url(&ctx.endpoints.openrouter_base, &callback_url, &attempt)
        .map_err(|e| fail("auth_url", e))?;
    open_browser(&url).map_err(|e| fail("browser", e))?;

    let result = listener
        .wait(CALLBACK_PATH, LOGIN_TIMEOUT, |q| match parse_callback(q, &attempt.state) {
            Some(r) => Decision::Done(r),
            None => Decision::KeepWaiting,
        })
        .await
        .map_err(|e| {
            fail(
                "callback",
                match e {
                    WaitError::Timeout => "no callback arrived in time".into(),
                    WaitError::Io(m) => m,
                },
            )
        })?;
    let code = match result {
        CallbackResult::Code(c) => c,
        CallbackResult::Denied(e) => {
            return Err(LoginFailure {
                code: Some(e),
                ..fail("callback", "authorization denied".into())
            });
        }
    };

    let resp = ctx
        .http
        .post(format!("{}/api/v1/auth/keys", ctx.endpoints.openrouter_base))
        .json(&json!({
            "code": code,
            "code_verifier": attempt.verifier,
            "code_challenge_method": "S256",
        }))
        .send()
        .await
        .map_err(|e| fail("exchange", e.to_string()))?;
    let status = resp.status();
    let rid = request_id(resp.headers());
    let body = resp.text().await.map_err(|e| fail("exchange", e.to_string()))?;
    if !status.is_success() {
        let api = ApiError::from_body(&body);
        return Err(LoginFailure {
            stage: "exchange",
            http_status: Some(status.as_u16()),
            code: api.code,
            message: api.message.unwrap_or_default(),
            request_id: rid,
        });
    }
    let v: Value = serde_json::from_str(&body).map_err(|e| fail("exchange", e.to_string()))?;
    let key = v
        .get("key")
        .and_then(Value::as_str)
        .filter(|k| !k.is_empty())
        .ok_or_else(|| fail("exchange", "exchange response has no key".into()))?
        .to_string();
    let key_prefix: String = key.split('-').take(3).collect::<Vec<_>>().join("-");
    ctx.store
        .update_vault(|vault| vault.openrouter_key = Some(key))
        .map_err(|e| fail("store", e))?;
    Ok(LoginEvidence {
        port,
        key_prefix,
        user_id_present: v.get("user_id").is_some_and(|u| !u.is_null()),
    })
}

pub fn saved_key(ctx: &Ctx) -> Result<String, String> {
    ctx.store
        .vault()?
        .openrouter_key
        .ok_or_else(|| "OpenRouter isn't connected".to_string())
}

/// Spend and limits of the stored key. Listed field by field, because the
/// response also describes the key itself.
pub async fn key_status(ctx: &Ctx) -> Result<Value, String> {
    let key = saved_key(ctx)?;
    let resp = ctx
        .http
        .get(format!("{}/api/v1/key", ctx.endpoints.openrouter_base))
        .bearer_auth(key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("key status returned {}", resp.status()));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let d = v.get("data").unwrap_or(&v);
    // Account balance. It may need a management key, hence the separate result.
    let credits = match ctx
        .http
        .get(format!("{}/api/v1/credits", ctx.endpoints.openrouter_base))
        .bearer_auth(saved_key(ctx)?)
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => {
            let c: Value = r.json().await.unwrap_or_default();
            json!({
                "total_credits": c.pointer("/data/total_credits"),
                "total_usage": c.pointer("/data/total_usage"),
            })
        }
        Ok(r) => json!({ "unavailable": r.status().as_u16() }),
        Err(_) => json!({ "unavailable": "no connection" }),
    };
    Ok(json!({
        "usage": d.get("usage"),
        "limit": d.get("limit"),
        "limit_remaining": d.get("limit_remaining"),
        "is_free_tier": d.get("is_free_tier"),
        "account": credits,
    }))
}

#[derive(Debug, Clone, Serialize)]
pub struct Model {
    pub id: String,
    pub name: String,
    pub structured_outputs: bool,
    pub tools: bool,
    pub price_prompt: Option<String>,
    pub price_completion: Option<String>,
    pub price_web_search: Option<String>,
}

pub fn parse_models(v: &Value) -> Vec<Model> {
    let has = |m: &Value, p: &str| {
        m.get("supported_parameters")
            .and_then(Value::as_array)
            .is_some_and(|a| a.iter().any(|x| x.as_str() == Some(p)))
    };
    let price = |m: &Value, p: &str| {
        m.get("pricing")
            .and_then(|x| x.get(p))
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    v.get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let id = m.get("id")?.as_str()?.to_string();
            Some(Model {
                name: m.get("name").and_then(Value::as_str).unwrap_or(&id).to_string(),
                id,
                structured_outputs: has(m, "structured_outputs"),
                tools: has(m, "tools"),
                price_prompt: price(m, "prompt"),
                price_completion: price(m, "completion"),
                price_web_search: price(m, "web_search"),
            })
        })
        .collect()
}

pub async fn list_models(ctx: &Ctx) -> Result<Vec<Model>, String> {
    let resp = ctx
        .http
        .get(format!("{}/api/v1/models", ctx.endpoints.openrouter_base))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("models request returned {}", resp.status()));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(parse_models(&v))
}

// --- Request bodies ---

fn messages(system: &str, user: &str) -> Value {
    json!([{ "role": "system", "content": system }, { "role": "user", "content": user }])
}

pub fn body_rewrite(model: &str, scene: &str) -> Value {
    json!({
        "model": model,
        "stream": true,
        "max_tokens": MAX_TOKENS,
        "messages": messages(
            "Prueba técnica de streaming. Reescribe la escena con otras palabras, conservando los hechos. Devuelve solo el texto.",
            scene,
        ),
    })
}

/// `require_parameters` keeps routing away from endpoints that would ignore the
/// schema. Without it the request could silently lose its guarantee.
pub fn body_structured(model: &str, scene: &str) -> Value {
    json!({
        "model": model,
        "stream": true,
        "max_tokens": MAX_TOKENS,
        "messages": messages(contract::EXTRACTION_INSTRUCTIONS, scene),
        "response_format": { "type": "json_schema", "json_schema": {
            "name": "scene_extraction",
            "strict": true,
            "schema": contract::extraction_schema(),
        }},
        "provider": { "require_parameters": true },
    })
}

fn web_search_tool() -> Value {
    json!({ "type": "openrouter:web_search", "parameters": { "engine": "exa", "max_results": 3 } })
}

pub fn body_web_search_responses(model: &str, topic: &str) -> Value {
    json!({
        "model": model,
        "stream": false,
        "input": topic,
        "max_output_tokens": MAX_TOKENS,
        "tools": [web_search_tool()],
    })
}

pub fn body_web_search_chat(model: &str, topic: &str) -> Value {
    json!({
        "model": model,
        "stream": false,
        "max_tokens": MAX_TOKENS,
        "messages": [{ "role": "user", "content": topic }],
        "tools": [web_search_tool()],
    })
}

// --- Stream handling ---

/// Reduces Chat Completions chunks to an outcome. A 200 can still carry a
/// failure, in a final chunk with a top-level `error`.
pub struct ChatState {
    out: StreamOutcome,
    started: Instant,
    finish_reason: Option<String>,
    done: bool,
    failed: bool,
}

impl ChatState {
    pub fn new(started: Instant) -> Self {
        Self {
            out: StreamOutcome::new(Terminal::Interrupted),
            started,
            finish_reason: None,
            done: false,
            failed: false,
        }
    }

    pub fn on_data(&mut self, data: &str, on_delta: &mut dyn FnMut(&str)) {
        if data.trim() == "[DONE]" {
            self.done = true;
            *self.out.event_types.entry("[DONE]".into()).or_default() += 1;
            return;
        }
        let Ok(v) = serde_json::from_str::<Value>(data) else {
            *self.out.event_types.entry("(unparsable)".into()).or_default() += 1;
            return;
        };
        *self.out.event_types.entry("chunk".into()).or_default() += 1;
        if let Some(err) = v.get("error") {
            self.failed = true;
            self.out.error = Some(ApiError::from_object(err));
        }
        if let Some(u) = v.get("usage").filter(|u| !u.is_null()) {
            self.out.usage = Some(u.clone());
        }
        if let Some(choice) = v.pointer("/choices/0") {
            if let Some(d) = choice.pointer("/delta/content").and_then(Value::as_str) {
                if !d.is_empty() {
                    if self.out.first_delta_ms.is_none() {
                        self.out.first_delta_ms = Some(self.started.elapsed().as_millis() as u64);
                    }
                    self.out.text.push_str(d);
                    on_delta(d);
                }
            }
            if let Some(r) = choice.get("finish_reason").and_then(Value::as_str) {
                self.finish_reason = Some(r.to_string());
            }
        }
    }

    pub fn finish(mut self, transport_error: Option<String>) -> StreamOutcome {
        self.out.finish_detail = self.finish_reason.clone().map(Value::String);
        self.out.terminal = if self.failed || self.finish_reason.as_deref() == Some("error") {
            Terminal::Failed
        } else if !self.done || self.finish_reason.is_none() {
            Terminal::Interrupted
        } else if self.finish_reason.as_deref() == Some("length") {
            Terminal::Incomplete
        } else {
            Terminal::Completed
        };
        if self.out.terminal == Terminal::Interrupted {
            self.out.error = Some(ApiError {
                message: Some(transport_error.unwrap_or_else(|| "stream ended before [DONE]".into())),
                ..ApiError::default()
            });
        }
        self.out.total_ms = self.started.elapsed().as_millis() as u64;
        self.out
    }
}

pub async fn stream_chat(
    ctx: &Ctx,
    key: &str,
    body: &Value,
    on_delta: &mut (dyn FnMut(&str) + Send),
) -> StreamOutcome {
    let started = Instant::now();
    let sent = ctx
        .http
        .post(format!("{}/api/v1/chat/completions", ctx.endpoints.openrouter_base))
        .bearer_auth(key)
        .json(body)
        .send()
        .await;
    let resp = match sent {
        Ok(r) => r,
        Err(e) => return StreamOutcome::unreachable(e.to_string()),
    };
    let mut meta = StreamOutcome::new(Terminal::HttpError);
    meta.take_response_meta(&resp);
    if !resp.status().is_success() {
        meta.error = Some(ApiError::from_body(&resp.text().await.unwrap_or_default()));
        meta.total_ms = started.elapsed().as_millis() as u64;
        return meta;
    }
    let mut state = ChatState::new(started);
    let mut sse = SseParser::default();
    let read = read_chunks(resp, |chunk| {
        for ev in sse.push(chunk) {
            state.on_data(&ev.data, &mut *on_delta);
        }
    })
    .await;
    for ev in sse.finish() {
        state.on_data(&ev.data, &mut *on_delta);
    }
    let mut out = state.finish(read.err());
    out.http_status = meta.http_status;
    out.request_id = meta.request_id;
    out.headers = meta.headers;
    out.header_names = meta.header_names;
    out
}

/// Non-streaming POST, used only for the web search probes.
pub async fn post_once(ctx: &Ctx, key: &str, path: &str, body: &Value) -> StreamOutcome {
    let started = Instant::now();
    let sent = ctx
        .http
        .post(format!("{}{path}", ctx.endpoints.openrouter_base))
        .bearer_auth(key)
        .json(body)
        .send()
        .await;
    let resp = match sent {
        Ok(r) => r,
        Err(e) => return StreamOutcome::unreachable(e.to_string()),
    };
    let mut out = StreamOutcome::new(Terminal::HttpError);
    out.take_response_meta(&resp);
    let ok = resp.status().is_success();
    let text = resp.text().await.unwrap_or_default();
    out.total_ms = started.elapsed().as_millis() as u64;
    if !ok {
        out.error = Some(ApiError::from_body(&text));
        return out;
    }
    let Ok(v) = serde_json::from_str::<Value>(&text) else {
        out.terminal = Terminal::Failed;
        out.error = Some(ApiError {
            message: Some("response is not JSON".into()),
            ..ApiError::default()
        });
        return out;
    };
    read_full_response(&v, &mut out);
    out
}

/// Reads either a Responses object or a Chat Completions object.
pub fn read_full_response(v: &Value, out: &mut StreamOutcome) {
    out.usage = v.get("usage").filter(|u| !u.is_null()).cloned();
    if let Some(err) = v.get("error").filter(|e| !e.is_null()) {
        out.terminal = Terminal::Failed;
        out.error = Some(ApiError::from_object(err));
        return;
    }
    out.terminal = Terminal::Completed;
    if let Some(items) = v.get("output").and_then(Value::as_array) {
        collect_items(items, out);
        match v.get("status").and_then(Value::as_str) {
            Some("failed") => out.terminal = Terminal::Failed,
            Some("incomplete") => out.terminal = Terminal::Incomplete,
            _ => {}
        }
    } else if let Some(msg) = v.pointer("/choices/0/message") {
        out.text = msg.get("content").and_then(Value::as_str).unwrap_or_default().to_string();
        for a in msg.get("annotations").and_then(Value::as_array).into_iter().flatten() {
            out.citations.extend(citation_from(a));
        }
    }
    if let Some(n) = v
        .pointer("/usage/server_tool_use_details/web_search_requests")
        .and_then(Value::as_u64)
    {
        out.web_search_calls = out.web_search_calls.max(n as u32);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(lines: &[&str]) -> StreamOutcome {
        let mut st = ChatState::new(Instant::now());
        for l in lines {
            st.on_data(l, &mut |_| {});
        }
        st.finish(None)
    }

    #[test]
    fn auth_url_has_the_documented_parameters() {
        let a = Attempt::new();
        let u = auth_url("https://openrouter.ai", "http://localhost:5/callback", &a).unwrap();
        let q: std::collections::HashMap<_, _> = Url::parse(&u).unwrap().query_pairs().into_owned().collect();
        assert!(u.starts_with("https://openrouter.ai/auth?"));
        assert_eq!(q["callback_url"], "http://localhost:5/callback");
        assert_eq!(q["code_challenge"], a.challenge);
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["state"], a.state);
    }

    #[test]
    fn callback_requires_the_state_for_a_code_but_not_for_a_denial() {
        assert_eq!(parse_callback("code=c&state=st", "st"), Some(CallbackResult::Code("c".into())));
        assert_eq!(parse_callback("code=c&state=bad", "st"), None);
        assert_eq!(parse_callback("code=c", "st"), None);
        assert_eq!(
            parse_callback("error=access_denied", "st"),
            Some(CallbackResult::Denied("access_denied".into()))
        );
    }

    #[test]
    fn completes_with_finish_reason_and_done() {
        let o = feed(&[
            r#"{"choices":[{"delta":{"content":"Hola"}}]}"#,
            r#"{"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"total_tokens":3}}"#,
            "[DONE]",
        ]);
        assert!(o.succeeded());
        assert_eq!(o.text, "Hola");
        assert_eq!(o.usage.unwrap()["total_tokens"], 3);
    }

    #[test]
    fn a_mid_stream_error_chunk_is_a_failure_despite_http_200() {
        let o = feed(&[
            r#"{"choices":[{"delta":{"content":"par"}}]}"#,
            r#"{"error":{"code":429,"message":"Rate limit exceeded","metadata":{"error_type":"rate_limit_exceeded"}},"choices":[{"index":0,"delta":{"content":""},"finish_reason":"error"}]}"#,
            "[DONE]",
        ]);
        assert_eq!(o.terminal, Terminal::Failed);
        assert_eq!(o.error_code(), Some("429"));
        assert_eq!(o.error.unwrap().kind.as_deref(), Some("rate_limit_exceeded"));
    }

    #[test]
    fn a_cut_stream_is_interrupted_and_length_is_incomplete() {
        let cut = feed(&[r#"{"choices":[{"delta":{"content":"par"}}]}"#]);
        assert_eq!(cut.terminal, Terminal::Interrupted);
        let long = feed(&[r#"{"choices":[{"delta":{},"finish_reason":"length"}]}"#, "[DONE]"]);
        assert_eq!(long.terminal, Terminal::Incomplete);
    }

    #[test]
    fn parses_model_capabilities() {
        let v = json!({ "data": [{
            "id": "x/y", "name": "Y",
            "supported_parameters": ["structured_outputs", "tools"],
            "pricing": { "prompt": "0.1", "completion": "0.2", "web_search": "0.007" }
        }, { "id": "x/z" }]});
        let m = parse_models(&v);
        assert!(m[0].structured_outputs && m[0].tools);
        assert_eq!(m[0].price_web_search.as_deref(), Some("0.007"));
        assert!(!m[1].structured_outputs);
        assert_eq!(m[1].name, "x/z");
    }

    #[test]
    fn reads_citations_from_both_response_shapes() {
        let mut chat = StreamOutcome::new(Terminal::HttpError);
        read_full_response(
            &json!({ "choices": [{ "message": { "content": "t", "annotations": [
                { "type": "url_citation", "url_citation": { "url": "https://a", "title": "A" } }
            ]}}], "usage": { "server_tool_use_details": { "web_search_requests": 1 } } }),
            &mut chat,
        );
        assert!(chat.succeeded());
        assert_eq!(chat.citations[0].url, "https://a");
        assert_eq!(chat.web_search_calls, 1);

        let mut responses = StreamOutcome::new(Terminal::HttpError);
        read_full_response(
            &json!({ "status": "completed", "output": [{ "type": "message", "content": [
                { "type": "output_text", "text": "t", "annotations": [{ "type": "url_citation", "url": "https://b" }] }
            ]}]}),
            &mut responses,
        );
        assert!(responses.succeeded());
        assert_eq!(responses.citations[0].url, "https://b");
    }

    #[test]
    fn a_structured_request_cannot_silently_lose_its_schema() {
        let b = body_structured("m", "escena");
        assert_eq!(b["provider"]["require_parameters"], true);
        assert_eq!(b["response_format"]["type"], "json_schema");
    }
}
