import type { AiProvider, ModelInfo, Usage } from "../src/provider/provider";

/** M3 runs without spending. These are what makes that a guarantee and not an intention. */

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
 * The free tier allows few requests a day. Reading twice, resolving, comparing several groups and
 * proofreading come to about this many per scene, measured on `fixtures/`.
 */
export function estimateRequests(uncachedScenes: number): number {
  return uncachedScenes * 6;
}

export function assertAllowance(allowance: DailyAllowance | null, needed: number): void {
  if (allowance !== null && allowance.remaining < needed) {
    throw new SpendingRefused(
      `This run may need ${needed} requests, and ${allowance.remaining} of ${allowance.limit} remain today`,
    );
  }
}

export type { AiProvider };
