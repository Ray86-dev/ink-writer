import {
  type AiConnection,
  type AiProvider,
  type AiTransport,
  AnalysisQueue,
  type ConnectionRoute,
  connectionAllowed,
  createConnectionProvider,
  type Project,
  SpendingGuard,
  type Storage,
} from "@ink-writer/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { describeError } from "../messages";

/** What the analysis is doing, for the author to see: offline and refused have to show. */
export type AnalysisView =
  | { readonly status: "off" }
  /** On, with nothing to say yet: it waits for a pause in the writing before it reads. */
  | { readonly status: "ready" }
  | { readonly status: "working" }
  | {
      readonly status: "done" | "waiting" | "blocked";
      /** Scenes still queued. */
      readonly pending: number;
      /** Scenes the model gave no usable answer for. */
      readonly skipped: number;
      readonly message: string | null;
    }
  /** Something other than the model went wrong, as the database. */
  | { readonly status: "failed"; readonly message: string };

export interface AnalysisOptions {
  /** Replaced in tests, which have no model to talk to. */
  readonly createProvider?: (route: ConnectionRoute, transport: AiTransport) => AiProvider;
  readonly pauseMs?: number;
  readonly retryMs?: number;
}

export interface Analysis {
  readonly view: AnalysisView;
  /** Called as the author types. It only restarts a timer. */
  readonly sceneEdited: (sceneId: string) => void;
  /** Called once a scene the author left is saved. */
  readonly sceneClosed: (sceneId: string) => void;
}

const OFF: AnalysisView = { status: "off" };
const READY: AnalysisView = { status: "ready" };
const WORKING: AnalysisView = { status: "working" };

/**
 * Runs the analysis queue of the open novel with the model the author chose, and with no other
 * (rule 10). Without a choice it does nothing at all.
 */
export function useAnalysis(
  storage: Storage,
  project: Project,
  transport: AiTransport,
  connection: AiConnection | null,
  options: AnalysisOptions = {},
): Analysis {
  const [view, setView] = useState<AnalysisView>(OFF);
  const queue = useRef<AnalysisQueue | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const route = connection?.route ?? null;
  const model = connection?.model ?? null;

  useEffect(() => {
    setView(OFF);
    if (route === null || model === null) {
      return;
    }
    let active = true;
    let started: AnalysisQueue | null = null;
    const { createProvider = createConnectionProvider, pauseMs, retryMs } = optionsRef.current;

    connectionAllowed(storage, { route, model })
      .then((allowed) => {
        if (!active || !allowed) {
          return;
        }
        // Counts what's spent and stops a paid model at the author's limit, or without one.
        const guard = new SpendingGuard(storage, { route, model });
        started = new AnalysisQueue({
          storage,
          projectId: project.id,
          beforeScene: () => guard.check(),
          analysis: {
            provider: createProvider(route, transport),
            model,
            language: project.language,
            onUsage: guard.onUsage,
            onStep: () => {
              if (active) setView(WORKING);
            },
          },
          ...(pauseMs === undefined ? {} : { pauseMs }),
          ...(retryMs === undefined ? {} : { retryMs }),
          onRun: (run) => {
            if (!active || run.status === "cancelled") {
              return;
            }
            setView({
              status: run.status,
              pending: run.pending,
              skipped: run.skipped.length,
              message: run.message,
            });
          },
          onError: (error) => {
            if (active) setView({ status: "failed", message: describeError(error) });
          },
        });
        queue.current = started;
        setView(READY);
        started.start();
      })
      .catch((error: unknown) => {
        if (active) setView({ status: "failed", message: describeError(error) });
      });

    return () => {
      active = false;
      if (started !== null) {
        if (queue.current === started) {
          queue.current = null;
        }
        // What it was doing is cancelled, and the scene stays queued with its old data untouched.
        void started.stop();
      }
    };
  }, [storage, project.id, project.language, transport, route, model]);

  const sceneEdited = useCallback((sceneId: string) => queue.current?.sceneEdited(sceneId), []);
  const sceneClosed = useCallback((sceneId: string) => queue.current?.sceneClosed(sceneId), []);

  return { view, sceneEdited, sceneClosed };
}
