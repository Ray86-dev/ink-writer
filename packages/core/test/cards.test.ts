import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AnalysisState,
  type AuthorOverride,
  addOverride,
  applyOverrides,
  buildNovelView,
  createNameFinder,
  type Entity,
  type Fact,
  knownNames,
  loadNovelView,
  loadOverrides,
  type Override,
  openSqlStorage,
  parseOverride,
  type SceneText,
  type Storage,
} from "../src/index";
import { createNodeSqliteDriver } from "./support/node-sqlite-driver";

const TEXT_1 =
  "Marta Rey bajó del autobús en Puerto Viejo. Tenía los ojos verdes. Tomás, su hermano, la esperaba.";
const TEXT_2 =
  "La doctora llegó tarde a la Calle de la Sal. Marta tenía los ojos marrones. Luis, el cartero, saludó a Luis Ferrer.";

const scenes = (one = TEXT_1, two = TEXT_2): SceneText[] => [
  { id: "s1", title: "Escena 1", chapterId: "c1", chapterTitle: "Capítulo 1", text: one },
  { id: "s2", title: "Escena 2", chapterId: "c2", chapterTitle: "Capítulo 2", text: two },
];

const entity = (
  id: string,
  name: string,
  type: Entity["type"],
  aliases: string[] = [],
): Entity => ({
  id,
  type,
  canonicalName: name,
  aliases,
});

const fact = (
  id: string,
  sceneId: string,
  entityId: string,
  quote: string,
  sentence: string,
): Fact => ({
  id,
  sceneId,
  entityId,
  category: "physical",
  attribute: "a",
  value: "v",
  quote,
  sentence,
  storyTime: null,
  inDialogue: false,
});

const analysis = (): AnalysisState => ({
  entities: [
    entity("marta", "Marta Rey", "person", ["Marta", "la doctora"]),
    entity("tomas", "Tomás", "person"),
    entity("puerto", "Puerto Viejo", "place"),
    entity("calle", "Calle de la Sal", "place"),
    entity("luis", "Luis", "person", ["Luis Ferrer"]),
    entity("ghost", "Nadie", "person"),
  ],
  mentions: [
    { sceneId: "s1", entityId: "marta", quote: "Marta Rey" },
    { sceneId: "s1", entityId: "tomas", quote: "Tomás" },
    { sceneId: "s1", entityId: "puerto", quote: "Puerto Viejo" },
    { sceneId: "s2", entityId: "marta", quote: "Marta" },
    { sceneId: "s2", entityId: "marta", quote: "La doctora" },
    { sceneId: "s2", entityId: "calle", quote: "Calle de la Sal" },
    { sceneId: "s2", entityId: "luis", quote: "Luis" },
    { sceneId: "s2", entityId: "luis", quote: "Luis Ferrer" },
  ],
  facts: [
    fact("f2", "s2", "marta", "los ojos marrones", "Marta tenía los ojos marrones."),
    fact("f1", "s1", "marta", "los ojos verdes", "Tenía los ojos verdes."),
    fact("f0", "s1", "marta", "bajó del autobús", "Marta Rey bajó del autobús en Puerto Viejo."),
    fact("f3", "s2", "luis", "el cartero", "Luis, el cartero, saludó a Luis Ferrer."),
    {
      ...fact("f4", "s1", "tomas", "la esperaba", "Tomás, su hermano, la esperaba."),
      storyTime: "al atardecer",
    },
  ],
  relations: [
    {
      id: "r1",
      sceneId: "s1",
      fromEntityId: "tomas",
      toEntityId: "marta",
      label: "hermano de",
      quote: "Tomás, su hermano",
    },
  ],
  issues: [
    {
      kind: "contradiction",
      a: { sceneId: "s1", quote: "los ojos verdes" },
      b: { sceneId: "s2", quote: "los ojos marrones" },
      reason: "color de ojos",
    },
  ],
  sceneOrder: ["s1", "s2"],
});

let clock = 0;
const by = (override: Override): AuthorOverride => {
  clock += 1;
  return { id: `o${clock}`, createdAt: clock, override };
};

