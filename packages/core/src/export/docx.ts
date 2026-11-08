import { strToU8, zipSync } from "fflate";
import type { Inline, Paragraph } from "../prose/text";
import type { Manuscript } from "./manuscript";

/**
 * A DOCX written by hand, on purpose. It has no `docProps` parts at all, so there's no generator,
 * author or date to scrub: rule 11 holds by construction. See docs/adr/0010.
 */

const WORD = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// A fixed date inside the ZIP format's range, so the file carries no trace of when it was made.
const ZIP_DATE = new Date(Date.UTC(1980, 0, 1, 12));

/** XML 1.0's allowed characters. Any other would make the whole file unreadable. */
function isLegalInXml(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

function withoutIllegalCharacters(text: string): string {
  let out = "";
  // `for...of` walks code points, so a character outside the basic plane stays in one piece.
  for (const character of text) {
    if (isLegalInXml(character.codePointAt(0) ?? 0)) {
      out += character;
    }
  }
  return out;
}

function escapeXml(text: string): string {
  return withoutIllegalCharacters(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function run(text: string, properties = ""): string {
  const props = properties === "" ? "" : `<w:rPr>${properties}</w:rPr>`;
  return `<w:r>${props}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function inlineToXml(inline: Inline): string {
  if (inline.kind === "break") {
    return "<w:r><w:br/></w:r>";
  }
  return run(inline.text, `${inline.bold ? "<w:b/>" : ""}${inline.italic ? "<w:i/>" : ""}`);
}

function paragraphToXml(paragraph: Paragraph): string {
  return `<w:p>${paragraph.inlines.map(inlineToXml).join("")}</w:p>`;
}

function styledParagraph(style: string, text: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${run(text)}</w:p>`;
}

const SCENE_BREAK = styledParagraph("SceneBreak", "* * *");

function documentXml(manuscript: Manuscript): string {
  const body: string[] = [styledParagraph("Title", manuscript.title)];
  for (const chapter of manuscript.chapters) {
    body.push(styledParagraph("Heading1", chapter.title));
    chapter.scenes.forEach((scene, index) => {
      if (index > 0) {
        body.push(SCENE_BREAK);
      }
      for (const paragraph of scene) {
        if (paragraph.inlines.length > 0) {
          body.push(paragraphToXml(paragraph));
        }
      }
    });
  }
  const page =
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/>' +
    "</w:sectPr>";
  return `${XML_HEADER}<w:document ${WORD}><w:body>${body.join("")}${page}</w:body></w:document>`;
}

function stylesXml(language: string): string {
  const style = (id: string, name: string, paragraph: string, characters: string) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>` +
    `<w:next w:val="Normal"/><w:qFormat/><w:pPr>${paragraph}</w:pPr><w:rPr>${characters}</w:rPr></w:style>`;
  return (
    `${XML_HEADER}<w:styles ${WORD}>` +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>' +
    `<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="${escapeXml(language)}"/></w:rPr></w:rPrDefault></w:docDefaults>` +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>' +
    '<w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/><w:ind w:firstLine="425"/><w:jc w:val="both"/></w:pPr></w:style>' +
    style(
      "Title",
      "Title",
      '<w:spacing w:before="2400" w:after="2400"/><w:ind w:firstLine="0"/><w:jc w:val="center"/>',
      '<w:sz w:val="48"/><w:szCs w:val="48"/>',
    ) +
    style(
      "Heading1",
      "heading 1",
      '<w:keepNext/><w:pageBreakBefore/><w:spacing w:after="480"/><w:ind w:firstLine="0"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/>',
      '<w:sz w:val="32"/><w:szCs w:val="32"/>',
    ) +
    style(
      "SceneBreak",
      "Scene Break",
      '<w:spacing w:before="240" w:after="240"/><w:ind w:firstLine="0"/><w:jc w:val="center"/>',
      "",
    ) +
    "</w:styles>"
  );
}

const CONTENT_TYPES =
  `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  "</Types>";

const ROOT_RELS =
  `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";

const DOCUMENT_RELS =
  `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  "</Relationships>";

export function toDocx(manuscript: Manuscript): Uint8Array {
  return zipSync(
    {
      "[Content_Types].xml": strToU8(CONTENT_TYPES),
      "_rels/.rels": strToU8(ROOT_RELS),
      "word/document.xml": strToU8(documentXml(manuscript)),
      "word/styles.xml": strToU8(stylesXml(manuscript.language)),
      "word/_rels/document.xml.rels": strToU8(DOCUMENT_RELS),
    },
    { mtime: ZIP_DATE },
  );
}
