import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AnalysisState,
  addTopic,
  answerPlace,
  buildNovelView,
  buildResearchView,
  checkTerm,
  DEFAULT_HINT_SETTINGS,
  findPlaces,
  type HintSettings,
  isPresentEra,
  isSourceUrl,
  loadResearch,
  openSqlStorage,
  type PlaceCandidate,
  parseClimate,
  parseGeocode,
  parseNearby,
  parseWiki,
  peopleNames,
  type ResearchAnswer,
  type ResearchDeps,
  type ResearchRequest,
  ResearchStoppedError,
  type ResearchTransport,
  type SceneText,
  type Storage,
  searchPending,
  searchTopic,
  TermRefusedError,
} from "../src/index";
import { createNodeSqliteDriver } from "./support/node-sqlite-driver";

const TEXT_1 =
  "Marta Rey cruzó Lavapiés bajo la lluvia. La doctora no miró atrás al dejar Valdeolmos.";
const TEXT_2 = "Tomás la esperaba en Lavapiés, con el reloj de su padre en el bolsillo.";

const scenes: SceneText[] = [
  { id: "s1", title: "Escena 1", chapterId: "c1", chapterTitle: "Capítulo 1", text: TEXT_1 },
  { id: "s2", title: "Escena 2", chapterId: "c1", chapterTitle: "Capítulo 1", text: TEXT_2 },
];

const analysis = (): AnalysisState => ({
  entities: [
    { id: "marta", type: "person", canonicalName: "Marta Rey", aliases: ["la doctora"] },
    { id: "tomas", type: "person", canonicalName: "Tomás", aliases: [] },
    { id: "lavapies", type: "place", canonicalName: "Lavapiés", aliases: [] },
    { id: "valdeolmos", type: "place", canonicalName: "Valdeolmos", aliases: [] },
  ],
  mentions: [
    { sceneId: "s1", entityId: "marta", quote: "Marta Rey" },
    { sceneId: "s2", entityId: "tomas", quote: "Tomás" },
    { sceneId: "s1", entityId: "lavapies", quote: "Lavapiés" },
    { sceneId: "s2", entityId: "lavapies", quote: "Lavapiés" },
    { sceneId: "s1", entityId: "valdeolmos", quote: "Valdeolmos" },
  ],
  facts: [],
  relations: [],
  issues: [],
  sceneOrder: ["s1", "s2"],
});

const novel = (state = analysis()) => buildNovelView({ analysis: state, overrides: [], scenes });

const LAVAPIES: PlaceCandidate = {
  label: "Lavapiés, Embajadores, Centro, Madrid, España",
  lat: 40.4084539,
  lon: -3.7006613,
  url: "https://www.openstreetmap.org/node/5303173543",
};

// As the services answer, cut down to a few entries.
const GEOCODE_BODY = JSON.stringify([
  {
    osm_type: "node",
    osm_id: 5303173543,
    lat: "40.4084539",
    lon: "-3.7006613",
    display_name: LAVAPIES.label,
  },
  {
    osm_type: "node",
    osm_id: 5303173603,
    lat: "40.4085142",
    lon: "-3.7009495",
    display_name: LAVAPIES.label,
  },
  { osm_type: "way", osm_id: 77, lat: "x", lon: "0", display_name: "Sin coordenadas" },
]);

const WIKI_BODY = JSON.stringify({
  batchcomplete: true,
  query: {
    pages: [
      {
        pageid: 2,
        title: "Lavapiés (desambiguación)",
        index: 1,
        extract: "Lavapiés puede referirse a:",
        pageprops: { disambiguation: "" },
        canonicalurl: "https://es.wikipedia.org/wiki/Lavapi%C3%A9s_(desambiguaci%C3%B3n)",
      },
      {
        pageid: 3,
        title: "Estación de Lavapiés",
        index: 3,
        extract: "Lavapiés es una estación del Metro de Madrid.",
        canonicalurl: "https://es.wikipedia.org/wiki/Estaci%C3%B3n_de_Lavapi%C3%A9s",
      },
      {
        pageid: 1,
        title: "Lavapiés",
        index: 2,
        extract: "Lavapiés es un barrio de Madrid.",
        fullurl: "https://es.wikipedia.org/wiki/Lavapi%C3%A9s",
      },
      { pageid: 4, title: "Sin enlace", index: 4, extract: "Un texto sin fuente." },
      { pageid: 5, title: "Sin texto", index: 5, canonicalurl: "https://es.wikipedia.org/wiki/X" },
    ],
  },
});

