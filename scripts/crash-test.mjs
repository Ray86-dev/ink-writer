// Rule 2 on the real app: kills it at random moments while it writes, and checks what survived.
// `npm run crash-test` builds it first. Usage: crash-test.mjs [rounds]
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { assertBuilt, startApp } from "./app-process.mjs";

const ROUNDS = Number(process.argv[2] ?? 8);
const FIRST_WRITE_TIMEOUT_MS = 90_000;

assertBuilt();
const dir = mkdtempSync(join(tmpdir(), "ink-writer-crash-"));
const shared = [`--test-dir=${dir}`];

let failed = false;
let confirmed = 0;
let total = 0;
const medians = [];
let worstLatency = 0;

/** Runs the writer until a random moment after it starts confirming writes, then kills it. */
async function writeAndKill(round) {
  let lastAck = confirmed;
  let acks = 0;
  const started = new Promise((resolve) => {
    const app = startApp(["--test-mode=crash-writer", "--test-timeout=600", ...shared], (line) => {
      if (line.startsWith("ACK ")) {
        const ack = Number(line.slice(4));
        // Counted before the kill can happen: everything seen here was confirmed by the database.
        if (ack <= lastAck) {
          console.error(`  round ${round}: confirmations went backwards: ${ack} after ${lastAck}`);
          failed = true;
        }
        lastAck = ack;
        acks += 1;
        if (acks === 1) {
          resolve(app);
        }
      } else if (line.startsWith("LATENCY ")) {
        // One line per 25 writes: median, 99th percentile and worst of those 25.
        const [median, , worst] = line.slice(8).split(" ").map(Number);
        medians.push(median);
        worstLatency = Math.max(worstLatency, worst);
      } else {
        console.log(`  ${line}`);
      }
    });
    app.done.then(({ code, errors }) => {
      if (acks === 0) {
        console.error(`  round ${round}: the writer ended (${code}) before writing anything`);
        console.error(errors.join("\n"));
        failed = true;
        resolve(null);
      }
    });
  });
  const app = await Promise.race([started, sleep(FIRST_WRITE_TIMEOUT_MS).then(() => null)]);
  if (app === null) {
    return null;
  }
  await sleep(300 + Math.random() * 2500);
  app.kill();
  await app.done;
  return { lastAck, acks };
}

for (let round = 1; round <= ROUNDS && !failed; round += 1) {
  const killed = await writeAndKill(round);
  if (killed === null) {
    failed = true;
    break;
  }
  confirmed = killed.lastAck;

  let survived = null;
  const verifier = startApp(
    [`--test-mode=crash-verify`, `--test-arg=${confirmed}`, ...shared],
    (line) => {
      if (line.startsWith("SURVIVED ")) {
        survived = Number(line.slice(9));
      } else {
        console.log(`  round ${round}: ${line}`);
      }
    },
  );
  const { code, errors } = await verifier.done;
  if (code !== 0 || survived === null) {
    console.error(`  round ${round}: FAILED with exit ${code}\n${errors.join("\n")}`);
    failed = true;
    break;
  }
  total += killed.acks;
  // What's beyond the last confirmation is kept too, and the next round carries on from there.
  confirmed = survived;
}

rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });

if (failed) {
  console.error("Crash test FAILED");
  process.exit(1);
}
const typical = [...medians].sort((a, b) => a - b)[Math.floor(medians.length / 2)];
console.log(
  `Crash test passed: ${ROUNDS} forced closes, ${total} confirmed writes, text ends at w${confirmed}.`,
);
console.log(
  `Typed to confirmed on disk: typically ${typical} ms, worst of the whole run ${worstLatency} ms`,
);
