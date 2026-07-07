"use client";

import { useI18n } from "@/i18n";

const DEFAULT_TONE =
  "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:text-blue-700";

export function LanguageToggle({ className }: { className?: string }) {
  const { dict, language, toggleLanguage } = useI18n();
  const nextLabel = language === "zh" ? dict.common.language.enName : dict.common.language.zhName;

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      aria-label={`${dict.common.language.toggleLabel}: ${nextLabel}`}
      title={`${dict.common.language.toggleLabel}: ${nextLabel}`}
      className={[
        "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-2.5 font-mono text-xs font-black transition hover:-translate-y-0.5 hover:shadow-sm",
        className ?? DEFAULT_TONE,
      ].join(" ")}
    >
      {language === "zh" ? dict.common.language.zhShort : dict.common.language.enShort}
    </button>
  );
}
