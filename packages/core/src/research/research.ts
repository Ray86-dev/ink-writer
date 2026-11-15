import { nameKey } from "../analysis/names";
import type { EntityRef, NovelView } from "../cards/cards";
import type { HintSettings } from "../hints/hints";
import type { Storage, StoredResearchItem, StoredResearchTopic } from "../storage/storage";
import {
  type FoundItem,
  ITEM_CATEGORIES,
  type ItemCategory,
  isSourceUrl,
  type PlaceCandidate,
  parseClimate,
  parseGeocode,
  parseNearby,
  parseWiki,
  type ResearchRequest,
  type ResearchTransport,
} from "./sources";
import { checkTerm, requireTerm, TermRefusedError } from "./terms";

/**
 * Documentation (SPEC §3.7 and §7): what the app looks up about the places and topics of the novel.
 * It searches for the topic, never for a character or the text. A place is only looked up after the
 * author says it exists. Everything found is kept with its source, and is no part of the novel until
 * the author takes it to their notes.
 */

export type Reality = "real" | "based" | "invented";
export type TopicKind = "place" | "era" | "topic";
export type TopicStatus = "pending" | "done" | "failed";
export type ItemStatus = "suggested" | "noted" | "dismissed";

export interface ResearchTopic {
  readonly id: string;
  readonly kind: TopicKind;
  /** For a place, what the novel calls it. Otherwise, the term itself. */
  readonly name: string;
  readonly reality: Reality | null;
  /** What's searched for. Null for an invented place: nothing is. */
  readonly term: string | null;
  /** The real place the author chose on the map, if they did. */
  readonly place: PlaceCandidate | null;
  readonly status: TopicStatus;
  readonly searchedAt: number | null;
}

export interface ResearchItem extends FoundItem {
  readonly id: string;
  readonly topicId: string;
  readonly retrievedAt: number;
  readonly status: ItemStatus;
}

const KINDS: readonly TopicKind[] = ["place", "era", "topic"];
const REALITIES: readonly Reality[] = ["real", "based", "invented"];
const STATUSES: readonly TopicStatus[] = ["pending", "done", "failed"];
const ITEM_STATUSES: readonly ItemStatus[] = ["suggested", "noted", "dismissed"];

function toPlace(stored: string | null): PlaceCandidate | null {
  if (stored === null) {
    return null;
  }
  try {
    const value = JSON.parse(stored) as Record<string, unknown> | null;
    if (
      value !== null &&
      typeof value.label === "string" &&
      typeof value.lat === "number" &&
      typeof value.lon === "number" &&
      isSourceUrl(value.url)
    ) {
      return { label: value.label, lat: value.lat, lon: value.lon, url: value.url };
    }
  } catch {
    // Unreadable counts as not chosen.
  }
  return null;
}

/** Null for a row this version can't read. */
export function toTopic(stored: StoredResearchTopic): ResearchTopic | null {
  if (
    !KINDS.includes(stored.kind as TopicKind) ||
    !STATUSES.includes(stored.status as TopicStatus)
  ) {
    return null;
  }
  return {
    id: stored.id,
    kind: stored.kind as TopicKind,
    name: stored.name,
    reality: REALITIES.includes(stored.reality as Reality) ? (stored.reality as Reality) : null,
    term: stored.term,
    place: toPlace(stored.place),
    status: stored.status as TopicStatus,
    searchedAt: stored.searchedAt,
  };
}

/** Null for anything without a source that can be followed: it's never shown (rule 3). */
export function toItem(stored: StoredResearchItem): ResearchItem | null {
  if (
    !isSourceUrl(stored.sourceUrl) ||
    stored.sourceTitle.trim() === "" ||
    stored.text.trim() === "" ||
    !ITEM_CATEGORIES.includes(stored.category as ItemCategory) ||
    !ITEM_STATUSES.includes(stored.status as ItemStatus)
  ) {
    return null;
  }
  return {
    id: stored.id,
    topicId: stored.topicId,
    category: stored.category as ItemCategory,
    text: stored.text,
    sourceUrl: stored.sourceUrl,
    sourceTitle: stored.sourceTitle,
    retrievedAt: stored.retrievedAt,
    status: stored.status as ItemStatus,
  };
}

