import type { TokenAccountUsageProfile, TokenLeaderboardSummary } from "@open-token-board/core";

export type RemoteStatsResponse =
  | (TokenLeaderboardSummary & { records?: number })
  | {
      records?: number;
      summary?: TokenLeaderboardSummary;
    };

export type AccountUsageResponse = {
  profile?: TokenAccountUsageProfile;
};

export type InstallGuideStep = {
  command?: string;
  commandLabel?: string;
  description: string;
  eyebrow: string;
  note: string;
  title: string;
};

export type InstallGuideUninstall = {
  command: string;
  commandLabel: string;
  description: string;
  note: string;
};

export type InstallGuidePlatform = "macos" | "windows";

export type InstallGuideConfig = {
  description: string;
  label: string;
  steps: InstallGuideStep[];
  uninstall: InstallGuideUninstall;
};

export type ViewerState = {
  authenticated: boolean;
  user?: {
    userId?: string;
    displayName?: string;
    githubLogin?: string;
    avatarUrl?: string;
  };
};

export type DataLoadState = "error" | "loading" | "ready";
export type AccountLoadState = "error" | "idle" | "loading" | "ready";
export type ToastTone = "error" | "success";
export type ToastState = {
  id: number;
  message: string;
  tone: ToastTone;
};
