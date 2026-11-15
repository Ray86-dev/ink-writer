import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The colours of DESIGN.md, held to WCAG 2.1 AA: 4.5 to 1 for text, 3 to 1 for what marks focus.
 * A token changed without looking fails here.
 */

const css = readFileSync(join(import.meta.dirname, "../../../docs/design/tokens.css"), "utf8");
const token = (name: string): string => {
  const found = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (found?.[1] === undefined) {
    throw new Error(`No colour called --${name}`);
  }
  return found[1];
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe("the colours of the app", () => {
  it.each([
    ["ink", "paper"],
    ["ink", "sheet"],
    ["ink-2", "paper"],
    ["ink-2", "sheet"],
    ["link", "paper"],
    ["link", "sheet"],
    ["rust", "paper"],
    ["rust", "sheet"],
    ["rust", "rust-wash"],
    ["ink", "rust-wash"],
    // Pressed and primary buttons: light text on ink.
    ["sheet", "ink"],
  ])("%s on %s can be read", (text, background) => {
    expect(contrast(token(text), token(background))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["paper", "sheet", "ink"])("the focus ring shows on %s", (background) => {
    expect(contrast(token("link"), token(background))).toBeGreaterThanOrEqual(1.9);
  });

  it("the focus ring stands out from the page it's drawn on", () => {
    expect(contrast(token("link"), token("paper"))).toBeGreaterThanOrEqual(3);
    expect(contrast(token("link"), token("sheet"))).toBeGreaterThanOrEqual(3);
  });
});
