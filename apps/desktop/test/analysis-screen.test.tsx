// @vitest-environment jsdom
import {
  acceptNotice,
  acceptOpenRouterNotice,
  loadAiConnection,
  loadSpendingCap,
  openSqlStorage,
  type Storage,
  saveAiConnection,
  saveSpendingCap,
  spendingDay,
  usageOn,
} from "@ink-writer/core";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteDriver } from "../../../packages/core/test/support/node-sqlite-driver";
import { MESSAGES } from "../src/messages";
import { describeAnalysisProblem } from "../src/project/AiPanel";
import { ProjectScreen } from "../src/project/ProjectScreen";
import type { Shell } from "../src/shell";
import { stubLayout } from "./support/environment";
import { fakeAi, fakeModels } from "./support/fake-ai";
import { fakeResearch } from "./support/fake-research";

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
    expect(panel.getByText("No hay conexión con el servicio. Se reintenta solo.")).toBeTruthy();
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

  describe("paying (M6)", () => {
    const setLimits = async (panel: ReturnType<typeof within>, cap: string, requests: string) => {
      fireEvent.change(await panel.findByLabelText("Gasto máximo al día, en dólares"), {
        target: { value: cap },
      });
      fireEvent.change(panel.getByLabelText("Peticiones de pago máximas al día"), {
        target: { value: requests },
      });
      fireEvent.click(panel.getByRole("button", { name: "Guardar topes" }));
    };
    const options = async (panel: ReturnType<typeof within>) =>
      [...((await panel.findByLabelText("Modelo")) as HTMLSelectElement).options].map(
        (option) => option.textContent,
      );
    const today = () => usageOn(storage, spendingDay(new Date()));

    describe("through OpenRouter", () => {
      beforeEach(async () => {
        await acceptOpenRouterNotice(storage);
        shellAi.state.connected = true;
      });

      const openrouter = async () => {
        const panel = await openPanel();
        fireEvent.click(panel.getByRole("radio", { name: "OpenRouter, modelos gratuitos" }));
        return panel;
      };

      it("offers no paid model until the author asks for them and sets both limits", async () => {
        show();
        const panel = await openrouter();

        expect(await options(panel)).toEqual(["Elige un modelo", "some/model:free"]);

        fireEvent.click(
          panel.getByRole("checkbox", {
            name: "Usar también modelos de pago, con un tope que pongo yo",
          }),
        );
        expect(await panel.findByText("Sin topes: no se usa ningún modelo de pago.")).toBeTruthy();
        expect(await options(panel)).toEqual(["Elige un modelo", "some/model:free"]);

        // One limit alone isn't enough.
        await setLimits(panel, "0,50", "");
        await waitFor(async () => expect(await loadSpendingCap(storage)).toBeNull());
        expect(shellAi.state.dailyRequests).toBe(0);

        await setLimits(panel, "0,50", "40");

        await waitFor(async () =>
          expect(await options(panel)).toEqual([
            "Elige un modelo",
            "some/model:free",
            "some/paid-model · de pago",
          ]),
        );
        await expect(loadSpendingCap(storage)).resolves.toBe(0.5);
        expect(shellAi.state.dailyRequests).toBe(40);
        expect(
          panel.getByText(/^Hoy: .*0,00.* de .*0,50.*, y 0 de 40 peticiones de pago\.$/),
        ).toBeTruthy();
      });

      it("analyses with a paid model, counts what it spends, and stops at the day's limit", async () => {
        await storage.createScene(chapterId, "Escena 2");
        await storage.createScene(chapterId, "Escena 3");
        await saveSpendingCap(storage, 0.05);
        shellAi.state.dailyRequests = 100;
        // Each answer says it cost 2 cents: the limit is passed during the first scene.
        models.state.usage = { inputTokens: 100, outputTokens: 100, cost: 0.02 };
        await saveAiConnection(storage, { route: "openrouter", model: "some/paid-model" });
        show();
        await type("Marta bajó del autobús. Llovía.");

        await waitFor(() => expect(aiButton().textContent).toBe("IA: detenida"));

        await expect(facts()).resolves.toEqual(["Marta bajó del autobús"]);
        const spent = await today();
        expect(spent.cost).toBeGreaterThanOrEqual(0.05);
        const asked = models.state.asked.length;
        const panel = await openPanel();
        expect(
          panel.getByText(
            "Se ha llegado al tope de gasto de hoy. El análisis sigue mañana, o si subes el tope.",
          ),
        ).toBeTruthy();

        // It stays stopped: writing more asks nothing more today.
        await type(" Y siguió lloviendo.");
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(models.state.asked.length).toBe(asked);
        expect((await today()).cost).toBe(spent.cost);
        // And it never moved to a free model by itself (rule 10).
        expect(new Set(models.state.asked.map((item) => item.request.model))).toEqual(
          new Set(["some/paid-model"]),
        );
      });

      it("a paid model chosen earlier is never asked once there's no limit", async () => {
        await saveAiConnection(storage, { route: "openrouter", model: "some/paid-model" });
        show();
        await type("Marta bajó del autobús. Llovía.");

        await waitFor(() => expect(aiButton().textContent).toBe("IA: detenida"));

        expect(models.state.asked).toEqual([]);
        const panel = await openPanel();
        expect(
          panel.getByText(
            "No hay tope de gasto, así que no se usa el modelo de pago. Ponlo en este panel.",
          ),
        ).toBeTruthy();
      });

      it("stops rather than spend blindly if an answer doesn't say what it cost", async () => {
        await storage.createScene(chapterId, "Escena 2");
        await saveSpendingCap(storage, 5);
        shellAi.state.dailyRequests = 100;
        models.state.usage = { inputTokens: 100, outputTokens: 100, cost: null };
        await saveAiConnection(storage, { route: "openrouter", model: "some/paid-model" });
        show();
        await type("Marta bajó del autobús. Llovía.");

        await waitFor(() => expect(aiButton().textContent).toBe("IA: detenida"));
        const panel = await openPanel();
        expect(panel.getByText(/para no gastar a ciegas/)).toBeTruthy();
      });

      it("taking the limits away turns a paid choice off", async () => {
        await saveSpendingCap(storage, 0.5);
        shellAi.state.dailyRequests = 40;
        await saveAiConnection(storage, { route: "openrouter", model: "some/paid-model" });
        show();
        const panel = await openPanel();

        await setLimits(panel, "", "");

        await waitFor(() => expect(aiButton().textContent).toBe("IA: apagada"));
        await expect(loadAiConnection(storage)).resolves.toBeNull();
        await expect(loadSpendingCap(storage)).resolves.toBeNull();
        expect(shellAi.state.dailyRequests).toBe(0);
      });
    });

    describe("with a DeepSeek key", () => {
      const deepseek = async () => {
        const panel = await openPanel();
        fireEvent.click(panel.getByRole("radio", { name: "DeepSeek, con tu clave" }));
        return panel;
      };

      it("says it's paid and that the text leaves the machine before asking for anything", async () => {
        show();
        const panel = await deepseek();

        expect(panel.getByText(/Es de pago: se cobra de tu saldo en DeepSeek/)).toBeTruthy();
        await panel.findByRole("button", { name: "Lo entiendo, quiero usar DeepSeek" });
        expect(panel.queryByLabelText("Tu clave de DeepSeek")).toBeNull();
        expect(panel.queryByLabelText("Modelo")).toBeNull();
      });

      it("hands the key to the shell, keeps none of it, and needs the limits before any model", async () => {
        show();
        const panel = await deepseek();
        fireEvent.click(
          await panel.findByRole("button", { name: "Lo entiendo, quiero usar DeepSeek" }),
        );

        const input = (await panel.findByLabelText("Tu clave de DeepSeek")) as HTMLInputElement;
        expect(input.type).toBe("password");
        fireEvent.change(input, { target: { value: "sk-secreta" } });
        fireEvent.click(panel.getByRole("button", { name: "Guardar clave" }));

        await panel.findByText("Hay una clave de DeepSeek guardada.");
        expect(shellAi.state.deepseekKey).toBe("sk-secreta");
        // The page shows it nowhere, and the field is gone.
        expect(panel.queryByLabelText("Tu clave de DeepSeek")).toBeNull();
        expect(document.body.innerHTML).not.toContain("sk-secreta");
        expect(panel.queryByLabelText("Modelo")).toBeNull();

        await setLimits(panel, "1", "200");

        // Only the model whose price is known: the other can't be held to a limit.
        await waitFor(async () =>
          expect(await options(panel)).toEqual(["Elige un modelo", "deepseek-flash · de pago"]),
        );
      });

      it("analyses, counting the cost from the tokens", async () => {
        await storage.createScene(chapterId, "Escena 2");
        await acceptNotice(storage, "deepseek");
        await saveSpendingCap(storage, 1);
        shellAi.state.deepseekKey = "sk-secreta";
        shellAi.state.dailyRequests = 200;
        // A million tokens each way: 0.30 $ in and 1.20 $ out at the published rate.
        models.state.usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cost: null };
        await saveAiConnection(storage, { route: "deepseek", model: "deepseek-flash" });
        show();
        await type("Marta bajó del autobús. Llovía.");

        await waitFor(() => expect(aiButton().textContent).toBe("IA: detenida"));

        const spent = await today();
        expect(spent.cost).toBeGreaterThanOrEqual(1.5);
        expect(spent.cost / spent.requests).toBeCloseTo(1.5, 10);
        expect(new Set(models.state.asked.map((item) => item.route))).toEqual(
          new Set(["deepseek"]),
        );
      });

      it("removing the key turns the analysis off first", async () => {
        await acceptNotice(storage, "deepseek");
        await saveSpendingCap(storage, 1);
        shellAi.state.deepseekKey = "sk-secreta";
        shellAi.state.dailyRequests = 200;
        await saveAiConnection(storage, { route: "deepseek", model: "deepseek-flash" });
        show();
        const panel = await openPanel();

        fireEvent.click(await panel.findByRole("button", { name: "Quitar clave" }));

        await waitFor(() => expect(shellAi.state.deepseekKey).toBeNull());
        await expect(loadAiConnection(storage)).resolves.toBeNull();
        await panel.findByLabelText("Tu clave de DeepSeek");
      });
    });
  });

  describe("why the analysis stopped, in words (M6: each error has its test)", () => {
    const es = MESSAGES.es;

    it.each([
      ["cap: no daily spending limit is set", es.aiProblems.noCap],
      ["cap: today's limit of 0.5 $ is reached", es.aiProblems.capReached],
      ["cap: an answer didn't say what it cost", es.aiProblems.uncounted],
      ["cap: what was spent couldn't be written down", es.aiProblems.uncounted],
      ["limit: the 40 paid requests allowed today are used up", es.aiProblems.requestsReached],
      ["limit: paid requests are off", es.aiProblems.requestsReached],
      ['paid: "some/model" isn\'t a free model', es.aiProblems.paidOff],
      ["key: the store is locked", es.aiProblems.keyStore],
      ["can't reach the service: connection refused", es.aiProblems.unreachable],
      ["401: No auth credentials found", es.aiProblems.badKey],
      ["403: Forbidden", es.aiProblems.badKey],
      ["402: Insufficient credits", es.aiProblems.noCredit],
      ["404: model not found", es.aiProblems.unknownModel],
      ['unknown_model: No model "x"', es.aiProblems.unknownModel],
      ["429: Rate limit exceeded", es.aiProblems.rateLimited],
      ["500: Internal error", es.aiProblems.serviceDown],
      ["503: The service is out of capacity", es.aiProblems.serviceDown],
    ])("%s", (message, expected) => {
      expect(describeAnalysisProblem(message, es)).toBe(expected);
    });

    it("leaves a problem it doesn't know as the service worded it", () => {
      expect(describeAnalysisProblem("418: I'm a teapot", es)).toBeNull();
      expect(describeAnalysisProblem("The stream ended early", es)).toBeNull();
    });

    it("has every problem in both languages", () => {
      expect(Object.keys(MESSAGES.en.aiProblems).sort()).toEqual(Object.keys(es.aiProblems).sort());
      for (const text of Object.values(MESSAGES.en.aiProblems)) {
        expect(text.length).toBeGreaterThan(10);
      }
    });
  });
});
