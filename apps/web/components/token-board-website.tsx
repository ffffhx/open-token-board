import Link from "next/link";

import { TokenBoardLogo } from "@/components/token-board-logo";

const TOKEN_BOARD_AGENT_VERSION = "0.4.11";
const NPX_PACKAGE_URL = `https://ffffhx.github.io/open-token-board/token-board-agent.tgz?v=${TOKEN_BOARD_AGENT_VERSION}`;
const NPX_INSTALL_COMMAND =
  `npx --yes --package ${NPX_PACKAGE_URL} -- token-board-agent install`;
const NPX_STATUS_COMMAND =
  `npx --yes --package ${NPX_PACKAGE_URL} -- token-board-agent status`;
const NPX_UNINSTALL_COMMAND =
  `npx --yes --package ${NPX_PACKAGE_URL} -- token-board-agent uninstall`;

const capabilityCards = [
  {
    title: "朋友排行榜",
    body: "按 1D、7D、30D、90D 查看 Token、费用和会话排名，适合小团队或朋友局做透明对比。",
    meta: "Rank by tokens, cost, sessions",
  },
  {
    title: "自动同步",
    body: "本机 agent 后台采集 AI 编码工具的用量记录，安装后定时上报，不需要手动整理日志。",
    meta: "macOS LaunchAgent / Windows Task",
  },
  {
    title: "个人洞察",
    body: "登录 GitHub 后查看自己的模型、项目、缓存命中率、活跃时间和 session 明细。",
    meta: "GitHub account view",
  },
];

const workflowSteps = [
  {
    eyebrow: "01",
    title: "安装并完成授权",
    body: "在你平时使用 Codex、Claude Code、Cursor 或 Trae 的电脑终端里运行安装命令。首次执行会引导 GitHub 授权，并注册后台同步任务。",
    command: NPX_INSTALL_COMMAND,
    commandLabel: "安装命令",
  },
  {
    eyebrow: "02",
    title: "检查同步状态",
    body: "安装完成后运行状态命令，确认配置文件、后台任务和最近一次上报结果是否正常。后台任务默认每 5 分钟同步一次。",
    command: NPX_STATUS_COMMAND,
    commandLabel: "状态检查命令",
  },
  {
    eyebrow: "03",
    title: "打开榜单并刷新",
    body: "回到榜单页面刷新，或切换时间窗口查看自己的记录。如果以后不想继续同步，可以运行卸载命令。",
    command: NPX_UNINSTALL_COMMAND,
    commandLabel: "卸载命令",
  },
];

const privacyItems = [
  "只展示 token、模型、工具、项目 basename 与会话短标题。",
  "不展示完整 prompt 文本，不上传项目绝对路径。",
  "费用按公开模型单价估算，不等同于实际账单。",
];

