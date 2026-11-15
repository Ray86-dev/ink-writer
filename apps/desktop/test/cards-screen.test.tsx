// @vitest-environment jsdom
import {
  type AnalysisState,
  type Fact,
  hashText,
  loadOverrides,
  openSqlStorage,
  type Storage,
  saveAiConnection,
} from "@ink-writer/core";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createNodeSqliteDriver } from "../../../packages/core/test/support/node-sqlite-driver";
import { writeParagraphs } from "../../../packages/core/test/support/prose";
import { ProjectScreen } from "../src/project/ProjectScreen";
import type { Shell } from "../src/shell";
import { stubLayout } from "./support/environment";
import { fakeAi, fakeModels } from "./support/fake-ai";
import { fakeResearch } from "./support/fake-research";

const FIRST = [
  "Marta Rey bajó del autobús en Puerto Viejo.",
  "Tenía los ojos verdes.",
  "Tomás, su hermano, la esperaba.",
];
const SECOND = ["Marta tenía los ojos marrones.", "Thomas no dijo nada."];

function currentEditor(): Editor {
  const element = document.querySelector(".prose") as (HTMLElement & { editor?: Editor }) | null;
  if (element?.editor === undefined) {
    throw new Error("No editor on screen yet");
  }
  return element.editor;
}

