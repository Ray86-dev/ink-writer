import { describe, expect, it } from "vitest";
import { type AiProvider, collectDraft, type GenerateEvent, type ModelInfo } from "../src/index";

const toList = async (events: AsyncIterable<GenerateEvent>) => {
  const list: GenerateEvent[] = [];
  for await (const event of events) {
    list.push(event);
  }
  return list;
};

const request = (model: string) => ({ model, instructions: "Prueba", input: "Hola" });

const schema = { name: "x", schema: { type: "object" } };

/**
 * What every provider must do. Adapters from M3 onward run this same suite, so the core can rely on
 * it without knowing which provider it is talking to.
 */
export function describeProviderContract(name: string, makeProvider: () => AiProvider): void {
  describe(`provider contract: ${name}`, () => {
    const modelWhere = async (test: (model: ModelInfo) => boolean) => {
      const model = (await makeProvider().listModels()).find(test);
      return model?.id;
    };

    it("declares who pays", () => {
      expect(makeProvider().billing).toMatch(/^(chatgpt_plan|openrouter_credits|api_key|local)$/);
    });

    it("lists models with their capabilities", async () => {
      const models = await makeProvider().listModels();
      expect(models.length).toBeGreaterThan(0);
      for (const model of models) {
        expect(model.id).not.toBe("");
        expect(model.capabilities.structuredOutput).toMatch(/^(json_schema|forced_tool|none)$/);
        expect(typeof model.capabilities.webSearch).toBe("boolean");
        expect(typeof model.capabilities.tools).toBe("boolean");
      }
    });

    it("ends every stream with exactly one end event, as the last one", async () => {
      const id = (await makeProvider().listModels())[0]?.id ?? "";
      const events = await toList(makeProvider().generate(request(id)));
      const ends = events.filter((e) => e.type === "end");

      expect(ends).toHaveLength(1);
      expect(events.at(-1)?.type).toBe("end");
    });

    it("reports an unknown model through the stream instead of throwing", async () => {
      const draft = await collectDraft(makeProvider().generate(request("no-such-model")));

      expect(draft.completed).toBe(false);
      expect(draft.outcome.status).toBe("failed");
    });

    it("refuses a schema the model can't honor, rather than dropping it silently", async () => {
      const id = await modelWhere((m) => m.capabilities.structuredOutput === "none");
      if (id === undefined) return;

      const draft = await collectDraft(
        makeProvider().generate({ ...request(id), structured: schema }),
      );

      expect(draft.outcome).toMatchObject({
        status: "failed",
        error: { code: "unsupported_capability" },
      });
    });

    it("refuses a web search the model can't do, rather than answering without sources", async () => {
      const id = await modelWhere((m) => !m.capabilities.webSearch);
      if (id === undefined) return;

      const draft = await collectDraft(
        makeProvider().generate({ ...request(id), webSearch: { maxSearches: 1 } }),
      );

      expect(draft.outcome).toMatchObject({
        status: "failed",
        error: { code: "unsupported_capability" },
      });
    });

    it("stops when aborted, without reporting success", async () => {
      const id = (await makeProvider().listModels())[0]?.id ?? "";
      const controller = new AbortController();
      controller.abort();

      const draft = await collectDraft(
        makeProvider().generate({ ...request(id), signal: controller.signal }),
      );

      expect(draft.completed).toBe(false);
    });
  });
}
