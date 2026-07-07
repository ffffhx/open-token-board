"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { dictionaries, type Dictionary } from "./dictionaries";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  detectBrowserLanguage,
  htmlLangForLanguage,
  localeForLanguage,
  setActiveLanguage,
  type Language,
} from "./runtime-locale";

type I18nContextValue = {
  dict: Dictionary;
  language: Language;
  locale: string;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function syncHtmlLanguage(language: Language) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.lang = htmlLangForLanguage(language);
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  useEffect(() => {
    const detected = detectBrowserLanguage();
    setLanguageState(detected);
    setActiveLanguage(detected);
    syncHtmlLanguage(detected);
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const applyLanguage = (nextLanguage: Language) => {
      setLanguageState(nextLanguage);
      setActiveLanguage(nextLanguage);
      syncHtmlLanguage(nextLanguage);
      try {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
      } catch {
        // Ignore storage failures; the in-memory language still updates.
      }
    };

    return {
      dict: dictionaries[language],
      language,
      locale: localeForLanguage(language),
      setLanguage: applyLanguage,
      toggleLanguage: () => applyLanguage(language === "zh" ? "en" : "zh"),
    };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }

  return context;
}

export type { Dictionary, Language };
