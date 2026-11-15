export type { DigestDeps, DigestResult, SceneDigest } from "./analysis/digest";
export {
  digestInstructions,
  digestScene,
  fingerprint,
  summaryBasis,
  ungroundedNames,
  validateDigest,
  withDigest,
} from "./analysis/digest";
export type { AnalysisDeps, SceneAnalysis, SceneToAnalyze } from "./analysis/pipeline";
export { analyzeScene } from "./analysis/pipeline";
export type { AnalysisQueueOptions, QueueRun, QueueStatus } from "./analysis/queue";
export { AnalysisQueue, hashText } from "./analysis/queue";
export type {
  AnalysisState,
  Digest,
  Entity,
  EntitySummary,
  Fact,
  Issue,
  Mention,
  QuoteRef,
  Relation,
  SceneNote,
  ScenePrompt,
} from "./analysis/state";
export { emptyState, liveEntities, withoutScene } from "./analysis/state";
export type {
  CardFact,
  CardIssue,
  CardPrompt,
  CardRelation,
  ChapterCard,
  EntityCard,
  EntityRef,
  NameEntry,
  NovelView,
  Passage,
  RelationCard,
  SceneText,
} from "./cards/cards";
export { buildNovelView, knownNames, withoutStale } from "./cards/cards";
export type { Novel } from "./cards/load";
export { loadNovel, loadNovelView, loadSceneTexts } from "./cards/load";
export type { KnownName, NameMatch } from "./cards/name-finder";
export { createNameFinder } from "./cards/name-finder";
export type { Applied, AuthorOverride, Override } from "./cards/overrides";
export { addOverride, applyOverrides, loadOverrides, parseOverride } from "./cards/overrides";
export type {
  Network,
  NetworkKind,
  NetworkLimits,
  NetworkLink,
  NetworkNode,
} from "./dashboard/network";
export { buildNetwork, EMPTY_NETWORK, NETWORK_LIMITS } from "./dashboard/network";
export { toDocx } from "./export/docx";
export type { Manuscript, ManuscriptChapter } from "./export/manuscript";
export { buildManuscript } from "./export/manuscript";
export { toMarkdown } from "./export/markdown";
export type {
  Hint,
  HintDecision,
  HintLevel,
  HintSettings,
  HintStates,
  HintStep,
  HintType,
  Task,
  TaskInput,
  TaskKind,
} from "./hints/hints";
export {
  buildHints,
  DEFAULT_HINT_SETTINGS,
  dayOf,
  HINT_LEVELS,
  HINT_TYPES,
  hintKey,
  loadHintSettings,
  loadHintStates,
  NO_HINT_STATES,
  nextTask,
  promptKey,
  saveHintSettings,
  TASK_KINDS,
  toHintStates,
} from "./hints/hints";
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
export type { AiConnection, ConnectionRoute, RemoteRoute } from "./provider/connection";
export {
  acceptNotice,
  acceptOpenRouterNotice,
  analysisModels,
  CONNECTION_ROUTES,
  connectionAllowed,
  createConnectionProvider,
  hasAcceptedNotice,
  hasAcceptedOpenRouterNotice,
  loadAiConnection,
  saveAiConnection,
} from "./provider/connection";
export {
  buildDeepSeekBody,
  createDeepSeekProvider,
  parseDeepSeekModels,
} from "./provider/deepseek";
export { buildOllamaBody, createOllamaProvider } from "./provider/ollama";
export {
  buildOpenRouterBody,
  createOpenRouterProvider,
  parseOpenRouterModels,
} from "./provider/openrouter";
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
  Usage,
} from "./provider/provider";
export { collectDraft, unsupportedRequest } from "./provider/provider";
export type { DayUsage, TokenPrices } from "./provider/spending";
export {
  canBePriced,
  costOf,
  isPaidConnection,
  KNOWN_PRICES,
  loadSpendingCap,
  SpendingGuard,
  saveSpendingCap,
  spendingDay,
  usageOn,
} from "./provider/spending";
export type { StructuredFailure, StructuredOptions, Validated } from "./provider/structured";
export { generateStructured, StructuredOutputError } from "./provider/structured";
export type {
  AiTransport,
  ProviderRoute,
  TransportRequest,
  TransportResponse,
} from "./provider/transport";
export { readAll, readLines, readSseData } from "./provider/transport";
export type {
  PendingOutcome,
  PlaceAnswer,
  PlaceView,
  Reality,
  ResearchDeps,
  ResearchItem,
  ResearchTopic,
  ResearchView,
  ResearchViewInput,
  StoredResearch,
  TopicKind,
  TopicStatus,
  TopicView,
} from "./research/research";
export {
  addEraTopic,
  addTopic,
  answerPlace,
  buildResearchView,
  findPlaces,
  isPresentEra,
  loadResearch,
  NO_RESEARCH,
  peopleNames,
  ResearchStoppedError,
  searchPending,
  searchTopic,
} from "./research/research";
export type {
  FoundItem,
  ItemCategory,
  PlaceCandidate,
  ResearchAnswer,
  ResearchRequest,
  ResearchTransport,
} from "./research/sources";
export {
  ITEM_CATEGORIES,
  isSourceUrl,
  parseClimate,
  parseGeocode,
  parseNearby,
  parseWiki,
} from "./research/sources";
export type { TermProblem } from "./research/terms";
export { checkTerm, MAX_TERM_CHARS, requireTerm, TermRefusedError } from "./research/terms";
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
  StoredHintState,
  StoredOverride,
  StoredResearchItem,
  StoredResearchTopic,
  StoredSceneProse,
  StoredUsage,
  Trash,
} from "./storage/storage";
export { InvalidInputError } from "./storage/storage";
