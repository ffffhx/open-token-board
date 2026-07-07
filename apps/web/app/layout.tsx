import type { Metadata } from "next";

import { I18nProvider } from "@/i18n";
import { zh } from "@/i18n/dictionaries/zh";

import "./globals.css";

const SITE_URL = "https://ffffhx.github.io/open-token-board/";

export const metadata: Metadata = {
  title: zh.common.metadata.homeTitle,
  description: zh.common.metadata.homeDescription,
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    title: zh.common.metadata.homeTitle,
    description: zh.common.metadata.homeOgDescription,
    type: "website",
    url: SITE_URL,
  },
  twitter: {
    card: "summary",
    title: zh.common.metadata.homeTitle,
    description: zh.common.metadata.homeTwitterDescription,
  },
};

// Applies the persisted (or system) theme before first paint to avoid a flash.
const themeScript = `(function(){try{var s=localStorage.getItem('theme');var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;var r=document.documentElement;if(d)r.classList.add('dark');r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a
          href="#main-content"
          className="sr-only fixed left-4 top-4 z-[200] rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-lg focus:not-sr-only"
        >
          跳到主要内容 / Skip to content
        </a>
        <div id="main-content">
          <I18nProvider>{children}</I18nProvider>
        </div>
      </body>
    </html>
  );
}
