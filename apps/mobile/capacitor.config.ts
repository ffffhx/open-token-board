import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.tokenboard.app",
  appName: "Token 榜",
  webDir: "www",
  server: {
    // 远程模式：壳内直接加载线上排行榜，网站更新后 APP 内容自动更新，无需重装 APK。
    url: "https://ffffhx.github.io/open-token-board/board/",
    // 允许在应用内跳转的域名（GitHub 登录、数据 API）。
    allowNavigation: ["github.com", "*.github.io", "*.anyip.dev"],
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
