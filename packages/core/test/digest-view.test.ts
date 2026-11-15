import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  type AiProvider,
  AnalysisQueue,
  type AnalysisState,
  type AuthorOverride,
  buildHints,
  buildNovelView,
  DEFAULT_HINT_SETTINGS,
  type Fact,
  fingerprint,
  type GenerateEvent,
  type HintSettings,
  loadNovelView,
  NO_HINT_STATES,
  nextTask,
  openSqlStorage,
  type SceneText,
  type Storage,
  summaryBasis,
} from "../src/index";
import { createNodeSqliteDriver } from "./support/node-sqlite-driver";
import { writeParagraphs } from "./support/prose";

const TEXT_1 = "Marta tenía los ojos verdes. Llegó en autobús. Nadie la esperaba, salvo Tomás.";
const TEXT_2 = "Marta abrió la farmacia.";

const scenes = (one = TEXT_1, two = TEXT_2): SceneText[] => [
  { id: "s1", title: "Escena 1", chapterId: "c1", chapterTitle: "Capítulo 1", text: one },
  { id: "s2", title: "Escena 2", chapterId: "c1", chapterTitle: "Capítulo 1", text: two },
];

const fact = (id: string, sceneId: string, entityId: string, quote: string): Fact => ({
  id,
  sceneId,
  entityId,
  category: "other",
  attribute: "a",
  value: "v",
  quote,
  sentence: quote,
  storyTime: null,
  inDialogue: false,
});

const martaFacts = [
  fact("f1", "s1", "marta", "Marta tenía los ojos verdes"),
  fact("f2", "s1", "marta", "Llegó en autobús"),
  fact("f3", "s2", "marta", "Marta abrió la farmacia"),
];

const analysis = (): AnalysisState => ({
  entities: [
    { id: "marta", type: "person", canonicalName: "Marta", aliases: [] },
    { id: "tomas", type: "person", canonicalName: "Tomás", aliases: [] },
  ],
  mentions: [{ sceneId: "s1", entityId: "tomas", quote: "Tomás" }],
  facts: martaFacts,
  relations: [],
  issues: [],
  sceneOrder: ["s1", "s2"],
  digest: {
    summaries: [
      {
        entityId: "marta",
        text: "Marta tiene los ojos verdes y abre la farmacia.",
        basis: summaryBasis(martaFacts),
      },
    ],
    notes: [
      { sceneId: "s1", change: "Marta llega.", textHash: fingerprint(TEXT_1) },
      { sceneId: "s2", change: "Marta abre la farmacia.", textHash: fingerprint(TEXT_2) },
    ],
    prompts: [
      {
        id: "p2",
        sceneId: "s2",
        kind: "suggestion",
        text: "Describe la farmacia.",
        quote: "la farmacia",
      },
      { id: "p1", sceneId: "s1", kind: "question", text: "¿Quién es Tomás?", quote: "salvo Tomás" },
    ],
  },
});

const view = (texts = scenes(), overrides: AuthorOverride[] = [], state = analysis()) =>
  buildNovelView({ analysis: state, overrides, scenes: texts });
const marta = (novel: ReturnType<typeof view>) => novel.cards.find((card) => card.id === "marta");
const settings = (changes: Partial<HintSettings> = {}): HintSettings => ({
  ...DEFAULT_HINT_SETTINGS,
  ...changes,
});
const by = (override: AuthorOverride["override"], at = 1): AuthorOverride => ({
  id: `o${at}`,
  createdAt: at,
  override,
});

