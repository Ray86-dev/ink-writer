// @vitest-environment jsdom
import {
  acceptOpenRouterNotice,
  loadAiConnection,
  openSqlStorage,
  type Storage,
  saveAiConnection,
} from "@ink-writer/core";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteDriver } from "../../../packages/core/test/support/node-sqlite-driver";
import { ProjectScreen } from "../src/project/ProjectScreen";
import type { Shell } from "../src/shell";
import { stubLayout } from "./support/environment";
import { fakeAi, fakeModels } from "./support/fake-ai";

function currentEditor(): Editor {
  const element = document.querySelector(".prose") as (HTMLElement & { editor?: Editor }) | null;
  if (element?.editor === undefined) {
    throw new Error("No editor on screen yet");
  }
  return element.editor;
}

describe("analysis on the project screen", () => {
  let driver: ReturnType<typeof createNodeSqliteDriver>;
  let storage: Storage;
  let projectId: string;
  let chapterId: string;
  let models: ReturnType<typeof fakeModels>;
  let shellAi: ReturnType<typeof fakeAi>;

  const show = (pauseMs = 10) => {
    const shell: Shell = {
      driver: {} as Shell["driver"],
      ai: shellAi.ai,
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
        analysisOptions={{ createProvider: models.createProvider, pauseMs, retryMs: 60_000 }}
      />,
    );
  };

  const type = async (text: string) => {
    const editor = await waitFor(currentEditor);
    editor.commands.insertContent(text);
  };
  const aiButton = () => screen.getByRole("button", { name: /^IA: / });
  const openPanel = async () => {
    fireEvent.click(aiButton());
    return within(await screen.findByRole("complementary", { name: "Análisis con IA" }));
  };
  const facts = async () => (await storage.loadAnalysis(projectId)).facts.map((fact) => fact.quote);
  const pickModel = async (panel: ReturnType<typeof within>, model: string) => {
    fireEvent.change(await panel.findByLabelText("Modelo"), { target: { value: model } });
  };

  beforeEach(async () => {
    stubLayout();
    localStorage.clear();
    driver = createNodeSqliteDriver();
    ({ storage } = await openSqlStorage(driver));
    projectId = (await storage.createProject({ title: "La veda", language: "es", era: "x" })).id;
    chapterId = (await storage.createChapter(projectId, "Capítulo 1")).id;
    await storage.createScene(chapterId, "Escena 1");
    models = fakeModels();
    shellAi = fakeAi();
  });

  afterEach(() => {
    cleanup();
    driver.close();
  });

  it("analyses nothing until the author chooses a model", async () => {
    show();
    await type("Marta bajó del autobús. Llovía.");
    const panel = await openPanel();

    expect(aiButton().textContent).toBe("IA: apagada");
    expect(panel.getByText(/Ahora no analiza ningún modelo./)).toBeTruthy();
    expect((panel.getByRole("radio", { name: "Nadie" }) as HTMLInputElement).checked).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(models.state.asked).toEqual([]);
    await expect(facts()).resolves.toEqual([]);
  });

  it("with a local model chosen, analyses what's written and says where it stands", async () => {
    show();
    await type("Marta bajó del autobús. Llovía.");
    const panel = await openPanel();

    fireEvent.click(panel.getByRole("radio", { name: "Ollama, en este equipo" }));
    await pickModel(panel, "gemma4:latest");

    await waitFor(async () => expect(await facts()).toEqual(["Marta bajó del autobús"]));
    await waitFor(() => expect(aiButton().textContent).toBe("IA: al día"));
    expect(
      panel.getByText(
        "Ahora analiza: Ollama, en este equipo, gemma4:latest. Todo lo escrito está analizado.",
      ),
    ).toBeTruthy();
    await expect(loadAiConnection(storage)).resolves.toEqual({
      route: "ollama",
      model: "gemma4:latest",
    });
    // Only the model the author chose was ever asked.
    expect(new Set(models.state.asked.map((asked) => asked.request.model))).toEqual(
      new Set(["gemma4:latest"]),
    );
  });

  it("analyses again after a pause in the writing", async () => {
    await saveAiConnection(storage, { route: "ollama", model: "gemma4:latest" });
    show();
    await waitFor(() => expect(aiButton().textContent).toBe("IA: al día"));

    await type("Tomás cerró la puerta. Nadie contestó.");

    await waitFor(async () => expect(await facts()).toEqual(["Tomás cerró la puerta"]));
  });

  it("analyses a scene when the author leaves it, without waiting for a pause", async () => {
    await saveAiConnection(storage, { route: "ollama", model: "gemma4:latest" });
    const second = await storage.createScene(chapterId, "Escena 2");
    show(10 * 60_000);
    await waitFor(() => expect(aiButton().textContent).toBe("IA: activa"));
    await type("Inés llamó dos veces. Llovía.");

    fireEvent.click(screen.getByRole("button", { name: "Capítulos y escenas" }));
    fireEvent.click(await screen.findByRole("button", { name: second.title }));

    await waitFor(async () => expect(await facts()).toEqual(["Inés llamó dos veces"]));
  });

  it("keeps the choice for the next time the novel is opened", async () => {
    const first = show();
    const panel = await openPanel();
    fireEvent.click(panel.getByRole("radio", { name: "Ollama, en este equipo" }));
    await pickModel(panel, "gemma4:e2b");
    await waitFor(() => expect(aiButton().textContent).toBe("IA: al día"));
    first.unmount();

    show();
    await type("Marta volvió. Era tarde.");

    await waitFor(async () => expect(await facts()).toEqual(["Marta volvió"]));
    expect(models.state.asked.at(-1)?.request.model).toBe("gemma4:e2b");
    const reopened = await openPanel();
    expect((reopened.getByLabelText("Modelo") as HTMLSelectElement).value).toBe("gemma4:e2b");
  });

  it("stops when the author turns it off", async () => {
    await saveAiConnection(storage, { route: "ollama", model: "gemma4:latest" });
    show();
    await waitFor(() => expect(aiButton().textContent).toBe("IA: al día"));
    const panel = await openPanel();

    fireEvent.click(panel.getByRole("radio", { name: "Nadie" }));

    await waitFor(() => expect(aiButton().textContent).toBe("IA: apagada"));
    await expect(loadAiConnection(storage)).resolves.toBeNull();
    const asked = models.state.asked.length;
    await type("Esto ya no lo lee nadie. Ni esto.");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(models.state.asked.length).toBe(asked);
  });

  it("says so when Ollama isn't running, and lets the author try again", async () => {
    models.state.unreachable = true;
    show();
    const panel = await openPanel();
    fireEvent.click(panel.getByRole("radio", { name: "Ollama, en este equipo" }));

    const alert = await panel.findByRole("alert");
    expect(alert.textContent).toContain("No encuentro Ollama en este equipo.");

    models.state.unreachable = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Reintentar" }));

    await panel.findByLabelText("Modelo");
    expect(panel.queryByRole("alert")).toBeNull();
  });

  it("shows that the model can't be reached, keeps the scene queued and asks no other", async () => {
    await saveAiConnection(storage, { route: "ollama", model: "gemma4:latest" });
    models.state.failWith = { status: "interrupted", message: "can't reach the service" };
    show();
    await type("Marta esperó. No vino nadie.");

    await waitFor(() => expect(aiButton().textContent).toBe("IA: en espera"));
    const panel = await openPanel();
    expect(panel.getByText(/Queda 1 escena en cola/)).toBeTruthy();
    expect(panel.getByText("can't reach the service")).toBeTruthy();
    await expect(facts()).resolves.toEqual([]);
    await expect(storage.listScenesToAnalyze(projectId)).resolves.toHaveLength(1);
    expect(new Set(models.state.asked.map((asked) => asked.route))).toEqual(new Set(["ollama"]));
  });

  it("stops when the service refuses, and says that only the author can sort it out", async () => {
    await acceptOpenRouterNotice(storage);
    await saveAiConnection(storage, { route: "openrouter", model: "some/model:free" });
    shellAi.state.connected = true;
    models.state.failWith = {
      status: "failed",
      error: { code: "401", message: "No auth credentials found" },
    };
    show();
    await type("Marta esperó. No vino nadie.");

    await waitFor(() => expect(aiButton().textContent).toBe("IA: detenida"));
    const panel = await openPanel();
    expect(panel.getByText(/el análisis está detenido/)).toBeTruthy();
    // It never moved to another route or model by itself (rule 10).
    expect(new Set(models.state.asked.map((asked) => asked.route))).toEqual(
      new Set(["openrouter"]),
    );
  });

  describe("OpenRouter", () => {
    const chooseOpenrouter = async () => {
      const panel = await openPanel();
      fireEvent.click(panel.getByRole("radio", { name: "OpenRouter, modelos gratuitos" }));
      return panel;
    };

    it("warns that the text leaves the machine before anything can be connected", async () => {
      show();
      const panel = await chooseOpenrouter();

      expect(panel.getByText(/el texto de cada escena sale de tu equipo/)).toBeTruthy();
      await panel.findByRole("button", { name: "Lo entiendo, quiero usar OpenRouter" });
      expect(panel.queryByRole("button", { name: "Conectar con OpenRouter" })).toBeNull();
      expect(panel.queryByLabelText("Modelo")).toBeNull();
    });

    it("connects after the notice, offers only free models and analyses with the one chosen", async () => {
      show();
      await type("Marta bajó del autobús. Llovía.");
      const panel = await chooseOpenrouter();

      fireEvent.click(
        await panel.findByRole("button", { name: "Lo entiendo, quiero usar OpenRouter" }),
      );
      fireEvent.click(await panel.findByRole("button", { name: "Conectar con OpenRouter" }));
      const select = (await panel.findByLabelText("Modelo")) as HTMLSelectElement;

      expect([...select.options].map((option) => option.value)).toEqual(["", "some/model:free"]);
      expect(models.state.asked).toEqual([]);

      fireEvent.change(select, { target: { value: "some/model:free" } });

      await waitFor(async () => expect(await facts()).toEqual(["Marta bajó del autobús"]));
      expect(new Set(models.state.asked.map((asked) => asked.route))).toEqual(
        new Set(["openrouter"]),
      );
    });

    it("asks about the notice only once", async () => {
      await acceptOpenRouterNotice(storage);
      show();
      const panel = await chooseOpenrouter();

      await panel.findByRole("button", { name: "Conectar con OpenRouter" });
      expect(panel.queryByRole("button", { name: /Lo entiendo/ })).toBeNull();
      // The warning itself stays in sight.
      expect(panel.getByText(/el texto de cada escena sale de tu equipo/)).toBeTruthy();
    });

    it("doesn't analyse through OpenRouter if the notice was never accepted", async () => {
      await saveAiConnection(storage, { route: "openrouter", model: "some/model:free" });
      shellAi.state.connected = true;
      show();
      await type("Marta bajó del autobús. Llovía.");

      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(models.state.asked).toEqual([]);
      expect(aiButton().textContent).toBe("IA: apagada");
    });

    it("explains a sign-in that fails", async () => {
      await acceptOpenRouterNotice(storage);
      shellAi.state.connect = "timeout";
      show();
      const panel = await chooseOpenrouter();

      fireEvent.click(await panel.findByRole("button", { name: "Conectar con OpenRouter" }));

      expect((await panel.findByRole("alert")).textContent).toBe(
        "No llegó ninguna respuesta del navegador en 5 minutos. Inténtalo de nuevo.",
      );
      await panel.findByRole("button", { name: "Conectar con OpenRouter" });
    });

    it("can be cancelled while it waits for the browser", async () => {
      await acceptOpenRouterNotice(storage);
      shellAi.state.connect = "wait";
      show();
      const panel = await chooseOpenrouter();
      fireEvent.click(await panel.findByRole("button", { name: "Conectar con OpenRouter" }));
      await panel.findByText(/Esperando a que autorices/);

      fireEvent.click(panel.getByRole("button", { name: "Cancelar" }));

      await panel.findByRole("button", { name: "Conectar con OpenRouter" });
      expect(panel.queryByRole("alert")).toBeNull();
      expect(shellAi.state.connected).toBe(false);
    });

    it("disconnecting turns the analysis off before the key goes", async () => {
      await acceptOpenRouterNotice(storage);
      await saveAiConnection(storage, { route: "openrouter", model: "some/model:free" });
      shellAi.state.connected = true;
      show();
      await waitFor(() => expect(aiButton().textContent).toBe("IA: al día"));
      const panel = await openPanel();

      fireEvent.click(await panel.findByRole("button", { name: "Desconectar" }));

      await waitFor(() => expect(shellAi.state.connected).toBe(false));
      await expect(loadAiConnection(storage)).resolves.toBeNull();
      await waitFor(() => expect(aiButton().textContent).toBe("IA: apagada"));
      await panel.findByRole("button", { name: "Conectar con OpenRouter" });
    });
  });
});
