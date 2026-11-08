import { vi } from "vitest";

/** What ProseMirror asks of a browser and jsdom doesn't implement, since it doesn't lay out pages. */
export function stubLayout(): void {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 };
  const rects = Object.assign([], { item: () => null });
  Range.prototype.getClientRects = () => rects as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect;
  Element.prototype.scrollIntoView = vi.fn();
  document.elementFromPoint = () => null;
}
