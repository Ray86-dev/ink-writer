import { strFromU8, unzipSync } from "fflate";
import mammoth from "mammoth";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildManuscript,
  type Manuscript,
  openSqlStorage,
  type Paragraph,
  SceneSession,
  type Storage,
  toDocx,
  toMarkdown,
} from "../src/index";
import { createNodeSqliteDriver } from "./support/node-sqlite-driver";
import { writeParagraphs } from "./support/prose";

const plain = (text: string): Paragraph => ({
  inlines: [{ kind: "text", text, bold: false, italic: false }],
});

const styled = (text: string, bold: boolean, italic: boolean): Paragraph => ({
  inlines: [{ kind: "text", text, bold, italic }],
});

const book = (scenes: readonly (readonly Paragraph[])[]): Manuscript => ({
  title: "La veda",
  language: "es",
  chapters: [{ title: "Uno", scenes }],
});

describe("toMarkdown", () => {
  it("gives title, chapters, paragraphs and scene breaks", () => {
    const text = toMarkdown({
      title: "La veda",
      language: "es",
      chapters: [
        {
          title: "Uno",
          scenes: [[plain("Primer párrafo."), plain("Segundo.")], [plain("Otra escena.")]],
        },
        { title: "Dos", scenes: [[plain("Fin.")]] },
      ],
    });

    expect(text).toBe(
      "# La veda\n\n## Uno\n\nPrimer párrafo.\n\nSegundo.\n\n* * *\n\nOtra escena.\n\n## Dos\n\nFin.\n",
    );
  });

  it("marks styles", () => {
    const text = toMarkdown(
      book([
        [
          styled("negrita", true, false),
          styled("cursiva", false, true),
          styled("ambas", true, true),
        ],
      ]),
    );

    expect(text).toContain("**negrita**");
    expect(text).toContain("\n*cursiva*\n");
    expect(text).toContain("***ambas***");
  });

  it("keeps spaces outside the style markers, or they wouldn't be valid", () => {
    const paragraph: Paragraph = {
      inlines: [
        { kind: "text", text: "dijo", bold: false, italic: false },
        { kind: "text", text: " claro ", bold: false, italic: true },
        { kind: "text", text: "que sí", bold: false, italic: false },
      ],
    };

    expect(toMarkdown(book([[paragraph]]))).toContain("dijo *claro* que sí");
  });

  it("writes a line break inside a paragraph", () => {
    const paragraph: Paragraph = {
      inlines: [
        { kind: "text", text: "uno", bold: false, italic: false },
        { kind: "break" },
        { kind: "text", text: "dos", bold: false, italic: false },
      ],
    };

    expect(toMarkdown(book([[paragraph]]))).toContain("uno\\\ndos");
  });

  it.each([
    ["a *b* c", "a \\*b\\* c"],
    ["_x_", "\\_x\\_"],
    ["[enlace](u)", "\\[enlace\\](u)"],
    ["<b>", "\\<b\\>"],
    ["`c`", "\\`c\\`"],
    ["# no es título", "\\# no es título"],
    ["> no es cita", "\\> no es cita"],
    ["- no es lista", "\\- no es lista"],
    ["1. no es lista", "1\\. no es lista"],
  ])("escapes %j so the author's text stays as typed", (input, expected) => {
    expect(toMarkdown(book([[plain(input)]]))).toContain(`\n${expected}\n`);
  });

  it("leaves dialogue dashes and accents alone", () => {
    expect(toMarkdown(book([[plain("—¿Qué ocurrió? —preguntó Tomás.")]]))).toContain(
      "\n—¿Qué ocurrió? —preguntó Tomás.\n",
    );
  });

  it("carries no mark of the tool or of AI (rule 11)", () => {
    const text = toMarkdown(book([[plain("Texto.")]]));

    expect(text).not.toMatch(/ink writer|tiptap|generated|\bAI\b|\bIA\b/i);
    expect(text.startsWith("---")).toBe(false);
  });
});

