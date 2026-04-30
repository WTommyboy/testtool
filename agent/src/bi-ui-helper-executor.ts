#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page, type Request, type Response } from "playwright";
import { closeChromeDebugSession, diagnoseChromeDebugSession, ensureChromeDebugSession, ensureSingleUserPageTab } from "./browser-session";
import { readConfig } from "./config";

type CliOptions = {
  runDir: string;
  caseId: string;
  action: string;
  params: Record<string, unknown>;
  approvedToolRequestId: string | null;
  closeAfter: boolean;
};

type HelperReport = {
  schemaVersion: "bi-ui-helper-report-v1";
  generatedAt: string;
  runId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  caseId: string;
  action: string;
  status: "ok" | "blocked" | "requires_approval" | "not_implemented" | "error";
  helperCanJudgeResult: false;
  params: Record<string, unknown>;
  evidenceMetadata: {
    source: "mac-agent-bi-ui-helper";
    runId: string;
    caseId: string;
    action: string;
    currentRunEvidence: true;
    artifactRoot: string;
    generatedAt: string;
    startedAt: string;
    endedAt: string;
  };
  evidence: Record<string, unknown>;
  artifacts: Record<string, string>;
  warnings: string[];
  error?: string;
  toolRequest?: Record<string, unknown>;
};

class HelperBlockedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "HelperBlockedError";
    this.reason = reason;
  }
}

const isActionabilityFailure = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /locator\.click|Timeout|not visible|not enabled|not stable|receives pointer events|outside of the viewport|strict mode violation/i.test(message);
};

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);
  const get = (name: string): string | null => {
    const index = args.indexOf(name);
    return index === -1 ? null : (args[index + 1] ?? null);
  };
  const paramsJson = get("--params-json") ?? "{}";
  let params: Record<string, unknown>;
  try {
    const parsed = JSON.parse(paramsJson) as unknown;
    params = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch (error) {
    throw new Error(`INVALID_PARAMS_JSON:${error instanceof Error ? error.message : String(error)}`);
  }

  const runDir = get("--run-dir");
  const action = get("--action");
  if (!runDir || !action) {
    throw new Error("Usage: node bi-ui-helper-executor.js --run-dir <runDir> --case <caseId> --action <template> --params-json '<json>' [--approved-tool-request-id <id>] [--close-after]");
  }

  return {
    runDir,
    caseId: get("--case") ?? String(params.caseId ?? "unknown-case"),
    action,
    params,
    approvedToolRequestId: get("--approved-tool-request-id"),
    closeAfter: args.includes("--close-after")
  };
};

const sanitize = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "artifact";

const ensureDir = (dir: string): void => {
  fs.mkdirSync(dir, { recursive: true });
};

const artifactRoot = (options: CliOptions): string => path.join(options.runDir, "output", "helper-artifacts", sanitize(options.caseId));

const runIdFromOptions = (options: CliOptions): string => path.basename(path.resolve(options.runDir));

const writeReport = (options: CliOptions, report: HelperReport): void => {
  const dir = artifactRoot(options);
  ensureDir(dir);
  fs.appendFileSync(path.join(dir, "helper-report.jsonl"), `${JSON.stringify(report)}\n`);
  fs.writeFileSync(path.join(dir, `${sanitize(options.action)}-latest.json`), `${JSON.stringify(report, null, 2)}\n`);
};

const stringParam = (params: Record<string, unknown>, key: string): string | null => {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const firstStringParam = (params: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = stringParam(params, key);
    if (value) return value;
  }
  return null;
};

const timestampId = (): string => new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 12);

const resolveReportName = (options: CliOptions): string => {
  const explicit = firstStringParam(options.params, ["reportName", "reportNamePattern", "name"]);
  if (explicit) return explicit.replace("<timestamp>", timestampId());
  return `${sanitize(options.caseId)}_${timestampId()}`;
};

const savedReportStatePath = (options: CliOptions): string => path.join(artifactRoot(options), "saved-report.json");

const writeSavedReportState = (options: CliOptions, reportName: string, extra: Record<string, unknown> = {}): void => {
  ensureDir(artifactRoot(options));
  fs.writeFileSync(
    savedReportStatePath(options),
    `${JSON.stringify({ reportName, caseId: options.caseId, savedAt: new Date().toISOString(), ...extra }, null, 2)}\n`
  );
};

const readSavedReportName = (options: CliOptions): string | null => {
  const explicit = firstStringParam(options.params, ["reportName", "savedReportName", "name"]);
  if (explicit) return explicit;
  const filePath = savedReportStatePath(options);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as { reportName?: unknown };
    return typeof parsed.reportName === "string" && parsed.reportName.trim() ? parsed.reportName.trim() : null;
  } catch {
    return null;
  }
};

const createReport = (
  options: CliOptions,
  status: HelperReport["status"],
  startedAt: string,
  evidence: Record<string, unknown>,
  artifacts: Record<string, string>,
  warnings: string[] = [],
  extra: Partial<HelperReport> = {}
): HelperReport => {
  const generatedAt = new Date().toISOString();
  const endedAt = generatedAt;
  const runId = runIdFromOptions(options);
  return {
    schemaVersion: "bi-ui-helper-report-v1",
    generatedAt,
    runId,
    startedAt,
    endedAt,
    durationMs: Math.max(0, Date.now() - Date.parse(startedAt)),
    caseId: options.caseId,
    action: options.action,
    status,
    helperCanJudgeResult: false,
    params: options.params,
    evidenceMetadata: {
      source: "mac-agent-bi-ui-helper",
      runId,
      caseId: options.caseId,
      action: options.action,
      currentRunEvidence: true,
      artifactRoot: artifactRoot(options),
      generatedAt,
      startedAt,
      endedAt
    },
    evidence,
    artifacts,
    warnings,
    ...extra
  };
};

