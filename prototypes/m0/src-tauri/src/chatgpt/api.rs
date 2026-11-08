//! Model list and streaming inference on `POST /v1/responses`.

use std::time::Instant;

use serde::Serialize;
use serde_json::{Value, json};

use crate::contract;
use crate::ctx::Ctx;
use crate::lines::{SseEvent, SseParser};
use crate::stream::{ApiError, FunctionCall, StreamOutcome, Terminal, citation_from, read_chunks, request_id};

/// Listed in the docs as rejected on this route. `reject_temperature` sends one
/// on purpose to record the real error; no other request may contain them.
pub const FORBIDDEN_FIELDS: [&str; 15] = [
    "background",
    "conversation",
    "max_output_tokens",
    "max_tool_calls",
    "metadata",
    "moderation",
    "multi_agent",
    "prompt",
    "prompt_cache_retention",
    "safety_identifier",
    "temperature",
    "top_logprobs",
    "top_p",
    "truncation",
    "user",
];

#[derive(Debug, Clone, Serialize)]
pub struct Model {
    pub slug: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelList {
    pub models: Vec<Model>,
    pub total_before_filter: usize,
    /// The schema isn't documented beyond these names, so M0 records the rest.
    pub first_model_fields: Vec<String>,
    pub http_status: u16,
    pub request_id: Option<String>,
    pub header_names: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ModelsError {
    pub http_status: Option<u16>,
    pub error: ApiError,
    pub request_id: Option<String>,
}

/// Keeps `visibility == "list"` and the server's order.
pub fn filter_models(v: &Value) -> (Vec<Model>, usize) {
    let all = v.get("models").and_then(Value::as_array).cloned().unwrap_or_default();
    let visible = all
        .iter()
        .filter(|m| m.get("visibility").and_then(Value::as_str) == Some("list"))
        .filter_map(|m| {
            let slug = m.get("slug")?.as_str()?.to_string();
            let display_name = m
                .get("display_name")
                .and_then(Value::as_str)
                .unwrap_or(&slug)
                .to_string();
            Some(Model { slug, display_name })
        })
        .collect();
    (visible, all.len())
}

pub async fn list_models(ctx: &Ctx, token: &str) -> Result<ModelList, ModelsError> {
    let resp = ctx
        .http
        .get(format!("{}/models", ctx.endpoints.api_base))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| ModelsError {
            http_status: None,
            error: ApiError {
                message: Some(e.to_string()),
                ..ApiError::default()
            },
            request_id: None,
        })?;
    let status = resp.status();
    let rid = request_id(resp.headers());
    let mut header_names: Vec<String> = resp.headers().keys().map(|k| k.to_string()).collect();
    header_names.sort();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(ModelsError {
            http_status: Some(status.as_u16()),
            error: ApiError::from_body(&body),
            request_id: rid,
        });
    }
    let v: Value = serde_json::from_str(&body).map_err(|e| ModelsError {
        http_status: Some(status.as_u16()),
        error: ApiError {
            message: Some(e.to_string()),
            ..ApiError::default()
        },
        request_id: rid.clone(),
    })?;
    let (models, total_before_filter) = filter_models(&v);
    let mut first_model_fields: Vec<String> = v
        .pointer("/models/0")
        .and_then(Value::as_object)
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();
    first_model_fields.sort();
    Ok(ModelList {
        models,
        total_before_filter,
        first_model_fields,
        http_status: status.as_u16(),
        request_id: rid,
        header_names,
    })
}

// --- Request bodies ---

fn base(model: &str, instructions: &str, user: &str) -> Value {
    json!({
        "model": model,
        "instructions": instructions,
        "input": [{ "role": "user", "content": user }],
        "store": false,
        "stream": true,
    })
}

/// Rewriting here only tests streaming, on a fixture scene. The result goes to
/// a read-only draft pane: the product never writes generated prose (rule 1).
pub fn body_rewrite(model: &str, scene: &str) -> Value {
    base(
        model,
        "Prueba técnica de streaming. Reescribe la escena con otras palabras, conservando los hechos. Devuelve solo el texto.",
        scene,
    )
}

