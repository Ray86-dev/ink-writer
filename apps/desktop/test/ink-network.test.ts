// @vitest-environment jsdom
import type { Network } from "@ink-writer/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInkNetwork,
  type InkFrame,
  type InkNetwork,
  type InkPainter,
} from "../src/dashboard/ink-network";

const NETWORK: Network = {
  nodes: [
    {
      key: "chapter:c1",
      kind: "chapter",
      id: "c1",
      name: "Capítulo 1",
      label: "Capítulo 1",
      conflict: false,
      position: [-1, -0.35, 0.15],
      radius: 0.03,
      depth: 0,
    },
    {
      key: "card:marta",
      kind: "person",
      id: "marta",
      name: "Marta",
      label: "Marta",
      conflict: true,
      position: [-0.4, 0.6, 0.3],
      radius: 0.04,
      depth: 1,
    },
    {
      key: "card:tomas",
      kind: "person",
      id: "tomas",
      name: "Tomás",
      label: "Tomás",
      conflict: false,
      position: [0.4, 0.7, -0.3],
      radius: 0.03,
      depth: 2,
    },
    {
      key: "card:faro",
      kind: "place",
      id: "faro",
      name: "Faro",
      label: "Faro",
      conflict: false,
      position: [0.8, -0.5, 0.4],
      radius: 0.03,
      depth: 3,
    },
  ],
  links: [
    { from: "chapter:c1", to: "card:marta", strength: 1, depth: 0 },
    { from: "card:marta", to: "card:tomas", strength: 1, depth: 1 },
  ],
  hidden: { chapters: 0, cards: 0 },
};

/** A browser whose frames come only when the test says, each a given time after the last. */
function fakeBrowser() {
  let waiting: ((now: number) => void) | null = null;
  const state = { now: 0, hidden: false, requested: 0, cancelled: 0 };
  return {
    state,
    environment: {
      requestFrame: (callback: (now: number) => void) => {
        waiting = callback;
        state.requested += 1;
        return state.requested;
      },
      cancelFrame: () => {
        waiting = null;
        state.cancelled += 1;
      },
      now: () => state.now,
      pixelRatio: () => 1,
      hidden: () => state.hidden,
    },
    /** Runs the frames that are due, `ms` apart. Returns how many ran. */
    run(count: number, ms = 16) {
      let ran = 0;
      for (let index = 0; index < count && waiting !== null; index += 1) {
        const callback = waiting;
        waiting = null;
        state.now += ms;
        callback(state.now);
        ran += 1;
      }
      return ran;
    },
    pending: () => waiting !== null,
  };
}

function fakePainter() {
  const frames: InkFrame[] = [];
  const sizes: { width: number; height: number; pixelRatio: number }[] = [];
  const state = { disposed: false };
  const painter: InkPainter = {
    resize: (width, height, pixelRatio) => sizes.push({ width, height, pixelRatio }),
    paint: (frame) => frames.push(frame),
    dispose: () => {
      state.disposed = true;
    },
  };
  return { painter, frames, sizes, state, last: () => frames.at(-1) as InkFrame };
}