export interface StoredResearch {
  readonly topics: readonly ResearchTopic[];
  readonly items: readonly ResearchItem[];
}

export const NO_RESEARCH: StoredResearch = { topics: [], items: [] };

export async function loadResearch(storage: Storage, projectId: string): Promise<StoredResearch> {
  const [topics, items] = await Promise.all([
    storage.listResearchTopics(projectId),
    storage.listResearchItems(projectId),
  ]);
  return {
    topics: topics.flatMap((topic) => toTopic(topic) ?? []),
    items: items.flatMap((item) => toItem(item) ?? []),
  };
}

const PRESENT_WORDS =
  /(^|[^\p{L}])(actualidad|actual|presente|hoy|contemporane[ao]|siglo xxi|present|present day|today|nowadays|now|contemporary|current|modern day|21st century)($|[^\p{L}])/u;

/**
 * True only if the era clearly says "now". The map only knows the present, so anything else, an
 * era this can't make out included, is treated as the past and gets no streets or premises.
 */
export function isPresentEra(era: string, thisYear: number): boolean {
  const plain = era.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const years = [...plain.matchAll(/\d{3,4}/g)].map((match) => Number(match[0]));
  if (years.length > 0) {
    return years.every((year) => year >= thisYear - 5 && year <= thisYear + 1);
  }
  return PRESENT_WORDS.test(plain);
}

/** Every name and alias of every character: what a search term must never contain. */
export function peopleNames(view: NovelView): string[] {
  return view.cards
    .filter((card) => card.type === "person")
    .flatMap((card) => [card.name, ...card.aliases]);
}

export interface TopicView {
  readonly topic: ResearchTopic;
  /** What was found and not discarded, with what's in the author's notes first. */
  readonly items: readonly ResearchItem[];
}

export interface PlaceView {
  readonly card: EntityRef;
  /** Null until the author says whether the place exists. Nothing is searched before that. */
  readonly topic: ResearchTopic | null;
  readonly items: readonly ResearchItem[];
}

export interface ResearchView {
  /**
   * Whether the app searches by itself. With hints off, or with the documentation kind off, it only
   * searches when the author presses "Search now" (SPEC §7).
   */
  readonly proactive: boolean;
  readonly presentEra: boolean;
  readonly places: readonly PlaceView[];
  /** The era of the story as a topic, when it isn't the present. */
  readonly era: {
    readonly term: string;
    readonly topic: ResearchTopic | null;
    readonly items: readonly ResearchItem[];
  } | null;
  /** The topics the author added. */
  readonly topics: readonly TopicView[];
}

export interface ResearchViewInput {
  readonly view: NovelView;
  readonly era: string;
  readonly settings: HintSettings;
  readonly research: StoredResearch;
  readonly thisYear: number;
}

export function buildResearchView(input: ResearchViewInput): ResearchView {
  const { view, settings, research, thisYear } = input;
  const era = input.era.trim();
  const itemsOf = (topic: ResearchTopic | null): ResearchItem[] =>
    topic === null
      ? []
      : research.items
          .filter((item) => item.topicId === topic.id && item.status !== "dismissed")
          .sort((a, b) => Number(b.status === "noted") - Number(a.status === "noted"));

  const places = view.cards
    .filter((card) => card.type === "place")
    .map((card): PlaceView => {
      const keys = new Set([card.name, ...card.aliases].map(nameKey));
      const topic =
        research.topics.find((item) => item.kind === "place" && keys.has(nameKey(item.name))) ??
        null;
      return {
        card: { id: card.id, name: card.name, type: card.type },
        topic,
        items: itemsOf(topic),
      };
    });

  const presentEra = isPresentEra(era, thisYear);
  const eraTopic =
    research.topics.find((topic) => topic.kind === "era" && topic.name === era) ?? null;

  return {
    proactive: settings.level !== "off" && settings.types.documentation,
    presentEra,
    places,
    era: era === "" || presentEra ? null : { term: era, topic: eraTopic, items: itemsOf(eraTopic) },
    topics: research.topics
      .filter((topic) => topic.kind === "topic")
      .map((topic) => ({ topic, items: itemsOf(topic) })),
  };
}

