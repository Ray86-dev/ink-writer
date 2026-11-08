import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = join(import.meta.dirname, "..", "src");

const sourceFiles = readdirSync(SOURCE, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".ts"))
  .map((file) => ({ file, code: readFileSync(join(SOURCE, file), "utf8") }));

/**
 * The core is shared with the future browser version (SPEC §8), so it can't depend on the desktop
 * shell, on Node, or on a page being there.
 */
describe("the core stays portable", () => {
  it("finds the source files", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it.each(sourceFiles)("$file imports only relative modules", ({ code }) => {
    const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

    expect(imports.filter((path) => !path.startsWith("."))).toEqual([]);
  });

  it.each(sourceFiles)("$file doesn't touch the page", ({ code }) => {
    expect(code).not.toMatch(/\b(window|document|localStorage)\s*[.[]/);
  });

  // The test configuration loads Node's types, so the compiler wouldn't catch these.
  it.each(sourceFiles)("$file doesn't use Node's globals", ({ code }) => {
    expect(code).not.toMatch(/\b(process|Buffer|__dirname|require)\s*[.[(]/);
  });
});
