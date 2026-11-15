/**
 * What may be searched for (SPEC §7): a topic, never the name of a character and never the author's
 * text (rule 5). Every term goes through here before it's stored and again before it's sent.
 */

/** A term is a topic, not a passage. The shell refuses a longer one too. */
export const MAX_TERM_CHARS = 80;
const MAX_TERM_WORDS = 8;

export type TermProblem =
  | { readonly kind: "empty" }
  | { readonly kind: "too_long" }
  /** It contains the name of a character, which is given. */
  | { readonly kind: "character"; readonly name: string };

/** Thrown instead of searching. Nothing was sent. */
export class TermRefusedError extends Error {
  override readonly name = "TermRefusedError";

  constructor(
    readonly term: string,
    readonly problem: TermProblem,
  ) {
    super(
      problem.kind === "character"
        ? `"${term}" contains the name of a character, "${problem.name}"`
        : `"${term}" can't be searched for: ${problem.kind}`,
    );
  }
}

/** Lower case, without accents, as separate words: "Calle de Ávila" and "calle de avila" are one. */
function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
}

function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) {
    return false;
  }
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((word, index) => haystack[start + index] === word)) {
      return true;
    }
  }
  return false;
}

/**
 * Null if the term can be searched for. `people` is every name and alias of every character: a term
 * with one of them in it, as whole words, is refused. That also refuses a real place that shares a
 * name with a character, which is the safe side to err on.
 */
export function checkTerm(term: string, people: readonly string[]): TermProblem | null {
  const trimmed = term.trim();
  const termWords = words(trimmed);
  if (termWords.length === 0) {
    return { kind: "empty" };
  }
  if (
    [...trimmed].length > MAX_TERM_CHARS ||
    termWords.length > MAX_TERM_WORDS ||
    /[\n\r]/.test(trimmed)
  ) {
    return { kind: "too_long" };
  }
  for (const name of people) {
    if (containsRun(termWords, words(name))) {
      return { kind: "character", name };
    }
  }
  return null;
}

/** The term, trimmed, or a `TermRefusedError`. */
export function requireTerm(term: string, people: readonly string[]): string {
  const problem = checkTerm(term, people);
  if (problem !== null) {
    throw new TermRefusedError(term.trim(), problem);
  }
  return term.trim();
}
