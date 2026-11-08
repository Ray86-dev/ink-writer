/**
 * The narrowest contract the core needs from SQLite. The desktop shell implements it over Tauri
 * commands; a browser build can implement it over a WebAssembly SQLite without touching the core.
 */
export type SqlValue = null | number | string | Uint8Array;

export type SqlRow = Readonly<Record<string, SqlValue>>;

export interface SqlStatement {
  readonly sql: string;
  readonly params?: readonly SqlValue[];
}

export interface SqlResult {
  readonly changes: number;
}

export interface SqlDriver {
  /** Runs one statement and returns its rows. Also for writes with `RETURNING`. */
  query(sql: string, params?: readonly SqlValue[]): Promise<SqlRow[]>;

  /** Runs one statement that returns no rows. */
  execute(sql: string, params?: readonly SqlValue[]): Promise<SqlResult>;

  /**
   * Runs every statement or none of them. It takes the whole batch at once rather than offering
   * begin and commit, so that a crash in the WebView can't leave a transaction open, and concurrent
   * callers can't end up inside each other's transactions.
   */
  transaction(statements: readonly SqlStatement[]): Promise<SqlResult[]>;
}
