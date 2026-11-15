import {
  type AiTransport,
  AnalysisQueue,
  buildManuscript,
  buildNetwork,
  collectDraft,
  createNameFinder,
  createOllamaProvider,
  knownNames,
  loadNovelView,
  type NovelView,
  openSqlStorage,
  parseWiki,
  plainText,
  type ResearchAnswer,
  type ResearchRequest,
  readParagraphs,
  SceneSession,
  type SqlDriver,
  toDocx,
  toMarkdown,
} from "@ink-writer/core";
import { Editor } from "@tiptap/core";
import { createInkNetwork } from "../dashboard/ink-network";
import { loadThreePainter, supportsWebGl } from "../dashboard/three-painter";
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
 * The Dashboard's network in this WebView. Where there's WebGL, three.js loads, the shader builds
 * and frames get painted. Where there isn't, the page must say so and go on with its cards alone.
 */
async function checkInkNetwork(host: HTMLElement, view: NovelView): Promise<string> {
  const hero = document.createElement("div");
  hero.style.cssText = "position:relative;width:960px;height:600px";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "width:100%;height:100%";
  const labels = document.createElement("div");
  hero.append(canvas, labels);
  host.append(hero);
  try {
    let lost = false;
    const painter = await loadThreePainter(canvas, () => {
      lost = true;
    });
    if (painter === null) {
      assert(!supportsWebGl(), "This WebView has WebGL, and the network didn't load");
      return "no WebGL here: the Dashboard shows its cards alone";
    }
    const network = buildNetwork(view);
    assert(network.nodes.length > 0, "The novel has cards and its network is empty");
    const ink = createInkNetwork({
      hero,
      labels,
      painter,
      reducedMotion: false,
      // By the clock, since a window that isn't in front may get no frames of its own.
      environment: {
        requestFrame: (callback) => window.setTimeout(() => callback(performance.now()), 16),
        cancelFrame: (handle) => window.clearTimeout(handle),
        hidden: () => false,
      },
    });
    ink.setNetwork(network);
    const started = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const { frames, pixelRatio } = ink.stats();
    const seconds = (performance.now() - started) / 1000;
    ink.dispose();
    assert(!lost, "The ink shader didn't build in this WebView");
    assert(frames > 0, "The network painted nothing");
    return `ink network of ${network.nodes.length} nodes painted with WebGL, ${Math.round(frames / seconds)} frames a second at ${pixelRatio.toFixed(2)} of the pixels`;
  } finally {
    hero.remove();
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
    assert(paid.includes("paid:"), `The shell didn't refuse a paid model: ${paid}`);

    // With a limit of one paid request a day, the shell lets one through and refuses the next.
    if (context.invoke !== undefined) {
      const sendPaid = () =>
        (context.transport as AiTransport)
          .send({
            route: "deepseek",
            method: "POST",
            path: "/chat/completions",
            body: { model: "deepseek-flash", messages: [] },
          })
          .then(
            () => "sent",
            (error: unknown) => String(error),
          );
      await context.invoke("ai_limits_set", { dailyRequests: 1 });
      const first = await sendPaid();
      const second = await sendPaid();
      assert(first === "sent", `The shell didn't let a paid request through: ${first}`);
      assert(second.includes("limit:"), `The shell went past the daily limit: ${second}`);
      const limits = (await context.invoke("ai_limits_get")) as { usedToday: number };
      assert(limits.usedToday === 1, "The shell didn't count the paid request");
      await context.invoke("ai_limits_set", { dailyRequests: 0 });

      // A search for documentation: the page gives a term, the shell builds the address, and what
      // comes back can be read. A passage isn't a term, and the day's limit holds here too.
      const invoke = context.invoke;
      const search = (request: ResearchRequest) =>
        invoke("research_fetch", { request }).then(
          (answer) => answer as ResearchAnswer,
          (error: unknown) => String(error),
        );
      await invoke("research_limits_set", { dailyRequests: 2 });
      const found = await search({ kind: "wiki", term: "Ñandú común", language: "es" });
      assert(typeof found !== "string", `The shell didn't search: ${String(found)}`);
      const [article] = parseWiki(found.body);
      assert(
        article?.text === "Sobre Ñandú común." &&
          article.sourceUrl === "https://es.wikipedia.org/wiki/%C3%91and%C3%BA%20com%C3%BAn",
        `The search term changed on its way out: ${JSON.stringify(article)}`,
      );
      const passage = await search({ kind: "wiki", term: `${prose} ${prose}`, language: "es" });
      assert(
        typeof passage === "string" && passage.includes("term:"),
        "The shell sent a passage as a search term",
      );
      const within = await search({ kind: "wiki", term: "relojero", language: "es" });
      const past = await search({ kind: "wiki", term: "tranvía", language: "es" });
      assert(typeof within !== "string", "A refused search used up the day's count");
      assert(
        typeof past === "string" && past.includes("limit:"),
        `The shell went past the day's searches: ${JSON.stringify(past)}`,
      );
      await invoke("research_limits_set", { dailyRequests: 60 });

      // Updates: the shell asks where it's told, reads what's announced, and a test installs
      // nothing.
      const update = (await invoke("update_check")) as { version: string; notes: string } | null;
      assert(
        update?.version === "99.0.0" && update.notes === "Notas de la versión ñ.",
        `The shell didn't read the update: ${JSON.stringify(update)}`,
      );
      const installing = await invoke("update_install").then(
        () => "installed",
        (error: unknown) => String(error),
      );
      assert(installing.includes("update:"), `A test installed an update: ${installing}`);
      const info = (await invoke("app_info")) as { version: string };
      assert(/^\d+\.\d+\.\d+$/.test(info.version), `The app has no version: ${info.version}`);
    }
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
      answer += `, ${await checkInkNetwork(context.host, novel)}`;
    }
  }

  return `schema ${migration.to}, ${scenes.length} scene, ${bytes.length} blob bytes, ${words} words saved, AI answer of ${answer}`;
}
