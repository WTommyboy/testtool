import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { config } from "./config";
import { db } from "./db";
import { requestRunCancel, startRun } from "./runner";
import { checkPlaywrightHealth } from "./playwright-health";
import { parseTestcaseXlsx, type ParsedCase, type ParsedStep } from "./xlsx-parser";

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
  stepNo: z.number().int().positive(),
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

const nowIso = (): string => new Date().toISOString();
const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

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

const setRunStatusWithMeta = (runId: string, status: string): void => {
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
  const tester = `Playwright Runner${manualFillers.length > 0 ? ` + ${manualFillers.join(", ")}` : ""}`;

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

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadRoot),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
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
    { name: "testcaseMd", maxCount: 1 },
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
        id, round_id, location, feature_main, feature_sub, run_name, dev_url, execution_mode, status, created_at, updated_at
      ) VALUES (
        @id, @round_id, @location, @feature_main, @feature_sub, @run_name, @dev_url, @execution_mode, @status, @created_at, @updated_at
      )
      `
    ).run({
      id: runId,
      round_id: payload.roundId,
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

    const files = req.files as
      | {
          testcaseXlsx?: Express.Multer.File[];
          testcaseMd?: Express.Multer.File[];
          referenceCsv?: Express.Multer.File[];
        }
      | undefined;
    const hasUploadFiles = Boolean(files?.testcaseXlsx?.[0] || files?.testcaseMd?.[0]);
    const sourceMode =
      body.sourceMode === "upload" || body.sourceMode === "conversation"
        ? body.sourceMode
        : hasUploadFiles
          ? "upload"
          : "conversation";

    if (sourceMode === "upload") {
      const testcaseXlsx = files?.testcaseXlsx?.[0];
      const testcaseMd = files?.testcaseMd?.[0];
      const referenceCsv = files?.referenceCsv?.[0];

      if (!testcaseXlsx || !testcaseMd) {
        return res.status(400).json({
          error: "UPLOAD_FILES_REQUIRED",
          message: "請上傳 xlsx 和 md 檔案"
        });
      }

      try {
        const imported = await parseTestcaseXlsx(testcaseXlsx.path);
        const { manualCases } = upsertImportedTestcase(runId, imported);
        insertRunLog(runId, "INFO", "XLSX+MD uploaded and parsed", {
          sourceMode,
          testcaseXlsx: testcaseXlsx.path,
          testcaseMd: testcaseMd.path,
          referenceCsv: referenceCsv?.path ?? null,
          importedCases: imported.cases.length,
          importedSteps: imported.steps.length,
          manualCases
        });
      } catch (error) {
        db.prepare("DELETE FROM runs WHERE id = ?").run(runId);
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

router.post("/:id/cancel", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  requestRunCancel(req.params.id);
  setRunStatusWithMeta(req.params.id, "CANCELLED");
  insertRunLog(req.params.id, "WARN", "Run cancel requested");

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

  db.prepare("UPDATE runs SET status = 'READY', updated_at = ? WHERE id = ?").run(now, req.params.id);
  insertRunLog(req.params.id, "INFO", "Approval resolved", {
    caseNo: parsed.data.caseNo,
    stepNo: parsed.data.stepNo,
    action: parsed.data.action,
    by: parsed.data.resolvedBy
  });

  return res.json({
    runId: req.params.id,
    caseNo: parsed.data.caseNo,
    stepNo: parsed.data.stepNo,
    action: parsed.data.action,
    runStatus: "READY"
  });
});

router.get("/:id", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "RUN_NOT_FOUND" });
  }

  return res.json(run);
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

  const limit = Math.min(Number(req.query.limit ?? 200), 1000);
  const items = db
    .prepare("SELECT * FROM run_logs WHERE run_id = ? ORDER BY created_at ASC LIMIT ?")
    .all(req.params.id, limit);
  return res.json({ items });
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
