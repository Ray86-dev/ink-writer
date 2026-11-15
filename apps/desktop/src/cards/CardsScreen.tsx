import {
  addOverride,
  type CardIssue,
  type ChapterCard,
  type EntityCard,
  type EntityRef,
  type NovelView,
  type Override,
  type Passage,
  type RelationCard,
  type Storage,
} from "@ink-writer/core";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { useLanguage } from "../i18n";
import { describeError, type Messages } from "../messages";
import { DocsOverview, PlaceDocs } from "../research/ResearchPanel";
import type { Research } from "../research/useResearch";

export type CardsTab = "person" | "place" | "lore" | "relations" | "chapters" | "names" | "docs";

/** Which card is open: the tab it's under and its id. */
export interface CardSelection {
  readonly tab: CardsTab;
  readonly id: string | null;
}

export interface CardsScreenProps {
  readonly storage: Storage;
  readonly projectId: string;
  readonly view: NovelView;
  readonly selection: CardSelection;
  readonly onSelect: (selection: CardSelection) => void;
  /** Goes to the passage in the editor. */
  readonly onOpenPassage: (passage: Passage) => void;
  readonly onOpenScene: (sceneId: string) => void;
  /** What was looked up about the novel's places and topics. */
  readonly research: Research;
  /** Opens the source of something found, in the author's browser. */
  readonly onOpenLink: (url: string) => void;
  /** Called after the author changed something, for the cards to be worked out again. */
  readonly onChanged: () => Promise<void>;
  readonly onClose: () => void;
}

const TABS: readonly CardsTab[] = [
  "person",
  "place",
  "lore",
  "relations",
  "chapters",
  "names",
  "docs",
];
const ENTITY_TABS = ["person", "place", "lore"] as const;

const isEntityTab = (tab: CardsTab): tab is EntityRef["type"] =>
  (ENTITY_TABS as readonly string[]).includes(tab);

function PassageButton({
  passage,
  children,
  onOpen,
}: {
  readonly passage: Passage;
  readonly children?: ReactNode;
  readonly onOpen: (passage: Passage) => void;
}) {
  const { messages } = useLanguage();
  return (
    <button
      type="button"
      className="passage"
      title={messages.cardsOpenPassage}
      onClick={() => onOpen(passage)}
    >
      <q>{children ?? passage.quote}</q>
      <span className="passage-source">
        {passage.chapterTitle} · {passage.sceneTitle}
      </span>
    </button>
  );
}

function EntityLink({
  entity,
  onSelect,
}: {
  readonly entity: EntityRef;
  readonly onSelect: (selection: CardSelection) => void;
}) {
  return (
    <button
      type="button"
      className="card-link"
      onClick={() => onSelect({ tab: entity.type, id: entity.id })}
    >
      {entity.name}
    </button>
  );
}

