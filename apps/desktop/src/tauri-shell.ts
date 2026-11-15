import type { AiTransport, ResearchAnswer } from "@ink-writer/core";
import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PaidRequestLimit, Shell } from "./shell";
import { bytesToBase64, createTauriDriver } from "./tauri-driver";
import { type AiEvent, createTauriTransport } from "./tauri-transport";

export function createTauriAiTransport(): AiTransport {
  return createTauriTransport(invoke, (onEvent) => {
    const channel = new Channel<AiEvent>();
    channel.onmessage = onEvent;
    return channel;
  });
}

export function createTauriShell(): Shell {
  return {
    driver: createTauriDriver(invoke),
    ai: {
      transport: createTauriAiTransport(),
      async openrouterConnected() {
        const { connected } = await invoke<{ connected: boolean }>("openrouter_status");
        return connected;
      },
      async connectOpenrouter() {
        try {
          await invoke("openrouter_connect");
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : String(error));
        }
      },
      cancelConnectOpenrouter() {
        void invoke("openrouter_cancel_connect").catch(() => {});
      },
      async disconnectOpenrouter() {
        await invoke("openrouter_disconnect");
      },
      async deepseekKeyPresent() {
        const { present } = await invoke<{ present: boolean }>("deepseek_key_status");
        return present;
      },
      async setDeepseekKey(key) {
        await invoke("deepseek_key_set", { key });
      },
      async clearDeepseekKey() {
        await invoke("deepseek_key_clear");
      },
      paidRequestLimit: () => invoke<PaidRequestLimit>("ai_limits_get"),
      setPaidRequestLimit: (dailyRequests) =>
        invoke<PaidRequestLimit>("ai_limits_set", { dailyRequests }),
    },
    research: {
      transport: {
        async fetch(request) {
          try {
            return await invoke<ResearchAnswer>("research_fetch", { request });
          } catch (error) {
            // The shell rejects with a plain string, which says why: `limit:`, `wait:`, `term:`.
            throw new Error(error instanceof Error ? error.message : String(error));
          }
        },
      },
      searchLimit: () => invoke<PaidRequestLimit>("research_limits_get"),
      setSearchLimit: (dailyRequests) =>
        invoke<PaidRequestLimit>("research_limits_set", { dailyRequests }),
    },
    async openLink(url) {
      await invoke("open_link", { url });
    },
    async exportFile(suggestedName, extension, data) {
      const saved = await invoke<boolean>("export_file", {
        suggestedName,
        extension,
        dataBase64: bytesToBase64(data),
      });
      return saved;
    },
    onCloseRequested(handler) {
      const window = getCurrentWindow();
      const stop = window.onCloseRequested(async (event) => {
        if (!(await handler())) {
          event.preventDefault();
        }
      });
      return () => {
        void stop.then((unlisten) => unlisten());
      };
    },
    forceClose() {
      void getCurrentWindow().destroy();
    },
  };
}
