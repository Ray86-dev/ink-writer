import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  type AiProvider,
  AnalysisQueue,
  type AnalysisState,
  type GenerateEvent,
  type GenerateOutcome,
  type GenerateRequest,
  hashText,
  openSqlStorage,
  type QueueRun,
  type Storage,
} from "../../src/index";
import { createNodeSqliteDriver } from "../support/node-sqlite-driver";
import { writeParagraphs } from "../support/prose";

/**
 * A model that finds one fact per sentence of the first paragraph, enough to see what got analysed.
 * `failWith` makes it fail, for as long as it's set.
 */
function fakeModel() {
  const state: { failWith: GenerateOutcome | null; badAnswers: boolean; asked: GenerateRequest[] } =
    {
      failWith: null,
      badAnswers: false,
      asked: [],
    };
  const provider: AiProvider = {
    id: "fake",
    displayName: "Fake",
    billing: "local",
    listModels: async () => [],
    async *generate(request): AsyncGenerator<GenerateEvent> {
      state.asked.push(request);
      if (request.signal?.aborted) {
        yield { type: "end", outcome: { status: "interrupted", message: "cancelled" } };
        return;
      }
      if (state.failWith !== null) {
        yield { type: "end", outcome: state.failWith };
        return;
      }
      if (state.badAnswers) {
        yield { type: "text", delta: "no es json" };
        yield { type: "end", outcome: { status: "completed" } };
        return;
      }
      const text = request.input.split("SCENE ")[1]?.split(":\n")[1] ?? "";
      const quote = text.split(".")[0] ?? "";
      const answer =
        request.structured?.name === "scene_extraction"
          ? {
              entities: [{ name: "Marta", type: "person", aliases: [] }],
              facts: [
                {
                  entity: "Marta",
                  category: "action",
                  attribute: "a",
                  value: "v",
                  quote,
                  story_time: null,
                },
              ],
              relations: [],
            }
          : request.structured?.name === "proofreading"
            ? { corrections: [] }
            : request.structured?.name === "comparison"
              ? { findings: [] }
              : { answers: [] };
      yield { type: "text", delta: JSON.stringify(answer) };
      yield { type: "end", outcome: { status: "completed" } };
    },
  };
  return { provider, state };
}

