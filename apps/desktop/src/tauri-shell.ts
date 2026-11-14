import type { AiTransport } from "@ink-writer/core";
import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Shell } from "./shell";
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
