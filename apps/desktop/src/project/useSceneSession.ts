import {
  type SaveState,
  SceneSession,
  type SceneSessionOptions,
  type Storage,
} from "@ink-writer/core";
import { useEffect, useRef, useState } from "react";

export interface OpenScene {
  /** Null while it opens. */
  readonly session: SceneSession | null;
  readonly saveState: SaveState;
  readonly saveError: unknown;
  readonly openError: unknown;
  /** Finishes with the open scene, for when the app is about to close. Never rejects. */
  readonly closeCurrent: () => Promise<void>;
}

/**
 * One per database rather than per screen: leaving a novel and coming back right away has to find
 * what the previous screen was still saving.
 */
const queues = new WeakMap<Storage, { current: Promise<void> }>();

function queueFor(storage: Storage): { current: Promise<void> } {
  let queue = queues.get(storage);
  if (queue === undefined) {
    queue = { current: Promise.resolve() };
    queues.set(storage, queue);
  }
  return queue;
}

/**
 * Keeps one scene open at a time. Each one fully closes before the next opens, so that going back to
 * a scene always finds what was just written in it.
 */
export function useSceneSession(
  storage: Storage,
  sceneId: string | null,
  options?: SceneSessionOptions,
): OpenScene {
  const [session, setSession] = useState<SceneSession | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<unknown>(null);
  const [openError, setOpenError] = useState<unknown>(null);
  const queue = queueFor(storage);
  const current = useRef<SceneSession | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (sceneId === null) {
      return;
    }
    let active = true;
    let opened: SceneSession | null = null;
    let stopListening = () => {};

    queue.current = queue.current.then(async () => {
      if (!active) {
        return;
      }
      setOpenError(null);
      try {
        const next = await SceneSession.open(storage, sceneId, optionsRef.current);
        if (!active) {
          await next.close();
          return;
        }
        opened = next;
        current.current = next;
        stopListening = next.onSaveState((state) => {
          setSaveState(state);
          setSaveError(state === "failing" ? next.saveError : null);
        });
        setSaveState(next.saveState);
        setSession(next);
      } catch (error) {
        if (active) setOpenError(error);
      }
    });

    return () => {
      active = false;
      setSession(null);
      queue.current = queue.current.then(async () => {
        const closing = opened;
        if (closing !== null) {
          await closing.close();
          stopListening();
          if (current.current === closing) {
            current.current = null;
          }
        }
      });
    };
  }, [storage, sceneId, queue]);

  const closeCurrent = async () => {
    await queue.current;
    await current.current?.close();
  };

  return { session, saveState, saveError, openError, closeCurrent };
}
