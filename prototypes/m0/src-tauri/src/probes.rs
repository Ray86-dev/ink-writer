//! The M0 checks, per provider. Each run writes a JSON report.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::chatgpt::{api, auth};
use crate::contract::{self, ContractCheck};
use crate::ctx::Ctx;
use crate::report::{ProbeResult, ProbeStatus, Report, status_of};
use crate::stream::{StreamOutcome, Terminal};
use crate::{ollama, openrouter};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Chatgpt,
    Openrouter,
    Ollama,
}

impl Provider {
    pub fn name(self) -> &'static str {
        match self {
            Self::Chatgpt => "chatgpt",
            Self::Openrouter => "openrouter",
            Self::Ollama => "ollama",
        }
    }
}

/// The docs say not to repeat the request after these. Stopping also avoids
/// burning the user's plan on checks that can't succeed.
const STOP_CODES: [&str; 6] = [
    "subscription_sharing_usage_limit_exceeded",
    "subscription_sharing_user_not_eligible",
    "subscription_sharing_invalid_user",
    "chatpass_v2_scope_not_authorized",
    "chatpass_v2_invalid_authorization_context",
    "402",
];

pub fn must_stop(o: &StreamOutcome) -> bool {
    o.error_code().is_some_and(|c| STOP_CODES.contains(&c))
}

enum Check {
    Stream,
    ContractInText,
    ContractInTool,
    WebSearch,
    ExpectRejection,
}

fn contract_details(c: &ContractCheck) -> Value {
    json!({ "contract": c })
}

/// Decides what a finished request means for its probe. Pure, so tested.
fn evaluate(probe: &str, check: &Check, o: &StreamOutcome, scene: &str) -> ProbeResult {
    let base = status_of(o);
    let (status, details) = match check {
        Check::Stream => (base, json!({})),
        Check::ContractInText if o.succeeded() => {
            let c = contract::check(&o.text, scene);
            (ok_if(c.usable()), contract_details(&c))
        }
        Check::ContractInTool if o.succeeded() => match o.function_calls.first() {
            Some(call) => {
                let c = contract::check(&call.arguments, scene);
                let mut d = contract_details(&c);
                d["function_call"] = json!({ "name": call.name, "namespace": call.namespace });
                d["function_call_count"] = json!(o.function_calls.len());
                (ok_if(c.usable()), d)
            }
            None => (ProbeStatus::Failed, json!({ "note": "completed with no function call" })),
        },
        Check::WebSearch if o.succeeded() => {
            // Rule 3: an answer with no linked source can't be shown at all.
            let urls: Vec<&str> = o.citations.iter().take(5).map(|c| c.url.as_str()).collect();
            (
                ok_if(!o.citations.is_empty()),
                json!({
                    "web_search_calls": o.web_search_calls,
                    "sources_count": o.sources.len(),
                    "citations_count": o.citations.len(),
                    "citation_urls": urls,
                }),
            )
        }
        Check::ExpectRejection if o.succeeded() => (
            ProbeStatus::Failed,
            json!({ "note": "accepted although the docs list it as rejected" }),
        ),
        Check::ExpectRejection if matches!(o.terminal, Terminal::HttpError | Terminal::Failed) => {
            (ProbeStatus::Rejected, json!({}))
        }
        _ => (base, json!({})),
    };
    ProbeResult::from_outcome(probe, status, o, details)
}

fn ok_if(ok: bool) -> ProbeStatus {
    if ok { ProbeStatus::Ok } else { ProbeStatus::Failed }
}

/// Collects results and passes each one on as it finishes, for the GUI.
struct Run<'a> {
    report: Report,
    on_result: &'a mut (dyn FnMut(&ProbeResult) + Send),
}

impl Run<'_> {
    fn push(&mut self, r: ProbeResult) {
        (self.on_result)(&r);
        self.report.results.push(r);
    }
}

fn secrets(ctx: &Ctx) -> Vec<String> {
    ctx.store.vault().map(|v| v.secrets()).unwrap_or_default()
}

fn write(ctx: &Ctx, report: Report) -> (Report, Option<PathBuf>) {
    let path = report.write(ctx.store.reports_dir(), &secrets(ctx)).ok();
    (report, path)
}

// --- ChatGPT ---

