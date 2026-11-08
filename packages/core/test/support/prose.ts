import * as Y from "yjs";
import { PROSE_FIELD, plainText, readParagraphs } from "../../src/index";

/** Types paragraphs into a document the way the editor stores them. */
export function writeParagraphs(doc: Y.Doc, paragraphs: readonly string[]): void {
  doc.transact(() => {
    const fragment = doc.getXmlFragment(PROSE_FIELD);
    for (const paragraph of paragraphs) {
      const element = new Y.XmlElement("paragraph");
      element.insert(0, [new Y.XmlText(paragraph)]);
      fragment.push([element]);
    }
  });
}

/** Adds text at the end of the first paragraph, creating it if needed. */
export function typeInto(doc: Y.Doc, text: string): void {
  const fragment = doc.getXmlFragment(PROSE_FIELD);
  if (fragment.length === 0) {
    writeParagraphs(doc, [text]);
    return;
  }
  const paragraph = fragment.get(0) as Y.XmlElement;
  const node = paragraph.get(0) as Y.XmlText;
  node.insert(node.length, text);
}

export const textOf = (doc: Y.Doc) => plainText(readParagraphs(doc));