/** A search that couldn't go on, and that trying again right now won't fix. */
export class ResearchStoppedError extends Error {
  override readonly name = "ResearchStoppedError";

  constructor(
    /** The day's searches are used up, or a service asked for a pause. */
    readonly reason: "limit" | "wait",
    message: string,
  ) {
    super(message);
  }
}

function stopped(error: unknown): ResearchStoppedError | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("limit:")) return new ResearchStoppedError("limit", message);
  if (message.startsWith("wait:")) return new ResearchStoppedError("wait", message);
  return null;
}

export interface ResearchDeps {
  readonly storage: Storage;
  readonly transport: ResearchTransport;
  readonly projectId: string;
  /** The project's language: what's found is in it, where the service allows. */
  readonly language: string;
  readonly era: string;
  /** From `peopleNames`. No search term may contain any of them. */
  readonly people: readonly string[];
  readonly now?: () => Date;
}

/** Wikipedia has an address per language, named by its code. Anything else gets the English one. */
function wikiLanguage(language: string): string {
  const code = language.toLowerCase().split(/[-_]/)[0] ?? "";
  return /^[a-z]{2,3}$/.test(code) ? code : "en";
}

async function ask(transport: ResearchTransport, request: ResearchRequest): Promise<string> {
  let answer: Awaited<ReturnType<ResearchTransport["fetch"]>>;
  try {
    answer = await transport.fetch(request);
  } catch (error) {
    throw stopped(error) ?? error;
  }
  if (answer.status !== 200) {
    throw new Error(`The service answered ${answer.status}`);
  }
  return answer.body;
}

/** The real places a name may mean, for the author to choose from. Only the name is sent. */
export async function findPlaces(
  deps: Pick<ResearchDeps, "transport" | "language" | "people">,
  term: string,
): Promise<PlaceCandidate[]> {
  const checked = requireTerm(term, deps.people);
  return parseGeocode(
    await ask(deps.transport, {
      kind: "geocode",
      term: checked,
      language: wikiLanguage(deps.language),
    }),
  );
}

export type PlaceAnswer =
  /** Made up from nothing: nothing is searched, and the author is asked about it instead. */
  | { readonly reality: "invented" }
  | {
      readonly reality: "real" | "based";
      /** The name of the real place. */
      readonly term: string;
      /** Where it is, if the author chose it on the map. */
      readonly place: PlaceCandidate | null;
    };

async function saveTopic(
  storage: Storage,
  topic: Parameters<Storage["saveResearchTopic"]>[0],
): Promise<ResearchTopic> {
  const saved = toTopic(await storage.saveResearchTopic(topic));
  if (saved === null) {
    throw new Error("The topic wasn't stored");
  }
  return saved;
}

/** Keeps what the author said about a place. A new answer takes the place of the old one. */
export async function answerPlace(
  storage: Storage,
  projectId: string,
  name: string,
  answer: PlaceAnswer,
  people: readonly string[],
): Promise<ResearchTopic> {
  if (answer.reality === "invented") {
    return saveTopic(storage, {
      projectId,
      kind: "place",
      name,
      reality: "invented",
      term: null,
      place: null,
      status: "done",
    });
  }
  return saveTopic(storage, {
    projectId,
    kind: "place",
    name,
    reality: answer.reality,
    term: requireTerm(answer.term, people),
    place: answer.place === null ? null : JSON.stringify(answer.place),
    status: "pending",
  });
}

/** A topic the author wants looked up: a trade, an object, a custom. */
export async function addTopic(
  storage: Storage,
  projectId: string,
  term: string,
  people: readonly string[],
): Promise<ResearchTopic> {
  const checked = requireTerm(term, people);
  return saveTopic(storage, {
    projectId,
    kind: "topic",
    name: checked,
    reality: null,
    term: checked,
    place: null,
    status: "pending",
  });
}

