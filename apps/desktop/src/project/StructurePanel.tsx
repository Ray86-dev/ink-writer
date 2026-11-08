import type { Chapter, MoveDirection, Scene, Storage, Trash } from "@ink-writer/core";
import { type FormEvent, useId, useState } from "react";
import { useLanguage } from "../i18n";
import { MoveDownIcon, MoveUpIcon, RenameIcon, TrashIcon } from "./icons";

export interface ChapterNode {
  readonly chapter: Chapter;
  readonly scenes: readonly Scene[];
}

export interface StructurePanelProps {
  readonly storage: Storage;
  readonly tree: readonly ChapterNode[];
  readonly trash: Trash;
  readonly currentSceneId: string | null;
  readonly onSelect: (sceneId: string) => void;
  readonly onChanged: () => Promise<void>;
  readonly onClose: () => void;
  readonly projectId: string;
}

function InlineRename({
  value,
  onSave,
  onCancel,
}: {
  readonly value: string;
  readonly onSave: (name: string) => void;
  readonly onCancel: () => void;
}) {
  const { messages } = useLanguage();
  const [name, setName] = useState(value);
  const id = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(name);
  };
  return (
    <form className="rename" onSubmit={submit}>
      <label htmlFor={id} className="visually-hidden">
        {messages.nameLabel}
      </label>
      {/* biome-ignore lint/a11y/noAutofocus: focus follows the rename the author just asked for */}
      <input id={id} value={name} autoFocus onChange={(event) => setName(event.target.value)} />
      <button type="submit" disabled={name.trim() === ""}>
        {messages.saveName}
      </button>
      <button type="button" onClick={onCancel}>
        {messages.cancel}
      </button>
    </form>
  );
}

function RowActions({
  name,
  onRename,
  onMove,
  onTrash,
}: {
  readonly name: string;
  readonly onRename: () => void;
  readonly onMove: (direction: MoveDirection) => void;
  readonly onTrash: () => void;
}) {
  const { messages } = useLanguage();
  return (
    <span className="row-actions">
      <button type="button" aria-label={messages.rename(name)} onClick={onRename}>
        <RenameIcon />
      </button>
      <button type="button" aria-label={messages.moveUp(name)} onClick={() => onMove("up")}>
        <MoveUpIcon />
      </button>
      <button type="button" aria-label={messages.moveDown(name)} onClick={() => onMove("down")}>
        <MoveDownIcon />
      </button>
      <button type="button" aria-label={messages.moveToTrash(name)} onClick={onTrash}>
        <TrashIcon />
      </button>
    </span>
  );
}

export function StructurePanel({
  storage,
  tree,
  trash,
  currentSceneId,
  onSelect,
  onChanged,
  onClose,
  projectId,
}: StructurePanelProps) {
  const { messages } = useLanguage();
  const [renaming, setRenaming] = useState<string | null>(null);

  const change = async (action: () => Promise<unknown>) => {
    await action();
    await onChanged();
  };

  const addChapter = () =>
    change(async () => {
      const chapter = await storage.createChapter(
        projectId,
        messages.newChapterTitle(tree.length + 1),
      );
      const scene = await storage.createScene(chapter.id, messages.newSceneTitle(1));
      onSelect(scene.id);
    });

  const addScene = (node: ChapterNode) =>
    change(async () => {
      const scene = await storage.createScene(
        node.chapter.id,
        messages.newSceneTitle(node.scenes.length + 1),
      );
      onSelect(scene.id);
    });

  return (
    <aside className="panel panel-left" aria-label={messages.structure}>
      <header className="panel-header">
        <h2>{messages.structure}</h2>
        <button type="button" onClick={onClose}>
          {messages.closePanel}
        </button>
      </header>

      <ol className="chapters">
        {tree.map((node) => (
          <li key={node.chapter.id}>
            <div className="row row-chapter">
              {renaming === node.chapter.id ? (
                <InlineRename
                  value={node.chapter.title}
                  onCancel={() => setRenaming(null)}
                  onSave={(name) => {
                    setRenaming(null);
                    void change(() => storage.renameChapter(node.chapter.id, name));
                  }}
                />
              ) : (
                <>
                  <span className="row-title">{node.chapter.title}</span>
                  <RowActions
                    name={node.chapter.title}
                    onRename={() => setRenaming(node.chapter.id)}
                    onMove={(direction) =>
                      void change(() => storage.moveChapter(node.chapter.id, direction))
                    }
                    onTrash={() => void change(() => storage.trashChapter(node.chapter.id))}
                  />
                </>
              )}
            </div>
            <ol className="scenes">
              {node.scenes.map((scene) => (
                <li key={scene.id}>
                  <div className={`row ${scene.id === currentSceneId ? "row-current" : ""}`}>
                    {renaming === scene.id ? (
                      <InlineRename
                        value={scene.title}
                        onCancel={() => setRenaming(null)}
                        onSave={(name) => {
                          setRenaming(null);
                          void change(() => storage.renameScene(scene.id, name));
                        }}
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          className="row-title scene-open"
                          aria-current={scene.id === currentSceneId ? "true" : undefined}
                          onClick={() => onSelect(scene.id)}
                        >
                          {scene.title}
                        </button>
                        <RowActions
                          name={scene.title}
                          onRename={() => setRenaming(scene.id)}
                          onMove={(direction) =>
                            void change(() => storage.moveScene(scene.id, direction))
                          }
                          onTrash={() => void change(() => storage.trashScene(scene.id))}
                        />
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <button type="button" className="add" onClick={() => void addScene(node)}>
              {messages.addScene}
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="add" onClick={() => void addChapter()}>
        {messages.addChapter}
      </button>

      <section className="trash" aria-labelledby="trash-heading">
        <h3 id="trash-heading">{messages.trash}</h3>
        {trash.chapters.length === 0 && trash.scenes.length === 0 ? (
          <p>{messages.trashEmpty}</p>
        ) : (
          <ul>
            {trash.chapters.map((chapter) => (
              <li key={chapter.id} className="row">
                <span className="row-title">
                  {messages.chapterInTrash}: {chapter.title}
                </span>
                <button
                  type="button"
                  onClick={() => void change(() => storage.restoreChapter(chapter.id))}
                >
                  {messages.restore(chapter.title)}
                </button>
              </li>
            ))}
            {trash.scenes.map((scene) => (
              <li key={scene.id} className="row">
                <span className="row-title">
                  {messages.sceneInTrash}: {scene.title}
                </span>
                <button
                  type="button"
                  onClick={() => void change(() => storage.restoreScene(scene.id))}
                >
                  {messages.restore(scene.title)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