const getGalaxyPage = async (browser: Browser): Promise<Page> => {
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const pages = context.pages();
  const applicationPages = pages.filter((page) => /^https?:\/\//i.test(page.url()));
  return pages.find((page) => page.url().includes("galaxy.games.gamania.com")) ?? applicationPages[0] ?? (await context.newPage());
};

const isApplicationPage = (page: Page): boolean => /^https?:\/\//i.test(page.url());

const screenshot = async (options: CliOptions, page: Page, label: string): Promise<string | null> => {
  const filePath = path.join(artifactRoot(options), `${sanitize(options.caseId)}-${sanitize(label)}.png`);
  ensureDir(path.dirname(filePath));
  try {
    await page.screenshot({ path: filePath, fullPage: false, timeout: 7000 });
    return filePath;
  } catch {
    return null;
  }
};

const readDomState = async (page: Page): Promise<Record<string, unknown>> => {
  return page.evaluate(() => {
    const text = (selector: string) => document.querySelector(selector)?.textContent?.trim() ?? null;
    const innerText = (selector: string) => (document.querySelector(selector) as HTMLElement | null)?.innerText?.trim() ?? null;
    const buttons = Array.from(document.querySelectorAll("button"))
      .map((item) => item.textContent?.trim())
      .filter(Boolean)
      .slice(0, 80);
    const selects = Array.from(document.querySelectorAll("select")).map((select) => ({
      name: select.getAttribute("name"),
      value: (select as HTMLSelectElement).value,
      text: (select as HTMLSelectElement).selectedOptions?.[0]?.textContent?.trim() ?? null
    }));
    const displaySelect = selects.find((item) => item.name === "displayMode") ?? selects.find((item) => /每天|每日|daily/i.test(`${item.text ?? ""}\n${item.value}`));
    return {
      url: location.href,
      title: document.title,
      bodyTextExcerpt: document.body.innerText.slice(0, 2500),
      reportHeader: text("h1, h2, [class*=title], [class*=header]"),
      cleanupState: {
        dateRangeText: innerText("#dateRangeBtn"),
        fieldSelectionText: innerText("#fieldSelectionContainer"),
        filterText: innerText("#dataFilterContainer"),
        groupText: innerText("#groupDimensionContainer"),
        displayModeValue: displaySelect?.value ?? null,
        displayModeText: displaySelect?.text ?? null
      },
      buttons,
      selects
    };
  });
};

const normalizeDateText = (value: string): string => value.replace(/\s+/g, "").replaceAll("-", "/");
const normalizeUiText = (value: string): string => value.replace(/\s+/g, "");

type CalendarSide = "left" | "right";
type VisibleButton = { index: number; text: string; x: number; y: number; width: number; height: number };
type VisibleTextTarget = {
  index: number;
  text: string;
  tagName: string;
  role: string | null;
  className: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
type VisibleMonthLabel = { text: string; year: number; month: number; x: number; y: number; width: number; height: number };

const parseDateRange = (value: string | null): { startIso: string; endIso: string; display: string } | null => {
  if (!value) return null;
  const matches = [...value.matchAll(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/g)];
  if (matches.length < 2) return null;
  const toIso = (match: RegExpMatchArray): string => {
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  };
  const startIso = toIso(matches[0]);
  const endIso = toIso(matches[1]);
  return {
    startIso,
    endIso,
    display: `${startIso.replaceAll("-", "/")} ~ ${endIso.replaceAll("-", "/")}`
  };
};

const bodyContainsDateRange = async (page: Page, display: string): Promise<boolean> => {
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return normalizeDateText(bodyText).includes(normalizeDateText(display));
};

const bodyContainsText = async (page: Page, expected: string): Promise<boolean> => {
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return normalizeUiText(bodyText).includes(normalizeUiText(expected));
};

const parseCleanupTargets = (value: unknown): Record<string, string> => {
  if (typeof value !== "string") return {};
  const result: Record<string, string> = {};
  for (const part of value.split(";")) {
    const [key, ...rest] = part.split("=");
    const normalizedKey = key?.trim();
    if (!normalizedKey) continue;
    const normalizedValue = rest.join("=").trim();
    if (normalizedValue) result[normalizedKey] = normalizedValue;
  }
  return result;
};

const targetStateFromParams = (params: Record<string, unknown>): Record<string, string | null> => {
  const cleanup = parseCleanupTargets(params.cleanupChecklist);
  return {
    field: stringParam(params, "field") ?? cleanup["欄位"] ?? null,
    filter: cleanup["篩選"] ?? null,
    group: cleanup["分組"] ?? null,
    dateRange: stringParam(params, "dateRange") ?? cleanup["時間"] ?? null,
    display: stringParam(params, "display") ?? cleanup["顯示"] ?? null
  };
};

const readStateDelta = async (page: Page, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const targets = targetStateFromParams(params);
  const observed = await page.evaluate(() => {
    const innerText = (selector: string) => (document.querySelector(selector) as HTMLElement | null)?.innerText?.trim() ?? null;
    const selects = Array.from(document.querySelectorAll("select")).map((select) => ({
      name: select.getAttribute("name"),
      value: (select as HTMLSelectElement).value,
      text: (select as HTMLSelectElement).selectedOptions?.[0]?.textContent?.trim() ?? ""
    }));
    const displaySelect = selects.find((item) => item.name === "displayMode") ?? selects.find((item) => /每天|每日|daily/i.test(`${item.text}\n${item.value}`));
    return {
      url: location.href,
      bodyText: document.body.innerText.slice(0, 5000),
      dateRangeText: innerText("#dateRangeBtn"),
      fieldSelectionText: innerText("#fieldSelectionContainer"),
      filterText: innerText("#dataFilterContainer"),
      groupText: innerText("#groupDimensionContainer"),
      displayModeValue: displaySelect?.value ?? null,
      displayModeText: displaySelect?.text ?? null,
      selects
    };
  });
  const contains = (value: unknown, expected: string | null): boolean | null => {
    if (!expected || expected === "不限" || expected === "不影響") return null;
    if (typeof value !== "string") return false;
    return normalizeUiText(value).includes(normalizeUiText(expected));
  };
  return {
    targets,
    observed: {
      ...observed,
      bodyText: observed.bodyText.slice(0, 1200)
    },
    checks: {
      field: contains(`${observed.fieldSelectionText ?? ""}\n${observed.bodyText}`, targets.field),
      filter: targets.filter === "0組" || targets.filter === "空"
        ? null
        : contains(observed.filterText, targets.filter),
      group: targets.group === "0組" || targets.group === "空"
        ? null
        : contains(observed.groupText, targets.group),
      dateRange: contains(`${observed.dateRangeText ?? ""}\n${observed.bodyText}`, targets.dateRange),
      display: contains(`${observed.displayModeText ?? ""}\n${observed.displayModeValue ?? ""}\n${observed.bodyText}`, targets.display)
    },
    policy: "delta planner may skip only when visible UI text/value verifies the target; unknown or false must fall back to UI action or blocked"
  };
};

const clickFirstVisible = async (locators: Array<ReturnType<Page["locator"]>>, timeout = 5000): Promise<boolean> => {
  for (const locator of locators) {
    try {
      const first = locator.first();
      if ((await first.count()) === 0) continue;
      await first.click({ timeout });
      return true;
    } catch {
      // Try the next visible locator candidate.
    }
  }
  return false;
};

const visibleInputIndexes = async (page: Page): Promise<Array<{ index: number; type: string; placeholder: string; value: string }>> => {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("input")).flatMap((input, index) => {
      const rect = input.getBoundingClientRect();
      const style = window.getComputedStyle(input);
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      if (!visible || input.disabled || input.readOnly) return [];
      return [{
        index,
        type: input.type,
        placeholder: input.placeholder,
        value: input.value
      }];
    });
  });
};

