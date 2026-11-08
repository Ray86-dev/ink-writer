import type { SqlDriver } from "./driver";
import { MIGRATIONS } from "./migrations";

export interface Migration {
  /** Consecutive, starting at 1. Never edit one that has shipped: add a new one. */
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

export interface MigrationResult {
  readonly from: number;
  readonly to: number;
  readonly applied: readonly number[];
}

/**
 * The database was written by a newer version of the app. Running on it could damage data this
 * version doesn't understand, so nothing is touched.
 */
export class DatabaseTooNewError extends Error {
  override readonly name = "DatabaseTooNewError";

  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(`Database schema ${found} is newer than the ${supported} this version supports`);
  }
}

function assertConsecutive(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `Migration "${migration.name}" has version ${migration.version}, expected ${index + 1}`,
      );
    }
  });
}

async function currentVersion(driver: SqlDriver): Promise<number> {
  const [row] = await driver.query("PRAGMA user_version");
  const version = row?.user_version;
  if (typeof version !== "number") {
    throw new Error("Could not read the database schema version");
  }
  return version;
}

/**
 * Brings the database up to the latest schema. Each migration and its version bump commit together,
 * so a crash leaves the database at the last complete version, and the next start resumes from it.
 */
export async function migrate(
  driver: SqlDriver,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<MigrationResult> {
  assertConsecutive(migrations);
  const from = await currentVersion(driver);
  const latest = migrations.length;
  if (from > latest) {
    throw new DatabaseTooNewError(from, latest);
  }

  const applied: number[] = [];
  for (const migration of migrations.slice(from)) {
    await driver.transaction([
      ...migration.statements.map((sql) => ({ sql })),
      // A pragma can't take a bound parameter. `version` was checked to be an integer above.
      { sql: `PRAGMA user_version = ${migration.version}` },
    ]);
    applied.push(migration.version);
  }
  return { from, to: latest, applied };
}
