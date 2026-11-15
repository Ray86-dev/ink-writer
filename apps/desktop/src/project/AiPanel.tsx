import {
  type AiConnection,
  type AiProvider,
  type AiTransport,
  acceptNotice,
  analysisModels,
  type ConnectionRoute,
  canBePriced,
  createConnectionProvider,
  type DayUsage,
  hasAcceptedNotice,
  isPaidConnection,
  loadSpendingCap,
  type ModelInfo,
  type RemoteRoute,
  type Storage,
  saveSpendingCap,
  spendingDay,
  usageOn,
} from "@ink-writer/core";
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import { useLanguage } from "../i18n";
import { describeConnectError, describeError, type Messages } from "../messages";
import type { AiShell, PaidRequestLimit } from "../shell";
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
 * Why the analysis stopped, in words the author can act on. The message comes from the service, the
 * shell or the spending guard, and starts with what went wrong. Null if it isn't one it knows.
 */
export function describeAnalysisProblem(message: string, messages: Messages): string | null {
  const problems = messages.aiProblems;
  if (message.startsWith("cap: no daily spending limit")) return problems.noCap;
  if (message.startsWith("cap: today's limit")) return problems.capReached;
  if (message.startsWith("cap:")) return problems.uncounted;
  if (message.includes("limit:")) return problems.requestsReached;
  if (message.includes("paid:")) return problems.paidOff;
  if (message.includes("key:")) return problems.keyStore;
  if (message.includes("can't reach the service")) return problems.unreachable;
  const code = /^(\d{3}|unknown_model)\b/.exec(message)?.[1];
  switch (code) {
    case "401":
    case "403":
      return problems.badKey;
    case "402":
      return problems.noCredit;
    case "404":
    case "unknown_model":
      return problems.unknownModel;
    case "429":
      return problems.rateLimited;
    case "500":
    case "502":
    case "503":
    case "504":
      return problems.serviceDown;
    default:
      return null;
  }
}

const dollars = (amount: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount > 0 && amount < 0.01 ? 4 : 2,
  }).format(amount);

