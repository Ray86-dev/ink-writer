import { describe, expect, it } from "vitest";
import {
  type AiProvider,
  type AnalysisState,
  digestScene,
  type Fact,
  fingerprint,
  type GenerateEvent,
  type GenerateRequest,
  StructuredOutputError,
  summaryBasis,
  ungroundedNames,
  validateDigest,
  withDigest,
  withoutScene,
} from "../../src/index";

const TEXT =
  "Marta Rey bajó del autobús en Puerto Viejo. Tenía los ojos verdes. Nadie la esperaba, salvo Tomás.";
const scene = { id: "s1", title: "Llegada", text: TEXT };

const fact = (id: string, entityId: string, quote: string, value: string): Fact => ({
  id,
  sceneId: "s1",
  entityId,
  category: "other",
  attribute: "dato",
  value,
  quote,
  sentence: quote,
  storyTime: null,
  inDialogue: false,
});

const state = (): AnalysisState => ({
  entities: [
    { id: "marta", type: "person", canonicalName: "Marta Rey", aliases: ["Marta"] },
    { id: "puerto", type: "place", canonicalName: "Puerto Viejo", aliases: [] },
    { id: "ines", type: "person", canonicalName: "Inés", aliases: [] },
  ],
  mentions: [],
  facts: [
    fact("f1", "marta", "Marta Rey bajó del autobús en Puerto Viejo", "llega en autobús"),
    fact("f2", "marta", "Tenía los ojos verdes", "ojos verdes"),
    fact("f3", "puerto", "bajó del autobús en Puerto Viejo", "tiene parada de autobús"),
  ],
  relations: [],
  issues: [],
  sceneOrder: ["s1"],
});

/** A model that answers with whatever the test hands it, and remembers what it was asked. */
function modelAnswering(answer: unknown) {
  const asked: GenerateRequest[] = [];
  const provider: AiProvider = {
    id: "fake",
    displayName: "Fake",
    billing: "local",
    listModels: async () => [],
    async *generate(request): AsyncGenerator<GenerateEvent> {
      asked.push(request);
      yield { type: "text", delta: typeof answer === "string" ? answer : JSON.stringify(answer) };
      yield { type: "end", outcome: { status: "completed" } };
    },
  };
  let next = 0;
  const deps = {
    provider,
    model: "m",
    language: "es",
    newId: () => {
      next += 1;
      return `p${next}`;
    },
  };
  return { deps, asked };
}

const good = {
  change: "Marta llega a Puerto Viejo y solo la espera Tomás.",
  summaries: [
    { entity: "E1", summary: "Marta Rey llega en autobús a Puerto Viejo. Tiene los ojos verdes." },
    { entity: "E2", summary: "Tiene parada de autobús." },
  ],
  questions: [{ text: "¿Quién es Tomás y por qué la espera?", quote: "salvo Tomás" }],
  suggestions: [{ text: "Describe cómo es la parada del autobús.", quote: "bajó del autobús" }],
};

