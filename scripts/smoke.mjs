// Starts the built app in smoke mode and passes on its result. `npm run smoke` builds it first.
import { assertBuilt, startApp } from "./app-process.mjs";

const TIMEOUT_MS = 180_000;

assertBuilt();

const app = startApp(["--test-mode=smoke"], (line) => console.log(line));
const timer = setTimeout(() => {
  console.error(`The app didn't finish within ${TIMEOUT_MS / 1000} s`);
  app.kill();
  process.exit(1);
}, TIMEOUT_MS);

const { code, signal, errors } = await app.done;
clearTimeout(timer);
if (code !== 0) {
  console.error(`The app exited with ${code ?? signal}\n${errors.join("\n")}`);
}
process.exit(code ?? 1);
