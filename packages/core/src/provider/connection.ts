import type { Storage } from "../storage/storage";
import { createOllamaProvider } from "./ollama";
import { createOpenRouterProvider } from "./openrouter";
import type { AiProvider, ModelInfo } from "./provider";
import type { AiTransport } from "./transport";

/**
 * Which model analyses the novel: the author's choice, kept until they change it. Nothing here
 * picks one for them or falls back to another (rule 10). See docs/adr/0012.
 */

export type ConnectionRoute = "ollama" | "openrouter";

export const CONNECTION_ROUTES: readonly ConnectionRoute[] = ["ollama", "openrouter"];

export interface AiConnection {
  readonly route: ConnectionRoute;
  readonly model: string;
}

const CONNECTION_KEY = "ai_connection";
const NOTICE_KEY = "openrouter_notice_accepted";

const isRoute = (value: unknown): value is ConnectionRoute =>
  CONNECTION_ROUTES.includes(value as ConnectionRoute);

/** Null if nothing was chosen, or if what's stored can't be read as a choice. */
export async function loadAiConnection(storage: Storage): Promise<AiConnection | null> {
  const stored = await storage.getSetting(CONNECTION_KEY);
  if (stored === null) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(stored);
    if (typeof value === "object" && value !== null) {
      const { route, model } = value as Record<string, unknown>;
      if (isRoute(route) && typeof model === "string" && model !== "") {
        return { route, model };
      }
    }
  } catch {
    // Treated as no choice: analysing with a guess would be worse than not analysing.
  }
  return null;
}

/** Null turns the analysis off. */
export async function saveAiConnection(
  storage: Storage,
  connection: AiConnection | null,
): Promise<void> {
  await storage.setSetting(
    CONNECTION_KEY,
    connection === null
      ? null
      : JSON.stringify({ route: connection.route, model: connection.model }),
  );
}

/**
 * Through OpenRouter the text leaves the machine, and the author must have been told before the
 * first request. This is their answer, kept so that it's asked once.
 */
export async function hasAcceptedOpenRouterNotice(storage: Storage): Promise<boolean> {
  return (await storage.getSetting(NOTICE_KEY)) !== null;
}

export async function acceptOpenRouterNotice(storage: Storage, now = new Date()): Promise<void> {
  await storage.setSetting(NOTICE_KEY, now.toISOString());
}

/**
 * The models that can be offered for the analysis: it needs output that follows a schema, and through
 * OpenRouter only the free ones until there are spending limits.
 */
export function analysisModels(
  route: ConnectionRoute,
  models: readonly ModelInfo[],
): readonly ModelInfo[] {
  return models.filter(
    (model) =>
      model.capabilities.structuredOutput === "json_schema" &&
      (route !== "openrouter" || model.free === true),
  );
}

export function createConnectionProvider(
  route: ConnectionRoute,
  transport: AiTransport,
): AiProvider {
  return route === "ollama" ? createOllamaProvider(transport) : createOpenRouterProvider(transport);
}

/**
 * Whether the analysis may run with this choice. Local models always can. OpenRouter only once the
 * author has accepted the notice.
 */
export async function connectionAllowed(
  storage: Storage,
  connection: AiConnection,
): Promise<boolean> {
  return connection.route === "ollama" || (await hasAcceptedOpenRouterNotice(storage));
}
