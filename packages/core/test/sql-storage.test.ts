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

describe("SQL storage: structure", () => {
  let driver: ReturnType<typeof createNodeSqliteDriver>;
  let storage: Storage;
  let projectId: string;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    ({ storage } = await openSqlStorage(driver));
    projectId = (await storage.createProject(newProject)).id;
  });

  afterEach(() => driver.close());

  const chapterTitles = async () =>
    (await storage.listChapters(projectId)).map((chapter) => chapter.title);

  it("finds a project by ID, or gives null", async () => {
    await expect(storage.getProject(projectId)).resolves.toMatchObject(newProject);
    await expect(storage.getProject("none")).resolves.toBeNull();
  });

  it("renames chapters and scenes, refusing an empty title", async () => {
    const chapter = await storage.createChapter(projectId, "Viejo");
    const scene = await storage.createScene(chapter.id, "Vieja");

    await storage.renameChapter(chapter.id, "  Nuevo ");
    await storage.renameScene(scene.id, "Nueva");

    expect(await chapterTitles()).toEqual(["Nuevo"]);
    await expect(storage.listScenes(chapter.id)).resolves.toMatchObject([{ title: "Nueva" }]);
    await expect(storage.renameChapter(chapter.id, " ")).rejects.toBeInstanceOf(InvalidInputError);
    await expect(storage.renameScene(scene.id, "")).rejects.toBeInstanceOf(InvalidInputError);
  });

  it("moves chapters up and down, and does nothing at the ends", async () => {
    const a = await storage.createChapter(projectId, "A");
    await storage.createChapter(projectId, "B");
    const c = await storage.createChapter(projectId, "C");

    await storage.moveChapter(c.id, "up");
    expect(await chapterTitles()).toEqual(["A", "C", "B"]);

    await storage.moveChapter(a.id, "down");
    expect(await chapterTitles()).toEqual(["C", "A", "B"]);

    await storage.moveChapter(c.id, "up");
    await storage.moveChapter((await storage.listChapters(projectId))[2]?.id ?? "", "down");
    expect(await chapterTitles()).toEqual(["C", "A", "B"]);
  });

  it("moves scenes inside their chapter only", async () => {
    const one = await storage.createChapter(projectId, "1");
    const two = await storage.createChapter(projectId, "2");
    const a = await storage.createScene(one.id, "a");
    const b = await storage.createScene(one.id, "b");
    const other = await storage.createScene(two.id, "other");

    await storage.moveScene(a.id, "down");
    await storage.moveScene(other.id, "up");

    expect((await storage.listScenes(one.id)).map((s) => s.id)).toEqual([b.id, a.id]);
    expect((await storage.listScenes(two.id)).map((s) => s.id)).toEqual([other.id]);
  });

  it("moves past items in the trash as if they weren't there", async () => {
    await storage.createChapter(projectId, "A");
    const b = await storage.createChapter(projectId, "B");
    const c = await storage.createChapter(projectId, "C");
    await storage.trashChapter(b.id);

    await storage.moveChapter(c.id, "up");

    expect(await chapterTitles()).toEqual(["C", "A"]);
  });

  it("ignores moving something that doesn't exist", async () => {
    await expect(storage.moveChapter("none", "up")).resolves.toBeUndefined();
    await expect(storage.moveScene("none", "down")).resolves.toBeUndefined();
  });

  it("moves to the trash without destroying, and restores in place", async () => {
    const chapter = await storage.createChapter(projectId, "C");
    const a = await storage.createScene(chapter.id, "a");
    const b = await storage.createScene(chapter.id, "b");

    await storage.trashScene(a.id);
    expect((await storage.listScenes(chapter.id)).map((s) => s.title)).toEqual(["b"]);
    await expect(storage.listTrash(projectId)).resolves.toMatchObject({
      chapters: [],
      scenes: [{ id: a.id, title: "a" }],
    });

    await storage.restoreScene(a.id);
    expect((await storage.listScenes(chapter.id)).map((s) => s.id)).toEqual([a.id, b.id]);
    await expect(storage.listTrash(projectId)).resolves.toEqual({ chapters: [], scenes: [] });
  });

  it("does the same for chapters, whose scenes come back with them", async () => {
    const chapter = await storage.createChapter(projectId, "C");
    const scene = await storage.createScene(chapter.id, "a");

    await storage.trashChapter(chapter.id);
    expect(await chapterTitles()).toEqual([]);
    expect((await storage.listTrash(projectId)).chapters).toMatchObject([{ title: "C" }]);

    await storage.restoreChapter(chapter.id);
    expect(await chapterTitles()).toEqual(["C"]);
    await expect(storage.listScenes(chapter.id)).resolves.toMatchObject([{ id: scene.id }]);
  });

  it("shows each project only its own trash", async () => {
    const other = await storage.createProject(newProject);
    const chapter = await storage.createChapter(projectId, "C");
    await storage.trashChapter(chapter.id);

    await expect(storage.listTrash(other.id)).resolves.toEqual({ chapters: [], scenes: [] });
  });

  it("never loads prose when listing scenes", async () => {
    const chapter = await storage.createChapter(projectId, "C");
    const scene = await storage.createScene(chapter.id, "S");
    await storage.appendSceneUpdate(scene.id, new Uint8Array([1, 2, 3]));

    const [listed] = await storage.listScenes(chapter.id);

    expect(listed).not.toHaveProperty("ydoc");
  });

  it("refuses prose for a scene that doesn't exist", async () => {
    await expect(storage.appendSceneUpdate("none", new Uint8Array([1]))).rejects.toThrow(
      /FOREIGN KEY/i,
    );
  });
});
