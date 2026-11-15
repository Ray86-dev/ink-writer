import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acceptOpenRouterNotice,
  analysisModels,
  connectionAllowed,
  createConnectionProvider,
  hasAcceptedOpenRouterNotice,
  loadAiConnection,
  type ModelInfo,
  openSqlStorage,
  type Storage,
  saveAiConnection,
} from "../src/index";
import { createNodeSqliteDriver } from "./support/node-sqlite-driver";

describe("settings", () => {
  let driver: ReturnType<typeof createNodeSqliteDriver>;
  let storage: Storage;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    ({ storage } = await openSqlStorage(driver));
  });

  afterEach(() => driver.close());

  it("keeps a value until it's changed or forgotten", async () => {
    await expect(storage.getSetting("a")).resolves.toBeNull();

    await storage.setSetting("a", "uno");
    await storage.setSetting("b", "ñ 🖋️");
    await storage.setSetting("a", "dos");

    await expect(storage.getSetting("a")).resolves.toBe("dos");
    await expect(storage.getSetting("b")).resolves.toBe("ñ 🖋️");

    await storage.setSetting("a", null);
    await storage.setSetting("never there", null);
    await expect(storage.getSetting("a")).resolves.toBeNull();
    await expect(storage.getSetting("b")).resolves.toBe("ñ 🖋️");
  });

  it("survives reopening the database", async () => {
    await saveAiConnection(storage, { route: "ollama", model: "gemma4:latest" });

    const { storage: reopened } = await openSqlStorage(driver);

    await expect(loadAiConnection(reopened)).resolves.toEqual({
      route: "ollama",
      model: "gemma4:latest",
    });
  });

  describe("the AI connection", () => {
    it("is nothing until the author chooses", async () => {
      await expect(loadAiConnection(storage)).resolves.toBeNull();
    });

    it("can be changed and turned off", async () => {
      await saveAiConnection(storage, { route: "ollama", model: "a" });
      await saveAiConnection(storage, { route: "openrouter", model: "b:free" });
      await expect(loadAiConnection(storage)).resolves.toEqual({
        route: "openrouter",
        model: "b:free",
      });

      await saveAiConnection(storage, null);
      await expect(loadAiConnection(storage)).resolves.toBeNull();
    });

    it.each([
      "not json",
      "null",
      '"ollama"',
      '{"route":"chatgpt","model":"x"}',
      '{"route":"ollama"}',
      '{"route":"ollama","model":""}',
      '{"route":"ollama","model":7}',
    ])("reads %s as no choice, rather than guessing one", async (stored) => {
      await storage.setSetting("ai_connection", stored);

      await expect(loadAiConnection(storage)).resolves.toBeNull();
    });

    it("needs the notice accepted for OpenRouter, and never for a local model", async () => {
      const local = { route: "ollama", model: "a" } as const;
      const remote = { route: "openrouter", model: "b:free" } as const;

      await expect(hasAcceptedOpenRouterNotice(storage)).resolves.toBe(false);
      await expect(connectionAllowed(storage, local)).resolves.toBe(true);
      await expect(connectionAllowed(storage, remote)).resolves.toBe(false);

      await acceptOpenRouterNotice(storage, new Date("2026-11-14T12:00:00Z"));

      await expect(hasAcceptedOpenRouterNotice(storage)).resolves.toBe(true);
      await expect(connectionAllowed(storage, remote)).resolves.toBe(true);
      // Turning the analysis off doesn't ask again later.
      await saveAiConnection(storage, null);
      await expect(hasAcceptedOpenRouterNotice(storage)).resolves.toBe(true);
    });
  });
});

describe("models offered for the analysis", () => {
  const model = (id: string, structured: boolean, free?: boolean): ModelInfo => ({
    id,
    displayName: id,
    capabilities: {
      structuredOutput: structured ? "json_schema" : "none",
      webSearch: false,
      tools: false,
    },
    ...(free === undefined ? {} : { free }),
  });
  const models = [
    model("free-structured", true, true),
    model("free-plain", false, true),
    model("paid-structured", true, false),
    model("unknown-price", true),
  ];

  it("through OpenRouter, only free ones that follow a schema", () => {
    expect(analysisModels("openrouter", models).map((entry) => entry.id)).toEqual([
      "free-structured",
    ]);
  });

  it("locally, any that follows a schema", () => {
    expect(analysisModels("ollama", models).map((entry) => entry.id)).toEqual([
      "free-structured",
      "paid-structured",
      "unknown-price",
    ]);
  });
});

describe("the provider of a connection", () => {
  const transport = {
    send: async () => {
      throw new Error("not reached");
    },
  };

  it("is the one the author chose and no other", () => {
    expect(createConnectionProvider("ollama", transport).id).toBe("ollama");
    expect(createConnectionProvider("openrouter", transport).id).toBe("openrouter");
  });
});
