// @vitest-environment jsdom
import {
  type AnalysisState,
  addTopic,
  answerPlace,
  DEFAULT_HINT_SETTINGS,
  type HintSettings,
  hashText,
  loadResearch,
  openSqlStorage,
  type Storage,
  saveHintSettings,
} from "@ink-writer/core";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createNodeSqliteDriver } from "../../../packages/core/test/support/node-sqlite-driver";
import { writeParagraphs } from "../../../packages/core/test/support/prose";
import { ProjectScreen } from "../src/project/ProjectScreen";
import type { Shell } from "../src/shell";
import { stubLayout } from "./support/environment";
import { fakeAi, fakeModels } from "./support/fake-ai";
import { fakeResearch } from "./support/fake-research";

const TEXT = [
  "Marta Rey bajó del autobús en Puerto Viejo.",
  "Tomás, su hermano, la esperaba en Valdeolmos.",
];
const MAP_LABEL = "Puerto Viejo de Algorta, Getxo, Bizkaia, España";

describe("documentation on the project screen", () => {
  let driver: ReturnType<typeof createNodeSqliteDriver>;
  let storage: Storage;
  let projectId: string;
  let sceneId: string;
  let research: ReturnType<typeof fakeResearch>;

  const analysed = (): AnalysisState => ({
    entities: [
      { id: "marta", type: "person", canonicalName: "Marta Rey", aliases: ["Marta"] },
      { id: "tomas", type: "person", canonicalName: "Tomás", aliases: [] },
      { id: "puerto", type: "place", canonicalName: "Puerto Viejo", aliases: [] },
      { id: "valde", type: "place", canonicalName: "Valdeolmos", aliases: [] },
    ],
    mentions: [
      { sceneId, entityId: "marta", quote: "Marta Rey" },
      { sceneId, entityId: "tomas", quote: "Tomás" },
      { sceneId, entityId: "puerto", quote: "Puerto Viejo" },
      { sceneId, entityId: "valde", quote: "Valdeolmos" },
    ],
    facts: [],
    relations: [],
    issues: [],
    sceneOrder: [sceneId],
  });

  const show = (era = "Actualidad") => {
    localStorage.setItem("editor-mode", "write");
    const shell: Shell = {
      driver: {} as Shell["driver"],
      ai: fakeAi().ai,
      ...research.shell,
      exportFile: vi.fn(async () => true),
      onCloseRequested: () => () => {},
      forceClose: vi.fn(),
    };
    return render(
      <ProjectScreen
        startAt="text"
        storage={storage}
        project={{ id: projectId, title: "La veda", language: "es", era }}
        shell={shell}
        onBack={() => {}}
        sessionOptions={{ autoSnapshotMs: 0 }}
        analysisOptions={{ createProvider: fakeModels().createProvider, pauseMs: 10 }}
      />,
    );
  };

  const hints = (changes: Partial<HintSettings>) =>
    saveHintSettings(storage, { ...DEFAULT_HINT_SETTINGS, ...changes });

  const openCards = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Fichas" }));
    return within(await screen.findByRole("region", { name: "Fichas" }));
  };
  const tab = (cards: ReturnType<typeof within>, name: string) =>
    fireEvent.click(cards.getByRole("button", { name: new RegExp(`^${name} \\d+$`) }));
  /** The documentation section of a place, on its card. */
  const placeDocs = async (cards: ReturnType<typeof within>, name: string) => {
    tab(cards, "Lugares");
    const index = within(cards.getByRole("navigation", { name: "Índice de fichas" }));
    fireEvent.click(await index.findByRole("button", { name }));
    const article = within(await cards.findByRole("article", { name }));
    return within(await article.findByRole("region", { name: `Documentación de ${name}` }));
  };
  const overview = async (cards: ReturnType<typeof within>) => {
    tab(cards, "Documentación");
    return within(await cards.findByRole("article", { name: "Documentación" }));
  };
  /** Says the place exists and picks it on the map. */
  const sayItExists = async (docs: ReturnType<typeof within>, realName?: string) => {
    fireEvent.click(docs.getByRole("radio", { name: "Existe" }));
    if (realName !== undefined) {
      fireEvent.change(docs.getByLabelText("Nombre del lugar real"), {
        target: { value: realName },
      });
    }
    fireEvent.click(docs.getByRole("button", { name: "Buscar en el mapa" }));
    fireEvent.click(await docs.findByRole("button", { name: MAP_LABEL }));
  };
  const kinds = () => research.state.sent.map((request) => request.kind);

  beforeEach(async () => {
    stubLayout();
    localStorage.clear();
    driver = createNodeSqliteDriver();
    ({ storage } = await openSqlStorage(driver));
    projectId = (await storage.createProject({ title: "La veda", language: "es", era: "x" })).id;
    const chapter = await storage.createChapter(projectId, "Capítulo 1");
    sceneId = (await storage.createScene(chapter.id, "Escena 1")).id;
    const doc = new Y.Doc();
    writeParagraphs(doc, TEXT);
    await storage.appendSceneUpdate(sceneId, Y.encodeStateAsUpdate(doc));
    doc.destroy();
    await storage.saveSceneAnalysis(
      projectId,
      sceneId,
      await hashText(TEXT.join("\n")),
      analysed(),
    );
    research = fakeResearch();
  });

  afterEach(() => {
    cleanup();
    driver.close();
  });

  it("asks whether a place exists, and searches nothing until the author answers", async () => {
    show();
    const docs = await placeDocs(await openCards(), "Puerto Viejo");

    expect(docs.getByText("¿Existe «Puerto Viejo»?")).toBeTruthy();
    expect(docs.getByRole("radio", { name: "Es inventado" })).toBeTruthy();
    // Time for anything that was going to be searched to have been.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(research.state.sent).toEqual([]);
  });

  it("looks a real place up once the author picks it on the map, with a source on everything", async () => {
    show();
    const cards = await openCards();
    const docs = await placeDocs(cards, "Puerto Viejo");

    await sayItExists(docs, "Puerto Viejo, Getxo");

    const after = await placeDocs(cards, "Puerto Viejo");
    expect(
      await after.findByText("El Puerto Viejo es un antiguo barrio de pescadores."),
    ).toBeTruthy();
    expect(after.getByText(`Se busca como «${MAP_LABEL}».`)).toBeTruthy();
    expect(
      within(after.getByRole("region", { name: "Calles cercanas" })).getByText("Calle del Muelle"),
    ).toBeTruthy();
    expect(after.getByText("Café del Puerto (cafetería)")).toBeTruthy();
    expect(kinds()).toEqual(["geocode", "wiki", "climate", "nearby"]);

    // Every piece names its source, and the source opens in the browser.
    const sources = after.getAllByRole("button", { name: /^(Wikipedia|OpenStreetMap)/ });
    expect(sources).toHaveLength(3);
    fireEvent.click(after.getByRole("button", { name: "Wikipedia: Puerto Viejo de Algorta" }));
    expect(research.state.opened).toEqual([
      "https://es.wikipedia.org/wiki/Puerto_Viejo_de_Algorta",
    ]);
  });

  it("sends the topic alone: no name of a character and nothing of the text", async () => {
    show();
    const cards = await openCards();
    await sayItExists(await placeDocs(cards, "Puerto Viejo"), "Puerto Viejo, Getxo");
    const all = await overview(cards);
    fireEvent.change(all.getByLabelText("Tema"), { target: { value: "autobuses de línea" } });
    fireEvent.click(all.getByRole("button", { name: "Añadir tema" }));
    await waitFor(() => expect(kinds().filter((kind) => kind === "wiki")).toHaveLength(2));

    const everything = JSON.stringify(research.state.sent).toLowerCase();
    for (const kept of ["marta", "rey", "tomás", "hermano", "esperaba", "bajó", "valdeolmos"]) {
      expect(everything).not.toContain(kept);
    }
    const terms = research.state.sent.flatMap((request) =>
      "term" in request ? [request.term] : [],
    );
    expect(new Set(terms)).toEqual(new Set(["Puerto Viejo, Getxo", "autobuses de línea"]));
  });

  it("never searches for a place the author says is invented", async () => {
    show();
    const cards = await openCards();
    const docs = await placeDocs(cards, "Valdeolmos");

    fireEvent.click(docs.getByRole("radio", { name: "Es inventado" }));
    fireEvent.click(docs.getByRole("button", { name: "Guardar" }));

    const after = await placeDocs(cards, "Valdeolmos");
    expect(await after.findByText(/No se busca nada sobre él\./)).toBeTruthy();
    expect(after.queryByRole("button", { name: "Buscar ahora" })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(research.state.sent).toEqual([]);
    expect((await loadResearch(storage, projectId)).topics[0]).toMatchObject({
      reality: "invented",
      term: null,
    });
  });

  it("refuses a search that names a character, and says why", async () => {
    show();
    const cards = await openCards();
    const docs = await placeDocs(cards, "Puerto Viejo");

    fireEvent.change(docs.getByLabelText("Nombre del lugar real"), {
      target: { value: "Casa de Marta Rey" },
    });
    fireEvent.click(docs.getByRole("button", { name: "Buscar en el mapa" }));

    expect((await docs.findByRole("alert")).textContent).toContain(
      "contiene el nombre de un personaje («Marta Rey»)",
    );

    const all = await overview(cards);
    fireEvent.change(all.getByLabelText("Tema"), { target: { value: "Tomás" } });
    fireEvent.click(all.getByRole("button", { name: "Añadir tema" }));
    expect((await all.findByRole("alert")).textContent).toContain("«Tomás»");

    expect(research.state.sent).toEqual([]);
    expect((await loadResearch(storage, projectId)).topics).toEqual([]);
  });

  it("leaves today's streets out of a story set in the past, and looks the era up", async () => {
    show("Posguerra española");
    const cards = await openCards();
    await sayItExists(await placeDocs(cards, "Puerto Viejo"));

    const all = await overview(cards);
    expect(all.getByText(/no se consultan las calles ni los locales de hoy/)).toBeTruthy();
    // The era is looked up as soon as the cards open; the place, once the author answers.
    await waitFor(() =>
      expect([...kinds()].sort()).toEqual(["climate", "geocode", "wiki", "wiki"]),
    );
    expect(research.state.sent).toContainEqual({
      kind: "wiki",
      term: "Posguerra española",
      language: "es",
    });
    expect(all.queryByText("Calle del Muelle")).toBeNull();
  });

  it("with hints off, only searches when the author presses Search now", async () => {
    await hints({ level: "off" });
    await answerPlace(
      storage,
      projectId,
      "Puerto Viejo",
      { reality: "real", term: "Puerto Viejo, Getxo", place: null },
      [],
    );
    show("1950");
    const cards = await openCards();
    const all = await overview(cards);

    expect(all.getByText(/solo se busca cuando pulsas «Buscar ahora»/)).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(research.state.sent).toEqual([]);

    const place = within(all.getByRole("region", { name: "Documentación de Puerto Viejo" }));
    fireEvent.click(place.getByRole("button", { name: "Buscar ahora" }));

    expect(
      await place.findByText("El Puerto Viejo es un antiguo barrio de pescadores."),
    ).toBeTruthy();
    // Only what was asked for: the era wasn't looked up by itself.
    expect(research.state.sent).toEqual([
      { kind: "wiki", term: "Puerto Viejo, Getxo", language: "es" },
    ]);
  });

  it("doesn't search with the documentation kind off either", async () => {
    await hints({ types: { ...DEFAULT_HINT_SETTINGS.types, documentation: false } });
    await addTopic(storage, projectId, "relojero", []);
    show();
    await overview(await openCards());

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(research.state.sent).toEqual([]);
  });

  it("searches nothing while the author is at the text", async () => {
    await addTopic(storage, projectId, "relojero", []);
    show();
    await screen.findByRole("button", { name: "Fichas" });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(research.state.sent).toEqual([]);

    // Opening the cards is when it's looked up.
    await openCards();
    await waitFor(() => expect(kinds()).toEqual(["wiki"]));
  });

  it("what's found is no note until the author takes it, and can be discarded", async () => {
    await addTopic(storage, projectId, "Puerto Viejo de Algorta", []);
    show();
    const all = await overview(await openCards());
    const topic = within(await all.findByRole("region", { name: "Puerto Viejo de Algorta" }));
    await topic.findByText("El Puerto Viejo es un antiguo barrio de pescadores.");
    expect(topic.queryByText("En mis notas")).toBeNull();

    fireEvent.click(topic.getByRole("button", { name: "A mis notas" }));
    expect(await topic.findByText("En mis notas")).toBeTruthy();
    expect((await loadResearch(storage, projectId)).items[0]?.status).toBe("noted");

    fireEvent.click(topic.getByRole("button", { name: "Quitar de mis notas" }));
    fireEvent.click(await topic.findByRole("button", { name: "Descartar" }));
    await waitFor(() =>
      expect(topic.queryByText("El Puerto Viejo es un antiguo barrio de pescadores.")).toBeNull(),
    );
    expect((await loadResearch(storage, projectId)).items[0]?.status).toBe("dismissed");
  });

  it("stops at the day's limit, says so, and goes on when the author raises it", async () => {
    research.state.dailyRequests = 1;
    await addTopic(storage, projectId, "relojero", []);
    await addTopic(storage, projectId, "tranvía", []);
    show();
    const all = await overview(await openCards());

    expect(await all.findByText(/Se han agotado las búsquedas de hoy\./)).toBeTruthy();
    expect(all.getByText(/Hoy van 1 de 1\./)).toBeTruthy();
    expect(kinds()).toEqual(["wiki"]);

    fireEvent.change(all.getByLabelText("Búsquedas al día"), { target: { value: "10" } });
    fireEvent.click(all.getByRole("button", { name: "Guardar tope" }));

    await waitFor(() => expect(kinds()).toEqual(["wiki", "wiki"]));
    await waitFor(() => expect(all.queryByText(/Se han agotado/)).toBeNull());
    expect(research.state.dailyRequests).toBe(10);
  });

  it("says when a source didn't answer and lets the author try again", async () => {
    research.state.replies.wiki = new Error("can't reach the service: offline");
    await addTopic(storage, projectId, "relojero", []);
    show();
    const all = await overview(await openCards());
    const topic = within(await all.findByRole("region", { name: "relojero" }));

    expect(await topic.findByText(/Alguna fuente no respondió\./)).toBeTruthy();

    research.state.replies.wiki = {
      status: 200,
      body: JSON.stringify({
        query: {
          pages: [
            {
              title: "Relojero",
              index: 1,
              extract: "Persona que repara relojes.",
              canonicalurl: "https://es.wikipedia.org/wiki/Relojero",
            },
          ],
        },
      }),
    };
    fireEvent.click(topic.getByRole("button", { name: "Buscar de nuevo" }));

    expect(await topic.findByText("Persona que repara relojes.")).toBeTruthy();
  });

  it("lets the author remove a topic they added", async () => {
    await addTopic(storage, projectId, "relojero", []);
    show();
    const all = await overview(await openCards());
    await all.findByRole("region", { name: "relojero" });

    fireEvent.click(all.getByRole("button", { name: "Quitar «relojero»" }));

    await waitFor(() => expect(all.queryByRole("region", { name: "relojero" })).toBeNull());
    expect((await loadResearch(storage, projectId)).topics).toEqual([]);
  });
});
