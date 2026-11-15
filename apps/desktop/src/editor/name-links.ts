import type { NameMatch } from "@ink-writer/core";
import { type Editor, Extension } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
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
    // Paragraphs are immutable, so one that didn't change is never searched again.
    let cachedFor: ((text: string) => NameMatch[]) | null = null;
    let cache = new WeakMap<ProseNode, NameMatch[]>();

    const build = (doc: ProseNode): DecorationSet => {
      const find = source.find();
      if (find === null) {
        return DecorationSet.empty;
      }
      if (find !== cachedFor) {
        cachedFor = find;
        cache = new WeakMap();
      }
      const decorations: Decoration[] = [];
      doc.descendants((node, position) => {
        if (!node.isTextblock) {
          return true;
        }
        let matches = cache.get(node);
        if (matches === undefined) {
          matches = find(node.textBetween(0, node.content.size, undefined, LEAF));
          cache.set(node, matches);
        }
        for (const match of matches) {
          decorations.push(
            Decoration.inline(position + 1 + match.from, position + 1 + match.to, {
              class: "name-link",
              "data-entity": match.entityId,
            }),
          );
        }
        return false;
      });
      return DecorationSet.create(doc, decorations);
    };

    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_config, state) => build(state.doc),
          apply: (transaction, previous, _old, next) =>
            transaction.docChanged || transaction.getMeta(key) === true
              ? build(next.doc)
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

/** Looks again, after the known names or the mode changed. */
export function refreshNameLinks(editor: Editor): void {
  if (!editor.isDestroyed) {
    editor.view.dispatch(editor.state.tr.setMeta(key, true).setMeta("addToHistory", false));
  }
}

/**
 * Selects a passage and brings it into view. False if the text no longer says it. It only moves the
 * selection: nothing is written.
 */
export function showPassage(editor: Editor, quote: string): boolean {
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
  if (range === null) {
    return false;
  }
  editor.chain().setTextSelection(range).scrollIntoView().run();
  return true;
}