const view = (overrides: AuthorOverride[] = [], texts = scenes(), state = analysis()) =>
  buildNovelView({ analysis: state, overrides, scenes: texts });
const card = (novel: ReturnType<typeof view>, id: string) => {
  const found = novel.cards.find((item) => item.id === id);
  if (found === undefined) {
    throw new Error(`No card "${id}"`);
  }
  return found;
};
const quotes = (novel: ReturnType<typeof view>, id: string) =>
  card(novel, id).facts.map((item) => item.quote);

describe("cards", () => {
  it("has one card for each thing the text still supports", () => {
    expect(view().cards.map((item) => item.name)).toEqual([
      "Calle de la Sal",
      "Luis",
      "Marta Rey",
      "Puerto Viejo",
      "Tomás",
    ]);
  });

  it("shows what was written in the order the novel tells it, each with its passage", () => {
    const marta = card(view(), "marta");

    expect(marta.facts.map((item) => [item.sceneTitle, item.chapterTitle, item.quote])).toEqual([
      ["Escena 1", "Capítulo 1", "bajó del autobús"],
      ["Escena 1", "Capítulo 1", "los ojos verdes"],
      ["Escena 2", "Capítulo 2", "los ojos marrones"],
    ]);
    expect(marta.aliases).toEqual(["Marta", "la doctora"]);
    expect(marta.scenes.map((scene) => scene.id)).toEqual(["s1", "s2"]);
  });

  it("links both ways: a relation shows on both cards, and so does who names whom", () => {
    const novel = view();

    expect(card(novel, "marta").relations).toMatchObject([
      { label: "hermano de", other: { id: "tomas" }, outgoing: false, quote: "Tomás, su hermano" },
    ]);
    expect(card(novel, "tomas").relations).toMatchObject([
      { label: "hermano de", other: { id: "marta" }, outgoing: true },
    ]);
    expect(card(novel, "tomas").linkedFrom.map((item) => item.id)).toEqual(["marta"]);
    // Marta's own passage names the place, so the place's card links back to her.
    expect(card(novel, "puerto").linkedFrom.map((item) => item.id)).toEqual(["marta"]);
  });

  it("lists what's open about a card, and not about the others", () => {
    const novel = view();

    expect(card(novel, "marta").issues).toMatchObject([
      {
        kind: "contradiction",
        reason: "color de ojos",
        a: { sceneTitle: "Escena 1", quote: "los ojos verdes" },
        b: { sceneTitle: "Escena 2", quote: "los ojos marrones" },
      },
    ]);
    expect(card(novel, "tomas").issues).toEqual([]);
  });

  describe("deleting text removes its data, with no analysis (rule 3)", () => {
    it("a passage goes when its quote is no longer in the scene", () => {
      const edited = scenes(TEXT_1.replace(" Tenía los ojos verdes.", ""));
      const novel = view([], edited);

      expect(quotes(novel, "marta")).toEqual(["bajó del autobús", "los ojos marrones"]);
      // The contradiction cited the deleted passage, so it's closed too.
      expect(card(novel, "marta").issues).toEqual([]);
    });

    it("a card goes when nothing in the text supports it any more", () => {
      const edited = scenes(TEXT_1.replace(" Tomás, su hermano, la esperaba.", ""));
      const novel = view([], edited);

      expect(novel.cards.map((item) => item.id)).not.toContain("tomas");
      expect(card(novel, "marta").relations).toEqual([]);
      expect(novel.relations).toEqual([]);
    });

    it("everything of a scene goes with the scene", () => {
      const novel = view([], scenes().slice(0, 1));

      expect(novel.cards.map((item) => item.id).sort()).toEqual(["marta", "puerto", "tomas"]);
      expect(quotes(novel, "marta")).toEqual(["bajó del autobús", "los ojos verdes"]);
    });
  });

  it("has a card for each pair that's related", () => {
    expect(view().relations).toMatchObject([
      {
        a: { id: "marta" },
        b: { id: "tomas" },
        links: [{ label: "hermano de", from: { id: "tomas" }, to: { id: "marta" } }],
      },
    ]);
  });

  it("has a card for each chapter: who appears, where and when", () => {
    const [first, second] = view().chapters;

    expect(first).toMatchObject({
      title: "Capítulo 1",
      scenes: [{ id: "s1", title: "Escena 1" }],
      people: [{ id: "marta" }, { id: "tomas" }],
      places: [{ id: "puerto" }],
      when: [{ storyTime: "al atardecer", quote: "la esperaba" }],
    });
    expect(second?.people.map((item) => item.id)).toEqual(["luis", "marta"]);
    expect(second?.places.map((item) => item.id)).toEqual(["calle"]);
    // A contradiction shows in both chapters it cites.
    expect(first?.issues).toHaveLength(1);
    expect(second?.issues).toHaveLength(1);
  });

  describe("the Names card", () => {
    it("indexes every proper name with its card and how often it's used", () => {
      const names = view().names.map((entry) => [
        entry.name,
        entry.entity.id,
        entry.isAlias,
        entry.uses,
      ]);

      expect(names).toEqual([
        ["Calle de la Sal", "calle", false, 1],
        ["Luis", "luis", false, 1],
        ["Luis Ferrer", "luis", true, 1],
        ["Marta", "marta", true, 1],
        ["Marta Rey", "marta", false, 1],
        ["Puerto Viejo", "puerto", false, 1],
        ["Tomás", "tomas", false, 1],
      ]);
    });

    it("leaves descriptions out: “la doctora” is nobody's proper name", () => {
      expect(view().names.map((entry) => entry.name)).not.toContain("la doctora");
    });

    it("points out names of different cards that look like one misspelled", () => {
      const state = analysis();
      const withTypo: AnalysisState = {
        ...state,
        entities: [...state.entities, entity("thomas", "Tomas", "person")],
        mentions: [...state.mentions, { sceneId: "s2", entityId: "thomas", quote: "Luis" }],
      };
      const names = view([], scenes(), withTypo).names;

      expect(names.find((entry) => entry.name === "Tomás")?.similar).toEqual([
        { name: "Tomas", entity: { id: "thomas", name: "Tomas", type: "person" } },
      ]);
      expect(names.find((entry) => entry.name === "Marta")?.similar).toEqual([]);
    });
  });
});

