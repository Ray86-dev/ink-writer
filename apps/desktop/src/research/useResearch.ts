import {
  addEraTopic,
  addTopic,
  answerPlace,
  buildResearchView,
  checkTerm,
  findPlaces,
  type HintSettings,
  loadResearch,
  NO_RESEARCH,
  type NovelView,
  type PlaceAnswer,
  type PlaceCandidate,
  type Project,
  peopleNames,
  type ResearchDeps,
  ResearchStoppedError,
  type ResearchTopic,
  type ResearchView,
  type Storage,
  type StoredResearch,
  searchPending,
  searchTopic,
} from "@ink-writer/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DailyRequestLimit, ResearchShell } from "../shell";

export interface Research {
  readonly view: ResearchView;
  /** True while a search is under way. */
  readonly searching: boolean;
  /** Why the last search stopped before the end, if it did. */
  readonly stopped: "limit" | "wait" | null;
  /** Null until read. */
  readonly limit: DailyRequestLimit | null;
  /** The real places a name may mean. Only the name is sent. */
  readonly findPlaces: (term: string) => Promise<PlaceCandidate[]>;
  readonly answerPlace: (name: string, answer: PlaceAnswer) => Promise<void>;
  readonly addTopic: (term: string) => Promise<void>;
  readonly removeTopic: (topicId: string) => Promise<void>;
  /** "Search now": the author asking, whatever the hints are set to. */
  readonly searchNow: (topic: ResearchTopic) => Promise<void>;
  readonly searchEraNow: () => Promise<void>;
  readonly setItemStatus: (
    itemId: string,
    status: "suggested" | "noted" | "dismissed",
  ) => Promise<void>;
  readonly setLimit: (dailyRequests: number) => Promise<void>;
}

/**
 * The documentation of the open novel (SPEC §3.7). While `active`, which is never while the author
 * writes, it looks up what's waiting, each topic once, if the hints allow the app to search by
 * itself. Everything else here happens because the author pressed something.
 */
export function useResearch(
  storage: Storage,
  project: Project,
  novel: NovelView,
  settings: HintSettings | null,
  shell: ResearchShell,
  active: boolean,
  onError: (error: unknown) => void,
  now: () => Date = () => new Date(),
): Research {
  const [stored, setStored] = useState<StoredResearch>(NO_RESEARCH);
  const [loaded, setLoaded] = useState(false);
  const [searching, setSearching] = useState(false);
  const [stopped, setStopped] = useState<"limit" | "wait" | null>(null);
  const [limit, setLimitView] = useState<DailyRequestLimit | null>(null);
  const nowRef = useRef(now);
  nowRef.current = now;

  const reload = useCallback(async () => {
    setStored(await loadResearch(storage, project.id));
    setLoaded(true);
  }, [storage, project.id]);

  useEffect(() => {
    reload().catch(onError);
  }, [reload, onError]);

  const refreshLimit = useCallback(async () => {
    setLimitView(await shell.searchLimit());
  }, [shell]);

  useEffect(() => {
    if (active) {
      refreshLimit().catch(onError);
    }
  }, [active, refreshLimit, onError]);

  const people = useMemo(() => peopleNames(novel), [novel]);
  const thisYear = now().getFullYear();
  const view = useMemo(
    () =>
      buildResearchView({
        view: novel,
        era: project.era,
        // Until the author's choice is read, nothing is searched: as if hints were off.
        settings: settings ?? {
          level: "off",
          types: {
            coherence: false,
            corrections: false,
            questions: false,
            suggestions: false,
            documentation: false,
          },
          noTasksOn: null,
        },
        research: stored,
        thisYear,
      }),
    [novel, project.era, settings, stored, thisYear],
  );

  const deps = useMemo(
    (): ResearchDeps => ({
      storage,
      transport: shell.transport,
      projectId: project.id,
      language: project.language,
      era: project.era,
      people,
      now: () => nowRef.current(),
    }),
    [storage, shell, project, people],
  );

  /** Runs a search and brings the screen up to date, whatever way it ends. */
  const run = useCallback(
    async (search: () => Promise<"limit" | "wait" | null>) => {
      setSearching(true);
      try {
        setStopped(await search());
      } catch (error) {
        if (error instanceof ResearchStoppedError) {
          setStopped(error.reason);
        } else {
          throw error;
        }
      } finally {
        setSearching(false);
        await reload();
        await refreshLimit().catch(() => {});
      }
    },
    [reload, refreshLimit],
  );

  // What's waiting, as one string: the same wait is only tried once, so that a search that can't
  // go through, as at the day's limit, isn't tried over and over.
  const waiting = useMemo(() => {
    if (!view.proactive) {
      return "";
    }
    const topics = [
      ...view.places.flatMap((place) => place.topic ?? []),
      ...view.topics.map((item) => item.topic),
    ]
      .filter((topic) => topic.status === "pending" && topic.term !== null)
      .map((topic) => topic.id);
    if (view.era !== null) {
      if (view.era.topic === null) {
        if (checkTerm(view.era.term, people) === null) topics.push(`era:${view.era.term}`);
      } else if (view.era.topic.status === "pending") {
        topics.push(view.era.topic.id);
      }
    }
    return topics.join("\u001f");
  }, [view, people]);

  const tried = useRef("");
  /** Goes up when something that stopped a search may no longer hold, so that it's tried again. */
  const [retries, setRetries] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `retries` is there to run it again
  useEffect(() => {
    if (!active || !loaded || searching || waiting === "" || tried.current === waiting) {
      return;
    }
    tried.current = waiting;
    run(async () => (await searchPending(deps, view)).stopped).catch(onError);
  }, [active, loaded, searching, waiting, run, deps, view, onError, retries]);

  return {
    view,
    searching,
    stopped,
    limit,
    findPlaces: useCallback((term: string) => findPlaces(deps, term), [deps]),
    answerPlace: useCallback(
      async (name: string, answer: PlaceAnswer) => {
        await answerPlace(storage, project.id, name, answer, people);
        tried.current = "";
        await reload();
      },
      [storage, project.id, people, reload],
    ),
    addTopic: useCallback(
      async (term: string) => {
        await addTopic(storage, project.id, term, people);
        tried.current = "";
        await reload();
      },
      [storage, project.id, people, reload],
    ),
    removeTopic: useCallback(
      async (topicId: string) => {
        await storage.removeResearchTopic(topicId);
        await reload();
      },
      [storage, reload],
    ),
    searchNow: useCallback(
      (topic: ResearchTopic) =>
        run(async () => {
          await searchTopic(deps, topic);
          return null;
        }),
      [run, deps],
    ),
    searchEraNow: useCallback(
      () =>
        run(async () => {
          const topic =
            view.era?.topic ?? (await addEraTopic(storage, project.id, project.era, people));
          await searchTopic(deps, topic);
          return null;
        }),
      [run, deps, view, storage, project, people],
    ),
    setItemStatus: useCallback(
      async (itemId: string, status: "suggested" | "noted" | "dismissed") => {
        await storage.setResearchItemStatus(itemId, status);
        await reload();
      },
      [storage, reload],
    ),
    setLimit: useCallback(
      async (dailyRequests: number) => {
        setLimitView(await shell.setSearchLimit(dailyRequests));
        // With more searches allowed, what stopped at the limit can go on.
        tried.current = "";
        setStopped(null);
        setRetries((count) => count + 1);
      },
      [shell],
    ),
  };
}
