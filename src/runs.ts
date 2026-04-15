import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "./db";
import { requestRunCancel, startRun } from "./runner";
import { parseTestcaseXlsx } from "./xlsx-parser";

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
  devUrl: z.string().url()
});

const createCasesSchema = z.object({
  items: z
    .array(
      z.object({
        caseNo: z.string().min(1),
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

const getRun = (runId: string): Record<string, unknown> | undefined =>
  db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;

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
        id, run_id, case_no, case_title, execution_type, result_status, detail_json, created_at, updated_at
      ) VALUES (
        @id, @run_id, @case_no, @case_title, @execution_type, @result_status, @detail_json, @created_at, @updated_at
      )
      ON CONFLICT(run_id, case_no) DO UPDATE SET
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

router.post("/", (req, res) => {
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
        id, round_id, location, feature_main, feature_sub, run_name, dev_url, status, created_at, updated_at
      ) VALUES (
        @id, @round_id, @location, @feature_main, @feature_sub, @run_name, @dev_url, @status, @created_at, @updated_at
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
    status: "READY",
    created_at: now,
    updated_at: now
  });

  insertRunLog(runId, "INFO", "Run created", payload);

  return res.status(201).json({
    id: runId,
    status: "READY"
  });
});

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
          run_id: req.params.id,
          case_no: item.caseNo,
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
          run_id: req.params.id,
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

  const now = nowIso();
  db.prepare("UPDATE runs SET status = ?, updated_at = ? WHERE id = ?").run(targetStatus, now, req.params.id);
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

router.post("/:id/start", (req, res) => {
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
  db.prepare("UPDATE runs SET status = ?, updated_at = ? WHERE id = ?").run("CANCELLED", nowIso(), req.params.id);
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

export default router;
