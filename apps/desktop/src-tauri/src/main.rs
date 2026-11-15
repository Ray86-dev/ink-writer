#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! The shell stays thin: domain logic lives in the TypeScript core. These commands are the whole
//! surface the WebView can reach, and none of them hands out a credential (rule 9).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use ink_writer::ai::{AiClient, AiEvent, AiRequest, Bases, Cancellations, Route, is_paid};
use ink_writer::db::{Database, ExecResult, Statement};
use ink_writer::files::write_atomically;
use ink_writer::limits::{DailyLimit, LimitsView, today};
use ink_writer::openrouter_login::Login;
use ink_writer::research::{ResearchAnswer, ResearchBases, ResearchClient, ResearchRequest};
use ink_writer::secrets::{Keys, MemoryStore, SystemStore};
use ink_writer::test_mode::TestMode;
use serde::Serialize;
use serde_json::{Map, Value};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const DB_FILE: &str = "ink-writer.db";
const SINGLE_INSTANCE_TEST: &str = "single-instance";
/// The names of the keys, both in the system's store and as the files that stand in for it.
const OPENROUTER_KEY: &str = "openrouter-key";
const DEEPSEEK_KEY: &str = "deepseek-key";
const LIMITS_FILE: &str = "ai-limits.json";
const SEARCH_LIMITS_FILE: &str = "search-limits.json";
const LOGIN_ID: &str = "openrouter-login";
/// How long the author has to come back from the browser. They can also cancel at any time.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

struct Shell {
    /// Kept as a `Result` so that the page can explain the problem instead of the app vanishing.
    db: Result<Database, String>,
    ai: Result<AiClient, String>,
    ai_calls: Cancellations,
    keys: Arc<Keys>,
    deepseek_keys: Arc<Keys>,
    /// What the author allows to be spent. Kept here so that the page can't go past it.
    limits: DailyLimit,
    research: Result<ResearchClient, String>,
    /// How many searches for documentation a day.
    searches: DailyLimit,
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
        // Each service gets its own key and no other. The system's store can be slow to answer.
        let keys = match request.route {
            Route::Openrouter => Some(shell.keys.clone()),
            Route::Deepseek => Some(shell.deepseek_keys.clone()),
            Route::Ollama => None,
        };
        let key = match keys {
            Some(keys) => tauri::async_runtime::spawn_blocking(move || keys.get())
                .await
                .map_err(|error| error.to_string())?
                .map_err(|error| format!("key: {error}"))?,
            None => None,
        };
        // A request that costs money is counted before it leaves, and refused past the day's limit.
        let paid = is_paid(&request);
        if paid {
            ink_writer::ai::check(&request, shell.limits.is_on())?;
            shell.limits.spend(today())?;
        }
        let sink = |event| {
            // The page going away is no reason to stop here: cancelling is how it says so.
            let _ = on_event.send(event);
        };
        client.run(&request, key.as_deref(), paid, sink).await
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
        connected: shell.keys.get()?.is_some(),
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
        tauri::async_runtime::spawn_blocking(move || keys.set(&key))
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
    shell.keys.clear()
}

#[derive(Serialize)]
struct KeyStatus {
    present: bool,
}

/// Whether there's a DeepSeek key. The key itself never goes back to the page (rule 9).
#[tauri::command(async)]
fn deepseek_key_status(shell: State<'_, Shell>) -> Result<KeyStatus, String> {
    Ok(KeyStatus {
        present: shell.deepseek_keys.get()?.is_some(),
    })
}

/// Keeps the key the author typed. It crosses the page once, on its way in, and never comes back.
#[tauri::command(async)]
fn deepseek_key_set(shell: State<'_, Shell>, key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() || key.chars().any(char::is_whitespace) {
        return Err("key: that doesn't look like a key".into());
    }
    shell
        .deepseek_keys
        .set(key)
        .map_err(|error| format!("store: {error}"))
}

#[tauri::command(async)]
fn deepseek_key_clear(shell: State<'_, Shell>) -> Result<(), String> {
    shell.deepseek_keys.clear()
}

/// How many paid requests a day the author allows, and how many were made today.
#[tauri::command(async)]
fn ai_limits_get(shell: State<'_, Shell>) -> LimitsView {
    shell.limits.view(today())
}

/// Zero turns paid requests off.
#[tauri::command(async)]
fn ai_limits_set(shell: State<'_, Shell>, daily_requests: u32) -> Result<LimitsView, String> {
    shell.limits.set_daily_requests(daily_requests)?;
    Ok(shell.limits.view(today()))
}

/// Looks something up for the documentation. The page says what kind of search and gives a term
/// or a point: where it goes is decided here. Each one counts against the day's searches.
#[tauri::command]
async fn research_fetch(
    shell: State<'_, Shell>,
    request: ResearchRequest,
) -> Result<ResearchAnswer, String> {
    let client = shell.research.as_ref().map_err(Clone::clone)?;
    // Checked first, so that a search that can't be sent doesn't use up the day's count.
    client.check(&request)?;
    shell.searches.spend(today())?;
    client.run(&request).await
}

#[tauri::command(async)]
fn research_limits_get(shell: State<'_, Shell>) -> LimitsView {
    shell.searches.view(today())
}

/// Zero turns the searches off.
#[tauri::command(async)]
fn research_limits_set(shell: State<'_, Shell>, daily_requests: u32) -> Result<LimitsView, String> {
    shell.searches.set_daily_requests(daily_requests)?;
    Ok(shell.searches.view(today()))
}

/// Opens the source of something found in the author's browser. Only a web address: the page can't
/// use this to start anything else.
#[tauri::command(async)]
fn open_link(shell: State<'_, Shell>, url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|error| error.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("only a web address can be opened".into());
    }
    if shell.test.is_some() {
        return Err("browser: a test can't open a link".into());
    }
    open::that_detached(parsed.as_str()).map_err(|error| format!("browser: {error}"))
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
                    None => Box::new(SystemStore::new(OPENROUTER_KEY, dir.join(OPENROUTER_KEY))),
                })),
                deepseek_keys: Arc::new(Keys::new(match &test {
                    Some(_) => Box::new(MemoryStore::default()),
                    None => Box::new(SystemStore::new(DEEPSEEK_KEY, dir.join(DEEPSEEK_KEY))),
                })),
                limits: DailyLimit::paid(dir.join(LIMITS_FILE)),
                research: ResearchClient::new(match &test {
                    Some(test) => test.research_bases(),
                    None => ResearchBases::default(),
                }),
                searches: DailyLimit::searches(dir.join(SEARCH_LIMITS_FILE)),
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
            deepseek_key_status,
            deepseek_key_set,
            deepseek_key_clear,
            ai_limits_get,
            ai_limits_set,
            research_fetch,
            research_limits_get,
            research_limits_set,
            open_link,
            test_log,
            test_close_window,
            test_finish,
        ])
        .run(tauri::generate_context!())
        .expect("can't start the application");
}
