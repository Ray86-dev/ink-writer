import type { EntityType, FactCategory } from "../analysis/contract";
import { isEpithet, looksLikeVariant, nameKey } from "../analysis/names";
import { type AnalysisState, type Issue, liveEntities } from "../analysis/state";
import type { KnownName } from "./name-finder";
import { type AuthorOverride, applyOverrides } from "./overrides";

/**
 * The cards of SPEC §3.2, worked out from what the analysis stored, what the author corrected and
 * what the scenes say right now. Nothing here asks a model.
 */

export interface SceneText {
  readonly id: string;
  readonly title: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  /** The scene's text as it is now, which may be newer than its analysis. */
  readonly text: string;
}

/** Where something comes from: every piece of a card links to the text behind it (rule 3). */
export interface Passage {
  readonly sceneId: string;
  readonly sceneTitle: string;
  readonly chapterTitle: string;
  readonly quote: string;
}

export interface EntityRef {
  readonly id: string;
  readonly name: string;
  readonly type: EntityType;
}

export interface CardFact extends Passage {
  readonly sentence: string;
  readonly category: FactCategory;
  readonly attribute: string;
  readonly value: string;
  readonly storyTime: string | null;
  readonly inDialogue: boolean;
}

export interface CardRelation extends Passage {
  readonly label: string;
  readonly other: EntityRef;
  /** True if this card is the one the label is said of: "Marta, hermana de Tomás". */
  readonly outgoing: boolean;
}

export interface CardIssue {
  readonly kind: Issue["kind"];
  readonly reason: string;
  readonly a: Passage;
  readonly b: Passage | null;
  readonly fix: string | null;
}

export interface EntityCard extends EntityRef {
  readonly aliases: readonly string[];
  readonly note: string | null;
  /** What you've written, in the order the novel tells it. */
  readonly facts: readonly CardFact[];
  readonly relations: readonly CardRelation[];
  /** Open contradictions and doubts about this card. */
  readonly issues: readonly CardIssue[];
  /** Other cards whose text names this one. */
  readonly linkedFrom: readonly EntityRef[];
  /** The scenes it appears in, in reading order. */
  readonly scenes: readonly { readonly id: string; readonly title: string }[];
  /** For a place: what it's inside of, outermost first, and what's inside it. */
  readonly within: readonly EntityRef[];
  readonly contains: readonly EntityRef[];
  /** What the author merged into this card. Removing the override undoes it. */
  readonly merged: readonly { readonly overrideId: string; readonly name: string }[];
  /** Set if the author split this card off another: the override to remove to undo it. */
  readonly splitOverrideId: string | null;
}

export interface RelationCard {
  /** The two ids, sorted and joined, so that it's the same whichever way it's told. */
  readonly id: string;
  readonly a: EntityRef;
  readonly b: EntityRef;
  readonly links: readonly (Passage & {
    readonly label: string;
    readonly from: EntityRef;
    readonly to: EntityRef;
  })[];
}

export interface ChapterCard {
  readonly id: string;
  readonly title: string;
  readonly scenes: readonly { readonly id: string; readonly title: string }[];
  readonly people: readonly EntityRef[];
  readonly places: readonly EntityRef[];
  readonly lore: readonly EntityRef[];
  /** When it happens, as the text says it. */
  readonly when: readonly (Passage & { readonly storyTime: string })[];
  readonly issues: readonly CardIssue[];
}

/** One proper name of the novel, for the Names card: an index to spot variants (SPEC §3.2). */
export interface NameEntry {
  readonly name: string;
  readonly entity: EntityRef;
  /** False for the name the card goes by. */
  readonly isAlias: boolean;
  /** How many times the text uses it. */
  readonly uses: number;
  /** Names of other cards that look like this one misspelled. */
  readonly similar: readonly { readonly name: string; readonly entity: EntityRef }[];
}

export interface NovelView {
  readonly cards: readonly EntityCard[];
  readonly relations: readonly RelationCard[];
  readonly chapters: readonly ChapterCard[];
  readonly names: readonly NameEntry[];
}

/**
 * Drops whatever the text no longer says: a quote that isn't literally in its scene now has no
 * origin, so it isn't shown, without waiting for a reanalysis (rule 3). Deleting a paragraph takes
 * its data with it.
 */
