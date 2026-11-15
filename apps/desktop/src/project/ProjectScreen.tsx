import {
  type AiConnection,
  buildManuscript,
  createNameFinder,
  type Hint,
  knownNames,
  loadAiConnection,
  loadNovel,
  type NovelView,
  type Passage,
  type Project,
  type SceneSessionOptions,
  type SceneText,
  type Storage,
  saveAiConnection,
  type Trash,
  toDocx,
  toMarkdown,
} from "@ink-writer/core";
import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type CardSelection, CardsScreen } from "../cards/CardsScreen";
import { applyCorrection, showPassage } from "../editor/name-links";
import { SceneEditor } from "../editor/SceneEditor";
import { Companion, HintsPanel } from "../hints/HintsPanel";
import { useHints } from "../hints/useHints";
import { useLanguage } from "../i18n";
import { describeError } from "../messages";
import { useResearch } from "../research/useResearch";
import type { Shell } from "../shell";
import { AiPanel } from "./AiPanel";
import { HistoryPanel } from "./HistoryPanel";
import { type ChapterNode, StructurePanel } from "./StructurePanel";
import { type AnalysisOptions, useAnalysis } from "./useAnalysis";
import { useSceneSession } from "./useSceneSession";

export type EditorMode = "write" | "live" | "read";
type Panel = "structure" | "history" | "ai" | "hints" | null;

const MODES: readonly EditorMode[] = ["write", "live", "read"];

const NO_CARDS: NovelView = {
  cards: [],
  relations: [],
  chapters: [],
  names: [],
  issues: [],
  prompts: [],
};
const NO_SCENES: readonly SceneText[] = [];

export interface ProjectScreenProps {
  readonly storage: Storage;
  readonly project: Project;
  readonly shell: Shell;
  readonly onBack: () => void;
  readonly sessionOptions?: SceneSessionOptions;
  readonly analysisOptions?: AnalysisOptions;
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
  analysisOptions,
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
  const [connection, setConnection] = useState<AiConnection | null>(null);
  const [novel, setNovel] = useState<NovelView>(NO_CARDS);
  /** Null while the author is at the text. */
  const [cards, setCards] = useState<CardSelection | null>(null);
  /** A passage to show once its scene is open. */
  const [jump, setJump] = useState<Passage | null>(null);
  const [sceneTexts, setSceneTexts] = useState<readonly SceneText[]>(NO_SCENES);
  /** A correction the author asked to apply, once its scene is open. */
  const [fixing, setFixing] = useState<Hint | null>(null);

  const analysis = useAnalysis(storage, project, shell.ai.transport, connection, analysisOptions);

  const { session, saveState, saveError, openError, closeCurrent } = useSceneSession(
    storage,
    sceneId,
    sessionOptions,
    analysis.sceneClosed,
  );

  // The author's choice of model. Until it's read, and without one, nothing is analysed.
  useEffect(() => {
    let active = true;
    loadAiConnection(storage)
      .then((saved) => {
        if (active) setConnection(saved);
      })
      .catch((error: unknown) => setNotice(describeError(error)));
    return () => {
      active = false;
    };
  }, [storage]);

  const sessionRef = useRef<typeof session>(null);
  sessionRef.current = session;

  /**
   * Works the cards out again from what's stored and saved. What was just typed is saved first, so
   * that a deleted passage is gone from them at once.
   */
  const reloadCards = useCallback(async () => {
    await sessionRef.current?.flush();
    const loaded = await loadNovel(storage, project.id);
    setNovel(loaded.view);
    setSceneTexts(loaded.scenes);
  }, [storage, project.id]);

  // On opening the novel, and each time a run of the analysis ends. Not while it's at work: reading
  // every scene again for each step would be for nothing.
  const analysisView = analysis.view;
  const settled = analysisView.status === "working" ? null : analysisView;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `settled` changes with each run
  useEffect(() => {
    reloadCards().catch((error: unknown) => setNotice(describeError(error)));
  }, [reloadCards, settled]);

  const find = useMemo(() => createNameFinder(knownNames(novel)), [novel]);