pub async fn run_chatgpt(
    ctx: &Ctx,
    model: &str,
    on_result: &mut (dyn FnMut(&ProbeResult) + Send),
) -> (Report, Option<PathBuf>) {
    let mut run = Run {
        report: Report::new("probes", "chatgpt", Some(model)),
        on_result,
    };
    let rewrite = contract::scene(contract::REWRITE_SCENE).text;
    let extract = contract::scene(contract::EXTRACTION_SCENE).text;
    let steps: Vec<(&str, Check, Value, &str)> = vec![
        ("stream_rewrite", Check::Stream, api::body_rewrite(model, &rewrite), &rewrite),
        ("structured_text_format", Check::ContractInText, api::body_text_format(model, &extract), &extract),
        ("tool_forced_top_level", Check::ContractInTool, api::body_tool_top_level(model, &extract), &extract),
        ("tool_namespace_required", Check::ContractInTool, api::body_tool_namespace_required(model, &extract), &extract),
        ("tool_namespace_named", Check::ContractInTool, api::body_tool_namespace_named(model, &extract), &extract),
        ("tool_additional_tools", Check::ContractInTool, api::body_tool_additional(model, &extract), &extract),
        ("web_search", Check::WebSearch, api::body_web_search(model), ""),
        ("reject_temperature", Check::ExpectRejection, api::body_reject_temperature(model), ""),
        ("reject_system_message", Check::ExpectRejection, api::body_reject_system_message(model), ""),
    ];
    let names: Vec<&str> = steps.iter().map(|s| s.0).collect();

    let token = match auth::access_token(ctx).await {
        Ok(t) => t,
        Err(e) => {
            let why = e.to_string();
            run.push(ProbeResult::skipped("models", &why));
            for name in &names {
                run.push(ProbeResult::skipped(name, &why));
            }
            run.push(ProbeResult::skipped("refresh", &why));
            return write(ctx, run.report);
        }
    };

    run.push(probe_models(ctx, &token, model).await);

    let mut stopped: Option<String> = None;
    for (i, (name, check, body, scene)) in steps.iter().enumerate() {
        if let Some(why) = &stopped {
            run.push(ProbeResult::skipped(name, why));
            continue;
        }
        let token = match auth::access_token(ctx).await {
            Ok(t) => t,
            Err(e) => {
                stopped = Some(e.to_string());
                run.push(ProbeResult::skipped(name, &e.to_string()));
                continue;
            }
        };
        let o = api::stream_responses(ctx, &token, body, &mut |_| {}).await;
        run.push(evaluate(name, check, &o, scene));
        if must_stop(&o) {
            stopped = Some(format!(
                "stopped after {} returned {}",
                names[i],
                o.error_code().unwrap_or_default()
            ));
        }
    }

    match &stopped {
        Some(why) => run.push(ProbeResult::skipped("refresh", why)),
        None => run.push(probe_refresh(ctx).await),
    }
    write(ctx, run.report)
}

async fn probe_models(ctx: &Ctx, token: &str, model: &str) -> ProbeResult {
    match api::list_models(ctx, token).await {
        Ok(list) => ProbeResult {
            http_status: Some(list.http_status),
            request_id: list.request_id.clone(),
            ..ProbeResult::plain(
                "models",
                ProbeStatus::Ok,
                json!({
                    "listed": list.models,
                    "total_before_filter": list.total_before_filter,
                    "first_model_fields": list.first_model_fields,
                    "header_names": list.header_names,
                    "selected_is_listed": list.models.iter().any(|m| m.slug == model),
                }),
            )
        },
        Err(e) => ProbeResult {
            http_status: e.http_status,
            error_code: e.error.code,
            error_param: e.error.param,
            error_message: e.error.message,
            request_id: e.request_id,
            ..ProbeResult::plain("models", ProbeStatus::Failed, json!({}))
        },
    }
}

