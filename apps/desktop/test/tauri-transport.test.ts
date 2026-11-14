import { createOllamaProvider, readAll } from "@ink-writer/core";
import { describe, expect, it } from "vitest";
import { bytesToBase64, type Invoke } from "../src/tauri-driver";
import { type AiEvent, createTauriTransport } from "../src/tauri-transport";

const HEAD: AiEvent = { type: "head", status: 200, requestId: null, retryAfterSeconds: null };
const chunk = (text: string): AiEvent => ({
  type: "chunk",
  data: bytesToBase64(new TextEncoder().encode(text)),
});

interface Call {
  readonly command: string;
  readonly args: Record<string, unknown>;
}

/** A shell whose answer to `ai_send` is whatever the test emits. */
function fakeShell(sendFails?: unknown) {
  const calls: Call[] = [];
  let emit: (event: AiEvent) => void = () => {};
  const invoke: Invoke = async (command, args = {}) => {
    calls.push({ command, args });
    if (command === "ai_send" && sendFails !== undefined) {
      throw sendFails;
    }
  };
  const transport = createTauriTransport(invoke, (onEvent) => {
    emit = onEvent;
    return "the channel";
  });
  return {
    transport,
    calls,
    emit: (...events: AiEvent[]) => {
      for (const event of events) emit(event);
    },
    commands: () => calls.map((call) => call.command),
  };
}

const tags = { route: "ollama", method: "GET", path: "/api/tags" } as const;

describe("Tauri transport", () => {
  it("sends the request with a name of its own and the channel to answer on", async () => {
    const shell = fakeShell();

    const first = shell.transport.send({
      route: "ollama",
      method: "POST",
      path: "/api/chat",
      body: { model: "m" },
    });
    shell.emit(HEAD, { type: "end" });
    await first;
    const second = shell.transport.send(tags);
    shell.emit(HEAD, { type: "end" });
    await second;

    expect(shell.calls[0]).toEqual({
      command: "ai_send",
      args: {
        id: expect.any(String),
        request: { route: "ollama", method: "POST", path: "/api/chat", body: { model: "m" } },
        onEvent: "the channel",
      },
    });
    expect(shell.calls[1]?.args.request).toEqual(tags);
    expect(shell.calls[1]?.args.id).not.toBe(shell.calls[0]?.args.id);
  });

  it("hands over the answer, with a character split between pieces kept whole", async () => {
    const shell = fakeShell();
    const sending = shell.transport.send(tags);
    const bytes = new TextEncoder().encode("señal");
    shell.emit(
      { type: "head", status: 429, requestId: "req-1", retryAfterSeconds: 30 },
      { type: "chunk", data: bytesToBase64(bytes.subarray(0, 3)) },
    );

    const response = await sending;
    shell.emit({ type: "chunk", data: bytesToBase64(bytes.subarray(3)) }, { type: "end" });

    expect(response.status).toBe(429);
    expect(response.requestId).toBe("req-1");
    expect(response.retryAfterSeconds).toBe(30);
    await expect(readAll(response.body)).resolves.toBe("señal");
    expect(shell.commands()).toEqual(["ai_send"]);
  });

  it("waits for pieces that come later", async () => {
    const shell = fakeShell();
    const sending = shell.transport.send(tags);
    shell.emit(HEAD);
    const response = await sending;

    const reading = readAll(response.body);
    await Promise.resolve();
    shell.emit(chunk("uno "));
    await Promise.resolve();
    shell.emit(chunk("dos"), { type: "end" });

    await expect(reading).resolves.toBe("uno dos");
  });

  it("rejects if the service can't be reached", async () => {
    const shell = fakeShell();
    const sending = shell.transport.send(tags);
    shell.emit({ type: "error", message: "can't reach the service" });

    await expect(sending).rejects.toThrow("can't reach the service");
  });

  it("rejects if the shell refuses the call itself", async () => {
    const shell = fakeShell("unknown variant `deepseek`");

    await expect(
      shell.transport.send({ route: "deepseek", method: "GET", path: "/models" }),
    ).rejects.toThrow(/deepseek/);
  });

  it("fails the reading, after what did arrive, if the answer is cut short", async () => {
    const shell = fakeShell();
    const sending = shell.transport.send(tags);
    shell.emit(HEAD, chunk("half"), { type: "error", message: "the connection failed" });
    const response = await sending;

    const seen: string[] = [];
    const reading = (async () => {
      for await (const piece of response.body) {
        seen.push(new TextDecoder().decode(piece));
      }
    })();

    await expect(reading).rejects.toThrow("the connection failed");
    expect(seen).toEqual(["half"]);
  });

  it("ignores whatever comes after the ending", async () => {
    const shell = fakeShell();
    const sending = shell.transport.send(tags);
    shell.emit(HEAD, chunk("all"), { type: "end" }, chunk(" and more"), {
      type: "error",
      message: "late",
    });

    await expect(readAll((await sending).body)).resolves.toBe("all");
  });

  it("doesn't send anything once cancelled", async () => {
    const shell = fakeShell();
    const controller = new AbortController();
    controller.abort();

    await expect(shell.transport.send({ ...tags, signal: controller.signal })).rejects.toThrow();
    expect(shell.calls).toEqual([]);
  });

  it("cancelling before the answer starts rejects and tells the shell", async () => {
    const shell = fakeShell();
    const controller = new AbortController();
    const sending = shell.transport.send({ ...tags, signal: controller.signal });

    controller.abort();

    await expect(sending).rejects.toMatchObject({ name: "AbortError" });
    const id = shell.calls[0]?.args.id;
    expect(shell.calls[1]).toEqual({ command: "ai_cancel", args: { id } });
  });

  it("cancelling halfway fails the reading and tells the shell", async () => {
    const shell = fakeShell();
    const controller = new AbortController();
    const sending = shell.transport.send({ ...tags, signal: controller.signal });
    shell.emit(HEAD);
    const response = await sending;
    const reading = readAll(response.body);

    controller.abort();
    // The shell reports the cancellation too, and that changes nothing.
    shell.emit({ type: "error", message: "cancelled" });

    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(shell.commands()).toEqual(["ai_send", "ai_cancel"]);
  });

  it("tells the shell to stop if whoever reads leaves early", async () => {
    const shell = fakeShell();
    const sending = shell.transport.send(tags);
    shell.emit(HEAD, chunk("one"), chunk("two"));
    const response = await sending;

    for await (const _piece of response.body) {
      break;
    }

    expect(shell.commands()).toEqual(["ai_send", "ai_cancel"]);
  });

  it("doesn't cancel what already ended", async () => {
    const shell = fakeShell();
    const controller = new AbortController();
    const sending = shell.transport.send({ ...tags, signal: controller.signal });
    shell.emit(HEAD, { type: "end" });
    await readAll((await sending).body);

    controller.abort();

    expect(shell.commands()).toEqual(["ai_send"]);
  });

  it("serves a real adapter", async () => {
    const shell = fakeShell();
    const provider = createOllamaProvider(shell.transport);

    const listing = provider.listModels();
    shell.emit(HEAD, chunk('{"models":[{"name":"gemma4:latest"}]}'), { type: "end" });

    await expect(listing).resolves.toMatchObject([{ id: "gemma4:latest" }]);
  });
});
