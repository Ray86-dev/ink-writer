// A second copy of the app must hand over to the first and leave. `npm run instance-test` builds it.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { assertBuilt, startApp } from "./app-process.mjs";

const STARTUP_TIMEOUT_MS = 90_000;
const SECOND_COPY_TIMEOUT_MS = 30_000;

assertBuilt();
const dir = mkdtempSync(join(tmpdir(), "ink-writer-instance-"));
const args = ["--test-mode=single-instance", "--test-timeout=300", `--test-dir=${dir}`];

let firstExited = false;
const first = await new Promise((resolve) => {
  const app = startApp(args, (line) => {
    if (line === "READY") {
      resolve(app);
    }
  });
  app.done.then(({ code, errors }) => {
    firstExited = true;
    resolve(null);
    if (code !== null && code !== 0) {
      console.error(`The first copy exited with ${code}\n${errors.join("\n")}`);
    }
  });
  setTimeout(() => resolve(null), STARTUP_TIMEOUT_MS);
});

let failed = first === null;

if (first !== null) {
  const second = startApp(args);
  const outcome = await Promise.race([
    second.done.then(({ code }) => ({ code })),
    sleep(SECOND_COPY_TIMEOUT_MS).then(() => null),
  ]);
  if (outcome === null) {
    console.error("The second copy didn't leave: two copies are running");
    second.kill();
    await second.done;
    failed = true;
  } else {
    console.log(`The second copy left by itself, with code ${outcome.code}`);
  }
  await sleep(1000);
  if (firstExited) {
    console.error("The first copy closed too: it should have stayed open");
    failed = true;
  }
  first.kill();
  await first.done;
}

rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
if (failed) {
  console.error("Single instance test FAILED");
  process.exit(1);
}
console.log("Single instance test passed");
process.exit(0);