async fn probe_refresh(ctx: &Ctx) -> ProbeResult {
    match auth::force_refresh(ctx).await {
        Ok(evidence) => {
            let token_works = match auth::access_token(ctx).await {
                Ok(t) => api::list_models(ctx, &t).await.is_ok(),
                Err(_) => false,
            };
            let mut details = serde_json::to_value(&evidence).unwrap_or_default();
            details["new_token_works"] = json!(token_works);
            ProbeResult::plain("refresh", ok_if(token_works), details)
        }
        Err(e) => ProbeResult {
            http_status: e.http_status,
            error_code: e.code,
            error_message: e.message,
            request_id: e.request_id,
            ..ProbeResult::plain("refresh", ProbeStatus::Failed, json!({}))
        },
    }
}

pub async fn chatgpt_login(
    ctx: &Ctx,
    port: Option<u16>,
    open_browser: impl FnOnce(&str) -> Result<(), String>,
) -> (ProbeResult, Option<PathBuf>) {
    let result = match auth::login(ctx, port, open_browser).await {
        Ok(e) => ProbeResult::plain(
            "login",
            ok_if(e.plan_enabled),
            serde_json::to_value(&e).unwrap_or_default(),
        ),
        Err(f) => ProbeResult {
            http_status: f.http_status,
            error_code: f.code.clone(),
            error_message: Some(f.message.clone()),
            request_id: f.request_id.clone(),
            ..ProbeResult::plain("login", ProbeStatus::Failed, serde_json::to_value(&f).unwrap_or_default())
        },
    };
    login_report(ctx, "chatgpt", result)
}

fn login_report(ctx: &Ctx, provider: &str, result: ProbeResult) -> (ProbeResult, Option<PathBuf>) {
    let mut report = Report::new("login", provider, None);
    report.results.push(result.clone());
    let (_, path) = write(ctx, report);
    (result, path)
}

// --- OpenRouter ---

pub async fn openrouter_login(
    ctx: &Ctx,
    open_browser: impl FnOnce(&str) -> Result<(), String>,
) -> (ProbeResult, Option<PathBuf>) {
    let result = match openrouter::login(ctx, open_browser).await {
        Ok(e) => ProbeResult::plain("login", ProbeStatus::Ok, serde_json::to_value(&e).unwrap_or_default()),
        Err(f) => ProbeResult {
            http_status: f.http_status,
            error_code: f.code.clone(),
            error_message: Some(f.message.clone()),
            request_id: f.request_id.clone(),
            ..ProbeResult::plain("login", ProbeStatus::Failed, serde_json::to_value(&f).unwrap_or_default())
        },
    };
    login_report(ctx, "openrouter", result)
}

/// Web search costs money even with a free model, and it doesn't need credits
/// up front: a real run on a key with no balance succeeded and reported a cost.
/// So it runs only when asked for, per rule 10.
pub async fn run_openrouter(
    ctx: &Ctx,
    model: &str,
    with_search: bool,
    on_result: &mut (dyn FnMut(&ProbeResult) + Send),
) -> (Report, Option<PathBuf>) {
    const NOT_ASKED: &str = "paid: web search runs only when explicitly requested";
    let mut run = Run {
        report: Report::new("probes", "openrouter", Some(model)),
        on_result,
    };
    let names = [
        "stream_rewrite",
        "structured_response_format",
        "web_search_responses_api",
        "web_search_chat_completions",
    ];
    match openrouter::list_models(ctx).await {
        Ok(models) => {
            let selected = models.iter().find(|m| m.id == model).cloned();
            run.push(ProbeResult::plain(
                "models",
                ok_if(selected.is_some()),
                json!({
                    "total": models.len(),
                    "with_structured_outputs": models.iter().filter(|m| m.structured_outputs).count(),
                    "with_tools": models.iter().filter(|m| m.tools).count(),
                    "selected": selected,
                }),
            ));
        }
        Err(e) => run.push(ProbeResult {
            error_message: Some(e),
            ..ProbeResult::plain("models", ProbeStatus::Failed, json!({}))
        }),
    }
    let key = match openrouter::saved_key(ctx) {
        Ok(k) => k,
        Err(e) => {
            for name in names {
                run.push(ProbeResult::skipped(name, &e));
            }
            return write(ctx, run.report);
        }
    };

    let rewrite = contract::scene(contract::REWRITE_SCENE).text;
    let extract = contract::scene(contract::EXTRACTION_SCENE).text;
    let topic = api::WEB_SEARCH_TOPIC;
    let spend_before = openrouter::key_status(ctx).await.ok();
    let mut stopped: Option<String> = None;
    for (i, name) in names.iter().enumerate() {
        if let Some(why) = &stopped {
            run.push(ProbeResult::skipped(name, why));
            continue;
        }
        if i >= 2 && !with_search {
            run.push(ProbeResult::skipped(name, NOT_ASKED));
            continue;
        }
        let (check, o, scene) = match i {
            0 => (
                Check::Stream,
                openrouter::stream_chat(ctx, &key, &openrouter::body_rewrite(model, &rewrite), &mut |_| {}).await,
                rewrite.as_str(),
            ),
            1 => (
                Check::ContractInText,
                openrouter::stream_chat(ctx, &key, &openrouter::body_structured(model, &extract), &mut |_| {}).await,
                extract.as_str(),
            ),
            2 => (
                Check::WebSearch,
                openrouter::post_once(ctx, &key, "/api/v1/responses", &openrouter::body_web_search_responses(model, topic)).await,
                "",
            ),
            _ => (
                Check::WebSearch,
                openrouter::post_once(ctx, &key, "/api/v1/chat/completions", &openrouter::body_web_search_chat(model, topic)).await,
                "",
            ),
        };
        run.push(evaluate(name, &check, &o, scene));
        if must_stop(&o) {
            stopped = Some(format!("stopped: {name} returned {}", o.error_code().unwrap_or_default()));
        }
    }
    let spend_after = openrouter::key_status(ctx).await.ok();
    run.push(ProbeResult::plain(
        "key_spend",
        ok_if(spend_after.is_some()),
        json!({ "before": spend_before, "after": spend_after }),
    ));
    write(ctx, run.report)
}

