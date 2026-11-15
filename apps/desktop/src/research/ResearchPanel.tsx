import {
  ITEM_CATEGORIES,
  type PlaceCandidate,
  type PlaceView,
  type Reality,
  type ResearchItem,
  type ResearchTopic,
  TermRefusedError,
} from "@ink-writer/core";
import { type FormEvent, useId, useState } from "react";
import { useLanguage } from "../i18n";
import { describeError, type Messages } from "../messages";
import type { Research } from "./useResearch";

/** What went wrong, in the author's words where the app knows them. */
function describeResearchError(error: unknown, messages: Messages): string {
  if (error instanceof TermRefusedError) {
    const { problem } = error;
    return problem.kind === "character"
      ? messages.docsTermProblems.character(problem.name)
      : messages.docsTermProblems[problem.kind];
  }
  return messages.docsSearchFailed(describeError(error));
}

interface Common {
  readonly research: Research;
  readonly onOpenLink: (url: string) => void;
}

/** What was found for a topic, by kind. Every piece shows where it comes from. */
function Items({
  items,
  research,
  onOpenLink,
}: Common & { readonly items: readonly ResearchItem[] }) {
  const { messages } = useLanguage();
  return (
    <>
      {ITEM_CATEGORIES.map((category) => {
        const group = items.filter((item) => item.category === category);
        if (group.length === 0) {
          return null;
        }
        return (
          <section key={category} aria-label={messages.docsCategories[category]}>
            <h4>{messages.docsCategories[category]}</h4>
            <ul className="docs-items">
              {group.map((item) => (
                <li key={item.id} className={item.status === "noted" ? "docs-noted" : undefined}>
                  <p>{item.text}</p>
                  <p className="docs-source">
                    {messages.docsSource}:{" "}
                    <button
                      type="button"
                      className="card-link"
                      title={item.sourceUrl}
                      onClick={() => onOpenLink(item.sourceUrl)}
                    >
                      {item.sourceTitle}
                    </button>
                  </p>
                  {item.status === "noted" ? (
                    <p className="docs-actions">
                      <span className="card-tag">{messages.docsInNotes}</span>
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => void research.setItemStatus(item.id, "suggested")}
                      >
                        {messages.docsOutOfNotes}
                      </button>
                    </p>
                  ) : (
                    <p className="docs-actions">
                      <button
                        type="button"
                        onClick={() => void research.setItemStatus(item.id, "noted")}
                      >
                        {messages.docsToNotes}
                      </button>
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => void research.setItemStatus(item.id, "dismissed")}
                      >
                        {messages.docsDiscard}
                      </button>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/** How a topic's search stands, with the button to search by hand. */
function TopicState({
  topic,
  items,
  research,
  guarded,
}: {
  readonly topic: ResearchTopic;
  readonly items: readonly ResearchItem[];
  readonly research: Research;
  readonly guarded: (action: () => Promise<void>) => void;
}) {
  const { messages } = useLanguage();
  if (topic.term === null) {
    return null;
  }
  return (
    <p className="docs-state">
      {topic.status === "pending" && messages.docsPending}
      {topic.status === "failed" && messages.docsFailed}
      {topic.status === "done" && items.length === 0 && messages.docsNothingFound}{" "}
      <button
        type="button"
        disabled={research.searching}
        onClick={() => guarded(() => research.searchNow(topic))}
      >
        {research.searching
          ? messages.docsSearching
          : topic.status === "pending"
            ? messages.docsSearchNow
            : messages.docsSearchAgain}
      </button>
    </p>
  );
}

function useGuard() {
  const { messages } = useLanguage();
  const [problem, setProblem] = useState<string | null>(null);
  const guarded = (action: () => Promise<void>) => {
    setProblem(null);
    action().catch((error: unknown) => setProblem(describeResearchError(error, messages)));
  };
  return { problem, guarded, setProblem };
}

/**
 * The documentation of one place. Before anything is looked up, the author says whether the place
 * exists: an invented one is never searched for (SPEC §3.7).
 */
export function PlaceDocs({ place, research, onOpenLink }: Common & { readonly place: PlaceView }) {
  const { messages } = useLanguage();
  const { topic } = place;
  const [asking, setAsking] = useState(false);
  const [reality, setReality] = useState<Reality>(topic?.reality ?? "real");
  const [term, setTerm] = useState(topic?.term ?? place.card.name);
  const [candidates, setCandidates] = useState<readonly PlaceCandidate[] | null>(null);
  const [finding, setFinding] = useState(false);
  const { problem, guarded } = useGuard();
  const termId = useId();
  const groupName = useId();

  const save = (candidate: PlaceCandidate | null) =>
    guarded(async () => {
      await research.answerPlace(
        place.card.name,
        reality === "invented" ? { reality } : { reality, term, place: candidate },
      );
      setAsking(false);
      setCandidates(null);
    });

  const find = (event: FormEvent) => {
    event.preventDefault();
    if (reality === "invented") {
      save(null);
      return;
    }
    setFinding(true);
    guarded(async () => {
      try {
        setCandidates(await research.findPlaces(term));
      } finally {
        setFinding(false);
      }
    });
  };

  const form = (
    <form onSubmit={find} className="docs-question">
      <fieldset>
        <legend>{messages.docsPlaceQuestion(place.card.name)}</legend>
        <p className="card-empty">{messages.docsPlaceQuestionHint}</p>
        {(["real", "based", "invented"] as const).map((value) => (
          <label key={value}>
            <input
              type="radio"
              name={groupName}
              checked={reality === value}
              onChange={() => {
                setReality(value);
                setCandidates(null);
              }}
            />{" "}
            {messages.docsRealityChoice[value]}
          </label>
        ))}
      </fieldset>
      {reality !== "invented" && (
        <p>
          <label htmlFor={termId}>{messages.docsRealName}</label>
          <input
            id={termId}
            value={term}
            maxLength={80}
            onChange={(event) => {
              setTerm(event.target.value);
              setCandidates(null);
            }}
          />
          <span className="card-empty">{messages.docsRealNameHint}</span>
        </p>
      )}
      <button type="submit" disabled={finding}>
        {reality === "invented"
          ? messages.docsSaveAnswer
          : finding
            ? messages.docsSearching
            : messages.docsFind}
      </button>
      {candidates !== null && reality !== "invented" && (
        <div className="docs-candidates">
          <p>{candidates.length === 0 ? messages.docsNoCandidates : messages.docsChoose}</p>
          <ul>
            {candidates.map((candidate) => (
              <li key={candidate.url}>
                <button type="button" onClick={() => save(candidate)}>
                  {candidate.label}
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="quiet" onClick={() => save(null)}>
                {messages.docsUseWithoutMap}
              </button>
            </li>
          </ul>
        </div>
      )}
    </form>
  );

  return (
    <section className="card-section docs-place" aria-label={messages.docsOf(place.card.name)}>
      <h3>{messages.docsOf(place.card.name)}</h3>
      {problem !== null && (
        <p role="alert" className="problem">
          {problem}
        </p>
      )}
      {topic === null || asking ? (
        form
      ) : (
        <>
          <p>
            <strong>{messages.docsRealityIs[topic.reality ?? "real"]}.</strong>{" "}
            {topic.term === null
              ? messages.docsInventedNote
              : messages.docsSearchedAs(topic.place?.label ?? topic.term)}{" "}
            <button type="button" className="quiet" onClick={() => setAsking(true)}>
              {messages.docsChangeAnswer}
            </button>
          </p>
          <TopicState topic={topic} items={place.items} research={research} guarded={guarded} />
          <Items items={place.items} research={research} onOpenLink={onOpenLink} />
        </>
      )}
    </section>
  );
}

/**
 * Everything looked up for the novel, in one place: its places, its era and the topics the author
 * added. It's reached from the cards, never shown while writing (SPEC §3.7).
 */
export function DocsOverview({ research, onOpenLink }: Common) {
  const { messages } = useLanguage();
  const { view, limit } = research;
  const [topic, setTopic] = useState("");
  const [limitText, setLimitText] = useState<string | null>(null);
  const { problem, guarded } = useGuard();
  const topicId = useId();
  const limitId = useId();

  const add = (event: FormEvent) => {
    event.preventDefault();
    guarded(async () => {
      await research.addTopic(topic);
      setTopic("");
    });
  };
  const saveLimit = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(limitText ?? limit?.dailyRequests ?? 0);
    if (Number.isInteger(value) && value >= 0) {
      guarded(async () => {
        await research.setLimit(value);
        setLimitText(null);
      });
    }
  };

  return (
    <article className="card docs" aria-label={messages.cardsTabs.docs}>
      <header>
        <h2>{messages.cardsTabs.docs}</h2>
        <p className="card-empty">{messages.docsIntro}</p>
        <p className="card-empty">{messages.docsPrivacy}</p>
        {!view.proactive && <p className="card-empty">{messages.docsManualOnly}</p>}
      </header>

      {problem !== null && (
        <p role="alert" className="problem">
          {problem}
        </p>
      )}
      {research.stopped !== null && (
        <p role="status" className="notice">
          {messages.docsStopped[research.stopped]}
        </p>
      )}
      {research.searching && <p role="status">{messages.docsSearching}</p>}

      <section className="card-section" aria-label={messages.docsEra}>
        <h3>{messages.docsEra}</h3>
        <p>{view.presentEra ? messages.docsEraPresent : messages.docsEraPast}</p>
        {view.era !== null && (
          <>
            <p className="docs-state">
              {messages.docsSearchedAs(view.era.term)}{" "}
              {view.era.topic === null ? (
                <button
                  type="button"
                  disabled={research.searching}
                  onClick={() => guarded(research.searchEraNow)}
                >
                  {messages.docsSearchNow}
                </button>
              ) : null}
            </p>
            {view.era.topic !== null && (
              <TopicState
                topic={view.era.topic}
                items={view.era.items}
                research={research}
                guarded={guarded}
              />
            )}
            <Items items={view.era.items} research={research} onOpenLink={onOpenLink} />
          </>
        )}
      </section>

      <section className="card-section" aria-label={messages.docsTopics}>
        <h3>{messages.docsTopics}</h3>
        <form onSubmit={add}>
          <label htmlFor={topicId}>{messages.docsTopicLabel}</label>
          <input
            id={topicId}
            value={topic}
            maxLength={80}
            placeholder={messages.docsTopicsHint}
            onChange={(event) => setTopic(event.target.value)}
          />
          <button type="submit" disabled={topic.trim() === ""}>
            {messages.docsAddTopic}
          </button>
        </form>
        {view.topics.map((item) => (
          <section key={item.topic.id} className="docs-topic" aria-label={item.topic.name}>
            <h4>
              {item.topic.name}{" "}
              <button
                type="button"
                className="quiet"
                onClick={() => guarded(() => research.removeTopic(item.topic.id))}
              >
                {messages.docsRemoveTopic(item.topic.name)}
              </button>
            </h4>
            <TopicState
              topic={item.topic}
              items={item.items}
              research={research}
              guarded={guarded}
            />
            <Items items={item.items} research={research} onOpenLink={onOpenLink} />
          </section>
        ))}
      </section>

      {view.places.length > 0 && <h3>{messages.docsPlaces}</h3>}
      {view.places.map((place) => (
        <PlaceDocs
          key={`${place.card.id}-${place.topic?.id ?? ""}-${place.topic?.reality ?? ""}`}
          place={place}
          research={research}
          onOpenLink={onOpenLink}
        />
      ))}

      <section className="card-section">
        <h3>
          <label htmlFor={limitId}>{messages.docsLimitTitle}</label>
        </h3>
        <form onSubmit={saveLimit}>
          <input
            id={limitId}
            type="number"
            min={0}
            max={500}
            step={1}
            value={limitText ?? String(limit?.dailyRequests ?? "")}
            onChange={(event) => setLimitText(event.target.value)}
          />
          <button type="submit" disabled={limit === null}>
            {messages.docsLimitSave}
          </button>
        </form>
        <p className="card-empty">
          {limit !== null && messages.docsLimitUsed(limit.usedToday, limit.dailyRequests)}{" "}
          {messages.docsLimitHint}
        </p>
      </section>

      <p className="card-empty">{messages.docsAttribution}</p>
    </article>
  );
}
