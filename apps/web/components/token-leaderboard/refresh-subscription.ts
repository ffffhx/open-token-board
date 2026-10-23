type RefreshOptions = {
  host: Pick<Window, "addEventListener" | "removeEventListener" | "setInterval" | "clearInterval">;
  page: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  lastRequestAt: () => number;
  onRefresh: () => void;
  onTick: (now: number) => void;
  clock?: () => number;
};

export function subscribeToBoardRefresh({ host, page, lastRequestAt, onRefresh, onTick, clock = Date.now }: RefreshOptions) {
  const refresh = () => {
    if (page.visibilityState === "visible" && clock() - lastRequestAt() >= 15_000) onRefresh();
  };
  const timer = host.setInterval(() => { onTick(clock()); refresh(); }, 60_000);
  host.addEventListener("focus", refresh);
  page.addEventListener("visibilitychange", refresh);
  return () => {
    host.clearInterval(timer);
    host.removeEventListener("focus", refresh);
    page.removeEventListener("visibilitychange", refresh);
  };
}
