import type { Network, NetworkKind, NetworkLink, NetworkNode } from "@ink-writer/core";

/**
 * The ink network of the Dashboard (DESIGN.md): where each node is on screen at each moment, how
 * the ink grows, and when to draw at all. What paints it is handed in, so that none of this needs
 * WebGL: without it there's simply no network, and the cards hold everything (rule 12).
 */

type Rgb = readonly [number, number, number];

/** One picture of the network, in the painter's units: origin at the centre, the height as one. */
export interface InkFrame {
  readonly time: number;
  readonly nodes: readonly {
    readonly x: number;
    readonly y: number;
    readonly radius: number;
    readonly ink: number;
    readonly color: Rgb;
  }[];
  readonly links: readonly {
    readonly ax: number;
    readonly ay: number;
    readonly bx: number;
    readonly by: number;
    readonly grow: number;
    readonly ink: number;
    readonly seed: number;
  }[];
  /** Ink spreading from a node that's being opened. No reach, no flood. */
  readonly flood: { readonly x: number; readonly y: number; readonly reach: number };
  /** Where the ink fades out to leave room for what's written over it. */
  readonly fade: readonly [number, number, number, number];
  readonly stroke: number;
}

export interface InkPainter {
  /** The size in CSS pixels and how many real pixels to draw for each. */
  readonly resize: (width: number, height: number, pixelRatio: number) => void;
  readonly paint: (frame: InkFrame) => void;
  readonly dispose: () => void;
}

/** What it asks of the browser, so that a test can stand in for it. */
export interface InkEnvironment {
  readonly requestFrame: (callback: (now: number) => void) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly now: () => number;
  readonly pixelRatio: () => number;
  readonly hidden: () => boolean;
}

export interface InkNetworkOptions {
  /** The area the network is drawn in. Out of sight, nothing is drawn. */
  readonly hero: HTMLElement;
  /** Holds one element per node, each with its key in `data-node`. */
  readonly labels: HTMLElement;
  readonly painter: InkPainter;
  /** The author asked the system for less motion: one still picture, redrawn only on a change. */
  readonly reducedMotion: boolean;
  /** On a narrow window, where what's written above the network ends, in pixels from the top. */
  readonly textBottom?: () => number;
  readonly environment?: Partial<InkEnvironment>;
}

export interface InkNetwork {
  readonly setNetwork: (network: Network) => void;
  /** Darkens a node and what it's tied to, and dims the rest. */
  readonly setActive: (key: string | null) => void;
  /** Ink floods from the node. Resolves when it has covered the screen, or at once without motion. */
  readonly flood: (key: string) => Promise<void>;
  readonly dispose: () => void;
  /** How many pictures have been drawn, and at what share of the real pixels. */
  readonly stats: () => { readonly frames: number; readonly pixelRatio: number };
}

const hex = (value: string): Rgb => [
  Number.parseInt(value.slice(1, 3), 16) / 255,
  Number.parseInt(value.slice(3, 5), 16) / 255,
  Number.parseInt(value.slice(5, 7), 16) / 255,
];

/** The pigments of DESIGN.md. Rust is for what's still to be resolved. */
const PIGMENTS: Readonly<Record<NetworkKind | "conflict", Rgb>> = {
  chapter: hex("#12141C"),
  person: hex("#1A2A86"),
  place: hex("#0F5C60"),
  lore: hex("#4B2A5E"),
  conflict: hex("#B4490B"),
};

const WIDE = 760;
const FLOOD_MS = 460;
const MIN_PIXEL_RATIO = 0.45;
/** A camera four units away with a 30° field of view. */
const CAMERA = 4;
const FOCAL = 1 / Math.tan((15 * Math.PI) / 180);

interface LiveNode {
  readonly node: NetworkNode;
  readonly element: HTMLElement | null;
  labelWidth: number;
  born: number;
  grow: number;
  ink: number;
  inkTarget: number;
  x: number;
  y: number;
  near: number;
  far: number;
  readonly phase: number;
  labelX: number;
  labelY: number | null;
}

