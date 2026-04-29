import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { config } from "./config";
import { agentRegistry } from "./agent/agent-registry";
import { db } from "./db";
import { requestRunCancel, startRun } from "./runner";
import { checkPlaywrightHealth } from "./playwright-health";
import { insertRunEvent, listRunEvents } from "./run-events";
import { parseTestcaseXlsx, type ParsedCase, type ParsedStep } from "./xlsx-parser";
import {
  parseResultXlsx,
  RESULT_XLSX_PARSER_VERSION,
  type ParsedBug,
  type ParsedResultCase
} from "./result-parser/result-xlsx-parser";
import {
  evaluateResultEvidenceGate,
  ResultEvidenceGateError,
  type ResultEvidenceGateReport
} from "./result-parser/result-evidence-gate";
import { readOptionalDomainPackFile } from "./domain-loader";

const router = Router();

const RUN_STATUS = [
  "DRAFT",
  "VALIDATING",
  "READY",
  "RUNNING",
  "WAITING_APPROVAL",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED"
] as const;

const CASE_EXECUTION_TYPE = ["auto", "semi", "manual"] as const;
const RUN_EXECUTION_MODE = ["offline", "interactive"] as const;
const CASE_RESULT_STATUS = [
  "PENDING",
  "PASS",
  "FAIL",
  "BLOCKED",
  "PARTIAL",
  "SKIPPED",
  "MANUAL_PENDING",
  "MANUAL_PASS",
  "MANUAL_FAIL",
  "MANUAL_BLOCKED"
] as const;

const ALLOWED_STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["VALIDATING", "READY", "CANCELLED"],
  VALIDATING: ["READY", "FAILED", "CANCELLED"],
  READY: ["RUNNING", "CANCELLED"],
  RUNNING: ["WAITING_APPROVAL", "SUCCEEDED", "FAILED", "CANCELLED"],
  WAITING_APPROVAL: ["RUNNING", "CANCELLED", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: []
};

const createRunSchema = z.object({
  domain: z.string().min(1).optional(),
  roundId: z.string().min(1),
  location: z.string().min(1),
  featureMain: z.string().min(1),
  featureSub: z.string().min(1),
  runName: z.string().min(1),
  devUrl: z.string().url(),
  executionMode: z.enum(RUN_EXECUTION_MODE).optional()
});

const createCasesSchema = z.object({
  items: z
    .array(
      z.object({
        caseNo: z.string().min(1),
        groupName: z.string().optional(),
        caseTitle: z.string().min(1),
        executionType: z.enum(CASE_EXECUTION_TYPE),
        detailJson: z.unknown().optional()
      })
    )
    .min(1)
});

const createStepsSchema = z.object({
  items: z
    .array(
      z.object({
        caseNo: z.string().min(1),
        stepNo: z.number().int().positive(),
        actionType: z.string().min(1),
        targetType: z.string().optional(),
        targetValue: z.string().optional(),
        inputValue: z.string().optional(),
        expected: z.string().optional(),
        requireApproval: z.boolean().optional(),
        timeoutMs: z.number().int().positive().optional(),
        retry: z.number().int().min(0).optional()
      })
    )
    .min(1)
});

const importXlsxSchema = z.object({
  filePath: z.string().min(1)
});

const approveSchema = z.object({
  caseNo: z.string().min(1),
  stepNo: z.number().int().min(0),
  action: z.enum(["continue", "skip"]),
  resolvedBy: z.string().min(1),
  note: z.string().optional()
});

const updateStatusSchema = z.object({
  targetStatus: z.enum(RUN_STATUS),
  reason: z.string().min(1).optional()
});

const manualFillSchema = z.object({
  caseNo: z.string().min(1),
  resultStatus: z.enum(["MANUAL_PASS", "MANUAL_FAIL", "MANUAL_BLOCKED"]),
  detailJson: z.unknown().optional(),
  manualFilledBy: z.string().min(1)
});

const dispatchAgentSchema = z.object({
  agentId: z.string().min(1)
});

const nowIso = (): string => new Date().toISOString();
const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);
const DEFAULT_ACTIVITY_PAGE_SIZE = 500;
const MAX_ACTIVITY_PAGE_SIZE = 1000;

type RunInputPaths = {
  testcase_xlsx_path?: string | null;
  testcase_md_path?: string | null;
  testcase_supporting_docs_json?: string | null;
  reference_csv_path?: string | null;
};

type RunOutputPaths = {
  result_xlsx_path?: string | null;
  log_path?: string | null;
};

type RunLogRow = {
  id: string;
  run_id: string;
  level: string;
  message: string;
  context_json: string | null;
  created_at: string;
};

const parseActivityLimit = (value: unknown): number => {
  const parsed = Number(value ?? DEFAULT_ACTIVITY_PAGE_SIZE);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ACTIVITY_PAGE_SIZE;
  return Math.min(Math.floor(parsed), MAX_ACTIVITY_PAGE_SIZE);
};

const countRunRows = (table: "run_logs" | "run_events", runId: string): number => {
  const row = db.prepare(`SELECT COUNT(1) AS count FROM ${table} WHERE run_id = ?`).get(runId) as { count: number };
  return row.count;
};

const listRunLogsPage = (
  runId: string,
  limit: number,
  afterId?: string
): { items: RunLogRow[]; hasMore: boolean; total: number; nextAfterId: string | null } => {
  const total = countRunRows("run_logs", runId);
  const pageLimit = limit + 1;
  const afterRow = afterId
    ? db.prepare("SELECT rowid FROM run_logs WHERE run_id = ? AND id = ?").get(runId, afterId) as { rowid: number } | undefined
    : undefined;
  if (afterId && !afterRow) {
    return { items: [], hasMore: false, total, nextAfterId: null };
  }

  const rows = afterRow
    ? db
        .prepare(
          `
            SELECT *
            FROM run_logs
            WHERE run_id = ? AND rowid > ?
            ORDER BY rowid ASC
            LIMIT ?
          `
        )
        .all(runId, afterRow.rowid, pageLimit) as RunLogRow[]
    : db
        .prepare(
          `
            SELECT *
            FROM run_logs
            WHERE run_id = ?
            ORDER BY rowid ASC
            LIMIT ?
          `
        )
        .all(runId, pageLimit) as RunLogRow[];

  const items = rows.slice(0, limit);
  return {
    items,
    hasMore: rows.length > limit,
    total,
    nextAfterId: items.at(-1)?.id ?? null
  };
};

type MdRun = {
  id: string;
  round_id: string;
  location: string | null;
  feature_main: string | null;
  feature_sub: string | null;
  run_name: string | null;
  dev_url: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
};

