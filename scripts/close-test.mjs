// The close button, on the real app: it must really close, and save what was just typed first.
// `npm run close-test` builds it first.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { assertBuilt, startApp } from "./app-process.mjs";

const CLOSE_TIMEOUT_MS = 120_000;

assertBuilt();
const dir = mkdtempSync(join(tmpdir(), "ink-writer-close-"));
const shared = [`--test-dir=${dir}`];

function finish(message) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  console.error(message);
  process.exit(1);
}

const app = startApp(["--test-mode=close", "--test-timeout=110", ...shared], (line) =>
  console.log(line),
);
const closed = await Promise.race([app.done, sleep(CLOSE_TIMEOUT_MS).then(() => null)]);
if (closed === null) {
  app.kill();
  finish("The window didn't close");
}
if (closed.code !== 0) {
  finish(`The app ended with ${closed.code} instead of closing:\n${closed.errors.join("\n")}`);
}

const verifier = startApp(["--test-mode=close-verify", ...shared], (line) => console.log(line));
const { code, errors } = await verifier.done;
if (code !== 0) {
  finish(`Close test FAILED with exit ${code}\n${errors.join("\n")}`);
}

rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log("Close test passed");
process.exit(0);
