import { DatabaseTooNewError } from "@ink-writer/core";

export interface Messages {
  readonly tooNew: string;
  readonly alreadyOpen: string;
  readonly failed: (detail: string) => string;
  readonly loading: string;

  readonly novels: string;
  readonly noNovels: string;
  readonly newNovel: string;
  readonly title: string;
  readonly language: string;
  readonly languageNames: Readonly<Record<string, string>>;
  readonly era: string;
  readonly eraHint: string;
  readonly create: string;
  readonly firstChapter: string;
  readonly firstScene: string;
  readonly fieldRequired: string;

  readonly noScene: string;
  readonly proseLabel: string;
  readonly modesLabel: string;
  readonly modes: { readonly write: string; readonly live: string; readonly read: string };
  readonly readingPanelTitle: string;
  readonly readingPanelEmpty: string;

  readonly saving: string;
  readonly saved: string;
  readonly saveFailing: (detail: string) => string;

  readonly structure: string;
  readonly closePanel: string;
  readonly addChapter: string;
  readonly addScene: string;
  readonly newChapterTitle: (number: number) => string;
  readonly newSceneTitle: (number: number) => string;
  readonly rename: (name: string) => string;
  readonly nameLabel: string;
  readonly saveName: string;
  readonly cancel: string;
  readonly moveUp: (name: string) => string;
  readonly moveDown: (name: string) => string;
  readonly moveToTrash: (name: string) => string;
  readonly trash: string;
  readonly trashEmpty: string;
  readonly restore: (name: string) => string;
  readonly chapterInTrash: string;
  readonly sceneInTrash: string;

  readonly history: string;
  readonly saveVersion: string;
  readonly versionName: string;
  readonly noVersions: string;
  readonly automaticVersion: string;
  readonly words: (count: number) => string;
  readonly compare: (when: string) => string;
  readonly comparing: (when: string) => string;
  readonly identical: string;
  readonly tooDifferent: string;
  readonly onlyInVersion: string;
  readonly onlyInCurrent: string;
  readonly restoreVersion: string;
  readonly restored: string;
  readonly beforeRestore: string;

  readonly export: string;
  readonly exportWord: string;
  readonly exportMarkdown: string;
  readonly exported: string;
  readonly exportFailed: (detail: string) => string;

  readonly closeBlockedTitle: string;
  readonly closeBlockedBody: string;
  readonly keepTrying: string;
  readonly closeAnyway: string;
}

const es: Messages = {
  tooNew:
    "Tus datos son de una versión más reciente de Ink Writer. Actualiza la aplicación. Tus datos no se han tocado.",
  alreadyOpen:
    "Ink Writer ya está abierto en otra ventana. Ciérrala antes de abrir otra, para no editar lo mismo dos veces.",
  failed: (detail) => `No se pudo abrir la base de datos: ${detail}`,
  loading: "Abriendo…",

  novels: "Tus novelas",
  noNovels: "Todavía no hay ninguna novela.",
  newNovel: "Nueva novela",
  title: "Título",
  language: "Idioma",
  languageNames: { es: "Español", en: "Inglés" },
  era: "Época de la historia",
  eraHint: "Por ejemplo: actualidad, años cincuenta",
  create: "Crear novela",
  firstChapter: "Capítulo 1",
  firstScene: "Escena 1",
  fieldRequired: "Este campo es obligatorio.",

  noScene: "No hay ninguna escena. Añade una en «Capítulos y escenas».",
  proseLabel: "Texto de la escena",
  modesLabel: "Modo del editor",
  modes: { write: "Escribir", live: "Escribir con enlaces", read: "Ver enlaces y pistas" },
  readingPanelTitle: "Enlaces y pistas",
  readingPanelEmpty:
    "Aún no hay enlaces ni pistas. Aparecerán aquí cuando la app analice tu texto.",

  saving: "Guardando…",
  saved: "Guardado",
  saveFailing: (detail) =>
    `No se está pudiendo guardar. Tu texto sigue aquí y se reintenta sin parar, pero no cierres la app. Motivo: ${detail}`,

  structure: "Capítulos y escenas",
  closePanel: "Cerrar panel",
  addChapter: "Añadir capítulo",
  addScene: "Añadir escena",
  newChapterTitle: (number) => `Capítulo ${number}`,
  newSceneTitle: (number) => `Escena ${number}`,
  rename: (name) => `Cambiar el nombre de ${name}`,
  nameLabel: "Nombre",
  saveName: "Guardar",
  cancel: "Cancelar",
  moveUp: (name) => `Subir ${name}`,
  moveDown: (name) => `Bajar ${name}`,
  moveToTrash: (name) => `Mover ${name} a la papelera`,
  trash: "Papelera",
  trashEmpty: "La papelera está vacía.",
  restore: (name) => `Recuperar ${name}`,
  chapterInTrash: "Capítulo",
  sceneInTrash: "Escena",

  history: "Historial",
  saveVersion: "Guardar versión",
  versionName: "Nombre de la versión (opcional)",
  noVersions: "Aún no hay versiones de esta escena.",
  automaticVersion: "Automática",
  words: (count) => `${count.toLocaleString("es")} ${count === 1 ? "palabra" : "palabras"}`,
  compare: (when) => `Comparar la versión de ${when}`,
  comparing: (when) => `Comparando con la versión de ${when}`,
  identical: "Esta versión es igual al texto actual.",
  tooDifferent: "Estos textos son demasiado distintos para compararlos.",
  onlyInVersion: "Solo en esa versión",
  onlyInCurrent: "Solo en el texto actual",
  restoreVersion: "Recuperar esta versión",
  restored: "Versión recuperada. El texto anterior queda guardado en el historial.",
  beforeRestore: "Antes de recuperar",

  export: "Exportar",
  exportWord: "Exportar a Word",
  exportMarkdown: "Exportar a Markdown",
  exported: "Novela exportada.",
  exportFailed: (detail) => `No se pudo exportar: ${detail}`,

  closeBlockedTitle: "Hay texto sin guardar",
  closeBlockedBody:
    "No se está pudiendo guardar. Si cierras ahora, perderás lo último que has escrito.",
  keepTrying: "Seguir intentándolo",
  closeAnyway: "Cerrar y perderlo",
};

