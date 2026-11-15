import type { CardIssue, CardPrompt, EntityCard, NovelView, Passage } from "../cards/cards";
import type { Storage, StoredHintState } from "../storage/storage";

/**
 * Hints and tasks (SPEC §3.4 and §3.5), worked out from what the cards already know. Nothing here
 * asks a model, and with hints off nothing here produces anything at all.
 */

export const HINT_LEVELS = ["off", "on_demand", "discreet", "companion"] as const;
export type HintLevel = (typeof HINT_LEVELS)[number];

export const HINT_TYPES = [
  "coherence",
  "corrections",
  "questions",
  "suggestions",
  "documentation",
] as const;
export type HintType = (typeof HINT_TYPES)[number];

export interface HintSettings {
  readonly level: HintLevel;
  /** One switch per kind of hint, each on its own. */
  readonly types: Readonly<Record<HintType, boolean>>;
  /** "Today I only want to write": the day, as YYYY-MM-DD, on which no task is proposed. */
  readonly noTasksOn: string | null;
}

/** Discreet by default (SPEC §11), with every kind on. */
export const DEFAULT_HINT_SETTINGS: HintSettings = {
  level: "discreet",
  types: {
    coherence: true,
    corrections: true,
    questions: true,
    suggestions: true,
    documentation: true,
  },
  noTasksOn: null,
};

const SETTINGS_KEY = "hints";

/** What's stored and can't be read counts as the defaults, field by field. */
export async function loadHintSettings(storage: Storage): Promise<HintSettings> {
  const stored = await storage.getSetting(SETTINGS_KEY);
  if (stored === null) {
    return DEFAULT_HINT_SETTINGS;
  }
  try {
    const value: unknown = JSON.parse(stored);
    if (typeof value !== "object" || value === null) {
      return DEFAULT_HINT_SETTINGS;
    }
    const { level, types, noTasksOn } = value as Record<string, unknown>;
    const switches = (typeof types === "object" && types !== null ? types : {}) as Record<
      string,
      unknown
    >;
    return {
      level: HINT_LEVELS.includes(level as HintLevel)
        ? (level as HintLevel)
        : DEFAULT_HINT_SETTINGS.level,
      types: Object.fromEntries(
        HINT_TYPES.map((type) => [type, switches[type] !== false]),
      ) as Record<HintType, boolean>,
      noTasksOn: typeof noTasksOn === "string" ? noTasksOn : null,
    };
  } catch {
    return DEFAULT_HINT_SETTINGS;
  }
}

export async function saveHintSettings(storage: Storage, settings: HintSettings): Promise<void> {
  await storage.setSetting(SETTINGS_KEY, JSON.stringify(settings));
}

/** How the author closed a hint. Each kind of hint offers its own (SPEC §3.4). */
export type HintDecision =
  /** Coherence: "It's intentional". */
  | "intentional"
  /** Correction: "Leave it as it is". */
  | "leave"
  /** Question, suggestion or task: "Not useful to me". */
  | "not_useful";

/** How far a hint has been revealed: vague, then pointed, then the exact detail. */
export type HintStep = 1 | 2 | 3;

export interface Hint {
  /**
   * The same for the same passages, whatever ids an analysis gives them, so that what the author
   * decided about it outlives every reanalysis (rule 4).
   */
  readonly key: string;
  readonly type: HintType;
  readonly kind: CardIssue["kind"] | "question" | "suggestion";
  /** Where it's marked in the text. For a contradiction, the later of the two passages. */
  readonly at: Passage;
  /** The passage it clashes with, shown from the second step on. */
  readonly other: Passage | null;
  /** The whole explanation, shown only at the last step. */
  readonly reason: string;
  /** For a correction, what to put instead of the quote. */
  readonly fix: string | null;
  readonly step: HintStep;
}

/** A question or a task is known by its passage: the model may word it differently next time. */
export function promptKey(prompt: Pick<CardPrompt, "kind" | "at">): string {
  return [prompt.kind, prompt.at.sceneId, prompt.at.quote].join("\u001e");
}

export function hintKey(issue: Pick<CardIssue, "kind" | "a" | "b">): string {
  const passages = [issue.a, ...(issue.b === null ? [] : [issue.b])].map(
    (passage) => `${passage.sceneId}\u001f${passage.quote}`,
  );
  // The same pair is the same hint whichever of the two is cited first.
  return [issue.kind, ...passages.sort()].join("\u001e");
}

const TYPE_OF: Readonly<Record<CardIssue["kind"], HintType>> = {
  contradiction: "coherence",
  name_variant: "coherence",
  correction: "corrections",
};

export interface HintStates {
  /** What the author decided about each hint, by key. A decided hint is closed. */
  readonly decisions: ReadonlyMap<string, HintDecision>;
  /** How far each one was revealed. */
  readonly steps: ReadonlyMap<string, HintStep>;
}

export const NO_HINT_STATES: HintStates = { decisions: new Map(), steps: new Map() };

const DECISIONS: readonly HintDecision[] = ["intentional", "leave", "not_useful"];

