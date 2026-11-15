import type { AiProvider, Usage } from "../provider/provider";
import { generateStructured, type Validated } from "../provider/structured";
import type {
  AnalysisState,
  Digest,
  Entity,
  EntitySummary,
  Fact,
  SceneNote,
  ScenePrompt,
} from "./state";

/**
 * Step 4 of SPEC §5: what the model writes about a scene once it's been analysed. A summary of each
 * card, what changes in the scene, and questions and small tasks for the author. One request per
 * scene, apart from the analysis: if it fails, the analysis stands and only this is missing.
 *
 * None of it ever goes into the manuscript (rule 1), and nothing is kept that the text doesn't back:
 * a question needs its quote, and a summary can't name what its facts don't (rule 3).
 */

export interface DigestDeps {
  readonly provider: AiProvider;
  readonly model: string;
  readonly language: string;
  readonly newId?: () => string;
  readonly reasoning?: "default" | "off";
  readonly signal?: AbortSignal;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly onUsage?: (usage: Usage) => void;
  readonly onStep?: (step: string) => void;
}

/** What one scene's digest adds: it replaces whatever the scene's last digest left. */
export interface SceneDigest {
  readonly sceneId: string;
  readonly note: SceneNote | null;
  readonly summaries: readonly EntitySummary[];
  readonly prompts: readonly ScenePrompt[];
}

export interface DigestResult {
  readonly digest: SceneDigest;
  /** What the model gave that the text doesn't back, and was thrown away. */
  readonly discarded: {
    readonly change: boolean;
    readonly summaries: number;
    readonly prompts: number;
  };
  /** Each thing thrown away and why, for the evaluation to show. */
  readonly rejected: readonly string[];
}

/** How many cards one request summarises. The rest wait for the next scene that touches them. */
const MAX_ENTITIES = 8;
const MAX_FACTS = 30;
const MAX_QUESTIONS = 2;
const MAX_SUGGESTIONS = 1;
const LONGEST_SUMMARY = 500;
const LONGEST_LINE = 260;

const LANGUAGE_NAMES: Readonly<Record<string, string>> = { es: "Spanish", en: "English" };

/** Any change here must go through the evaluation in `fixtures/`, like the other prompts. */
export function digestInstructions(language: string): string {
  return `You help a novelist keep track of their own novel. You never write the novel, and you never suggest what should happen in it. You get one scene and, for some characters, places or things, the facts the novel has stated about them so far.

Answer with four things.

"change": one short sentence saying what is different at the end of this scene compared with its start: who arrives or leaves, what someone learns, decides, loses or reveals. Only what the scene itself states. If nothing changes, an empty string.

"summaries": for each entity listed under ENTITIES, at most two short sentences, under 300 characters in all, saying who or what it is and what matters most about it. Don't list every fact. Use only its listed facts: no guesses, no opinions, no adjectives the facts don't contain, and no names that aren't in them. When two facts disagree, state both without choosing. "entity" is the id alone, such as "E1".

"questions": at most ${MAX_QUESTIONS} questions about something this scene mentions and leaves undefined, which the novelist would need to settle to keep the story consistent: who someone is, when something happened, how two things fit. Each is one short sentence ending with a question mark. Never ask about style, and never suggest an answer. "quote" is the exact text from the scene that raises the question, copied character by character. An empty list is a normal answer.

"suggestions": at most ${MAX_SUGGESTIONS} small writing task of 5 to 20 minutes that develops something already present in this scene, such as describing a place the scene only names, or showing a moment it only reports. Say what to develop, never how it should turn out, and never write any of the text yourself. "quote" is the exact text from the scene it starts from. An empty list is a normal answer.

Write everything in ${LANGUAGE_NAMES[language] ?? language}. Answer only with the JSON object.`;
}

const STRING = { type: "string" } as const;
const PROMPT_LIST = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["text", "quote"],
    properties: { text: STRING, quote: STRING },
  },
} as const;

export const DIGEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["change", "summaries", "questions", "suggestions"],
  properties: {
    change: STRING,
    summaries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["entity", "summary"],
        properties: { entity: STRING, summary: STRING },
      },
    },
    questions: PROMPT_LIST,
    suggestions: PROMPT_LIST,
  },
} as const;

