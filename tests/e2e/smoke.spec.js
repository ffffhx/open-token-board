const fs = require("node:fs/promises");
const path = require("node:path");

const { expect, test } = require("@playwright/test");

const SESSION_COOKIE_NAME = "token_board_session";
const e2eStatePath = path.resolve(__dirname, "..", ".tmp", "e2e-state.json");
const testAvatarPath = path.resolve(__dirname, "../../apps/web/public/icons/icon-192.png");

let state;

test.beforeAll(async () => {
  state = JSON.parse(await fs.readFile(e2eStatePath, "utf8"));
});

test.beforeEach(async ({ context }) => {
  await context.route(/^https:\/\/github\.com\/[^/?#]+\.png(?:\?.*)?$/, (route) =>
    route.fulfill({
      path: testAvatarPath,
      contentType: "image/png",
    })
  );
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
    name: "legacy claude limits",
    path: () => "/claude-limits/",
    assertVisible: async (page) => {
      await expect(page.getByRole("heading", { name: "Claude Code 额度面板" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Claude Code" })).toHaveAttribute("aria-selected", "true");
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
  {
    name: "benchmark comparison",
    path: () => "/bench/",
    assertVisible: async (page) => {
      await expect(page.getByRole("link", { name: "对比总览" })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("heading", { name: "逐题对比" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "UI 还原对比" })).toBeVisible();
    },
  },
  {
    name: "codex benchmark",
    path: () => "/bench/codex/",
    assertVisible: async (page) => {
      await expect(page.getByRole("heading", { name: "Codex 智商与速度评测" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Codex 评测" })).toHaveAttribute("aria-current", "page");
    },
  },
  {
    name: "claude benchmark",
    path: () => "/bench/claude/",
    assertVisible: async (page) => {
      await expect(page.getByRole("heading", { name: "Claude Code 智商与速度评测" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Claude Code 评测" })).toHaveAttribute("aria-current", "page");
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

test("/board can switch to code-line metric and shows personal line cards", async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await gotoApp(page, "/board/", "light");

  const linesResponse = page.waitForResponse((response) => {
    const url = response.url();
    return url.includes("/api/usage/stats") && url.includes("metric=lines") && response.ok();
  });
  await page.getByRole("radio", { name: "代码行" }).click();
  const linesPayload = await (await linesResponse).json();

  expect(linesPayload.summary.totalLinesWritten).toBe(128);
  await expect(page.getByRole("radio", { name: "代码行" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("团队代码行")).toBeVisible();
  await expect(page.locator("#token-leaderboard-rankings")).toContainText("代码行");
  await expect(page.locator("#token-leaderboard-rankings")).toContainText("128");
  await expect(page.getByText("写入行数").first()).toBeVisible();
  await expect(page.getByText("当前区间成功写入 128 行").first()).toBeVisible();
  expect(cleanConsoleErrors(errors)).toEqual([]);
});

test("/limits switches between Codex, Claude Code, and team snapshots", async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await gotoApp(page, "/limits/", "light");

  await expect(page.getByRole("tab", { name: "Codex" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Codex 额度面板" })).toBeVisible();

  await page.getByRole("tab", { name: "Claude Code" }).click();
  await expect(page.getByRole("tab", { name: "Claude Code" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Claude Code 额度面板" })).toBeVisible();

  const teamResponse = page.waitForResponse((response) =>
    response.url().includes("/api/usage/rate-limits/team") && response.ok()
  );
  await page.getByRole("tab", { name: "团队" }).click();
  await teamResponse;
  await expect(page.getByRole("tab", { name: "团队" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "团队额度墙" })).toBeVisible();
  await expect(page.getByText(state.primaryLogin).first()).toBeVisible();
  await expect(page.getByText("bob-cache").first()).toBeVisible();
  expect(cleanConsoleErrors(errors)).toEqual([]);
});

test("language and theme persist across app navigation", async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await gotoApp(page, "/board/", "light");

  await page.getByRole("button", { name: "切换语言: English" }).click();
  await expect(page.getByRole("navigation", { name: "Page navigation" })).toBeVisible();
  await page.getByRole("switch", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.getByRole("link", { name: "Report", exact: true }).click();
  await expect(page).toHaveURL(/\/card\/?$/);
  await expect(page.getByRole("button", { name: "Save image" })).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("open-token-board:language"))).toBe("en");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("theme"))).toBe("dark");
  expect(cleanConsoleErrors(errors)).toEqual([]);
});

test("/u renders heatmap and badge copy action", async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await gotoApp(page, `/u/?login=${state.primaryLogin}`, "light");

  await expect(page.getByRole("img", { name: "近 365 天 Token 用量热力图" })).toBeVisible();
  await expect(page.getByRole("button", { name: "3D" })).toBeVisible();
  await expect(page.getByRole("button", { name: /复制徽章/ })).toBeVisible();
  expect(cleanConsoleErrors(errors)).toEqual([]);
});

test("/u switches between 2D and 3D contribution views and persists the choice", async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await gotoApp(page, `/u/?login=${state.primaryLogin}`, "light");

  await expect(page.getByRole("img", { name: "近 365 天 Token 用量热力图" })).toBeVisible();
  await page.getByRole("button", { name: "3D" }).click();
  await expect(page.getByRole("img", { name: /近 365 天 Token 用量 3D 等距贡献图/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("open-token-board:profile-contribution-view"))).toBe("3d");

  const activeDate = await page.locator("[data-contribution-3d-bar]").evaluateAll((nodes) => {
    const active = nodes.find((node) => Number(node.getAttribute("data-token-height")) > 0);
    return active?.getAttribute("data-contribution-3d-bar") || "";
  });
  expect(activeDate).toBeTruthy();
  await page.locator(`[data-contribution-3d-bar="${activeDate}"]`).hover();
  await expect(page.locator("section").filter({ has: page.getByRole("img", { name: /3D 等距贡献图/ }) })).toContainText(activeDate);

  await page.reload();
  await expect(page.getByRole("img", { name: /近 365 天 Token 用量 3D 等距贡献图/ })).toBeVisible();
  await page.getByRole("button", { name: "2D" }).click();
  await expect(page.getByRole("img", { name: "近 365 天 Token 用量热力图" })).toBeVisible();
  expect(cleanConsoleErrors(errors)).toEqual([]);
});

for (const language of ["zh", "en"]) {
  for (const theme of ["light", "dark"]) {
    test(`/u 3D contribution graph renders in ${language}/${theme}`, async ({ page }) => {
      const errors = trackConsoleErrors(page);
      await gotoApp(page, `/u/?login=${state.primaryLogin}`, theme, language);

      await page.getByRole("button", { name: "3D" }).click();
      await expect(page.getByRole("img", { name: /3D/ }).first()).toBeVisible();
      await expect(page.locator("[data-contribution-3d-bar]")).toHaveCount(365);
      expect(cleanConsoleErrors(errors)).toEqual([]);
    });
  }
}

test("/u 3D contribution graph keeps extreme token days readable", async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await page.route("**/api/usage/user**", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const daily365 = payload.profile.daily365.map((point, index) => ({
      ...point,
      tokens: index === 300 ? 10_000_000_000 : index % 6 === 0 ? 850_000 : 120_000,
    }));
    payload.profile.daily365 = daily365;
    payload.profile.totals.tokens = daily365.reduce((sum, point) => sum + point.tokens, 0);
    await route.fulfill({ response, json: payload });
  });

  await gotoApp(page, `/u/?login=${state.primaryLogin}`, "light");
  await page.getByRole("button", { name: "3D" }).click();
  const heights = await page.locator("[data-contribution-3d-bar]").evaluateAll((nodes) =>
    nodes.map((node) => Number(node.getAttribute("data-token-height"))).filter((height) => height > 0)
  );
  expect(heights).toHaveLength(365);
  const minHeight = Math.min(...heights);
  const maxHeight = Math.max(...heights);
  expect(maxHeight).toBeGreaterThan(68);
  expect(minHeight).toBeGreaterThan(30);
  expect(maxHeight / minHeight).toBeLessThan(2.5);
  expect(cleanConsoleErrors(errors)).toEqual([]);
});

test("/u share card can include the 3D contribution graph", async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await gotoApp(page, `/u/?login=${state.primaryLogin}`, "light");

  await page.getByRole("button", { name: /生成分享卡/ }).click();
  await expect(page.getByLabel("分享卡包含 3D 图")).toBeChecked();
  await expect(page.locator("[data-contribution-3d='true']")).toBeVisible();
  await page.getByLabel("分享卡包含 3D 图").uncheck();
  await expect(page.getByText("年度热力图")).toBeVisible();
  expect(cleanConsoleErrors(errors)).toEqual([]);
});

test("wrapped renders the period 3D thumbnail and share-card option", async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await gotoApp(page, `/wrapped/?login=${state.primaryLogin}&period=${state.currentMonthPeriod}`, "light");

  await expect(page.getByRole("img", { name: /Wrapped 周期 Token 用量 3D 等距贡献图/ })).toBeVisible();
  await expect(page.getByLabel("分享卡包含 3D 图")).toBeChecked();
  await expect(page.getByRole("img", { name: /周期每日 token 3D 等距贡献图/ })).toBeVisible();
  expect(cleanConsoleErrors(errors)).toEqual([]);
});

for (const languageCase of [
  {
    code: "zh",
    storyLabel: "AI 写的代码",
    storyText: /今年 AI 帮你写了\s*128\s*行/,
    shareLabel: "代码行",
  },
  {
    code: "en",
    storyLabel: "AI-written code",
    storyText: /AI wrote\s*128\s*lines/,
    shareLabel: "Code lines",
  },
]) {
  for (const theme of ["light", "dark"]) {
    test(`wrapped shows code-line copy in ${languageCase.code}/${theme}`, async ({ page }) => {
      const errors = trackConsoleErrors(page);
      await gotoApp(page, `/wrapped/?login=${state.primaryLogin}&period=${state.currentMonthPeriod}`, theme, languageCase.code);

      await expect(page.getByText(languageCase.storyLabel).first()).toBeVisible();
      await expect(page.getByText(languageCase.storyText).first()).toBeVisible();
      await expect(page.getByText(languageCase.shareLabel).first()).toBeVisible();
      expect(cleanConsoleErrors(errors)).toEqual([]);
    });
  }
}

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

test("/u 3D contribution graph has no horizontal overflow at 390px", async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("open-token-board:profile-contribution-view", "3d");
  });
  await gotoApp(page, `/u/?login=${state.primaryLogin}`, "light");

  await expect(page.getByRole("img", { name: /3D 等距贡献图/ })).toBeVisible();
  const overflow = await page.evaluate(() => {
    const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    return documentWidth - document.documentElement.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
  expect(cleanConsoleErrors(errors)).toEqual([]);
});

async function gotoApp(page, pathname, theme, language = "zh") {
  await page.addInitScript(({ nextLanguage, nextTheme }) => {
    window.localStorage.setItem("theme", nextTheme);
    window.localStorage.setItem("open-token-board:language", nextLanguage);
  }, { nextLanguage: language, nextTheme: theme });
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
