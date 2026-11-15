import type { EntityCard, NovelView } from "../cards/cards";

/**
 * The novel as a network, for the Dashboard (SPEC §3.1): chapters, people, places and lore, and what
 * ties them together. Worked out from the cards, with no model. Painting it costs more with each
 * node and link, so only the main ones are in it; everything else stays in the cards (DESIGN.md).
 */

export type NetworkKind = "chapter" | "person" | "place" | "lore";

export interface NetworkNode {
  /** Unique in the network: a chapter and a card may share the id they have in the novel. */
  readonly key: string;
  readonly kind: NetworkKind;
  /** The id of the chapter or of the card. */
  readonly id: string;
  readonly name: string;
  /** The name, cut short if it's long. */
  readonly label: string;
  /** Something about it is still to be resolved. */
  readonly conflict: boolean;
  /** Where it floats, each axis within about -1 and 1. */
  readonly position: readonly [number, number, number];
  /** How big it's drawn. */
  readonly radius: number;
  /** Links away from the first chapter: the order in which the ink reaches it. */
  readonly depth: number;
}

export interface NetworkLink {
  /** The end the ink reaches first. */
  readonly from: string;
  readonly to: string;
  readonly strength: number;
  readonly depth: number;
}

export interface Network {
  readonly nodes: readonly NetworkNode[];
  readonly links: readonly NetworkLink[];
  /** What the novel has and the network leaves out. */
  readonly hidden: { readonly chapters: number; readonly cards: number };
}

export interface NetworkLimits {
  readonly nodes: number;
  readonly links: number;
}

/** What the demo was drawn with, and what's been seen to run smoothly (DESIGN.md). */
export const NETWORK_LIMITS: NetworkLimits = { nodes: 16, links: 24 };

export const EMPTY_NETWORK: Network = { nodes: [], links: [], hidden: { chapters: 0, cards: 0 } };

const LABEL_CHARS = 20;

const chapterKey = (id: string) => `chapter:${id}`;
const cardKey = (id: string) => `card:${id}`;

function shorten(name: string): string {
  const clean = name.trim();
  return clean.length <= LABEL_CHARS ? clean : `${clean.slice(0, LABEL_CHARS - 1).trimEnd()}…`;
}

/** The cards that matter most first: what's unresolved, then what the novel returns to most. */
function byPresence(a: EntityCard, b: EntityCard): number {
  return (
    Number(b.issues.length > 0) - Number(a.issues.length > 0) ||
    b.scenes.length - a.scenes.length ||
    b.facts.length - a.facts.length ||
    a.name.localeCompare(b.name)
  );
}

type Vec = [number, number, number];

const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value));

/**
 * Chapters run in a line from left to right, and everything else settles around the chapters it's
 * tied to. No randomness: the same novel always gives the same picture.
 */
function layout(
  chapters: readonly string[],
  others: readonly string[],
  pairs: readonly (readonly [string, string])[],
): Map<string, Vec> {
  const at = new Map<string, Vec>();
  chapters.forEach((key, index) => {
    const t = chapters.length === 1 ? 0.5 : index / (chapters.length - 1);
    at.set(key, [-1 + 2 * t, -0.35 + 0.7 * t, index % 2 === 0 ? 0.15 : -0.25]);
  });

  const neighbours = new Map<string, string[]>();
  for (const [a, b] of pairs) {
    neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
    neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
  }

  others.forEach((key, index) => {
    const anchors = (neighbours.get(key) ?? []).flatMap((other) => {
      const found = at.get(other);
      return found === undefined || !chapters.includes(other) ? [] : [found];
    });
    const mean = (axis: 0 | 1) =>
      anchors.length === 0
        ? 0
        : anchors.reduce((sum, item) => sum + item[axis], 0) / anchors.length;
    // The golden angle spreads them evenly, alternating above and below the line of chapters.
    const angle = index * 2.399963;
    const reach = 0.55 + 0.25 * ((index * 0.618) % 1);
    at.set(key, [
      mean(0) + 0.35 * Math.cos(angle),
      mean(1) + reach * Math.sin(angle),
      0.6 * Math.cos(angle * 1.7 + index),
    ]);
  });

  const keys = [...chapters, ...others];
  const fixed = new Set(chapters);
  for (let round = 0; round < 80; round += 1) {
    const push = new Map<string, Vec>(others.map((key) => [key, [0, 0, 0]]));
    for (const a of others) {
      const pa = at.get(a) as Vec;
      const force = push.get(a) as Vec;
      for (const b of keys) {
        if (a === b) continue;
        const pb = at.get(b) as Vec;
        const delta: Vec = [pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]];
        const distance = Math.hypot(...delta) || 0.001;
        // Too close: apart. Depth counts for less, since it's the flat picture that gets crowded.
        const flat = Math.hypot(delta[0], delta[1]) || 0.001;
        if (flat < 0.5) {
          const strength = (0.5 - flat) * 0.25;
          force[0] += (delta[0] / flat) * strength;
          force[1] += (delta[1] / flat) * strength;
        }
        if ((neighbours.get(a) ?? []).includes(b) && distance > 0.7) {
          const strength = (distance - 0.7) * 0.08;
          force[0] -= (delta[0] / distance) * strength;
          force[1] -= (delta[1] / distance) * strength;
          force[2] -= (delta[2] / distance) * strength;
        }
      }
    }
    for (const key of others) {
      if (fixed.has(key)) continue;
      const position = at.get(key) as Vec;
      const force = push.get(key) as Vec;
      at.set(key, [
        clamp(position[0] + force[0], 1.1),
        clamp(position[1] + force[1], 0.85),
        clamp(position[2] + force[2], 0.8),
      ]);
    }
  }
  return at;
}

