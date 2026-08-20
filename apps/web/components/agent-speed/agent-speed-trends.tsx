"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  AgentModelSpeedSummary,
  AgentSpeedDailySnapshot,
  AgentTimeCompositionSummary,
} from "@open-token-board/core/agent-speed";

import { AppNavLinks } from "@/components/app-nav-links";
import { TokenBoardLogo } from "@/components/token-board-logo";
import { useI18n } from "@/i18n";

type LoadState = "loading" | "ready" | "login" | "error";
type HistoryRange = 7 | 30 | 90;
type CompositionEngine = "all" | "codex" | "claude";

type HistoryResponse = {
  schemaVersion: 1;
  generatedAt: string;
  days: number;
  user: {
    userId: string;
    displayName: string;
    githubLogin?: string;
    avatarUrl?: string;
  };
  snapshots: AgentSpeedDailySnapshot[];
};

type ModelOption = { key: string; engine: "codex" | "claude"; model: string };

export function AgentSpeedTrends({ apiBaseUrl, initialNow }: { apiBaseUrl: string; initialNow: string }) {
  const { dict, locale } = useI18n();
  const copy = dict.speed;
  const base = apiBaseUrl.replace(/\/+$/, "");
  const [range, setRange] = useState<HistoryRange>(30);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [report, setReport] = useState<HistoryResponse | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [compositionEngine, setCompositionEngine] = useState<CompositionEngine>("all");

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    setError("");
    fetch(`${base}/api/agent-speed/history?days=${range}`, {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          setReport(null);
          setState("login");
          return;
        }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`);
        }
        if (!isHistoryResponse(payload)) throw new Error("Invalid agent speed response");
        setReport(payload);
        setState("ready");
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setState("error");
      });
    return () => controller.abort();
  }, [base, range, reloadKey]);

  const modelOptions = useMemo(() => collectModelOptions(report?.snapshots ?? []), [report]);
  useEffect(() => {
    if (!modelOptions.length) {
      setSelectedModel("");
      return;
    }
    if (!modelOptions.some((option) => option.key === selectedModel)) {
      const firstWithData = modelOptions.find((option) =>
        report?.snapshots.some((snapshot) => modelRow(snapshot, option.key)?.available)
      );
      setSelectedModel(firstWithData?.key ?? modelOptions[0].key);
    }
  }, [modelOptions, report, selectedModel]);

  const selectedOption = modelOptions.find((option) => option.key === selectedModel) ?? null;
  const validRows = (report?.snapshots ?? []).flatMap((snapshot) => {
    const row = modelRow(snapshot, selectedModel);
    return row?.available ? [{ snapshot, row }] : [];
  });
  const latest = validRows.at(-1) ?? null;
  const previous = validRows.at(-2) ?? null;
  const speedDelta = latest?.row.decodeTokensPerSecond && previous?.row.decodeTokensPerSecond
    ? (latest.row.decodeTokensPerSecond / previous.row.decodeTokensPerSecond - 1) * 100
    : null;
  const generatedAt = report?.generatedAt || initialNow;

  const signIn = () => {
    window.location.href = `${base}/api/auth/github/start?returnTo=${encodeURIComponent(window.location.href)}`;
  };

  return (
    <main className="min-h-screen bg-otb-page text-otb-ink">
      <header className="border-b border-slate-200 bg-white/90 px-4 py-4 backdrop-blur sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <TokenBoardLogo />
          <AppNavLinks active="speed" />
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-slate-800 bg-slate-950 px-4 py-10 text-white sm:px-6 lg:px-8 lg:py-14">
        <PulseTrace />
        <div className="relative mx-auto max-w-7xl">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-3">
                <p className="font-mono text-xs font-bold tracking-[0.18em] text-blue-300">{copy.page.eyebrow}</p>
                <span className="rounded-full border border-white/15 bg-white/8 px-3 py-1 font-mono text-[11px] text-slate-300">
                  {copy.page.privateBadge}
                </span>
              </div>
              <h1 className="mt-4 text-4xl font-black tracking-[-0.04em] sm:text-6xl">{copy.page.title}</h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">{copy.page.description}</p>
            </div>
            <RangeControl range={range} setRange={setRange} labels={copy.ranges} />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        {state === "loading" ? <LoadingPanel label={copy.states.loading} /> : null}
        {state === "login" ? (
          <ActionState
            eyebrow="PRIVATE TRACE"
            title={copy.states.loginTitle}
            body={copy.states.loginBody}
            action={copy.states.loginAction}
            onAction={signIn}
          />
        ) : null}
        {state === "error" ? (
          <ActionState
            eyebrow="CONNECTION"
            title={copy.states.errorTitle}
            body={error}
            action={copy.states.retry}
            onAction={() => setReloadKey((value) => value + 1)}
          />
        ) : null}
        {state === "ready" && report && report.snapshots.length === 0 ? (
          <EmptyState title={copy.states.emptyTitle} body={copy.states.emptyBody} command={copy.states.emptyCommand} />
        ) : null}

        {state === "ready" && report && report.snapshots.length > 0 ? (
          <div className="space-y-6">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">{copy.model.label}</p>
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {modelOptions.map((option) => {
                    const active = option.key === selectedModel;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setSelectedModel(option.key)}
                        className={`shrink-0 rounded-lg border px-3 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                          active
                            ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                            : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50"
                        }`}
                      >
                        <span className="block font-mono text-[10px] uppercase opacity-70">
                          {option.engine === "codex" ? copy.model.codex : copy.model.claude}
                        </span>
                        <span className="mt-0.5 block max-w-56 truncate text-sm font-bold">{option.model}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="shrink-0 font-mono text-xs text-slate-500">
                {copy.page.updated(formatDateTime(generatedAt, locale))}
              </p>
            </div>

            <section className="relative overflow-hidden rounded-otb-card border border-slate-800 bg-slate-950 p-5 text-white shadow-otb-card sm:p-7">
              <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_80%_20%,rgba(249,115,22,0.16),transparent_60%)]" />
              <div className="relative grid gap-7 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
                <div>
                  <p className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-blue-300">{copy.hero.decode}</p>
                  <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
                    <strong className="font-mono text-5xl tracking-[-0.07em] sm:text-7xl">
                      {formatMetric(latest?.row.decodeTokensPerSecond, 1)}
                    </strong>
                    <span className="pb-2 font-mono text-sm text-slate-400">{copy.units.tokensPerSecond}</span>
                    {speedDelta !== null ? (
                      <span className={`mb-2 rounded-full border px-2.5 py-1 font-mono text-xs font-bold ${speedDelta >= 0 ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-rose-400/30 bg-rose-400/10 text-rose-300"}`}>
                        {speedDelta >= 0 ? "+" : ""}{speedDelta.toFixed(1)}%
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm text-slate-400">{speedDelta === null ? copy.hero.noChange : copy.hero.versus}</p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <DarkMetric label={copy.hero.fixed} value={formatMetric(latest?.row.fixedOverheadSeconds, 1)} unit={copy.units.seconds} />
                  <DarkMetric label={copy.hero.sample} value={formatInteger(latest?.row.sampleCount)} />
                  <DarkMetric label={copy.hero.confidence} value={confidenceLabel(latest?.row.confidence, copy.hero)} />
                </div>
              </div>
            </section>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.65fr)]">
              <section className="rounded-otb-card border border-slate-200 bg-white p-5 shadow-otb-card sm:p-6">
                <PanelTitle title={copy.chart.speedTitle} description={copy.chart.speedDescription} />
                <SpeedLineChart snapshots={report.snapshots} modelKey={selectedModel} ariaLabel={copy.chart.speedAria(selectedOption?.model ?? "model")} locale={locale} emptyLabel={copy.chart.noPoint} />
              </section>

              <aside className="rounded-otb-card border border-slate-200 bg-white p-5 shadow-otb-card sm:p-6">
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">{copy.detail.title}</p>
                <p className="mt-2 text-sm font-bold text-slate-900">{latest ? formatDay(latest.snapshot.date, locale) : "—"}</p>
                <dl className="mt-6 divide-y divide-slate-100">
                  <DetailRow label={copy.detail.jitterP90} value={`${formatMetric(latest?.row.jitterP90, 2)}${copy.units.multiplier}`} />
                  <DetailRow label={copy.detail.jitterP99} value={`${formatMetric(latest?.row.jitterP99, 2)}${copy.units.multiplier}`} />
                  <DetailRow label={copy.detail.rSquared} value={formatMetric(latest?.row.rSquared, 2)} />
                  <DetailRow label={copy.detail.outputSpread} value={`${formatMetric(latest?.row.outputSpreadRatio, 1)}${copy.units.multiplier}`} />
                </dl>
                <div className="mt-6 border-t border-slate-200 pt-5">
                  <PanelTitle title={copy.chart.fixedTitle} description={copy.chart.fixedDescription} compact />
                  <MiniLineChart snapshots={report.snapshots} modelKey={selectedModel} />
                </div>
              </aside>
            </div>

            <section className="rounded-otb-card border border-slate-200 bg-white p-5 shadow-otb-card sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <PanelTitle title={copy.chart.toolTitle} description={copy.chart.toolDescription} />
                <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-1" aria-label={copy.chart.toolTitle}>
                  {(["all", "codex", "claude"] as const).map((engine) => (
                    <button
                      key={engine}
                      type="button"
                      onClick={() => setCompositionEngine(engine)}
                      className={`min-h-9 rounded-md px-3 text-xs font-bold transition focus-visible:outline-2 focus-visible:outline-blue-500 ${compositionEngine === engine ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
                    >
                      {copy.chart[engine]}
                    </button>
                  ))}
                </div>
              </div>
              <TimeCompositionChart snapshots={report.snapshots} engine={compositionEngine} locale={locale} copy={copy.chart} />
            </section>

            <div className="grid gap-4 md:grid-cols-2">
              <InfoPanel title={copy.detail.methodTitle} body={copy.detail.methodBody} marker="R²" />
              <InfoPanel title={copy.detail.privacyTitle} body={copy.detail.privacyBody} marker="LOCAL" />
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function RangeControl({ range, setRange, labels }: { range: HistoryRange; setRange: (range: HistoryRange) => void; labels: { seven: string; thirty: string; ninety: string } }) {
  const entries: Array<[HistoryRange, string]> = [[7, labels.seven], [30, labels.thirty], [90, labels.ninety]];
  return (
    <div className="flex rounded-lg border border-white/15 bg-white/8 p-1 backdrop-blur">
      {entries.map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => setRange(value)}
          className={`min-h-10 rounded-md px-4 font-mono text-xs font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${range === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SpeedLineChart({ snapshots, modelKey, ariaLabel, locale, emptyLabel }: { snapshots: AgentSpeedDailySnapshot[]; modelKey: string; ariaLabel: string; locale: string; emptyLabel: string }) {
  const [hoveredDate, setHoveredDate] = useState("");
  const width = 960;
  const height = 320;
  const left = 58;
  const right = 20;
  const top = 28;
  const bottom = 44;
  const points = snapshots.flatMap((snapshot) => {
    const row = modelRow(snapshot, modelKey);
    return row?.available && row.decodeTokensPerSecond
      ? [{ date: snapshot.date, value: row.decodeTokensPerSecond, confidence: row.confidence, row }]
      : [];
  });
  if (!points.length) return <div className="mt-6 flex min-h-64 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 text-center text-sm text-slate-500">{emptyLabel}</div>;
  const maxValue = niceCeiling(Math.max(...points.map((point) => point.value)) * 1.08);
  const firstTime = dayTime(snapshots[0]?.date ?? points[0].date);
  const lastTime = dayTime(snapshots.at(-1)?.date ?? points.at(-1)!.date);
  const domain = Math.max(24 * 60 * 60 * 1_000, lastTime - firstTime);
  const x = (date: string) => left + (dayTime(date) - firstTime) / domain * (width - left - right);
  const y = (value: number) => top + (1 - value / maxValue) * (height - top - bottom);
  const hovered = points.find((point) => point.date === hoveredDate) ?? points.at(-1)!;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="mt-5">
      <div className="flex min-h-8 items-center justify-end gap-2 font-mono text-xs text-slate-500">
        <span>{formatDay(hovered.date, locale)}</span>
        <span className="font-bold text-slate-950">{hovered.value.toFixed(1)} tok/s</span>
        <span className={`size-2 rounded-full ${hovered.confidence === "high" ? "bg-emerald-500" : hovered.confidence === "medium" ? "bg-amber-500" : "bg-slate-400"}`} />
      </div>
      <svg className="block h-auto w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id="speed-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-blue-500)" stopOpacity="0.24" />
            <stop offset="1" stopColor="var(--color-blue-500)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => {
          const tickY = y(maxValue * tick);
          return (
            <g key={tick}>
              <line x1={left} x2={width - right} y1={tickY} y2={tickY} stroke="var(--color-slate-200)" strokeWidth="1" />
              <text x={left - 10} y={tickY + 4} textAnchor="end" fill="var(--color-slate-500)" fontFamily="var(--font-space-mono)" fontSize="11">
                {Math.round(maxValue * tick)}
              </text>
            </g>
          );
        })}
        {points.length > 1 ? (
          <path d={`${linePath(points, x, y)} L ${x(points.at(-1)!.date)} ${height - bottom} L ${x(points[0].date)} ${height - bottom} Z`} fill="url(#speed-area)" />
        ) : null}
        {points.slice(1).map((point, index) => {
          const previous = points[index];
          const lowConfidence = point.confidence === "low" || previous.confidence === "low";
          return <line key={point.date} x1={x(previous.date)} y1={y(previous.value)} x2={x(point.date)} y2={y(point.value)} stroke="var(--color-blue-600)" strokeWidth="3" strokeLinecap="round" strokeDasharray={lowConfidence ? "7 7" : undefined} />;
        })}
        {points.map((point, index) => (
          <circle
            key={point.date}
            cx={x(point.date)}
            cy={y(point.value)}
            r={point.date === hovered.date ? 6 : index === points.length - 1 ? 5 : 3.5}
            fill={point.confidence === "low" ? "var(--color-white)" : "var(--color-blue-600)"}
            stroke="var(--color-blue-600)"
            strokeWidth="2.5"
            tabIndex={0}
            onMouseEnter={() => setHoveredDate(point.date)}
            onFocus={() => setHoveredDate(point.date)}
          >
            <title>{`${formatDay(point.date, locale)} · ${point.value.toFixed(1)} tok/s · n=${point.row.sampleCount}`}</title>
          </circle>
        ))}
        {[snapshots[0], snapshots[Math.floor((snapshots.length - 1) / 2)], snapshots.at(-1)].filter(Boolean).map((snapshot, index, array) => (
          <text key={`${snapshot!.date}-${index}`} x={x(snapshot!.date)} y={height - 15} textAnchor={index === 0 ? "start" : index === array.length - 1 ? "end" : "middle"} fill="var(--color-slate-500)" fontFamily="var(--font-space-mono)" fontSize="11">
            {snapshot!.date.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function MiniLineChart({ snapshots, modelKey }: { snapshots: AgentSpeedDailySnapshot[]; modelKey: string }) {
  const width = 320;
  const height = 100;
  const points = snapshots.flatMap((snapshot, index) => {
    const row = modelRow(snapshot, modelKey);
    return row?.available && row.fixedOverheadSeconds ? [{ index, value: row.fixedOverheadSeconds }] : [];
  });
  if (!points.length) return <div className="mt-4 h-24 rounded-lg bg-slate-50" />;
  const max = Math.max(...points.map((point) => point.value), 1);
  const x = (index: number) => 6 + index / Math.max(1, snapshots.length - 1) * (width - 12);
  const y = (value: number) => 8 + (1 - value / max) * (height - 22);
  return (
    <svg className="mt-4 block h-24 w-full" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={points.map((point, index) => `${index ? "L" : "M"} ${x(point.index)} ${y(point.value)}`).join(" ")} fill="none" stroke="var(--color-amber-500)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      {points.map((point) => <circle key={point.index} cx={x(point.index)} cy={y(point.value)} r="3" fill="var(--color-amber-500)" vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}

function TimeCompositionChart({ snapshots, engine, locale, copy }: { snapshots: AgentSpeedDailySnapshot[]; engine: CompositionEngine; locale: string; copy: ReturnType<typeof useI18n>["dict"]["speed"]["chart"] }) {
  const rows = snapshots.flatMap((snapshot) => {
    const summary = snapshot.timeComposition.find((entry) => entry.engine === engine);
    return summary?.wallMs ? [{ date: snapshot.date, summary }] : [];
  });
  const aggregate = aggregateComposition(rows.map((row) => row.summary), engine);
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-end">
      <div>
        <div className="flex items-end gap-2">
          <strong className="font-mono text-4xl tracking-[-0.06em] text-slate-950">{aggregate.toolPercent.toFixed(1)}%</strong>
          <span className="pb-1 text-sm font-bold text-blue-700">{copy.tool}</span>
        </div>
        <p className="mt-2 font-mono text-xs text-slate-500">{copy.turns(aggregate.turnCount)}</p>
        <div className="mt-4 flex gap-4 text-xs text-slate-600">
          <span className="flex items-center gap-2"><i className="size-2.5 rounded-sm bg-blue-600" />{copy.tool}</span>
          <span className="flex items-center gap-2"><i className="size-2.5 rounded-sm bg-slate-200" />{copy.nonTool}</span>
        </div>
      </div>
      {rows.length ? (
        <div className="flex h-44 items-end gap-1.5 overflow-hidden border-b border-slate-200 pb-px">
          {rows.map(({ date, summary }) => (
            <div key={date} className="group relative flex h-full min-w-1 flex-1 flex-col justify-end" tabIndex={0}>
              <div className="w-full bg-slate-200" style={{ height: `${Math.max(2, summary.nonToolPercent)}%` }} />
              <div className="w-full bg-blue-600 transition group-hover:bg-blue-500 group-focus:bg-blue-500" style={{ height: `${Math.max(2, summary.toolPercent)}%` }} />
              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 font-mono text-[10px] text-white shadow-lg group-hover:block group-focus:block">
                {formatDay(date, locale)} · {summary.toolPercent.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      ) : <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">—</div>}
    </div>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="rounded-otb-card border border-slate-200 bg-white p-6 shadow-otb-card">
      <div className="h-3 w-36 animate-pulse rounded-full bg-slate-200" />
      <div className="mt-5 h-16 w-72 max-w-full animate-pulse rounded-lg bg-slate-100" />
      <div className="mt-8 h-72 animate-pulse rounded-lg bg-slate-100" />
      <p className="mt-4 text-sm text-slate-500">{label}</p>
    </div>
  );
}

function ActionState({ eyebrow, title, body, action, onAction }: { eyebrow: string; title: string; body: string; action: string; onAction: () => void }) {
  return (
    <section className="grid min-h-96 place-items-center rounded-otb-card border border-slate-200 bg-white p-8 text-center shadow-otb-card">
      <div className="max-w-lg">
        <p className="font-mono text-xs font-bold tracking-[0.18em] text-blue-600">{eyebrow}</p>
        <h2 className="mt-4 text-2xl font-black sm:text-3xl">{title}</h2>
        <p className="mt-3 text-sm leading-7 text-slate-600">{body}</p>
        <button type="button" onClick={onAction} className="mt-6 min-h-11 rounded-lg bg-blue-600 px-5 text-sm font-bold text-white transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{action}</button>
      </div>
    </section>
  );
}

function EmptyState({ title, body, command }: { title: string; body: string; command: string }) {
  return (
    <section className="grid min-h-96 place-items-center rounded-otb-card border border-slate-200 bg-white p-8 text-center shadow-otb-card">
      <div className="max-w-xl">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-blue-200 bg-blue-50 font-mono text-xl font-black text-blue-700">0.0</div>
        <h2 className="mt-5 text-2xl font-black">{title}</h2>
        <p className="mt-3 text-sm leading-7 text-slate-600">{body}</p>
        <code className="mt-6 block overflow-x-auto rounded-lg bg-slate-950 px-4 py-3 text-left font-mono text-xs text-slate-100">{command}</code>
      </div>
    </section>
  );
}

function PulseTrace() {
  const points = [42, 39, 43, 35, 37, 18, 60, 31, 34, 29, 38, 33, 36, 34, 35];
  return (
    <svg aria-hidden="true" className="absolute inset-y-0 right-0 h-full w-2/3 opacity-20" viewBox="0 0 900 140" preserveAspectRatio="none">
      <defs><linearGradient id="pulse-fade" x1="0" x2="1"><stop stopColor="#f97316" stopOpacity="0" /><stop offset=".5" stopColor="#fb923c" /><stop offset="1" stopColor="#fbbf24" stopOpacity="0" /></linearGradient></defs>
      {[28, 56, 84, 112].map((y) => <line key={y} x1="0" x2="900" y1={y} y2={y} stroke="#fff" strokeOpacity=".12" />)}
      <polyline points={points.map((value, index) => `${index / (points.length - 1) * 900},${value + 35}`).join(" ")} fill="none" stroke="url(#pulse-fade)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function PanelTitle({ title, description, compact = false }: { title: string; description: string; compact?: boolean }) {
  return <div><h2 className={`${compact ? "text-base" : "text-xl"} font-black tracking-[-0.02em] text-slate-950`}>{title}</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500 sm:text-sm">{description}</p></div>;
}

function DarkMetric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return <div className="border-l border-white/15 pl-3"><p className="text-[11px] leading-4 text-slate-400">{label}</p><p className="mt-2 font-mono text-lg font-bold text-white sm:text-xl">{value}<span className="ml-1 text-[10px] font-normal text-slate-500">{unit}</span></p></div>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 py-3"><dt className="text-sm text-slate-600">{label}</dt><dd className="font-mono text-sm font-bold text-slate-950">{value}</dd></div>;
}

function InfoPanel({ title, body, marker }: { title: string; body: string; marker: string }) {
  return <section className="grid gap-4 rounded-otb-card border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-[4rem_1fr]"><div className="flex h-12 items-center justify-center rounded-lg bg-slate-950 font-mono text-xs font-bold text-blue-300">{marker}</div><div><h2 className="text-base font-black text-slate-950">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{body}</p></div></section>;
}

function collectModelOptions(snapshots: AgentSpeedDailySnapshot[]): ModelOption[] {
  const options = new Map<string, ModelOption>();
  for (const snapshot of snapshots) for (const row of snapshot.modelSpeed) {
    const key = modelKey(row.engine, row.model);
    options.set(key, { key, engine: row.engine, model: row.model });
  }
  return [...options.values()].sort((left, right) => left.engine.localeCompare(right.engine) || left.model.localeCompare(right.model));
}

function modelKey(engine: string, model: string) { return `${engine}\u0000${model}`; }
function modelRow(snapshot: AgentSpeedDailySnapshot, key: string) { return snapshot.modelSpeed.find((row) => modelKey(row.engine, row.model) === key); }
function dayTime(day: string) { return Date.parse(`${day}T00:00:00.000Z`); }
function linePath(points: Array<{ date: string; value: number }>, x: (date: string) => number, y: (value: number) => number) { return points.map((point, index) => `${index ? "L" : "M"} ${x(point.date)} ${y(point.value)}`).join(" "); }
function niceCeiling(value: number) { const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, value))); return Math.ceil(value / magnitude * 2) / 2 * magnitude; }
function formatMetric(value: number | undefined, digits: number) { return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—"; }
function formatInteger(value: number | undefined) { return typeof value === "number" ? new Intl.NumberFormat().format(value) : "—"; }
function formatDay(day: string, locale: string) { return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`)); }
function formatDateTime(value: string, locale: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "—"; }
function confidenceLabel(value: AgentModelSpeedSummary["confidence"], labels: { confidenceHigh: string; confidenceMedium: string; confidenceLow: string }) { return value === "high" ? labels.confidenceHigh : value === "medium" ? labels.confidenceMedium : labels.confidenceLow; }
function aggregateComposition(rows: AgentTimeCompositionSummary[], engine: CompositionEngine) {
  const wallMs = rows.reduce((sum, row) => sum + row.wallMs, 0);
  const toolMs = rows.reduce((sum, row) => sum + row.toolMs, 0);
  return { engine, turnCount: rows.reduce((sum, row) => sum + row.turnCount, 0), toolPercent: wallMs > 0 ? toolMs / wallMs * 100 : 0 };
}
function isHistoryResponse(value: unknown): value is HistoryResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<HistoryResponse>;
  return record.schemaVersion === 1 && typeof record.generatedAt === "string" && Array.isArray(record.snapshots) && Boolean(record.user && typeof record.user.userId === "string");
}