describe("scene digest", () => {
  it("asks once, with the scene and the facts of the cards it touched", async () => {
    const { deps, asked } = modelAnswering(good);

    await digestScene(state(), scene, deps);

    expect(asked).toHaveLength(1);
    expect(asked[0]?.structured?.name).toBe("scene_digest");
    expect(asked[0]?.temperature).toBe(0);
    expect(asked[0]?.input).toContain(TEXT);
    expect(asked[0]?.input).toContain("E1 Marta Rey [person]");
    expect(asked[0]?.input).toContain("- dato: ojos verdes | «Tenía los ojos verdes»");
    expect(asked[0]?.input).toContain("E2 Puerto Viejo [place]");
    // A card with no facts has nothing to summarise.
    expect(asked[0]?.input).not.toContain("Inés");
  });

  it("keeps what the text backs: the change, a summary per card, the question and the task", async () => {
    const { deps } = modelAnswering(good);

    const { digest, discarded } = await digestScene(state(), scene, deps);

    expect(digest).toEqual({
      sceneId: "s1",
      note: { sceneId: "s1", change: good.change, textHash: fingerprint(TEXT) },
      summaries: [
        {
          entityId: "marta",
          text: "Marta Rey llega en autobús a Puerto Viejo. Tiene los ojos verdes.",
          basis: summaryBasis(state().facts.filter((item) => item.entityId === "marta")),
        },
        {
          entityId: "puerto",
          text: "Tiene parada de autobús.",
          basis: summaryBasis(state().facts.filter((item) => item.entityId === "puerto")),
        },
      ],
      prompts: [
        {
          id: "p1",
          sceneId: "s1",
          kind: "question",
          text: "¿Quién es Tomás y por qué la espera?",
          quote: "salvo Tomás",
        },
        {
          id: "p2",
          sceneId: "s1",
          kind: "suggestion",
          text: "Describe cómo es la parada del autobús.",
          quote: "bajó del autobús",
        },
      ],
    });
    expect(discarded).toEqual({ change: false, summaries: 0, prompts: 0 });
  });

  describe("throws away what has no origin (rule 3)", () => {
    it("a question or a task whose quote isn't literally in the scene", async () => {
      const { deps } = modelAnswering({
        ...good,
        questions: [
          { text: "¿Quién es Tomás?", quote: "excepto Tomás" },
          { text: "¿De dónde viene Marta?", quote: "bajó del autobús" },
          { text: "¿Sin cita?", quote: "" },
        ],
        suggestions: [{ text: "Describe la casa.", quote: "la casa de la abuela" }],
      });

      const { digest, discarded } = await digestScene(state(), scene, deps);

      expect(digest.prompts.map((prompt) => prompt.text)).toEqual(["¿De dónde viene Marta?"]);
      expect(discarded.prompts).toBe(3);
    });

    it("a summary that names someone its facts don't", async () => {
      const { deps } = modelAnswering({
        ...good,
        summaries: [
          { entity: "E1", summary: "Marta Rey es la hermana de Lucía. Tiene los ojos verdes." },
          { entity: "E2", summary: "Tiene parada de autobús." },
        ],
      });

      const { digest, discarded } = await digestScene(state(), scene, deps);

      expect(digest.summaries.map((summary) => summary.entityId)).toEqual(["puerto"]);
      expect(discarded.summaries).toBe(1);
    });

    it("a summary for a card it wasn't asked about, a second one for the same card, or an empty one", async () => {
      const { deps } = modelAnswering({
        ...good,
        summaries: [
          { entity: "E9", summary: "No existe." },
          { entity: "marta", summary: "Sin el id que se le dio." },
          { entity: "E1", summary: "Tiene los ojos verdes." },
          { entity: "E1", summary: "Llega en autobús." },
          { entity: "E2", summary: "   " },
        ],
      });

      const { digest, discarded } = await digestScene(state(), scene, deps);

      expect(digest.summaries).toMatchObject([
        { entityId: "marta", text: "Tiene los ojos verdes." },
      ]);
      expect(discarded.summaries).toBe(4);
    });

    it("a change that names someone the scene doesn't", async () => {
      const { deps } = modelAnswering({ ...good, change: "Marta se reencuentra con Lucía." });

      const { digest, discarded } = await digestScene(state(), scene, deps);

      expect(digest.note).toBeNull();
      expect(discarded.change).toBe(true);
    });

    it("a question that isn't one, and anything beyond the few that were asked for", async () => {
      const { deps } = modelAnswering({
        ...good,
        questions: [
          { text: "Tomás debería ser su hermano.", quote: "salvo Tomás" },
          { text: "¿Quién es Tomás?", quote: "salvo Tomás" },
          { text: "¿De dónde viene?", quote: "bajó del autobús" },
          { text: "¿Por qué nadie la espera?", quote: "Nadie la esperaba" },
        ],
        suggestions: [
          { text: "Describe la parada.", quote: "bajó del autobús" },
          { text: "Describe el pueblo.", quote: "Puerto Viejo" },
        ],
      });

      const { digest, discarded } = await digestScene(state(), scene, deps);

      expect(digest.prompts.map((prompt) => [prompt.kind, prompt.text])).toEqual([
        ["question", "¿Quién es Tomás?"],
        ["question", "¿De dónde viene?"],
        ["suggestion", "Describe la parada."],
      ]);
      expect(discarded.prompts).toBe(3);
    });
  });

  it("an empty answer is a normal one: nothing changes, nothing to ask", async () => {
    const { deps } = modelAnswering({ change: "", summaries: [], questions: [], suggestions: [] });

    const { digest, discarded } = await digestScene(state(), scene, deps);

    expect(digest).toEqual({ sceneId: "s1", note: null, summaries: [], prompts: [] });
    expect(discarded).toEqual({ change: false, summaries: 0, prompts: 0 });
  });

  it("an answer of the wrong shape gets one retry, and then it's a bad answer", async () => {
    const { deps, asked } = modelAnswering({ resumen: "no es lo pedido" });

    await expect(digestScene(state(), scene, deps)).rejects.toBeInstanceOf(StructuredOutputError);
    expect(asked).toHaveLength(2);
  });

  it("also summarises a card whose stored summary no longer matches its passages", async () => {
    const before = withDigest(state(), {
      sceneId: "s0",
      note: null,
      summaries: [
        { entityId: "ines", text: "Vieja.", basis: "of facts that are gone" },
        { entityId: "puerto", text: "Al día.", basis: summaryBasis([state().facts[2] as Fact]) },
      ],
      prompts: [],
    });
    const withInes: AnalysisState = {
      ...before,
      facts: [...before.facts, { ...fact("f4", "ines", "x", "vive lejos"), sceneId: "s0" }],
    };
    const { deps, asked } = modelAnswering({ ...good, summaries: [] });

    await digestScene(withInes, scene, deps);

    expect(asked[0]?.input).toContain("E3 Inés [person]");
  });
});

