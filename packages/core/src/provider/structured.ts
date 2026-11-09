import { type AiProvider, collectDraft, type GenerateRequest, type Usage } from "./provider";

/** A value, or why it doesn't fit. */
export type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: string };

/**
 * What to do about a failure. `later`: nothing's wrong with the work, as with no connection or a rate
 * limit. `refused`: it won't work until the setup changes, as with a bad key or no credit.
 * `bad_answer`: the model answered, but not with anything usable, even after the retry.
 */
export type StructuredFailure = "later" | "refused" | "bad_answer";

export class StructuredOutputError extends Error {
  override readonly name = "StructuredOutputError";

  constructor(
    message: string,
    readonly failure: StructuredFailure,
  ) {
    super(message);
  }
}

export interface StructuredOptions {
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly onUsage?: (usage: Usage) => void;
}

const MAX_TRANSIENT_RETRIES = 4;
const FIRST_WAIT_MS = 5000;
const LONGEST_WAIT_MS = 60_000;

const TRANSIENT = new Set(["408", "429", "500", "502", "503", "504"]);

/** Ends early if cancelled, so that closing the app doesn't wait out a rate limit. */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function parse(text: string): unknown {
  // Some models wrap their JSON in a code fence, even when told not to.
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(unfenced);
}

/**
 * Gets output that passes `validate`. SPEC §5: if it doesn't fit, one retry that says what was wrong.
 * Rate limits and server errors are waited out a few times, and don't use up that retry.
 */
export async function generateStructured<T>(
  provider: AiProvider,
  request: GenerateRequest,
  validate: (value: unknown) => Validated<T>,
  options: StructuredOptions = {},
): Promise<T> {
  const sleep = options.sleep ?? abortableSleep;
  let input = request.input;
  let repaired = false;
  let transientFailures = 0;

  for (;;) {
    const draft = await collectDraft(provider.generate({ ...request, input }));
    if (draft.usage !== undefined) {
      options.onUsage?.(draft.usage);
    }

    let problem: string;
    if (draft.outcome.status === "failed") {
      const { error } = draft.outcome;
      const transient = error.code !== null && TRANSIENT.has(error.code);
      const wait = error.retryAfterSeconds
        ? error.retryAfterSeconds * 1000
        : Math.min(FIRST_WAIT_MS * 2 ** transientFailures, LONGEST_WAIT_MS);
      // Asked to wait for longer than that, as with a daily limit, the work waits instead of a request.
      if (transient && transientFailures < MAX_TRANSIENT_RETRIES && wait <= LONGEST_WAIT_MS) {
        transientFailures += 1;
        await sleep(wait, request.signal);
        continue;
      }
      throw new StructuredOutputError(
        `${error.code ?? "error"}: ${error.message}`,
        transient || error.code === null ? "later" : "refused",
      );
    }
    if (draft.outcome.status === "interrupted") {
      throw new StructuredOutputError(draft.outcome.message, "later");
    }
    if (draft.outcome.status === "incomplete") {
      problem = "The answer was cut off before it ended. Give a shorter answer.";
    } else {
      try {
        const checked = validate(parse(draft.text));
        if (checked.ok) {
          return checked.value;
        }
        problem = checked.problem;
      } catch {
        problem = "The answer wasn't valid JSON.";
      }
    }

    if (repaired) {
      throw new StructuredOutputError(
        `The answer didn't fit after a retry: ${problem}`,
        "bad_answer",
      );
    }
    repaired = true;
    input = `${request.input}\n\nYour previous answer was rejected: ${problem}\nAnswer again with only the JSON object.`;
  }
}
