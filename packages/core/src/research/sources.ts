/**
 * The public services the documentation comes from (SPEC §7), and how to read what they answer.
 * Whatever can't be linked to where it comes from is left out here: without a source, it isn't
 * shown (rule 3).
 */

export type ResearchRequest =
  | { readonly kind: "geocode"; readonly term: string; readonly language: string }
  | { readonly kind: "nearby"; readonly lat: number; readonly lon: number }
  | {
      readonly kind: "climate";
      readonly lat: number;
      readonly lon: number;
      readonly firstYear: number;
      readonly lastYear: number;
    }
  | { readonly kind: "wiki"; readonly term: string; readonly language: string };

export interface ResearchAnswer {
  readonly status: number;
  readonly body: string;
}

/**
 * How a search reaches the network. Whoever implements this builds the address from the request, so
 * that nothing but a term or a point can leave. It rejects with a message that starts with `limit:`
 * once the day's searches are used up, with `wait:` while a service asked for a pause, and with
 * `term:` for a term it won't send.
 */
export interface ResearchTransport {
  fetch(request: ResearchRequest): Promise<ResearchAnswer>;
}

export const ITEM_CATEGORIES = ["article", "climate", "streets", "premises"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export interface FoundItem {
  readonly category: ItemCategory;
  readonly text: string;
  readonly sourceUrl: string;
  readonly sourceTitle: string;
}

/** A real place, as the map knows it. */
export interface PlaceCandidate {
  readonly label: string;
  readonly lat: number;
  readonly lon: number;
  /** Its page on the map. */
  readonly url: string;
}

/** True for a link someone can follow. Anything else doesn't count as a source. */
export function isSourceUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "";
  } catch {
    return false;
  }
}

function parse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("The service's answer can't be read");
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const OSM = "https://www.openstreetmap.org";
const OSM_TITLE = "OpenStreetMap";

export function parseGeocode(body: string): PlaceCandidate[] {
  const rows = parse(body);
  if (!Array.isArray(rows)) {
    throw new Error("The service's answer can't be read");
  }
  const places: PlaceCandidate[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    const label = text(row.display_name);
    const type = text(row.osm_type);
    const id = row.osm_id;
    if (
      label === "" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      !["node", "way", "relation"].includes(type) ||
      typeof id !== "number"
    ) {
      continue;
    }
    // The same spot often comes several times, as a station and its entrances.
    if (!places.some((place) => place.label === label)) {
      places.push({ label, lat, lon, url: `${OSM}/${type}/${id}` });
    }
  }
  return places;
}

/** What each kind of premises is called, by language. English for a language that isn't here. */
const PREMISES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  es: {
    cafe: "cafetería",
    bar: "bar",
    pub: "bar",
    restaurant: "restaurante",
    pharmacy: "farmacia",
    library: "biblioteca",
    marketplace: "mercado",
    theatre: "teatro",
    cinema: "cine",
    place_of_worship: "lugar de culto",
    bakery: "panadería",
    books: "librería",
  },
  en: {
    cafe: "café",
    bar: "bar",
    pub: "pub",
    restaurant: "restaurant",
    pharmacy: "pharmacy",
    library: "library",
    marketplace: "market",
    theatre: "theatre",
    cinema: "cinema",
    place_of_worship: "place of worship",
    bakery: "bakery",
    books: "bookshop",
  },
};

const MAX_STREETS = 25;
const MAX_PREMISES = 12;

/** Streets as one item, linked to the map at that point. Each of the premises, linked to its own page. */
export function parseNearby(
  body: string,
  point: { readonly lat: number; readonly lon: number },
  language: string,
): FoundItem[] {
  const answer = parse(body);
  const elements = isRecord(answer) && Array.isArray(answer.elements) ? answer.elements : null;
  if (elements === null) {
    throw new Error("The service's answer can't be read");
  }
  const kinds = PREMISES[language] ?? PREMISES.en ?? {};
  const streets: string[] = [];
  const premises: FoundItem[] = [];
  const seen = new Set<string>();
  for (const element of elements) {
    if (!isRecord(element) || !isRecord(element.tags)) continue;
    const name = text(element.tags.name);
    if (name === "") continue;
    if (typeof element.tags.highway === "string") {
      if (!streets.includes(name) && streets.length < MAX_STREETS) {
        streets.push(name);
      }
      continue;
    }
    const kind = kinds[text(element.tags.amenity)] ?? kinds[text(element.tags.shop)];
    const type = text(element.type);
    if (
      kind === undefined ||
      !["node", "way", "relation"].includes(type) ||
      typeof element.id !== "number" ||
      seen.has(name) ||
      premises.length >= MAX_PREMISES
    ) {
      continue;
    }
    seen.add(name);
    premises.push({
      category: "premises",
      text: `${name} (${kind})`,
      sourceUrl: `${OSM}/${type}/${element.id}`,
      sourceTitle: OSM_TITLE,
    });
  }
  const items: FoundItem[] = [];
  if (streets.length > 0) {
    items.push({
      category: "streets",
      text: streets.join(", "),
      sourceUrl: `${OSM}/#map=17/${point.lat.toFixed(4)}/${point.lon.toFixed(4)}`,
      sourceTitle: OSM_TITLE,
    });
  }
  return [...items, ...premises];
}