describe("cards on the project screen", () => {
  let driver: ReturnType<typeof createNodeSqliteDriver>;
  let storage: Storage;
  let projectId: string;
  let one: string;
  let two: string;
  let models: ReturnType<typeof fakeModels>;

  const fact = (id: string, sceneId: string, entityId: string, quote: string): Fact => ({
    id,
    sceneId,
    entityId,
    category: "physical",
    attribute: id,
    value: "v",
    quote,
    sentence: `${quote}.`,
    storyTime: null,
    inDialogue: false,
  });

  /** What an analysis of the two scenes would have left. */
  const analysed = (): AnalysisState => ({
    entities: [
      { id: "marta", type: "person", canonicalName: "Marta Rey", aliases: ["Marta"] },
      { id: "tomas", type: "person", canonicalName: "Tomás", aliases: [] },
      { id: "thomas", type: "person", canonicalName: "Thomas", aliases: [] },
      { id: "puerto", type: "place", canonicalName: "Puerto Viejo", aliases: [] },
    ],
    mentions: [
      { sceneId: one, entityId: "marta", quote: "Marta Rey" },
      { sceneId: one, entityId: "tomas", quote: "Tomás" },
      { sceneId: one, entityId: "puerto", quote: "Puerto Viejo" },
      { sceneId: two, entityId: "marta", quote: "Marta" },
      { sceneId: two, entityId: "thomas", quote: "Thomas" },
    ],
    facts: [
      fact("f1", one, "marta", "Marta Rey bajó del autobús en Puerto Viejo"),
      fact("f2", one, "marta", "Tenía los ojos verdes"),
      fact("f3", one, "tomas", "Tomás, su hermano, la esperaba"),
      fact("f4", two, "marta", "Marta tenía los ojos marrones"),
      fact("f5", two, "thomas", "Thomas no dijo nada"),
    ],
    relations: [
      {
        id: "r1",
        sceneId: one,
        fromEntityId: "tomas",
        toEntityId: "marta",
        label: "hermano de",
        quote: "Tomás, su hermano",
      },
    ],
    issues: [
      {
        kind: "contradiction",
        a: { sceneId: one, quote: "Tenía los ojos verdes" },
        b: { sceneId: two, quote: "Marta tenía los ojos marrones" },
        reason: "Los ojos cambian de color.",
      },
    ],
    sceneOrder: [one, two],
  });

  async function write(sceneId: string, paragraphs: readonly string[]) {
    const doc = new Y.Doc();
    writeParagraphs(doc, paragraphs);
    await storage.appendSceneUpdate(sceneId, Y.encodeStateAsUpdate(doc));
    doc.destroy();
  }

  const show = (mode: "write" | "live" | "read" = "write") => {
    localStorage.setItem("editor-mode", mode);
    const shell: Shell = {
      driver: {} as Shell["driver"],
      ai: fakeAi().ai,
      ...fakeResearch().shell,
      exportFile: vi.fn(async () => true),
      onCloseRequested: () => () => {},
      forceClose: vi.fn(),
    };
    return render(
      <ProjectScreen
        storage={storage}
        project={{ id: projectId, title: "La veda", language: "es", era: "x" }}
        shell={shell}
        onBack={() => {}}
        sessionOptions={{ autoSnapshotMs: 0 }}
        analysisOptions={{ createProvider: models.createProvider, pauseMs: 10, retryMs: 60_000 }}
      />,
    );
  };

  const openCards = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Fichas" }));
    return within(await screen.findByRole("region", { name: "Fichas" }));
  };
  const tab = (cards: ReturnType<typeof within>, name: string) =>
    fireEvent.click(cards.getByRole("button", { name: new RegExp(`^${name} \\d+$`) }));
  const card = async (cards: ReturnType<typeof within>, name: string) => {
    const index = within(cards.getByRole("navigation", { name: "Índice de fichas" }));
    fireEvent.click(await index.findByRole("button", { name }));
    return within(await cards.findByRole("article", { name }));
  };
  const passages = (article: ReturnType<typeof within>) =>
    within(article.getByRole("region", { name: "Lo que has escrito" }))
      .getAllByRole("button", { name: /·/ })
      .map((button) => button.querySelector("q")?.textContent);
  const kinds = async () =>
    (await loadOverrides(storage, projectId)).map((item) => item.override.kind);

  beforeEach(async () => {
    stubLayout();
    localStorage.clear();
    driver = createNodeSqliteDriver();
    ({ storage } = await openSqlStorage(driver));
    projectId = (await storage.createProject({ title: "La veda", language: "es", era: "x" })).id;
    const chapter = await storage.createChapter(projectId, "Capítulo 1");
    one = (await storage.createScene(chapter.id, "Escena 1")).id;
    two = (await storage.createScene(chapter.id, "Escena 2")).id;
    await write(one, FIRST);
    await write(two, SECOND);
    const state = analysed();
    await storage.saveSceneAnalysis(projectId, one, await hashText(FIRST.join("\n")), state);
    await storage.saveSceneAnalysis(projectId, two, await hashText(SECOND.join("\n")), state);
    models = fakeModels();
  });

  afterEach(() => {
    cleanup();
    driver.close();
  });

  it("says how cards come to be when there are none yet", async () => {
    const empty = (await storage.createProject({ title: "Otra", language: "es", era: "x" })).id;
    projectId = empty;
    await storage.createScene((await storage.createChapter(empty, "C")).id, "E");
    show();

    const cards = await openCards();

    expect(cards.getByText(/Aún no hay fichas\./)).toBeTruthy();
  });

  it("shows a character's card: names, passages in order, relations and what's open", async () => {
    show();
    const cards = await openCards();
    const marta = await card(cards, "Marta Rey");

    expect(marta.getByText("También: Marta")).toBeTruthy();
    expect(passages(marta)).toEqual([
      "Marta Rey bajó del autobús en Puerto Viejo.",
      "Tenía los ojos verdes.",
      "Marta tenía los ojos marrones.",
    ]);
    const relations = within(marta.getByRole("region", { name: "Relaciones" }));
    expect(relations.getByText(/hermano de, según:/)).toBeTruthy();
    const open = within(marta.getByRole("region", { name: "Por resolver" }));
    expect(open.getByText("Los ojos cambian de color.")).toBeTruthy();
    expect(
      within(marta.getByRole("region", { name: "Enlazan aquí" })).getByText("Tomás"),
    ).toBeTruthy();
  });

  it("goes from one card to another and back through their links", async () => {
    show();
    const cards = await openCards();
    const marta = await card(cards, "Marta Rey");

    fireEvent.click(
      within(marta.getByRole("region", { name: "Relaciones" })).getByRole("button", {
        name: "Tomás",
      }),
    );
    const tomas = within(await cards.findByRole("article", { name: "Tomás" }));

    fireEvent.click(
      within(tomas.getByRole("region", { name: "Relaciones" })).getByRole("button", {
        name: "Marta Rey",
      }),
    );
    await cards.findByRole("article", { name: "Marta Rey" });
  });

  it("has places, relationships, chapters and the index of names", async () => {
    show();
    const cards = await openCards();

    tab(cards, "Lugares");
    await cards.findByRole("article", { name: "Puerto Viejo" });

    tab(cards, "Relaciones");
    const relation = within(await cards.findByRole("article", { name: "Marta Rey · Tomás" }));
    expect(relation.getByText("Tomás: hermano de → Marta Rey")).toBeTruthy();

    tab(cards, "Capítulos");
    const chapter = within(await cards.findByRole("article", { name: "Capítulo 1" }));
    expect(
      within(chapter.getByRole("region", { name: "Quién aparece" }))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Marta Rey", "Thomas", "Tomás"]);
    expect(
      within(chapter.getByRole("region", { name: "Dónde" })).getByText("Puerto Viejo"),
    ).toBeTruthy();

    tab(cards, "Nombres");
    const names = within(await cards.findByRole("article", { name: "Nombres" }));
    expect(names.getAllByRole("rowheader").map((cell) => cell.firstChild?.textContent)).toEqual([
      "Marta",
      "Marta Rey",
      "Puerto Viejo",
      "Thomas",
      "Tomás",
    ]);
    expect(names.getByText("Se parece a «Thomas».")).toBeTruthy();
  });

  it("goes from a passage to that very text in the editor, without changing it", async () => {
    show();
    const cards = await openCards();
    const marta = await card(cards, "Marta Rey");

    fireEvent.click(marta.getByRole("button", { name: /Marta tenía los ojos marrones\./ }));

    await waitFor(() => {
      const { state } = currentEditor();
      expect(state.doc.textBetween(state.selection.from, state.selection.to)).toBe(
        "Marta tenía los ojos marrones",
      );
    });
    expect(screen.queryByRole("region", { name: "Fichas" })).toBeNull();
    expect(currentEditor().getText({ blockSeparator: "\n" })).toBe(SECOND.join("\n"));
  });

  describe("deleting a paragraph removes its data (M4's first exit condition)", () => {
    it("at once, with no model asked", async () => {
      show();
      const editor = await waitFor(currentEditor);
      await waitFor(() => expect(editor.state.doc.childCount).toBe(3));

      // The author deletes the second paragraph: "Tenía los ojos verdes."
      const second = editor.state.doc.child(1);
      const start = editor.state.doc.child(0).nodeSize;
      editor.commands.deleteRange({ from: start, to: start + second.nodeSize });
      expect(editor.getText({ blockSeparator: "\n" })).toBe(`${FIRST[0]}\n${FIRST[2]}`);

      const cards = await openCards();
      const marta = await card(cards, "Marta Rey");

      expect(passages(marta)).toEqual([
        "Marta Rey bajó del autobús en Puerto Viejo.",
        "Marta tenía los ojos marrones.",
      ]);
      // The contradiction cited the deleted passage, so it's closed.
      expect(marta.queryByRole("region", { name: "Por resolver" })).toBeNull();
      expect(models.state.asked).toEqual([]);
    });

    it("and the card itself goes when nothing supports it any more", async () => {
      show();
      const editor = await waitFor(currentEditor);
      await waitFor(() => expect(editor.state.doc.childCount).toBe(3));
      const start = editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize;
      editor.commands.deleteRange({ from: start, to: editor.state.doc.content.size });

      const cards = await openCards();
      const index = within(cards.getByRole("navigation", { name: "Índice de fichas" }));

      await index.findByRole("button", { name: "Marta Rey" });
      expect(index.queryByRole("button", { name: "Tomás" })).toBeNull();
      const marta = await card(cards, "Marta Rey");
      expect(marta.queryByRole("region", { name: "Relaciones" })).toBeNull();
    });

    it("and the analysis that follows leaves it gone", async () => {
      await saveAiConnection(storage, { route: "ollama", model: "gemma4:latest" });
      show();
      const editor = await waitFor(currentEditor);
      await waitFor(() => expect(editor.state.doc.childCount).toBe(3));
      const start = editor.state.doc.child(0).nodeSize;
      editor.commands.deleteRange({ from: start, to: editor.state.doc.content.size });

      await waitFor(async () => {
        const stored = await storage.loadAnalysis(projectId);
        expect(
          stored.facts.filter((item) => item.sceneId === one).map((item) => item.quote),
        ).toEqual(["Marta Rey bajó del autobús en Puerto Viejo"]);
      });
    });
  });

  describe("the author's corrections survive reanalysis (M4's second exit condition)", () => {
    it("a note, a merge and a dismissed passage are still there after the scene is read again", async () => {
      await saveAiConnection(storage, { route: "ollama", model: "gemma4:latest" });
      show();
      // Nothing waits to be read: the stored analysis is of the text as it stands.
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /^IA: / }).textContent).toBe("IA: al día"),
      );

      let cards = await openCards();
      let tomas = await card(cards, "Tomás");
      fireEvent.change(tomas.getByLabelText("Mi nota"), { target: { value: "Es zurdo." } });
      fireEvent.click(tomas.getByRole("button", { name: "Guardar nota" }));
      await waitFor(async () => expect(await kinds()).toEqual(["note"]));

      // The card is drawn again with its note, so it's looked up again.
      tomas = await card(cards, "Tomás");

      fireEvent.change(tomas.getByLabelText("Es lo mismo que"), { target: { value: "thomas" } });
      fireEvent.click(tomas.getByRole("button", { name: "Fusionar" }));
      await waitFor(async () => expect(await kinds()).toEqual(["note", "merge"]));

      const marta = await card(cards, "Marta Rey");
      fireEvent.click(
        marta.getByRole("button", { name: "Quitar de la ficha: Tenía los ojos verdes" }),
      );
      await waitFor(async () => expect(await kinds()).toEqual(["note", "merge", "dismiss"]));

      // The author goes back to the text and writes: the scene is analysed again.
      fireEvent.click(cards.getByRole("button", { name: "Volver al texto" }));
      const asked = models.state.asked.length;
      (await waitFor(currentEditor)).commands.insertContentAt(1, "Y ");
      await waitFor(() => expect(models.state.asked.length).toBeGreaterThan(asked));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /^IA: / }).textContent).toBe("IA: al día"),
      );
      // The other scene is read again too, and its data comes back under new ids.
      const again = analysed();
      await storage.saveSceneAnalysis(projectId, two, await hashText(SECOND.join("\n")), {
        ...again,
        facts: again.facts.map((item) => ({ ...item, id: `again-${item.id}` })),
      });

      await expect(kinds()).resolves.toEqual(["note", "merge", "dismiss"]);
      cards = await openCards();
      tomas = await card(cards, "Tomás");
      expect((tomas.getByLabelText("Mi nota") as HTMLTextAreaElement).value).toBe("Es zurdo.");
      expect(tomas.getByText("También: Thomas")).toBeTruthy();
      expect(passages(tomas)).toContain("Thomas no dijo nada.");
      const index = within(cards.getByRole("navigation", { name: "Índice de fichas" }));
      expect(index.queryByRole("button", { name: "Thomas" })).toBeNull();
    });
  });

  describe("what the author can correct", () => {
    it("merges two cards from the index of names, and undoes it", async () => {
      show();
      const cards = await openCards();
      tab(cards, "Nombres");
      const names = within(await cards.findByRole("article", { name: "Nombres" }));

      fireEvent.click(names.getByRole("button", { name: "Fusionar Thomas con Tomás" }));

      await waitFor(() => expect(names.queryByText("Thomas")?.closest("th")).toBeTruthy());
      await waitFor(() =>
        expect(names.queryByRole("button", { name: /Fusionar Thomas/ })).toBeNull(),
      );
      tab(cards, "Personajes");
      const tomas = await card(cards, "Tomás");
      expect(tomas.getByText("Fusionada con «Thomas».")).toBeTruthy();

      fireEvent.click(tomas.getByRole("button", { name: "Deshacer la fusión con Thomas" }));

      const index = within(cards.getByRole("navigation", { name: "Índice de fichas" }));
      await index.findByRole("button", { name: "Thomas" });
      await expect(kinds()).resolves.toEqual([]);
    });

    it("splits a name into a card of its own", async () => {
      show();
      const cards = await openCards();
      const marta = await card(cards, "Marta Rey");

      fireEvent.click(marta.getByRole("button", { name: "Separar «Marta» en su propia ficha" }));

      const split = await card(cards, "Marta");
      expect(passages(split)).toEqual(["Marta tenía los ojos marrones."]);
      expect(split.getByText("Separaste esta ficha de otra.")).toBeTruthy();
      expect(passages(await card(cards, "Marta Rey"))).toEqual([
        "Marta Rey bajó del autobús en Puerto Viejo.",
        "Tenía los ojos verdes.",
      ]);
    });

    it("renames a card and changes what kind of thing it is", async () => {
      show();
      const cards = await openCards();
      const puerto = await (async () => {
        tab(cards, "Lugares");
        return card(cards, "Puerto Viejo");
      })();

      fireEvent.change(puerto.getByLabelText("Nombre"), { target: { value: "Puerto Nuevo" } });
      fireEvent.click(puerto.getByRole("button", { name: "Cambiar nombre" }));
      const renamed = within(await cards.findByRole("article", { name: "Puerto Nuevo" }));
      expect(renamed.getByText("También: Puerto Viejo")).toBeTruthy();

      fireEvent.change(renamed.getByLabelText("Tipo"), { target: { value: "lore" } });

      await waitFor(() =>
        expect(cards.getByRole("button", { name: /^Lore \d+$/ }).textContent).toBe("Lore 1"),
      );
      expect(cards.getByRole("button", { name: /^Lugares \d+$/ }).textContent).toBe("Lugares 0");
    });

    it("removes a card that isn't right", async () => {
      show();
      const cards = await openCards();
      const thomas = await card(cards, "Thomas");

      fireEvent.click(thomas.getByRole("button", { name: "Esta ficha no es correcta: quitarla" }));

      const index = within(cards.getByRole("navigation", { name: "Índice de fichas" }));
      await waitFor(() => expect(index.queryByRole("button", { name: "Thomas" })).toBeNull());
    });
  });

  describe("links in the text, with no AI", () => {
    const linked = () =>
      [...document.querySelectorAll(".prose .name-link")].map((link) => link.textContent);

    it("the plain writing mode underlines nothing", async () => {
      show("write");
      await waitFor(() => expect(currentEditor().state.doc.childCount).toBe(3));
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(linked()).toEqual([]);
    });

    it("writing with links underlines known names, also in what's typed now", async () => {
      show("live");
      await waitFor(() => expect(linked()).toEqual(["Marta Rey", "Puerto Viejo", "Tomás"]));

      const editor = currentEditor();
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, " Thomas y Martaza.");

      await waitFor(() =>
        expect(linked()).toEqual(["Marta Rey", "Puerto Viejo", "Tomás", "Thomas"]),
      );
      expect(models.state.asked).toEqual([]);
      // Only decoration: the text itself has nothing added to it (rule 1).
      expect(editor.getText({ blockSeparator: "\n" })).toBe(
        `${FIRST.join("\n")} Thomas y Martaza.`,
      );
    });

    it("keeps the links right through splitting, joining and deleting paragraphs", async () => {
      show("live");
      await waitFor(() => expect(linked()).toEqual(["Marta Rey", "Puerto Viejo", "Tomás"]));
      const editor = currentEditor();
      /** Every link must sit exactly on its name, wherever the text has moved to. */
      const expectLinks = (names: string[]) => {
        expect(linked()).toEqual(names);
        for (const link of document.querySelectorAll(".prose .name-link")) {
          const card = link.getAttribute("data-entity");
          expect([link.textContent, card]).toEqual(
            link.textContent === "Marta Rey" || link.textContent === "Marta"
              ? [link.textContent, "marta"]
              : link.textContent === "Puerto Viejo"
                ? ["Puerto Viejo", "puerto"]
                : [link.textContent, link.textContent === "Tomás" ? "tomas" : "thomas"],
          );
        }
      };

      // A name cut in two by a new paragraph is no longer a name.
      editor.commands.setTextSelection(7);
      editor.commands.splitBlock();
      expectLinks(["Marta", "Puerto Viejo", "Tomás"]);

      // Joined back, it's whole again.
      editor.commands.joinBackward();
      expectLinks(["Marta Rey", "Puerto Viejo", "Tomás"]);

      // A paragraph typed before the others pushes them along.
      editor.commands.insertContentAt(0, {
        type: "paragraph",
        content: [{ type: "text", text: "Thomas llegó." }],
      });
      expectLinks(["Thomas", "Marta Rey", "Puerto Viejo", "Tomás"]);

      // And deleting the first two leaves only what the rest says.
      const first = editor.state.doc.child(0).nodeSize;
      const second = editor.state.doc.child(1).nodeSize;
      editor.commands.deleteRange({ from: 0, to: first + second });
      expectLinks(["Tomás"]);

      // Undoing brings text back in one piece, however many steps it takes back at once: whatever
      // the text says then is what's linked.
      editor.commands.undo();
      const names = /Marta Rey|Marta|Puerto Viejo|Tomás|Thomas/g;
      expectLinks(editor.getText({ blockSeparator: "\n" }).match(names) ?? []);
      expect(linked().length).toBeGreaterThan(1);
    });

    it("while writing, a plain click stays in the text and Ctrl or Cmd with it opens the card", async () => {
      show("live");
      const link = await waitFor(() => {
        const found = document.querySelector('.name-link[data-entity="tomas"]');
        expect(found).not.toBeNull();
        return found as Element;
      });

      fireEvent.click(link);
      expect(screen.queryByRole("region", { name: "Fichas" })).toBeNull();

      fireEvent.click(link, { ctrlKey: true });
      const cards = within(await screen.findByRole("region", { name: "Fichas" }));
      await cards.findByRole("article", { name: "Tomás" });
    });

    it("in the reading mode a click is enough, and the panel lists the scene's cards", async () => {
      show("read");
      const panel = within(await screen.findByRole("complementary", { name: "Enlaces y pistas" }));
      await waitFor(() =>
        expect(panel.getAllByRole("button").map((button) => button.textContent)).toEqual([
          "Marta Rey",
          "Puerto Viejo",
          "Tomás",
        ]),
      );

      fireEvent.click(
        await waitFor(() => {
          const link = document.querySelector('.name-link[data-entity="marta"]');
          expect(link).not.toBeNull();
          return link as Element;
        }),
      );
      const cards = within(await screen.findByRole("region", { name: "Fichas" }));
      await cards.findByRole("article", { name: "Marta Rey" });

      fireEvent.click(cards.getByRole("button", { name: "Volver al texto" }));
      fireEvent.click(await panel.findByRole("button", { name: "Puerto Viejo" }));
      await within(await screen.findByRole("region", { name: "Fichas" })).findByRole("article", {
        name: "Puerto Viejo",
      });
    });
  });
});
