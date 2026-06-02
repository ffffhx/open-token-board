import { INSTALL_GUIDES } from "./constants";
import type { InstallGuidePlatform } from "./types";
import { Icon } from "./shared-ui";

export function InstallGuideDialog({
  canLogin,
  onClose,
  onCopy,
  onLogin,
  onPlatformChange,
  onRefresh,
  onStepChange,
  open,
  platform,
  stepIndex,
}: {
  canLogin: boolean;
  onClose: () => void;
  onCopy: (command: string, label: string) => void;
  onLogin: () => void;
  onPlatformChange: (platform: InstallGuidePlatform) => void;
  onRefresh: () => void;
  onStepChange: (step: number) => void;
  open: boolean;
  platform: InstallGuidePlatform;
  stepIndex: number;
}) {
  if (!open) {
    return null;
  }

  const guide = INSTALL_GUIDES[platform] ?? INSTALL_GUIDES.macos;
  const steps = guide.steps;
  const step = steps[stepIndex] ?? steps[0];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === steps.length - 1;

  function completeGuide() {
    onClose();
    onRefresh();
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="token-board-install-guide-title"
        className="flex h-[min(42rem,calc(100vh-2rem))] w-[min(52rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border-2 border-blue-600/55 bg-white shadow-sm"
      >
        <div className="shrink-0 border-b border-stone-950/8 px-5 pb-4 pt-5 sm:px-7">
          <div className="flex items-center gap-2">
            <div className="grid flex-1 grid-cols-3 gap-2">
              {steps.map((item, index) => (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => onStepChange(index)}
                  className={`h-1.5 rounded-full transition ${
                    index <= stepIndex ? "bg-blue-600" : "bg-stone-950/8 hover:bg-stone-950/16"
                  }`}
                  aria-label={`查看${item.title}`}
                  aria-current={index === stepIndex ? "step" : undefined}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="ml-3 inline-flex size-9 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-950/8 hover:text-stone-900"
              aria-label="关闭安装指南"
            >
              <Icon name="close" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7 sm:py-7">
          <div className="mb-5 rounded-lg border border-stone-950/10 bg-white/70 p-2">
            <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="选择安装系统">
              {(Object.keys(INSTALL_GUIDES) as InstallGuidePlatform[]).map((item) => {
                const selected = item === platform;

                return (
                  <button
                    key={item}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onPlatformChange(item)}
                    className={`min-h-10 rounded-lg px-3 text-sm font-semibold transition ${
                      selected
                        ? "bg-slate-950 text-white shadow-sm"
                        : "text-stone-500 hover:bg-stone-950/6 hover:text-stone-900"
                    }`}
                  >
                    {INSTALL_GUIDES[item].label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 px-2 text-xs leading-5 text-stone-500">{guide.description}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-[3.5rem_minmax(0,1fr)]">
            <div className="flex size-12 items-center justify-center rounded-lg border border-blue-600/25 bg-blue-50 text-blue-600 shadow-sm">
              <Icon name={step.command ? "terminal" : "refresh"} />
            </div>
            <div className="min-w-0">
              <p className="font-mono text-xs font-semibold uppercase text-blue-600">
                {step.eyebrow} / {steps.length}
              </p>
              <h2 id="token-board-install-guide-title" className="mt-2 text-2xl font-semibold leading-tight text-stone-950 sm:text-3xl">
                {step.title}
              </h2>
              <p className="mt-3 text-sm leading-6 text-stone-600 sm:text-base">
                {step.description}
              </p>
            </div>
          </div>

          {step.command ? (
            <div className="mt-5 overflow-hidden rounded-lg bg-slate-950 text-white shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <span className="font-mono text-xs text-white/52">{step.commandLabel}</span>
                <button
                  type="button"
                  onClick={() => onCopy(step.command!, step.commandLabel ?? "命令")}
                  className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/16"
                >
                  <Icon name="download" />
                  复制命令
                </button>
              </div>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all px-4 py-4 font-mono text-sm leading-7 text-white sm:text-base">
                <span className="mr-3 select-none text-blue-300">&gt;_</span>
                {step.command}
              </pre>
            </div>
          ) : (
            <div className="mt-5 rounded-lg border border-blue-600/20 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
              <p className="font-semibold text-blue-600">完成后你可以：</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {["刷新榜单", "切换时间范围", "查看个人消耗"].map((item) => (
                  <span key={item} className="rounded-lg border border-white/70 bg-white/70 px-3 py-2 text-center font-semibold">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          )}

          {canLogin && stepIndex === 0 ? (
            <div className="mt-4 flex flex-col gap-3 rounded-lg border border-stone-950/10 bg-white/70 p-3 text-sm text-stone-600 sm:flex-row sm:items-center sm:justify-between">
              <p>还没登录页面的话，可以先完成 GitHub 登录；安装命令也会在终端里引导授权。</p>
              <button
                type="button"
                onClick={onLogin}
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-stone-950/12 bg-white px-3 font-semibold text-stone-800 transition hover:border-blue-600/35 hover:bg-blue-50"
              >
                <Icon name="github" />
                GitHub 登录
              </button>
            </div>
          ) : null}

          <p className="mt-4 rounded-lg bg-white/70 px-4 py-3 text-sm leading-6 text-stone-600">
            {step.note}
          </p>

          {isLastStep ? (
            <div className="mt-4 rounded-lg border border-stone-950/10 bg-white/70 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-stone-950">以后不想同步时</p>
                  <p className="mt-1 text-xs leading-5 text-stone-500">{guide.uninstall.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onCopy(guide.uninstall.command, guide.uninstall.commandLabel)}
                  className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-stone-950/10 bg-white px-3 text-xs font-semibold text-stone-800 transition hover:border-blue-600/35 hover:bg-blue-50"
                >
                  <Icon name="download" />
                  复制卸载命令
                </button>
              </div>
              <pre className="mt-3 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 px-3 py-3 font-mono text-xs leading-5 text-white">
                <span className="mr-2 select-none text-blue-300">&gt;_</span>
                {guide.uninstall.command}
              </pre>
              <p className="mt-3 text-xs leading-5 text-stone-500">{guide.uninstall.note}</p>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-stone-950/8 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-stone-500 transition hover:bg-stone-950/6 hover:text-stone-900"
          >
            跳过
          </button>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => onStepChange(Math.max(0, stepIndex - 1))}
              disabled={isFirstStep}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-950/12 bg-white px-5 text-sm font-semibold text-stone-800 transition hover:border-blue-600/35 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-stone-950/12 disabled:hover:bg-white"
            >
              上一步
            </button>
            <button
              type="button"
              onClick={isLastStep ? completeGuide : () => onStepChange(Math.min(steps.length - 1, stepIndex + 1))}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800"
            >
              {isLastStep ? "完成并刷新" : "下一步"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
