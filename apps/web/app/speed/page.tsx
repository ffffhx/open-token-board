import type { Metadata } from "next";

import { AgentSpeedTrends } from "@/components/agent-speed/agent-speed-trends";
import { zh } from "@/i18n/dictionaries/zh";

const DEFAULT_API_URL = "https://124-221-36-36.anyip.dev:8443/token-board";

export const metadata: Metadata = {
  title: zh.common.metadata.speedTitle,
  description: zh.common.metadata.speedDescription,
};

export default function SpeedPage() {
  return (
    <AgentSpeedTrends
      apiBaseUrl={process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL}
      initialNow={new Date().toISOString()}
    />
  );
}
