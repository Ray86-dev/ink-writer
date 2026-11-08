import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  openSqlStorage,
  paragraphsFromState,
  plainText,
  SceneSession,
  type SceneSessionOptions,
  type Storage,
} from "../src/index";
import { createNodeSqliteDriver } from "./support/node-sqlite-driver";
import { textOf, typeInto, writeParagraphs } from "./support/prose";

const noSleep = { sleep: async () => {} };

/** No timers in tests, unless a test asks for them. */
const options = (extra: SceneSessionOptions = {}): SceneSessionOptions => ({
  autoSnapshotMs: 0,
  ...noSleep,
  ...extra,
});

describe("SceneSession", () => {
  let driver: ReturnType<typeof createNodeSqliteDriver>;
  let storage: Storage;
  let sceneId: string;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    ({ storage } = await openSqlStorage(driver));
    const project = await storage.createProject({ title: "T", language: "es", era: "actualidad" });
    const chapter = await storage.createChapter(project.id, "C");
    sceneId = (await storage.createScene(chapter.id, "S")).id;
  });

  afterEach(() => driver.close());

  const open = (extra?: SceneSessionOptions) => SceneSession.open(storage, sceneId, options(extra));

  const rows = async () => (await storage.loadSceneProse(sceneId)).updates.length;

  /** What a fresh start would read, without closing anything: the crash view of the database. */
  const textAfterCrash = async () => {
    const reopened = await open();
    const text = textOf(reopened.doc);
    reopened.doc.destroy();
    return text;
  };

  describe("saving", () => {
    it("starts empty and saved", async () => {
      const session = await open();

      expect(textOf(session.doc)).toBe("");
      expect(session.saveState).toBe("saved");
    });

    it("has what was typed in the database once flush resolves, without closing", async () => {
      const session = await open();

      writeParagraphs(session.doc, ["Marta bajó del autobús."]);
      await session.flush();

      expect(await textAfterCrash()).toBe("Marta bajó del autobús.");
    });

    it("goes through saving and back to saved", async () => {
      const session = await open();
      const seen: string[] = [];
      session.onSaveState((state) => seen.push(state));

      writeParagraphs(session.doc, ["x"]);
      expect(session.saveState).toBe("saving");
      await session.flush();

      expect(seen).toEqual(["saving", "saved"]);
    });

    it("doesn't write back what it loaded", async () => {
      const first = await open();
      writeParagraphs(first.doc, ["x"]);
      await first.flush();
      const before = await rows();

      const second = await open();
      await second.flush();

      expect(await rows()).toBe(before);
    });

    it("never overwrites: every write adds a row", async () => {
      const session = await open();

      writeParagraphs(session.doc, ["a"]);
      await session.flush();
      const afterFirst = await rows();
      typeInto(session.doc, "b");
      await session.flush();

      expect(await rows()).toBe(afterFirst + 1);
    });

    it("groups changes made while a write is running, and loses none", async () => {
      const appended: Uint8Array[] = [];
      const release: (() => void)[] = [];
      const slow: Storage = {
        ...storage,
        appendSceneUpdate: async (id, update) => {
          appended.push(update);
          await new Promise<void>((resolve) => release.push(resolve));
          await storage.appendSceneUpdate(id, update);
        },
      };
      const session = await SceneSession.open(slow, sceneId, options());

      writeParagraphs(session.doc, ["a"]);
      for (const letter of "bcdefghij") {
        typeInto(session.doc, letter);
      }
      const flushed = session.flush();
      release.shift()?.();
      await new Promise((resolve) => setTimeout(resolve));
      release.shift()?.();
      await flushed;

      expect(appended).toHaveLength(2);
      expect(await textAfterCrash()).toBe("abcdefghij");
    });

    it("flush covers changes made before it, not ones made after", async () => {
      const session = await open();
      writeParagraphs(session.doc, ["a"]);

      const flushed = session.flush();
      typeInto(session.doc, "b");
      await flushed;
      await session.flush();

      expect(await textAfterCrash()).toBe("ab");
    });
  });

  describe("when writing fails", () => {
    /** Refuses writes until told otherwise, like a full disk. */
    const failing = () => {
      const control = { failing: true, attempts: 0 };
      const store: Storage = {
        ...storage,
        appendSceneUpdate: async (id, update) => {
          control.attempts += 1;
          if (control.failing) {
            throw new Error("disk full");
          }
          await storage.appendSceneUpdate(id, update);
        },
      };
      return { control, store };
    };

    it("says so, keeps the text and saves it once writing works again", async () => {
      const { control, store } = failing();
      const session = await SceneSession.open(
        store,
        sceneId,
        options({
          sleep: async () => {
            if (control.attempts >= 3) {
              control.failing = false;
            }
          },
        }),
      );
      const seen: string[] = [];
      session.onSaveState((state) => seen.push(state));

      writeParagraphs(session.doc, ["No me pierdas."]);
      await session.flush();

      expect(seen).toContain("failing");
      expect(session.saveState).toBe("saved");
      expect(session.saveError).toBeNull();
      expect(control.attempts).toBeGreaterThanOrEqual(3);
      expect(await textAfterCrash()).toBe("No me pierdas.");
    });

    it("exposes the cause while failing, and text typed meanwhile isn't lost", async () => {
      const { control, store } = failing();
      let wake = () => {};
      const session = await SceneSession.open(
        store,
        sceneId,
        options({
          sleep: () =>
            new Promise<void>((resolve) => {
              wake = resolve;
            }),
        }),
      );

      writeParagraphs(session.doc, ["antes"]);
      await new Promise((resolve) => setTimeout(resolve));
      expect(session.saveState).toBe("failing");
      expect(String(session.saveError)).toContain("disk full");

      typeInto(session.doc, " y después");
      control.failing = false;
      wake();
      await session.flush();

      expect(await textAfterCrash()).toBe("antes y después");
    });

    it("backs off between retries, up to a limit", async () => {
      const { control, store } = failing();
      const waits: number[] = [];
      const session = await SceneSession.open(
        store,
        sceneId,
        options({
          sleep: async (ms) => {
            waits.push(ms);
            if (waits.length === 8) {
              control.failing = false;
            }
          },
        }),
      );

      writeParagraphs(session.doc, ["x"]);
      await session.flush();

      expect(waits).toEqual([250, 500, 1000, 2000, 4000, 5000, 5000, 5000]);
    });

    it("doesn't resolve flush while the text isn't on disk", async () => {
      const { control, store } = failing();
      let wake = () => {};
      const session = await SceneSession.open(
        store,
        sceneId,
        options({
          sleep: () =>
            new Promise<void>((resolve) => {
              wake = resolve;
            }),
        }),
      );
      let flushed = false;

      writeParagraphs(session.doc, ["x"]);
      void session.flush().then(() => {
        flushed = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(flushed).toBe(false);

      control.failing = false;
      wake();
      await session.flush();
      expect(flushed).toBe(true);
    });
  });

  describe("conflicts (rule 2)", () => {
    it("merges two sessions writing at once: no text is lost", async () => {
      const a = await open();
      const b = await open();

      writeParagraphs(a.doc, ["Texto de A."]);
      writeParagraphs(b.doc, ["Texto de B."]);
      await Promise.all([a.flush(), b.flush()]);

      const merged = await textAfterCrash();
      expect(merged).toContain("Texto de A.");
      expect(merged).toContain("Texto de B.");
    });

    it("merges edits to the same paragraph made from the same starting point", async () => {
      const first = await open();
      writeParagraphs(first.doc, ["base"]);
      await first.close();

      const a = await open();
      const b = await open();
      typeInto(a.doc, " de A");
      typeInto(b.doc, " de B");
      await Promise.all([a.flush(), b.flush()]);

      const merged = await textAfterCrash();
      expect(merged).toContain("base");
      expect(merged).toContain(" de A");
      expect(merged).toContain(" de B");
    });

    it("keeps a write that arrives during compaction", async () => {
      const session = await open();
      writeParagraphs(session.doc, ["antes"]);
      await session.flush();

      // Another writer gets in between the compaction's read and its commit.
      const other = await open();
      const racing: Storage = {
        ...storage,
        compactSceneProse: async (id, base, upTo, version) => {
          typeInto(other.doc, " y durante");
          await other.flush();
          return storage.compactSceneProse(id, base, upTo, version);
        },
      };
      const compacting = await SceneSession.open(racing, sceneId, options());
      await compacting.compact();

      expect(await textAfterCrash()).toBe("antes y durante");
      expect(await rows()).toBeGreaterThan(0);
    });

    it("applying the same stored updates twice changes nothing", async () => {
      const session = await open();
      writeParagraphs(session.doc, ["una vez"]);
      await session.flush();

      const prose = await storage.loadSceneProse(sceneId);
      const doc = new Y.Doc();
      for (const update of [...prose.updates, ...prose.updates]) {
        Y.applyUpdate(doc, update.data);
      }

      expect(textOf(doc)).toBe("una vez");
    });

    it("reads the same whatever the order of the updates", async () => {
      const session = await open();
      writeParagraphs(session.doc, ["a"]);
      await session.flush();
      typeInto(session.doc, "b");
      await session.flush();
      typeInto(session.doc, "c");
      await session.flush();

      const { updates } = await storage.loadSceneProse(sceneId);
      const doc = new Y.Doc();
      for (const update of [...updates].reverse()) {
        Y.applyUpdate(doc, update.data);
      }

      expect(textOf(doc)).toBe("abc");
    });
  });

  describe("compaction", () => {
    it("folds the log into the base and keeps the text", async () => {
      const session = await open();
      writeParagraphs(session.doc, ["uno", "dos"]);
      await session.flush();
      typeInto(session.doc, " más");
      await session.flush();

      await session.compact();

      const prose = await storage.loadSceneProse(sceneId);
      expect(prose.updates).toEqual([]);
      expect(prose.base).not.toBeNull();
      expect(await textAfterCrash()).toBe("uno más\ndos");
    });

    it("does nothing when there's nothing to fold", async () => {
      const session = await open();

      await session.compact();

      expect((await storage.loadSceneProse(sceneId)).base).toBeNull();
    });

    it("keeps working on top of a compacted base", async () => {
      const session = await open();
      writeParagraphs(session.doc, ["a"]);
      await session.compact();
      typeInto(session.doc, "b");
      await session.compact();
      typeInto(session.doc, "c");
      await session.flush();

      expect(await textAfterCrash()).toBe("abc");
    });

    it("leaves everything in place if the commit fails", async () => {
      const session = await open();
      writeParagraphs(session.doc, ["a salvo"]);
      await session.flush();
      const before = await rows();
      const broken: Storage = {
        ...storage,
        compactSceneProse: async () => {
          throw new Error("disk full");
        },
      };
      const compacting = await SceneSession.open(broken, sceneId, options());

      await expect(compacting.compact()).rejects.toThrow("disk full");

      expect(await rows()).toBe(before);
      expect(await textAfterCrash()).toBe("a salvo");
    });

    it("refuses a compaction built from an old read, which would otherwise lose text", async () => {
      const session = await open();
      writeParagraphs(session.doc, ["uno"]);
      await session.flush();

      // Between this compaction's read and its commit, another one folds in newer text.
      const newer = await open();
      const stale: Storage = {
        ...storage,
        compactSceneProse: async (id, base, upTo, version) => {
          typeInto(newer.doc, " dos");
          await newer.compact();
          return storage.compactSceneProse(id, base, upTo, version);
        },
      };
      const older = await SceneSession.open(stale, sceneId, options());

      await older.compact();

      expect(await textAfterCrash()).toBe("uno dos");
    });

    it("a refused compaction changes nothing at all", async () => {
      const session = await open();
      writeParagraphs(session.doc, ["a salvo"]);
      await session.flush();
      const before = await storage.loadSceneProse(sceneId);

      const done = await storage.compactSceneProse(
        sceneId,
        new Uint8Array([1, 2, 3]),
        before.updates.at(-1)?.id ?? 0,
        before.baseVersion + 7,
      );

      expect(done).toBe(false);
      expect(await storage.loadSceneProse(sceneId)).toEqual(before);
    });

    it("runs one compaction at a time inside a session", async () => {
      const session = await open();
      writeParagraphs(session.doc, ["x"]);
      await session.flush();
      let running = 0;
      let most = 0;
      const counting: Storage = {
        ...storage,
        compactSceneProse: async (...args) => {
          running += 1;
          most = Math.max(most, running);
          await new Promise((resolve) => setTimeout(resolve, 5));
          running -= 1;
          return storage.compactSceneProse(...args);
        },
      };
      const compacting = await SceneSession.open(counting, sceneId, options());

      await Promise.all([compacting.compact(), compacting.compact(), compacting.compact()]);

      expect(most).toBe(1);
      expect(await textAfterCrash()).toBe("x");
    });

    it("counts up the base version with each compaction", async () => {
      const session = await open();
      expect((await storage.loadSceneProse(sceneId)).baseVersion).toBe(0);

      writeParagraphs(session.doc, ["a"]);
      await session.compact();
      expect((await storage.loadSceneProse(sceneId)).baseVersion).toBe(1);

      typeInto(session.doc, "b");
      await session.compact();
      expect((await storage.loadSceneProse(sceneId)).baseVersion).toBe(2);
    });

    it("runs by itself once enough updates pile up", async () => {
      const session = await open({ compactAfterUpdates: 3 });
      writeParagraphs(session.doc, ["a"]);
      await session.flush();
      for (const letter of "bcd") {
        typeInto(session.doc, letter);
        await session.flush();
      }
      await new Promise((resolve) => setTimeout(resolve, 5));

      expect(await rows()).toBeLessThan(4);
      expect(await textAfterCrash()).toBe("abcd");
    });

    it("the compaction itself is atomic: a failed batch undoes the base too", async () => {
      const session = await open();
      writeParagraphs(session.doc, ["a salvo"]);
      await session.flush();
      const before = await storage.loadSceneProse(sceneId);

      await expect(
        driver.transaction([
          {
            sql: "UPDATE scenes SET ydoc = ? WHERE id = ?",
            params: [new Uint8Array([1]), sceneId],
          },
          { sql: "NOT SQL" },
        ]),
      ).rejects.toThrow();

      expect(await storage.loadSceneProse(sceneId)).toEqual(before);
    });
  });

  describe("history", () => {
    it("stores a version that reads back as it was, and later edits don't change it", async () => {
      const session = await open();
      writeParagraphs(session.doc, ["primera versión con cinco palabras"]);

      const info = await session.snapshot("Mi versión");
      typeInto(session.doc, " y más");
      await session.flush();

      expect(info).toMatchObject({ sceneId, label: "Mi versión", wordCount: 5 });
      const state = await storage.loadSnapshot(info.id);
      expect(plainText(paragraphsFromState(state as Uint8Array))).toBe(
        "primera versión con cinco palabras",
      );
    });

    it("includes pending changes: a version never misses what was just typed", async () => {
      const session = await open();
      writeParagraphs(session.doc, ["recién escrito"]);

      const info = await session.snapshot();

      expect(await textAfterCrash()).toBe("recién escrito");
      expect(info.wordCount).toBe(2);
    });

    it("lists the newest first, without loading the data", async () => {
      let clock = 1000;
      const { storage: timed } = await openSqlStorage(driver, { now: () => clock++ });
      const session = await SceneSession.open(timed, sceneId, options());
      writeParagraphs(session.doc, ["x"]);
      const older = await session.snapshot("a");
      const newer = await session.snapshot("b");

      const list = await timed.listSnapshots(sceneId);

      expect(list.map((s) => s.id)).toEqual([newer.id, older.id]);
      expect(list[0]).not.toHaveProperty("ydoc");
      expect(list[0]).not.toHaveProperty("data");
    });

    it("gives null for a version that doesn't exist", async () => {
      await expect(storage.loadSnapshot("none")).resolves.toBeNull();
    });

    it("takes automatic versions only when something changed", async () => {
      const session = await open({ autoSnapshotMs: 5 });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await storage.listSnapshots(sceneId)).toEqual([]);

      writeParagraphs(session.doc, ["x"]);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const count = (await storage.listSnapshots(sceneId)).length;
      expect(count).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await storage.listSnapshots(sceneId)).toHaveLength(count);
      await session.close();
    });
  });

  describe("closing", () => {
    it("saves everything, stores a version and compacts", async () => {
      const session = await open();
      writeParagraphs(session.doc, ["hasta luego"]);

      await session.close();

      const prose = await storage.loadSceneProse(sceneId);
      expect(prose.updates).toEqual([]);
      expect(await storage.listSnapshots(sceneId)).toHaveLength(1);
      expect(await textAfterCrash()).toBe("hasta luego");
    });

    it("stores no version if nothing changed", async () => {
      const first = await open();
      writeParagraphs(first.doc, ["x"]);
      await first.close();
      const before = (await storage.listSnapshots(sceneId)).length;

      const second = await open();
      await second.close();

      expect(await storage.listSnapshots(sceneId)).toHaveLength(before);
    });

    it("still closes with the text safe if the version or the compaction fail", async () => {
      const broken: Storage = {
        ...storage,
        createSnapshot: async () => {
          throw new Error("no");
        },
        compactSceneProse: async () => {
          throw new Error("no");
        },
      };
      const session = await SceneSession.open(broken, sceneId, options());
      writeParagraphs(session.doc, ["a salvo"]);

      await expect(session.close()).resolves.toBeUndefined();

      expect(await textAfterCrash()).toBe("a salvo");
    });

    it("can be called twice", async () => {
      const session = await open();

      await session.close();
      await expect(session.close()).resolves.toBeUndefined();
    });
  });
});
