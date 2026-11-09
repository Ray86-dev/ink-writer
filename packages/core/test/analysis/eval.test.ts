import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withCache } from "../../eval/cache";
import {
  assertAllowance,
  assertFreeModel,
  assertNoCost,
  estimateRequests,
  SpendingRefused,
} from "../../eval/guard";
import { type Expected, mergedPeople, sameQuote, scoreAnalysis } from "../../eval/score";
import {
  type AiProvider,
  type AnalysisState,
  collectDraft,
  emptyState,
  type Fact,
  type GenerateEvent,
} from "../../src/index";

const EXPECTED: Expected = {
  entities: [
    { id: "marta", names: ["Marta Rey", "Marta"] },
    { id: "tomas", names: ["Tomás"] },
    { id: "luis_cartero", names: ["Luis", "el cartero"] },
    { id: "luis_alcalde", names: ["Luis Ferrer", "el alcalde"] },
  ],
  must_resolve_reference: [
    { scene: "s1", quote: "Llegó tarde", entity: "marta" },
    { scene: "s2", quote: "lo vio", entity: "tomas" },
  ],
  must_flag: [
    {
      id: "ojos",
      category: "coherence",
      a: { scene: "s1", quote: "ojos verdes" },
      b: { scene: "s2", quote: "ojos marrones" },
    },
    {
      id: "errata",
      category: "correction",
      a: { scene: "s2", quote: "halla leído" },
      expected_fix: "haya leído",
    },
  ],
  must_not_flag: [
    {
      id: "n_dos_luis",
      namesakes: ["luis_cartero", "luis_alcalde"],
      a: { scene: "s1", quote: "Luis, el cartero" },
      b: { scene: "s1", quote: "Luis Ferrer, el alcalde" },
    },
    {
      id: "soltera",
      a: { scene: "s1", quote: "soltera" },
      b: { scene: "s2", quote: "casada" },
    },
  ],
};

const TEXTS = new Map([
  [
    "s1",
    "Llegó tarde. Tenía los ojos verdes y estaba soltera. Me la dio Luis, el cartero. Luis Ferrer, el alcalde, entró.",
  ],
  ["s2", "Sus ojos marrones. Ya casada. Inés lo vio. Cuando halla leído la carta."],
]);

function fact(sceneId: string, entityId: string, quote: string, value = "v"): Fact {
  return {
    id: `${sceneId}-${quote}`,
    sceneId,
    entityId,
    category: "other",
    attribute: "a",
    value,
    quote,
    sentence: quote,
    storyTime: null,
    inDialogue: false,
  };
}

const perfect: AnalysisState = {
  ...emptyState(["s1", "s2"]),
  entities: [
    { id: "m", type: "person", canonicalName: "Marta Rey", aliases: ["Marta"] },
    { id: "t", type: "person", canonicalName: "Tomás", aliases: [] },
    { id: "c", type: "person", canonicalName: "Luis", aliases: ["el cartero"] },
    { id: "f", type: "person", canonicalName: "Luis Ferrer", aliases: ["el alcalde"] },
  ],
  facts: [
    fact("s1", "m", "Llegó tarde"),
    fact("s2", "t", "lo vio"),
    fact("s1", "c", "Luis, el cartero"),
    fact("s1", "f", "Luis Ferrer, el alcalde"),
  ],
  issues: [
    {
      kind: "contradiction",
      a: { sceneId: "s1", quote: "ojos verdes" },
      b: { sceneId: "s2", quote: "ojos marrones" },
      reason: "r",
    },
    {
      kind: "correction",
      a: { sceneId: "s2", quote: "halla leído" },
      fix: "haya leído",
      reason: "r",
    },
  ],
};

const score = (state: AnalysisState, discarded = 0) =>
  scoreAnalysis(state, EXPECTED, TEXTS, discarded);

// The thresholds of the real fixture would ask for more than this small example has.
const metrics = (state: AnalysisState) => {
  const { mustFlag, falseAlarms, inventedQuotes, twoLuisMerged, references } = score(state);
  return {
    found: mustFlag.found,
    falseAlarms,
    inventedQuotes,
    twoLuisMerged,
    refs: references.found,
  };
};

