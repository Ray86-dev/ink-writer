import { DatabaseTooNewError } from "@ink-writer/core";

export interface Messages {
  readonly ready: string;
  readonly tooNew: string;
  readonly failed: (detail: string) => string;
}

const es: Messages = {
  ready: "Todo listo. El editor llegará en el próximo hito.",
  tooNew:
    "Tus datos son de una versión más reciente de Ink Writer. Actualiza la aplicación. Tus datos no se han tocado.",
  failed: (detail) => `No se pudo abrir la base de datos: ${detail}`,
};

const en: Messages = {
  ready: "All set. The editor comes in the next milestone.",
  tooNew:
    "Your data comes from a newer version of Ink Writer. Update the app. Your data hasn't been touched.",
  failed: (detail) => `The database couldn't be opened: ${detail}`,
};

export type Locale = "es" | "en";

/** Spanish and English from the start (SPEC §10). Anything else falls back to English. */
export function pickLocale(language: string): Locale {
  return language.toLowerCase().startsWith("es") ? "es" : "en";
}

export const MESSAGES: Readonly<Record<Locale, Messages>> = { es, en };

export function describeStartupError(error: unknown, messages: Messages): string {
  if (error instanceof DatabaseTooNewError) {
    return messages.tooNew;
  }
  return messages.failed(error instanceof Error ? error.message : String(error));
}
