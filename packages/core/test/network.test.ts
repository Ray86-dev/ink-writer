import { describe, expect, it } from "vitest";
import {
  buildNetwork,
  type ChapterCard,
  type EntityCard,
  type EntityRef,
  NETWORK_LIMITS,
  type NovelView,
} from "../src/index";

const ref = (id: string, type: EntityRef["type"] = "person"): EntityRef => ({ id, name: id, type });

function card(id: string, type: EntityRef["type"], extra: Partial<EntityCard> = {}): EntityCard {
  return {
    id,
    name: id,
    type,
    aliases: [],
    summary: null,
    note: null,
    facts: [],
    relations: [],
    issues: [],
    linkedFrom: [],
    scenes: [{ id: "s1", title: "S" }],
    within: [],
    contains: [],
    merged: [],
    splitOverrideId: null,
    ...extra,
  };
}

function chapter(id: string, extra: Partial<ChapterCard> = {}): ChapterCard {
  return {
    id,
    title: id,
    scenes: [],
    people: [],
    places: [],
    lore: [],
    when: [],
    changes: [],
    issues: [],
    ...extra,
  };
}

const novel = (parts: Partial<NovelView>): NovelView => ({
  cards: [],
  relations: [],
  chapters: [],
  names: [],
  issues: [],
  prompts: [],
  ...parts,
});

const issue = {
  kind: "contradiction" as const,
  reason: "r",
  a: { sceneId: "s1", sceneTitle: "S", chapterTitle: "C", quote: "q" },
  b: null,
  fix: null,
};

const scenes = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `s${index}`, title: "S" }));

describe("the novel as a network", () => {
  const small = novel({
    chapters: [
      chapter("c1", { people: [ref("marta")], places: [ref("puerto", "place")] }),
      chapter("c2", { people: [ref("marta"), ref("tomas")], lore: [ref("veda", "lore")] }),
    ],
    cards: [
      card("marta", "person", { issues: [issue], scenes: scenes(3) }),
      card("tomas", "person"),
      card("puerto", "place"),
      card("sal", "place", { within: [ref("puerto", "place")] }),
      card("veda", "lore"),
    ],
    relations: [{ id: "marta·tomas", a: ref("marta"), b: ref("tomas"), links: [] }],
  });

  it("has every chapter and card of a small novel, each of its kind", () => {
    const network = buildNetwork(small);

    expect(network.nodes.map((node) => `${node.kind}:${node.id}`).sort()).toEqual([
      "chapter:c1",
      "chapter:c2",
      "lore:veda",
      "person:marta",
      "person:tomas",
      "place:puerto",
      "place:sal",
    ]);
    expect(network.hidden).toEqual({ chapters: 0, cards: 0 });
  });

  it("ties chapters in a line, cards as the text relates them, and each card to its chapters", () => {
    const network = buildNetwork(small);
    const pairs = network.links.map((link) => [link.from, link.to].sort().join(" - "));

    expect(pairs).toContain("chapter:c1 - chapter:c2");
    expect(pairs).toContain("card:marta - card:tomas");
    expect(pairs).toContain("card:puerto - card:sal");
    expect(pairs).toContain("card:marta - chapter:c1");
    expect(pairs).toContain("card:marta - chapter:c2");
    expect(pairs).toContain("card:veda - chapter:c2");
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("marks what's still to be resolved", () => {
    const network = buildNetwork(small);

    expect(network.nodes.filter((node) => node.conflict).map((node) => node.id)).toEqual(["marta"]);
  });

  it("starts the ink at the first chapter and reaches the rest link by link", () => {
    const network = buildNetwork(small);
    const depth = (key: string) => network.nodes.find((node) => node.key === key)?.depth;

    expect(depth("chapter:c1")).toBe(0);
    expect(depth("chapter:c2")).toBe(1);
    expect(depth("card:puerto")).toBe(1);
    expect(depth("card:sal")).toBe(2);
    for (const link of network.links) {
      expect(depth(link.from)).toBeLessThanOrEqual(depth(link.to) as number);
    }
  });

  it("gives the same picture every time, with nothing on top of anything else", () => {
    const first = buildNetwork(small);
    const second = buildNetwork(small);

    expect(second).toEqual(first);
    for (const a of first.nodes) {
      for (const coordinate of a.position) {
        expect(Number.isFinite(coordinate)).toBe(true);
        expect(Math.abs(coordinate)).toBeLessThanOrEqual(1.1);
      }
      for (const b of first.nodes) {
        if (a.key < b.key) {
          const flat = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]);
          expect(flat).toBeGreaterThan(0.12);
        }
      }
    }
  });

  it("keeps a long novel within what can be painted, with what matters most", () => {
    const people = Array.from({ length: 40 }, (_, index) =>
      card(`p${index}`, "person", { scenes: scenes(index + 1) }),
    );
    const minor = card("menor", "lore", { issues: [issue] });
    const chapters = Array.from({ length: 30 }, (_, index) =>
      chapter(`c${index}`, { people: people.map((person) => ref(person.id)) }),
    );
    const network = buildNetwork(novel({ chapters, cards: [...people, minor] }));

    expect(network.nodes).toHaveLength(NETWORK_LIMITS.nodes);
    expect(network.links.length).toBeLessThanOrEqual(NETWORK_LIMITS.links);
    expect(network.hidden).toEqual({ chapters: 24, cards: 31 });
    const ids = network.nodes.map((node) => node.id);
    // The latest chapters, what's unresolved, and whoever appears most.
    expect(ids).toContain("c29");
    expect(ids).not.toContain("c0");
    expect(ids).toContain("menor");
    expect(ids).toContain("p39");
    expect(ids).not.toContain("p0");
    // Each end of a link is in the network.
    const keys = new Set(network.nodes.map((node) => node.key));
    for (const link of network.links) {
      expect(keys.has(link.from) && keys.has(link.to)).toBe(true);
    }
  });

  it("is empty for a novel with nothing in it, and cuts long names", () => {
    expect(buildNetwork(novel({})).nodes).toEqual([]);

    const [node] = buildNetwork(
      novel({ chapters: [chapter("c1", { title: "Capítulo 1 · Los ojos de su madre" })] }),
    ).nodes;
    expect(node?.name).toBe("Capítulo 1 · Los ojos de su madre");
    expect(node?.label).toBe("Capítulo 1 · Los oj…");
  });

  it("doesn't mix up a chapter and a card that share an id", () => {
    const network = buildNetwork(
      novel({ chapters: [chapter("x", { people: [ref("x")] })], cards: [card("x", "person")] }),
    );

    expect(network.nodes.map((node) => node.key)).toEqual(["chapter:x", "card:x"]);
    expect(network.links).toHaveLength(1);
  });
});
