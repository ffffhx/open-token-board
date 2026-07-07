const fs = require("node:fs/promises");
const path = require("node:path");

const { expect, test } = require("@playwright/test");

const SESSION_COOKIE_NAME = "token_board_session";
const e2eStatePath = path.resolve(__dirname, "..", ".tmp", "e2e-state.json");

let state;

test.beforeAll(async () => {
  state = JSON.parse(await fs.readFile(e2eStatePath, "utf8"));
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: state.webSessionToken,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
      expires: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    },
  ]);
});

const smokePages = [
  {
    name: "home",
    path: () => "/",
    assertVisible: async (page) => {
      await expect(page.getByRole("heading", { name: "Open Token Board" })).toBeVisible();
      await expect(page.getByRole("link", { name: "看实时榜单" })).toBeVisible();
    },
  },
  {
    name: "board",
    path: () => "/board/",
    assertVisible: async (page) => {
      await expect(page.getByRole("heading", { name: "朋友间的 Token 排行榜" })).toBeVisible();
      await expect(page.locator("#token-leaderboard-rankings")).toContainText("排行榜");
      await expect(page.getByText("总消耗 Token").first()).toBeVisible();
    },
  },
  {
    name: "public profile",
    path: (state) => `/u/?login=${state.primaryLogin}`,
    assertVisible: async (page, state) => {
      await expect(page.getByText(`@${state.primaryLogin}`).first()).toBeVisible();
      await expect(page.getByRole("img", { name: "近 365 天 Token 用量热力图" })).toBeVisible();
      await expect(page.getByRole("button", { name: /复制徽章/ })).toBeVisible();
    },
  },
  {
    name: "limits",
    path: () => "/limits/",
    assertVisible: async (page) => {
      await expect(page.getByRole("heading", { name: "Codex 额度面板" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "团队" })).toBeVisible();
      await expect(page.getByText("每周").first()).toBeVisible();
    },
  },
  {
    name: "wrapped",
    path: (state) => `/wrapped/?login=${state.primaryLogin}&period=${state.currentMonthPeriod}`,
    assertVisible: async (page, state) => {
      await expect(page.getByText(`@${state.primaryLogin}`).first()).toBeVisible();
      await expect(page.getByRole("heading", { name: /你把这个周期烧成了/ })).toBeVisible();
    },
  },
  {
    name: "card",
    path: (state) => `/card/?range=7D&user=${state.primaryLogin}`,
    assertVisible: async (page) => {
      await expect(page.getByRole("button", { name: /保存为图片/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /查看完整榜单/ })).toBeVisible();
    },
  },
];

for (const theme of ["light", "dark"]) {
  for (const smokePage of smokePages) {
    test(`${smokePage.name} renders in ${theme} theme without console errors`, async ({ page }) => {
      const errors = trackConsoleErrors(page);
      await gotoApp(page, smokePage.path(state), theme);
      await smokePage.assertVisible(page, state);
      expect(cleanConsoleErrors(errors)).toEqual([]);
    });
  }
}

test("/board updates range, metric chart, and hourly drilldown", async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await gotoApp(page, "/board/", "light");

  const leaderboard = page.locator("#token-leaderboard-rankings");
  await expect(leaderboard).toContainText(state.primaryLogin);
  const initialLeaderboardText = await leaderboard.innerText();

  const monthResponse = page.waitForResponse((response) => {
    const url = response.url();
    return url.includes("/api/usage/stats") && url.includes("range=month") && response.ok();
  });
  await page.getByRole("radio", { name: "本月" }).click();
  const monthPayload = await (await monthResponse).json();
  await expect.poll(() => leaderboard.innerText()).not.toBe(initialLeaderboardText);
  expect(monthPayload.summary.range).toBe("month");

  const costResponse = page.waitForResponse((response) => {
    const url = response.url();
    return url.includes("/api/usage/stats") && url.includes("metric=cost") && response.ok();
  });
  await page.getByRole("button", { name: /估算费用/ }).click();
  const costPayload = await (await costResponse).json();
  expect(costPayload.summary.range).toBe("month");
  await expect(page.getByRole("img", { name: /费用日趋势/ })).toBeVisible();

  await page.locator("[data-token-trend-point]").last().click({ force: true });
  await expect(page.getByRole("heading", { name: /小时分布/ })).toBeVisible();
  await expect(page.locator("span").filter({ hasText: /^24 小时$/ })).toBeVisible();
  expect(cleanConsoleErrors(errors)).toEqual([]);
});

test("/u renders heatmap and badge copy action", async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await gotoApp(page, `/u/?login=${state.primaryLogin}`, "light");

  await expect(page.getByRole("img", { name: "近 365 天 Token 用量热力图" })).toBeVisible();
  await expect(page.getByRole("button", { name: /复制徽章/ })).toBeVisible();
  expect(cleanConsoleErrors(errors)).toEqual([]);
});

for (const target of [
  { name: "/board/", path: () => "/board/" },
  { name: "/u/", path: (state) => `/u/?login=${state.primaryLogin}` },
]) {
  test(`${target.name} has no horizontal overflow at 390px`, async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApp(page, target.path(state), "light");

    await expect(page.locator("body")).toBeVisible();
    const overflow = await page.evaluate(() => {
      const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      return documentWidth - document.documentElement.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
    expect(cleanConsoleErrors(errors)).toEqual([]);
  });
}

async function gotoApp(page, pathname, theme) {
  await page.addInitScript((nextTheme) => {
    window.localStorage.setItem("theme", nextTheme);
  }, theme);
  await page.goto(`${state.webUrl}${pathname}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
}

function trackConsoleErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  return errors;
}

function cleanConsoleErrors(errors) {
  return errors.filter((error) => !/favicon\.ico/.test(error));
}