const visibleButtons = async (page: Page): Promise<VisibleButton[]> => {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("button")).flatMap((button, index) => {
      const rect = button.getBoundingClientRect();
      const style = window.getComputedStyle(button);
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      if (!visible || button.disabled) return [];
      return [{
        index,
        text: (button.textContent ?? "").trim().replace(/\s+/g, " "),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      }];
    });
  });
};

const visibleExactTextTargets = async (page: Page, expectedText: string): Promise<VisibleTextTarget[]> => {
  return page.evaluate((targetText) => {
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
    const elements = Array.from(document.querySelectorAll("body *"));
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
    };
    return elements.flatMap((element, index) => {
      if (!(element instanceof HTMLElement)) return [];
      const text = normalize(element.textContent);
      if (text !== targetText) return [];
      const hasExactVisibleChild = Array.from(element.children).some((child) => normalize(child.textContent) === targetText && isVisible(child));
      if (hasExactVisibleChild) return [];
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const className = typeof element.className === "string" ? element.className : "";
      const ariaDisabled = element.getAttribute("aria-disabled") === "true";
      const disabled = "disabled" in element && Boolean((element as HTMLButtonElement).disabled);
      const visuallyDisabled = /disabled|disable|unavailable|outside|other-month/i.test(className) || Number.parseFloat(style.opacity || "1") < 0.35;
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      if (!visible || ariaDisabled || disabled || visuallyDisabled) return [];
      return [
        {
          index,
          text,
          tagName: element.tagName.toLowerCase(),
          role: element.getAttribute("role"),
          className,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        }
      ];
    });
  }, expectedText);
};

