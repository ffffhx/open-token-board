import { once } from "node:events";
import path from "node:path";
import { spawn } from "node:child_process";
import { inflateSync } from "node:zlib";

import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { repoRoot, startTokenBoardHarness, type TokenBoardHarness } from "../tests/support/harness";
import { startStaticServer, type StaticServer } from "../tests/support/static-server";
import { SESSION_COOKIE_NAME } from "../tests/support/fixtures";

type AuditPage = {
  name: string;
  path: (state: AuditState) => string;
};

type AuditState = {
  currentMonthPeriod: string;
  primaryLogin: string;
  webSessionToken: string;
};

type ViewportCase = {
  name: "desktop" | "mobile";
  height: number;
  width: number;
};

type ThemeCase = "light" | "dark";

type ContrastFailure = {
  actual: number;
  background: string;
  color: string;
  required: number;
  selector: string;
  text: string;
};

type TargetFailure = {
  height: number;
  label: string;
  selector: string;
  width: number;
};

type Rgba = { a: number; b: number; g: number; r: number };

type ContrastCandidate = {
  color: Rgba;
  deviceScaleFactor: number;
  rect: { height: number; width: number; x: number; y: number };
  required: number;
  selector: string;
  text: string;
};

type PngImage = {
  data: Uint8Array;
  height: number;
  width: number;
};

const auditPages: AuditPage[] = [
  { name: "home", path: () => "/" },
  { name: "board", path: () => "/board/" },
  { name: "profile", path: (state) => `/u/?login=${state.primaryLogin}` },
  { name: "limits", path: () => "/limits/" },
  { name: "wrapped", path: (state) => `/wrapped/?login=${state.primaryLogin}&period=${state.currentMonthPeriod}` },
  { name: "card", path: (state) => `/card/?range=7D&user=${state.primaryLogin}` },
];

const viewportCases: ViewportCase[] = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];

const themeCases: ThemeCase[] = ["light", "dark"];
const maxFailuresToPrint = 20;
const auditHelpersScript = String.raw`
(() => {
  function isVisibleForAudit(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      style.opacity !== "0" &&
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-disabled") !== "true"
    );
  }

  function accessibleLabel(element) {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) {
      return ariaLabel.replace(/\s+/g, " ").trim();
    }

    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) {
        return text;
      }
    }

    return (element.textContent || element.getAttribute("title") || element.getAttribute("name") || element.tagName.toLowerCase())
      .replace(/\s+/g, " ")
      .trim();
  }

  function elementTag(element) {
    const id = element.id ? "#" + element.id : "";
    const role = element.getAttribute("role") ? '[role="' + element.getAttribute("role") + '"]' : "";
    return element.tagName.toLowerCase() + id + role;
  }

  function describeActiveElement() {
    const element = document.activeElement;
    if (!element || element === document.body) {
      return "body";
    }
    const role = element.getAttribute("role") || element.tagName.toLowerCase();
    const label = accessibleLabel(element);
    return (role + ":" + (label || elementTag(element))).slice(0, 100);
  }

  window.__openTokenBoardAudit = {
    accessibleLabel,
    describeActiveElement,
    elementTag,
    isVisibleForAudit,
  };
})();
`;

