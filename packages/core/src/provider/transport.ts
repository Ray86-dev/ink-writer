/**
 * How adapters reach the network. Whoever implements this attaches the credentials, so the core and
 * the WebView never see them (rule 9). The desktop shell does it in Rust; the evaluation harness, in
 * Node.
 */

export type ProviderRoute = "openrouter" | "ollama";

export interface TransportRequest {
  readonly route: ProviderRoute;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

export interface TransportResponse {
  readonly status: number;
  readonly requestId: string | null;
  /** From the `Retry-After` header, if there was one. */
  readonly retryAfterSeconds: number | null;
  readonly body: AsyncIterable<Uint8Array>;
}

export interface AiTransport {
  /** Rejects if the service can't be reached at all, as when offline or if Ollama isn't running. */
  send(request: TransportRequest): Promise<TransportResponse>;
}

export async function readAll(body: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of body) {
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

/** Splits into lines, whatever the chunks. A character split between chunks stays in one piece. */
export async function* readLines(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      yield line.endsWith("\r") ? line.slice(0, -1) : line;
    }
  }
  pending += decoder.decode();
  if (pending !== "") {
    yield pending;
  }
}

/** The `data:` payloads of a server-sent event stream. Comments and other fields are skipped. */
export async function* readSseData(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  let data: string[] = [];
  for await (const line of readLines(body)) {
    if (line === "") {
      if (data.length > 0) {
        yield data.join("\n");
        data = [];
      }
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (data.length > 0) {
    yield data.join("\n");
  }
}
