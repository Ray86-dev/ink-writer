import {
  HINT_LEVELS,
  HINT_TYPES,
  type Hint,
  type HintDecision,
  type HintSettings,
  type Passage,
  type Task,
} from "@ink-writer/core";
import { useState } from "react";
import { useLanguage } from "../i18n";
import type { Messages } from "../messages";

export interface HintsPanelProps {
  readonly settings: HintSettings;
  /** Open hints, without the ones put off for now. */
  readonly hints: readonly Hint[];
  readonly task: Task | null;
  readonly onSettings: (settings: HintSettings) => void;
  /** Asks for the next, more detailed step of a hint. */
  readonly onReveal: (hint: Hint) => void;
  readonly onDecide: (key: string, decision: HintDecision) => void;
  /** "Not now": out of the way until the novel is opened again. */
  readonly onLater: (key: string) => void;
  readonly onOpenPassage: (passage: Passage) => void;
  /** "I'll fix it myself": to the passage, ready to write. */
  readonly onFixMyself: (hint: Hint) => void;
  /** Puts the correction in the text. The only thing here that changes the manuscript. */
  readonly onApply: (hint: Hint) => void;
  readonly onOpenCard: (entityId: string) => void;
  readonly onOpenScene: (sceneId: string) => void;
  /** "Today I only want to write". */
  readonly onQuietToday: () => void;
  readonly onClose: () => void;
}

const where = (passage: Passage) => `${passage.chapterTitle} · ${passage.sceneTitle}`;

/** What a hint says at the step it's at: vague first, then pointed, then the exact detail. */
export function describeHint(hint: Hint, messages: Messages): string {
  if (hint.step === 1) {
    return messages.hintVague[hint.type === "corrections" ? "corrections" : "coherence"];
  }
  if (hint.kind === "question" || hint.kind === "suggestion") {
    return hint.reason;
  }
  if (hint.step === 2 && hint.other !== null) {
    return messages.hintPointed(where(hint.other));
  }
  return hint.reason;
}

function HintItem({ hint, props }: { readonly hint: Hint; readonly props: HintsPanelProps }) {
  const { messages } = useLanguage();
  const exact = hint.step === 3 || (hint.step === 2 && hint.other === null);
  return (
    <li className="hint">
      <p className="hint-kind">{messages.hintTypes[hint.type]}</p>
      <p>{describeHint(hint, messages)}</p>
      <button type="button" className="passage" onClick={() => props.onOpenPassage(hint.at)}>
        {exact ? <q>{hint.at.quote}</q> : messages.hintGoThere}
        <span className="passage-source">{where(hint.at)}</span>
      </button>
      {hint.step >= 2 && hint.other !== null && (
        <button
          type="button"
          className="passage"
          onClick={() => props.onOpenPassage(hint.other as Passage)}
        >
          {exact ? <q>{hint.other.quote}</q> : messages.hintGoThere}
          <span className="passage-source">{where(hint.other)}</span>
        </button>
      )}
      {exact && hint.fix !== null && <p>{messages.hintFix(hint.at.quote, hint.fix)}</p>}

      <div className="hint-actions">
        {!exact && (
          <button type="button" onClick={() => props.onReveal(hint)}>
            {messages.hintMore}
          </button>
        )}
        {hint.kind === "question" || hint.kind === "suggestion" ? (
          <>
            <button type="button" onClick={() => props.onFixMyself(hint)}>
              {messages.hintWriteNow}
            </button>
            <button type="button" onClick={() => props.onDecide(hint.key, "not_useful")}>
              {messages.hintNotUseful}
            </button>
          </>
        ) : hint.type === "corrections" ? (
          <>
            {exact && hint.fix !== null && (
              <button type="button" className="primary" onClick={() => props.onApply(hint)}>
                {messages.hintApply}
              </button>
            )}
            <button type="button" onClick={() => props.onDecide(hint.key, "leave")}>
              {messages.hintLeave}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => props.onFixMyself(hint)}>
              {messages.hintFixMyself}
            </button>
            <button type="button" onClick={() => props.onDecide(hint.key, "intentional")}>
              {messages.hintIntentional}
            </button>
          </>
        )}
        <button type="button" className="quiet" onClick={() => props.onLater(hint.key)}>
          {messages.hintLater}
        </button>
      </div>
    </li>
  );
}

/** Where a task leads. Each kind goes somewhere else. */
export interface TaskHandlers {
  readonly onOpenPassage: (passage: Passage) => void;
  readonly onFixMyself: (hint: Hint) => void;
  readonly onOpenCard: (entityId: string) => void;
  readonly onOpenScene: (sceneId: string) => void;
}

/** What a task asks, why it's proposed, and what doing it means (SPEC §3.5). */
export function describeTask(task: Task, messages: Messages, handlers: TaskHandlers) {
  return task.kind === "resolve"
    ? {
        body: messages.taskResolve,
        reason: messages.taskResolveReason(
          where(task.hint.at),
          task.hint.other === null ? null : where(task.hint.other),
        ),
        action: messages.taskResolveGo,
        go: () => handlers.onOpenPassage(task.hint.at),
      }
    : task.kind === "write"
      ? {
          body: task.hint.reason,
          reason: messages.taskWriteReason(where(task.hint.at)),
          action: messages.hintWriteNow,
          go: () => handlers.onFixMyself(task.hint),
        }
      : task.kind === "define"
        ? {
            body: messages.taskDefine(task.card.name),
            reason: messages.taskDefineReason(task.card.name, task.scenes),
            action: messages.taskDefineGo,
            go: () => handlers.onOpenCard(task.card.id),
          }
        : {
            body: messages.taskComplete(task.scene.title),
            reason: messages.taskCompleteReason,
            action: messages.taskCompleteGo,
            go: () => handlers.onOpenScene(task.scene.id),
          };
}

