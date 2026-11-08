import { describe, expect, it } from "vitest";
import { cargoPackages, checkPackage, isPermissive, npmPackages } from "./license-policy.mjs";

describe("isPermissive", () => {
  it.each([
    "MIT",
    "MIT OR Apache-2.0",
    "Apache-2.0 OR MIT",
    "MIT/Apache-2.0",
    "Apache-2.0 / MIT",
    "(MIT OR Apache-2.0) AND Unicode-3.0",
    "Apache-2.0 AND ISC",
    "Apache-2.0 WITH LLVM-exception",
    "Apache-2.0 WITH LLVM-exception OR MIT",
    "GPL-3.0 OR MIT",
    "MIT OR LGPL-2.1-or-later",
  ])("accepts %s", (expression) => {
    expect(isPermissive(expression)).toBe(true);
  });

  it.each([
    "GPL-3.0",
    "LGPL-2.1-or-later",
    "MPL-2.0",
    "AGPL-3.0",
    "MIT AND GPL-3.0",
    "(MIT OR GPL-3.0) AND LGPL-3.0",
    "Apache-2.0 WITH Some-unknown-exception",
    "Sign-in-with-ChatGPT-DevKit-Noncommercial-1.0",
    "UNLICENSED",
    "SEE LICENSE IN LICENSE.txt",
    "",
  ])("refuses %s", (expression) => {
    expect(isPermissive(expression)).toBe(false);
  });

  it("gives AND priority over OR", () => {
    expect(isPermissive("MIT OR GPL-3.0 AND LGPL-3.0")).toBe(true);
    expect(isPermissive("GPL-3.0 AND MIT OR LGPL-3.0")).toBe(false);
  });

  it.each(["MIT OR", "(MIT", "MIT)", "AND MIT", "MIT MIT"])(
    "refuses the malformed expression %s",
    (expression) => {
      expect(isPermissive(expression)).toBe(false);
    },
  );

  it.each([undefined, null, 42])("refuses a missing licence: %s", (expression) => {
    expect(isPermissive(expression)).toBe(false);
  });
});

describe("checkPackage", () => {
  it("allows a listed exception only under its listed licence", () => {
    expect(checkPackage({ name: "option-ext", license: "MPL-2.0" })).toBe(true);
    expect(checkPackage({ name: "option-ext", license: "GPL-3.0" })).toBe(false);
  });

  it("doesn't extend an exception to other packages", () => {
    expect(checkPackage({ name: "something-new", license: "MPL-2.0" })).toBe(false);
    expect(checkPackage({ name: "lightningcss2", license: "MPL-2.0" })).toBe(false);
  });

  it("covers the platform packages of an excepted tool, under the same licence only", () => {
    expect(checkPackage({ name: "lightningcss", license: "MPL-2.0" })).toBe(true);
    expect(checkPackage({ name: "lightningcss-linux-x64-gnu", license: "MPL-2.0" })).toBe(true);
    expect(checkPackage({ name: "lightningcss-linux-x64-gnu", license: "GPL-3.0" })).toBe(false);
  });
});

describe("npmPackages", () => {
  it("lists installed packages, nested ones too, without the workspace itself", () => {
    const lockfile = {
      packages: {
        "": { name: "root", license: "MIT" },
        "packages/core": { name: "@ink-writer/core", license: "MIT" },
        "node_modules/@ink-writer/core": { resolved: "packages/core", link: true },
        "node_modules/a": { version: "1.0.0", license: "MIT" },
        "node_modules/a/node_modules/@scope/b": { version: "2.0.0", license: "ISC" },
        "node_modules/missing": { version: "3.0.0" },
      },
    };

    expect(npmPackages(lockfile)).toEqual([
      { name: "a", version: "1.0.0", license: "MIT" },
      { name: "@scope/b", version: "2.0.0", license: "ISC" },
      { name: "missing", version: "3.0.0", license: undefined },
    ]);
  });
});

describe("cargoPackages", () => {
  it("lists what was resolved, without the app or inactive packages", () => {
    const metadata = {
      workspace_members: ["app"],
      resolve: { nodes: [{ id: "app" }, { id: "dep" }] },
      packages: [
        { id: "app", name: "app", version: "0.0.0", license: "MIT" },
        { id: "dep", name: "dep", version: "1.0.0", license: "Apache-2.0" },
        { id: "unused", name: "unused", version: "1.0.0", license: "GPL-3.0" },
      ],
    };

    expect(cargoPackages(metadata)).toEqual([
      { name: "dep", version: "1.0.0", license: "Apache-2.0" },
    ]);
  });
});