interface RawDigest {
  readonly change: string;
  readonly summaries: readonly { readonly entity: string; readonly summary: string }[];
  readonly questions: readonly { readonly text: string; readonly quote: string }[];
  readonly suggestions: readonly { readonly text: string; readonly quote: string }[];
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null;

/** Only the shape. Whether the text backs each piece is checked afterwards, piece by piece. */
export function validateDigest(value: unknown): Validated<RawDigest> {
  if (!isObject(value)) {
    return { ok: false, problem: "It must be an object." };
  }
  const pairs = (field: string, a: string, b: string) => {
    const list = value[field];
    if (!Array.isArray(list)) {
      return null;
    }
    return list.filter(
      (entry): entry is Json =>
        isObject(entry) && typeof entry[a] === "string" && typeof entry[b] === "string",
    );
  };
  const summaries = pairs("summaries", "entity", "summary");
  const questions = pairs("questions", "text", "quote");
  const suggestions = pairs("suggestions", "text", "quote");
  if (summaries === null || questions === null || suggestions === null) {
    return {
      ok: false,
      problem: 'It must have the lists "summaries", "questions" and "suggestions".',
    };
  }
  return {
    ok: true,
    value: {
      change: typeof value.change === "string" ? value.change : "",
      summaries: summaries.map((entry) => ({
        entity: entry.entity as string,
        summary: entry.summary as string,
      })),
      questions: questions.map((entry) => ({
        text: entry.text as string,
        quote: entry.quote as string,
      })),
      suggestions: suggestions.map((entry) => ({
        text: entry.text as string,
        quote: entry.quote as string,
      })),
    },
  };
}

/** A short, stable fingerprint of a text. Enough to tell whether something changed, not a secret. */
export function fingerprint(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ (code + index), 0x85ebca6b);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * What a summary was written from: the passages of its card, in any order. A summary is only shown
 * while its card shows exactly those passages, so it never outlives the text behind it.
 */
export function summaryBasis(
  passages: readonly { readonly sceneId: string; readonly quote: string }[],
): string {
  return fingerprint(
    passages
      .map((passage) => `${passage.sceneId}\u001f${passage.quote}`)
      .sort()
      .join("\u001e"),
  );
}

/**
 * Words written with a capital in the middle of a sentence that the allowed text doesn't have:
 * names the model brought in from nowhere.
 */
export function ungroundedNames(text: string, allowed: string): string[] {
  const known = allowed.toLocaleLowerCase();
  const names: string[] = [];
  for (const sentence of text.split(/(?<=[.!?…:])\s+/)) {
    const words = sentence.match(/[\p{L}\p{N}'’-]+/gu) ?? [];
    for (const word of words.slice(1)) {
      const first = word[0] ?? "";
      if (
        first !== first.toLocaleLowerCase() &&
        first === first.toLocaleUpperCase() &&
        !known.includes(word.toLocaleLowerCase())
      ) {
        names.push(word);
      }
    }
  }
  return names;
}

const factsOf = (state: AnalysisState, entityId: string): Fact[] =>
  state.facts.filter((fact) => fact.entityId === entityId);

/** The cards this scene's digest should summarise: the ones it touched, then the ones gone stale. */
function entitiesToSummarise(state: AnalysisState, sceneId: string): Entity[] {
  const touched = new Set(
    state.facts.filter((fact) => fact.sceneId === sceneId).map((fact) => fact.entityId),
  );
  const stored = new Map(
    (state.digest?.summaries ?? []).map((summary) => [summary.entityId, summary.basis]),
  );
  const stale = (entity: Entity) => {
    const facts = factsOf(state, entity.id);
    return (
      facts.length > 0 && stored.has(entity.id) && stored.get(entity.id) !== summaryBasis(facts)
    );
  };
  return [
    ...state.entities.filter((entity) => touched.has(entity.id)),
    ...state.entities.filter((entity) => !touched.has(entity.id) && stale(entity)),
  ].slice(0, MAX_ENTITIES);
}

function entityBlock(state: AnalysisState, entities: readonly Entity[]): string {
  if (entities.length === 0) {
    return "ENTITIES\n(none)";
  }
  return `ENTITIES\n${entities
    .map((entity, index) => {
      const facts = factsOf(state, entity.id).slice(-MAX_FACTS);
      return `E${index + 1} ${entity.canonicalName} [${entity.type}]\n${facts
        .map((fact) => `- ${fact.attribute}: ${fact.value} | «${fact.quote}»`)
        .join("\n")}`;
    })
    .join("\n\n")}`;
}

const clean = (text: string) => text.trim().replace(/\s+/g, " ");

/**
 * Digests a scene that was just analysed. `state` must already hold that analysis. Throws what
 * `generateStructured` throws: whoever calls decides that a missing digest is no reason to stop.
 */
export async function digestScene(
  state: AnalysisState,
  scene: { readonly id: string; readonly title: string; readonly text: string },
  deps: DigestDeps,
): Promise<DigestResult> {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const entities = entitiesToSummarise(state, scene.id);

  deps.onStep?.("digest");
  const raw = await generateStructured(
    deps.provider,
    {
      model: deps.model,
      instructions: digestInstructions(deps.language),
      input: `SCENE ${scene.id} "${scene.title}":\n${scene.text}\n\n${entityBlock(state, entities)}`,
      structured: { name: "scene_digest", schema: DIGEST_SCHEMA },
      temperature: 0,
      ...(deps.reasoning === undefined ? {} : { reasoning: deps.reasoning }),
      ...(deps.signal === undefined ? {} : { signal: deps.signal }),
    },
    validateDigest,
    {
      ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
      ...(deps.onUsage === undefined ? {} : { onUsage: deps.onUsage }),
    },
  );

  // A name the novel already has is no invention, wherever it's used. Any other must come from the
  // text the piece is about.
  const knownNames = state.entities
    .flatMap((entity) => [entity.canonicalName, ...entity.aliases])
    .join(" ");
  const inScene = `${scene.text} ${knownNames}`;

  const change = clean(raw.change);
  const changeStands =
    change !== "" && change.length <= LONGEST_LINE && ungroundedNames(change, inScene).length === 0;

  const rejected: string[] = [];
  const summaries: EntitySummary[] = [];
  let discardedSummaries = 0;
  for (const entry of raw.summaries) {
    // Models often repeat the name after the id they were given: "E1 Marta Rey".
    const index = /^E(\d+)(?![\p{L}\p{N}])/u.exec(entry.entity.trim());
    const entity = index === null ? undefined : entities[Number(index[1]) - 1];
    const text = clean(entry.summary);
    if (entity === undefined || text === "") {
      discardedSummaries += 1;
      rejected.push(`summary of "${entry.entity}": no such entity, or empty`);
      continue;
    }
    const facts = factsOf(state, entity.id);
    const allowed = [
      knownNames,
      ...facts.flatMap((fact) => [fact.sentence, fact.value, fact.attribute]),
    ].join(" ");
    const strangers = ungroundedNames(text, allowed);
    if (
      text.length > LONGEST_SUMMARY ||
      strangers.length > 0 ||
      summaries.some((summary) => summary.entityId === entity.id)
    ) {
      discardedSummaries += 1;
      rejected.push(
        `summary of ${entity.canonicalName}: ${
          strangers.length > 0
            ? `names not in its facts (${strangers.join(", ")})`
            : text.length > LONGEST_SUMMARY
              ? `too long (${text.length})`
              : "a second one"
        } | ${text}`,
      );
      continue;
    }
    summaries.push({ entityId: entity.id, text, basis: summaryBasis(facts) });
  }

  const prompts: ScenePrompt[] = [];
  let discardedPrompts = 0;
  const keep = (
    kind: ScenePrompt["kind"],
    entries: readonly { readonly text: string; readonly quote: string }[],
    limit: number,
  ) => {
    let kept = 0;
    for (const entry of entries) {
      const text = clean(entry.text);
      const stands =
        kept < limit &&
        text !== "" &&
        text.length <= LONGEST_LINE &&
        entry.quote.trim() !== "" &&
        // The quote is the question's origin: one that isn't in the scene has none (rule 3).
        scene.text.includes(entry.quote) &&
        (kind !== "question" || text.endsWith("?")) &&
        ungroundedNames(text, inScene).length === 0;
      if (!stands) {
        discardedPrompts += 1;
        rejected.push(`${kind}: ${text} | «${entry.quote}»`);
        continue;
      }
      kept += 1;
      prompts.push({ id: newId(), sceneId: scene.id, kind, text, quote: entry.quote });
    }
  };
  keep("question", raw.questions, MAX_QUESTIONS);
  keep("suggestion", raw.suggestions, MAX_SUGGESTIONS);

  return {
    digest: {
      sceneId: scene.id,
      note: changeStands ? { sceneId: scene.id, change, textHash: fingerprint(scene.text) } : null,
      summaries,
      prompts,
    },
    discarded: {
      change: change !== "" && !changeStands,
      summaries: discardedSummaries,
      prompts: discardedPrompts,
    },
    rejected: [...rejected, ...(change !== "" && !changeStands ? [`change: ${change}`] : [])],
  };
}

const EMPTY: Digest = { summaries: [], notes: [], prompts: [] };

/** Puts a scene's digest in place of what its last one left. */
export function withDigest(state: AnalysisState, digest: SceneDigest): AnalysisState {
  const current = state.digest ?? EMPTY;
  const summarised = new Set(digest.summaries.map((summary) => summary.entityId));
  return {
    ...state,
    digest: {
      summaries: [
        ...current.summaries.filter((summary) => !summarised.has(summary.entityId)),
        ...digest.summaries,
      ],
      notes: [
        ...current.notes.filter((note) => note.sceneId !== digest.sceneId),
        ...(digest.note === null ? [] : [digest.note]),
      ],
      prompts: [
        ...current.prompts.filter((prompt) => prompt.sceneId !== digest.sceneId),
        ...digest.prompts,
      ],
    },
  };
}
