/**
 * Rule 8: only dependencies compatible with MIT. Pure logic, so it can be tested without a lockfile.
 */

export const PERMISSIVE = new Set([
  "0BSD",
  "Apache-2.0",
  "Apache-2.0 WITH LLVM-exception",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSL-1.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT-0",
  "Unicode-3.0",
  "Unicode-DFS-2016",
  "Unlicense",
  "Zlib",
]);

/**
 * Not permissive, but compatible when used unmodified. Listed by name so that a new dependency under
 * these terms stops CI until someone looks at it. See docs/adr/0009-andamiaje.md.
 */
export const EXCEPTIONS = new Map([
  ["selectors", "MPL-2.0"],
  ["cssparser", "MPL-2.0"],
  ["cssparser-macros", "MPL-2.0"],
  ["dtoa-short", "MPL-2.0"],
  ["option-ext", "MPL-2.0"],
  // Vite's CSS tool. Runs at build time only, and none of it reaches the app.
  ["lightningcss", "MPL-2.0"],
]);

/** One native package per platform, all from `lightningcss` above. */
const LIGHTNINGCSS_PLATFORM = /^lightningcss-[a-z0-9-]+$/;

export function isException({ name, license }) {
  if (LIGHTNINGCSS_PLATFORM.test(name)) {
    return license === "MPL-2.0";
  }
  return EXCEPTIONS.has(name) && EXCEPTIONS.get(name) === license;
}

function tokenize(expression) {
  return expression
    .replaceAll("/", " OR ")
    .replaceAll("(", " ( ")
    .replaceAll(")", " ) ")
    .trim()
    .split(/\s+/)
    .filter((token) => token !== "");
}

/**
 * Evaluates an SPDX expression. OR needs one acceptable side, AND needs both, and AND binds tighter.
 * Anything it can't parse counts as not allowed.
 */
export function isPermissive(expression) {
  if (typeof expression !== "string") {
    return false;
  }
  const tokens = tokenize(expression);
  let position = 0;

  const parseOr = () => {
    let value = parseAnd();
    while (tokens[position] === "OR") {
      position += 1;
      const right = parseAnd();
      value = value || right;
    }
    return value;
  };

  const parseAnd = () => {
    let value = parseAtom();
    while (tokens[position] === "AND") {
      position += 1;
      const right = parseAtom();
      value = value && right;
    }
    return value;
  };

  const parseAtom = () => {
    const token = tokens[position];
    position += 1;
    if (token === "(") {
      const value = parseOr();
      if (tokens[position] !== ")") {
        throw new Error("Unbalanced parentheses");
      }
      position += 1;
      return value;
    }
    if (token === undefined || token === ")" || token === "OR" || token === "AND") {
      throw new Error("Unexpected token");
    }
    if (tokens[position] === "WITH") {
      const exception = tokens[position + 1];
      position += 2;
      return PERMISSIVE.has(`${token} WITH ${exception}`);
    }
    return PERMISSIVE.has(token);
  };

  try {
    const value = parseOr();
    return position === tokens.length && value;
  } catch {
    return false;
  }
}

export function checkPackage(pkg) {
  return isPermissive(pkg.license) || isException(pkg);
}

/** What's actually installed from npm, read from the lockfile so it covers every platform. */
export function npmPackages(lockfile) {
  return Object.entries(lockfile.packages)
    .filter(([path]) => path.includes("node_modules/"))
    .filter(([, entry]) => !entry.link)
    .map(([path, entry]) => ({
      name: path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length),
      version: entry.version,
      license: entry.license,
    }));
}

/** Everything Cargo resolved, for every target, without the app itself. */
export function cargoPackages(metadata) {
  const active = new Set(metadata.resolve.nodes.map((node) => node.id));
  return metadata.packages
    .filter((pkg) => active.has(pkg.id) && !metadata.workspace_members.includes(pkg.id))
    .map((pkg) => ({ name: pkg.name, version: pkg.version, license: pkg.license }));
}
