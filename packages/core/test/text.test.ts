import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  compareTexts,
  countWords,
  PROSE_FIELD,
  paragraphsFromState,
  paragraphsToEditorContent,
  plainText,
  readParagraphs,
} from "../src/index";

function styledDoc() {
  const doc = new Y.Doc();
  doc.transact(() => {
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    text.insert(0, "normal ");
    text.insert(7, "cursiva", { italic: {} });
    text.insert(14, " y ", {});
    text.insert(17, "negrita", { bold: {} });
    paragraph.insert(0, [text, new Y.XmlElement("hardBreak"), new Y.XmlText("tras el salto")]);
    doc.getXmlFragment(PROSE_FIELD).push([paragraph]);
  });
  return doc;
}

describe("readParagraphs", () => {
  it("reads text, styles and line breaks", () => {
    expect(readParagraphs(styledDoc())).toEqual([
      {
        inlines: [
          { kind: "text", text: "normal ", bold: false, italic: false },
          { kind: "text", text: "cursiva", bold: false, italic: true },
          { kind: "text", text: " y ", bold: false, italic: false },
          { kind: "text", text: "negrita", bold: true, italic: false },
          { kind: "break" },
          { kind: "text", text: "tras el salto", bold: false, italic: false },
        ],
      },
    ]);
  });

  it("keeps empty paragraphs", () => {
    const doc = new Y.Doc();
    doc.getXmlFragment(PROSE_FIELD).push([new Y.XmlElement("paragraph")]);

    expect(readParagraphs(doc)).toEqual([{ inlines: [] }]);
  });

  it("never loses the text of markup it doesn't know", () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const future = new Y.XmlElement("someFutureBlock");
      const inner = new Y.XmlElement("someFutureInline");
      inner.insert(0, [new Y.XmlText("no me pierdas")]);
      future.insert(0, [inner]);
      doc.getXmlFragment(PROSE_FIELD).push([future]);
    });

    expect(plainText(readParagraphs(doc))).toBe("no me pierdas");
  });

  it("reads a stored state the same as the live document", () => {
    const doc = styledDoc();

    expect(paragraphsFromState(Y.encodeStateAsUpdate(doc))).toEqual(readParagraphs(doc));
  });
});

describe("plainText", () => {
  it("joins paragraphs and breaks with new lines", () => {
    expect(plainText(readParagraphs(styledDoc()))).toBe("normal cursiva y negrita\ntras el salto");
  });
});

describe("countWords", () => {
  it.each([
    ["", 0],
    ["   \n ", 0],
    ["una", 1],
    ["—Dijo que sí —respondió.", 4],
    ["una\ndos\n\ntres", 3],
  ])("%j has %i words", (text, expected) => {
    expect(countWords(text)).toBe(expected);
  });
});

describe("paragraphsToEditorContent", () => {
  it("gives the shape the editor expects", () => {
    expect(paragraphsToEditorContent(readParagraphs(styledDoc()))).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "normal " },
            { type: "text", text: "cursiva", marks: [{ type: "italic" }] },
            { type: "text", text: " y " },
            { type: "text", text: "negrita", marks: [{ type: "bold" }] },
            { type: "hardBreak" },
            { type: "text", text: "tras el salto" },
          ],
        },
      ],
    });
  });
});

describe("compareTexts", () => {
  it("marks what was added and removed", () => {
    expect(compareTexts("los ojos verdes", "los ojos marrones")).toEqual([
      { kind: "same", text: "los ojos " },
      { kind: "removed", text: "verdes" },
      { kind: "added", text: "marrones" },
    ]);
  });

  it("reports identical texts as unchanged", () => {
    expect(compareTexts("igual", "igual")).toEqual([{ kind: "same", text: "igual" }]);
  });

  it("rebuilds both texts exactly from its parts", () => {
    const before = "—Hola, dijo.\n\nY se fue.";
    const after = "—Adiós, dijo ella.\n\nY se fue lejos.";
    const parts = compareTexts(before, after) ?? [];

    const rebuild = (skip: string) =>
      parts
        .filter((part) => part.kind !== skip)
        .map((part) => part.text)
        .join("");

    expect(rebuild("added")).toBe(before);
    expect(rebuild("removed")).toBe(after);
  });
});
