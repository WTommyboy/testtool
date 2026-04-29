#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page, type Request, type Response } from "playwright";
import { closeChromeDebugSession, ensureChromeDebugSession, ensureSingleUserPageTab } from "./browser-session";
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
  startedAt: string;
  endedAt: string;
  durationMs: number;
  caseId: string;
  action: string;
  status: "ok" | "blocked" | "requires_approval" | "not_implemented" | "error";
  helperCanJudgeResult: false;
  params: Record<string, unknown>;
  evidence: Record<string, unknown>;
  artifacts: Record<string, string>;
  warnings: string[];
  error?: string;
  toolRequest?: Record<string, unknown>;
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

const createReport = (
  options: CliOptions,
  status: HelperReport["status"],
  startedAt: string,
  evidence: Record<string, unknown>,
  artifacts: Record<string, string>,
  warnings: string[] = [],
  extra: Partial<HelperReport> = {}
): HelperReport => ({
  schemaVersion: "bi-ui-helper-report-v1",
  generatedAt: new Date().toISOString(),
  startedAt,
  endedAt: new Date().toISOString(),
  durationMs: Math.max(0, Date.now() - Date.parse(startedAt)),
  caseId: options.caseId,
  action: options.action,
  status,
  helperCanJudgeResult: false,
  params: options.params,
  evidence,
  artifacts,
  warnings,
  ...extra
});

const getGalaxyPage = async (browser: Browser): Promise<Page> => {
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const pages = context.pages();
  return pages.find((page) => page.url().includes("galaxy.games.gamania.com")) ?? pages[0] ?? (await context.newPage());
};

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
    const buttons = Array.from(document.querySelectorAll("button"))
      .map((item) => item.textContent?.trim())
      .filter(Boolean)
      .slice(0, 80);
    const selects = Array.from(document.querySelectorAll("select")).map((item) => ({
      name: item.getAttribute("name"),
      value: item.value,
      text: item.selectedOptions?.[0]?.textContent?.trim() ?? null
    }));
    return {
      url: location.href,
      title: document.title,
      bodyTextExcerpt: document.body.innerText.slice(0, 2500),
      reportHeader: text("h1, h2, [class*=title], [class*=header]"),
      buttons,
      selects
    };
  });
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
    } catch {
      await locator.click({ timeout: Math.min(timeout, 5000), force: true });
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
  if (field) {
    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (!bodyText.includes(field)) {
      await page.getByText("+ 新增欄位", { exact: false }).first().click({ timeout: 15000 });
      await page.waitForTimeout(800);
      await clickByText(page, field);
      await page.waitForTimeout(800);
    }
  }
  if (dateRange) {
    warnings.push("DATE_RANGE_UI_SETTING_NOT_FULLY_AUTOMATED_V1: helper records current DOM state; Codex must verify or complete date setting if needed.");
  }
  const shot = await screenshot(options, page, "configure-metric");
  return createReport(options, "ok", startedAt, { domState: await readDomState(page), requestedDateRange: dateRange }, shot ? { screenshot: shot } : {}, shot ? warnings : [...warnings, "SCREENSHOT_UNAVAILABLE"]);
};

const runPreview = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const observed = await observeDuring(page, async () => {
    await page.getByText("執行", { exact: true }).first().click({ timeout: 15000 });
    await page.waitForTimeout(2500);
  });
  const shot = await screenshot(options, page, "run-preview");
  return createReport(
    options,
    "ok",
    startedAt,
    {
      domState: await readDomState(page),
      network: { requests: observed.requests, responses: observed.responses },
      chart: await readChartSummary(page)
    },
    shot ? { screenshot: shot } : {},
    shot ? [] : ["SCREENSHOT_UNAVAILABLE"]
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

const saveReport = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  if (!options.approvedToolRequestId) return approvalRequired(options, "save current temporary report", startedAt);
  const reportName = stringParam(options.params, "reportNamePattern")?.replace("<timestamp>", new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 12));
  const dialogs: Record<string, unknown>[] = [];
  page.once("dialog", async (dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message(), defaultValue: dialog.defaultValue() });
    await dialog.accept(reportName ?? undefined);
  });
  await page.getByText("儲存報表", { exact: false }).first().click({ timeout: 15000 });
  await page.waitForTimeout(2000);
  const shot = await screenshot(options, page, "save-report");
  return createReport(
    options,
    "ok",
    startedAt,
    { domState: await readDomState(page), dialogs, approvedToolRequestId: options.approvedToolRequestId, reportName },
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
  const endpoint = await ensureChromeDebugSession(config, null, {
    resetTabs: false,
    openInitialUrl: false
  });
  if (!endpoint) throw new Error("CHROME_CDP_UNAVAILABLE");

  let browser: Browser | null = null;
  let report: HelperReport;
  try {
    browser = await chromium.connectOverCDP(endpoint);
    const page = await getGalaxyPage(browser);
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
        report = await notImplemented(options, page, "Reopen report helper is planned for V1.1; Codex may perform visible UI steps manually and still use helper evidence capture.", startedAt);
        break;
      case "collage.deleteTemporaryReport":
      case "filter.addAndPreview":
      case "group.addAndPreview":
        report = options.approvedToolRequestId
          ? await notImplemented(options, page, "Template is registered but not implemented in this executor version.", startedAt)
          : approvalRequired(options, options.action, startedAt);
        break;
      default:
        report = await notImplemented(options, page, `Unknown helper action: ${options.action}`, startedAt);
        break;
    }
    writeReport(options, report);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report = createReport(options, "error", startedAt, {}, {}, [], {
      error: error instanceof Error ? error.stack ?? error.message : String(error)
    });
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
