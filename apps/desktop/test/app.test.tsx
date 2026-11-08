// @vitest-environment jsdom
import { openSqlStorage } from "@ink-writer/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteDriver } from "../../../packages/core/test/support/node-sqlite-driver";
import { App } from "../src/App";
import type { Shell } from "../src/shell";
import { stubLayout } from "./support/environment";

const shellOver = (driver: Shell["driver"]): Shell => ({
  driver,
  exportFile: vi.fn(async () => true),
  onCloseRequested: () => () => {},
  forceClose: vi.fn(),
});

describe("App", () => {
  beforeEach(() => {
    stubLayout();
    localStorage.clear();
  });

  afterEach(cleanup);

  const fill = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it("creates a novel from title, language and period, and lands on a blank page", async () => {
    const driver = createNodeSqliteDriver();
    render(<App shell={shellOver(driver)} language="es-ES" />);

    await screen.findByText("Todavía no hay ninguna novela.");
    fill("Título", "La veda");
    fill("Idioma", "en");
    fill("Época de la historia", "años cincuenta");
    fireEvent.click(screen.getByRole("button", { name: "Crear novela" }));

    await waitFor(() => expect(document.querySelector(".prose")).not.toBeNull());
    expect(screen.getByText("La veda")).toBeTruthy();

    const { storage } = await openSqlStorage(driver);
    const [project] = await storage.listProjects();
    expect(project).toMatchObject({ title: "La veda", language: "en", era: "años cincuenta" });
    const [chapter] = await storage.listChapters(project?.id ?? "");
    expect(chapter?.title).toBe("Capítulo 1");
    await expect(storage.listScenes(chapter?.id ?? "")).resolves.toMatchObject([
      { title: "Escena 1" },
    ]);
    cleanup();
    driver.close();
  });

  it("uses the novel's language, not the interface's, for the text", async () => {
    const driver = createNodeSqliteDriver();
    const { storage } = await openSqlStorage(driver);
    const project = await storage.createProject({ title: "T", language: "en", era: "x" });
    const chapter = await storage.createChapter(project.id, "C");
    await storage.createScene(chapter.id, "S");
    render(<App shell={shellOver(driver)} language="es" />);

    fireEvent.click(await screen.findByRole("button", { name: /^T/ }));

    await waitFor(() => expect(document.querySelector(".prose")?.getAttribute("lang")).toBe("en"));
    cleanup();
    driver.close();
  });

  it("refuses an empty period with a clear message", async () => {
    const driver = createNodeSqliteDriver();
    render(<App shell={shellOver(driver)} language="es" />);
    await screen.findByText("Todavía no hay ninguna novela.");
    fill("Título", "La veda");
    fill("Época de la historia", "   ");

    fireEvent.submit(screen.getByRole("button", { name: "Crear novela" }));

    await screen.findByText("Este campo es obligatorio.");
    const { storage } = await openSqlStorage(driver);
    await expect(storage.listProjects()).resolves.toEqual([]);
    driver.close();
  });

  it("shows the interface in English when that's the system's language", async () => {
    const driver = createNodeSqliteDriver();
    render(<App shell={shellOver(driver)} language="en-GB" />);

    await screen.findByText("There are no novels yet.");
    expect(document.documentElement.lang).toBe("en");
    driver.close();
  });

  it("explains when another copy of the app holds the database", async () => {
    const driver = createNodeSqliteDriver();
    const locked: Shell["driver"] = {
      ...driver,
      query: async () => {
        throw "already_open";
      },
    };
    render(<App shell={shellOver(locked)} language="es" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("ya está abierto");
    driver.close();
  });

  it("explains a database from a newer version, and leaves it alone", async () => {
    const driver = createNodeSqliteDriver();
    await driver.execute("PRAGMA user_version = 999");
    render(<App shell={shellOver(driver)} language="es" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("versión más reciente");
    await expect(driver.query("PRAGMA user_version")).resolves.toEqual([{ user_version: 999 }]);
    driver.close();
  });
});