describe("toDocx", () => {
  const parts = (bytes: Uint8Array) => unzipSync(bytes);
  const documentOf = (bytes: Uint8Array) =>
    strFromU8(parts(bytes)["word/document.xml"] as Uint8Array);

  it("has exactly the parts a document needs", () => {
    expect(Object.keys(parts(toDocx(book([[plain("x")]])))).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "word/_rels/document.xml.rels",
      "word/document.xml",
      "word/styles.xml",
    ]);
  });

  it("is read correctly by an independent reader", async () => {
    const bytes = toDocx({
      title: "La veda",
      language: "es",
      chapters: [
        {
          title: "Uno",
          scenes: [
            [plain("—¿Qué ocurrió? —preguntó."), plain("Y se fue.")],
            [plain("Otra escena.")],
          ],
        },
      ],
    });

    const { value, messages } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });

    expect(messages.filter((m) => m.type === "error")).toEqual([]);
    expect(value).toContain("La veda");
    expect(value).toContain("Uno");
    expect(value).toContain("—¿Qué ocurrió? —preguntó.");
    expect(value).toContain("Y se fue.");
    expect(value).toContain("* * *");
    expect(value).toContain("Otra escena.");
  });

  it("gives chapters their heading style and keeps bold and italic", async () => {
    const bytes = toDocx(book([[styled("negrita", true, false), styled("cursiva", false, true)]]));

    const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });

    expect(html).toContain("<h1>Uno</h1>");
    expect(html).toContain("<strong>negrita</strong>");
    expect(html).toContain("<em>cursiva</em>");
  });

  it("escapes characters that are special in XML", async () => {
    const bytes = toDocx(book([[plain(`Tom & "Jerry" <gato> 'x'`)]]));

    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });

    expect(value).toContain(`Tom & "Jerry" <gato> 'x'`);
  });

  it("drops only the characters XML can't hold, keeping everything around them", async () => {
    const bytes = toDocx(book([[plain("antes\u0001\u000Bdespués 🖋️ fin")]]));

    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });

    expect(value).toContain("antesdespués 🖋️ fin");
  });

  it("preserves spaces at the edges of a run", () => {
    const xml = documentOf(toDocx(book([[plain("  con espacios  ")]])));

    expect(xml).toContain('xml:space="preserve">  con espacios  <');
  });

  it("carries no mark of the tool or of AI, and no metadata (rule 11)", () => {
    const zip = parts(toDocx(book([[plain("Texto.")]])));

    expect(Object.keys(zip).some((name) => name.startsWith("docProps"))).toBe(false);
    for (const [name, data] of Object.entries(zip)) {
      const content = strFromU8(data);
      expect(content, name).not.toMatch(
        /ink.?writer|tiptap|fflate|generator|application>|creator/i,
      );
    }
  });

  it("leaks no date: the same book gives the same bytes, whenever it's exported", async () => {
    const make = () => toDocx(book([[plain("Texto.")]]));
    const first = make();
    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(make()).toEqual(first);
  });

  it("handles a chapter with no scenes", async () => {
    const bytes = toDocx(book([]));

    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    expect(value).toContain("Uno");
  });
});

describe("buildManuscript", () => {
  let storage: Storage;
  let projectId: string;

  const write = async (sceneId: string, paragraphs: string[]) => {
    const session = await SceneSession.open(storage, sceneId, { autoSnapshotMs: 0 });
    writeParagraphs(session.doc, paragraphs);
    await session.close();
  };

  beforeEach(async () => {
    ({ storage } = await openSqlStorage(createNodeSqliteDriver()));
    projectId = (
      await storage.createProject({ title: "La veda", language: "es", era: "actualidad" })
    ).id;
  });

  const texts = (manuscript: Manuscript) =>
    manuscript.chapters.map((chapter) => ({
      title: chapter.title,
      scenes: chapter.scenes.map((scene) =>
        scene.map((p) => p.inlines.map((i) => (i.kind === "text" ? i.text : "")).join("")),
      ),
    }));

  it("reads the book in order from what's saved", async () => {
    const c1 = await storage.createChapter(projectId, "Uno");
    const c2 = await storage.createChapter(projectId, "Dos");
    const s1 = await storage.createScene(c1.id, "título interno");
    const s2 = await storage.createScene(c1.id, "otro");
    const s3 = await storage.createScene(c2.id, "más");
    await write(s1.id, ["A1", "A2"]);
    await write(s2.id, ["B"]);
    await write(s3.id, ["C"]);

    const manuscript = await buildManuscript(storage, projectId);

    expect(manuscript).toMatchObject({ title: "La veda", language: "es" });
    expect(texts(manuscript)).toEqual([
      { title: "Uno", scenes: [["A1", "A2"], ["B"]] },
      { title: "Dos", scenes: [["C"]] },
    ]);
  });

  it("reads updates not yet compacted, as after a forced close", async () => {
    const chapter = await storage.createChapter(projectId, "Uno");
    const scene = await storage.createScene(chapter.id, "S");
    const session = await SceneSession.open(storage, scene.id, { autoSnapshotMs: 0 });
    writeParagraphs(session.doc, ["sin compactar"]);
    await session.flush();

    expect(texts(await buildManuscript(storage, projectId))[0]?.scenes).toEqual([
      ["sin compactar"],
    ]);
  });

  it("leaves out the trash, empty scenes, and scene titles", async () => {
    const kept = await storage.createChapter(projectId, "Uno");
    const trashedChapter = await storage.createChapter(projectId, "Tirado");
    const scene = await storage.createScene(kept.id, "TÍTULO INTERNO");
    await storage.createScene(kept.id, "vacía");
    const trashedScene = await storage.createScene(kept.id, "tirada");
    const inTrashedChapter = await storage.createScene(trashedChapter.id, "x");
    await write(scene.id, ["visible"]);
    await write(trashedScene.id, ["oculta"]);
    await write(inTrashedChapter.id, ["oculta también"]);
    await storage.trashScene(trashedScene.id);
    await storage.trashChapter(trashedChapter.id);

    const manuscript = await buildManuscript(storage, projectId);

    expect(texts(manuscript)).toEqual([{ title: "Uno", scenes: [["visible"]] }]);
    expect(toMarkdown(manuscript)).not.toContain("TÍTULO INTERNO");
  });

  it("refuses a project that doesn't exist", async () => {
    await expect(buildManuscript(storage, "none")).rejects.toThrow(/none/);
  });
});
