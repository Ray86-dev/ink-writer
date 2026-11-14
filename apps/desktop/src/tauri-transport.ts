import type { AiTransport, TransportResponse } from "@ink-writer/core";
import { base64ToBytes, type Invoke } from "./tauri-driver";

/** What the shell sends back for one request, in order. `end` or `error` comes once, and last. */
export type AiEvent =
  | {
      readonly type: "head";
      readonly status: number;
      readonly requestId: string | null;
      readonly retryAfterSeconds: number | null;
    }
  | { readonly type: "chunk"; readonly data: string }
  | { readonly type: "end" }
  | { readonly type: "error"; readonly message: string };

/**
 * Makes what the shell writes events to: a `Channel` from `@tauri-apps/api/core`. Passed in so that
 * the transport can be tested on its own.
 */
export type OpenChannel = (onEvent: (event: AiEvent) => void) => unknown;

function aborted(): Error {
  return new DOMException("The request was cancelled", "AbortError");
}

/**
 * The network, through the shell. The shell adds the credentials and refuses anything but the
 * requests the app makes, so neither a key nor a way to spend reaches the page (rule 9, ADR 0012).
 */
export function createTauriTransport(invoke: Invoke, openChannel: OpenChannel): AiTransport {
  return {
    async send({ route, method, path, body, signal }) {
      signal?.throwIfAborted();
      const id = crypto.randomUUID();

      const pieces: Uint8Array[] = [];
      let over = false;
      let failure: Error | null = null;
      let wake: (() => void) | null = null;
      let gotHead: ((head: AiEvent & { type: "head" }) => void) | null = null;
      let lostHead: ((error: Error) => void) | null = null;
      const head = new Promise<AiEvent & { type: "head" }>((resolve, reject) => {
        gotHead = resolve;
        lostHead = reject;
      });

      const notify = () => {
        wake?.();
        wake = null;
      };
      const fail = (error: Error) => {
        if (over || failure !== null) {
          return;
        }
        failure = error;
        lostHead?.(error);
        notify();
      };
      const cancel = () => {
        void invoke("ai_cancel", { id }).catch(() => {});
      };
      const onAbort = () => {
        cancel();
        fail(aborted());
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const channel = openChannel((event) => {
        // Nothing counts after the ending, whatever arrives.
        if (over || failure !== null) {
          return;
        }
        switch (event.type) {
          case "head":
            gotHead?.(event);
            break;
          case "chunk":
            pieces.push(base64ToBytes(event.data));
            notify();
            break;
          case "end":
            over = true;
            notify();
            break;
          case "error":
            fail(new Error(event.message));
            break;
        }
      });

      invoke("ai_send", {
        id,
        request: { route, method, path, ...(body === undefined ? {} : { body }) },
        onEvent: channel,
      }).catch((error: unknown) => {
        fail(new Error(error instanceof Error ? error.message : String(error)));
      });

      let response: AiEvent & { type: "head" };
      try {
        response = await head;
      } catch (error) {
        signal?.removeEventListener("abort", onAbort);
        throw error;
      }

      async function* read(): AsyncGenerator<Uint8Array> {
        try {
          for (;;) {
            const piece = pieces.shift();
            if (piece !== undefined) {
              yield piece;
            } else if (failure !== null) {
              // Only once everything that did arrive has been handed over.
              throw failure;
            } else if (over) {
              return;
            } else {
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
            }
          }
        } finally {
          signal?.removeEventListener("abort", onAbort);
          // Whoever was reading stopped early: the shell has no reason to keep downloading.
          if (!over && failure === null) {
            over = true;
            cancel();
          }
        }
      }

      return {
        status: response.status,
        requestId: response.requestId,
        retryAfterSeconds: response.retryAfterSeconds,
        body: read(),
      } satisfies TransportResponse;
    },
  };
}
