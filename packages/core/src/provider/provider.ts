/**
 * The single AI provider interface of SPEC §6. Each adapter builds its own requests; the core only
 * sees capabilities and a normalized event stream. Shaped by what M0 measured against real services
 * (docs/adr/0008-resultado-m0-vias-de-ia.md).
 *
 * Credentials aren't part of this interface on purpose: they stay in the Rust layer (rule 9).
 */

/** Who pays, so the UI can always say so. Nothing switches between these by itself (rule 10). */
export type BillingKind = "chatgpt_plan" | "openrouter_credits" | "api_key" | "local";

/** Routes differ here, and on the ChatGPT route the mechanism is still unverified. */
export type StructuredOutputMode = "json_schema" | "forced_tool" | "none";

/** Per model rather than per provider: on OpenRouter they vary from one model to the next. */
export interface ModelCapabilities {
  readonly structuredOutput: StructuredOutputMode;
  readonly webSearch: boolean;
  readonly tools: boolean;
}

export interface ModelInfo {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ModelCapabilities;
}

export interface GenerateRequest {
  readonly model: string;
  readonly instructions: string;
  readonly input: string;
  readonly structured?: {
    readonly name: string;
    readonly schema: Readonly<Record<string, unknown>>;
  };
  /** Each search costs money, and one request can run several, so the cap is mandatory. */
  readonly webSearch?: { readonly maxSearches: number };
  readonly signal?: AbortSignal;
}

export interface Citation {
  readonly url: string;
  readonly title: string | null;
}

export interface ProviderError {
  readonly code: string | null;
  readonly message: string;
  /** Kept for support, as the ChatGPT route asks for. */
  readonly requestId?: string;
  readonly httpStatus?: number;
}

/** Only `completed` is success. Any other ending leaves, at most, a partial draft. */
export type GenerateOutcome =
  | { readonly status: "completed" }
  | { readonly status: "failed"; readonly error: ProviderError }
  | { readonly status: "incomplete"; readonly reason: string | null }
  | { readonly status: "interrupted"; readonly message: string };

export type GenerateEvent =
  | { readonly type: "text"; readonly delta: string }
  | { readonly type: "citation"; readonly citation: Citation }
  | { readonly type: "end"; readonly outcome: GenerateOutcome };

export interface AiProvider {
  readonly id: string;
  readonly displayName: string;
  readonly billing: BillingKind;
  listModels(): Promise<ModelInfo[]>;
  /**
   * Yields exactly one `end` event, as the last one. Failures are reported through it rather than by
   * throwing, including a request the model can't honor: see `unsupportedRequest`.
   */
  generate(request: GenerateRequest): AsyncIterable<GenerateEvent>;
}

/**
 * Why a model can't honor a request, or null if it can. Adapters refuse such a request before
 * sending it, because quietly dropping a schema or a search would give a wrong answer that looks
 * right.
 */
export function unsupportedRequest(
  capabilities: ModelCapabilities,
  request: Pick<GenerateRequest, "structured" | "webSearch">,
): string | null {
  if (request.structured !== undefined && capabilities.structuredOutput === "none") {
    return "structured_output";
  }
  if (request.webSearch !== undefined && !capabilities.webSearch) {
    return "web_search";
  }
  return null;
}

export interface Draft {
  readonly text: string;
  readonly citations: readonly Citation[];
  readonly outcome: GenerateOutcome;
  /** True only after a `completed` ending. Anything else can't be treated as a finished result. */
  readonly completed: boolean;
}

/**
 * Reads a stream into a draft. Whatever goes wrong, including an adapter that breaks its contract,
 * the text received so far is kept and the draft is marked as not completed.
 */
export async function collectDraft(
  events: AsyncIterable<GenerateEvent>,
  onText?: (delta: string) => void,
): Promise<Draft> {
  let text = "";
  const citations: Citation[] = [];
  let outcome: GenerateOutcome | undefined;
  try {
    for await (const event of events) {
      if (event.type === "text") {
        text += event.delta;
        onText?.(event.delta);
      } else if (event.type === "citation") {
        citations.push(event.citation);
      } else {
        outcome = event.outcome;
        break;
      }
    }
  } catch (error) {
    outcome = {
      status: "interrupted",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const final = outcome ?? {
    status: "interrupted" as const,
    message: "The stream ended without an ending event",
  };
  return { text, citations, outcome: final, completed: final.status === "completed" };
}
