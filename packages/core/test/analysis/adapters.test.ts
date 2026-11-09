import { describe, expect, it } from "vitest";
import {
  type AiTransport,
  buildOllamaBody,
  buildOpenRouterBody,
  collectDraft,
  createOllamaProvider,
  createOpenRouterProvider,
  type GenerateEvent,
  parseOpenRouterModels,
  type TransportRequest,
} from "../../src/index";
import { describeProviderContract } from "../provider-contract";

const encode = (text: string) => new TextEncoder().encode(text);

async function* chunks(...parts: readonly string[]) {
  for (const part of parts) {
    yield encode(part);
  }
}

function response(status: number, ...parts: readonly string[]) {
  return { status, requestId: "req-1", retryAfterSeconds: null, body: chunks(...parts) };
}

/** Answers from a list of handlers by path, and remembers what it was asked. */
function fakeTransport(handlers: Readonly<Record<string, () => ReturnType<typeof response>>>) {
  const sent: TransportRequest[] = [];
  const transport: AiTransport = {
    async send(request) {
      sent.push(request);
      const handler = handlers[request.path];
      if (handler === undefined) {
        throw new Error(`No handler for ${request.path}`);
      }
      return handler();
    },
  };
  return { transport, sent };
}

const MODELS = JSON.stringify({
  data: [
    {
      id: "full/model:free",
      name: "Full",
      supported_parameters: ["structured_outputs", "tools", "web_search_options"],
      pricing: { prompt: "0", completion: "0" },
    },
    {
      id: "bare/model",
      name: "Bare",
      supported_parameters: [],
      pricing: { prompt: "0.000001", completion: "0.000002" },
    },
  ],
});

const STREAM_OK = [
  ": OPENROUTER PROCESSING\n\n",
  'data: {"choices":[{"delta":{"content":"Ho"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"la"}}]}\n\n',
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"cost":0}}\n\n',
  "data: [DONE]\n\n",
];

const request = { model: "full/model:free", instructions: "i", input: "x" };

const list = async (events: AsyncIterable<GenerateEvent>) => {
  const out: GenerateEvent[] = [];
  for await (const event of events) {
    out.push(event);
  }
  return out;
};

describeProviderContract("OpenRouter, with a fake network", () => {
  const { transport } = fakeTransport({
    "/api/v1/models": () => response(200, MODELS),
    "/api/v1/chat/completions": () => response(200, ...STREAM_OK),
  });
  return createOpenRouterProvider(transport);
});

describeProviderContract("Ollama, with a fake network", () => {
  // Unlike OpenRouter, the adapter doesn't look models up first: the server is who refuses one.
  const transport: AiTransport = {
    send: async (sent) => {
      if (sent.path === "/api/tags") {
        return response(200, JSON.stringify({ models: [{ name: "m:1" }] }));
      }
      return (sent.body as { model: string }).model === "m:1"
        ? response(
            200,
            '{"message":{"content":"x"},"done":false}\n{"done":true,"done_reason":"stop"}\n',
          )
        : response(404, '{"error":"model not found"}');
    },
  };
  return createOllamaProvider(transport);
});

describe("OpenRouter models", () => {
  it("reads capabilities per model", () => {
    const [full, bare] = parseOpenRouterModels(JSON.parse(MODELS));

    expect(full?.capabilities).toEqual({
      structuredOutput: "json_schema",
      webSearch: true,
      tools: true,
    });
    expect(bare?.capabilities.structuredOutput).toBe("none");
  });

  it.each([
    ["a/b:free", "0", "0", true],
    ["a/b:free", "0.1", "0", false],
    ["a/b:free", "0", "0.1", false],
    ["a/b", "0", "0", false],
    ["a/b:free", undefined, undefined, false],
  ])("%s at %s and %s: free is %s", (id, prompt, completion, free) => {
    const [model] = parseOpenRouterModels({ data: [{ id, pricing: { prompt, completion } }] });

    expect(model?.free).toBe(free);
  });

  it("copes with a malformed answer", () => {
    expect(parseOpenRouterModels({})).toEqual([]);
    expect(parseOpenRouterModels({ data: [{ name: "no id" }] })).toEqual([]);
  });
});

