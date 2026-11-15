// @vitest-environment jsdom
import { openSqlStorage } from "@ink-writer/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteDriver } from "../../../packages/core/test/support/node-sqlite-driver";
import { App } from "../src/App";
import { RELEASES_URL, UPDATE_ON_START_SETTING } from "../src/projects/Updates";
import type { Shell } from "../src/shell";
import { stubLayout } from "./support/environment";
import { fakeAi } from "./support/fake-ai";
import { fakeResearch } from "./support/fake-research";

describe("updates", () => {
  let driver: ReturnType<typeof createNodeSqliteDriver>;
  let outside: ReturnType<typeof fakeResearch>;

  const show = () => {
    const shell: Shell = {
      driver,
      ai: fakeAi().ai,
      ...outside.shell,
      exportFile: vi.fn(async () => true),
      onCloseRequested: () => () => {},
      forceClose: vi.fn(),
    };
    return render(<App shell={shell} language="es" />);
  };
  const check = async () =>
    fireEvent.click(await screen.findByRole("button", { name: "Buscar actualizaciones" }));

  beforeEach(() => {
    stubLayout();
    localStorage.clear();
    driver = createNodeSqliteDriver();
    outside = fakeResearch();
  });

  afterEach(() => {
    cleanup();
    driver.close();
  });

  it("says which version is running, and asks nobody anything by itself", async () => {
    show();

    expect(await screen.findByText("Tienes la versión 0.1.0.")).toBeTruthy();
    await screen.findByRole("button", { name: "Buscar actualizaciones" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(outside.state.updateChecks).toBe(0);
    expect((screen.getByLabelText("Buscar al abrir la app") as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it("looks when the author presses, and says so when there's nothing newer", async () => {
    show();

    await check();

    expect(await screen.findByText("Tienes la última versión.")).toBeTruthy();
    expect(outside.state.updateChecks).toBe(1);
    expect(screen.queryByRole("button", { name: "Instalar y reiniciar" })).toBeNull();
  });

  it("shows a newer version with its notes, and installs only when told to", async () => {
    outside.state.update = { version: "0.2.0", notes: "Arregla el guardado." };
    show();

    await check();

    expect(await screen.findByText("Hay una versión nueva: 0.2.0.")).toBeTruthy();
    expect(screen.getByText("Arregla el guardado.")).toBeTruthy();
    expect(outside.state.installed).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Instalar y reiniciar" }));
    await waitFor(() => expect(outside.state.installed).toBe(1));
  });

  it("explains a failed check, and offers the page of versions instead", async () => {
    outside.state.update = new Error("update: no connection");
    show();

    await check();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("update: no connection");
    fireEvent.click(screen.getByRole("button", { name: "Ver las versiones en GitHub" }));
    expect(outside.state.opened).toEqual([RELEASES_URL]);
  });

  it("explains a failed install and lets the author try again", async () => {
    outside.state.update = { version: "0.2.0", notes: null };
    outside.state.installFails = new Error("update: signature mismatch");
    show();
    await check();

    fireEvent.click(await screen.findByRole("button", { name: "Instalar y reiniciar" }));

    expect((await screen.findByRole("alert")).textContent).toContain("signature mismatch");
    expect(outside.state.installed).toBe(0);
    expect(
      (screen.getByRole("button", { name: "Buscar actualizaciones" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("looks on starting only once the author has turned that on, and remembers it", async () => {
    outside.state.update = { version: "0.2.0", notes: null };
    show();
    fireEvent.click(await screen.findByLabelText("Buscar al abrir la app"));
    const { storage } = await openSqlStorage(driver);
    await waitFor(async () => expect(await storage.getSetting(UPDATE_ON_START_SETTING)).toBe("on"));
    expect(outside.state.updateChecks).toBe(0);
    cleanup();

    show();
    expect(await screen.findByText("Hay una versión nueva: 0.2.0.")).toBeTruthy();
    expect(outside.state.updateChecks).toBe(1);

    fireEvent.click(screen.getByLabelText("Buscar al abrir la app"));
    await waitFor(async () => expect(await storage.getSetting(UPDATE_ON_START_SETTING)).toBeNull());
  });

  it("stays quiet on starting if the check fails, as without a connection", async () => {
    const { storage } = await openSqlStorage(driver);
    await storage.setSetting(UPDATE_ON_START_SETTING, "on");
    outside.state.update = new Error("update: no connection");
    show();

    await waitFor(() => expect(outside.state.updateChecks).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Todavía no hay ninguna novela.")).toBeTruthy();
  });
});
