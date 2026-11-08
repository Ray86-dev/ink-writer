//! What every provider's stream reduces to, plus response helpers.

use std::collections::BTreeMap;

use futures_util::StreamExt;
use reqwest::header::HeaderMap;
use serde::Serialize;
use serde_json::{Value, json};

const MAX_MESSAGE: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Terminal {
    /// The only state that counts as success.
    Completed,
    /// The provider reported a failure, possibly after partial output.
    Failed,
    /// The provider ended the response early, such as on a length limit.
    Incomplete,
    /// The stream ended with no terminal event. Partial text is a draft at best.
    Interrupted,
    /// Rejected before a stream opened.
    HttpError,
    /// No connection, such as Ollama not running.
    Unreachable,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct ApiError {
    pub code: Option<String>,
    pub param: Option<String>,
    pub message: Option<String>,
    pub kind: Option<String>,
}

fn as_text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

pub fn truncate(s: &str) -> String {
    match s.char_indices().nth(MAX_MESSAGE) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_string(),
    }
}

impl ApiError {
    /// `{"error":{...}}`, `{"code":...}`.
    pub fn from_object(v: &Value) -> Self {
        Self {
            code: v.get("code").and_then(as_text),
            param: v.get("param").and_then(as_text),
            message: v.get("message").and_then(as_text).map(|m| truncate(&m)),
            kind: v
                .get("type")
                .and_then(as_text)
                .or_else(|| v.pointer("/metadata/error_type").and_then(as_text)),
        }
    }

