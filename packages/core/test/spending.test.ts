import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  type AiConnection,
  type AiProvider,
  AnalysisQueue,
  acceptNotice,
  analysisModels,
  buildOpenRouterBody,
  canBePriced,
  connectionAllowed,
  costOf,
  createConnectionProvider,
  type GenerateEvent,
  hasAcceptedNotice,
  isPaidConnection,
  loadAiConnection,
  loadSpendingCap,
  type ModelInfo,
  openSqlStorage,
  SpendingGuard,
  type Storage,
  saveAiConnection,
  saveSpendingCap,
  spendingDay,
  usageOn,
} from "../src/index";
import { createNodeSqliteDriver } from "./support/node-sqlite-driver";
import { writeParagraphs } from "./support/prose";

const local: AiConnection = { route: "ollama", model: "gemma4:latest" };
const free: AiConnection = { route: "openrouter", model: "some/model:free" };
const paid: AiConnection = { route: "openrouter", model: "some/model" };
const byKey: AiConnection = { route: "deepseek", model: "deepseek-flash" };

const usage = (inputTokens: number | null, outputTokens: number | null, cost: number | null) => ({
  inputTokens,
  outputTokens,
  cost,
});

describe("what costs money", () => {
  it("a local model and a free one don't; a paid model and a service by key do", () => {
    expect(isPaidConnection(local)).toBe(false);
    expect(isPaidConnection(free)).toBe(false);
    expect(isPaidConnection(paid)).toBe(true);
    expect(isPaidConnection(byKey)).toBe(true);
  });

  it("a free answer costs nothing, whatever it reports", () => {
    expect(costOf(local, usage(1000, 1000, null))).toBe(0);
    expect(costOf(free, usage(null, null, null))).toBe(0);
  });

  it("through OpenRouter the cost is what the service says, and unknown if it doesn't", () => {
    expect(costOf(paid, usage(1000, 500, 0.0042))).toBe(0.0042);
    expect(costOf(paid, usage(1000, 500, null))).toBeNull();
  });

  it("by key it's worked out from the tokens, at the highest published rate", () => {
    // 1,000,000 in at 0.30 $ and 500,000 out at 1.20 $ per million.
    expect(costOf(byKey, usage(1_000_000, 500_000, null))).toBeCloseTo(0.9, 10);
    expect(costOf(byKey, usage(null, 500, null))).toBeNull();
    expect(costOf({ route: "deepseek", model: "unknown-model" }, usage(10, 10, null))).toBeNull();
  });

  it("a model with no known price can't be priced, so it can't be offered", () => {
    expect(canBePriced(byKey)).toBe(true);
    expect(canBePriced(paid)).toBe(true);
    expect(canBePriced(local)).toBe(true);
    expect(canBePriced({ route: "deepseek", model: "unknown-model" })).toBe(false);
  });

  it("asks OpenRouter for the cost on a paid model, and leaves a free model's request as it was", () => {
    const request = { instructions: "i", input: "x" };

    expect(buildOpenRouterBody({ ...request, model: "some/model" })).toMatchObject({
      usage: { include: true },
    });
    expect(buildOpenRouterBody({ ...request, model: "some/model:free" })).not.toHaveProperty(
      "usage",
    );
  });
});

describe("models offered", () => {
  const model = (
    id: string,
    mode: "json_schema" | "json_object" | "none",
    isFree?: boolean,
  ): ModelInfo => ({
    id,
    displayName: id,
    capabilities: { structuredOutput: mode, webSearch: false, tools: false },
    ...(isFree === undefined ? {} : { free: isFree }),
  });
  const models = [
    model("free", "json_schema", true),
    model("paid", "json_schema", false),
    model("plain", "none", true),
    model("json-only", "json_object", false),
  ];
  const ids = (list: readonly ModelInfo[]) => list.map((entry) => entry.id);

  it("through OpenRouter, paid ones only once paying is allowed", () => {
    expect(ids(analysisModels("openrouter", models))).toEqual(["free"]);
    expect(ids(analysisModels("openrouter", models, true))).toEqual(["free", "paid", "json-only"]);
  });

  it("by key, none until paying is allowed", () => {
    expect(ids(analysisModels("deepseek", models))).toEqual([]);
    expect(ids(analysisModels("deepseek", models, true))).toEqual(["free", "paid", "json-only"]);
  });

  it("locally, any that gives structured output, with or without it", () => {
    expect(ids(analysisModels("ollama", models))).toEqual(["free", "paid", "json-only"]);
  });

  it("the provider of a choice by key is that service and no other", () => {
    const transport = {
      send: async () => {
        throw new Error("not reached");
      },
    };

    expect(createConnectionProvider("deepseek", transport).id).toBe("deepseek");
    expect(createConnectionProvider("deepseek", transport).billing).toBe("api_key");
  });
});