async function main() {
  let harness: TokenBoardHarness | undefined;
  let staticServer: StaticServer | undefined;
  let browser: Browser | undefined;

  try {
    harness = await startTokenBoardHarness();
    await buildWeb(harness.apiUrl);
    staticServer = await startStaticServer(path.join(repoRoot, "apps", "web", "out"));
    browser = await chromium.launch();

    const state: AuditState = {
      currentMonthPeriod: harness.fixture.currentMonthPeriod,
      primaryLogin: harness.fixture.primaryLogin,
      webSessionToken: harness.webSessionToken,
    };

    const contrastFailures: Array<{ page: string; theme: ThemeCase; viewport: string; failures: ContrastFailure[] }> = [];
    const targetFailures: Array<{ page: string; theme: ThemeCase; viewport: string; failures: TargetFailure[] }> = [];

    for (const viewport of viewportCases) {
      for (const theme of themeCases) {
        const context = await newAuditContext(browser, viewport, state);
        const page = await context.newPage();

        for (const auditPage of auditPages) {
          await gotoAuditPage(page, staticServer.url, auditPage.path(state), theme);
          const contrast = await runContrastCheck(page);
          const targets = await runTouchTargetCheck(page);

          if (contrast.length) {
            contrastFailures.push({ page: auditPage.name, theme, viewport: viewport.name, failures: contrast });
          }
          if (targets.length) {
            targetFailures.push({ page: auditPage.name, theme, viewport: viewport.name, failures: targets });
          }

          console.log(
            `[a11y] ${auditPage.name.padEnd(8)} ${theme.padEnd(5)} ${viewport.name.padEnd(7)} contrast=${contrast.length ? "FAIL" : "PASS"} targets=${targets.length ? "FAIL" : "PASS"}`
          );
        }

        await context.close();
      }
    }

    const keyboardContext = await newAuditContext(browser, viewportCases[0], state);
    const keyboardPage = await keyboardContext.newPage();
    console.log("\n[keyboard] first tab stops, desktop/light");
    for (const auditPage of auditPages) {
      await gotoAuditPage(keyboardPage, staticServer.url, auditPage.path(state), "light");
      const stops = await collectTabStops(keyboardPage, 18);
      console.log(`${auditPage.name}: ${stops.join(" -> ")}`);
    }
    await keyboardContext.close();

    if (contrastFailures.length || targetFailures.length) {
      printFailures("contrast", contrastFailures);
      printFailures("targets", targetFailures);
      process.exitCode = 1;
      return;
    }

    console.log("\n[a11y] PASS: contrast and 44px target checks passed for 6 pages x 2 themes x 2 viewports.");
  } finally {
    await browser?.close().catch(() => undefined);
    await staticServer?.close().catch(() => undefined);
    await harness?.close().catch(() => undefined);
  }
}

async function buildWeb(apiUrl: string) {
  const child = spawn("pnpm", ["--filter", "@open-token-board/web", "build"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NEXT_PUBLIC_TOKEN_BOARD_API_URL: apiUrl,
      PAGES_BASE_PATH: "",
    },
    stdio: "inherit",
  });
  const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];

  if (code !== 0) {
    throw new Error(`web build failed with ${signal || `exit code ${code}`}`);
  }
}

async function newAuditContext(browser: Browser, viewport: ViewportCase, state: AuditState): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
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
  return context;
}

