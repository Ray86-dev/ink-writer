import type { SceneSession } from "@ink-writer/core";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect } from "react";
import { proseExtensions } from "./extensions";

export interface SceneEditorProps {
  readonly session: SceneSession;
  readonly label: string;
  readonly language: string;
  /** False in the reading mode. */
  readonly editable?: boolean;
  readonly autofocus?: boolean;
  /** For whoever needs the editor itself: to restore a version, or to measure typing. */
  readonly onEditor?: (editor: Editor | null) => void;
  /** Called on every change the author makes, without re-rendering anything. */
  readonly onInput?: () => void;
}

/**
 * The text itself. `shouldRerenderOnTransaction: false` keeps it out of React's rendering, so that
 * typing costs the same however much of the app is on screen. The parent gives this a `key` per
 * session: a scene never shares an editor with another one.
 */
export function SceneEditor({
  session,
  label,
  language,
  editable = true,
  autofocus = true,
  onEditor,
  onInput,
}: SceneEditorProps) {
  const editor = useEditor({
    extensions: proseExtensions(session.doc),
    autofocus: autofocus ? "end" : false,
    editable,
    shouldRerenderOnTransaction: false,
    // It would add a <style> tag, which the CSP blocks. The same rules are in styles.css.
    injectCSS: false,
    editorProps: {
      attributes: {
        class: "prose",
        "aria-label": label,
        "aria-multiline": "true",
        role: "textbox",
        lang: language,
        spellcheck: "true",
      },
    },
    onUpdate: () => onInput?.(),
  });

  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  useEffect(() => {
    editor.setEditable(editable);
  }, [editor, editable]);

  return <EditorContent editor={editor} />;
}