export function toHintStates(stored: readonly StoredHintState[]): HintStates {
  const decisions = new Map<string, HintDecision>();
  const steps = new Map<string, HintStep>();
  for (const state of stored) {
    if (DECISIONS.includes(state.decision as HintDecision)) {
      decisions.set(state.key, state.decision as HintDecision);
    }
    if (state.step === 2 || state.step === 3) {
      steps.set(state.key, state.step);
    }
  }
  return { decisions, steps };
}

export async function loadHintStates(storage: Storage, projectId: string): Promise<HintStates> {
  return toHintStates(await storage.listHintStates(projectId));
}

/**
 * The open hints, in reading order of where they're marked. Off means none (SPEC §3.4), and so does
 * a kind that's switched off. A hint whose text is gone isn't here either: the cards already dropped
 * it, so it closes by itself.
 */
export function buildHints(
  view: NovelView,
  settings: HintSettings,
  states: HintStates = NO_HINT_STATES,
): Hint[] {
  if (settings.level === "off") {
    return [];
  }
  const seen = new Set<string>();
  const hints: Hint[] = [];
  for (const issue of view.issues) {
    const type = TYPE_OF[issue.kind];
    const key = hintKey(issue);
    if (!settings.types[type] || states.decisions.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    hints.push({
      key,
      type,
      kind: issue.kind,
      // The issues come in reading order, with `b` the later passage: that's where it's noticed.
      at: issue.b ?? issue.a,
      other: issue.b === null ? null : issue.a,
      reason: issue.reason,
      fix: issue.fix,
      step: states.steps.get(key) ?? 1,
    });
  }
  for (const prompt of view.prompts) {
    const type: HintType = prompt.kind === "question" ? "questions" : "suggestions";
    const key = promptKey(prompt);
    if (!settings.types[type] || states.decisions.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    hints.push({
      key,
      type,
      kind: prompt.kind,
      at: prompt.at,
      other: null,
      reason: prompt.text,
      fix: null,
      // A question isn't a riddle: it's shown whole.
      step: 3,
    });
  }
  return hints;
}

export const TASK_KINDS = ["define", "write", "resolve", "complete"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** A small next step (SPEC §3.5). It always says why it's proposed, and comes from what's written. */
export type Task =
  | {
      readonly key: string;
      readonly kind: "resolve";
      readonly hint: Hint;
    }
  | {
      readonly key: string;
      readonly kind: "write";
      /** A small writing task the model proposed from a passage. */
      readonly hint: Hint;
    }
  | {
      readonly key: string;
      readonly kind: "define";
      /** A card the text names, in several scenes, without saying anything about it. */
      readonly card: Pick<EntityCard, "id" | "name" | "type">;
      readonly scenes: number;
    }
  | {
      readonly key: string;
      readonly kind: "complete";
      /** A scene with a title and no text, between scenes that have some. */
      readonly scene: {
        readonly id: string;
        readonly title: string;
        readonly chapterTitle: string;
      };
    };

export interface TaskInput {
  readonly view: NovelView;
  readonly hints: readonly Hint[];
  readonly settings: HintSettings;
  readonly states?: HintStates;
  /** Every scene in reading order, with whether it has any text. */
  readonly scenes: readonly {
    readonly id: string;
    readonly title: string;
    readonly chapterTitle: string;
    readonly empty: boolean;
  }[];
  /** Today, as YYYY-MM-DD. */
  readonly today: string;
}

/**
 * The one task to propose, or null. None with hints off, none on a day the author said they only want
 * to write, and never one they already said isn't useful. What's unresolved goes first.
 */
export function nextTask(input: TaskInput): Task | null {
  const { view, hints, settings, scenes, today } = input;
  const states = input.states ?? NO_HINT_STATES;
  if (settings.level === "off" || settings.noTasksOn === today) {
    return null;
  }
  const open = (task: Task) => !states.decisions.has(task.key);

  const candidates: Task[] = [];
  for (const hint of hints) {
    if (hint.type === "coherence") {
      candidates.push({ key: `task\u001eresolve\u001e${hint.key}`, kind: "resolve", hint });
    }
  }
  if (settings.types.questions) {
    for (const card of view.cards) {
      if (card.facts.length === 0 && card.relations.length === 0 && card.scenes.length >= 2) {
        candidates.push({
          key: `task\u001edefine\u001e${card.id}`,
          kind: "define",
          card: { id: card.id, name: card.name, type: card.type },
          scenes: card.scenes.length,
        });
      }
    }
  }
  for (const hint of hints) {
    if (hint.type === "suggestions") {
      candidates.push({ key: `task\u001ewrite\u001e${hint.key}`, kind: "write", hint });
    }
  }
  if (settings.types.suggestions) {
    const lastWritten = scenes.findLastIndex((scene) => !scene.empty);
    for (const [index, scene] of scenes.entries()) {
      // Only a gap: empty scenes after the last written one are simply what comes next.
      if (scene.empty && index < lastWritten) {
        candidates.push({
          key: `task\u001ecomplete\u001e${scene.id}`,
          kind: "complete",
          scene: { id: scene.id, title: scene.title, chapterTitle: scene.chapterTitle },
        });
      }
    }
  }
  return candidates.find(open) ?? null;
}

/** The local day, as YYYY-MM-DD. */
export function dayOf(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