async function gotoAuditPage(page: Page, baseUrl: string, pathname: string, theme: ThemeCase) {
  await page.addInitScript((nextTheme) => {
    window.localStorage.setItem("theme", nextTheme);
  }, theme);
  await page.goto(`${baseUrl}${pathname}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await installAuditHelpers(page);
}

async function installAuditHelpers(page: Page) {
  await page.addScriptTag({ content: auditHelpersScript });
}

async function collectTabStops(page: Page, count: number) {
  const stops: string[] = [];
  await page.keyboard.press("Home").catch(() => undefined);
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press("Tab");
    const label = await page.evaluate(() => window.__openTokenBoardAudit?.describeActiveElement() || "");
    if (!label || label === stops.at(-1)) {
      continue;
    }
    stops.push(label);
  }
  return stops;
}

async function runContrastCheck(page: Page): Promise<ContrastFailure[]> {
  const candidates = await page.evaluate(() => {
    const selector =
      "body, h1, h2, h3, h4, h5, h6, p, span, li, a, button, label, dt, dd, th, td, caption, input, select, textarea, [role='button'], [role='tab'], [role='switch'], [role='radio']";
    const candidates: ContrastCandidate[] = [];
    const seenText = new Set<string>();
    const audit = window.__openTokenBoardAudit;

    if (!audit) {
      throw new Error("Audit helpers were not installed");
    }

    for (const element of candidates) {
      if (!audit.isVisibleForAudit(element) || element.closest("[aria-hidden='true']")) {
        continue;
      }

      const text = visibleText(element);
      if (!text) {
        continue;
      }

      const style = window.getComputedStyle(element);
      const color = parseColor(style.color);
      if (!color || color.a < 0.95) {
        continue;
      }

      const fontSize = Number.parseFloat(style.fontSize);
      const fontWeight = Number.parseInt(style.fontWeight, 10);
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const required = isLarge ? 3 : 4.5;
      const rect = element.getBoundingClientRect();
      const key = `${audit.elementTag(element)}:${text}:${style.color}:${Math.round(rect.x)}:${Math.round(rect.y)}`;

      if (!seenText.has(key)) {
        seenText.add(key);
        candidates.push({
          color,
          deviceScaleFactor: window.devicePixelRatio || 1,
          rect: {
            height: rect.height,
            width: rect.width,
            x: rect.x,
            y: rect.y,
          },
          required,
          selector: audit.elementTag(element),
          text: text.slice(0, 90),
        });
      }
    }

    return candidates;

    function visibleText(element: HTMLElement) {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return element.value || element.placeholder || element.getAttribute("aria-label") || "";
      }
      if (element instanceof HTMLSelectElement) {
        return element.selectedOptions[0]?.textContent?.trim() || element.getAttribute("aria-label") || "";
      }
      return (element.innerText || element.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
    }

    function parseColor(input: string): Rgba | null {
      const rgba = input.match(/^rgba?\(([^)]+)\)$/);
      if (!rgba) {
        return null;
      }

      const parts = rgba[1].split(/[,\s/]+/).filter(Boolean);
      const [r, g, b] = parts.slice(0, 3).map(Number);
      const a = parts[3] === undefined ? 1 : Number(parts[3]);
      if (![r, g, b, a].every(Number.isFinite)) {
        return null;
      }
      return { r, g, b, a };
    }
  });

  const screenshot = await page.screenshot({ animations: "disabled" });
  const image = decodePng(screenshot);
  const failures: ContrastFailure[] = [];

  for (const candidate of candidates) {
    const sampled = sampleBestBackground(image, candidate);
    if (!sampled) {
      continue;
    }

    if (sampled.actual + 0.005 < candidate.required) {
      failures.push({
        actual: round2(sampled.actual),
        background: rgbaToString(sampled.background),
        color: rgbaToString(candidate.color),
        required: candidate.required,
        selector: candidate.selector,
        text: candidate.text,
      });
    }
  }

  return failures;
}

function sampleBestBackground(image: PngImage, candidate: ContrastCandidate): { actual: number; background: Rgba } | null {
  const scale = candidate.deviceScaleFactor || 1;
  const left = Math.max(0, Math.floor(candidate.rect.x * scale));
  const top = Math.max(0, Math.floor(candidate.rect.y * scale));
  const right = Math.min(image.width - 1, Math.ceil((candidate.rect.x + candidate.rect.width) * scale));
  const bottom = Math.min(image.height - 1, Math.ceil((candidate.rect.y + candidate.rect.height) * scale));
  const inset = Math.max(2, Math.round(3 * scale));
  const points = [
    [left + inset, top + inset],
    [right - inset, top + inset],
    [left + inset, bottom - inset],
    [right - inset, bottom - inset],
    [Math.round((left + right) / 2), top + inset],
    [Math.round((left + right) / 2), bottom - inset],
    [left + inset, Math.round((top + bottom) / 2)],
    [right - inset, Math.round((top + bottom) / 2)],
    [Math.round((left + right) / 2), Math.round((top + bottom) / 2)],
  ];

  let best: { actual: number; background: Rgba } | null = null;
  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
      continue;
    }
    const background = pixelAt(image, x, y);
    const actual = contrastRatio(candidate.color, background);
    if (!best || actual > best.actual) {
      best = { actual, background };
    }
  }
  return best;
}

function decodePng(buffer: Buffer): PngImage {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("Expected PNG screenshot");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth} colorType=${colorType}`);
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const stride = width * bytesPerPixel;
  const data = new Uint8Array(width * height * 4);
  let inputOffset = 0;
  let previous = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const current = new Uint8Array(stride);

    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[inputOffset + x];
      const left = x >= bytesPerPixel ? current[x - bytesPerPixel] : 0;
      const up = previous[x] || 0;
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] || 0 : 0;
      current[x] = unfilterByte(filter, raw, left, up, upLeft);
    }
    inputOffset += stride;

    for (let x = 0; x < width; x += 1) {
      const source = x * bytesPerPixel;
      const target = (y * width + x) * 4;
      data[target] = current[source];
      data[target + 1] = current[source + 1];
      data[target + 2] = current[source + 2];
      data[target + 3] = colorType === 6 ? current[source + 3] : 255;
    }

    previous = current;
  }

  return { data, height, width };
}

