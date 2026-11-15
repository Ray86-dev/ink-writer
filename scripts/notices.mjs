// Writes THIRD-PARTY-NOTICES.md: what ships inside the app, under which licence, and where its
// source is. Some licences (MPL-2.0, OFL-1.1) ask for exactly that when binaries are distributed.
// `--check` fails if the file isn't up to date, so that CI catches a dependency added without it.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cargoPackages, npmPackages } from "./license-policy.mjs";

const root = join(import.meta.dirname, "..");
const target = join(root, "THIRD-PARTY-NOTICES.md");

const lockfile = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const metadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--format-version",
      "1",
      "--locked",
      "--manifest-path",
      join(root, "apps/desktop/src-tauri/Cargo.toml"),
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  ),
);

// Only what reaches the installed app: tools that run at build or test time don't ship.
const shipped = new Set(
  Object.entries(lockfile.packages)
    .filter(([path, entry]) => path.includes("node_modules/") && entry.dev !== true)
    .map(([path]) => path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length)),
);
const unique = (packages) => [
  ...new Map(packages.map((pkg) => [`${pkg.name}@${pkg.version}`, pkg])).values(),
];
const byName = (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version);

const npm = unique(npmPackages(lockfile).filter((pkg) => shipped.has(pkg.name))).sort(byName);
const cargo = unique(cargoPackages(metadata)).sort(byName);

const row = (pkg, link) => `| ${pkg.name} | ${pkg.version} | ${pkg.license ?? "?"} | <${link}> |`;
const table = (packages, link) =>
  ["| Paquete | Versión | Licencia | Código fuente |", "|---|---|---|---|"]
    .concat(packages.map((pkg) => row(pkg, link(pkg))))
    .join("\n");

const text = `# Avisos de terceros

Ink Writer incluye el trabajo de otras personas. Esta lista dice qué va dentro de la app instalada, con qué licencia y dónde está su código fuente. La genera \`npm run notices\`: no la edites a mano.

Ink Writer no modifica ninguno de estos paquetes. Los que tienen licencia MPL-2.0 se usan tal cual, y su código está en el enlace de cada uno. Las tipografías Literata e Instrument Sans tienen licencia SIL Open Font License 1.1.

## Página (npm)

${table(npm, (pkg) => `https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`)}

## Shell (Rust)

${table(cargo, (pkg) => `https://crates.io/crates/${pkg.name}/${pkg.version}`)}
`;

if (process.argv.includes("--check")) {
  const current = (() => {
    try {
      return readFileSync(target, "utf8").replaceAll("\r\n", "\n");
    } catch {
      return null;
    }
  })();
  if (current !== text) {
    console.error("THIRD-PARTY-NOTICES.md is out of date. Run `npm run notices` and commit it.");
    process.exit(1);
  }
  console.log(`THIRD-PARTY-NOTICES.md is up to date: ${npm.length} npm, ${cargo.length} Rust`);
} else {
  writeFileSync(target, text);
  console.log(`Wrote ${npm.length} npm and ${cargo.length} Rust packages`);
}