export function withoutStale(
  state: AnalysisState,
  texts: ReadonlyMap<string, string>,
): AnalysisState {
  const stands = (sceneId: string, quote: string) => texts.get(sceneId)?.includes(quote) === true;
  return {
    ...state,
    mentions: state.mentions.filter((item) => stands(item.sceneId, item.quote)),
    facts: state.facts.filter((item) => stands(item.sceneId, item.quote)),
    relations: state.relations.filter((item) => stands(item.sceneId, item.quote)),
    issues: state.issues.filter(
      (issue) =>
        stands(issue.a.sceneId, issue.a.quote) &&
        (!("b" in issue) || stands(issue.b.sceneId, issue.b.quote)),
    ),
  };
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

function uniqueById<T extends { readonly id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.id) && seen.add(item.id) !== undefined);
}

export function buildNovelView(input: {
  readonly analysis: AnalysisState;
  readonly overrides: readonly AuthorOverride[];
  /** Every scene that isn't in the trash, in reading order. */
  readonly scenes: readonly SceneText[];
}): NovelView {
  const { scenes } = input;
  const applied = applyOverrides(input.analysis, input.overrides);
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const state = withoutStale(applied.state, new Map(scenes.map((scene) => [scene.id, scene.text])));
  const order = new Map(scenes.map((scene, index) => [scene.id, index]));

  /** Reading order: by scene, then by where the quote is in it. */
  const position = (item: { sceneId: string; quote: string }) =>
    (order.get(item.sceneId) ?? 0) * 1e7 +
    (sceneById.get(item.sceneId)?.text.indexOf(item.quote) ?? 0);
  const inOrder = <T extends { sceneId: string; quote: string }>(items: readonly T[]) =>
    [...items].sort((a, b) => position(a) - position(b));

  const passage = (item: { sceneId: string; quote: string }): Passage => {
    const scene = sceneById.get(item.sceneId);
    return {
      sceneId: item.sceneId,
      sceneTitle: scene?.title ?? "",
      chapterTitle: scene?.chapterTitle ?? "",
      quote: item.quote,
    };
  };

  const entities = liveEntities(state);
  const refs = new Map<string, EntityRef>(
    entities.map((entity) => [
      entity.id,
      { id: entity.id, name: entity.canonicalName, type: entity.type },
    ]),
  );
  const ref = (id: string) => refs.get(id);

  const toIssue = (issue: Issue): CardIssue => ({
    kind: issue.kind,
    reason: issue.reason,
    a: passage(issue.a),
    b: "b" in issue ? passage(issue.b) : null,
    fix: "fix" in issue ? issue.fix : null,
  });
  const quotesOf = (issue: Issue) => ("b" in issue ? [issue.a, issue.b] : [issue.a]);

  const cards: EntityCard[] = entities.map((entity) => {
    const facts = inOrder(state.facts.filter((fact) => fact.entityId === entity.id));
    const mentions = state.mentions.filter((mention) => mention.entityId === entity.id);
    const relations = inOrder(
      state.relations.filter(
        (relation) =>
          (relation.fromEntityId === entity.id || relation.toEntityId === entity.id) &&
          relation.fromEntityId !== relation.toEntityId,
      ),
    );
    const names = [entity.canonicalName, ...entity.aliases].filter((name) => !isEpithet(name));
    const namedIn = (text: string) =>
      names.some((name) => text.toLocaleLowerCase().includes(name.toLocaleLowerCase()));

    // An issue is about this card if it cites one of its passages.
    const own = new Set([
      ...facts.map((fact) => `${fact.sceneId}\n${fact.quote}`),
      ...mentions.map((mention) => `${mention.sceneId}\n${mention.quote}`),
    ]);
    const issues = state.issues
      .filter((issue) =>
        quotesOf(issue).some((cited) => own.has(`${cited.sceneId}\n${cited.quote}`)),
      )
      .map(toIssue);

    const linkedFrom = uniqueById(
      [
        ...relations.map((relation) =>
          relation.fromEntityId === entity.id ? relation.toEntityId : relation.fromEntityId,
        ),
        ...state.facts
          .filter((fact) => fact.entityId !== entity.id && namedIn(fact.sentence))
          .map((fact) => fact.entityId),
      ].flatMap((id) => ref(id) ?? []),
    ).sort(byName);

    const sceneIds = uniqueById(
      [...facts, ...mentions]
        .map((item) => ({ id: item.sceneId }))
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
    );

    const within: EntityRef[] = [];
    for (
      let parent = applied.parents.get(entity.id);
      parent !== undefined && within.length < 100;
      parent = applied.parents.get(parent)
    ) {
      const found = ref(parent);
      if (found !== undefined) {
        within.unshift(found);
      }
    }

    return {
      id: entity.id,
      name: entity.canonicalName,
      type: entity.type,
      aliases: entity.aliases,
      note: applied.notes.get(entity.id) ?? null,
      facts: facts.map((fact) => ({
        ...passage(fact),
        sentence: fact.sentence,
        category: fact.category,
        attribute: fact.attribute,
        value: fact.value,
        storyTime: fact.storyTime,
        inDialogue: fact.inDialogue,
      })),
      relations: relations.flatMap((relation) => {
        const outgoing = relation.fromEntityId === entity.id;
        const other = ref(outgoing ? relation.toEntityId : relation.fromEntityId);
        return other === undefined
          ? []
          : [{ ...passage(relation), label: relation.label, other, outgoing }];
      }),
      issues,
      linkedFrom,
      scenes: sceneIds.map(({ id }) => ({ id, title: sceneById.get(id)?.title ?? "" })),
      within,
      contains: [...applied.parents]
        .filter(([, parent]) => parent === entity.id)
        .flatMap(([child]) => ref(child) ?? [])
        .sort(byName),
      merged: applied.merged.get(entity.id) ?? [],
      splitOverrideId: applied.splitOff.get(entity.id) ?? null,
    };
  });
  cards.sort(byName);

  const pairs = new Map<string, RelationCard>();
  for (const relation of inOrder(state.relations)) {
    const from = ref(relation.fromEntityId);
    const to = ref(relation.toEntityId);
    if (from === undefined || to === undefined || from.id === to.id) {
      continue;
    }
    const [a, b] = [from, to].sort((x, y) => x.id.localeCompare(y.id)) as [EntityRef, EntityRef];
    const id = `${a.id}|${b.id}`;
    const link = { ...passage(relation), label: relation.label, from, to };
    const known = pairs.get(id);
    pairs.set(id, { id, a, b, links: [...(known?.links ?? []), link] });
  }
  const relations = [...pairs.values()].sort((x, y) => byName(x.a, y.a) || byName(x.b, y.b));

  const chapterIds = uniqueById(scenes.map((scene) => ({ id: scene.chapterId })));
  const chapters: ChapterCard[] = chapterIds.map(({ id }) => {
    const own = scenes.filter((scene) => scene.chapterId === id);
    const inChapter = new Set(own.map((scene) => scene.id));
    const present = uniqueById(
      [...state.mentions, ...state.facts]
        .filter((item) => inChapter.has(item.sceneId))
        .flatMap((item) => ref(item.entityId) ?? []),
    ).sort(byName);
    const ofType = (type: EntityType) => present.filter((entity) => entity.type === type);
    return {
      id,
      title: own[0]?.chapterTitle ?? "",
      scenes: own.map((scene) => ({ id: scene.id, title: scene.title })),
      people: ofType("person"),
      places: ofType("place"),
      lore: ofType("lore"),
      when: inOrder(state.facts)
        .filter((fact) => inChapter.has(fact.sceneId) && fact.storyTime !== null)
        .map((fact) => ({ ...passage(fact), storyTime: fact.storyTime as string })),
      issues: state.issues
        .filter((issue) => quotesOf(issue).some((cited) => inChapter.has(cited.sceneId)))
        .map(toIssue),
    };
  });

  const uses = new Map<string, number>();
  for (const mention of state.mentions) {
    const key = `${mention.entityId}\n${nameKey(mention.quote)}`;
    uses.set(key, (uses.get(key) ?? 0) + 1);
  }
  const allNames = entities.flatMap((entity) => {
    const entityRef = ref(entity.id) as EntityRef;
    return [entity.canonicalName, ...entity.aliases]
      .filter((name) => !isEpithet(name))
      .map((name, index) => ({ name, entity: entityRef, isAlias: index > 0 }));
  });
  const names: NameEntry[] = allNames
    .map((entry) => ({
      ...entry,
      uses: uses.get(`${entry.entity.id}\n${nameKey(entry.name)}`) ?? 0,
      similar: allNames
        .filter(
          (other) =>
            other.entity.id !== entry.entity.id && looksLikeVariant(entry.name, other.name),
        )
        .map((other) => ({ name: other.name, entity: other.entity })),
    }))
    .sort(byName);

  return { cards, relations, chapters, names };
}

/** The names the editor can link as the author types: proper names only, never a description. */
export function knownNames(view: NovelView): KnownName[] {
  return view.names.map((entry) => ({ name: entry.name, entityId: entry.entity.id }));
}
