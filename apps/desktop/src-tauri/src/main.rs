#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! The shell stays thin: domain logic lives in the TypeScript core. These commands are the whole
//! surface the WebView can reach, and none of them hands out a credential (rule 9).

use std::path::{Path, PathBuf};
use std::time::Duration;

use ink_writer::db::{Database, ExecResult, Statement};
use serde::Serialize;
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager, State};

const DB_FILE: &str = "ink-writer.db";

/// Starts the app on a throwaway database, runs the checks in the page, and exits with the result.
/// It's how CI proves that the app really starts on each operating system.
const SMOKE_FLAG: &str = "--smoke-test";
const SMOKE_TIMEOUT: Duration = Duration::from_secs(120);

struct Shell {
    /// Kept as a `Result` so that the page can explain the problem instead of the app vanishing.
    db: Result<Database, String>,
    smoke: bool,
}

impl Shell {
    fn db(&self) -> Result<&Database, String> {
        self.db.as_ref().map_err(Clone::clone)
    }
}

#[derive(Serialize)]
struct AppInfo {
    smoke: bool,
}

#[tauri::command]
fn app_info(shell: State<'_, Shell>) -> AppInfo {
    AppInfo { smoke: shell.smoke }
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

#[tauri::command]
fn smoke_report(
    app: AppHandle,
    shell: State<'_, Shell>,
    ok: bool,
    detail: String,
) -> Result<(), String> {
    if !shell.smoke {
        return Err(format!("only available with {SMOKE_FLAG}"));
    }
    let verdict = if ok { "passed" } else { "FAILED" };
    println!("smoke test {verdict}: {detail}");
    app.exit(if ok { 0 } else { 1 });
    Ok(())
}

/// A fixed folder recreated on each run, so that it can never touch the user's data, and repeated
/// runs leave at most one behind.
fn smoke_db_path() -> PathBuf {
    let dir = std::env::temp_dir().join("ink-writer-smoke");
    let _ = std::fs::remove_dir_all(&dir);
    dir.join(DB_FILE)
}

fn real_db_path(data_dir: &Path) -> PathBuf {
    data_dir.join(DB_FILE)
}

fn main() {
    let smoke = std::env::args().any(|arg| arg == SMOKE_FLAG);
    if smoke {
        // A plain `cargo build` or `cargo test` leaves a binary that loads the page from the dev
        // server. With none running, the page never appears and the test would only time out.
        if tauri::is_dev() {
            eprintln!("smoke test FAILED: this binary needs the dev server. Use: npm run smoke");
            std::process::exit(3);
        }
        std::thread::spawn(|| {
            std::thread::sleep(SMOKE_TIMEOUT);
            eprintln!("smoke test FAILED: the page didn't report within {SMOKE_TIMEOUT:?}");
            std::process::exit(2);
        });
    }

    tauri::Builder::default()
        .setup(move |app| {
            let path = if smoke {
                smoke_db_path()
            } else {
                real_db_path(&app.path().app_data_dir()?)
            };
            app.manage(Shell {
                db: Database::open(&path),
                smoke,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            db_query,
            db_execute,
            db_transaction,
            smoke_report,
        ])
        .run(tauri::generate_context!())
        .expect("can't start the application");
}
