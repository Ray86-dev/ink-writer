import type { AiProvider, GenerateEvent, GenerateRequest, ModelInfo, Usage } from "./provider";
import { unsupportedRequest } from "./provider";
import { type AiTransport, readAll, readLines } from "./transport";

/** Enough for a long scene plus the facts it's compared with. Ollama's default can cut prompts. */
const CONTEXT_TOKENS = 16384;

const CAPABILITIES = { structuredOutput: "json_schema", webSearch: false, tools: false } as const;

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return typeof value === "object" && value !== null ? (value as Json) : {};
}

function parseJson(text: string): Json | null {
  try {
    return asObject(JSON.parse(text));
  } catch {
    return null;
  }
}

export function buildOllamaBody(request: GenerateRequest): Json {
  return {
    model: request.model,
    stream: true,
    messages: [
      { role: "system", content: request.instructions },
      { role: "user", content: request.input },
    ],
    // Some models reason unseen by default, which delays any answer by several seconds.
    ...(request.reasoning === "off" ? { think: false } : {}),
    ...(request.structured === undefined ? {} : { format: request.structured.schema }),
    options: {
      num_ctx: CONTEXT_TOKENS,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.maxOutputTokens === undefined ? {} : { num_predict: request.maxOutputTokens }),
    },
  };
}

export function createOllamaProvider(transport: AiTransport): AiProvider {
  const listModels = async (): Promise<ModelInfo[]> => {
    const response = await transport.send({ route: "ollama", method: "GET", path: "/api/tags" });
    const text = await readAll(response.body);
    if (response.status !== 200) {
      throw new Error(`The model list returned ${response.status}`);
    }
    const models = parseJson(text)?.models;
    if (!Array.isArray(models)) {
      return [];
    }
    return models.flatMap((entry) => {
      const name = asObject(entry).name;
      return typeof name === "string"
        ? [{ id: name, displayName: name, capabilities: CAPABILITIES }]
        : [];
    });
  };

  return {
    id: "ollama",
    displayName: "Ollama",
    billing: "local",
    listModels,

    async *generate(request: GenerateRequest): AsyncGenerator<GenerateEvent> {
      const unsupported = unsupportedRequest(CAPABILITIES, request);
      if (unsupported !== null) {
        yield {
          type: "end",
          outcome: {
            status: "failed",
            error: { code: "unsupported_capability", message: unsupported },
          },
        };
        return;
      }
      let usage: Usage | undefined;
      try {
        // Whatever the transport does with the signal, a cancelled request never reports success.
        request.signal?.throwIfAborted();
        const response = await transport.send({
          route: "ollama",
          method: "POST",
          path: "/api/chat",
          body: buildOllamaBody(request),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        if (response.status !== 200) {
          const text = await readAll(response.body);
          const message = parseJson(text)?.error;
          yield {
            type: "end",
            outcome: {
              status: "failed",
              error: {
                code: response.status === 404 ? "unknown_model" : String(response.status),
                message: typeof message === "string" ? message : text.slice(0, 300),
                httpStatus: response.status,
              },
            },
          };
          return;
        }

        let done = false;
        let reason: string | null = null;
        for await (const line of readLines(response.body)) {
          request.signal?.throwIfAborted();
          if (line.trim() === "") {
            continue;
          }
          const chunk = parseJson(line);
          if (chunk === null) {
            continue;
          }
          // A 200 can still carry a failure, in a line with an error.
          if (typeof chunk.error === "string") {
            yield {
              type: "end",
              outcome: { status: "failed", error: { code: null, message: chunk.error } },
            };
            return;
          }
          const content = asObject(chunk.message).content;
          if (typeof content === "string" && content !== "") {
            yield { type: "text", delta: content };
          }
          if (chunk.done === true) {
            done = true;
            reason = typeof chunk.done_reason === "string" ? chunk.done_reason : null;
            usage = {
              inputTokens:
                typeof chunk.prompt_eval_count === "number" ? chunk.prompt_eval_count : null,
              outputTokens: typeof chunk.eval_count === "number" ? chunk.eval_count : null,
              cost: 0,
            };
          }
        }
        const withUsage = usage === undefined ? {} : { usage };
        if (!done) {
          yield {
            type: "end",
            outcome: { status: "interrupted", message: "The stream ended early" },
            ...withUsage,
          };
        } else if (reason === "length") {
          yield {
            type: "end",
            outcome: { status: "incomplete", reason: "length" },
            ...withUsage,
          };
        } else {
          yield { type: "end", outcome: { status: "completed" }, ...withUsage };
        }
      } catch (error) {
        yield {
          type: "end",
          outcome: {
            status: "interrupted",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };
}
