import type { NameMatch } from "@ink-writer/core";
import { type Editor, Extension } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** What the plugin reads each time, so that the names can change without rebuilding the editor. */
export interface NameLinkSource {
  /** Null while links are off, as in the plain writing mode. */
  readonly find: () => ((text: string) => NameMatch[]) | null;
  /** While writing, a plain click must stay a click on the text. */
  readonly needsModifier: () => boolean;
  readonly onOpen: (entityId: string) => void;
}

const key = new PluginKey<DecorationSet>("nameLinks");

/** Stands for a line break, so that an offset in the text is the same offset in the document. */
const LEAF = "￼";

/**
 * Underlines the names the cards know, as the author types, with no model involved (SPEC §3.3). It
 * only decorates: the document, and so the manuscript, is never changed by it (rule 1).
 */
export const NameLinks = Extension.create<{ source: NameLinkSource | null }>({
  name: "nameLinks",

  addOptions() {
    return { source: null };
  },

  addProseMirrorPlugins() {
    const { source } = this.options;
    if (source === null) {
      return [];
    }
    type Find = (text: string) => NameMatch[];
    /** What the links on screen were found with, to tell a change of names from a keystroke. */
    let foundWith: Find | null = null;

    const linksIn = (node: ProseNode, position: number, find: Find): Decoration[] =>
      find(node.textBetween(0, node.content.size, undefined, LEAF)).map((match) =>
        Decoration.inline(position + 1 + match.from, position + 1 + match.to, {
          class: "name-link",
          "data-entity": match.entityId,
        }),
      );

    const build = (doc: ProseNode): DecorationSet => {
      const find = source.find();
      foundWith = find;
      if (find === null) {
        return DecorationSet.empty;
      }
      const decorations: Decoration[] = [];
      doc.descendants((node, position) => {
        if (!node.isTextblock) {
          return true;
        }
        decorations.push(...linksIn(node, position, find));
        return false;
      });
      return DecorationSet.create(doc, decorations);
    };

    /**
     * After a keystroke, only the paragraphs it touched are searched again: the rest keep their
     * links, moved along with the text. Typing costs the same however long the scene is.
     */
    const update = (
      transaction: Transaction,
      previous: DecorationSet,
      doc: ProseNode,
    ): DecorationSet => {
      const find = source.find();
      if (find === null || find !== foundWith) {
        return build(doc);
      }
      let links = previous.map(transaction.mapping, doc);
      const { maps } = transaction.mapping;
      maps.forEach((map, index) => {
        map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
          const rest = transaction.mapping.slice(index + 1);
          const from = Math.max(0, rest.map(newStart, -1));
          const to = Math.min(doc.content.size, rest.map(newEnd, 1));
          doc.nodesBetween(from, to, (node, position) => {
            if (!node.isTextblock) {
              return true;
            }
            links = links
              .remove(links.find(position, position + node.nodeSize))
              .add(doc, linksIn(node, position, find));
            return false;
          });
        });
      });
      return links;
    };

    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_config, state) => build(state.doc),
          apply: (transaction, previous, _old, next) =>
            transaction.getMeta(key) === true
              ? build(next.doc)
              : transaction.docChanged
                ? update(transaction, previous, next.doc)
                : previous,
        },
        props: {
          decorations: (state) => key.getState(state),
          handleDOMEvents: {
            click(_view, event) {
              const target = event.target instanceof Element ? event.target : null;
              const entityId = target?.closest(".name-link")?.getAttribute("data-entity");
              if (
                entityId === null ||
                entityId === undefined ||
                (source.needsModifier() && !event.ctrlKey && !event.metaKey)
              ) {
                return false;
              }
              event.preventDefault();
              source.onOpen(entityId);
              return true;
            },
          },
        },
      }),
    ];
  },
});

/** A passage to mark in the text, as the place a hint is about. */
export interface PassageMark {
  readonly key: string;
  readonly quote: string;
}

const marksKey = new PluginKey<DecorationSet>("hintMarks");

/**
 * Marks the passages that hints are about. Only decoration, like the links, and only ever given
 * something to mark in the reading mode: nothing shows while the author writes (SPEC §3.3).
 */
export const HintMarks = Extension.create<{ marks: (() => readonly PassageMark[]) | null }>({
  name: "hintMarks",

  addOptions() {
    return { marks: null };
  },

  addProseMirrorPlugins() {
    const read = this.options.marks;
    if (read === null) {
      return [];
    }
    const build = (doc: ProseNode): DecorationSet => {
      const marks = read();
      if (marks.length === 0) {
        return DecorationSet.empty;
      }
      const decorations: Decoration[] = [];
      doc.descendants((node, position) => {
        if (!node.isTextblock) {
          return true;
        }
        const text = node.textBetween(0, node.content.size, undefined, LEAF);
        for (const mark of marks) {
          const index = text.indexOf(mark.quote);
          if (index >= 0) {
            decorations.push(
              Decoration.inline(position + 1 + index, position + 1 + index + mark.quote.length, {
                class: "hint-mark",
                "data-hint": mark.key,
              }),
            );
          }
        }
        return false;
      });
      return DecorationSet.create(doc, decorations);
    };
    return [
      new Plugin<DecorationSet>({
        key: marksKey,
        state: {
          init: (_config, state) => build(state.doc),
          apply: (transaction, previous, _old, next) =>
            transaction.docChanged || transaction.getMeta(marksKey) === true
              ? build(next.doc)
              : previous,
        },
        props: { decorations: (state) => marksKey.getState(state) },
      }),
    ];
  },
});

export function refreshHintMarks(editor: Editor): void {
  if (!editor.isDestroyed) {
    editor.view.dispatch(editor.state.tr.setMeta(marksKey, true).setMeta("addToHistory", false));
  }
}

/** Looks again, after the known names or the mode changed. */
export function refreshNameLinks(editor: Editor): void {
  if (!editor.isDestroyed) {
    editor.view.dispatch(editor.state.tr.setMeta(key, true).setMeta("addToHistory", false));
  }
}

function findPassage(editor: Editor, quote: string): { from: number; to: number } | null {
  let range: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, position) => {
    if (range !== null || !node.isTextblock) {
      return range === null;
    }
    const index = node.textBetween(0, node.content.size, undefined, LEAF).indexOf(quote);
    if (index >= 0) {
      range = { from: position + 1 + index, to: position + 1 + index + quote.length };
    }
    return false;
  });
  return range;
}

/**
 * Selects a passage and brings it into view. False if the text no longer says it. It only moves the
 * selection: nothing is written.
 */
export function showPassage(editor: Editor, quote: string): boolean {
  const range = findPassage(editor, quote);
  if (range === null) {
    return false;
  }
  editor.chain().setTextSelection(range).scrollIntoView().run();
  return true;
}

/**
 * Puts a correction in place of a passage. This is the one way the app ever changes the manuscript,
 * and only because the author pressed "Apply" on that very correction (rule 1). It's one undoable
 * step. False, with nothing changed, if the text no longer says the passage.
 */
export function applyCorrection(editor: Editor, quote: string, fix: string): boolean {
  const range = findPassage(editor, quote);
  if (range === null) {
    return false;
  }
  return editor.chain().insertContentAt(range, fix).scrollIntoView().run();
}