const CLIMATE_WORDS: Readonly<
  Record<string, { readonly average: (years: string) => string; readonly to: string }>
> = {
  es: { average: (years) => `Media de ${years}`, to: "a" },
  en: { average: (years) => `Average for ${years}`, to: "to" },
};

function monthName(language: string, month: number): string {
  try {
    return new Intl.DateTimeFormat(language, { month: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2001, month, 1)),
    );
  } catch {
    return String(month + 1);
  }
}

/**
 * The average of each month over the years asked for: highs, lows and rain. One item, which says
 * which years it's the average of, because it describes those years and no others.
 */
export function parseClimate(body: string, language: string): FoundItem[] {
  const answer = parse(body);
  const daily = isRecord(answer) && isRecord(answer.daily) ? answer.daily : null;
  const days = daily !== null && Array.isArray(daily.time) ? daily.time : null;
  if (daily === null || days === null) {
    throw new Error("The service's answer can't be read");
  }
  const column = (name: string): readonly unknown[] => {
    const values = daily[name];
    return Array.isArray(values) ? values : [];
  };
  const highs = column("temperature_2m_max");
  const lows = column("temperature_2m_min");
  const rain = column("precipitation_sum");

  const months = Array.from({ length: 12 }, () => ({
    high: 0,
    highDays: 0,
    low: 0,
    lowDays: 0,
    rain: 0,
  }));
  const years = new Set<string>();
  days.forEach((day, index) => {
    const match = typeof day === "string" ? /^(\d{4})-(\d{2})-\d{2}$/.exec(day) : null;
    const month = match === null ? undefined : months[Number(match[2]) - 1];
    if (match === null || month === undefined) return;
    const high = highs[index];
    const low = lows[index];
    const fell = rain[index];
    if (typeof high === "number") {
      month.high += high;
      month.highDays += 1;
      years.add(match[1] as string);
    }
    if (typeof low === "number") {
      month.low += low;
      month.lowDays += 1;
    }
    if (typeof fell === "number") {
      month.rain += fell;
    }
  });
  if (years.size === 0 || months.some((month) => month.highDays === 0 || month.lowDays === 0)) {
    return [];
  }
  const sorted = [...years].sort();
  const span = sorted.length === 1 ? `${sorted[0]}` : `${sorted[0]}–${sorted.at(-1)}`;
  const say = CLIMATE_WORDS[language] ?? (CLIMATE_WORDS.en as (typeof CLIMATE_WORDS)[string]);
  const lines = months.map((month, index) => {
    const low = Math.round(month.low / month.lowDays);
    const high = Math.round(month.high / month.highDays);
    const millimetres = Math.round(month.rain / sorted.length);
    return `${monthName(language, index)}: ${low} ${say.to} ${high} °C, ${millimetres} mm`;
  });
  return [
    {
      category: "climate",
      text: `${say.average(span)}. ${lines.join(" · ")}`,
      sourceUrl: "https://open-meteo.com/",
      sourceTitle: `Open-Meteo, ${span}`,
    },
  ];
}

/** The start of each article found, best match first. A page that only lists meanings is left out. */
export function parseWiki(body: string): FoundItem[] {
  const answer = parse(body);
  if (!isRecord(answer)) {
    throw new Error("The service's answer can't be read");
  }
  // No match at all comes without a `query`.
  const pages =
    isRecord(answer.query) && Array.isArray(answer.query.pages) ? answer.query.pages : [];
  return pages
    .filter(isRecord)
    .filter((page) => !(isRecord(page.pageprops) && "disambiguation" in page.pageprops))
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
    .flatMap((page): FoundItem[] => {
      const title = text(page.title);
      const extract = text(page.extract);
      const url = page.canonicalurl ?? page.fullurl;
      if (title === "" || extract === "" || !isSourceUrl(url)) {
        return [];
      }
      return [
        { category: "article", text: extract, sourceUrl: url, sourceTitle: `Wikipedia: ${title}` },
      ];
    });
}