  const reportProblem = useCallback((error: unknown) => setNotice(describeError(error)), []);
  const hinting = useHints(storage, project.id, novel, sceneTexts, reportProblem);
  const hintLevel = hinting.settings?.level ?? "off";
  // Only with the cards open: nothing is looked up, and nothing found is shown, while writing.
  const research = useResearch(
    storage,
    project,
    novel,
    hinting.settings,
    shell.research,
    cards !== null,
    reportProblem,
  );
  const openLink = useCallback(
    (url: string) => {
      shell.openLink(url).catch(reportProblem);
    },
    [shell, reportProblem],
  );

  const openCards = useCallback(
    (selection: CardSelection) => {
      setPanel(null);
      setCards(selection);
      reloadCards().catch((error: unknown) => setNotice(describeError(error)));
    },
    [reloadCards],
  );

  const openCardOf = useCallback(
    (entityId: string) => {
      const card = novel.cards.find((item) => item.id === entityId);
      if (card !== undefined) {
        openCards({ tab: card.type, id: card.id });
      }
    },
    [novel, openCards],
  );

  const links = useMemo(() => ({ find, onOpen: openCardOf }), [find, openCardOf]);

  const changeConnection = useCallback(
    async (next: AiConnection | null) => {
      await saveAiConnection(storage, next);
      setConnection(next);
    },
    [storage],
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

  const openPassage = useCallback(
    (passage: Passage) => {
      setNotice(null);
      setCards(null);
      remember(sceneKey, passage.sceneId);
      setSceneId(passage.sceneId);
      setJump(passage);
    },
    [sceneKey],
  );

  const openScene = useCallback(
    (id: string) => {
      setCards(null);
      remember(sceneKey, id);
      setSceneId(id);
    },
    [sceneKey],
  );

  // Once the scene of the passage is on screen, the passage is selected in it.
  useEffect(() => {
    if (jump === null || editor === null || session?.sceneId !== jump.sceneId || cards !== null) {
      return;
    }
    if (!showPassage(editor, jump.quote)) {
      setNotice(messages.cardsPassageGone);
    }
    setJump(null);
  }, [jump, editor, session, cards, messages]);

  const changeMode = (next: EditorMode) => {
    remember("editor-mode", next);
    setMode(next);
    if (next === "read") {
      // Links and marks are of the text as it is now.
      reloadCards().catch(reportProblem);
    }
  };

  // The author pressed "Apply" on a correction: once its scene is on screen, it goes in the text.
  useEffect(() => {
    if (fixing === null || editor === null || session?.sceneId !== fixing.at.sceneId) {
      return;
    }
    setFixing(null);
    if (fixing.fix === null || !applyCorrection(editor, fixing.at.quote, fixing.fix)) {
      setNotice(messages.cardsPassageGone);
      return;
    }
    // The passage is gone from the text now, so the hint closes by itself.
    reloadCards().catch(reportProblem);
  }, [fixing, editor, session, messages, reloadCards, reportProblem]);

  const applyHint = (hint: Hint) => {
    setNotice(null);
    setCards(null);
    remember(sceneKey, hint.at.sceneId);
    setSceneId(hint.at.sceneId);
    setFixing(hint);
  };

  const fixMyself = (hint: Hint) => {
    setPanel(null);
    changeMode("write");
    openPassage(hint.at);
  };

  const guard = (action: Promise<void>) => {
    action.catch(reportProblem);
  };

  const sceneEdited = analysis.sceneEdited;
  const onInput = useCallback(() => {
    if (sceneId !== null) {
      sceneEdited(sceneId);
    }
    if (!typingRef.current) {
      typingRef.current = true;
      setTyping(true);
    }
  }, [sceneId, sceneEdited]);

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
      } else if (cards !== null) {
        setCards(null);
      } else {
        typingRef.current = !typingRef.current;
        setTyping(typingRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, cards]);

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

