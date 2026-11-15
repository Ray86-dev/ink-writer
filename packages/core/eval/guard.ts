import type { AiProvider, ModelInfo, Usage } from "../src/provider/provider";
import { KNOWN_PRICES, type TokenPrices } from "../src/provider/spending";

/**
 * The evaluation runs without spending unless it's told a limit. These are what makes that a guarantee
 * and not an intention.
 */

export class SpendingRefused extends Error {
  override readonly name = "SpendingRefused";
}

/**
 * Only a model that OpenRouter itself states is free: named `:free`, with a price of zero. A paid
 * model given by mistake stops here, before any request goes out.
 */
export function assertFreeModel(models: readonly ModelInfo[], id: string): void {
  const model = models.find((candidate) => candidate.id === id);
  if (model === undefined) {
    throw new SpendingRefused(`OpenRouter has no model "${id}"`);
  }
  if (model.free !== true) {
    throw new SpendingRefused(`"${id}" isn't free, and this evaluation runs without spending`);
  }
}

/** Stops at the first answer reporting any cost, however small. */
export function assertNoCost(usage: Usage): void {
  if (usage.cost !== null && usage.cost > 0) {
    throw new SpendingRefused(`A request reported a cost of ${usage.cost} $: stopping`);
  }
}

export interface DailyAllowance {
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
}

/**
 * The free tier allows few requests a day. Reading twice, resolving, comparing several groups,
 * proofreading and the digest come to about this many per scene, measured on `fixtures/`.
 */
export function estimateRequests(uncachedScenes: number): number {
  return uncachedScenes * 7;
}

export function assertAllowance(allowance: DailyAllowance | null, needed: number): void {
  if (allowance !== null && allowance.remaining < needed) {
    throw new SpendingRefused(
      `This run may need ${needed} requests, and ${allowance.remaining} of ${allowance.limit} remain today`,
    );
  }
}

export type { TokenPrices };

/**
 * Only models with a known price can be paid for: without one, nothing could say when to stop. The
 * prices are the app's own, in `src/provider/spending.ts`.
 */
export function pricesFor(model: string): TokenPrices {
  const prices = KNOWN_PRICES.deepseek?.[model];
  if (prices === undefined) {
    throw new SpendingRefused(`There's no known price for "${model}"`);
  }
  return prices;
}

export function parseSpendingLimit(text: string | undefined): number {
  const limit = Number(text);
  if (text === undefined || !Number.isFinite(limit) || limit <= 0) {
    throw new SpendingRefused("A paid model needs a spending limit in dollars: --max-cost 0.50");
  }
  return limit;
}

export interface SpendingMeter {
  readonly spent: () => number;
  readonly count: (usage: Usage) => void;
}

/**
 * Adds up what each answer cost, and stops before the next request once it reaches the limit. An
 * answer that can't be counted stops it too: going on would be spending without knowing how much.
 */
export function createSpendingMeter(prices: TokenPrices, limit: number): SpendingMeter {
  let spent = 0;
  return {
    spent: () => spent,
    count(usage) {
      if (usage.inputTokens === null || usage.outputTokens === null) {
        throw new SpendingRefused("An answer didn't say how many tokens it used: stopping");
      }
      spent +=
        (usage.inputTokens * prices.inputPerMillion +
          usage.outputTokens * prices.outputPerMillion) /
        1_000_000;
      if (spent >= limit) {
        throw new SpendingRefused(
          `The limit of ${limit} $ was reached, at about ${spent.toFixed(4)} $: stopping`,
        );
      }
    },
  };
}

export type { AiProvider };