interface LiveLink {
  readonly link: NetworkLink;
  readonly from: LiveNode;
  readonly to: LiveNode;
  born: number;
  grow: number;
  ink: number;
  inkTarget: number;
  readonly seed: number;
}

const easeOut = (value: number) => 1 - (1 - Math.min(1, Math.max(0, value))) ** 3;

export function createInkNetwork(options: InkNetworkOptions): InkNetwork {
  const { hero, labels, painter, reducedMotion } = options;
  const environment: InkEnvironment = {
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    now: () => performance.now(),
    pixelRatio: () => window.devicePixelRatio || 1,
    hidden: () => document.hidden,
    ...options.environment,
  };

  let nodes: LiveNode[] = [];
  let links: LiveLink[] = [];
  let width = 1;
  let height = 1;
  let centreX = 0;
  let centreY = 0;
  let scale = 1;
  let fade: [number, number, number, number] = [0, 0, 0, 0];
  // The ink is soft, so it's drawn with fewer pixels than the screen has, and with fewer still if
  // the machine can't keep up.
  let pixelRatio = Math.min(environment.pixelRatio(), 1) * 0.85;
  let clock = reducedMotion ? 100 : 0;
  let last = environment.now();
  let pointerX = 0;
  let pointerY = 0;
  let swayX = 0;
  let swayY = 0;
  // Timed by the frames' own clock, from the first frame that draws it.
  let flood: { x: number; y: number; start: number | null; done: () => void } | null = null;
  let inView = true;
  let handle: number | null = null;
  let disposed = false;
  let frames = 0;
  let measured = 0;
  let measuredTime = 0;
  let previous: number | null = null;

  const visible = () => inView && !environment.hidden();

  const labelOf = (key: string) =>
    ([...labels.children] as HTMLElement[]).find((item) => item.dataset.node === key) ?? null;

  function measure(): void {
    width = hero.clientWidth || 1;
    height = hero.clientHeight || 1;
    painter.resize(width, height, pixelRatio);
    if (width >= WIDE) {
      // The next step is written on the left, and the network floats on the right.
      centreX = width * 0.665;
      centreY = height * 0.5;
      scale = Math.min(width * 0.27, height * 0.43);
      fade = [0.3, 0.47, 0, 0.02];
    } else {
      const bottom = Math.min(options.textBottom?.() ?? 0, height * 0.6);
      centreX = width * 0.5;
      centreY = (bottom + height) / 2;
      scale = Math.min(width * 0.34, (height - bottom) * 0.38);
      fade = [-1, -0.5, (bottom - 20) / height, (bottom + 40) / height];
    }
    for (const item of nodes) {
      item.labelWidth = item.element?.offsetWidth ?? 0;
    }
  }

  function step(now: number): void {
    const elapsed = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!reducedMotion) {
      clock += elapsed;
    }
    swayX += (pointerX - swayX) * 0.05;
    swayY += (pointerY - swayY) * 0.05;
    const turnX = reducedMotion ? 0 : swayY * 0.28;
    const turnY = (reducedMotion ? 0.2 : Math.sin(clock * 0.11) * 0.42) + swayX * 0.42;
    const ease = reducedMotion ? 1 : 0.1;

    for (const item of nodes) {
      item.grow = reducedMotion ? 1 : easeOut((clock - item.born) / 0.75);
      item.ink += (item.inkTarget - item.ink) * ease;
      const [px, py, pz] = item.node.position;
      const bob = reducedMotion ? 0 : Math.sin(clock * 0.5 + item.phase) * 0.02;
      // Turned about the vertical axis and then tilted, as the pointer and the slow drift say.
      const x1 = px * Math.cos(turnY) + pz * Math.sin(turnY);
      const z1 = -px * Math.sin(turnY) + pz * Math.cos(turnY);
      const y2 = (py + bob) * Math.cos(turnX) - z1 * Math.sin(turnX);
      const z2 = (py + bob) * Math.sin(turnX) + z1 * Math.cos(turnX);
      const perspective = FOCAL / (CAMERA - z2);
      item.x = centreX + x1 * perspective * scale * 1.07;
      item.y = centreY - y2 * perspective * scale * 1.07;
      item.near = CAMERA / (CAMERA - z2);
      item.far = 0.72 + 0.28 * Math.min(1, Math.max(0, (z2 + 1) / 2));
      item.labelX = Math.min(
        width - item.labelWidth / 2 - 8,
        Math.max(item.labelWidth / 2 + 8, item.x),
      );
      if (item.element !== null) {
        item.element.style.opacity = item.grow > 0.35 ? (0.62 + 0.38 * item.far).toFixed(2) : "0";
      }
    }

    // Labels mustn't cover one another: the nearest keep their place and the rest move down.
    const placed: { x: number; y: number; width: number }[] = [];
    for (const item of [...nodes].sort((a, b) => b.near - a.near)) {
      let y = item.y + 14 * item.near;
      let moved = true;
      for (let guard = 0; moved && guard < 6; guard += 1) {
        moved = false;
        for (const other of placed) {
          const overlapX =
            Math.abs(item.labelX - other.x) < (item.labelWidth + other.width) / 2 + 4;
          if (overlapX && Math.abs(y - other.y) < 30) {
            y = other.y + 30;
            moved = true;
          }
        }
      }
      if (item.grow > 0.35) {
        placed.push({ x: item.labelX, y, width: item.labelWidth });
      }
      item.labelY =
        item.labelY === null || reducedMotion ? y : item.labelY + (y - item.labelY) * 0.12;
      if (item.element !== null) {
        item.element.style.transform = `translate3d(${item.labelX.toFixed(1)}px,${item.labelY.toFixed(1)}px,0) translateX(-50%)`;
      }
    }

    for (const item of links) {
      item.grow = reducedMotion ? 1 : easeOut((clock - item.born) / 0.7);
      item.ink += (item.inkTarget - item.ink) * ease;
    }

    let reach = 0;
    if (flood !== null) {
      flood.start ??= now;
      const progress = (now - flood.start) / FLOOD_MS;
      reach = Math.min(1, Math.max(0, progress)) ** 2.2 * 1.9;
      if (progress >= 1) {
        const { done } = flood;
        // It stays covered: the card takes the screen right after.
        flood = { ...flood, done: () => {} };
        done();
      }
    }

    const toX = (x: number) => (x - width / 2) / height;
    const toY = (y: number) => (height / 2 - y) / height;
    painter.paint({
      time: clock,
      nodes: nodes.map((item) => {
        return {
          x: toX(item.x),
          y: toY(item.y),
          radius:
            item.node.radius * item.near * (scale / (height * 0.42)) * (0.3 + 0.7 * item.grow),
          ink: item.ink * item.far * item.grow * 1.1,
          color: item.node.conflict ? PIGMENTS.conflict : PIGMENTS[item.node.kind],
        };
      }),
      links: links.map((item) => ({
        ax: toX(item.from.x),
        ay: toY(item.from.y),
        bx: toX(item.to.x),
        by: toY(item.to.y),
        grow: item.grow,
        ink: item.ink * item.link.strength,
        seed: item.seed,
      })),
      flood: { x: toX(flood?.x ?? 0), y: toY(flood?.y ?? 0), reach },
      fade,
      stroke: Math.min(1, Math.max(0.5, scale / (height * 0.43))),
    });
    frames += 1;
  }

  function loop(now: number): void {
    handle = null;
    if (disposed || !visible()) {
      return;
    }
    step(now);
    // A machine that can't keep up gets fewer pixels to fill, down to a floor.
    if (previous !== null) {
      measuredTime += now - previous;
      measured += 1;
    }
    previous = now;
    if (measured >= 45) {
      if (measuredTime / measured > 26 && pixelRatio > MIN_PIXEL_RATIO) {
        pixelRatio = Math.max(MIN_PIXEL_RATIO, pixelRatio - 0.15);
        measure();
      }
      measured = 0;
      measuredTime = 0;
    }
    handle = environment.requestFrame(loop);
  }

  /** Draws: once if there's to be no motion, and otherwise for as long as it's in sight. */
  function wake(): void {
    if (disposed || handle !== null || !visible()) {
      return;
    }
    previous = null;
    last = environment.now();
    handle = environment.requestFrame(
      reducedMotion
        ? (now) => {
            handle = null;
            if (!disposed) step(now);
          }
        : loop,
    );
  }

  function shade(key: string | null): void {
    const near = new Set<string>();
    if (key !== null) {
      near.add(key);
      for (const item of links) {
        if (item.link.from === key) near.add(item.link.to);
        if (item.link.to === key) near.add(item.link.from);
      }
    }
    for (const item of nodes) {
      item.inkTarget =
        key === null ? 1 : item.node.key === key ? 1.5 : near.has(item.node.key) ? 1.05 : 0.38;
    }
    for (const item of links) {
      item.inkTarget =
        key === null ? 1 : item.link.from === key || item.link.to === key ? 1.8 : 0.3;
    }
  }

  const onPointer = (event: PointerEvent) => {
    pointerX = event.clientX / (window.innerWidth || 1) - 0.5;
    pointerY = event.clientY / (window.innerHeight || 1) - 0.5;
  };
  const onResize = () => {
    measure();
    wake();
  };
  const onVisibility = () => wake();
  window.addEventListener("pointermove", onPointer, { passive: true });
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibility);
  const watcher =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver((entries) => {
          inView = entries.at(-1)?.isIntersecting ?? true;
          wake();
        });
  watcher?.observe(hero);
  const sizer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
  sizer?.observe(hero);

  return {
    setNetwork(network) {
      const before = new Map(nodes.map((item) => [item.node.key, item]));
      const opening = before.size === 0;
      if (opening && !reducedMotion) {
        clock = 0;
      }
      // The ink takes about three seconds to reach the furthest node, however far that is.
      const deepest = Math.max(1, ...network.nodes.map((node) => node.depth));
      const pace = Math.min(0.62, 2.6 / deepest);
      nodes = network.nodes.map((node, index) => {
        const known = before.get(node.key);
        const element = labelOf(node.key);
        return {
          node,
          element,
          labelWidth: element?.offsetWidth ?? 0,
          // What a new scene adds grows from where the ink already is.
          born: known?.born ?? (opening ? 0.25 + node.depth * pace : clock + 0.7),
          grow: known?.grow ?? 0,
          ink: known?.ink ?? 1,
          inkTarget: 1,
          x: known?.x ?? 0,
          y: known?.y ?? 0,
          near: known?.near ?? 1,
          far: known?.far ?? 1,
          phase: index * 1.7,
          labelX: known?.labelX ?? 0,
          labelY: known?.labelY ?? null,
        };
      });
      const byKey = new Map(nodes.map((item) => [item.node.key, item]));
      const linked = new Map(links.map((item) => [`${item.link.from}\u001e${item.link.to}`, item]));
      links = network.links.flatMap((link, index) => {
        const from = byKey.get(link.from);
        const to = byKey.get(link.to);
        if (from === undefined || to === undefined) {
          return [];
        }
        const known = linked.get(`${link.from}\u001e${link.to}`);
        return [
          {
            link,
            from,
            to,
            born: known?.born ?? (opening ? 0.25 + link.depth * pace : clock + 0.1),
            grow: known?.grow ?? 0,
            ink: known?.ink ?? 1,
            inkTarget: 1,
            seed: index * 2.3,
          },
        ];
      });
      measure();
      wake();
    },
    setActive(key) {
      shade(key);
      wake();
    },
    flood(key) {
      const target = nodes.find((item) => item.node.key === key);
      if (reducedMotion || disposed || target === undefined || !visible()) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        flood?.done();
        flood = { x: target.x, y: target.y, start: null, done: resolve };
        wake();
      });
    },
    dispose() {
      disposed = true;
      if (handle !== null) {
        environment.cancelFrame(handle);
        handle = null;
      }
      flood?.done();
      flood = null;
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      watcher?.disconnect();
      sizer?.disconnect();
      painter.dispose();
    },
    stats: () => ({ frames, pixelRatio }),
  };
}
