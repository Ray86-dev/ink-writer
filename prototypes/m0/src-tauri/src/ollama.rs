//! Ollama: local server, NDJSON streaming, `format` with a JSON schema.

use std::time::Instant;

use serde::Serialize;
use serde_json::{Value, json};

use crate::contract;
use crate::ctx::Ctx;
use crate::lines::LineBuffer;
use crate::stream::{ApiError, StreamOutcome, Terminal, read_chunks};

#[derive(Debug, Clone, Serialize)]
pub struct Model {
    pub name: String,
    pub size_bytes: Option<u64>,
    pub family: Option<String>,
    pub quantization: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Server {
    pub version: Option<String>,
    pub models: Vec<Model>,
}

pub fn parse_tags(v: &Value) -> Vec<Model> {
    v.get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|m| {
            Some(Model {
                name: m.get("name")?.as_str()?.to_string(),
                size_bytes: m.get("size").and_then(Value::as_u64),
                family: m.pointer("/details/family").and_then(Value::as_str).map(str::to_string),
                quantization: m
                    .pointer("/details/quantization_level")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect()
}

/// `Err` means nothing answered: Ollama isn't installed or isn't running.
pub async fn server(ctx: &Ctx) -> Result<Server, String> {
    let base = &ctx.endpoints.ollama_base;
    let resp = ctx
        .http
        .get(format!("{base}/api/tags"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("/api/tags returned {}", resp.status()));
    }
    let tags: Value = resp.json().await.map_err(|e| e.to_string())?;
    let version = match ctx.http.get(format!("{base}/api/version")).send().await {
        Ok(r) => r
            .json::<Value>()
            .await
            .ok()
            .and_then(|v| v.get("version")?.as_str().map(str::to_string)),
        Err(_) => None,
    };
    Ok(Server {
        version,
        models: parse_tags(&tags),
    })
}

pub fn body_rewrite(model: &str, scene: &str) -> Value {
    json!({
        "model": model,
        "stream": true,
        "messages": [
            { "role": "system", "content": "Prueba técnica de streaming. Reescribe la escena con otras palabras, conservando los hechos. Devuelve solo el texto." },
            { "role": "user", "content": scene },
        ],
    })
}

/// Temperature 0, as Ollama's structured output docs advise.
pub fn body_structured(model: &str, scene: &str) -> Value {
    json!({
        "model": model,
        "stream": true,
        "format": contract::extraction_schema(),
        "options": { "temperature": 0 },
        "messages": [
            { "role": "system", "content": contract::EXTRACTION_INSTRUCTIONS },
            { "role": "user", "content": scene },
        ],
    })
}

/// Reduces NDJSON lines to an outcome. A 200 can still carry a failure line.
pub struct ChatState {
    out: StreamOutcome,
    started: Instant,
    done_reason: Option<String>,
    done: bool,
    failed: bool,
}

impl ChatState {
    pub fn new(started: Instant) -> Self {
        Self {
            out: StreamOutcome::new(Terminal::Interrupted),
            started,
            done_reason: None,
            done: false,
            failed: false,
        }
    }

    pub fn on_line(&mut self, line: &str, on_delta: &mut dyn FnMut(&str)) {
        if line.trim().is_empty() {
            return;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            *self.out.event_types.entry("(unparsable)".into()).or_default() += 1;
            return;
        };
        *self.out.event_types.entry("line".into()).or_default() += 1;
        if let Some(err) = v.get("error") {
            self.failed = true;
            self.out.error = Some(ApiError {
                message: err.as_str().map(str::to_string),
                ..ApiError::default()
            });
            return;
        }
        if let Some(d) = v.pointer("/message/content").and_then(Value::as_str) {
            if !d.is_empty() {
                if self.out.first_delta_ms.is_none() {
                    self.out.first_delta_ms = Some(self.started.elapsed().as_millis() as u64);
                }
                self.out.text.push_str(d);
                on_delta(d);
            }
        }
        if v.get("done").and_then(Value::as_bool) == Some(true) {
            self.done = true;
            self.done_reason = v.get("done_reason").and_then(Value::as_str).map(str::to_string);
            self.out.usage = Some(json!({
                "prompt_eval_count": v.get("prompt_eval_count"),
                "eval_count": v.get("eval_count"),
                "total_duration": v.get("total_duration"),
            }));
        }
    }

    pub fn finish(mut self, transport_error: Option<String>) -> StreamOutcome {
        self.out.finish_detail = self.done_reason.clone().map(Value::String);
        self.out.terminal = if self.failed {
            Terminal::Failed
        } else if !self.done {
            Terminal::Interrupted
        } else if self.done_reason.as_deref() == Some("length") {
            Terminal::Incomplete
        } else {
            Terminal::Completed
        };
        if self.out.terminal == Terminal::Interrupted {
            self.out.error = Some(ApiError {
                message: Some(transport_error.unwrap_or_else(|| "stream ended before done:true".into())),
                ..ApiError::default()
            });
        }
        self.out.total_ms = self.started.elapsed().as_millis() as u64;
        self.out
    }
}

pub async fn stream_chat(ctx: &Ctx, body: &Value, on_delta: &mut (dyn FnMut(&str) + Send)) -> StreamOutcome {
    let started = Instant::now();
    let sent = ctx
        .http
        .post(format!("{}/api/chat", ctx.endpoints.ollama_base))
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
    let mut lines = LineBuffer::default();
    let read = read_chunks(resp, |chunk| {
        for line in lines.push(chunk) {
            state.on_line(&line, &mut *on_delta);
        }
    })
    .await;
    if let Some(line) = lines.finish() {
        state.on_line(&line, &mut *on_delta);
    }
    let mut out = state.finish(read.err());
    out.http_status = meta.http_status;
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(lines: &[&str]) -> StreamOutcome {
        let mut st = ChatState::new(Instant::now());
        for l in lines {
            st.on_line(l, &mut |_| {});
        }
        st.finish(None)
    }

    #[test]
    fn completes_on_done_true() {
        let o = feed(&[
            r#"{"message":{"role":"assistant","content":"Ho"},"done":false}"#,
            r#"{"message":{"role":"assistant","content":"la"},"done":false}"#,
            r#"{"message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","eval_count":2}"#,
        ]);
        assert!(o.succeeded());
        assert_eq!(o.text, "Hola");
        assert_eq!(o.usage.unwrap()["eval_count"], 2);
    }

    #[test]
    fn a_mid_stream_error_line_is_a_failure() {
        let o = feed(&[
            r#"{"message":{"content":"par"},"done":false}"#,
            r#"{"error":"an error was encountered while running the model"}"#,
        ]);
        assert_eq!(o.terminal, Terminal::Failed);
        assert!(o.error.unwrap().message.unwrap().contains("running the model"));
        assert_eq!(o.text, "par");
    }

    #[test]
    fn a_cut_stream_is_interrupted_and_length_is_incomplete() {
        let cut = feed(&[r#"{"message":{"content":"par"},"done":false}"#]);
        assert_eq!(cut.terminal, Terminal::Interrupted);
        let long = feed(&[r#"{"message":{"content":""},"done":true,"done_reason":"length"}"#]);
        assert_eq!(long.terminal, Terminal::Incomplete);
    }

    #[test]
    fn parses_tags() {
        let v = json!({ "models": [{ "name": "m:1", "size": 10, "details": { "family": "f", "quantization_level": "Q4" } }] });
        let m = parse_tags(&v);
        assert_eq!(m[0].name, "m:1");
        assert_eq!(m[0].quantization.as_deref(), Some("Q4"));
    }

    #[test]
    fn structured_body_sends_the_schema_in_format() {
        let b = body_structured("m", "s");
        assert_eq!(b["format"]["type"], "object");
        assert_eq!(b["options"]["temperature"], 0);
    }
}
