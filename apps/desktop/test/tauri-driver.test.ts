import { describe, expect, it, vi } from "vitest";
import { base64ToBytes, bytesToBase64, createTauriDriver, type Invoke } from "../src/tauri-driver";

const driverReturning = (value: unknown) => {
  const invoke = vi.fn<Invoke>(async () => value);
  return { invoke, driver: createTauriDriver(invoke) };
};

describe("base64", () => {
  it("matches the wire format the Rust side is tested against", () => {
    expect(bytesToBase64(new Uint8Array([0, 1, 2, 255]))).toBe("AAEC/w==");
    expect([...base64ToBytes("AAEC/w==")]).toEqual([0, 1, 2, 255]);
  });

  it("round-trips every byte value", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });

  it("handles a blob too large to spread into one call", () => {
    const bytes = new Uint8Array(1024 * 1024).fill(7);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("handles an empty blob", () => {
    expect(bytesToBase64(new Uint8Array())).toBe("");
    expect(base64ToBytes("")).toEqual(new Uint8Array());
  });
});

describe("Tauri driver", () => {
  it("sends parameters, encoding blobs and defaulting to none", async () => {
    const { invoke, driver } = driverReturning([]);

    await driver.query("SELECT ?, ?, ?, ?", [null, 1.5, "ñ", new Uint8Array([255])]);
    await driver.query("SELECT 1");

    expect(invoke).toHaveBeenNthCalledWith(1, "db_query", {
      sql: "SELECT ?, ?, ?, ?",
      params: [null, 1.5, "ñ", { $blob: "/w==" }],
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "db_query", { sql: "SELECT 1", params: [] });
  });

  it("decodes blobs in rows and leaves everything else alone", async () => {
    const { driver } = driverReturning([{ n: null, i: 1, t: "ñ", b: { $blob: "AAEC/w==" } }]);

    const [row] = await driver.query("SELECT");

    expect(row).toEqual({ n: null, i: 1, t: "ñ", b: new Uint8Array([0, 1, 2, 255]) });
  });

  it("refuses a value it can't recognize instead of passing it on", async () => {
    const { driver } = driverReturning([{ x: { something: "else" } }]);

    await expect(driver.query("SELECT")).rejects.toThrow(/Unexpected value/);
  });

  it("sends a transaction as one batch", async () => {
    const { invoke, driver } = driverReturning([{ changes: 1 }, { changes: 0 }]);

    const results = await driver.transaction([
      { sql: "A", params: [new Uint8Array([255])] },
      { sql: "B" },
    ]);

    expect(results).toEqual([{ changes: 1 }, { changes: 0 }]);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("db_transaction", {
      statements: [
        { sql: "A", params: [{ $blob: "/w==" }] },
        { sql: "B", params: [] },
      ],
    });
  });

  it("returns what an execute reports", async () => {
    const { driver } = driverReturning({ changes: 3 });

    await expect(driver.execute("UPDATE")).resolves.toEqual({ changes: 3 });
  });

  it.each([NaN, Infinity, -Infinity, 2 ** 53])(
    "refuses %d, which JSON or JavaScript would change silently",
    async (value) => {
      const { invoke, driver } = driverReturning([]);

      await expect(driver.query("SELECT ?", [value])).rejects.toBeInstanceOf(RangeError);
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("passes on an error from the shell", async () => {
    const invoke: Invoke = async () => {
      throw "database is locked";
    };

    await expect(createTauriDriver(invoke).execute("X")).rejects.toBe("database is locked");
  });
});
