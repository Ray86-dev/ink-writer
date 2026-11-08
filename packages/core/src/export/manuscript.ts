import * as Y from "yjs";
import { type Paragraph, readParagraphs } from "../prose/text";
import type { Storage } from "../storage/storage";

export interface ManuscriptChapter {
  readonly title: string;
  /** Each scene's paragraphs. Empty scenes are left out. */
  readonly scenes: readonly (readonly Paragraph[])[];
}

/** The book as the author wrote it, and nothing else: no analysis, notes or scene titles. */
export interface Manuscript {
  readonly title: string;
  readonly language: string;
  readonly chapters: readonly ManuscriptChapter[];
}

async function readScene(storage: Storage, sceneId: string): Promise<Paragraph[]> {
  const prose = await storage.loadSceneProse(sceneId);
  const doc = new Y.Doc();
  try {
    if (prose.base !== null) {
      Y.applyUpdate(doc, prose.base);
    }
    for (const update of prose.updates) {
      Y.applyUpdate(doc, update.data);
    }
    return readParagraphs(doc);
  } finally {
    doc.destroy();
  }
}

const isEmpty = (paragraphs: readonly Paragraph[]) =>
  paragraphs.every((paragraph) => paragraph.inlines.length === 0);

/**
 * Reads the project from storage, so it exports what's saved. Close or flush open scenes first.
 * Whatever is in the trash stays out.
 */
export async function buildManuscript(storage: Storage, projectId: string): Promise<Manuscript> {
  const project = await storage.getProject(projectId);
  if (project === null) {
    throw new Error(`No project "${projectId}"`);
  }
  const chapters: ManuscriptChapter[] = [];
  for (const chapter of await storage.listChapters(projectId)) {
    const scenes: (readonly Paragraph[])[] = [];
    for (const scene of await storage.listScenes(chapter.id)) {
      const paragraphs = await readScene(storage, scene.id);
      if (!isEmpty(paragraphs)) {
        scenes.push(paragraphs);
      }
    }
    chapters.push({ title: chapter.title, scenes });
  }
  return { title: project.title, language: project.language, chapters };
}
