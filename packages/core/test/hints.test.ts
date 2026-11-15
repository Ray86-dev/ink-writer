import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AnalysisState,
  buildHints,
  buildNovelView,
  DEFAULT_HINT_SETTINGS,
  dayOf,
  type HintSettings,
  type HintStates,
  hintKey,
  loadHintSettings,
  loadHintStates,
  NO_HINT_STATES,
  nextTask,
  openSqlStorage,
  type SceneText,
  type Storage,
  saveHintSettings,
  toHintStates,
} from "../src/index";
import { createNodeSqliteDriver } from "./support/node-sqlite-driver";

const TEXT_1 = "Marta tenía los ojos verdes. Tomás llegó. Haber si viene Inés.";
const TEXT_2 = "Marta tenía los ojos marrones. Thomas saludó a Inés.";

const scenes = (one = TEXT_1, two = TEXT_2): SceneText[] => [
  { id: "s1", title: "Escena 1", chapterId: "c1", chapterTitle: "Capítulo 1", text: one },
  { id: "s2", title: "Escena 2", chapterId: "c2", chapterTitle: "Capítulo 2", text: two },
];

const analysis = (): AnalysisState => ({
  entities: [
    { id: "marta", type: "person", canonicalName: "Marta", aliases: [] },
    { id: "tomas", type: "person", canonicalName: "Tomás", aliases: [] },
    { id: "thomas", type: "person", canonicalName: "Thomas", aliases: [] },
    { id: "ines", type: "person", canonicalName: "Inés", aliases: [] },
  ],
  mentions: [
    { sceneId: "s1", entityId: "marta", quote: "Marta" },
    { sceneId: "s1", entityId: "tomas", quote: "Tomás" },
    { sceneId: "s2", entityId: "thomas", quote: "Thomas" },
    { sceneId: "s1", entityId: "ines", quote: "Inés" },
    { sceneId: "s2", entityId: "ines", quote: "Inés" },
  ],
  facts: [
    {
      id: "f1",
      sceneId: "s1",
      entityId: "marta",
      category: "physical",
      attribute: "eyes",
      value: "verdes",
      quote: "los ojos verdes",
      sentence: "Marta tenía los ojos verdes.",
      storyTime: null,
      inDialogue: false,
    },
    {
      id: "f2",
      sceneId: "s2",
      entityId: "marta",
      category: "physical",
      attribute: "eyes",
      value: "marrones",
      quote: "los ojos marrones",
      sentence: "Marta tenía los ojos marrones.",
      storyTime: null,
      inDialogue: false,
    },
  ],
  relations: [],
  issues: [
    // Stored with the later passage first, as an analysis may.
    {
      kind: "contradiction",
      a: { sceneId: "s2", quote: "los ojos marrones" },
      b: { sceneId: "s1", quote: "los ojos verdes" },
      reason: "Los ojos cambian de color.",
    },
    {
      kind: "name_variant",
      a: { sceneId: "s1", quote: "Tomás" },
      b: { sceneId: "s2", quote: "Thomas" },
      reason: "Pueden ser el mismo nombre.",
    },
    {
      kind: "correction",
      a: { sceneId: "s1", quote: "Haber si" },
      fix: "A ver si",
      reason: "Se escribe «a ver».",
    },
  ],
  sceneOrder: ["s1", "s2"],
});

const view = (texts = scenes(), state = analysis()) =>
  buildNovelView({ analysis: state, overrides: [], scenes: texts });

const settings = (changes: Partial<HintSettings> = {}): HintSettings => ({
  ...DEFAULT_HINT_SETTINGS,
  ...changes,
});
const only = (...types: (keyof HintSettings["types"])[]): HintSettings["types"] => ({
  coherence: types.includes("coherence"),
  corrections: types.includes("corrections"),
  questions: types.includes("questions"),
  suggestions: types.includes("suggestions"),
  documentation: types.includes("documentation"),
});
const states = (changes: Partial<HintStates>): HintStates => ({ ...NO_HINT_STATES, ...changes });
const sceneList = (...empty: boolean[]) =>
  empty.map((isEmpty, index) => ({
    id: `s${index + 1}`,
    title: `Escena ${index + 1}`,
    chapterTitle: "Capítulo 1",
    empty: isEmpty,
  }));

