import { type Paragraph, paragraphsToEditorContent } from "@ink-writer/core";
import type { Editor } from "@tiptap/core";
import { yUndoPluginKey } from "@tiptap/y-tiptap";

/**
 * Replaces the whole text through the editor, as one edit of its own. Undo groups edits made close
 * together, and this keeps it out of any group: one undo goes back to exactly the previous text.
 */
export function replaceProse(editor: Editor, paragraphs: readonly Paragraph[]): void {
  const undo = yUndoPluginKey.getState(editor.state)?.undoManager;
  undo?.stopCapturing();
  editor.commands.setContent(paragraphsToEditorContent(paragraphs) as never);
  undo?.stopCapturing();
}
