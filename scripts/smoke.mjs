// Starts the built app in smoke mode and passes on its result. `npm run smoke` builds it first.
import { createServer } from "node:http";
import { assertBuilt, startApp } from "./app-process.mjs";

const TIMEOUT_MS = 180_000;

assertBuilt();

/**
 * Stands in for Ollama, so that the test never depends on a model or on the network. It answers with
 * what it was sent, in pieces that cut a character in two, as a real stream can.
 */
const ai = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/api/tags") {
    response.end(JSON.stringify({ models: [{ name: "smoke-model" }] }));
    return;
  }
  if (request.method !== "POST" || request.url !== "/api/chat") {
    response.writeHead(404).end();
    return;
  }
  const received = [];
  request.on("data", (piece) => received.push(piece));
  request.on("end", () => {
    const { messages } = JSON.parse(Buffer.concat(received).toString("utf8"));
    const lines = Buffer.from(
      `${JSON.stringify({ message: { content: messages.at(-1).content } })}
${JSON.stringify({ done: true, done_reason: "stop" })}
`,
    );
    // The second byte of the "¿" in the smoke prose, so that the cut falls inside a character.
    const cut = lines.indexOf(0xbf);
    response.writeHead(200, { "content-type": "application/x-ndjson" });
    response.write(lines.subarray(0, cut));
    setTimeout(() => response.end(lines.subarray(cut)), 50);
  });
});
await new Promise((resolve) => ai.listen(0, "127.0.0.1", resolve));

const app = startApp(
  ["--test-mode=smoke", `--test-ai=http://127.0.0.1:${ai.address().port}`],
  (line) => console.log(line),
);
const timer = setTimeout(() => {
  console.error(`The app didn't finish within ${TIMEOUT_MS / 1000} s`);
  app.kill();
  process.exit(1);
}, TIMEOUT_MS);

const { code, signal, errors } = await app.done;
clearTimeout(timer);
ai.close();
if (code !== 0) {
  console.error(`The app exited with ${code ?? signal}\n${errors.join("\n")}`);
}
process.exit(code ?? 1);