pub fn body_text_format(model: &str, scene: &str) -> Value {
    let mut b = base(model, contract::EXTRACTION_INSTRUCTIONS, scene);
    b["text"] = json!({ "format": {
        "type": "json_schema",
        "name": "scene_extraction",
        "strict": true,
        "schema": contract::extraction_schema(),
    }});
    b
}

fn extraction_function() -> Value {
    json!({
        "type": "function",
        "name": "report_extraction",
        "description": "Entrega el resultado de la extracción.",
        "strict": true,
        "parameters": contract::extraction_schema(),
    })
}

/// The docs say tools go "in namespaces or additional_tools". This checks
/// whether the standard top-level form also passes.
pub fn body_tool_top_level(model: &str, scene: &str) -> Value {
    let mut b = base(model, contract::EXTRACTION_INSTRUCTIONS, scene);
    b["tools"] = json!([extraction_function()]);
    b["tool_choice"] = json!({ "type": "function", "name": "report_extraction" });
    b
}

fn namespace_tool() -> Value {
    json!({
        "type": "namespace",
        "name": "ink",
        "description": "Herramientas de análisis de escenas.",
        "tools": [extraction_function()],
    })
}

/// With one tool in the request, `required` forces exactly that tool.
pub fn body_tool_namespace_required(model: &str, scene: &str) -> Value {
    let mut b = base(model, contract::EXTRACTION_INSTRUCTIONS, scene);
    b["tools"] = json!([namespace_tool()]);
    b["tool_choice"] = json!("required");
    b
}

pub fn body_tool_namespace_named(model: &str, scene: &str) -> Value {
    let mut b = base(model, contract::EXTRACTION_INSTRUCTIONS, scene);
    b["tools"] = json!([namespace_tool()]);
    b["tool_choice"] = json!({ "type": "function", "name": "report_extraction" });
    b
}

/// Shape from the Responses reference: an `additional_tools` input item.
pub fn body_tool_additional(model: &str, scene: &str) -> Value {
    let mut b = base(model, contract::EXTRACTION_INSTRUCTIONS, scene);
    b["input"] = json!([
        { "type": "additional_tools", "role": "developer", "tools": [extraction_function()] },
        { "role": "user", "content": scene },
    ]);
    b["tool_choice"] = json!("required");
    b
}

/// Rule 5: the query is a topic, with no manuscript text or character names.
pub const WEB_SEARCH_TOPIC: &str =
    "¿Cómo era el trabajo diario en una farmacia rural española en los años cincuenta? Responde en tres frases y cita las fuentes.";

pub fn body_web_search(model: &str) -> Value {
    let mut b = base(model, "Responde apoyándote en la búsqueda web.", WEB_SEARCH_TOPIC);
    b["tools"] = json!([{ "type": "web_search" }]);
    b["tool_choice"] = json!("auto");
    b["include"] = json!(["web_search_call.action.sources"]);
    b
}

pub fn body_reject_temperature(model: &str) -> Value {
    let mut b = base(model, "Responde con una palabra.", "Di hola.");
    b["temperature"] = json!(0.2);
    b
}

pub fn body_reject_system_message(model: &str) -> Value {
    let mut b = base(model, "Responde con una palabra.", "Di hola.");
    b["input"] = json!([
        { "type": "message", "role": "system", "content": "Responde con una palabra." },
        { "role": "user", "content": "Di hola." },
    ]);
    b
}

// --- Stream handling ---

/// Reduces Responses events to an outcome. Free of I/O, so every path is tested.
pub struct ResponsesState {
    out: StreamOutcome,
    items: Vec<Value>,
    started: Instant,
    terminal: Option<Terminal>,
}

impl ResponsesState {
    pub fn new(started: Instant) -> Self {
        Self {
            out: StreamOutcome::new(Terminal::Interrupted),
            items: Vec::new(),
            started,
            terminal: None,
        }
    }

    fn set_terminal(&mut self, t: Terminal, response: Option<&Value>) {
        if self.terminal.is_some() {
            return;
        }
        self.terminal = Some(t);
        if let Some(r) = response {
            if let Some(u) = r.get("usage").filter(|u| !u.is_null()) {
                self.out.usage = Some(u.clone());
            }
            // Some routes leave `output` empty with store:false. Then the items
            // gathered from output_item.done are what's left.
            if let Some(items) = r.get("output").and_then(Value::as_array) {
                if !items.is_empty() {
                    self.items = items.clone();
                }
            }
        }
    }