function TaskCard({ task, props }: { readonly task: Task; readonly props: HintsPanelProps }) {
  const { messages } = useLanguage();
  const text = describeTask(task, messages, props);
  return (
    <section className="task" aria-label={messages.taskTitle}>
      <h3>{messages.taskTitle}</h3>
      <p className="hint-kind">{messages.taskKinds[task.kind]}</p>
      <p className="task-body">{text.body}</p>
      <p>{text.reason}</p>
      <div className="hint-actions">
        <button type="button" className="primary" onClick={text.go}>
          {text.action}
        </button>
        <button type="button" onClick={() => props.onDecide(task.key, "not_useful")}>
          {messages.taskNotUseful}
        </button>
        <button type="button" className="quiet" onClick={props.onQuietToday}>
          {messages.taskQuietToday}
        </button>
      </div>
    </section>
  );
}

/**
 * Hints, the next step and how much of them the author wants (SPEC §3.4 and §3.5). It's a panel the
 * author opens: nothing here ever shows by itself while they write.
 */
export function HintsPanel(props: HintsPanelProps) {
  const { messages } = useLanguage();
  const { settings, hints, task, onSettings, onClose } = props;
  /** At "if I ask", hints stay out of sight until asked for, one at a time. */
  const [asked, setAsked] = useState(0);
  const shown = settings.level === "on_demand" ? hints.slice(0, asked) : hints;

  return (
    <aside className="panel panel-right hints-panel" aria-label={messages.hints}>
      <div className="panel-header">
        <h2>{messages.hints}</h2>
        <button type="button" onClick={onClose}>
          {messages.closePanel}
        </button>
      </div>

      {task !== null && <TaskCard task={task} props={props} />}

      {settings.level === "off" ? (
        <p>{messages.hintsOffNote}</p>
      ) : (
        <section aria-label={messages.hintsOpen}>
          <h3>{messages.hintsOpen}</h3>
          {settings.level !== "on_demand" && (
            <p role="status">{messages.hintsCount(hints.length)}</p>
          )}
          {settings.level === "on_demand" && asked < hints.length && (
            <button type="button" className="primary" onClick={() => setAsked(asked + 1)}>
              {asked === 0 ? messages.hintsAsk : messages.hintsAskAnother}
            </button>
          )}
          {settings.level === "on_demand" && hints.length === 0 && <p>{messages.hintsNone}</p>}
          <ul className="hints-list">
            {shown.map((hint) => (
              <HintItem key={hint.key} hint={hint} props={props} />
            ))}
          </ul>
        </section>
      )}

      <section className="hints-settings" aria-label={messages.hintsSettings}>
        <h3>{messages.hintsSettings}</h3>
        <fieldset className="ai-routes">
          <legend>{messages.hintsLevel}</legend>
          {HINT_LEVELS.map((level) => (
            <label key={level}>
              <input
                type="radio"
                name="hint-level"
                checked={settings.level === level}
                onChange={() => onSettings({ ...settings, level })}
              />
              <span>
                {messages.hintLevels[level]}
                <span className="hint-level-note">{messages.hintLevelNotes[level]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="ai-routes" disabled={settings.level === "off"}>
          <legend>{messages.hintsKinds}</legend>
          {HINT_TYPES.map((type) => (
            <label key={type}>
              <input
                type="checkbox"
                checked={settings.types[type]}
                onChange={(event) =>
                  onSettings({
                    ...settings,
                    types: { ...settings.types, [type]: event.target.checked },
                  })
                }
              />
              {messages.hintTypes[type]}
            </label>
          ))}
        </fieldset>
      </section>
    </aside>
  );
}

/**
 * The companion: a drop of ink with two eyes that stands by the text and offers the next hint. Our
 * own character, drawn here (DESIGN.md).
 */
export function Companion({ hint, onOpen }: { readonly hint: Hint; readonly onOpen: () => void }) {
  const { messages } = useLanguage();
  return (
    <div className="companion">
      <svg viewBox="0 0 48 60" width="48" height="60" aria-hidden="true">
        <path d="M24 2C24 2 6 26 6 39a18 18 0 0 0 36 0C42 26 24 2 24 2z" fill="currentColor" />
        <circle cx="18" cy="38" r="4" fill="var(--sheet)" />
        <circle cx="30" cy="38" r="4" fill="var(--sheet)" />
        <circle cx="19" cy="39" r="1.6" fill="currentColor" />
        <circle cx="31" cy="39" r="1.6" fill="currentColor" />
      </svg>
      <div className="companion-says">
        <p>{describeHint(hint, messages)}</p>
        <button type="button" onClick={onOpen}>
          {messages.companionOpen}
        </button>
      </div>
    </div>
  );
}
