import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseTooNewError, MIGRATIONS, type Migration, migrate } from "../src/index";
import { createNodeSqliteDriver } from "./support/node-sqlite-driver";

const version = async (driver: ReturnType<typeof createNodeSqliteDriver>) =>
  (await driver.query("PRAGMA user_version"))[0]?.user_version;

const tableNames = async (driver: ReturnType<typeof createNodeSqliteDriver>) =>
  (await driver.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map(
    (row) => row.name,
  );

describe("migrate", () => {
  let driver = createNodeSqliteDriver();

  afterEach(() => {
    driver.close();
    driver = createNodeSqliteDriver();
  });

  it("brings an empty database to the latest schema", async () => {
    const result = await migrate(driver);

    expect(result).toEqual({
      from: 0,
      to: MIGRATIONS.length,
      applied: MIGRATIONS.map((m) => m.version),
    });
    expect(await version(driver)).toBe(MIGRATIONS.length);
    expect(await tableNames(driver)).toEqual([
      "chapters",
      "projects",
      "scene_snapshots",
      "scene_updates",
      "scenes",
      "sqlite_sequence",
    ]);
  });

  it("does nothing when already up to date", async () => {
    await migrate(driver);
    const again = await migrate(driver);

    expect(again.applied).toEqual([]);
    expect(again.from).toBe(MIGRATIONS.length);
  });

  it("applies only what is pending, and keeps existing data", async () => {
    const first: Migration = {
      version: 1,
      name: "a",
      statements: ["CREATE TABLE a (x TEXT)"],
    };
    await migrate(driver, [first]);
    await driver.execute("INSERT INTO a VALUES ('kept')");

    const result = await migrate(driver, [
      first,
      { version: 2, name: "b", statements: ["ALTER TABLE a ADD COLUMN y TEXT"] },
    ]);

    expect(result).toEqual({ from: 1, to: 2, applied: [2] });
    expect(await driver.query("SELECT x, y FROM a")).toEqual([{ x: "kept", y: null }]);
  });

  it("leaves a failed migration completely undone, and earlier ones in place", async () => {
    const good: Migration = { version: 1, name: "good", statements: ["CREATE TABLE good (x)"] };
    const bad: Migration = {
      version: 2,
      name: "bad",
      statements: ["CREATE TABLE half_done (x)", "THIS IS NOT SQL"],
    };

    await expect(migrate(driver, [good, bad])).rejects.toThrow();

    expect(await version(driver)).toBe(1);
    expect(await tableNames(driver)).toEqual(["good"]);
  });

  it("retries a failed migration on the next start", async () => {
    const statements = ["CREATE TABLE t (x)", "INSERT INTO missing VALUES (1)"];
    await expect(migrate(driver, [{ version: 1, name: "m", statements }])).rejects.toThrow();

    const fixed: Migration = { version: 1, name: "m", statements: ["CREATE TABLE t (x)"] };
    const result = await migrate(driver, [fixed]);

    expect(result.applied).toEqual([1]);
  });

  it("refuses a database from a newer version, and doesn't touch it", async () => {
    await driver.execute("CREATE TABLE from_the_future (x)");
    await driver.execute(`PRAGMA user_version = ${MIGRATIONS.length + 5}`);

    const error = await migrate(driver).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DatabaseTooNewError);
    expect(error).toMatchObject({ found: MIGRATIONS.length + 5, supported: MIGRATIONS.length });
    expect(await version(driver)).toBe(MIGRATIONS.length + 5);
    expect(await tableNames(driver)).toEqual(["from_the_future"]);
  });

  it("rejects a list of migrations with gaps or duplicates", async () => {
    const m = (v: number): Migration => ({ version: v, name: `m${v}`, statements: [] });

    await expect(migrate(driver, [m(2)])).rejects.toThrow(/expected 1/);
    await expect(migrate(driver, [m(1), m(1)])).rejects.toThrow(/expected 2/);
    await expect(migrate(driver, [m(1), m(3)])).rejects.toThrow(/expected 2/);
    expect(await version(driver)).toBe(0);
  });

  it("the shipped migrations have consecutive versions", () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
  });
});

describe("migrate on a file", () => {
  it("keeps the schema across reopening", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ink-migrate-"));
    const path = join(dir, "test.db");
    try {
      const first = createNodeSqliteDriver(path);
      await migrate(first);
      first.close();

      const second = createNodeSqliteDriver(path);
      const result = await migrate(second);
      second.close();

      expect(result.applied).toEqual([]);
      expect(result.from).toBe(MIGRATIONS.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
