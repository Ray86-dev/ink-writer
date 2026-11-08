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

export class InvalidInputError extends Error {
  override readonly name = "InvalidInputError";

  constructor(readonly field: string) {
    super(`"${field}" can't be empty`);
  }
}

/**
 * Everything the app persists, whatever the backend. There is no delete yet: M2 adds it together
 * with the history that makes it safe, because losing text is the one unforgivable failure.
 */
export interface Storage {
  createProject(project: NewProject): Promise<Project>;
  listProjects(): Promise<Project[]>;
  /** Added after the project's last chapter. */
  createChapter(projectId: string, title: string): Promise<Chapter>;
  listChapters(projectId: string): Promise<Chapter[]>;
  /** Added after the chapter's last scene. */
  createScene(chapterId: string, title: string): Promise<Scene>;
  listScenes(chapterId: string): Promise<Scene[]>;
}