describe("what the model wrote, in the cards", () => {
  it("shows a card's summary while the card shows the passages it was written from", () => {
    expect(marta(view())?.summary).toBe("Marta tiene los ojos verdes y abre la farmacia.");
  });

  describe("and takes it away as soon as those passages change (rule 3)", () => {
    it("when the author deletes one of them, without waiting for any analysis", () => {
      const edited = scenes(TEXT_1.replace(" Llegó en autobús.", ""));

      expect(marta(view(edited))?.summary).toBeNull();
      // The card is still there, with what's left.
      expect(marta(view(edited))?.facts.map((item) => item.quote)).toEqual([
        "Marta tenía los ojos verdes",
        "Marta abrió la farmacia",
      ]);
    });

    it("when the author says one of them isn't right", () => {
      const dismissed = [by({ kind: "dismiss", entityId: "marta", quote: "Llegó en autobús" })];

      expect(marta(view(scenes(), dismissed))?.summary).toBeNull();
    });

    it("when another card is merged into it, bringing passages the summary never saw", () => {
      const state = analysis();
      const withOther: AnalysisState = {
        ...state,
        entities: [
          ...state.entities,
          { id: "doc", type: "person", canonicalName: "La doctora", aliases: [] },
        ],
        facts: [...state.facts, fact("f9", "s2", "doc", "abrió la farmacia")],
      };

      expect(marta(view(scenes(), [], withOther))?.summary).not.toBeNull();
      expect(
        marta(view(scenes(), [by({ kind: "merge", from: "doc", into: "marta" })], withOther))
          ?.summary,
      ).toBeNull();
    });

    it("when a new analysis adds a passage", () => {
      const state = analysis();
      const more: AnalysisState = {
        ...state,
        facts: [...state.facts, fact("f4", "s1", "marta", "Nadie la esperaba")],
      };

      expect(marta(view(scenes(), [], more))?.summary).toBeNull();
    });
  });

  it("a card with no summary written has none, and never one written for another card", () => {
    expect(view().cards.find((card) => card.id === "tomas")?.summary).toBeNull();
  });

  it("the chapter says what changes in each scene, only for scenes whose text is still that text", () => {
    expect(view().chapters[0]?.changes).toEqual([
      { sceneId: "s1", sceneTitle: "Escena 1", change: "Marta llega." },
      { sceneId: "s2", sceneTitle: "Escena 2", change: "Marta abre la farmacia." },
    ]);

    const edited = scenes(TEXT_1, `${TEXT_2} Luego la cerró.`);
    expect(view(edited).chapters[0]?.changes).toEqual([
      { sceneId: "s1", sceneTitle: "Escena 1", change: "Marta llega." },
    ]);
  });

  it("lists questions and tasks in reading order, and drops one whose passage is gone", () => {
    expect(
      view().prompts.map((prompt) => [prompt.kind, prompt.text, prompt.at.sceneTitle]),
    ).toEqual([
      ["question", "¿Quién es Tomás?", "Escena 1"],
      ["suggestion", "Describe la farmacia.", "Escena 2"],
    ]);

    const edited = scenes(TEXT_1.replace(", salvo Tomás", ""));
    expect(view(edited).prompts.map((prompt) => prompt.kind)).toEqual(["suggestion"]);
  });

  it("a novel analysed before any of this was written simply has none of it", () => {
    const { digest: _digest, ...old } = analysis();
    const novel = view(scenes(), [], old);

    expect(marta(novel)?.summary).toBeNull();
    expect(novel.chapters[0]?.changes).toEqual([]);
    expect(novel.prompts).toEqual([]);
  });
});

describe("questions and tasks as hints", () => {
  it("are hints of their own kinds, shown whole, each with its passage", () => {
    const hints = buildHints(view(), settings());

    expect(
      hints.map((hint) => [hint.type, hint.kind, hint.reason, hint.at.quote, hint.step]),
    ).toEqual([
      ["questions", "question", "¿Quién es Tomás?", "salvo Tomás", 3],
      ["suggestions", "suggestion", "Describe la farmacia.", "la farmacia", 3],
    ]);
  });

  it("follow their switches, and off means none", () => {
    const types = { ...DEFAULT_HINT_SETTINGS.types, questions: false };

    expect(buildHints(view(), settings({ types })).map((hint) => hint.kind)).toEqual([
      "suggestion",
    ]);
    expect(buildHints(view(), settings({ level: "off" }))).toEqual([]);
  });

  it("a “not useful” still stands if the model words the same thing differently next time", () => {
    const [question] = buildHints(view(), settings());
    const decided = {
      ...NO_HINT_STATES,
      decisions: new Map([[question?.key ?? "", "not_useful" as const]]),
    };
    const state = analysis();
    const reworded: AnalysisState = {
      ...state,
      digest: {
        ...(state.digest as NonNullable<AnalysisState["digest"]>),
        prompts: [
          {
            id: "new",
            sceneId: "s1",
            kind: "question",
            text: "¿Qué pinta Tomás aquí?",
            quote: "salvo Tomás",
          },
        ],
      },
    };

    expect(buildHints(view(scenes(), [], reworded), settings(), decided)).toEqual([]);
  });

  it("a task proposed by the model becomes the next step, of the kind “write”", () => {
    const novel = view();
    const base = settings();
    const task = nextTask({
      view: novel,
      hints: buildHints(novel, base),
      settings: base,
      scenes: [],
      today: "2026-11-15",
    });

    expect(task).toMatchObject({ kind: "write", hint: { reason: "Describe la farmacia." } });
  });

  it("no writing task with suggestions switched off or hints off", () => {
    const novel = view();
    for (const quiet of [
      settings({ types: { ...DEFAULT_HINT_SETTINGS.types, suggestions: false } }),
      settings({ level: "off" }),
    ]) {
      expect(
        nextTask({
          view: novel,
          hints: buildHints(novel, quiet),
          settings: quiet,
          scenes: [],
          today: "2026-11-15",
        }),
      ).toBeNull();
    }
  });
});

