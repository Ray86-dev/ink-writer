import type { SceneDigest } from "../analysis/digest";
import type { AnalysisState } from "../analysis/state";

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

/** Something the author said about the cards, as stored. `cards/overrides.ts` gives it meaning. */
export interface StoredOverride {
  readonly id: string;
  readonly projectId: string;
  readonly kind: string;
  /** JSON. */
  readonly payload: string;
  readonly createdAt: number;
}

/** What the author did with a hint, as stored. `hints/hints.ts` gives it meaning. */
export interface StoredHintState {
  readonly key: string;
  readonly step: number;
  readonly decision: string | null;
}

/** What was asked of one service on one day. */
export interface StoredUsage {
  readonly route: string;
  readonly requests: number;
  /** In dollars. */
  readonly cost: number;
}

/** Something to look up for the documentation, as stored. `research/research.ts` gives it meaning. */
export interface StoredResearchTopic {
  readonly id: string;
  readonly projectId: string;
  readonly kind: string;
  /** What it's called in the novel. With the kind, it says which topic this is. */
  readonly name: string;
  /** For a place: whether the author said it exists. */
  readonly reality: string | null;
  /** What's searched for. Null if nothing is to be searched. */
  readonly term: string | null;
  /** JSON: the real place the author chose. */
  readonly place: string | null;
  readonly status: string;
  readonly searchedAt: number | null;
}

export interface NewResearchTopic {
  readonly projectId: string;
  readonly kind: string;
  readonly name: string;
  readonly reality: string | null;
  readonly term: string | null;
  readonly place: string | null;
  readonly status: string;
}

/** One thing found, always with where it comes from. */
export interface StoredResearchItem {
  readonly id: string;
  readonly topicId: string;
  readonly category: string;
  readonly text: string;
  readonly sourceUrl: string;
  readonly sourceTitle: string;
  readonly retrievedAt: number;
  readonly status: string;
}

export interface NewResearchItem {
  readonly category: string;
  readonly text: string;
  readonly sourceUrl: string;
  readonly sourceTitle: string;
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

  /** Keeps something the author said about the cards. No reanalysis touches it (rule 4). */
  addOverride(projectId: string, kind: string, payload: string): Promise<StoredOverride>;
  /** Oldest first, which is the order they apply in. */
  listOverrides(projectId: string): Promise<StoredOverride[]>;
  /** Only the author takes one back, as when undoing a merge. */
  removeOverride(id: string): Promise<void>;

  /**
   * Stores what the model wrote about a scene, in place of what its last digest left. The summaries
   * replace those of the same cards.
   */
  saveSceneDigest(digest: SceneDigest): Promise<void>;

  listHintStates(projectId: string): Promise<StoredHintState[]>;
  /** Keeps how far a hint was revealed. It never goes back to showing less. */
  revealHint(projectId: string, key: string, step: number): Promise<void>;
  /** Keeps how the author closed a hint or a task. Null opens it again. */
  decideHint(projectId: string, key: string, decision: string | null): Promise<void>;

  /** Counts one more request to a service on a day, and what it cost in dollars. */
  addUsage(day: string, route: string, cost: number): Promise<void>;
  listUsage(day: string): Promise<StoredUsage[]>;

  /**
   * Keeps a topic, in place of the one with the same kind and name. What had been found for the old
   * one goes, except what the author took to their notes.
   */
  saveResearchTopic(topic: NewResearchTopic): Promise<StoredResearchTopic>;
  /** Oldest first. */
  listResearchTopics(projectId: string): Promise<StoredResearchTopic[]>;
  /** With everything found for it, the author's notes included. Only the author removes one. */
  removeResearchTopic(id: string): Promise<void>;
  /**
   * Stores what a search found and how it went, all or nothing. It replaces what the last search
   * left, and leaves what the author already took to their notes or discarded as it is.
   */
  saveResearchResult(
    topicId: string,
    status: string,
    items: readonly NewResearchItem[],
  ): Promise<void>;
  listResearchItems(projectId: string): Promise<StoredResearchItem[]>;
  setResearchItemStatus(id: string, status: string): Promise<void>;

  /** A choice the author made for the whole app. Null if they haven't. Never a credential. */
  getSetting(key: string): Promise<string | null>;
  /** Null forgets it. */
  setSetting(key: string, value: string | null): Promise<void>;

  /** What a scene's text hashes to now. It waits for analysis while this differs from the last one. */
  setSceneContentHash(sceneId: string, hash: string): Promise<void>;
  /** Scenes with text not yet analysed, in reading order, without the ones in the trash. */
  listScenesToAnalyze(projectId: string): Promise<Scene[]>;
  /** What's known of the novel, with what came from scenes in the trash left out. */
  loadAnalysis(projectId: string): Promise<AnalysisState>;
  /**
   * Stores what analysing a scene produced, all or nothing: its data replaces the scene's old data
   * (SPEC §4), and `analyzedHash` says which text it describes. If the author kept writing meanwhile,
   * the scene stays in the queue. An entity already stored keeps its name: only its aliases can grow.
   */
  saveSceneAnalysis(
    projectId: string,
    sceneId: string,
    analyzedHash: string,
    state: AnalysisState,
  ): Promise<void>;
}
