import {
  buildHints,
  dayOf,
  type Hint,
  type HintDecision,
  type HintSettings,
  type HintStates,
  loadHintSettings,
  loadHintStates,
  NO_HINT_STATES,
  type NovelView,
  nextTask,
  type SceneText,
  type Storage,
  saveHintSettings,
  type Task,
} from "@ink-writer/core";
import { useCallback, useEffect, useMemo, useState } from "react";

export interface Hints {
  /** Null until the author's choice has been read: until then nothing is shown, as if off. */
  readonly settings: HintSettings | null;
  /** Open hints, without the ones put off for now. Empty with hints off. */
  readonly hints: readonly Hint[];
  readonly task: Task | null;
  readonly changeSettings: (settings: HintSettings) => Promise<void>;
  readonly reveal: (hint: Hint) => Promise<void>;
  readonly decide: (key: string, decision: HintDecision) => Promise<void>;
  /** "Not now": out of the way until the novel is opened again. */
  readonly later: (key: string) => void;
  readonly quietToday: () => Promise<void>;
}

const NO_HINTS: readonly Hint[] = [];

/**
 * The hints and the next step of the open novel, as the author wants them. Everything comes from the
 * cards: this never asks a model, and with hints off it yields nothing (SPEC §3.4).
 */
export function useHints(
  storage: Storage,
  projectId: string,
  view: NovelView,
  scenes: readonly SceneText[],
  onError: (error: unknown) => void,
  now: () => Date = () => new Date(),
): Hints {
  const [settings, setSettings] = useState<HintSettings | null>(null);
  const [states, setStates] = useState<HintStates>(NO_HINT_STATES);
  const [putOff, setPutOff] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let active = true;
    Promise.all([loadHintSettings(storage), loadHintStates(storage, projectId)]).then(
      ([loadedSettings, loadedStates]) => {
        if (!active) return;
        setSettings(loadedSettings);
        setStates(loadedStates);
      },
      onError,
    );
    return () => {
      active = false;
    };
  }, [storage, projectId, onError]);

  const hints = useMemo(
    () =>
      settings === null
        ? NO_HINTS
        : buildHints(view, settings, states).filter((hint) => !putOff.has(hint.key)),
    [view, settings, states, putOff],
  );

  const today = dayOf(now());
  const task = useMemo(
    () =>
      settings === null
        ? null
        : nextTask({
            view,
            hints,
            settings,
            states,
            scenes: scenes.map((scene) => ({
              id: scene.id,
              title: scene.title,
              chapterTitle: scene.chapterTitle,
              empty: scene.text.trim() === "",
            })),
            today,
          }),
    [view, hints, settings, states, scenes, today],
  );

  const changeSettings = useCallback(
    async (next: HintSettings) => {
      setSettings(next);
      await saveHintSettings(storage, next);
    },
    [storage],
  );

  const reveal = useCallback(
    async (hint: Hint) => {
      // A correction has nothing to point at in between: after the vague hint comes the detail.
      await storage.revealHint(projectId, hint.key, hint.other === null ? 3 : hint.step + 1);
      setStates(await loadHintStates(storage, projectId));
    },
    [storage, projectId],
  );

  const decide = useCallback(
    async (key: string, decision: HintDecision) => {
      await storage.decideHint(projectId, key, decision);
      setStates(await loadHintStates(storage, projectId));
    },
    [storage, projectId],
  );

  const later = useCallback((key: string) => {
    setPutOff((current) => new Set([...current, key]));
  }, []);

  const quietToday = useCallback(async () => {
    if (settings !== null) {
      await changeSettings({ ...settings, noTasksOn: today });
    }
  }, [settings, changeSettings, today]);

  return { settings, hints, task, changeSettings, reveal, decide, later, quietToday };
}