function unfilterByte(filter: number, raw: number, left: number, up: number, upLeft: number) {
  switch (filter) {
    case 0:
      return raw;
    case 1:
      return (raw + left) & 0xff;
    case 2:
      return (raw + up) & 0xff;
    case 3:
      return (raw + Math.floor((left + up) / 2)) & 0xff;
    case 4:
      return (raw + paeth(left, up, upLeft)) & 0xff;
    default:
      throw new Error(`Unsupported PNG filter: ${filter}`);
  }
}

function paeth(left: number, up: number, upLeft: number) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }
  return upDistance <= upLeftDistance ? up : upLeft;
}

function pixelAt(image: PngImage, x: number, y: number): Rgba {
  const offset = (y * image.width + x) * 4;
  const alpha = image.data[offset + 3] / 255;
  const raw = {
    r: image.data[offset],
    g: image.data[offset + 1],
    b: image.data[offset + 2],
    a: alpha,
  };
  return alpha >= 1 ? raw : blend(raw, { r: 255, g: 255, b: 255, a: 1 });
}

function blend(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground.a + background.a * (1 - foreground.a);
  if (alpha <= 0) {
    return { r: 255, g: 255, b: 255, a: 1 };
  }
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha,
  };
}

function contrastRatio(foreground: Rgba, background: Rgba) {
  const l1 = luminance(foreground);
  const l2 = luminance(background);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function luminance(color: Rgba) {
  const channels = [color.r, color.g, color.b].map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function rgbaToString(color: Rgba) {
  return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

async function runTouchTargetCheck(page: Page): Promise<TargetFailure[]> {
  return page.evaluate(() => {
    type Failure = { height: number; label: string; selector: string; width: number };
    const selector = "button, input, select, textarea, [role='button'], [role='tab'], [role='switch'], [role='radio']";
    const failures: Failure[] = [];
    const audit = window.__openTokenBoardAudit;

    if (!audit) {
      throw new Error("Audit helpers were not installed");
    }

    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (!audit.isVisibleForAudit(element) || element.closest("[aria-hidden='true']")) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width >= 44 && rect.height >= 44) {
        continue;
      }
      failures.push({
        height: Math.round(rect.height),
        label: audit.accessibleLabel(element).slice(0, 90),
        selector: audit.elementTag(element),
        width: Math.round(rect.width),
      });
    }

    return failures;
  });
}

function printFailures(
  label: string,
  groups: Array<{ page: string; theme: ThemeCase; viewport: string; failures: Array<Record<string, unknown>> }>
) {
  if (!groups.length) {
    return;
  }

  console.log(`\n[${label}] failures`);
  let printed = 0;
  for (const group of groups) {
    for (const failure of group.failures) {
      if (printed >= maxFailuresToPrint) {
        console.log(`[${label}] ... truncated after ${maxFailuresToPrint} failures`);
        return;
      }
      console.log(`${group.page}/${group.theme}/${group.viewport}: ${JSON.stringify(failure)}`);
      printed += 1;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

declare global {
  interface Window {
    __openTokenBoardAudit?: {
      accessibleLabel: (element: Element) => string;
      describeActiveElement: () => string;
      elementTag: (element: Element) => string;
      isVisibleForAudit: (element: HTMLElement) => boolean;
    };
  }
}
