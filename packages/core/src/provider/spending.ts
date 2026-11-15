import type { Storage } from "../storage/storage";
import type { AiConnection } from "./connection";
import type { Usage } from "./provider";

/**
 * What the analysis costs, and the most the author lets it spend in a day. Paying is never something
 * the app decides: without a limit set by the author, a paid model isn't used at all (rule 10).
 */

export interface TokenPrices {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
}

/**
 * For services that don't say what an answer cost, in dollars. From
 * https://api-docs.deepseek.com/quick_start/pricing/ on 2026-11-09: the peak rates, which are double,
 * and the price of input that isn't cached, so that what's counted can only be above the bill.
 */
export const KNOWN_PRICES: Readonly<Record<string, Readonly<Record<string, TokenPrices>>>> = {
  deepseek: {
    "deepseek-flash": { inputPerMillion: 0.3, outputPerMillion: 1.2 },
  },
};

/** True for a choice that costs the author money. The shell applies the same rule to each request. */
export function isPaidConnection(connection: AiConnection): boolean {
  switch (connection.route) {
    case "ollama":
      return false;
    case "openrouter":
      return !connection.model.endsWith(":free");
    case "deepseek":
      return true;
  }
}

/**
 * What one answer cost, in dollars. Null if it can't be known: then nothing can say when to stop, and
 * whoever counts must stop.
 */
export function costOf(connection: AiConnection, usage: Usage): number | null {
  if (!isPaidConnection(connection)) {
    return 0;
  }
  if (connection.route === "openrouter") {
    return usage.cost;
  }
  const prices = KNOWN_PRICES[connection.route]?.[connection.model];
  if (prices === undefined || usage.inputTokens === null || usage.outputTokens === null) {
    return null;
  }
  return (
    (usage.inputTokens * prices.inputPerMillion + usage.outputTokens * prices.outputPerMillion) /
    1_000_000
  );
}

/** Whether what a paid choice costs can be counted at all. If not, it can't be offered. */
export function canBePriced(connection: AiConnection): boolean {
  return (
    !isPaidConnection(connection) ||
    connection.route === "openrouter" ||
    KNOWN_PRICES[connection.route]?.[connection.model] !== undefined
  );
}

const CAP_KEY = "ai_daily_spending_cap";

/** The most to spend in a day, in dollars. Null until the author sets one: nothing paid until then. */
export async function loadSpendingCap(storage: Storage): Promise<number | null> {
  const stored = Number(await storage.getSetting(CAP_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : null;
}

/** Null, zero or anything that isn't an amount takes the limit away, and with it paid models. */
export async function saveSpendingCap(storage: Storage, dollars: number | null): Promise<void> {
  await storage.setSetting(
    CAP_KEY,
    dollars !== null && Number.isFinite(dollars) && dollars > 0 ? String(dollars) : null,
  );
}

/** The local day, as YYYY-MM-DD: a daily limit starts again when the author's day does. */
export function spendingDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface DayUsage {
  readonly requests: number;
  /** In dollars. */
  readonly cost: number;
}

/** Everything asked today, over every service. */
export async function usageOn(storage: Storage, day: string): Promise<DayUsage> {
  const rows = await storage.listUsage(day);
  return {
    requests: rows.reduce((sum, row) => sum + row.requests, 0),
    cost: rows.reduce((sum, row) => sum + row.cost, 0),
  };
}

/**
 * Counts what the analysis spends and says when it must stop. Everything is written down as it
 * happens, so that closing the app in the middle of a day doesn't start the count again.
 */
export class SpendingGuard {
  private pending: Promise<void> = Promise.resolve();
  private failure: unknown = null;
  /** Set once an answer of a paid model didn't say what it cost. */
  private uncounted = false;

  constructor(
    private readonly storage: Storage,
    private readonly connection: AiConnection,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** For the analysis to call with each answer's usage. Never throws: `check` reports problems. */
  readonly onUsage = (usage: Usage): void => {
    const cost = costOf(this.connection, usage);
    if (cost === null) {
      this.uncounted = true;
    }
    const day = spendingDay(this.now());
    this.pending = this.pending
      .then(() => this.storage.addUsage(day, this.connection.route, cost ?? 0))
      .catch((error: unknown) => {
        this.failure = error;
      });
  };

  /**
   * Why the analysis must stop before asking anything else, or null if it may go on. The reason
   * starts with \`cap:\`, for whoever shows it.
   */
  async check(): Promise<string | null> {
    await this.pending;
    if (!isPaidConnection(this.connection)) {
      return null;
    }
    if (this.failure !== null) {
      return "cap: what was spent couldn't be written down";
    }
    if (this.uncounted || !canBePriced(this.connection)) {
      return "cap: an answer didn't say what it cost";
    }
    const cap = await loadSpendingCap(this.storage);
    if (cap === null) {
      return "cap: no daily spending limit is set";
    }
    const { cost } = await usageOn(this.storage, spendingDay(this.now()));
    return cost >= cap ? `cap: today's limit of ${cap} $ is reached` : null;
  }
}
