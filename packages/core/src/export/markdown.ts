import type { Inline, Paragraph } from "../prose/text";
import type { Manuscript } from "./manuscript";

const SCENE_BREAK = "* * *";

function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]<>~|]/g, "\\$&");
}

/** What would turn a paragraph into a heading, a quote or a list, if left at its start. */
function escapeLineStart(text: string): string {
  return text
    .replace(/^(\s*)(#{1,6}\s|>|[-+]\s|=+\s*$)/, "$1\\$2")
    .replace(/^(\s*\d+)([.)]\s)/, "$1\\$2");
}

/** Markers must touch the words, so the spaces around a styled run stay outside of them. */
function styled(text: string, marker: string): string {
  const match = text.match(/^(\s*)(.*?)(\s*)$/su);
  const [, before = "", body = "", after = ""] = match ?? [];
  return body === "" ? text : `${before}${marker}${body}${marker}${after}`;
}

function inlineToMarkdown(inline: Inline): string {
  if (inline.kind === "break") {
    return "\\\n";
  }
  const text = escapeInline(inline.text);
  if (inline.bold && inline.italic) {
    return styled(text, "***");
  }
  if (inline.bold) {
    return styled(text, "**");
  }
  return inline.italic ? styled(text, "*") : text;
}

function paragraphToMarkdown(paragraph: Paragraph): string {
  return escapeLineStart(paragraph.inlines.map(inlineToMarkdown).join(""));
}

const hasContent = (paragraph: Paragraph) => paragraph.inlines.length > 0;

export function toMarkdown(manuscript: Manuscript): string {
  const blocks: string[] = [`# ${escapeInline(manuscript.title)}`];
  for (const chapter of manuscript.chapters) {
    blocks.push(`## ${escapeInline(chapter.title)}`);
    chapter.scenes.forEach((scene, index) => {
      if (index > 0) {
        blocks.push(SCENE_BREAK);
      }
      blocks.push(...scene.filter(hasContent).map(paragraphToMarkdown));
    });
  }
  return `${blocks.join("\n\n")}\n`;
}