const en: Messages = {
  tooNew:
    "Your data comes from a newer version of Ink Writer. Update the app. Your data hasn't been touched.",
  alreadyOpen:
    "Ink Writer is already open in another window. Close it before opening another, so nothing gets edited twice.",
  failed: (detail) => `The database couldn't be opened: ${detail}`,
  loading: "Opening…",

  novels: "Your novels",
  noNovels: "There are no novels yet.",
  newNovel: "New novel",
  title: "Title",
  language: "Language",
  languageNames: { es: "Spanish", en: "English" },
  era: "When the story takes place",
  eraHint: "For example: present day, the 1950s",
  create: "Create novel",
  firstChapter: "Chapter 1",
  firstScene: "Scene 1",
  fieldRequired: "This field is required.",

  noScene: "There are no scenes. Add one under “Chapters and scenes”.",
  proseLabel: "Scene text",
  modesLabel: "Editor mode",
  modes: { write: "Write", live: "Write with links", read: "View links and hints" },
  readingPanelTitle: "Links and hints",
  readingPanelEmpty: "No links or hints yet. They'll appear here once the app analyzes your text.",

  saving: "Saving…",
  saved: "Saved",
  saveFailing: (detail) =>
    `Saving isn't working. Your text is still here and it keeps retrying, but don't close the app. Reason: ${detail}`,

  structure: "Chapters and scenes",
  closePanel: "Close panel",
  addChapter: "Add chapter",
  addScene: "Add scene",
  newChapterTitle: (number) => `Chapter ${number}`,
  newSceneTitle: (number) => `Scene ${number}`,
  rename: (name) => `Rename ${name}`,
  nameLabel: "Name",
  saveName: "Save",
  cancel: "Cancel",
  moveUp: (name) => `Move ${name} up`,
  moveDown: (name) => `Move ${name} down`,
  moveToTrash: (name) => `Move ${name} to the trash`,
  trash: "Trash",
  trashEmpty: "The trash is empty.",
  restore: (name) => `Restore ${name}`,
  chapterInTrash: "Chapter",
  sceneInTrash: "Scene",

  history: "History",
  saveVersion: "Save version",
  versionName: "Version name (optional)",
  noVersions: "This scene has no versions yet.",
  automaticVersion: "Automatic",
  words: (count) => `${count.toLocaleString("en")} ${count === 1 ? "word" : "words"}`,
  compare: (when) => `Compare the version from ${when}`,
  comparing: (when) => `Comparing with the version from ${when}`,
  identical: "This version is the same as the current text.",
  tooDifferent: "These texts are too different to compare.",
  onlyInVersion: "Only in that version",
  onlyInCurrent: "Only in the current text",
  restoreVersion: "Restore this version",
  restored: "Version restored. The previous text stays saved in the history.",
  beforeRestore: "Before restoring",

  export: "Export",
  exportWord: "Export to Word",
  exportMarkdown: "Export to Markdown",
  exported: "Novel exported.",
  exportFailed: (detail) => `The export failed: ${detail}`,

  closeBlockedTitle: "There's unsaved text",
  closeBlockedBody: "Saving isn't working. If you close now, you'll lose the last thing you wrote.",
  keepTrying: "Keep trying",
  closeAnyway: "Close and lose it",
};

export type Locale = "es" | "en";

/** Spanish and English from the start (SPEC §10). Anything else falls back to English. */
export function pickLocale(language: string): Locale {
  return language.toLowerCase().startsWith("es") ? "es" : "en";
}

export const MESSAGES: Readonly<Record<Locale, Messages>> = { es, en };

/** What the shell reports when another process holds the database. */
const ALREADY_OPEN = "already_open";

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function describeStartupError(error: unknown, messages: Messages): string {
  if (error instanceof DatabaseTooNewError) {
    return messages.tooNew;
  }
  const detail = describe(error);
  return detail === ALREADY_OPEN ? messages.alreadyOpen : messages.failed(detail);
}

export function describeError(error: unknown): string {
  return describe(error);
}
