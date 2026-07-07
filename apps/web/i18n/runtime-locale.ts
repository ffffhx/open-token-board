export type Language = "zh" | "en";

export const DEFAULT_LANGUAGE: Language = "zh";
export const LANGUAGE_STORAGE_KEY = "open-token-board:language";

let activeLanguage: Language = DEFAULT_LANGUAGE;

export function isLanguage(value: string | null | undefined): value is Language {
  return value === "zh" || value === "en";
}

export function localeForLanguage(language: Language) {
  return language === "zh" ? "zh-CN" : "en-US";
}

export function htmlLangForLanguage(language: Language) {
  return language === "zh" ? "zh-CN" : "en";
}

export function getActiveLanguage() {
  return activeLanguage;
}

export function getActiveLocale() {
  return localeForLanguage(activeLanguage);
}

export function setActiveLanguage(language: Language) {
  activeLanguage = language;
}

export function detectBrowserLanguage(): Language {
  if (typeof window === "undefined") {
    return DEFAULT_LANGUAGE;
  }

  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(stored)) {
      return stored;
    }
  } catch {
    // Ignore storage failures; fall back to the product default.
  }

  return DEFAULT_LANGUAGE;
}
