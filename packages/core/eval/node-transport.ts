import type { AiTransport, ProviderRoute } from "../src/provider/transport";

const BASES: Readonly<Record<ProviderRoute, string>> = {
  openrouter: "https://openrouter.ai",
  ollama: "http://127.0.0.1:11434",
};

/** The network from Node, for the evaluation. In the app, the Rust shell plays this part. */
export function createNodeTransport(openRouterKey: string | null): AiTransport {
  return {
    async send({ route, method, path, body, signal }) {
      const response = await fetch(`${BASES[route]}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(route === "openrouter" && openRouterKey !== null
            ? { authorization: `Bearer ${openRouterKey}` }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal === undefined ? {} : { signal }),
      });
      const retryAfter = Number(response.headers.get("retry-after"));
      return {
        status: response.status,
        requestId: response.headers.get("x-generation-id") ?? response.headers.get("x-request-id"),
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
        body: (response.body ?? []) as AsyncIterable<Uint8Array>,
      };
    },
  };
}
