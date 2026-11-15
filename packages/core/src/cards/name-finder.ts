export interface KnownName {
  readonly name: string;
  readonly entityId: string;
}

export interface NameMatch {
  readonly from: number;
  readonly to: number;
  readonly entityId: string;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Finds known names in a text, with no model: whole words only, the longest name first, so that
 * "Marta Rey" isn't taken for "Marta". Returns a function, because it's called on every keystroke.
 */
export function createNameFinder(names: readonly KnownName[]): (text: string) => NameMatch[] {
  const byKey = new Map<string, string>();
  for (const { name, entityId } of names) {
    const trimmed = name.trim();
    if (trimmed !== "" && !byKey.has(trimmed)) {
      byKey.set(trimmed, entityId);
    }
  }
  if (byKey.size === 0) {
    return () => [];
  }
  const alternatives = [...byKey.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`,
    "gu",
  );
  return (text) => {
    const matches: NameMatch[] = [];
    for (const match of text.matchAll(pattern)) {
      const entityId = byKey.get(match[0]);
      if (entityId !== undefined) {
        matches.push({ from: match.index, to: match.index + match[0].length, entityId });
      }
    }
    return matches;
  };
}
