import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyOAuthState } from "../../packages/token-board-core/src/token-board-auth";
import { TEST_AUTH_SECRET } from "../support/fixtures";
import { startTokenBoardHarness } from "../support/harness";

const PAGES_ORIGIN = "https://ffffhx.github.io";

test("loopback origins allow any port without accepting lookalike hosts", async () => {
  const harness = await startTokenBoardHarness({
    allowedOrigins: [PAGES_ORIGIN],
    allowedReturnOrigins: [PAGES_ORIGIN],
    allowLoopbackOrigins: true,
    githubClientId: "test-github-client",
  });

  try {
    for (const origin of ["http://localhost:3001", "http://127.0.0.1:43127", "https://[::1]:8443"]) {
      const response = await fetch(`${harness.apiUrl}/api/usage/health`, {
        headers: { Origin: origin },
      });

      assert.equal(response.headers.get("access-control-allow-origin"), origin);
      assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    }

    const lookalikeOrigin = "http://localhost.evil.example:3001";
    const rejected = await fetch(`${harness.apiUrl}/api/usage/health`, {
      headers: { Origin: lookalikeOrigin },
    });
    assert.equal(rejected.headers.get("access-control-allow-origin"), PAGES_ORIGIN);
    assert.equal(rejected.headers.get("access-control-allow-credentials"), null);

    const returnTo = "http://localhost:43127/speed/?range=30d";
    const logout = await fetch(
      `${harness.apiUrl}/api/auth/logout?returnTo=${encodeURIComponent(returnTo)}`,
      { redirect: "manual" }
    );
    assert.equal(logout.headers.get("location"), returnTo);

    const githubStart = await fetch(
      `${harness.apiUrl}/api/auth/github/start?returnTo=${encodeURIComponent(returnTo)}`,
      { redirect: "manual" }
    );
    const githubLocation = new URL(assertString(githubStart.headers.get("location")));
    assert.equal(githubLocation.origin, "https://github.com");
    assert.equal(githubLocation.searchParams.get("client_id"), "test-github-client");
    const state = verifyOAuthState(assertString(githubLocation.searchParams.get("state")), TEST_AUTH_SECRET);
    assert.equal(state?.returnTo, returnTo);

    const rejectedReturnTo = `${lookalikeOrigin}/speed/`;
    const rejectedLogout = await fetch(
      `${harness.apiUrl}/api/auth/logout?returnTo=${encodeURIComponent(rejectedReturnTo)}`,
      { redirect: "manual" }
    );
    assert.equal(rejectedLogout.headers.get("location"), "/");
  } finally {
    await harness.close();
  }
});

function assertString(value: string | null): string {
  assert.ok(value);
  return value;
}
