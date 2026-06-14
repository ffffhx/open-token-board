#!/usr/bin/env -S npx tsx
import {
  analyzeCodexRateLimits,
  type CodexRateLimitReport,
  type CodexRateWindow,
} from "@open-token-board/core/codex-rate-limits";

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  reset: COLOR ? "[0m" : "",
  dim: COLOR ? "[2m" : "",
  bold: COLOR ? "[1m" : "",
  red: COLOR ? "[31m" : "",
  green: COLOR ? "[32m" : "",
  yellow: COLOR ? "[33m" : "",
  blue: COLOR ? "[34m" : "",
  cyan: COLOR ? "[36m" : "",
};

function helpText(): string {
  return `codex-limits — 查看 Codex CLI 实时剩余额度与预计耗尽时间

用法:
  codex-limits [选项]

选项:
  --watch[=秒]   持续刷新（默认每 15 秒），按 Ctrl+C 退出
  --json         输出原始 JSON
  --days=N       只看最近 N 天的日志（默认 14）
  --no-color     关闭颜色
  -h, --help     显示本帮助

数据来源: $CODEX_HOME 或 ~/.codex/sessions。百分比与重置时间是 Codex
上报的精确值；token 容量为估算值。窗口边界按重置点切分，已计入提前充值。`;
}

function parseArgs(argv: string[]) {
  let watch: number | null = null;
  let json = false;
  let days: number | undefined;
  let help = false;
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") help = true;
    else if (arg === "--json") json = true;
    else if (arg === "--watch") watch = 15;
    else if (arg.startsWith("--watch=")) watch = Math.max(2, Number(arg.slice(8)) || 15);
    else if (arg.startsWith("--days=")) days = Math.max(1, Number(arg.slice(7)) || 14);
    else if (arg === "--no-color") {
      /* handled via env elsewhere; ignore */
    }
  }
  return { watch, json, days, help };
}

function fmtDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds <= 0) return "已到期";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}天 ${h}小时`;
  if (h > 0) return `${h}小时 ${m}分`;
  return `${m}分`;
}

function fmtTokens(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return `${value}`;
}

function bar(percent: number, width = 28): string {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
  const color = percent >= 85 ? c.red : percent >= 60 ? c.yellow : c.green;
  return `${color}${"█".repeat(filled)}${c.dim}${"░".repeat(width - filled)}${c.reset}`;
}

function renderWindow(w: CodexRateWindow): string {
  const lines: string[] = [];
  const usedColor = w.usedPercent >= 85 ? c.red : w.usedPercent >= 60 ? c.yellow : c.green;
  lines.push(`${c.bold}${w.label}窗口${c.reset}  ${c.dim}(${w.windowMinutes} 分钟)${c.reset}`);
  lines.push(
    `  ${bar(w.usedPercent)}  ${usedColor}${w.usedPercent.toFixed(0)}%${c.reset} 已用` +
      `  ${c.dim}|${c.reset}  剩余 ${c.bold}${w.remainingPercent.toFixed(0)}%${c.reset}`,
  );
  lines.push(`  重置倒计时   ${c.cyan}${fmtDuration(w.resetsInSeconds)}${c.reset}`);

  let eta: string;
  if (w.etaSeconds === null) {
    eta = `${c.green}当前速度下本周期不会耗尽${c.reset}`;
  } else if (w.willExhaustBeforeReset) {
    eta = `${c.red}约 ${fmtDuration(w.etaSeconds)}后耗尽${c.reset} ${c.dim}(早于重置)${c.reset}`;
  } else {
    eta = `${c.yellow}约 ${fmtDuration(w.etaSeconds)}后耗尽${c.reset} ${c.dim}(晚于重置，会先刷新)${c.reset}`;
  }
  lines.push(`  预计耗尽     ${eta}`);

  const burn = w.burnPercentPerHour !== null ? `${w.burnPercentPerHour.toFixed(1)}%/小时` : "—（空闲）";
  lines.push(`  消耗速度     ${burn}`);

  const cap = fmtTokens(w.estimatedCapacityTokens);
  const rem = fmtTokens(w.estimatedRemainingTokens);
  lines.push(
    `  ${c.dim}容量估算 ≈ ${cap} tokens · 剩余 ≈ ${rem} · 本机本周期已用 ≈ ${fmtTokens(
      w.localConsumedTokensThisWindow,
    )}${c.reset}`,
  );
  return lines.join("\n");
}

function render(report: CodexRateLimitReport): string {
  const out: string[] = [];
  out.push(`${c.bold}${c.blue}Codex 额度面板${c.reset}  ${c.dim}${new Date(report.generatedAt).toLocaleString()}${c.reset}`);
  if (!report.available) {
    out.push(`${c.yellow}未找到限额数据。${c.reset}`);
    for (const note of report.notes) out.push(`  ${c.dim}${note}${c.reset}`);
    return out.join("\n");
  }
  if (report.plan) out.push(`${c.dim}计划: ${report.plan}${c.reset}`);
  out.push("");
  for (const w of report.windows) {
    out.push(renderWindow(w));
    out.push("");
  }
  if (report.recentTokensPerHour !== null) {
    out.push(`${c.dim}最近一小时本机吞吐 ≈ ${fmtTokens(report.recentTokensPerHour)} tokens/小时${c.reset}`);
  }
  if (report.latestEventAt) {
    const ageSec = Math.round((Date.now() - Date.parse(report.latestEventAt)) / 1000);
    out.push(`${c.dim}最近一次 Codex 活动: ${fmtDuration(ageSec)}前${c.reset}`);
  }
  for (const note of report.notes) out.push(`${c.dim}注: ${note}${c.reset}`);
  return out.join("\n");
}

async function main() {
  const { watch, json, days, help } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log(helpText());
    return;
  }

  const run = async () => analyzeCodexRateLimits({ lookbackDays: days });

  if (json) {
    console.log(JSON.stringify(await run(), null, 2));
    return;
  }

  if (watch !== null) {
    const tick = async () => {
      const report = await run();
      process.stdout.write("[2J[H");
      console.log(render(report));
      console.log(`${c.dim}每 ${watch} 秒刷新 · Ctrl+C 退出${c.reset}`);
    };
    await tick();
    const timer = setInterval(() => {
      void tick();
    }, watch * 1000);
    process.on("SIGINT", () => {
      clearInterval(timer);
      process.stdout.write("\n");
      process.exit(0);
    });
    return;
  }

  console.log(render(await run()));
}

void main();
