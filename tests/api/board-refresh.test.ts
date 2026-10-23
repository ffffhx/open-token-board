import assert from "node:assert/strict";
import { test } from "node:test";
import { subscribeToBoardRefresh } from "../../apps/web/components/token-leaderboard/refresh-subscription";

test("board refresh reacts to focus/visibility, throttles rapid focus, and cleans up", () => {
  let now = 60_000;
  let lastRequest = 0;
  let refreshed = 0;
  let ticked = 0;
  let interval: (() => void) | undefined;
  const host = Object.assign(new EventTarget(), {
    setInterval(callback: () => void, delay: number) { assert.equal(delay, 60_000); interval = callback; return 1; },
    clearInterval() { interval = undefined; },
  });
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  const cleanup = subscribeToBoardRefresh({ host, page, clock: () => now, lastRequestAt: () => lastRequest, onRefresh: () => { refreshed++; lastRequest = now; }, onTick: () => { ticked++; } });
  host.dispatchEvent(new Event("focus"));
  assert.equal(refreshed, 1);
  host.dispatchEvent(new Event("focus"));
  page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(refreshed, 1, "focus and visibility events do not trigger duplicate requests");
  page.visibilityState = "hidden";
  now += 60_000;
  interval!();
  assert.equal(ticked, 1, "age labels still advance");
  assert.equal(refreshed, 1, "hidden tabs do not poll the API");
  page.visibilityState = "visible";
  page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(refreshed, 2, "returning to the tab refreshes old data");
  now += 60_000;
  interval!();
  assert.equal(refreshed, 3, "visible tabs refresh on the interval");
  cleanup();
  now += 60_000;
  host.dispatchEvent(new Event("focus"));
  page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(refreshed, 3);
  assert.equal(interval, undefined);
});
