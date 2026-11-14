import { asObject, type Json, parseJson } from "./json";
import {
  type AiProvider,
  type GenerateEvent,
  type GenerateOutcome,
  type GenerateRequest,
  type ModelInfo,
  type Usage,
  unsupportedRequest,
} from "./provider";
import { type AiTransport, readAll, readSseData } from "./transport";

/**
 * DeepSeek's own API, paid by key. Documented at https://api-docs.deepseek.com. It's used by the
 * evaluation for now: the app connects to Ollama and OpenRouter (docs/adr/0012).
 */

/** The service's default is 64K while reasoning, and every token of it is paid. */
const DEFAULT_MAX_TOKENS = 8000;

/** It promises valid JSON and no particular shape, so the shape goes in the instructions. */
const CAPABILITIES = { structuredOutput: "json_object", webSearch: false, tools: false } as const;

export function parseDeepSeekModels(body: unknown): ModelInfo[] {
  const data = asObject(body).data;
  if (!Array.isArray(data)) {
    return [];
  }
  return data.flatMap((entry) => {
    const model = asObject(entry);
    return typeof model.id === "string"
      ? [
          {
            id: model.id,
            displayName: typeof model.name === "string" ? model.name : model.id,
            capabilities: CAPABILITIES,
          },
        ]
      : [];
  });
}

export function buildDeepSeekBody(request: GenerateRequest): Json {
  // The service requires the word "json" in the prompt, and needs to be told what to fill in.
  const shape =
    request.structured === undefined
      ? ""
      : `\n\nAnswer only with a json object that follows this schema:\n${JSON.stringify(request.structured.schema)}`;
  return {
    model: request.model,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
    messages: [
      { role: "system", content: `${request.instructions}${shape}` },
      { role: "user", content: request.input },
    ],
    // It's ignored while reasoning, which is the default, and honoured otherwise.
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.reasoning === "off" ? { thinking: { type: "disabled" } } : {}),
    ...(request.structured === undefined ? {} : { response_format: { type: "json_object" } }),
  };
}

const numberOrNull = (value: unknown) => (typeof value === "number" ? value : null);

/** There's no cost in the answer: whoever pays works it out from the tokens and the current prices. */
const toUsage = (usage: Json): Usage => ({
  inputTokens: numberOrNull(usage.prompt_tokens),
  outputTokens: numberOrNull(usage.completion_tokens),
  cost: null,
});

const UNKNOWN_USAGE: Usage = { inputTokens: null, outputTokens: null, cost: null };

function toOutcome(finish: string): GenerateOutcome {
  switch (finish) {
    case "stop":
      return { status: "completed" };
    case "aborted":
      return { status: "interrupted", message: "The service aborted the request" };
    case "insufficient_system_resource":
      // The service is out of capacity right now, which is what a 503 says.
      return {
        status: "failed",
        error: { code: "503", message: "The service is out of capacity" },
      };
    default:
      // Length, a content filter or anything new: only a clean stop counts as a whole answer.
      return { status: "incomplete", reason: finish };
  }
}

export function createDeepSeekProvider(transport: AiTransport): AiProvider {
  let models: ModelInfo[] | undefined;

  const listModels = async () => {
    if (models === undefined) {
      const response = await transport.send({ route: "deepseek", method: "GET", path: "/models" });
      const text = await readAll(response.body);
      if (response.status !== 200) {
        throw new Error(`The model list returned ${response.status}`);
      }
      models = parseDeepSeekModels(parseJson(text));
    }
    return models;
  };

  return {
    id: "deepseek",
    displayName: "DeepSeek",
    billing: "api_key",
    listModels,

    async *generate(request: GenerateRequest): AsyncGenerator<GenerateEvent> {
      let usage: Usage | undefined;
      const withUsage = (outcome: GenerateOutcome): GenerateEvent => ({
        type: "end",
        outcome,
        ...(usage === undefined ? {} : { usage }),
      });
      try {
        const unsupported = unsupportedRequest(CAPABILITIES, request);
        if (unsupported !== null) {
          yield withUsage({
            status: "failed",
            error: { code: "unsupported_capability", message: unsupported },
          });
          return;
        }
        // Asked before any paid request, so that a wrong name costs nothing.
        if (!(await listModels()).some((candidate) => candidate.id === request.model)) {
          yield withUsage({
            status: "failed",
            error: { code: "unknown_model", message: `No model "${request.model}"` },
          });
          return;
        }

        // Whatever the transport does with the signal, a cancelled request never reports success.
        request.signal?.throwIfAborted();
        const response = await transport.send({
          route: "deepseek",
          method: "POST",
          path: "/chat/completions",
          body: buildDeepSeekBody(request),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        if (response.status !== 200) {
          const text = await readAll(response.body);
          const message = asObject(parseJson(text)?.error).message;
          yield withUsage({
            status: "failed",
            error: {
              // Its error bodies carry names, and what each failure means goes by the HTTP status.
              code: String(response.status),
              message: typeof message === "string" ? message : text.slice(0, 300),
              httpStatus: response.status,
              ...(response.requestId === null ? {} : { requestId: response.requestId }),
              ...(response.retryAfterSeconds === null
                ? {}
                : { retryAfterSeconds: response.retryAfterSeconds }),
            },
          });
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
          if (chunk.error !== undefined) {
            const message = asObject(chunk.error).message;
            yield withUsage({
              status: "failed",
              error: {
                code: null,
                message: typeof message === "string" ? message : "The stream reported an error",
              },
            });
            return;
          }
          const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
          const choice = asObject(choices[0]);
          // `reasoning_content` comes apart from this, and must never be taken for the answer.
          const content = asObject(choice.delta).content;
          if (typeof content === "string" && content !== "") {
            yield { type: "text", delta: content };
          }
          if (typeof choice.finish_reason === "string") {
            finish = choice.finish_reason;
          }
        }

        if (!done || finish === null) {
          yield withUsage({ status: "interrupted", message: "The stream ended early" });
          return;
        }
        // An answer was paid for: not knowing how much is something for whoever counts to refuse.
        usage ??= UNKNOWN_USAGE;
        yield withUsage(toOutcome(finish));
      } catch (error) {
        yield withUsage({
          status: "interrupted",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
