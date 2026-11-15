// Starts the built app in smoke mode and passes on its result. `npm run smoke` builds it first.
import { createServer } from "node:http";
import { assertBuilt, startApp } from "./app-process.mjs";

const TIMEOUT_MS = 180_000;

assertBuilt();

/** What each step of the analysis gets back: one fact, quoted from the smoke prose, and no findings. */
function analyse(format) {
  const asked = Object.keys(format.properties ?? {});
  if (asked.includes("entities")) {
    return {
      entities: [{ name: "Tomás", type: "person", aliases: [] }],
      facts: [
        {
          entity: "Tomás",
          category: "physical",
          attribute: "eye_color",
          value: "verdes",
          quote: "los ojos verdes de su madre",
          story_time: null,
        },
      ],
      relations: [],
    };
  }
  return Object.fromEntries(asked.map((name) => [name, []]));
}

/**
 * Stands in for Ollama, so that the test never depends on a model or on the network. Asked for plain
 * text, it answers with what it was sent, in pieces that cut a character in two, as a real stream
 * can. Asked for a schema, with what `analyse` says.
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
    const { messages, format } = JSON.parse(Buffer.concat(received).toString("utf8"));
    const content =
      format === undefined ? messages.at(-1).content : JSON.stringify(analyse(format));
    const lines = Buffer.from(
      [{ message: { content } }, { done: true, done_reason: "stop" }]
        .map((line) => `${JSON.stringify(line)}\n`)
        .join(""),
    );
    // The second byte of the "¿" in the smoke prose, so that the cut falls inside a character.
    const cut = Math.max(lines.indexOf(0xbf), 1);
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
