import {
  type AnalysisState,
  hashText,
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

const LETTER = [
  "Tomás, su hermano, la encontró en el faro de la Punta. Este año la veda empieza el martes, dijo.",
  "Marta guardó la carta sin firmar en el bolsillo.",
];
const EYES = [
  "Al verla pensó que Marta tenía los ojos marrones de su madre.",
  "Inés Cabrera, patrona del único barco que seguía faenando, dijo que la veda empezaba el jueves.",
];

/** What an analysis of the sample would have left, so that the tour has cards to show. */
function analysed(first: string, second: string, third: string): AnalysisState {
  const fact = (
    id: string,
    sceneId: string,
    entityId: string,
    attribute: string,
    quote: string,
  ): AnalysisState["facts"][number] => ({
    id,
    sceneId,
    entityId,
    category: "physical",
    attribute,
    value: quote,
    quote,
    sentence: quote,
    storyTime: null,
    inDialogue: false,
  });
  return {
    entities: [
      { id: "marta", type: "person", canonicalName: "Marta Rey", aliases: ["Marta"] },
      { id: "tomas", type: "person", canonicalName: "Tomás", aliases: [] },
      { id: "ines", type: "person", canonicalName: "Inés Cabrera", aliases: ["Inés"] },
      { id: "remedios", type: "person", canonicalName: "Remedios", aliases: [] },
      { id: "puerto", type: "place", canonicalName: "Puerto Viejo", aliases: [] },
      { id: "sal", type: "place", canonicalName: "calle de la Sal", aliases: [] },
      { id: "faro", type: "place", canonicalName: "faro de la Punta", aliases: [] },
      { id: "carta", type: "lore", canonicalName: "carta sin firmar", aliases: [] },
      { id: "veda", type: "lore", canonicalName: "veda", aliases: [] },
    ],
    mentions: [
      { sceneId: first, entityId: "marta", quote: "Marta Rey" },
      { sceneId: first, entityId: "puerto", quote: "Puerto Viejo" },
      { sceneId: first, entityId: "sal", quote: "calle de la Sal" },
      { sceneId: first, entityId: "remedios", quote: "Remedios" },
      { sceneId: first, entityId: "carta", quote: "carta sin firmar" },
      { sceneId: second, entityId: "tomas", quote: "Tomás" },
      { sceneId: second, entityId: "faro", quote: "faro de la Punta" },
      { sceneId: second, entityId: "veda", quote: "veda" },
      { sceneId: second, entityId: "marta", quote: "Marta" },
      { sceneId: second, entityId: "carta", quote: "carta sin firmar" },
      { sceneId: third, entityId: "marta", quote: "Marta" },
      { sceneId: third, entityId: "ines", quote: "Inés Cabrera" },
      { sceneId: third, entityId: "veda", quote: "veda" },
    ],
    facts: [
      fact("f1", first, "marta", "arrival", "Marta Rey bajó del autobús en Puerto Viejo"),
      fact("f2", first, "marta", "status", "aún estaba soltera"),
      fact("f3", second, "veda", "start", "la veda empieza el martes"),
      fact("f4", third, "marta", "eyes", "Marta tenía los ojos marrones de su madre"),
      fact("f5", third, "ines", "job", "patrona del único barco que seguía faenando"),
      fact("f6", third, "veda", "start", "la veda empezaba el jueves"),
    ],
    relations: [
      {
        id: "r1",
        sceneId: second,
        fromEntityId: "tomas",
        toEntityId: "marta",
        label: "hermano de",
        quote: "Tomás, su hermano",
      },
      {
        id: "r2",
        sceneId: first,
        fromEntityId: "remedios",
        toEntityId: "marta",
        label: "tía de",
        quote: "su tía Remedios",
      },
    ],
    issues: [
      {
        kind: "contradiction",
        a: { sceneId: second, quote: "la veda empieza el martes" },
        b: { sceneId: third, quote: "la veda empezaba el jueves" },
        reason: "La veda empieza el martes en un capítulo y el jueves en otro.",
      },
    ],
    sceneOrder: [first, second, third],
  };
}

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
  const letter = await storage.createScene(chapter.id, "La carta");
  const eyes = await storage.createScene(other.id, "Los ojos de su madre");
  // The other two scenes, and what an analysis of the three would have found.
  for (const [target, paragraphs] of [
    [letter, LETTER],
    [eyes, EYES],
  ] as const) {
    const filling = await SceneSession.open(storage, target.id, { autoSnapshotMs: 0 });
    filling.doc.transact(() => {
      const fragment = filling.doc.getXmlFragment(PROSE_FIELD);
      for (const text of paragraphs) {
        const element = new Y.XmlElement("paragraph");
        element.insert(0, [new Y.XmlText(text)]);
        fragment.push([element]);
      }
    });
    await filling.close();
  }
  const state = analysed(scene.id, letter.id, eyes.id);
  for (const [target, paragraphs] of [
    [scene, SAMPLE],
    [letter, LETTER],
    [eyes, EYES],
  ] as const) {
    await storage.saveSceneAnalysis(
      project.id,
      target.id,
      await hashText(paragraphs.join("\n")),
      state,
    );
  }
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

  // A novel opens at its Dashboard. Every other screen of the tour is of the text.
  if (screen.startsWith("dashboard")) {
    await until(() => document.querySelector(".dash-card"));
    await wait(4000);
    await context.log("READY");
    return;
  }
  (await until(() => button(/Seguir escribiendo|Keep writing/))).click();

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
