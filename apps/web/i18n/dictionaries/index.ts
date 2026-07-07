import { en } from "./en";
import { zh } from "./zh";
import type { Language } from "../runtime-locale";

export const dictionaries = {
  zh,
  en,
};

export type { Dictionary } from "./zh";

export function dictionaryForLanguage(language: Language) {
  return dictionaries[language];
}
