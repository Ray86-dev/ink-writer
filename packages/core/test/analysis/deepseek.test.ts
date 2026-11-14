import { describe, expect, it } from "vitest";
import {
  type AiTransport,
  buildDeepSeekBody,
  collectDraft,
  createDeepSeekProvider,
  generateStructured,
  parseDeepSeekModels,
  type TransportRequest,
  type Validated,
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

const MODELS = JSON.stringify({
  object: "list",
  data: [{ id: "deepseek-flash", name: "DeepSeek-V4.1-Flash", object: "model" }],
});

const STREAM_OK = [
  ": keep-alive\n\n",
  'data: {"choices":[{"delta":{"reasoning_content":"Pienso que"},"finish_reason":null}],"usage":null}\n\n',
  'data: {"choices":[{"delta":{"content":"Ho"},"finish_reason":null}],"usage":null}\n\n',
  'data: {"choices":[{"delta":{"content":"la"},"finish_reason":null}],"usage":null}\n\n',
  'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":30,"completion_tokens":20,"prompt_cache_hit_tokens":10,"prompt_cache_miss_tokens":20,"completion_tokens_details":{"reasoning_tokens":18}}}\n\n',
  "data: [DONE]\n\n",
];

/** Answers the model list, and then whatever `chat` says. Remembers what it was asked. */
function fake(chat: (request: TransportRequest) => ReturnType<typeof response>) {
  const sent: TransportRequest[] = [];
  const transport: AiTransport = {
    async send(request) {
      sent.push(request);
      return request.path === "/models" ? response(200, MODELS) : chat(request);
    },
  };
  return { provider: createDeepSeekProvider(transport), sent };
}

const request = { model: "deepseek-flash", instructions: "Instrucciones", input: "Texto" };
const schema = { name: "cosa", schema: { type: "object", required: ["thing"] } };

const isThing = (value: unknown): Validated<{ thing: string }> =>
  typeof value === "object" && value !== null && "thing" in value
    ? { ok: true, value: value as { thing: string } }
    : { ok: false, problem: 'It needs "thing".' };

const noWait = { sleep: async () => {} };

describeProviderContract("DeepSeek, with a fake network", () => {
  return fake(() => response(200, ...STREAM_OK)).provider;
});

describe("DeepSeek models", () => {
  it("reads the list, and says only JSON is guaranteed, not its shape", () => {
    expect(parseDeepSeekModels(JSON.parse(MODELS))).toEqual([
      {
        id: "deepseek-flash",
        displayName: "DeepSeek-V4.1-Flash",
        capabilities: { structuredOutput: "json_object", webSearch: false, tools: false },
      },
    ]);
  });

  it("copes with a malformed answer", () => {
    expect(parseDeepSeekModels({})).toEqual([]);
    expect(parseDeepSeekModels({ data: [{ name: "no id" }] })).toEqual([]);
  });
});

describe("DeepSeek requests", () => {
  it("asks for JSON the only way it can, and tells the model the shape", () => {
    const body = buildDeepSeekBody({ ...request, structured: schema });
    const [system, user] = body.messages as { role: string; content: string }[];

    expect(body.response_format).toEqual({ type: "json_object" });
    expect(system?.content).toContain("Instrucciones");
    // The service refuses a JSON request whose prompt doesn't have this word.
    expect(system?.content).toContain("json");
    expect(system?.content).toContain('"required":["thing"]');
    expect(user?.content).toBe("Texto");
  });

  it("leaves all that out when no structure is asked for", () => {
    const body = buildDeepSeekBody(request);

    expect(body.response_format).toBeUndefined();
    expect(body.messages).toEqual([
      { role: "system", content: "Instrucciones" },
      { role: "user", content: "Texto" },
    ]);
  });

  it("always bounds the answer, as the service's own default is 64K paid tokens", () => {
    expect(buildDeepSeekBody(request).max_tokens).toBe(8000);
    expect(buildDeepSeekBody({ ...request, maxOutputTokens: 100 }).max_tokens).toBe(100);
  });

  it("always asks for the usage, as it's the only way to count what was spent", () => {
    expect(buildDeepSeekBody(request).stream_options).toEqual({ include_usage: true });
  });

  it("only turns reasoning off when asked", () => {
    expect(buildDeepSeekBody(request).thinking).toBeUndefined();
    expect(buildDeepSeekBody({ ...request, reasoning: "off" }).thinking).toEqual({
      type: "disabled",
    });
  });

  it("never asks for a search or a tool, which are paid by the request", () => {
    const body = JSON.stringify(buildDeepSeekBody({ ...request, structured: schema }));

    expect(body).not.toContain("web_search");
    expect(body).not.toContain("tools");
  });

  it("goes to the right place", async () => {
    const { provider, sent } = fake(() => response(200, ...STREAM_OK));

    await collectDraft(provider.generate(request));

    expect(sent.map((item) => [item.route, item.method, item.path])).toEqual([
      ["deepseek", "GET", "/models"],
      ["deepseek", "POST", "/chat/completions"],
    ]);
  });
});

describe("DeepSeek streaming", () => {
  const generate = (...parts: readonly string[]) =>
    collectDraft(fake(() => response(200, ...parts)).provider.generate(request));

  it("ignores keep-alives, and reports the usage", async () => {
    const draft = await generate(...STREAM_OK);

    expect(draft).toMatchObject({ text: "Hola", completed: true });
    expect(draft.usage).toEqual({ inputTokens: 30, outputTokens: 20, cost: null });
  });

  it("never takes the model's reasoning for its answer", async () => {
    const draft = await generate(...STREAM_OK);

    expect(draft.text).not.toContain("Pienso");
  });

  it("says when it can't tell what an answer cost, instead of saying nothing", async () => {
    const draft = await generate(
      'data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    );

    expect(draft.usage).toEqual({ inputTokens: null, outputTokens: null, cost: null });
  });

  it.each([
    ["length", { status: "incomplete", reason: "length" }],
    ["content_filter", { status: "incomplete", reason: "content_filter" }],
    ["tool_calls", { status: "incomplete", reason: "tool_calls" }],
    ["aborted", { status: "interrupted", message: "The service aborted the request" }],
    [
      "insufficient_system_resource",
      { status: "failed", error: { code: "503", message: "The service is out of capacity" } },
    ],
  ])("%s isn't a whole answer", async (finish, outcome) => {
    const draft = await generate(
      `data: {"choices":[{"delta":{"content":"a medias"},"finish_reason":"${finish}"}]}\n\n`,
      "data: [DONE]\n\n",
    );

    expect(draft.completed).toBe(false);
    expect(draft.outcome).toEqual(outcome);
  });

  it("treats a cut stream as interrupted", async () => {
    const draft = await generate('data: {"choices":[{"delta":{"content":"a medias"}}]}\n\n');

    expect(draft.outcome.status).toBe("interrupted");
    expect(draft.text).toBe("a medias");
  });

  it("treats an error chunk as something to try later, even under a 200", async () => {
    const draft = await generate(
      'data: {"choices":[{"delta":{"content":"par"}}]}\n\n',
      'data: {"error":{"message":"Se cayó"}}\n\n',
    );

    expect(draft.text).toBe("par");
    expect(draft.outcome).toEqual({
      status: "failed",
      error: { code: null, message: "Se cayó" },
    });
  });

  it("stops reading when cancelled halfway, and doesn't report success", async () => {
    const controller = new AbortController();
    async function* cancelledHalfway() {
      yield encode('data: {"choices":[{"delta":{"content":"a"}}]}\n\n');
      controller.abort();
      yield encode('data: {"choices":[{"delta":{"content":"b"},"finish_reason":"stop"}]}\n\n');
      yield encode("data: [DONE]\n\n");
    }
    const { provider } = fake(() => ({ ...response(200), body: cancelledHalfway() }));

    const draft = await collectDraft(provider.generate({ ...request, signal: controller.signal }));

    expect(draft.text).toBe("a");
    expect(draft.outcome.status).toBe("interrupted");
  });

  it("reports no connection as interrupted, so that the work can wait", async () => {
    const offline: AiTransport = {
      send: async () => {
        throw new Error("fetch failed");
      },
    };

    const draft = await collectDraft(createDeepSeekProvider(offline).generate(request));

    expect(draft.outcome).toMatchObject({ status: "interrupted", message: "fetch failed" });
  });
});

describe("DeepSeek failures", () => {
  it("doesn't send a paid request for a model it doesn't have", async () => {
    const { provider, sent } = fake(() => response(200, ...STREAM_OK));

    const draft = await collectDraft(provider.generate({ ...request, model: "otro" }));

    expect(draft.outcome).toMatchObject({ status: "failed", error: { code: "unknown_model" } });
    expect(sent.map((item) => item.path)).toEqual(["/models"]);
  });

  it("keeps the service's explanation, with the status and the request ID", async () => {
    const { provider } = fake(() =>
      response(402, '{"error":{"message":"Insufficient Balance","type":"unknown_error"}}'),
    );

    const draft = await collectDraft(provider.generate(request));

    expect(draft.outcome).toEqual({
      status: "failed",
      error: {
        code: "402",
        message: "Insufficient Balance",
        httpStatus: 402,
        requestId: "req-1",
      },
    });
  });

  it.each([400, 401, 402, 422])(
    "%i can't get better by itself: it stops the work",
    async (status) => {
      const { provider, sent } = fake(() => response(status, '{"error":{"message":"m"}}'));

      const error = await generateStructured(provider, request, isThing, noWait).catch((e) => e);

      expect(error.failure).toBe("refused");
      expect(sent.filter((item) => item.path === "/chat/completions")).toHaveLength(1);
    },
  );

  it.each([429, 500, 503])("%i is tried again, and then left for later", async (status) => {
    const { provider, sent } = fake(() => response(status, '{"error":{"message":"m"}}'));

    const error = await generateStructured(provider, request, isThing, noWait).catch((e) => e);

    expect(error.failure).toBe("later");
    expect(sent.filter((item) => item.path === "/chat/completions").length).toBeGreaterThan(1);
  });

  it("gets one more chance when the answer comes back blank, as the service warns it can", async () => {
    const blank = 'data: {"choices":[{"delta":{"content":"   "},"finish_reason":"stop"}]}\n\n';
    const good =
      'data: {"choices":[{"delta":{"content":"{\\"thing\\":\\"a\\"}"},"finish_reason":"stop"}]}\n\n';
    let calls = 0;
    const { provider } = fake(() => {
      calls += 1;
      return response(200, calls === 1 ? blank : good, "data: [DONE]\n\n");
    });

    await expect(generateStructured(provider, request, isThing, noWait)).resolves.toEqual({
      thing: "a",
    });
    expect(calls).toBe(2);
  });
});
