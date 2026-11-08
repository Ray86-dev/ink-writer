import { openSqlStorage, type SqlDriver } from "@ink-writer/core";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Crosses every layer for real: page, IPC, Rust and the SQLite file, on whichever operating system
 * and WebView this runs. Unit tests can't show that these parts fit together.
 */
export async function runSmokeChecks(driver: SqlDriver): Promise<string> {
  const { storage, migration } = await openSqlStorage(driver);

  const title = "Prueba de humo ñ 🖋️";
  const project = await storage.createProject({ title, language: "es", era: "actualidad" });
  const chapter = await storage.createChapter(project.id, "Uno");
  const scene = await storage.createScene(chapter.id, "A");

  const [listed] = await storage.listProjects();
  assert(listed?.title === title, "Text didn't survive the round trip");
  const scenes = await storage.listScenes(chapter.id);
  assert(scenes[0]?.id === scene.id, "The scene can't be read back");

  // M2 stores Yjs documents as blobs: every byte value must cross the boundary unchanged.
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

  return `schema ${migration.to}, ${scenes.length} scene, ${bytes.length} blob bytes`;
}