  const zen = typing && panel === null && cards === null && mode !== "read";
  const inScene = novel.cards.filter((card) => card.scenes.some((scene) => scene.id === sceneId));
  // Marks only when reading, and only at the levels that underline (SPEC §3.3 and §3.4).
  const showMarks = mode === "read" && (hintLevel === "discreet" || hintLevel === "companion");
  const openHints = hinting.hints;
  const marks = useMemo(
    () =>
      showMarks
        ? openHints.flatMap((hint) =>
            [hint.at, ...(hint.other === null ? [] : [hint.other])]
              .filter((passage) => passage.sceneId === sceneId)
              .map((passage) => ({ key: hint.key, quote: passage.quote })),
          )
        : [],
    [showMarks, openHints, sceneId],
  );
  const firstHint = openHints[0];

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
            aria-pressed={cards !== null}
            onClick={() =>
              cards === null ? openCards({ tab: "person", id: null }) : setCards(null)
            }
          >
            {messages.cards}
          </button>
          <button
            type="button"
            aria-expanded={panel === "history"}
            onClick={() => setPanel(panel === "history" ? null : "history")}
          >
            {messages.history}
          </button>
          <button
            type="button"
            aria-expanded={panel === "hints"}
            onClick={() => {
              setPanel(panel === "hints" ? null : "hints");
              // What's shown is of the text as it is now, so what was just rewritten is closed.
              reloadCards().catch(reportProblem);
            }}
          >
            {messages.hints}
            {hintLevel === "off" && `: ${messages.hintsShortOff}`}
            {(hintLevel === "discreet" || hintLevel === "companion") && `: ${openHints.length}`}
          </button>
          <button
            type="button"
            aria-expanded={panel === "ai"}
            onClick={() => setPanel(panel === "ai" ? null : "ai")}
          >
            {messages.ai}: {messages.analysisShort[analysis.view.status]}
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

      {cards !== null && (
        <CardsScreen
          storage={storage}
          projectId={project.id}
          view={novel}
          selection={cards}
          onSelect={setCards}
          onOpenPassage={openPassage}
          onOpenScene={openScene}
          research={research}
          onOpenLink={openLink}
          onChanged={reloadCards}
          onClose={() => setCards(null)}
        />
      )}

      <div className="workspace" hidden={cards !== null}>
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
              links={mode === "write" ? null : links}
              marks={marks}
            />
          )}
          {mode === "read" &&
            hintLevel === "companion" &&
            firstHint !== undefined &&
            panel !== "hints" && <Companion hint={firstHint} onOpen={() => setPanel("hints")} />}
        </main>

        {mode === "read" && panel === null && (
          <aside className="panel panel-right" aria-label={messages.readingPanelTitle}>
            <h2>{messages.readingPanelTitle}</h2>
            {inScene.length === 0 ? (
              <p>{messages.readingPanelEmpty}</p>
            ) : (
              <>
                <h3>{messages.cardsInScene}</h3>
                <ul className="card-links">
                  {inScene.map((card) => (
                    <li key={card.id}>
                      <button
                        type="button"
                        className="card-link"
                        onClick={() => openCards({ tab: card.type, id: card.id })}
                      >
                        {card.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        )}

        {panel === "hints" && hinting.settings !== null && (
          <HintsPanel
            settings={hinting.settings}
            hints={openHints}
            task={hinting.task}
            onSettings={(next) => guard(hinting.changeSettings(next))}
            onReveal={(hint) => guard(hinting.reveal(hint))}
            onDecide={(key, decision) => guard(hinting.decide(key, decision))}
            onLater={hinting.later}
            onOpenPassage={openPassage}
            onFixMyself={fixMyself}
            onApply={applyHint}
            onOpenCard={openCardOf}
            onOpenScene={openScene}
            onQuietToday={() => guard(hinting.quietToday())}
            onClose={() => setPanel(null)}
          />
        )}

        {panel === "ai" && (
          <AiPanel
            storage={storage}
            ai={shell.ai}
            connection={connection}
            onConnection={changeConnection}
            view={analysis.view}
            onClose={() => setPanel(null)}
            {...(analysisOptions?.createProvider === undefined
              ? {}
              : { createProvider: analysisOptions.createProvider })}
          />
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
