#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! The shell stays thin: domain logic lives in the TypeScript core. These commands are the whole
//! surface the WebView can reach, and none of them hands out a credential (rule 9).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use ink_writer::ai::{AiClient, AiEvent, AiRequest, Bases, Cancellations, Route};
use ink_writer::db::{Database, ExecResult, Statement};
use ink_writer::files::write_atomically;
use ink_writer::openrouter_login::Login;
use ink_writer::secrets::{Keys, MemoryStore, SystemStore};
use ink_writer::test_mode::TestMode;
use serde::Serialize;
use serde_json::{Map, Value};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const DB_FILE: &str = "ink-writer.db";
const SINGLE_INSTANCE_TEST: &str = "single-instance";
const KEY_FILE: &str = "openrouter-key";
const LOGIN_ID: &str = "openrouter-login";
/// How long the author has to come back from the browser. They can also cancel at any time.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

struct Shell {
    /// Kept as a `Result` so that the page can explain the problem instead of the app vanishing.
    db: Result<Database, String>,
    ai: Result<AiClient, String>,
    ai_calls: Cancellations,
    keys: Arc<Keys>,
    test: Option<TestMode>,
    /// In a test, where exports go. A test can't answer a dialog.
    test_dir: Option<PathBuf>,
}

impl Shell {
    fn db(&self) -> Result<&Database, String> {
        self.db.as_ref().map_err(Clone::clone)
    }
}

#[derive(Serialize)]
struct TestInfo {
    mode: String,
    arg: Option<String>,
}

#[derive(Serialize)]
struct AppInfo {
    test: Option<TestInfo>,
}

#[tauri::command]
fn app_info(shell: State<'_, Shell>) -> AppInfo {
    AppInfo {
        test: shell.test.as_ref().map(|test| TestInfo {
            mode: test.name.clone(),
            arg: test.arg.clone(),
        }),
    }
}

// `async` runs them off the main thread: a slow disk must not freeze the window.
#[tauri::command(async)]
fn db_query(
    shell: State<'_, Shell>,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Map<String, Value>>, String> {
    shell.db()?.query(&sql, &params)
}

#[tauri::command(async)]
fn db_execute(
    shell: State<'_, Shell>,
    sql: String,
    params: Vec<Value>,
) -> Result<ExecResult, String> {
    shell.db()?.execute(&sql, &params)
}

#[tauri::command(async)]
fn db_transaction(
    shell: State<'_, Shell>,
    statements: Vec<Statement>,
) -> Result<Vec<ExecResult>, String> {
    shell.db()?.transaction(&statements)
}

/// Saves an exported book where the author chooses. The dialog opens here rather than taking a path
/// from the page, so the page can't write anywhere by itself. Returns false if the author cancels.
#[tauri::command(async)]
fn export_file(
    app: AppHandle,
    shell: State<'_, Shell>,
    suggested_name: String,
    extension: String,
    data_base64: String,
) -> Result<bool, String> {
    let label = match extension.as_str() {
        "docx" => "Word",
        "md" => "Markdown",
        _ => return Err(format!("can't export as {extension}")),
    };
    let bytes = STANDARD
        .decode(data_base64)
        .map_err(|error| error.to_string())?;
    let target: Option<PathBuf> = match &shell.test_dir {
        Some(dir) => Some(dir.join(format!("export.{extension}"))),
        None => app
            .dialog()
            .file()
            .set_file_name(format!("{suggested_name}.{extension}"))
            .add_filter(label, &[extension.as_str()])
            .blocking_save_file()
            .map(|path| path.into_path().map_err(|error| error.to_string()))
            .transpose()?,
    };
    match target {
        Some(path) => write_atomically(&path, &bytes)
            .map(|()| true)
            .map_err(|error| error.to_string()),
        None => Ok(false),
    }
}

/// Sends one request to a model and passes the answer on as it arrives. Everything about how it
/// went, a failure included, goes through `on_event`, so that the page gets it all in order.
#[tauri::command]
async fn ai_send(
    shell: State<'_, Shell>,
    id: String,
    request: AiRequest,
    on_event: Channel<AiEvent>,
) -> Result<(), String> {
    let cancelled = shell.ai_calls.register(&id);
    let result = async {
        let client = shell.ai.as_ref().map_err(Clone::clone)?;
        // Read only for the service it belongs to. The system's store can be slow to answer.
        let key = if request.route == Route::Openrouter {
            let keys = shell.keys.clone();
            tauri::async_runtime::spawn_blocking(move || keys.openrouter())
                .await
                .map_err(|error| error.to_string())?
                .map_err(|error| format!("key: {error}"))?
        } else {
            None
        };
        let sink = |event| {
            // The page going away is no reason to stop here: cancelling is how it says so.
            let _ = on_event.send(event);
        };
        client.run(&request, key.as_deref(), sink).await
    };
    let result = tokio::select! {
        result = result => {
            shell.ai_calls.finish(&id);
            result
        }
        _ = cancelled => Err("cancelled".to_string()),
    };
    if let Err(message) = result {
        let _ = on_event.send(AiEvent::Error { message });
    }
    Ok(())
}

#[tauri::command]
fn ai_cancel(shell: State<'_, Shell>, id: String) {
    shell.ai_calls.cancel(&id);
}