describe("the ink network", () => {
  let hero: HTMLElement;
  let labels: HTMLElement;
  let browser: ReturnType<typeof fakeBrowser>;
  let paint: ReturnType<typeof fakePainter>;
  let ink: InkNetwork | null;

  const start = (reducedMotion = false) => {
    ink = createInkNetwork({
      hero,
      labels,
      painter: paint.painter,
      reducedMotion,
      environment: browser.environment,
    });
    return ink;
  };
  const label = (key: string) =>
    [...labels.children].find((item) => (item as HTMLElement).dataset.node === key) as HTMLElement;

  beforeEach(() => {
    hero = document.createElement("div");
    Object.defineProperty(hero, "clientWidth", { value: 1200 });
    Object.defineProperty(hero, "clientHeight", { value: 700 });
    labels = document.createElement("div");
    for (const node of NETWORK.nodes) {
      const button = document.createElement("button");
      button.dataset.node = node.key;
      labels.append(button);
    }
    document.body.append(hero, labels);
    browser = fakeBrowser();
    paint = fakePainter();
    ink = null;
  });

  afterEach(() => {
    ink?.dispose();
    hero.remove();
    labels.remove();
  });

  it("lets the ink out from the first chapter, and reaches everything in about three seconds", () => {
    start().setNetwork(NETWORK);

    browser.run(30);
    const early = paint.last();
    expect(early.nodes[0]?.ink).toBeGreaterThan(0);
    expect(early.nodes[3]?.ink).toBe(0);
    expect(early.links[1]?.grow).toBe(0);
    expect(label("card:faro").style.opacity).toBe("0");

    browser.run(200);
    const late = paint.last();
    expect(late.time).toBeGreaterThan(3);
    expect(late.time).toBeLessThan(4);
    for (const node of late.nodes) {
      expect(node.ink).toBeGreaterThan(0.5);
    }
    expect(late.links.every((link) => link.grow === 1)).toBe(true);
    expect(Number(label("card:faro").style.opacity)).toBeGreaterThan(0.5);
  });

  it("puts each name by its node, inside the picture", () => {
    start().setNetwork(NETWORK);
    browser.run(250);

    const frame = paint.last();
    for (const node of frame.nodes) {
      expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
      // Half the width over the height each way, in the painter's units.
      expect(Math.abs(node.x)).toBeLessThan(1200 / 700 / 2);
      expect(Math.abs(node.y)).toBeLessThan(0.5);
    }
    expect(label("card:marta").style.transform).toMatch(/^translate3d\(\d+\.\dpx,\d+\.\dpx,0\)/);
    // What's unresolved is in rust, whatever kind of card it is.
    expect(frame.nodes[1]?.color.map((value) => Math.round(value * 255))).toEqual([180, 73, 11]);
    expect(frame.nodes[2]?.color.map((value) => Math.round(value * 255))).toEqual([26, 42, 134]);
  });

  it("stops drawing while the window is hidden, and goes on when it's back", () => {
    start().setNetwork(NETWORK);
    browser.run(5);
    const drawn = paint.frames.length;

    browser.state.hidden = true;
    browser.run(5);
    expect(browser.pending()).toBe(false);
    expect(paint.frames.length).toBe(drawn);

    browser.state.hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(browser.run(5)).toBe(5);
    expect(paint.frames.length).toBe(drawn + 5);
  });

  it("draws one still picture, and no more, when the author wants less motion", () => {
    start(true).setNetwork(NETWORK);

    expect(browser.run(10)).toBe(1);
    expect(paint.frames).toHaveLength(1);
    // Everything is there at once: nothing grows.
    expect(paint.last().links.every((link) => link.grow === 1)).toBe(true);
    expect(paint.last().nodes.every((node) => node.ink > 0.5)).toBe(true);
    expect(browser.pending()).toBe(false);

    ink?.setActive("card:marta");
    expect(browser.run(10)).toBe(1);
    expect(paint.frames).toHaveLength(2);
  });

  it("darkens the node under the pointer and what it's tied to, and dims the rest", () => {
    const network = start(true);
    network.setNetwork(NETWORK);
    browser.run(1);
    const before = paint.last();

    network.setActive("card:tomas");
    browser.run(1);

    const after = paint.last();
    expect(after.nodes[2]?.ink).toBeGreaterThan(before.nodes[2]?.ink as number);
    expect(after.nodes[3]?.ink).toBeLessThan(before.nodes[3]?.ink as number);
    expect(after.links[1]?.ink).toBeGreaterThan(before.links[1]?.ink as number);
    expect(after.links[0]?.ink).toBeLessThan(before.links[0]?.ink as number);
  });

  it("grows a new node from where the ink already is, without starting over", () => {
    const network = start();
    network.setNetwork({ ...NETWORK, nodes: NETWORK.nodes.slice(0, 3) });
    browser.run(250);
    const settled = paint.last().time;

    network.setNetwork(NETWORK);
    browser.run(1);
    expect(paint.last().time).toBeGreaterThan(settled);
    expect(paint.last().nodes[0]?.ink).toBeGreaterThan(0.5);
    expect(paint.last().nodes[3]?.ink).toBe(0);

    browser.run(120);
    expect(paint.last().nodes[3]?.ink).toBeGreaterThan(0.5);
  });

  it("floods from a node before its card opens, and at once without motion", async () => {
    const network = start();
    network.setNetwork(NETWORK);
    browser.run(250);
    let opened = false;

    const flooding = network.flood("card:marta").then(() => {
      opened = true;
    });
    browser.run(10);
    await Promise.resolve();
    expect(opened).toBe(false);
    expect(paint.last().flood.reach).toBeGreaterThan(0);

    browser.run(30);
    await flooding;
    expect(opened).toBe(true);
    network.dispose();

    paint = fakePainter();
    const still = start(true);
    still.setNetwork(NETWORK);
    await still.flood("card:marta");
  });

  it("draws fewer pixels on a machine that can't keep up, down to a floor", () => {
    const network = start();
    network.setNetwork(NETWORK);
    const full = network.stats().pixelRatio;

    browser.run(100, 40);
    const lowered = network.stats().pixelRatio;
    expect(lowered).toBeLessThan(full);
    expect(paint.sizes.at(-1)?.pixelRatio).toBe(lowered);

    browser.run(1000, 40);
    expect(network.stats().pixelRatio).toBe(0.45);
  });

  it("keeps every pixel on a machine that keeps up", () => {
    const network = start();
    network.setNetwork(NETWORK);
    const full = network.stats().pixelRatio;

    browser.run(300, 16);

    expect(network.stats().pixelRatio).toBe(full);
  });

  it("lets go of everything when the Dashboard closes", () => {
    const network = start();
    network.setNetwork(NETWORK);
    browser.run(5);

    network.dispose();
    ink = null;

    expect(paint.state.disposed).toBe(true);
    expect(browser.pending()).toBe(false);
    const drawn = paint.frames.length;
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("resize"));
    browser.run(5);
    expect(paint.frames.length).toBe(drawn);
  });
});
