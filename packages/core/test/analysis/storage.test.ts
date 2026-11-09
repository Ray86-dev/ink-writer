import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AnalysisState,
  emptyState,
  type Fact,
  type Issue,
  MIGRATIONS,
  migrate,
  openSqlStorage,
  type Storage,
  withoutScene,
} from "../../src/index";
import { createNodeSqliteDriver } from "../support/node-sqlite-driver";

describe("analysis storage", () => {
  let driver: ReturnType<typeof createNodeSqliteDriver>;
  let storage: Storage;
  let projectId: string;
  let chapterId: string;
  let s1: string;
  let s2: string;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    ({ storage } = await openSqlStorage(driver));
    projectId = (await storage.createProject({ title: "T", language: "es", era: "e" })).id;
    chapterId = (await storage.createChapter(projectId, "C")).id;
    s1 = (await storage.createScene(chapterId, "Uno")).id;
    s2 = (await storage.createScene(chapterId, "Dos")).id;
  });

  afterEach(() => driver.close());

  const fact = (id: string, sceneId: string, quote: string): Fact => ({
    id,
    sceneId,
    entityId: "marta",
    category: "physical",
    attribute: "ojos",
    value: "v",
    quote,
    sentence: `Frase con ${quote}.`,
    storyTime: null,
    inDialogue: false,
  });

  const contradiction = (quoteA: string, quoteB: string): Issue => ({
    kind: "contradiction",
    a: { sceneId: s1, quote: quoteA },
    b: { sceneId: s2, quote: quoteB },
    reason: "r",
  });

  const base = (): AnalysisState => ({
    ...emptyState([s1, s2]),
    entities: [{ id: "marta", type: "person", canonicalName: "Marta Rey", aliases: ["Marta"] }],
    mentions: [{ sceneId: s1, entityId: "marta", quote: "Marta" }],
    facts: [fact("f1", s1, "ojos verdes")],
  });

  it("gives back what it was given, in every detail", async () => {
    const state: AnalysisState = {
      ...base(),
      entities: [
        ...base().entities,
        { id: "tomas", type: "person", canonicalName: "Tomás", aliases: [] },
      ],
      facts: [
        { ...fact("f1", s1, "ojos verdes"), storyTime: "a los doce", inDialogue: true },
        { ...fact("f2", s1, "otra"), category: "travel_time" },
      ],
      relations: [
        {
          id: "r1",
          sceneId: s1,
          fromEntityId: "marta",
          toEntityId: "tomas",
          label: "hermana de",
          quote: "su hermano",
        },
      ],
      issues: [
        { kind: "correction", a: { sceneId: s1, quote: "halla" }, fix: "haya", reason: "r" },
        {
          kind: "name_variant",
          a: { sceneId: s1, quote: "Tomás" },
          b: { sceneId: s1, quote: "Thomas" },
          reason: "r",
        },
      ],
    };

    await storage.saveSceneAnalysis(projectId, s1, "h1", state);

    expect(await storage.loadAnalysis(projectId)).toEqual(state);
  });

  it("replaces a scene's data when it's analysed again (SPEC §4)", async () => {
    await storage.saveSceneAnalysis(projectId, s1, "h1", base());

    await storage.saveSceneAnalysis(projectId, s1, "h2", {
      ...base(),
      mentions: [],
      facts: [fact("f9", s1, "ojos grises")],
    });

    const after = await storage.loadAnalysis(projectId);
    expect(after.facts.map((item) => item.quote)).toEqual(["ojos grises"]);
    expect(after.mentions).toEqual([]);
  });

  it("leaves other scenes' data alone", async () => {
    await storage.saveSceneAnalysis(projectId, s1, "h1", base());
    const withBoth: AnalysisState = {
      ...base(),
      facts: [...base().facts, fact("f2", s2, "ojos marrones")],
    };
    await storage.saveSceneAnalysis(projectId, s2, "h2", withBoth);

    await storage.saveSceneAnalysis(projectId, s2, "h3", withoutScene(withBoth, s2));

    const after = await storage.loadAnalysis(projectId);
    expect(after.facts.map((item) => item.quote)).toEqual(["ojos verdes"]);
  });

  it("takes out an issue when either of its scenes is analysed again", async () => {
    const state: AnalysisState = {
      ...base(),
      facts: [...base().facts, fact("f2", s2, "ojos marrones")],
      issues: [contradiction("ojos verdes", "ojos marrones")],
    };
    await storage.saveSceneAnalysis(projectId, s1, "h1", state);
    await storage.saveSceneAnalysis(projectId, s2, "h2", state);
    expect((await storage.loadAnalysis(projectId)).issues).toHaveLength(1);

    // Scene 1 no longer says that, so the issue doesn't come back.
    await storage.saveSceneAnalysis(projectId, s1, "h3", withoutScene(state, s1));

    expect((await storage.loadAnalysis(projectId)).issues).toEqual([]);
  });

  it("stores an issue only once, from whichever scene found it", async () => {
    const state: AnalysisState = {
      ...base(),
      issues: [contradiction("ojos verdes", "ojos marrones")],
    };

    await storage.saveSceneAnalysis(projectId, s1, "h1", state);
    await storage.saveSceneAnalysis(projectId, s2, "h2", state);

    expect((await storage.loadAnalysis(projectId)).issues).toHaveLength(1);
  });

  it("is all or nothing: a failure leaves the old data and the scene queued", async () => {
    await storage.setSceneContentHash(s1, "h1");
    await storage.saveSceneAnalysis(projectId, s1, "h1", base());
    await storage.setSceneContentHash(s1, "h2");

    const impossible: AnalysisState = {
      ...base(),
      facts: [{ ...fact("f9", s1, "x"), entityId: "no-such-entity" }],
    };

    await expect(storage.saveSceneAnalysis(projectId, s1, "h2", impossible)).rejects.toThrow();

    expect((await storage.loadAnalysis(projectId)).facts.map((item) => item.quote)).toEqual([
      "ojos verdes",
    ]);
    expect((await storage.listScenesToAnalyze(projectId)).map((scene) => scene.id)).toEqual([s1]);
  });

  describe("entities", () => {
    it("keep their name once stored: a model can't rename what the author may have set", async () => {
      await storage.saveSceneAnalysis(projectId, s1, "h1", base());

      await storage.saveSceneAnalysis(projectId, s1, "h2", {
        ...base(),
        entities: [{ id: "marta", type: "person", canonicalName: "Otra", aliases: ["La otra"] }],
      });

      const [entity] = (await storage.loadAnalysis(projectId)).entities;
      expect(entity?.canonicalName).toBe("Marta Rey");
      expect(entity?.aliases).toEqual(["Marta", "La otra"]);
    });

    it("stay when their scenes are analysed again, so that their id does too (rule 4)", async () => {
      await storage.saveSceneAnalysis(projectId, s1, "h1", base());

      await storage.saveSceneAnalysis(projectId, s1, "h2", withoutScene(base(), s1));

      const after = await storage.loadAnalysis(projectId);
      expect(after.entities.map((entity) => entity.id)).toEqual(["marta"]);
      expect(after.facts).toEqual([]);
    });

    it("belong to one project", async () => {
      await storage.saveSceneAnalysis(projectId, s1, "h1", base());
      const other = await storage.createProject({ title: "O", language: "es", era: "e" });

      expect((await storage.loadAnalysis(other.id)).entities).toEqual([]);
    });
  });

  describe("the queue", () => {
    const queued = async () =>
      (await storage.listScenesToAnalyze(projectId)).map((scene) => scene.id);

    it("is empty until a hash says there's text", async () => {
      expect(await queued()).toEqual([]);
    });

    it("has a scene from the moment its text differs, until that text is analysed", async () => {
      await storage.setSceneContentHash(s1, "h1");
      expect(await queued()).toEqual([s1]);

      await storage.saveSceneAnalysis(projectId, s1, "h1", base());
      expect(await queued()).toEqual([]);

      await storage.setSceneContentHash(s1, "h2");
      expect(await queued()).toEqual([s1]);
    });

    it("keeps a scene if the text changed while it was being analysed", async () => {
      await storage.setSceneContentHash(s1, "h2");

      await storage.saveSceneAnalysis(projectId, s1, "h1", base());

      expect(await queued()).toEqual([s1]);
    });

    it("is in reading order, across chapters", async () => {
      const later = await storage.createChapter(projectId, "Después");
      const s3 = (await storage.createScene(later.id, "Tres")).id;
      for (const id of [s3, s2, s1]) {
        await storage.setSceneContentHash(id, "h");
      }

      expect(await queued()).toEqual([s1, s2, s3]);

      await storage.moveChapter(later.id, "up");
      expect(await queued()).toEqual([s3, s1, s2]);
    });

    it("leaves out the trash", async () => {
      await storage.setSceneContentHash(s1, "h");
      await storage.setSceneContentHash(s2, "h");

      await storage.trashScene(s1);
      expect(await queued()).toEqual([s2]);

      await storage.trashChapter(chapterId);
      expect(await queued()).toEqual([]);
    });
  });

  describe("the trash", () => {
    const state = (): AnalysisState => ({
      ...base(),
      facts: [...base().facts, fact("f2", s2, "ojos marrones")],
      issues: [contradiction("ojos verdes", "ojos marrones")],
    });

    beforeEach(async () => {
      await storage.saveSceneAnalysis(projectId, s1, "h1", state());
      await storage.saveSceneAnalysis(projectId, s2, "h2", state());
    });

    it("hides what came from a scene, and the issues citing it", async () => {
      await storage.trashScene(s2);

      const after = await storage.loadAnalysis(projectId);
      expect(after.sceneOrder).toEqual([s1]);
      expect(after.facts.map((item) => item.quote)).toEqual(["ojos verdes"]);
      expect(after.issues).toEqual([]);
    });

    it("gives it all back on restoring, with no new analysis", async () => {
      await storage.trashScene(s2);
      await storage.restoreScene(s2);

      const after = await storage.loadAnalysis(projectId);
      expect(after.facts).toHaveLength(2);
      expect(after.issues).toHaveLength(1);
    });

    it("works through a whole chapter too", async () => {
      await storage.trashChapter(chapterId);

      const after = await storage.loadAnalysis(projectId);
      expect(after.sceneOrder).toEqual([]);
      expect(after.facts).toEqual([]);
      expect(after.issues).toEqual([]);

      await storage.restoreChapter(chapterId);
      expect((await storage.loadAnalysis(projectId)).facts).toHaveLength(2);
    });
  });

  it("says the scenes in reading order, so that a comparison knows what came first", async () => {
    await storage.moveScene(s2, "up");

    expect((await storage.loadAnalysis(projectId)).sceneOrder).toEqual([s2, s1]);
  });

  it("the migration keeps the prose of a database from before it", async () => {
    const old = createNodeSqliteDriver();
    await migrate(
      old,
      MIGRATIONS.filter((migration) => migration.version <= 2),
    );
    await old.execute("INSERT INTO projects VALUES ('p', 'T', 'es', 'e')");
    await old.execute(
      "INSERT INTO chapters (id, project_id, position, title) VALUES ('c', 'p', 0, 'C')",
    );
    await old.execute(
      "INSERT INTO scenes (id, chapter_id, position, title) VALUES ('s', 'c', 0, 'S')",
    );
    const prose = new Uint8Array([1, 2, 3]);
    await old.execute("INSERT INTO scene_updates (scene_id, update_data) VALUES ('s', ?)", [prose]);

    const { storage: upgraded, migration } = await openSqlStorage(old);

    expect(migration.from).toBe(2);
    expect((await upgraded.loadSceneProse("s")).updates[0]?.data).toEqual(prose);
    expect(await upgraded.listScenesToAnalyze("p")).toEqual([]);
    old.close();
  });
});