describe("the queue digests what it analyses", () => {
  let driver: ReturnType<typeof createNodeSqliteDriver>;
  let storage: Storage;
  let projectId: string;
  let sceneId: string;
  const prose = "Marta llegó a Puerto Viejo. Nadie la esperaba.";

  /** Analyses with one fact per scene, and digests as told. */
  function model(digest: unknown) {
    const asked: string[] = [];
    const provider: AiProvider = {
      id: "fake",
      displayName: "Fake",
      billing: "local",
      listModels: async () => [],
      async *generate(request): AsyncGenerator<GenerateEvent> {
        const name = request.structured?.name ?? "";
        asked.push(name);
        const answer =
          name === "scene_extraction"
            ? {
                entities: [{ name: "Marta", type: "person", aliases: [] }],
                facts: [
                  {
                    entity: "Marta",
                    category: "action",
                    attribute: "llegada",
                    value: "llega a Puerto Viejo",
                    quote: "Marta llegó a Puerto Viejo",
                    story_time: null,
                  },
                ],
                relations: [],
              }
            : name === "proofreading"
              ? { corrections: [] }
              : name === "comparison"
                ? { findings: [] }
                : name === "scene_digest"
                  ? digest
                  : { answers: [] };
        yield { type: "text", delta: typeof answer === "string" ? answer : JSON.stringify(answer) };
        yield { type: "end", outcome: { status: "completed" } };
      },
    };
    return { provider, asked };
  }

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    ({ storage } = await openSqlStorage(driver));
    projectId = (await storage.createProject({ title: "T", language: "es", era: "e" })).id;
    const chapter = await storage.createChapter(projectId, "C");
    sceneId = (await storage.createScene(chapter.id, "S")).id;
    const doc = new Y.Doc();
    writeParagraphs(doc, [prose]);
    await storage.appendSceneUpdate(sceneId, Y.encodeStateAsUpdate(doc));
    doc.destroy();
  });

  afterEach(() => driver.close());

  const run = (provider: AiProvider) =>
    new AnalysisQueue({
      storage,
      projectId,
      analysis: { provider, model: "m", language: "es" },
    }).run();

  it("and the summary, the change and the question reach the cards", async () => {
    const { provider, asked } = model({
      change: "Marta llega a Puerto Viejo.",
      summaries: [{ entity: "E1", summary: "Marta llega a Puerto Viejo." }],
      questions: [{ text: "¿Por qué nadie la esperaba?", quote: "Nadie la esperaba" }],
      suggestions: [],
    });

    const result = await run(provider);

    expect(result).toMatchObject({ status: "done", analyzed: [sceneId] });
    expect(asked.filter((name) => name === "scene_digest")).toHaveLength(1);
    const novel = await loadNovelView(storage, projectId);
    expect(novel.cards[0]).toMatchObject({ name: "Marta", summary: "Marta llega a Puerto Viejo." });
    expect(novel.chapters[0]?.changes.map((item) => item.change)).toEqual([
      "Marta llega a Puerto Viejo.",
    ]);
    expect(novel.prompts.map((prompt) => prompt.text)).toEqual(["¿Por qué nadie la esperaba?"]);
  });

  it("a digest the model can't give leaves the analysis standing, with the scene done", async () => {
    const { provider, asked } = model("no es json");

    const result = await run(provider);

    expect(result).toMatchObject({ status: "done", analyzed: [sceneId], skipped: [], pending: 0 });
    // One retry, as with any answer of the wrong shape, and no more.
    expect(asked.filter((name) => name === "scene_digest")).toHaveLength(2);
    const novel = await loadNovelView(storage, projectId);
    expect(novel.cards[0]).toMatchObject({ name: "Marta", summary: null });
    // This stand-in model repeats its one fact on the second reading, so only what's there counts.
    expect(new Set(novel.cards[0]?.facts.map((item) => item.quote))).toEqual(
      new Set(["Marta llegó a Puerto Viejo"]),
    );
  });
});
