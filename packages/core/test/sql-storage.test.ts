import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqlStorage, InvalidInputError, openSqlStorage, type Storage } from "../src/index";
import { createNodeSqliteDriver } from "./support/node-sqlite-driver";

const newProject = { title: "La veda", language: "es", era: "actualidad" };

describe("SQL storage", () => {
  let driver: ReturnType<typeof createNodeSqliteDriver>;
  let storage: Storage;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    ({ storage } = await openSqlStorage(driver));
  });

  afterEach(() => driver.close());

  it("opening migrates the database first", async () => {
    const fresh = createNodeSqliteDriver();
    const { migration, storage: opened } = await openSqlStorage(fresh);

    expect(migration.from).toBe(0);
    await expect(opened.listProjects()).resolves.toEqual([]);
    fresh.close();
  });

  it("creates and lists projects", async () => {
    const project = await storage.createProject(newProject);

    expect(project).toMatchObject(newProject);
    expect(project.id).not.toBe("");
    await expect(storage.listProjects()).resolves.toEqual([project]);
  });

  it("gives each record a new ID by default, and takes an injected generator", async () => {
    const a = await storage.createProject(newProject);
    const b = await storage.createProject(newProject);
    expect(a.id).not.toBe(b.id);

    const fixed = createSqlStorage(driver, { newId: () => "fixed-id" });
    await expect(fixed.createProject(newProject)).resolves.toMatchObject({ id: "fixed-id" });
  });

  it("orders projects by title", async () => {
    await storage.createProject({ ...newProject, title: "Zeta" });
    await storage.createProject({ ...newProject, title: "Alfa" });

    const titles = (await storage.listProjects()).map((p) => p.title);
    expect(titles).toEqual(["Alfa", "Zeta"]);
  });

  it("trims text and refuses empty required fields without writing", async () => {
    const trimmed = await storage.createProject({ ...newProject, title: "  Con espacios " });
    expect(trimmed.title).toBe("Con espacios");

    for (const field of ["title", "language", "era"] as const) {
      await expect(storage.createProject({ ...newProject, [field]: "   " })).rejects.toEqual(
        new InvalidInputError(field),
      );
    }
    await expect(storage.listProjects()).resolves.toHaveLength(1);
  });

  it("appends chapters and scenes in order", async () => {
    const project = await storage.createProject(newProject);
    const c0 = await storage.createChapter(project.id, "Uno");
    const c1 = await storage.createChapter(project.id, "Dos");
    const s0 = await storage.createScene(c0.id, "A");
    const s1 = await storage.createScene(c0.id, "B");
    const other = await storage.createScene(c1.id, "C");

    expect([c0.position, c1.position]).toEqual([0, 1]);
    expect([s0.position, s1.position, other.position]).toEqual([0, 1, 0]);
    expect(c0).toMatchObject({ projectId: project.id, eraOverride: null });
    expect(s0).toMatchObject({ chapterId: c0.id, status: "draft" });
    await expect(storage.listChapters(project.id)).resolves.toEqual([c0, c1]);
    await expect(storage.listScenes(c0.id)).resolves.toEqual([s0, s1]);
  });

  it("gives concurrent inserts different positions", async () => {
    const project = await storage.createProject(newProject);

    const chapters = await Promise.all(
      ["a", "b", "c", "d"].map((title) => storage.createChapter(project.id, title)),
    );

    expect(chapters.map((c) => c.position).sort()).toEqual([0, 1, 2, 3]);
  });

  it("keeps positions separate between projects", async () => {
    const a = await storage.createProject(newProject);
    const b = await storage.createProject(newProject);
    await storage.createChapter(a.id, "a0");

    await expect(storage.createChapter(b.id, "b0")).resolves.toMatchObject({ position: 0 });
  });

  it("refuses orphans", async () => {
    await expect(storage.createChapter("no-such-project", "x")).rejects.toThrow();
    await expect(storage.createScene("no-such-chapter", "x")).rejects.toThrow();
  });

  it("can't delete a chapter that still has scenes, nor a project with chapters", async () => {
    const project = await storage.createProject(newProject);
    const chapter = await storage.createChapter(project.id, "Uno");
    const scene = await storage.createScene(chapter.id, "A");

    await expect(driver.execute("DELETE FROM chapters WHERE id = ?", [chapter.id])).rejects.toThrow(
      /FOREIGN KEY/i,
    );
    await expect(driver.execute("DELETE FROM projects WHERE id = ?", [project.id])).rejects.toThrow(
      /FOREIGN KEY/i,
    );
    await expect(storage.listScenes(chapter.id)).resolves.toEqual([scene]);
  });

  it("stores text exactly, including quotes and non-ASCII", async () => {
    const title = `—Dijo "ñandú"; DROP TABLE projects; 日本語 🖋️`;
    const project = await storage.createProject({ ...newProject, title });

    expect(project.title).toBe(title);
    await expect(storage.listProjects()).resolves.toMatchObject([{ title }]);
  });

  it("rejects an invalid project as a promise, never by throwing synchronously", async () => {
    let threw = false;
    let promise: Promise<unknown> | undefined;
    try {
      promise = storage.createProject({ ...newProject, title: "" });
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    await expect(promise).rejects.toBeInstanceOf(InvalidInputError);
  });
});
