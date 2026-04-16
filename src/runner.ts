import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { db } from "./db";
import { config } from "./config";

type RunRow = {
  id: string;
  dev_url: string;
  status: string;
  execution_mode?: string | null;
};

type CaseRow = {
  id: string;
  run_id: string;
  case_no: string;
  group_name?: string | null;
  case_title?: string;
  execution_type: string;
  result_status: string;
  detail_json?: string | null;
};

type StepRow = {
  id: string;
  run_id: string;
  case_no: string;
  step_no: number;
  action_type: string;
  target_type: string | null;
  target_value: string | null;
  input_value: string | null;
  expected: string | null;
  require_approval: number;
  timeout_ms: number;
  retry: number;
  status: string;
};

type ActiveRun = {
  startedAt: number;
  cancelRequested: boolean;
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
};

type DetailCollector = Record<string, string | number | boolean | string[] | null>;

class CaseExecutionError extends Error {
  detailJson?: DetailCollector;
  constructor(message: string, detailJson?: DetailCollector) {
    super(message);
    this.name = "CaseExecutionError";
    this.detailJson = detailJson;
  }
}

const activeRuns = new Map<string, ActiveRun>();

const nowIso = (): string => new Date().toISOString();
const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

const insertRunLog = (runId: string, level: "INFO" | "WARN" | "ERROR", message: string, context?: unknown): void => {
  db.prepare(
    `
      INSERT INTO run_logs (id, run_id, level, message, context_json, created_at)
      VALUES (@id, @run_id, @level, @message, @context_json, @created_at)
    `
  ).run({
    id: randomUUID(),
    run_id: runId,
    level,
    message,
    context_json: context ? JSON.stringify(context) : null,
    created_at: nowIso()
  });
};

const setRunStatus = (runId: string, status: string): void => {
  const now = nowIso();
  db.prepare("UPDATE runs SET status = ?, updated_at = ? WHERE id = ?").run(status, now, runId);

  if (!TERMINAL_STATUSES.has(status)) {
    return;
  }

  const run = db.prepare("SELECT created_at FROM runs WHERE id = ?").get(runId) as { created_at?: string } | undefined;
  const startDate = run?.created_at ? new Date(run.created_at).toISOString().slice(0, 10) : "";
  const endDate = now.slice(0, 10);
  const dateStr = startDate ? (startDate === endDate ? startDate : `${startDate} ~ ${endDate}`) : endDate;

  const fillers = db
    .prepare(
      `
        SELECT DISTINCT manual_filled_by
        FROM run_cases
        WHERE run_id = ? AND manual_filled_by IS NOT NULL AND TRIM(manual_filled_by) <> ''
      `
    )
    .all(runId) as Array<{ manual_filled_by: string }>;
  const manualFillers = fillers.map((x) => x.manual_filled_by);
  const tester = `Playwright Runner${manualFillers.length > 0 ? ` + ${manualFillers.join(", ")}` : ""}`;

  db.prepare("UPDATE runs SET date = ?, tester = ?, finished_at = ?, updated_at = ? WHERE id = ?").run(
    dateStr,
    tester,
    now,
    now,
    runId
  );
};

const normalizeDetailValue = (value: unknown): string | number | boolean | string[] | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
  return JSON.stringify(value);
};

const parseCaseDetailJson = (value: string | null | undefined): DetailCollector => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: DetailCollector = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k] = normalizeDetailValue(v);
    }
    return out;
  } catch {
    return {};
  }
};

const ensureString = (value: string | number | boolean | string[] | null | undefined, fallback: string): string => {
  if (value === null || value === undefined) return fallback;
  if (Array.isArray(value)) return value.length > 0 ? value.join("、") : fallback;
  const text = String(value).trim();
  return text || fallback;
};

const parseExpectedOptionsFromText = (expectedText: string): string[] => {
  const fromColon = expectedText.match(/[：:]\s*(.+)$/);
  const source = fromColon?.[1] ?? expectedText;
  return source
    .split(/[、，,]/)
    .map((x) => x.trim().replace(/^「|」$/g, "").replace(/^"|"$|^'|'$/g, ""))
    .filter((x) => x.length > 0)
    .filter((x) => !/^(應|出現|個|key|值|應該)$/i.test(x));
};

const ensureCoreDetail = (
  runId: string,
  caseNo: string,
  resultStatus: string,
  detailJson?: unknown
): DetailCollector => {
  const row = db
    .prepare(
      `
        SELECT rc.case_title, r.dev_url
        FROM run_cases rc
        JOIN runs r ON r.id = rc.run_id
        WHERE rc.run_id = ? AND rc.case_no = ?
        LIMIT 1
      `
    )
    .get(runId, caseNo) as { case_title?: string; dev_url?: string } | undefined;

  const base: DetailCollector = {};
  if (detailJson && typeof detailJson === "object" && !Array.isArray(detailJson)) {
    for (const [k, v] of Object.entries(detailJson as Record<string, unknown>)) {
      base[k] = normalizeDetailValue(v);
    }
  } else if (typeof detailJson === "string") {
    base.原始訊息 = detailJson;
  }

  const purpose = typeof base.測試目的 === "string" && base.測試目的.trim() ? base.測試目的 : row?.case_title || `執行 ${caseNo}`;
  const condition =
    typeof base.設定條件 === "string" && base.設定條件.trim()
      ? base.設定條件
      : "未提供前置條件";
  const testType =
    typeof base.測試類型 === "string" && base.測試類型.trim() ? base.測試類型 : "未分類";
  const stepText =
    typeof base.執行步驟 === "string" && base.執行步驟.trim() ? base.執行步驟 : "未提供執行步驟";
  const expected =
    typeof base.預期行為 === "string" && base.預期行為.trim() ? base.預期行為 : "案例應依測試設計完成";
  const actual =
    typeof base.實際行為 === "string" && base.實際行為.trim()
      ? base.實際行為
      : resultStatus === "PASS"
        ? "案例執行完成"
        : "案例執行失敗或中斷";

  base.測試類型 = String(testType);
  base.測試目的 = String(purpose);
  base.設定條件 = String(condition);
  base.執行步驟 = String(stepText);
  base.預期行為 = String(expected);
  base.實際行為 = String(actual);
  if (!base.執行方式) {
    base.執行方式 = String(row?.dev_url ? "Playwright Runner" : "未指定");
  }

  if ((resultStatus === "FAIL" || resultStatus === "BLOCKED") && !base.錯誤原因) {
    if (typeof base.reason === "string" && base.reason.trim()) {
      base.錯誤原因 = base.reason;
    } else {
      base.錯誤原因 = "未知錯誤";
    }
  }

  return base;
};

