import {
  compareTexts,
  type DiffPart,
  type Paragraph,
  paragraphsFromState,
  plainText,
  readParagraphs,
  type SceneSession,
  type SnapshotInfo,
  type Storage,
} from "@ink-writer/core";
import type { Editor } from "@tiptap/core";
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import { replaceProse } from "../editor/replace-prose";
import { useLanguage } from "../i18n";
import { describeError } from "../messages";

export interface HistoryPanelProps {
  readonly storage: Storage;
  readonly session: SceneSession;
  readonly editor: Editor | null;
  readonly onClose: () => void;
}

interface Comparison {
  readonly info: SnapshotInfo;
  readonly paragraphs: readonly Paragraph[];
  /** Null if the texts are too different to compare in reasonable time. */
  readonly parts: readonly DiffPart[] | null;
}

/** Versions of the scene (SPEC §3.3): saving one, comparing it with the text, and restoring it. */
export function HistoryPanel({ storage, session, editor, onClose }: HistoryPanelProps) {
  const { locale, messages } = useLanguage();
  const [versions, setVersions] = useState<readonly SnapshotInfo[]>([]);
  const [name, setName] = useState("");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const nameId = useId();

  const formatDate = (timestamp: number) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);

  const reload = useCallback(async () => {
    setVersions(await storage.listSnapshots(session.sceneId));
  }, [storage, session]);

  useEffect(() => {
    reload().catch((error: unknown) => setProblem(describeError(error)));
  }, [reload]);

  const guarded = async (action: () => Promise<void>) => {
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    void guarded(async () => {
      await session.snapshot(name.trim() === "" ? null : name.trim());
      setName("");
      setNotice(null);
      await reload();
    });
  };

  const compare = (info: SnapshotInfo) =>
    guarded(async () => {
      const state = await storage.loadSnapshot(info.id);
      if (state === null) {
        throw new Error(info.id);
      }
      const paragraphs = paragraphsFromState(state);
      const parts = compareTexts(plainText(paragraphs), plainText(readParagraphs(session.doc)));
      setNotice(null);
      setComparison({ info, paragraphs, parts });
    });

  /**
   * Restoring is one more edit: the current text is stored as a version first, and the content is
   * replaced through the editor. Nothing is rewritten, and it can be undone.
   */
  const restore = (target: Comparison) =>
    guarded(async () => {
      if (editor === null) {
        return;
      }
      await session.snapshot(messages.beforeRestore);
      replaceProse(editor, target.paragraphs);
      await session.flush();
      setComparison(null);
      setNotice(messages.restored);
      await reload();
    });

  const identical = comparison?.parts?.every((part) => part.kind === "same") ?? false;

  return (
    <aside className="panel panel-right" aria-label={messages.history}>
      <header className="panel-header">
        <h2>{messages.history}</h2>
        <button type="button" onClick={onClose}>
          {messages.closePanel}
        </button>
      </header>

      <form className="form" onSubmit={save}>
        <label htmlFor={nameId}>{messages.versionName}</label>
        <input id={nameId} value={name} onChange={(event) => setName(event.target.value)} />
        <button type="submit">{messages.saveVersion}</button>
      </form>

      {notice !== null && <p role="status">{notice}</p>}
      {problem !== null && (
        <p role="alert" className="problem">
          {problem}
        </p>
      )}

      {comparison !== null && (
        <section
          className="comparison"
          aria-label={messages.comparing(formatDate(comparison.info.createdAt))}
        >
          <h3>{messages.comparing(formatDate(comparison.info.createdAt))}</h3>
          {comparison.parts === null && <p>{messages.tooDifferent}</p>}
          {identical && <p>{messages.identical}</p>}
          {comparison.parts !== null && !identical && (
            <>
              <p className="legend">
                <del>{messages.onlyInVersion}</del> <ins>{messages.onlyInCurrent}</ins>
              </p>
              <div className="diff">
                {comparison.parts.map((part, index) => {
                  // The parts of a comparison never change or reorder once shown.
                  const key = `${index}-${part.kind}`;
                  if (part.kind === "added") return <ins key={key}>{part.text}</ins>;
                  if (part.kind === "removed") return <del key={key}>{part.text}</del>;
                  return <span key={key}>{part.text}</span>;
                })}
              </div>
            </>
          )}
          <button
            type="button"
            className="primary"
            disabled={identical}
            onClick={() => void restore(comparison)}
          >
            {messages.restoreVersion}
          </button>
        </section>
      )}

      {versions.length === 0 ? (
        <p>{messages.noVersions}</p>
      ) : (
        <ul className="versions">
          {versions.map((version) => {
            const when = formatDate(version.createdAt);
            return (
              <li key={version.id}>
                <button
                  type="button"
                  className="version"
                  aria-label={messages.compare(when)}
                  aria-current={comparison?.info.id === version.id ? "true" : undefined}
                  onClick={() => void compare(version)}
                >
                  <span className="version-when">{when}</span>
                  <span className="version-detail">
                    {version.label ?? messages.automaticVersion} ·{" "}
                    {messages.words(version.wordCount)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
