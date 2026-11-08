// Starts the built app in smoke mode and passes on its result. Run `npm run build:debug` first.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const TIMEOUT_MS = 180_000;

const name = process.platform === "win32" ? "ink-writer.exe" : "ink-writer";
const binary = join(import.meta.dirname, "..", "apps/desktop/src-tauri/target/debug", name);

if (!existsSync(binary)) {
  console.error(`No build at ${binary}. Run: npm run build:debug`);
  process.exit(1);
}

const child = spawn(binary, ["--smoke-test"], { stdio: "inherit" });

const timer = setTimeout(() => {
  console.error(`The app didn't finish within ${TIMEOUT_MS / 1000} s`);
  child.kill();
  process.exit(1);
}, TIMEOUT_MS);

child.on("error", (error) => {
  clearTimeout(timer);
  console.error(`The app couldn't start: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  if (code !== 0) {
    console.error(`The app exited with ${code ?? signal}`);
  }
  process.exit(code ?? 1);
});