const setCaseResult = (
  runId: string,
  caseNo: string,
  resultStatus: string,
  failCategory: string | null,
  detailJson?: unknown
): void => {
  const normalizedDetail = ensureCoreDetail(runId, caseNo, resultStatus, detailJson);
  db.prepare(
    `
      UPDATE run_cases
      SET result_status = ?, fail_category = ?, detail_json = ?, updated_at = ?
      WHERE run_id = ? AND case_no = ?
    `
  ).run(resultStatus, failCategory, JSON.stringify(normalizedDetail), nowIso(), runId, caseNo);
};

const setStepResult = (
  runId: string,
  caseNo: string,
  stepNo: number,
  status: "PASS" | "FAIL" | "SKIPPED",
  actual?: unknown,
  errorMessage?: string
): void => {
  const now = nowIso();
  db.prepare(
    `
      UPDATE run_case_steps
      SET status = ?,
          actual_json = ?,
          error_message = ?,
          started_at = COALESCE(started_at, ?),
          finished_at = ?,
          updated_at = ?
      WHERE run_id = ? AND case_no = ? AND step_no = ?
    `
  ).run(status, actual ? JSON.stringify(actual) : null, errorMessage ?? null, now, now, now, runId, caseNo, stepNo);
};

const createApproval = (runId: string, caseNo: string, stepNo: number, reason: string, snapshotPath?: string): void => {
  db.prepare(
    `
      INSERT INTO approvals (
        id, run_id, case_no, step_no, reason, status, snapshot_path, created_at
      ) VALUES (
        @id, @run_id, @case_no, @step_no, @reason, @status, @snapshot_path, @created_at
      )
    `
  ).run({
    id: randomUUID(),
    run_id: runId,
    case_no: caseNo,
    step_no: stepNo,
    reason,
    status: "PENDING",
    snapshot_path: snapshotPath ?? null,
    created_at: nowIso()
  });
};

const isRunCancelled = (runId: string): boolean => {
  const row = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string } | undefined;
  return row?.status === "CANCELLED";
};

const ensureArtifactsDir = (runId: string): string => {
  const dir = path.resolve(config.storageRoot, "runs", runId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const splitCsvLine = (line: string): string[] => {
  // Lightweight CSV parser for MVP; supports quoted commas.
  const out: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuote = !inQuote;
      }
      continue;
    }
    if (ch === "," && !inQuote) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
};

const readCsvRows = (filePath: string): string[][] => {
  const text = fs.readFileSync(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .filter((x) => x.trim())
    .map((line) => splitCsvLine(line));
};

const closeBrowser = async (state: ActiveRun): Promise<void> => {
  try {
    await state.page?.close();
  } catch {
    // ignore close errors
  }
  try {
    await state.context?.close();
  } catch {
    // ignore close errors
  }
  try {
    await state.browser?.close();
  } catch {
    // ignore close errors
  }
};

const launchBrowser = async (interactiveMode: boolean): Promise<{ browser: Browser; context: BrowserContext; page: Page }> => {
  const browser = await chromium.launch({
    headless: interactiveMode ? false : config.playwrightHeadless,
    slowMo: interactiveMode ? Math.max(config.playwrightSlowMoMs, 200) : config.playwrightSlowMoMs
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  return { browser, context, page };
};

const startHeartbeat = (runId: string, state: ActiveRun): (() => void) => {
  let lastHealthy = Date.now();

  const timer = setInterval(async () => {
    if (!state.page || !state.browser) return;
    try {
      await Promise.race([
        state.page.evaluate(() => 1),
        new Promise((_, reject) => setTimeout(() => reject(new Error("HEALTHCHECK_TIMEOUT")), config.playwrightHealthcheckTimeoutMs))
      ]);
      lastHealthy = Date.now();
    } catch (error) {
      const downMs = Date.now() - lastHealthy;
      if (downMs < config.playwrightCrashDownMs) return;

      insertRunLog(runId, "ERROR", "Browser heartbeat failed", {
        downMs,
        error: error instanceof Error ? error.message : String(error)
      });

      const currentCase = db
        .prepare(
          "SELECT case_no FROM run_cases WHERE run_id = ? AND result_status = 'PENDING' ORDER BY created_at ASC LIMIT 1"
        )
        .get(runId) as { case_no: string } | undefined;
      if (currentCase) {
        setCaseResult(runId, currentCase.case_no, "BLOCKED", "BROWSER_CRASH", {
          reason: "heartbeat timeout",
          detectedAt: nowIso()
        });
      }

      setRunStatus(runId, "FAILED");
      state.cancelRequested = true;
    }
  }, config.playwrightHeartbeatIntervalMs);

  return () => clearInterval(timer);
};

const tryClickVisibleText = async (page: Page, candidates: string[], timeoutMs: number): Promise<boolean> => {
  try {
    await clickFirstVisibleText(page, candidates, timeoutMs);
    return true;
  } catch {
    return false;
  }
};

const ensureInteractiveEntry = async (runId: string, run: RunRow, page: Page): Promise<void> => {
  await page.goto(run.dev_url, { waitUntil: "domcontentloaded", timeout: config.playwrightTimeoutMs });
  await page.waitForTimeout(600);

  if (/\/edit\b/i.test(page.url())) {
    insertRunLog(runId, "INFO", "Interactive entry ready", { url: page.url(), source: "dev_url" });
    return;
  }

  const hasHomeHint = (await page.getByText("請從左側選擇專案查看報表", { exact: false }).count().catch(() => 0)) > 0;
  if (!hasHomeHint && !/\/home\b/i.test(page.url())) {
    insertRunLog(runId, "INFO", "Interactive entry skipped bootstrap", { url: page.url() });
    return;
  }

  const projectCandidates = ["UAT_G01測試專案", "拼貼test_001"];
  for (const candidate of projectCandidates) {
    const clicked = await tryClickVisibleText(page, [candidate], 2500);
    if (clicked) {
      await page.waitForTimeout(500);
      break;
    }
  }

  await tryClickVisibleText(page, ["新增報表", "+新增報表"], 2500);
  await page.waitForTimeout(900);
  insertRunLog(runId, "INFO", "Interactive bootstrap attempted", { url: page.url() });
};

const clickFirstVisibleText = async (page: Page, candidates: string[], timeoutMs: number): Promise<string> => {
  for (const text of candidates) {
    const locator = page.getByText(text, { exact: false }).first();
    try {
      await locator.waitFor({ state: "visible", timeout: Math.min(timeoutMs, 1800) });
      await locator.click({ timeout: timeoutMs });
      return text;
    } catch {
      // try next candidate
    }
  }
  throw new Error(`STEP_TRANSLATION_FAILED cannot find text candidates: ${candidates.join(" | ")}`);
};

const collectDropdownOptions = async (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const selectors = [
      "[role='option']",
      ".dropdown-option",
      ".el-select-dropdown__item",
      ".el-option",
      ".ant-select-item-option-content"
    ];
    const merged: string[] = [];
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        const text = (node.textContent || "").trim();
        if (text && !merged.includes(text)) merged.push(text);
      }
    }
    return merged;
  });

