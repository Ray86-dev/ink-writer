import type { Storage } from "../storage/storage";
import { createDeepSeekProvider } from "./deepseek";
import { createOllamaProvider } from "./ollama";
import { createOpenRouterProvider } from "./openrouter";
import type { AiProvider, ModelInfo } from "./provider";
import type { AiTransport } from "./transport";

/**
 * Which model analyses the novel: the author's choice, kept until they change it. Nothing here
 * picks one for them or falls back to another (rule 10). See docs/adr/0012.
 */

export type ConnectionRoute = "ollama" | "openrouter" | "deepseek";

export const CONNECTION_ROUTES: readonly ConnectionRoute[] = ["ollama", "openrouter", "deepseek"];

/** The routes where the text leaves the machine, each with its own notice to accept. */
export type RemoteRoute = Exclude<ConnectionRoute, "ollama">;

export interface AiConnection {
  readonly route: ConnectionRoute;
  readonly model: string;
}

const CONNECTION_KEY = "ai_connection";
const noticeKey = (route: RemoteRoute) => `${route}_notice_accepted`;

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
 * Through a remote service the text leaves the machine, and the author must have been told before
 * the first request. This is their answer, kept so that it's asked once for each service.
 */
export async function hasAcceptedNotice(storage: Storage, route: RemoteRoute): Promise<boolean> {
  return (await storage.getSetting(noticeKey(route))) !== null;
}

export async function acceptNotice(
  storage: Storage,
  route: RemoteRoute,
  now = new Date(),
): Promise<void> {
  await storage.setSetting(noticeKey(route), now.toISOString());
}

export const hasAcceptedOpenRouterNotice = (storage: Storage) =>
  hasAcceptedNotice(storage, "openrouter");

export const acceptOpenRouterNotice = (storage: Storage, now = new Date()) =>
  acceptNotice(storage, "openrouter", now);

/**
 * The models that can be offered for the analysis. It needs structured output, and one that costs
 * money is only offered once the author has allowed paying and set a limit.
 */
export function analysisModels(
  route: ConnectionRoute,
  models: readonly ModelInfo[],
  paidAllowed = false,
): readonly ModelInfo[] {
  return models.filter((model) => {
    const structured =
      model.capabilities.structuredOutput === "json_schema" ||
      model.capabilities.structuredOutput === "json_object";
    if (route === "ollama") {
      return structured;
    }
    if (route === "openrouter") {
      return structured && (model.free === true || paidAllowed);
    }
    return structured && paidAllowed;
  });
}

export function createConnectionProvider(
  route: ConnectionRoute,
  transport: AiTransport,
): AiProvider {
  switch (route) {
    case "ollama":
      return createOllamaProvider(transport);
    case "openrouter":
      return createOpenRouterProvider(transport);
    case "deepseek":
      return createDeepSeekProvider(transport);
  }
}

/**
 * Whether the analysis may run with this choice. Local models always can. A remote service only
 * once the author has accepted its notice.
 */
export async function connectionAllowed(
  storage: Storage,
  connection: AiConnection,
): Promise<boolean> {
  return connection.route === "ollama" || (await hasAcceptedNotice(storage, connection.route));
}
