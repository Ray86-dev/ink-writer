import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SqlDriver, SqlRow, SqlValue } from "../../src/storage/driver";

/**
 * A real SQLite behind the core's driver contract, so the core's SQL is exercised for real in tests.
 * The desktop shell's implementation is checked by its own tests and by the smoke test.
 */
export function createNodeSqliteDriver(path = ":memory:"): SqlDriver & { close(): void } {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");

  const toRow = (row: Record<string, unknown>): SqlRow => row as SqlRow;
  const bind = (params: readonly SqlValue[]) => params as SQLInputValue[];

  return {
    async query(sql, params = []) {
      return db
        .prepare(sql)
        .all(...bind(params))
        .map((row) => toRow(row as Record<string, unknown>));
    },
    async execute(sql, params = []) {
      return { changes: Number(db.prepare(sql).run(...bind(params)).changes) };
    },
    async transaction(statements) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map(({ sql, params = [] }) => ({
          changes: Number(db.prepare(sql).run(...bind(params)).changes),
        }));
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
}
