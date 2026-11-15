import type { ResearchAnswer, ResearchRequest } from "@ink-writer/core";
import type { AvailableUpdate, Shell } from "../../src/shell";

type Reply = ResearchAnswer | Error;

const PLACE = {
  osm_type: "node",
  osm_id: 5303173543,
  lat: "40.4084539",
  lon: "-3.7006613",
  display_name: "Puerto Viejo de Algorta, Getxo, Bizkaia, España",
};

const ok = (body: unknown): ResearchAnswer => ({ status: 200, body: JSON.stringify(body) });

/**
 * The shell's side of the documentation and of the updates, with no network: it records every search the page asks
 * for, answers from a table, and counts them against a daily limit as the real one does.
 */
export function fakeResearch() {
  const state = {
    sent: [] as ResearchRequest[],
    replies: {
      geocode: ok([PLACE]),
      wiki: ok({
        query: {
          pages: [
            {
              title: "Puerto Viejo de Algorta",
              index: 1,
              extract: "El Puerto Viejo es un antiguo barrio de pescadores.",
              canonicalurl: "https://es.wikipedia.org/wiki/Puerto_Viejo_de_Algorta",
            },
          ],
        },
      }),
      climate: ok({ daily: { time: [] } }),
      nearby: ok({
        elements: [
          { type: "way", id: 1, tags: { highway: "residential", name: "Calle del Muelle" } },
          { type: "node", id: 7, tags: { amenity: "cafe", name: "Café del Puerto" } },
        ],
      }),
    } as Record<ResearchRequest["kind"], Reply>,
    dailyRequests: 60,
    usedToday: 0,
    opened: [] as string[],
    // Updates: what the releases would answer, and what the page asked for.
    version: "0.1.0",
    update: null as AvailableUpdate | Error | null,
    updateChecks: 0,
    installed: 0,
    installFails: null as Error | null,
  };
  const shell: Pick<Shell, "research" | "openLink" | "updates"> = {
    updates: {
      version: async () => state.version,
      check: async () => {
        state.updateChecks += 1;
        if (state.update instanceof Error) {
          throw state.update;
        }
        return state.update;
      },
      install: async () => {
        if (state.installFails !== null) {
          throw state.installFails;
        }
        state.installed += 1;
      },
    },
    research: {
      transport: {
        fetch: async (request) => {
          if (state.usedToday >= state.dailyRequests) {
            throw new Error(`limit: the ${state.dailyRequests} searches allowed today are used up`);
          }
          state.usedToday += 1;
          state.sent.push(request);
          const reply = state.replies[request.kind];
          if (reply instanceof Error) {
            throw reply;
          }
          return reply;
        },
      },
      searchLimit: async () => ({
        dailyRequests: state.dailyRequests,
        usedToday: state.usedToday,
      }),
      setSearchLimit: async (dailyRequests) => {
        state.dailyRequests = dailyRequests;
        return { dailyRequests, usedToday: state.usedToday };
      },
    },
    openLink: async (url) => {
      state.opened.push(url);
    },
  };
  return { shell, state };
}
