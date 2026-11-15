import type { AiTransport, SqlDriver } from "@ink-writer/core";

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
}

/** Everything the interface needs from outside the page. Replaced by a fake in tests. */
export interface Shell {
  readonly driver: SqlDriver;
  readonly ai: AiShell;
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
