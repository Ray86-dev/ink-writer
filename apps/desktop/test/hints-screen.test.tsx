// @vitest-environment jsdom
import {
  type AnalysisState,
  DEFAULT_HINT_SETTINGS,
  type HintSettings,
  hashText,
  loadHintSettings,
  loadHintStates,
  openSqlStorage,
  type Storage,
  saveHintSettings,
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

const FIRST = ["Marta tenía los ojos verdes.", "Haber si viene Inés."];
const SECOND = ["Marta tenía los ojos marrones.", "Inés llamó."];

function currentEditor(): Editor {
  const element = document.querySelector(".prose") as (HTMLElement & { editor?: Editor }) | null;
  if (element?.editor === undefined) {
    throw new Error("No editor on screen yet");
  }
  return element.editor;
}

describe("hints on the project screen", () => {
  let driver: ReturnType<typeof createNodeSqliteDriver>;
  let storage: Storage;
  let projectId: string;
  let one: string;
  let two: string;
  let models: ReturnType<typeof fakeModels>;

  const analysed = (): AnalysisState => ({
    entities: [
      { id: "marta", type: "person", canonicalName: "Marta", aliases: [] },
      { id: "ines", type: "person", canonicalName: "Inés", aliases: [] },
    ],
    mentions: [
      { sceneId: one, entityId: "marta", quote: "Marta" },
      { sceneId: two, entityId: "marta", quote: "Marta" },
      { sceneId: one, entityId: "ines", quote: "Inés" },
      { sceneId: two, entityId: "ines", quote: "Inés" },
    ],
    facts: [
      {
        id: "f1",
        sceneId: one,
        entityId: "marta",
        category: "physical",
        attribute: "eyes",
        value: "verdes",
        quote: "los ojos verdes",
        sentence: "Marta tenía los ojos verdes.",
        storyTime: null,
        inDialogue: false,
      },
      {
        id: "f2",
        sceneId: two,
        entityId: "marta",
        category: "physical",
        attribute: "eyes",
        value: "marrones",
        quote: "los ojos marrones",
        sentence: "Marta tenía los ojos marrones.",
        storyTime: null,
        inDialogue: false,
      },
    ],
    relations: [],
    issues: [
      {
        kind: "contradiction",
        a: { sceneId: one, quote: "los ojos verdes" },
        b: { sceneId: two, quote: "los ojos marrones" },
        reason: "Los ojos de Marta cambian de color.",
      },
      {
        kind: "correction",
        a: { sceneId: one, quote: "Haber si" },
        fix: "A ver si",
        reason: "Se escribe «a ver».",
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

  const setHints = (changes: Partial<HintSettings>) =>
    saveHintSettings(storage, { ...DEFAULT_HINT_SETTINGS, ...changes });

  const show = (mode: "write" | "live" | "read" = "read") => {
    localStorage.setItem("editor-mode", mode);
    const shell: Shell = {
      driver: {} as Shell["driver"],
      ai: fakeAi().ai,
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

  const hintsButton = () => screen.getByRole("button", { name: /^Pistas/ });
  const openPanel = async () => {
    fireEvent.click(hintsButton());
    return within(await screen.findByRole("complementary", { name: "Pistas" }));
  };
  const marked = () =>
    [...document.querySelectorAll(".prose .hint-mark")].map((mark) => mark.textContent);
  const items = (panel: ReturnType<typeof within>) =>
    panel.queryAllByRole("listitem").filter((item: HTMLElement) => item.classList.contains("hint"));
  const text = () => currentEditor().getText({ blockSeparator: "\n" });
  const ready = () => waitFor(() => expect(currentEditor().state.doc.childCount).toBe(2));

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

  describe("with hints off (M5's exit condition)", () => {
    beforeEach(() => setHints({ level: "off" }));

    it("there's no task, no mark and no hint, in any mode", async () => {
      for (const mode of ["read", "live", "write"] as const) {
        const view = show(mode);
        await ready();
        await new Promise((resolve) => setTimeout(resolve, 40));

        expect(hintsButton().textContent).toBe("Pistas: apagadas");
        expect(marked()).toEqual([]);
        expect(document.querySelector(".companion")).toBeNull();
        const panel = await openPanel();
        expect(panel.queryByRole("region", { name: "Siguiente paso" })).toBeNull();
        expect(panel.queryByRole("region", { name: "Por revisar" })).toBeNull();
        expect(items(panel)).toEqual([]);
        expect(panel.getByText(/Las pistas están apagadas/)).toBeTruthy();
        view.unmount();
      }
      expect(models.state.asked).toEqual([]);
    });

    it("the cards are still there, with what's open in them", async () => {
      show();
      await ready();

      fireEvent.click(screen.getByRole("button", { name: "Fichas" }));
      const cards = within(await screen.findByRole("region", { name: "Fichas" }));
      fireEvent.click(await cards.findByRole("button", { name: "Marta" }));
      const marta = within(await cards.findByRole("article", { name: "Marta" }));

      expect(marta.getByRole("region", { name: "Por resolver" })).toBeTruthy();
    });

    it("turning them on brings everything back at once", async () => {
      show();
      await ready();
      const panel = await openPanel();

      fireEvent.click(panel.getByRole("radio", { name: /^Discretas/ }));

      await waitFor(() => expect(hintsButton().textContent).toBe("Pistas: 2"));
      await waitFor(() => expect(marked()).toEqual(["los ojos verdes", "Haber si"]));
      expect(panel.getByRole("region", { name: "Siguiente paso" })).toBeTruthy();
      await expect(loadHintSettings(storage)).resolves.toMatchObject({ level: "discreet" });
    });
  });

  describe("discreet, the default", () => {
    it("counts the hints and, only when reading, marks their passages", async () => {
      const reading = show("read");
      await waitFor(() => expect(hintsButton().textContent).toBe("Pistas: 2"));
      await waitFor(() => expect(marked()).toEqual(["los ojos verdes", "Haber si"]));
      // Marking is decoration: the text is what it was.
      expect(text()).toBe(FIRST.join("\n"));
      reading.unmount();

      for (const mode of ["write", "live"] as const) {
        const writing = show(mode);
        await ready();
        await waitFor(() => expect(hintsButton().textContent).toBe("Pistas: 2"));
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(marked()).toEqual([]);
        writing.unmount();
      }
    });

    it("gives a hint little by little, and remembers how far it went", async () => {
      const first = show();
      let panel = await openPanel();
      await waitFor(() => expect(items(panel)).toHaveLength(2));
      let hint = within(items(panel)[1] as HTMLElement);

      expect(hint.getByText("Algo no encaja aquí.")).toBeTruthy();
      expect(hint.queryByText(/ojos/)).toBeNull();

      fireEvent.click(hint.getByRole("button", { name: "Dame otra pista" }));
      await waitFor(() => {
        hint = within(items(panel)[1] as HTMLElement);
        expect(hint.getByText("Compáralo con Capítulo 1 · Escena 1.")).toBeTruthy();
      });
      expect(hint.queryByText(/cambian de color/)).toBeNull();

      fireEvent.click(hint.getByRole("button", { name: "Dame otra pista" }));
      await waitFor(() => {
        hint = within(items(panel)[1] as HTMLElement);
        expect(hint.getByText("Los ojos de Marta cambian de color.")).toBeTruthy();
      });
      expect(hint.getByText("los ojos marrones")).toBeTruthy();
      expect(hint.getByText("los ojos verdes")).toBeTruthy();
      expect(hint.queryByRole("button", { name: "Dame otra pista" })).toBeNull();
      first.unmount();

      show();
      panel = await openPanel();
      await waitFor(() => expect(items(panel)).toHaveLength(2));
      expect(
        within(items(panel)[1] as HTMLElement).getByText("Los ojos de Marta cambian de color."),
      ).toBeTruthy();
    });

    it("“it's intentional” closes a hint for good", async () => {
      const first = show();
      const panel = await openPanel();
      await waitFor(() => expect(items(panel)).toHaveLength(2));

      fireEvent.click(
        within(items(panel)[1] as HTMLElement).getByRole("button", { name: "Es intencionado" }),
      );

      await waitFor(() => expect(hintsButton().textContent).toBe("Pistas: 1"));
      await waitFor(() => expect(marked()).toEqual(["Haber si"]));
      first.unmount();

      show();
      await waitFor(() => expect(hintsButton().textContent).toBe("Pistas: 1"));
      expect([...(await loadHintStates(storage, projectId)).decisions.values()]).toEqual([
        "intentional",
      ]);
    });

    it("“not now” puts a hint away until the novel is opened again", async () => {
      const first = show();
      const panel = await openPanel();
      await waitFor(() => expect(items(panel)).toHaveLength(2));

      fireEvent.click(
        within(items(panel)[0] as HTMLElement).getByRole("button", { name: "Ahora no" }),
      );

      await waitFor(() => expect(hintsButton().textContent).toBe("Pistas: 1"));
      first.unmount();

      show();
      await waitFor(() => expect(hintsButton().textContent).toBe("Pistas: 2"));
    });

    it("“I'll fix it myself” goes to the passage, ready to write", async () => {
      show();
      const panel = await openPanel();
      await waitFor(() => expect(items(panel)).toHaveLength(2));

      fireEvent.click(
        within(items(panel)[1] as HTMLElement).getByRole("button", { name: "Lo corrijo yo" }),
      );

      await waitFor(() => {
        const { state } = currentEditor();
        expect(state.doc.textBetween(state.selection.from, state.selection.to)).toBe(
          "los ojos marrones",
        );
      });
      expect(currentEditor().isEditable).toBe(true);
      expect((screen.getByRole("radio", { name: "Escribir" }) as HTMLInputElement).checked).toBe(
        true,
      );
      // Nothing is underlined now that the author is writing.
      expect(marked()).toEqual([]);
    });

    it("each kind of hint has its own switch", async () => {
      show();
      const panel = await openPanel();
      await waitFor(() => expect(items(panel)).toHaveLength(2));

      fireEvent.click(panel.getByRole("checkbox", { name: "Coherencia" }));

      await waitFor(() => expect(hintsButton().textContent).toBe("Pistas: 1"));
      await waitFor(() => expect(marked()).toEqual(["Haber si"]));
      await expect(loadHintSettings(storage)).resolves.toMatchObject({
        types: { coherence: false, corrections: true },
      });
    });

    it("a hint closes by itself when the author rewrites what caused it", async () => {
      show("write");
      await ready();
      await waitFor(() => expect(hintsButton().textContent).toBe("Pistas: 2"));
      const editor = currentEditor();

      // The author rewrites "Haber si" by hand, with no model involved.
      const start = editor.state.doc.child(0).nodeSize + 1;
      editor.commands.insertContentAt({ from: start, to: start + "Haber si".length }, "A ver si");
      expect(text()).toBe("Marta tenía los ojos verdes.\nA ver si viene Inés.");

      const panel = await openPanel();

      await waitFor(() => expect(items(panel)).toHaveLength(1));
      expect(hintsButton().textContent).toBe("Pistas: 1");
      expect(models.state.asked).toEqual([]);

      // And on switching to the reading mode, only what's still open is marked.
      fireEvent.click(panel.getByRole("button", { name: "Cerrar panel" }));
      fireEvent.click(screen.getByRole("radio", { name: "Ver enlaces y pistas" }));
      await waitFor(() => expect(marked()).toEqual(["los ojos verdes"]));
    });
  });

  describe("a correction", () => {
    it("is applied only when the author presses “Apply”, and changes just that passage", async () => {
      show();
      const panel = await openPanel();
      await waitFor(() => expect(items(panel)).toHaveLength(2));
      let hint = within(items(panel)[0] as HTMLElement);

      expect(hint.getByText("Hay algo que revisar en cómo está escrito esto.")).toBeTruthy();
      expect(hint.queryByRole("button", { name: "Aplicar" })).toBeNull();
      expect(text()).toBe(FIRST.join("\n"));

      fireEvent.click(hint.getByRole("button", { name: "Dame otra pista" }));
      await waitFor(() => {
        hint = within(items(panel)[0] as HTMLElement);
        expect(hint.getByText("«Haber si» pasaría a ser «A ver si».")).toBeTruthy();
      });
      // Seeing the correction changes nothing yet.
      expect(text()).toBe(FIRST.join("\n"));

      fireEvent.click(hint.getByRole("button", { name: "Aplicar" }));

      await waitFor(() =>
        expect(text()).toBe("Marta tenía los ojos verdes.\nA ver si viene Inés."),
      );
      await waitFor(() => expect(hintsButton().textContent).toBe("Pistas: 1"));

      // One step to take it back.
      currentEditor().commands.undo();
      expect(text()).toBe(FIRST.join("\n"));
    });

    it("can be left as it is, for good", async () => {
      show();
      const panel = await openPanel();
      await waitFor(() => expect(items(panel)).toHaveLength(2));

      fireEvent.click(
        within(items(panel)[0] as HTMLElement).getByRole("button", { name: "Déjalo así" }),
      );

      await waitFor(() => expect(hintsButton().textContent).toBe("Pistas: 1"));
      expect(text()).toBe(FIRST.join("\n"));
      expect([...(await loadHintStates(storage, projectId)).decisions.values()]).toEqual(["leave"]);
    });
  });

  describe("if I ask", () => {
    beforeEach(() => setHints({ level: "on_demand" }));

    it("shows nothing by itself: no count, no marks, and one hint each time it's asked", async () => {
      show();
      await ready();
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(hintsButton().textContent).toBe("Pistas");
      expect(marked()).toEqual([]);
      const panel = await openPanel();
      expect(items(panel)).toEqual([]);

      fireEvent.click(await panel.findByRole("button", { name: "Dame una pista" }));
      expect(items(panel)).toHaveLength(1);

      fireEvent.click(panel.getByRole("button", { name: "Dame otra" }));
      expect(items(panel)).toHaveLength(2);
      expect(panel.queryByRole("button", { name: "Dame otra" })).toBeNull();
    });
  });

  describe("companion", () => {
    beforeEach(() => setHints({ level: "companion" }));

    it("stands by the text when reading and offers the next hint, vaguely", async () => {
      show("read");
      const companion = await waitFor(() => {
        const found = document.querySelector(".companion");
        expect(found).not.toBeNull();
        return within(found as HTMLElement);
      });

      expect(companion.getByText("Hay algo que revisar en cómo está escrito esto.")).toBeTruthy();
      fireEvent.click(companion.getByRole("button", { name: "Ver la pista" }));

      const panel = within(await screen.findByRole("complementary", { name: "Pistas" }));
      expect(items(panel)).toHaveLength(2);
    });

    it("stays away while the author writes", async () => {
      show("live");
      await ready();
      await waitFor(() => expect(hintsButton().textContent).toBe("Pistas: 2"));

      expect(document.querySelector(".companion")).toBeNull();
    });
  });

  describe("the next step", () => {
    it("is one task with its reason, and what's unresolved goes first", async () => {
      show();
      const panel = await openPanel();
      const task = within(await panel.findByRole("region", { name: "Siguiente paso" }));

      expect(task.getByText("Resolver")).toBeTruthy();
      expect(task.getByText("Hay dos pasajes que no encajan entre sí.")).toBeTruthy();
      expect(
        task.getByText(
          "Te lo propongo porque Capítulo 1 · Escena 1 y Capítulo 1 · Escena 2 dicen cosas distintas.",
        ),
      ).toBeTruthy();

      fireEvent.click(task.getByRole("button", { name: "Ir al pasaje" }));
      await waitFor(() => {
        const { state } = currentEditor();
        expect(state.doc.textBetween(state.selection.from, state.selection.to)).toBe(
          "los ojos marrones",
        );
      });
    });

    it("“this one isn't useful” moves on to another, and it doesn't come back", async () => {
      const first = show();
      const panel = await openPanel();
      let task = within(await panel.findByRole("region", { name: "Siguiente paso" }));

      fireEvent.click(task.getByRole("button", { name: "Esta no me sirve" }));

      await waitFor(() => {
        task = within(panel.getByRole("region", { name: "Siguiente paso" }));
        expect(task.getByText("¿Quién o qué es Inés?")).toBeTruthy();
      });
      expect(
        task.getByText(
          "Te lo propongo porque Inés aparece en 2 escenas y el texto aún no dice nada concreto.",
        ),
      ).toBeTruthy();
      // The hint itself is still open.
      expect(hintsButton().textContent).toBe("Pistas: 2");
      first.unmount();

      show();
      const again = await openPanel();
      expect(
        within(await again.findByRole("region", { name: "Siguiente paso" })).getByText(
          "¿Quién o qué es Inés?",
        ),
      ).toBeTruthy();
    });

    it("“today I only want to write” takes tasks away for the day", async () => {
      show();
      const panel = await openPanel();
      const task = within(await panel.findByRole("region", { name: "Siguiente paso" }));

      fireEvent.click(task.getByRole("button", { name: "Hoy solo quiero escribir" }));

      await waitFor(() =>
        expect(panel.queryByRole("region", { name: "Siguiente paso" })).toBeNull(),
      );
      // Hints aren't tasks: they stay.
      expect(hintsButton().textContent).toBe("Pistas: 2");
      expect((await loadHintSettings(storage)).noTasksOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