// --- Ollama ---

pub async fn run_ollama(
    ctx: &Ctx,
    model: Option<&str>,
    on_result: &mut (dyn FnMut(&ProbeResult) + Send),
) -> (Report, Option<PathBuf>) {
    let names = ["stream_rewrite", "structured_format"];
    const NO_SEARCH: &str = "a local model doesn't search by itself: SPEC §7 calls the APIs directly";
    let server = ollama::server(ctx).await;
    let chosen = match &server {
        Ok(s) => model
            .map(str::to_string)
            .or_else(|| s.models.first().map(|m| m.name.clone())),
        Err(_) => model.map(str::to_string),
    };
    let mut run = Run {
        report: Report::new("probes", "ollama", chosen.as_deref()),
        on_result,
    };
    let Ok(s) = server else {
        let why = server.err().unwrap_or_default();
        run.push(ProbeResult {
            error_message: Some(why.clone()),
            ..ProbeResult::plain("server", ProbeStatus::Failed, json!({ "note": "not installed or not running" }))
        });
        for name in names {
            run.push(ProbeResult::skipped(name, "server unreachable"));
        }
        run.push(ProbeResult::skipped("web_search", NO_SEARCH));
        return write(ctx, run.report);
    };
    // Only the count and the model under test: what else someone keeps on their
    // machine is none of the report's business.
    let selected = chosen
        .as_deref()
        .and_then(|c| s.models.iter().find(|m| m.name == c));
    run.push(ProbeResult::plain(
        "server",
        ProbeStatus::Ok,
        json!({ "version": s.version, "models_installed": s.models.len(), "selected": selected }),
    ));
    let Some(chosen) = chosen else {
        for name in names {
            run.push(ProbeResult::skipped(name, "no model pulled"));
        }
        run.push(ProbeResult::skipped("web_search", NO_SEARCH));
        return write(ctx, run.report);
    };

    let rewrite = contract::scene(contract::REWRITE_SCENE).text;
    let o = ollama::stream_chat(ctx, &ollama::body_rewrite(&chosen, &rewrite), &mut |_| {}).await;
    run.push(evaluate(names[0], &Check::Stream, &o, &rewrite));
    let extract = contract::scene(contract::EXTRACTION_SCENE).text;
    let o = ollama::stream_chat(ctx, &ollama::body_structured(&chosen, &extract), &mut |_| {}).await;
    run.push(evaluate(names[1], &Check::ContractInText, &o, &extract));
    run.push(ProbeResult::skipped("web_search", NO_SEARCH));
    write(ctx, run.report)
}

// --- Rewrite, for the GUI's draft pane and the CLI ---

