import type { Validated } from "../provider/structured";

/** What each step asks the model for, as schemas for the provider and validators for the answer. */

export type EntityType = "person" | "place" | "lore";

export interface ExtractedEntity {
  readonly name: string;
  readonly type: EntityType;
  readonly aliases: readonly string[];
}

/**
 * What a fact is about, from a closed list. The comparison groups by this, and each group is judged by
 * its own rule, so that a small model only ever has to weigh a few facts of one kind.
 */
export const FACT_CATEGORIES = [
  "physical",
  "age",
  "relative_age",
  "marital_status",
  "family",
  "job",
  "alive_or_dead",
  "date_of_event",
  "travel_time",
  "location",
  "action",
  "possession",
  "thought",
  "other",
] as const;

export type FactCategory = (typeof FACT_CATEGORIES)[number];

export interface ExtractedFact {
  readonly entity: string;
  readonly category: FactCategory;
  readonly attribute: string;
  readonly value: string;
  readonly quote: string;
  readonly story_time: string | null;
}

export interface ExtractedRelation {
  readonly from: string;
  readonly to: string;
  readonly label: string;
  readonly quote: string;
}

/** SPEC §5, step 1. */
export interface Extraction {
  readonly entities: readonly ExtractedEntity[];
  readonly facts: readonly ExtractedFact[];
  readonly relations: readonly ExtractedRelation[];
}

const STRING = { type: "string" } as const;

export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["entities", "facts", "relations"],
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "type", "aliases"],
        properties: {
          name: STRING,
          type: { type: "string", enum: ["person", "place", "lore"] },
          aliases: { type: "array", items: STRING },
        },
      },
    },
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["entity", "category", "attribute", "value", "quote", "story_time"],
        properties: {
          entity: STRING,
          category: { type: "string", enum: FACT_CATEGORIES },
          attribute: STRING,
          value: STRING,
          quote: STRING,
          story_time: { type: ["string", "null"] },
        },
      },
    },
    relations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "label", "quote"],
        properties: { from: STRING, to: STRING, label: STRING, quote: STRING },
      },
    },
  },
} as const;

export interface IdentityAnswer {
  readonly name: string;
  /** The known entity this name refers to, or null if it's someone or something new. */
  readonly entity_id: string | null;
}

/** SPEC §5, step 2. */
export const IDENTITY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answers"],
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "entity_id"],
        properties: { name: STRING, entity_id: { type: ["string", "null"] } },
      },
    },
  },
} as const;

export type Verdict = "contradiction" | "evolution";

export interface Finding {
  readonly new_fact: string;
  readonly other_fact: string;
  readonly verdict: Verdict;
  readonly reason: string;
}

/** SPEC §5, step 3. Facts with no relation simply aren't listed. */
export const COMPARISON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["new_fact", "other_fact", "verdict", "reason"],
        properties: {
          new_fact: STRING,
          other_fact: STRING,
          verdict: { type: "string", enum: ["contradiction", "evolution"] },
          reason: STRING,
        },
      },
    },
  },
} as const;

export interface Correction {
  readonly quote: string;
  readonly fix: string;
  readonly reason: string;
}

/** SPEC §5, step 5. */
export const PROOFREAD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["corrections"],
  properties: {
    corrections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["quote", "fix", "reason"],
        properties: { quote: STRING, fix: STRING, reason: STRING },
      },
    },
  },
} as const;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null;

function fail<T>(problem: string): Validated<T> {
  return { ok: false, problem };
}

function strings(entry: Json, fields: readonly string[]): string | null {
  for (const field of fields) {
    if (typeof entry[field] !== "string") {
      return `"${field}" must be text`;
    }
  }
  return null;
}

function listOf(value: unknown, field: string): unknown[] | null {
  if (!isObject(value) || !Array.isArray(value[field])) {
    return null;
  }
  return value[field];
}

