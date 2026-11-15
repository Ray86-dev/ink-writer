import type { Storage } from "@ink-writer/core";
import { useEffect, useId, useState } from "react";
import { useLanguage } from "../i18n";
import { describeError } from "../messages";
import type { AvailableUpdate, UpdateShell } from "../shell";

/** Where the author's choice to look for updates on starting is kept. Off unless it says "on". */
export const UPDATE_ON_START_SETTING = "update-check-on-start";
export const RELEASES_URL = "https://github.com/Ray86-dev/ink-writer/releases";

type Status =
  | { readonly at: "idle" }
  | { readonly at: "checking" }
  | { readonly at: "none" }
  | { readonly at: "available"; readonly update: AvailableUpdate }
  | { readonly at: "installing"; readonly update: AvailableUpdate }
  | { readonly at: "failed"; readonly detail: string };

export interface UpdatesProps {
  readonly storage: Storage;
  readonly updates: UpdateShell;
  readonly onOpenLink: (url: string) => void;
}

/**
 * Updates, on the screen of the novels, where no text is open. Looking for one is a connection the
 * author didn't ask for, so the app only looks when they press the button, unless they turn on
 * looking each time it starts. Nothing is installed without them pressing for it.
 */
export function Updates({ storage, updates, onOpenLink }: UpdatesProps) {
  const { messages } = useLanguage();
  const [version, setVersion] = useState<string | null>(null);
  const [onStart, setOnStart] = useState(false);
  const [status, setStatus] = useState<Status>({ at: "idle" });
  const onStartId = useId();

  useEffect(() => {
    let active = true;
    updates.version().then(
      (value) => {
        if (active) setVersion(value);
      },
      () => {},
    );
    storage.getSetting(UPDATE_ON_START_SETTING).then(
      async (saved) => {
        if (!active || saved !== "on") return;
        setOnStart(true);
        // Quietly: with no connection, or with nothing new, the author is told nothing.
        const update = await updates.check().catch(() => null);
        if (active && update !== null) {
          setStatus({ at: "available", update });
        }
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [storage, updates]);

  const check = async () => {
    setStatus({ at: "checking" });
    try {
      const update = await updates.check();
      setStatus(update === null ? { at: "none" } : { at: "available", update });
    } catch (error) {
      setStatus({ at: "failed", detail: describeError(error) });
    }
  };

  const install = async (update: AvailableUpdate) => {
    setStatus({ at: "installing", update });
    try {
      // The app starts again by itself once it's installed.
      await updates.install();
    } catch (error) {
      setStatus({ at: "failed", detail: describeError(error) });
    }
  };

  const changeOnStart = (next: boolean) => {
    setOnStart(next);
    storage.setSetting(UPDATE_ON_START_SETTING, next ? "on" : null).catch(() => {});
  };

  const busy = status.at === "checking" || status.at === "installing";
  const found = status.at === "available" || status.at === "installing" ? status.update : null;

  return (
    <div className="updates">
      <h3>{messages.updatesTitle}</h3>
      {version !== null && <p className="card-empty">{messages.updatesVersion(version)}</p>}

      <button type="button" disabled={busy} onClick={() => void check()}>
        {messages.updatesCheck}
      </button>

      <p role="status">
        {status.at === "checking" && messages.updatesChecking}
        {status.at === "none" && messages.updatesNone}
        {status.at === "installing" && messages.updatesInstalling}
        {status.at === "available" && messages.updatesAvailable(status.update.version)}
      </p>
      {status.at === "failed" && (
        <p role="alert" className="problem">
          {messages.updatesFailed(status.detail)}
        </p>
      )}

      {found !== null && (
        <>
          {found.notes !== null && found.notes.trim() !== "" && (
            <p className="updates-notes">{found.notes}</p>
          )}
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void install(found)}
          >
            {messages.updatesInstall}
          </button>
        </>
      )}
      {(found !== null || status.at === "failed") && (
        <button type="button" className="quiet" onClick={() => onOpenLink(RELEASES_URL)}>
          {messages.updatesSeeReleases}
        </button>
      )}

      <label className="updates-on-start" htmlFor={onStartId}>
        <input
          id={onStartId}
          type="checkbox"
          checked={onStart}
          onChange={(event) => changeOnStart(event.target.checked)}
        />
        {messages.updatesOnStart}
      </label>
      <p className="card-empty">{messages.updatesPrivacy}</p>
    </div>
  );
}