/// Streams into `on_delta`. The text goes to a read-only pane: nothing in this
/// prototype can write it into a manuscript, and none exists to write into.
pub async fn rewrite(
    ctx: &Ctx,
    provider: Provider,
    model: &str,
    on_delta: &mut (dyn FnMut(&str) + Send),
) -> Result<StreamOutcome, String> {
    let scene = contract::scene(contract::REWRITE_SCENE).text;
    match provider {
        Provider::Chatgpt => {
            let token = auth::access_token(ctx).await.map_err(|e| e.to_string())?;
            Ok(api::stream_responses(ctx, &token, &api::body_rewrite(model, &scene), on_delta).await)
        }
        Provider::Openrouter => {
            let key = openrouter::saved_key(ctx)?;
            Ok(openrouter::stream_chat(ctx, &key, &openrouter::body_rewrite(model, &scene), on_delta).await)
        }
        Provider::Ollama => Ok(ollama::stream_chat(ctx, &ollama::body_rewrite(model, &scene), on_delta).await),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stream::{ApiError, Citation, FunctionCall};

    fn completed() -> StreamOutcome {
        StreamOutcome::new(Terminal::Completed)
    }

    const GOOD: &str = r#"{"entities":[{"name":"Marta","type":"person","aliases":[]}],"facts":[],"relations":[]}"#;

    #[test]
    fn a_tool_probe_without_a_call_fails_even_when_completed() {
        let r = evaluate("t", &Check::ContractInTool, &completed(), "");
        assert_eq!(r.status, ProbeStatus::Failed);
    }

    #[test]
    fn a_tool_probe_checks_the_arguments_against_the_contract() {
        let mut o = completed();
        o.function_calls.push(FunctionCall {
            name: "report_extraction".into(),
            namespace: Some("ink".into()),
            arguments: GOOD.into(),
        });
        let r = evaluate("t", &Check::ContractInTool, &o, "");
        assert_eq!(r.status, ProbeStatus::Ok);
        assert_eq!(r.details["function_call"]["namespace"], "ink");

        o.function_calls[0].arguments = "{\"bad\":1}".into();
        assert_eq!(evaluate("t", &Check::ContractInTool, &o, "").status, ProbeStatus::Failed);
    }

    #[test]
    fn text_that_breaks_the_contract_fails_the_probe() {
        let mut o = completed();
        o.text = "Claro, aquí tienes el resultado".into();
        let r = evaluate("t", &Check::ContractInText, &o, "");
        assert_eq!(r.status, ProbeStatus::Failed);
        assert_eq!(r.details["contract"]["schema_ok"], false);
        // The model's text must not leak through the parser error either.
        assert!(!r.details.to_string().contains("aquí tienes"));
    }

    #[test]
    fn web_search_without_a_citation_is_a_failure() {
        let mut o = completed();
        o.web_search_calls = 1;
        assert_eq!(evaluate("t", &Check::WebSearch, &o, "").status, ProbeStatus::Failed);
        o.citations.push(Citation {
            url: "https://a".into(),
            title: None,
        });
        assert_eq!(evaluate("t", &Check::WebSearch, &o, "").status, ProbeStatus::Ok);
    }

    #[test]
    fn rejection_probes_expect_a_refusal() {
        let mut refused = StreamOutcome::new(Terminal::HttpError);
        refused.http_status = Some(400);
        refused.error = Some(ApiError {
            code: Some("subscription_sharing_unsupported_capability".into()),
            param: Some("temperature".into()),
            ..ApiError::default()
        });
        let r = evaluate("t", &Check::ExpectRejection, &refused, "");
        assert_eq!(r.status, ProbeStatus::Rejected);
        assert_eq!(r.error_param.as_deref(), Some("temperature"));
        assert_eq!(evaluate("t", &Check::ExpectRejection, &completed(), "").status, ProbeStatus::Failed);
    }

    #[test]
    fn a_probe_never_reports_success_on_a_cut_stream() {
        let cut = StreamOutcome::new(Terminal::Interrupted);
        for check in [Check::Stream, Check::ContractInText, Check::ContractInTool, Check::WebSearch] {
            assert_eq!(evaluate("t", &check, &cut, "").status, ProbeStatus::Failed);
        }
    }
}
