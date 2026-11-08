import {
  countWords,
  openSqlStorage,
  PROSE_FIELD,
  SceneSession,
  type SqlDriver,
  type Storage,
} from "@ink-writer/core";
import type { Editor } from "@tiptap/core";
import { createRoot } from "react-dom/client";
import * as Y from "yjs";
import { SceneEditor } from "../editor/SceneEditor";
import type { TestContext } from "./run";

/**
 * "Fluent typing with 150,000 words" (M2). A novel is many scenes, each its own document, so typing
 * normally touches only a small part of it. The whole book in one scene is the worst case, and both
 * are measured. Keystrokes go through the editor's own transactions, without the operating system's
 * input handling, and each one is timed until the next frame is on its way.
 */

const WORDS = 150_000;
const WORDS_PER_PARAGRAPH = 100;
const KEYSTROKES = 200;
/** A very fast typist: about 16 characters per second. */
const KEYSTROKE_GAP_MS = 60;

const VOCABULARY =
  "marta bajó del autobús en puerto viejo con una sola maleta nadie la esperaba en la calle de la sal y lo agradeció hacía once años que se había ido la casa olía a cerrado sobre la mesa alguien había dejado una carta sin firmar".split(
    " ",
  );

function paragraphsOf(words: number): string[] {
  const paragraphs: string[] = [];
  let written = 0;
  while (written < words) {
    const count = Math.min(WORDS_PER_PARAGRAPH, words - written);
    const parts: string[] = [];
    for (let index = 0; index < count; index += 1) {
      parts.push(VOCABULARY[(written + index * 7) % VOCABULARY.length] as string);
    }
    paragraphs.push(parts.join(" "));
    written += count;
  }
  return paragraphs;
}

function writeProse(doc: Y.Doc, paragraphs: readonly string[]): void {
  doc.transact(() => {
    const fragment = doc.getXmlFragment(PROSE_FIELD);
    fragment.push(
      paragraphs.map((text) => {
        const element = new Y.XmlElement("paragraph");
        element.insert(0, [new Y.XmlText(text)]);
        return element;
      }),
    );
  });
}

const percentile = (sorted: readonly number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

function summary(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: Number(percentile(sorted, 0.5).toFixed(1)),
    p95: Number(percentile(sorted, 0.95).toFixed(1)),
    p99: Number(percentile(sorted, 0.99).toFixed(1)),
    max: Number((sorted.at(-1) ?? 0).toFixed(1)),
  };
}

/** Resolves when the browser is about to paint, or soon after if it isn't painting at all. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const fallback = setTimeout(resolve, 250);
    requestAnimationFrame(() => {
      clearTimeout(fallback);
      setTimeout(resolve, 0);
    });
  });
}

/**
 * What years of editing leave behind: thousands of small insertions and deletions scattered around.
 * A freshly written document is one tidy run per paragraph, which flatters the numbers.
 */
