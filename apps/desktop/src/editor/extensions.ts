import { PROSE_FIELD } from "@ink-writer/core";
import Bold from "@tiptap/extension-bold";
import Collaboration from "@tiptap/extension-collaboration";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Italic from "@tiptap/extension-italic";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import type * as Y from "yjs";

/**
 * The prose schema: paragraphs, line breaks, bold and italics. Chapters and scenes are structure, so
 * they don't need headings here. Undo comes from the collaboration extension and works per session.
 */
export function proseExtensions(doc: Y.Doc) {
  return [
    Document,
    Paragraph,
    Text,
    Bold,
    Italic,
    HardBreak,
    Collaboration.configure({ document: doc, field: PROSE_FIELD }),
  ];
}