describe("score", () => {
  it("finds everything in a perfect analysis", () => {
    expect(metrics(perfect)).toEqual({
      found: ["ojos", "errata"],
      falseAlarms: [],
      inventedQuotes: 0,
      twoLuisMerged: false,
      refs: 2,
    });
  });

  it("finds nothing in an empty analysis, and that doesn't pass", () => {
    const result = score(emptyState());

    expect(result.mustFlag.found).toEqual([]);
    expect(result.passed).toBe(false);
  });

  it("matches a pair whichever way round it comes", () => {
    const swapped: AnalysisState = {
      ...perfect,
      issues: [
        {
          kind: "contradiction",
          a: { sceneId: "s2", quote: "ojos marrones" },
          b: { sceneId: "s1", quote: "ojos verdes" },
          reason: "r",
        },
      ],
    };

    expect(score(swapped).mustFlag.found).toContain("ojos");
  });

  it("doesn't count a contradiction found in the wrong scene", () => {
    const wrong: AnalysisState = {
      ...perfect,
      issues: [
        {
          kind: "contradiction",
          a: { sceneId: "s2", quote: "ojos verdes" },
          b: { sceneId: "s2", quote: "ojos marrones" },
          reason: "r",
        },
      ],
    };

    expect(score(wrong).mustFlag.found).not.toContain("ojos");
  });

  it("doesn't count half a pair", () => {
    const half: AnalysisState = {
      ...perfect,
      issues: [
        {
          kind: "contradiction",
          a: { sceneId: "s1", quote: "ojos verdes" },
          b: { sceneId: "s2", quote: "Ya casada" },
          reason: "r",
        },
      ],
    };

    expect(score(half).mustFlag.found).not.toContain("ojos");
  });

  it("counts an evolution reported as an error as a false alarm", () => {
    const alarm: AnalysisState = {
      ...perfect,
      issues: [
        ...perfect.issues,
        {
          kind: "contradiction",
          a: { sceneId: "s1", quote: "soltera" },
          b: { sceneId: "s2", quote: "casada" },
          reason: "r",
        },
      ],
    };

    expect(score(alarm).falseAlarms).toEqual(["soltera"]);
  });

  it("doesn't count a correction with a wrong fix: it's applied with one click", async () => {
    const wrongFix: AnalysisState = {
      ...perfect,
      issues: [
        {
          kind: "correction",
          a: { sceneId: "s2", quote: "halla leído" },
          fix: "había leído",
          reason: "r",
        },
      ],
    };

    expect(score(wrongFix).mustFlag.found).not.toContain("errata");
  });

  it("takes two quotes of one sentence as one place, even with its final stop", async () => {
    const texts = new Map([["s1", "Primera frase. Marta oyó la llamada, y luego la voz."]]);
    const ref = { scene: "s1", quote: "oyó la llamada" };

    expect(sameQuote({ sceneId: "s1", quote: "luego la voz." }, ref, texts)).toBe(true);
    expect(sameQuote({ sceneId: "s1", quote: "Primera frase." }, ref, texts)).toBe(false);
  });

  it("doesn't take a correction as the contradiction it resembles, nor the other way", () => {
    const mixedUp: AnalysisState = {
      ...perfect,
      issues: [
        {
          kind: "contradiction",
          a: { sceneId: "s2", quote: "halla leído" },
          b: { sceneId: "s2", quote: "x" },
          reason: "r",
        },
      ],
    };

    expect(score(mixedUp).mustFlag.found).not.toContain("errata");
  });

  it("catches a quote kept that isn't in the scene", () => {
    const invented: AnalysisState = {
      ...perfect,
      facts: [...perfect.facts, fact("s1", "m", "algo que no dice")],
    };

    expect(score(invented).inventedQuotes).toBe(1);
    expect(score(invented).passed).toBe(false);
  });

  it("reports the discarded quotes apart, since those were caught", () => {
    expect(score(perfect, 3).discardedQuotes).toBe(3);
    expect(score(perfect, 3).inventedQuotes).toBe(0);
  });

  it("counts a reference only if it's about the right person", () => {
    const wrong: AnalysisState = {
      ...perfect,
      facts: perfect.facts.map((f) => (f.quote === "Llegó tarde" ? { ...f, entityId: "t" } : f)),
    };

    expect(score(wrong).references.found).toBe(1);
    expect(score(wrong).references.missed).toEqual(["Llegó tarde"]);
  });

  it("counts a pronoun resolved in the fact's value", () => {
    const inValue: AnalysisState = {
      ...perfect,
      facts: perfect.facts.map((f) =>
        f.quote === "lo vio" ? { ...f, entityId: "m", value: "vio a Tomás" } : f,
      ),
    };

    expect(score(inValue).references.found).toBe(2);
  });

  it("counts issues that are neither expected nor forbidden", () => {
    const extra: AnalysisState = {
      ...perfect,
      issues: [
        ...perfect.issues,
        { kind: "correction", a: { sceneId: "s1", quote: "Llegó" }, fix: "x", reason: "r" },
      ],
    };

    expect(score(extra).extraIssues).toBe(1);
  });
});

