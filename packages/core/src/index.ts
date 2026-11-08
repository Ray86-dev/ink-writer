export { toDocx } from "./export/docx";
export type { Manuscript, ManuscriptChapter } from "./export/manuscript";
export { buildManuscript } from "./export/manuscript";
export { toMarkdown } from "./export/markdown";
export type { DiffPart } from "./prose/diff";
export { compareTexts } from "./prose/diff";
export type { SaveState, SceneSessionOptions } from "./prose/scene-session";
export { SceneSession } from "./prose/scene-session";
export type { Inline, Paragraph } from "./prose/text";
export {
  countWords,
  PROSE_FIELD,
  paragraphsFromState,
  paragraphsToEditorContent,
  plainText,
  readParagraphs,
} from "./prose/text";
export type {
  AiProvider,
  BillingKind,
  Citation,
  Draft,
  GenerateEvent,
  GenerateOutcome,
  GenerateRequest,
  ModelCapabilities,
  ModelInfo,
  ProviderError,
  StructuredOutputMode,
} from "./provider/provider";
export { collectDraft, unsupportedRequest } from "./provider/provider";
export type { SqlDriver, SqlResult, SqlRow, SqlStatement, SqlValue } from "./storage/driver";
export type { Migration, MigrationResult } from "./storage/migrate";
export { DatabaseTooNewError, migrate } from "./storage/migrate";
export { MIGRATIONS } from "./storage/migrations";
export type { OpenedStorage, SqlStorageOptions } from "./storage/sql-storage";
export { createSqlStorage, openSqlStorage } from "./storage/sql-storage";
export type {
  Chapter,
  MoveDirection,
  NewProject,
  NewSnapshot,
  Project,
  Scene,
  SnapshotInfo,
  Storage,
  StoredSceneProse,
  Trash,
} from "./storage/storage";
export { InvalidInputError } from "./storage/storage";