type MdCase = {
  case_no: string;
  case_title: string;
  group_name: string | null;
  execution_type: string | null;
  result_status: string | null;
  detail_json: string | null;
  fail_category: string | null;
  manual_filled_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type MdBug = {
  severity: string | null;
  related_case_no: string | null;
  description: string | null;
  suggestion: string | null;
};

const mdEscape = (input: unknown): string => {
  const text = String(input ?? "—");
  return text.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
};

const extractSummary = (c: MdCase): string => {
  if (!c.detail_json) return "—";
  try {
    const d = JSON.parse(c.detail_json) as Record<string, unknown>;
    const summaryKeys = ["問題", "錯誤原因", "BLOCKED原因", "實際行為", "實際", "比對結果", "結論", "備註"];
    for (const key of summaryKeys) {
      const value = d[key];
      if (typeof value === "string" && value.trim()) return value.trim().slice(0, 120);
    }
    const first = Object.values(d)[0];
    if (typeof first === "string" && first.trim()) return first.trim().slice(0, 120);
    if (typeof first === "number" || typeof first === "boolean") return String(first);
    return "—";
  } catch {
    return "—";
  }
};

const generateMd = (
  run: MdRun,
  cases: MdCase[],
  bugs: MdBug[],
  counts: Record<string, number>,
  total: number
): string => {
  const now = new Date();
  const nowText = now.toISOString().replace("T", " ").slice(0, 19);
  const reportDate = now.toISOString().slice(0, 10);
  const pct = (n: number): string => (total > 0 ? ((n / total) * 100).toFixed(1) : "0.0");
  const statusOrder = [
    "PASS",
    "FAIL",
    "BLOCKED",
    "PARTIAL",
    "SKIPPED",
    "MANUAL_PASS",
    "MANUAL_FAIL",
    "MANUAL_BLOCKED",
    "PENDING",
    "MANUAL_PENDING"
  ];
  const statusEmoji: Record<string, string> = {
    PASS: "✅",
    FAIL: "❌",
    BLOCKED: "🚫",
    PARTIAL: "⚠️",
    SKIPPED: "⏭️",
    MANUAL_PASS: "📝✅",
    MANUAL_FAIL: "📝❌",
    MANUAL_BLOCKED: "📝🚫",
    PENDING: "⏳",
    MANUAL_PENDING: "📝⏳"
  };

  const manualFillers = [
    ...new Set(cases.map((c) => c.manual_filled_by?.trim()).filter((x): x is string => Boolean(x)))
  ].join(", ");

  const startedAt = cases[0]?.created_at ?? run.created_at ?? "—";
  const finishedAt = cases[cases.length - 1]?.updated_at ?? run.updated_at ?? "—";

  let md = "";
  md += "# Galaxy UAT 測試報告\n\n";
  md += "| 項目 | 內容 |\n";
  md += "|------|------|\n";
  md += `| 輪次ID | ${mdEscape(run.round_id)} |\n`;
  md += `| 位置 | ${mdEscape(run.location ?? "—")} |\n`;
  md += `| 功能 | ${mdEscape(run.feature_main ?? "—")} / ${mdEscape(run.feature_sub ?? "—")} |\n`;
  md += `| 輪次名稱 | ${mdEscape(run.run_name ?? "—")} |\n`;
  md += `| 測試環境 | ${mdEscape(run.dev_url ?? "—")} |\n`;
  md += `| 執行時間 | ${mdEscape(startedAt)} ~ ${mdEscape(finishedAt)} |\n`;
  md += `| 測試者 | Playwright Runner${manualFillers ? ` + ${mdEscape(manualFillers)}` : ""} |\n`;
  md += `| 狀態 | ${mdEscape(run.status)} |\n\n`;
  md += "---\n\n";

  md += "## 測試結果摘要\n\n";
  md += "| 結果 | 數量 | 佔比 |\n";
  md += "|------|------|------|\n";
  for (const status of statusOrder) {
    const count = counts[status] ?? 0;
    if (count > 0) {
      md += `| ${statusEmoji[status] ?? ""} ${status} | ${count} | ${pct(count)}% |\n`;
    }
  }
  md += `| **總計** | **${total}** | **100%** |\n\n`;
  md += "---\n\n";

  md += "## 已完成的 Test Case（摘要表）\n\n";
  md += "| 編號 | 測試項目 | 結果 | 備註 |\n";
  md += "|------|---------|------|------|\n";
  for (const c of cases) {
    md += `| ${mdEscape(c.case_no)} | ${mdEscape(c.case_title)} | **${mdEscape(c.result_status ?? "—")}** | ${mdEscape(extractSummary(c))} |\n`;
  }
  md += "\n---\n\n";

  if (bugs.length > 0) {
    md += "## 已發現 Bug 摘要\n\n";
    md += "| # | 嚴重度 | 編號 | 描述 | 建議確認方式 |\n";
    md += "|---|--------|------|------|------------|\n";
    bugs.forEach((b, i) => {
      md += `| ${i + 1} | **${mdEscape(b.severity ?? "—")}** | ${mdEscape(b.related_case_no ?? "—")} | ${mdEscape(b.description ?? "—")} | ${mdEscape(b.suggestion ?? "—")} |\n`;
    });
    md += "\n---\n\n";
  }

  md += "## 詳細執行紀錄\n\n";
  let lastGroup = "";
  for (const c of cases) {
    const groupName = c.group_name?.trim() || "未分組";
    if (groupName !== lastGroup) {
      lastGroup = groupName;
      md += `### ${mdEscape(groupName)}\n\n`;
    }

    md += `#### ${mdEscape(c.case_no)}｜${mdEscape(c.case_title)}\n\n`;
    md += "| 項目 | 內容 |\n";
    md += "|------|------|\n";
    md += `| **測試日** | ${mdEscape(c.updated_at ?? c.created_at ?? "—")} |\n`;
    md += `| **執行方式** | ${mdEscape(c.execution_type ?? "—")} |\n`;
    md += `| **結果** | **${mdEscape(c.result_status ?? "—")}** |\n`;
    if (c.fail_category) {
      md += `| **失敗分類** | ${mdEscape(c.fail_category)} |\n`;
    }
    if (c.detail_json) {
      try {
        const detail = JSON.parse(c.detail_json) as Record<string, unknown>;
        for (const [k, v] of Object.entries(detail)) {
          const detailValue = typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
          md += `| **${mdEscape(k)}** | ${mdEscape(detailValue)} |\n`;
        }
      } catch {
        md += "| **狀態** | detail_json 格式異常 |\n";
      }
    } else {
      md += "| **狀態** | 尚未有詳細紀錄 |\n";
    }
    md += "\n---\n\n";
  }

  md += "## 測試環境資訊\n\n";
  md += "| 項目 | 內容 |\n";
  md += "|------|------|\n";
  md += `| Dev URL | ${mdEscape(run.dev_url ?? "—")} |\n`;
  md += "| 測試工具 | UAT Test Tool (Playwright) |\n";
  md += `| 報告生成時間 | ${mdEscape(nowText)} |\n`;
  md += `| 報告日期 | ${mdEscape(reportDate)} |\n`;

  return md;
};

const getRun = (runId: string): Record<string, unknown> | undefined =>
  db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;

const deleteRunCascade = (runId: string): void => {
  const remove = db.transaction((id: string) => {
    for (const table of ["run_case_steps", "approvals", "bugs", "run_cases", "run_logs", "run_events"]) {
      db.prepare(`DELETE FROM ${table} WHERE run_id = ?`).run(id);
    }
    db.prepare("DELETE FROM runs WHERE id = ?").run(id);
  });
  remove(runId);
};

const getRequestBaseUrl = (req: Request): string => {
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim();
  const proto = forwardedProto || req.protocol;
  const forwardedHost = String(req.headers["x-forwarded-host"] ?? "").split(",")[0]?.trim();
  const host = forwardedHost || req.get("host") || "localhost";
  return `${proto}://${host}`;
};

type SupportingDoc = {
  path: string;
  originalName: string;
  mimeType?: string;
  size?: number;
};

const cjkCharCount = (value: string): number => value.match(/[\u4e00-\u9fff]/g)?.length ?? 0;

const normalizeUploadOriginalName = (value: string): string => {
  const decoded = Buffer.from(value, "latin1").toString("utf8");
  return cjkCharCount(decoded) > cjkCharCount(value) ? decoded : value;
};

const parseSupportingDocs = (value: unknown): SupportingDoc[] => {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return null;
        const doc = item as Record<string, unknown>;
        if (typeof doc.path !== "string" || !doc.path.trim()) return null;
        const supportingDoc: SupportingDoc = {
          path: doc.path,
          originalName: typeof doc.originalName === "string" && doc.originalName.trim()
            ? doc.originalName
            : path.basename(doc.path),
          mimeType: typeof doc.mimeType === "string" ? doc.mimeType : undefined,
          size: typeof doc.size === "number" ? doc.size : undefined
        };
        return supportingDoc;
      })
      .filter((item): item is SupportingDoc => Boolean(item));
  } catch {
    return [];
  }
};

const getRunInputUrls = (req: Request, runId: string, paths: RunInputPaths): Record<string, string> => {
  const base = getRequestBaseUrl(req);
  const urls: Record<string, string> = {};
  if (paths.testcase_xlsx_path) {
    urls.xlsx = `${base}/api/runs/${runId}/input/xlsx`;
  }
  if (paths.testcase_md_path) {
    urls.md = `${base}/api/runs/${runId}/input/md`;
    urls.startup_instruction = `${base}/api/runs/${runId}/input/startup`;
  }
  const supportingDocs = parseSupportingDocs(paths.testcase_supporting_docs_json);
  supportingDocs.forEach((doc, index) => {
    urls[`supporting_doc_${index + 1}`] = `${base}/api/runs/${runId}/input/supporting/${index}/${encodeURIComponent(doc.originalName)}`;
  });
  if (paths.reference_csv_path) {
    urls.baseline = `${base}/api/runs/${runId}/input/baseline`;
  }
  return urls;
};

const getDomainInputUrls = (req: Request, domain: string): Record<string, string> => {
  const base = getRequestBaseUrl(req);
  const encodedDomain = encodeURIComponent(domain || "BI");
  const urls: Record<string, string> = {
    domain_rules: `${base}/api/domains/${encodedDomain}/rules`,
    domain_schema: `${base}/api/domains/${encodedDomain}/schema`,
    domain_result_adapter: `${base}/api/domains/${encodedDomain}/result-adapter`,
    domain_startup_template: `${base}/api/domains/${encodedDomain}/startup-template`
  };
  if (readOptionalDomainPackFile(domain || "BI", "locators/demo001-locator-registry.json") !== null) {
    urls.domain_locator_registry = `${base}/api/domains/${encodedDomain}/locator-registry`;
  }
  return urls;
};