describe("analysis queue", () => {
  let driver: ReturnType<typeof createNodeSqliteDriver>;
  let storage: Storage;
  let projectId: string;
  let chapterId: string;
  let model: ReturnType<typeof fakeModel>;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    ({ storage } = await openSqlStorage(driver));
    projectId = (await storage.createProject({ title: "T", language: "es", era: "e" })).id;
    chapterId = (await storage.createChapter(projectId, "C")).id;
    model = fakeModel();
  });

  afterEach(() => {
    vi.useRealTimers();
    driver.close();
  });

  /** Only timers are faked: hashing and the database still take real, if very little, time. */
  const fakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  /** Moves the clock on, and waits for whatever that set off. */
  async function advance(queue: AnalysisQueue, ms: number) {
    await vi.advanceTimersByTimeAsync(ms);
    await queue.settled();
  }

  const makeQueue = (overrides: Partial<ConstructorParameters<typeof AnalysisQueue>[0]> = {}) =>
    new AnalysisQueue({
      storage,
      projectId,
      analysis: { provider: model.provider, model: "m", language: "es" },
      ...overrides,
    });

  async function write(sceneId: string, text: string) {
    const doc = new Y.Doc();
    const prose = await storage.loadSceneProse(sceneId);
    if (prose.base !== null) Y.applyUpdate(doc, prose.base);
    for (const update of prose.updates) Y.applyUpdate(doc, update.data);
    doc.getXmlFragment("prose").delete(0, doc.getXmlFragment("prose").length);
    writeParagraphs(doc, [text]);
    await storage.appendSceneUpdate(sceneId, Y.encodeStateAsUpdate(doc));
    doc.destroy();
  }

  async function newScene(title: string, text: string) {
    const scene = await storage.createScene(chapterId, title);
    await write(scene.id, text);
    return scene.id;
  }

  const factsOf = (state: AnalysisState) => state.facts.map((fact) => fact.quote);

  it("analyses everything not yet analysed, in reading order", async () => {
    const one = await newScene("1", "Marta llegó.");
    const two = await newScene("2", "Marta salió.");

    const run = await makeQueue().run();

    expect(run).toMatchObject({ status: "done", analyzed: [one, two], skipped: [], pending: 0 });
    expect(factsOf(await storage.loadAnalysis(projectId))).toEqual(["Marta llegó", "Marta salió"]);
  });

  it("doesn't ask again about text it already analysed, even after a restart", async () => {
    await newScene("1", "Marta llegó.");
    await makeQueue().run();
    const asked = model.state.asked.length;

    const run = await makeQueue().run();

    expect(run.analyzed).toEqual([]);
    expect(model.state.asked).toHaveLength(asked);
  });

  it("analyses a scene again only if its text changed", async () => {
    const one = await newScene("1", "Marta llegó.");
    const two = await newScene("2", "Marta salió.");
    const queue = makeQueue();
    await queue.run();

    await write(two, "Marta volvió.");
    queue.sceneEdited(two);
    const run = await queue.run();

    expect(run.analyzed).toEqual([two]);
    expect(run.analyzed).not.toContain(one);
    expect(factsOf(await storage.loadAnalysis(projectId))).toEqual(["Marta llegó", "Marta volvió"]);
  });

  it("finds on opening what a crash left with an old hash", async () => {
    const one = await newScene("1", "Marta llegó.");
    await makeQueue().run();

    // Saved by the editor, and then the app died before anything else could happen.
    await write(one, "Marta volvió.");

    const run = await makeQueue().run();

    expect(run.analyzed).toEqual([one]);
  });

  it("clears what an emptied scene said, without asking any model", async () => {
    const one = await newScene("1", "Marta llegó.");
    const queue = makeQueue();
    await queue.run();
    const asked = model.state.asked.length;

    await write(one, "");
    queue.sceneEdited(one);
    const run = await queue.run();

    expect(run.analyzed).toEqual([one]);
    expect(factsOf(await storage.loadAnalysis(projectId))).toEqual([]);
    expect(model.state.asked).toHaveLength(asked);
  });

  it("describes the text it read, so that writing meanwhile keeps the scene queued", async () => {
    const one = await newScene("1", "Marta llegó.");
    const original = storage.saveSceneAnalysis.bind(storage);
    // The author types while the model is thinking.
    storage.saveSceneAnalysis = async (...args) => {
      await write(one, "Marta volvió.");
      await storage.setSceneContentHash(one, await hashText("Marta volvió."));
      await original(...args);
    };

    await makeQueue().run();
    storage.saveSceneAnalysis = original;

    expect((await storage.listScenesToAnalyze(projectId)).map((scene) => scene.id)).toEqual([one]);
    const run = await makeQueue().run();
    expect(run.analyzed).toEqual([one]);
    expect(factsOf(await storage.loadAnalysis(projectId))).toEqual(["Marta volvió"]);
  });

  describe("without a connection", () => {
    const offline: GenerateOutcome = { status: "interrupted", message: "fetch failed" };

    it("leaves every scene queued and loses nothing", async () => {
      const one = await newScene("1", "Marta llegó.");
      await newScene("2", "Marta salió.");
      model.state.failWith = offline;

      const run = await makeQueue().run();

      expect(run).toMatchObject({ status: "waiting", analyzed: [], pending: 2 });
      expect(run.message).toBe("fetch failed");
      expect((await storage.listScenesToAnalyze(projectId))[0]?.id).toBe(one);
    });

    it("stops at the first failure, instead of asking for every scene", async () => {
      await newScene("1", "Marta llegó.");
      await newScene("2", "Marta salió.");
      model.state.failWith = offline;

      await makeQueue().run();

      expect(model.state.asked).toHaveLength(1);
    });

    it("keeps what was already done, and picks up where it stopped", async () => {
      const one = await newScene("1", "Marta llegó.");
      const two = await newScene("2", "Marta salió.");
      let calls = 0;
      const dropsLater: AiProvider = {
        ...model.provider,
        generate: (request) => {
          calls += 1;
          model.state.failWith = calls > 2 ? offline : null;
          return model.provider.generate(request);
        },
      };

      const first = await makeQueue({
        analysis: { provider: dropsLater, model: "m", language: "es" },
      }).run();

      expect(first).toMatchObject({ status: "waiting", analyzed: [one], pending: 1 });
      expect(factsOf(await storage.loadAnalysis(projectId))).toEqual(["Marta llegó"]);

      model.state.failWith = null;
      const second = await makeQueue().run();
      expect(second).toMatchObject({ status: "done", analyzed: [two], pending: 0 });
    });

    it("leaves a scene's old data alone until a new analysis finishes", async () => {
      const one = await newScene("1", "Marta llegó.");
      const queue = makeQueue();
      await queue.run();

      await write(one, "Marta volvió.");
      queue.sceneEdited(one);
      model.state.failWith = offline;
      await queue.run();

      expect(factsOf(await storage.loadAnalysis(projectId))).toEqual(["Marta llegó"]);
    });

    it("tries again by itself, waiting longer each time, until it works", async () => {
      fakeTimers();
      await newScene("1", "Marta llegó.");
      model.state.failWith = offline;
      const runs: QueueRun[] = [];
      const queue = makeQueue({ retryMs: 1000, onRun: (run) => runs.push(run) });

      queue.start();
      await advance(queue, 1);
      expect(runs.map((run) => run.status)).toEqual(["waiting"]);

      await advance(queue, 1000);
      expect(runs).toHaveLength(2);

      // Twice as long now: nothing at the first interval.
      await advance(queue, 1000);
      expect(runs).toHaveLength(2);
      await advance(queue, 1000);
      expect(runs).toHaveLength(3);

      model.state.failWith = null;
      await advance(queue, 4000);
      expect(runs.at(-1)?.status).toBe("done");

      // And then it stops: there's nothing left to try.
      const count = runs.length;
      await advance(queue, 100_000);
      expect(runs).toHaveLength(count);
      await queue.stop();
    });
  });

  describe("when refused", () => {
    const noCredit: GenerateOutcome = {
      status: "failed",
      error: { code: "402", message: "Insufficient credits", httpStatus: 402 },
    };

    it("stops, keeps everything queued and says why", async () => {
      await newScene("1", "Marta llegó.");
      await newScene("2", "Marta salió.");
      model.state.failWith = noCredit;

      const run = await makeQueue().run();

      expect(run).toMatchObject({ status: "blocked", pending: 2 });
      expect(run.message).toContain("Insufficient credits");
      expect(model.state.asked).toHaveLength(1);
    });

    it("doesn't keep asking by itself: only the author can sort this out", async () => {
      fakeTimers();
      await newScene("1", "Marta llegó.");
      model.state.failWith = noCredit;
      const queue = makeQueue({ retryMs: 1000 });

      queue.start();
      await advance(queue, 1);
      await advance(queue, 1_000_000);

      expect(model.state.asked).toHaveLength(1);
      await queue.stop();
    });

    it("never turns to another provider (rule 10)", async () => {
      await newScene("1", "Marta llegó.");
      model.state.failWith = noCredit;
      const other = fakeModel();
      const queue = makeQueue();

      await queue.run();

      expect(other.state.asked).toEqual([]);
      expect(model.state.asked.every((request) => request.model === "m")).toBe(true);
    });
  });

  describe("when the model's answer isn't usable", () => {
    it("goes on with the other scenes, instead of getting stuck on one", async () => {
      const one = await newScene("1", "Marta llegó.");
      const two = await newScene("2", "Marta salió.");
      let calls = 0;
      const failsTwice: AiProvider = {
        ...model.provider,
        generate: (request) => {
          calls += 1;
          model.state.badAnswers = calls <= 2;
          return model.provider.generate(request);
        },
      };

      const run = await makeQueue({
        analysis: { provider: failsTwice, model: "m", language: "es" },
      }).run();

      expect(run).toMatchObject({ status: "done", analyzed: [two], skipped: [one], pending: 0 });
    });

    it("doesn't spend requests on that text again, until it changes", async () => {
      const one = await newScene("1", "Marta llegó.");
      model.state.badAnswers = true;
      const queue = makeQueue();
      await queue.run();
      const asked = model.state.asked.length;

      const again = await queue.run();
      expect(again.skipped).toEqual([one]);
      expect(model.state.asked).toHaveLength(asked);

      model.state.badAnswers = false;
      await write(one, "Marta volvió.");
      queue.sceneEdited(one);
      const changed = await queue.run();
      expect(changed.analyzed).toEqual([one]);
    });
  });

  describe("when it runs (SPEC §5)", () => {
    beforeEach(() => {
      fakeTimers();
    });

    it("never at each key: typing only restarts the wait", async () => {
      const one = await newScene("1", "Marta llegó.");
      const queue = makeQueue({ pauseMs: 1000 });

      for (let key = 0; key < 50; key += 1) {
        queue.sceneEdited(one);
        await advance(queue, 100);
      }
      expect(model.state.asked).toEqual([]);

      await advance(queue, 1000);
      expect(model.state.asked.length).toBeGreaterThan(0);
      await queue.stop();
    });

    it("on closing a scene, without waiting for a pause", async () => {
      const one = await newScene("1", "Marta llegó.");
      const queue = makeQueue({ pauseMs: 1_000_000 });

      queue.sceneClosed(one);
      await advance(queue, 1);

      expect(model.state.asked.length).toBeGreaterThan(0);
      await queue.stop();
    });

    it("doesn't start two runs at once", async () => {
      await newScene("1", "Marta llegó.");
      const queue = makeQueue();

      const [a, b] = await Promise.all([queue.run(), queue.run()]);

      expect(a).toBe(b);
      await queue.stop();
    });

    it("goes back for what was edited during a run", async () => {
      const one = await newScene("1", "Marta llegó.");
      const runs: QueueRun[] = [];
      const queue = makeQueue({ pauseMs: 1000, onRun: (run) => runs.push(run) });
      const original = storage.saveSceneAnalysis.bind(storage);
      storage.saveSceneAnalysis = async (...args) => {
        storage.saveSceneAnalysis = original;
        await write(one, "Marta volvió.");
        queue.sceneEdited(one);
        await original(...args);
      };

      queue.start();
      await advance(queue, 1);
      await advance(queue, 1000);

      expect(runs).toHaveLength(2);
      expect(factsOf(await storage.loadAnalysis(projectId))).toEqual(["Marta volvió"]);
      await queue.stop();
    });

    it("doesn't start anything after being stopped", async () => {
      const one = await newScene("1", "Marta llegó.");
      const queue = makeQueue({ pauseMs: 1000 });
      queue.sceneEdited(one);

      await queue.stop();
      await advance(queue, 10_000);
      queue.sceneClosed(one);
      await advance(queue, 10_000);

      expect(model.state.asked).toEqual([]);
    });
  });

  it("stopping cancels what's in progress, and that scene stays queued", async () => {
    const one = await newScene("1", "Marta llegó.");
    let queue: AnalysisQueue | null = null;
    const stopsMidway: AiProvider = {
      ...model.provider,
      generate(request) {
        void queue?.stop();
        return model.provider.generate(request);
      },
    };
    queue = makeQueue({ analysis: { provider: stopsMidway, model: "m", language: "es" } });

    const run = await queue.run();

    expect(run).toMatchObject({ status: "cancelled", analyzed: [], pending: 1 });
    expect((await storage.listScenesToAnalyze(projectId)).map((scene) => scene.id)).toEqual([one]);
    expect(factsOf(await storage.loadAnalysis(projectId))).toEqual([]);
  });

  it("reports what isn't the model's fault, without taking it for being offline", async () => {
    await newScene("1", "Marta llegó.");
    const broken: Storage = {
      ...storage,
      saveSceneAnalysis: async () => {
        throw new Error("disk full");
      },
    };
    const errors: unknown[] = [];
    fakeTimers();
    const queue = makeQueue({ storage: broken, onError: (error) => errors.push(error) });

    queue.start();
    await advance(queue, 1);

    expect(errors).toEqual([expect.objectContaining({ message: "disk full" })]);
    await queue.stop();
  });

  it("leaves the trash out", async () => {
    const one = await newScene("1", "Marta llegó.");
    await storage.trashScene(one);

    const run = await makeQueue().run();

    expect(run.analyzed).toEqual([]);
  });

  it("hashes the same text the same way, and any change differently", async () => {
    expect(await hashText("Marta")).toBe(await hashText("Marta"));
    expect(await hashText("Marta")).not.toBe(await hashText("Marta."));
    expect(await hashText("Marta")).toMatch(/^[0-9a-f]{64}$/);
  });
});
