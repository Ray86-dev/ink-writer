import {
  type AiProvider,
  type GenerateEvent,
  type GenerateRequest,
  type ModelCapabilities,
  type ModelInfo,
  unsupportedRequest,
} from "../../src/index";

export const FULL_CAPABILITIES: ModelCapabilities = {
  structuredOutput: "json_schema",
  webSearch: true,
  tools: true,
};

export const NO_CAPABILITIES: ModelCapabilities = {
  structuredOutput: "none",
  webSearch: false,
  tools: false,
};

export interface FakeOptions {
  readonly models?: readonly ModelInfo[];
  /** What a supported request yields. Default: some text and a `completed` ending. */
  readonly script?: readonly GenerateEvent[];
}

/** An in-memory provider, with no network, that keeps the contract in `provider-contract.ts`. */
export function createFakeProvider(options: FakeOptions = {}): AiProvider & { sent: number } {
  const models = options.models ?? [
    { id: "full", displayName: "Full", capabilities: FULL_CAPABILITIES },
    { id: "bare", displayName: "Bare", capabilities: NO_CAPABILITIES },
  ];
  const script = options.script ?? [
    { type: "text", delta: "Ho" },
    { type: "text", delta: "la" },
    { type: "end", outcome: { status: "completed" } },
  ];

  const provider = {
    id: "fake",
    displayName: "Fake",
    billing: "local" as const,
    /** Requests that would have gone out to a real service. */
    sent: 0,
    listModels: async () => [...models],
    async *generate(request: GenerateRequest): AsyncGenerator<GenerateEvent> {
      const model = models.find((m) => m.id === request.model);
      if (model === undefined) {
        yield {
          type: "end",
          outcome: {
            status: "failed",
            error: { code: "unknown_model", message: `No model "${request.model}"` },
          },
        };
        return;
      }
      const unsupported = unsupportedRequest(model.capabilities, request);
      if (unsupported !== null) {
        yield {
          type: "end",
          outcome: {
            status: "failed",
            error: { code: "unsupported_capability", message: unsupported },
          },
        };
        return;
      }
      provider.sent += 1;
      for (const event of script) {
        if (request.signal?.aborted) {
          yield { type: "end", outcome: { status: "interrupted", message: "aborted" } };
          return;
        }
        yield event;
      }
    },
  };
  return provider;
}
