/** Comparing names without any model: fast, free, and the same answer every time. */

/** Words that don't identify anyone by themselves, so "la tía Remedios" can match "Remedios". */
const NOT_IDENTIFYING = new Set([
  "a",
  "an",
  "de",
  "del",
  "el",
  "la",
  "las",
  "los",
  "su",
  "sus",
  "the",
  "tía",
  "tío",
  "un",
  "una",
  "don",
  "doña",
]);

/** Case-insensitive, keeping accents: "Tomás" and "Tomas" may be a real difference to flag. */
export const nameKey = (name: string) => name.trim().toLocaleLowerCase();

export const withoutAccents = (text: string) =>
  text.normalize("NFD").replace(/\p{Diacritic}/gu, "");

/** The words of a name that actually identify someone. */
export function nameTokens(name: string): string[] {
  return nameKey(name)
    .split(/[\s,.]+/)
    .filter((token) => token !== "" && !NOT_IDENTIFYING.has(token));
}

/** True if every identifying word of one name is in the other: "Marta" and "Marta Rey". */
export function isPartOfName(a: string, b: string): boolean {
  const [shorter, longer] = [nameTokens(a), nameTokens(b)].sort((x, y) => x.length - y.length);
  if (shorter === undefined || longer === undefined || shorter.length === 0) {
    return false;
  }
  return shorter.every((token) => longer.includes(token));
}

/**
 * True for a description rather than a name: "la doctora", "el cartero". Only a name's own context
 * can say who these are, which is what the identity step of the analysis is for.
 */
export function isEpithet(name: string): boolean {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first !== "" && first === first.toLocaleLowerCase();
}

export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/**
 * True for two names that look like one misspelled as the other: "Tomás" and "Thomas". Short names
 * need to match more closely, or "Ana" and "Eva" would be taken for the same person.
 */
export function looksLikeVariant(a: string, b: string): boolean {
  const left = withoutAccents(nameKey(a));
  const right = withoutAccents(nameKey(b));
  if (nameKey(a) === nameKey(b)) {
    return false;
  }
  if (left === right) {
    return true;
  }
  const shortest = Math.min(left.length, right.length);
  if (shortest < 4) {
    return false;
  }
  return editDistance(left, right) <= (shortest < 8 ? 1 : 2);
}