const splitNaturalSteps = (stepText: string): string[] =>
  stepText
    .split(/(?:→|->|➜|\n)+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

const extractQuotedText = (text: string): string | null => {
  const match = text.match(/[「『"“](.+?)[」』"”]/);
  return match?.[1]?.trim() || null;
};

const normalizeNaturalTarget = (text: string): string =>
  text
    .replace(/^(點擊|點|按|click|切換|選擇|選|改成|切至)\s*/i, "")
    .replace(/(按鈕|選項|模式|頁籤|tab)$/i, "")
    .replace(/[「」『』"“”]/g, "")
    .trim();

const firstVisibleInput = (page: Page, selector: string): import("playwright").Locator =>
  page.locator(selector).filter({ hasNot: page.locator("[disabled]") }).first();

const tableRowCount = async (page: Page): Promise<number> =>
  page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("table tr"));
    return rows.filter((tr) => tr.querySelectorAll("td").length > 0).length;
  });

const executeCustomNaturalStep = async (
  page: Page,
  step: StepRow,
  detail: DetailCollector,
  timeoutMs: number
): Promise<Record<string, unknown>> => {
  const stepText = ensureString(step.input_value, ensureString(detail.執行步驟, "")).replace(/\s+/g, " ").trim();
  if (!stepText) {
    throw new Error("STEP_TRANSLATION_FAILED empty custom step text");
  }

  const subSteps = splitNaturalSteps(stepText);
  if (subSteps.length === 0) {
    throw new Error("STEP_TRANSLATION_FAILED empty natural sub-step");
  }

  const logs: string[] = [];
  const outputs: Record<string, unknown> = {};

  for (const sub of subSteps) {
    if (/^篩選[:：]/.test(sub)) {
      const expr = sub.replace(/^篩選[:：]\s*/i, "").trim();
      const parts = expr.split(/\s+/).filter((x) => x.length > 0);
      const field = parts[0] ?? "";
      const operators = ["等於", "包含", "大於", "小於", "區間", "位於區間", "早於", "晚於", "有值"];
      const operator = parts.find((x) => operators.includes(x)) ?? "";
      const value = parts.slice(field && operator ? parts.indexOf(operator) + 1 : 1).join(" ").trim();

      await tryClickVisibleText(page, ["新增篩選", "+新增篩選", "篩選"], timeoutMs);
      if (field) await tryClickVisibleText(page, [field], timeoutMs);
      if (operator) await tryClickVisibleText(page, [operator], timeoutMs);
      if (value) {
        try {
          const input = firstVisibleInput(page, "input, textarea");
          await input.waitFor({ state: "visible", timeout: Math.min(timeoutMs, 1800) });
          await input.fill(value, { timeout: timeoutMs });
        } catch {
          // keep going in interactive-style fallback
        }
      }
      logs.push(`嘗試執行篩選語句：${expr}`);
      continue;
    }

    if (/^逐一計算/.test(sub)) {
      const options = await collectDropdownOptions(page).catch(() => []);
      detail.抽樣數據 = options.slice(0, 10);
      logs.push(`逐一計算步驟以抽樣方式記錄，選項 ${options.length} 項`);
      continue;
    }

    const enterMatch = sub.match(/^(.+?)進入$/);
    if (enterMatch) {
      const target = enterMatch[1].trim();
      if (target) {
        await clickFirstVisibleText(page, [target], timeoutMs);
        await page.waitForTimeout(300);
        logs.push(`點擊進入「${target}」成功`);
        continue;
      }
    }

    if (/主欄位/.test(sub) && /(選擇|下拉|選單)/.test(sub)) {
      const clickedText = await clickFirstVisibleText(page, ["+ 選擇主欄位", "+選擇主欄位", "選擇主欄位"], timeoutMs);
      await page.waitForTimeout(300);
      const options = await collectDropdownOptions(page);
      if (options.length === 0) throw new Error("STEP_TRANSLATION_FAILED dropdown options not found");
      outputs.mainFieldOptions = options;
      detail.抽樣數據 = options.slice(0, 10);
      logs.push(`點擊「${clickedText}」，取得下拉 ${options.length} 項`);
      continue;
    }

    if (/^(點擊|點|按|click)/i.test(sub) || /^(切換|選擇|選|改成|切至)/.test(sub)) {
      const quoted = extractQuotedText(sub);
      const normalized = normalizeNaturalTarget(sub);
      const target = quoted || normalized;
      if (!target) throw new Error(`STEP_TRANSLATION_FAILED empty target: ${sub}`);
      await clickFirstVisibleText(page, [target, target.replace(/\s+/g, "")], timeoutMs);
      await page.waitForTimeout(300);
      logs.push(`點擊「${target}」成功`);
      continue;
    }

    if (/(輸入|填入|填寫)/.test(sub)) {
      const value = extractQuotedText(sub) ?? sub.replace(/^(輸入|填入|填寫)\s*/g, "").trim();
      if (!value) throw new Error(`STEP_TRANSLATION_FAILED empty input value: ${sub}`);
      const input = firstVisibleInput(page, "input, textarea");
      await input.waitFor({ state: "visible", timeout: timeoutMs });
      await input.fill(value, { timeout: timeoutMs });
      logs.push(`輸入「${value}」成功`);
      continue;
    }

    if (/(確認|確定|ok)/i.test(sub)) {
      await clickFirstVisibleText(page, ["確認", "確定", "OK", "ok"], timeoutMs);
      await page.waitForTimeout(250);
      logs.push("已點擊確認");
      continue;
    }

    if (/(執行|查詢|搜尋)/.test(sub)) {
      const clickedText = await clickFirstVisibleText(page, ["執行", "查詢", "搜尋"], timeoutMs);
      await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => undefined);
      const rows = await tableRowCount(page);
      detail.筆數 = rows;
      outputs.rowCount = rows;
      logs.push(`點擊「${clickedText}」後資料 ${rows} 筆`);
      continue;
    }

    if (/(記錄|提取|讀取|觀察).*(下拉|選項|選單)/.test(sub)) {
      const options = await collectDropdownOptions(page);
      if (options.length === 0) throw new Error("STEP_TRANSLATION_FAILED no dropdown options to record");
      outputs.recordedOptions = options;
      detail.抽樣數據 = options.slice(0, 10);
      logs.push(`記錄下拉選項 ${options.length} 項`);
      continue;
    }

    const fallbackTarget = extractQuotedText(sub);
    if (fallbackTarget) {
      await clickFirstVisibleText(page, [fallbackTarget], timeoutMs);
      await page.waitForTimeout(250);
      logs.push(`嘗試點擊「${fallbackTarget}」成功`);
      continue;
    }

    throw new Error(`STEP_TRANSLATION_FAILED unsupported custom step: ${sub}`);
  }

  detail.實際行為 = logs.join("；");
  return { stepText, logs, ...outputs };
};

