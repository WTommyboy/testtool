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
};

type CaseRow = {
  id: string;
  run_id: string;
  case_no: string;
  case_title?: string;
  execution_type: string;
  result_status: string;
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
      : `入口=${row?.dev_url || "N/A"}`;
  const expected =
    typeof base.預期行為 === "string" && base.預期行為.trim() ? base.預期行為 : "案例應依測試設計完成";
  const actual =
    typeof base.實際行為 === "string" && base.實際行為.trim()
      ? base.實際行為
      : resultStatus === "PASS"
        ? "案例執行完成"
        : "案例執行失敗或中斷";

  base.測試目的 = String(purpose);
  base.設定條件 = String(condition);
  base.預期行為 = String(expected);
  base.實際行為 = String(actual);

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

const launchBrowser = async (): Promise<{ browser: Browser; context: BrowserContext; page: Page }> => {
  const browser = await chromium.launch({ headless: config.playwrightHeadless });
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

const processCase = async (run: RunRow, item: CaseRow, state: ActiveRun, artifactsDir: string): Promise<void> => {
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

  const detail: DetailCollector = {
    測試目的: item.case_title || `執行 ${item.case_no}`,
    設定條件: `入口=${run.dev_url}`,
    預期行為: "所有步驟應通過且符合預期",
    實際行為: "開始執行"
  };
  const actionLogs: string[] = [];
  const requestDates: Array<{ start?: string; end?: string }> = [];

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
    await state.page.goto(run.dev_url, { waitUntil: "domcontentloaded", timeout: config.playwrightTimeoutMs });
    const shotPath = path.join(artifactsDir, `${item.case_no}.png`);
    await state.page.screenshot({ path: shotPath, fullPage: true });
    detail.實際行為 = "完成 smoke navigation 並截圖";
    detail.截圖 = shotPath;
    setCaseResult(run.id, item.case_no, "PASS", null, {
      ...detail,
      mode: "smoke-navigation",
      url: run.dev_url
    });
    page.off("request", reqHandler);
    page.off("response", respHandler);
    return;
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

            return { skipped: true, reason: "ACTION_NOT_IMPLEMENTED", action };
          };

          const result = await Promise.race([
            exec(),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`STEP_TIMEOUT_${timeoutMs}ms`)), timeoutMs))
          ]);
          actionLogs.push(`step${step.step_no}:${action}:PASS`);
          if (action === "asserttext" && typeof step.expected === "string") {
            detail.預期行為 = `文字包含「${step.expected}」`;
          }
          if (action === "assertdata") {
            const data = result as { rowCount?: number };
            if (typeof data.rowCount === "number") {
              detail.筆數 = data.rowCount;
              detail.實際行為 = `資料筆數 ${data.rowCount}`;
            }
          }
          if (action === "comparecsv") {
            const data = result as { compared?: number; mismatches?: number };
            detail.比對方式 = "預覽數據 vs CSV 逐筆比對";
            detail.比對結果 = `${data.compared ?? 0} 筆比對`;
            detail.差異筆數 = data.mismatches ?? 0;
          }
          if (action === "screenshot") {
            const data = result as { screenshot?: string };
            if (data.screenshot) detail.截圖 = data.screenshot;
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
        if (failShotPath) detail.截圖 = failShotPath;
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

  if (requestDates.length > 0) {
    const last = requestDates[requestDates.length - 1];
    const dateRangeText = `${last.start ?? "-"} ~ ${last.end ?? "-"}`;
    detail.日期範圍 = dateRangeText;
  }
  if (actionLogs.length > 0) {
    detail.實際行為 = `步驟通過 ${actionLogs.length} 項`;
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
  const run = db.prepare("SELECT id, dev_url, status FROM runs WHERE id = ?").get(runId) as RunRow | undefined;
  if (!run) return;
  if (run.status !== "READY") {
    insertRunLog(runId, "WARN", "Run start ignored: status is not READY", { status: run.status });
    return;
  }

  const cases = db
    .prepare(
      "SELECT id, run_id, case_no, case_title, execution_type, result_status FROM run_cases WHERE run_id = ? AND result_status IN ('PENDING','BLOCKED','FAIL','MANUAL_PENDING') ORDER BY created_at ASC"
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
  insertRunLog(runId, "INFO", "Run started", { totalCases: cases.length });

  const artifactsDir = ensureArtifactsDir(runId);
  const stopHeartbeat = startHeartbeat(runId, state);
  let crashCount = 0;

  try {
    const launched = await launchBrowser();
    state.browser = launched.browser;
    state.context = launched.context;
    state.page = launched.page;

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
        await processCase(run, item, state, artifactsDir);
        insertRunLog(runId, "INFO", "Case executed", { caseNo: item.case_no, result: "PASS" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const category = message.startsWith("MANUAL_CHECK_REQUIRED@")
          ? "ENV_BLOCKED"
          : message.includes("Target page, context or browser has been closed")
            ? "BROWSER_CRASH"
            : "SYSTEM_ERROR";
        if (category === "BROWSER_CRASH") crashCount += 1;

        if (!message.startsWith("MANUAL_CHECK_REQUIRED@")) {
          const detailFromError = error instanceof CaseExecutionError ? error.detailJson : undefined;
          setCaseResult(runId, item.case_no, "BLOCKED", category, {
            測試目的: item.case_title || `執行 ${item.case_no}`,
            設定條件: `入口=${run.dev_url}`,
            預期行為: "案例應可執行完成",
            實際行為: "案例中斷或失敗",
            錯誤原因: message,
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
          const relaunched = await launchBrowser();
          state.browser = relaunched.browser;
          state.context = relaunched.context;
          state.page = relaunched.page;
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
