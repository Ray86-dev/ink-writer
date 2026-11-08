// "Fluent typing with 150,000 words" on the real app. `npm run perf-test` builds it first.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertBuilt, startApp } from "./app-process.mjs";

/**
 * Over 100 ms, a delay starts to be noticeable while typing. It fails on the 95th percentile: a rare
 * slow frame is tolerable, a regular one isn't. CI machines are slow and busy, so this is meant to
 * catch something really wrong, while the numbers themselves are what to look at.
 */
const LIMIT_P95_MS = 100;

assertBuilt();
const dir = mkdtempSync(join(tmpdir(), "ink-writer-perf-"));
const results = [];

const app = startApp(
  ["--test-mode=performance", "--test-timeout=900", `--test-dir=${dir}`],
  (line) => {
    if (line.startsWith("PERF ")) {
      results.push(JSON.parse(line.slice(5)));
    } else {
      console.log(line);
    }
  },
);
const { code, errors } = await app.done;
rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });

if (code !== 0) {
  console.error(`The app exited with ${code}\n${errors.join("\n")}`);
  process.exit(1);
}

let failed = false;
for (const result of results) {
  console.log(`\n${result.case} (${result.words} words on screen)`);
  console.log(`  save ${result.saveMs} ms, load ${result.loadMs} ms, show ${result.mountMs} ms`);
  console.log(`  version ${result.snapshotMs} ms, close ${result.closeMs} ms`);
  for (const [name, typing] of [
    ["at the end", result.typingAtEnd],
    ["in the middle", result.typingInTheMiddle],
  ]) {
    const { p50, p95, max } = typing.toFrame;
    console.log(`  typing ${name}: median ${p50} ms, p95 ${p95} ms, worst ${max} ms to the frame`);
    if (p95 > LIMIT_P95_MS) {
      console.error(`  TOO SLOW: p95 of ${p95} ms is over ${LIMIT_P95_MS} ms`);
      failed = true;
    }
  }
}

process.exit(failed || results.length === 0 ? 1 : 0);
