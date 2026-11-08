//! SQLite behind the core's `SqlDriver` contract.
//!
//! The schema and the queries live in the TypeScript core, shared with the future browser version.
//! That means the WebView can run SQL, so this connection is limited to the app's own database: it
//! can't attach other files, load extensions or write to the schema tables directly. Tokens are
//! never stored in this database (rule 9).

use std::path::Path;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use rusqlite::config::DbConfig;
use rusqlite::limits::Limit;
use rusqlite::types::{Value as Sql, ValueRef};
use rusqlite::{Connection, TransactionBehavior, params_from_iter};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value as Json, json};

/// Blobs cross the IPC boundary as `{"$blob": "<base64>"}`, because JSON has no binary type.
const BLOB_KEY: &str = "$blob";

/// Past this, a JavaScript number silently loses precision, so such integers are refused.
const MAX_SAFE_INTEGER: i64 = (1 << 53) - 1;

#[derive(Debug, Deserialize)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Json>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct ExecResult {
    pub changes: usize,
}

pub struct Database {
    conn: Mutex<Connection>,
}

fn check_safe(value: i64) -> Result<i64, String> {
    if value.abs() > MAX_SAFE_INTEGER {
        return Err(format!(
            "integer {value} doesn't fit a JavaScript number exactly"
        ));
    }
    Ok(value)
}

fn to_sql(value: &Json) -> Result<Sql, String> {
    match value {
        Json::Null => Ok(Sql::Null),
        Json::String(text) => Ok(Sql::Text(text.clone())),
        Json::Number(number) => {
            if let Some(integer) = number.as_i64() {
                check_safe(integer).map(Sql::Integer)
            } else if number.is_f64() {
                number
                    .as_f64()
                    .map(Sql::Real)
                    .ok_or_else(|| "invalid number".to_string())
            } else {
                Err(format!(
                    "integer {number} doesn't fit a JavaScript number exactly"
                ))
            }
        }
        Json::Object(object) if object.len() == 1 => {
            let encoded = object
                .get(BLOB_KEY)
                .and_then(Json::as_str)
                .ok_or("unsupported parameter object")?;
            STANDARD
                .decode(encoded)
                .map(Sql::Blob)
                .map_err(|error| format!("invalid blob parameter: {error}"))
        }
        _ => Err("unsupported parameter type".into()),
    }
}

fn to_json(value: ValueRef<'_>) -> Result<Json, String> {
    match value {
        ValueRef::Null => Ok(Json::Null),
        ValueRef::Integer(integer) => check_safe(integer).map(Json::from),
        ValueRef::Real(real) => Number::from_f64(real)
            .map(Json::Number)
            .ok_or_else(|| "non-finite number in the database".to_string()),
        ValueRef::Text(bytes) => std::str::from_utf8(bytes)
            .map(Json::from)
            .map_err(|error| format!("invalid text in the database: {error}")),
        ValueRef::Blob(bytes) => Ok(json!({ BLOB_KEY: STANDARD.encode(bytes) })),
    }
}

fn bind(params: &[Json]) -> Result<Vec<Sql>, String> {
    params.iter().map(to_sql).collect()
}

fn text_error(error: rusqlite::Error) -> String {
    error.to_string()
}

fn run(conn: &Connection, sql: &str, params: &[Json]) -> Result<ExecResult, String> {
    let values = bind(params)?;
    let changes = conn
        .prepare(sql)
        .map_err(text_error)?
        .execute(params_from_iter(values))
        .map_err(text_error)?;
    Ok(ExecResult { changes })
}