    pub fn on_event(&mut self, ev: &SseEvent, on_delta: &mut dyn FnMut(&str)) {
        let Ok(v) = serde_json::from_str::<Value>(&ev.data) else {
            *self.out.event_types.entry("(unparsable)".into()).or_default() += 1;
            return;
        };
        let kind = v
            .get("type")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| ev.event.clone())
            .unwrap_or_else(|| "(untyped)".into());
        *self.out.event_types.entry(kind.clone()).or_default() += 1;
        match kind.as_str() {
            "response.output_text.delta" => {
                if let Some(d) = v.get("delta").and_then(Value::as_str) {
                    if self.out.first_delta_ms.is_none() {
                        self.out.first_delta_ms = Some(self.started.elapsed().as_millis() as u64);
                    }
                    self.out.text.push_str(d);
                    on_delta(d);
                }
            }
            "response.output_item.done" => {
                if let Some(item) = v.get("item") {
                    self.items.push(item.clone());
                }
            }
            "response.completed" => self.set_terminal(Terminal::Completed, v.get("response")),
            "response.failed" => {
                let err = v.pointer("/response/error");
                if self.terminal.is_none() {
                    self.out.error = err.map(ApiError::from_object).or_else(|| {
                        Some(ApiError {
                            message: Some("response.failed without an error object".into()),
                            ..ApiError::default()
                        })
                    });
                }
                self.set_terminal(Terminal::Failed, v.get("response"));
            }
            "response.incomplete" => {
                if self.terminal.is_none() {
                    self.out.finish_detail = v.pointer("/response/incomplete_details").cloned();
                }
                self.set_terminal(Terminal::Incomplete, v.get("response"));
            }
            "error" => {
                if self.terminal.is_none() {
                    self.out.error = Some(ApiError::from_object(v.get("error").unwrap_or(&v)));
                }
                self.set_terminal(Terminal::Failed, None);
            }
            _ => {}
        }
    }

    pub fn finish(mut self, transport_error: Option<String>) -> StreamOutcome {
        self.out.terminal = self.terminal.unwrap_or(Terminal::Interrupted);
        if self.terminal.is_none() {
            self.out.error = Some(ApiError {
                message: Some(transport_error.unwrap_or_else(|| "stream ended with no terminal event".into())),
                ..ApiError::default()
            });
        }
        let items = std::mem::take(&mut self.items);
        collect_items(&items, &mut self.out);
        self.out.total_ms = self.started.elapsed().as_millis() as u64;
        self.out
    }
}

/// Pulls function calls, citations and search activity out of output items.
pub fn collect_items(items: &[Value], out: &mut StreamOutcome) {
    let mut message_text = String::new();
    for item in items {
        match item.get("type").and_then(Value::as_str) {
            Some("function_call") => out.function_calls.push(FunctionCall {
                name: item.get("name").and_then(Value::as_str).unwrap_or_default().to_string(),
                namespace: item.get("namespace").and_then(Value::as_str).map(str::to_string),
                arguments: item.get("arguments").and_then(Value::as_str).unwrap_or_default().to_string(),
            }),
            Some("web_search_call") => {
                out.web_search_calls += 1;
                if let Some(sources) = item.pointer("/action/sources").and_then(Value::as_array) {
                    out.sources.extend(
                        sources
                            .iter()
                            .filter_map(|s| s.get("url")?.as_str().map(str::to_string)),
                    );
                }
            }
            Some("message") => {
                for part in item.get("content").and_then(Value::as_array).into_iter().flatten() {
                    if let Some(t) = part.get("text").and_then(Value::as_str) {
                        message_text.push_str(t);
                    }
                    for a in part.get("annotations").and_then(Value::as_array).into_iter().flatten() {
                        out.citations.extend(citation_from(a));
                    }
                }
            }
            _ => {}
        }
    }
    if out.text.is_empty() {
        out.text = message_text;
    }
}

