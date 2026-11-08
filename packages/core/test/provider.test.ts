import { describe, expect, it } from "vitest";
import { collectDraft, type GenerateEvent, unsupportedRequest } from "../src/index";
import { describeProviderContract } from "./provider-contract";
import { createFakeProvider, FULL_CAPABILITIES, NO_CAPABILITIES } from "./support/fake-provider";

describeProviderContract("fake", () => createFakeProvider());

async function* stream(events: readonly GenerateEvent[], failure?: Error) {
  yield* events;
  if (failure !== undefined) {
    throw failure;
  }
}

const text = (delta: string): GenerateEvent => ({ type: "text", delta });
const completed: GenerateEvent = { type: "end", outcome: { status: "completed" } };

describe("collectDraft", () => {
  it("is completed only after a completed ending", async () => {
    const draft = await collectDraft(stream([text("Ho"), text("la"), completed]));

    expect(draft).toMatchObject({ text: "Hola", completed: true });
  });

  it("passes each piece of text on as it arrives", async () => {
    const seen: string[] = [];

    await collectDraft(stream([text("a"), text("b"), completed]), (d) => seen.push(d));

    expect(seen).toEqual(["a", "b"]);
  });

  it.each([
    ["failed", { status: "failed", error: { code: "x", message: "y" } }],
    ["incomplete", { status: "incomplete", reason: "length" }],
    ["interrupted", { status: "interrupted", message: "cut" }],
  ] as const)("keeps the partial text and isn't completed after %s", async (status, outcome) => {
    const draft = await collectDraft(stream([text("a medias"), { type: "end", outcome }]));

    expect(draft.text).toBe("a medias");
    expect(draft.completed).toBe(false);
    expect(draft.outcome.status).toBe(status);
  });

  it("treats a stream with no ending as interrupted", async () => {
    const draft = await collectDraft(stream([text("a medias")]));

    expect(draft).toMatchObject({
      text: "a medias",
      completed: false,
      outcome: { status: "interrupted" },
    });
  });

  it("treats a thrown error as interrupted and keeps the text", async () => {
    const draft = await collectDraft(stream([text("a medias")], new Error("connection reset")));

    expect(draft).toMatchObject({
      text: "a medias",
      completed: false,
      outcome: { status: "interrupted", message: "connection reset" },
    });
  });

  it("ignores anything after the ending", async () => {
    const draft = await collectDraft(stream([text("a"), completed, text("tarde")]));

    expect(draft.text).toBe("a");
    expect(draft.completed).toBe(true);
  });

  it("keeps citations, because a claim without a source can't be shown", async () => {
    const citation = { url: "https://example.com", title: "Fuente" };

    const draft = await collectDraft(stream([{ type: "citation", citation }, completed]));

    expect(draft.citations).toEqual([citation]);
  });
});

describe("unsupportedRequest", () => {
  const structured = { name: "x", schema: {} };
  const webSearch = { maxSearches: 1 };

  it("accepts what the model can do", () => {
    expect(unsupportedRequest(FULL_CAPABILITIES, { structured, webSearch })).toBeNull();
    expect(unsupportedRequest(NO_CAPABILITIES, {})).toBeNull();
    expect(
      unsupportedRequest({ ...NO_CAPABILITIES, structuredOutput: "forced_tool" }, { structured }),
    ).toBeNull();
  });

  it("names what the model can't do", () => {
    expect(unsupportedRequest(NO_CAPABILITIES, { structured })).toBe("structured_output");
    expect(unsupportedRequest(NO_CAPABILITIES, { webSearch })).toBe("web_search");
  });
});

describe("fake provider", () => {
  it("never sends a request it must refuse, so a refused search costs nothing", async () => {
    const provider = createFakeProvider();

    await collectDraft(
      provider.generate({
        model: "bare",
        instructions: "",
        input: "",
        webSearch: { maxSearches: 1 },
      }),
    );

    expect(provider.sent).toBe(0);
  });
});
