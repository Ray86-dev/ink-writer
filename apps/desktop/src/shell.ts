import type { AiTransport, ResearchTransport, SqlDriver } from "@ink-writer/core";

/**
 * How the page reaches a model. Credentials stay on the other side: the page can ask whether
 * OpenRouter is connected, and never for its key (rule 9).
 */
export interface AiShell {
  readonly transport: AiTransport;
  openrouterConnected(): Promise<boolean>;
  /**
   * Signs in through the author's browser. Resolves once connected. Rejects with an error whose
   * message starts with what went wrong: `cancelled`, `timeout`, `listen`, `browser`,
   * `unreachable`, `refused` or `store`.
   */
  connectOpenrouter(): Promise<void>;
  cancelConnectOpenrouter(): void;
  /** Forgets the key on this machine. */
  disconnectOpenrouter(): Promise<void>;

  deepseekKeyPresent(): Promise<boolean>;
  /** Hands the shell the key the author typed. It's never handed back. */
  setDeepseekKey(key: string): Promise<void>;
  clearDeepseekKey(): Promise<void>;

  /** How many paid requests a day the shell lets through, and how many it has today. */
  paidRequestLimit(): Promise<PaidRequestLimit>;
  /** Zero turns paid requests off. */
  setPaidRequestLimit(dailyRequests: number): Promise<PaidRequestLimit>;
}

export interface PaidRequestLimit {
  readonly dailyRequests: number;
  readonly usedToday: number;
}

/** How many requests of one kind the shell lets through in a day, and how many it has today. */
export type DailyRequestLimit = PaidRequestLimit;

/**
 * How the page looks things up for the documentation. It says what kind of search and gives a term
 * or a point: the shell decides where that goes, and counts each one against the day's limit.
 */
export interface ResearchShell {
  readonly transport: ResearchTransport;
  searchLimit(): Promise<DailyRequestLimit>;
  /** Zero turns the searches off. */
  setSearchLimit(dailyRequests: number): Promise<DailyRequestLimit>;
}

/** A newer version of the app, as its release announces it. */
export interface AvailableUpdate {
  readonly version: string;
  readonly notes: string | null;
}

/**
 * Updates. The shell knows where the releases are and checks their signature: the page can only
 * ask whether there's one and say to install it.
 */
export interface UpdateShell {
  /** The version that's running. */
  version(): Promise<string>;
  /** Asks the releases, over the network. Null if this is the latest. */
  check(): Promise<AvailableUpdate | null>;
  /** Downloads, verifies and installs the newer version, and starts the app again. */
  install(): Promise<void>;
}

/** Everything the interface needs from outside the page. Replaced by a fake in tests. */
export interface Shell {
  readonly driver: SqlDriver;
  readonly ai: AiShell;
  readonly research: ResearchShell;
  readonly updates: UpdateShell;
  /** Opens a web address in the author's browser. */
  openLink(url: string): Promise<void>;
  /** Saves a file where the author chooses. False if they cancel. */
  exportFile(suggestedName: string, extension: "docx" | "md", data: Uint8Array): Promise<boolean>;
  /**
   * Calls `handler` when the author tries to close the window. If it resolves false, the window
   * stays open. Returns how to stop listening.
   */
  onCloseRequested(handler: () => Promise<boolean>): () => void;
  /** Closes the window without asking again. */
  forceClose(): void;
}
