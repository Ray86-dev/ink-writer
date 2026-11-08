import type { SqlDriver } from "@ink-writer/core";

/** Everything the interface needs from outside the page. Replaced by a fake in tests. */
export interface Shell {
  readonly driver: SqlDriver;
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
