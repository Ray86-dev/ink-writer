import {
  buildNetwork,
  type EntityCard,
  HINT_LEVELS,
  type Hint,
  type NetworkNode,
  type NovelView,
  type Passage,
  type ResearchView,
} from "@ink-writer/core";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { CardSelection } from "../cards/CardsScreen";
import { describeTask } from "../hints/HintsPanel";
import type { Hints } from "../hints/useHints";
import { useLanguage } from "../i18n";
import type { Messages } from "../messages";
import { createInkNetwork, type InkNetwork } from "./ink-network";
import { loadThreePainter, type PainterLoader } from "./three-painter";

export interface DashboardProps {
  readonly projectId: string;
  readonly view: NovelView;
  /** False until the cards have been worked out for the first time. */
  readonly ready: boolean;
  readonly hints: Hints;
  readonly research: ResearchView;
  /** Today, as YYYY-MM-DD. */
  readonly today: string;
  readonly onOpenCards: (selection: CardSelection) => void;
  readonly onOpenCard: (entityId: string) => void;
  readonly onOpenPassage: (passage: Passage) => void;
  readonly onOpenScene: (sceneId: string) => void;
  readonly onFixMyself: (hint: Hint) => void;
  /** To the text, where the author left it. */
  readonly onWrite: () => void;
  /** What paints the network. Without it, three.js and WebGL. */
  readonly loadPainter?: PainterLoader;
}

const SHOWN = 4;

type TileId = keyof Messages["dashTiles"];

interface TileItem {
  readonly key: string;
  readonly label: string;
  readonly note?: string;
  readonly fresh?: boolean;
  readonly open: () => void;
}

interface Tile {
  readonly id: TileId;
  /** Null for a tile that counts nothing. */
  readonly count: number | null;
  readonly items: readonly TileItem[];
  readonly empty: string;
  readonly alert?: boolean;
  readonly note?: string;
  readonly all?: () => void;
  readonly extra?: ReactNode;
}

/** What was on the Dashboard the last time the author looked, to tell what's new since. */
function readSeen(key: string): ReadonlySet<string> | null {
  try {
    const stored = localStorage.getItem(key);
    const value: unknown = stored === null ? null : JSON.parse(stored);
    return Array.isArray(value) ? new Set(value.filter((item) => typeof item === "string")) : null;
  } catch {
    return null;
  }
}

function writeSeen(key: string, seen: readonly string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(seen));
  } catch {
    // Only a convenience: without it, nothing is marked as new.
  }
}

const lessMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const suggested = (items: readonly { readonly status: string }[]) =>
  items.filter((item) => item.status === "suggested").length;

/**
 * The home of a novel (SPEC §3.1): the novel as a network of ink, one next step, and a card for
 * each side of it. The network is only a way in: everything in it is in the cards too, so that
 * nothing is lost on a machine that can't paint it. Nothing here runs while the author writes.
 */
