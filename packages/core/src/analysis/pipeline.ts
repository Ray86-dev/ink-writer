import type { AiProvider, GenerateRequest, Usage } from "../provider/provider";
import { generateStructured, type Validated } from "../provider/structured";
import {
  COMPARISON_SCHEMA,
  type Correction,
  EXTRACTION_SCHEMA,
  type ExtractedEntity,
  type Extraction,
  type Finding,
  IDENTITY_SCHEMA,
  type IdentityAnswer,
  PROOFREAD_SCHEMA,
  validateCorrections,
  validateExtraction,
  validateFindings,
  validateIdentities,
} from "./contract";
import {
  editDistance,
  isEpithet,
  isPartOfName,
  looksLikeVariant,
  nameKey,
  nameTokens,
  withoutAccents,
} from "./names";
import {
  type ComparedCategory,
  comparisonInstructions,
  extractionInstructions,
  identityInstructions,
  missedSentencesBlock,
  proofreadInstructions,
} from "./prompts";
import {
  type AnalysisState,
  type Entity,
  type Fact,
  type Issue,
  liveEntities,
  type Mention,
  type Relation,
  withoutScene,
} from "./state";
import {
  namesakesIn,
  nameWords,
  sentenceAround,
  sentencesWithoutFacts,
  speaksOfDeath,
  topicWords,
} from "./topics";

export interface AnalysisDeps {
  readonly provider: AiProvider;
  readonly model: string;
  readonly language: string;
  readonly newId?: () => string;
  readonly reasoning?: "default" | "off";
  readonly signal?: AbortSignal;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly onUsage?: (usage: Usage) => void;
  /** Which step is about to ask the model, for progress and for counting requests. */
  readonly onStep?: (step: string) => void;
}

