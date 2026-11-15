import type {
  AiProvider,
  ConnectionRoute,
  GenerateEvent,
  GenerateOutcome,
  GenerateRequest,
  ModelInfo,
} from "@ink-writer/core";
import type { AiShell } from "../../src/shell";

const model = (id: string, free?: boolean): ModelInfo => ({
  id,
  displayName: id,
  capabilities: { structuredOutput: "json_schema", webSearch: false, tools: false },
  ...(free === undefined ? {} : { free }),
});

/**
 * The shell's AI side, with no network and no browser. `connect` decides how signing in ends.
 */
export function fakeAi() {
  const state = {
    connected: false,
    /** What the next sign-in does. A string makes it fail with that message. */
    connect: "ok" as "ok" | "wait" | string,
    cancelled: 0,
  };
  let release: ((error: Error) => void) | null = null;
  const ai: AiShell = {
    transport: {
      send: async () => {
        throw new Error("The tests replace the provider, so nothing reaches the transport");
      },
    },
    openrouterConnected: async () => state.connected,
    connectOpenrouter: () =>
      new Promise<void>((resolve, reject) => {
        if (state.connect === "ok") {
          state.connected = true;
          resolve();
        } else if (state.connect === "wait") {
          release = reject;
        } else {
          reject(new Error(state.connect));
        }
      }),
    cancelConnectOpenrouter: () => {
      state.cancelled += 1;
      release?.(new Error("cancelled"));
      release = null;
    },
    disconnectOpenrouter: async () => {
      state.connected = false;
    },
  };
  return { ai, state };
}

/**
 * Models that find one fact in each scene: its first sentence. Enough to see what got analysed,
 * with which model, and what happens when the model fails.
 */
export function fakeModels() {
  const state = {
    asked: [] as { route: ConnectionRoute; request: GenerateRequest }[],
    failWith: null as GenerateOutcome | null,
    /** Makes listing the models fail, as when Ollama isn't running. */
    unreachable: false,
    models: {
      ollama: [model("gemma4:latest"), model("gemma4:e2b")],
      openrouter: [model("some/model:free", true), model("some/paid-model", false)],
    } as Record<ConnectionRoute, ModelInfo[]>,
  };
  const createProvider = (route: ConnectionRoute): AiProvider => ({
    id: route,
    displayName: route,
    billing: route === "ollama" ? "local" : "openrouter_credits",
    listModels: async () => {
      if (state.unreachable) {
        throw new Error("unreachable");
      }
      return state.models[route];
    },
    async *generate(request): AsyncGenerator<GenerateEvent> {
      state.asked.push({ route, request });
      if (request.signal?.aborted) {
        yield { type: "end", outcome: { status: "interrupted", message: "cancelled" } };
        return;
      }
      if (state.failWith !== null) {
        yield { type: "end", outcome: state.failWith };
        return;
      }
      const text = request.input.split("SCENE ")[1]?.split(":\n")[1] ?? "";
      const quote = text.split(".")[0] ?? "";
      const name = request.structured?.name;
      const answer =
        name === "scene_extraction"
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
          : name === "proofreading"
            ? { corrections: [] }
            : name === "comparison"
              ? { findings: [] }
              : { answers: [] };
      yield { type: "text", delta: JSON.stringify(answer) };
      yield { type: "end", outcome: { status: "completed" } };
    },
  });
  return { createProvider, state };
}
