// Fails if any npm or Rust dependency, on any platform, isn't compatible with MIT (rule 8).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cargoPackages,
  checkPackage,
  isException,
  isPermissive,
  npmPackages,
} from "./license-policy.mjs";

const root = join(import.meta.dirname, "..");

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

const packages = [
  ...npmPackages(lockfile).map((pkg) => ({ ...pkg, source: "npm" })),
  ...cargoPackages(metadata).map((pkg) => ({ ...pkg, source: "cargo" })),
];
const refused = packages.filter((pkg) => !checkPackage(pkg));
const excepted = packages.filter((pkg) => !isPermissive(pkg.license) && isException(pkg));

console.log(`${packages.length} packages checked, ${excepted.length} listed exceptions:`);
for (const pkg of excepted) {
  console.log(`  [${pkg.source}] ${pkg.name}: ${pkg.license}`);
}

if (refused.length > 0) {
  console.error("\nNot compatible with MIT, or with no declared licence:");
  for (const pkg of refused) {
    console.error(`  [${pkg.source}] ${pkg.name}@${pkg.version}: ${pkg.license ?? "none"}`);
  }
  process.exit(1);
}
