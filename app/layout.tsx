import type { Metadata } from "next";

import "./globals.css";

const SITE_URL = "https://ffffhx.github.io/open-token-board/";

export const metadata: Metadata = {
  title: "Open Token Board | AI 编码 Token 官网",
  description: "Open Token Board 是面向朋友和团队的 AI 编码 Token 排行榜，支持自动同步、费用估算、模型消耗、工具分布与个人洞察。",
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    title: "Open Token Board | AI 编码 Token 官网",
    description: "自动同步 AI 编码工具用量，公开 Token 排名、趋势、费用估算和效率指标。",
    type: "website",
    url: SITE_URL,
  },
  twitter: {
    card: "summary",
    title: "Open Token Board | AI 编码 Token 官网",
    description: "朋友和团队共享 AI 编码 Token 用量的开源排行榜。",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