/** The story's era as a topic. */
export async function addEraTopic(
  storage: Storage,
  projectId: string,
  era: string,
  people: readonly string[],
): Promise<ResearchTopic> {
  const checked = requireTerm(era, people);
  return saveTopic(storage, {
    projectId,
    kind: "era",
    name: era.trim(),
    reality: null,
    term: checked,
    place: null,
    status: "pending",
  });
}

const CLIMATE_YEARS = 5;

/**
 * Looks one topic up and stores what was found, once. `done` if every source answered, `failed` if
 * any didn't: what the others found is kept all the same. If the day's searches run out halfway,
 * nothing is stored and the topic stays for later.
 */
export async function searchTopic(deps: ResearchDeps, topic: ResearchTopic): Promise<TopicStatus> {
  if (topic.term === null) {
    return topic.status;
  }
  // Checked again: a character may have been given this name since the topic was stored.
  const problem = checkTerm(topic.term, deps.people);
  if (problem !== null) {
    await deps.storage.saveResearchResult(topic.id, "failed", []);
    throw new TermRefusedError(topic.term, problem);
  }
  const thisYear = (deps.now?.() ?? new Date()).getFullYear();
  const language = wikiLanguage(deps.language);
  const point = topic.place;

  const sources: (() => Promise<FoundItem[]>)[] = [
    async () =>
      parseWiki(await ask(deps.transport, { kind: "wiki", term: topic.term as string, language })),
  ];
  if (point !== null) {
    sources.push(async () =>
      parseClimate(
        await ask(deps.transport, {
          kind: "climate",
          lat: point.lat,
          lon: point.lon,
          firstYear: thisYear - CLIMATE_YEARS,
          lastYear: thisYear - 1,
        }),
        language,
      ),
    );
    // The map shows today's streets and premises: no use, and misleading, for a story in the past.
    if (isPresentEra(deps.era, thisYear)) {
      sources.push(async () =>
        parseNearby(
          await ask(deps.transport, { kind: "nearby", lat: point.lat, lon: point.lon }),
          point,
          language,
        ),
      );
    }
  }

  const found: FoundItem[] = [];
  let status: TopicStatus = "done";
  for (const source of sources) {
    try {
      found.push(...(await source()));
    } catch (error) {
      if (error instanceof ResearchStoppedError) {
        throw error;
      }
      status = "failed";
    }
  }
  await deps.storage.saveResearchResult(
    topic.id,
    status,
    found.filter((item) => isSourceUrl(item.sourceUrl) && item.sourceTitle.trim() !== ""),
  );
  return status;
}

export interface PendingOutcome {
  /** How many topics were looked up. */
  readonly searched: number;
  /** Why it stopped before the end, if it did. */
  readonly stopped: "limit" | "wait" | null;
}

/**
 * Looks up what's waiting, each topic once: the places the author said exist, the era if it isn't
 * the present, and the topics they added. Does nothing unless the app may search by itself.
 */
export async function searchPending(
  deps: ResearchDeps,
  view: ResearchView,
): Promise<PendingOutcome> {
  if (!view.proactive) {
    return { searched: 0, stopped: null };
  }
  const waiting: ResearchTopic[] = [
    ...view.places.flatMap((place) => place.topic ?? []),
    ...view.topics.map((item) => item.topic),
  ].filter((topic) => topic.status === "pending" && topic.term !== null);
  if (view.era !== null) {
    if (view.era.topic === null) {
      // An era that can't be searched for, as one that names a character, is simply left alone.
      if (checkTerm(view.era.term, deps.people) === null) {
        waiting.push(await addEraTopic(deps.storage, deps.projectId, view.era.term, deps.people));
      }
    } else if (view.era.topic.status === "pending") {
      waiting.push(view.era.topic);
    }
  }

  let searched = 0;
  for (const topic of waiting) {
    try {
      await searchTopic(deps, topic);
      searched += 1;
    } catch (error) {
      if (error instanceof ResearchStoppedError) {
        return { searched, stopped: error.reason };
      }
      if (!(error instanceof TermRefusedError)) {
        throw error;
      }
    }
  }
  return { searched, stopped: null };
}
