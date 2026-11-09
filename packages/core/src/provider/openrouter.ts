import {
  type AiProvider,
  type GenerateEvent,
  type GenerateRequest,
  type ModelInfo,
  type ProviderError,
  type Usage,
  unsupportedRequest,
} from "./provider";
import { type AiTransport, readAll, readSseData } from "./transport";

/** Bounds each request, and leaves room for reasoning, which is spent before any answer. */
const DEFAULT_MAX_TOKENS = 8000;

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

function toError(
  body: Json | null,
  fallback: string,
  httpStatus: number | undefined,
  requestId: string | null,
): ProviderError {
  const error = asObject(body?.error);
  const code = error.code;
  return {
    code: code === undefined || code === null ? null : String(code),
    message: typeof error.message === "string" ? error.message : fallback,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(requestId === null ? {} : { requestId }),
  };
}

export function parseOpenRouterModels(body: unknown): ModelInfo[] {
  const data = asObject(body).data;
  if (!Array.isArray(data)) {
    return [];
  }
  return data.flatMap((entry) => {
    const model = asObject(entry);
    if (typeof model.id !== "string") {
      return [];
    }
    const parameters = Array.isArray(model.supported_parameters) ? model.supported_parameters : [];
    const pricing = asObject(model.pricing);
    return [
      {
        id: model.id,
        displayName: typeof model.name === "string" ? model.name : model.id,
        capabilities: {
          structuredOutput: parameters.includes("structured_outputs") ? "json_schema" : "none",
          webSearch: parameters.includes("web_search_options"),
          tools: parameters.includes("tools"),
        },
        free:
          model.id.endsWith(":free") &&
          Number(pricing.prompt ?? 1) === 0 &&
          Number(pricing.completion ?? 1) === 0,
      } satisfies ModelInfo,
    ];
  });
}

export function buildOpenRouterBody(request: GenerateRequest): Json {
  return {
    model: request.model,
    stream: true,
    max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
    messages: [
      { role: "system", content: request.instructions },
      { role: "user", content: request.input },
    ],
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.reasoning === "off" ? { reasoning: { enabled: false } } : {}),
    ...(request.structured === undefined
      ? {}
      : {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: request.structured.name,
              strict: true,
              schema: request.structured.schema,
            },
          },
          // Without this, routing could pick an endpoint that ignores the schema, silently.
          provider: { require_parameters: true },
        }),
  };
}

const toUsage = (usage: Json): Usage => ({
  inputTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
  outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
  cost: typeof usage.cost === "number" ? usage.cost : null,
});

export function createOpenRouterProvider(transport: AiTransport): AiProvider {
  let models: ModelInfo[] | undefined;

  const listModels = async () => {
    if (models === undefined) {
      const response = await transport.send({
        route: "openrouter",
        method: "GET",
        path: "/api/v1/models",
      });
      const text = await readAll(response.body);
      if (response.status !== 200) {
        throw new Error(`The model list returned ${response.status}`);
      }
      models = parseOpenRouterModels(parseJson(text));
    }
    return models;
  };

  return {
    id: "openrouter",
    displayName: "OpenRouter",
    billing: "openrouter_credits",
    listModels,

    async *generate(request: GenerateRequest): AsyncGenerator<GenerateEvent> {
      let usage: Usage | undefined;
      const end = (outcome: GenerateEvent & { type: "end" }): GenerateEvent => ({
        ...outcome,
        ...(usage === undefined ? {} : { usage }),
      });
      try {
        const model = (await listModels()).find((candidate) => candidate.id === request.model);
        if (model === undefined) {
          yield {
            type: "end",
            outcome: {
              status: "failed",
              error: { code: "unknown_model", message: `No model "${request.model}"` },
            },
          };
          return;
        }
        const unsupported = unsupportedRequest(model.capabilities, request);
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

        // Whatever the transport does with the signal, a cancelled request never reports success.
        request.signal?.throwIfAborted();
        const response = await transport.send({
          route: "openrouter",
          method: "POST",
          path: "/api/v1/chat/completions",
          body: buildOpenRouterBody(request),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        if (response.status !== 200) {
          const text = await readAll(response.body);
          yield {
            type: "end",
            outcome: {
              status: "failed",
              error: {
                ...toError(
                  parseJson(text),
                  text.slice(0, 300),
                  response.status,
                  response.requestId,
                ),
                ...(response.retryAfterSeconds === null
                  ? {}
                  : { retryAfterSeconds: response.retryAfterSeconds }),
              },
            },
          };
          return;
        }

        let finish: string | null = null;
        let done = false;
        for await (const data of readSseData(response.body)) {
          request.signal?.throwIfAborted();
          if (data.trim() === "[DONE]") {
            done = true;
            break;
          }
          const chunk = parseJson(data);
          if (chunk === null) {
            continue;
          }
          if (chunk.usage !== undefined && chunk.usage !== null) {
            usage = toUsage(asObject(chunk.usage));
          }
          // A 200 can still carry a failure, in a chunk with a top-level error.
          if (chunk.error !== undefined) {
            yield end({
              type: "end",
              outcome: {
                status: "failed",
                error: toError(
                  chunk,
                  "The stream reported an error",
                  undefined,
                  response.requestId,
                ),
              },
            });
            return;
          }
          const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
          const choice = asObject(choices[0]);
          const delta = asObject(choice.delta);
          if (typeof delta.content === "string" && delta.content !== "") {
            yield { type: "text", delta: delta.content };
          }
          if (typeof choice.finish_reason === "string") {
            finish = choice.finish_reason;
          }
        }

        if (!done || finish === null) {
          yield end({
            type: "end",
            outcome: { status: "interrupted", message: "The stream ended early" },
          });
        } else if (finish === "stop") {
          yield end({ type: "end", outcome: { status: "completed" } });
        } else {
          // Length, a content filter or anything new: only a clean stop counts as a whole answer.
          yield end({ type: "end", outcome: { status: "incomplete", reason: finish } });
        }
      } catch (error) {
        yield end({
          type: "end",
          outcome: {
            status: "interrupted",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    },
  };
}
