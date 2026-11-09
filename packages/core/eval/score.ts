import { isEpithet } from "../src/analysis/names";
import type { AnalysisState, QuoteRef } from "../src/analysis/state";
import { sentenceAround } from "../src/analysis/topics";

/**
 * Scores an analysis against `fixtures/<novel>/expected.json`, with the thresholds in
 * `fixtures/README.md`. Pure, and independent of any model, so that it can be tested by itself.
 */

interface ExpectedRef {
  readonly scene: string;
  readonly quote: string;
}

export interface Expected {
  readonly entities: readonly {
    readonly id: string;
    readonly names: readonly string[];
  }[];
  readonly must_resolve_reference: readonly {
    readonly scene: string;
    readonly quote: string;
    readonly entity: string;
  }[];
  readonly must_flag: readonly {
    readonly id: string;
    readonly category: string;
    readonly a: ExpectedRef;
    readonly b?: ExpectedRef;
    /** What a correction must say: it's applied with one click, so a wrong one doesn't count. */
    readonly expected_fix?: string;
  }[];
  readonly must_not_flag: readonly {
    readonly id: string;
    readonly a: ExpectedRef;
    readonly b?: ExpectedRef;
    /** Two people with one name, by their entity ids, that must stay two. */
    readonly namesakes?: readonly [string, string];
  }[];
}

export const THRESHOLDS = {
  mustFlagAtLeast: 6,
  falseAlarmsAtMost: 1,
  inventedQuotesAtMost: 0,
  referencesAtLeast: 2,
} as const;

export interface Score {
  readonly mustFlag: { readonly found: readonly string[]; readonly missed: readonly string[] };
  readonly falseAlarms: readonly string[];
  readonly inventedQuotes: number;
  readonly discardedQuotes: number;
  readonly twoLuisMerged: boolean;
  readonly references: {
    readonly found: number;
    readonly total: number;
    readonly missed: readonly string[];
  };
  readonly extraIssues: number;
  readonly passed: boolean;
}

/**
 * Whether a model's quote points at the expected place: same scene, and one inside the other, or both
 * in one sentence. A model can pick another part of the same sentence, and the author still gets taken
 * to the right place. It's as lenient for false alarms, so it can't only help a score.
 */
export function sameQuote(
  actual: QuoteRef,
  expected: ExpectedRef,
  texts?: ReadonlyMap<string, string>,
): boolean {
  if (actual.sceneId !== expected.scene || actual.quote === "") {
    return false;
  }
  if (actual.quote.includes(expected.quote) || expected.quote.includes(actual.quote)) {
    return true;
  }
  const text = texts?.get(actual.sceneId);
  if (text === undefined) {
    return false;
  }
  return sentenceAround(text, expected.quote) === sentenceAround(text, actual.quote);
}

function issueMatches(
  issue: AnalysisState["issues"][number],
  expected: { readonly a: ExpectedRef; readonly b?: ExpectedRef },
  texts: ReadonlyMap<string, string>,
): boolean {
  if (expected.b === undefined) {
    return sameQuote(issue.a, expected.a, texts);
  }
  if (!("b" in issue)) {
    return false;
  }
  return (
    (sameQuote(issue.a, expected.a, texts) && sameQuote(issue.b, expected.b, texts)) ||
    (sameQuote(issue.a, expected.b, texts) && sameQuote(issue.b, expected.a, texts))
  );
}

const lower = (text: string) => text.toLocaleLowerCase();

/** The entity an analysis gave to a name: exact match first, since "Luis" is also in "Luis Ferrer". */
function entityForName(state: AnalysisState, name: string): string | undefined {
  return state.entities.find((entity) =>
    [entity.canonicalName, ...entity.aliases].some((other) => lower(other) === lower(name)),
  )?.id;
}

/**
 * Whether two people with one name ended up as one. Names alone can't tell: a model can attach
 * "Luis, el cartero" to Luis Ferrer without ever listing "Luis" as a name. So it also looks at who
 * each person's own quote was attributed to.
 */
