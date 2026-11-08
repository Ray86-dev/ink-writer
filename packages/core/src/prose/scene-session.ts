import * as Y from "yjs";
import type { SnapshotInfo, Storage, StoredSceneProse } from "../storage/storage";
import { countWords, plainText, readParagraphs } from "./text";

/** How the save is going. Anything but `saved` means some typed text isn't on disk yet. */
export type SaveState = "saved" | "saving" | "failing";

export interface SceneSessionOptions {
  /** Time between automatic versions while there are edits. */
  readonly autoSnapshotMs?: number;
  /** Compacts when more updates than this have piled up. */
  readonly compactAfterUpdates?: number;
  /** Waits before retrying a failed write. Injected so tests don't sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const TEN_MINUTES = 10 * 60 * 1000;
const FIRST_RETRY_MS = 250;
const LONGEST_RETRY_MS = 5000;

/** Marks updates that came from the database, so they aren't written back to it. */
const FROM_STORAGE = Symbol("from storage");

function applyStored(doc: Y.Doc, prose: StoredSceneProse): void {
  if (prose.base !== null) {
    Y.applyUpdate(doc, prose.base, FROM_STORAGE);
  }
  for (const update of prose.updates) {
    Y.applyUpdate(doc, update.data, FROM_STORAGE);
  }
}

/**
 * One scene open for editing: its Yjs document, plus the guarantee that what happens in it reaches
 * the database. Each change goes out at once. While a write is running, later changes wait and then
 * go together, so a slow disk neither blocks typing nor builds up a queue of writes. A failed write
 * keeps its changes in memory and retries: nothing is ever discarded.
 */
export class SceneSession {
  readonly doc = new Y.Doc();

  private readonly pending: Uint8Array[] = [];
  private enqueued = 0;
  private persisted = 0;
  private pumping = false;
  private state: SaveState = "saved";
  private lastError: unknown = null;
  private readonly listeners = new Set<(state: SaveState) => void>();
  private readonly waiters: { seq: number; resolve: () => void }[] = [];
  private changedSinceSnapshot = false;
  private storedUpdates = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private compacting: Promise<void> | null = null;

  private readonly compactAfterUpdates: number;
  private readonly sleep: (ms: number) => Promise<void>;

  private constructor(
    private readonly storage: Storage,
    readonly sceneId: string,
    options: SceneSessionOptions,
  ) {
    this.compactAfterUpdates = options.compactAfterUpdates ?? 500;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  static async open(
    storage: Storage,
    sceneId: string,
    options: SceneSessionOptions = {},
  ): Promise<SceneSession> {
    const session = new SceneSession(storage, sceneId, options);
    const prose = await storage.loadSceneProse(sceneId);
    applyStored(session.doc, prose);
    session.storedUpdates = prose.updates.length;
    session.doc.on("update", session.onUpdate);
    const interval = options.autoSnapshotMs ?? TEN_MINUTES;
    if (interval > 0) {
      session.timer = setInterval(() => {
        void session.autoSnapshot();
      }, interval);
    }
    return session;
  }

  get saveState(): SaveState {
    return this.state;
  }

  /** The cause of the current `failing` state, to show the author. */
  get saveError(): unknown {
    return this.lastError;
  }

  /** Calls back on every change of state. Returns how to stop listening. */
  onSaveState(listener: (state: SaveState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(state: SaveState): void {
    if (state !== this.state) {
      this.state = state;
      for (const listener of this.listeners) {
        listener(state);
      }
    }
  }

  private readonly onUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === FROM_STORAGE) {
      return;
    }
    this.pending.push(update);
    this.enqueued += 1;
    this.changedSinceSnapshot = true;
    this.setState(this.state === "failing" ? "failing" : "saving");
    void this.pump();
  };

  private async pump(): Promise<void> {
    if (this.pumping) {
      return;
    }
    this.pumping = true;
    let retryMs = FIRST_RETRY_MS;
    while (this.pending.length > 0) {
      const count = this.pending.length;
      const batch = count === 1 ? (this.pending[0] as Uint8Array) : Y.mergeUpdates(this.pending);
      try {
        await this.storage.appendSceneUpdate(this.sceneId, batch);
      } catch (error) {
        this.lastError = error;
        this.setState("failing");
        await this.sleep(retryMs);
        retryMs = Math.min(retryMs * 2, LONGEST_RETRY_MS);
        continue;
      }
      retryMs = FIRST_RETRY_MS;
      this.lastError = null;
      // Later changes were pushed behind these while the write ran, so they stay queued.
      this.pending.splice(0, count);
      this.persisted += count;
      this.storedUpdates += 1;
      this.resolveWaiters();
      this.setState(this.pending.length > 0 ? "saving" : "saved");
    }
    this.pumping = false;
    if (this.storedUpdates > this.compactAfterUpdates) {
      this.compact().catch(() => {
        // The text is safe in the update log either way. Compaction runs again later.
      });
    }
  }

  private resolveWaiters(): void {
    // They were added in order, so the ones ready to resolve are always at the front.
    while (this.waiters[0] !== undefined && this.waiters[0].seq <= this.persisted) {
      this.waiters.shift()?.resolve();
    }
  }

  /** Resolves once everything changed so far has been committed to the database. */
  flush(): Promise<void> {
    if (this.persisted >= this.enqueued) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push({ seq: this.enqueued, resolve });
    });
  }

