import type { EntityType } from "../analysis/contract";
import { nameKey } from "../analysis/names";
import type { AnalysisState, Entity } from "../analysis/state";
import type { Storage, StoredOverride } from "../storage/storage";
import { createNameFinder } from "./name-finder";

/**
 * What the author says about the cards (SPEC §4, `user_overrides`). None of it is written into what
 * the analysis stores: it's applied on top, every time, so no reanalysis can undo it (rule 4).
 */
export type Override =
  /** Two cards are the same thing. `from` becomes part of `into`. */
  | { readonly kind: "merge"; readonly from: string; readonly into: string }
  /** One of a card's names is something else, which gets a card of its own. */
  | {
      readonly kind: "split";
      readonly entityId: string;
      readonly name: string;
      readonly newEntityId: string;
    }
  /** The author's own note on a card. An empty one takes it away. */
  | { readonly kind: "note"; readonly entityId: string; readonly text: string }
  /** The card's name, what kind of thing it is, or the place it's inside of. */
  | {
      readonly kind: "correction";
      readonly entityId: string;
      readonly name?: string;
      readonly type?: EntityType;
      readonly parentId?: string | null;
    }
  /** "This isn't right": one passage of a card, or without a quote, the whole card. */
  | { readonly kind: "dismiss"; readonly entityId: string; readonly quote?: string };

export interface AuthorOverride {
  readonly id: string;
  readonly createdAt: number;
  readonly override: Override;
}

const ENTITY_TYPES: readonly EntityType[] = ["person", "place", "lore"];

const text = (value: unknown): value is string => typeof value === "string" && value !== "";

/** Null for anything that isn't one of the shapes above: it's ignored, never guessed at. */
export function parseOverride(stored: StoredOverride): AuthorOverride | null {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(stored.payload);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const wrap = (override: Override): AuthorOverride => ({
    id: stored.id,
    createdAt: stored.createdAt,
    override,
  });
  const { entityId } = payload;
  switch (stored.kind) {
    case "merge":
      return text(payload.from) && text(payload.into) && payload.from !== payload.into
        ? wrap({ kind: "merge", from: payload.from, into: payload.into })
        : null;
    case "split":
      return text(entityId) && text(payload.name) && text(payload.newEntityId)
        ? wrap({ kind: "split", entityId, name: payload.name, newEntityId: payload.newEntityId })
        : null;
    case "note":
      return text(entityId) && typeof payload.text === "string"
        ? wrap({ kind: "note", entityId, text: payload.text })
        : null;
    case "correction": {
      if (!text(entityId)) {
        return null;
      }
      const { name, type, parentId } = payload;
      return wrap({
        kind: "correction",
        entityId,
        ...(text(name) && name.trim() !== "" ? { name: name.trim() } : {}),
        ...(ENTITY_TYPES.includes(type as EntityType) ? { type: type as EntityType } : {}),
        ...(text(parentId) || parentId === null ? { parentId } : {}),
      });
    }
    case "dismiss":
      return text(entityId)
        ? wrap({
            kind: "dismiss",
            entityId,
            ...(text(payload.quote) ? { quote: payload.quote } : {}),
          })
        : null;
    default:
      return null;
  }
}

export async function loadOverrides(
  storage: Storage,
  projectId: string,
): Promise<AuthorOverride[]> {
  const stored = await storage.listOverrides(projectId);
  return stored.flatMap((item) => parseOverride(item) ?? []);
}

export async function addOverride(
  storage: Storage,
  projectId: string,
  override: Override,
): Promise<void> {
  const { kind, ...payload } = override;
  await storage.addOverride(projectId, kind, JSON.stringify(payload));
}

export interface Applied {
  /** The analysis as the author has corrected it. */
  readonly state: AnalysisState;
  readonly notes: ReadonlyMap<string, string>;
  /** For a place, the place it's inside of. */
  readonly parents: ReadonlyMap<string, string>;
  /** What was merged into each card, with the override to remove to undo it. */
  readonly merged: ReadonlyMap<string, readonly { overrideId: string; name: string }[]>;
  /** Cards that exist because the author split them off, with the override behind each. */
  readonly splitOff: ReadonlyMap<string, string>;
}