const assertExpectedForCustom = async (page: Page, expectedTextRaw: string, detail: DetailCollector): Promise<void> => {
  const expectedText = expectedTextRaw.trim();
  if (!expectedText) throw new Error("EXPECTATION_NOT_ASSERTABLE empty expected text");

  const highlightMatch = expectedText.match(/[「『"“](.+?)[」』"”].*(高亮|選中|active|藍色)/i);
  if (highlightMatch) {
    const targetText = highlightMatch[1];
    const locator = page.getByText(targetText, { exact: false }).first();
    const count = await locator.count();
    if (count === 0) throw new Error(`ASSERT_HIGHLIGHT_FAILED target_not_found:${targetText}`);

    const state = await locator.evaluate((el) => {
      const classes = el.className || "";
      const style = getComputedStyle(el);
      return {
        classes: String(classes),
        backgroundColor: style.backgroundColor,
        color: style.color
      };
    });
    const isActive =
      /active|selected|current|highlight|is-active/i.test(state.classes) ||
      state.backgroundColor !== "rgba(0, 0, 0, 0)";
    if (!isActive) {
      throw new Error(`ASSERT_HIGHLIGHT_FAILED no_active_state:${targetText}`);
    }
    detail.判定 = `「${targetText}」高亮狀態符合預期`;
    return;
  }

  if (/應.*出現/.test(expectedText) && /(個|key|選項|值)/i.test(expectedText)) {
    const options = await collectDropdownOptions(page);
    if (options.length === 0) throw new Error("ASSERT_OPTIONS_FAILED no_options_found");
    const expectedCountMatch = expectedText.match(/(\d+)\s*個/);
    const expectedCount = expectedCountMatch ? Number(expectedCountMatch[1]) : undefined;
    const expectedOptions = parseExpectedOptionsFromText(expectedText);
    const missing = expectedOptions.filter((x) => !options.some((actual) => actual.includes(x)));
    if (expectedCount !== undefined && options.length !== expectedCount) {
      throw new Error(`ASSERT_OPTIONS_FAILED expectedCount=${expectedCount} actualCount=${options.length}`);
    }
    if (missing.length > 0) {
      throw new Error(`ASSERT_OPTIONS_FAILED missing=${missing.join(",")}`);
    }
    detail.判定 = `下拉選項比對通過（${options.length} 項）`;
    detail.抽樣數據 = options.slice(0, 10);
    return;
  }

  const rowsMatch = expectedText.match(/(?:回傳|應有|應為|共)\s*(\d+)\s*筆/);
  if (rowsMatch) {
    const expectedRows = Number(rowsMatch[1]);
    const actualRows = await tableRowCount(page);
    detail.筆數 = actualRows;
    if (actualRows !== expectedRows) {
      throw new Error(`ASSERT_ROW_COUNT_FAILED expected=${expectedRows} actual=${actualRows}`);
    }
    detail.判定 = `筆數比對通過（${actualRows} 筆）`;
    return;
  }

  const textPresenceMatch = expectedText.match(/(?:應出現|顯示)[「『"“](.+?)[」』"”]/);
  if (textPresenceMatch) {
    const targetText = textPresenceMatch[1];
    const locator = page.getByText(targetText, { exact: false }).first();
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      throw new Error(`ASSERT_TEXT_PRESENCE_FAILED expectedText=${targetText}`);
    }
    detail.判定 = `文字「${targetText}」已出現`;
    return;
  }

  throw new Error(`EXPECTATION_NOT_ASSERTABLE: ${expectedText.slice(0, 120)}`);
};

type ProcessCaseOptions = {
  interactiveMode: boolean;
};