function Issues({
  issues,
  messages,
  onOpenPassage,
}: {
  readonly issues: readonly CardIssue[];
  readonly messages: Messages;
  readonly onOpenPassage: (passage: Passage) => void;
}) {
  if (issues.length === 0) {
    return null;
  }
  return (
    <section className="card-section card-issues" aria-label={messages.cardsOpenIssues}>
      <h3>{messages.cardsOpenIssues}</h3>
      <ul>
        {issues.map((issue) => (
          <li key={`${issue.kind}-${issue.a.sceneId}-${issue.a.quote}-${issue.b?.quote ?? ""}`}>
            <p>
              <strong>{messages.cardsIssueKinds[issue.kind]}.</strong> {issue.reason}
            </p>
            <PassageButton passage={issue.a} onOpen={onOpenPassage} />
            {issue.b !== null && <PassageButton passage={issue.b} onOpen={onOpenPassage} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface EntityDetailProps {
  readonly card: EntityCard;
  readonly view: NovelView;
  readonly onSelect: (selection: CardSelection) => void;
  readonly onOpenPassage: (passage: Passage) => void;
  readonly apply: (override: Override) => Promise<void>;
  readonly undo: (overrideId: string) => Promise<void>;
  readonly research: Research;
  readonly onOpenLink: (url: string) => void;
}

function EntityDetail({
  card,
  view,
  onSelect,
  onOpenPassage,
  apply,
  undo,
  research,
  onOpenLink,
}: EntityDetailProps) {
  const { messages } = useLanguage();
  const [note, setNote] = useState(card.note ?? "");
  const [name, setName] = useState(card.name);
  const [mergeWith, setMergeWith] = useState("");
  const noteId = useId();
  const nameId = useId();
  const typeId = useId();
  const mergeId = useId();
  const parentId = useId();

  const others = view.cards.filter((other) => other.id !== card.id);
  const places = others.filter((other) => other.type === "place");
  // A place can't go inside one that's already inside it.
  const possibleParents = places.filter(
    (place) => !place.within.some((parent) => parent.id === card.id),
  );
  const placeDocs = research.view.places.find((place) => place.card.id === card.id);

  const saveNote = (event: FormEvent) => {
    event.preventDefault();
    void apply({ kind: "note", entityId: card.id, text: note.trim() });
  };
  const rename = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() !== "" && name.trim() !== card.name) {
      void apply({ kind: "correction", entityId: card.id, name: name.trim() });
    }
  };

  return (
    <article className="card" aria-label={card.name}>
      <header>
        <p className="card-kind">{messages.cardsTypes[card.type]}</p>
        <h2>{card.name}</h2>
        {card.aliases.length > 0 && (
          <p className="card-aliases">{messages.cardsAlsoCalled(card.aliases.join(", "))}</p>
        )}
        {card.within.length > 0 && (
          <p className="card-within">
            {messages.cardsWithin}{" "}
            {card.within.map((place, index) => (
              <span key={place.id}>
                {index > 0 && " › "}
                <EntityLink entity={place} onSelect={onSelect} />
              </span>
            ))}
          </p>
        )}
        {card.contains.length > 0 && (
          <p className="card-within">
            {messages.cardsContains}{" "}
            {card.contains.map((place, index) => (
              <span key={place.id}>
                {index > 0 && ", "}
                <EntityLink entity={place} onSelect={onSelect} />
              </span>
            ))}
          </p>
        )}
      </header>

      {card.summary !== null && (
        <section className="card-section card-summary" aria-label={messages.cardsSummary}>
          <h3>{messages.cardsSummary}</h3>
          <p>{card.summary}</p>
          <p className="card-empty">{messages.cardsSummaryNote}</p>
        </section>
      )}

      <Issues issues={card.issues} messages={messages} onOpenPassage={onOpenPassage} />

      <section className="card-section" aria-label={messages.cardsWritten}>
        <h3>{messages.cardsWritten}</h3>
        {card.facts.length === 0 && <p className="card-empty">{messages.cardsNoFacts}</p>}
        <ul>
          {card.facts.map((fact) => (
            <li key={`${fact.sceneId}-${fact.quote}-${fact.attribute}`}>
              <PassageButton passage={fact} onOpen={onOpenPassage}>
                {fact.sentence}
              </PassageButton>
              {fact.inDialogue && <span className="card-tag">{messages.cardsInDialogue}</span>}
              <button
                type="button"
                className="quiet"
                aria-label={messages.cardsDismissFact(fact.quote)}
                onClick={() =>
                  void apply({ kind: "dismiss", entityId: card.id, quote: fact.quote })
                }
              >
                {messages.cardsDismiss}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {card.relations.length > 0 && (
        <section className="card-section" aria-label={messages.cardsRelations}>
          <h3>{messages.cardsRelations}</h3>
          <ul>
            {card.relations.map((relation) => (
              <li key={`${relation.sceneId}-${relation.quote}-${relation.other.id}`}>
                <p>
                  {relation.outgoing
                    ? messages.cardsRelationOut(relation.label)
                    : messages.cardsRelationIn(relation.label)}{" "}
                  <EntityLink entity={relation.other} onSelect={onSelect} />
                </p>
                <PassageButton passage={relation} onOpen={onOpenPassage} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {card.linkedFrom.length > 0 && (
        <section className="card-section" aria-label={messages.cardsLinkedFrom}>
          <h3>{messages.cardsLinkedFrom}</h3>
          <ul className="card-links">
            {card.linkedFrom.map((other) => (
              <li key={other.id}>
                <EntityLink entity={other} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {placeDocs !== undefined && (
        <PlaceDocs
          key={`${placeDocs.topic?.id ?? ""}-${placeDocs.topic?.reality ?? ""}`}
          place={placeDocs}
          research={research}
          onOpenLink={onOpenLink}
        />
      )}

      <section className="card-section">
        <h3>
          <label htmlFor={noteId}>{messages.cardsMyNote}</label>
        </h3>
        <form onSubmit={saveNote}>
          <textarea
            id={noteId}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <button type="submit">{messages.cardsSaveNote}</button>
        </form>
      </section>

      <section className="card-section card-actions" aria-label={messages.cardsCorrect}>
        <h3>{messages.cardsCorrect}</h3>
        <p className="card-empty">{messages.cardsCorrectHint}</p>

        <form onSubmit={rename}>
          <label htmlFor={nameId}>{messages.cardsName}</label>
          <input id={nameId} value={name} onChange={(event) => setName(event.target.value)} />
          <button type="submit">{messages.cardsRename}</button>
        </form>

        <div>
          <label htmlFor={typeId}>{messages.cardsType}</label>
          <select
            id={typeId}
            value={card.type}
            onChange={(event) =>
              void apply({
                kind: "correction",
                entityId: card.id,
                type: event.target.value as EntityRef["type"],
              })
            }
          >
            {ENTITY_TABS.map((type) => (
              <option key={type} value={type}>
                {messages.cardsTypes[type]}
              </option>
            ))}
          </select>
        </div>

        {card.type === "place" && (
          <div>
            <label htmlFor={parentId}>{messages.cardsParent}</label>
            <select
              id={parentId}
              value={card.within.at(-1)?.id ?? ""}
              onChange={(event) =>
                void apply({
                  kind: "correction",
                  entityId: card.id,
                  parentId: event.target.value === "" ? null : event.target.value,
                })
              }
            >
              <option value="">{messages.cardsNoParent}</option>
              {possibleParents.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {others.length > 0 && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (mergeWith !== "") {
                void apply({ kind: "merge", from: mergeWith, into: card.id });
                setMergeWith("");
              }
            }}
          >
            <label htmlFor={mergeId}>{messages.cardsMerge}</label>
            <select
              id={mergeId}
              value={mergeWith}
              onChange={(event) => setMergeWith(event.target.value)}
            >
              <option value="">{messages.cardsMergePick}</option>
              {others.map((other) => (
                <option key={other.id} value={other.id}>
                  {other.name}
                </option>
              ))}
            </select>
            <button type="submit" disabled={mergeWith === ""}>
              {messages.cardsMergeDo}
            </button>
          </form>
        )}

        {card.merged.length > 0 && (
          <ul className="card-undo">
            {card.merged.map((merged) => (
              <li key={merged.overrideId}>
                {messages.cardsMergedWith(merged.name)}{" "}
                <button type="button" onClick={() => void undo(merged.overrideId)}>
                  {messages.cardsUndoMerge(merged.name)}
                </button>
              </li>
            ))}
          </ul>
        )}

        {card.aliases.length > 0 && (
          <ul className="card-undo">
            {card.aliases.map((alias) => (
              <li key={alias}>
                <button
                  type="button"
                  onClick={() =>
                    void apply({
                      kind: "split",
                      entityId: card.id,
                      name: alias,
                      newEntityId: crypto.randomUUID(),
                    })
                  }
                >
                  {messages.cardsSplit(alias)}
                </button>
              </li>
            ))}
          </ul>
        )}

        {card.splitOverrideId !== null && (
          <p>
            {messages.cardsWasSplit}{" "}
            <button type="button" onClick={() => void undo(card.splitOverrideId as string)}>
              {messages.cardsUndoSplit}
            </button>
          </p>
        )}

        <button
          type="button"
          className="quiet"
          onClick={() => void apply({ kind: "dismiss", entityId: card.id })}
        >
          {messages.cardsDismissCard}
        </button>
      </section>
    </article>
  );
}

function RelationDetail({
  card,
  onSelect,
  onOpenPassage,
}: {
  readonly card: RelationCard;
  readonly onSelect: (selection: CardSelection) => void;
  readonly onOpenPassage: (passage: Passage) => void;
}) {
  const { messages } = useLanguage();
  return (
    <article className="card" aria-label={`${card.a.name} · ${card.b.name}`}>
      <header>
        <p className="card-kind">{messages.cardsRelationKind}</p>
        <h2>
          <EntityLink entity={card.a} onSelect={onSelect} /> ·{" "}
          <EntityLink entity={card.b} onSelect={onSelect} />
        </h2>
      </header>
      <section className="card-section" aria-label={messages.cardsWritten}>
        <h3>{messages.cardsWritten}</h3>
        <ul>
          {card.links.map((link) => (
            <li key={`${link.sceneId}-${link.quote}-${link.label}`}>
              <p>
                {link.from.name}: {link.label} → {link.to.name}
              </p>
              <PassageButton passage={link} onOpen={onOpenPassage} />
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

function ChapterDetail({
  card,
  onSelect,
  onOpenPassage,
  onOpenScene,
}: {
  readonly card: ChapterCard;
  readonly onSelect: (selection: CardSelection) => void;
  readonly onOpenPassage: (passage: Passage) => void;
  readonly onOpenScene: (sceneId: string) => void;
}) {
  const { messages } = useLanguage();
  const group = (title: string, entities: readonly EntityRef[]) =>
    entities.length > 0 && (
      <section className="card-section" aria-label={title}>
        <h3>{title}</h3>
        <ul className="card-links">
          {entities.map((entity) => (
            <li key={entity.id}>
              <EntityLink entity={entity} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      </section>
    );
  const nothing =
    card.people.length + card.places.length + card.lore.length + card.when.length === 0;
  return (
    <article className="card" aria-label={card.title}>
      <header>
        <p className="card-kind">{messages.cardsChapterKind}</p>
        <h2>{card.title}</h2>
      </header>
      <section className="card-section" aria-label={messages.cardsScenes}>
        <h3>{messages.cardsScenes}</h3>
        <ul className="card-links">
          {card.scenes.map((scene) => (
            <li key={scene.id}>
              <button type="button" className="card-link" onClick={() => onOpenScene(scene.id)}>
                {scene.title}
              </button>
            </li>
          ))}
        </ul>
      </section>
      {card.changes.length > 0 && (
        <section className="card-section" aria-label={messages.cardsChanges}>
          <h3>{messages.cardsChanges}</h3>
          <ul>
            {card.changes.map((item) => (
              <li key={item.sceneId}>
                <p>{item.change}</p>
                <button
                  type="button"
                  className="card-link"
                  onClick={() => onOpenScene(item.sceneId)}
                >
                  {item.sceneTitle}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Issues issues={card.issues} messages={messages} onOpenPassage={onOpenPassage} />
      {nothing && <p className="card-empty">{messages.cardsChapterEmpty}</p>}
      {group(messages.cardsWho, card.people)}
      {group(messages.cardsWhere, card.places)}
      {group(messages.cardsTabs.lore, card.lore)}
      {card.when.length > 0 && (
        <section className="card-section" aria-label={messages.cardsWhen}>
          <h3>{messages.cardsWhen}</h3>
          <ul>
            {card.when.map((moment) => (
              <li key={`${moment.sceneId}-${moment.quote}`}>
                <p>{moment.storyTime}</p>
                <PassageButton passage={moment} onOpen={onOpenPassage} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

function NamesIndex({
  view,
  onSelect,
  apply,
}: {
  readonly view: NovelView;
  readonly onSelect: (selection: CardSelection) => void;
  readonly apply: (override: Override) => Promise<void>;
}) {
  const { messages } = useLanguage();
  return (
    <article className="card" aria-label={messages.cardsTabs.names}>
      <header>
        <h2>{messages.cardsTabs.names}</h2>
        <p className="card-empty">{messages.cardsNamesHint}</p>
      </header>
      {view.names.length === 0 && <p className="card-empty">{messages.cardsNone}</p>}
      <table className="names">
        <thead>
          <tr>
            <th scope="col">{messages.cardsName}</th>
            <th scope="col">{messages.cardsNameCard}</th>
            <th scope="col">{messages.cardsNameUses}</th>
          </tr>
        </thead>
        <tbody>
          {view.names.map((entry) => (
            <tr key={`${entry.entity.id}-${entry.name}`}>
              <th scope="row">
                {entry.name}
                {entry.similar.map((similar) => (
                  <p key={`${similar.entity.id}-${similar.name}`} className="names-similar">
                    {messages.cardsSimilar(similar.name)}{" "}
                    <button
                      type="button"
                      onClick={() =>
                        void apply({
                          kind: "merge",
                          from: similar.entity.id,
                          into: entry.entity.id,
                        })
                      }
                    >
                      {messages.cardsMergeNames(similar.name, entry.entity.name)}
                    </button>
                  </p>
                ))}
              </th>
              <td>
                <EntityLink entity={entry.entity} onSelect={onSelect} />
              </td>
              <td>{entry.uses}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

/**
 * The cards of the novel (SPEC §3.2). Everything here comes from the text, and every piece goes back
 * to it. What the author changes is kept apart from the analysis, so it outlives it (rule 4).
 */
export function CardsScreen({
  storage,
  projectId,
  view,
  selection,
  onSelect,
  onOpenPassage,
  onOpenScene,
  research,
  onOpenLink,
  onChanged,
  onClose,
}: CardsScreenProps) {
  const { messages } = useLanguage();
  const [problem, setProblem] = useState<string | null>(null);

  const guarded = async (action: () => Promise<void>) => {
    setProblem(null);
    try {
      await action();
      await onChanged();
    } catch (error) {
      setProblem(describeError(error));
    }
  };
  const apply = (override: Override) => guarded(() => addOverride(storage, projectId, override));
  const undo = (overrideId: string) => guarded(() => storage.removeOverride(overrideId));

  const { tab } = selection;
  const items: readonly { readonly id: string; readonly label: string }[] = isEntityTab(tab)
    ? view.cards
        .filter((card) => card.type === tab)
        .map((card) => ({ id: card.id, label: card.name }))
    : tab === "relations"
      ? view.relations.map((card) => ({ id: card.id, label: `${card.a.name} · ${card.b.name}` }))
      : tab === "chapters"
        ? view.chapters.map((card) => ({ id: card.id, label: card.title }))
        : [];
  // A card that's gone, as after a merge, hands over to the first of its list.
  const selectedId = items.some((item) => item.id === selection.id)
    ? selection.id
    : (items[0]?.id ?? null);

  const entityCard = isEntityTab(tab) ? view.cards.find((card) => card.id === selectedId) : null;
  const relationCard =
    tab === "relations" ? view.relations.find((card) => card.id === selectedId) : null;
  const chapterCard =
    tab === "chapters" ? view.chapters.find((card) => card.id === selectedId) : null;
  const count = (which: CardsTab) =>
    isEntityTab(which)
      ? view.cards.filter((card) => card.type === which).length
      : which === "relations"
        ? view.relations.length
        : which === "chapters"
          ? view.chapters.length
          : which === "names"
            ? view.names.length
            : // What's been found and the author hasn't looked at yet.
              [
                ...research.view.places,
                ...research.view.topics,
                ...(research.view.era === null ? [] : [research.view.era]),
              ].reduce(
                (sum, topic) =>
                  sum + topic.items.filter((item) => item.status === "suggested").length,
                0,
              );
  const listed = tab !== "names" && tab !== "docs";

  return (
    <section className="cards" aria-label={messages.cards}>
      <nav className="cards-index" aria-label={messages.cardsIndex}>
        <div className="panel-header">
          <h2>{messages.cards}</h2>
          <button type="button" onClick={onClose}>
            {messages.cardsBack}
          </button>
        </div>
        <ul className="cards-tabs">
          {TABS.map((value) => (
            <li key={value}>
              <button
                type="button"
                aria-pressed={tab === value}
                onClick={() => onSelect({ tab: value, id: null })}
              >
                {messages.cardsTabs[value]} <span className="count">{count(value)}</span>
              </button>
            </li>
          ))}
        </ul>
        {listed && (
          <ul className="cards-list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={item.id === selectedId ? "true" : undefined}
                  onClick={() => onSelect({ tab, id: item.id })}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <div className="cards-detail">
        {problem !== null && (
          <p role="alert" className="problem">
            {problem}
          </p>
        )}
        {listed && items.length === 0 && (
          <p className="card-empty">
            {view.cards.length === 0 ? messages.cardsNoneYet : messages.cardsNone}
          </p>
        )}
        {entityCard != null && (
          <EntityDetail
            key={`${entityCard.id}-${entityCard.name}-${entityCard.note ?? ""}`}
            card={entityCard}
            view={view}
            onSelect={onSelect}
            onOpenPassage={onOpenPassage}
            apply={apply}
            undo={undo}
            research={research}
            onOpenLink={onOpenLink}
          />
        )}
        {relationCard != null && (
          <RelationDetail card={relationCard} onSelect={onSelect} onOpenPassage={onOpenPassage} />
        )}
        {chapterCard != null && (
          <ChapterDetail
            card={chapterCard}
            onSelect={onSelect}
            onOpenPassage={onOpenPassage}
            onOpenScene={onOpenScene}
          />
        )}
        {tab === "names" && <NamesIndex view={view} onSelect={onSelect} apply={apply} />}
        {tab === "docs" && <DocsOverview research={research} onOpenLink={onOpenLink} />}
      </div>
    </section>
  );
}