export interface SceneToAnalyze {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

export interface SceneAnalysis {
  readonly state: AnalysisState;
  /** Quotes the model gave that aren't in the scene. They were thrown away (rule 3). */
  readonly discardedQuotes: readonly string[];
  /** Facts about a name that isn't in the scene, so they couldn't be given to anyone. */
  readonly unplacedFacts: readonly string[];
}

/** Keeps a prompt small on a long novel. The latest facts are the ones kept. */
const MAX_FACTS_IN_GROUP = 12;

/** Keeps the requests per scene down. The topics shared by the fewest facts say the most. */
const MAX_TOPIC_GROUPS = 5;

/**
 * How far the words a correction replaces can be from the new ones, and still be the same word. This
 * keeps a model from rewriting the author's prose through a "correction" (rule 1), since the author can
 * apply them with one click.
 */
const MAX_TYPO_DISTANCE = 0.34;

function ask<T>(
  deps: AnalysisDeps,
  step: string,
  request: Omit<GenerateRequest, "model" | "temperature" | "reasoning">,
  validate: (value: unknown) => Validated<T>,
): Promise<T> {
  deps.onStep?.(step);
  return generateStructured(
    deps.provider,
    {
      ...request,
      model: deps.model,
      temperature: 0,
      ...(deps.reasoning === undefined ? {} : { reasoning: deps.reasoning }),
      ...(deps.signal === undefined ? {} : { signal: deps.signal }),
    },
    validate,
    {
      ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
      ...(deps.onUsage === undefined ? {} : { onUsage: deps.onUsage }),
    },
  );
}

function knownEntitiesBlock(entities: readonly Entity[]): string {
  if (entities.length === 0) {
    return "KNOWN ENTITIES: none yet.";
  }
  const lines = entities.map((entity) => {
    const others = entity.aliases.filter((alias) => alias !== entity.canonicalName);
    const also = others.length > 0 ? ` (also: ${others.join(", ")})` : "";
    return `- [${entity.id}] ${entity.canonicalName}${also}, ${entity.type}`;
  });
  return `KNOWN ENTITIES:\n${lines.join("\n")}`;
}

function sceneBlock(scene: SceneToAnalyze): string {
  return `SCENE "${scene.title}":\n${scene.text}`;
}

/** Step 1 and the literal check of rule 3: a quote that isn't in the scene is thrown away. */
async function extract(
  state: AnalysisState,
  scene: SceneToAnalyze,
  deps: AnalysisDeps,
): Promise<{ extraction: Extraction; discarded: string[] }> {
  const first = await ask(
    deps,
    "extract",
    {
      instructions: extractionInstructions(deps.language),
      input: `${knownEntitiesBlock(liveEntities(state))}\n\n${sceneBlock(scene)}`,
      structured: { name: "scene_extraction", schema: EXTRACTION_SCHEMA },
    },
    validateExtraction,
  );
  // Every model tried skips sentences, and a fact never extracted can never be compared.
  const missed = sentencesWithoutFacts(
    scene.text,
    first.facts.map((fact) => fact.quote),
  );
  const raw =
    missed.length === 0
      ? first
      : mergeExtractions(
          first,
          await ask(
            deps,
            "extract-missed",
            {
              instructions: extractionInstructions(deps.language),
              input: `${knownEntitiesBlock(liveEntities(state))}\n\n${sceneBlock(scene)}\n\n${missedSentencesBlock(missed)}`,
              structured: { name: "scene_extraction", schema: EXTRACTION_SCHEMA },
            },
            validateExtraction,
          ),
        );
  const discarded: string[] = [];
  const isLiteral = (quote: string) => {
    if (quote !== "" && scene.text.includes(quote)) {
      return true;
    }
    discarded.push(quote);
    return false;
  };
  const facts = raw.facts.filter((fact) => isLiteral(fact.quote));
  const relations = raw.relations.filter((relation) => isLiteral(relation.quote));
  return {
    extraction: separateNamesakes(
      {
        entities: withUnlistedEntities(
          raw.entities.map((entity) => usableAliases(entity, scene.text)),
          [...facts.map((fact) => fact.entity), ...relations.flatMap((r) => [r.from, r.to])],
          scene.text,
        ),
        facts,
        relations,
      },
      scene.text,
    ),
    discarded,
  };
}

/**
 * Models often state a fact about something they left out of their list of entities, as with a good
 * fact about "veda". The fact counts if the scene really names it. Taken for "lore" here, it still
 * joins any known place or person of that name in the next step.
 */
function withUnlistedEntities(
  listed: readonly ExtractedEntity[],
  used: readonly string[],
  sceneText: string,
): ExtractedEntity[] {
  const entities = [...listed];
  const text = sceneText.toLocaleLowerCase();
  for (const name of new Set(used)) {
    const known = entities.some((entity) =>
      namesOf(entity).some(
        (other) => nameKey(other) === nameKey(name) || isPartOfName(name, other),
      ),
    );
    if (!known && nameTokens(name).length > 0 && text.includes(name.toLocaleLowerCase())) {
      entities.push({ name, type: "lore", aliases: [] });
    }
  }
  return entities;
}

const namesOf = (entity: ExtractedEntity) => [entity.name, ...entity.aliases];

/** Adds a second reading to the first, joining the entities both of them named. */
function mergeExtractions(first: Extraction, second: Extraction): Extraction {
  const entities = [...first.entities];
  for (const entity of second.entities) {
    const keys = new Set(namesOf(entity).map(nameKey));
    const index = entities.findIndex((other) =>
      namesOf(other).some((name) => keys.has(nameKey(name))),
    );
    const same = entities[index];
    if (same === undefined) {
      entities.push(entity);
    } else {
      entities[index] = {
        ...same,
        aliases: [...new Set([...same.aliases, ...namesOf(entity)])].filter(
          (name) => name !== same.name,
        ),
      };
    }
  }
  return {
    entities,
    facts: [...first.facts, ...second.facts],
    relations: [...first.relations, ...second.relations],
  };
}

/**
 * Undoes a merge the text rules out. Models tend to fold "Luis, el cartero" into "Luis Ferrer, el
 * alcalde" whatever they're told, so this reads who's who from the text, and also moves their facts.
 */
function separateNamesakes(extraction: Extraction, sceneText: string): Extraction {
  let { entities, facts, relations } = extraction;
  for (const [shorter, longer] of namesakesIn(sceneText)) {
    const names = [shorter.name, shorter.epithet, longer.name, longer.epithet].map(nameKey);
    const isInvolved = (name: string) => names.includes(nameKey(name));
    const others = entities.filter((entity) => !namesOf(entity).some(isInvolved));
    const involved = entities.filter((entity) => namesOf(entity).some(isInvolved));
    const type = involved[0]?.type ?? "person";
    const inherited = involved.flatMap(namesOf).filter((name) => !isInvolved(name));
    entities = [
      ...others,
      { name: shorter.name, type, aliases: [shorter.epithet] },
      { name: longer.name, type, aliases: [longer.epithet, ...new Set(inherited)] },
    ];
    const whoIn = (quote: string, current: string) => {
      const sentence = sentenceAround(sceneText, quote);
      if (sentence.includes(longer.name) || sentence.includes(longer.epithet)) {
        return longer.name;
      }
      if (sentence.includes(shorter.name) || sentence.includes(shorter.epithet)) {
        return shorter.name;
      }
      return current;
    };
    facts = facts.map((fact) =>
      isInvolved(fact.entity) ? { ...fact, entity: whoIn(fact.quote, fact.entity) } : fact,
    );
    relations = relations.map((relation) => ({
      ...relation,
      from: isInvolved(relation.from) ? whoIn(relation.quote, relation.from) : relation.from,
      to: isInvolved(relation.to) ? whoIn(relation.quote, relation.to) : relation.to,
    }));
  }
  return { entities, facts, relations };
}

/**
 * Keeps only what can really name someone. Models tend to add articles and family words, and "su
 * hermano" would later match any character's brother. A name must also appear in the scene.
 */
function usableAliases(extracted: ExtractedEntity, sceneText: string): ExtractedEntity {
  const usable = extracted.aliases.filter(
    (alias) =>
      sceneText.includes(alias) &&
      nameTokens(alias).length > 0 &&
      !/^(su|sus|mi|mis|tu|tus|his|her|their|my|your)\s/i.test(alias.trim()) &&
      !looksLikeVariant(alias, extracted.name),
  );
  return { ...extracted, aliases: [...new Set(usable)] };
}

/** How one extracted entity relates to the known ones, using only the names. */
function matchByName(
  extracted: ExtractedEntity,
  known: readonly Entity[],
  taken: ReadonlySet<string>,
): { kind: "same"; id: string } | { kind: "ambiguous" } | { kind: "new" } {
  const keys = new Set(namesOf(extracted).map(nameKey));
  const exact = known.filter((entity) =>
    [entity.canonicalName, ...entity.aliases].some((name) => keys.has(nameKey(name))),
  );
  const [onlyExact] = exact;
  if (exact.length === 1 && onlyExact !== undefined) {
    return { kind: "same", id: onlyExact.id };
  }
  if (exact.length > 1) {
    return { kind: "ambiguous" };
  }
  const partial = known.filter(
    (entity) =>
      entity.type === extracted.type &&
      !taken.has(entity.id) &&
      namesOf(extracted).some((name) =>
        [entity.canonicalName, ...entity.aliases].some((other) => isPartOfName(name, other)),
      ),
  );
  const [onlyPartial] = partial;
  if (partial.length === 1 && onlyPartial !== undefined) {
    return { kind: "same", id: onlyPartial.id };
  }
  return partial.length > 1 ? { kind: "ambiguous" } : { kind: "new" };
}

/** Step 2: code settles what names alone can, and the model only sees what's left. */
async function resolve(
  state: AnalysisState,
  scene: SceneToAnalyze,
  extraction: Extraction,
  deps: AnalysisDeps,
  newId: () => string,
): Promise<{ entities: Entity[]; nameToId: Map<string, string> }> {
  const entities = [...state.entities];
  const nameToId = new Map<string, string>();
  const taken = new Set<string>();
  const decided = new Map<ExtractedEntity, string | null>();
  const toAsk: ExtractedEntity[] = [];

  for (const extracted of extraction.entities) {
    const match = matchByName(extracted, state.entities, taken);
    if (match.kind === "same") {
      decided.set(extracted, match.id);
      taken.add(match.id);
    } else if (match.kind === "ambiguous" || isEpithet(extracted.name)) {
      toAsk.push(extracted);
    } else {
      decided.set(extracted, null);
    }
  }

  if (toAsk.length > 0 && state.entities.length > 0) {
    const answers: readonly IdentityAnswer[] = await ask(
      deps,
      "resolve",
      {
        instructions: identityInstructions(),
        input: `${knownEntitiesBlock(liveEntities(state))}\n\n${sceneBlock(scene)}\n\nNAMES TO DECIDE:\n${toAsk
          .map((entity) => `- ${entity.name}`)
          .join("\n")}`,
        structured: { name: "identity_answers", schema: IDENTITY_SCHEMA },
      },
      validateIdentities,
    );
    for (const extracted of toAsk) {
      const answer = answers.find((item) => nameKey(item.name) === nameKey(extracted.name));
      const id = answer?.entity_id ?? null;
      // An answer naming an entity that doesn't exist is treated as no answer.
      const exists = id !== null && state.entities.some((entity) => entity.id === id);
      decided.set(extracted, exists ? id : null);
    }
  } else {
    for (const extracted of toAsk) {
      decided.set(extracted, null);
    }
  }

  for (const extracted of extraction.entities) {
    const existingId = decided.get(extracted) ?? null;
    if (existingId === null) {
      const id = newId();
      entities.push({
        id,
        type: extracted.type,
        canonicalName: extracted.name,
        aliases: [...new Set(namesOf(extracted))],
      });
      for (const name of namesOf(extracted)) {
        nameToId.set(nameKey(name), id);
      }
    } else {
      const index = entities.findIndex((entity) => entity.id === existingId);
      const entity = entities[index];
      if (entity !== undefined) {
        entities[index] = {
          ...entity,
          aliases: [...new Set([...entity.aliases, ...namesOf(extracted)])],
        };
      }
      for (const name of namesOf(extracted)) {
        nameToId.set(nameKey(name), existingId);
      }
    }
  }
  return { entities, nameToId };
}

/** The id for a name used in a fact or a relation, which may not be listed among the entities. */
function idForName(
  name: string,
  nameToId: ReadonlyMap<string, string>,
  entities: readonly Entity[],
) {
  const direct = nameToId.get(nameKey(name));
  if (direct !== undefined) {
    return direct;
  }
  const known = entities.filter((entity) =>
    [entity.canonicalName, ...entity.aliases].some(
      (other) => nameKey(other) === nameKey(name) || isPartOfName(name, other),
    ),
  );
  return known.length === 1 ? known[0]?.id : undefined;
}

const namesInQuote = (quote: string, name: string) =>
  new RegExp(`(?<!\\p{L})${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\p{L})`, "u").test(
    quote,
  );

/**
 * The owner of a fact the model filed under something the scene doesn't name, such as an event it
 * made up. A literal quote naming just one known entity says whose it is.
 */
function onlyEntityNamedIn(quote: string, entities: readonly Entity[]): string | undefined {
  const named = entities.filter((entity) =>
    [entity.canonicalName, ...entity.aliases].some(
      (name) => nameTokens(name).length > 0 && namesInQuote(quote, name),
    ),
  );
  return named.length === 1 ? named[0]?.id : undefined;
}

/** A fact stated in a line of dialogue: the quote sits in a line opened by a dash. */
function isInDialogue(sceneText: string, quote: string): boolean {
  const at = sceneText.indexOf(quote);
  if (at < 0) {
    return false;
  }
  const lineStart = sceneText.lastIndexOf("\n", at) + 1;
  return /^\s*[—–-]/.test(sceneText.slice(lineStart, at + 1));
}

function mentionsIn(scene: SceneToAnalyze, entities: readonly Entity[]): Mention[] {
  const mentions: Mention[] = [];
  for (const entity of entities) {
    for (const name of new Set([entity.canonicalName, ...entity.aliases])) {
      if (name !== "" && scene.text.includes(name)) {
        mentions.push({ sceneId: scene.id, entityId: entity.id, quote: name });
      }
    }
  }
  return mentions;
}

/**
 * Capitalized words in the scene that look like a misspelled known name. It reads the text rather
 * than the model's answer, because a model may well decide "Thomas" is just "Tomás" and say nothing.
 */
function variantsInText(
  scene: SceneToAnalyze,
  known: readonly Entity[],
  mentions: readonly Mention[],
): Issue[] {
  const knownTokens = known.flatMap((entity) =>
    [entity.canonicalName, ...entity.aliases].flatMap((name) =>
      nameTokens(name).map((token) => ({ entity, token })),
    ),
  );
  const exact = new Set(knownTokens.map((item) => item.token));
  const issues: Issue[] = [];
  const words = new Set(scene.text.match(/\p{Lu}\p{L}+/gu) ?? []);
  for (const word of words) {
    if (exact.has(nameKey(word))) {
      continue;
    }
    const match = knownTokens.find(
      (item) => item.entity.type === "person" && looksLikeVariant(word, item.token),
    );
    const first = match && mentions.find((mention) => mention.entityId === match.entity.id);
    if (match !== undefined && first !== undefined) {
      issues.push({
        kind: "name_variant",
        a: { sceneId: first.sceneId, quote: first.quote },
        b: { sceneId: scene.id, quote: word },
        reason: `«${word}» y «${first.quote}» podrían ser el mismo nombre.`,
      });
    }
  }
  return issues;
}

/** Names that look like one misspelled as the other, which only the author can settle. */
function nameVariantIssues(
  state: AnalysisState,
  before: readonly Entity[],
  after: readonly Entity[],
  mentions: readonly Mention[],
): Issue[] {
  const issues: Issue[] = [];
  const allMentions = [...state.mentions, ...mentions];
  const added = after.filter((entity) => !before.some((old) => old.id === entity.id));
  for (const entity of added) {
    for (const other of after) {
      if (other.id === entity.id || other.type !== entity.type) {
        continue;
      }
      const pair = [entity.canonicalName, ...entity.aliases].flatMap((name) =>
        [other.canonicalName, ...other.aliases]
          .filter((otherName) => looksLikeVariant(name, otherName))
          .map((otherName) => [name, otherName] as const),
      )[0];
      if (pair === undefined) {
        continue;
      }
      const a = allMentions.find((m) => m.entityId === other.id && m.quote === pair[1]);
      const b = allMentions.find((m) => m.entityId === entity.id && m.quote === pair[0]);
      if (a !== undefined && b !== undefined) {
        issues.push({
          kind: "name_variant",
          a: { sceneId: a.sceneId, quote: a.quote },
          b: { sceneId: b.sceneId, quote: b.quote },
          reason: `«${pair[0]}» y «${pair[1]}» podrían ser el mismo nombre.`,
        });
        break;
      }
    }
  }
  return issues;
}

function factLine(
  fact: Fact,
  tag: string,
  sceneNumber: number,
  entities: readonly Entity[],
): string {
  const name = entities.find((entity) => entity.id === fact.entityId)?.canonicalName ?? "?";
  const dialogue = fact.inDialogue ? " (dialogue)" : "";
  const when = fact.storyTime === null ? "" : ` [when: ${fact.storyTime}]`;
  return `${tag} scene ${sceneNumber}${dialogue}${when} | ${name} | ${fact.attribute}: ${fact.value} | "${fact.sentence}"`;
}

/** Compared per entity: a trait of one person says nothing about another. */
const PER_ENTITY: readonly ComparedCategory[] = [
  "physical",
  "age",
  "marital_status",
  "family",
  "job",
  "alive_or_dead",
];

/** Compared across entities: the same trip or the same pair of people can be told from either side. */
const ACROSS_ENTITIES: readonly ComparedCategory[] = [
  "relative_age",
  "date_of_event",
  "travel_time",
];

interface FactGroup {
  readonly category: ComparedCategory | "topic";
  readonly facts: readonly Fact[];
}

/** What can be done, as opposed to what someone is: it can't happen after dying. */
const DEEDS: ReadonlySet<string> = new Set([
  "action",
  "location",
  "thought",
  "possession",
  "other",
]);

const isSubset = (small: readonly Fact[], large: readonly Fact[]) =>
  small.every((fact) => large.includes(fact));

/**
 * Facts sharing a word, whatever category and person the model gave them. A model may file a start date
 * under what a character did, and this still sets it next to the other date. People's names don't count
 * as topics, or every fact about the protagonist would be one group.
 */
function topicGroups(
  known: readonly Fact[],
  newFacts: readonly Fact[],
  entities: readonly Entity[],
): FactGroup[] {
  const all = [...known, ...newFacts];
  const people = new Set(
    entities
      .filter((entity) => entity.type === "person")
      .flatMap((entity) => [entity.canonicalName, ...entity.aliases])
      .flatMap(nameWords),
  );
  const wordsOf = new Map(
    all.map((fact) => [fact, topicWords(`${fact.quote} ${fact.value}`, people)]),
  );
  const topics = new Set(newFacts.flatMap((fact) => [...(wordsOf.get(fact) ?? [])]));
  const groups: Fact[][] = [];
  for (const topic of topics) {
    const facts = all.filter((fact) => wordsOf.get(fact)?.has(topic));
    const scenes = new Set(facts.map((fact) => fact.sceneId));
    // Inside one scene, it's usually one sentence split into several facts.
    if (scenes.size >= 2 && facts.some((fact) => newFacts.includes(fact))) {
      groups.push(facts);
    }
  }
  return groups
    .sort((a, b) => a.length - b.length)
    .slice(0, MAX_TOPIC_GROUPS)
    .map((facts) => ({ category: "topic", facts }));
}

/**
 * Which facts to weigh together. Only facts of one kind, about one thing, and only groups with something
 * new in them. Actions and locations aren't compared with each other, as they change all the time:
 * that's also why a character lying about where they've been can't turn into a false alarm.
 */
function factGroups(
  known: readonly Fact[],
  newFacts: readonly Fact[],
  entities: readonly Entity[],
): FactGroup[] {
  const all = [...known, ...newFacts];
  const newIds = new Set(newFacts.map((fact) => fact.id));
  const groups: FactGroup[] = [];
  const add = (category: ComparedCategory, facts: readonly Fact[]) => {
    if (facts.length >= 2 && facts.some((fact) => newIds.has(fact.id))) {
      groups.push({ category, facts: facts.slice(-MAX_FACTS_IN_GROUP) });
    }
  };
  for (const category of ACROSS_ENTITIES) {
    add(
      category,
      all.filter((fact) => fact.category === category),
    );
  }
  for (const category of PER_ENTITY) {
    const entityIds = new Set(
      newFacts.filter((fact) => fact.category === category).map((fact) => fact.entityId),
    );
    for (const entityId of entityIds) {
      add(
        category,
        all.filter((fact) => fact.category === category && fact.entityId === entityId),
      );
    }
  }
  // The dead acting. A death can be filed under anything, and so can what they do later, which can
  // even be filed under someone else: "Marta got a call: her aunt asked her".
  const isDeath = (fact: Fact) => fact.category === "alive_or_dead" || speaksOfDeath(fact.quote);
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const deadIds = new Set(
    all
      .filter(isDeath)
      .filter((fact) => entityById.get(fact.entityId)?.type === "person")
      .map((fact) => fact.entityId),
  );
  for (const entityId of deadIds) {
    const names = [
      entityById.get(entityId)?.canonicalName ?? "",
      ...(entityById.get(entityId)?.aliases ?? []),
    ].filter((name) => name !== "");
    const deaths = all.filter((fact) => isDeath(fact) && fact.entityId === entityId);
    const deeds = newFacts.filter(
      (fact) =>
        !deaths.includes(fact) &&
        DEEDS.has(fact.category) &&
        (fact.entityId === entityId || names.some((name) => fact.quote.includes(name))),
    );
    if (deeds.length > 0) {
      add("alive_or_dead", [...deaths, ...deeds]);
    }
  }
  const unique = groups.filter(
    (group, index) =>
      !groups.some(
        (other, otherIndex) =>
          index !== otherIndex &&
          isSubset(group.facts, other.facts) &&
          // Of two equal groups, one stays.
          (other.facts.length > group.facts.length || otherIndex < index),
      ),
  );
  const topics = topicGroups(known, newFacts, entities).filter(
    (group, index, list) =>
      !unique.some((other) => isSubset(group.facts, other.facts)) &&
      !list.some(
        (other, otherIndex) =>
          index !== otherIndex &&
          isSubset(group.facts, other.facts) &&
          (other.facts.length > group.facts.length || otherIndex < index),
      ),
  );
  return [
    ...unique,
    ...topics.map((group) => ({ ...group, facts: group.facts.slice(-MAX_FACTS_IN_GROUP) })),
  ];
}

/** Step 3: new facts against the registry, without rereading the novel, in small groups. */
async function compare(
  state: AnalysisState,
  newFacts: readonly Fact[],
  entities: readonly Entity[],
  deps: AnalysisDeps,
): Promise<Issue[]> {
  const sceneNumber = (id: string) => state.sceneOrder.indexOf(id) + 1;
  const newIds = new Set(newFacts.map((fact) => fact.id));
  const issues: Issue[] = [];
  const seen = new Set<string>();

  for (const group of factGroups(state.facts, newFacts, entities)) {
    const ordered = [...group.facts].sort(
      (a, b) => sceneNumber(a.sceneId) - sceneNumber(b.sceneId),
    );
    const tagged = new Map<string, Fact>();
    const lines = ordered.map((fact, index) => {
      const tag = `F${index + 1}`;
      tagged.set(tag, fact);
      const line = factLine(fact, tag, sceneNumber(fact.sceneId), entities);
      return newIds.has(fact.id) ? `${line} NEW` : line;
    });
    const findings: readonly Finding[] = await ask(
      deps,
      `compare:${group.category}`,
      {
        instructions: comparisonInstructions(deps.language, group.category),
        input: `FACTS:\n${lines.join("\n")}`,
        structured: { name: "comparison", schema: COMPARISON_SCHEMA },
      },
      validateFindings,
    );
    for (const finding of findings) {
      if (finding.verdict !== "contradiction") {
        continue;
      }
      // Some models answer "F1, F2" for one conflict with two facts.
      for (const newTag of finding.new_fact.match(/F\d+/g) ?? []) {
        for (const otherTag of finding.other_fact.match(/F\d+/g) ?? []) {
          const a = tagged.get(otherTag);
          const b = tagged.get(newTag);
          if (
            a === undefined ||
            b === undefined ||
            // Two old facts were weighed when they were new. Stored here, this wouldn't come back
            // if the scene they cite were analysed again, as it doesn't cite the one being analysed.
            (!newIds.has(a.id) && !newIds.has(b.id)) ||
            // One sentence doesn't contradict itself: these are two readings of it.
            (a.sceneId === b.sceneId && a.sentence === b.sentence)
          ) {
            continue;
          }
          // By sentence: a model can find one conflict again through two facts of the same sentence.
          const key = [a.sentence, b.sentence].sort().join("|");
          if (!seen.has(key)) {
            seen.add(key);
            issues.push({
              kind: "contradiction",
              a: { sceneId: a.sceneId, quote: a.quote },
              b: { sceneId: b.sceneId, quote: b.quote },
              reason: finding.reason,
            });
          }
        }
      }
    }
  }
  return issues;
}

/** A line of dialogue opened with a hyphen. A rule, so it's found every time without any model. */
function dialogueDashIssues(scene: SceneToAnalyze): Issue[] {
  return scene.text.split("\n").flatMap((line): Issue[] => {
    const match = line.match(/^\s*(-\s?)\S/);
    if (match === null) {
      return [];
    }
    const sentence = line.trim().split(/[,.;:!?]/)[0] ?? line.trim();
    return [
      {
        kind: "correction",
        a: { sceneId: scene.id, quote: sentence },
        fix: sentence.replace(/^-\s?/, "—"),
        reason: "Los diálogos se abren con raya, no con guion.",
      },
    ];
  });
}

/**
 * Spanish misspellings mostly sound right, and letters alone can't tell them from another word: "halla"
 * is as near to the right "haya" as to the wrong "había". By sound, "haya" is the same word, and so is
 * "a ver" for "haber".
 */
function asItSounds(text: string, language: string): string {
  return language === "es"
    ? text
        .replace(/(?<!c)h/g, "")
        .replace(/v/g, "b")
        .replace(/ll/g, "y")
        .replace(/\s+/g, "")
    : text;
}

/**
 * Whether what a correction changes looks like the author's own word mistyped, rather than another
 * word. Rule 1 allows fixing a typo with one click, and not rewriting the author in small pieces:
 * "Cerró" for "Abrió" can be small, and it's still somebody else's sentence.
 */
function looksLikeTypo(before: string, after: string, language: string): boolean {
  const words = (text: string) => withoutAccents(text.toLocaleLowerCase()).split(/\s+/);
  const a = words(before);
  const b = words(after);
  while (a.length > 0 && a[0] === b[0]) {
    a.shift();
    b.shift();
  }
  while (a.length > 0 && a.at(-1) === b.at(-1)) {
    a.pop();
    b.pop();
  }
  // Nothing to compare with means a word was added or taken away, which isn't a typo.
  if (a.length === 0 || b.length === 0) {
    return a.length === b.length;
  }
  const left = asItSounds(a.join(" "), language);
  const right = asItSounds(b.join(" "), language);
  return editDistance(left, right) / Math.max(left.length, right.length, 1) <= MAX_TYPO_DISTANCE;
}

function isSmallCorrection(correction: Correction, sceneText: string, language: string): boolean {
  return (
    correction.quote !== correction.fix &&
    correction.quote !== "" &&
    sceneText.includes(correction.quote) &&
    looksLikeTypo(correction.quote, correction.fix, language)
  );
}

/** Step 5. Anything that isn't a small, literal fix is thrown away. */
async function proofread(scene: SceneToAnalyze, deps: AnalysisDeps): Promise<Issue[]> {
  const corrections = await ask(
    deps,
    "proofread",
    {
      instructions: proofreadInstructions(deps.language),
      input: sceneBlock(scene),
      structured: { name: "proofreading", schema: PROOFREAD_SCHEMA },
    },
    validateCorrections,
  );
  return corrections
    .filter((correction) => isSmallCorrection(correction, scene.text, deps.language))
    .map((correction) => ({
      kind: "correction",
      a: { sceneId: scene.id, quote: correction.quote },
      fix: correction.fix,
      reason: correction.reason,
    }));
}

/**
 * Analyses one scene, in the steps of SPEC §5, against what's known of the rest. Reanalysing a scene
 * first takes out everything that came from it. If the model can't be reached this throws, and the
 * state stays as it was, so that the scene can simply wait in the queue.
 */
export async function analyzeScene(
  current: AnalysisState,
  scene: SceneToAnalyze,
  deps: AnalysisDeps,
): Promise<SceneAnalysis> {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const state = withoutScene(current, scene.id);

  const { extraction, discarded } = await extract(state, scene, deps);
  const { entities, nameToId } = await resolve(state, scene, extraction, deps, newId);
  const mentions = mentionsIn(scene, entities);

  const unplacedFacts: string[] = [];
  const facts: Fact[] = extraction.facts.flatMap((fact) => {
    const entityId =
      idForName(fact.entity, nameToId, entities) ?? onlyEntityNamedIn(fact.quote, entities);
    if (entityId === undefined) {
      unplacedFacts.push(fact.quote);
      return [];
    }
    return [
      {
        id: newId(),
        sceneId: scene.id,
        entityId,
        category: fact.category,
        attribute: fact.attribute,
        value: fact.value,
        quote: fact.quote,
        sentence: sentenceAround(scene.text, fact.quote),
        storyTime: fact.story_time,
        inDialogue: isInDialogue(scene.text, fact.quote),
      },
    ];
  });
  const relations: Relation[] = extraction.relations.flatMap((relation) => {
    const fromEntityId = idForName(relation.from, nameToId, entities);
    const toEntityId = idForName(relation.to, nameToId, entities);
    return fromEntityId === undefined || toEntityId === undefined
      ? []
      : [
          {
            id: newId(),
            sceneId: scene.id,
            fromEntityId,
            toEntityId,
            label: relation.label,
            quote: relation.quote,
          },
        ];
  });

  const contradictions = await compare(state, facts, entities, deps);
  const corrections = await proofread(scene, deps);
  // The same pair can be found both ways: from the text and from a new entity.
  const variants = [
    ...variantsInText(scene, state.entities, state.mentions),
    ...nameVariantIssues(state, state.entities, entities, mentions),
  ].filter(
    (issue, index, all) =>
      all.findIndex((other) => "b" in other && "b" in issue && other.b.quote === issue.b.quote) ===
      index,
  );

  return {
    state: {
      ...state,
      entities,
      mentions: [...state.mentions, ...mentions],
      facts: [...state.facts, ...facts],
      relations: [...state.relations, ...relations],
      issues: [
        ...state.issues,
        ...contradictions,
        ...variants,
        ...dialogueDashIssues(scene),
        ...corrections,
      ],
    },
    discardedQuotes: discarded,
    unplacedFacts,
  };
}
