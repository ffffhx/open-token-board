import type { ReactNode } from "react";

import type { ToastState } from "./types";

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) {
    return null;
  }

  const tone =
    toast.tone === "error"
      ? "border-red-600/40 bg-red-50 text-red-900 shadow-sm ring-red-600/10 dark:border-red-400/35 dark:bg-red-950/80 dark:text-red-100"
      : "border-blue-600/40 bg-blue-50 text-blue-900 shadow-sm ring-blue-600/10 dark:border-blue-300/35 dark:bg-blue-950/80 dark:text-blue-100";

  return (
    <div
      key={toast.id}
      role="status"
      aria-live="polite"
      className={`otb-toast-pop pointer-events-none fixed left-1/2 top-5 z-[100] flex min-h-12 min-w-[11rem] max-w-[min(18rem,calc(100vw-2rem))] -translate-x-1/2 items-center justify-center rounded-lg border px-4 py-3 text-center text-sm font-semibold leading-5 ring-4 backdrop-blur-xl ${tone}`}
    >
      {toast.message}
    </div>
  );
}

export type LoadingTone = "dark" | "light";

export function LoadingSpinner({
  className = "size-4",
  tone = "dark",
}: {
  className?: string;
  tone?: LoadingTone;
}) {
  const tones = {
    dark: "border-slate-950/15 border-t-blue-600",
    light: "border-white/25 border-t-white",
  };

  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full border-2 motion-safe:animate-spin ${tones[tone]} ${className}`}
    />
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`otb-skeleton inline-block rounded-md ${className}`}
    />
  );
}

export function EmptyStateIllustration({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 180 132"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M31 90c10-27 23-41 40-42 13-1 21 7 31 5 10-3 14-18 29-17 14 1 25 16 28 36"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="7"
        opacity=".12"
      />
      <rect
        height="54"
        rx="12"
        stroke="currentColor"
        strokeWidth="3"
        width="116"
        x="32"
        y="54"
        opacity=".28"
      />
      <path d="M52 88h24M52 75h42M104 75h24" stroke="currentColor" strokeLinecap="round" strokeWidth="5" opacity=".34" />
      <path
        d="M116 98c10-2 18-11 19-23"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="5"
        opacity=".34"
      />
      <path d="M88 39l9-17 9 17 18 7-18 7-9 17-9-17-18-7 18-7Z" fill="currentColor" opacity=".13" />
      <path d="M97 22v48M70 46h54" stroke="currentColor" strokeLinecap="round" strokeWidth="3" opacity=".3" />
      <circle cx="44" cy="38" r="4" fill="currentColor" opacity=".18" />
      <circle cx="142" cy="43" r="5" fill="currentColor" opacity=".16" />
      <circle cx="139" cy="113" r="3" fill="currentColor" opacity=".2" />
    </svg>
  );
}

export function EmptyStatePanel({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description: ReactNode;
  title: string;
}) {
  return (
    <div className="otb-panel-muted rounded-lg px-5 py-8 text-center text-slate-600 dark:text-slate-300">
      <EmptyStateIllustration className="mx-auto h-28 w-40 text-blue-600 dark:text-blue-300" />
      <p className="mt-2 text-base font-semibold text-slate-950 dark:text-slate-50">{title}</p>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function LoadingInline({
  className = "",
  label,
  spinnerClassName = "size-3.5",
  tone = "dark",
}: {
  className?: string;
  label: string;
  spinnerClassName?: string;
  tone?: LoadingTone;
}) {
  return (
    <span role="status" className={`inline-flex min-w-0 items-center gap-1.5 align-middle ${className}`}>
      <LoadingSpinner className={spinnerClassName} tone={tone} />
      <span className="truncate">{label}</span>
    </span>
  );
}

export function Avatar({ name, index }: { name: string; index: number }) {
  const tones = [
    "bg-blue-50 text-blue-900 ring-blue-600/20",
    "bg-sky-50 text-sky-900 ring-sky-600/20",
    "bg-amber-50 text-amber-900 ring-amber-600/20",
    "bg-rose-50 text-red-900 ring-red-600/20",
    "bg-slate-100 text-stone-700 ring-stone-950/10",
  ];

  return (
    <span
      className={`flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold ring-1 ${tones[index % tones.length]}`}
      aria-hidden="true"
    >
      {name.trim().slice(0, 1).toUpperCase() || "U"}
    </span>
  );
}

export function Icon({ name }: { name: "arrow" | "check" | "close" | "copy" | "download" | "file" | "github" | "guide" | "logout" | "refresh" | "terminal" | "upload" }) {
  const paths = {
    arrow: "M5 12h14m0 0-5-5m5 5-5 5",
    check: "m5 12 4 4L19 6",
    close: "M18 6 6 18M6 6l12 12",
    copy: "M8 8h10v12H8V8Zm-4 8V4h10",
    download: "M12 3v10m0 0 4-4m-4 4-4-4M5 17v2h14v-2",
    file: "M7 3h7l4 4v14H7V3Zm7 0v5h5",
    github:
      "M15 22v-3.8a3.3 3.3 0 0 0-.9-2.6c3-.3 6.1-1.5 6.1-6.7a5.2 5.2 0 0 0-1.4-3.6 4.8 4.8 0 0 0-.1-3.6s-1.1-.4-3.7 1.4a12.7 12.7 0 0 0-6.7 0C5.7 1.3 4.6 1.7 4.6 1.7a4.8 4.8 0 0 0-.1 3.6A5.2 5.2 0 0 0 3.1 9c0 5.2 3.1 6.4 6.1 6.7a3 3 0 0 0-.8 1.9c-.8.4-2.8 1-4-1.1 0 0-.7-1.3-2.1-1.4 0 0-1.3 0-.1.8 0 0 .9.4 1.5 2 0 0 .8 2.4 4.6 1.6V22",
    guide: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15ZM8 6h8M8 10h6",
    logout: "M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-6M21 19a2 2 0 0 1-2 2h-6",
    refresh: "M4 12a8 8 0 0 1 13.5-5.8M20 12a8 8 0 0 1-13.5 5.8M17 3v4h4M7 21v-4H3",
    terminal: "M4 17l6-5-6-5M12 19h8",
    upload: "M12 21V11m0 0-4 4m4-4 4 4M5 7V5h14v2",
  };

  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
