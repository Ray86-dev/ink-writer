import { readScene } from "../export/manuscript";
import { plainText } from "../prose/text";
import type { Storage } from "../storage/storage";
import { buildNovelView, type NovelView, type SceneText } from "./cards";
import { loadOverrides } from "./overrides";

/** Every scene that isn't in the trash, in reading order, with the text that's saved now. */
export async function loadSceneTexts(storage: Storage, projectId: string): Promise<SceneText[]> {
  const scenes: SceneText[] = [];
  for (const chapter of await storage.listChapters(projectId)) {
    for (const scene of await storage.listScenes(chapter.id)) {
      scenes.push({
        id: scene.id,
        title: scene.title,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        text: plainText(await readScene(storage, scene.id)),
      });
    }
  }
  return scenes;
}

/**
 * The cards as they stand: the stored analysis, the author's overrides on top, and only what the
 * saved text still says. Flush an open scene first, or what was just typed in it won't count.
 */
export async function loadNovelView(storage: Storage, projectId: string): Promise<NovelView> {
  const [analysis, overrides, scenes] = await Promise.all([
    storage.loadAnalysis(projectId),
    loadOverrides(storage, projectId),
    loadSceneTexts(storage, projectId),
  ]);
  return buildNovelView({ analysis, overrides, scenes });
}
