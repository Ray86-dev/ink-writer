// @vitest-environment jsdom
import {
  type AnalysisState,
  DEFAULT_HINT_SETTINGS,
  type Fact,
  hashText,
  loadHintSettings,
  openSqlStorage,
  type Storage,
  saveHintSettings,
} from "@ink-writer/core";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createNodeSqliteDriver } from "../../../packages/core/test/support/node-sqlite-driver";
import { writeParagraphs } from "../../../packages/core/test/support/prose";
import type { InkPainter } from "../src/dashboard/ink-network";
import type { PainterLoader } from "../src/dashboard/three-painter";
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

/** Stands in for three.js: says what it was asked to do, and paints nothing. */
function fakePainter() {
  const state = { made: 0, disposed: 0, frames: 0, lose: () => {} };
  const load: PainterLoader = async (_canvas, onLost) => {
    state.made += 1;
    state.lose = onLost;
    const painter: InkPainter = {
      resize: () => {},
      paint: () => {
        state.frames += 1;
      },
      dispose: () => {
        state.disposed += 1;
      },
    };
    return painter;
  };
  return { load, state };
}

describe("the Dashboard", () => {
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

  const show = (loadPainter?: PainterLoader) => {
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
        {...(loadPainter === undefined ? {} : { loadPainter })}
      />,
    );
  };

  const tile = async (name: string) => within(await screen.findByRole("region", { name }));
  const count = (region: ReturnType<typeof within>) =>
    region.getByRole("heading").parentElement?.querySelector(".dash-count")?.textContent;
  const nextStep = () => within(screen.getByRole("region", { name: "Siguiente paso" }));
  const atTheText = () => document.querySelector(".workspace")?.hasAttribute("hidden") === false;

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

  it("is where a novel opens, with a card for each side of it and its totals", async () => {
    show();

    const people = await tile("Personajes");
    await waitFor(() => expect(count(people)).toBe("3"));
    expect(people.getByRole("button", { name: "Marta Rey" })).toBeTruthy();
    expect(count(await tile("Capítulos"))).toBe("1");
    expect(count(await tile("Lugares"))).toBe("1");
    expect(count(await tile("Relaciones"))).toBe("1");
    expect(count(await tile("Lore"))).toBe("0");
    for (const name of ["Nombres", "Cronología", "Documentación", "Ayuda"]) {
      expect(screen.getByRole("region", { name })).toBeTruthy();
    }
    expect(atTheText()).toBe(false);
    // The modes are of the text, so they aren't offered here.
    expect(screen.queryByRole("radio", { name: "Escribir" })).toBeNull();
  });

  it("says what's still to be resolved with words, not only with colour", async () => {
    show();

    const checks = await tile("Verificación de datos");
    await waitFor(() => expect(count(checks)).toBe("1"));
    expect(checks.getByText(/1 por resolver/)).toBeTruthy();

    fireEvent.click(checks.getByRole("button", { name: "Marta Rey" }));
    const card = within(await screen.findByRole("article", { name: "Marta Rey" }));
    expect(card.getByText("Los ojos cambian de color.")).toBeTruthy();
  });

  it("proposes one next step with its reason, and takes the author to it", async () => {
    show();

    await waitFor(() => expect(nextStep().getByText(/Siguiente paso · Resolver/)).toBeTruthy());
    expect(nextStep().getByText(/Escena 1/)).toBeTruthy();
    fireEvent.click(nextStep().getByRole("button", { name: "Ir al pasaje" }));

    await waitFor(() => expect(atTheText()).toBe(true));
  });

  it("drops a task that isn't useful, and proposes none on a day for writing only", async () => {
    show();
    await waitFor(() => expect(nextStep().getByText(/Siguiente paso · Resolver/)).toBeTruthy());

    fireEvent.click(nextStep().getByRole("button", { name: "Esta no me sirve" }));
    await waitFor(() => expect(nextStep().queryByText(/Resolver/)).toBeNull());

    cleanup();
    await storage.decideHint(projectId, "nothing", "not_useful");
    await saveHintSettings(storage, { ...DEFAULT_HINT_SETTINGS, noTasksOn: null });
    const other = (await storage.createProject({ title: "Otra", language: "es", era: "x" })).id;
    projectId = other;
    const chapter = await storage.createChapter(other, "C");
    await storage.createScene(chapter.id, "E");
    show();
    await waitFor(() => expect(nextStep().getByText("Nada pendiente ahora.")).toBeTruthy());
    expect(nextStep().getByRole("button", { name: "Seguir escribiendo" })).toBeTruthy();
  });

  it("changes how much the app hints, and with hints off proposes nothing", async () => {
    show();
    await waitFor(() => expect(nextStep().getByText(/Siguiente paso/)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Apagadas" }));

    await waitFor(() =>
      expect(nextStep().getByText("Sin tareas. Solo tú y el texto.")).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "Apagadas" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await waitFor(async () => expect((await loadHintSettings(storage)).level).toBe("off"));

    fireEvent.click(nextStep().getByRole("button", { name: "Activar las pistas" }));
    await waitFor(() => expect(nextStep().getByText(/Siguiente paso/)).toBeTruthy());
  });

  it("goes to the text and comes back", async () => {
    show();
    await tile("Personajes");

    fireEvent.click(nextStep().getByRole("button", { name: "Seguir escribiendo" }));
    expect(atTheText()).toBe(true);
    expect(screen.queryByRole("region", { name: "Personajes" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Escribir" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Inicio" }));
    expect(await screen.findByRole("region", { name: "Personajes" })).toBeTruthy();
    expect(atTheText()).toBe(false);
  });

  it("opens a card from its tile, and closing the card comes back here", async () => {
    show();
    const places = await tile("Lugares");

    fireEvent.click(await places.findByRole("button", { name: "Puerto Viejo" }));
    const cards = within(await screen.findByRole("region", { name: "Fichas" }));
    expect(await cards.findByRole("article", { name: "Puerto Viejo" })).toBeTruthy();

    fireEvent.click(cards.getByRole("button", { name: "Volver al inicio" }));
    expect(await screen.findByRole("region", { name: "Lugares" })).toBeTruthy();
  });

  it("leaves out the network, and keeps everything in the cards, without WebGL", async () => {
    const { container } = show();
    const people = await tile("Personajes");
    await waitFor(() => expect(count(people)).toBe("3"));

    await waitFor(() =>
      expect(container.querySelector(".dash-hero")?.classList.contains("dash-no-ink")).toBe(true),
    );
    expect(container.querySelector(".dash-ink")?.hasAttribute("hidden")).toBe(true);
    expect(container.querySelectorAll(".dash-node")).toHaveLength(0);
    expect(screen.queryByRole("group", { name: "Red de tinta" })).toBeNull();
  });

  it("names every node of the network as a button that opens its card", async () => {
    const painter = fakePainter();
    show(painter.load);

    const network = within(await screen.findByRole("group", { name: "Red de tinta" }));
    const marta = await network.findByRole("button", {
      name: "Abrir ficha: Marta Rey. Personaje. Tiene algo por resolver.",
    });
    expect(
      network.getByRole("button", { name: /^Abrir ficha: Capítulo 1. Capítulo./ }),
    ).toBeTruthy();
    expect(network.getByRole("button", { name: "Abrir ficha: Puerto Viejo. Lugar." })).toBeTruthy();
    await waitFor(() => expect(painter.state.frames).toBeGreaterThan(0));

    fireEvent.click(marta);

    expect(await screen.findByRole("article", { name: "Marta Rey" })).toBeTruthy();
  });

  it("has nothing painting once the author is at the text or at a card", async () => {
    const painter = fakePainter();
    show(painter.load);
    await screen.findByRole("group", { name: "Red de tinta" });
    await waitFor(() => expect(painter.state.frames).toBeGreaterThan(0));

    fireEvent.click(nextStep().getByRole("button", { name: "Seguir escribiendo" }));

    expect(painter.state.disposed).toBe(1);
    const drawn = painter.state.frames;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(painter.state.frames).toBe(drawn);
    expect(document.querySelector("canvas")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Inicio" }));
    await screen.findByRole("group", { name: "Red de tinta" });
    expect(painter.state.made).toBe(2);
  });

  it("falls back to the cards alone if painting stops working", async () => {
    const painter = fakePainter();
    const { container } = show(painter.load);
    await screen.findByRole("group", { name: "Red de tinta" });

    painter.state.lose();

    await waitFor(() => expect(screen.queryByRole("group", { name: "Red de tinta" })).toBeNull());
    expect(painter.state.disposed).toBe(1);
    expect(container.querySelector(".dash-hero")?.classList.contains("dash-no-ink")).toBe(true);
    expect(screen.getByRole("region", { name: "Personajes" })).toBeTruthy();
  });

  it("marks what's new since the last look, and nothing the first time", async () => {
    show();
    const people = await tile("Personajes");
    await waitFor(() => expect(count(people)).toBe("3"));
    expect(screen.queryByText(/novedad/)).toBeNull();
    cleanup();

    // A scene written since brings a new character.
    const state = analysed();
    const withInes: AnalysisState = {
      ...state,
      entities: [
        ...state.entities,
        { id: "ines", type: "person", canonicalName: "Inés", aliases: [] },
      ],
      mentions: [...state.mentions, { sceneId: two, entityId: "ines", quote: "Inés" }],
    };
    const text = [...SECOND, "Inés miraba."];
    await write(two, ["Inés miraba."]);
    await storage.saveSceneAnalysis(projectId, two, await hashText(text.join("\n")), withInes);
    show();

    const again = await tile("Personajes");
    await waitFor(() => expect(count(again)).toBe("4"));
    expect(again.getByText("1 novedad")).toBeTruthy();
    const [first] = again.getAllByRole("listitem");
    expect(first?.textContent).toContain("Inés");
    expect(first?.textContent).toContain("nuevo");
  });

  it("explains in Help why the AI doesn't write, and leads to the hint levels", async () => {
    show();
    const help = await tile("Ayuda");

    expect(help.getByText("Por qué la IA no escribe por ti")).toBeTruthy();
    expect(help.getByText("Cómo se crean las fichas")).toBeTruthy();
    await screen.findByRole("button", { name: "Discretas" });
    fireEvent.click(help.getByRole("button", { name: "Regular las pistas" }));

    expect(document.activeElement?.textContent).toBe("Apagadas");
  });
});
