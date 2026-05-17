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
import { insertRunEvent, listRunEvents, type RunEvent } from "./run-events";
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
  type ExternalToolBridgeEvidence,
  type ResultEvidenceGateReport
} from "./result-parser/result-evidence-gate";
import { containCaseLevelResultEvidenceGateIssues } from "./result-parser/result-evidence-containment";
import { buildMissingBugCandidates } from "./result-parser/fail-bug-fallback";
import { getDomainPack, readOptionalDomainPackFile, type OptionalDomainPackFile } from "./domain-loader";
import { writeFinalAggregateResultXlsx, type AggregateBug, type AggregateCase, type AggregateRun } from "./result-aggregate-writer";

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
const RUN_EXECUTION_MODE = ["offline", "interactive", "diagnostic"] as const;
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
        groupId: z.string().optional(),
        groupName: z.string().optional(),
        caseTitle: z.string().min(1),
        executionType: z.enum(CASE_EXECUTION_TYPE),
        resultStatus: z.enum(CASE_RESULT_STATUS).optional(),
        failCategory: z.string().optional(),
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

const pmReviewSchema = z.object({
  caseNo: z.string().min(1),
  finalStatus: z.enum(["MANUAL_PASS", "MANUAL_FAIL", "MANUAL_BLOCKED"]),
  reviewedBy: z.string().min(1),
  note: z.string().optional()
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
  aggregate_result_xlsx_path?: string | null;
  aggregate_result_generated_at?: string | null;
  log_path?: string | null;
  timing_summary_path?: string | null;
  diagnostic_summary_path?: string | null;
  diagnostic_config_json?: string | null;
};

type RunArtifactRow = {
  id: string;
  run_id: string;
  case_no: string | null;
  action: string | null;
  artifact_type: string;
  manifest_id: string | null;
  storage_path: string;
  original_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  checksum: string | null;
  local_path: string | null;
  relative_path: string | null;
  source: string | null;
  retention_class: string | null;
  metadata_json: string | null;
  created_at: string;
  uploaded_at: string;
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
  domain?: string | null;
  location: string | null;
  feature_main: string | null;
  feature_sub: string | null;
  run_name: string | null;
  dev_url: string | null;
  execution_mode?: string | null;
  date?: string | null;
  tester?: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  finished_at?: string | null;
  result_ingested_at?: string | null;
  result_xlsx_parser_version?: string | null;
  aggregate_result_generated_at?: string | null;
  log_uploaded_at?: string | null;
  timing_summary_path?: string | null;
  timing_summary_uploaded_at?: string | null;
};

type MdCase = {
  case_no: string;
  case_title: string;
  group_id: string | null;
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

const safeFilenameSegment = (v: string | null | undefined): string =>
  (v ?? "NA").trim().replace(/[\/\s]+/g, "_").replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "");

const safeJsonText = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value !== "string") return JSON.stringify(value);
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return value;
  }
};

const readRunOutputJson = (filePath: unknown): unknown | null => {
  if (typeof filePath !== "string" || !filePath.trim()) return null;
  const resolved = path.resolve(filePath);
  const storageRoot = path.resolve(config.storageRoot);
  if (!resolved.startsWith(storageRoot + path.sep) && resolved !== storageRoot) return null;
  if (!fs.existsSync(resolved)) return null;
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8")) as unknown;
  } catch {
    return null;
  }
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