  /** Stores the current state as a version in the history. */
  async snapshot(label: string | null = null): Promise<SnapshotInfo> {
    await this.flush();
    const info = await this.storage.createSnapshot({
      sceneId: this.sceneId,
      data: Y.encodeStateAsUpdate(this.doc),
      label,
      wordCount: countWords(plainText(readParagraphs(this.doc))),
    });
    this.changedSinceSnapshot = false;
    return info;
  }

  private async autoSnapshot(): Promise<void> {
    if (this.changedSinceSnapshot && this.state !== "failing") {
      await this.snapshot().catch(() => {
        // A missed version isn't lost text. The next interval tries again.
      });
    }
  }

  /**
   * Folds the update log into the base. One at a time: if two overlapped, the older could otherwise
   * replace the base with one missing what the newer had already folded in and removed.
   */
  compact(): Promise<void> {
    this.compacting ??= this.runCompaction().finally(() => {
      this.compacting = null;
    });
    return this.compacting;
  }

  /**
   * Replays what's stored into a separate document rather than trusting the live one, and refuses to
   * touch anything unless the result reads the same.
   */
  private async runCompaction(): Promise<void> {
    await this.flush();
    const prose = await this.storage.loadSceneProse(this.sceneId);
    const last = prose.updates.at(-1);
    if (last === undefined) {
      return;
    }
    const replayed = new Y.Doc();
    const check = new Y.Doc();
    try {
      applyStored(replayed, prose);
      const base = Y.encodeStateAsUpdate(replayed);
      Y.applyUpdate(check, base);
      if (plainText(readParagraphs(check)) !== plainText(readParagraphs(replayed))) {
        throw new Error("Compaction would have changed the text");
      }
      const done = await this.storage.compactSceneProse(
        this.sceneId,
        base,
        last.id,
        prose.baseVersion,
      );
      if (done) {
        this.storedUpdates = Math.max(0, this.storedUpdates - prose.updates.length);
      }
    } finally {
      replayed.destroy();
      check.destroy();
    }
  }

  /**
   * Finishes with the scene: saves everything, then stores a version and compacts if useful. Those
   * two can fail without losing text, so they don't stop the scene from closing.
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
    }
    await this.flush();
    this.doc.off("update", this.onUpdate);
    if (this.changedSinceSnapshot) {
      await this.snapshot().catch(() => {});
    }
    if (this.storedUpdates > 0) {
      await this.compact().catch(() => {});
    }
    this.doc.destroy();
  }
}