const processCase = async (
  run: RunRow,
  item: CaseRow,
  state: ActiveRun,
  artifactsDir: string,
  options: ProcessCaseOptions
): Promise<void> => {
  if (item.execution_type === "manual") {
    return;
  }

  if (!state.page) {
    throw new Error("PAGE_NOT_INITIALIZED");
  }
  const page = state.page;

  const steps = db
    .prepare(
      "SELECT id, run_id, case_no, step_no, action_type, target_type, target_value, input_value, expected, require_approval, timeout_ms, retry, status FROM run_case_steps WHERE run_id = ? AND case_no = ? ORDER BY step_no ASC"
    )
    .all(run.id, item.case_no) as StepRow[];

  const baseDetail = parseCaseDetailJson(item.detail_json);
  const detail: DetailCollector = {
    ...baseDetail,
    測試類型: ensureString(baseDetail.測試類型, "未分類"),
    測試目的: ensureString(baseDetail.測試目的, item.case_title || `執行 ${item.case_no}`),
    設定條件: ensureString(baseDetail.設定條件, "未提供前置條件"),
    執行步驟: ensureString(baseDetail.執行步驟, "未提供執行步驟"),
    預期行為: ensureString(baseDetail.預期行為, "未提供預期結果"),
    執行方式: ensureString(baseDetail.執行方式, item.execution_type),
    實際行為: "開始執行"
  };
  const actionLogs: string[] = [];
  const observationLogs: string[] = [];
  const requestDates: Array<{ start?: string; end?: string }> = [];
  const caseExpectedText = ensureString(baseDetail.預期行為, "").trim();
  let customStepExecuted = false;
  let hasAssertionResult = false;

  const reqHandler = (req: import("playwright").Request): void => {
    if (req.method() !== "POST") return;
    const url = req.url();
    if (!/(preview|query|report)/i.test(url)) return;
    try {
      const payload = JSON.parse(req.postData() || "{}") as Record<string, unknown>;
      const dr = payload.dateRange as { start?: string; end?: string } | undefined;
      if (dr) {
        requestDates.push({ start: dr.start, end: dr.end });
        if (dr.start) detail["requestBody.dateRange.start"] = dr.start;
        if (dr.end) detail["requestBody.dateRange.end"] = dr.end;
      }
    } catch {
      // ignore malformed body
    }
  };

  const respHandler = async (resp: import("playwright").Response): Promise<void> => {
    const url = resp.url();
    if (!/(preview|query|report)/i.test(url)) return;
    detail.responseStatus = resp.status();
    try {
      const body = (await resp.json()) as Record<string, unknown>;
      const rows =
        (Array.isArray(body.data) ? body.data.length : undefined) ??
        (typeof body.total === "number" ? body.total : undefined) ??
        (typeof body.rowCount === "number" ? body.rowCount : undefined);
      if (rows !== undefined) {
        detail.responseRowCount = rows;
        detail.筆數 = rows;
      }
    } catch {
      // ignore non-json response
    }
  };
  page.on("request", reqHandler);
  page.on("response", respHandler);

  if (steps.length === 0) {
    const shotPath = path.join(artifactsDir, `${item.case_no}_blocked_no_steps.png`);
    if (!options.interactiveMode) {
      await page.goto(run.dev_url, { waitUntil: "domcontentloaded", timeout: config.playwrightTimeoutMs });
    }
    await page.screenshot({ path: shotPath, fullPage: true });
    detail.實際行為 = "找不到可執行步驟，未執行測試";
    detail.BLOCKED原因 = "STEP_NOT_FOUND";
    detail.截圖路徑 = shotPath;
    setCaseResult(run.id, item.case_no, "BLOCKED", "ENV_BLOCKED", detail);
    page.off("request", reqHandler);
    page.off("response", respHandler);
    throw new CaseExecutionError("STEP_NOT_FOUND", detail);
  }

  if (!options.interactiveMode) {
    try {
      await page.goto(run.dev_url, { waitUntil: "domcontentloaded", timeout: config.playwrightTimeoutMs });
      actionLogs.push("setup:goto:PASS");
      observationLogs.push("已開啟測試頁面");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let failShotPath = "";
      try {
        failShotPath = path.join(artifactsDir, `${item.case_no}_setup_goto_fail.png`);
        await page.screenshot({ path: failShotPath, fullPage: true });
      } catch {
        // ignore screenshot failure
      }
      detail.實際行為 = "開啟測試頁面失敗";
      detail.錯誤原因 = message;
      if (failShotPath) detail.截圖路徑 = failShotPath;
      page.off("request", reqHandler);
      page.off("response", respHandler);
      throw new CaseExecutionError(`SETUP_GOTO_FAILED ${message}`, detail);
    }
  } else {
    actionLogs.push("setup:interactive:PASS");
    observationLogs.push("互動模式沿用當前頁面狀態");
  }

  for (const step of steps) {
    if (step.status === "PASS") {
      continue;
    }

    const timeoutMs = step.timeout_ms || config.playwrightTimeoutMs;
    const action = step.action_type.toLowerCase();
    const target = step.target_value ?? "";
    const targetType = (step.target_type ?? "").toLowerCase();

    try {
      if (step.require_approval) {
        const shotPath = path.join(artifactsDir, `${item.case_no}_step${step.step_no}_approval.png`);
        await page.screenshot({ path: shotPath, fullPage: true });
        db.prepare(
          "UPDATE run_case_steps SET status = 'WAITING_APPROVAL', actual_json = ?, updated_at = ? WHERE run_id = ? AND case_no = ? AND step_no = ?"
        ).run(JSON.stringify({ reason: "require_approval=true", screenshot: shotPath }), nowIso(), run.id, item.case_no, step.step_no);
        createApproval(run.id, item.case_no, step.step_no, "MANUAL_CHECK", shotPath);
        detail.實際行為 = `步驟 ${step.step_no} 需要人工確認`;
        detail.錯誤原因 = "require_approval=true";
        detail.截圖 = shotPath;
        setCaseResult(run.id, item.case_no, "BLOCKED", "ENV_BLOCKED", {
          ...detail,
          reason: "manual approval required",
          stepNo: step.step_no
        });
        page.off("request", reqHandler);
        page.off("response", respHandler);
        throw new CaseExecutionError(`MANUAL_CHECK_REQUIRED@${step.step_no}`, detail);
      }

      const tryCount = Math.max(0, step.retry) + 1;
      let lastError = "";
      let passed = false;

      for (let attempt = 1; attempt <= tryCount; attempt += 1) {
        try {
          const exec = async (): Promise<unknown> => {
            if (action === "goto") {
              const url = step.input_value || run.dev_url;
              await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
              return { url };
            }

            if (action === "waitfor") {
              if (!target) return { waited: "time" };
              if (targetType === "text") {
                await page.getByText(target, { exact: false }).first().waitFor({ timeout: timeoutMs });
              } else {
                await page.waitForSelector(target, { timeout: timeoutMs });
              }
              return { waited: target };
            }

            if (action === "click") {
              if (targetType === "text") {
                await page.getByText(target, { exact: false }).first().click({ timeout: timeoutMs });
              } else {
                await page.click(target, { timeout: timeoutMs });
              }
              return { clicked: target };
            }

            if (action === "fill") {
              await page.fill(target, step.input_value ?? "", { timeout: timeoutMs });
              return { filled: target };
            }

            if (action === "select") {
              await page.selectOption(target, step.input_value ?? "", { timeout: timeoutMs });
              return { selected: step.input_value ?? "" };
            }

            if (action === "press") {
              await page.press(target, step.input_value ?? "Enter", { timeout: timeoutMs });
              return { pressed: step.input_value ?? "Enter" };
            }

            if (action === "asserttext") {
              if (!step.expected) throw new Error("ASSERT_TEXT_EXPECTED_REQUIRED");
              const content =
                targetType === "text"
                  ? await page.getByText(target, { exact: false }).first().textContent()
                  : await page.textContent(target);
              const actual = String(content ?? "").trim();
              if (!actual.includes(step.expected)) {
                throw new Error(`ASSERT_TEXT_FAILED expected=${step.expected} actual=${actual}`);
              }
              return { actual, expected: step.expected };
            }

            if (action === "custom") {
              customStepExecuted = true;
              const result = await executeCustomNaturalStep(page, step, detail, timeoutMs);
              const expectedForStep = (step.expected ?? "").trim();
              if (expectedForStep) {
                await assertExpectedForCustom(page, expectedForStep, detail);
                hasAssertionResult = true;
                return { ...result, asserted: expectedForStep };
              }
              return result;
            }

            if (action === "screenshot") {
              const shotPath = path.join(artifactsDir, `${item.case_no}_step${step.step_no}.png`);
              await page.screenshot({ path: shotPath, fullPage: true });
              return { screenshot: shotPath };
            }

            if (action === "download") {
              const download = await Promise.race([
                page.waitForEvent("download", { timeout: timeoutMs }),
                (async () => {
                  if (targetType === "text") {
                    await page.getByText(target, { exact: false }).first().click({ timeout: timeoutMs });
                  } else {
                    await page.click(target, { timeout: timeoutMs });
                  }
                  return page.waitForEvent("download", { timeout: timeoutMs });
                })()
              ]);
              const savePath = path.join(artifactsDir, `${item.case_no}_step${step.step_no}_${download.suggestedFilename()}`);
              await download.saveAs(savePath);
              return { download: savePath };
            }

            if (action === "upload") {
              if (!step.input_value) throw new Error("UPLOAD_INPUT_PATH_REQUIRED");
              await page.setInputFiles(target, step.input_value, { timeout: timeoutMs });
              return { uploaded: step.input_value };
            }

            if (action === "runscript") {
              const script = step.input_value || "(() => document.title)()";
              const result = await page.evaluate(script as unknown as () => unknown);
              return { script, result };
            }

            if (action === "assertdata") {
              const rows = await page.evaluate(() => {
                const trs = Array.from(document.querySelectorAll("table tr"));
                return trs
                  .map((tr) => Array.from(tr.querySelectorAll("th,td")).map((x) => (x.textContent || "").trim()))
                  .filter((r) => r.length > 0);
              });
              const rowCount = rows.length;
              const expectedMin = Number(step.expected ?? "1");
              if (Number.isFinite(expectedMin) && rowCount < expectedMin) {
                throw new Error(`ASSERT_DATA_FAILED expectedRows>=${expectedMin} actual=${rowCount}`);
              }
              return { rowCount, sample: rows.slice(0, 3) };
            }

            if (action === "comparecsv") {
              if (!step.input_value) throw new Error("COMPARE_CSV_INPUT_PATH_REQUIRED");
              const expectedRows = readCsvRows(step.input_value);
              const actualRows = await page.evaluate(() => {
                const trs = Array.from(document.querySelectorAll("table tr"));
                return trs
                  .map((tr) => Array.from(tr.querySelectorAll("th,td")).map((x) => (x.textContent || "").trim()))
                  .filter((r) => r.length > 0);
              });
              const compared = Math.min(expectedRows.length, actualRows.length);
              let mismatches = 0;
              for (let i = 0; i < compared; i += 1) {
                const a = JSON.stringify(expectedRows[i]);
                const b = JSON.stringify(actualRows[i]);
                if (a !== b) mismatches += 1;
              }
              if (mismatches > 0) {
                throw new Error(`COMPARE_CSV_FAILED mismatches=${mismatches} compared=${compared}`);
              }
              return { compared, mismatches };
            }

            throw new Error(`ACTION_NOT_IMPLEMENTED:${action}`);
          };

          const result = await Promise.race([
            exec(),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`STEP_TIMEOUT_${timeoutMs}ms`)), timeoutMs))
          ]);
          actionLogs.push(`step${step.step_no}:${action}:PASS`);
          observationLogs.push(`步驟 ${step.step_no} ${action} 執行成功`);
          if (action === "asserttext" && typeof step.expected === "string") {
            detail.文字比對 = `預期包含「${step.expected}」`;
            hasAssertionResult = true;
          }
          if (action === "assertdata") {
            const data = result as { rowCount?: number };
            if (typeof data.rowCount === "number") {
              detail.筆數 = data.rowCount;
              observationLogs.push(`資料筆數 ${data.rowCount}`);
            }
            hasAssertionResult = true;
          }
          if (action === "comparecsv") {
            const data = result as { compared?: number; mismatches?: number };
            detail.比對方式 = "預覽數據 vs CSV 逐筆比對";
            detail.比對結果 = `${data.compared ?? 0} 筆比對`;
            detail.差異筆數 = data.mismatches ?? 0;
            observationLogs.push(`CSV 比對 ${data.compared ?? 0} 筆，差異 ${data.mismatches ?? 0} 筆`);
            hasAssertionResult = true;
          }
          if (action === "custom" && typeof (result as { asserted?: string }).asserted === "string") {
            observationLogs.push("中文預期結果驗證通過");
          }
          if (action === "screenshot") {
            const data = result as { screenshot?: string };
            if (data.screenshot) detail.截圖路徑 = data.screenshot;
          }
          setStepResult(run.id, item.case_no, step.step_no, "PASS", {
            attempt,
            result
          });
          passed = true;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          actionLogs.push(`step${step.step_no}:${action}:FAIL(${lastError})`);
          insertRunLog(run.id, "WARN", "Step attempt failed", {
            caseNo: item.case_no,
            stepNo: step.step_no,
            attempt,
            maxAttempt: tryCount,
            error: lastError
          });
        }
      }

      if (!passed) {
        let failShotPath = "";
        try {
          failShotPath = path.join(artifactsDir, `${item.case_no}_step${step.step_no}_fail.png`);
          await page.screenshot({ path: failShotPath, fullPage: true });
        } catch {
          // ignore screenshot failure
        }
        detail.實際行為 = `步驟 ${step.step_no} 失敗`;
        detail.錯誤原因 = lastError || `STEP_FAILED@${step.step_no}`;
        if (failShotPath) detail.截圖路徑 = failShotPath;
        setStepResult(run.id, item.case_no, step.step_no, "FAIL", undefined, lastError);
        page.off("request", reqHandler);
        page.off("response", respHandler);
        throw new CaseExecutionError(lastError || `STEP_FAILED@${step.step_no}`, detail);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.startsWith("MANUAL_CHECK_REQUIRED@")) {
        setStepResult(run.id, item.case_no, step.step_no, "FAIL", undefined, message);
      }
      throw error;
    }
  }

  if (customStepExecuted && !hasAssertionResult) {
    const fallbackExpected = caseExpectedText;
    if (!fallbackExpected) {
      const message = "EXPECTATION_NOT_ASSERTABLE empty expected text";
      let failShotPath = "";
      try {
        failShotPath = path.join(artifactsDir, `${item.case_no}_expected_missing.png`);
        await page.screenshot({ path: failShotPath, fullPage: true });
      } catch {
        // ignore screenshot failure
      }
      detail.實際行為 = "案例步驟執行完成，但未提供可驗證預期";
      detail.錯誤原因 = message;
      if (failShotPath) detail.截圖路徑 = failShotPath;
      page.off("request", reqHandler);
      page.off("response", respHandler);
      throw new CaseExecutionError(message, detail);
    }

    try {
      await assertExpectedForCustom(page, fallbackExpected, detail);
      hasAssertionResult = true;
      observationLogs.push("依案例預期結果完成驗證");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let failShotPath = "";
      try {
        failShotPath = path.join(artifactsDir, `${item.case_no}_expected_assert_fail.png`);
        await page.screenshot({ path: failShotPath, fullPage: true });
      } catch {
        // ignore screenshot failure
      }
      detail.實際行為 = "案例步驟執行完成，但預期驗證失敗";
      detail.錯誤原因 = message;
      if (failShotPath) detail.截圖路徑 = failShotPath;
      page.off("request", reqHandler);
      page.off("response", respHandler);
      throw new CaseExecutionError(message, detail);
    }
  }

  if (requestDates.length > 0) {
    const last = requestDates[requestDates.length - 1];
    const dateRangeText = `${last.start ?? "-"} ~ ${last.end ?? "-"}`;
    detail.日期範圍 = dateRangeText;
  }
  if (actionLogs.length > 0) {
    detail.實際行為 =
      observationLogs.length > 0
        ? observationLogs.slice(0, 6).join("；")
        : `完成 ${actionLogs.length} 個步驟`;
    detail.步驟摘要 = actionLogs.slice(0, 20);
  }
  page.off("request", reqHandler);
  page.off("response", respHandler);
  setCaseResult(run.id, item.case_no, "PASS", null, {
    ...detail,
    mode: "step-execution",
    steps: steps.length
  });
};

