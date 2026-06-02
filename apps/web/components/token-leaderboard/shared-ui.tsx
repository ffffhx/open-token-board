import type { ToastState } from "./types";

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) {
    return null;
  }

  const tone =
    toast.tone === "error"
      ? "border-red-600/40 bg-red-50 text-red-900 shadow-sm ring-red-600/10"
      : "border-blue-600/40 bg-blue-50 text-blue-900 shadow-sm ring-blue-600/10";

  return (
    <div
      key={toast.id}
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed left-1/2 top-1/2 z-[100] flex min-h-12 min-w-[11rem] max-w-[min(15rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg border px-4 py-3 text-center text-sm font-semibold leading-5 ring-4 backdrop-blur-xl ${tone}`}
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

export function Icon({ name }: { name: "close" | "download" | "file" | "github" | "guide" | "logout" | "refresh" | "terminal" | "upload" }) {
  const paths = {
    close: "M18 6 6 18M6 6l12 12",
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