describe("OpenRouter requests", () => {
  it("asks for the schema and refuses endpoints that would ignore it", () => {
    const body = buildOpenRouterBody({
      ...request,
      structured: { name: "n", schema: { type: "object" } },
    });

    expect(body.response_format).toMatchObject({ type: "json_schema" });
    expect(body.provider).toEqual({ require_parameters: true });
  });

  it("never asks for a paid web search by itself", () => {
    const body = JSON.stringify(buildOpenRouterBody(request));

    expect(body).not.toContain("web_search");
    expect(body).not.toContain("plugins");
    expect(body).not.toContain("tools");
  });

  it("bounds the answer, and can turn reasoning off", () => {
    const body = buildOpenRouterBody({ ...request, reasoning: "off", temperature: 0 });

    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.temperature).toBe(0);
    expect(buildOpenRouterBody(request).reasoning).toBeUndefined();
  });
});

describe("OpenRouter streaming", () => {
  const provider = (...parts: readonly string[]) =>
    createOpenRouterProvider(
      fakeTransport({
        "/api/v1/models": () => response(200, MODELS),
        "/api/v1/chat/completions": () => response(200, ...parts),
      }).transport,
    );

  it("ignores comments, and reports usage with the cost", async () => {
    const draft = await collectDraft(provider(...STREAM_OK).generate(request));

    expect(draft).toMatchObject({ text: "Hola", completed: true });
    expect(draft.usage).toEqual({ inputTokens: 3, outputTokens: 2, cost: 0 });
  });

  it("treats an error chunk as a failure, even under a 200", async () => {
    const draft = await collectDraft(
      provider(
        'data: {"choices":[{"delta":{"content":"par"}}]}\n\n',
        'data: {"error":{"code":429,"message":"Rate limit"},"choices":[{"delta":{},"finish_reason":"error"}]}\n\n',
      ).generate(request),
    );

    expect(draft.completed).toBe(false);
    expect(draft.text).toBe("par");
    expect(draft.outcome).toMatchObject({ status: "failed", error: { code: "429" } });
  });

  it("treats running out of tokens as incomplete, not as success", async () => {
    const draft = await collectDraft(
      provider(
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
        "data: [DONE]\n\n",
      ).generate(request),
    );

    expect(draft.outcome).toEqual({ status: "incomplete", reason: "length" });
  });

  it("doesn't take an answer stopped by a content filter as a whole one", async () => {
    const draft = await collectDraft(
      provider(
        'data: {"choices":[{"delta":{"content":"a"},"finish_reason":"content_filter"}]}\n\n',
        "data: [DONE]\n\n",
      ).generate(request),
    );

    expect(draft.outcome).toEqual({ status: "incomplete", reason: "content_filter" });
  });

  it("stops reading when cancelled halfway, and doesn't report success", async () => {
    const controller = new AbortController();
    const { transport } = fakeTransport({ "/api/v1/models": () => response(200, MODELS) });
    const original = transport.send;
    async function* cancelledHalfway() {
      yield encode('data: {"choices":[{"delta":{"content":"a"}}]}\n\n');
      controller.abort();
      yield encode('data: {"choices":[{"delta":{"content":"b"}}]}\n\n');
      yield encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    }
    const cancelling: AiTransport = {
      send: (r) =>
        r.path === "/api/v1/chat/completions"
          ? Promise.resolve({ ...response(200), body: cancelledHalfway() })
          : original(r),
    };

    const draft = await collectDraft(
      createOpenRouterProvider(cancelling).generate({ ...request, signal: controller.signal }),
    );

    expect(draft.text).toBe("a");
    expect(draft.outcome.status).toBe("interrupted");
  });

  it("treats a cut stream as interrupted", async () => {
    const draft = await collectDraft(
      provider('data: {"choices":[{"delta":{"content":"a medias"}}]}\n\n').generate(request),
    );

    expect(draft.outcome.status).toBe("interrupted");
    expect(draft.text).toBe("a medias");
  });

  it("keeps a character split between chunks", async () => {
    const bytes = encode('data: {"choices":[{"delta":{"content":"ñ"}}]}\n\n');
    const at = bytes.indexOf(0xc3) + 1;
    async function* split() {
      yield bytes.slice(0, at);
      yield bytes.slice(at);
      yield encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    }
    const { transport } = fakeTransport({ "/api/v1/models": () => response(200, MODELS) });
    const original = transport.send;
    const split429: AiTransport = {
      send: (r) =>
        r.path === "/api/v1/chat/completions"
          ? Promise.resolve({ ...response(200), body: split() })
          : original(r),
    };

    const draft = await collectDraft(createOpenRouterProvider(split429).generate(request));

    expect(draft.text).toBe("ñ");
  });

  it("reports a refusal with its code, its request ID and how long to wait", async () => {
    const { transport } = fakeTransport({ "/api/v1/models": () => response(200, MODELS) });
    const original = transport.send;
    const limited: AiTransport = {
      send: (r) =>
        r.path === "/api/v1/chat/completions"
          ? Promise.resolve({
              ...response(429, '{"error":{"code":429,"message":"Rate limit exceeded"}}'),
              retryAfterSeconds: 30,
            })
          : original(r),
    };

    const draft = await collectDraft(createOpenRouterProvider(limited).generate(request));

    expect(draft.outcome).toEqual({
      status: "failed",
      error: {
        code: "429",
        message: "Rate limit exceeded",
        httpStatus: 429,
        requestId: "req-1",
        retryAfterSeconds: 30,
      },
    });
  });

  it("sends nothing for what the model can't do, so a refusal costs nothing", async () => {
    const { transport, sent } = fakeTransport({ "/api/v1/models": () => response(200, MODELS) });

    const events = await list(
      createOpenRouterProvider(transport).generate({
        ...request,
        model: "bare/model",
        structured: { name: "n", schema: {} },
      }),
    );

    expect(events.at(-1)).toMatchObject({
      outcome: { status: "failed", error: { code: "unsupported_capability" } },
    });
    expect(sent.map((r) => r.path)).toEqual(["/api/v1/models"]);
  });

  it("reports no connection as interrupted, so that the work can wait", async () => {
    const offline: AiTransport = {
      send: async () => {
        throw new Error("fetch failed");
      },
    };

    const draft = await collectDraft(createOpenRouterProvider(offline).generate(request));

    expect(draft.outcome).toMatchObject({ status: "interrupted", message: "fetch failed" });
  });
});

