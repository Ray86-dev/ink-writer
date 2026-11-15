import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AiProvider, GenerateEvent, GenerateRequest } from "../src/provider/provider";

export interface CacheStats {
  hits: number;
  misses: number;
}

function keyOf(providerId: string, request: GenerateRequest): string {
  const { signal: _signal, ...content } = request;
  return createHash("sha256").update(JSON.stringify({ providerId, content })).digest("hex");
}

/**
 * Remembers completed answers on disk. The free tier allows few requests a day, so an unchanged prompt
 * is never asked twice, and changing one prompt only re-runs what depends on it.
 */
export function withCache(
  provider: AiProvider,
  directory: string,
  /** Never asks: for scoring again what's already known, so that it can't use up any allowance. */
  cacheOnly = false,
): AiProvider & { readonly stats: CacheStats } {
  const stats: CacheStats = { hits: 0, misses: 0 };
  mkdirSync(directory, { recursive: true });
  return {
    id: provider.id,
    displayName: provider.displayName,
    billing: provider.billing,
    listModels: () => provider.listModels(),
    stats,
    async *generate(request: GenerateRequest): AsyncGenerator<GenerateEvent> {
      const file = join(directory, `${keyOf(provider.id, request)}.json`);
      let cached: string | null = null;
      try {
        cached = readFileSync(file, "utf8");
      } catch {
        // Not asked yet.
      }
      if (cached !== null) {
        stats.hits += 1;
        const stored = JSON.parse(cached) as { text: string; incomplete?: string | null };
        yield { type: "text", delta: stored.text };
        yield {
          type: "end",
          outcome:
            stored.incomplete === undefined
              ? { status: "completed" }
              : { status: "incomplete", reason: stored.incomplete },
        };
        return;
      }
      stats.misses += 1;
      if (cacheOnly) {
        yield {
          type: "end",
          outcome: {
            status: "failed",
            error: { code: "not_cached", message: "This answer isn't in the cache" },
          },
        };
        return;
      }
      let text = "";
      for await (const event of provider.generate(request)) {
        if (event.type === "text") {
          text += event.delta;
        }
        // A failure of the service must be tried again, not remembered. An answer that the model
        // cut short is the model's answer to that prompt: remembering it too is what makes a run
        // repeat exactly, instead of asking again and drifting from there on.
        if (event.type === "end" && event.outcome.status === "completed") {
          writeFileSync(file, JSON.stringify({ text }));
        } else if (event.type === "end" && event.outcome.status === "incomplete") {
          writeFileSync(file, JSON.stringify({ text, incomplete: event.outcome.reason }));
        }
        yield event;
      }
    },
  };
}