describe("the two people with one name", () => {
  it("are fine when kept apart", () => {
    expect(mergedPeople(perfect, EXPECTED)).toBe(false);
  });

  it("are merged if a name of each ends up in one entity", () => {
    const merged: AnalysisState = {
      ...perfect,
      entities: [
        { id: "f", type: "person", canonicalName: "Luis Ferrer", aliases: ["el cartero"] },
      ],
      facts: [],
    };

    expect(mergedPeople(merged, EXPECTED)).toBe(true);
  });

  it("are merged if each one's quote is attributed to the same entity, even with no alias", () => {
    // This is how the first real run went wrong, while a check of the names alone said it was fine.
    const merged: AnalysisState = {
      ...perfect,
      entities: [{ id: "f", type: "person", canonicalName: "Luis Ferrer", aliases: [] }],
      facts: [fact("s1", "f", "Luis, el cartero"), fact("s1", "f", "Luis Ferrer, el alcalde")],
    };

    expect(mergedPeople(merged, EXPECTED)).toBe(true);
  });
});

describe("sameQuote", () => {
  const ref = { scene: "s1", quote: "ojos verdes" };

  it.each([
    [{ sceneId: "s1", quote: "ojos verdes" }, true],
    [{ sceneId: "s1", quote: "los ojos verdes y" }, true],
    [{ sceneId: "s1", quote: "verdes" }, true],
    [{ sceneId: "s2", quote: "ojos verdes" }, false],
    [{ sceneId: "s1", quote: "" }, false],
    [{ sceneId: "s1", quote: "Llegó tarde" }, false],
  ])("%j: %s", (actual, expected) => {
    expect(sameQuote(actual, ref, TEXTS)).toBe(expected);
  });

  it("accepts another part of the same sentence, only if it knows the text", () => {
    const sameSentence = { sceneId: "s1", quote: "estaba soltera" };

    expect(sameQuote(sameSentence, ref, TEXTS)).toBe(true);
    expect(sameQuote(sameSentence, ref)).toBe(false);
  });
});

