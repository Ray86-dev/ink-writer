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

  readonly ai: string;
  readonly aiTitle: string;
  readonly aiIntro: string;
  readonly aiCurrentNone: string;
  readonly aiCurrent: (route: string, model: string) => string;
  readonly aiRouteLabel: string;
  readonly aiRouteOff: string;
  readonly aiRouteOllama: string;
  readonly aiRouteOpenrouter: string;
  readonly aiOllamaHint: string;
  readonly aiOllamaUnreachable: string;
  readonly aiOllamaNoModels: string;
  readonly aiOpenrouterNotice: string;
  readonly aiOpenrouterLimits: string;
  readonly aiAcceptNotice: string;
  readonly aiConnect: string;
  readonly aiConnecting: string;
  readonly aiConnected: string;
  readonly aiDisconnect: string;
  readonly aiLoadingModels: string;
  readonly aiModelsFailed: string;
  readonly aiNoModels: string;
  readonly aiRetry: string;
  readonly aiModelLabel: string;
  readonly aiPickModel: string;
  readonly aiConnectErrors: {
    readonly timeout: string;
    readonly listen: string;
    readonly browser: string;
    readonly unreachable: string;
    readonly refused: string;
    readonly store: string;
  };

  readonly cards: string;
  readonly cardsIndex: string;
  readonly cardsBack: string;
  readonly cardsTabs: {
    readonly person: string;
    readonly place: string;
    readonly lore: string;
    readonly relations: string;
    readonly chapters: string;
    readonly names: string;
  };
  readonly cardsTypes: { readonly person: string; readonly place: string; readonly lore: string };
  readonly cardsRelationKind: string;
  readonly cardsChapterKind: string;
  readonly cardsNoneYet: string;
  readonly cardsNone: string;
  readonly cardsAlsoCalled: (names: string) => string;
  readonly cardsWithin: string;
  readonly cardsContains: string;
  readonly cardsWritten: string;
  readonly cardsNoFacts: string;
  readonly cardsOpenPassage: string;
  readonly cardsInDialogue: string;
  readonly cardsDismiss: string;
  readonly cardsDismissFact: (quote: string) => string;
  readonly cardsRelations: string;
  readonly cardsRelationOut: (label: string) => string;
  readonly cardsRelationIn: (label: string) => string;
  readonly cardsOpenIssues: string;
  readonly cardsIssueKinds: {
    readonly contradiction: string;
    readonly name_variant: string;
    readonly correction: string;
  };
  readonly cardsLinkedFrom: string;
  readonly cardsMyNote: string;
  readonly cardsSaveNote: string;
  readonly cardsCorrect: string;
  readonly cardsCorrectHint: string;
  readonly cardsName: string;
  readonly cardsRename: string;
  readonly cardsType: string;
  readonly cardsParent: string;
  readonly cardsNoParent: string;
  readonly cardsMerge: string;
  readonly cardsMergePick: string;
  readonly cardsMergeDo: string;
  readonly cardsMergedWith: (name: string) => string;
  readonly cardsUndoMerge: (name: string) => string;
  readonly cardsSplit: (name: string) => string;
  readonly cardsWasSplit: string;
  readonly cardsUndoSplit: string;
  readonly cardsDismissCard: string;
  readonly cardsScenes: string;
  readonly cardsWho: string;
  readonly cardsWhere: string;
  readonly cardsWhen: string;
  readonly cardsChapterEmpty: string;
  readonly cardsNamesHint: string;
  readonly cardsNameCard: string;
  readonly cardsNameUses: string;
  readonly cardsSimilar: (name: string) => string;
  readonly cardsMergeNames: (from: string, into: string) => string;
  readonly cardsInScene: string;
  readonly cardsPassageGone: string;
  readonly linkHint: string;

  readonly hints: string;
  readonly hintsShortOff: string;
  readonly hintsOpen: string;
  readonly hintsCount: (count: number) => string;
  readonly hintsAsk: string;
  readonly hintsAskAnother: string;
  readonly hintsNone: string;
  readonly hintsOffNote: string;
  readonly hintsSettings: string;
  readonly hintsLevel: string;
  readonly hintLevels: {
    readonly off: string;
    readonly on_demand: string;
    readonly discreet: string;
    readonly companion: string;
  };
  readonly hintLevelNotes: {
    readonly off: string;
    readonly on_demand: string;
    readonly discreet: string;
    readonly companion: string;
  };
  readonly hintsKinds: string;
  readonly hintTypes: {
    readonly coherence: string;
    readonly corrections: string;
    readonly questions: string;
    readonly suggestions: string;
    readonly documentation: string;
  };
  readonly hintVague: { readonly coherence: string; readonly corrections: string };
  readonly hintPointed: (where: string) => string;
  readonly hintGoThere: string;
  readonly hintFix: (quote: string, fix: string) => string;
  readonly hintMore: string;
  readonly hintApply: string;
  readonly hintLeave: string;
  readonly hintFixMyself: string;
  readonly hintIntentional: string;
  readonly hintLater: string;
  readonly companionOpen: string;
  readonly taskTitle: string;
  readonly taskKinds: {
    readonly define: string;
    readonly write: string;
    readonly resolve: string;
    readonly complete: string;
  };
  readonly taskResolve: string;
  readonly taskResolveReason: (here: string, there: string | null) => string;
  readonly taskResolveGo: string;
  readonly taskDefine: (name: string) => string;
  readonly taskDefineReason: (name: string, scenes: number) => string;
  readonly taskDefineGo: string;
  readonly taskComplete: (title: string) => string;
  readonly taskCompleteReason: string;
  readonly taskCompleteGo: string;
  readonly taskNotUseful: string;
  readonly taskQuietToday: string;

  readonly analysisOff: string;
  readonly analysisReady: string;
  readonly analysisWorking: string;
  readonly analysisDone: string;
  readonly analysisSkipped: (count: number) => string;
  readonly analysisWaiting: (pending: number) => string;
  readonly analysisBlocked: (pending: number) => string;
  readonly analysisFailed: (detail: string) => string;
  readonly analysisShort: {
    readonly off: string;
    readonly ready: string;
    readonly working: string;
    readonly done: string;
    readonly waiting: string;
    readonly blocked: string;
    readonly failed: string;
  };
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
    "Aún no hay enlaces en esta escena. Aparecerán aquí cuando la app analice tu texto.",

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

  ai: "IA",
  aiTitle: "Análisis con IA",
  aiIntro:
    "La IA lee lo que escribes para llevar las fichas y avisar de incoherencias. Nunca escribe en tu novela. Tú eliges qué modelo lee, y la app no usa ningún otro.",
  aiCurrentNone: "Ahora no analiza ningún modelo.",
  aiCurrent: (route, model) => `Ahora analiza: ${route}, ${model}.`,
  aiRouteLabel: "Quién analiza",
  aiRouteOff: "Nadie",
  aiRouteOllama: "Ollama, en este equipo",
  aiRouteOpenrouter: "OpenRouter, modelos gratuitos",
  aiOllamaHint:
    "Tu texto no sale de este equipo. Hace falta un modelo mediano: los muy pequeños pasan por alto incoherencias.",
  aiOllamaUnreachable: "No encuentro Ollama en este equipo. Comprueba que está en marcha.",
  aiOllamaNoModels: "Ollama no tiene ningún modelo descargado.",
  aiOpenrouterNotice:
    "Con OpenRouter, el texto de cada escena sale de tu equipo y llega a un tercero. Algunos proveedores de modelos gratuitos pueden guardar lo que reciben o usarlo para entrenar. Con Ollama, el texto no sale.",
  aiOpenrouterLimits:
    "Solo se ofrecen modelos gratuitos, así que no se gasta nada. El cupo gratuito da para unas 9 escenas al día; el resto espera en la cola.",
  aiAcceptNotice: "Lo entiendo, quiero usar OpenRouter",
  aiConnect: "Conectar con OpenRouter",
  aiConnecting: "Se ha abierto tu navegador. Esperando a que autorices…",
  aiConnected: "OpenRouter está conectado.",
  aiDisconnect: "Desconectar",
  aiLoadingModels: "Buscando modelos…",
  aiModelsFailed: "No se pudo obtener la lista de modelos.",
  aiNoModels: "Ahora mismo no hay ningún modelo gratuito que sirva para el análisis.",
  aiRetry: "Reintentar",
  aiModelLabel: "Modelo",
  aiPickModel: "Elige un modelo",
  aiConnectErrors: {
    timeout: "No llegó ninguna respuesta del navegador en 5 minutos. Inténtalo de nuevo.",
    listen: "No se pudo preparar la conexión en este equipo.",
    browser: "No se pudo abrir el navegador.",
    unreachable: "No hay conexión con OpenRouter. Comprueba tu conexión a internet.",
    refused: "OpenRouter no aceptó la conexión. Inténtalo de nuevo.",
    store: "No se pudo guardar la clave en este equipo, así que no se ha conectado.",
  },

  cards: "Fichas",
  cardsIndex: "Índice de fichas",
  cardsBack: "Volver al texto",
  cardsTabs: {
    person: "Personajes",
    place: "Lugares",
    lore: "Lore",
    relations: "Relaciones",
    chapters: "Capítulos",
    names: "Nombres",
  },
  cardsTypes: { person: "Personaje", place: "Lugar", lore: "Lore" },
  cardsRelationKind: "Relación",
  cardsChapterKind: "Capítulo",
  cardsNoneYet:
    "Aún no hay fichas. Se crean solas cuando la IA lee tu texto: elige quién analiza en «IA».",
  cardsNone: "No hay ninguna ficha de este tipo.",
  cardsAlsoCalled: (names) => `También: ${names}`,
  cardsWithin: "Está en:",
  cardsContains: "Contiene:",
  cardsWritten: "Lo que has escrito",
  cardsNoFacts: "El texto la nombra, pero todavía no dice nada de ella.",
  cardsOpenPassage: "Ir a este pasaje en el texto",
  cardsInDialogue: "Lo dice un personaje",
  cardsDismiss: "No es correcto",
  cardsDismissFact: (quote) => `Quitar de la ficha: ${quote}`,
  cardsRelations: "Relaciones",
  cardsRelationOut: (label) => `${label}:`,
  cardsRelationIn: (label) => `${label}, según:`,
  cardsOpenIssues: "Por resolver",
  cardsIssueKinds: {
    contradiction: "Posible contradicción",
    name_variant: "Nombres parecidos",
    correction: "Posible errata",
  },
  cardsLinkedFrom: "Enlazan aquí",
  cardsMyNote: "Mi nota",
  cardsSaveNote: "Guardar nota",
  cardsCorrect: "Corregir la ficha",
  cardsCorrectHint: "Lo que cambies aquí se mantiene aunque la IA vuelva a leer el texto.",
  cardsName: "Nombre",
  cardsRename: "Cambiar nombre",
  cardsType: "Tipo",
  cardsParent: "Está dentro de",
  cardsNoParent: "Ningún otro lugar",
  cardsMerge: "Es lo mismo que",
  cardsMergePick: "Elige una ficha",
  cardsMergeDo: "Fusionar",
  cardsMergedWith: (name) => `Fusionada con «${name}».`,
  cardsUndoMerge: (name) => `Deshacer la fusión con ${name}`,
  cardsSplit: (name) => `Separar «${name}» en su propia ficha`,
  cardsWasSplit: "Separaste esta ficha de otra.",
  cardsUndoSplit: "Deshacer la separación",
  cardsDismissCard: "Esta ficha no es correcta: quitarla",
  cardsScenes: "Escenas",
  cardsWho: "Quién aparece",
  cardsWhere: "Dónde",
  cardsWhen: "Cuándo",
  cardsChapterEmpty: "Todavía no hay datos de este capítulo.",
  cardsNamesHint:
    "Todos los nombres propios de la novela. Sirve para ver si un mismo nombre está escrito de dos formas.",
  cardsNameCard: "Ficha",
  cardsNameUses: "Veces",
  cardsSimilar: (name) => `Se parece a «${name}».`,
  cardsMergeNames: (from, into) => `Fusionar ${from} con ${into}`,
  cardsInScene: "Fichas de esta escena",
  cardsPassageGone: "Ese pasaje ya no está en el texto.",
  linkHint: "Ctrl o Cmd y clic en un nombre subrayado abre su ficha.",

  hints: "Pistas",
  hintsShortOff: "apagadas",
  hintsOpen: "Por revisar",
  hintsCount: (count) =>
    count === 0
      ? "No hay nada por revisar."
      : count === 1
        ? "Hay 1 pista."
        : `Hay ${count} pistas.`,
  hintsAsk: "Dame una pista",
  hintsAskAnother: "Dame otra",
  hintsNone: "No hay nada por revisar.",
  hintsOffNote:
    "Las pistas están apagadas: no hay tareas ni marcas. Las fichas se siguen actualizando.",
  hintsSettings: "Cuánta ayuda quieres",
  hintsLevel: "Nivel",
  hintLevels: {
    off: "Apagadas",
    on_demand: "Si las pido",
    discreet: "Discretas",
    companion: "Compañera",
  },
  hintLevelNotes: {
    off: "Sin tareas ni marcas.",
    on_demand: "Solo cuando pulses «Dame una pista».",
    discreet: "Subrayados al leer y un contador.",
    companion: "Una gota de tinta te propone la pista al leer.",
  },
  hintsKinds: "Tipos de pista",
  hintTypes: {
    coherence: "Coherencia",
    corrections: "Correcciones",
    questions: "Preguntas",
    suggestions: "Sugerencias",
    documentation: "Documentación",
  },
  hintVague: {
    coherence: "Algo no encaja aquí.",
    corrections: "Hay algo que revisar en cómo está escrito esto.",
  },
  hintPointed: (where) => `Compáralo con ${where}.`,
  hintGoThere: "Ir al pasaje",
  hintFix: (quote, fix) => `«${quote}» pasaría a ser «${fix}».`,
  hintMore: "Dame otra pista",
  hintApply: "Aplicar",
  hintLeave: "Déjalo así",
  hintFixMyself: "Lo corrijo yo",
  hintIntentional: "Es intencionado",
  hintLater: "Ahora no",
  companionOpen: "Ver la pista",
  taskTitle: "Siguiente paso",
  taskKinds: { define: "Definir", write: "Escribir", resolve: "Resolver", complete: "Completar" },
  taskResolve: "Hay dos pasajes que no encajan entre sí.",
  taskResolveReason: (here, there) =>
    there === null
      ? `Te lo propongo porque en ${here} hay algo por resolver.`
      : `Te lo propongo porque ${there} y ${here} dicen cosas distintas.`,
  taskResolveGo: "Ir al pasaje",
  taskDefine: (name) => `¿Quién o qué es ${name}?`,
  taskDefineReason: (name, scenes) =>
    `Te lo propongo porque ${name} aparece en ${scenes} escenas y el texto aún no dice nada concreto.`,
  taskDefineGo: "Abrir su ficha",
  taskComplete: (title) => `La escena «${title}» está vacía.`,
  taskCompleteReason: "Te lo propongo porque hay escenas escritas después de ella.",
  taskCompleteGo: "Ir a la escena",
  taskNotUseful: "Esta no me sirve",
  taskQuietToday: "Hoy solo quiero escribir",

  analysisOff: "El análisis está apagado.",
  analysisReady: "Leerá lo nuevo cuando hagas una pausa.",
  analysisWorking: "Analizando…",
  analysisDone: "Todo lo escrito está analizado.",
  analysisSkipped: (count) =>
    count === 1
      ? "El modelo no dio una respuesta útil para 1 escena. Se volverá a intentar cuando cambie."
      : `El modelo no dio una respuesta útil para ${count} escenas. Se volverá a intentar cuando cambien.`,
  analysisWaiting: (pending) =>
    `No se puede hablar con el modelo ahora. ${pending === 1 ? "Queda 1 escena" : `Quedan ${pending} escenas`} en cola y se reintenta solo.`,
  analysisBlocked: (pending) =>
    `El servicio rechazó la petición y el análisis está detenido. ${pending === 1 ? "Queda 1 escena" : `Quedan ${pending} escenas`} en cola. Revisa la conexión o elige otro modelo.`,
  analysisFailed: (detail) => `El análisis falló: ${detail}`,
  analysisShort: {
    off: "apagada",
    ready: "activa",
    working: "analizando",
    done: "al día",
    waiting: "en espera",
    blocked: "detenida",
    failed: "con un fallo",
  },
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
  readingPanelEmpty:
    "No links in this scene yet. They'll appear here once the app analyzes your text.",

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

  ai: "AI",
  aiTitle: "AI analysis",
  aiIntro:
    "The AI reads what you write to keep the story's records and point out inconsistencies. It never writes in your novel. You choose which model reads, and the app uses no other.",
  aiCurrentNone: "No model is analyzing now.",
  aiCurrent: (route, model) => `Analyzing now: ${route}, ${model}.`,
  aiRouteLabel: "Who analyzes",
  aiRouteOff: "Nobody",
  aiRouteOllama: "Ollama, on this computer",
  aiRouteOpenrouter: "OpenRouter, free models",
  aiOllamaHint:
    "Your text doesn't leave this computer. It takes a mid-sized model: very small ones miss inconsistencies.",
  aiOllamaUnreachable: "Ollama can't be found on this computer. Check that it's running.",
  aiOllamaNoModels: "Ollama has no models downloaded.",
  aiOpenrouterNotice:
    "With OpenRouter, the text of each scene leaves your computer and reaches a third party. Some providers of free models may keep what they receive or use it for training. With Ollama, the text doesn't leave.",
  aiOpenrouterLimits:
    "Only free models are offered, so nothing is spent. The free allowance covers about 9 scenes a day; the rest waits in the queue.",
  aiAcceptNotice: "I understand, I want to use OpenRouter",
  aiConnect: "Connect OpenRouter",
  aiConnecting: "Your browser has opened. Waiting for you to authorize…",
  aiConnected: "OpenRouter is connected.",
  aiDisconnect: "Disconnect",
  aiLoadingModels: "Looking for models…",
  aiModelsFailed: "The list of models couldn't be fetched.",
  aiNoModels: "Right now there's no free model that works for the analysis.",
  aiRetry: "Retry",
  aiModelLabel: "Model",
  aiPickModel: "Choose a model",
  aiConnectErrors: {
    timeout: "No answer came back from the browser in 5 minutes. Try again.",
    listen: "The connection couldn't be set up on this computer.",
    browser: "The browser couldn't be opened.",
    unreachable: "OpenRouter can't be reached. Check your internet connection.",
    refused: "OpenRouter didn't accept the connection. Try again.",
    store: "The key couldn't be saved on this computer, so it isn't connected.",
  },

  cards: "Cards",
  cardsIndex: "Index of cards",
  cardsBack: "Back to the text",
  cardsTabs: {
    person: "Characters",
    place: "Places",
    lore: "Lore",
    relations: "Relationships",
    chapters: "Chapters",
    names: "Names",
  },
  cardsTypes: { person: "Character", place: "Place", lore: "Lore" },
  cardsRelationKind: "Relationship",
  cardsChapterKind: "Chapter",
  cardsNoneYet:
    "There are no cards yet. They're made by themselves when the AI reads your text: choose who analyzes under “AI”.",
  cardsNone: "There are no cards of this kind.",
  cardsAlsoCalled: (names) => `Also: ${names}`,
  cardsWithin: "It's in:",
  cardsContains: "Contains:",
  cardsWritten: "What you've written",
  cardsNoFacts: "The text names it, but doesn't say anything about it yet.",
  cardsOpenPassage: "Go to this passage in the text",
  cardsInDialogue: "Said by a character",
  cardsDismiss: "Not right",
  cardsDismissFact: (quote) => `Remove from the card: ${quote}`,
  cardsRelations: "Relationships",
  cardsRelationOut: (label) => `${label}:`,
  cardsRelationIn: (label) => `${label}, according to:`,
  cardsOpenIssues: "To resolve",
  cardsIssueKinds: {
    contradiction: "Possible contradiction",
    name_variant: "Similar names",
    correction: "Possible typo",
  },
  cardsLinkedFrom: "Linked from",
  cardsMyNote: "My note",
  cardsSaveNote: "Save note",
  cardsCorrect: "Correct the card",
  cardsCorrectHint: "What you change here stays even when the AI reads the text again.",
  cardsName: "Name",
  cardsRename: "Rename",
  cardsType: "Kind",
  cardsParent: "It's inside",
  cardsNoParent: "No other place",
  cardsMerge: "It's the same as",
  cardsMergePick: "Choose a card",
  cardsMergeDo: "Merge",
  cardsMergedWith: (name) => `Merged with “${name}”.`,
  cardsUndoMerge: (name) => `Undo the merge with ${name}`,
  cardsSplit: (name) => `Split “${name}” into its own card`,
  cardsWasSplit: "You split this card off another.",
  cardsUndoSplit: "Undo the split",
  cardsDismissCard: "This card isn't right: remove it",
  cardsScenes: "Scenes",
  cardsWho: "Who appears",
  cardsWhere: "Where",
  cardsWhen: "When",
  cardsChapterEmpty: "There's no data about this chapter yet.",
  cardsNamesHint:
    "Every proper name in the novel. It helps to see whether one name is written in two ways.",
  cardsNameCard: "Card",
  cardsNameUses: "Uses",
  cardsSimilar: (name) => `It looks like “${name}”.`,
  cardsMergeNames: (from, into) => `Merge ${from} with ${into}`,
  cardsInScene: "Cards of this scene",
  cardsPassageGone: "That passage is no longer in the text.",
  linkHint: "Ctrl or Cmd and click on an underlined name opens its card.",

  hints: "Hints",
  hintsShortOff: "off",
  hintsOpen: "To review",
  hintsCount: (count) =>
    count === 0
      ? "There's nothing to review."
      : count === 1
        ? "There's 1 hint."
        : `There are ${count} hints.`,
  hintsAsk: "Give me a hint",
  hintsAskAnother: "Give me another",
  hintsNone: "There's nothing to review.",
  hintsOffNote: "Hints are off: no tasks and no marks. The cards keep being updated.",
  hintsSettings: "How much help you want",
  hintsLevel: "Level",
  hintLevels: {
    off: "Off",
    on_demand: "If I ask",
    discreet: "Discreet",
    companion: "Companion",
  },
  hintLevelNotes: {
    off: "No tasks and no marks.",
    on_demand: "Only when you press “Give me a hint”.",
    discreet: "Underlines when reading, and a counter.",
    companion: "A drop of ink offers you the hint when reading.",
  },
  hintsKinds: "Kinds of hint",
  hintTypes: {
    coherence: "Consistency",
    corrections: "Corrections",
    questions: "Questions",
    suggestions: "Suggestions",
    documentation: "Research",
  },
  hintVague: {
    coherence: "Something doesn't fit here.",
    corrections: "There's something to check in how this is written.",
  },
  hintPointed: (where) => `Compare it with ${where}.`,
  hintGoThere: "Go to the passage",
  hintFix: (quote, fix) => `“${quote}” would become “${fix}”.`,
  hintMore: "Give me another hint",
  hintApply: "Apply",
  hintLeave: "Leave it as it is",
  hintFixMyself: "I'll fix it myself",
  hintIntentional: "It's intentional",
  hintLater: "Not now",
  companionOpen: "See the hint",
  taskTitle: "Next step",
  taskKinds: { define: "Define", write: "Write", resolve: "Resolve", complete: "Complete" },
  taskResolve: "Two passages don't fit together.",
  taskResolveReason: (here, there) =>
    there === null
      ? `I'm suggesting it because there's something to resolve in ${here}.`
      : `I'm suggesting it because ${there} and ${here} say different things.`,
  taskResolveGo: "Go to the passage",
  taskDefine: (name) => `Who or what is ${name}?`,
  taskDefineReason: (name, scenes) =>
    `I'm suggesting it because ${name} appears in ${scenes} scenes and the text doesn't say anything specific yet.`,
  taskDefineGo: "Open its card",
  taskComplete: (title) => `The scene “${title}” is empty.`,
  taskCompleteReason: "I'm suggesting it because there are scenes written after it.",
  taskCompleteGo: "Go to the scene",
  taskNotUseful: "This one isn't useful",
  taskQuietToday: "Today I only want to write",

  analysisOff: "The analysis is off.",
  analysisReady: "It'll read what's new when you pause.",
  analysisWorking: "Analyzing…",
  analysisDone: "Everything written has been analyzed.",
  analysisSkipped: (count) =>
    count === 1
      ? "The model gave no usable answer for 1 scene. It'll be tried again when it changes."
      : `The model gave no usable answer for ${count} scenes. They'll be tried again when they change.`,
  analysisWaiting: (pending) =>
    `The model can't be reached right now. ${pending === 1 ? "1 scene is" : `${pending} scenes are`} queued and it retries by itself.`,
  analysisBlocked: (pending) =>
    `The service refused the request and the analysis has stopped. ${pending === 1 ? "1 scene is" : `${pending} scenes are`} queued. Check the connection or choose another model.`,
  analysisFailed: (detail) => `The analysis failed: ${detail}`,
  analysisShort: {
    off: "off",
    ready: "on",
    working: "analyzing",
    done: "up to date",
    waiting: "waiting",
    blocked: "stopped",
    failed: "failed",
  },
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

/**
 * Why connecting OpenRouter didn't work, from the word the shell's error starts with. Null if the
 * author cancelled, which needs no explaining.
 */
export function describeConnectError(error: unknown, messages: Messages): string | null {
  const detail = describe(error);
  const kind = detail.split(":")[0]?.trim() ?? "";
  if (kind === "cancelled") {
    return null;
  }
  const known = messages.aiConnectErrors as Readonly<Record<string, string>>;
  return Object.hasOwn(known, kind) ? (known[kind] ?? detail) : detail;
}

export function describeError(error: unknown): string {
  return describe(error);
}
