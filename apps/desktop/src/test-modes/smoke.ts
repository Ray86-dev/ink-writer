import {
  type AiTransport,
  AnalysisQueue,
  buildManuscript,
  collectDraft,
  createNameFinder,
  createOllamaProvider,
  knownNames,
  loadNovelView,
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
  /** With one, a stand-in for the AI services must be listening: see `scripts/smoke.mjs`. */
  readonly transport?: AiTransport;
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

  // A model's answer comes back through the shell piece by piece, as it would from a real service.
  let answer = "none";
  if (context.transport !== undefined) {
    const provider = createOllamaProvider(context.transport);
    const models = await provider.listModels();
    assert(models[0]?.id === "smoke-model", "The model list didn't come through the shell");
    const draft = await collectDraft(
      provider.generate({ model: "smoke-model", instructions: "Repite.", input: prose }),
    );
    assert(draft.completed, `The answer didn't complete: ${JSON.stringify(draft.outcome)}`);
    assert(draft.text === prose, "The answer changed on its way through the shell");

    const paid = await context.transport
      .send({
        route: "openrouter",
        method: "POST",
        path: "/api/v1/chat/completions",
        body: { model: "some/paid-model", messages: [] },
      })
      .then(
        () => "sent",
        (error: unknown) => String(error),
      );
    assert(paid.includes("free"), `The shell didn't refuse a paid model: ${paid}`);
    answer = `${draft.text.length} characters`;

    // The whole way round: the scene saved above is read, sent, and what comes back is stored.
    if (context.host !== undefined) {
      const queue = new AnalysisQueue({
        storage,
        projectId: project.id,
        analysis: { provider, model: "smoke-model", language: "es" },
      });
      const run = await queue.run();
      await queue.stop();
      assert(
        run.status === "done" && run.analyzed.includes(scene.id),
        `The scene wasn't analysed: ${JSON.stringify(run)}`,
      );
      const { facts } = await storage.loadAnalysis(project.id);
      assert(
        facts.some((fact) => fact.quote === "los ojos verdes de su madre"),
        "The analysis didn't keep the fact with its quote",
      );
      answer += `, ${facts.length} fact stored`;

      // From what's stored to a card, and from the card's names to links in the real editor.
      const novel = await loadNovelView(storage, project.id);
      const card = novel.cards.find((item) => item.name === "Tomás");
      assert(
        card?.facts[0]?.quote === "los ojos verdes de su madre",
        "The card doesn't show the passage",
      );
      const find = createNameFinder(knownNames(novel));
      const linked = await SceneSession.open(storage, scene.id, { autoSnapshotMs: 0 });
      const linkEditor = new Editor({
        element: context.host,
        extensions: proseExtensions(linked.doc, {
          find: () => find,
          needsModifier: () => true,
          onOpen: () => {},
        }),
      });
      const link = context.host.querySelector(".name-link");
      assert(link?.textContent === "Tomás", "The name isn't linked in the editor");
      assert(linkEditor.getText() === prose, "Linking a name changed the text");
      linkEditor.destroy();
      await linked.close();
      answer += ", 1 card with its name linked";
    }
  }

  return `schema ${migration.to}, ${scenes.length} scene, ${bytes.length} blob bytes, ${words} words saved, AI answer of ${answer}`;
}