describe("hints", () => {
  it("come from what's open, in the order the text reaches them", () => {
    const hints = buildHints(view(), settings());

    expect(hints.map((hint) => [hint.kind, hint.type, hint.at.quote, hint.other?.quote])).toEqual([
      ["correction", "corrections", "Haber si", undefined],
      ["contradiction", "coherence", "los ojos marrones", "los ojos verdes"],
      ["name_variant", "coherence", "Thomas", "Tomás"],
    ]);
  });

  it("mark the later passage, where the reader would notice, whichever way it was stored", () => {
    const [, contradiction] = buildHints(view(), settings());

    expect(contradiction?.at).toMatchObject({ sceneId: "s2", sceneTitle: "Escena 2" });
    expect(contradiction?.other).toMatchObject({ sceneId: "s1", chapterTitle: "Capítulo 1" });
    expect(contradiction?.reason).toBe("Los ojos cambian de color.");
  });

  it("carry what a correction would put instead", () => {
    const [correction] = buildHints(view(), settings());

    expect(correction).toMatchObject({ fix: "A ver si", other: null });
  });

  it("start at the vaguest step, and stay as far as the author revealed them", () => {
    const hints = buildHints(view(), settings());
    const key = hints[1]?.key ?? "";

    expect(hints.map((hint) => hint.step)).toEqual([1, 1, 1]);
    const revealed = buildHints(view(), settings(), states({ steps: new Map([[key, 2]]) }));
    expect(revealed.map((hint) => hint.step)).toEqual([1, 2, 1]);
  });

  describe("off means nothing at all (M5's exit condition)", () => {
    it("no hints, whatever is open", () => {
      expect(buildHints(view(), settings({ level: "off" }))).toEqual([]);
    });

    it("no task either", () => {
      const off = settings({ level: "off" });

      expect(
        nextTask({
          view: view(),
          hints: buildHints(view(), settings()),
          settings: off,
          scenes: sceneList(false, true, false),
          today: "2026-11-15",
        }),
      ).toBeNull();
    });

    it("and the cards are still all there", () => {
      expect(view().cards.map((card) => card.name)).toEqual(["Inés", "Marta", "Thomas", "Tomás"]);
      expect(view().issues).toHaveLength(3);
    });
  });

  it.each(["on_demand", "discreet", "companion"] as const)(
    "at the %s level the same hints exist: the level only changes how they're shown",
    (level) => {
      expect(buildHints(view(), settings({ level }))).toHaveLength(3);
    },
  );

  it("each kind has its own switch", () => {
    expect(
      buildHints(view(), settings({ types: only("corrections") })).map((hint) => hint.kind),
    ).toEqual(["correction"]);
    expect(
      buildHints(view(), settings({ types: only("coherence") })).map((hint) => hint.kind),
    ).toEqual(["contradiction", "name_variant"]);
    expect(buildHints(view(), settings({ types: only("questions", "documentation") }))).toEqual([]);
  });

  it("a hint closes by itself when the text that caused it is gone", () => {
    const fixed = scenes(TEXT_1.replace("Haber si", "A ver si"));
    expect(buildHints(view(fixed), settings()).map((hint) => hint.kind)).toEqual([
      "contradiction",
      "name_variant",
    ]);

    const rewritten = scenes(TEXT_1, TEXT_2.replace("los ojos marrones", "los ojos verdes"));
    expect(buildHints(view(rewritten), settings()).map((hint) => hint.kind)).toEqual([
      "correction",
      "name_variant",
    ]);
  });

  describe("what the author decided", () => {
    it("closes the hint", () => {
      const [correction, contradiction] = buildHints(view(), settings());
      const decided = states({
        decisions: new Map([
          [correction?.key ?? "", "leave"],
          [contradiction?.key ?? "", "intentional"],
        ]),
      });

      expect(buildHints(view(), settings(), decided).map((hint) => hint.kind)).toEqual([
        "name_variant",
      ]);
    });

    it("survives a reanalysis that finds the same thing again, the other way round", () => {
      const [, contradiction] = buildHints(view(), settings());
      const decided = states({ decisions: new Map([[contradiction?.key ?? "", "intentional"]]) });
      const state = analysis();
      const again: AnalysisState = {
        ...state,
        issues: state.issues.map((issue) =>
          issue.kind === "contradiction"
            ? { ...issue, a: issue.b, b: issue.a, reason: "Dicho de otra forma." }
            : issue,
        ),
      };

      expect(
        buildHints(view(scenes(), again), settings(), decided).map((hint) => hint.kind),
      ).toEqual(["correction", "name_variant"]);
    });

    it("doesn't close another hint about other text", () => {
      const state = analysis();
      const other: AnalysisState = {
        ...state,
        issues: [
          {
            kind: "contradiction",
            a: { sceneId: "s1", quote: "Tomás llegó" },
            b: { sceneId: "s2", quote: "los ojos marrones" },
            reason: "Otra cosa.",
          },
        ],
      };
      const [original] = buildHints(view(), settings({ types: only("coherence") }));
      const decided = states({ decisions: new Map([[original?.key ?? "", "intentional"]]) });

      expect(buildHints(view(scenes(), other), settings(), decided)).toHaveLength(1);
    });
  });

  it("the key depends on the passages and not on which is cited first", () => {
    const a = { sceneId: "s1", sceneTitle: "", chapterTitle: "", quote: "uno" };
    const b = { sceneId: "s2", sceneTitle: "", chapterTitle: "", quote: "dos" };

    expect(hintKey({ kind: "contradiction", a, b })).toBe(
      hintKey({ kind: "contradiction", a: b, b: a }),
    );
    expect(hintKey({ kind: "contradiction", a, b })).not.toBe(
      hintKey({ kind: "name_variant", a, b }),
    );
    expect(hintKey({ kind: "correction", a, b: null })).not.toBe(
      hintKey({ kind: "correction", a: b, b: null }),
    );
  });
});