function editAllOver(doc: Y.Doc, edits: number): void {
  const fragment = doc.getXmlFragment(PROSE_FIELD);
  const paragraphs = fragment.length;
  const batch = 100;
  for (let done = 0; done < edits; done += batch) {
    doc.transact(() => {
      for (let index = 0; index < batch; index += 1) {
        const seed = done + index;
        const paragraph = fragment.get((seed * 7919) % paragraphs) as Y.XmlElement;
        const text = paragraph.get(0) as Y.XmlText;
        const at = (seed * 104729) % Math.max(1, text.length);
        if (seed % 3 === 0 && text.length > at + 3) {
          text.delete(at, 3);
        } else {
          text.insert(at, "x");
        }
      }
    });
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mount(
  host: HTMLElement,
  session: SceneSession,
): Promise<{ editor: Editor; ms: number; unmount: () => void }> {
  const started = performance.now();
  const container = document.createElement("div");
  host.append(container);
  const root = createRoot(container);
  const editor = await new Promise<Editor>((resolve) => {
    root.render(
      <SceneEditor
        session={session}
        label="prueba"
        language="es"
        autofocus={false}
        onEditor={(ready) => {
          if (ready !== null) {
            resolve(ready);
          }
        }}
      />,
    );
  });
  await nextFrame();
  return {
    editor,
    ms: performance.now() - started,
    unmount: () => {
      root.unmount();
      container.remove();
    },
  };
}

async function typeAt(editor: Editor, position: number) {
  const dispatch: number[] = [];
  const toFrame: number[] = [];
  editor.commands.setTextSelection(position);
  for (let index = 0; index < KEYSTROKES; index += 1) {
    const started = performance.now();
    editor.commands.insertContent("a");
    dispatch.push(performance.now() - started);
    await nextFrame();
    toFrame.push(performance.now() - started);
    await sleep(KEYSTROKE_GAP_MS);
  }
  return { dispatch: summary(dispatch), toFrame: summary(toFrame) };
}

async function measureScene(
  storage: Storage,
  host: HTMLElement,
  sceneId: string,
  paragraphs: readonly string[],
  edits = 0,
) {
  const writing = await SceneSession.open(storage, sceneId, { autoSnapshotMs: 0 });
  const writeStarted = performance.now();
  writeProse(writing.doc, paragraphs);
  editAllOver(writing.doc, edits);
  await writing.close();
  const saveMs = performance.now() - writeStarted;

  const loadStarted = performance.now();
  const session = await SceneSession.open(storage, sceneId, { autoSnapshotMs: 0 });
  const loadMs = performance.now() - loadStarted;
  const { editor, ms: mountMs, unmount } = await mount(host, session);
  const words = countWords(editor.getText());
  const expected = paragraphs.join(" ").split(" ").length;
  // A test that measured an empty editor would look wonderful, so it checks what's really shown.
  if (Math.abs(words - expected) > expected * 0.05) {
    throw new Error(`The editor shows ${words} words instead of about ${expected}`);
  }

  const end = await typeAt(editor, editor.state.doc.content.size - 1);
  const middle = await typeAt(editor, Math.floor(editor.state.doc.content.size / 2));

  const flushStarted = performance.now();
  await session.flush();
  const flushMs = performance.now() - flushStarted;
  const snapshotStarted = performance.now();
  await session.snapshot();
  const snapshotMs = performance.now() - snapshotStarted;
  const closeStarted = performance.now();
  unmount();
  await session.close();
  const closeMs = performance.now() - closeStarted;

  return {
    words,
    saveMs: Math.round(saveMs),
    loadMs: Math.round(loadMs),
    mountMs: Math.round(mountMs),
    typingAtEnd: end,
    typingInTheMiddle: middle,
    flushMs: Math.round(flushMs),
    snapshotMs: Math.round(snapshotMs),
    closeMs: Math.round(closeMs),
  };
}

export async function runPerformance(driver: SqlDriver, context: TestContext): Promise<string> {
  const { storage } = await openSqlStorage(driver);
  const project = await storage.createProject({ title: "Rendimiento", language: "es", era: "x" });
  const chapter = await storage.createChapter(project.id, "Uno");

  const wholeBook = await storage.createScene(chapter.id, "El libro entero");
  const worstCase = await measureScene(storage, context.host, wholeBook.id, paragraphsOf(WORDS));
  await context.log(`PERF ${JSON.stringify({ case: "150k words in one scene", ...worstCase })}`);

  const edited = await storage.createScene(chapter.id, "El libro muy editado");
  const heavy = await measureScene(storage, context.host, edited.id, paragraphsOf(WORDS), 20_000);
  await context.log(
    `PERF ${JSON.stringify({ case: "150k words after 20,000 scattered edits", ...heavy })}`,
  );

  // A realistic split: one scene of the 300 that make up the same novel.
  const realistic = await storage.createScene(chapter.id, "Una escena normal");
  const usual = await measureScene(storage, context.host, realistic.id, paragraphsOf(WORDS / 300));
  await context.log(`PERF ${JSON.stringify({ case: "one scene of 500 words", ...usual })}`);

  return "measured";
}
