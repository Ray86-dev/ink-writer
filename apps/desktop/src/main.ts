import "./styles.css";
import { openSqlStorage } from "@ink-writer/core";
import { invoke } from "@tauri-apps/api/core";
import { describeStartupError, MESSAGES, pickLocale } from "./messages";
import { runSmokeChecks } from "./smoke";
import { createTauriDriver } from "./tauri-driver";

async function smokeTest(): Promise<void> {
  try {
    const detail = await runSmokeChecks(createTauriDriver(invoke));
    await invoke("smoke_report", { ok: true, detail });
  } catch (error) {
    await invoke("smoke_report", { ok: false, detail: String(error) });
  }
}

async function start(): Promise<void> {
  const locale = pickLocale(navigator.language);
  document.documentElement.lang = locale;
  const messages = MESSAGES[locale];
  const status = document.getElementById("status");
  if (status === null) {
    throw new Error("The page has no status element");
  }
  try {
    await openSqlStorage(createTauriDriver(invoke));
    status.textContent = messages.ready;
  } catch (error) {
    status.textContent = describeStartupError(error, messages);
    status.className = "problem";
  }
}

const { smoke } = await invoke<{ smoke: boolean }>("app_info");
await (smoke ? smokeTest() : start());
