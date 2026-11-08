import "@fontsource-variable/literata/wght.css";
import "@fontsource-variable/literata/wght-italic.css";
import "@fontsource-variable/instrument-sans/wght.css";
import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createTauriShell } from "./tauri-shell";

interface AppInfo {
  readonly test: { readonly mode: string; readonly arg: string | null } | null;
}

const { test } = await invoke<AppInfo>("app_info");

if (test !== null) {
  // Loaded only when asked for, so normal use never carries this code.
  const { runTestMode } = await import("./test-modes/run");
  await runTestMode(test);
} else {
  const root = document.getElementById("root");
  if (root === null) {
    throw new Error("The page has no root element");
  }
  createRoot(root).render(<App shell={createTauriShell()} />);
}