describe("spending", () => {
  let driver: ReturnType<typeof createNodeSqliteDriver>;
  let storage: Storage;
  let clock: Date;
  const now = () => clock;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    ({ storage } = await openSqlStorage(driver));
    clock = new Date(2026, 10, 15, 10, 0);
  });

  afterEach(() => driver.close());

  it("each remote service has its own notice to accept", async () => {
    await acceptNotice(storage, "openrouter");

    await expect(hasAcceptedNotice(storage, "openrouter")).resolves.toBe(true);
    await expect(hasAcceptedNotice(storage, "deepseek")).resolves.toBe(false);
    await expect(connectionAllowed(storage, byKey)).resolves.toBe(false);

    await acceptNotice(storage, "deepseek");
    await expect(connectionAllowed(storage, byKey)).resolves.toBe(true);
  });

  it("keeps a choice by key", async () => {
    await saveAiConnection(storage, byKey);

    await expect(loadAiConnection(storage)).resolves.toEqual(byKey);
  });

  it("there's no limit until the author sets one, and only a real amount is one", async () => {
    await expect(loadSpendingCap(storage)).resolves.toBeNull();

    await saveSpendingCap(storage, 0.5);
    await expect(loadSpendingCap(storage)).resolves.toBe(0.5);

    for (const nothing of [0, -1, Number.NaN, null]) {
      await saveSpendingCap(storage, nothing);
      await expect(loadSpendingCap(storage)).resolves.toBeNull();
    }
    await storage.setSetting("ai_daily_spending_cap", "mucho");
    await expect(loadSpendingCap(storage)).resolves.toBeNull();
  });

  it("adds up what each service was asked each day", async () => {
    await storage.addUsage("2026-11-15", "deepseek", 0.01);
    await storage.addUsage("2026-11-15", "deepseek", 0.02);
    await storage.addUsage("2026-11-15", "ollama", 0);
    await storage.addUsage("2026-11-16", "deepseek", 0.5);

    await expect(storage.listUsage("2026-11-15")).resolves.toEqual([
      { route: "deepseek", requests: 2, cost: 0.03 },
      { route: "ollama", requests: 1, cost: 0 },
    ]);
    const day = await usageOn(storage, "2026-11-15");
    expect(day.requests).toBe(3);
    expect(day.cost).toBeCloseTo(0.03, 10);
    await expect(usageOn(storage, "2026-11-17")).resolves.toEqual({ requests: 0, cost: 0 });
  });

  it("the day is the author's own, not UTC's", () => {
    expect(spendingDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(spendingDay(new Date(2026, 0, 6, 0, 0))).toBe("2026-01-06");
  });

  describe("the guard", () => {
    it("never stops a model that costs nothing, and still counts what it's asked", async () => {
      const guard = new SpendingGuard(storage, local, now);

      guard.onUsage(usage(100, 100, 0));
      guard.onUsage(usage(100, 100, 0));

      await expect(guard.check()).resolves.toBeNull();
      await expect(usageOn(storage, "2026-11-15")).resolves.toEqual({ requests: 2, cost: 0 });
    });

    it("stops a paid model that has no limit set, before it asks anything", async () => {
      const guard = new SpendingGuard(storage, byKey, now);

      await expect(guard.check()).resolves.toBe("cap: no daily spending limit is set");
    });

    it("lets a paid model go on until the day's limit is reached, and then stops it", async () => {
      await saveSpendingCap(storage, 0.05);
      const guard = new SpendingGuard(storage, paid, now);

      await expect(guard.check()).resolves.toBeNull();
      guard.onUsage(usage(1000, 1000, 0.03));
      await expect(guard.check()).resolves.toBeNull();
      guard.onUsage(usage(1000, 1000, 0.02));

      await expect(guard.check()).resolves.toBe("cap: today's limit of 0.05 $ is reached");
    });

    it("counts what was spent before a restart, and by another service", async () => {
      await saveSpendingCap(storage, 0.05);
      await storage.addUsage("2026-11-15", "openrouter", 0.04);
      await storage.addUsage("2026-11-15", "deepseek", 0.01);

      await expect(new SpendingGuard(storage, byKey, now).check()).resolves.toMatch(/^cap: today/);
    });

    it("starts again the next day", async () => {
      await saveSpendingCap(storage, 0.05);
      await storage.addUsage("2026-11-15", "deepseek", 0.05);
      const guard = new SpendingGuard(storage, byKey, now);
      await expect(guard.check()).resolves.toMatch(/^cap: today/);

      clock = new Date(2026, 10, 16, 8, 0);

      await expect(guard.check()).resolves.toBeNull();
    });

    it("stops if an answer of a paid model doesn't say what it cost", async () => {
      await saveSpendingCap(storage, 5);
      const guard = new SpendingGuard(storage, paid, now);

      guard.onUsage(usage(1000, 1000, null));

      await expect(guard.check()).resolves.toBe("cap: an answer didn't say what it cost");
      // The request is still counted, at nothing: it happened.
      await expect(usageOn(storage, "2026-11-15")).resolves.toEqual({ requests: 1, cost: 0 });
    });

    it("stops a model whose price isn't known, before it asks anything", async () => {
      await saveSpendingCap(storage, 5);
      const guard = new SpendingGuard(storage, { route: "deepseek", model: "unknown-model" }, now);

      await expect(guard.check()).resolves.toBe("cap: an answer didn't say what it cost");
    });

    it("stops if what was spent can't be written down", async () => {
      await saveSpendingCap(storage, 5);
      const broken: Storage = {
        ...storage,
        addUsage: async () => {
          throw new Error("disk full");
        },
      };
      const guard = new SpendingGuard(broken, byKey, now);

      guard.onUsage(usage(1000, 1000, null));

      await expect(guard.check()).resolves.toBe("cap: what was spent couldn't be written down");
    });
  });

  describe("in the queue", () => {
    let projectId: string;
    let scenes: string[];

    /** Answers every step, saying each answer used a thousand tokens each way. */
    const model = (): { provider: AiProvider; asked: () => number } => {
      let count = 0;
      const provider: AiProvider = {
        id: "deepseek",
        displayName: "DeepSeek",
        billing: "api_key",
        listModels: async () => [],
        async *generate(request): AsyncGenerator<GenerateEvent> {
          count += 1;
          const name = request.structured?.name ?? "";
          const answer =
            name === "scene_extraction"
              ? { entities: [], facts: [], relations: [] }
              : name === "proofreading"
                ? { corrections: [] }
                : name === "scene_digest"
                  ? { change: "", summaries: [], questions: [], suggestions: [] }
                  : name === "comparison"
                    ? { findings: [] }
                    : { answers: [] };
          yield { type: "text", delta: JSON.stringify(answer) };
          yield {
            type: "end",
            outcome: { status: "completed" },
            usage: usage(1000, 1000, null),
          };
        },
      };
      return { provider, asked: () => count };
    };

    beforeEach(async () => {
      projectId = (await storage.createProject({ title: "T", language: "es", era: "e" })).id;
      const chapter = await storage.createChapter(projectId, "C");
      scenes = [];
      for (const title of ["1", "2", "3"]) {
        const scene = await storage.createScene(chapter.id, title);
        const doc = new Y.Doc();
        writeParagraphs(doc, [`Escena ${title}.`]);
        await storage.appendSceneUpdate(scene.id, Y.encodeStateAsUpdate(doc));
        doc.destroy();
        scenes.push(scene.id);
      }
    });

    const queueWith = (guard: SpendingGuard, provider: AiProvider) =>
      new AnalysisQueue({
        storage,
        projectId,
        analysis: { provider, model: "deepseek-flash", language: "es", onUsage: guard.onUsage },
        beforeScene: () => guard.check(),
      });

    it("with no limit set, a paid model is never asked and every scene stays queued", async () => {
      const { provider, asked } = model();

      const run = await queueWith(new SpendingGuard(storage, byKey, now), provider).run();

      expect(run).toMatchObject({
        status: "blocked",
        analyzed: [],
        pending: 3,
        message: "cap: no daily spending limit is set",
      });
      expect(asked()).toBe(0);
    });

    it("stops between scenes once the day's limit is reached, and goes on the next day", async () => {
      // Each answer counts 0.0015 $, and a scene takes three: one scene fits under 0.005 $.
      await saveSpendingCap(storage, 0.005);
      const { provider } = model();
      const guard = new SpendingGuard(storage, byKey, now);

      const first = await queueWith(guard, provider).run();

      expect(first.status).toBe("blocked");
      expect(first.message).toBe("cap: today's limit of 0.005 $ is reached");
      expect(first.analyzed.length).toBeGreaterThan(0);
      expect(first.analyzed.length).toBeLessThan(3);
      expect(first.pending).toBe(3 - first.analyzed.length);
      const spent = (await usageOn(storage, "2026-11-15")).cost;
      expect(spent).toBeGreaterThanOrEqual(0.005);

      // Asking again the same day asks nothing more.
      const again = await queueWith(guard, provider).run();
      expect(again).toMatchObject({ status: "blocked", analyzed: [] });
      expect((await usageOn(storage, "2026-11-15")).cost).toBe(spent);

      clock = new Date(2026, 10, 16, 8, 0);
      const nextDay = await queueWith(guard, provider).run();
      expect(nextDay.analyzed.length).toBeGreaterThan(0);
    });

    it("a model that costs nothing is never stopped by any of this", async () => {
      const { provider } = model();

      const run = await queueWith(new SpendingGuard(storage, local, now), provider).run();

      expect(run).toMatchObject({ status: "done", analyzed: scenes, pending: 0 });
    });
  });
});
