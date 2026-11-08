import { diffWordsWithSpace } from "diff";

export type DiffPart = {
  readonly kind: "same" | "added" | "removed";
  readonly text: string;
};

/** Gives up past this, because comparing two very different long texts can take far too long. */
const TIMEOUT_MS = 2000;

/** What changed between two texts, word by word. Null if they're too different to compare in time. */
export function compareTexts(before: string, after: string): DiffPart[] | null {
  const changes = diffWordsWithSpace(before, after, { timeout: TIMEOUT_MS });
  if (changes === undefined) {
    return null;
  }
  return changes.map((change) => ({
    kind: change.added ? "added" : change.removed ? "removed" : "same",
    text: change.value,
  }));
}
