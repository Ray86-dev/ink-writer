import { createContext, useContext } from "react";
import { type Locale, MESSAGES, type Messages } from "./messages";

interface Language {
  readonly locale: Locale;
  readonly messages: Messages;
}

export const LanguageContext = createContext<Language>({ locale: "es", messages: MESSAGES.es });

export function useLanguage(): Language {
  return useContext(LanguageContext);
}
