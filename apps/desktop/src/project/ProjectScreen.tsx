import {
  buildManuscript,
  type Project,
  type SceneSessionOptions,
  type Storage,
  type Trash,
  toDocx,
  toMarkdown,
} from "@ink-writer/core";
import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { SceneEditor } from "../editor/SceneEditor";
import { useLanguage } from "../i18n";
import { describeError } from "../messages";
import type { Shell } from "../shell";
import { HistoryPanel } from "./HistoryPanel";
import { type ChapterNode, StructurePanel } from "./StructurePanel";
import { useSceneSession } from "./useSceneSession";

export type EditorMode = "write" | "live" | "read";
type Panel = "structure" | "history" | null;

const MODES: readonly EditorMode[] = ["write", "live", "read"];

export interface ProjectScreenProps {
  readonly storage: Storage;
  readonly project: Project;
  readonly shell: Shell;
  readonly onBack: () => void;
  readonly sessionOptions?: SceneSessionOptions;
}

/** A title can hold characters that no operating system allows in a file name. */
export function safeFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  return cleaned === "" ? "novela" : cleaned;
}

/** A remembered choice for this viewer. The app works the same if the storage isn't available. */
function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Only a convenience.
  }
}

/**
 * The writing screen. Zen by default: while the author types there's only the text, and the controls
 * come back with the mouse or the Esc key (SPEC §3.3). A saving problem is the one thing that shows
 * regardless, because the author needs to know.
 */