const visibleCalendarMonths = async (page: Page): Promise<VisibleMonthLabel[]> => {
  return page.evaluate(() => {
    const monthMap: Record<string, number> = {
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
      十: 10,
      十一: 11,
      十二: 12
    };
    const seen = new Set<string>();
    return Array.from(document.querySelectorAll("body *")).flatMap((element) => {
      const text = (element.textContent ?? "").trim().replace(/\s+/g, " ");
      const match = text.match(/^([一二三四五六七八九十]{1,2})月\s+(\d{4})$/);
      if (!match) return [];
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      const month = monthMap[match[1] ?? ""];
      if (!visible || !month) return [];
      const key = `${text}:${Math.round(rect.x)}:${Math.round(rect.y)}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        text,
        year: Number(match[2]),
        month,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      }];
    });
  });
};

const monthDiff = (from: Pick<VisibleMonthLabel, "year" | "month">, toYear: number, toMonth: number): number =>
  (toYear - from.year) * 12 + (toMonth - from.month);

const clickVisibleButtonByIndex = async (page: Page, index: number, timeout = 5000): Promise<void> => {
  await page.locator("button").nth(index).click({ timeout });
};

const clickVisibleBodyElementByIndex = async (page: Page, index: number, timeout = 5000): Promise<void> => {
  await page.locator("body *").nth(index).click({ timeout });
};

const clickSideButton = async (page: Page, text: string | RegExp, side: CalendarSide, timeout = 5000): Promise<boolean> => {
  const buttons = await visibleButtons(page);
  const matches = buttons
    .filter((button) => (typeof text === "string" ? button.text === text : text.test(button.text)))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (matches.length === 0) return false;
  const selected = side === "left" ? matches[0] : matches[matches.length - 1];
  if (!selected) return false;
  await clickVisibleButtonByIndex(page, selected.index, timeout);
  return true;
};

const ensureStaticCalendarTabs = async (page: Page): Promise<void> => {
  await clickSideButton(page, "靜態時間", "left", 3000).catch(() => false);
  await page.waitForTimeout(150);
  await clickSideButton(page, "靜態時間", "right", 3000).catch(() => false);
  await page.waitForTimeout(300);
};

const calendarMonthForSide = async (page: Page, side: CalendarSide): Promise<VisibleMonthLabel | null> => {
  const months = (await visibleCalendarMonths(page)).sort((a, b) => a.x - b.x || a.y - b.y);
  if (months.length === 0) return null;
  return side === "left" ? months[0] ?? null : months[months.length - 1] ?? null;
};

const moveCalendarToMonth = async (page: Page, side: CalendarSide, targetYear: number, targetMonth: number): Promise<boolean> => {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const current = await calendarMonthForSide(page, side);
    if (!current) return false;
    const diff = monthDiff(current, targetYear, targetMonth);
    if (diff === 0) return true;
    const direction = diff < 0 ? "‹" : "›";
    const clicked = await clickSideButton(page, direction, side, 3000);
    if (!clicked) return false;
    await page.waitForTimeout(250);
  }
  return false;
};

const clickCalendarDay = async (page: Page, side: CalendarSide, day: number): Promise<boolean> => {
  const months = (await visibleCalendarMonths(page)).sort((a, b) => a.x - b.x || a.y - b.y);
  if (months.length < 2) return false;
  const left = months[0];
  const right = months[months.length - 1];
  if (!left || !right) return false;
  const splitX = (left.x + left.width / 2 + right.x + right.width / 2) / 2;
  const selectedMonth = side === "left" ? left : right;
  const buttons = await visibleButtons(page);
  const candidates = buttons
    .filter((button) => button.text === String(day))
    .filter((button) => {
      const centerX = button.x + button.width / 2;
      const centerY = button.y + button.height / 2;
      const inSide = side === "left" ? centerX < splitX : centerX > splitX;
      return inSide && centerY > selectedMonth.y + selectedMonth.height && centerY < selectedMonth.y + 280;
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const selected = candidates[0];
  if (selected) {
    await clickVisibleButtonByIndex(page, selected.index, 5000);
    return true;
  }

  const textTargets = await visibleExactTextTargets(page, String(day));
  const targetCandidates = textTargets
    .filter((target) => target.width <= 90 && target.height <= 90)
    .filter((target) => {
      const centerX = target.x + target.width / 2;
      const centerY = target.y + target.height / 2;
      const inSide = side === "left" ? centerX < splitX : centerX > splitX;
      return inSide && centerY > selectedMonth.y + selectedMonth.height && centerY < selectedMonth.y + 320;
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const target = targetCandidates[0];
  if (!target) return false;
  await clickVisibleBodyElementByIndex(page, target.index, 5000);
  return true;
};

const clickCalendarDayInVisibleMonth = async (
  page: Page,
  targetYear: number,
  targetMonth: number,
  day: number,
  preferredSide?: CalendarSide
): Promise<boolean> => {
  const months = (await visibleCalendarMonths(page)).sort((a, b) => a.x - b.x || a.y - b.y);
  if (months.length < 2) return false;
  const matching = months
    .map((month, index) => ({
      month,
      side: index === 0 ? "left" as CalendarSide : "right" as CalendarSide
    }))
    .filter((item) => item.month.year === targetYear && item.month.month === targetMonth);
  const selected = preferredSide
    ? matching.find((item) => item.side === preferredSide) ?? matching[0]
    : matching[0];
  if (!selected) return false;
  return clickCalendarDay(page, selected.side, day);
};

const setStaticDateRangeByCalendar = async (
  page: Page,
  parsed: { startIso: string; endIso: string; display: string }
): Promise<{ ok: boolean; warning?: string; observedAfter?: string; inputs?: unknown }> => {
  const start = new Date(`${parsed.startIso}T00:00:00Z`);
  const end = new Date(`${parsed.endIso}T00:00:00Z`);
  const startYear = start.getUTCFullYear();
  const startMonth = start.getUTCMonth() + 1;
  const startDay = start.getUTCDate();
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth() + 1;
  const endDay = end.getUTCDate();

  await ensureStaticCalendarTabs(page);
  const startMonthReady = await moveCalendarToMonth(page, "left", startYear, startMonth);
  const sameMonth = startYear === endYear && startMonth === endMonth;
  const endMonthReady = sameMonth ? true : await moveCalendarToMonth(page, "right", endYear, endMonth);
  if (!startMonthReady || !endMonthReady) {
    return {
      ok: false,
      warning: "DATE_RANGE_CALENDAR_MONTH_NOT_REACHED",
      observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1000)
    };
  }

  const startClicked = await clickCalendarDayInVisibleMonth(page, startYear, startMonth, startDay, "left");
  await page.waitForTimeout(250);
  const endClicked = await clickCalendarDayInVisibleMonth(page, endYear, endMonth, endDay, sameMonth ? "left" : "right");
  if (!startClicked || !endClicked) {
    return {
      ok: false,
      warning: `DATE_RANGE_CALENDAR_DAY_NOT_CLICKABLE:startClicked=${startClicked};endClicked=${endClicked};sameMonth=${sameMonth}`,
      observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1200)
    };
  }

  const confirmed = await clickFirstVisible([page.getByText("確認", { exact: true }), page.locator("button").filter({ hasText: "確認" })], 5000);
  if (!confirmed) {
    return {
      ok: false,
      warning: "DATE_RANGE_CONFIRM_NOT_CLICKABLE",
      observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1200)
    };
  }
  await page.waitForTimeout(800);
  const ok = await bodyContainsDateRange(page, parsed.display);
  return {
    ok,
    warning: ok ? undefined : "DATE_RANGE_VERIFY_FAILED_AFTER_CALENDAR_CLICK",
    observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1200)
  };
};

const setDateRange = async (page: Page, dateRange: string): Promise<{ ok: boolean; warning?: string; observedAfter?: string; inputs?: unknown }> => {
  const parsed = parseDateRange(dateRange);
  if (!parsed) return setDatePreset(page, dateRange);
  if (await bodyContainsDateRange(page, parsed.display)) return { ok: true, observedAfter: parsed.display };

  const opened = await clickFirstVisible([
    page.locator("#dateRangeBtn"),
    page.locator("button").filter({ hasText: /過去|最近|今日|昨日|本週|上週|本月|上月|\d{4}[/-]\d{1,2}[/-]\d{1,2}/ }),
    page.getByText(/過去7天|最近7天|過去30天|最近30天|\d{4}[/-]\d{1,2}[/-]\d{1,2}/, { exact: false })
  ], 8000);
  if (!opened) return { ok: false, warning: "DATE_RANGE_CONTROL_NOT_CLICKABLE" };
  await page.waitForTimeout(400);

  await clickFirstVisible([page.getByText("靜態時間", { exact: true }), page.locator("button").filter({ hasText: "靜態時間" })], 5000);
  await page.waitForTimeout(400);

  const inputs = await visibleInputIndexes(page);
  const dateInputs = inputs.filter((item) => item.type === "date");
  const textInputs = inputs.filter((item) => item.type === "text" && !/報表名稱/.test(item.placeholder));
  const targets = dateInputs.length >= 2 ? dateInputs.slice(0, 2) : textInputs.slice(0, 2);
  if (targets.length < 2) {
    const calendarResult = await setStaticDateRangeByCalendar(page, parsed);
    return calendarResult.ok ? { ...calendarResult, inputs } : { ...calendarResult, inputs, warning: `${calendarResult.warning ?? "DATE_RANGE_CALENDAR_FAILED"};DATE_RANGE_INPUTS_NOT_FOUND` };
  }

  const values = targets[0].type === "date"
    ? [parsed.startIso, parsed.endIso]
    : [parsed.startIso.replaceAll("-", "/"), parsed.endIso.replaceAll("-", "/")];
  for (let i = 0; i < 2; i += 1) {
    await page.locator("input").nth(targets[i].index).fill(values[i], { timeout: 5000 });
  }
  await clickFirstVisible([page.getByText("確認", { exact: true }), page.locator("button").filter({ hasText: "確認" })], 5000);
  await page.waitForTimeout(800);

  const ok = await bodyContainsDateRange(page, parsed.display);
  return {
    ok,
    warning: ok ? undefined : "DATE_RANGE_VERIFY_FAILED_AFTER_UI_INPUT",
    observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1000),
    inputs
  };
};

const setDatePreset = async (page: Page, preset: string): Promise<{ ok: boolean; warning?: string; observedAfter?: string; inputs?: unknown }> => {
  const normalizedPreset = preset.trim();
  if (!normalizedPreset) return { ok: false, warning: "DATE_RANGE_PRESET_EMPTY" };
  if (await bodyContainsText(page, normalizedPreset)) return { ok: true, observedAfter: normalizedPreset };

  const opened = await clickFirstVisible([
    page.locator("#dateRangeBtn"),
    page.locator("button").filter({ hasText: /過去|最近|今日|昨日|本週|上週|本月|上月|\d{4}[/-]\d{1,2}[/-]\d{1,2}/ }),
    page.getByText(/過去7天|最近7天|過去30天|最近30天|今日|昨日|本週|上週|本月|上月/, { exact: false })
  ], 8000);
  if (!opened) return { ok: false, warning: "DATE_RANGE_CONTROL_NOT_CLICKABLE" };
  await page.waitForTimeout(400);

  const selected = await clickFirstVisible([
    page.getByText(normalizedPreset, { exact: true }),
    page.locator("button").filter({ hasText: normalizedPreset })
  ], 5000);
  if (!selected) {
    return {
      ok: false,
      warning: `DATE_RANGE_PRESET_NOT_FOUND:${normalizedPreset}`,
      observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1000)
    };
  }
  await clickFirstVisible([page.getByText("確認", { exact: true }), page.locator("button").filter({ hasText: "確認" })], 3000).catch(() => false);
  await page.waitForTimeout(800);

  const ok = await bodyContainsText(page, normalizedPreset);
  return {
    ok,
    warning: ok ? undefined : "DATE_RANGE_PRESET_VERIFY_FAILED_AFTER_UI_CLICK",
    observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1000)
  };
};

const readChartSummary = async (page: Page): Promise<Record<string, unknown> | null> => {
  try {
    return await page.evaluate(() => {
      const chartWindow = window as unknown as { Chart?: { instances?: Record<string, unknown> } };
      const instances = chartWindow.Chart?.instances ? Object.values(chartWindow.Chart.instances) : [];
      const first = instances[0] as
        | {
            data?: { labels?: unknown[]; datasets?: Array<{ label?: string; data?: unknown[] }> };
          }
        | undefined;
      if (!first?.data) return null;
      const datasets = first.data.datasets ?? [];
      const numeric = datasets.flatMap((dataset) => (dataset.data ?? []).map((item) => Number(item)).filter(Number.isFinite));
      return {
        labelCount: first.data.labels?.length ?? 0,
        datasetCount: datasets.length,
        datasets: datasets.map((dataset) => ({
          label: dataset.label ?? null,
          count: dataset.data?.length ?? 0,
          sample: (dataset.data ?? []).slice(0, 10)
        })),
        numericSummary:
          numeric.length > 0
            ? {
                count: numeric.length,
                sum: numeric.reduce((total, item) => total + item, 0),
                max: Math.max(...numeric),
                min: Math.min(...numeric)
              }
            : null
      };
    });
  } catch {
    return null;
  }
};

const observeDuring = async <T>(page: Page, fn: () => Promise<T>): Promise<{ result: T; requests: Record<string, unknown>[]; responses: Record<string, unknown>[] }> => {
  const requests: Record<string, unknown>[] = [];
  const responses: Record<string, unknown>[] = [];
  const onRequest = (request: Request) => {
    if (!/biapi|preview|report|chart|custom/i.test(request.url())) return;
    requests.push({
      url: request.url(),
      method: request.method(),
      postData: request.postData()?.slice(0, 4000) ?? null,
      timestamp: new Date().toISOString()
    });
  };
  const onResponse = (response: Response) => {
    if (!/biapi|preview|report|chart|custom/i.test(response.url())) return;
    responses.push({
      url: response.url(),
      status: response.status(),
      timestamp: new Date().toISOString()
    });
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  try {
    const result = await fn();
    return { result, requests, responses };
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
  }
};

const clickByText = async (page: Page, text: string, timeout = 12000): Promise<void> => {
  const locator = page.getByText(text, { exact: false }).first();
  try {
    await locator.click({ timeout });
  } catch (error) {
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(300);
    try {
      await locator.click({ timeout: Math.min(timeout, 5000) });
    } catch (retryError) {
      const firstMessage = error instanceof Error ? error.message : String(error);
      const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
      throw new HelperBlockedError(
        `VISIBLE_UI_CLICK_BLOCKED: text="${text}"; first=${firstMessage.slice(0, 500)}; retry=${retryMessage.slice(0, 500)}`
      );
    }
  }
};

const openProject = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const devUrl = stringParam(options.params, "devUrl");
  const projectName = stringParam(options.params, "projectName");
  if (devUrl && !page.url().includes("galaxy.games.gamania.com")) {
    await page.goto(devUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  }
  await page.waitForTimeout(800);
  if (projectName) {
    await clickByText(page, projectName);
    await page.waitForTimeout(1200);
  }
  const shot = await screenshot(options, page, "open-project");
  return createReport(
    options,
    "ok",
    startedAt,
    { domState: await readDomState(page) },
    shot ? { screenshot: shot } : {},
    shot ? [] : ["SCREENSHOT_UNAVAILABLE"]
  );
};

const createCollageReport = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const projectName = stringParam(options.params, "projectName");
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (!bodyText.includes("+ 新增報表") && projectName) {
    await clickByText(page, projectName);
    await page.waitForTimeout(1200);
  }
  await page.getByText("+ 新增報表", { exact: false }).first().click({ timeout: 15000 });
  await page.waitForTimeout(1200);
  const shot = await screenshot(options, page, "create-report");
  return createReport(options, "ok", startedAt, { domState: await readDomState(page) }, shot ? { screenshot: shot } : {}, shot ? [] : ["SCREENSHOT_UNAVAILABLE"]);
};

const configureMetric = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const warnings: string[] = [];
  const field = stringParam(options.params, "field");
  const dateRange = stringParam(options.params, "dateRange");
  const stateDeltaBefore = await readStateDelta(page, options.params);
  const operations: string[] = [];
  let dateRangeEvidence: Record<string, unknown> | null = null;
  if (field) {
    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (!bodyText.includes(field)) {
      await page.getByText("+ 新增欄位", { exact: false }).first().click({ timeout: 15000 });
      await page.waitForTimeout(800);
      await clickByText(page, field);
      await page.waitForTimeout(800);
      operations.push(`field:set:${field}`);
    } else {
      operations.push(`field:already_visible:${field}`);
    }
  }
  if (dateRange) {
    const result = await setDateRange(page, dateRange);
    dateRangeEvidence = result;
    if (!result.ok) {
      warnings.push(`DATE_RANGE_UI_SETTING_NOT_COMPLETED:${result.warning ?? "unknown"}`);
      operations.push(`dateRange:blocked:${dateRange}`);
    } else {
      operations.push(`dateRange:verified:${dateRange}`);
    }
  }
  const stateDeltaAfter = await readStateDelta(page, options.params);
  const shot = await screenshot(options, page, "configure-metric");
  return createReport(
    options,
    warnings.some((warning) => warning.startsWith("DATE_RANGE_UI_SETTING_NOT_COMPLETED")) ? "blocked" : "ok",
    startedAt,
    {
      domState: await readDomState(page),
      requestedDateRange: dateRange,
      dateRangeEvidence,
      stateDelta: {
        before: stateDeltaBefore,
        after: stateDeltaAfter,
        operations
      }
    },
    shot ? { screenshot: shot } : {},
    shot ? warnings : [...warnings, "SCREENSHOT_UNAVAILABLE"]
  );
};

const runPreview = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const observed = await observeDuring(page, async () => {
    await page.getByText("執行", { exact: true }).first().click({ timeout: 15000 });
    await page.waitForTimeout(2500);
  });
  const chart = await readChartSummary(page);
  const shot = await screenshot(options, page, "run-preview");
  const hasPreviewEvidence = observed.requests.length > 0 || observed.responses.length > 0 || chart !== null;
  return createReport(
    options,
    hasPreviewEvidence ? "ok" : "blocked",
    startedAt,
    {
      domState: await readDomState(page),
      network: { requests: observed.requests, responses: observed.responses },
      chart,
      stateDelta: await readStateDelta(page, options.params)
    },
    shot ? { screenshot: shot } : {},
    [
      ...(shot ? [] : ["SCREENSHOT_UNAVAILABLE"]),
      ...(hasPreviewEvidence ? [] : ["PREVIEW_UI_ACTION_NOT_VERIFIED_NO_NETWORK_OR_CHART_EVIDENCE"])
    ]
  );
};

const approvalRequired = (options: CliOptions, action: string, startedAt: string): HelperReport => {
  const requestId = `${options.caseId}-${sanitize(options.action)}`;
  return createReport(
    options,
    "requires_approval",
    startedAt,
    {},
    {},
    ["TOOL_BRIDGE_RESPONSE_REQUIRED_BEFORE_HELPER_ACTION"],
    {
      toolRequest: {
        type: "irreversible_operation",
        request_id: requestId,
        case: options.caseId,
        action,
        reason: `${options.action} may create, overwrite, delete, or accept native dialogs.`,
        proposed_action: `Authorize helper action ${options.action} for current case ${options.caseId} only.`
      }
    }
  );
};

const fillVisibleReportNameInput = async (page: Page, reportName: string): Promise<Record<string, unknown>> => {
  const inputs = await visibleInputIndexes(page);
  const candidates = inputs.filter((item) => item.type === "text" && !/專案|project/i.test(item.placeholder));
  const preferred =
    candidates.find((item) => /報表|report|名稱|name/i.test(item.placeholder)) ??
    candidates.find((item) => item.value.trim().length === 0) ??
    candidates.at(-1);
  if (!preferred) {
    throw new HelperBlockedError(`SAVE_REPORT_NAME_INPUT_NOT_FOUND inputs=${JSON.stringify(inputs).slice(0, 1000)}`);
  }
  await page.locator("input").nth(preferred.index).fill(reportName, { timeout: 8000 });
  return { selectedInput: preferred, visibleInputs: inputs };
};

const clickModalSaveButton = async (page: Page): Promise<void> => {
  const clicked = await clickFirstVisible([
    page.locator(".modal button").filter({ hasText: /儲存|確認|確定|保存/ }),
    page.locator("[role=dialog] button").filter({ hasText: /儲存|確認|確定|保存/ }),
    page.locator("button").filter({ hasText: /儲存|確認|確定|保存/ })
  ], 8000);
  if (!clicked) throw new HelperBlockedError("SAVE_MODAL_SUBMIT_BUTTON_NOT_CLICKABLE");
};

const saveReport = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  if (!options.approvedToolRequestId) return approvalRequired(options, "save current temporary report", startedAt);
  const reportName = resolveReportName(options);
  const dialogs: Record<string, unknown>[] = [];
  let dialogChainRequiresApproval = false;
  page.on("dialog", async (dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message(), defaultValue: dialog.defaultValue() });
    if (dialogs.length === 1) {
      await dialog.accept();
      return;
    }
    dialogChainRequiresApproval = true;
  });
  const observed = await observeDuring(page, async () => {
    await page.getByText("儲存報表", { exact: false }).first().click({ timeout: 15000 });
    await page.waitForTimeout(600);
    const nameInputEvidence = await fillVisibleReportNameInput(page, reportName);
    await clickModalSaveButton(page);
    await page.waitForTimeout(1800);
    return nameInputEvidence;
  });
  writeSavedReportState(options, reportName, { approvedToolRequestId: options.approvedToolRequestId, dialogs });
  if (dialogChainRequiresApproval) {
    return createReport(
      options,
      "requires_approval",
      startedAt,
      {
        reportName,
        dialogs,
        network: { requests: observed.requests, responses: observed.responses },
        nameInput: observed.result
      },
      {},
      ["NATIVE_DIALOG_CHAIN_REQUIRES_TOOL_BRIDGE", "SECOND_NATIVE_DIALOG_LEFT_FOR_PM_RECOVERY"],
      {
        toolRequest: {
          type: "playwright_recovery",
          request_id: `${options.caseId}-${sanitize(options.action)}-dialog-chain`,
          case: options.caseId,
          error: "NATIVE_DIALOG_CHAIN: helper handled the first save dialog and detected a follow-up native dialog.",
          proposed_action: "Tommy handles the visible follow-up native dialog in persistent Chrome, returns to the report list, then continues the UAT Tool run."
        }
      }
    );
  }
  const shot = await screenshot(options, page, "save-report");
  return createReport(
    options,
    "ok",
    startedAt,
    {
      domState: await readDomState(page),
      dialogs,
      approvedToolRequestId: options.approvedToolRequestId,
      reportName,
      network: { requests: observed.requests, responses: observed.responses },
      nameInput: observed.result
    },
    shot ? { screenshot: shot } : {},
    shot ? [] : ["SCREENSHOT_UNAVAILABLE"]
  );
};

const reopenReport = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const reportName = readSavedReportName(options);
  const projectName = stringParam(options.params, "projectName");
  if (!reportName) throw new HelperBlockedError("SAVED_REPORT_NAME_MISSING");
  const beforeText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (!beforeText.includes(reportName) && projectName) {
    await clickByText(page, projectName, 8000);
    await page.waitForTimeout(1200);
  }
  const refreshedText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (!refreshedText.includes(reportName)) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    if (projectName) {
      await clickByText(page, projectName, 8000).catch(() => undefined);
      await page.waitForTimeout(800);
    }
  }
  const finalListText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (!finalListText.includes(reportName)) {
    throw new HelperBlockedError(`SAVED_REPORT_ROW_NOT_FOUND:${reportName}`);
  }
  await clickByText(page, reportName, 12000);
  await page.waitForTimeout(1800);
  const shot = await screenshot(options, page, "reopen-report");
  return createReport(
    options,
    "ok",
    startedAt,
    {
      reportName,
      expected: {
        field: stringParam(options.params, "field"),
        dateRange: stringParam(options.params, "dateRange"),
        display: stringParam(options.params, "display")
      },
      domState: await readDomState(page)
    },
    shot ? { screenshot: shot } : {},
    shot ? [] : ["SCREENSHOT_UNAVAILABLE"]
  );
};

const notImplemented = async (options: CliOptions, page: Page, reason: string, startedAt: string): Promise<HelperReport> => {
  const shot = await screenshot(options, page, sanitize(options.action));
  return createReport(
    options,
    "not_implemented",
    startedAt,
    { domState: await readDomState(page), reason },
    shot ? { screenshot: shot } : {},
    ["HELPER_TEMPLATE_NOT_IMPLEMENTED_IN_V1"]
  );
};

const run = async (): Promise<void> => {
  const options = parseArgs();
  const startedAt = new Date().toISOString();
  const config = readConfig();

  let browser: Browser | null = null;
  let page: Page | null = null;
  let report: HelperReport;
  try {
    const endpoint = await ensureChromeDebugSession(config, null, {
      resetTabs: false,
      openInitialUrl: false
    });
    if (!endpoint) {
      const diagnostics = await diagnoseChromeDebugSession(config);
      report = createReport(
        options,
        "error",
        startedAt,
        { reason: "CHROME_CDP_UNAVAILABLE", cdpDiagnostics: diagnostics },
        {},
        ["HELPER_CDP_DIAGNOSTICS_CAPTURED"],
        { error: "CHROME_CDP_UNAVAILABLE" }
      );
      writeReport(options, report);
      console.error(JSON.stringify(report, null, 2));
      process.exitCode = 1;
      return;
    }
    browser = await chromium.connectOverCDP(endpoint);
    page = await getGalaxyPage(browser);
    if (options.action !== "collage.openProject" && !isApplicationPage(page)) {
      throw new HelperBlockedError(`GALAXY_PAGE_NOT_FOUND_FOR_HELPER_ACTION:url=${page.url() || "blank"}`);
    }
    await page.bringToFront();
    await ensureSingleUserPageTab(endpoint, { closeNewTab: true });
    switch (options.action) {
      case "collage.openProject":
        report = await openProject(options, page, startedAt);
        break;
      case "collage.createReport":
        report = await createCollageReport(options, page, startedAt);
        break;
      case "collage.configureMetric":
        report = await configureMetric(options, page, startedAt);
        break;
      case "collage.runPreviewAndCollectEvidence":
        report = await runPreview(options, page, startedAt);
        break;
      case "collage.saveReport":
        report = await saveReport(options, page, startedAt);
        break;
      case "collage.reopenReport":
        report = await reopenReport(options, page, startedAt);
        break;
      case "collage.deleteTemporaryReport":
        report = options.approvedToolRequestId
          ? await notImplemented(options, page, "Template is registered but not implemented in this executor version.", startedAt)
          : approvalRequired(options, options.action, startedAt);
        break;
      case "filter.addAndPreview":
      case "group.addAndPreview":
        report = await notImplemented(options, page, "Filter/group helpers are not implemented for trusted Agent runs. Capability gate should mark these cases unsupported.", startedAt);
        break;
      default:
        report = await notImplemented(options, page, `Unknown helper action: ${options.action}`, startedAt);
        break;
    }
    writeReport(options, report);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const isBlocked = error instanceof HelperBlockedError || isActionabilityFailure(error);
    const shot = page ? await screenshot(options, page, isBlocked ? "blocked" : "error") : null;
    const evidence: Record<string, unknown> = {
      reason: error instanceof HelperBlockedError
        ? error.reason
        : isBlocked
          ? `VISIBLE_UI_ACTION_BLOCKED: ${error instanceof Error ? error.message : String(error)}`
          : error instanceof Error
            ? error.message
            : String(error)
    };
    if (page) {
      evidence.domState = await readDomState(page).catch((domError) => ({
        readError: domError instanceof Error ? domError.message : String(domError)
      }));
    }
    report = createReport(
      options,
      isBlocked ? "blocked" : "error",
      startedAt,
      evidence,
      shot ? { screenshot: shot } : {},
      shot ? [] : ["SCREENSHOT_UNAVAILABLE"],
      {
        error: error instanceof Error ? error.stack ?? error.message : String(error)
      }
    );
    writeReport(options, report);
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    if (options.closeAfter) {
      if (browser) await browser.close().catch(() => undefined);
      await closeChromeDebugSession(config).catch(() => undefined);
    } else if (browser) {
      const connection = (browser as unknown as { _connection?: { close?: () => void } })._connection;
      connection?.close?.();
    }
  }
};

void run().then(() => {
  process.exit(process.exitCode ?? 0);
});