/**
 * Which model reads the novel (SPEC §3.9). Nothing is chosen for the author: until they pick a
 * model, the app analyses nothing, and it never pays for one without a limit they set (rule 10).
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
  const { locale, messages } = useLanguage();
  const [choice, setChoice] = useState<Choice>(connection?.route ?? "off");
  const [models, setModels] = useState<Models>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [notices, setNotices] = useState<Readonly<Record<RemoteRoute, boolean>> | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [keyPresent, setKeyPresent] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [cap, setCap] = useState<number | null>(null);
  const [limit, setLimit] = useState<PaidRequestLimit>({ dailyRequests: 0, usedToday: 0 });
  const [usage, setUsage] = useState<DayUsage>({ requests: 0, cost: 0 });
  /** Through OpenRouter, paid models are only listed if the author asks for them here. */
  const [wantsPaid, setWantsPaid] = useState(
    connection !== null && connection.route === "openrouter" && isPaidConnection(connection),
  );
  const [capInput, setCapInput] = useState("");
  const [requestsInput, setRequestsInput] = useState("");
  const [keyInput, setKeyInput] = useState("");
  // The panel can be opened before the saved choice has been read: it shows it once it arrives.
  const savedRoute = connection?.route ?? null;
  const savedPaid = connection !== null && isPaidConnection(connection);
  useEffect(() => {
    if (savedRoute !== null) {
      setChoice(savedRoute);
      if (savedRoute === "openrouter" && savedPaid) {
        setWantsPaid(true);
      }
    }
  }, [savedRoute, savedPaid]);

  const modelId = useId();
  const capId = useId();
  const requestsId = useId();
  const keyId = useId();

  const refreshSpending = useCallback(async () => {
    const [savedCap, savedLimit, today] = await Promise.all([
      loadSpendingCap(storage),
      ai.paidRequestLimit(),
      usageOn(storage, spendingDay(new Date())),
    ]);
    setCap(savedCap);
    setLimit(savedLimit);
    setUsage(today);
    return { savedCap, savedLimit };
  }, [storage, ai]);

  useEffect(() => {
    let active = true;
    Promise.all([
      hasAcceptedNotice(storage, "openrouter"),
      hasAcceptedNotice(storage, "deepseek"),
      ai.openrouterConnected(),
      ai.deepseekKeyPresent(),
      refreshSpending(),
    ]).then(
      ([openrouter, deepseek, isConnected, hasKey, { savedCap, savedLimit }]) => {
        if (!active) return;
        setNotices({ openrouter, deepseek });
        setConnected(isConnected);
        setKeyPresent(hasKey);
        setCapInput(savedCap === null ? "" : String(savedCap));
        setRequestsInput(savedLimit.dailyRequests === 0 ? "" : String(savedLimit.dailyRequests));
      },
      (error: unknown) => {
        if (active) setProblem(describeError(error));
      },
    );
    return () => {
      active = false;
    };
  }, [storage, ai, refreshSpending]);

  // What was spent goes up as the analysis works.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `view` changes with each run
  useEffect(() => {
    refreshSpending().catch(() => {});
  }, [refreshSpending, view]);

  // An attempt left waiting for the browser ends with the panel.
  useEffect(() => () => ai.cancelConnectOpenrouter(), [ai]);

  const limitsSet = cap !== null && limit.dailyRequests > 0;
  const paidAllowed = limitsSet && (choice === "deepseek" || wantsPaid);
  const remote: RemoteRoute | null =
    choice === "openrouter" || choice === "deepseek" ? choice : null;
  const noticeAccepted = remote === null ? true : (notices?.[remote] ?? null);
  const reachable =
    choice === "ollama" ||
    (choice === "openrouter" && connected === true) ||
    (choice === "deepseek" && keyPresent === true && limitsSet);
  const canList = reachable && noticeAccepted === true;

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
          if (!active) return;
          setModels({
            status: "ready",
            // One whose cost can't be counted can't be held to a limit, so it isn't offered.
            list: analysisModels(choice, list, paidAllowed).filter((model) =>
              canBePriced({ route: choice, model: model.id }),
            ),
          });
        },
        () => {
          if (active) setModels({ status: "failed" });
        },
      );
    return () => {
      active = false;
    };
  }, [choice, canList, paidAllowed, ai, createProvider, attempt]);

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

  const accept = (route: RemoteRoute) =>
    guarded(async () => {
      await acceptNotice(storage, route);
      setNotices((current) => ({ openrouter: false, deepseek: false, ...current, [route]: true }));
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

  const saveKey = (event: FormEvent) => {
    event.preventDefault();
    void guarded(async () => {
      await ai.setDeepseekKey(keyInput);
      // It's in the shell now, and nowhere in the page.
      setKeyInput("");
      setKeyPresent(true);
    });
  };

  const removeKey = () =>
    guarded(async () => {
      if (connection?.route === "deepseek") {
        await onConnection(null);
      }
      await ai.clearDeepseekKey();
      setKeyPresent(false);
    });

  const saveLimits = (event: FormEvent) => {
    event.preventDefault();
    void guarded(async () => {
      const amount = Number(capInput.replace(",", "."));
      const requests = Math.floor(Number(requestsInput));
      const valid =
        Number.isFinite(amount) && amount > 0 && Number.isFinite(requests) && requests > 0;
      // Both or neither: a limit on one alone would leave the other open.
      await saveSpendingCap(storage, valid ? amount : null);
      await ai.setPaidRequestLimit(valid ? requests : 0);
      await refreshSpending();
      if (!valid) {
        setCapInput("");
        setRequestsInput("");
        // Without a limit nothing paid is used, so a paid choice is turned off rather than left on.
        if (connection !== null && isPaidConnection(connection)) {
          await onConnection(null);
        }
      }
    });
  };

  const selected = connection !== null && connection.route === choice ? connection.model : "";
  const names: Readonly<Record<Choice, string>> = {
    off: messages.aiRouteOff,
    ollama: messages.aiRouteOllama,
    openrouter: messages.aiRouteOpenrouter,
    deepseek: messages.aiRouteDeepseek,
  };
  const stopped = view.status === "waiting" || view.status === "blocked" ? view.message : null;
  const showLimits = choice === "deepseek" || (choice === "openrouter" && wantsPaid);
  const isPaidModel = (model: ModelInfo) =>
    choice !== "off" && isPaidConnection({ route: choice, model: model.id });

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
      {stopped !== null && (
        <p className="ai-detail">{describeAnalysisProblem(stopped, messages) ?? stopped}</p>
      )}

      <fieldset className="ai-routes">
        <legend>{messages.aiRouteLabel}</legend>
        {(["off", "ollama", "openrouter", "deepseek"] as const).map((value) => (
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

      {remote !== null && (
        <>
          <p className="ai-notice">{messages.aiNotices[remote]}</p>
          {noticeAccepted === false && (
            <button type="button" className="primary" onClick={() => void accept(remote)}>
              {messages.aiAcceptNotices[remote]}
            </button>
          )}
        </>
      )}

      {choice === "openrouter" && noticeAccepted === true && (
        <>
          <p>{messages.aiOpenrouterLimits}</p>
          {connected === false && !connecting && (
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
            <>
              <p>
                {messages.aiConnected}{" "}
                <button type="button" onClick={() => void disconnect()}>
                  {messages.aiDisconnect}
                </button>
              </p>
              <label className="ai-check">
                <input
                  type="checkbox"
                  checked={wantsPaid}
                  onChange={(event) => setWantsPaid(event.target.checked)}
                />
                {messages.aiWantPaid}
              </label>
            </>
          )}
        </>
      )}

      {choice === "deepseek" && noticeAccepted === true && (
        <>
          {keyPresent === false && (
            <form className="ai-form" onSubmit={saveKey}>
              <label htmlFor={keyId}>{messages.aiKeyLabel}</label>
              <input
                id={keyId}
                type="password"
                autoComplete="off"
                value={keyInput}
                onChange={(event) => setKeyInput(event.target.value)}
              />
              <p className="ai-detail">{messages.aiKeyHint}</p>
              <button type="submit" className="primary" disabled={keyInput.trim() === ""}>
                {messages.aiKeySave}
              </button>
            </form>
          )}
          {keyPresent === true && (
            <p>
              {messages.aiKeyPresent}{" "}
              <button type="button" onClick={() => void removeKey()}>
                {messages.aiKeyRemove}
              </button>
            </p>
          )}
        </>
      )}

      {showLimits && noticeAccepted === true && (
        <form className="ai-form" onSubmit={saveLimits} aria-label={messages.aiLimitsTitle}>
          <h3>{messages.aiLimitsTitle}</h3>
          <p>{messages.aiLimitsIntro}</p>
          <label htmlFor={capId}>{messages.aiCapLabel}</label>
          <input
            id={capId}
            inputMode="decimal"
            value={capInput}
            onChange={(event) => setCapInput(event.target.value)}
          />
          <label htmlFor={requestsId}>{messages.aiRequestsLabel}</label>
          <input
            id={requestsId}
            inputMode="numeric"
            value={requestsInput}
            onChange={(event) => setRequestsInput(event.target.value)}
          />
          <button type="submit">{messages.aiLimitsSave}</button>
          <p role="status" className="ai-detail">
            {limitsSet
              ? messages.aiSpentToday(
                  dollars(usage.cost, locale),
                  dollars(cap ?? 0, locale),
                  limit.usedToday,
                  limit.dailyRequests,
                )
              : messages.aiLimitsUnset}
          </p>
        </form>
      )}

      {canList && (
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
                    {isPaidModel(model)
                      ? messages.aiPaidModel(model.displayName)
                      : model.displayName}
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