describe("digest in the state", () => {
  const first = {
    sceneId: "s1",
    note: { sceneId: "s1", change: "Llega.", textHash: "t" },
    summaries: [{ entityId: "marta", text: "Uno.", basis: "b1" }],
    prompts: [{ id: "p1", sceneId: "s1", kind: "question" as const, text: "¿?", quote: "q" }],
  };

  it("a scene's digest replaces its last one, and leaves the other scenes' alone", () => {
    const other = {
      sceneId: "s2",
      note: { sceneId: "s2", change: "Se va.", textHash: "t2" },
      summaries: [{ entityId: "puerto", text: "Dos.", basis: "b2" }],
      prompts: [],
    };
    const again = {
      sceneId: "s1",
      note: null,
      summaries: [{ entityId: "marta", text: "Tres.", basis: "b3" }],
      prompts: [],
    };

    const result = withDigest(withDigest(withDigest(state(), first), other), again);

    expect(result.digest).toEqual({
      summaries: [
        { entityId: "puerto", text: "Dos.", basis: "b2" },
        { entityId: "marta", text: "Tres.", basis: "b3" },
      ],
      notes: [{ sceneId: "s2", change: "Se va.", textHash: "t2" }],
      prompts: [],
    });
  });

  it("taking a scene out for reanalysis takes its note and prompts, and keeps the summaries", () => {
    const result = withoutScene(withDigest(state(), first), "s1");

    expect(result.digest).toEqual({
      summaries: [{ entityId: "marta", text: "Uno.", basis: "b1" }],
      notes: [],
      prompts: [],
    });
  });
});

describe("the checks behind it", () => {
  it("a fingerprint is the same for the same text and changes with any edit", () => {
    expect(fingerprint("Marta llegó.")).toBe(fingerprint("Marta llegó."));
    expect(fingerprint("Marta llegó.")).not.toBe(fingerprint("Marta llego."));
    expect(fingerprint("ab")).not.toBe(fingerprint("ba"));
    expect(fingerprint("")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("a basis depends on which passages, not on their order", () => {
    const a = { sceneId: "s1", quote: "uno" };
    const b = { sceneId: "s2", quote: "dos" };

    expect(summaryBasis([a, b])).toBe(summaryBasis([b, a]));
    expect(summaryBasis([a, b])).not.toBe(summaryBasis([a]));
    expect(summaryBasis([a])).not.toBe(summaryBasis([{ sceneId: "s2", quote: "uno" }]));
  });

  it.each([
    ["Marta llega con Lucía.", "Marta llega sola.", ["Lucía"]],
    ["Marta llega. Nadie la espera.", "marta", []],
    ["Llega a Puerto Viejo.", "puerto viejo, un lunes", []],
    ["¿Quién es Tomás? ¿Y Lucía?", "Tomás", ["Lucía"]],
    ["Vive en la Calle de la Sal.", "calle de la sal", []],
    ["Tiene ojos verdes y un perro.", "", []],
  ])("in %j, names not backed by %j: %j", (text, allowed, expected) => {
    expect(ungroundedNames(text, allowed)).toEqual(expected);
  });

  it("accepts an answer with its four parts, and says what's missing otherwise", () => {
    expect(validateDigest(good)).toMatchObject({ ok: true });
    expect(validateDigest({ summaries: [], questions: [], suggestions: [] })).toMatchObject({
      ok: true,
      value: { change: "" },
    });
    expect(validateDigest({ change: "x" })).toMatchObject({ ok: false });
    expect(validateDigest("no")).toMatchObject({ ok: false });
    // An entry of the wrong shape is dropped, not a reason to reject the rest.
    expect(
      validateDigest({
        ...good,
        questions: [
          { text: 7, quote: "q" },
          { text: "¿?", quote: "q" },
        ],
      }),
    ).toMatchObject({ ok: true, value: { questions: [{ text: "¿?", quote: "q" }] } });
  });
});
