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
        yield { type: "text", delta: (JSON.parse(cached) as { text: string }).text };
        yield { type: "end", outcome: { status: "completed" } };
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
        // Only finished answers: a failure must be tried again, not remembered.
        if (event.type === "end" && event.outcome.status === "completed") {
          writeFileSync(file, JSON.stringify({ text }));
        }
        yield event;
      }
    },
  };
}
