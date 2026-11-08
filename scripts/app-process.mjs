// Runs the built app in a test mode, line by line. Shared by the scripts that test the whole app.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const name = process.platform === "win32" ? "ink-writer.exe" : "ink-writer";
const binary = join(import.meta.dirname, "..", "apps/desktop/src-tauri/target/debug", name);

export function assertBuilt() {
  if (!existsSync(binary)) {
    console.error(`No build at ${binary}. Use the npm script, which builds it first.`);
    process.exit(1);
  }
}

/**
 * Starts the app. `onLine` sees each line it prints. The returned `done` resolves with its exit code
 * and `kill` ends it at once, with no chance to clean up, as a crash or a forced close would.
 */
export function startApp(args, onLine = () => {}) {
  const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
  createInterface({ input: child.stdout }).on("line", onLine);
  const errors = [];
  createInterface({ input: child.stderr }).on("line", (line) => errors.push(line));
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, errors }));
  });
  return { done, kill: () => child.kill("SIGKILL") };
}