describe("the author's overrides", () => {
  it("merge: two cards become one, with everything of both", () => {
    const state = analysis();
    const twice: AnalysisState = {
      ...state,
      entities: [...state.entities, entity("doc", "La Doctora Rey", "person", ["Doctora Rey"])],
      mentions: [...state.mentions, { sceneId: "s2", entityId: "doc", quote: "tarde" }],
      facts: [...state.facts, fact("f9", "s2", "doc", "llegó tarde", "La doctora llegó tarde.")],
    };
    const merge = by({ kind: "merge", from: "doc", into: "marta" });
    const novel = view([merge], scenes(), twice);

    expect(novel.cards.map((item) => item.id)).not.toContain("doc");
    expect(quotes(novel, "marta")).toContain("llegó tarde");
    expect(card(novel, "marta").aliases).toEqual([
      "Marta",
      "la doctora",
      "La Doctora Rey",
      "Doctora Rey",
    ]);
    expect(card(novel, "marta").merged).toEqual([{ overrideId: merge.id, name: "La Doctora Rey" }]);
  });

  it("merge: what's said later about the merged card reaches the one it became", () => {
    const novel = view([
      by({ kind: "merge", from: "tomas", into: "marta" }),
      by({ kind: "note", entityId: "tomas", text: "Revisar." }),
      by({ kind: "merge", from: "marta", into: "luis" }),
    ]);

    expect(novel.cards.map((item) => item.id).sort()).toEqual(["calle", "luis", "puerto"]);
    expect(card(novel, "luis").note).toBe("Revisar.");
    expect(card(novel, "luis").merged.map((item) => item.name)).toEqual(["Tomás", "Marta Rey"]);
    // The relation between the two merged cards is no relation at all now.
    expect(card(novel, "luis").relations).toEqual([]);
  });

  it("split: one name gets a card of its own, with the passages that name it", () => {
    const split = by({
      kind: "split",
      entityId: "luis",
      name: "Luis Ferrer",
      newEntityId: "ferrer",
    });
    const novel = view([split]);

    expect(card(novel, "ferrer")).toMatchObject({
      name: "Luis Ferrer",
      type: "person",
      splitOverrideId: split.id,
    });
    expect(quotes(novel, "ferrer")).toEqual(["el cartero"]);
    expect(card(novel, "luis").aliases).toEqual([]);
    expect(novel.names.find((entry) => entry.name === "Luis Ferrer")?.entity.id).toBe("ferrer");
  });

  it("note: the last one stands, and an empty one takes it away", () => {
    const first = by({ kind: "note", entityId: "marta", text: "Es zurda." });
    const second = by({ kind: "note", entityId: "marta", text: "Es diestra." });

    expect(card(view([first]), "marta").note).toBe("Es zurda.");
    expect(card(view([first, second]), "marta").note).toBe("Es diestra.");
    expect(
      card(view([first, second, by({ kind: "note", entityId: "marta", text: " " })]), "marta").note,
    ).toBeNull();
  });

  it("correction: a new name, with the old one kept as a name the text uses", () => {
    const novel = view([by({ kind: "correction", entityId: "marta", name: "Marta Rey Santana" })]);

    expect(card(novel, "marta").name).toBe("Marta Rey Santana");
    expect(card(novel, "marta").aliases).toEqual(["Marta Rey", "Marta", "la doctora"]);
  });

  it("correction: what kind of thing it is", () => {
    const novel = view([by({ kind: "correction", entityId: "puerto", type: "lore" })]);

    expect(card(novel, "puerto").type).toBe("lore");
    expect(novel.chapters[0]?.places).toEqual([]);
    expect(novel.chapters[0]?.lore.map((item) => item.id)).toEqual(["puerto"]);
  });

  it("correction: a place inside another, both ways", () => {
    const state = analysis();
    const withBar: AnalysisState = {
      ...state,
      entities: [...state.entities, entity("bar", "Bar Luz", "place")],
      mentions: [...state.mentions, { sceneId: "s2", entityId: "bar", quote: "Luis" }],
    };
    const novel = view(
      [
        by({ kind: "correction", entityId: "calle", parentId: "puerto" }),
        by({ kind: "correction", entityId: "bar", parentId: "calle" }),
      ],
      scenes(),
      withBar,
    );

    expect(card(novel, "bar").within.map((item) => item.name)).toEqual([
      "Puerto Viejo",
      "Calle de la Sal",
    ]);
    expect(card(novel, "puerto").contains.map((item) => item.name)).toEqual(["Calle de la Sal"]);
    expect(card(novel, "calle").contains.map((item) => item.name)).toEqual(["Bar Luz"]);
  });

  it("correction: a place can't end up inside itself", () => {
    const novel = view([
      by({ kind: "correction", entityId: "calle", parentId: "puerto" }),
      by({ kind: "correction", entityId: "puerto", parentId: "calle" }),
    ]);

    const loops = [card(novel, "calle"), card(novel, "puerto")].filter((item) =>
      item.within.some((parent) => parent.id === item.id),
    );
    expect(loops).toEqual([]);
    expect(card(novel, "calle").within.length + card(novel, "puerto").within.length).toBeLessThan(
      2,
    );
  });

  it("dismiss: one passage, or the whole card", () => {
    const one = view([by({ kind: "dismiss", entityId: "marta", quote: "los ojos verdes" })]);
    expect(quotes(one, "marta")).toEqual(["bajó del autobús", "los ojos marrones"]);

    const whole = view([by({ kind: "dismiss", entityId: "tomas" })]);
    expect(whole.cards.map((item) => item.id)).not.toContain("tomas");
    expect(card(whole, "marta").relations).toEqual([]);
  });

  it("changes nothing when it's about something that isn't there, and never fails", () => {
    const novel = view([
      by({ kind: "merge", from: "nobody", into: "marta" }),
      by({ kind: "merge", from: "marta", into: "nobody" }),
      by({ kind: "split", entityId: "nobody", name: "X", newEntityId: "x" }),
      by({ kind: "split", entityId: "marta", name: "Marta Rey", newEntityId: "same-name" }),
      by({ kind: "correction", entityId: "nobody", name: "X" }),
      by({ kind: "correction", entityId: "calle", parentId: "nobody" }),
      by({ kind: "dismiss", entityId: "nobody" }),
    ]);

    expect(novel).toEqual(view());
  });

  it("the analysis itself is left as it was", () => {
    const state = analysis();
    const before = JSON.stringify(state);

    applyOverrides(state, [
      by({ kind: "merge", from: "tomas", into: "marta" }),
      by({ kind: "dismiss", entityId: "luis" }),
    ]);

    expect(JSON.stringify(state)).toBe(before);
  });

  describe("survive reanalysis (rule 4)", () => {
    it("a scene analysed again, with new ids for everything in it, keeps every override", () => {
      const overrides = [
        by({ kind: "merge", from: "tomas", into: "marta" }),
        by({ kind: "note", entityId: "marta", text: "Es zurda." }),
        by({ kind: "dismiss", entityId: "marta", quote: "los ojos verdes" }),
        by({ kind: "correction", entityId: "puerto", name: "Puerto Viejo de la Sal" }),
        by({ kind: "split", entityId: "luis", name: "Luis Ferrer", newEntityId: "ferrer" }),
      ];
      const before = view(overrides);

      const state = analysis();
      const again: AnalysisState = {
        ...state,
        facts: state.facts.map((item) => ({ ...item, id: `new-${item.id}` })),
        relations: state.relations.map((item) => ({ ...item, id: `new-${item.id}` })),
      };
      const after = view(overrides, scenes(), again);

      expect(after).toEqual(before);
      expect(card(after, "marta").note).toBe("Es zurda.");
      expect(quotes(after, "marta")).not.toContain("los ojos verdes");
      expect(quotes(after, "marta")).toContain("la esperaba");
      expect(card(after, "puerto").name).toBe("Puerto Viejo de la Sal");
      expect(quotes(after, "ferrer")).toEqual(["el cartero"]);
    });

    it("a card that leaves the novel and comes back still has what the author said of it", () => {
      const note = by({ kind: "note", entityId: "tomas", text: "Volverá en el capítulo 3." });
      const without = scenes(TEXT_1.replace(" Tomás, su hermano, la esperaba.", ""));

      expect(view([note], without).cards.map((item) => item.id)).not.toContain("tomas");
      expect(card(view([note]), "tomas").note).toBe("Volverá en el capítulo 3.");
    });
  });
});

