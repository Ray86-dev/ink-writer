import * as Y from "yjs";

/** Where the prose lives inside a scene's Yjs document. */
export const PROSE_FIELD = "prose";

export type Inline =
  | {
      readonly kind: "text";
      readonly text: string;
      readonly bold: boolean;
      readonly italic: boolean;
    }
  | { readonly kind: "break" };

export interface Paragraph {
  readonly inlines: readonly Inline[];
}

const HARD_BREAK = "hardBreak";

function readInlines(parent: Y.XmlElement | Y.XmlFragment, out: Inline[]): void {
  for (const child of parent.toArray()) {
    if (child instanceof Y.XmlText) {
      for (const part of child.toDelta() as {
        insert?: unknown;
        attributes?: Record<string, unknown>;
      }[]) {
        if (typeof part.insert === "string" && part.insert !== "") {
          out.push({
            kind: "text",
            text: part.insert,
            bold: part.attributes?.bold !== undefined,
            italic: part.attributes?.italic !== undefined,
          });
        }
      }
    } else if (child instanceof Y.XmlElement) {
      if (child.nodeName === HARD_BREAK) {
        out.push({ kind: "break" });
      } else {
        // An element this version doesn't know, from a future schema. Its text is kept: exporting
        // or comparing must never lose words just because the markup is unfamiliar.
        readInlines(child, out);
      }
    }
  }
}

/** The prose of a Yjs document, independent of the editor. */
export function readParagraphs(doc: Y.Doc): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (const child of doc.getXmlFragment(PROSE_FIELD).toArray()) {
    if (child instanceof Y.XmlElement) {
      const inlines: Inline[] = [];
      readInlines(child, inlines);
      paragraphs.push({ inlines });
    } else if (child instanceof Y.XmlText) {
      paragraphs.push({
        inlines: [{ kind: "text", text: child.toString(), bold: false, italic: false }],
      });
    }
  }
  return paragraphs;
}

/** Reads the prose out of a stored document state. */
export function paragraphsFromState(state: Uint8Array): Paragraph[] {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return readParagraphs(doc);
  } finally {
    doc.destroy();
  }
}

export function plainText(paragraphs: readonly Paragraph[]): string {
  return paragraphs
    .map((paragraph) =>
      paragraph.inlines.map((inline) => (inline.kind === "text" ? inline.text : "\n")).join(""),
    )
    .join("\n");
}

export function countWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

/** What the editor needs to show these paragraphs, as ProseMirror-style JSON. */
export function paragraphsToEditorContent(paragraphs: readonly Paragraph[]): unknown {
  const marks = (inline: Inline & { kind: "text" }) => {
    const list = [
      ...(inline.bold ? [{ type: "bold" }] : []),
      ...(inline.italic ? [{ type: "italic" }] : []),
    ];
    return list.length > 0 ? { marks: list } : {};
  };
  return {
    type: "doc",
    content: paragraphs.map((paragraph) => ({
      type: "paragraph",
      content: paragraph.inlines.map((inline) =>
        inline.kind === "break"
          ? { type: HARD_BREAK }
          : { type: "text", text: inline.text, ...marks(inline) },
      ),
    })),
  };
}
