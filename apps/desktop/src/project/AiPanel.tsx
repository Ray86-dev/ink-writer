import {
  type AiConnection,
  type AiProvider,
  type AiTransport,
  acceptOpenRouterNotice,
  analysisModels,
  type ConnectionRoute,
  createConnectionProvider,
  hasAcceptedOpenRouterNotice,
  type ModelInfo,
  type Storage,
} from "@ink-writer/core";
import { useEffect, useId, useState } from "react";
import { useLanguage } from "../i18n";
import { describeConnectError, describeError, type Messages } from "../messages";
import type { AiShell } from "../shell";
import type { AnalysisView } from "./useAnalysis";

export interface AiPanelProps {
  readonly storage: Storage;
  readonly ai: AiShell;
  /** What analyses now. Null if the analysis is off. */
  readonly connection: AiConnection | null;
  /** Called with the author's choice, already saved. */
  readonly onConnection: (connection: AiConnection | null) => Promise<void>;
  readonly view: AnalysisView;
  readonly onClose: () => void;
  readonly createProvider?: (route: ConnectionRoute, transport: AiTransport) => AiProvider;
}

type Choice = "off" | ConnectionRoute;

type Models =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly list: readonly ModelInfo[] }
  | { readonly status: "failed" };

export function describeAnalysis(view: AnalysisView, messages: Messages): string {
  switch (view.status) {
    case "off":
      return messages.analysisOff;
    case "ready":
      return messages.analysisReady;
    case "working":
      return messages.analysisWorking;
    case "done":
      return view.skipped > 0 ? messages.analysisSkipped(view.skipped) : messages.analysisDone;
    case "waiting":
      return messages.analysisWaiting(view.pending);
    case "blocked":
      return messages.analysisBlocked(view.pending);
    case "failed":
      return messages.analysisFailed(view.message);
  }
}

/**
 * Which model reads the novel (SPEC §3.9, the part that ADR 0012 brings into M4). Nothing is chosen
 * for the author: until they pick a model, the app analyses nothing.
 */