const unique = (names: readonly string[]) => {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = nameKey(name);
    if (key === "" || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

/**
 * Applies the author's overrides, oldest first, over what the analysis found. An override about
 * something that isn't there now changes nothing, and takes effect again if it comes back.
 */
export function applyOverrides(
  analysis: AnalysisState,
  overrides: readonly AuthorOverride[],
): Applied {
  let entities: Entity[] = analysis.entities.map((entity) => ({ ...entity }));
  let { mentions, facts, relations } = analysis;
  const notes = new Map<string, string>();
  const parents = new Map<string, string>();
  const merged = new Map<string, { overrideId: string; name: string }[]>();
  const splitOff = new Map<string, string>();
  /** Where each merged card went, so that what's said about it later reaches the right one. */
  const movedTo = new Map<string, string>();

  const resolve = (id: string): string => {
    let current = id;
    for (let hops = 0; movedTo.has(current) && hops < 1000; hops += 1) {
      current = movedTo.get(current) as string;
    }
    return current;
  };
  const find = (id: string) => entities.find((entity) => entity.id === id);
  const replace = (next: Entity) => {
    entities = entities.map((entity) => (entity.id === next.id ? next : entity));
  };

  for (const { id: overrideId, override } of [...overrides].sort(
    (a, b) => a.createdAt - b.createdAt,
  )) {
    switch (override.kind) {
      case "merge": {
        const fromId = resolve(override.from);
        const intoId = resolve(override.into);
        const from = find(fromId);
        const into = find(intoId);
        if (from === undefined || into === undefined || fromId === intoId) {
          break;
        }
        replace({
          ...into,
          aliases: unique([...into.aliases, from.canonicalName, ...from.aliases]).filter(
            (alias) => nameKey(alias) !== nameKey(into.canonicalName),
          ),
        });
        entities = entities.filter((entity) => entity.id !== fromId);
        movedTo.set(fromId, intoId);
        mentions = mentions.map((item) =>
          item.entityId === fromId ? { ...item, entityId: intoId } : item,
        );
        facts = facts.map((item) =>
          item.entityId === fromId ? { ...item, entityId: intoId } : item,
        );
        relations = relations.map((item) => ({
          ...item,
          fromEntityId: item.fromEntityId === fromId ? intoId : item.fromEntityId,
          toEntityId: item.toEntityId === fromId ? intoId : item.toEntityId,
        }));
        merged.set(intoId, [
          ...(merged.get(intoId) ?? []),
          ...(merged.get(fromId) ?? []),
          { overrideId, name: from.canonicalName },
        ]);
        merged.delete(fromId);
        const note = notes.get(fromId);
        if (note !== undefined && !notes.has(intoId)) {
          notes.set(intoId, note);
        }
        notes.delete(fromId);
        break;
      }
      case "split": {
        const sourceId = resolve(override.entityId);
        const source = find(sourceId);
        const { name, newEntityId } = override;
        if (
          source === undefined ||
          find(newEntityId) !== undefined ||
          nameKey(source.canonicalName) === nameKey(name)
        ) {
          break;
        }
        replace({
          ...source,
          aliases: source.aliases.filter((alias) => nameKey(alias) !== nameKey(name)),
        });
        entities.push({ id: newEntityId, type: source.type, canonicalName: name, aliases: [] });
        // Whether a text names the split-off thing itself: "Marta" isn't named by "Marta Rey".
        const findName = createNameFinder(
          [source.canonicalName, ...source.aliases].map((known) => ({
            name: known,
            entityId: nameKey(known) === nameKey(name) ? newEntityId : sourceId,
          })),
        );
        const containsName = (where: string) =>
          findName(where).some((match) => match.entityId === newEntityId);
        splitOff.set(newEntityId, overrideId);
        // What names the split-off thing goes with it. The rest stays where it was.
        mentions = mentions.map((item) =>
          item.entityId === sourceId && nameKey(item.quote) === nameKey(name)
            ? { ...item, entityId: newEntityId }
            : item,
        );
        facts = facts.map((item) =>
          item.entityId === sourceId && containsName(item.sentence)
            ? { ...item, entityId: newEntityId }
            : item,
        );
        relations = relations.map((item) =>
          containsName(item.quote)
            ? {
                ...item,
                fromEntityId: item.fromEntityId === sourceId ? newEntityId : item.fromEntityId,
                toEntityId: item.toEntityId === sourceId ? newEntityId : item.toEntityId,
              }
            : item,
        );
        break;
      }
      case "note": {
        const id = resolve(override.entityId);
        if (override.text.trim() === "") {
          notes.delete(id);
        } else {
          notes.set(id, override.text);
        }
        break;
      }
      case "correction": {
        const id = resolve(override.entityId);
        const entity = find(id);
        if (entity === undefined) {
          break;
        }
        const name = override.name ?? entity.canonicalName;
        replace({
          ...entity,
          type: override.type ?? entity.type,
          canonicalName: name,
          // The name it had is still a name the text uses.
          aliases: unique([entity.canonicalName, ...entity.aliases]).filter(
            (alias) => nameKey(alias) !== nameKey(name),
          ),
        });
        if (override.parentId === null) {
          parents.delete(id);
        } else if (override.parentId !== undefined) {
          parents.set(id, override.parentId);
        }
        break;
      }
      case "dismiss": {
        const id = resolve(override.entityId);
        const { quote } = override;
        if (quote === undefined) {
          entities = entities.filter((entity) => entity.id !== id);
          mentions = mentions.filter((item) => item.entityId !== id);
          facts = facts.filter((item) => item.entityId !== id);
          relations = relations.filter(
            (item) => item.fromEntityId !== id && item.toEntityId !== id,
          );
        } else {
          facts = facts.filter((item) => item.entityId !== id || item.quote !== quote);
          relations = relations.filter(
            (item) => (item.fromEntityId !== id && item.toEntityId !== id) || item.quote !== quote,
          );
        }
        break;
      }
    }
  }

  // A place can't be inside itself, nor inside something that's gone or that's inside it.
  for (const [child, parent] of [...parents]) {
    const target = resolve(parent);
    const seen = new Set([child]);
    let current: string | undefined = target;
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      current = parents.get(current);
    }
    if (find(target) === undefined || current !== undefined) {
      parents.delete(child);
    } else {
      parents.set(child, target);
    }
  }

  return {
    state: { ...analysis, entities, mentions, facts, relations },
    notes,
    parents,
    merged,
    splitOff,
  };
}