pub async fn stream_responses(
    ctx: &Ctx,
    token: &str,
    body: &Value,
    on_delta: &mut (dyn FnMut(&str) + Send),
) -> StreamOutcome {
    let started = Instant::now();
    let sent = ctx
        .http
        .post(format!("{}/responses", ctx.endpoints.api_base))
        .bearer_auth(token)
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
        let text = resp.text().await.unwrap_or_default();
        meta.error = Some(ApiError::from_body(&text));
        meta.total_ms = started.elapsed().as_millis() as u64;
        return meta;
    }
    let mut state = ResponsesState::new(started);
    let mut sse = SseParser::default();
    let read = read_chunks(resp, |chunk| {
        for ev in sse.push(chunk) {
            state.on_event(&ev, &mut *on_delta);
        }
    })
    .await;
    for ev in sse.finish() {
        state.on_event(&ev, &mut *on_delta);
    }
    let mut out = state.finish(read.err());
    out.http_status = meta.http_status;
    out.request_id = meta.request_id;
    out.headers = meta.headers;
    out.header_names = meta.header_names;
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(events: &[Value]) -> StreamOutcome {
        feed_with(events, None)
    }

    fn feed_with(events: &[Value], transport: Option<&str>) -> StreamOutcome {
        let mut st = ResponsesState::new(Instant::now());
        for e in events {
            st.on_event(
                &SseEvent {
                    event: None,
                    data: e.to_string(),
                },
                &mut |_| {},
            );
        }
        st.finish(transport.map(str::to_string))
    }

    fn delta(text: &str) -> Value {
        json!({ "type": "response.output_text.delta", "delta": text })
    }

    #[test]
    fn success_needs_response_completed() {
        let o = feed(&[delta("Hola"), json!({ "type": "response.completed", "response": { "usage": { "input_tokens": 5 } } })]);
        assert!(o.succeeded());
        assert_eq!(o.text, "Hola");
        assert_eq!(o.usage.unwrap()["input_tokens"], 5);
    }

    #[test]
    fn a_stream_without_a_terminal_event_is_interrupted() {
        let o = feed(&[delta("Medio te")]);
        assert_eq!(o.terminal, Terminal::Interrupted);
        assert!(!o.succeeded());
        assert_eq!(o.text, "Medio te");
    }

    #[test]
    fn a_transport_failure_is_interrupted_and_keeps_its_cause() {
        let o = feed_with(&[delta("x")], Some("connection reset"));
        assert_eq!(o.terminal, Terminal::Interrupted);
        assert_eq!(o.error.unwrap().message.as_deref(), Some("connection reset"));
    }

    #[test]
    fn failed_after_output_keeps_the_code_and_is_not_success() {
        let o = feed(&[
            delta("parcial"),
            json!({ "type": "response.failed", "response": { "error": {
                "code": "subscription_sharing_usage_limit_exceeded", "message": "limit"
            }}}),
        ]);
        assert_eq!(o.terminal, Terminal::Failed);
        assert_eq!(o.error_code(), Some("subscription_sharing_usage_limit_exceeded"));
        assert_eq!(o.text, "parcial");
    }

    #[test]
    fn failed_without_an_error_object_is_still_a_failure() {
        let o = feed(&[json!({ "type": "response.failed", "response": {} })]);
        assert_eq!(o.terminal, Terminal::Failed);
        assert!(o.error.is_some());
    }

    #[test]
    fn incomplete_is_separate_from_completed() {
        let o = feed(&[json!({ "type": "response.incomplete", "response": { "incomplete_details": { "reason": "max_output_tokens" } } })]);
        assert_eq!(o.terminal, Terminal::Incomplete);
        assert_eq!(o.finish_detail.unwrap()["reason"], "max_output_tokens");
    }

    #[test]
    fn an_error_event_fails_the_stream() {
        let o = feed(&[json!({ "type": "error", "code": "server_error", "message": "boom" })]);
        assert_eq!(o.terminal, Terminal::Failed);
        assert_eq!(o.error_code(), Some("server_error"));
    }

    #[test]
    fn the_first_terminal_event_wins() {
        let o = feed(&[
            json!({ "type": "response.completed", "response": {} }),
            json!({ "type": "response.failed", "response": { "error": { "code": "late" } } }),
        ]);
        assert!(o.succeeded());
        assert_eq!(o.error, None);
    }

    #[test]
    fn items_from_events_are_used_when_final_output_is_empty() {
        let o = feed(&[
            json!({ "type": "response.output_item.done", "item": {
                "type": "function_call", "name": "report_extraction", "namespace": "ink", "arguments": "{}"
            }}),
            json!({ "type": "response.completed", "response": { "output": [] } }),
        ]);
        assert_eq!(o.function_calls[0].name, "report_extraction");
        assert_eq!(o.function_calls[0].namespace.as_deref(), Some("ink"));
    }

    #[test]
    fn final_output_replaces_event_items_without_duplicates() {
        let call = json!({ "type": "function_call", "name": "f", "arguments": "{}" });
        let o = feed(&[
            json!({ "type": "response.output_item.done", "item": call }),
            json!({ "type": "response.completed", "response": { "output": [call] } }),
        ]);
        assert_eq!(o.function_calls.len(), 1);
    }

    #[test]
    fn collects_web_search_calls_sources_and_citations() {
        let o = feed(&[json!({ "type": "response.completed", "response": { "output": [
            { "type": "web_search_call", "action": { "type": "search", "sources": [{ "type": "url", "url": "https://s" }] } },
            { "type": "message", "content": [{ "type": "output_text", "text": "Dato.", "annotations": [
                { "type": "url_citation", "url": "https://c", "title": "C", "start_index": 0, "end_index": 4 }
            ]}]}
        ]}})]);
        assert_eq!(o.web_search_calls, 1);
        assert_eq!(o.sources, ["https://s"]);
        assert_eq!(o.citations[0].url, "https://c");
        assert_eq!(o.text, "Dato.");
    }

    #[test]
    fn deltas_reach_the_callback_in_order() {
        let mut st = ResponsesState::new(Instant::now());
        let mut seen = String::new();
        for d in ["Ho", "la"] {
            st.on_event(
                &SseEvent {
                    event: None,
                    data: delta(d).to_string(),
                },
                &mut |t| seen.push_str(t),
            );
        }
        assert_eq!(seen, "Hola");
    }

    #[test]
    fn an_unparsable_event_is_counted_and_does_not_end_the_stream() {
        let mut st = ResponsesState::new(Instant::now());
        st.on_event(
            &SseEvent {
                event: None,
                data: "{not json".into(),
            },
            &mut |_| {},
        );
        let o = st.finish(None);
        assert_eq!(o.event_types["(unparsable)"], 1);
        assert_eq!(o.terminal, Terminal::Interrupted);
    }

    #[test]
    fn filter_keeps_listed_models_in_server_order() {
        let v = json!({ "models": [
            { "slug": "b", "display_name": "B", "visibility": "list" },
            { "slug": "hidden", "display_name": "H", "visibility": "hide" },
            { "slug": "a", "display_name": "A", "visibility": "list" },
        ]});
        let (models, total) = filter_models(&v);
        assert_eq!(total, 3);
        let slugs: Vec<&str> = models.iter().map(|m| m.slug.as_str()).collect();
        assert_eq!(slugs, ["b", "a"]);
    }

    #[test]
    fn regular_bodies_contain_no_forbidden_field() {
        let s = "escena";
        let bodies = [
            body_rewrite("m", s),
            body_text_format("m", s),
            body_tool_top_level("m", s),
            body_tool_namespace_required("m", s),
            body_tool_namespace_named("m", s),
            body_tool_additional("m", s),
            body_web_search("m"),
        ];
        for b in bodies {
            for field in FORBIDDEN_FIELDS {
                assert!(b.get(field).is_none(), "{field} in {b}");
            }
            assert_eq!(b["store"], false);
            assert_eq!(b["stream"], true);
            assert!(b["input"].is_array());
        }
    }

    #[test]
    fn no_regular_body_sends_a_system_message() {
        let b = body_tool_additional("m", "s");
        assert!(!b.to_string().contains("\"system\""));
        assert!(body_rewrite("m", "s").get("instructions").is_some());
    }

    #[test]
    fn the_web_search_probe_sends_no_manuscript_content() {
        let scene = contract::scene(contract::EXTRACTION_SCENE);
        let body = body_web_search("m").to_string();
        assert!(!body.contains(&scene.text));
        for name in ["Marta", "Tomás", "Remedios", "Puerto Viejo"] {
            assert!(!body.contains(name), "{name}");
        }
    }
}
