import type { SqlDriver, SqlResult, SqlRow, SqlStatement, SqlValue } from "@ink-writer/core";

/** `invoke` from `@tauri-apps/api/core`. Passed in so that the mapping can be tested on its own. */
export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

const BLOB_KEY = "$blob";

/** Built in chunks, because spreading a large array into one call overflows the stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let start = 0; start < bytes.length; start += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(encoded: string): Uint8Array {
  return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
}

/**
 * JSON turns NaN and Infinity into null, which would store the wrong value without any error, and
 * the shell can't tell an unsafe integer from the one that was meant.
 */
function encodeValue(value: SqlValue): unknown {
  if (value instanceof Uint8Array) {
    return { [BLOB_KEY]: bytesToBase64(value) };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError(`Can't store ${value}`);
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new RangeError(`Integer ${value} isn't exact in JavaScript`);
    }
  }
  return value;
}

function decodeValue(value: unknown): SqlValue {
  if (value === null || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && BLOB_KEY in value && typeof value[BLOB_KEY] === "string") {
    return base64ToBytes(value[BLOB_KEY]);
  }
  throw new TypeError("Unexpected value from the database");
}

function decodeRow(row: Record<string, unknown>): SqlRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, decodeValue(value)]));
}

const encodeParams = (params: readonly SqlValue[] = []) => params.map(encodeValue);

export function createTauriDriver(invoke: Invoke): SqlDriver {
  return {
    async query(sql, params) {
      const rows = await invoke("db_query", { sql, params: encodeParams(params) });
      return (rows as Record<string, unknown>[]).map(decodeRow);
    },
    async execute(sql, params) {
      return (await invoke("db_execute", { sql, params: encodeParams(params) })) as SqlResult;
    },
    async transaction(statements: readonly SqlStatement[]) {
      const encoded = statements.map(({ sql, params }) => ({ sql, params: encodeParams(params) }));
      return (await invoke("db_transaction", { statements: encoded })) as SqlResult[];
    },
  };
}
