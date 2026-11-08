import {
  openSqlStorage,
  plainText,
  readParagraphs,
  SceneSession,
  type SqlDriver,
  type Storage,
} from "@ink-writer/core";
import { Editor } from "@tiptap/core";
import { proseExtensions } from "../editor/extensions";
import type { TestContext } from "./run";

/**
 * Rule 2, on the real app. The writer types numbered words into the real editor as fast as it can,
 * and reports each number only after the database has confirmed it. Something outside then kills the
 * whole process at a random moment, and the verifier checks what survived.
 */

export const PARAGRAPH_EVERY = 40;

/** Compacts and stores versions far more often than real use, to die in the middle of them too. */
const AGGRESSIVE = { autoSnapshotMs: 150, compactAfterUpdates: 30 } as const;

/** What a run is checked against: every number once, in order, with nothing missing. */
export function checkSequence(text: string): { max: number; problem: string | null } {
  const numbers = [...text.matchAll(/w(\d+)/g)].map((match) => Number(match[1]));
  for (const [index, number] of numbers.entries()) {
    if (number !== index + 1) {
      return { max: numbers.length, problem: `word ${index + 1} of the text is w${number}` };
    }
  }
  return { max: numbers.length, problem: null };
}

async function theOnlyScene(storage: Storage): Promise<string> {
  const [project] = await storage.listProjects();
  if (project !== undefined) {
    const [chapter] = await storage.listChapters(project.id);
    const [scene] = await storage.listScenes(chapter?.id ?? "");
    if (scene !== undefined) {
      return scene.id;
    }
  }
  const created = await storage.createProject({
    title: "Crash",
    language: "es",
    era: "actualidad",
  });
  const chapter = await storage.createChapter(created.id, "Uno");
  return (await storage.createScene(chapter.id, "Una")).id;
}

const percentile = (sorted: readonly number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

export async function runCrashWriter(driver: SqlDriver, context: TestContext): Promise<void> {
  const { storage } = await openSqlStorage(driver);
  const session = await SceneSession.open(storage, await theOnlyScene(storage), AGGRESSIVE);
  const editor = new Editor({ element: context.host, extensions: proseExtensions(session.doc) });

  // Carries on from whatever survived the last kill.
  let next = checkSequence(plainText(readParagraphs(session.doc))).max + 1;
  const latencies: number[] = [];

  for (;;) {
    const started = performance.now();
    // A burst, like fast typing: these reach the database together.
    const burst = 1 + (next % 4);
    let last = next;
    for (let index = 0; index < burst; index += 1) {
      last = next;
      editor
        .chain()
        .setTextSelection(editor.state.doc.content.size - 1)
        .insertContent(`w${next} `)
        .run();
      if (next % PARAGRAPH_EVERY === 0) {
        editor.commands.splitBlock();
      }
      next += 1;
    }
    await session.flush();
    latencies.push(performance.now() - started);
    await context.log(`ACK ${last}`);

    if (latencies.length >= 25) {
      const sorted = [...latencies].sort((a, b) => a - b);
      await context.log(
        `LATENCY ${percentile(sorted, 0.5).toFixed(1)} ${percentile(sorted, 0.99).toFixed(1)} ${(sorted.at(-1) ?? 0).toFixed(1)}`,
      );
      latencies.length = 0;
    }
  }
}

/** `arg` is the last number confirmed before the kill. */
export async function runCrashVerify(driver: SqlDriver, context: TestContext): Promise<string> {
  const acknowledged = Number(context.arg ?? "0");
  const [health] = await driver.query("PRAGMA integrity_check");
  if (health?.integrity_check !== "ok") {
    throw new Error(`The database is damaged: ${String(health?.integrity_check)}`);
  }
  const { storage } = await openSqlStorage(driver);
  const session = await SceneSession.open(storage, await theOnlyScene(storage), {
    autoSnapshotMs: 0,
  });
  const stored = plainText(readParagraphs(session.doc));
  const { max, problem } = checkSequence(stored);
  if (problem !== null) {
    throw new Error(`The text is out of order: ${problem}`);
  }
  if (max < acknowledged) {
    throw new Error(`Lost text: w${acknowledged} was confirmed, but the text ends at w${max}`);
  }

  // The author sees what the editor shows, so that must hold up as well.
  const editor = new Editor({ element: context.host, extensions: proseExtensions(session.doc) });
  const shown = checkSequence(editor.getText());
  if (shown.problem !== null || shown.max !== max) {
    throw new Error(`The editor shows something else: ${shown.problem ?? `ends at w${shown.max}`}`);
  }
  editor.destroy();

  await context.log(`SURVIVED ${max}`);
  return `confirmed w${acknowledged}, text ends at w${max}, ${max - acknowledged} beyond`;
}