export function mergedPeople(state: AnalysisState, expected: Expected): boolean {
  const pair = expected.must_not_flag.find((item) => item.namesakes !== undefined);
  if (pair?.b === undefined || pair.namesakes === undefined) {
    return false;
  }
  const { a, b } = { a: pair.a, b: pair.b };
  const attributedTo = (ref: ExpectedRef) =>
    new Set(
      state.facts
        .filter((fact) => sameQuote({ sceneId: fact.sceneId, quote: fact.quote }, ref))
        .map((fact) => fact.entityId),
    );
  const first = attributedTo(a);
  if ([...attributedTo(b)].some((id) => first.has(id))) {
    return true;
  }
  const idsOf = (id: string) =>
    new Set(
      (expected.entities.find((entity) => entity.id === id)?.names ?? [])
        .map((name) => entityForName(state, name))
        .filter((found) => found !== undefined),
    );
  const other = idsOf(pair.namesakes[1]);
  return [...idsOf(pair.namesakes[0])].some((id) => other.has(id));
}

export function scoreAnalysis(
  state: AnalysisState,
  expected: Expected,
  texts: ReadonlyMap<string, string>,
  discardedQuotes: number,
): Score {
  const coherenceOrCorrection = expected.must_flag;
  const found = coherenceOrCorrection
    .filter((item) =>
      state.issues.some((issue) =>
        item.category === "correction"
          ? issue.kind === "correction" &&
            issueMatches(issue, item, texts) &&
            issue.fix.includes(item.expected_fix ?? "")
          : issue.kind !== "correction" && issueMatches(issue, item, texts),
      ),
    )
    .map((item) => item.id);
  const missed = coherenceOrCorrection.map((item) => item.id).filter((id) => !found.includes(id));

  const falseAlarms = expected.must_not_flag
    .filter((item) =>
      state.issues.some((issue) => issue.kind !== "correction" && issueMatches(issue, item, texts)),
    )
    .map((item) => item.id);

  // Everything kept must be literally in its scene. The pipeline drops the rest, and this checks it.
  const cited: QuoteRef[] = [
    ...state.facts.map((fact) => ({ sceneId: fact.sceneId, quote: fact.quote })),
    ...state.relations.map((relation) => ({ sceneId: relation.sceneId, quote: relation.quote })),
    ...state.issues.flatMap((issue) => ("b" in issue ? [issue.a, issue.b] : [issue.a])),
  ];
  const inventedQuotes = cited.filter(
    (ref) => !(texts.get(ref.sceneId) ?? "").includes(ref.quote),
  ).length;

  const twoLuisMerged = mergedPeople(state, expected);

  const entityNames = new Map(expected.entities.map((entity) => [entity.id, entity.names]));
  const resolvedTo = (reference: Expected["must_resolve_reference"][number]) => {
    const names = entityNames.get(reference.entity) ?? [];
    const ref = { scene: reference.scene, quote: reference.quote };
    // A pronoun is resolved if the fact is about that person, or if the fact's own value names them:
    // "Inés lo vio" as "Inés: vio a Tomás" has understood who "lo" is. Only by a proper name, though:
    // repeating "la doctora" from the text doesn't show who she was taken to be.
    // For the same reason, it's the proper names that say which entity is that person: if "la doctora"
    // was given to someone else, that someone else is not who was expected.
    const properNames = names.filter((name) => !isEpithet(name));
    const ids = new Set(properNames.map((name) => entityForName(state, name)));
    return state.facts.some(
      (fact) =>
        sameQuote({ sceneId: fact.sceneId, quote: fact.quote }, ref, texts) &&
        (ids.has(fact.entityId) || properNames.some((name) => fact.value.includes(name))),
    );
  };
  const references = expected.must_resolve_reference;
  const resolved = references.filter(resolvedTo);

  const matchedIssue = (issue: AnalysisState["issues"][number]) =>
    [...expected.must_flag, ...expected.must_not_flag].some((item) =>
      issueMatches(issue, item, texts),
    );

  const passed =
    found.length >= THRESHOLDS.mustFlagAtLeast &&
    falseAlarms.length <= THRESHOLDS.falseAlarmsAtMost &&
    inventedQuotes <= THRESHOLDS.inventedQuotesAtMost &&
    !twoLuisMerged &&
    resolved.length >= THRESHOLDS.referencesAtLeast;

  return {
    mustFlag: { found, missed },
    falseAlarms,
    inventedQuotes,
    discardedQuotes,
    twoLuisMerged,
    references: {
      found: resolved.length,
      total: references.length,
      missed: references.filter((ref) => !resolved.includes(ref)).map((ref) => ref.quote),
    },
    extraIssues: state.issues.filter((issue) => !matchedIssue(issue)).length,
    passed,
  };
}