export function buildNetwork(view: NovelView, limits: NetworkLimits = NETWORK_LIMITS): Network {
  const total = view.chapters.length + view.cards.length;
  if (total === 0 || limits.nodes <= 0) {
    return EMPTY_NETWORK;
  }

  // If not everything fits, chapters keep at least three in eight places, and they're the latest
  // ones: where the author is writing.
  const chapterShare = Math.max(
    limits.nodes - view.cards.length,
    Math.ceil((limits.nodes * 3) / 8),
  );
  const chapters =
    total <= limits.nodes
      ? view.chapters
      : view.chapters.slice(-Math.min(chapterShare, limits.nodes));
  const cards = [...view.cards].sort(byPresence).slice(0, limits.nodes - chapters.length);

  const kept = new Set([
    ...chapters.map((c) => chapterKey(c.id)),
    ...cards.map((c) => cardKey(c.id)),
  ]);
  const keptCard = (id: string) => kept.has(cardKey(id));

  // Most telling first, since there's room for only so many: the line of chapters, what the text
  // says ties two cards, places inside places, and then where each card appears.
  const wanted: { readonly a: string; readonly b: string; readonly strength: number }[] = [];
  chapters.slice(1).forEach((chapter, index) => {
    wanted.push({
      a: chapterKey((chapters[index] as (typeof chapters)[number]).id),
      b: chapterKey(chapter.id),
      strength: 1.5,
    });
  });
  for (const relation of view.relations) {
    if (keptCard(relation.a.id) && keptCard(relation.b.id)) {
      wanted.push({ a: cardKey(relation.a.id), b: cardKey(relation.b.id), strength: 1 });
    }
  }
  for (const card of cards) {
    const parent = card.within.at(-1);
    if (parent !== undefined && keptCard(parent.id)) {
      wanted.push({ a: cardKey(parent.id), b: cardKey(card.id), strength: 1 });
    }
  }
  const appearsIn = (cardId: string) =>
    chapters.filter((chapter) =>
      [...chapter.people, ...chapter.places, ...chapter.lore].some(
        (entity) => entity.id === cardId,
      ),
    );
  const later: typeof wanted = [];
  for (const card of cards) {
    const [first, ...rest] = appearsIn(card.id);
    if (first !== undefined) {
      wanted.push({ a: chapterKey(first.id), b: cardKey(card.id), strength: 1 });
    }
    for (const chapter of rest) {
      later.push({ a: chapterKey(chapter.id), b: cardKey(card.id), strength: 1 });
    }
  }
  const seen = new Set<string>();
  const pairs = [...wanted, ...later]
    .filter((pair) => {
      const id = [pair.a, pair.b].sort().join("\u001e");
      if (pair.a === pair.b || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, Math.max(0, limits.links));

  const chapterKeys = chapters.map((chapter) => chapterKey(chapter.id));
  const cardKeys = cards.map((card) => cardKey(card.id));
  const order = [...chapterKeys, ...cardKeys];

  // How far each is from where the ink starts.
  const depth = new Map<string, number>();
  const start = order[0] as string;
  depth.set(start, 0);
  const queue = [start];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const pair of pairs) {
      const other = pair.a === next ? pair.b : pair.b === next ? pair.a : null;
      if (other !== null && !depth.has(other)) {
        depth.set(other, (depth.get(next) as number) + 1);
        queue.push(other);
      }
    }
  }
  const loose = Math.max(...depth.values()) + 1;
  const depthOf = (key: string) => depth.get(key) ?? loose;

  const positions = layout(
    chapterKeys,
    cardKeys,
    pairs.map((pair) => [pair.a, pair.b] as const),
  );
  const most = Math.max(1, ...cards.map((card) => card.scenes.length));

  const nodes: NetworkNode[] = [
    ...chapters.map(
      (chapter): NetworkNode => ({
        key: chapterKey(chapter.id),
        kind: "chapter",
        id: chapter.id,
        name: chapter.title,
        label: shorten(chapter.title),
        // A chapter keeps its black ink: what's unresolved in it shows on the cards it's about.
        conflict: false,
        position: positions.get(chapterKey(chapter.id)) as Vec,
        radius: 0.03,
        depth: depthOf(chapterKey(chapter.id)),
      }),
    ),
    ...cards.map(
      (card): NetworkNode => ({
        key: cardKey(card.id),
        kind: card.type,
        id: card.id,
        name: card.name,
        label: shorten(card.name),
        conflict: card.issues.length > 0,
        position: positions.get(cardKey(card.id)) as Vec,
        radius: 0.028 + 0.014 * (card.scenes.length / most),
        depth: depthOf(cardKey(card.id)),
      }),
    ),
  ];

  return {
    nodes,
    links: pairs.map((pair) => {
      const swap = depthOf(pair.a) > depthOf(pair.b);
      return {
        from: swap ? pair.b : pair.a,
        to: swap ? pair.a : pair.b,
        strength: pair.strength,
        depth: Math.min(depthOf(pair.a), depthOf(pair.b)),
      };
    }),
    hidden: {
      chapters: view.chapters.length - chapters.length,
      cards: view.cards.length - cards.length,
    },
  };
}