const detailObject = (value: string | null | undefined): Record<string, unknown> | null => {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const isPmSkippedCase = (c: Pick<MdCase, "result_status" | "fail_category" | "execution_type" | "detail_json">): boolean => {
  if ((c.result_status ?? "").toUpperCase() !== "BLOCKED") return false;
  const detail = detailObject(c.detail_json);
  const text = [
    c.fail_category,
    c.execution_type,
    detail?.skip_reason,
    detail?.skipped_reason,
    detail?.["跳過原因"],
    detail?.blocked_reason,
    detail?.["阻塞原因"],
    detail?.["實際行為"]
  ]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .join("\n");
  return /PM.*(?:skip|跳過)|本輪不執行|主動跳過|skip_reason|N\/A\s*\(?本輪不執行\)?/i.test(text);
};

const classifiedCaseStatus = (c: Pick<MdCase, "result_status" | "fail_category" | "execution_type" | "detail_json">): string =>
  isPmSkippedCase(c) ? "PM_SKIPPED" : c.result_status || "PENDING";

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
    "PM_SKIPPED",
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
    PM_SKIPPED: "⏭️",
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
    md += `| ${mdEscape(c.case_no)} | ${mdEscape(c.case_title)} | **${mdEscape(classifiedCaseStatus(c))}** | ${mdEscape(extractSummary(c))} |\n`;
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
    const groupId = c.group_id?.trim();
    const groupName = c.group_name?.trim() || "未分組";
    const groupHeading = groupId ? `${groupId}｜${groupName}` : groupName;
    if (groupHeading !== lastGroup) {
      lastGroup = groupHeading;
      md += `### ${mdEscape(groupHeading)}\n\n`;
    }

    md += `#### ${mdEscape(c.case_no)}｜${mdEscape(c.case_title)}\n\n`;
    md += "| 項目 | 內容 |\n";
    md += "|------|------|\n";
    md += `| **測試日** | ${mdEscape(c.updated_at ?? c.created_at ?? "—")} |\n`;
    md += `| **執行方式** | ${mdEscape(c.execution_type ?? "—")} |\n`;
    md += `| **結果** | **${mdEscape(classifiedCaseStatus(c))}** |\n`;
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

const generateArchiveMd = (
  run: MdRun,
  cases: MdCase[],
  logs: RunLogRow[],
  events: RunEvent[],
  artifacts: RunArtifactRow[],
  timingSummary: unknown | null
): string => {
  const generatedAt = new Date().toISOString();
  const counts = cases.reduce<Record<string, number>>((acc, item) => {
    const status = classifiedCaseStatus(item);
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});
  const artifactStats = artifacts.reduce<Record<string, { count: number; bytes: number }>>((acc, item) => {
    const key = item.artifact_type || "artifact";
    const current = acc[key] ?? { count: 0, bytes: 0 };
    current.count += 1;
    current.bytes += item.size_bytes ?? 0;
    acc[key] = current;
    return acc;
  }, {});
  const timeline = [
    ...events.map((event) => ({
      createdAt: event.created_at,
      kind: "event",
      marker: event.event_type,
      detail: safeJsonText(event.payload_json),
      seq: event.seq
    })),
    ...logs.map((log) => ({
      createdAt: log.created_at,
      kind: "log",
      marker: log.level,
      detail: `${log.message}${log.context_json ? ` ${safeJsonText(log.context_json)}` : ""}`,
      seq: null
    }))
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let md = "";
  md += "# Galaxy UAT 完整執行紀錄\n\n";
  md += "| 項目 | 內容 |\n";
  md += "|------|------|\n";
  md += `| Run ID | ${mdEscape(run.id)} |\n`;
  md += `| 輪次ID | ${mdEscape(run.round_id)} |\n`;
  md += `| Domain | ${mdEscape(run.domain ?? "BI")} |\n`;
  md += `| 功能 | ${mdEscape(run.feature_main ?? "—")} / ${mdEscape(run.feature_sub ?? "—")} |\n`;
  md += `| 輪次名稱 | ${mdEscape(run.run_name ?? "—")} |\n`;
  md += `| Execution mode | ${mdEscape(run.execution_mode ?? "—")} |\n`;
  md += `| Dev URL | ${mdEscape(run.dev_url ?? "—")} |\n`;
  md += `| Run status | ${mdEscape(run.status)} |\n`;
  md += `| Created / Updated / Finished | ${mdEscape(run.created_at ?? "—")} / ${mdEscape(run.updated_at ?? "—")} / ${mdEscape(run.finished_at ?? "—")} |\n`;
  md += `| Result ingest / parser | ${mdEscape(run.result_ingested_at ?? "—")} / ${mdEscape(run.result_xlsx_parser_version ?? "—")} |\n`;
  md += `| Aggregate generated | ${mdEscape(run.aggregate_result_generated_at ?? "—")} |\n`;
  md += `| Generated at | ${mdEscape(generatedAt)} |\n\n`;

  md += "## Case State\n\n";
  md += "| Case | Group | Title | Status | Fail category | Updated | Detail summary |\n";
  md += "|------|-------|-------|--------|---------------|---------|----------------|\n";
  for (const c of cases) {
    const group = c.group_id ? `${c.group_id}｜${c.group_name ?? ""}` : c.group_name ?? "—";
    md += `| ${mdEscape(c.case_no)} | ${mdEscape(group)} | ${mdEscape(c.case_title)} | ${mdEscape(c.result_status ?? "—")} | ${mdEscape(c.fail_category ?? "—")} | ${mdEscape(c.updated_at ?? "—")} | ${mdEscape(extractSummary(c))} |\n`;
  }
  md += "\n";

  md += "## Result Counts\n\n";
  md += "| Status | Count |\n";
  md += "|--------|-------|\n";
  for (const [status, count] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
    md += `| ${mdEscape(status)} | ${count} |\n`;
  }
  md += "\n";

  md += "## Timing Summary\n\n";
  if (timingSummary && typeof timingSummary === "object") {
    const timing = timingSummary as { totalCompletedMs?: unknown; entryCount?: unknown; activeCount?: unknown; byName?: unknown };
    md += `- totalCompletedMs: ${mdEscape(timing.totalCompletedMs ?? "—")}\n`;
    md += `- entryCount: ${mdEscape(timing.entryCount ?? "—")}\n`;
    md += `- activeCount: ${mdEscape(timing.activeCount ?? "—")}\n\n`;
    if (timing.byName && typeof timing.byName === "object" && !Array.isArray(timing.byName)) {
      md += "| Name | Count | Total ms | Max ms | P95 ms |\n";
      md += "|------|-------|----------|--------|--------|\n";
      for (const [name, raw] of Object.entries(timing.byName as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
        const bucket = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
        md += `| ${mdEscape(name)} | ${mdEscape(bucket.count ?? "—")} | ${mdEscape(bucket.totalMs ?? "—")} | ${mdEscape(bucket.maxMs ?? "—")} | ${mdEscape(bucket.p95Ms ?? "—")} |\n`;
      }
      md += "\n";
    }
  } else {
    md += "Timing summary artifact not available.\n\n";
  }

  md += "## Artifact Stats\n\n";
  md += "| Type | Count | Bytes |\n";
  md += "|------|-------|-------|\n";
  for (const [type, stat] of Object.entries(artifactStats).sort(([a], [b]) => a.localeCompare(b))) {
    md += `| ${mdEscape(type)} | ${stat.count} | ${stat.bytes} |\n`;
  }
  if (artifacts.length === 0) md += "| — | 0 | 0 |\n";
  md += "\n";

  md += "## Artifacts\n\n";
  md += "| Uploaded | Case | Action | Type | Name | Relative path | Bytes |\n";
  md += "|----------|------|--------|------|------|---------------|-------|\n";
  for (const artifact of artifacts) {
    md += `| ${mdEscape(artifact.uploaded_at)} | ${mdEscape(artifact.case_no ?? "run")} | ${mdEscape(artifact.action ?? "—")} | ${mdEscape(artifact.artifact_type)} | ${mdEscape(artifact.original_name ?? "—")} | ${mdEscape(artifact.relative_path ?? artifact.local_path ?? "—")} | ${mdEscape(artifact.size_bytes ?? "—")} |\n`;
  }
  if (artifacts.length === 0) md += "| — | — | — | — | — | — | — |\n";
  md += "\n";

  md += "## Timeline\n\n";
  md += "| Time | Kind | Marker | Seq | Detail |\n";
  md += "|------|------|--------|-----|--------|\n";
  for (const item of timeline) {
    md += `| ${mdEscape(item.createdAt)} | ${mdEscape(item.kind)} | ${mdEscape(item.marker)} | ${mdEscape(item.seq ?? "—")} | ${mdEscape(item.detail)} |\n`;
  }
  if (timeline.length === 0) md += "| — | — | — | — | — |\n";
  md += "\n";

  md += "## Logs\n\n";
  md += "| Time | Level | Message | Context |\n";
  md += "|------|-------|---------|---------|\n";
  for (const log of logs) {
    md += `| ${mdEscape(log.created_at)} | ${mdEscape(log.level)} | ${mdEscape(log.message)} | ${mdEscape(safeJsonText(log.context_json))} |\n`;
  }
  if (logs.length === 0) md += "| — | — | — | — |\n";
  md += "\n";

  md += "## Events\n\n";
  md += "| Time | Seq | Event | Payload |\n";
  md += "|------|-----|-------|---------|\n";
  for (const event of events) {
    md += `| ${mdEscape(event.created_at)} | ${mdEscape(event.seq ?? "—")} | ${mdEscape(event.event_type)} | ${mdEscape(safeJsonText(event.payload_json))} |\n`;
  }
  if (events.length === 0) md += "| — | — | — | — |\n";
  md += "\n";

  return md;
};

const getRun = (runId: string): Record<string, unknown> | undefined =>
  db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;

const deleteRunCascade = (runId: string): void => {
  const remove = db.transaction((id: string) => {
    for (const table of ["run_case_steps", "approvals", "bugs", "run_cases", "run_logs", "run_events", "run_artifacts"]) {
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
  const domainName = domain || "BI";
  const encodedDomain = encodeURIComponent(domainName);
  const urls: Record<string, string> = {
    domain_rules: `${base}/api/domains/${encodedDomain}/rules`,
    domain_schema: `${base}/api/domains/${encodedDomain}/schema`,
    domain_result_adapter: `${base}/api/domains/${encodedDomain}/result-adapter`,
    domain_startup_template: `${base}/api/domains/${encodedDomain}/startup-template`
  };

  const optionalDomainInputs: Array<{ key: string; fileName: OptionalDomainPackFile; path: string }> = [
    { key: "domain_locator_registry", fileName: "locators/demo001-locator-registry.json", path: "locator-registry" },
    { key: "domain_ui_contract", fileName: "ui-contract.json", path: "ui-contract" },
    { key: "domain_action_set_metric_rows", fileName: "action-contracts/setMetricRows.json", path: "action-contracts/setMetricRows" },
    { key: "domain_evidence_schema", fileName: "evidence-schema.json", path: "evidence-schema" },
    { key: "domain_lint_rules", fileName: "lint-rules.json", path: "lint-rules" },
    { key: "domain_discovery_page_map", fileName: "discovery/page-map.json", path: "discovery/page-map" },
    { key: "domain_discovery_component_inventory", fileName: "discovery/component-inventory.json", path: "discovery/component-inventory" }
  ];

  for (const input of optionalDomainInputs) {
    if (readOptionalDomainPackFile(domainName, input.fileName) !== null) {
      urls[input.key] = `${base}/api/domains/${encodedDomain}/${input.path}`;
    }
  }
  return urls;
};

const getRunOutputUrls = (req: Request, runId: string): Record<string, string> => {
  const base = getRequestBaseUrl(req);
  return {
    result_xlsx: `${base}/api/runs/${runId}/output/result-xlsx`,
    log: `${base}/api/runs/${runId}/output/log`,
    timing_summary: `${base}/api/runs/${runId}/output/timing-summary`,
    diagnostic_summary: `${base}/api/runs/${runId}/output/diagnostic-summary`,
    artifact: `${base}/api/runs/${runId}/output/artifacts`
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

const numberBodyField = (body: Record<string, unknown>, key: string): number | null => {
  const value = body[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildDiagnosticConfig = (body: Record<string, unknown>): Record<string, unknown> | null => {
  const fromStep = numberBodyField(body, "diagnosticFromStep");
  const untilStep = numberBodyField(body, "diagnosticUntilStep");
  const purpose = typeof body.diagnosticPurpose === "string" && body.diagnosticPurpose.trim()
    ? body.diagnosticPurpose.trim()
    : null;
  const configPayload: Record<string, unknown> = {};
  if (fromStep !== null) configPayload.fromStep = Math.max(1, Math.floor(fromStep));
  if (untilStep !== null) configPayload.untilStep = Math.max(1, Math.floor(untilStep));
  if (purpose) configPayload.purpose = purpose;
  return Object.keys(configPayload).length > 0 ? configPayload : null;
};

const parseDiagnosticConfig = (value: unknown): Record<string, unknown> | null => {
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
    insertRunEvent(runId, "tool_response.dispatch_failed", {
      requestId,
      caseNo: approval.case_no,
      stepNo: approval.step_no,
      error: "TOOL_REQUEST_EVENT_NOT_FOUND",
      message: "Tool Bridge response missing: the approval was resolved, but the original Tool Bridge request event could not be found or bound."
    });
    insertRunLog(runId, "ERROR", "Tool Bridge response missing: request event not found", {
      requestId,
      caseNo: approval.case_no,
      stepNo: approval.step_no
    });
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
    insertRunEvent(runId, "tool_response.dispatch_failed", {
      agentId: event.agentId,
      requestId: event.requestId ?? requestId,
      caseNo: approval.case_no,
      stepNo: approval.step_no,
      error: message,
      message: "Tool Bridge response dispatch failed: the App attempted to send the response to the Mac Agent but delivery failed."
    });
    insertRunLog(runId, "ERROR", "Tool response dispatch failed", {
      agentId: event.agentId,
      requestId: event.requestId ?? requestId,
      error: message
    });
    return { sent: false, agentId: event.agentId, requestId: event.requestId ?? requestId, error: message };
  }
};

type ToolBridgeStatusItem = {
  id: string;
  caseNo: string;
  stepNo: number;
  requestId: string | null;
  requestType: string;
  action: string;
  reason: string;
  approvalStatus: string;
  responseState: "pending_approval" | "rejected" | "response_missing" | "response_sent" | "response_delivered";
  resolvedBy: string | null;
  createdAt: string | null;
  resolvedAt: string | null;
  responseSentAt: string | null;
  responseDeliveredAt: string | null;
  error: string | null;
};

const parseToolRequestReason = (reason: string): { requestType: string; action: string; requestId: string | null; reason: string } => {
  const lines = reason.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0] ?? reason.trim();
  const toolMatch = firstLine.match(/^TOOL_REQUEST\s+([^:]+):\s*(.*)$/i);
  const lineValue = (prefix: string): string | null => {
    const found = lines.find((line) => line.toLowerCase().startsWith(prefix.toLowerCase()));
    const value = found ? found.slice(prefix.length).trim() : "";
    return value || null;
  };
  return {
    requestType: toolMatch?.[1] ?? "manual_approval",
    action: toolMatch?.[2] ?? firstLine,
    requestId: lineValue("request_id:"),
    reason: lineValue("reason:") ?? ""
  };
};

const collectToolBridgeStatusItems = (runId: string): ToolBridgeStatusItem[] => {
  const approvals = db
    .prepare("SELECT * FROM approvals WHERE run_id = ? AND reason LIKE 'TOOL_REQUEST%' ORDER BY created_at ASC")
    .all(runId) as Array<Record<string, unknown>>;
  if (approvals.length === 0) return [];

  const events = db
    .prepare(
      `
        SELECT event_type, payload_json, created_at
        FROM run_events
        WHERE run_id = ?
          AND event_type IN ('tool_response.sent', 'tool_response.delivered', 'tool_response.dispatch_failed')
        ORDER BY rowid ASC
      `
    )
    .all(runId) as Array<{ event_type: string; payload_json: string | null; created_at: string | null }>;

  const sentByRequestId = new Map<string, { createdAt: string | null }>();
  const deliveredByRequestId = new Map<string, { createdAt: string | null }>();
  const failureByRequestId = new Map<string, { createdAt: string | null; error: string | null }>();
  for (const event of events) {
    const payload = parseJsonObject(event.payload_json);
    const requestId = requestIdFromToolBridgePayload(payload);
    if (!requestId) continue;
    if (event.event_type === "tool_response.sent") {
      sentByRequestId.set(requestId, { createdAt: event.created_at });
    } else if (event.event_type === "tool_response.delivered") {
      deliveredByRequestId.set(requestId, { createdAt: event.created_at });
    } else if (event.event_type === "tool_response.dispatch_failed") {
      failureByRequestId.set(requestId, {
        createdAt: event.created_at,
        error: stringValue(payload?.error) ?? stringValue(payload?.message)
      });
    }
  }

  return approvals.map((approval) => {
    const reasonText = String(approval.reason ?? "");
    const parsed = parseToolRequestReason(reasonText);
    const requestId = parsed.requestId;
    const sent = requestId ? sentByRequestId.get(requestId) ?? null : null;
    const delivered = requestId ? deliveredByRequestId.get(requestId) ?? null : null;
    const failure = requestId ? failureByRequestId.get(requestId) ?? null : null;
    const approvalStatus = String(approval.status ?? "");
    const responseState: ToolBridgeStatusItem["responseState"] =
      approvalStatus === "PENDING"
        ? "pending_approval"
        : approvalStatus === "SKIPPED"
          ? "rejected"
          : delivered
            ? "response_delivered"
            : sent
              ? "response_sent"
              : "response_missing";
    return {
      id: String(approval.id ?? `${requestId ?? "unknown"}-${approval.step_no ?? 0}`),
      caseNo: String(approval.case_no ?? ""),
      stepNo: Number(approval.step_no ?? 0),
      requestId,
      requestType: parsed.requestType,
      action: parsed.action,
      reason: parsed.reason || reasonText,
      approvalStatus,
      responseState,
      resolvedBy: stringValue(approval.resolved_by),
      createdAt: stringValue(approval.created_at),
      resolvedAt: stringValue(approval.resolved_at),
      responseSentAt: sent?.createdAt ?? null,
      responseDeliveredAt: delivered?.createdAt ?? null,
      error: failure?.error ?? (responseState === "response_missing" && approvalStatus === "APPROVED" ? "TOOL_BRIDGE_RESPONSE_MISSING" : null)
    };
  });
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
        id, run_id, case_no, group_id, group_name, case_title, execution_type, result_status, fail_category, detail_json, created_at, updated_at
      ) VALUES (
        @id, @run_id, @case_no, @group_id, @group_name, @case_title, @execution_type, @result_status, @fail_category, @detail_json, @created_at, @updated_at
      )
      ON CONFLICT(run_id, case_no) DO UPDATE SET
        group_id = excluded.group_id,
        group_name = excluded.group_name,
        case_title = excluded.case_title,
        execution_type = excluded.execution_type,
        result_status = excluded.result_status,
        fail_category = excluded.fail_category,
        detail_json = excluded.detail_json,
        updated_at = excluded.updated_at
    `
  );

const prepareUpsertStepStmt = () =>
  db.prepare(
    `
      INSERT INTO run_case_steps (
        id, run_id, case_no, step_no, action_type, target_type, target_value, input_value, expected,
        require_approval, timeout_ms, retry, status, actual_json, created_at, updated_at
      ) VALUES (
        @id, @run_id, @case_no, @step_no, @action_type, @target_type, @target_value, @input_value, @expected,
        @require_approval, @timeout_ms, @retry, @status, @actual_json, @created_at, @updated_at
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
        status = excluded.status,
        actual_json = excluded.actual_json,
        updated_at = excluded.updated_at
    `
  );

const uploadRoot = path.resolve(config.storageRoot, "uploads");
fs.mkdirSync(uploadRoot, { recursive: true });
const outputRoot = path.resolve(config.storageRoot, "outputs");
fs.mkdirSync(outputRoot, { recursive: true });

const SOURCE_TERMINAL_RESULT_STATUSES = new Set([
  "PASS",
  "FAIL",
  "BLOCKED",
  "PARTIAL",
  "SKIPPED",
  "MANUAL_PASS",
  "MANUAL_FAIL",
  "MANUAL_BLOCKED"
]);

const normalizeSourceResultStatus = (status: string | null | undefined): string | null => {
  const normalized = status?.trim().toUpperCase().replace(/\s+/g, "_");
  return normalized && SOURCE_TERMINAL_RESULT_STATUSES.has(normalized) ? normalized : null;
};

const detailJsonObjectFromUnknown = (value: unknown): Record<string, unknown> => {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
};

const sourceResultBlockedReason = (detail: Record<string, unknown>): string | null => {
  for (const key of ["blocked_reason", "blockedReason", "阻塞原因", "skip_reason", "skipped_reason", "跳過原因"]) {
    const value = detail[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const buildSourcePrefilledDetailJson = (item: ParsedCase, resultStatus: string): Record<string, unknown> => {
  const detail = detailJsonObjectFromUnknown(item.detailJson);
  const blockedReason = sourceResultBlockedReason(detail);
  const executionMethod = item.executionMethodRaw ?? item.executionType;
  return {
    ...detail,
    測試類型: typeof detail.測試類型 === "string" && detail.測試類型.trim() ? detail.測試類型 : item.testType ?? "未分類",
    測試目的: typeof detail.測試目的 === "string" && detail.測試目的.trim() ? detail.測試目的 : item.caseTitle || item.caseNo,
    設定條件: typeof detail.設定條件 === "string" && detail.設定條件.trim() ? detail.設定條件 : item.precondition ?? "未提供前置條件",
    執行步驟: typeof detail.執行步驟 === "string" && detail.執行步驟.trim() ? detail.執行步驟 : item.stepText ?? "未提供執行步驟",
    預期行為: typeof detail.預期行為 === "string" && detail.預期行為.trim() ? detail.預期行為 : item.expectedResult ?? "未提供預期結果",
    實際行為: typeof detail.實際行為 === "string" && detail.實際行為.trim()
      ? detail.實際行為
      : resultStatus === "BLOCKED"
        ? "Source testcase row already contains result=BLOCKED; Agent execution skipped."
        : `Source testcase row already contains result=${resultStatus}; Agent execution skipped.`,
    執行方式: typeof detail.執行方式 === "string" && detail.執行方式.trim() ? detail.執行方式 : executionMethod,
    ...(item.validationMethod && !detail.驗證方法 ? { 驗證方法: item.validationMethod } : {}),
    ...(item.testDate && !detail.測試日 ? { 測試日: item.testDate } : {}),
    ...(resultStatus === "BLOCKED" && !detail.blocked_reason ? { blocked_reason: blockedReason ?? "Source testcase row prefilled BLOCKED." } : {}),
    sourcePrefilledResult: {
      source: "testcase_xlsx",
      resultStatus,
      originalResult: item.resultStatusRaw ?? resultStatus,
      importedAt: nowIso()
    }
  };
};

const resultStatusForImportedCase = (item: ParsedCase): string =>
  normalizeSourceResultStatus(item.resultStatusRaw) ?? (item.executionType === "manual" ? "MANUAL_PENDING" : "PENDING");

const executionTypeForImportedCase = (item: ParsedCase, resultStatus: string): string => {
  if (SOURCE_TERMINAL_RESULT_STATUSES.has(resultStatus)) return item.executionMethodRaw ?? item.executionType;
  return item.executionType;
};

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
	      const ext = path.extname(file.originalname) || (file.fieldname === "log" ? ".log" : file.fieldname === "artifact" ? ".artifact" : ".xlsx");
	      cb(null, `${Date.now()}-${randomUUID()}${ext}`);
	    }
	  })
});

const artifactDownloadUrl = (req: Request, runId: string, artifactId: string): string =>
  `${getRequestBaseUrl(req)}/api/runs/${runId}/artifacts/${artifactId}/download`;

const serializeRunArtifact = (req: Request, row: RunArtifactRow): Record<string, unknown> => ({
  id: row.id,
  runId: row.run_id,
  caseNo: row.case_no,
  action: row.action,
  artifactType: row.artifact_type,
  manifestId: row.manifest_id,
  originalName: row.original_name,
  mimeType: row.mime_type,
  sizeBytes: row.size_bytes,
  checksum: row.checksum,
  localPath: row.local_path,
  relativePath: row.relative_path,
  source: row.source,
  retentionClass: row.retention_class,
  metadata: parseJsonObject(row.metadata_json),
  createdAt: row.created_at,
  uploadedAt: row.uploaded_at,
  downloadUrl: artifactDownloadUrl(req, row.run_id, row.id)
});

const listRunArtifacts = (runId: string): RunArtifactRow[] =>
  db
    .prepare(
      `
        SELECT *
        FROM run_artifacts
        WHERE run_id = ?
        ORDER BY uploaded_at DESC
      `
    )
    .all(runId) as RunArtifactRow[];

const countRunArtifactsByType = (runId: string): { total: number; screenshots: number; manifests: number } => {
  const rows = db
    .prepare(
      `
        SELECT artifact_type, COUNT(1) AS count
        FROM run_artifacts
        WHERE run_id = ?
        GROUP BY artifact_type
      `
    )
    .all(runId) as Array<{ artifact_type: string; count: number }>;
  return rows.reduce((acc, row) => {
    acc.total += row.count;
    if (row.artifact_type === "screenshot") acc.screenshots += row.count;
    if (row.artifact_type === "evidence_manifest") acc.manifests += row.count;
    return acc;
  }, { total: 0, screenshots: 0, manifests: 0 });
};

export const upsertImportedTestcase = (
  runId: string,
  imported: { cases: ParsedCase[]; steps: ParsedStep[] }
): { manualCases: number; prefilledCases: number } => {
  const now = nowIso();
  let manualCases = 0;
  let prefilledCases = 0;
  const sourceResultStatusByCase = new Map<string, string>();
  const upsertCaseStmt = prepareUpsertCaseStmt();
  const upsertStepStmt = prepareUpsertStepStmt();

  const tx = db.transaction(() => {
    for (const item of imported.cases) {
      const resultStatus = resultStatusForImportedCase(item);
      const sourcePrefilled = SOURCE_TERMINAL_RESULT_STATUSES.has(resultStatus);
      if (sourcePrefilled) {
        prefilledCases += 1;
        sourceResultStatusByCase.set(item.caseNo, resultStatus);
      } else if (item.executionType === "manual") {
        manualCases += 1;
      }
      upsertCaseStmt.run({
        id: randomUUID(),
        run_id: runId,
        case_no: item.caseNo,
        group_id: item.groupId ?? null,
        group_name: item.groupName ?? null,
        case_title: item.caseTitle,
        execution_type: executionTypeForImportedCase(item, resultStatus),
        result_status: resultStatus,
        fail_category: item.failCategory ?? null,
        detail_json: sourcePrefilled
          ? JSON.stringify(buildSourcePrefilledDetailJson(item, resultStatus))
          : item.detailJson
            ? JSON.stringify(item.detailJson)
            : null,
        created_at: now,
        updated_at: now
      });
    }

    for (const step of imported.steps) {
      const prefilledStatus = sourceResultStatusByCase.get(step.caseNo);
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
        status: prefilledStatus ? "SKIPPED" : "PENDING",
        actual_json: prefilledStatus
          ? JSON.stringify({
              source: "source_prefilled_result",
              resultStatus: prefilledStatus,
              skippedAt: now
            })
          : null,
        created_at: now,
        updated_at: now
      });
    }
  });
  tx();

  db.prepare("UPDATE runs SET updated_at = ? WHERE id = ?").run(now, runId);
  return { manualCases, prefilledCases };
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

const terminalStatusForRunCases = (runId: string, fallbackCases: ParsedResultCase[]): string => {
  const rows = db
    .prepare("SELECT result_status FROM run_cases WHERE run_id = ?")
    .all(runId) as Array<{ result_status: string | null }>;
  const statuses = rows.map((item) => normalizeParsedResultStatus(item.result_status ?? "PENDING"));
  if (statuses.some((status) => status === "PENDING" || status === "MANUAL_PENDING")) {
    return "RUNNING";
  }
  const passLike = new Set(["PASS", "MANUAL_PASS", "SKIPPED"]);
  if (statuses.length === 0) {
    return resultHasFailedOutcome(fallbackCases) ? "FAILED" : "SUCCEEDED";
  }
  return statuses.some((status) => !passLike.has(status)) ? "FAILED" : "SUCCEEDED";
};

const stepStatusForCaseResult = (status: string): "PASS" | "FAIL" | "SKIPPED" => {
  if (status === "PASS" || status === "MANUAL_PASS") return "PASS";
  if (status === "SKIPPED") return "SKIPPED";
  return "FAIL";
};

const parseStoredDetailJson = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {
      原始詳細紀錄JSON解析狀態: "INVALID_JSON",
      原始內容: value
    };
  }
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

const objectValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const stringValue = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const toolBridgePayloadObject = (payload: Record<string, unknown> | null): Record<string, unknown> => {
  const nested = objectValue(payload?.payload);
  return nested ?? payload ?? {};
};

const requestIdFromToolBridgePayload = (payload: Record<string, unknown> | null): string | null => {
  const toolPayload = toolBridgePayloadObject(payload);
  return (
    stringValue(payload?.requestId) ??
    stringValue(payload?.request_id) ??
    stringValue(toolPayload.requestId) ??
    stringValue(toolPayload.request_id)
  );
};

const caseNoFromToolBridgePayload = (payload: Record<string, unknown> | null): string | null => {
  const toolPayload = toolBridgePayloadObject(payload);
  return (
    stringValue(payload?.caseNo) ??
    stringValue(payload?.case_no) ??
    stringValue(payload?.case) ??
    stringValue(toolPayload.caseNo) ??
    stringValue(toolPayload.case_no) ??
    stringValue(toolPayload.case)
  );
};

const booleanValue = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

const toolBridgeResponseEvidence = (
  eventType: string,
  createdAt: string | null,
  payload: Record<string, unknown> | null
): ExternalToolBridgeEvidence => {
  const toolPayload = toolBridgePayloadObject(payload);
  return {
    requestId: requestIdFromToolBridgePayload(payload),
    eventType,
    approved: booleanValue(payload?.approved) ?? booleanValue(toolPayload.approved),
    resolvedBy: stringValue(payload?.resolvedBy) ?? stringValue(payload?.resolved_by) ?? stringValue(toolPayload.resolvedBy) ?? stringValue(toolPayload.resolved_by),
    source: "run_events",
    ...(createdAt ? { createdAt } : {})
  };
};

const inferCaseNoFromRequestId = (requestId: string | null, expectedCaseNos: string[]): string | null => {
  if (!requestId) return null;
  const normalizedRequestId = normalizeCaseNoForGate(requestId);
  return expectedCaseNos.find((caseNo) => normalizedRequestId.includes(normalizeCaseNoForGate(caseNo))) ?? null;
};

const collectExternalToolBridgeEvidenceByCase = (
  runId: string,
  currentCaseNos: string[]
): Record<string, ExternalToolBridgeEvidence[]> => {
  const rows = db
    .prepare(
      `
        SELECT event_type, payload_json, created_at
        FROM run_events
        WHERE run_id = ? AND event_type IN ('tool_request.created', 'tool_response.sent', 'tool_response.delivered')
        ORDER BY rowid ASC
      `
    )
    .all(runId) as Array<{ event_type: string; payload_json: string | null; created_at: string | null }>;

  const requestIdToCaseNo = new Map<string, string>();
  for (const row of rows) {
    if (row.event_type !== "tool_request.created") continue;
    const payload = parseJsonObject(row.payload_json);
    const requestId = requestIdFromToolBridgePayload(payload);
    const caseNo = caseNoFromToolBridgePayload(payload) ?? inferCaseNoFromRequestId(requestId, currentCaseNos);
    if (requestId && caseNo) requestIdToCaseNo.set(requestId, caseNo);
  }

  const evidenceByCase: Record<string, ExternalToolBridgeEvidence[]> = {};
  for (const row of rows) {
    if (row.event_type !== "tool_response.sent" && row.event_type !== "tool_response.delivered") continue;
    const payload = parseJsonObject(row.payload_json);
    const requestId = requestIdFromToolBridgePayload(payload);
    let caseNo = caseNoFromToolBridgePayload(payload);
    if (!caseNo && requestId) caseNo = requestIdToCaseNo.get(requestId) ?? null;
    if (!caseNo) caseNo = inferCaseNoFromRequestId(requestId, currentCaseNos);
    if (!caseNo) continue;
    const evidence = toolBridgeResponseEvidence(row.event_type, row.created_at, payload);
    evidenceByCase[caseNo] = [...(evidenceByCase[caseNo] ?? []), evidence];
  }
  return evidenceByCase;
};

const deleteBugsForParsedResult = (runId: string, parsed: { cases: ParsedResultCase[]; bugs: ParsedBug[] }): void => {
  const relatedCaseNos = uniqueCaseNosForGate([
    ...parsed.cases.map((item) => item.caseNo),
    ...parsed.bugs.map((item) => item.relatedCaseNo)
  ]).filter((caseNo) => caseNo !== "-");
  if (relatedCaseNos.length === 0) return;
  const placeholders = relatedCaseNos.map(() => "?").join(", ");
  db.prepare(`DELETE FROM bugs WHERE run_id = ? AND related_case_no IN (${placeholders})`).run(runId, ...relatedCaseNos);
};

const expectedCaseNosForRun = (runId: string): string[] => {
  const rows = db
    .prepare("SELECT case_no FROM run_cases WHERE run_id = ? ORDER BY COALESCE(group_id, ''), created_at ASC, case_no ASC")
    .all(runId) as Array<{ case_no: string }>;
  return uniqueCaseNosForGate(rows.map((item) => item.case_no));
};

const aggregateResultPathForRun = (runId: string): string => path.join(outputRoot, `${runId}-final-aggregate-result.xlsx`);

const listAggregateCases = (runId: string): AggregateCase[] =>
  db
    .prepare(
      `
        SELECT group_id, group_name, case_no, case_title, execution_type, result_status, fail_category,
               detail_json, created_at, updated_at
        FROM run_cases
        WHERE run_id = ?
        ORDER BY COALESCE(group_id, ''), COALESCE(group_name, ''), case_no
      `
    )
    .all(runId) as AggregateCase[];

const listAggregateBugs = (runId: string): AggregateBug[] =>
  db
    .prepare(
      `
        SELECT id, severity, related_case_no, description, suggestion, created_at
        FROM bugs
        WHERE run_id = ?
        ORDER BY related_case_no ASC, created_at ASC
      `
    )
    .all(runId) as AggregateBug[];

const casesReadyForFinalAggregate = (cases: AggregateCase[]): boolean => {
  if (cases.length === 0) return false;
  return !cases.some((item) => {
    const status = normalizeParsedResultStatus(item.result_status ?? "PENDING");
    return status === "PENDING" || status === "MANUAL_PENDING";
  });
};

const casesReadyForPartialAggregate = (cases: AggregateCase[]): boolean => {
  if (cases.length === 0) return false;
  return cases.some((item) => {
    const status = normalizeParsedResultStatus(item.result_status ?? "PENDING");
    return (status !== "PENDING" && status !== "MANUAL_PENDING") || Boolean(item.detail_json?.trim());
  });
};

const generateAggregateResult = async (runId: string, aggregateMode: "final" | "partial"): Promise<string | null> => {
  const run = getRun(runId) as (AggregateRun & RunOutputPaths) | undefined;
  if (!run) return null;
  const cases = listAggregateCases(runId);
  if (aggregateMode === "final" && !casesReadyForFinalAggregate(cases)) return null;
  if (aggregateMode === "partial" && !casesReadyForPartialAggregate(cases)) return null;

  const filePath = aggregateResultPathForRun(runId);
  await writeFinalAggregateResultXlsx({
    filePath,
    run,
    cases,
    bugs: listAggregateBugs(runId),
    aggregateMode
  });

  const now = nowIso();
  db.prepare("UPDATE runs SET aggregate_result_xlsx_path = ?, aggregate_result_generated_at = ?, updated_at = ? WHERE id = ?").run(
    filePath,
    now,
    now,
    runId
  );
  insertRunEvent(runId, aggregateMode === "final" ? "result.aggregate_generated" : "result.partial_aggregate_generated", {
    filePath,
    caseCount: cases.length,
    aggregateMode,
    source: "normalized-server-state"
  });
  insertRunLog(runId, "INFO", aggregateMode === "final" ? "Final aggregate result xlsx generated" : "Partial aggregate result xlsx generated", {
    filePath,
    caseCount: cases.length,
    aggregateMode
  });
  return filePath;
};

const generateFinalAggregateResult = async (runId: string): Promise<string | null> => generateAggregateResult(runId, "final");

const getDownloadResultXlsxPath = async (runId: string, run: RunOutputPaths): Promise<string | null> => {
  const cases = listAggregateCases(runId);
  const aggregateMode = casesReadyForFinalAggregate(cases) ? "final" : "partial";
  const aggregatePath = await generateAggregateResult(runId, aggregateMode);
  if (aggregatePath) return aggregatePath;
  if (run.aggregate_result_xlsx_path && fs.existsSync(run.aggregate_result_xlsx_path)) return run.aggregate_result_xlsx_path;
  return run.result_xlsx_path ?? null;
};

const writeResultEvidenceGateReport = (filePath: string, report: ResultEvidenceGateReport, suffix?: string): string => {
  const reportPath = `${filePath}.result-evidence-gate${suffix ? `-${suffix}` : ""}.json`;
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
};

export const ingestResultXlsx = async (
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
  const externalToolBridgeEvidenceByCase = collectExternalToolBridgeEvidenceByCase(
    runId,
    uniqueCaseNosForGate([
      ...parsed.cases.map((item) => item.caseNo),
      ...(options.currentCaseNo ? [options.currentCaseNo] : []),
      ...(options.expectedCaseNos ?? [])
    ])
  );
  let report = evaluateResultEvidenceGate({
    parsed,
    resultSource: options.resultSource,
    currentCaseNo: options.currentCaseNo,
    expectedCaseNos,
    requireSingleCase: true,
    externalToolBridgeEvidenceByCase
  });
  let reportPath = writeResultEvidenceGateReport(filePath, report);
  insertRunEvent(runId, "result.evidence_gate_checked", {
    status: report.status,
    issueCount: report.issues.length,
    errorCodes: report.issues.filter((item) => item.severity === "error").map((item) => item.code),
    warningCodes: report.issues.filter((item) => item.severity === "warning").map((item) => item.code),
    reportPath
  });
  if (report.status === "error") {
    const containmentReport = containCaseLevelResultEvidenceGateIssues(parsed, report);
    insertRunEvent(runId, "result.evidence_gate_containment_checked", containmentReport);
    if (containmentReport.status === "updated") {
      report = evaluateResultEvidenceGate({
        parsed,
        resultSource: options.resultSource,
        currentCaseNo: options.currentCaseNo,
        expectedCaseNos,
        requireSingleCase: true,
        externalToolBridgeEvidenceByCase
      });
      reportPath = writeResultEvidenceGateReport(filePath, report, "after-containment");
      insertRunEvent(runId, "result.evidence_gate_checked_after_containment", {
        status: report.status,
        issueCount: report.issues.length,
        errorCodes: report.issues.filter((item) => item.severity === "error").map((item) => item.code),
        warningCodes: report.issues.filter((item) => item.severity === "warning").map((item) => item.code),
        reportPath,
        containment: containmentReport
      });
    }
  }
  if (report.status === "error") {
    insertRunEvent(runId, "result.evidence_gate_failed", {
      issueCount: report.issues.length,
      errorCodes: report.issues.filter((item) => item.severity === "error").map((item) => item.code),
      reportPath
    });
    throw new ResultEvidenceGateError(report);
  }
  const now = nowIso();

  const upsertCaseStmt = db.prepare(
    `
      INSERT INTO run_cases (
        id, run_id, case_no, group_id, group_name, case_title, execution_type, result_status, fail_category,
        detail_json, created_at, updated_at
      ) VALUES (
        @id, @run_id, @case_no, @group_id, @group_name, @case_title, @execution_type, @result_status, @fail_category,
        @detail_json, @created_at, @updated_at
      )
      ON CONFLICT(run_id, case_no) DO UPDATE SET
        group_id = excluded.group_id,
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
  let generatedBugCount = 0;

  const tx = db.transaction(() => {
    for (const item of parsed.cases) {
      const resultStatus = normalizeParsedResultStatus(item.status);
      upsertCaseStmt.run({
        id: randomUUID(),
        run_id: runId,
        case_no: item.caseNo,
        group_id: item.groupId,
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

    deleteBugsForParsedResult(runId, parsed);
    const defaultBugRelatedCaseNo = parsed.cases.length === 1 ? parsed.cases[0]?.caseNo ?? "-" : "-";
    const generatedBugCandidates = buildMissingBugCandidates({
      cases: parsed.cases,
      bugs: parsed.bugs,
      defaultBugRelatedCaseNo
    });
    generatedBugCount = generatedBugCandidates.length;
    for (const bug of parsed.bugs) {
      insertBugStmt.run({
        id: randomUUID(),
        run_id: runId,
        round_id: String(run.round_id ?? ""),
        severity: bug.severity || "INFO",
        related_case_no: bug.relatedCaseNo ?? defaultBugRelatedCaseNo,
        description: formatParsedBugDescription(bug),
        suggestion: bug.suggestion,
        created_at: now,
        updated_at: now
      });
    }
    for (const bug of generatedBugCandidates) {
      insertBugStmt.run({
        id: randomUUID(),
        run_id: runId,
        round_id: String(run.round_id ?? ""),
        severity: bug.severity || "INFO",
        related_case_no: bug.relatedCaseNo ?? defaultBugRelatedCaseNo,
        description: bug.description ?? bug.title,
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
    if (generatedBugCandidates.length > 0) {
      insertRunEvent(runId, "result.fail_bug_fallback_generated", {
        count: generatedBugCandidates.length,
        cases: generatedBugCandidates.map((item) => item.relatedCaseNo),
        source: "result_xlsx_ingest"
      });
    }
  });
  tx();

  const runStatus = terminalStatusForRunCases(runId, parsed.cases);
  setRunStatusWithMeta(runId, runStatus, "Mac Agent");
  if (TERMINAL_STATUSES.has(runStatus)) {
    await generateFinalAggregateResult(runId);
  }

  return {
    cases: parsed.cases.length,
    bugs: parsed.bugs.length + generatedBugCount,
    parserVersion: parsed.parserVersion,
    runStatus,
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
    const domain = payload.domain ?? "BI";
    if (!getDomainPack(domain)) {
      return res.status(400).json({ error: "DOMAIN_NOT_FOUND", domain });
    }
	    const diagnosticConfig = buildDiagnosticConfig(req.body as Record<string, unknown>);

	    db.prepare(
	      `
	      INSERT INTO runs (
	        id, round_id, domain, location, feature_main, feature_sub, run_name, dev_url, execution_mode, diagnostic_config_json, status, created_at, updated_at
	      ) VALUES (
	        @id, @round_id, @domain, @location, @feature_main, @feature_sub, @run_name, @dev_url, @execution_mode, @diagnostic_config_json, @status, @created_at, @updated_at
	      )
	      `
	    ).run({
      id: runId,
      round_id: payload.roundId,
      domain,
      location: payload.location,
      feature_main: payload.featureMain,
	      feature_sub: payload.featureSub,
	      run_name: payload.runName,
	      dev_url: payload.devUrl,
	      execution_mode: payload.executionMode ?? (config.nodeEnv === "production" ? "offline" : "interactive"),
	      diagnostic_config_json: diagnosticConfig ? JSON.stringify(diagnosticConfig) : null,
	      status: "READY",
	      created_at: now,
	      updated_at: now
    });

    insertRunLog(runId, "INFO", "Run created", payload);
    insertRunEvent(runId, "run.created", {
      domain,
      roundId: payload.roundId,
      location: payload.location,
	      featureMain: payload.featureMain,
	      featureSub: payload.featureSub,
	      executionMode: payload.executionMode ?? null,
	      diagnostic: diagnosticConfig
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
        const { manualCases, prefilledCases } = upsertImportedTestcase(runId, imported);
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
          manualCases,
          prefilledCases
        });
        insertRunEvent(runId, "input.xlsx_parsed", {
          sourceMode,
          importedCases: imported.cases.length,
          importedSteps: imported.steps.length,
          manualCases,
          prefilledCases
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
  let prefilledCases = 0;
  const upsertCaseStmt = prepareUpsertCaseStmt();

  const tx = db.transaction(() => {
    for (const item of parsed.data.items) {
      const sourceResultStatus = normalizeSourceResultStatus(item.resultStatus);
      const resultStatus = sourceResultStatus ?? (item.executionType === "manual" ? "MANUAL_PENDING" : "PENDING");
      if (sourceResultStatus) {
        prefilledCases += 1;
      } else if (item.executionType === "manual") {
        manualCases += 1;
      }
      const sourcePrefilledDetail = sourceResultStatus
        ? {
            ...detailJsonObjectFromUnknown(item.detailJson),
            sourcePrefilledResult: {
              source: "api",
              resultStatus,
              originalResult: item.resultStatus,
              importedAt: now
            }
          }
        : null;

      upsertCaseStmt.run({
        id: randomUUID(),
        run_id: req.params.id,
        case_no: item.caseNo,
        group_id: item.groupId ?? null,
        group_name: item.groupName ?? null,
        case_title: item.caseTitle,
        execution_type: item.executionType,
        result_status: resultStatus,
        fail_category: item.failCategory ?? null,
        detail_json: sourcePrefilledDetail
          ? JSON.stringify(sourcePrefilledDetail)
          : item.detailJson
            ? JSON.stringify(item.detailJson)
            : null,
        created_at: now,
        updated_at: now
      });
    }
  });

  tx();

  db.prepare("UPDATE runs SET updated_at = ? WHERE id = ?").run(now, req.params.id);
  insertRunLog(req.params.id, "INFO", "Cases upserted", {
    total: parsed.data.items.length,
    manualCases,
    prefilledCases
  });

  return res.status(201).json({
    runId: req.params.id,
    total: parsed.data.items.length,
    manualCases,
    prefilledCases
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
  const caseStatuses = db
    .prepare("SELECT case_no, result_status FROM run_cases WHERE run_id = ?")
    .all(req.params.id) as Array<{ case_no: string; result_status: string | null }>;
  const sourceResultStatusByCase = new Map(
    caseStatuses
      .map((item) => [item.case_no, normalizeSourceResultStatus(item.result_status)] as const)
      .filter((item): item is readonly [string, string] => Boolean(item[1]))
  );
  const tx = db.transaction(() => {
    for (const step of parsed.data.items) {
      const prefilledStatus = sourceResultStatusByCase.get(step.caseNo);
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
        status: prefilledStatus ? "SKIPPED" : "PENDING",
        actual_json: prefilledStatus
          ? JSON.stringify({
              source: "source_prefilled_result",
              resultStatus: prefilledStatus,
              skippedAt: now
            })
          : null,
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
    const { manualCases, prefilledCases } = upsertImportedTestcase(req.params.id, imported);

    insertRunLog(req.params.id, "INFO", "XLSX imported", {
      filePath: parsed.data.filePath,
      cases: imported.cases.length,
      steps: imported.steps.length,
      manualCases,
      prefilledCases
    });

    return res.status(201).json({
      runId: req.params.id,
      importedCases: imported.cases.length,
      importedSteps: imported.steps.length,
      manualCases,
      prefilledCases
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
  const requestedExecutionMode = String(run.execution_mode ?? "interactive");
  if (agent.supportedExecutionModes.length > 0 && !agent.supportedExecutionModes.includes(requestedExecutionMode)) {
    return res.status(409).json({
      error: "AGENT_UNSUPPORTED_EXECUTION_MODE",
      supportedExecutionModes: agent.supportedExecutionModes
    });
  }

  try {
    const domain = String(run.domain ?? "BI");
    const diagnosticConfig = requestedExecutionMode === "diagnostic"
      ? parseDiagnosticConfig((run as RunOutputPaths).diagnostic_config_json)
      : null;
    const inputUrls = {
      ...getDomainInputUrls(req, domain),
      ...getRunInputUrls(req, req.params.id, run as RunInputPaths)
    };
    const outputUrls = getRunOutputUrls(req, req.params.id);
    const message = agentRegistry.dispatchTask(parsed.data.agentId, {
      run_id: req.params.id,
      domain,
      round_id: String(run.round_id ?? ""),
      execution_mode: requestedExecutionMode,
      dev_url: String(run.dev_url ?? ""),
      feature_main: String(run.feature_main ?? ""),
      feature_sub: String(run.feature_sub ?? ""),
      ...(diagnosticConfig ? { diagnostic: diagnosticConfig } : {}),
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
	      outputUrls: Object.keys(outputUrls),
	      diagnostic: diagnosticConfig
	    }, message.seq);
    insertRunLog(req.params.id, "INFO", "Run dispatched to Mac Agent", {
      agentId: parsed.data.agentId,
      deviceName: agent.deviceName,
      messageId: message.id,
      inputUrls: Object.keys(inputUrls),
      outputUrls: Object.keys(outputUrls),
      diagnostic: diagnosticConfig
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

router.post("/:id/pm-review", async (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const parsed = pmReviewSchema.safeParse(req.body);
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

  const now = nowIso();
  const originalStatus = String(target.result_status ?? "PENDING");
  const detailJson = {
    ...parseStoredDetailJson(target.detail_json),
    Codex建議判定: originalStatus,
    PM最終判定: parsed.data.finalStatus,
    PM複核者: parsed.data.reviewedBy,
    PM複核時間: now,
    ...(parsed.data.note?.trim() ? { PM複核備註: parsed.data.note.trim() } : {})
  };

  db.prepare(
    `
      UPDATE run_cases
      SET result_status = ?, detail_json = ?, manual_filled_by = ?, manual_filled_at = ?, updated_at = ?
      WHERE run_id = ? AND case_no = ?
    `
  ).run(
    parsed.data.finalStatus,
    JSON.stringify(detailJson),
    parsed.data.reviewedBy,
    now,
    now,
    req.params.id,
    parsed.data.caseNo
  );

  const runStatus = terminalStatusForRunCases(req.params.id, []);
  setRunStatusWithMeta(req.params.id, runStatus, "Mac Agent + PM Review");
  if (TERMINAL_STATUSES.has(runStatus)) {
    await generateFinalAggregateResult(req.params.id);
  }
  insertRunEvent(req.params.id, "pm_review.updated", {
    caseNo: parsed.data.caseNo,
    originalStatus,
    finalStatus: parsed.data.finalStatus,
    reviewedBy: parsed.data.reviewedBy
  });
  insertRunLog(req.params.id, "INFO", "PM final review updated", {
    caseNo: parsed.data.caseNo,
    originalStatus,
    finalStatus: parsed.data.finalStatus,
    reviewedBy: parsed.data.reviewedBy
  });

  return res.json({
    runId: req.params.id,
    caseNo: parsed.data.caseNo,
    originalStatus,
    finalStatus: parsed.data.finalStatus,
    runStatus
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

router.get("/:id/output/result-xlsx", async (req, res) => {
  const run = getRun(req.params.id) as (Record<string, unknown> & RunOutputPaths) | undefined;
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }
  const resultPath = await getDownloadResultXlsxPath(req.params.id, run);
  return safeSendRunOutputFile(
    res,
    resultPath,
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

router.post("/:id/output/timing-summary", resultUpload.single("timingSummary"), (req, res) => {
  const runId = String(req.params.id);
  const run = getRun(runId);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  if (!req.file) {
    return res.status(400).json({
      error: "TIMING_SUMMARY_REQUIRED",
      message: "請使用 multipart 欄位 timingSummary 上傳 timing-summary.json"
    });
  }

  const now = nowIso();
  db.prepare("UPDATE runs SET timing_summary_path = ?, timing_summary_uploaded_at = ?, updated_at = ? WHERE id = ?").run(
    req.file.path,
    now,
    now,
    runId
  );
  insertRunEvent(runId, "timing_summary.uploaded", {
    filePath: req.file.path,
    originalName: req.file.originalname,
    size: req.file.size
  });
  insertRunLog(runId, "INFO", "Agent timing summary uploaded", {
    filePath: req.file.path,
    originalName: req.file.originalname,
    size: req.file.size
  });

  return res.status(201).json({
    runId,
    timingSummaryPath: req.file.path,
    uploadedAt: now
  });
});

router.get("/:id/output/timing-summary", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }
  return safeSendRunOutputFile(res, run.timing_summary_path, `${String(run.round_id ?? req.params.id)}_timing-summary.json`);
});

router.post("/:id/output/diagnostic-summary", resultUpload.single("diagnosticSummary"), (req, res) => {
  const runId = String(req.params.id);
  const run = getRun(runId);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  if (!req.file) {
    return res.status(400).json({
      error: "DIAGNOSTIC_SUMMARY_REQUIRED",
      message: "請使用 multipart 欄位 diagnosticSummary 上傳 diagnostic-summary.json"
    });
  }

  const now = nowIso();
  db.prepare("UPDATE runs SET diagnostic_summary_path = ?, diagnostic_summary_uploaded_at = ?, updated_at = ? WHERE id = ?").run(
    req.file.path,
    now,
    now,
    runId
  );
  insertRunEvent(runId, "diagnostic_summary.uploaded", {
    filePath: req.file.path,
    originalName: req.file.originalname,
    size: req.file.size
  });
  insertRunLog(runId, "INFO", "Agent diagnostic summary uploaded", {
    filePath: req.file.path,
    originalName: req.file.originalname,
    size: req.file.size
  });

  return res.status(201).json({
    runId,
    diagnosticSummaryPath: req.file.path,
    uploadedAt: now
  });
});

router.get("/:id/output/diagnostic-summary", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }
  return safeSendRunOutputFile(
    res,
    run.diagnostic_summary_path,
    `${String(run.round_id ?? req.params.id)}_diagnostic-summary.json`
  );
});

router.post("/:id/output/artifacts", resultUpload.single("artifact"), (req, res) => {
  const runId = String(req.params.id);
  const run = getRun(runId);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  if (!req.file) {
    return res.status(400).json({
      error: "ARTIFACT_REQUIRED",
      message: "請使用 multipart 欄位 artifact 上傳 evidence artifact"
    });
  }

  const body = req.body as Record<string, unknown>;
  const now = nowIso();
  const artifactId = randomUUID();
  const artifactType = typeof body.artifactType === "string" && body.artifactType.trim()
    ? body.artifactType.trim()
    : "artifact";
  const originalName = normalizeUploadOriginalName(req.file.originalname);
  const metadataJson = typeof body.metadataJson === "string" && body.metadataJson.trim()
    ? body.metadataJson.trim()
    : null;

  db.prepare(
    `
      INSERT INTO run_artifacts (
        id, run_id, case_no, action, artifact_type, manifest_id, storage_path, original_name, mime_type,
        size_bytes, checksum, local_path, relative_path, source, retention_class, metadata_json, created_at, uploaded_at
      ) VALUES (
        @id, @run_id, @case_no, @action, @artifact_type, @manifest_id, @storage_path, @original_name, @mime_type,
        @size_bytes, @checksum, @local_path, @relative_path, @source, @retention_class, @metadata_json, @created_at, @uploaded_at
      )
    `
  ).run({
    id: artifactId,
    run_id: runId,
    case_no: typeof body.caseNo === "string" && body.caseNo.trim() ? body.caseNo.trim() : null,
    action: typeof body.action === "string" && body.action.trim() ? body.action.trim() : null,
    artifact_type: artifactType,
    manifest_id: typeof body.manifestId === "string" && body.manifestId.trim() ? body.manifestId.trim() : null,
    storage_path: req.file.path,
    original_name: originalName,
    mime_type: req.file.mimetype || null,
    size_bytes: req.file.size,
    checksum: typeof body.checksum === "string" && body.checksum.trim() ? body.checksum.trim() : null,
    local_path: typeof body.localPath === "string" && body.localPath.trim() ? body.localPath.trim() : null,
    relative_path: typeof body.relativePath === "string" && body.relativePath.trim() ? body.relativePath.trim() : null,
    source: typeof body.source === "string" && body.source.trim() ? body.source.trim() : null,
    retention_class: typeof body.retentionClass === "string" && body.retentionClass.trim() ? body.retentionClass.trim() : null,
    metadata_json: metadataJson,
    created_at: typeof body.createdAt === "string" && body.createdAt.trim() ? body.createdAt.trim() : now,
    uploaded_at: now
  });

  const row = db.prepare("SELECT * FROM run_artifacts WHERE id = ? AND run_id = ?").get(artifactId, runId) as RunArtifactRow;
  const serialized = serializeRunArtifact(req, row);
  insertRunEvent(runId, "artifact.uploaded", {
    artifactId,
    artifactType,
    caseNo: row.case_no,
    action: row.action,
    originalName,
    size: req.file.size
  });
  insertRunLog(runId, "INFO", "Agent evidence artifact uploaded", {
    artifactId,
    artifactType,
    caseNo: row.case_no,
    relativePath: row.relative_path,
    size: req.file.size
  });

  return res.status(201).json({
    runId,
    artifactId,
    downloadUrl: serialized.downloadUrl,
    artifact: serialized
  });
});

router.get("/:id/artifacts", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }
  const items = listRunArtifacts(req.params.id).map((row) => serializeRunArtifact(req, row));
  return res.json({ items });
});

router.get("/:id/artifacts/:artifactId/download", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }
  const row = db
    .prepare("SELECT * FROM run_artifacts WHERE run_id = ? AND id = ?")
    .get(req.params.id, req.params.artifactId) as RunArtifactRow | undefined;
  if (!row) {
    return res.status(404).json({ error: "ARTIFACT_NOT_FOUND" });
  }
  return safeSendRunOutputFile(
    res,
    row.storage_path,
    row.original_name || `${String(run.round_id ?? req.params.id)}_${row.artifact_type}`
  );
});

router.get("/:id/cases", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const items = db
    .prepare("SELECT * FROM run_cases WHERE run_id = ? ORDER BY COALESCE(group_id, ''), created_at ASC")
    .all(req.params.id);
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

router.get("/:id/tool-bridge", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  return res.json({ items: collectToolBridgeStatusItems(req.params.id) });
});

router.get("/:id/summary", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  const caseStatsRows = db
    .prepare("SELECT result_status, COUNT(1) AS count FROM run_cases WHERE run_id = ? GROUP BY result_status")
    .all(req.params.id) as Array<{ result_status: string; count: number }>;
  const caseRowsForClassStats = db
    .prepare("SELECT result_status, fail_category, execution_type, detail_json FROM run_cases WHERE run_id = ?")
    .all(req.params.id) as MdCase[];
  const stepStatsRows = db
    .prepare("SELECT status, COUNT(1) AS count FROM run_case_steps WHERE run_id = ? GROUP BY status")
    .all(req.params.id) as Array<{ status: string; count: number }>;
  const pendingApprovals = db
    .prepare("SELECT COUNT(1) AS count FROM approvals WHERE run_id = ? AND status = 'PENDING'")
    .get(req.params.id) as { count: number };
  const artifactStats = countRunArtifactsByType(req.params.id);

  const caseStats: Record<string, number> = {};
  for (const row of caseStatsRows) caseStats[row.result_status] = row.count;
  const caseStatsByClass: Record<string, number> = {};
  for (const row of caseRowsForClassStats) {
    const status = classifiedCaseStatus(row);
    caseStatsByClass[status] = (caseStatsByClass[status] ?? 0) + 1;
  }
  const stepStats: Record<string, number> = {};
  for (const row of stepStatsRows) stepStats[row.status] = row.count;

  return res.json({
    runId: req.params.id,
    runStatus: run.status,
    domain: run.domain ?? "BI",
    date: run.date ?? null,
    tester: run.tester ?? null,
    location: run.location ?? null,
    featureMain: run.feature_main ?? null,
    featureSub: run.feature_sub ?? null,
    resultXlsxAvailable:
      (typeof run.aggregate_result_xlsx_path === "string" && run.aggregate_result_xlsx_path.trim().length > 0) ||
      (typeof run.result_xlsx_path === "string" && run.result_xlsx_path.trim().length > 0),
    resultIngestedAt: run.result_ingested_at ?? null,
    resultParserVersion: run.result_xlsx_parser_version ?? null,
    logAvailable: typeof run.log_path === "string" && run.log_path.trim().length > 0,
    logUploadedAt: run.log_uploaded_at ?? null,
    timingSummaryAvailable: typeof run.timing_summary_path === "string" && run.timing_summary_path.trim().length > 0,
    timingSummaryUploadedAt: run.timing_summary_uploaded_at ?? null,
    diagnosticSummaryAvailable: typeof run.diagnostic_summary_path === "string" && run.diagnostic_summary_path.trim().length > 0,
    diagnosticSummaryUploadedAt: run.diagnostic_summary_uploaded_at ?? null,
    artifactCount: artifactStats.total,
    screenshotArtifactCount: artifactStats.screenshots,
    artifactManifestAvailable: artifactStats.manifests > 0,
    caseStats,
    caseStatsByClass,
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
        ORDER BY COALESCE(group_id, ''), COALESCE(group_name, ''), case_no
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
    const status = classifiedCaseStatus(c);
    counts[status] = (counts[status] ?? 0) + 1;
  }
  const total = cases.length;
  const content = generateMd(run, cases, bugs, counts, total);

  const filename = `UAT_${safeFilenameSegment(run.round_id)}_${safeFilenameSegment(run.feature_sub)}_${safeFilenameSegment(run.run_name)}_${new Date().toISOString().slice(0, 10)}.md`;

  insertRunLog(req.params.id, "INFO", "Markdown report exported", { filename, totalCases: total, totalBugs: bugs.length });
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
  return res.send(content);
});

router.post("/:id/export-archive-md", (req, res) => {
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
        ORDER BY COALESCE(group_id, ''), COALESCE(group_name, ''), case_no
      `
    )
    .all(req.params.id) as MdCase[];
  const logs = db
    .prepare(
      `
        SELECT *
        FROM run_logs
        WHERE run_id = ?
        ORDER BY rowid ASC
      `
    )
    .all(req.params.id) as RunLogRow[];
  const events = db
    .prepare(
      `
        SELECT *
        FROM run_events
        WHERE run_id = ?
        ORDER BY rowid ASC
      `
    )
    .all(req.params.id) as RunEvent[];
  const artifacts = db
    .prepare(
      `
        SELECT *
        FROM run_artifacts
        WHERE run_id = ?
        ORDER BY uploaded_at ASC
      `
    )
    .all(req.params.id) as RunArtifactRow[];
  const timingSummary = readRunOutputJson(run.timing_summary_path);
  const content = generateArchiveMd(run, cases, logs, events, artifacts, timingSummary);
  const filename = `UAT_ARCHIVE_${safeFilenameSegment(run.round_id)}_${safeFilenameSegment(run.feature_sub)}_${safeFilenameSegment(run.run_name)}_${new Date().toISOString().slice(0, 10)}.md`;

  insertRunLog(req.params.id, "INFO", "Complete archive Markdown exported", {
    filename,
    totalCases: cases.length,
    totalLogs: logs.length,
    totalEvents: events.length,
    totalArtifacts: artifacts.length,
    timingSummaryAvailable: timingSummary !== null
  });
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
        SELECT case_no, case_title, result_status, detail_json
        FROM run_cases
        WHERE run_id = ?
        ORDER BY case_no ASC
      `
    )
    .all(req.params.id) as Array<{ case_no: string; case_title: string; result_status: string | null; detail_json: string | null }>;

  const coreKeys = ["測試目的", "設定條件", "預期行為", "實際行為"];
  const cases = items.map((item) => {
    let parsed: Record<string, unknown> = {};
    let parseError: string | null = null;
    if (item.detail_json) {
      try {
        parsed = JSON.parse(item.detail_json) as Record<string, unknown>;
      } catch (error) {
        parseError = error instanceof Error ? error.message : String(error);
        parsed = {};
      }
    }

    const status = (item.result_status ?? "PENDING").trim().toUpperCase().replace(/\s+/g, "_");
    const statusKeys = status === "BLOCKED" ? ["blocked_reason"] : [];
    const requiredKeys = [...coreKeys, ...statusKeys];
    const missingKeys = requiredKeys.filter((k) => {
      const v = parsed[k];
      return typeof v !== "string" || !v.trim();
    });

    return {
      caseNo: item.case_no,
      caseTitle: item.case_title,
      status,
      healthy: missingKeys.length === 0 && !parseError,
      missingKeys,
      parseError
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
