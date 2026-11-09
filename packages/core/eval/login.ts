/**
 * Gets an OpenRouter key for the evaluation by signing in through the browser, so that nobody has to
 * paste one anywhere. It's kept in the user's own folder, never in the repository, and never printed.
 *
 *   npm run eval:login
 */
import { exec } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const KEY_FILE = join(
  process.env.LOCALAPPDATA ?? join(homedir(), ".local", "share"),
  "ink-writer-dev",
  "openrouter-key",
);

const TIMEOUT_MS = 5 * 60 * 1000;

const base64url = (bytes: Buffer) => bytes.toString("base64url");

const verifier = base64url(randomBytes(64));
const challenge = base64url(createHash("sha256").update(verifier).digest());
const state = base64url(randomBytes(32));

function openBrowser(url: string): void {
  const command =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(command);
}

/** Lets the program end by itself: a hard exit with a connection open trips an assertion on Windows. */
function finish(): void {
  clearTimeout(timer);
  server.close();
  server.closeAllConnections();
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== "/callback") {
    response.writeHead(404).end();
    return;
  }
  const code = url.searchParams.get("code");
  if (code === null || url.searchParams.get("state") !== state) {
    response.writeHead(400).end("Respuesta no válida.");
    return;
  }
  try {
    const exchange = await fetch("https://openrouter.ai/api/v1/auth/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
    });
    const body = (await exchange.json()) as { key?: string };
    if (!exchange.ok || typeof body.key !== "string") {
      throw new Error(`OpenRouter answered ${exchange.status}`);
    }
    mkdirSync(dirname(KEY_FILE), { recursive: true });
    writeFileSync(KEY_FILE, body.key, { mode: 0o600 });
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end("<!doctype html><p>Listo. Puedes cerrar esta pestaña.</p>");
    console.log("Conectado. La clave queda guardada en tu carpeta de usuario.");
  } catch (error) {
    response.writeHead(500).end("No se pudo completar.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
  finish();
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const auth = new URL("https://openrouter.ai/auth");
  auth.searchParams.set("callback_url", `http://localhost:${port}/callback`);
  auth.searchParams.set("code_challenge", challenge);
  auth.searchParams.set("code_challenge_method", "S256");
  auth.searchParams.set("state", state);
  auth.searchParams.set("key_label", "Ink Writer evaluation");
  console.log("Se abre el navegador para autorizar a OpenRouter. Esperando...");
  openBrowser(auth.toString());
});

const timer = setTimeout(() => {
  console.error("No llegó ninguna respuesta en 5 minutos.");
  process.exitCode = 1;
  finish();
}, TIMEOUT_MS);
