import {
  buildManuscript,
  openSqlStorage,
  plainText,
  readParagraphs,
  SceneSession,
  type SqlDriver,
  toDocx,
  toMarkdown,
} from "@ink-writer/core";
import { Editor } from "@tiptap/core";
import { proseExtensions } from "../editor/extensions";
import { bytesToBase64, type Invoke } from "../tauri-driver";

export interface SmokeContext {
  readonly invoke?: Invoke;
  readonly host?: HTMLElement;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Crosses every layer for real: page, editor, IPC, Rust and the SQLite file, on whichever operating
 * system and WebView this runs. Unit tests can't show that these parts fit together.
 */
export async function runSmokeChecks(
  driver: SqlDriver,
  context: SmokeContext = {},
): Promise<string> {
  const { storage, migration } = await openSqlStorage(driver);

  const title = "Prueba de humo ñ 🖋️";
  const project = await storage.createProject({ title, language: "es", era: "actualidad" });
  const chapter = await storage.createChapter(project.id, "Uno");
  const scene = await storage.createScene(chapter.id, "A");

  const projects = await storage.listProjects();
  assert(
    projects.some((listed) => listed.title === title),
    "Text didn't survive the round trip",
  );
  const scenes = await storage.listScenes(chapter.id);
  assert(scenes[0]?.id === scene.id, "The scene can't be read back");

  // Yjs documents are stored as blobs: every byte value must cross the boundary unchanged.
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
  const [row] = await driver.query("SELECT ? AS value", [bytes]);
  const echoed = row?.value;
  assert(
    echoed instanceof Uint8Array && echoed.every((byte, index) => byte === bytes[index]),
    "A blob changed in the round trip",
  );

  const failed = await driver
    .transaction([
      { sql: "INSERT INTO projects (id, title, language, era) VALUES ('x', 't', 'l', 'e')" },
      { sql: "THIS IS NOT SQL" },
    ])
    .then(
      () => false,
      () => true,
    );
  assert(failed, "A bad transaction didn't fail");
  const rolledBack = await driver.query("SELECT id FROM projects WHERE id = 'x'");
  assert(rolledBack.length === 0, "A failed transaction left data behind");

  // The real editor, saving for real, and reading it back.
  const prose = "—¿Qué ocurrió? —preguntó Tomás, con los ojos verdes de su madre.";
  const session = await SceneSession.open(storage, scene.id, { autoSnapshotMs: 0 });
  let words = 0;
  if (context.host !== undefined) {
    const editor = new Editor({ element: context.host, extensions: proseExtensions(session.doc) });
    editor.commands.insertContent(prose);
    await session.flush();
    assert(editor.getText() === prose, "The editor doesn't show what was typed");
    await session.snapshot("Smoke");
    editor.destroy();
    await session.close();

    const reopened = await SceneSession.open(storage, scene.id, { autoSnapshotMs: 0 });
    assert(plainText(readParagraphs(reopened.doc)) === prose, "The text wasn't saved");
    words = prose.split(/\s+/).length;
    await reopened.close();
  } else {
    await session.close();
  }

  const manuscript = await buildManuscript(storage, project.id);
  assert(toMarkdown(manuscript).includes(title), "The export lost the title");

  // The export goes through the shell, which writes it to the test's folder.
  if (context.invoke !== undefined) {
    const saved = await context.invoke("export_file", {
      suggestedName: "smoke",
      extension: "docx",
      dataBase64: bytesToBase64(toDocx(manuscript)),
    });
    assert(saved === true, "The shell didn't save the export");
  }

  return `schema ${migration.to}, ${scenes.length} scene, ${bytes.length} blob bytes, ${words} words saved`;
}
