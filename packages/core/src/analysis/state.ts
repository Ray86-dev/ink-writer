import type { EntityType, FactCategory } from "./contract";

/**
 * What the analysis knows about a novel: the registry of SPEC §5, against which new facts are
 * compared without rereading the book. Rebuilding a scene replaces what came from that scene.
 */

export interface Entity {
  readonly id: string;
  readonly type: EntityType;
  readonly canonicalName: string;
  readonly aliases: readonly string[];
}

export interface Mention {
  readonly sceneId: string;
  readonly entityId: string;
  /** The name as written, which appears literally in the scene. */
  readonly quote: string;
}

export interface Fact {
  readonly id: string;
  readonly sceneId: string;
  readonly entityId: string;
  readonly category: FactCategory;
  readonly attribute: string;
  readonly value: string;
  readonly quote: string;
  /** The sentence the quote comes from. A model may split one sentence into several facts. */
  readonly sentence: string;
  readonly storyTime: string | null;
  /** Said by a character, who may be mistaken or lying, rather than stated by the narrator. */
  readonly inDialogue: boolean;
}

export interface Relation {
  readonly id: string;
  readonly sceneId: string;
  readonly fromEntityId: string;
  readonly toEntityId: string;
  readonly label: string;
  readonly quote: string;
}

export interface QuoteRef {
  readonly sceneId: string;
  readonly quote: string;
}

export type Issue =
  | {
      readonly kind: "contradiction";
      readonly a: QuoteRef;
      readonly b: QuoteRef;
      readonly reason: string;
    }
  /** Two names that may be one misspelled. The author decides: they're never merged silently. */
  | {
      readonly kind: "name_variant";
      readonly a: QuoteRef;
      readonly b: QuoteRef;
      readonly reason: string;
    }
  | {
      readonly kind: "correction";
      readonly a: QuoteRef;
      readonly fix: string;
      readonly reason: string;
    };

export interface AnalysisState {
  readonly entities: readonly Entity[];
  readonly mentions: readonly Mention[];
  readonly facts: readonly Fact[];
  readonly relations: readonly Relation[];
  readonly issues: readonly Issue[];
  /** Scenes in reading order, so that a comparison knows what came first. */
  readonly sceneOrder: readonly string[];
}

export const emptyState = (sceneOrder: readonly string[] = []): AnalysisState => ({
  entities: [],
  mentions: [],
  facts: [],
  relations: [],
  issues: [],
  sceneOrder,
});

/**
 * The entities some scene still supports. The others stay stored, so that a name coming back keeps its
 * id and whatever the author said about it (rule 4), but they aren't in the novel now.
 */
export function liveEntities(state: AnalysisState): readonly Entity[] {
  const supported = new Set([
    ...state.mentions.map((mention) => mention.entityId),
    ...state.facts.map((fact) => fact.entityId),
  ]);
  return state.entities.filter((entity) => supported.has(entity.id));
}

const citesScene = (issue: Issue, sceneId: string) =>
  issue.a.sceneId === sceneId || ("b" in issue && issue.b.sceneId === sceneId);

/**
 * Takes out everything that came from a scene, for reanalysing it (SPEC §4). What it leaves is exactly
 * what the rest of the novel supports: an issue citing this scene goes too, and it comes back if the
 * text still justifies it.
 */
export function withoutScene(state: AnalysisState, sceneId: string): AnalysisState {
  return {
    ...state,
    mentions: state.mentions.filter((mention) => mention.sceneId !== sceneId),
    facts: state.facts.filter((fact) => fact.sceneId !== sceneId),
    relations: state.relations.filter((relation) => relation.sceneId !== sceneId),
    issues: state.issues.filter((issue) => !citesScene(issue, sceneId)),
  };
}