#[derive(Serialize)]
struct OpenrouterStatus {
    connected: bool,
}

/// Whether there's a key. The key itself never goes to the page (rule 9).
#[tauri::command(async)]
fn openrouter_status(shell: State<'_, Shell>) -> Result<OpenrouterStatus, String> {
    Ok(OpenrouterStatus {
        connected: shell.keys.openrouter()?.is_some(),
    })
}

/// Signs in through the author's browser and keeps the key. Resolves once connected. An error
/// starts with what went wrong: `cancelled`, `timeout`, `listen`, `browser`, `unreachable`,
/// `refused` or `store`.
#[tauri::command]
async fn openrouter_connect(shell: State<'_, Shell>) -> Result<(), String> {
    if shell.test.is_some() {
        return Err("browser: a test can't sign in".into());
    }
    let client = shell.ai.as_ref().map_err(Clone::clone)?;
    // A new attempt takes the place of one still waiting, which ends as cancelled.
    let cancelled = shell.ai_calls.register(LOGIN_ID);
    let attempt = async {
        let base = client.openrouter_base();
        let login = Login::begin(base)
            .await
            .map_err(|error| error.to_string())?;
        open::that_detached(&login.auth_url).map_err(|error| format!("browser: {error}"))?;
        let key = tokio::time::timeout(LOGIN_TIMEOUT, login.finish(client.http(), base))
            .await
            .map_err(|_| "timeout".to_string())?
            .map_err(|error| error.to_string())?;
        let keys = shell.keys.clone();
        tauri::async_runtime::spawn_blocking(move || keys.set_openrouter(&key))
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| format!("store: {error}"))
    };
    tokio::select! {
        result = attempt => {
            shell.ai_calls.finish(LOGIN_ID);
            result
        }
        _ = cancelled => Err("cancelled".to_string()),
    }
}

#[tauri::command]
fn openrouter_cancel_connect(shell: State<'_, Shell>) {
    shell.ai_calls.cancel(LOGIN_ID);
}

/// Forgets the key on this machine. It doesn't delete it from the author's OpenRouter account.
#[tauri::command(async)]
fn openrouter_disconnect(shell: State<'_, Shell>) -> Result<(), String> {
    shell.keys.clear_openrouter()
}

/// One line to whoever started the test. Sent only after what it reports has really happened.
#[tauri::command]
fn test_log(shell: State<'_, Shell>, line: String) -> Result<(), String> {
    if shell.test.is_none() {
        return Err("only available in a test mode".into());
    }
    println!("{line}");
    Ok(())
}

/// Closes the window the way the system's close button does, so that a test can go through what
/// happens then.
#[tauri::command]
fn test_close_window(window: tauri::Window, shell: State<'_, Shell>) -> Result<(), String> {
    if shell.test.is_none() {
        return Err("only available in a test mode".into());
    }
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
fn test_finish(
    app: AppHandle,
    shell: State<'_, Shell>,
    ok: bool,
    detail: String,
) -> Result<(), String> {
    let Some(test) = shell.test.as_ref() else {
        return Err("only available in a test mode".into());
    };
    let verdict = if ok { "passed" } else { "FAILED" };
    println!("{} test {verdict}: {detail}", test.name);
    app.exit(if ok { 0 } else { 1 });
    Ok(())
}

fn main() {
    let test = TestMode::from_args(std::env::args());
    if let Some(test) = &test {
        // A plain `cargo build` or `cargo test` leaves a binary that loads the page from the dev
        // server. With none running, the page never appears and the test would only time out.
        if tauri::is_dev() {
            eprintln!(
                "{} test FAILED: this binary needs the dev server. Use the npm script.",
                test.name
            );
            std::process::exit(3);
        }
        let (name, timeout) = (test.name.clone(), test.timeout);
        std::thread::spawn(move || {
            std::thread::sleep(timeout);
            eprintln!("{name} test FAILED: the page didn't report within {timeout:?}");
            std::process::exit(2);
        });
    }

    let mut builder = tauri::Builder::default();
    // First, as the plugin asks. Not in other tests, which may run alongside copies on purpose.
    if test
        .as_ref()
        .is_none_or(|test| test.name == SINGLE_INSTANCE_TEST)
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let dir = match &test {
                Some(test) => test.data_dir(),
                None => app.path().app_data_dir()?,
            };
            app.manage(Shell {
                db: Database::open(&dir.join(DB_FILE)),
                ai: AiClient::new(match &test {
                    Some(test) => test.ai_bases(),
                    None => Bases::default(),
                }),
                ai_calls: Cancellations::default(),
                // A test never touches the author's real credentials.
                keys: Arc::new(Keys::new(match &test {
                    Some(_) => Box::new(MemoryStore::default()),
                    None => Box::new(SystemStore::new(dir.join(KEY_FILE))),
                })),
                test_dir: test.is_some().then(|| dir.clone()),
                test,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            db_query,
            db_execute,
            db_transaction,
            export_file,
            ai_send,
            ai_cancel,
            openrouter_status,
            openrouter_connect,
            openrouter_cancel_connect,
            openrouter_disconnect,
            test_log,
            test_close_window,
            test_finish,
        ])
        .run(tauri::generate_context!())
        .expect("can't start the application");
}