export function AiPanel({
  storage,
  ai,
  connection,
  onConnection,
  view,
  onClose,
  createProvider = createConnectionProvider,
}: AiPanelProps) {
  const { messages } = useLanguage();
  const [choice, setChoice] = useState<Choice>(connection?.route ?? "off");
  const [models, setModels] = useState<Models>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [noticeAccepted, setNoticeAccepted] = useState<boolean | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const modelId = useId();

  useEffect(() => {
    let active = true;
    Promise.all([hasAcceptedOpenRouterNotice(storage), ai.openrouterConnected()]).then(
      ([accepted, isConnected]) => {
        if (!active) return;
        setNoticeAccepted(accepted);
        setConnected(isConnected);
      },
      (error: unknown) => {
        if (active) setProblem(describeError(error));
      },
    );
    return () => {
      active = false;
    };
  }, [storage, ai]);

  // An attempt left waiting for the browser ends with the panel.
  useEffect(() => () => ai.cancelConnectOpenrouter(), [ai]);

  const canList = choice === "ollama" || (choice === "openrouter" && connected === true);

  // `attempt` is only here to ask again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (choice === "off" || !canList) {
      return;
    }
    let active = true;
    setModels({ status: "loading" });
    createProvider(choice, ai.transport)
      .listModels()
      .then(
        (list) => {
          if (active) setModels({ status: "ready", list: analysisModels(choice, list) });
        },
        () => {
          if (active) setModels({ status: "failed" });
        },
      );
    return () => {
      active = false;
    };
  }, [choice, canList, ai, createProvider, attempt]);

  const guarded = async (action: () => Promise<void>) => {
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const choose = (next: Choice) => {
    setChoice(next);
    setProblem(null);
    if (next === "off" && connection !== null) {
      void guarded(() => onConnection(null));
    }
  };

  const pickModel = (model: string) => {
    if (choice === "off" || model === "") {
      return;
    }
    void guarded(() => onConnection({ route: choice, model }));
  };

  const acceptNotice = () =>
    guarded(async () => {
      await acceptOpenRouterNotice(storage);
      setNoticeAccepted(true);
    });

  const connect = async () => {
    setProblem(null);
    setConnecting(true);
    try {
      await ai.connectOpenrouter();
      setConnected(true);
    } catch (error) {
      setProblem(describeConnectError(error, messages));
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () =>
    guarded(async () => {
      // First, so that nothing is analysed with a key that's about to go.
      if (connection?.route === "openrouter") {
        await onConnection(null);
      }
      await ai.disconnectOpenrouter();
      setConnected(false);
    });

  const selected = connection !== null && connection.route === choice ? connection.model : "";
  const names: Readonly<Record<Choice, string>> = {
    off: messages.aiRouteOff,
    ollama: messages.aiRouteOllama,
    openrouter: messages.aiRouteOpenrouter,
  };

  return (
    <aside className="panel panel-right ai-panel" aria-label={messages.aiTitle}>
      <div className="panel-header">
        <h2>{messages.aiTitle}</h2>
        <button type="button" onClick={onClose}>
          {messages.closePanel}
        </button>
      </div>

      <p>{messages.aiIntro}</p>
      <p role="status" className="ai-current">
        {connection === null
          ? messages.aiCurrentNone
          : messages.aiCurrent(names[connection.route], connection.model)}{" "}
        {describeAnalysis(view, messages)}
      </p>
      {(view.status === "waiting" || view.status === "blocked") && view.message !== null && (
        <p className="ai-detail">{view.message}</p>
      )}

      <fieldset className="ai-routes">
        <legend>{messages.aiRouteLabel}</legend>
        {(["off", "ollama", "openrouter"] as const).map((value) => (
          <label key={value}>
            <input
              type="radio"
              name="ai-route"
              checked={choice === value}
              onChange={() => choose(value)}
            />
            {names[value]}
          </label>
        ))}
      </fieldset>

      {choice === "ollama" && <p>{messages.aiOllamaHint}</p>}

      {choice === "openrouter" && (
        <>
          <p className="ai-notice">{messages.aiOpenrouterNotice}</p>
          <p>{messages.aiOpenrouterLimits}</p>
          {noticeAccepted === false && (
            <button type="button" className="primary" onClick={() => void acceptNotice()}>
              {messages.aiAcceptNotice}
            </button>
          )}
          {noticeAccepted === true && connected === false && !connecting && (
            <button type="button" className="primary" onClick={() => void connect()}>
              {messages.aiConnect}
            </button>
          )}
          {connecting && (
            <p role="status">
              {messages.aiConnecting}{" "}
              <button type="button" onClick={() => ai.cancelConnectOpenrouter()}>
                {messages.cancel}
              </button>
            </p>
          )}
          {connected === true && (
            <p>
              {messages.aiConnected}{" "}
              <button type="button" onClick={() => void disconnect()}>
                {messages.aiDisconnect}
              </button>
            </p>
          )}
        </>
      )}

      {canList && (choice !== "openrouter" || noticeAccepted === true) && (
        <div className="ai-models">
          {models.status === "loading" && <p role="status">{messages.aiLoadingModels}</p>}
          {models.status === "failed" && (
            <p role="alert" className="problem">
              {choice === "ollama" ? messages.aiOllamaUnreachable : messages.aiModelsFailed}{" "}
              <button type="button" onClick={() => setAttempt((count) => count + 1)}>
                {messages.aiRetry}
              </button>
            </p>
          )}
          {models.status === "ready" && models.list.length === 0 && (
            <p>{choice === "ollama" ? messages.aiOllamaNoModels : messages.aiNoModels}</p>
          )}
          {models.status === "ready" && models.list.length > 0 && (
            <>
              <label htmlFor={modelId}>{messages.aiModelLabel}</label>
              <select
                id={modelId}
                value={selected}
                onChange={(event) => pickModel(event.target.value)}
              >
                <option value="">{messages.aiPickModel}</option>
                {/* The one in use stays visible even if the service no longer lists it. */}
                {selected !== "" && !models.list.some((model) => model.id === selected) && (
                  <option value={selected}>{selected}</option>
                )}
                {models.list.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      {problem !== null && (
        <p role="alert" className="problem">
          {problem}
        </p>
      )}
    </aside>
  );
}
