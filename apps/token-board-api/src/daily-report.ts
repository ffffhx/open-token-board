import { createHmac } from "node:crypto";

import type { TokenLeaderboardSummary } from "@open-token-board/core";

/**
 * Daily leaderboard digest pushed to a Feishu (Lark) custom-bot webhook.
 *
 * Pure data in, an interactive card out — no headless browser, no app
 * credentials. Everything here is side-effect free except `sendFeishuCard`,
 * which performs the single outbound POST.
 */

export type DailyReportConfig = {
  webhookUrl: string;
  /** Optional "签名校验" secret configured on the custom bot. */
  secret?: string;
  /** Minutes east of UTC used to render date labels (e.g. 480 for UTC+8). */
  tzOffsetMinutes: number;
  /** Public site URL linked in the card footer. */
  siteUrl?: string;
  timeoutMs?: number;
};

const RANGE_LABEL: Record<string, string> = {
  "1D": "近 24 小时",
  "7D": "本周",
  "30D": "近 30 天",
  "90D": "近 90 天",
};

const MEDALS = ["🥇", "🥈", "🥉"];

export function formatCompact(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

export function formatUsd(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

/** Render a YYYY-MM-DD(...) ISO instant as `M/D` in the configured timezone. */
export function formatDateLabel(iso: string, tzOffsetMinutes: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const local = new Date(ms + tzOffsetMinutes * 60_000);
  return `${local.getUTCMonth() + 1}/${local.getUTCDate()}`;
}

function pct(share: number): string {
  return `${Math.round((Number.isFinite(share) ? share : 0) * 100)}%`;
}

/** Build the Feishu interactive-card payload for a whole-board daily digest. */
export function buildDailyReportCard(
  summary: TokenLeaderboardSummary,
  options: { tzOffsetMinutes: number; siteUrl?: string },
): Record<string, unknown> {
  const { tzOffsetMinutes, siteUrl } = options;
  const rangeLabel = RANGE_LABEL[summary.range] ?? summary.range;
  const start = formatDateLabel(summary.startAt, tzOffsetMinutes);
  const end = formatDateLabel(summary.endAt, tzOffsetMinutes);
  const dateRange = start && end ? (start === end ? end : `${start}–${end}`) : "";

  const MAX_DETAIL = 10;
  const detailUsers = summary.users.slice(0, MAX_DETAIL);
  const detailLines = detailUsers.length
    ? detailUsers
        .map((user, index) => {
          const medal = MEDALS[index] ?? `#${user.rank}`;
          const head = `${medal} **${escapeMd(user.displayName)}** · ${formatCompact(user.tokens)} tokens (${pct(user.share)})`;
          const model = user.topModel ? escapeMd(user.topModel) : "—";
          const tool = user.topTool ? ` / ${escapeMd(user.topTool)}` : "";
          // Per-user detail line: cost · sessions · top model/tool.
          const sub = `　└ ${formatUsd(user.costUsd)} · ${formatCompact(user.sessions)} 会话 · ${model}${tool}`;
          return `${head}\n${sub}`;
        })
        .join("\n")
    : "_今日暂无上榜数据_";
  const restCount = summary.users.length - detailUsers.length;
  const detailFooter = restCount > 0 ? `\n_…等共 ${summary.users.length} 位选手_` : "";

  const elements: Array<Record<string, unknown>> = [
    {
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**${rangeLabel}**${dateRange ? ` · ${dateRange}` : ""} · 共 **${summary.activeUsers}** 位选手`,
      },
    },
    {
      tag: "div",
      fields: [
        shortField("📦 总消耗", `${formatCompact(summary.totalTokens)} tokens`),
        shortField("💰 估算成本", formatUsd(summary.totalCostUsd)),
        shortField("💬 总会话", formatCompact(summary.totalSessions)),
        shortField("🤖 主力模型", summary.topModel || "—"),
      ],
    },
    { tag: "hr" },
    { tag: "div", text: { tag: "lark_md", content: `🏆 **排行榜 · 个人明细**\n${detailLines}${detailFooter}` } },
  ];

  if (summary.topModel || summary.topTool) {
    const bits: string[] = [];
    if (summary.topModel) bits.push(`主力模型 \`${escapeMd(summary.topModel)}\``);
    if (summary.topTool) bits.push(`主力工具 \`${escapeMd(summary.topTool)}\``);
    elements.push({ tag: "hr" });
    elements.push({ tag: "div", text: { tag: "lark_md", content: `✨ **今日亮点**\n${bits.join(" · ")}` } });
  }

  const noteText = siteUrl ? `open-token-board · 自动推送 · ${siteUrl}` : "open-token-board · 自动推送";
  elements.push({ tag: "note", elements: [{ tag: "plain_text", content: noteText }] });

  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: "blue",
        title: { tag: "plain_text", content: "📊 每日 Token 战报" },
      },
      elements,
    },
  };
}

function shortField(label: string, value: string): Record<string, unknown> {
  return { is_short: true, text: { tag: "lark_md", content: `**${label}**\n${value}` } };
}

/** Feishu custom-bot signature: base64(HMAC-SHA256(key=`${ts}\n${secret}`, msg="")). */
export function signFeishu(timestampSec: number, secret: string): string {
  const stringToSign = `${timestampSec}\n${secret}`;
  return createHmac("sha256", stringToSign).update("").digest("base64");
}

export type FeishuSendResult = { ok: boolean; status: number; code?: number; msg?: string };

/** POST a prepared card payload to the Feishu custom-bot webhook. */
export async function sendFeishuCard(
  payload: Record<string, unknown>,
  config: DailyReportConfig,
): Promise<FeishuSendResult> {
  const body: Record<string, unknown> = { ...payload };
  if (config.secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    body.timestamp = String(timestamp);
    body.sign = signFeishu(timestamp, config.secret);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);
  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let code: number | undefined;
    let msg: string | undefined;
    try {
      const json = (await response.json()) as { code?: number; msg?: string; StatusCode?: number; StatusMessage?: string };
      code = json.code ?? json.StatusCode;
      msg = json.msg ?? json.StatusMessage;
    } catch {
      // Non-JSON body — fall back to HTTP status only.
    }
    // Feishu returns code/StatusCode === 0 on success.
    const ok = response.ok && (code === undefined || code === 0);
    return { ok, status: response.status, code, msg };
  } finally {
    clearTimeout(timer);
  }
}

function escapeMd(value: string): string {
  // Keep card markdown from breaking on user-controlled display names / model ids.
  return String(value ?? "").replace(/[*_`[\]]/g, "\\$&");
}