describe("stored overrides", () => {
  let driver: ReturnType<typeof createNodeSqliteDriver>;
  let storage: Storage;
  let projectId: string;
  let ticks: number;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    ticks = 1000;
    ({ storage } = await openSqlStorage(driver, { now: () => ticks }));
    projectId = (await storage.createProject({ title: "T", language: "es", era: "e" })).id;
  });

  afterEach(() => driver.close());

  it("come back as they were made, in the order they were made", async () => {
    // The same instant for all three, as when they're made in a burst.
    await addOverride(storage, projectId, { kind: "note", entityId: "a", text: "uno" });
    await addOverride(storage, projectId, { kind: "merge", from: "b", into: "a" });
    await addOverride(storage, projectId, { kind: "note", entityId: "a", text: "dos ñ 🖋️" });

    const loaded = await loadOverrides(storage, projectId);

    expect(loaded.map((item) => item.override)).toEqual([
      { kind: "note", entityId: "a", text: "uno" },
      { kind: "merge", from: "b", into: "a" },
      { kind: "note", entityId: "a", text: "dos ñ 🖋️" },
    ]);
    expect(loaded.map((item) => item.createdAt)).toEqual([1000, 1001, 1002]);
  });

  it("belong to their novel", async () => {
    const other = (await storage.createProject({ title: "O", language: "es", era: "e" })).id;
    await addOverride(storage, projectId, { kind: "dismiss", entityId: "a" });

    await expect(loadOverrides(storage, other)).resolves.toEqual([]);
  });

  it("only go when the author takes one back", async () => {
    await addOverride(storage, projectId, { kind: "merge", from: "b", into: "a" });
    await addOverride(storage, projectId, { kind: "dismiss", entityId: "c" });
    const [merge] = await loadOverrides(storage, projectId);

    await storage.removeOverride(merge?.id ?? "");

    await expect(loadOverrides(storage, projectId)).resolves.toMatchObject([
      { override: { kind: "dismiss", entityId: "c" } },
    ]);
  });

  it("are untouched by saving an analysis", async () => {
    const chapter = await storage.createChapter(projectId, "C");
    const scene = await storage.createScene(chapter.id, "S");
    await addOverride(storage, projectId, { kind: "note", entityId: "marta", text: "Es zurda." });

    for (const round of [1, 2]) {
      await storage.saveSceneAnalysis(projectId, scene.id, `hash-${round}`, {
        entities: [entity("marta", "Marta", "person")],
        mentions: [{ sceneId: scene.id, entityId: "marta", quote: "Marta" }],
        facts: [],
        relations: [],
        issues: [],
        sceneOrder: [scene.id],
      });
    }

    await expect(loadOverrides(storage, projectId)).resolves.toMatchObject([
      { override: { kind: "note", entityId: "marta", text: "Es zurda." } },
    ]);
  });

  it.each([
    ["merge", "not json"],
    ["merge", "[]"],
    ["merge", '{"from":"a"}'],
    ["merge", '{"from":"a","into":"a"}'],
    ["split", '{"entityId":"a","name":""}'],
    ["note", '{"entityId":"a"}'],
    ["correction", '{"name":"X"}'],
    ["dismiss", "{}"],
    ["something else", '{"entityId":"a"}'],
  ])("ignore a stored %s of %s, rather than guess what was meant", (kind, payload) => {
    expect(parseOverride({ id: "x", projectId, kind, payload, createdAt: 1 })).toBeNull();
  });

  it("the cards of a novel come from what's stored and saved", async () => {
    await expect(loadNovelView(storage, projectId)).resolves.toEqual({
      cards: [],
      relations: [],
      chapters: [],
      names: [],
      issues: [],
      prompts: [],
    });
  });
});

