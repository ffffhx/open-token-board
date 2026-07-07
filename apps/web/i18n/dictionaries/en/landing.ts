import type { landing as zhLanding } from "../zh/landing";

export const landing = {
  capabilities: {
    eyebrow: "Token usage, shared clearly",
    title: "Turn AI coding usage into a leaderboard people can discuss",
    description: "Open Token Board is built for small circles that want to see who is coding hardest, which models cost the most, and how well context gets reused.",
    cards: [
      {
        title: "Friendly leaderboard",
        body: "Rank tokens, cost, and sessions across 1D, 7D, 30D, and 90D windows for transparent comparisons in small teams or friend groups.",
        meta: "Rank by tokens, cost, sessions",
        preview: "rank",
      },
      {
        title: "Automatic sync",
        body: "A local agent collects AI coding usage in the background and uploads on a schedule, so nobody has to clean up logs by hand.",
        meta: "macOS LaunchAgent / Windows Task",
        preview: "sync",
      },
      {
        title: "Personal insights",
        body: "After GitHub sign-in, review your models, projects, cache hit rate, active hours, and session details.",
        meta: "GitHub account view",
        preview: "profile",
      },
    ],
  },
  workflow: {
    eyebrow: "3 steps",
    title: "Install, check, refresh the board",
    description: "No manual log wrangling. Run the command locally, wait for the agent to sync, then open `/board/` to see your data.",
    openBoard: "Open board",
    steps: [
      {
        eyebrow: "01",
        title: "Install and authorize",
        body: "Run the install command in the terminal on the machine where you use Codex or Claude Code. The first run guides GitHub authorization and registers the background sync job.",
        commandLabel: "Install command",
      },
      {
        eyebrow: "02",
        title: "Check sync status",
        body: "After installation, run the status command to verify the config file, background task, and latest upload result. The task syncs every 5 minutes by default.",
        commandLabel: "Status command",
      },
      {
        eyebrow: "03",
        title: "Refresh the board",
        body: "Return to the board and refresh, or switch windows to inspect your records. Run the uninstall command later if you no longer want to sync.",
        commandLabel: "Uninstall command",
      },
    ],
  },
  privacy: {
    eyebrow: "Privacy boundary",
    title: "Good for public rankings, not public prompts",
    description: "Token Board shares statistics, not content. The board should show usage, trends, and efficiency, not your full conversations.",
    items: [
      "Shows tokens, models, tools, project basenames, and short session titles only.",
      "Never shows full prompt text or uploads absolute project paths.",
      "Costs are estimated from public model prices and are not your actual bill.",
    ],
  },
  hero: {
    capabilities: "Capabilities",
    privacy: "Privacy",
    eyebrow: "AI coding token arena",
    tagline: "Make AI coding usage a visible ranking race.",
    description: "Sync local tokens automatically, publish trends, efficiency, and leader highlights, without exposing full prompts.",
    cta: "See live board",
    liveSummary: "Live summary",
    connectingTitle: "Board data is connecting",
    connectingBody: "When the summary endpoint is available, this panel will animate site-wide tokens and participants.",
    highlight: "Leaders should not live only in the first table row. Open Token Board lifts highlights, trends, and efficiency into view.",
    sceneSignals: ["Current leader", "Window records", "Top combo"],
    sceneColumns: ["Rank", "User", "Daily usage", "Total usage", "Sessions", "Model"],
  },
  live: {
    total7d: "7-day total tokens",
    rollingTotal: "Site-wide rolling usage",
    participants: "Participants",
    reporting: "Auto reporting",
    leader: "Current leader",
  },
  command: {
    aria: "Copy join command",
    copiedToast: "Join command copied",
    failedToast: "Copy failed. Please copy the command manually.",
  },
} satisfies typeof zhLanding;
