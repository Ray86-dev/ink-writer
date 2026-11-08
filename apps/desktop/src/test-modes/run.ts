import { invoke } from "@tauri-apps/api/core";
import { createTauriDriver, type Invoke } from "../tauri-driver";
import { createTauriShell } from "../tauri-shell";
import { runCrashVerify, runCrashWriter } from "./crash";
import { runPerformance } from "./performance";
import { runSmokeChecks } from "./smoke";
import { runCloseVerify, runCloseWindow, runTour } from "./tour";

export interface TestInfo {
  readonly mode: string;
  readonly arg: string | null;
}

/** What each check can use. `log` reaches whoever started the test, in order, once it's returned. */
export interface TestContext {
  readonly invoke: Invoke;
  readonly log: (line: string) => Promise<void>;
  readonly host: HTMLElement;
  readonly arg: string | null;
}

const finish = (ok: boolean, detail: string) => invoke("test_finish", { ok, detail });

export async function runTestMode(test: TestInfo): Promise<void> {
  const context: TestContext = {
    invoke,
    log: (line) => invoke("test_log", { line }),
    host: document.body,
    arg: test.arg,
  };
  try {
    const driver = createTauriDriver(invoke);
    switch (test.mode) {
      case "smoke":
        await finish(true, await runSmokeChecks(driver, context));
        break;
      case "crash-writer":
        // Runs until killed. Reaching the end at all is a failure.
        await runCrashWriter(driver, context);
        await finish(false, "the writer stopped by itself");
        break;
      case "crash-verify":
        await finish(true, await runCrashVerify(driver, context));
        break;
      case "single-instance":
        // Stays open, for a second copy to try starting. Whoever started it ends it.
        await context.log("READY");
        return;
      case "close":
        // Ends when the window closes. Reaching the timeout is the failure.
        await runCloseWindow(createTauriShell(), context);
        return;
      case "close-verify":
        await finish(true, await runCloseVerify(driver));
        break;
      case "tour":
        await runTour(createTauriShell(), context);
        return;
      case "performance":
        await finish(true, await runPerformance(driver, context));
        break;
      default:
        await finish(false, `no test mode called "${test.mode}"`);
    }
  } catch (error) {
    await finish(false, error instanceof Error ? (error.stack ?? error.message) : String(error));
  }
}