describe("spending guard", () => {
  const models = [
    { id: "a:free", displayName: "A", capabilities: CAPS(), free: true },
    { id: "b", displayName: "B", capabilities: CAPS(), free: false },
    { id: "c:free", displayName: "C", capabilities: CAPS() },
  ];

  function CAPS() {
    return { structuredOutput: "json_schema", webSearch: false, tools: false } as const;
  }

  it("lets a free model through", () => {
    expect(() => assertFreeModel(models, "a:free")).not.toThrow();
  });

  it.each(["b", "c:free", "unknown"])("stops %s before any request", (id) => {
    expect(() => assertFreeModel(models, id)).toThrow(SpendingRefused);
  });

  it("stops at the first answer with any cost", () => {
    expect(() => assertNoCost({ inputTokens: 1, outputTokens: 1, cost: 0.0001 })).toThrow(
      SpendingRefused,
    );
    expect(() => assertNoCost({ inputTokens: 1, outputTokens: 1, cost: 0 })).not.toThrow();
    expect(() => assertNoCost({ inputTokens: 1, outputTokens: 1, cost: null })).not.toThrow();
  });

  it("won't start a run that doesn't fit today's allowance", () => {
    const allowance = { used: 45, limit: 50, remaining: 5 };

    expect(() => assertAllowance(allowance, 6)).toThrow(SpendingRefused);
    expect(() => assertAllowance(allowance, 5)).not.toThrow();
    expect(() => assertAllowance(null, 100)).not.toThrow();
  });

  it("estimates requests by scene, on the safe side", () => {
    expect(estimateRequests(8)).toBeGreaterThanOrEqual(8 * 3);
    expect(estimateRequests(0)).toBe(0);
  });
});

describe("cache", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function counting(outcomes: readonly ("completed" | "failed")[]) {
    let calls = 0;
    const provider: AiProvider = {
      id: "fake",
      displayName: "Fake",
      billing: "local",
      listModels: async () => [],
      async *generate(): AsyncGenerator<GenerateEvent> {
        const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
        calls += 1;
        if (outcome === "completed") {
          yield { type: "text", delta: `respuesta ${calls}` };
          yield { type: "end", outcome: { status: "completed" } };
        } else {
          yield {
            type: "end",
            outcome: { status: "failed", error: { code: "429", message: "limit" } },
          };
        }
      },
    };
    return { provider, calls: () => calls };
  }

  const fresh = () => {
    const directory = mkdtempSync(join(tmpdir(), "ink-cache-"));
    directories.push(directory);
    return directory;
  };

  const request = { model: "m", instructions: "i", input: "x" };

  it("never asks the same thing twice, so the daily allowance lasts", async () => {
    const { provider, calls } = counting(["completed"]);
    const cached = withCache(provider, fresh());

    const first = await collectDraft(cached.generate(request));
    const second = await collectDraft(cached.generate(request));

    expect(calls()).toBe(1);
    expect(second.text).toBe(first.text);
    expect(second.completed).toBe(true);
    expect(cached.stats).toEqual({ hits: 1, misses: 1 });
  });

  it("asks again when anything in the request changes", async () => {
    const { provider, calls } = counting(["completed"]);
    const cached = withCache(provider, fresh());

    await collectDraft(cached.generate(request));
    await collectDraft(cached.generate({ ...request, input: "otra" }));
    await collectDraft(cached.generate({ ...request, model: "n" }));
    await collectDraft(cached.generate({ ...request, reasoning: "off" }));

    expect(calls()).toBe(4);
  });

  it("doesn't remember a failure: it must be tried again", async () => {
    const { provider, calls } = counting(["failed", "completed"]);
    const directory = fresh();
    const cached = withCache(provider, directory);

    const failed = await collectDraft(cached.generate(request));
    expect(failed.completed).toBe(false);
    expect(readdirSync(directory)).toEqual([]);

    const retried = await collectDraft(cached.generate(request));
    expect(retried.completed).toBe(true);
    expect(calls()).toBe(2);
  });

  it("in cache-only mode never asks, so that scoring again can't use up the allowance", async () => {
    const { provider, calls } = counting(["completed"]);
    const directory = fresh();
    await collectDraft(withCache(provider, directory).generate(request));

    const scoring = withCache(provider, directory, true);
    const known = await collectDraft(scoring.generate(request));
    const unknown = await collectDraft(scoring.generate({ ...request, input: "otra" }));

    expect(known.completed).toBe(true);
    expect(unknown.outcome).toMatchObject({ status: "failed", error: { code: "not_cached" } });
    expect(calls()).toBe(1);
  });

  it("is kept on disk, for the next run", async () => {
    const { provider, calls } = counting(["completed"]);
    const directory = fresh();

    await collectDraft(withCache(provider, directory).generate(request));
    await collectDraft(withCache(provider, directory).generate(request));

    expect(calls()).toBe(1);
  });
});
