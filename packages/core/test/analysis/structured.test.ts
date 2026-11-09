import { describe, expect, it, vi } from "vitest";
import {
  type AiProvider,
  type GenerateEvent,
  type GenerateOutcome,
  generateStructured,
  StructuredOutputError,
  type Validated,
} from "../../src/index";

/** Plays back one answer per call, and remembers the inputs it got. */
function scripted(...answers: readonly (string | GenerateOutcome)[]) {
  const inputs: string[] = [];
  let next = 0;
  const provider: AiProvider = {
    id: "fake",
    displayName: "Fake",
    billing: "local",
    listModels: async () => [],
    async *generate(request): AsyncGenerator<GenerateEvent> {
      inputs.push(request.input);
      const answer = answers[next];
      next += 1;
      if (answer === undefined) {
        throw new Error("Asked more times than expected");
      }
      if (typeof answer === "string") {
        yield { type: "text", delta: answer };
        yield {
          type: "end",
          outcome: { status: "completed" },
          usage: { inputTokens: 1, outputTokens: 1, cost: 0 },
        };
      } else {
        yield { type: "end", outcome: answer };
      }
    },
  };
  return { provider, inputs, calls: () => next };
}

const isThing = (value: unknown): Validated<{ thing: string }> =>
  typeof value === "object" && value !== null && "thing" in value
    ? { ok: true, value: value as { thing: string } }
    : { ok: false, problem: 'It needs "thing".' };

const request = { model: "m", instructions: "i", input: "pregunta" };
const options = { sleep: async () => {} };

const failed = (code: string, retryAfterSeconds?: number): GenerateOutcome => ({
  status: "failed",
  error: {
    code,
    message: "m",
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  },
});

describe("generateStructured", () => {
  it("returns a valid answer the first time", async () => {
    const { provider, calls } = scripted('{"thing":"a"}');

    await expect(generateStructured(provider, request, isThing, options)).resolves.toEqual({
      thing: "a",
    });
    expect(calls()).toBe(1);
  });

  it("accepts JSON wrapped in a code fence, which some models add anyway", async () => {
    const { provider } = scripted('```json\n{"thing":"a"}\n```');

    await expect(generateStructured(provider, request, isThing, options)).resolves.toEqual({
      thing: "a",
    });
  });

  it("gives one repair retry, saying what was wrong (SPEC §5)", async () => {
    const { provider, inputs } = scripted('{"other":1}', '{"thing":"b"}');

    await expect(generateStructured(provider, request, isThing, options)).resolves.toEqual({
      thing: "b",
    });
    expect(inputs[1]).toContain("pregunta");
    expect(inputs[1]).toContain('It needs "thing".');
  });

  it("gives up after that one retry, saying the answer was the problem", async () => {
    const { provider, calls } = scripted("no es json", "tampoco");

    const error = await generateStructured(provider, request, isThing, options).catch((e) => e);

    expect(error).toBeInstanceOf(StructuredOutputError);
    expect(error.failure).toBe("bad_answer");
    expect(calls()).toBe(2);
  });

  it("treats an answer cut off by length as something to repair", async () => {
    const { provider, inputs } = scripted(
      { status: "incomplete", reason: "length" },
      '{"thing":"a"}',
    );

    await expect(generateStructured(provider, request, isThing, options)).resolves.toEqual({
      thing: "a",
    });
    expect(inputs[1]).toContain("shorter");
  });

  it("waits out a rate limit, without using up the repair retry", async () => {
    const { provider } = scripted(failed("429"), failed("503"), '{"other":1}', '{"thing":"a"}');
    const sleep = vi.fn(async () => {});

    await expect(generateStructured(provider, request, isThing, { sleep })).resolves.toEqual({
      thing: "a",
    });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("honours Retry-After, and otherwise waits longer each time", async () => {
    const { provider } = scripted(failed("429", 7), failed("429"), failed("429"), '{"thing":"a"}');
    const waits: number[] = [];

    await generateStructured(provider, request, isThing, {
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    expect(waits).toEqual([7000, 10_000, 20_000]);
  });

  it("stops retrying a rate limit eventually, leaving the work for later", async () => {
    const { provider, calls } = scripted(...Array.from({ length: 5 }, () => failed("429")));

    const error = await generateStructured(provider, request, isThing, options).catch((e) => e);

    expect(error).toBeInstanceOf(StructuredOutputError);
    expect(error.failure).toBe("later");
    expect(calls()).toBe(5);
  });

  it("doesn't wait hours for a long Retry-After, as with a daily limit", async () => {
    const { provider, calls } = scripted(failed("429", 3600));
    const sleep = vi.fn(async () => {});

    const error = await generateStructured(provider, request, isThing, { sleep }).catch((e) => e);

    expect(error.failure).toBe("later");
    expect(sleep).not.toHaveBeenCalled();
    expect(calls()).toBe(1);
  });

  it("stops waiting when cancelled", async () => {
    const controller = new AbortController();
    const { provider } = scripted(failed("429", 30), {
      status: "interrupted",
      message: "cancelled",
    });
    const started = Date.now();

    const pending = generateStructured(
      provider,
      { ...request, signal: controller.signal },
      isThing,
    ).catch((e) => e);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    const error = await pending;

    expect(error.failure).toBe("later");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("doesn't retry a refusal that can't change, and says so", async () => {
    const { provider, calls } = scripted(failed("unsupported_capability"));

    const error = await generateStructured(provider, request, isThing, options).catch((e) => e);

    expect(error.failure).toBe("refused");
    expect(calls()).toBe(1);
  });

  it("treats no connection as something to try later", async () => {
    const { provider, calls } = scripted({ status: "interrupted", message: "offline" });

    const error = await generateStructured(provider, request, isThing, options).catch((e) => e);

    expect(error.failure).toBe("later");
    expect(error.message).toBe("offline");
    expect(calls()).toBe(1);
  });

  it("passes on the usage of every answer, including the rejected one", async () => {
    const { provider } = scripted("no es json", '{"thing":"a"}');
    const onUsage = vi.fn();

    await generateStructured(provider, request, isThing, { ...options, onUsage });

    expect(onUsage).toHaveBeenCalledTimes(2);
  });

  it("stops at once if the usage callback refuses, as the spending guard does", async () => {
    const { provider, calls } = scripted("no es json", '{"thing":"a"}');

    await expect(
      generateStructured(provider, request, isThing, {
        ...options,
        onUsage: () => {
          throw new Error("cost");
        },
      }),
    ).rejects.toThrow("cost");
    expect(calls()).toBe(1);
  });
});
