import {
  openSqlStorage,
  PROSE_FIELD,
  plainText,
  readParagraphs,
  SceneSession,
  type SqlDriver,
} from "@ink-writer/core";
import type { Editor } from "@tiptap/core";
import { createRoot } from "react-dom/client";
import * as Y from "yjs";
import { App } from "../App";
import type { Shell } from "../shell";
import type { TestContext } from "./run";

/**
 * Puts the real interface on a given screen with sample text, and stays there so that it can be
 * looked at. `arg` names the screen. For checking the layout by eye, including in other languages.
 */

const SAMPLE = [
  "Marta Rey bajó del autobús en Puerto Viejo con una sola maleta. Nadie la esperaba en la calle de la Sal, y lo agradeció. Hacía once años que se había ido, y aún estaba soltera, para disgusto de su tía Remedios.",
  "La casa olía a cerrado. Sobre la mesa, alguien había dejado una carta sin firmar.",
  "—¿Quién anda ahí? —preguntó, sin esperar respuesta.",
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(find: () => T | null | undefined): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const found = find();
    if (found !== null && found !== undefined) {
      return found;
    }
    await wait(25);
  }
  throw new Error("The tour didn't find what it was waiting for");
}

function button(name: RegExp): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find(
    (element) =>
      name.test(element.textContent ?? "") || name.test(element.getAttribute("aria-label") ?? ""),
  );
}

/** The novel the tour shows, written once before the app starts. */
async function seed(shell: Shell): Promise<void> {
  const { storage } = await openSqlStorage(shell.driver);
  if ((await storage.listProjects()).length > 0) {
    return;
  }
  const project = await storage.createProject({
    title: "La veda",
    language: "es",
    era: "actualidad",
  });
  const chapter = await storage.createChapter(project.id, "Capítulo 1");
  const other = await storage.createChapter(project.id, "Capítulo 2");
  const scene = await storage.createScene(chapter.id, "El regreso");
  await storage.createScene(chapter.id, "La carta");
  await storage.createScene(other.id, "Los ojos de su madre");
  const session = await SceneSession.open(storage, scene.id, { autoSnapshotMs: 0 });
  const write = (paragraphs: readonly string[]) =>
    session.doc.transact(() => {
      const fragment = session.doc.getXmlFragment(PROSE_FIELD);
      for (const text of paragraphs) {
        const element = new Y.XmlElement("paragraph");
        element.insert(0, [new Y.XmlText(text)]);
        fragment.push([element]);
      }
    });
  write(SAMPLE.slice(0, 2));
  await session.snapshot("Primer borrador");
  write(SAMPLE.slice(2));
  await session.close();
}

const LAST_WORDS = "Lo último antes de cerrar la ventana.";

/**
 * The real interface, and then the window's close button. Nothing is awaited between typing and
 * closing, so that it's the closing itself that has to save.
 */
export async function runCloseWindow(shell: Shell, context: TestContext): Promise<void> {
  await seed(shell);
  const root = document.getElementById("root");
  if (root === null) {
    throw new Error("The page has no root element");
  }
  createRoot(root).render(<App shell={shell} language="es" />);
  (await until(() => button(/La veda/))).click();
  const prose = await until(() =>
    document.querySelector<HTMLElement & { editor?: Editor }>(".prose"),
  );
  const editor = await until(() => prose.editor);
  // Lets the window's close listener get registered, which the page does right after showing.
  await wait(500);
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.commands.insertContent(LAST_WORDS);
  await context.invoke("test_close_window");
}

/** What the close above must have left behind, read from the database after the app is gone. */
export async function runCloseVerify(driver: SqlDriver): Promise<string> {
  const { storage } = await openSqlStorage(driver);
  const [project] = await storage.listProjects();
  const [chapter] = await storage.listChapters(project?.id ?? "");
  const [scene] = await storage.listScenes(chapter?.id ?? "");
  const prose = await storage.loadSceneProse(scene?.id ?? "");
  const session = await SceneSession.open(storage, scene?.id ?? "", { autoSnapshotMs: 0 });
  const text = plainText(readParagraphs(session.doc));
  session.doc.destroy();
  if (!text.includes(LAST_WORDS)) {
    throw new Error("Closing the window lost the last words");
  }
  if (prose.updates.length > 0) {
    throw new Error(`Closing left ${prose.updates.length} updates without compacting`);
  }
  const versions = await storage.listSnapshots(scene?.id ?? "");
  return `the last words were saved, the log was compacted, ${versions.length} versions`;
}

export async function runTour(shell: Shell, context: TestContext): Promise<void> {
  const screen = context.arg ?? "projects";
  const language = screen.endsWith("-en") ? "en" : "es";
  localStorage.removeItem("editor-mode");
  await seed(shell);

  const root = document.getElementById("root");
  if (root === null) {
    throw new Error("The page has no root element");
  }
  createRoot(root).render(<App shell={shell} language={language} />);

  if (screen.startsWith("projects")) {
    await until(() => button(/La veda/));
    await wait(300);
    await context.log("READY");
    return;
  }

  (await until(() => button(/La veda/))).click();
  await until(() => document.querySelector(".prose"));

  if (screen.startsWith("history")) {
    (await until(() => button(/Historial|History/))).click();
    (await until(() => button(/Comparar|Compare|Primer borrador/))).click();
    await until(() => document.querySelector(".comparison"));
  } else if (screen.startsWith("structure")) {
    (await until(() => button(/Capítulos y escenas|Chapters and scenes/))).click();
  } else if (screen.startsWith("read")) {
    const radios = await until(() => {
      const found = document.querySelectorAll<HTMLInputElement>('input[type="radio"]');
      return found.length === 3 ? found : null;
    });
    radios[2]?.click();
  }
  // The WebView's storage is shared with normal use, and this choice isn't the author's.
  localStorage.removeItem("editor-mode");
  await wait(300);
  await context.log("READY");
}
