// @vitest-environment jsdom
import {
  openSqlStorage,
  plainText,
  readParagraphs,
  SceneSession,
  type Storage,
} from "@ink-writer/core";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteDriver } from "../../../packages/core/test/support/node-sqlite-driver";
import { ProjectScreen, safeFileName } from "../src/project/ProjectScreen";
import type { Shell } from "../src/shell";
import { stubLayout } from "./support/environment";

const fakeShell = () => {
  const exported: { name: string; extension: string; data: Uint8Array }[] = [];
  const closing: (() => Promise<boolean>)[] = [];
  const shell: Shell = {
    driver: {} as Shell["driver"],
    exportFile: vi.fn(async (name, extension, data) => {
      exported.push({ name, extension, data });
      return true;
    }),
    onCloseRequested: (handler) => {
      closing.push(handler);
      return () => {
        closing.splice(closing.indexOf(handler), 1);
      };
    },
    forceClose: vi.fn(),
  };
  return { shell, exported, requestClose: () => (closing[0] as () => Promise<boolean>)() };
};

/** The Tiptap instance behind what's on screen, which sets it on its own element. */
function currentEditor(): Editor {
  const element = document.querySelector(".prose") as (HTMLElement & { editor?: Editor }) | null;
  if (element?.editor === undefined) {
    throw new Error("No editor on screen yet");
  }
  return element.editor;
}

async function typed(text: string): Promise<Editor> {
  const editor = await waitFor(currentEditor);
  editor.commands.insertContent(text);
  return editor;
}

describe("safeFileName", () => {
  it.each([
    ["La veda", "La veda"],
    ["¿Quién? ñ 🖋️", "¿Quién- ñ 🖋️"],
    ["Parte 1/2: el regreso", "Parte 1-2- el regreso"],
    ['a\\b*c?d"e<f>g|h', "a-b-c-d-e-f-g-h"],
    ["  espacios   de más  ", "espacios de más"],
    ["...", "novela"],
    ["fin.", "fin"],
  ])("%j becomes %j", (title, expected) => {
    expect(safeFileName(title)).toBe(expected);
  });
});