describe("Ollama", () => {
  const generate = (...lines: readonly string[]) =>
    createOllamaProvider(
      fakeTransport({ "/api/chat": () => response(200, ...lines) }).transport,
    ).generate({ model: "m", instructions: "i", input: "x" });

  it("sends the schema, and reserves room for the prompt", () => {
    const body = buildOllamaBody({
      model: "m",
      instructions: "i",
      input: "x",
      structured: { name: "n", schema: { type: "object" } },
    });

    expect(body.format).toEqual({ type: "object" });
    expect(body.options).toMatchObject({ num_ctx: expect.any(Number) });
  });

  it("only turns reasoning off when asked", () => {
    const base = { model: "m", instructions: "i", input: "x" };

    expect(buildOllamaBody(base).think).toBeUndefined();
    expect(buildOllamaBody({ ...base, reasoning: "off" }).think).toBe(false);
  });

  it("completes on the last line, and reports no cost", async () => {
    const draft = await collectDraft(
      generate(
        '{"message":{"content":"Ho"},"done":false}\n',
        '{"message":{"content":"la"},"done":false}\n',
        '{"message":{"content":""},"done":true,"done_reason":"stop","prompt_eval_count":5,"eval_count":2}\n',
      ),
    );

    expect(draft).toMatchObject({ text: "Hola", completed: true });
    expect(draft.usage).toEqual({ inputTokens: 5, outputTokens: 2, cost: 0 });
  });

  it("treats an error line as a failure, keeping the partial text", async () => {
    const draft = await collectDraft(
      generate('{"message":{"content":"par"},"done":false}\n', '{"error":"out of memory"}\n'),
    );

    expect(draft.text).toBe("par");
    expect(draft.outcome).toMatchObject({ status: "failed", error: { message: "out of memory" } });
  });

  it("treats a cut stream as interrupted, and running out of tokens as incomplete", async () => {
    const cut = await collectDraft(generate('{"message":{"content":"a"},"done":false}\n'));
    const long = await collectDraft(generate('{"done":true,"done_reason":"length"}\n'));

    expect(cut.outcome.status).toBe("interrupted");
    expect(long.outcome.status).toBe("incomplete");
  });

  it("names a missing model", async () => {
    const { transport } = fakeTransport({
      "/api/chat": () => response(404, '{"error":"model not found"}'),
    });

    const draft = await collectDraft(
      createOllamaProvider(transport).generate({ model: "m", instructions: "i", input: "x" }),
    );

    expect(draft.outcome).toMatchObject({
      status: "failed",
      error: { code: "unknown_model", message: "model not found" },
    });
  });

  it("reports the server not running as interrupted, so that the work can wait", async () => {
    const offline: AiTransport = {
      send: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    };

    const draft = await collectDraft(
      createOllamaProvider(offline).generate({ model: "m", instructions: "i", input: "x" }),
    );

    expect(draft.outcome.status).toBe("interrupted");
  });
});