    /// Accepts each error body seen across these APIs. The token endpoint's
    /// shape isn't documented, so both OAuth and object forms are handled.
    pub fn from_body(body: &str) -> Self {
        let Ok(v) = serde_json::from_str::<Value>(body) else {
            return Self {
                message: Some(truncate(body)),
                ..Self::default()
            };
        };
        match v.get("error") {
            Some(obj @ Value::Object(_)) => Self::from_object(obj),
            Some(Value::String(code)) => Self {
                code: Some(code.clone()),
                message: v
                    .get("error_description")
                    .and_then(as_text)
                    .map(|m| truncate(&m)),
                ..Self::default()
            },
            _ => Self {
                message: v
                    .get("detail")
                    .and_then(as_text)
                    .or_else(|| v.get("message").and_then(as_text))
                    .map(|m| truncate(&m)),
                ..Self::default()
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FunctionCall {
    pub name: String,
    pub namespace: Option<String>,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Citation {
    pub url: String,
    pub title: Option<String>,
}

/// Reads both the flat form (OpenAI) and the nested form (OpenRouter).
pub fn citation_from(annotation: &Value) -> Option<Citation> {
    if annotation.get("type")?.as_str()? != "url_citation" {
        return None;
    }
    let source = annotation.get("url_citation").unwrap_or(annotation);
    Some(Citation {
        url: source.get("url")?.as_str()?.to_string(),
        title: source.get("title").and_then(as_text),
    })
}

#[derive(Debug, Clone)]
pub struct StreamOutcome {
    pub terminal: Terminal,
    pub http_status: Option<u16>,
    pub request_id: Option<String>,
    pub headers: BTreeMap<String, String>,
    pub header_names: Vec<String>,
    pub error: Option<ApiError>,
    /// Model output. Shown as a draft; never copied into a report.
    pub text: String,
    pub function_calls: Vec<FunctionCall>,
    pub citations: Vec<Citation>,
    pub web_search_calls: u32,
    pub sources: Vec<String>,
    pub event_types: BTreeMap<String, u32>,
    pub usage: Option<Value>,
    pub finish_detail: Option<Value>,
    pub first_delta_ms: Option<u64>,
    pub total_ms: u64,
}

impl StreamOutcome {
    pub fn new(terminal: Terminal) -> Self {
        Self {
            terminal,
            http_status: None,
            request_id: None,
            headers: BTreeMap::new(),
            header_names: Vec::new(),
            error: None,
            text: String::new(),
            function_calls: Vec::new(),
            citations: Vec::new(),
            web_search_calls: 0,
            sources: Vec::new(),
            event_types: BTreeMap::new(),
            usage: None,
            finish_detail: None,
            first_delta_ms: None,
            total_ms: 0,
        }
    }

    pub fn unreachable(message: String) -> Self {
        let mut o = Self::new(Terminal::Unreachable);
        o.error = Some(ApiError {
            message: Some(truncate(&message)),
            ..ApiError::default()
        });
        o
    }

    pub fn succeeded(&self) -> bool {
        self.terminal == Terminal::Completed
    }

    pub fn error_code(&self) -> Option<&str> {
        self.error.as_ref()?.code.as_deref()
    }

    pub fn take_response_meta(&mut self, resp: &reqwest::Response) {
        self.http_status = Some(resp.status().as_u16());
        self.request_id = request_id(resp.headers());
        self.headers = interesting_headers(resp.headers());
        self.header_names = resp.headers().keys().map(|k| k.to_string()).collect();
        self.header_names.sort();
    }

    /// Metadata only: safe for a report. Holds no model text.
    pub fn metrics(&self) -> Value {
        json!({
            "terminal": self.terminal,
            "first_delta_ms": self.first_delta_ms,
            "total_ms": self.total_ms,
            "output_chars": self.text.chars().count(),
            "event_types": self.event_types,
            "usage": self.usage,
            "finish_detail": self.finish_detail,
            "headers": self.headers,
        })
    }
}

/// Header OpenAI documents for support, then the fallbacks.
pub fn request_id(headers: &HeaderMap) -> Option<String> {
    ["openai-request-id", "x-request-id", "x-generation-id"]
        .iter()
        .find_map(|name| headers.get(*name)?.to_str().ok().map(str::to_string))
}

/// Usage and limit headers, to find out whether remaining usage is readable.
/// The docs say no API for it exists, so M0 looks at what actually comes back.
pub fn interesting_headers(headers: &HeaderMap) -> BTreeMap<String, String> {
    const NEEDLES: [&str; 8] = [
        "ratelimit", "usage", "limit", "plan", "quota", "reset", "model", "processing",
    ];
    headers
        .iter()
        .filter(|(name, _)| {
            let n = name.as_str();
            n != "set-cookie" && n != "authorization" && NEEDLES.iter().any(|x| n.contains(x))
        })
        .filter_map(|(name, value)| Some((name.to_string(), value.to_str().ok()?.to_string())))
        .collect()
}

/// Feeds network chunks to `on_chunk`. `Err` means the transport failed.
pub async fn read_chunks(
    resp: reqwest::Response,
    mut on_chunk: impl FnMut(&[u8]),
) -> Result<(), String> {
    let mut body = resp.bytes_stream();
    while let Some(chunk) = body.next().await {
        match chunk {
            Ok(bytes) => on_chunk(&bytes),
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_each_error_body_shape() {
        let responses = ApiError::from_body(
            r#"{"error":{"code":"subscription_sharing_unsupported_capability","param":"temperature","message":"no","type":"invalid_request_error"}}"#,
        );
        assert_eq!(
            responses.code.as_deref(),
            Some("subscription_sharing_unsupported_capability")
        );
        assert_eq!(responses.param.as_deref(), Some("temperature"));

        let oauth = ApiError::from_body(r#"{"error":"invalid_grant","error_description":"gone"}"#);
        assert_eq!(oauth.code.as_deref(), Some("invalid_grant"));
        assert_eq!(oauth.message.as_deref(), Some("gone"));

        let detail = ApiError::from_body(r#"{"detail":"not accepted"}"#);
        assert_eq!(detail.message.as_deref(), Some("not accepted"));

        let openrouter = ApiError::from_body(
            r#"{"error":{"code":402,"message":"credits","metadata":{"error_type":"payment_required"}}}"#,
        );
        assert_eq!(openrouter.code.as_deref(), Some("402"));
        assert_eq!(openrouter.kind.as_deref(), Some("payment_required"));

        let html = ApiError::from_body("<html>bad gateway</html>");
        assert_eq!(html.message.as_deref(), Some("<html>bad gateway</html>"));
    }

    #[test]
    fn truncates_long_messages_on_a_character_boundary() {
        let long = "ñ".repeat(MAX_MESSAGE + 10);
        let cut = truncate(&long);
        assert_eq!(cut.chars().count(), MAX_MESSAGE + 1);
        assert!(cut.ends_with('…'));
    }

    #[test]
    fn reads_flat_and_nested_citations() {
        let flat = json!({"type":"url_citation","url":"https://a","title":"A"});
        let nested = json!({"type":"url_citation","url_citation":{"url":"https://b","title":"B"}});
        assert_eq!(citation_from(&flat).unwrap().url, "https://a");
        assert_eq!(citation_from(&nested).unwrap().title.as_deref(), Some("B"));
        assert_eq!(citation_from(&json!({"type":"file_citation"})), None);
    }

    #[test]
    fn metrics_never_contain_model_text() {
        let mut o = StreamOutcome::new(Terminal::Completed);
        o.text = "TEXTO DEL MODELO".into();
        assert!(!o.metrics().to_string().contains("TEXTO DEL MODELO"));
    }
}
