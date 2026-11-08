export interface Project {
  readonly id: string;
  readonly title: string;
  readonly language: string;
  readonly era: string;
}

export interface NewProject {
  readonly title: string;
  readonly language: string;
  readonly era: string;
}

export interface Chapter {
  readonly id: string;
  readonly projectId: string;
  readonly position: number;
  readonly title: string;
  readonly eraOverride: string | null;
}

export interface Scene {
  readonly id: string;
  readonly chapterId: string;
  readonly position: number;
  readonly title: string;
  readonly status: string;
}

export interface Trash {
  readonly chapters: readonly Chapter[];
  readonly scenes: readonly Scene[];
}

/** A scene's prose as stored: its compacted base, plus every update since. */
export interface StoredSceneProse {
  readonly base: Uint8Array | null;
  /** Goes up with each compaction, so a compaction based on an old read can be refused. */
  readonly baseVersion: number;
  readonly updates: readonly { readonly id: number; readonly data: Uint8Array }[];
}

export interface SnapshotInfo {
  readonly id: string;
  readonly sceneId: string;
  readonly createdAt: number;
  /** Set by the author or by a system event. Null for a periodic automatic one. */
  readonly label: string | null;
  readonly wordCount: number;
}

export interface NewSnapshot {
  readonly sceneId: string;
  readonly data: Uint8Array;
  readonly label: string | null;
  readonly wordCount: number;
}

export type MoveDirection = "up" | "down";

export class InvalidInputError extends Error {
  override readonly name = "InvalidInputError";

  constructor(readonly field: string) {
    super(`"${field}" can't be empty`);
  }
}

/**
 * Everything the app persists, whatever the backend. There is no permanent delete: moving something
 * to the trash only marks it, because losing text is the one unforgivable failure.
 */
export interface Storage {
  createProject(project: NewProject): Promise<Project>;
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;

  /** Added after the project's last chapter. */
  createChapter(projectId: string, title: string): Promise<Chapter>;
  /** Without the ones in the trash. */
  listChapters(projectId: string): Promise<Chapter[]>;
  renameChapter(id: string, title: string): Promise<void>;
  /** Swaps with its neighbour. Does nothing at either end. */
  moveChapter(id: string, direction: MoveDirection): Promise<void>;
  trashChapter(id: string): Promise<void>;
  restoreChapter(id: string): Promise<void>;

  /** Added after the chapter's last scene. */
  createScene(chapterId: string, title: string): Promise<Scene>;
  /** Without the ones in the trash. */
  listScenes(chapterId: string): Promise<Scene[]>;
  renameScene(id: string, title: string): Promise<void>;
  /** Swaps with its neighbour inside the chapter. Does nothing at either end. */
  moveScene(id: string, direction: MoveDirection): Promise<void>;
  trashScene(id: string): Promise<void>;
  restoreScene(id: string): Promise<void>;

  listTrash(projectId: string): Promise<Trash>;

  /** Adds one Yjs update. Prose is append-only: nothing here overwrites what was stored. */
  appendSceneUpdate(sceneId: string, update: Uint8Array): Promise<void>;
  loadSceneProse(sceneId: string): Promise<StoredSceneProse>;
  /**
   * Replaces the base and removes the updates it now includes, all or nothing. Updates after
   * `upToUpdateId` stay, so a write arriving meanwhile is kept. If the stored base is no longer at
   * `expectedBaseVersion`, this new base was built from an old read and would lose text, so nothing
   * changes and it returns false.
   */
  compactSceneProse(
    sceneId: string,
    base: Uint8Array,
    upToUpdateId: number,
    expectedBaseVersion: number,
  ): Promise<boolean>;

  createSnapshot(snapshot: NewSnapshot): Promise<SnapshotInfo>;
  /** Newest first. */
  listSnapshots(sceneId: string): Promise<SnapshotInfo[]>;
  loadSnapshot(id: string): Promise<Uint8Array | null>;
}