export function Dashboard({
  projectId,
  view,
  ready,
  hints,
  research,
  today,
  onOpenCards,
  onOpenCard,
  onOpenPassage,
  onOpenScene,
  onFixMyself,
  onWrite,
  loadPainter = loadThreePainter,
}: DashboardProps) {
  const { messages } = useLanguage();
  const hero = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const labels = useRef<HTMLFieldSetElement>(null);
  const next = useRef<HTMLElement>(null);
  const levels = useRef<HTMLFieldSetElement>(null);
  const engine = useRef<InkNetwork | null>(null);
  /** Off: this machine can't paint the network, or stopped being able to. */
  const [ink, setInk] = useState<"loading" | "on" | "off">("loading");

  const network = useMemo(() => buildNetwork(view), [view]);

  useEffect(() => {
    const [area, surface, names] = [hero.current, canvas.current, labels.current];
    if (area === null || surface === null || names === null) {
      return;
    }
    let gone = false;
    let made: InkNetwork | null = null;
    const stop = () => {
      made?.dispose();
      made = null;
      engine.current = null;
      if (!gone) setInk("off");
    };
    loadPainter(surface, stop).then(
      (painter) => {
        if (gone) {
          painter?.dispose();
          return;
        }
        if (painter === null) {
          setInk("off");
          return;
        }
        made = createInkNetwork({
          hero: area,
          labels: names,
          painter,
          reducedMotion: lessMotion(),
          // On a narrow window the network sits in the room left under the next step.
          textBottom: () =>
            next.current === null ? 0 : next.current.offsetTop + next.current.offsetHeight - 400,
        });
        engine.current = made;
        setInk("on");
      },
      () => {
        if (!gone) setInk("off");
      },
    );
    return () => {
      gone = true;
      made?.dispose();
      engine.current = null;
    };
  }, [loadPainter]);

  // After the labels are on the page, since the network places them.
  useEffect(() => {
    if (ink === "on") {
      engine.current?.setNetwork(network);
    }
  }, [network, ink]);

  const seenKey = `dashboard-seen-${projectId}`;
  const [seen] = useState(() => readSeen(seenKey));
  const isNew = (key: string) => seen !== null && !seen.has(key);
  useEffect(() => {
    if (ready) {
      writeSeen(seenKey, [
        ...view.chapters.map((chapter) => `chapter:${chapter.id}`),
        ...view.cards.map((card) => `card:${card.id}`),
        ...view.relations.map((relation) => `relation:${relation.id}`),
      ]);
    }
  }, [ready, seenKey, view]);

  const openNode = async (node: NetworkNode) => {
    // The ink floods from the node, and the card takes the screen.
    await engine.current?.flood(node.key);
    onOpenCards(
      node.kind === "chapter" ? { tab: "chapters", id: node.id } : { tab: node.kind, id: node.id },
    );
  };

  const settings = hints.settings;
  const task = hints.task;
  const told =
    task === null
      ? null
      : describeTask(task, messages, { onOpenPassage, onFixMyself, onOpenCard, onOpenScene });

  const cardsOf = (type: EntityCard["type"], note?: (card: EntityCard) => string | undefined) =>
    view.cards
      .filter((card) => card.type === type)
      .map((card) => ({ card, fresh: isNew(`card:${card.id}`) }))
      // What's new first, and then what the novel returns to most.
      .sort(
        (a, b) => Number(b.fresh) - Number(a.fresh) || b.card.scenes.length - a.card.scenes.length,
      )
      .map(({ card, fresh }): TileItem => {
        const extra = note?.(card);
        return {
          key: card.id,
          label: card.name,
          fresh,
          open: () => onOpenCards({ tab: card.type, id: card.id }),
          ...(extra === undefined ? {} : { note: extra }),
        };
      });

  const placeNotes = new Map(
    research.places.map((place) => [place.card.id, suggested(place.items)] as const),
  );
  const variants = new Set<string>();
  const similarNames = view.names.flatMap((entry) =>
    entry.similar.flatMap((other): TileItem[] => {
      const key = [entry.name, other.name].sort().join("\u001e");
      if (variants.has(key)) {
        return [];
      }
      variants.add(key);
      return [
        {
          key,
          label: messages.dashSimilar(entry.name, other.name),
          open: () => onOpenCards({ tab: "names", id: null }),
        },
      ];
    }),
  );
  const moments = view.chapters.flatMap((chapter) =>
    chapter.when.map(
      (moment): TileItem => ({
        key: `${moment.sceneId}-${moment.quote}`,
        label: moment.storyTime,
        note: chapter.title,
        open: () => onOpenCards({ tab: "chapters", id: chapter.id }),
      }),
    ),
  );
  const unresolved = view.cards
    .filter((card) => card.issues.length > 0)
    .map(
      (card): TileItem => ({
        key: card.id,
        label: card.name,
        note: messages.dashToResolve(card.issues.length),
        open: () => onOpenCards({ tab: card.type, id: card.id }),
      }),
    );
  const toAnswer = research.places.filter((place) => place.topic === null).length;
  const suggestions = [
    ...research.places,
    ...research.topics,
    ...(research.era === null ? [] : [research.era]),
  ].reduce((sum, topic) => sum + suggested(topic.items), 0);
  const found: TileItem[] = [
    ...research.places
      .filter((place) => suggested(place.items) > 0)
      .map(
        (place): TileItem => ({
          key: `place-${place.card.id}`,
          label: place.card.name,
          note: messages.dashSuggestions(suggested(place.items)),
          open: () => onOpenCards({ tab: "place", id: place.card.id }),
        }),
      ),
    ...[...research.topics, ...(research.era?.topic == null ? [] : [research.era])]
      .filter((topic) => suggested(topic.items) > 0)
      .map(
        (topic): TileItem => ({
          key: `topic-${topic.topic?.id ?? ""}`,
          label: topic.topic?.name ?? "",
          note: messages.dashSuggestions(suggested(topic.items)),
          open: () => onOpenCards({ tab: "docs", id: null }),
        }),
      ),
    ...(toAnswer === 0
      ? []
      : [
          {
            key: "to-answer",
            label: messages.dashPlacesToAnswer(toAnswer),
            open: () => onOpenCards({ tab: "docs", id: null }),
          },
        ]),
  ];

  const tiles: readonly Tile[] = [
    {
      id: "chapters",
      count: view.chapters.length,
      items: [...view.chapters].reverse().map(
        (chapter, index): TileItem => ({
          key: chapter.id,
          label: chapter.title,
          fresh: isNew(`chapter:${chapter.id}`),
          open: () => onOpenCards({ tab: "chapters", id: chapter.id }),
          ...(index === 0 ? { note: messages.dashCurrent } : {}),
        }),
      ),
      empty: messages.dashNothingYet,
      all: () => onOpenCards({ tab: "chapters", id: null }),
    },
    {
      id: "people",
      count: view.cards.filter((card) => card.type === "person").length,
      items: cardsOf("person"),
      empty: messages.dashNothingYet,
      all: () => onOpenCards({ tab: "person", id: null }),
    },
    {
      id: "relations",
      count: view.relations.length,
      items: view.relations.map((relation): TileItem => {
        const label = relation.links[0]?.label;
        return {
          key: relation.id,
          label: `${relation.a.name} · ${relation.b.name}`,
          fresh: isNew(`relation:${relation.id}`),
          open: () => onOpenCards({ tab: "relations", id: relation.id }),
          ...(label === undefined ? {} : { note: label }),
        };
      }),
      empty: messages.dashNothingYet,
      all: () => onOpenCards({ tab: "relations", id: null }),
    },
    {
      id: "places",
      count: view.cards.filter((card) => card.type === "place").length,
      items: cardsOf("place", (card) => {
        const count = placeNotes.get(card.id) ?? 0;
        return count === 0 ? undefined : messages.dashSuggestions(count);
      }),
      empty: messages.dashNothingYet,
      all: () => onOpenCards({ tab: "place", id: null }),
    },
    {
      id: "names",
      count: view.names.length,
      // Names that may be one and the same first: that's what the index is for. Otherwise, the
      // most used.
      items:
        similarNames.length > 0
          ? similarNames
          : [...view.names]
              .sort((a, b) => b.uses - a.uses)
              .map(
                (entry): TileItem => ({
                  key: `${entry.entity.id}-${entry.name}`,
                  label: entry.name,
                  open: () => onOpenCards({ tab: entry.entity.type, id: entry.entity.id }),
                }),
              ),
      empty: messages.dashNothingYet,
      all: () => onOpenCards({ tab: "names", id: null }),
    },
    {
      id: "lore",
      count: view.cards.filter((card) => card.type === "lore").length,
      items: cardsOf("lore"),
      empty: messages.dashNothingYet,
      all: () => onOpenCards({ tab: "lore", id: null }),
    },
    {
      id: "timeline",
      count: moments.length,
      items: moments,
      empty: messages.dashNoTimeline,
      all: () => onOpenCards({ tab: "chapters", id: null }),
    },
    {
      id: "checks",
      count: view.issues.length,
      items: unresolved,
      empty: messages.dashNoChecks,
      alert: view.issues.length > 0,
      note: messages.dashChecksNote,
    },
    {
      id: "docs",
      count: suggestions,
      items: found,
      empty: messages.dashNoDocs,
      all: () => onOpenCards({ tab: "docs", id: null }),
    },
    {
      id: "help",
      count: null,
      items: [
        {
          key: "levels",
          label: messages.dashHelpLevels,
          open: () => {
            const first = levels.current?.querySelector("button");
            first?.scrollIntoView?.({ block: "center" });
            first?.focus();
          },
        },
      ],
      empty: "",
      extra: (
        <>
          <details>
            <summary>{messages.dashHelpWhyTitle}</summary>
            <p>{messages.dashHelpWhy}</p>
          </details>
          <details>
            <summary>{messages.dashHelpCardsTitle}</summary>
            <p>{messages.dashHelpCards}</p>
          </details>
        </>
      ),
    },
  ];

  const kindName = (node: NetworkNode) =>
    node.kind === "chapter" ? messages.cardsChapterKind : messages.cardsTypes[node.kind];
  const trimmed = network.hidden.chapters + network.hidden.cards > 0;

  return (
    <main className="dash">
      <div className={ink === "off" ? "dash-hero dash-no-ink" : "dash-hero"} ref={hero}>
        {/* Only a picture: every node is a button further down, and a card below. */}
        <div className="dash-ink" aria-hidden="true" hidden={ink === "off"}>
          <canvas ref={canvas} />
        </div>

        {settings !== null && (
          <div className="dash-top">
            <span className="dash-levels-label">{messages.hints}</span>
            <fieldset className="dash-seg" ref={levels}>
              <legend className="visually-hidden">{messages.hintsLevel}</legend>
              {HINT_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={settings.level === level}
                  title={messages.hintLevelNotes[level]}
                  onClick={() => void hints.changeSettings({ ...settings, level })}
                >
                  {messages.hintLevels[level]}
                </button>
              ))}
            </fieldset>
          </div>
        )}

        <fieldset className="dash-labels" ref={labels} hidden={ink !== "on"}>
          <legend className="visually-hidden">{messages.dashNetwork}</legend>
          {ink === "on" &&
            network.nodes.map((node) => (
              <button
                key={node.key}
                type="button"
                data-node={node.key}
                className={`dash-node dash-node-${node.kind}${node.conflict ? " dash-node-conflict" : ""}`}
                aria-label={messages.dashOpenNode(node.name, kindName(node), node.conflict)}
                title={node.name}
                onPointerEnter={() => engine.current?.setActive(node.key)}
                onPointerLeave={() => engine.current?.setActive(null)}
                onFocus={() => engine.current?.setActive(node.key)}
                onBlur={() => engine.current?.setActive(null)}
                onClick={() => void openNode(node)}
              >
                {node.label}
              </button>
            ))}
        </fieldset>

        <section className="dash-next" aria-label={messages.taskTitle} ref={next}>
          {settings === null ? null : settings.level === "off" ? (
            <>
              <h1>{messages.dashOffTitle}</h1>
              <p>{messages.hintsOffNote}</p>
              <div className="dash-actions">
                <button type="button" className="primary" onClick={onWrite}>
                  {messages.dashWrite}
                </button>
                <button
                  type="button"
                  onClick={() => void hints.changeSettings({ ...settings, level: "discreet" })}
                >
                  {messages.dashOffTurnOn}
                </button>
              </div>
            </>
          ) : task === null || told === null ? (
            <>
              <h1>{messages.dashNoTaskTitle}</h1>
              <p>{settings.noTasksOn === today ? messages.dashQuietToday : messages.dashNoTask}</p>
              <div className="dash-actions">
                <button type="button" className="primary" onClick={onWrite}>
                  {messages.dashWrite}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="dash-kicker">
                {messages.taskTitle} · {messages.taskKinds[task.kind]}
              </p>
              <h1>{told.body}</h1>
              <p>{told.reason}</p>
              <div className="dash-actions">
                <button type="button" className="primary" onClick={told.go}>
                  {told.action}
                </button>
                <button type="button" onClick={() => void hints.decide(task.key, "not_useful")}>
                  {messages.taskNotUseful}
                </button>
                <button type="button" onClick={() => void hints.quietToday()}>
                  {messages.taskQuietToday}
                </button>
                <button type="button" onClick={onWrite}>
                  {messages.dashWrite}
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      <div className="dash-board">
        <div className="dash-board-head">
          <h2>{messages.dashBoard}</h2>
          {ink === "on" && trimmed && <p className="dash-trimmed">{messages.dashTrimmed}</p>}
        </div>
        <div className="dash-grid">
          {tiles.map((tile, index) => {
            const title = messages.dashTiles[tile.id];
            const news = tile.items.filter((item) => item.fresh === true).length;
            return (
              <section
                key={tile.id}
                className={tile.alert === true ? "dash-card dash-alert" : "dash-card"}
                aria-label={title}
                style={{ "--i": index % 5 } as CSSProperties}
              >
                <header>
                  <h3>{title}</h3>
                  {tile.count !== null && <span className="dash-count">{tile.count}</span>}
                </header>
                {news > 0 && <p className="dash-news">{messages.dashNews(news)}</p>}
                {(tile.count ?? 0) === 0 && tile.items.length === 0 && tile.extra === undefined && (
                  <p className="dash-empty">{tile.empty}</p>
                )}
                <ul>
                  {tile.items.slice(0, SHOWN).map((item) => (
                    <li key={item.key}>
                      <button type="button" className="card-link" onClick={item.open}>
                        {item.label}
                      </button>
                      {item.note !== undefined && <span className="dash-note"> · {item.note}</span>}
                      {item.fresh === true && (
                        <span className="dash-new"> · {messages.dashNew}</span>
                      )}
                    </li>
                  ))}
                </ul>
                {tile.extra}
                {tile.note !== undefined && <p className="dash-empty">{tile.note}</p>}
                {tile.all !== undefined && (tile.count ?? 0) + tile.items.length > 0 && (
                  <button
                    type="button"
                    className="quiet"
                    aria-label={messages.dashSeeAllOf(title)}
                    onClick={tile.all}
                  >
                    {messages.dashSeeAll}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