describe("ProjectScreen", () => {
  let driver: ReturnType<typeof createNodeSqliteDriver>;
  let storage: Storage;
  let projectId: string;
  let chapterId: string;
  let firstScene: string;
  const project = () => ({ id: projectId, title: "La veda", language: "es", era: "actualidad" });

  /** What a fresh start would read from the database. */
  const stored = async (sceneId: string) => {
    const session = await SceneSession.open(storage, sceneId, { autoSnapshotMs: 0 });
    const text = plainText(readParagraphs(session.doc));
    session.doc.destroy();
    return text;
  };

  const show = (store: Storage = storage) => {
    const { shell, exported, requestClose } = fakeShell();
    const onBack = vi.fn();
    const view = render(
      <ProjectScreen
        storage={store}
        project={project()}
        shell={shell}
        onBack={onBack}
        sessionOptions={{ autoSnapshotMs: 0 }}
      />,
    );
    return { shell, exported, requestClose, onBack, ...view };
  };

  const openStructure = () =>
    fireEvent.click(screen.getByRole("button", { name: "Capítulos y escenas" }));
  const openHistory = () => fireEvent.click(screen.getByRole("button", { name: "Historial" }));

  beforeEach(async () => {
    stubLayout();
    localStorage.clear();
    driver = createNodeSqliteDriver();
    ({ storage } = await openSqlStorage(driver));
    projectId = (await storage.createProject({ title: "La veda", language: "es", era: "x" })).id;
    chapterId = (await storage.createChapter(projectId, "Capítulo 1")).id;
    firstScene = (await storage.createScene(chapterId, "Escena 1")).id;
  });

  afterEach(() => {
    cleanup();
    driver.close();
  });

  describe("writing and saving", () => {
    it("opens straight on the first scene, and what's typed reaches the database", async () => {
      show();

      await typed("Marta bajó del autobús.");

      await waitFor(async () => {
        expect(await stored(firstScene)).toBe("Marta bajó del autobús.");
      });
      await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Guardado"));
    });

    it("shows the text again on returning", async () => {
      const first = show();
      await typed("No me olvides.");
      await waitFor(async () => expect(await stored(firstScene)).toBe("No me olvides."));
      first.unmount();

      show();

      const editor = await waitFor(currentEditor);
      expect(editor.getText()).toBe("No me olvides.");
    });

    it("writes in the language of the novel, for the spell checker", async () => {
      show();

      const editor = await waitFor(currentEditor);

      expect(editor.view.dom.getAttribute("lang")).toBe("es");
      expect(editor.view.dom.getAttribute("spellcheck")).toBe("true");
    });
  });

  describe("zen mode", () => {
    it("hides the controls while typing, and the mouse brings them back", async () => {
      const { container } = show();
      const root = () => container.querySelector(".project") as HTMLElement;
      expect(root().classList.contains("zen")).toBe(false);

      await typed("x");
      await waitFor(() => expect(root().classList.contains("zen")).toBe(true));

      fireEvent.mouseMove(root());
      expect(root().classList.contains("zen")).toBe(false);
    });

    it("toggles the controls with Esc, so the keyboard alone is enough", async () => {
      const { container } = show();
      const root = () => container.querySelector(".project") as HTMLElement;
      await typed("x");
      await waitFor(() => expect(root().classList.contains("zen")).toBe(true));

      fireEvent.keyDown(window, { key: "Escape" });
      expect(root().classList.contains("zen")).toBe(false);

      fireEvent.keyDown(window, { key: "Escape" });
      expect(root().classList.contains("zen")).toBe(true);
    });

    it("keeps the controls in reach for the keyboard while hidden", async () => {
      const { container } = show();
      await typed("x");
      await waitFor(() =>
        expect(container.querySelector(".project")?.classList.contains("zen")).toBe(true),
      );

      // Hidden by opacity only: still in the page, and a key's press away.
      expect(screen.getByRole("button", { name: "Historial" })).toBeTruthy();
    });

    it("closes an open panel with Esc before anything else", async () => {
      show();
      await waitFor(currentEditor);
      openStructure();
      expect(screen.getByRole("complementary", { name: "Capítulos y escenas" })).toBeTruthy();

      fireEvent.keyDown(window, { key: "Escape" });

      expect(screen.queryByRole("complementary", { name: "Capítulos y escenas" })).toBeNull();
    });
  });

  describe("the three modes", () => {
    const mode = (name: string) => screen.getByRole("radio", { name });

    it("starts on writing, with only the text", async () => {
      show();
      const editor = await waitFor(currentEditor);

      expect((mode("Escribir") as HTMLInputElement).checked).toBe(true);
      expect(editor.isEditable).toBe(true);
      expect(screen.queryByRole("complementary")).toBeNull();
    });

    it("keeps writing possible and adds no marks in the linked mode", async () => {
      show();
      const editor = await waitFor(currentEditor);

      fireEvent.click(mode("Escribir con enlaces"));

      expect(editor.isEditable).toBe(true);
      expect(screen.queryByRole("complementary")).toBeNull();
    });

    it("makes the text read-only in the reading mode, and says what's coming", async () => {
      show();
      const editor = await waitFor(currentEditor);

      fireEvent.click(mode("Ver enlaces y pistas"));

      await waitFor(() => expect(editor.isEditable).toBe(false));
      const panel = screen.getByRole("complementary", { name: "Enlaces y pistas" });
      expect(within(panel).getByText(/Aún no hay enlaces ni pistas/)).toBeTruthy();
    });

    it("remembers the choice", async () => {
      const first = show();
      await waitFor(currentEditor);
      fireEvent.click(mode("Escribir con enlaces"));
      first.unmount();

      show();

      expect((mode("Escribir con enlaces") as HTMLInputElement).checked).toBe(true);
    });
  });

  describe("chapters and scenes", () => {
    it("adds a scene and goes to it", async () => {
      show();
      await waitFor(currentEditor);
      openStructure();

      fireEvent.click(screen.getByRole("button", { name: "Añadir escena" }));

      await waitFor(async () => {
        const scenes = await storage.listScenes(chapterId);
        expect(scenes.map((scene) => scene.title)).toEqual(["Escena 1", "Escena 2"]);
      });
      // Going to it closes the panel, back to the page.
      await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
    });

    it("keeps each scene's text apart when moving between them", async () => {
      const second = await storage.createScene(chapterId, "Escena 2");
      show();
      await typed("En la primera.");
      await waitFor(async () => expect(await stored(firstScene)).toBe("En la primera."));

      openStructure();
      fireEvent.click(await screen.findByRole("button", { name: "Escena 2" }));
      await waitFor(() => expect(currentEditor().getText()).toBe(""));
      currentEditor().commands.insertContent("En la segunda.");
      await waitFor(async () => expect(await stored(second.id)).toBe("En la segunda."));

      openStructure();
      fireEvent.click(await screen.findByRole("button", { name: "Escena 1" }));
      await waitFor(() => expect(currentEditor().getText()).toBe("En la primera."));
      expect(await stored(second.id)).toBe("En la segunda.");
    });

    it("saves the scene being left before opening the next", async () => {
      const second = await storage.createScene(chapterId, "Escena 2");
      show();
      await typed("Último segundo.");

      // No waiting: the scene changes right after the text was typed.
      openStructure();
      fireEvent.click(await screen.findByRole("button", { name: "Escena 2" }));

      await waitFor(() => expect(currentEditor().getText()).toBe(""));
      expect(await stored(firstScene)).toBe("Último segundo.");
      expect(await stored(second.id)).toBe("");
    });

    it("renames", async () => {
      show();
      await waitFor(currentEditor);
      openStructure();
      fireEvent.click(await screen.findByRole("button", { name: "Cambiar el nombre de Escena 1" }));

      fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "El regreso" } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "El regreso" })).toBeTruthy());
      expect((await storage.listScenes(chapterId))[0]?.title).toBe("El regreso");
    });

    it("reorders", async () => {
      await storage.createScene(chapterId, "Escena 2");
      show();
      await waitFor(currentEditor);
      openStructure();

      fireEvent.click(await screen.findByRole("button", { name: "Bajar Escena 1" }));

      await waitFor(async () => {
        expect((await storage.listScenes(chapterId)).map((s) => s.title)).toEqual([
          "Escena 2",
          "Escena 1",
        ]);
      });
    });

    it("moves the open scene to the trash, goes to another, and can bring it back whole", async () => {
      await storage.createScene(chapterId, "Escena 2");
      show();
      await typed("Rescátame.");
      await waitFor(async () => expect(await stored(firstScene)).toBe("Rescátame."));
      openStructure();

      fireEvent.click(await screen.findByRole("button", { name: "Mover Escena 1 a la papelera" }));

      await waitFor(() => expect(currentEditor().getText()).toBe(""));
      const restore = await screen.findByRole("button", { name: "Recuperar Escena 1" });
      fireEvent.click(restore);

      await waitFor(async () => {
        expect((await storage.listScenes(chapterId)).map((s) => s.title)).toContain("Escena 1");
      });
      expect(await stored(firstScene)).toBe("Rescátame.");
    });

    it("adds a chapter with its first scene, ready to write", async () => {
      show();
      await waitFor(currentEditor);
      openStructure();

      fireEvent.click(screen.getByRole("button", { name: "Añadir capítulo" }));

      await waitFor(async () => {
        const chapters = await storage.listChapters(projectId);
        expect(chapters.map((c) => c.title)).toEqual(["Capítulo 1", "Capítulo 2"]);
        expect(await storage.listScenes(chapters[1]?.id ?? "")).toHaveLength(1);
      });
    });
  });

  describe("history", () => {
    const saveVersion = async (name: string) => {
      fireEvent.change(screen.getByLabelText("Nombre de la versión (opcional)"), {
        target: { value: name },
      });
      fireEvent.click(screen.getByRole("button", { name: "Guardar versión" }));
      await screen.findByText(new RegExp(name));
    };

    it("saves a named version and lists it with its word count", async () => {
      show();
      await typed("Tres palabras aquí");
      openHistory();

      await saveVersion("Primer borrador");

      expect(screen.getByText(/Primer borrador · 3 palabras/)).toBeTruthy();
    });

    it("compares a version with the current text, marked by more than color", async () => {
      show();
      const editor = await typed("los ojos verdes");
      openHistory();
      await saveVersion("Antes");
      editor.commands.setContent("<p>los ojos marrones</p>");

      fireEvent.click(screen.getByRole("button", { name: /Comparar la versión/ }));

      const removed = await screen.findByText("verdes");
      const added = await screen.findByText("marrones");
      expect(removed.tagName).toBe("DEL");
      expect(added.tagName).toBe("INS");
    });

    it("says so when a version is the same as the current text", async () => {
      show();
      await typed("sin cambios");
      openHistory();
      await saveVersion("Igual");

      fireEvent.click(screen.getByRole("button", { name: /Comparar la versión/ }));

      await screen.findByText("Esta versión es igual al texto actual.");
      expect(
        (screen.getByRole("button", { name: "Recuperar esta versión" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    });

    it("restores a version as a new edit, keeping the text it replaces", async () => {
      show();
      const editor = await typed("la versión buena");
      openHistory();
      await saveVersion("Buena");
      editor.commands.setContent("<p>un cambio que no convence</p>");
      await waitFor(async () => expect(await stored(firstScene)).toBe("un cambio que no convence"));

      fireEvent.click(screen.getByRole("button", { name: /Comparar la versión/ }));
      fireEvent.click(await screen.findByRole("button", { name: "Recuperar esta versión" }));

      await screen.findByText(/Versión recuperada/);
      expect(editor.getText()).toBe("la versión buena");
      await waitFor(async () => expect(await stored(firstScene)).toBe("la versión buena"));

      // What it replaced can still be found, under its own version.
      const versions = await storage.listSnapshots(firstScene);
      expect(versions.map((v) => v.label)).toContain("Antes de recuperar");
      const before = versions.find((v) => v.label === "Antes de recuperar");
      const state = await storage.loadSnapshot(before?.id ?? "");
      const { paragraphsFromState } = await import("@ink-writer/core");
      expect(plainText(paragraphsFromState(state as Uint8Array))).toBe("un cambio que no convence");
    });

    it("restoring can be undone", async () => {
      show();
      const editor = await typed("original");
      openHistory();
      await saveVersion("V");
      editor.commands.setContent("<p>distinto</p>");

      fireEvent.click(screen.getByRole("button", { name: /Comparar la versión/ }));
      fireEvent.click(await screen.findByRole("button", { name: "Recuperar esta versión" }));
      await screen.findByText(/Versión recuperada/);
      expect(editor.getText()).toBe("original");

      editor.commands.undo();

      expect(editor.getText()).toBe("distinto");
    });
  });

  describe("export", () => {
    it("exports what was just typed to Word, with the novel's title as file name", async () => {
      const { exported } = show();
      await typed("Recién escrito.");

      fireEvent.click(screen.getByRole("button", { name: "Exportar a Word" }));

      await screen.findByText("Novela exportada.");
      expect(exported[0]).toMatchObject({ name: "La veda", extension: "docx" });
      const document = strFromU8(
        unzipSync(exported[0]?.data as Uint8Array)["word/document.xml"] as Uint8Array,
      );
      expect(document).toContain("Recién escrito.");
    });

    it("exports to Markdown", async () => {
      const { exported } = show();
      await typed("En Markdown.");

      fireEvent.click(screen.getByRole("button", { name: "Exportar a Markdown" }));

      await screen.findByText("Novela exportada.");
      expect(exported[0]?.extension).toBe("md");
      expect(new TextDecoder().decode(exported[0]?.data)).toContain("En Markdown.");
    });

    it("says nothing if the author cancels the dialog", async () => {
      const { shell } = show();
      await waitFor(currentEditor);
      vi.mocked(shell.exportFile).mockResolvedValueOnce(false);

      fireEvent.click(screen.getByRole("button", { name: "Exportar a Word" }));

      await waitFor(() => expect(shell.exportFile).toHaveBeenCalled());
      expect(screen.queryByText("Novela exportada.")).toBeNull();
    });

    it("explains a failed export", async () => {
      const { shell } = show();
      await waitFor(currentEditor);
      vi.mocked(shell.exportFile).mockRejectedValueOnce("disco lleno");

      fireEvent.click(screen.getByRole("button", { name: "Exportar a Word" }));

      await screen.findByText(/No se pudo exportar: disco lleno/);
    });
  });

  describe("when saving fails", () => {
    const failing = () => {
      const control = { failing: true };
      const store: Storage = {
        ...storage,
        appendSceneUpdate: async (id, update) => {
          if (control.failing) {
            throw new Error("disco lleno");
          }
          await storage.appendSceneUpdate(id, update);
        },
      };
      return { control, store };
    };

    it("warns even in zen mode, keeps the text, and clears once saving works again", async () => {
      const { control, store } = failing();
      const { container } = show(store);
      await typed("No me pierdas.");

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("disco lleno");
      expect(container.querySelector(".project")?.classList.contains("zen")).toBe(true);
      expect(currentEditor().getText()).toBe("No me pierdas.");

      control.failing = false;

      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull(), { timeout: 3000 });
      expect(await stored(firstScene)).toBe("No me pierdas.");
    });

    it("won't close silently: it asks, and only closes if the author insists", async () => {
      const { store } = failing();
      const { requestClose, shell } = show(store);
      await typed("Sin guardar.");
      await screen.findByRole("alert");

      await expect(requestClose()).resolves.toBe(false);

      const dialog = await screen.findByRole("alertdialog");
      expect(within(dialog).getByText(/perderás lo último/)).toBeTruthy();
      expect(shell.forceClose).not.toHaveBeenCalled();

      fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar y perderlo" }));
      expect(shell.forceClose).toHaveBeenCalled();
    });

    it("lets the author stay and keep trying", async () => {
      const { store } = failing();
      const { requestClose } = show(store);
      await typed("Sin guardar.");
      await screen.findByRole("alert");
      await requestClose();

      fireEvent.click(await screen.findByRole("button", { name: "Seguir intentándolo" }));

      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(currentEditor().getText()).toBe("Sin guardar.");
    });
  });

  describe("closing", () => {
    it("saves everything before letting the window close", async () => {
      const { requestClose } = show();
      await typed("Justo antes de cerrar.");

      await expect(requestClose()).resolves.toBe(true);

      expect(await stored(firstScene)).toBe("Justo antes de cerrar.");
    });

    it("stores a version on closing, and compacts", async () => {
      const { requestClose } = show();
      await typed("Fin de la sesión.");

      await requestClose();

      expect(await storage.listSnapshots(firstScene)).toHaveLength(1);
      expect((await storage.loadSceneProse(firstScene)).updates).toEqual([]);
    });
  });

  it("finds what was just typed when leaving the novel and coming straight back", async () => {
    const first = show();
    await typed("Justo antes de salir.");

    first.unmount();
    show();

    await waitFor(() => expect(currentEditor().getText()).toBe("Justo antes de salir."));
    expect(await stored(firstScene)).toBe("Justo antes de salir.");
  });

  it("goes back to the list of novels", async () => {
    const { onBack } = show();
    await waitFor(currentEditor);

    fireEvent.click(screen.getByRole("button", { name: /Tus novelas/ }));

    expect(onBack).toHaveBeenCalled();
  });
});
