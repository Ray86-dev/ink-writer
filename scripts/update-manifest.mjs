// Writes `latest.json`, which an installed app reads to learn of a newer version, from the
// installers of a release and their signatures. Run by the release workflow: see docs/publicar.md.
import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Which installer updates which system. The names are the updater's, and each system has one
 * installer that it can install by itself.
 */
const PLATFORMS = [
  { key: "windows-x86_64", ends: "-setup.exe" },
  { key: "linux-x86_64", ends: ".AppImage" },
  { key: "darwin-aarch64", ends: ".app.tar.gz" },
];

/** GitHub turns the spaces of a file's name into dots, so the name is settled before uploading. */
export function assetName(name, version) {
  const plain = name.replaceAll(" ", ".");
  // The macOS archive carries neither version nor architecture in its name.
  // Its signature, next to it, takes the same name.
  return plain.includes(".app.tar.gz") && !plain.includes(version)
    ? plain.replace(".app.tar.gz", `_${version}_aarch64.app.tar.gz`)
    : plain;
}

/**
 * `files` are the names in the release, as `assetName` leaves them, and `signatures` maps each
 * signed one to its signature. Only an installer with a signature is announced: an installed app
 * refuses any other. Null if there's none at all.
 */
export function buildManifest({ version, notes, date, repository, tag, files, signatures }) {
  const platforms = {};
  for (const { key, ends } of PLATFORMS) {
    const file = files.find((name) => name.endsWith(ends) && signatures[name] !== undefined);
    if (file !== undefined) {
      platforms[key] = {
        signature: signatures[file],
        url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(file)}`,
      };
    }
  }
  if (Object.keys(platforms).length === 0) {
    return null;
  }
  return { version, notes, pub_date: date, platforms };
}

function main([directory, tag, repository]) {
  if (directory === undefined || tag === undefined || repository === undefined) {
    console.error("Usage: update-manifest.mjs <directory> <tag> <owner/repository>");
    process.exit(2);
  }
  const version = tag.replace(/^v/, "");
  for (const name of readdirSync(directory)) {
    const renamed = assetName(name, version);
    if (renamed !== name) {
      renameSync(join(directory, name), join(directory, renamed));
    }
  }
  const all = readdirSync(directory);
  const signatures = Object.fromEntries(
    all
      .filter((name) => name.endsWith(".sig"))
      .map((name) => [name.slice(0, -4), readFileSync(join(directory, name), "utf8").trim()]),
  );
  const manifest = buildManifest({
    version,
    notes: `Ink Writer ${version}`,
    date: new Date().toISOString(),
    repository,
    tag,
    files: all.filter((name) => !name.endsWith(".sig")),
    signatures,
  });
  if (manifest === null) {
    console.log("No signed installer: no latest.json. Installed apps won't see this version.");
    return;
  }
  writeFileSync(join(directory, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`latest.json announces ${version} for ${Object.keys(manifest.platforms).join(", ")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2));
}