describe("the next step", () => {
  const input = (changes: Partial<Parameters<typeof nextTask>[0]> = {}) => {
    const base = settings();
    return {
      view: view(),
      hints: buildHints(view(), base),
      settings: base,
      scenes: sceneList(false, false),
      today: "2026-11-15",
      ...changes,
    };
  };

  it("is one task, and what's unresolved goes first", () => {
    const task = nextTask(input());

    expect(task).toMatchObject({ kind: "resolve", hint: { kind: "contradiction" } });
  });

  it("asks to define a card the text names in several scenes and says nothing about", () => {
    const task = nextTask(input({ hints: [] }));

    expect(task).toMatchObject({ kind: "define", card: { name: "Inés" }, scenes: 2 });
  });

  it("asks to complete a scene left empty between written ones, and not the ones still to come", () => {
    const nothingElse = { hints: [], view: view(scenes(), { ...analysis(), mentions: [] }) };

    expect(
      nextTask(input({ ...nothingElse, scenes: sceneList(false, true, false, true) })),
    ).toMatchObject({
      kind: "complete",
      scene: { id: "s2", title: "Escena 2" },
    });
    expect(
      nextTask(input({ ...nothingElse, scenes: sceneList(false, false, true, true) })),
    ).toBeNull();
    expect(nextTask(input({ ...nothingElse, scenes: sceneList(true, true) }))).toBeNull();
  });

  it("is nothing when there's nothing to propose: the app never makes one up", () => {
    const quiet = view(scenes(), { ...analysis(), issues: [], mentions: [] });

    expect(nextTask(input({ view: quiet, hints: [] }))).toBeNull();
  });

  it("“this one isn't useful” moves on to the next, for good", () => {
    const first = nextTask(input());
    const dismissed = states({ decisions: new Map([[first?.key ?? "", "not_useful"]]) });

    const second = nextTask(input({ states: dismissed }));

    expect(second).toMatchObject({ kind: "resolve", hint: { kind: "name_variant" } });
    // Dismissing the task leaves the hint itself open.
    expect(buildHints(view(), settings(), dismissed)).toHaveLength(3);
  });

  it("“today I only want to write” means none today, and they're back tomorrow", () => {
    const quiet = settings({ noTasksOn: "2026-11-15" });

    expect(nextTask(input({ settings: quiet }))).toBeNull();
    expect(nextTask(input({ settings: quiet, today: "2026-11-16" }))).not.toBeNull();
  });

  it("follows the switches: no questions means no “define”, no suggestions no “complete”", () => {
    const base = { hints: [], scenes: sceneList(false, true, false) };

    expect(
      nextTask(input({ ...base, settings: settings({ types: only("suggestions") }) })),
    ).toMatchObject({
      kind: "complete",
    });
    expect(
      nextTask(input({ ...base, settings: settings({ types: only("questions") }) })),
    ).toMatchObject({
      kind: "define",
    });
    expect(
      nextTask(input({ ...base, settings: settings({ types: only("corrections") }) })),
    ).toBeNull();
  });

  it("names the day in local time", () => {
    expect(dayOf(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(dayOf(new Date(2026, 10, 15, 0, 0))).toBe("2026-11-15");
  });
});

describe("stored hint settings and states", () => {
  let driver: ReturnType<typeof createNodeSqliteDriver>;
  let storage: Storage;
  let projectId: string;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    ({ storage } = await openSqlStorage(driver));
    projectId = (await storage.createProject({ title: "T", language: "es", era: "e" })).id;
  });

  afterEach(() => driver.close());

  it("discreet and everything on until the author says otherwise", async () => {
    await expect(loadHintSettings(storage)).resolves.toEqual(DEFAULT_HINT_SETTINGS);
    expect(DEFAULT_HINT_SETTINGS.level).toBe("discreet");
  });

  it("keep the level, each switch and the quiet day", async () => {
    const chosen: HintSettings = {
      level: "companion",
      types: only("coherence", "documentation"),
      noTasksOn: "2026-11-15",
    };

    await saveHintSettings(storage, chosen);

    await expect(loadHintSettings(storage)).resolves.toEqual(chosen);
  });

  it.each([
    ["not json", DEFAULT_HINT_SETTINGS],
    ["[]", DEFAULT_HINT_SETTINGS],
    ['{"level":"loud"}', DEFAULT_HINT_SETTINGS],
    ['{"level":"off","types":"all"}', { ...DEFAULT_HINT_SETTINGS, level: "off" }],
    [
      '{"level":"off","types":{"coherence":false,"corrections":"no"},"noTasksOn":7}',
      {
        level: "off",
        types: { ...DEFAULT_HINT_SETTINGS.types, coherence: false },
        noTasksOn: null,
      },
    ],
  ])("reads %s field by field, falling back to the default of each", async (stored, expected) => {
    await storage.setSetting("hints", stored);

    await expect(loadHintSettings(storage)).resolves.toEqual(expected);
  });

  it("a hint revealed further never goes back to showing less", async () => {
    await storage.revealHint(projectId, "k", 2);
    await storage.revealHint(projectId, "k", 3);
    await storage.revealHint(projectId, "k", 2);

    expect((await loadHintStates(storage, projectId)).steps.get("k")).toBe(3);
  });

  it("deciding keeps how far it was revealed, and can be taken back", async () => {
    await storage.revealHint(projectId, "k", 2);
    await storage.decideHint(projectId, "k", "intentional");
    await storage.decideHint(projectId, "other", "leave");

    let loaded = await loadHintStates(storage, projectId);
    expect([...loaded.decisions]).toEqual([
      ["k", "intentional"],
      ["other", "leave"],
    ]);
    expect(loaded.steps.get("k")).toBe(2);

    await storage.decideHint(projectId, "k", null);
    loaded = await loadHintStates(storage, projectId);
    expect([...loaded.decisions]).toEqual([["other", "leave"]]);
    expect(loaded.steps.get("k")).toBe(2);
  });

  it("belong to their novel", async () => {
    const other = (await storage.createProject({ title: "O", language: "es", era: "e" })).id;
    await storage.decideHint(projectId, "k", "intentional");

    expect((await loadHintStates(storage, other)).decisions.size).toBe(0);
  });

  it("are untouched by saving an analysis", async () => {
    const chapter = await storage.createChapter(projectId, "C");
    const scene = await storage.createScene(chapter.id, "S");
    await storage.decideHint(projectId, "k", "intentional");

    await storage.saveSceneAnalysis(projectId, scene.id, "h", {
      entities: [],
      mentions: [],
      facts: [],
      relations: [],
      issues: [],
      sceneOrder: [scene.id],
    });

    expect((await loadHintStates(storage, projectId)).decisions.get("k")).toBe("intentional");
  });

  it("ignores a stored decision or step it doesn't know", () => {
    const read = toHintStates([
      { key: "a", step: 9, decision: "whatever" },
      { key: "b", step: 1, decision: null },
    ]);

    expect(read.decisions.size).toBe(0);
    expect(read.steps.size).toBe(0);
  });
});