describe("finding known names in the text, with no model", () => {
  const find = createNameFinder([
    { name: "Marta", entityId: "marta" },
    { name: "Marta Rey", entityId: "marta" },
    { name: "Ana", entityId: "ana" },
    { name: "Puerto Viejo", entityId: "puerto" },
    { name: "S.A.", entityId: "sa" },
  ]);
  const found = (text: string) =>
    find(text).map((match) => [text.slice(match.from, match.to), match.entityId]);

  it("finds each name where it is", () => {
    expect(found("Ana vio a Marta en Puerto Viejo.")).toEqual([
      ["Ana", "ana"],
      ["Marta", "marta"],
      ["Puerto Viejo", "puerto"],
    ]);
  });

  it("takes the longest name, not the shorter one inside it", () => {
    expect(found("Marta Rey y Marta")).toEqual([
      ["Marta Rey", "marta"],
      ["Marta", "marta"],
    ]);
  });

  it("only whole words: “Ana” isn't in “Anabel” or “Susana”, with accents too", () => {
    expect(found("Anabel y Susana y Anaís")).toEqual([]);
    expect(found("—Ana —dijo. ¿Ana? «Ana», (Ana)")).toHaveLength(4);
  });

  it("is exact about capitals, so a common word isn't taken for a name", () => {
    expect(found("ana, marta, puerto viejo")).toEqual([]);
  });

  it("copes with names that have punctuation in them", () => {
    expect(found("Trabaja en S.A. desde ayer")).toEqual([["S.A.", "sa"]]);
    expect(found("SxAx")).toEqual([]);
  });

  it("finds nothing when no name is known", () => {
    expect(createNameFinder([])("Marta")).toEqual([]);
    expect(createNameFinder([{ name: "  ", entityId: "x" }])("Marta")).toEqual([]);
  });

  it("works from the names of the cards", () => {
    const names = knownNames(view());
    const text = "La doctora y Marta Rey";

    expect(createNameFinder(names)(text).map((match) => text.slice(match.from, match.to))).toEqual([
      "Marta Rey",
    ]);
  });
});