const NEARBY_BODY = JSON.stringify({
  elements: [
    { type: "way", id: 1, tags: { highway: "living_street", name: "Calle del Amparo" } },
    { type: "way", id: 2, tags: { highway: "residential", name: "Calle del Ave María" } },
    { type: "way", id: 3, tags: { highway: "residential", name: "Calle del Amparo" } },
    {
      type: "node",
      id: 26472719,
      lat: 40.4,
      lon: -3.7,
      tags: { amenity: "pub", name: "Café Melo's" },
    },
    {
      type: "way",
      id: 9,
      center: { lat: 40.4, lon: -3.7 },
      tags: { shop: "books", name: "La Fugitiva" },
    },
    { type: "node", id: 10, tags: { amenity: "cafe" } },
    { type: "node", id: 11, tags: { amenity: "bank", name: "Un banco" } },
  ],
});

/** Two years of days: every January day 2 to 10 °C with 1 mm, every other day 15 to 25 °C and dry. */
const climateBody = (): string => {
  const time: string[] = [];
  const max: (number | null)[] = [];
  const min: (number | null)[] = [];
  const rain: (number | null)[] = [];
  for (const year of [2024, 2025]) {
    for (let day = new Date(Date.UTC(year, 0, 1)); day.getUTCFullYear() === year; ) {
      const january = day.getUTCMonth() === 0;
      time.push(day.toISOString().slice(0, 10));
      max.push(january ? 10 : 25);
      min.push(january ? 2 : 15);
      rain.push(january ? 1 : 0);
      day = new Date(day.getTime() + 86_400_000);
    }
  }
  return JSON.stringify({
    daily: { time, temperature_2m_max: max, temperature_2m_min: min, precipitation_sum: rain },
  });
};

type Reply = ResearchAnswer | Error;

/** Stands in for the shell: records every search asked for and answers from a table. */
function fakeTransport(replies: Partial<Record<ResearchRequest["kind"], Reply>> = {}) {
  const sent: ResearchRequest[] = [];
  const table: Record<ResearchRequest["kind"], Reply> = {
    geocode: { status: 200, body: GEOCODE_BODY },
    wiki: { status: 200, body: WIKI_BODY },
    climate: { status: 200, body: climateBody() },
    nearby: { status: 200, body: NEARBY_BODY },
    ...replies,
  };
  const transport: ResearchTransport = {
    fetch: async (request) => {
      sent.push(request);
      const reply = table[request.kind];
      if (reply instanceof Error) {
        throw reply;
      }
      return reply;
    },
  };
  return { transport, sent, table };
}

const settings = (changes: Partial<HintSettings> = {}): HintSettings => ({
  ...DEFAULT_HINT_SETTINGS,
  ...changes,
});