impl Database {
    /// Opens the database, creating it and its folder if needed.
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let conn = Connection::open(path).map_err(text_error)?;
        Self::configure(&conn).map_err(text_error)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn configure(conn: &Connection) -> rusqlite::Result<()> {
        conn.busy_timeout(Duration::from_secs(5))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        // FULL syncs the log on every commit, so that a commit survives a power cut too. The cost
        // is small next to losing text, and M2 measures it with real typing.
        conn.pragma_update(None, "synchronous", "FULL")?;
        conn.pragma_update(None, "foreign_keys", true)?;
        conn.set_db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)?;
        conn.set_db_config(DbConfig::SQLITE_DBCONFIG_TRUSTED_SCHEMA, false)?;
        conn.set_limit(Limit::SQLITE_LIMIT_ATTACHED, 0)?;
        Ok(())
    }

    fn conn(&self) -> MutexGuard<'_, Connection> {
        // A panic elsewhere doesn't invalidate the connection: SQLite rolls back what was open.
        self.conn.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn query(&self, sql: &str, params: &[Json]) -> Result<Vec<Map<String, Json>>, String> {
        let values = bind(params)?;
        let conn = self.conn();
        let mut statement = conn.prepare(sql).map_err(text_error)?;
        let columns: Vec<String> = statement.column_names().map(str::to_string).collect();
        let mut rows = statement
            .query(params_from_iter(values))
            .map_err(text_error)?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(text_error)? {
            let mut object = Map::with_capacity(columns.len());
            for (index, column) in columns.iter().enumerate() {
                let value = row.get_ref(index).map_err(text_error)?;
                object.insert(column.clone(), to_json(value)?);
            }
            out.push(object);
        }
        Ok(out)
    }

    pub fn execute(&self, sql: &str, params: &[Json]) -> Result<ExecResult, String> {
        run(&self.conn(), sql, params)
    }

    /// Runs every statement or none. Dropping the transaction on an error rolls it back.
    pub fn transaction(&self, statements: &[Statement]) -> Result<Vec<ExecResult>, String> {
        let mut conn = self.conn();
        let transaction = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(text_error)?;
        let results = statements
            .iter()
            .map(|statement| run(&transaction, &statement.sql, &statement.params))
            .collect::<Result<Vec<_>, _>>()?;
        transaction.commit().map_err(text_error)?;
        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::{TempDir, tempdir};

    fn open() -> (TempDir, Database) {
        let dir = tempdir().unwrap();
        let db = Database::open(&dir.path().join("test.db")).unwrap();
        (dir, db)
    }

    fn table(db: &Database) {
        db.execute("CREATE TABLE t (x)", &[]).unwrap();
    }

    fn count(db: &Database) -> i64 {
        db.query("SELECT COUNT(*) AS n FROM t", &[]).unwrap()[0]["n"]
            .as_i64()
            .unwrap()
    }

    fn stmt(sql: &str) -> Statement {
        Statement {
            sql: sql.into(),
            params: vec![],
        }
    }

    #[test]
    fn creates_missing_folders() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("a").join("b").join("test.db");
        Database::open(&path).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn opens_with_the_durability_settings() {
        let (_dir, db) = open();
        let get = |pragma: &str| db.query(&format!("PRAGMA {pragma}"), &[]).unwrap();
        assert_eq!(get("journal_mode")[0]["journal_mode"], "wal");
        assert_eq!(get("synchronous")[0]["synchronous"], 2, "2 means FULL");
        assert_eq!(get("foreign_keys")[0]["foreign_keys"], 1);
    }

    #[test]
    fn round_trips_every_value_type() {
        let (_dir, db) = open();
        let row = db
            .query(
                "SELECT ? AS n, ? AS i, ? AS r, ? AS t, ? AS b",
                &[
                    Json::Null,
                    json!(42),
                    json!(1.5),
                    json!("ñandú 🖋️"),
                    json!({ "$blob": "AAEC/w==" }),
                ],
            )
            .unwrap()
            .remove(0);
        assert_eq!(row["n"], Json::Null);
        assert_eq!(row["i"], 42);
        assert_eq!(row["r"], 1.5);
        assert_eq!(row["t"], "ñandú 🖋️");
        assert_eq!(row["b"], json!({ "$blob": "AAEC/w==" }));
    }

    #[test]
    fn stores_blob_bytes_exactly() {
        // The same literal is checked on the TypeScript side of the wire format.
        let (_dir, db) = open();
        let row = db
            .query(
                "SELECT hex(?) AS h, length(?) AS l",
                &[
                    json!({ "$blob": "AAEC/w==" }),
                    json!({ "$blob": "AAEC/w==" }),
                ],
            )
            .unwrap()
            .remove(0);
        assert_eq!(row["h"], "000102FF");
        assert_eq!(row["l"], 4);
    }

    #[test]
    fn refuses_integers_a_javascript_number_would_corrupt() {
        let (_dir, db) = open();
        let too_big = MAX_SAFE_INTEGER + 1;
        assert!(db.query("SELECT ?", &[json!(too_big)]).is_err());
        assert!(db.query("SELECT ?", &[json!(u64::MAX)]).is_err());
        assert!(db.query(&format!("SELECT {too_big}"), &[]).is_err());
        assert!(db.query("SELECT ?", &[json!(MAX_SAFE_INTEGER)]).is_ok());
    }

    #[test]
    fn refuses_parameters_it_cant_represent() {
        let (_dir, db) = open();
        for bad in [
            json!(true),
            json!([1]),
            json!({ "other": "x" }),
            json!({ "$blob": 1 }),
            json!({ "$blob": "not base64!" }),
            json!({ "$blob": "AA==", "extra": 1 }),
        ] {
            let params = std::slice::from_ref(&bad);
            assert!(db.query("SELECT ?", params).is_err(), "{bad}");
        }
    }

    #[test]
    fn refuses_the_wrong_number_of_parameters() {
        let (_dir, db) = open();
        assert!(db.query("SELECT ?", &[]).is_err());
        assert!(db.query("SELECT 1", &[json!(1)]).is_err());
    }

    #[test]
    fn refuses_several_statements_in_one_call() {
        let (_dir, db) = open();
        table(&db);
        assert!(
            db.execute("INSERT INTO t VALUES (1); DROP TABLE t", &[])
                .is_err()
        );
        assert_eq!(count(&db), 0);
    }

    #[test]
    fn execute_reports_changes() {
        let (_dir, db) = open();
        table(&db);
        let result = db
            .execute("INSERT INTO t VALUES (?), (?)", &[json!(1), json!(2)])
            .unwrap();
        assert_eq!(result, ExecResult { changes: 2 });
    }

    #[test]
    fn query_with_returning_commits_the_write() {
        let (_dir, db) = open();
        table(&db);
        let rows = db
            .query("INSERT INTO t VALUES (?) RETURNING x", &[json!("a")])
            .unwrap();
        assert_eq!(rows[0]["x"], "a");
        assert_eq!(count(&db), 1);
    }

    #[test]
    fn transaction_commits_everything() {
        let (_dir, db) = open();
        table(&db);
        let results = db
            .transaction(&[
                stmt("INSERT INTO t VALUES (1)"),
                stmt("INSERT INTO t VALUES (2)"),
            ])
            .unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(count(&db), 2);
    }

    #[test]
    fn transaction_rolls_back_everything_on_failure() {
        let (_dir, db) = open();
        table(&db);
        let result = db.transaction(&[
            stmt("INSERT INTO t VALUES (1)"),
            stmt("CREATE TABLE half_done (x)"),
            stmt("THIS IS NOT SQL"),
        ]);
        assert!(result.is_err());
        assert_eq!(count(&db), 0);
        assert!(db.query("SELECT * FROM half_done", &[]).is_err());
    }

    #[test]
    fn stays_usable_after_a_failed_transaction() {
        let (_dir, db) = open();
        table(&db);
        let _ = db.transaction(&[stmt("BAD")]);
        db.transaction(&[stmt("INSERT INTO t VALUES (1)")]).unwrap();
        assert_eq!(count(&db), 1);
    }

    #[test]
    fn user_version_moves_with_the_transaction() {
        // The migration runner relies on this: the version and the schema commit together.
        let (_dir, db) = open();
        let version = || db.query("PRAGMA user_version", &[]).unwrap()[0]["user_version"].clone();
        let _ = db.transaction(&[stmt("PRAGMA user_version = 7"), stmt("BAD")]);
        assert_eq!(version(), 0);
        db.transaction(&[stmt("PRAGMA user_version = 7")]).unwrap();
        assert_eq!(version(), 7);
    }

    #[test]
    fn enforces_foreign_keys() {
        let (_dir, db) = open();
        db.execute("CREATE TABLE p (id TEXT PRIMARY KEY)", &[])
            .unwrap();
        db.execute("CREATE TABLE c (p TEXT REFERENCES p (id))", &[])
            .unwrap();
        assert!(db.execute("INSERT INTO c VALUES ('none')", &[]).is_err());
    }

    #[test]
    fn cant_reach_other_files() {
        let (dir, db) = open();
        let outside = dir.path().join("outside.db");
        let path = outside.to_string_lossy().replace('\'', "''");
        assert!(
            db.execute(&format!("ATTACH '{path}' AS other"), &[])
                .is_err()
        );
        assert!(db.execute(&format!("VACUUM INTO '{path}'"), &[]).is_err());
        assert!(
            !outside.exists(),
            "nothing was written outside the database"
        );
    }

    #[test]
    fn cant_load_extensions() {
        let (_dir, db) = open();
        assert!(db.query("SELECT load_extension('anything')", &[]).is_err());
    }

    #[test]
    fn cant_corrupt_the_schema_tables() {
        let (_dir, db) = open();
        table(&db);
        let _ = db.execute("PRAGMA writable_schema = ON", &[]);
        assert!(db.execute("DELETE FROM sqlite_master", &[]).is_err());
        assert_eq!(count(&db), 0, "the table is still there");
    }

    #[test]
    fn data_survives_reopening() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("test.db");
        {
            let db = Database::open(&path).unwrap();
            table(&db);
            db.execute("INSERT INTO t VALUES ('kept')", &[]).unwrap();
        }
        let db = Database::open(&path).unwrap();
        assert_eq!(db.query("SELECT x FROM t", &[]).unwrap()[0]["x"], "kept");
    }
}