export function validateExtraction(value: unknown): Validated<Extraction> {
  const rawEntities = listOf(value, "entities");
  const rawFacts = listOf(value, "facts");
  const rawRelations = listOf(value, "relations");
  if (rawEntities === null || rawFacts === null || rawRelations === null) {
    return fail('It must have the lists "entities", "facts" and "relations".');
  }
  const entities: ExtractedEntity[] = [];
  for (const entry of rawEntities) {
    if (!isObject(entry)) {
      return fail("Each entity must be an object.");
    }
    const problem = strings(entry, ["name"]);
    if (problem !== null) {
      return fail(`In an entity, ${problem}.`);
    }
    const aliases = Array.isArray(entry.aliases)
      ? entry.aliases.filter((alias): alias is string => typeof alias === "string")
      : [];
    const type: EntityType =
      entry.type === "person" || entry.type === "place" ? entry.type : "lore";
    entities.push({ name: entry.name as string, type, aliases });
  }
  const facts: ExtractedFact[] = [];
  for (const entry of rawFacts) {
    if (!isObject(entry)) {
      return fail("Each fact must be an object.");
    }
    const problem = strings(entry, ["entity", "attribute", "value", "quote"]);
    if (problem !== null) {
      return fail(`In a fact, ${problem}.`);
    }
    facts.push({
      entity: entry.entity as string,
      // An unknown category isn't worth rejecting a whole answer: it's just never compared.
      category: FACT_CATEGORIES.includes(entry.category as FactCategory)
        ? (entry.category as FactCategory)
        : "other",
      attribute: entry.attribute as string,
      value: entry.value as string,
      quote: entry.quote as string,
      story_time: typeof entry.story_time === "string" ? entry.story_time : null,
    });
  }
  const relations: ExtractedRelation[] = [];
  for (const entry of rawRelations) {
    if (!isObject(entry)) {
      return fail("Each relation must be an object.");
    }
    const problem = strings(entry, ["from", "to", "label", "quote"]);
    if (problem !== null) {
      return fail(`In a relation, ${problem}.`);
    }
    relations.push({
      from: entry.from as string,
      to: entry.to as string,
      label: entry.label as string,
      quote: entry.quote as string,
    });
  }
  return { ok: true, value: { entities, facts, relations } };
}

export function validateIdentities(value: unknown): Validated<readonly IdentityAnswer[]> {
  const raw = listOf(value, "answers");
  if (raw === null) {
    return fail('It must have the list "answers".');
  }
  const answers: IdentityAnswer[] = [];
  for (const entry of raw) {
    if (!isObject(entry) || typeof entry.name !== "string") {
      return fail('Each answer must have a "name".');
    }
    answers.push({
      name: entry.name,
      entity_id: typeof entry.entity_id === "string" ? entry.entity_id : null,
    });
  }
  return { ok: true, value: answers };
}

export function validateFindings(value: unknown): Validated<readonly Finding[]> {
  const raw = listOf(value, "findings");
  if (raw === null) {
    return fail('It must have the list "findings".');
  }
  const findings: Finding[] = [];
  for (const entry of raw) {
    if (!isObject(entry)) {
      return fail("Each finding must be an object.");
    }
    const problem = strings(entry, ["new_fact", "other_fact", "reason"]);
    if (problem !== null) {
      return fail(`In a finding, ${problem}.`);
    }
    if (entry.verdict !== "contradiction" && entry.verdict !== "evolution") {
      return fail('"verdict" must be "contradiction" or "evolution".');
    }
    findings.push({
      new_fact: entry.new_fact as string,
      other_fact: entry.other_fact as string,
      verdict: entry.verdict,
      reason: entry.reason as string,
    });
  }
  return { ok: true, value: findings };
}

export function validateCorrections(value: unknown): Validated<readonly Correction[]> {
  const raw = listOf(value, "corrections");
  if (raw === null) {
    return fail('It must have the list "corrections".');
  }
  const corrections: Correction[] = [];
  for (const entry of raw) {
    if (!isObject(entry)) {
      return fail("Each correction must be an object.");
    }
    const problem = strings(entry, ["quote", "fix", "reason"]);
    if (problem !== null) {
      return fail(`In a correction, ${problem}.`);
    }
    corrections.push({
      quote: entry.quote as string,
      fix: entry.fix as string,
      reason: entry.reason as string,
    });
  }
  return { ok: true, value: corrections };
}