describe("a search term", () => {
  const people = ["Marta Rey", "la doctora", "Tomás"];

  it("is a topic: a place, a trade, an object", () => {
    for (const term of ["Lavapiés, Madrid", "relojero", "tranvías de Madrid en 1950"]) {
      expect(checkTerm(term, people)).toBeNull();
    }
  });

  it("is never the name of a character, however it's written", () => {
    for (const term of ["Marta Rey", "marta rey", "la casa de MARTA REY", "Tomas", "la doctora"]) {
      expect(checkTerm(term, people)).toMatchObject({ kind: "character" });
    }
    // Whole words only: a name inside another word isn't that name.
    expect(checkTerm("tomasita", people)).toBeNull();
    expect(checkTerm("Rey Juan Carlos", people)).toBeNull();
  });

  it("refuses a real place that shares its name with a character", () => {
    expect(checkTerm("Santiago de Compostela", ["Santiago"])).toEqual({
      kind: "character",
      name: "Santiago",
    });
  });

  it("is never a passage of the text", () => {
    expect(checkTerm(TEXT_1, [])).toEqual({ kind: "too_long" });
    expect(checkTerm("una dos tres cuatro cinco seis siete ocho nueve", [])).toEqual({
      kind: "too_long",
    });
    expect(checkTerm("dos\nlíneas", [])).toEqual({ kind: "too_long" });
    expect(checkTerm("  ", [])).toEqual({ kind: "empty" });
    expect(checkTerm("¿?", [])).toEqual({ kind: "empty" });
  });
});

describe("what the services answer", () => {
  it("only a link that can be followed counts as a source", () => {
    expect(isSourceUrl("https://es.wikipedia.org/wiki/Lavapi%C3%A9s")).toBe(true);
    for (const value of ["", "wikipedia", "javascript:alert(1)", "file:///etc/passwd", null, 3]) {
      expect(isSourceUrl(value)).toBe(false);
    }
  });

  it("the places a name may mean, each once, with its page on the map", () => {
    expect(parseGeocode(GEOCODE_BODY)).toEqual([LAVAPIES]);
    expect(parseGeocode("[]")).toEqual([]);
    expect(() => parseGeocode("<html>")).toThrow();
  });

  it("articles in order of match, without lists of meanings and without anything unsourced", () => {
    expect(parseWiki(WIKI_BODY)).toEqual([
      {
        category: "article",
        text: "Lavapiés es un barrio de Madrid.",
        sourceUrl: "https://es.wikipedia.org/wiki/Lavapi%C3%A9s",
        sourceTitle: "Wikipedia: Lavapiés",
      },
      {
        category: "article",
        text: "Lavapiés es una estación del Metro de Madrid.",
        sourceUrl: "https://es.wikipedia.org/wiki/Estaci%C3%B3n_de_Lavapi%C3%A9s",
        sourceTitle: "Wikipedia: Estación de Lavapiés",
      },
    ]);
    // Nothing found comes without a `query`.
    expect(parseWiki('{"batchcomplete":true}')).toEqual([]);
  });

  it("the streets as one item and each of the premises with its own link", () => {
    expect(parseNearby(NEARBY_BODY, LAVAPIES, "es")).toEqual([
      {
        category: "streets",
        text: "Calle del Amparo, Calle del Ave María",
        sourceUrl: "https://www.openstreetmap.org/#map=17/40.4085/-3.7007",
        sourceTitle: "OpenStreetMap",
      },
      {
        category: "premises",
        text: "Café Melo's (bar)",
        sourceUrl: "https://www.openstreetmap.org/node/26472719",
        sourceTitle: "OpenStreetMap",
      },
      {
        category: "premises",
        text: "La Fugitiva (librería)",
        sourceUrl: "https://www.openstreetmap.org/way/9",
        sourceTitle: "OpenStreetMap",
      },
    ]);
    expect(parseNearby(NEARBY_BODY, LAVAPIES, "en")[2]?.text).toBe("La Fugitiva (bookshop)");
    expect(parseNearby('{"elements":[]}', LAVAPIES, "es")).toEqual([]);
  });

  it("the climate as monthly averages that say which years they're of", () => {
    const [item, ...rest] = parseClimate(climateBody(), "es");

    expect(rest).toEqual([]);
    expect(item?.sourceTitle).toBe("Open-Meteo, 2024–2025");
    expect(item?.sourceUrl).toBe("https://open-meteo.com/");
    expect(
      item?.text.startsWith(
        "Media de 2024–2025. enero: 2 a 10 °C, 31 mm · febrero: 15 a 25 °C, 0 mm",
      ),
    ).toBe(true);
    expect(parseClimate(climateBody(), "en")[0]?.text).toContain("January: 2 to 10 °C, 31 mm");
    // Without a whole year of days there's no average to give.
    expect(
      parseClimate(
        JSON.stringify({
          daily: { time: ["2025-01-01"], temperature_2m_max: [1], temperature_2m_min: [0] },
        }),
        "es",
      ),
    ).toEqual([]);
  });
});