const blockPendingAutoCases = (runId: string, failCategory: string, reason: string): void => {
  const now = nowIso();
  db.prepare(
    `
      UPDATE run_cases
      SET result_status = 'BLOCKED',
          fail_category = ?,
          detail_json = ?,
          updated_at = ?
      WHERE run_id = ?
        AND execution_type IN ('auto', 'semi')
        AND result_status = 'PENDING'
    `
  ).run(
    failCategory,
    JSON.stringify({
      測試目的: "Runner 進程中斷後保護性封鎖",
      設定條件: `runId=${runId}`,
      預期行為: "未執行案例應標記為 BLOCKED",
      實際行為: `Runner fallback: ${reason}`,
      錯誤原因: reason,
      mode: "runner-fallback",
      timestamp: now
    }),
    now,
    runId
  );
};

const runJob = async (runId: string): Promise<void> => {
  const run = db
    .prepare("SELECT id, dev_url, status, execution_mode FROM runs WHERE id = ?")
    .get(runId) as RunRow | undefined;
  if (!run) return;
  if (run.status !== "READY") {
    insertRunLog(runId, "WARN", "Run start ignored: status is not READY", { status: run.status });
    return;
  }

  const interactiveMode = (run.execution_mode ?? "offline") === "interactive";

  const cases = db
    .prepare(
      "SELECT id, run_id, case_no, group_name, case_title, execution_type, result_status, detail_json FROM run_cases WHERE run_id = ? AND result_status IN ('PENDING','BLOCKED','FAIL','MANUAL_PENDING') ORDER BY created_at ASC"
    )
    .all(runId) as CaseRow[];
  if (cases.length === 0) {
    insertRunLog(runId, "WARN", "Run start blocked: no cases");
    setRunStatus(runId, "FAILED");
    return;
  }

  const state: ActiveRun = { startedAt: Date.now(), cancelRequested: false };
  activeRuns.set(runId, state);
  setRunStatus(runId, "RUNNING");
  insertRunLog(runId, "INFO", "Run started", { totalCases: cases.length, executionMode: run.execution_mode ?? "offline" });

  const artifactsDir = ensureArtifactsDir(runId);
  const stopHeartbeat = startHeartbeat(runId, state);
  let crashCount = 0;

  try {
    const launched = await launchBrowser(interactiveMode);
    state.browser = launched.browser;
    state.context = launched.context;
    state.page = launched.page;
    if (interactiveMode) {
      await ensureInteractiveEntry(runId, run, state.page);
    }

    for (const item of cases) {
      if (state.cancelRequested || isRunCancelled(runId)) {
        setRunStatus(runId, "CANCELLED");
        insertRunLog(runId, "WARN", "Run cancelled by request");
        return;
      }

      if (item.execution_type === "manual") {
        insertRunLog(runId, "INFO", "Manual case skipped from auto runner", { caseNo: item.case_no });
        continue;
      }

      try {
        await processCase(run, item, state, artifactsDir, { interactiveMode });
        insertRunLog(runId, "INFO", "Case executed", { caseNo: item.case_no, result: "PASS" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const category = message.startsWith("MANUAL_CHECK_REQUIRED@")
          ? "ENV_BLOCKED"
          : message.includes("STEP_NOT_FOUND")
            ? "ENV_BLOCKED"
          : message.includes("STEP_TRANSLATION_FAILED") || message.includes("EXPECTATION_NOT_ASSERTABLE")
            ? "ENV_BLOCKED"
            : message.includes("ACTION_NOT_IMPLEMENTED")
              ? "ENV_BLOCKED"
          : message.startsWith("ASSERT_")
            ? "ASSERTION_FAILED"
          : message.includes("Target page, context or browser has been closed")
            ? "BROWSER_CRASH"
            : "SYSTEM_ERROR";
        const resultStatus = category === "ENV_BLOCKED" || category === "BROWSER_CRASH" ? "BLOCKED" : "FAIL";
        if (category === "BROWSER_CRASH") crashCount += 1;

        if (!message.startsWith("MANUAL_CHECK_REQUIRED@")) {
          const detailFromError = error instanceof CaseExecutionError ? error.detailJson : undefined;
          const baseDetail = parseCaseDetailJson(item.detail_json);
          setCaseResult(runId, item.case_no, resultStatus, category, {
            ...baseDetail,
            測試目的: ensureString(baseDetail.測試目的, item.case_title || `執行 ${item.case_no}`),
            設定條件: ensureString(baseDetail.設定條件, "未提供前置條件"),
            執行步驟: ensureString(baseDetail.執行步驟, "未提供執行步驟"),
            預期行為: ensureString(baseDetail.預期行為, "未提供預期結果"),
            實際行為: resultStatus === "FAIL" ? "案例執行結果與預期不符" : "案例中斷或無法執行",
            ...(resultStatus === "BLOCKED" ? { BLOCKED原因: message } : {}),
            ...(resultStatus === "FAIL" ? { 錯誤原因: message } : {}),
            ...(detailFromError ?? {}),
            reason: message,
            mode: "step-or-smoke"
          });
        } else {
          setRunStatus(runId, "WAITING_APPROVAL");
          insertRunLog(runId, "WARN", "Run paused for manual approval", { caseNo: item.case_no, message });
          return;
        }
        insertRunLog(runId, "ERROR", "Case execution failed", { caseNo: item.case_no, category, message });

        if (category === "BROWSER_CRASH" && crashCount >= config.playwrightCrashConsecutiveThreshold) {
          setRunStatus(runId, "FAILED");
          insertRunLog(runId, "ERROR", "Run failed due to repeated browser crash", { crashCount });
          return;
        }

        if (category === "BROWSER_CRASH") {
          await closeBrowser(state);
          const relaunched = await launchBrowser(interactiveMode);
          state.browser = relaunched.browser;
          state.context = relaunched.context;
          state.page = relaunched.page;
          if (interactiveMode) {
            await ensureInteractiveEntry(runId, run, state.page);
          }
          continue;
        }
      }
    }

    const unresolved = db
      .prepare(
        "SELECT COUNT(1) AS count FROM run_cases WHERE run_id = ? AND result_status IN ('PENDING', 'MANUAL_PENDING')"
      )
      .get(runId) as { count: number };
    const blockedOrFail = db
      .prepare("SELECT COUNT(1) AS count FROM run_cases WHERE run_id = ? AND result_status IN ('BLOCKED','FAIL')")
      .get(runId) as { count: number };
    const pendingApprovals = db
      .prepare("SELECT COUNT(1) AS count FROM approvals WHERE run_id = ? AND status = 'PENDING'")
      .get(runId) as { count: number };

    if (pendingApprovals.count > 0 || unresolved.count > 0) {
      setRunStatus(runId, "WAITING_APPROVAL");
      insertRunLog(runId, "WARN", "Run waiting approval/manual fill", {
        unresolved: unresolved.count,
        pendingApprovals: pendingApprovals.count
      });
    } else if (blockedOrFail.count > 0) {
      setRunStatus(runId, "FAILED");
      insertRunLog(runId, "ERROR", "Run finished with blocked/failed cases", {
        blockedOrFail: blockedOrFail.count
      });
    } else {
      setRunStatus(runId, "SUCCEEDED");
      insertRunLog(runId, "INFO", "Run finished successfully");
    }
  } catch (error) {
    blockPendingAutoCases(
      runId,
      "SYSTEM_ERROR",
      error instanceof Error ? error.message : String(error)
    );
    setRunStatus(runId, "FAILED");
    insertRunLog(runId, "ERROR", "Run crashed with unhandled error", {
      message: error instanceof Error ? error.message : String(error)
    });
  } finally {
    stopHeartbeat();
    await closeBrowser(state);
    activeRuns.delete(runId);
  }
};

export const startRun = (runId: string): { accepted: boolean; reason?: string } => {
  if (activeRuns.has(runId)) {
    return { accepted: false, reason: "RUN_ALREADY_ACTIVE" };
  }

  // Fire-and-forget to keep endpoint responsive.
  void runJob(runId);
  return { accepted: true };
};

export const requestRunCancel = (runId: string): void => {
  const active = activeRuns.get(runId);
  if (active) active.cancelRequested = true;
};

export const hasConnectedPlaywrightBrowser = (): boolean => {
  for (const state of activeRuns.values()) {
    if (state.browser?.isConnected()) {
      return true;
    }
  }
  return false;
};