const getRunOutputUrls = (req: Request, runId: string): Record<string, string> => {
  const base = getRequestBaseUrl(req);
  return {
    result_xlsx: `${base}/api/runs/${runId}/output/result-xlsx`,
    log: `${base}/api/runs/${runId}/output/log`
  };
};

const stringBodyField = (req: Request, key: string): string | null => {
  const value = (req.body as Record<string, unknown> | undefined)?.[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
};

const stringArrayBodyField = (req: Request, key: string): string[] => {
  const value = (req.body as Record<string, unknown> | undefined)?.[key];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
    }
  } catch {
    // Fall through to comma-separated parsing for simple manual requests.
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
};

const parseJsonObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const extractToolRequestIdFromReason = (reason: unknown): string | null => {
  if (typeof reason !== "string") return null;
  const match = reason.match(/request_id:\s*([^\s]+)/);
  return match?.[1] ?? null;
};

const findToolRequestEvent = (runId: string, requestId: string | null): { agentId: string; requestId: string | null } | null => {
  const rows = db
    .prepare(
      `
        SELECT payload_json
        FROM run_events
        WHERE run_id = ? AND event_type = 'tool_request.created'
        ORDER BY rowid DESC
        LIMIT 20
      `
    )
    .all(runId) as Array<{ payload_json: string | null }>;

  for (const row of rows) {
    const payload = parseJsonObject(row.payload_json);
    const agentId = typeof payload?.agentId === "string" ? payload.agentId : null;
    const toolPayload = payload?.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
      ? payload.payload as Record<string, unknown>
      : {};
    const eventRequestId = typeof toolPayload.request_id === "string" ? toolPayload.request_id : null;
    if (agentId && (!requestId || requestId === eventRequestId)) {
      return { agentId, requestId: eventRequestId };
    }
  }
  return null;
};

const dispatchToolResponseIfNeeded = (
  runId: string,
  approval: Record<string, unknown>,
  parsed: z.infer<typeof approveSchema>
): { sent: boolean; agentId?: string; messageId?: string; requestId?: string | null; error?: string } => {
  const reason = typeof approval.reason === "string" ? approval.reason : "";
  if (!reason.startsWith("TOOL_REQUEST")) return { sent: false };

  const requestId = extractToolRequestIdFromReason(reason);
  const event = findToolRequestEvent(runId, requestId);
  if (!event) {
    return { sent: false, requestId, error: "TOOL_REQUEST_EVENT_NOT_FOUND" };
  }

  try {
    const message = agentRegistry.send(
      event.agentId,
      "tool_response",
      {
        run_id: runId,
        request_id: event.requestId ?? requestId,
        approved: parsed.action === "continue",
        note: parsed.note ?? "",
        resolved_by: parsed.resolvedBy
      },
      true
    );
    insertRunEvent(runId, "tool_response.sent", {
      agentId: event.agentId,
      requestId: event.requestId ?? requestId,
      approved: parsed.action === "continue",
      messageId: message.id
    }, message.seq);
    insertRunLog(runId, "INFO", "Tool response sent to Mac Agent", {
      agentId: event.agentId,
      requestId: event.requestId ?? requestId,
      approved: parsed.action === "continue",
      messageId: message.id
    });
    return { sent: true, agentId: event.agentId, messageId: message.id, requestId: event.requestId ?? requestId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    insertRunLog(runId, "ERROR", "Tool response dispatch failed", {
      agentId: event.agentId,
      requestId: event.requestId ?? requestId,
      error: message
    });
    return { sent: false, agentId: event.agentId, requestId: event.requestId ?? requestId, error: message };
  }
};

const safeSendRunInputFile = (res: Response, filePath: unknown, downloadName: string): Response | void => {
  if (typeof filePath !== "string" || !filePath.trim()) {
    return res.status(404).json({ error: "RUN_INPUT_NOT_FOUND" });
  }

  const resolved = path.resolve(filePath);
  const storageRoot = path.resolve(config.storageRoot);
  if (!resolved.startsWith(storageRoot + path.sep) && resolved !== storageRoot) {
    return res.status(403).json({ error: "RUN_INPUT_OUTSIDE_STORAGE" });
  }
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: "RUN_INPUT_FILE_MISSING" });
  }

  return res.download(resolved, downloadName);
};

const safeSendRunOutputFile = (res: Response, filePath: unknown, downloadName: string): Response | void => {
  if (typeof filePath !== "string" || !filePath.trim()) {
    return res.status(404).json({ error: "RUN_OUTPUT_NOT_FOUND" });
  }

  const resolved = path.resolve(filePath);
  const storageRoot = path.resolve(config.storageRoot);
  if (!resolved.startsWith(storageRoot + path.sep) && resolved !== storageRoot) {
    return res.status(403).json({ error: "RUN_OUTPUT_OUTSIDE_STORAGE" });
  }
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: "RUN_OUTPUT_FILE_MISSING" });
  }

  return res.download(resolved, downloadName);
};

const setRunStatusWithMeta = (runId: string, status: string, testerPrefix = "Playwright Runner"): void => {
  const now = nowIso();
  db.prepare("UPDATE runs SET status = ?, updated_at = ? WHERE id = ?").run(status, now, runId);

  if (!TERMINAL_STATUSES.has(status)) return;

  const run = getRun(runId) as { created_at?: string } | undefined;
  const startDate = run?.created_at ? new Date(String(run.created_at)).toISOString().slice(0, 10) : "";
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
  const tester = `${testerPrefix}${manualFillers.length > 0 ? ` + ${manualFillers.join(", ")}` : ""}`;

  db.prepare("UPDATE runs SET date = ?, tester = ?, finished_at = ?, updated_at = ? WHERE id = ?").run(
    dateStr,
    tester,
    now,
    now,
    runId
  );
};

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

const prepareUpsertCaseStmt = () =>
  db.prepare(
    `
      INSERT INTO run_cases (
        id, run_id, case_no, group_name, case_title, execution_type, result_status, detail_json, created_at, updated_at
      ) VALUES (
        @id, @run_id, @case_no, @group_name, @case_title, @execution_type, @result_status, @detail_json, @created_at, @updated_at
      )
      ON CONFLICT(run_id, case_no) DO UPDATE SET
        group_name = excluded.group_name,
        case_title = excluded.case_title,
        execution_type = excluded.execution_type,
        result_status = excluded.result_status,
        detail_json = excluded.detail_json,
        updated_at = excluded.updated_at
    `
  );

const prepareUpsertStepStmt = () =>
  db.prepare(
    `
      INSERT INTO run_case_steps (
        id, run_id, case_no, step_no, action_type, target_type, target_value, input_value, expected,
        require_approval, timeout_ms, retry, status, created_at, updated_at
      ) VALUES (
        @id, @run_id, @case_no, @step_no, @action_type, @target_type, @target_value, @input_value, @expected,
        @require_approval, @timeout_ms, @retry, @status, @created_at, @updated_at
      )
      ON CONFLICT(run_id, case_no, step_no) DO UPDATE SET
        action_type = excluded.action_type,
        target_type = excluded.target_type,
        target_value = excluded.target_value,
        input_value = excluded.input_value,
        expected = excluded.expected,
        require_approval = excluded.require_approval,
        timeout_ms = excluded.timeout_ms,
        retry = excluded.retry,
        updated_at = excluded.updated_at
    `
  );