describe("the era", () => {
  it("is the present only when it clearly says so", () => {
    for (const era of [
      "Actualidad",
      "presente",
      "Madrid, hoy",
      "2026",
      "present day",
      "Siglo XXI",
    ]) {
      expect(isPresentEra(era, 2026)).toBe(true);
    }
    for (const era of ["", "1950", "Posguerra", "Madrid, 1936-1939", "siglo XIX", "2026 y 1950"]) {
      expect(isPresentEra(era, 2026)).toBe(false);
    }
  });
});

describe("documentation", () => {
  let driver: ReturnType<typeof createNodeSqliteDriver>;
  let storage: Storage;
  let projectId: string;

  beforeEach(async () => {
    driver = createNodeSqliteDriver();
    ({ storage } = await openSqlStorage(driver));
    projectId = (await storage.createProject({ title: "T", language: "es", era: "Actualidad" })).id;
  });

  afterEach(() => driver.close());

  const deps = (
    transport: ResearchTransport,
    changes: Partial<ResearchDeps> = {},
  ): ResearchDeps => ({
    storage,
    transport,
    projectId,
    language: "es",
    era: "Actualidad",
    people: peopleNames(novel()),
    now: () => new Date(2026, 10, 15),
    ...changes,
  });

  const viewNow = async (era = "Actualidad", hints = settings(), state = analysis()) =>
    buildResearchView({
      view: novel(state),
      era,
      settings: hints,
      research: await loadResearch(storage, projectId),
      thisYear: 2026,
    });

  it("asks about each place before anything is searched", async () => {
    const { transport, sent } = fakeTransport();
    const view = await viewNow();

    expect(view.places.map((place) => [place.card.name, place.topic])).toEqual([
      ["Lavapiés", null],
      ["Valdeolmos", null],
    ]);
    expect(await searchPending(deps(transport), view)).toEqual({ searched: 0, stopped: null });
    expect(sent).toEqual([]);
  });

  it("never searches for a place the author made up", async () => {
    const { transport, sent } = fakeTransport();
    const people = peopleNames(novel());
    await answerPlace(storage, projectId, "Valdeolmos", { reality: "invented" }, people);

    const view = await viewNow();
    const outcome = await searchPending(deps(transport), view);

    expect(view.places[1]?.topic).toMatchObject({
      reality: "invented",
      term: null,
      status: "done",
    });
    expect(outcome.searched).toBe(0);
    expect(sent).toEqual([]);
  });

  it("looks a real place up once, in each source, and keeps it all with its source", async () => {
    const { transport, sent } = fakeTransport();
    const people = peopleNames(novel());

    expect(await findPlaces(deps(transport), "Lavapiés, Madrid")).toEqual([LAVAPIES]);
    await answerPlace(
      storage,
      projectId,
      "Lavapiés",
      { reality: "real", term: "Lavapiés, Madrid", place: LAVAPIES },
      people,
    );
    expect(await searchPending(deps(transport), await viewNow())).toEqual({
      searched: 1,
      stopped: null,
    });

    expect(sent).toEqual([
      { kind: "geocode", term: "Lavapiés, Madrid", language: "es" },
      { kind: "wiki", term: "Lavapiés, Madrid", language: "es" },
      { kind: "climate", lat: LAVAPIES.lat, lon: LAVAPIES.lon, firstYear: 2021, lastYear: 2025 },
      { kind: "nearby", lat: LAVAPIES.lat, lon: LAVAPIES.lon },
    ]);
    const place = (await viewNow()).places[0];
    expect(place?.topic).toMatchObject({ status: "done", reality: "real" });
    expect(place?.items.map((item) => item.category)).toEqual([
      "article",
      "article",
      "climate",
      "streets",
      "premises",
      "premises",
    ]);
    expect(place?.items.every((item) => isSourceUrl(item.sourceUrl))).toBe(true);

    // Once per topic: what's stored is what's read from then on, also with no network.
    sent.length = 0;
    const offline = fakeTransport({ wiki: new Error("can't reach the service") });
    expect(await searchPending(deps(offline.transport), await viewNow())).toEqual({
      searched: 0,
      stopped: null,
    });
    expect(offline.sent).toEqual([]);
    expect((await viewNow()).places[0]?.items).toHaveLength(6);
  });

  it("sends neither the text nor the name of any character", async () => {
    const { transport, sent } = fakeTransport();
    const people = peopleNames(novel());
    await findPlaces(deps(transport), "Lavapiés, Madrid");
    await answerPlace(
      storage,
      projectId,
      "Lavapiés",
      { reality: "based", term: "Lavapiés, Madrid", place: LAVAPIES },
      people,
    );
    await addTopic(storage, projectId, "relojero", people);
    await searchPending(deps(transport, { era: "1950" }), await viewNow("1950"));

    expect(sent.length).toBeGreaterThan(3);
    const everything = JSON.stringify(sent).toLowerCase();
    for (const name of ["marta", "rey", "doctora", "tomás", "tomas"]) {
      expect(everything).not.toContain(name);
    }
    // Nothing of the text beyond the terms themselves: no sentence, no words around them.
    for (const fragment of ["cruzó", "lluvia", "esperaba", "bolsillo", "valdeolmos"]) {
      expect(everything).not.toContain(fragment);
    }
    const terms = sent.flatMap((request) => ("term" in request ? [request.term] : []));
    expect(new Set(terms)).toEqual(new Set(["Lavapiés, Madrid", "relojero", "1950"]));
  });

  it("refuses a term with a character's name before anything is sent or stored", async () => {
    const { transport, sent } = fakeTransport();
    const people = peopleNames(novel());

    await expect(findPlaces(deps(transport), "Casa de Marta Rey")).rejects.toBeInstanceOf(
      TermRefusedError,
    );
    await expect(addTopic(storage, projectId, "la doctora", people)).rejects.toBeInstanceOf(
      TermRefusedError,
    );
    await expect(
      answerPlace(
        storage,
        projectId,
        "Lavapiés",
        { reality: "real", term: "Tomás", place: null },
        people,
      ),
    ).rejects.toBeInstanceOf(TermRefusedError);

    expect(sent).toEqual([]);
    expect((await loadResearch(storage, projectId)).topics).toEqual([]);
  });

  it("doesn't search for a stored topic once a character is given that name", async () => {
    const { transport, sent } = fakeTransport();
    const topic = await addTopic(storage, projectId, "Aurora", []);

    await expect(
      searchTopic(deps(transport, { people: ["Aurora"] }), topic),
    ).rejects.toBeInstanceOf(TermRefusedError);
    const view = await viewNow();
    expect(await searchPending(deps(transport, { people: ["Aurora"] }), view)).toEqual({
      searched: 0,
      stopped: null,
    });

    expect(sent).toEqual([]);
    expect(view.topics[0]?.topic.status).toBe("failed");
  });

  it("leaves today's streets and premises out of a story set in the past, and looks the era up", async () => {
    const { transport, sent } = fakeTransport();
    await answerPlace(
      storage,
      projectId,
      "Lavapiés",
      { reality: "real", term: "Lavapiés, Madrid", place: LAVAPIES },
      [],
    );

    const before = await viewNow("Posguerra española");
    expect(before.presentEra).toBe(false);
    expect(before.era).toEqual({ term: "Posguerra española", topic: null, items: [] });
    await searchPending(deps(transport, { era: "Posguerra española" }), before);

    expect(sent.map((request) => request.kind)).toEqual(["wiki", "climate", "wiki"]);
    expect(sent.at(-1)).toEqual({ kind: "wiki", term: "Posguerra española", language: "es" });
    const after = await viewNow("Posguerra española");
    expect(after.era?.topic?.status).toBe("done");
    expect(after.places[0]?.items.some((item) => item.category === "streets")).toBe(false);
    // The present needs no looking up as an era.
    expect((await viewNow("Actualidad")).era).toBeNull();
  });

  it("with hints off, or documentation off, only searches when the author asks", async () => {
    const { transport, sent } = fakeTransport();
    const topic = await addTopic(storage, projectId, "relojero", []);

    for (const quiet of [
      settings({ level: "off" }),
      settings({ types: { ...DEFAULT_HINT_SETTINGS.types, documentation: false } }),
    ]) {
      const view = await viewNow("1950", quiet);
      expect(view.proactive).toBe(false);
      expect(await searchPending(deps(transport, { era: "1950" }), view)).toEqual({
        searched: 0,
        stopped: null,
      });
    }
    expect(sent).toEqual([]);
    // Not even the era was stored as something to look up.
    expect((await loadResearch(storage, projectId)).topics).toHaveLength(1);

    // "Search now" is the author asking.
    expect(await searchTopic(deps(transport), topic)).toBe("done");
    expect(sent).toEqual([{ kind: "wiki", term: "relojero", language: "es" }]);
  });

  it("stops at the day's limit and leaves the rest for another day", async () => {
    const limit = fakeTransport({
      wiki: new Error("limit: the 60 searches allowed today are used up"),
    });
    await addTopic(storage, projectId, "relojero", []);
    await addTopic(storage, projectId, "tranvía", []);

    expect(await searchPending(deps(limit.transport), await viewNow())).toEqual({
      searched: 0,
      stopped: "limit",
    });
    expect(limit.sent).toHaveLength(1);
    expect((await viewNow()).topics.map((item) => item.topic.status)).toEqual([
      "pending",
      "pending",
    ]);

    const pause = fakeTransport({ wiki: new Error("wait: the service asked for a pause of 30 s") });
    const topic = (await viewNow()).topics[0]?.topic;
    await expect(searchTopic(deps(pause.transport), topic as never)).rejects.toMatchObject({
      name: "ResearchStoppedError",
      reason: "wait",
    });
    expect(ResearchStoppedError).toBeDefined();

    // The next day it goes on where it stopped.
    const next = fakeTransport();
    expect(await searchPending(deps(next.transport), await viewNow())).toEqual({
      searched: 2,
      stopped: null,
    });
  });

  it("keeps what one source found when another fails, and says the search failed", async () => {
    const { transport } = fakeTransport({
      climate: { status: 500, body: "" },
      nearby: new Error("can't reach the service"),
    });
    await answerPlace(
      storage,
      projectId,
      "Lavapiés",
      { reality: "real", term: "Lavapiés", place: LAVAPIES },
      [],
    );

    await searchPending(deps(transport), await viewNow());

    const place = (await viewNow()).places[0];
    expect(place?.topic?.status).toBe("failed");
    expect(place?.items.map((item) => item.category)).toEqual(["article", "article"]);

    // Asked again by the author, it tries every source again.
    const again = fakeTransport();
    expect(await searchTopic(deps(again.transport), place?.topic as never)).toBe("done");
    expect((await viewNow()).places[0]?.items).toHaveLength(6);
  });

  it("shows nothing without a source, and the store takes nothing without one", async () => {
    const topic = await addTopic(storage, projectId, "relojero", []);

    await expect(
      storage.saveResearchResult(topic.id, "done", [
        { category: "article", text: "Un dato suelto.", sourceUrl: "", sourceTitle: "Wikipedia" },
      ]),
    ).rejects.toThrow();
    await expect(
      storage.saveResearchResult(topic.id, "done", [
        { category: "article", text: "Otro.", sourceUrl: "https://example.org/a", sourceTitle: "" },
      ]),
    ).rejects.toThrow();
    // A link that the store lets through and nobody could follow isn't shown either.
    await storage.saveResearchResult(topic.id, "done", [
      {
        category: "article",
        text: "Con fuente.",
        sourceUrl: "https://example.org/a",
        sourceTitle: "A",
      },
      { category: "article", text: "Sin fuente real.", sourceUrl: "https://", sourceTitle: "B" },
    ]);

    expect((await viewNow()).topics[0]?.items.map((item) => item.text)).toEqual(["Con fuente."]);
  });

  it("is no part of the notes until the author takes it, and what they decided stays", async () => {
    const { transport } = fakeTransport();
    const topic = await addTopic(storage, projectId, "Lavapiés", []);
    await searchTopic(deps(transport), topic);
    const [first, second] = (await viewNow()).topics[0]?.items ?? [];
    expect([first?.status, second?.status]).toEqual(["suggested", "suggested"]);

    await storage.setResearchItemStatus(second?.id as string, "noted");
    await storage.setResearchItemStatus(first?.id as string, "dismissed");

    // What's in the notes comes first, and what was discarded is gone.
    expect((await viewNow()).topics[0]?.items.map((item) => [item.text, item.status])).toEqual([
      ["Lavapiés es una estación del Metro de Madrid.", "noted"],
    ]);

    // Searching again offers neither of them a second time.
    await searchTopic(deps(transport), topic);
    expect((await viewNow()).topics[0]?.items).toHaveLength(1);
    expect((await loadResearch(storage, projectId)).items).toHaveLength(2);
  });

  it("a new answer about a place takes the old one's place, and keeps the author's notes", async () => {
    const { transport, sent } = fakeTransport();
    await answerPlace(
      storage,
      projectId,
      "Lavapiés",
      { reality: "real", term: "Lavapiés", place: null },
      [],
    );
    await searchPending(deps(transport), await viewNow());
    // Without a point on the map there's only the encyclopedia.
    expect(sent.map((request) => request.kind)).toEqual(["wiki"]);
    const [kept] = (await viewNow()).places[0]?.items ?? [];
    await storage.setResearchItemStatus(kept?.id as string, "noted");

    await answerPlace(storage, projectId, "Lavapiés", { reality: "invented" }, []);

    const place = (await viewNow()).places[0];
    expect(place?.topic).toMatchObject({ reality: "invented", term: null });
    expect(place?.items.map((item) => item.status)).toEqual(["noted"]);
    expect((await loadResearch(storage, projectId)).topics).toHaveLength(1);
  });

  it("knows a place by its name in the novel, whatever id an analysis gives it", async () => {
    await answerPlace(storage, projectId, "lavapiés", { reality: "invented" }, []);
    const state = analysis();
    const renumbered: AnalysisState = {
      ...state,
      entities: state.entities.map((entity) =>
        entity.id === "lavapies" ? { ...entity, id: "e99", aliases: ["el barrio"] } : entity,
      ),
      mentions: state.mentions.map((mention) =>
        mention.entityId === "lavapies" ? { ...mention, entityId: "e99" } : mention,
      ),
    };

    const view = await viewNow("Actualidad", settings(), renumbered);

    expect(view.places[0]).toMatchObject({ card: { id: "e99" }, topic: { reality: "invented" } });
  });

  it("an author's topic can be removed, with everything found for it", async () => {
    const { transport } = fakeTransport();
    const topic = await addTopic(storage, projectId, "relojero", []);
    await searchTopic(deps(transport), topic);

    await storage.removeResearchTopic(topic.id);

    expect(await loadResearch(storage, projectId)).toEqual({ topics: [], items: [] });
  });
});
