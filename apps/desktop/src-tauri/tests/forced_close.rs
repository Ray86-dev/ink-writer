//! Rule 2: nothing committed may be lost when the process dies. The test re-runs itself as a child
//! process, which writes and then aborts on the spot, as a crash or a killed process would. M2 builds
//! on this guarantee for prose.

use std::path::{Path, PathBuf};
use std::process::Command;

use ink_writer::db::{Database, Statement};
use rusqlite::Connection;
use serde_json::json;

const DB_PATH_VAR: &str = "INK_WRITER_FORCED_CLOSE_DB";

fn schema(db: &Database) {
    db.execute("CREATE TABLE IF NOT EXISTS log (x TEXT)", &[])
        .unwrap();
}

fn rows(path: &Path) -> Vec<String> {
    let db = Database::open(path).unwrap();
    db.query("SELECT x FROM log ORDER BY rowid", &[])
        .unwrap()
        .into_iter()
        .map(|row| row["x"].as_str().unwrap().to_string())
        .collect()
}

fn run_child(test: &str, path: &Path) {
    let status = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", test, "--ignored", "--nocapture"])
        .env(DB_PATH_VAR, path)
        .status()
        .unwrap();
    assert!(
        !status.success(),
        "the child was meant to die abruptly, not finish"
    );
}

fn child_path() -> PathBuf {
    PathBuf::from(std::env::var_os(DB_PATH_VAR).expect("run through the parent test"))
}

#[test]
fn committed_writes_survive_a_forced_close() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.db");

    run_child("child_commits_then_dies", &path);

    assert_eq!(rows(&path), ["single", "batch-1", "batch-2"]);
}

#[test]
#[ignore = "run by committed_writes_survive_a_forced_close as a child process"]
fn child_commits_then_dies() {
    let db = Database::open(&child_path()).unwrap();
    schema(&db);
    db.execute("INSERT INTO log VALUES (?)", &[json!("single")])
        .unwrap();
    db.transaction(&[
        Statement {
            sql: "INSERT INTO log VALUES ('batch-1')".into(),
            params: vec![],
        },
        Statement {
            sql: "INSERT INTO log VALUES ('batch-2')".into(),
            params: vec![],
        },
    ])
    .unwrap();
    std::process::abort();
}

#[test]
fn an_unfinished_transaction_leaves_no_trace_after_a_forced_close() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.db");

    run_child("child_dies_inside_a_transaction", &path);

    assert_eq!(rows(&path), ["before"]);
    // The database is still healthy and accepts writes.
    let db = Database::open(&path).unwrap();
    db.execute("INSERT INTO log VALUES ('after')", &[]).unwrap();
    let check = db.query("PRAGMA integrity_check", &[]).unwrap();
    assert_eq!(check[0]["integrity_check"], "ok");
}

#[test]
#[ignore = "run by an_unfinished_transaction_leaves_no_trace_after_a_forced_close as a child process"]
fn child_dies_inside_a_transaction() {
    let path = child_path();
    {
        let db = Database::open(&path).unwrap();
        schema(&db);
        db.execute("INSERT INTO log VALUES ('before')", &[])
            .unwrap();
    }
    // `Database` doesn't expose an open transaction, by design, so this uses SQLite directly on the
    // same file to die in the middle of one.
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch("PRAGMA journal_mode = WAL; BEGIN; INSERT INTO log VALUES ('unfinished');")
        .unwrap();
    std::process::abort();
}
