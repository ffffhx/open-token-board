import type { Metadata } from "next";

import "./globals.css";

const SITE_URL = "https://ffffhx.github.io/open-token-board/";

export const metadata: Metadata = {
  title: "Open Token Board | AI 编码 Token 排行榜",
  description: "朋友间共享 AI 编码工具 token 使用量的排行榜，包含排名、费用估算、模型消耗、工具分布与效率指标。",
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    title: "Open Token Board | AI 编码 Token 排行榜",
    description: "查看朋友间的 AI 编码 Token 排名、费用估算、模型消耗、工具分布与效率指标。",
    type: "website",
    url: SITE_URL,
  },
  twitter: {
    card: "summary",
    title: "Open Token Board | AI 编码 Token 排行榜",
    description: "朋友间共享 AI 编码工具 token 使用量的排行榜。",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
