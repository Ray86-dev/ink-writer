import { isPartOfName, nameKey, withoutAccents } from "./names";

/**
 * Finding what to compare and whom to keep apart by reading the text, without any model: the same
 * answer every time, whichever model produced the facts, and whichever category it filed them under.
 */

/** Too common to say what a sentence is about, in the languages the app supports. Times too. */
const NOT_A_TOPIC = new Set(
  `algo alguien alguna alguno aquel aquella aquello aquellos ante antes aqui asi aunque ayer cada casi
  como con contra cual cuando desde despues donde durante ella ello ellos entonces entre era eran esa
  esas ese eso esos esta estaba estaban estas este esto estos fue fueron habia habian hace hacia hasta
  hora horas manana mas mientras mismo misma mucho muy nada nadie noche nunca otra otras otro otros
  para pero poco porque pues puede quien quiza segun sido siempre sobre solo suya suyo tambien tanto
  tarde tenia tiene toda todas todo todos tras unas unos
  ano anos dia dias mes meses semana semanas
  lunes martes miercoles jueves viernes sabado domingo
  about after again also been before being could from have into just more much never only other over
  said some than that their them then there these they this those very were what when where which
  while will with would year years month months week weeks today tonight yesterday tomorrow
  monday tuesday wednesday thursday friday saturday sunday`.split(/\s+/),
);

const SHORTEST_TOPIC = 4;

const normalize = (word: string) => withoutAccents(word.toLocaleLowerCase()).replace(/s$/, "");

/** The words of a text that can say what it's about, leaving out any in `excluded`. */
export function topicWords(text: string, excluded: ReadonlySet<string> = new Set()): Set<string> {
  const words = text.match(/\p{L}+/gu) ?? [];
  const topics = new Set<string>();
  for (const word of words) {
    const plain = withoutAccents(word.toLocaleLowerCase());
    const topic = normalize(word);
    if (
      plain.length >= SHORTEST_TOPIC &&
      !NOT_A_TOPIC.has(plain) &&
      !NOT_A_TOPIC.has(topic) &&
      !excluded.has(topic)
    ) {
      topics.add(topic);
    }
  }
  return topics;
}

/** The words of a name, in the form `topicWords` compares them. */
export const nameWords = (name: string): string[] => [...topicWords(name)];

/**
 * Whether a text talks of someone dying or being dead. It only widens what gets compared, so a false
 * positive costs a question, while a miss loses the contradiction.
 */
export function speaksOfDeath(text: string): boolean {
  return /\b(enterr|entierro|muri[oe]|muert|fallec|difunt|funeral|velatorio|buried|burial|died|dead|deceased|funeral)/u.test(
    withoutAccents(text.toLocaleLowerCase()),
  );
}

/** The sentences of a text, as written. */
export function sentencesOf(text: string): string[] {
  return (text.match(/[^.!?…\n]+[.!?…]*/gu) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

/** The sentence a quote comes from, or the quote itself if it spans more than one. */
export function sentenceAround(text: string, quote: string): string {
  return sentencesOf(text).find((sentence) => sentence.includes(quote)) ?? quote;
}

/** Sentences that no quote touches, so that nothing was extracted from them. */
export function sentencesWithoutFacts(text: string, quotes: readonly string[]): string[] {
  return sentencesOf(text).filter(
    (sentence) =>
      (sentence.match(/\p{L}+/gu) ?? []).length >= 3 &&
      !quotes.some((quote) => sentence.includes(quote) || quote.includes(sentence)),
  );
}

export interface Apposition {
  /** As written: "Luis". */
  readonly name: string;
  /** What the text says that person is: "el cartero". */
  readonly epithet: string;
  /** Both, as they appear together: "Luis, el cartero". */
  readonly text: string;
}

/** Capitalized only for opening a sentence: "En Madrid, la capital" is about Madrid. */
const SENTENCE_OPENERS =
  /^(?:A|Al|Ante|Con|Cuando|De|Del|Desde|En|Entre|Hasta|Para|Pero|Por|Que|Si|Sin|Sobre|Tras|Y|And|At|But|By|For|From|In|On|When|With)\s+/u;

/** A name, then what that person is: "Luis, el cartero". */
export function appositionsIn(text: string): Apposition[] {
  const found = text.matchAll(/(\p{Lu}\p{L}*(?:\s+\p{Lu}\p{L}+)*),\s+((?:el|la|the)\s+\p{Ll}+)/gu);
  return [...found].flatMap((match) => {
    const written = match[1] ?? "";
    const name = written.replace(SENTENCE_OPENERS, "");
    const epithet = match[2] ?? "";
    return name === "" || SENTENCE_OPENERS.test(`${name} `)
      ? []
      : [{ name, epithet, text: `${name}, ${epithet}` }];
  });
}

/**
 * Pairs the text itself keeps apart: one name inside the other, each with its own description, as in
 * "Luis, el cartero" and "Luis Ferrer, el alcalde". The first of each pair has the shorter name. If
 * it's really one person with two roles, the author can merge them; a wrong merge would be silent.
 */
export function namesakesIn(text: string): (readonly [Apposition, Apposition])[] {
  const found = appositionsIn(text);
  const pairs: (readonly [Apposition, Apposition])[] = [];
  for (const [index, a] of found.entries()) {
    for (const b of found.slice(index + 1)) {
      if (
        nameKey(a.name) !== nameKey(b.name) &&
        nameKey(a.epithet) !== nameKey(b.epithet) &&
        isPartOfName(a.name, b.name)
      ) {
        pairs.push(a.name.length <= b.name.length ? [a, b] : [b, a]);
      }
    }
  }
  return pairs;
}
