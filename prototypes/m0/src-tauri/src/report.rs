//! JSON evidence for the M0 decision record.
//!
//! Reports hold metadata only: status codes, event names, counts and timings.
//! They never hold tokens, scene text, model output or account identity.

use std::path::PathBuf;

use serde::Serialize;
use serde_json::{Value, json};

use crate::store::atomic_write;
use crate::stream::{StreamOutcome, Terminal};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProbeStatus {
    /// Worked as needed.
    Ok,
    /// Reached the server and refused. For a `reject_*` probe, the expectation.
    Rejected,
    /// Accepted, but the result isn't usable.
    Failed,
    /// Not run.
    Skipped,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProbeResult {
    pub probe: String,
    pub status: ProbeStatus,
    pub http_status: Option<u16>,
    pub error_code: Option<String>,
    pub error_param: Option<String>,
    pub error_message: Option<String>,
    pub request_id: Option<String>,
    pub details: Value,
}

impl ProbeResult {
    pub fn plain(probe: &str, status: ProbeStatus, details: Value) -> Self {
        Self {
            probe: probe.into(),
            status,
            http_status: None,
            error_code: None,
            error_param: None,
            error_message: None,
            request_id: None,
            details,
        }
    }

    pub fn skipped(probe: &str, why: &str) -> Self {
        Self::plain(probe, ProbeStatus::Skipped, json!({ "why": why }))
    }

    /// `status` is decided by the caller, which knows what the probe wanted.
    pub fn from_outcome(probe: &str, status: ProbeStatus, o: &StreamOutcome, details: Value) -> Self {
        let err = o.error.clone().unwrap_or_default();
        let mut merged = o.metrics();
        if let (Some(m), Value::Object(d)) = (merged.as_object_mut(), details) {
            m.extend(d);
        }
        Self {
            probe: probe.into(),
            status,
            http_status: o.http_status,
            error_code: err.code,
            error_param: err.param,
            error_message: err.message,
            request_id: o.request_id.clone(),
            details: merged,
        }
    }
}

/// How a stream's end maps onto a probe status, before content checks.
pub fn status_of(o: &StreamOutcome) -> ProbeStatus {
    match o.terminal {
        Terminal::Completed => ProbeStatus::Ok,
        Terminal::HttpError => ProbeStatus::Rejected,
        _ => ProbeStatus::Failed,
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Report {
    pub kind: String,
    pub provider: String,
    pub model: Option<String>,
    pub generated_at_unix: u64,
    pub platform: &'static str,
    pub results: Vec<ProbeResult>,
}

impl Report {
    pub fn new(kind: &str, provider: &str, model: Option<&str>) -> Self {
        Self {
            kind: kind.into(),
            provider: provider.into(),
            model: model.map(str::to_string),
            generated_at_unix: crate::now_unix(),
            platform: std::env::consts::OS,
            results: Vec::new(),
        }
    }

    pub fn file_name(&self) -> String {
        let model = self
            .model
            .as_deref()
            .unwrap_or("none")
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' })
            .collect::<String>();
        format!(
            "{}-{}-{}-{}.json",
            self.generated_at_unix, self.provider, self.kind, model
        )
    }

    /// Serializes and removes any secret, as a last line of defence: error
    /// messages come from servers and can't be fully trusted to omit them.
    pub fn render(&self, secrets: &[String]) -> Result<String, String> {
        let mut text = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        for secret in secrets.iter().filter(|s| !s.is_empty()) {
            text = text.replace(secret.as_str(), "[redacted]");
        }
        Ok(text)
    }

    pub fn write(&self, dir: PathBuf, secrets: &[String]) -> Result<PathBuf, String> {
        let path = dir.join(self.file_name());
        atomic_write(&path, self.render(secrets)?.as_bytes())?;
        Ok(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_removes_secrets_wherever_they_appear() {
        let mut r = Report::new("probes", "chatgpt", Some("m"));
        r.results.push(ProbeResult::plain(
            "x",
            ProbeStatus::Failed,
            json!({ "echo": "server said tok-123 was bad" }),
        ));
        let text = r.render(&["tok-123".to_string()]).unwrap();
        assert!(!text.contains("tok-123"));
        assert!(text.contains("[redacted]"));
    }

    #[test]
    fn an_empty_secret_does_not_mangle_the_report() {
        let r = Report::new("probes", "chatgpt", None);
        let text = r.render(&[String::new()]).unwrap();
        assert!(text.contains("\"provider\": \"chatgpt\""));
    }

    #[test]
    fn file_name_is_safe_for_any_model_id() {
        let r = Report::new("probes", "openrouter", Some("openai/gpt:free"));
        let name = r.file_name();
        assert!(name.ends_with("-openrouter-probes-openai_gpt_free.json"));
        assert!(!name.contains('/') && !name.contains(':'));
    }

    #[test]
    fn details_keep_both_metrics_and_probe_fields() {
        let o = StreamOutcome::new(Terminal::Completed);
        let p = ProbeResult::from_outcome("x", ProbeStatus::Ok, &o, json!({ "quotes": 3 }));
        assert_eq!(p.details["quotes"], 3);
        assert_eq!(p.details["terminal"], "completed");
    }
}