export function TokenBoardWebsite() {
  return (
    <main className="min-w-0 bg-slate-100 text-slate-950">
      <HeroSection />

      <section id="capabilities" className="border-y border-slate-200 bg-white px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="font-mono text-xs font-semibold uppercase text-blue-600">Token usage, shared clearly</p>
            <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">把 AI 编码用量变成一张可讨论的榜单</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Open Token Board 适合想知道“最近谁在高强度编码、哪些模型最贵、上下文复用效率如何”的小圈子。
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {capabilityCards.map((card) => (
              <article key={card.title} className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                <p className="font-mono text-xs text-blue-600">{card.meta}</p>
                <h3 className="mt-4 text-lg font-semibold">{card.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{card.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="max-w-3xl">
              <p className="font-mono text-xs font-semibold uppercase text-blue-600">3 steps</p>
              <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">使用流程：安装、检查、刷新榜单</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                不需要手动整理日志。复制下面的命令在本机执行，等 agent 完成同步后进入 `/board/` 就能看到数据。
              </p>
            </div>
            <Link
              href="/board"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              打开榜单
            </Link>
          </div>

          <div className="mt-8 grid gap-4">
            {workflowSteps.map((step) => (
              <article key={step.title} className="grid gap-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-[3.5rem_minmax(0,1fr)] sm:p-6">
                <div className="flex size-14 items-center justify-center rounded-lg bg-blue-600 font-mono text-base font-semibold text-white">
                  {step.eyebrow}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-base font-semibold">{step.title}</h3>
                    <span className="font-mono text-xs text-blue-600">{step.commandLabel}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{step.body}</p>
                  <pre className="mt-4 rounded-lg bg-slate-950 px-4 py-3 font-mono text-xs leading-6 text-slate-100">
                    <code className="block whitespace-pre-wrap break-all">{step.command}</code>
                  </pre>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="privacy" className="border-y border-slate-200 bg-slate-950 px-4 py-14 text-white sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="font-mono text-xs font-semibold uppercase text-blue-300">Privacy boundary</p>
            <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">适合公开排名，但不适合公开 prompt</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Token Board 的目标是共享统计，不是共享内容。榜单里应该出现的是用量、趋势和效率，而不是你的完整对话。
            </p>
          </div>

          <div className="grid gap-3">
            {privacyItems.map((item) => (
              <div key={item} className="rounded-lg border border-white/10 bg-white/6 px-4 py-3 text-sm leading-6 text-slate-200">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

    </main>
  );
}

function HeroSection() {
  return (
    <section className="relative min-h-[78svh] overflow-hidden bg-slate-950 text-white">
      <HeroDashboardScene />
      <div className="absolute inset-0 bg-slate-950/72" />

      <nav className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
        <Link href="/" className="text-white">
          <TokenBoardLogo />
        </Link>
        <div className="flex items-center gap-2">
          <a href="#capabilities" className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white sm:inline-flex">
            能力
          </a>
          <a href="#privacy" className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white sm:inline-flex">
            隐私
          </a>
          <Link
            href="/board"
            className="inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            进入榜单
          </Link>
        </div>
      </nav>

      <div className="relative z-10 mx-auto flex max-w-7xl flex-col justify-end px-4 pb-12 pt-16 sm:px-6 sm:pt-20 lg:px-8">
        <div className="max-w-3xl">
          <p className="font-mono text-xs font-semibold uppercase text-blue-200">AI coding token leaderboard</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight sm:text-6xl">Open Token Board</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-200 sm:text-lg">
            给朋友、团队和开源协作者看的 AI 编码 Token 排行榜。自动同步本机用量，公开趋势和效率，不公开完整 prompt。
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/board"
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              查看实时榜单
            </Link>
            <a
              href="#workflow"
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/20 bg-white/10 px-5 text-sm font-semibold text-white transition hover:bg-white/15"
            >
              了解使用流程
            </a>
          </div>
        </div>

        <div className="mt-10 hidden max-w-4xl gap-3 sm:grid sm:grid-cols-3">
          <HeroMetric label="当前榜首" value="Syfyivan" meta="1.8B tokens" />
          <HeroMetric label="区间记录" value="23,116" meta="rolling 7D" />
          <HeroMetric label="高频模型" value="gpt-5.5" meta="Codex CLI" />
        </div>
      </div>
    </section>
  );
}

function HeroMetric({ label, meta, value }: { label: string; meta: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/12 bg-white/10 p-4 backdrop-blur">
      <p className="text-xs font-semibold uppercase text-slate-300">{label}</p>
      <p className="mt-2 truncate font-mono text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-blue-200">{meta}</p>
    </div>
  );
}

function HeroDashboardScene() {
  return (
    <div aria-hidden="true" className="absolute inset-0 min-w-[58rem] opacity-95">
      <div className="absolute left-1/2 top-20 w-[76rem] -translate-x-1/2 rotate-[-3deg] rounded-lg border border-white/10 bg-white p-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <div className="h-3 w-36 rounded-full bg-blue-100" />
            <div className="mt-3 h-7 w-80 rounded bg-slate-900" />
            <div className="mt-3 h-3 w-52 rounded-full bg-slate-200" />
          </div>
          <div className="grid w-96 grid-cols-4 gap-2 rounded-lg bg-slate-100 p-1">
            {["1D", "7D", "30D", "90D"].map((item, index) => (
              <div key={item} className={`h-10 rounded-lg ${index === 1 ? "bg-white shadow-sm" : "bg-transparent"}`} />
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          {["当前榜首", "当前区间记录", "高频组合"].map((item, index) => (
            <div key={item} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="h-3 w-24 rounded-full bg-slate-300" />
              <div className={`mt-4 h-6 rounded ${index === 1 ? "w-28 bg-blue-600" : "w-36 bg-slate-900"}`} />
              <div className="mt-3 h-3 w-20 rounded-full bg-blue-100" />
            </div>
          ))}
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
          <div className="grid grid-cols-[5rem_10rem_1fr_9rem_7rem_9rem] bg-slate-50 px-4 py-3 text-xs text-slate-400">
            <span>排名</span>
            <span>用户</span>
            <span>每日用量</span>
            <span>总消耗</span>
            <span>会话</span>
            <span>模型</span>
          </div>
          {["Syfyivan", "ffffhx", "OpenBoard"].map((name, index) => (
            <div key={name} className="grid grid-cols-[5rem_10rem_1fr_9rem_7rem_9rem] items-center border-t border-slate-100 px-4 py-4">
              <div className="font-mono text-sm font-semibold text-slate-500">#{index + 1}</div>
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-lg bg-blue-50 ring-1 ring-blue-200" />
                <div>
                  <div className="h-3 w-20 rounded-full bg-slate-900" />
                  <div className="mt-2 h-2 w-12 rounded-full bg-slate-200" />
                </div>
              </div>
              <div className="flex h-14 items-end gap-2 pr-8">
                {[44, 68, 38, 31, 49, 47, 42].map((height, barIndex) => (
                  <div key={barIndex} className="flex-1 rounded-t bg-blue-600" style={{ height: `${height}%` }} />
                ))}
              </div>
              <div className="h-4 w-20 rounded bg-slate-900" />
              <div className="h-3 w-10 rounded-full bg-slate-300" />
              <div className="h-7 w-20 rounded-md bg-amber-50 ring-1 ring-amber-200" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