const uploadRoot = path.resolve(config.storageRoot, "uploads");
fs.mkdirSync(uploadRoot, { recursive: true });
const outputRoot = path.resolve(config.storageRoot, "outputs");
fs.mkdirSync(outputRoot, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadRoot),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${randomUUID()}${ext}`);
    }
  })
});

const resultUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, outputRoot),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || (file.fieldname === "log" ? ".log" : ".xlsx");
      cb(null, `${Date.now()}-${randomUUID()}${ext}`);
    }
  })
});

const upsertImportedTestcase = (
  runId: string,
  imported: { cases: ParsedCase[]; steps: ParsedStep[] }
): { manualCases: number } => {
  const now = nowIso();
  let manualCases = 0;
  const upsertCaseStmt = prepareUpsertCaseStmt();
  const upsertStepStmt = prepareUpsertStepStmt();

  const tx = db.transaction(() => {
    for (const item of imported.cases) {
      const resultStatus = item.executionType === "manual" ? "MANUAL_PENDING" : "PENDING";
      if (item.executionType === "manual") manualCases += 1;
      upsertCaseStmt.run({
        id: randomUUID(),
        run_id: runId,
        case_no: item.caseNo,
        group_name: item.groupName ?? null,
        case_title: item.caseTitle,
        execution_type: item.executionType,
        result_status: resultStatus,
        detail_json: item.detailJson ? JSON.stringify(item.detailJson) : null,
        created_at: now,
        updated_at: now
      });
    }

    for (const step of imported.steps) {
      upsertStepStmt.run({
        id: randomUUID(),
        run_id: runId,
        case_no: step.caseNo,
        step_no: step.stepNo,
        action_type: step.actionType,
        target_type: step.targetType ?? null,
        target_value: step.targetValue ?? null,
        input_value: step.inputValue ?? null,
        expected: step.expected ?? null,
        require_approval: step.requireApproval ? 1 : 0,
        timeout_ms: step.timeoutMs,
        retry: step.retry,
        status: "PENDING",
        created_at: now,
        updated_at: now
      });
    }
  });
  tx();

  db.prepare("UPDATE runs SET updated_at = ? WHERE id = ?").run(now, runId);
  return { manualCases };
};

const normalizeParsedResultStatus = (status: string): string => {
  const normalized = status.trim().toUpperCase().replace(/\s+/g, "_");
  if ((CASE_RESULT_STATUS as readonly string[]).includes(normalized)) return normalized;
  return normalized || "PENDING";
};

const buildDetailJsonForParsedCase = (item: ParsedResultCase): string | null => {
  if (item.detailJson) return JSON.stringify(item.detailJson);
  if (!item.detailJsonRaw && !item.detailParseError) return null;
  return JSON.stringify({
    詳細紀錄JSON解析狀態: "INVALID_JSON",
    錯誤原因: item.detailParseError ?? "unknown",
    原始內容: item.detailJsonRaw ?? ""
  });
};

const resultHasFailedOutcome = (cases: ParsedResultCase[]): boolean => {
  const passLike = new Set(["PASS", "MANUAL_PASS", "SKIPPED"]);
  if (cases.length === 0) return true;
  return cases.some((item) => !passLike.has(normalizeParsedResultStatus(item.status)));
};

const stepStatusForCaseResult = (status: string): "PASS" | "FAIL" | "SKIPPED" => {
  if (status === "PASS" || status === "MANUAL_PASS") return "PASS";
  if (status === "SKIPPED") return "SKIPPED";
  return "FAIL";
};

const formatParsedBugDescription = (bug: ParsedBug): string => {
  const parts = [`${bug.bugId} ${bug.title}`.trim()];
  if (bug.description) parts.push(bug.description);
  if (bug.status) parts.push(`狀態: ${bug.status}`);
  return parts.filter(Boolean).join("\n");
};

type ResultIngestOptions = {
  resultSource?: string | null;
  currentCaseNo?: string | null;
  expectedCaseNos?: string[];
};

const normalizeCaseNoForGate = (value: string): string =>
  value
    .trim()
    .replace(/\s+/g, "")
    .replace(/^DEMO-/i, "")
    .toUpperCase();

const uniqueCaseNosForGate = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = normalizeCaseNoForGate(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
};

const expectedCaseNosForRun = (runId: string): string[] => {
  const rows = db
    .prepare("SELECT case_no FROM run_cases WHERE run_id = ? ORDER BY created_at ASC, case_no ASC")
    .all(runId) as Array<{ case_no: string }>;
  return uniqueCaseNosForGate(rows.map((item) => item.case_no));
};

const writeResultEvidenceGateReport = (filePath: string, report: ResultEvidenceGateReport): string => {
  const reportPath = `${filePath}.result-evidence-gate.json`;
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
};

const ingestResultXlsx = async (
  runId: string,
  filePath: string,
  options: ResultIngestOptions = {}
): Promise<{
  cases: number;
  bugs: number;
  parserVersion: string;
  runStatus: string;
  resultEvidenceGate: { status: string; issueCount: number; reportPath: string };
}> => {
  const parsed = await parseResultXlsx(filePath);
  const expectedCaseNos = uniqueCaseNosForGate([
    ...expectedCaseNosForRun(runId),
    ...(options.expectedCaseNos ?? [])
  ]);
  const report = evaluateResultEvidenceGate({
    parsed,
    resultSource: options.resultSource,
    currentCaseNo: options.currentCaseNo,
    expectedCaseNos,
    requireSingleCase: true
  });
  const reportPath = writeResultEvidenceGateReport(filePath, report);
  insertRunEvent(runId, "result.evidence_gate_checked", {
    status: report.status,
    issueCount: report.issues.length,
    errorCodes: report.issues.filter((item) => item.severity === "error").map((item) => item.code),
    warningCodes: report.issues.filter((item) => item.severity === "warning").map((item) => item.code),
    reportPath
  });
  if (report.status === "error") {
    insertRunEvent(runId, "result.evidence_gate_failed", {
      issueCount: report.issues.length,
      errorCodes: report.issues.filter((item) => item.severity === "error").map((item) => item.code),
      reportPath
    });
    throw new ResultEvidenceGateError(report);
  }
  const now = nowIso();
  const terminalStatus = resultHasFailedOutcome(parsed.cases) ? "FAILED" : "SUCCEEDED";

  const upsertCaseStmt = db.prepare(
    `
      INSERT INTO run_cases (
        id, run_id, case_no, group_name, case_title, execution_type, result_status, fail_category,
        detail_json, created_at, updated_at
      ) VALUES (
        @id, @run_id, @case_no, @group_name, @case_title, @execution_type, @result_status, @fail_category,
        @detail_json, @created_at, @updated_at
      )
      ON CONFLICT(run_id, case_no) DO UPDATE SET
        group_name = excluded.group_name,
        case_title = excluded.case_title,
        execution_type = excluded.execution_type,
        result_status = excluded.result_status,
        fail_category = excluded.fail_category,
        detail_json = excluded.detail_json,
        updated_at = excluded.updated_at
    `
  );

  const insertBugStmt = db.prepare(
    `
      INSERT INTO bugs (
        id, run_id, round_id, severity, related_case_no, description, suggestion, created_at, updated_at
      ) VALUES (
        @id, @run_id, @round_id, @severity, @related_case_no, @description, @suggestion, @created_at, @updated_at
      )
    `
  );

  const run = getRun(runId);
  if (!run) throw new Error("RUN_NOT_FOUND");

  const tx = db.transaction(() => {
    for (const item of parsed.cases) {
      const resultStatus = normalizeParsedResultStatus(item.status);
      upsertCaseStmt.run({
        id: randomUUID(),
        run_id: runId,
        case_no: item.caseNo,
        group_name: item.groupName,
        case_title: item.caseTitle ?? item.caseNo,
        execution_type: item.executionMethod ?? "agent",
        result_status: resultStatus,
        fail_category: item.verdictReason,
        detail_json: buildDetailJsonForParsedCase(item),
        created_at: now,
        updated_at: now
      });
      db.prepare(
        `
          UPDATE run_case_steps
          SET status = ?, actual_json = ?, finished_at = ?, updated_at = ?
          WHERE run_id = ? AND case_no = ?
        `
      ).run(
        stepStatusForCaseResult(resultStatus),
        JSON.stringify({ source: "result_xlsx_ingest", caseStatus: resultStatus }),
        now,
        now,
        runId,
        item.caseNo
      );
    }

    db.prepare("DELETE FROM bugs WHERE run_id = ?").run(runId);
    for (const bug of parsed.bugs) {
      insertBugStmt.run({
        id: randomUUID(),
        run_id: runId,
        round_id: String(run.round_id ?? ""),
        severity: bug.severity || "INFO",
        related_case_no: bug.relatedCaseNo ?? "-",
        description: formatParsedBugDescription(bug),
        suggestion: bug.suggestion,
        created_at: now,
        updated_at: now
      });
    }

    db.prepare(
      `
        UPDATE runs
        SET result_xlsx_path = ?, result_ingested_at = ?, result_xlsx_parser_version = ?, updated_at = ?
        WHERE id = ?
      `
    ).run(filePath, now, parsed.parserVersion, now, runId);
  });
  tx();

  setRunStatusWithMeta(runId, terminalStatus, "Mac Agent");

  return {
    cases: parsed.cases.length,
    bugs: parsed.bugs.length,
    parserVersion: parsed.parserVersion,
    runStatus: terminalStatus,
    resultEvidenceGate: {
      status: report.status,
      issueCount: report.issues.length,
      reportPath
    }
  };
};

router.get("/", (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const roundId = typeof req.query.roundId === "string" ? req.query.roundId : undefined;
  const featureMain = typeof req.query.featureMain === "string" ? req.query.featureMain : undefined;
  const limit = Math.min(Number(req.query.limit ?? 50), 200);

  const where: string[] = [];
  const params: Array<string | number> = [];

  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (roundId) {
    where.push("round_id = ?");
    params.push(roundId);
  }
  if (featureMain) {
    where.push("feature_main = ?");
    params.push(featureMain);
  }

  params.push(limit);
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `SELECT * FROM runs ${whereSql} ORDER BY created_at DESC LIMIT ?`;
  const items = db.prepare(sql).all(...params);

  return res.json({ items });
});

router.get("/history", (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const roundId = typeof req.query.roundId === "string" ? req.query.roundId : undefined;
  const page = Math.max(Number(req.query.page ?? 1), 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize ?? 20), 1), 100);
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const params: Array<string | number> = [];

  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (roundId) {
    where.push("round_id = ?");
    params.push(roundId);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const totalRow = db.prepare(`SELECT COUNT(1) AS count FROM runs ${whereSql}`).get(...params) as { count: number };
  const rows = db
    .prepare(
      `
        SELECT * FROM runs
        ${whereSql}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `
    )
    .all(...params, pageSize, offset) as Array<Record<string, unknown>>;

  const items = rows.map((run) => {
    const statsRows = db
      .prepare("SELECT result_status, COUNT(1) AS count FROM run_cases WHERE run_id = ? GROUP BY result_status")
      .all(run.id) as Array<{ result_status: string; count: number }>;
    const stats: Record<string, number> = {};
    for (const s of statsRows) stats[s.result_status] = s.count;
    return { ...run, caseStats: stats };
  });

  return res.json({
    items,
    page,
    pageSize,
    total: totalRow.count
  });
});

router.post(
  "/",
  upload.fields([
    { name: "testcaseXlsx", maxCount: 1 },
    { name: "testcaseMd", maxCount: 10 },
    { name: "referenceCsv", maxCount: 1 }
  ]),
  async (req, res) => {
    const body = req.body as Record<string, string | undefined>;
    const parsed = createRunSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "INVALID_PAYLOAD",
        issues: parsed.error.issues
      });
    }

    const now = nowIso();
    const runId = randomUUID();
    const payload = parsed.data;

    db.prepare(
      `
      INSERT INTO runs (
        id, round_id, domain, location, feature_main, feature_sub, run_name, dev_url, execution_mode, status, created_at, updated_at
      ) VALUES (
        @id, @round_id, @domain, @location, @feature_main, @feature_sub, @run_name, @dev_url, @execution_mode, @status, @created_at, @updated_at
      )
      `
    ).run({
      id: runId,
      round_id: payload.roundId,
      domain: payload.domain ?? "BI",
      location: payload.location,
      feature_main: payload.featureMain,
      feature_sub: payload.featureSub,
      run_name: payload.runName,
      dev_url: payload.devUrl,
      execution_mode: payload.executionMode ?? (config.nodeEnv === "production" ? "offline" : "interactive"),
      status: "READY",
      created_at: now,
      updated_at: now
    });

    insertRunLog(runId, "INFO", "Run created", payload);
    insertRunEvent(runId, "run.created", {
      domain: payload.domain ?? "BI",
      roundId: payload.roundId,
      location: payload.location,
      featureMain: payload.featureMain,
      featureSub: payload.featureSub,
      executionMode: payload.executionMode ?? null
    });

    const files = req.files as
      | {
          testcaseXlsx?: Express.Multer.File[];
          testcaseMd?: Express.Multer.File[];
          referenceCsv?: Express.Multer.File[];
        }
      | undefined;
    const hasUploadFiles = Boolean(files?.testcaseXlsx?.[0] || (files?.testcaseMd?.length ?? 0) > 0);
    const sourceMode =
      body.sourceMode === "upload" || body.sourceMode === "conversation"
        ? body.sourceMode
        : hasUploadFiles
          ? "upload"
          : "conversation";

    if (sourceMode === "upload") {
      const testcaseXlsx = files?.testcaseXlsx?.[0];
      const testcaseDocs = files?.testcaseMd ?? [];
      const testcaseMd = testcaseDocs[0];
      const supportingDocs = testcaseDocs.slice(1).map((file) => ({
        path: file.path,
        originalName: normalizeUploadOriginalName(file.originalname),
        mimeType: file.mimetype,
        size: file.size
      }));
      const referenceCsv = files?.referenceCsv?.[0];

      if (!testcaseXlsx || !testcaseMd) {
        deleteRunCascade(runId);
        return res.status(400).json({
          error: "UPLOAD_FILES_REQUIRED",
          message: "請上傳 xlsx 和至少一份說明文件"
        });
      }

      try {
        const imported = await parseTestcaseXlsx(testcaseXlsx.path);
        const { manualCases } = upsertImportedTestcase(runId, imported);
        db.prepare(
          `
            UPDATE runs
            SET testcase_xlsx_path = ?, testcase_md_path = ?, testcase_supporting_docs_json = ?, reference_csv_path = ?, updated_at = ?
            WHERE id = ?
          `
        ).run(
          testcaseXlsx.path,
          testcaseMd.path,
          JSON.stringify(supportingDocs),
          referenceCsv?.path ?? null,
          nowIso(),
          runId
        );
        insertRunLog(runId, "INFO", "XLSX+MD uploaded and parsed", {
          sourceMode,
          testcaseXlsx: testcaseXlsx.path,
          testcaseMd: testcaseMd.path,
          supportingDocs,
          referenceCsv: referenceCsv?.path ?? null,
          importedCases: imported.cases.length,
          importedSteps: imported.steps.length,
          manualCases
        });
        insertRunEvent(runId, "input.xlsx_parsed", {
          sourceMode,
          importedCases: imported.cases.length,
          importedSteps: imported.steps.length,
          manualCases
        });
      } catch (error) {
        deleteRunCascade(runId);
        return res.status(400).json({
          error: "XLSX_IMPORT_FAILED",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    } else {
      insertRunLog(runId, "INFO", "Run created from conversation mode", {
        sourceMode,
        conversationId: body.conversationId ?? null
      });
      insertRunEvent(runId, "input.conversation_created", {
        sourceMode,
        conversationId: body.conversationId ?? null
      });
    }

    return res.status(201).json({
      id: runId,
      status: "READY"
    });
  }
);

router.post("/:id/cases", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const parsed = createCasesSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "INVALID_PAYLOAD",
      issues: parsed.error.issues
    });
  }

  const now = nowIso();
  let manualCases = 0;
  const upsertCaseStmt = prepareUpsertCaseStmt();

  const tx = db.transaction(() => {
    for (const item of parsed.data.items) {
      const resultStatus = item.executionType === "manual" ? "MANUAL_PENDING" : "PENDING";
      if (item.executionType === "manual") manualCases += 1;

      upsertCaseStmt.run({
        id: randomUUID(),
        run_id: req.params.id,
        case_no: item.caseNo,
        group_name: item.groupName ?? null,
        case_title: item.caseTitle,
        execution_type: item.executionType,
        result_status: resultStatus,
        detail_json: item.detailJson ? JSON.stringify(item.detailJson) : null,
        created_at: now,
        updated_at: now
      });
    }
  });

  tx();

  db.prepare("UPDATE runs SET updated_at = ? WHERE id = ?").run(now, req.params.id);
  insertRunLog(req.params.id, "INFO", "Cases upserted", {
    total: parsed.data.items.length,
    manualCases
  });

  return res.status(201).json({
    runId: req.params.id,
    total: parsed.data.items.length,
    manualCases
  });
});

router.post("/:id/steps", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const parsed = createStepsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "INVALID_PAYLOAD",
      issues: parsed.error.issues
    });
  }

  const now = nowIso();
  const upsertStepStmt = prepareUpsertStepStmt();
  const tx = db.transaction(() => {
    for (const step of parsed.data.items) {
      upsertStepStmt.run({
        id: randomUUID(),
        run_id: req.params.id,
        case_no: step.caseNo,
        step_no: step.stepNo,
        action_type: step.actionType,
        target_type: step.targetType ?? null,
        target_value: step.targetValue ?? null,
        input_value: step.inputValue ?? null,
        expected: step.expected ?? null,
        require_approval: step.requireApproval ? 1 : 0,
        timeout_ms: step.timeoutMs ?? 10000,
        retry: step.retry ?? 0,
        status: "PENDING",
        created_at: now,
        updated_at: now
      });
    }
  });
  tx();

  insertRunLog(req.params.id, "INFO", "Steps upserted", { total: parsed.data.items.length });
  return res.status(201).json({
    runId: req.params.id,
    total: parsed.data.items.length
  });
});

router.post("/:id/import-xlsx", async (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const parsed = importXlsxSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "INVALID_PAYLOAD",
      issues: parsed.error.issues
    });
  }

  try {
    const imported = await parseTestcaseXlsx(parsed.data.filePath);
    const { manualCases } = upsertImportedTestcase(req.params.id, imported);

    insertRunLog(req.params.id, "INFO", "XLSX imported", {
      filePath: parsed.data.filePath,
      cases: imported.cases.length,
      steps: imported.steps.length,
      manualCases
    });

    return res.status(201).json({
      runId: req.params.id,
      importedCases: imported.cases.length,
      importedSteps: imported.steps.length,
      manualCases
    });
  } catch (error) {
    insertRunLog(req.params.id, "ERROR", "XLSX import failed", {
      filePath: parsed.data.filePath,
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(400).json({
      error: "XLSX_IMPORT_FAILED",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

router.post("/:id/status", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const parsed = updateStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "INVALID_PAYLOAD",
      issues: parsed.error.issues
    });
  }

  const currentStatus = String(run.status);
  const { targetStatus, reason } = parsed.data;
  const allowed = ALLOWED_STATUS_TRANSITIONS[currentStatus] ?? [];

  if (!allowed.includes(targetStatus)) {
    return res.status(409).json({
      error: "INVALID_STATUS_TRANSITION",
      from: currentStatus,
      to: targetStatus
    });
  }

  setRunStatusWithMeta(req.params.id, targetStatus);
  insertRunLog(req.params.id, "INFO", "Run status changed", {
    from: currentStatus,
    to: targetStatus,
    reason: reason ?? null
  });

  return res.json({
    id: req.params.id,
    from: currentStatus,
    to: targetStatus
  });
});

router.post("/:id/start", async (req, res) => {
  const health = await checkPlaywrightHealth(config.playwrightHealthcheckTimeoutMs);
  if (health.status === "unavailable") {
    return res.status(503).json({
      error: "PLAYWRIGHT_UNAVAILABLE",
      message:
        "Playwright 未連線，請確認 runner 已啟動。若是首次執行請先執行 `npx playwright install` 安裝瀏覽器。",
      detail: health.message
    });
  }

  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  if (String(run.status) !== "READY") {
    return res.status(409).json({
      error: "RUN_NOT_READY",
      status: String(run.status)
    });
  }

  insertRunLog(req.params.id, "INFO", "Run start requested");
  const accepted = startRun(req.params.id);
  if (!accepted.accepted) {
    return res.status(409).json({
      error: accepted.reason ?? "RUN_START_REJECTED"
    });
  }
  return res.status(202).json({
    id: req.params.id,
    status: "RUNNING"
  });
});

router.post("/:id/dispatch-agent", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const parsed = dispatchAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "INVALID_PAYLOAD",
      issues: parsed.error.issues
    });
  }

  const currentStatus = String(run.status);
  if (TERMINAL_STATUSES.has(currentStatus)) {
    return res.status(409).json({
      error: "RUN_ALREADY_TERMINAL",
      status: currentStatus
    });
  }

  const agent = agentRegistry.get(parsed.data.agentId);
  if (!agent) {
    return res.status(404).json({ error: "AGENT_NOT_FOUND" });
  }
  if (agent.status !== "idle") {
    return res.status(409).json({
      error: agent.status === "busy" ? "AGENT_BUSY" : "AGENT_NOT_READY",
      currentRunId: agent.currentRunId,
      status: agent.status
    });
  }
  if (agent.doctorOk === false) {
    return res.status(409).json({
      error: "AGENT_DOCTOR_FAILED",
      failedChecks: agent.doctorChecks.filter((check) => check.verdict === "FAIL").map((check) => check.name)
    });
  }
  if (agent.supportedTaskTypes.length > 0 && !agent.supportedTaskTypes.includes("uat_run")) {
    return res.status(409).json({
      error: "AGENT_UNSUPPORTED_TASK_TYPE",
      supportedTaskTypes: agent.supportedTaskTypes
    });
  }
  if (agent.supportedExecutionModes.length > 0 && !agent.supportedExecutionModes.includes("interactive")) {
    return res.status(409).json({
      error: "AGENT_UNSUPPORTED_EXECUTION_MODE",
      supportedExecutionModes: agent.supportedExecutionModes
    });
  }

  try {
    const domain = String(run.domain ?? "BI");
    const inputUrls = {
      ...getDomainInputUrls(req, domain),
      ...getRunInputUrls(req, req.params.id, run as RunInputPaths)
    };
    const outputUrls = getRunOutputUrls(req, req.params.id);
    const message = agentRegistry.dispatchTask(parsed.data.agentId, {
      run_id: req.params.id,
      domain,
      round_id: String(run.round_id ?? ""),
      execution_mode: String(run.execution_mode ?? "interactive"),
      dev_url: String(run.dev_url ?? ""),
      feature_main: String(run.feature_main ?? ""),
      feature_sub: String(run.feature_sub ?? ""),
      input_urls: inputUrls,
      output_urls: outputUrls,
      startup_instruction:
        inputUrls.xlsx && inputUrls.startup_instruction
          ? [
            "Execute the assigned Galaxy BI UAT run using the uploaded testcase workbook and markdown instruction as the source of truth.",
            "Use real UI/browser automation for BI validation; do not bypass BI UI with direct BI API calls.",
            "Write the completed result workbook to output/result.xlsx in the agent workdir. Include sheets named 索引, 測試案例, and Bug when applicable.",
            "If SSO login, irreversible operation approval, or an ambiguous testing decision blocks progress, emit a Tool Bridge [TOOL_REQUEST]...[/TOOL_REQUEST] block and stop at the safe pause point."
          ].join(" ")
          : "You are assigned a Galaxy BI UAT run, but no uploaded testcase package is available. Report missing inputs and exit cleanly."
    });

    setRunStatusWithMeta(req.params.id, "RUNNING");
    insertRunEvent(req.params.id, "task.dispatched", {
      agentId: parsed.data.agentId,
      deviceName: agent.deviceName,
      messageId: message.id,
      inputUrls: Object.keys(inputUrls),
      outputUrls: Object.keys(outputUrls)
    }, message.seq);
    insertRunLog(req.params.id, "INFO", "Run dispatched to Mac Agent", {
      agentId: parsed.data.agentId,
      deviceName: agent.deviceName,
      messageId: message.id,
      inputUrls: Object.keys(inputUrls),
      outputUrls: Object.keys(outputUrls)
    });

    return res.status(202).json({
      id: req.params.id,
      status: "RUNNING",
      agentId: parsed.data.agentId,
      messageId: message.id
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    insertRunLog(req.params.id, "ERROR", "Run dispatch to Mac Agent failed", {
      agentId: parsed.data.agentId,
      error: message
    });
    const status = message === "AGENT_BUSY" ? 409 : 503;
    return res.status(status).json({ error: message });
  }
});

router.post("/:id/cancel", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  requestRunCancel(req.params.id);
  setRunStatusWithMeta(req.params.id, "CANCELLED");
  insertRunEvent(req.params.id, "run.interrupted", { reason: "pm_cancelled" });
  insertRunLog(req.params.id, "WARN", "Run cancel requested");
  const agent = agentRegistry.findByCurrentRunId(req.params.id);
  if (agent) {
    try {
      const message = agentRegistry.send(
        agent.id,
        "task.cancel",
        {
          run_id: req.params.id,
          reason: "cancelled_by_pm"
        },
        true
      );
      insertRunLog(req.params.id, "WARN", "Cancel dispatched to Mac Agent", {
        agentId: agent.id,
        deviceName: agent.deviceName,
        messageId: message.id
      });
      insertRunEvent(req.params.id, "task.cancelled", {
        agentId: agent.id,
        deviceName: agent.deviceName,
        messageId: message.id
      }, message.seq);
    } catch (error) {
      insertRunLog(req.params.id, "ERROR", "Cancel dispatch to Mac Agent failed", {
        agentId: agent.id,
        error: error instanceof Error ? error.message : String(error)
      });
      insertRunEvent(req.params.id, "task.cancel_failed", {
        agentId: agent.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return res.json({
    id: req.params.id,
    status: "CANCELLED"
  });
});

router.post("/:id/manual-fill", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const parsed = manualFillSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "INVALID_PAYLOAD",
      issues: parsed.error.issues
    });
  }

  const target = db
    .prepare("SELECT * FROM run_cases WHERE run_id = ? AND case_no = ?")
    .get(req.params.id, parsed.data.caseNo) as Record<string, unknown> | undefined;

  if (!target) {
    return res.status(404).json({ error: "CASE_NOT_FOUND" });
  }

  if (String(target.execution_type) !== "manual") {
    return res.status(409).json({ error: "CASE_IS_NOT_MANUAL" });
  }

  const now = nowIso();
  db.prepare(
    `
      UPDATE run_cases
      SET result_status = ?, detail_json = ?, manual_filled_by = ?, manual_filled_at = ?, updated_at = ?
      WHERE run_id = ? AND case_no = ?
    `
  ).run(
    parsed.data.resultStatus,
    parsed.data.detailJson ? JSON.stringify(parsed.data.detailJson) : target.detail_json ?? null,
    parsed.data.manualFilledBy,
    now,
    now,
    req.params.id,
    parsed.data.caseNo
  );

  insertRunLog(req.params.id, "INFO", "Manual case filled", {
    caseNo: parsed.data.caseNo,
    resultStatus: parsed.data.resultStatus,
    by: parsed.data.manualFilledBy
  });

  return res.json({
    runId: req.params.id,
    caseNo: parsed.data.caseNo,
    resultStatus: parsed.data.resultStatus
  });
});

router.post("/:id/approve", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const parsed = approveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "INVALID_PAYLOAD",
      issues: parsed.error.issues
    });
  }

  const approval = db
    .prepare("SELECT * FROM approvals WHERE run_id = ? AND case_no = ? AND step_no = ? AND status = 'PENDING'")
    .get(req.params.id, parsed.data.caseNo, parsed.data.stepNo) as Record<string, unknown> | undefined;

  if (!approval) {
    return res.status(404).json({ error: "PENDING_APPROVAL_NOT_FOUND" });
  }

  const now = nowIso();
  const nextStatus = parsed.data.action === "continue" ? "APPROVED" : "SKIPPED";
  db.prepare(
    `
      UPDATE approvals
      SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ?
      WHERE id = ?
    `
  ).run(nextStatus, now, parsed.data.resolvedBy, parsed.data.note ?? null, approval.id);

  if (parsed.data.action === "continue") {
    db.prepare(
      `
        UPDATE run_case_steps
        SET status = 'PENDING', require_approval = 0, error_message = NULL, updated_at = ?
        WHERE run_id = ? AND case_no = ? AND step_no = ?
      `
    ).run(now, req.params.id, parsed.data.caseNo, parsed.data.stepNo);
    db.prepare(
      `
        UPDATE run_cases
        SET result_status = 'PENDING', fail_category = NULL, updated_at = ?
        WHERE run_id = ? AND case_no = ?
      `
    ).run(now, req.params.id, parsed.data.caseNo);
  } else {
    db.prepare(
      `
        UPDATE run_case_steps
        SET status = 'SKIPPED', actual_json = ?, updated_at = ?
        WHERE run_id = ? AND case_no = ? AND step_no = ?
      `
    ).run(JSON.stringify({ reason: "approved_skip" }), now, req.params.id, parsed.data.caseNo, parsed.data.stepNo);
    db.prepare(
      `
        UPDATE run_cases
        SET result_status = 'SKIPPED', fail_category = 'ENV_BLOCKED', updated_at = ?
        WHERE run_id = ? AND case_no = ?
      `
    ).run(now, req.params.id, parsed.data.caseNo);
  }

  const toolResponse = dispatchToolResponseIfNeeded(req.params.id, approval, parsed.data);
  const runStatus = toolResponse.sent ? "RUNNING" : "READY";
  db.prepare("UPDATE runs SET status = ?, updated_at = ? WHERE id = ?").run(runStatus, now, req.params.id);
  insertRunLog(req.params.id, "INFO", "Approval resolved", {
    caseNo: parsed.data.caseNo,
    stepNo: parsed.data.stepNo,
    action: parsed.data.action,
    by: parsed.data.resolvedBy,
    toolResponse
  });

  return res.json({
    runId: req.params.id,
    caseNo: parsed.data.caseNo,
    stepNo: parsed.data.stepNo,
    action: parsed.data.action,
    runStatus,
    toolResponse
  });
});

router.get("/:id", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  return res.json(run);
});

router.get("/:id/input/xlsx", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }
  return safeSendRunInputFile(res, run.testcase_xlsx_path, `${String(run.round_id ?? req.params.id)}_testcase.xlsx`);
});

router.get("/:id/input/md", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }
  return safeSendRunInputFile(res, run.testcase_md_path, `${String(run.round_id ?? req.params.id)}_instructions.md`);
});

router.get("/:id/input/startup", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }
  return safeSendRunInputFile(res, run.testcase_md_path, `${String(run.round_id ?? req.params.id)}_startup.md`);
});

router.get("/:id/input/supporting/:index/:filename", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const index = Number.parseInt(req.params.index, 10);
  if (!Number.isInteger(index) || index < 0) {
    return res.status(400).json({ error: "INVALID_SUPPORTING_DOC_INDEX" });
  }

  const doc = parseSupportingDocs(run.testcase_supporting_docs_json)[index];
  if (!doc) {
    return res.status(404).json({ error: "SUPPORTING_DOC_NOT_FOUND" });
  }

  return safeSendRunInputFile(res, doc.path, doc.originalName);
});

router.get("/:id/input/baseline", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }
  return safeSendRunInputFile(res, run.reference_csv_path, `${String(run.round_id ?? req.params.id)}_baseline.csv`);
});

router.post("/:id/output/result-xlsx", resultUpload.single("resultXlsx"), async (req, res) => {
  const runId = String(req.params.id);
  const run = getRun(runId);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  if (!req.file) {
    return res.status(400).json({
      error: "RESULT_XLSX_REQUIRED",
      message: "請使用 multipart 欄位 resultXlsx 上傳結果 xlsx"
    });
  }

  insertRunLog(runId, "INFO", "Agent result xlsx uploaded", {
    filePath: req.file.path,
    originalName: req.file.originalname,
    parserVersion: RESULT_XLSX_PARSER_VERSION
  });
  insertRunEvent(runId, "result.uploaded", {
    filePath: req.file.path,
    originalName: req.file.originalname,
    parserVersion: RESULT_XLSX_PARSER_VERSION
  });

  try {
    const ingestOptions = {
      resultSource: stringBodyField(req, "resultSource"),
      currentCaseNo: stringBodyField(req, "currentCaseNo"),
      expectedCaseNos: stringArrayBodyField(req, "expectedCaseNos")
    };
    insertRunEvent(runId, "result.ingest_started", { filePath: req.file.path, ...ingestOptions });
    const result = await ingestResultXlsx(runId, req.file.path, ingestOptions);
    insertRunEvent(runId, "result.ingested", result);
    insertRunLog(runId, "INFO", "Agent result xlsx ingested", result);
    return res.status(201).json({
      runId,
      resultXlsxPath: req.file.path,
      ...result
    });
  } catch (error) {
    setRunStatusWithMeta(runId, "FAILED");
    insertRunEvent(runId, "result.ingest_failed", {
      filePath: req.file.path,
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof ResultEvidenceGateError ? { resultEvidenceGate: error.report } : {})
    });
    insertRunLog(runId, "ERROR", "Agent result xlsx ingest failed", {
      filePath: req.file.path,
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof ResultEvidenceGateError ? { resultEvidenceGate: error.report } : {})
    });
    return res.status(error instanceof ResultEvidenceGateError ? 422 : 400).json({
      error: error instanceof ResultEvidenceGateError ? "RESULT_EVIDENCE_GATE_FAILED" : "RESULT_XLSX_INGEST_FAILED",
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof ResultEvidenceGateError ? { report: error.report } : {})
    });
  }
});

router.post("/:id/ingest-result", async (req, res) => {
  const runId = String(req.params.id);
  const run = getRun(runId) as (Record<string, unknown> & RunOutputPaths) | undefined;
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  if (!run.result_xlsx_path) {
    return res.status(404).json({ error: "RESULT_XLSX_NOT_FOUND" });
  }

  try {
    insertRunEvent(runId, "result.ingest_started", { filePath: run.result_xlsx_path, source: "manual" });
    const result = await ingestResultXlsx(runId, run.result_xlsx_path);
    insertRunEvent(runId, "result.ingested", { ...result, source: "manual" });
    insertRunLog(runId, "INFO", "Result xlsx manually re-ingested", result);
    return res.json({
      runId,
      resultXlsxPath: run.result_xlsx_path,
      ...result
    });
  } catch (error) {
    insertRunEvent(runId, "result.ingest_failed", {
      filePath: run.result_xlsx_path,
      source: "manual",
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof ResultEvidenceGateError ? { resultEvidenceGate: error.report } : {})
    });
    insertRunLog(runId, "ERROR", "Result xlsx manual ingest failed", {
      filePath: run.result_xlsx_path,
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof ResultEvidenceGateError ? { resultEvidenceGate: error.report } : {})
    });
    return res.status(error instanceof ResultEvidenceGateError ? 422 : 400).json({
      error: error instanceof ResultEvidenceGateError ? "RESULT_EVIDENCE_GATE_FAILED" : "RESULT_XLSX_INGEST_FAILED",
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof ResultEvidenceGateError ? { report: error.report } : {})
    });
  }
});

router.get("/:id/output/result-xlsx", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }
  return safeSendRunOutputFile(
    res,
    run.result_xlsx_path,
    `${String(run.round_id ?? req.params.id)}_result.xlsx`
  );
});

router.post("/:id/output/log", resultUpload.single("log"), (req, res) => {
  const runId = String(req.params.id);
  const run = getRun(runId);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  if (!req.file) {
    return res.status(400).json({
      error: "LOG_FILE_REQUIRED",
      message: "請使用 multipart 欄位 log 上傳執行 log"
    });
  }

  const now = nowIso();
  db.prepare("UPDATE runs SET log_path = ?, log_uploaded_at = ?, updated_at = ? WHERE id = ?").run(
    req.file.path,
    now,
    now,
    runId
  );
  insertRunLog(runId, "INFO", "Agent execution log uploaded", {
    filePath: req.file.path,
    originalName: req.file.originalname,
    size: req.file.size
  });

  return res.status(201).json({
    runId,
    logPath: req.file.path,
    uploadedAt: now
  });
});

router.get("/:id/output/log", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }
  return safeSendRunOutputFile(res, run.log_path, `${String(run.round_id ?? req.params.id)}_agent.log`);
});

router.get("/:id/cases", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const items = db.prepare("SELECT * FROM run_cases WHERE run_id = ? ORDER BY created_at ASC").all(req.params.id);
  return res.json({ items });
});

router.get("/:id/steps", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const caseNo = typeof req.query.caseNo === "string" ? req.query.caseNo : undefined;
  if (caseNo) {
    const items = db
      .prepare("SELECT * FROM run_case_steps WHERE run_id = ? AND case_no = ? ORDER BY case_no ASC, step_no ASC")
      .all(req.params.id, caseNo);
    return res.json({ items });
  }

  const items = db
    .prepare("SELECT * FROM run_case_steps WHERE run_id = ? ORDER BY case_no ASC, step_no ASC")
    .all(req.params.id);
  return res.json({ items });
});

router.get("/:id/approvals", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (status) {
    const items = db
      .prepare("SELECT * FROM approvals WHERE run_id = ? AND status = ? ORDER BY created_at ASC")
      .all(req.params.id, status);
    return res.json({ items });
  }

  const items = db.prepare("SELECT * FROM approvals WHERE run_id = ? ORDER BY created_at ASC").all(req.params.id);
  return res.json({ items });
});

router.get("/:id/summary", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const caseStatsRows = db
    .prepare("SELECT result_status, COUNT(1) AS count FROM run_cases WHERE run_id = ? GROUP BY result_status")
    .all(req.params.id) as Array<{ result_status: string; count: number }>;
  const stepStatsRows = db
    .prepare("SELECT status, COUNT(1) AS count FROM run_case_steps WHERE run_id = ? GROUP BY status")
    .all(req.params.id) as Array<{ status: string; count: number }>;
  const pendingApprovals = db
    .prepare("SELECT COUNT(1) AS count FROM approvals WHERE run_id = ? AND status = 'PENDING'")
    .get(req.params.id) as { count: number };

  const caseStats: Record<string, number> = {};
  for (const row of caseStatsRows) caseStats[row.result_status] = row.count;
  const stepStats: Record<string, number> = {};
  for (const row of stepStatsRows) stepStats[row.status] = row.count;

  return res.json({
    runId: req.params.id,
    runStatus: run.status,
    date: run.date ?? null,
    tester: run.tester ?? null,
    location: run.location ?? null,
    featureMain: run.feature_main ?? null,
    featureSub: run.feature_sub ?? null,
    resultXlsxAvailable: typeof run.result_xlsx_path === "string" && run.result_xlsx_path.trim().length > 0,
    resultIngestedAt: run.result_ingested_at ?? null,
    resultParserVersion: run.result_xlsx_parser_version ?? null,
    logAvailable: typeof run.log_path === "string" && run.log_path.trim().length > 0,
    logUploadedAt: run.log_uploaded_at ?? null,
    caseStats,
    stepStats,
    pendingApprovals: pendingApprovals.count
  });
});

router.get("/:id/logs", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const limit = parseActivityLimit(req.query.limit);
  const afterId = typeof req.query.after_id === "string" ? req.query.after_id : undefined;
  const page = listRunLogsPage(req.params.id, limit, afterId);
  return res.json({ ...page, limit });
});

router.get("/:id/events", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const limit = parseActivityLimit(req.query.limit);
  const afterId = typeof req.query.after_id === "string" ? req.query.after_id : undefined;
  const events = listRunEvents(req.params.id, limit + 1, afterId);
  const visibleEvents = events.slice(0, limit);
  const items = visibleEvents.map((event) => {
    let payload: unknown = null;
    try {
      payload = event.payload_json ? JSON.parse(event.payload_json) : null;
    } catch {
      payload = event.payload_json;
    }
    return { ...event, payload };
  });
  return res.json({
    items,
    hasMore: events.length > limit,
    total: countRunRows("run_events", req.params.id),
    nextAfterId: visibleEvents.at(-1)?.id ?? null,
    limit
  });
});

router.post("/:id/export-md", (req, res) => {
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(req.params.id) as MdRun | undefined;
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const cases = db
    .prepare(
      `
        SELECT *
        FROM run_cases
        WHERE run_id = ?
        ORDER BY COALESCE(group_name, ''), case_no
      `
    )
    .all(req.params.id) as MdCase[];

  const bugs = db
    .prepare(
      `
        SELECT severity, related_case_no, description, suggestion
        FROM bugs
        WHERE run_id = ?
        ORDER BY
          CASE severity
            WHEN 'HIGH' THEN 3
            WHEN 'MEDIUM' THEN 2
            WHEN 'LOW' THEN 1
            ELSE 0
          END DESC,
          created_at DESC
      `
    )
    .all(req.params.id) as MdBug[];

  const counts: Record<string, number> = {};
  for (const c of cases) {
    const status = c.result_status || "PENDING";
    counts[status] = (counts[status] ?? 0) + 1;
  }
  const total = cases.length;
  const content = generateMd(run, cases, bugs, counts, total);

  const safe = (v: string | null | undefined): string =>
    (v ?? "NA").trim().replace(/[\/\s]+/g, "_").replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "");
  const filename = `UAT_${safe(run.round_id)}_${safe(run.feature_sub)}_${safe(run.run_name)}_${new Date().toISOString().slice(0, 10)}.md`;

  insertRunLog(req.params.id, "INFO", "Markdown report exported", { filename, totalCases: total, totalBugs: bugs.length });
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
  return res.send(content);
});

router.get("/:id/bugs", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const items = db
    .prepare(
      `
        SELECT
          id,
          run_id,
          round_id,
          severity,
          related_case_no,
          description,
          suggestion,
          created_at
        FROM bugs
        WHERE run_id = ?
        ORDER BY created_at DESC
      `
    )
    .all(req.params.id);

  return res.json({ items });
});

router.get("/:id/detail-health", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const items = db
    .prepare(
      `
        SELECT case_no, case_title, detail_json
        FROM run_cases
        WHERE run_id = ?
        ORDER BY case_no ASC
      `
    )
    .all(req.params.id) as Array<{ case_no: string; case_title: string; detail_json: string | null }>;

  const coreKeys = ["測試目的", "設定條件", "預期行為", "實際行為"];
  const cases = items.map((item) => {
    let parsed: Record<string, unknown> = {};
    if (item.detail_json) {
      try {
        parsed = JSON.parse(item.detail_json) as Record<string, unknown>;
      } catch {
        parsed = {};
      }
    }

    const missingKeys = coreKeys.filter((k) => {
      const v = parsed[k];
      return typeof v !== "string" || !v.trim();
    });

    return {
      caseNo: item.case_no,
      caseTitle: item.case_title,
      healthy: missingKeys.length === 0,
      missingKeys
    };
  });

  const unhealthyCases = cases.filter((c) => !c.healthy).length;
  return res.json({
    runId: req.params.id,
    totalCases: cases.length,
    healthyCases: cases.length - unhealthyCases,
    unhealthyCases,
    cases
  });
});

export default router;
