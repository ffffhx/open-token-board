#!/usr/bin/env -S npx tsx
import { createServer } from "node:http";

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
  --serve[=端口] 启动本地小网页面板（默认端口 4747）
  --json         输出原始 JSON
  --days=N       只看最近 N 天的日志（默认 14）
  --no-color     关闭颜色
  -h, --help     显示本帮助

数据来源: $CODEX_HOME 或 ~/.codex/sessions。百分比与重置时间是 Codex
上报的精确值；token 容量为估算值。窗口边界按重置点切分，已计入提前充值。`;
}

function parseArgs(argv: string[]) {
  let watch: number | null = null;
  let serve: number | null = null;
  let json = false;
  let days: number | undefined;
  let help = false;
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") help = true;
    else if (arg === "--json") json = true;
    else if (arg === "--watch") watch = 15;
    else if (arg.startsWith("--watch=")) watch = Math.max(2, Number(arg.slice(8)) || 15);
    else if (arg === "--serve" || arg === "--server") serve = 4747;
    else if (arg.startsWith("--serve=")) serve = Math.max(1, Number(arg.slice(8)) || 4747);
    else if (arg.startsWith("--server=")) serve = Math.max(1, Number(arg.slice(9)) || 4747);
    else if (arg.startsWith("--days=")) days = Math.max(1, Number(arg.slice(7)) || 14);
    else if (arg === "--no-color") {
      /* handled via env elsewhere; ignore */
    }
  }
  return { watch, serve, json, days, help };
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
  const color = percent >= 90 ? c.red : percent >= 70 ? c.yellow : c.green;
  return `${color}${"█".repeat(filled)}${c.dim}${"░".repeat(width - filled)}${c.reset}`;
}

function renderWindow(w: CodexRateWindow): string {
  const lines: string[] = [];
  const usedColor = w.usedPercent >= 90 ? c.red : w.usedPercent >= 70 ? c.yellow : c.green;
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

const PAGE_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Codex 额度面板</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f1f5f9; color: #0f172a;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 28px 20px 64px; }
  h1 { font-size: 26px; margin: 6px 0 4px; }
  .eyebrow { font: 700 12px/1 ui-monospace, monospace; letter-spacing: .08em;
    text-transform: uppercase; color: #2563eb; }
  .sub { color: #475569; max-width: 640px; margin: 8px 0 0; }
  .status { display: flex; flex-wrap: wrap; gap: 4px 20px; color: #64748b;
    font-size: 12px; margin: 20px 0 14px; }
  .status b { color: #334155; }
  .grid { display: grid; gap: 18px; grid-template-columns: 1fr; }
  @media (min-width: 720px) { .grid { grid-template-columns: 1fr 1fr; } }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 18px;
    padding: 22px; box-shadow: 0 1px 2px rgba(15,23,42,.05); }
  .card h2 { font-size: 18px; margin: 0; display: flex; justify-content: space-between;
    align-items: baseline; }
  .card h2 span { font: 12px ui-monospace, monospace; color: #94a3b8; }
  .big { font-size: 46px; font-weight: 650; font-variant-numeric: tabular-nums;
    margin: 14px 0 0; }
  .big small { font-size: 22px; }
  .lbl { color: #64748b; font-size: 13px; margin-left: 8px; font-weight: 400; }
  .track { height: 10px; background: #f1f5f9; border-radius: 999px; overflow: hidden; margin: 14px 0 6px; }
  .track > div { height: 100%; border-radius: 999px; transition: width .7s; }
  .meta { color: #64748b; font-size: 12px; }
  dl { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 18px 0 0; }
  dt { color: #94a3b8; font-size: 12px; }
  dd { margin: 4px 0 0; font-weight: 600; }
  .foot { margin-top: 18px; background: #f8fafc; border: 1px solid #f1f5f9;
    border-radius: 12px; padding: 11px 14px; color: #64748b; font-size: 12px; }
  .green { color: #059669; } .amber { color: #d97706; } .rose { color: #e11d48; }
  .note { color: #94a3b8; font-size: 12px; margin-top: 18px; }
  .err { background:#fff1f2; border:1px solid #fecdd3; color:#be123c; border-radius:14px; padding:18px; }
</style></head>
<body><div class="wrap">
  <p class="eyebrow">Codex rate limits</p>
  <h1>Codex 额度面板</h1>
  <p class="sub">实时读取本机 <code>~/.codex</code> 日志。百分比与重置时间是 Codex 上报的精确值，
    token 容量为估算值。窗口按重置点切分，已计入提前充值。</p>
  <div id="status" class="status"></div>
  <div id="grid" class="grid"></div>
  <div id="notes"></div>
</div>
<script>
const fmtTok = v => v==null ? "—" : v>=1e9?(v/1e9).toFixed(2)+"B":v>=1e6?(v/1e6).toFixed(1)+"M":v>=1e3?(v/1e3).toFixed(1)+"K":""+v;
function fmtDur(s){ if(s==null)return"—"; if(s<=0)return"已到期";
  const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),x=Math.floor(s%60);
  if(d>0)return d+"天 "+h+"小时 "+m+"分"; if(h>0)return h+"小时 "+m+"分"; if(m>0)return m+"分 "+x+"秒"; return x+"秒"; }
const until = iso => iso==null ? null : Math.round((Date.parse(iso)-Date.now())/1000);
const tone = p => p>=90?{b:"#f43f5e",t:"rose"}:p>=70?{b:"#f59e0b",t:"amber"}:{b:"#10b981",t:"green"};
let last = null;
function card(w){ const tn=tone(w.usedPercent);
  let eta = w.etaAt==null ? '<span class="green">当前速度下本周期不会耗尽</span>'
    : w.willExhaustBeforeReset ? '<span class="rose">约 '+fmtDur(until(w.etaAt))+'后耗尽 <small style="color:#94a3b8">(早于重置)</small></span>'
    : '<span class="amber">约 '+fmtDur(until(w.etaAt))+'后耗尽 <small style="color:#94a3b8">(晚于重置，会先刷新)</small></span>';
  return '<div class="card"><h2>'+w.label+'窗口<span>'+w.windowMinutes+' 分钟</span></h2>'
    +'<div class="big '+tn.t+'">'+w.remainingPercent.toFixed(0)+'<small>%</small><span class="lbl">剩余额度</span></div>'
    +'<div class="track"><div style="width:'+Math.min(100,w.usedPercent)+'%;background:'+tn.b+'"></div></div>'
    +'<div class="meta">已用 <b style="color:#334155">'+w.usedPercent.toFixed(0)+'%</b></div>'
    +'<dl><div><dt>重置倒计时</dt><dd style="font-family:ui-monospace,monospace">'+fmtDur(until(w.resetsAt))+'</dd></div>'
    +'<div><dt>消耗速度</dt><dd>'+(w.burnPercentPerHour!=null?w.burnPercentPerHour.toFixed(1)+'%/小时':'空闲')+'</dd></div>'
    +'<div style="grid-column:1/3"><dt>预计耗尽</dt><dd>'+eta+'</dd></div></dl>'
    +'<div class="foot"><b style="color:#475569">容量估算</b> ≈ '+fmtTok(w.estimatedCapacityTokens)+' tokens · 剩余 ≈ '
    +fmtTok(w.estimatedRemainingTokens)+' · 本机本周期已用 ≈ '+fmtTok(w.localConsumedTokensThisWindow)+'</div></div>'; }
function paint(){ if(!last)return;
  if(!last.available){ document.getElementById('grid').innerHTML='<div class="err">未找到限额数据。'+(last.notes[0]||'')+'</div>'; return; }
  const age = last.latestEventAt ? Math.round((Date.now()-Date.parse(last.latestEventAt))/1000) : null;
  document.getElementById('status').innerHTML =
    (last.plan?'<span>计划 <b>'+last.plan+'</b></span>':'')
    +(last.recentTokensPerHour!=null?'<span>最近一小时吞吐 <b>'+fmtTok(last.recentTokensPerHour)+'/小时</b></span>':'')
    +(age!=null?'<span>最近活动 <b>'+fmtDur(age)+'前</b></span>':'')
    +'<span style="color:#94a3b8">每 15 秒自动刷新</span>';
  document.getElementById('grid').innerHTML = last.windows.map(card).join('');
  document.getElementById('notes').innerHTML = last.notes.map(n=>'<p class="note">注：'+n+'</p>').join(''); }
async function load(){ try{ const r=await fetch('/data',{cache:'no-store'}); last=await r.json(); paint(); }
  catch(e){ document.getElementById('grid').innerHTML='<div class="err">请求失败：'+e+'</div>'; } }
load(); setInterval(load, 15000); setInterval(paint, 1000);
</script></body></html>`;

function startServer(port: number, days: number | undefined) {
  const server = createServer((req, res) => {
    if (req.url && req.url.startsWith("/data")) {
      analyzeCodexRateLimits({ lookbackDays: days, cacheMs: 8000 })
        .then((report) => {
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(report));
        })
        .catch((error: unknown) => {
          res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : "failed" }));
        });
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE_HTML);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`${c.bold}${c.blue}Codex 额度面板${c.reset} 已启动: ${c.cyan}http://127.0.0.1:${port}${c.reset}`);
    console.log(`${c.dim}按 Ctrl+C 退出${c.reset}`);
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`${c.red}端口 ${port} 已被占用，换一个：codex-limits --serve=${port + 1}${c.reset}`);
    } else {
      console.error(`${c.red}启动失败: ${error.message}${c.reset}`);
    }
    process.exit(1);
  });
}

async function main() {
  const { watch, serve, json, days, help } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log(helpText());
    return;
  }

  const run = async () => analyzeCodexRateLimits({ lookbackDays: days });

  if (serve !== null) {
    startServer(serve, days);
    return;
  }

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
