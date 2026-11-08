import type { SqlDriver } from "@ink-writer/core";
import { describe, expect, it } from "vitest";
import { createNodeSqliteDriver } from "../../../packages/core/test/support/node-sqlite-driver";
import { runSmokeChecks } from "../src/smoke";

describe("smoke checks", () => {
  it("pass on a healthy driver, on the first start and on a later one", async () => {
    const driver = createNodeSqliteDriver();

    await expect(runSmokeChecks(driver)).resolves.toMatch(/^schema \d+/);
    await expect(runSmokeChecks(driver)).resolves.toMatch(/^schema \d+/);
    driver.close();
  });

  it("catch a driver that corrupts blobs", async () => {
    const real = createNodeSqliteDriver();
    const corrupting: SqlDriver = {
      ...real,
      query: async (sql, params) => {
        const rows = await real.query(sql, params);
        return sql.startsWith("SELECT ? AS value") ? [{ value: new Uint8Array(256) }] : rows;
      },
    };

    await expect(runSmokeChecks(corrupting)).rejects.toThrow(/blob/);
    real.close();
  });

  it("catch a driver whose transactions aren't atomic", async () => {
    const real = createNodeSqliteDriver();
    const notAtomic: SqlDriver = {
      ...real,
      transaction: async (statements) => {
        const results = [];
        for (const { sql, params } of statements) {
          results.push(await real.execute(sql, params));
        }
        return results;
      },
    };

    await expect(runSmokeChecks(notAtomic)).rejects.toThrow(/left data behind/);
    real.close();
  });
});