export function ProjectScreen({
  storage,
  project,
  shell,
  onBack,
  sessionOptions,
}: ProjectScreenProps) {
  const { messages } = useLanguage();
  const [tree, setTree] = useState<readonly ChapterNode[]>([]);
  const [trash, setTrash] = useState<Trash>({ chapters: [], scenes: [] });
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>(() => {
    const saved = remembered("editor-mode");
    return MODES.includes(saved as EditorMode) ? (saved as EditorMode) : "write";
  });
  const [panel, setPanel] = useState<Panel>(null);
  const [typing, setTyping] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const typingRef = useRef(false);

  const { session, saveState, saveError, openError, closeCurrent } = useSceneSession(
    storage,
    sceneId,
    sessionOptions,
  );

  const sceneKey = `last-scene-${project.id}`;

  const reload = useCallback(async () => {
    const chapters = await storage.listChapters(project.id);
    const nodes = await Promise.all(
      chapters.map(async (chapter) => ({
        chapter,
        scenes: await storage.listScenes(chapter.id),
      })),
    );
    setTree(nodes);
    setTrash(await storage.listTrash(project.id));
    return nodes;
  }, [storage, project.id]);

  // Goes to the last scene opened here, or to the first there is.
  useEffect(() => {
    let active = true;
    reload()
      .then((nodes) => {
        if (!active) return;
        const scenes = nodes.flatMap((node) => node.scenes);
        const last = remembered(sceneKey);
        const pick = scenes.find((scene) => scene.id === last) ?? scenes[0];
        setSceneId(pick?.id ?? null);
      })
      .catch((error: unknown) => setNotice(describeError(error)));
    return () => {
      active = false;
    };
  }, [reload, sceneKey]);

  // The open scene may have just gone to the trash. Then another takes its place.
  const onStructureChanged = useCallback(async () => {
    const nodes = await reload();
    const scenes = nodes.flatMap((node) => node.scenes);
    setSceneId((current) =>
      scenes.some((scene) => scene.id === current) ? current : (scenes[0]?.id ?? null),
    );
  }, [reload]);

  const select = useCallback(
    (id: string) => {
      remember(sceneKey, id);
      setSceneId(id);
      setPanel(null);
    },
    [sceneKey],
  );

  const changeMode = (next: EditorMode) => {
    remember("editor-mode", next);
    setMode(next);
  };

  const onInput = useCallback(() => {
    if (!typingRef.current) {
      typingRef.current = true;
      setTyping(true);
    }
  }, []);

  const reveal = useCallback(() => {
    if (typingRef.current) {
      typingRef.current = false;
      setTyping(false);
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (panel !== null) {
        setPanel(null);
      } else {
        typingRef.current = !typingRef.current;
        setTyping(typingRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel]);

  // Closing the window saves first. It stays open only if the text can't be saved.
  const closeCurrentRef = useRef(closeCurrent);
  closeCurrentRef.current = closeCurrent;
  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;
  useEffect(
    () =>
      shell.onCloseRequested(async () => {
        if (saveStateRef.current === "failing") {
          setCloseBlocked(true);
          return false;
        }
        await closeCurrentRef.current();
        return true;
      }),
    [shell],
  );

  const exportMenu = useRef<HTMLDetailsElement>(null);

  const exportBook = async (extension: "docx" | "md") => {
    setNotice(null);
    if (exportMenu.current !== null) {
      exportMenu.current.open = false;
    }
    try {
      // Exports what's saved, so everything typed so far must be there first.
      await session?.flush();
      const manuscript = await buildManuscript(storage, project.id);
      const data =
        extension === "docx"
          ? toDocx(manuscript)
          : new TextEncoder().encode(toMarkdown(manuscript));
      if (await shell.exportFile(safeFileName(project.title), extension, data)) {
        setNotice(messages.exported);
      }
    } catch (error) {
      setNotice(messages.exportFailed(describeError(error)));
    }
  };

  const zen = typing && panel === null && mode !== "read";

  return (
    // The mouse only brings the controls back: everything it does here also has a key or a button.
    // biome-ignore lint/a11y/noStaticElementInteractions: see above
    <div className={`project ${zen ? "zen" : ""}`} onMouseMove={reveal}>
      <header className="chrome">
        <button type="button" onClick={onBack}>
          ← {messages.novels}
        </button>
        <span className="chrome-title">{project.title}</span>
        <span className="save-state" role="status">
          {saveState === "saving" ? messages.saving : saveState === "saved" ? messages.saved : ""}
        </span>

        <fieldset className="modes">
          <legend className="visually-hidden">{messages.modesLabel}</legend>
          {MODES.map((value) => (
            <label key={value} className={mode === value ? "mode mode-on" : "mode"}>
              <input
                type="radio"
                name="editor-mode"
                className="visually-hidden"
                checked={mode === value}
                onChange={() => changeMode(value)}
              />
              {messages.modes[value]}
            </label>
          ))}
        </fieldset>

        <span className="chrome-actions">
          <button
            type="button"
            aria-expanded={panel === "structure"}
            onClick={() => setPanel(panel === "structure" ? null : "structure")}
          >
            {messages.structure}
          </button>
          <button
            type="button"
            aria-expanded={panel === "history"}
            onClick={() => setPanel(panel === "history" ? null : "history")}
          >
            {messages.history}
          </button>
          <details className="menu" ref={exportMenu}>
            <summary>{messages.export}</summary>
            <div className="menu-items">
              <button type="button" onClick={() => void exportBook("docx")}>
                {messages.exportWord}
              </button>
              <button type="button" onClick={() => void exportBook("md")}>
                {messages.exportMarkdown}
              </button>
            </div>
          </details>
        </span>
      </header>

      {saveState === "failing" && (
        <p role="alert" className="save-problem">
          {messages.saveFailing(describeError(saveError))}
        </p>
      )}
      {openError !== null && (
        <p role="alert" className="save-problem">
          {describeError(openError)}
        </p>
      )}
      {notice !== null && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}

      <div className="workspace">
        {panel === "structure" && (
          <StructurePanel
            storage={storage}
            projectId={project.id}
            tree={tree}
            trash={trash}
            currentSceneId={sceneId}
            onSelect={select}
            onChanged={onStructureChanged}
            onClose={() => setPanel(null)}
          />
        )}

        <main className="page">
          {tree.length > 0 && tree.every((node) => node.scenes.length === 0) && (
            <p className="no-scene">{messages.noScene}</p>
          )}
          {session !== null && (
            <SceneEditor
              key={session.sceneId}
              session={session}
              label={messages.proseLabel}
              language={project.language}
              editable={mode !== "read"}
              onEditor={setEditor}
              onInput={onInput}
            />
          )}
        </main>

        {mode === "read" && panel === null && (
          <aside className="panel panel-right" aria-label={messages.readingPanelTitle}>
            <h2>{messages.readingPanelTitle}</h2>
            <p>{messages.readingPanelEmpty}</p>
          </aside>
        )}

        {panel === "history" && session !== null && (
          <HistoryPanel
            key={session.sceneId}
            storage={storage}
            session={session}
            editor={editor}
            onClose={() => setPanel(null)}
          />
        )}
      </div>

      {closeBlocked && (
        <div className="overlay">
          <div role="alertdialog" aria-labelledby="close-title" className="dialog">
            <h2 id="close-title">{messages.closeBlockedTitle}</h2>
            <p>{messages.closeBlockedBody}</p>
            <div className="dialog-actions">
              <button type="button" className="primary" onClick={() => setCloseBlocked(false)}>
                {messages.keepTrying}
              </button>
              <button type="button" onClick={() => shell.forceClose()}>
                {messages.closeAnyway}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
