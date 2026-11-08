import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = join(import.meta.dirname, "..", "src");

/** Pure JavaScript, usable in a browser and in the desktop WebView alike. */
const PORTABLE_LIBRARIES = new Set(["diff", "fflate", "yjs"]);

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

  it.each(sourceFiles)("$file imports only its own modules and portable libraries", ({ code }) => {
    const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");
    const external = imports.filter((path) => !path.startsWith("."));

    expect(external.filter((path) => !PORTABLE_LIBRARIES.has(path))).toEqual([]);
  });

  it.each(sourceFiles)("$file doesn't touch the page", ({ code }) => {
    // `document` as an API call: the word also appears in comments and in "word/document.xml".
    expect(code).not.toMatch(/\b(window|localStorage|navigator)\s*[.[]|\bdocument\.\w+\(/);
  });

  // The test configuration loads Node's types, so the compiler wouldn't catch these.
  it.each(sourceFiles)("$file doesn't use Node's globals", ({ code }) => {
    expect(code).not.toMatch(/\b(process|Buffer|__dirname|require)\s*[.[(]/);
  });
});
