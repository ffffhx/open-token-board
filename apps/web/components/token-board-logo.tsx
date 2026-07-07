type TokenBoardLogoMarkProps = {
  className?: string;
  decorative?: boolean;
};

export function TokenBoardLogoMark({
  className = "size-8",
  decorative = false,
}: TokenBoardLogoMarkProps) {
  return (
    <svg
      aria-hidden={decorative ? "true" : undefined}
      aria-label={decorative ? undefined : "Open Token Board logo"}
      className={className}
      fill="none"
      role={decorative ? undefined : "img"}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="otb-logo-energy" x1="8" x2="56" y1="8" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2F5BFF" />
          <stop offset=".52" stopColor="#8A3FFC" />
          <stop offset="1" stopColor="#00B8D9" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#otb-logo-energy)" />
      <path
        d="M23 20h16c7.2 0 13 5.8 13 13s-5.8 13-13 13H23"
        stroke="#FFFFFF"
        strokeLinecap="round"
        strokeWidth="6"
      />
      <path
        d="M24 25l-8 8 8 8"
        stroke="#DCE7FF"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="6"
      />
      <path d="M33 38V30" stroke="#FFFFFF" strokeLinecap="round" strokeWidth="5" />
      <path d="M42 38V25" stroke="#FFFFFF" strokeLinecap="round" strokeWidth="5" />
    </svg>
  );
}

export function TokenBoardLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${className}`}>
      <TokenBoardLogoMark className="size-8 shrink-0" decorative />
      <span className="truncate font-mono text-sm font-semibold uppercase tracking-normal">
        Open Token Board
      </span>
    </span>
  );
}
