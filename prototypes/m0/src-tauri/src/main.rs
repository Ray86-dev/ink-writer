#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Tauri shell of the M0 spike. Only metadata and draft text cross to the
//! WebView: tokens stay in Rust (rule 9). The commands return values built for
//! the UI, none of which contain a credential.

use std::sync::{Arc, Mutex};

use m0::chatgpt::{api, auth};
use m0::ctx::Ctx;
use m0::probes::{self, Provider};
use m0::report::ProbeResult;
use m0::{now_unix, ollama, openrouter};
use serde::Serialize;
use serde_json::{Value, json};
use tauri::State;
use tauri::ipc::Channel;
use tokio::task::AbortHandle;

struct App {
    ctx: Arc<Ctx>,
    /// A sign-in abandoned in the browser would hold its port until timeout.
    login: Mutex<Option<AbortHandle>>,
}

fn open_system_browser(url: &str) -> Result<(), String> {
    open::that_detached(url).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct Status {
    chatgpt_registered: bool,
    chatgpt_signed_in: bool,
    chatgpt_plan_enabled: bool,
    chatgpt_expires_in_s: Option<i64>,
    openrouter_connected: bool,
    data_dir: String,
}

#[tauri::command]
async fn status(app: State<'_, App>) -> Result<Status, String> {
    let state = app.ctx.store.state()?;
    let vault = app.ctx.store.vault()?;
    Ok(Status {
        chatgpt_registered: state.chatgpt_client_id.is_some(),
        chatgpt_signed_in: vault.chatgpt.is_some(),
        chatgpt_plan_enabled: vault
            .chatgpt
            .as_ref()
            .is_some_and(|t| auth::scope_grants_plan(&t.scope)),
        chatgpt_expires_in_s: vault
            .chatgpt
            .as_ref()
            .map(|t| t.expires_at_unix as i64 - now_unix() as i64),
        openrouter_connected: vault.openrouter_key.is_some(),
        data_dir: app.ctx.store.dir().display().to_string(),
    })
}

fn with_path(result: ProbeResult, path: Option<std::path::PathBuf>) -> Value {
    json!({ "result": result, "report_path": path.map(|p| p.display().to_string()) })
}

/// Runs a sign-in, replacing any earlier one still waiting on its callback.
async fn exclusive_login(
    app: &App,
    work: impl Future<Output = Value> + Send + 'static,
) -> Result<Value, String> {
    let task = {
        let mut slot = app.login.lock().map_err(|_| "login lock poisoned")?;
        if let Some(previous) = slot.take() {
            previous.abort();
        }
        let task = tokio::spawn(work);
        *slot = Some(task.abort_handle());
        task
    };
    task.await
        .map_err(|_| "Se canceló este inicio de sesión.".to_string())
}

#[tauri::command]
async fn chatgpt_login(app: State<'_, App>, port: Option<u16>) -> Result<Value, String> {
    let ctx = app.ctx.clone();
    exclusive_login(&app, async move {
        let (result, path) = probes::chatgpt_login(&ctx, port, open_system_browser).await;
        with_path(result, path)
    })
    .await
}

#[tauri::command]
async fn chatgpt_logout(app: State<'_, App>) -> Result<(), String> {
    auth::sign_out(&app.ctx)
        .await
        .map_err(|e| format!("La revocación no se confirmó: {}", e.message.unwrap_or_default()))
}

#[tauri::command]
async fn chatgpt_models(app: State<'_, App>) -> Result<Vec<api::Model>, String> {
    let token = auth::access_token(&app.ctx).await.map_err(|e| e.to_string())?;
    api::list_models(&app.ctx, &token)
        .await
        .map(|l| l.models)
        .map_err(|e| {
            format!(
                "HTTP {:?} {}",
                e.http_status,
                e.error.code.or(e.error.message).unwrap_or_default()
            )
        })
}

#[tauri::command]
async fn openrouter_login(app: State<'_, App>) -> Result<Value, String> {
    let ctx = app.ctx.clone();
    exclusive_login(&app, async move {
        let (result, path) = probes::openrouter_login(&ctx, open_system_browser).await;
        with_path(result, path)
    })
    .await
}

#[tauri::command]
async fn openrouter_models(app: State<'_, App>) -> Result<Vec<openrouter::Model>, String> {
    openrouter::list_models(&app.ctx).await
}

#[tauri::command]
async fn ollama_server(app: State<'_, App>) -> Result<ollama::Server, String> {
    ollama::server(&app.ctx).await
}

#[tauri::command]
async fn rewrite(
    app: State<'_, App>,
    provider: Provider,
    model: String,
    on_delta: Channel<String>,
) -> Result<Value, String> {
    let mut send = |d: &str| {
        let _ = on_delta.send(d.to_string());
    };
    let o = probes::rewrite(&app.ctx, provider, &model, &mut send).await?;
    let mut summary = o.metrics();
    summary["error"] = json!(o.error);
    summary["http_status"] = json!(o.http_status);
    summary["request_id"] = json!(o.request_id);
    Ok(summary)
}

#[tauri::command]
async fn run_probes(
    app: State<'_, App>,
    provider: Provider,
    model: String,
    with_search: Option<bool>,
    on_result: Channel<ProbeResult>,
) -> Result<Option<String>, String> {
    let mut send = |r: &ProbeResult| {
        let _ = on_result.send(r.clone());
    };
    let (_, path) = match provider {
        Provider::Chatgpt => probes::run_chatgpt(&app.ctx, &model, &mut send).await,
        Provider::Openrouter => {
            probes::run_openrouter(&app.ctx, &model, with_search.unwrap_or(false), &mut send).await
        }
        Provider::Ollama => {
            let chosen = (!model.is_empty()).then_some(model.as_str());
            probes::run_ollama(&app.ctx, chosen, &mut send).await
        }
    };
    Ok(path.map(|p| p.display().to_string()))
}

/// A fixed destination, so the WebView can't ask to open arbitrary URLs.
#[tauri::command]
fn open_manage_usage() -> Result<(), String> {
    open_system_browser("https://chatgpt.com/settings/usage")
}

fn main() {
    let ctx = Ctx::production().expect("can't start the local store");
    tauri::Builder::default()
        .manage(App {
            ctx: Arc::new(ctx),
            login: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            status,
            chatgpt_login,
            chatgpt_logout,
            chatgpt_models,
            openrouter_login,
            openrouter_models,
            ollama_server,
            rewrite,
            run_probes,
            open_manage_usage,
        ])
        .run(tauri::generate_context!())
        .expect("can't run the Tauri app");
}
