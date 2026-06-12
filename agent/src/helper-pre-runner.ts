import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { helperExecutorPath, type HelperExecutionPlan, type HelperPlanAction } from "./helper-execution-plan";
import { formatDuration, type RunTimingRecorder } from "./timing";

export type HelperPreRunActionResult = {
  actionId: string;
  template: string;
  title: string;
  status: "ok" | "blocked" | "requires_approval" | "not_implemented" | "error" | "skipped";
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdoutExcerpt: string;
  stderrExcerpt: string;
  reportPath: string | null;
  warnings: string[];
  substepCount?: number;
  slowWaits?: Array<Record<string, unknown>>;
  evidenceDecision?: Record<string, unknown>;
  error?: string;
};

export type HelperPreRunSummary = {
  schemaVersion: "helper-pre-run-v1";
  generatedAt: string;
  runDir: string;
  caseId: string | null;
  status: "ok" | "partial" | "skipped";
  skippedReason: string | null;
  actionCount: number;
  executedCount: number;
  durationMs: number;
  actions: HelperPreRunActionResult[];
};

export type AutoApprovedToolBridgeResponseLike = {
  requestId: string | null;
  request: unknown;
  raw?: string;
  note?: string;
};

export type HelperContinuationSummary = {
  schemaVersion: "helper-continuation-v1";
  generatedAt: string;
  runDir: string;
  caseId: string | null;
  status: "ok" | "partial" | "skipped";
  skippedReason: string | null;
  actionCount: number;
  executedCount: number;
  durationMs: number;
  autoResponseCount: number;
  actions: HelperPreRunActionResult[];
};

export type PendingHelperToolBridgeRequest = {
  actionId: string;
  template: string;
  title: string;
  requestId: string;
  request: Record<string, unknown>;
  raw: string;
};

const readJsonIfExists = <T>(filePath: string): T | null => {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
};

const consistencyStatus = (runDir: string): "ok" | "warning" | "error" | "missing" => {
  const paths = [
    path.join(runDir, "input", "test-package-consistency.json"),
    path.join(runDir, "input", "document-consistency.json")
  ];
  let worst: "ok" | "warning" | "error" | "missing" = "ok";
  for (const filePath of paths) {
    const parsed = readJsonIfExists<{ status?: unknown }>(filePath);
    const status = parsed?.status;
    if (status === "error") return "error";
    if (status === "warning" && worst === "ok") worst = "warning";
    if (!parsed && worst === "ok") worst = "missing";
  }
  return worst;
};

const capabilityGateAllowsHelperPreRun = (runDir: string): { allowed: boolean; reason: string | null } => {
  const gate = readJsonIfExists<{ helperPreRunAllowed?: unknown; blockingReason?: unknown; supportStatus?: unknown }>(
    path.join(runDir, "input", "capability-gate.json")
  );
  if (!gate) return { allowed: true, reason: null };
  if (gate.helperPreRunAllowed === false) {
    const reason = typeof gate.blockingReason === "string" && gate.blockingReason.trim()
      ? gate.blockingReason.trim()
      : `CAPABILITY_GATE_${String(gate.supportStatus ?? "SKIPPED")}`;
    return { allowed: false, reason };
  }
  return { allowed: true, reason: null };
};

const safeActions = (plan: HelperExecutionPlan): HelperPlanAction[] => {
  const result: HelperPlanAction[] = [];
  for (const action of plan.actions) {
    if (action.requiresToolBridge || action.optional) break;
    result.push(action);
  }
  return result;
};

const latestReportPath = (runDir: string, caseId: string | null, template: string): string => {
  const safeCase = (caseId ?? "unknown-case").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown-case";
  const safeAction = template.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "helper-action";
  return path.join(runDir, "output", "helper-artifacts", safeCase, `${safeAction}-latest.json`);
};

const sanitizeId = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "helper-action";

type HelperReportArtifactValidation = {
  ok: boolean;
  status: HelperPreRunActionResult["status"] | null;
  warnings: string[];
  error: string | null;
};

const isValidHelperStatus = (value: unknown): value is Exclude<HelperPreRunActionResult["status"], "skipped"> =>
  value === "ok" || value === "blocked" || value === "requires_approval" || value === "not_implemented" || value === "error";

const getString = (value: Record<string, unknown> | null, key: string): string | null => {
  const item = value?.[key];
  return typeof item === "string" && item.trim() ? item.trim() : null;
};

const parseIsoMs = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

export const validateHelperReportArtifact = (options: {
  runDir: string;
  reportPath: string;
  expectedCaseId: string | null;
  expectedAction: string;
}): HelperReportArtifactValidation => {
  const parsed = readJsonIfExists<Record<string, unknown>>(options.reportPath);
  if (!parsed) {
    return {
      ok: false,
      status: null,
      warnings: ["HELPER_REPORT_MISSING"],
      error: "HELPER_REPORT_MISSING"
    };
  }
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.filter((item): item is string => typeof item === "string") : [];
  const errors: string[] = [];
  const status = parsed.status;
  const expectedRunId = path.basename(path.resolve(options.runDir));
  const expectedCaseId = options.expectedCaseId ?? "";
  const evidenceMetadata = parsed.evidenceMetadata && typeof parsed.evidenceMetadata === "object" && !Array.isArray(parsed.evidenceMetadata)
    ? parsed.evidenceMetadata as Record<string, unknown>
    : null;
  const state = readJsonIfExists<Record<string, unknown>>(path.join(options.runDir, "state.json"));
  const runStartedAtMs = parseIsoMs(state?.started_at);
  const startedAtMs = parseIsoMs(parsed.startedAt);
  const endedAtMs = parseIsoMs(parsed.endedAt);

  if (parsed.schemaVersion !== "bi-ui-helper-report-v1") errors.push("schemaVersion");
  if (!isValidHelperStatus(status)) errors.push("status");
  if (parsed.helperCanJudgeResult !== false) errors.push("helperCanJudgeResult");
  if (parsed.runId !== expectedRunId) errors.push("runId");
  if (parsed.caseId !== expectedCaseId) errors.push("caseId");
  if (parsed.action !== options.expectedAction) errors.push("action");
  if (!startedAtMs) errors.push("startedAt");
  if (!endedAtMs) errors.push("endedAt");
  if (startedAtMs && endedAtMs && endedAtMs < startedAtMs) errors.push("timestamp_order");
  if (runStartedAtMs && startedAtMs && startedAtMs < runStartedAtMs - 5000) errors.push("stale_startedAt_before_run");
  if (endedAtMs && endedAtMs > Date.now() + 60_000) errors.push("endedAt_in_future");
  if (getString(evidenceMetadata, "source") !== "mac-agent-bi-ui-helper") errors.push("evidenceMetadata.source");
  if (evidenceMetadata?.currentRunEvidence !== true) errors.push("evidenceMetadata.currentRunEvidence");
  if (getString(evidenceMetadata, "runId") !== expectedRunId) errors.push("evidenceMetadata.runId");
  if (getString(evidenceMetadata, "caseId") !== expectedCaseId) errors.push("evidenceMetadata.caseId");
  if (getString(evidenceMetadata, "action") !== options.expectedAction) errors.push("evidenceMetadata.action");

  return {
    ok: errors.length === 0,
    status: isValidHelperStatus(status) ? status : null,
    warnings: errors.length === 0 ? warnings : [...warnings, `HELPER_REPORT_VALIDATION_FAILED:${errors.join(",")}`],
    error: errors.length === 0 ? null : `HELPER_REPORT_VALIDATION_FAILED:${errors.join(",")}`
  };
};

const reportArray = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];

const reportRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const readLatestReport = (
  runDir: string,
  caseId: string | null,
  action: HelperPlanAction,
  filePath: string
): {
  status: HelperPreRunActionResult["status"] | null;
  warnings: string[];
  error?: string;
  substepCount?: number;
  slowWaits?: Array<Record<string, unknown>>;
  evidenceDecision?: Record<string, unknown>;
} => {
  const validation = validateHelperReportArtifact({
    runDir,
    reportPath: filePath,
    expectedCaseId: caseId,
    expectedAction: action.template
  });
  const parsed = readJsonIfExists<Record<string, unknown>>(filePath);
  const substeps = reportArray(parsed?.substeps);
  const slowWaits = reportArray(parsed?.slowWaits);
  const evidenceDecision = reportRecord(parsed?.evidenceDecision) ?? undefined;
  return {
    status: validation.ok ? validation.status : "error",
    warnings: validation.warnings,
    substepCount: substeps.length,
    slowWaits: slowWaits.slice(0, 12),
    evidenceDecision,
    error: validation.error ?? undefined
  };
};

const runHelperAction = async (
  runDir: string,
  caseId: string | null,
  action: HelperPlanAction,
  timing?: RunTimingRecorder,
  options: { approvedToolRequestId?: string | null } = {}
): Promise<HelperPreRunActionResult> => {
  const startedAt = Date.now();
  const timingId = timing?.start(`helper.${action.template}`, "helper_action", {
    actionId: action.id,
    title: action.title,
    continuation: Boolean(options.approvedToolRequestId)
  });
  const executor = helperExecutorPath();
  const reportPath = latestReportPath(runDir, caseId, action.template);
  const args = [
    executor,
    "--run-dir",
    runDir,
    "--case",
    caseId ?? "",
    "--action",
    action.template,
    "--params-json",
    JSON.stringify(action.params ?? {})
  ];
  if (options.approvedToolRequestId) {
    args.push("--approved-tool-request-id", options.approvedToolRequestId);
  }

  return await new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: runDir,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    });
    child.on("close", (exitCode, signal) => {
      const durationMs = Date.now() - startedAt;
      const latestReport = readLatestReport(runDir, caseId, action, reportPath);
      const status = latestReport.status ?? (exitCode === 0 ? "ok" : "error");
      timing?.end(timingId ?? "", status === "ok" ? "ok" : status === "requires_approval" ? "requires_approval" : "failed", {
        exitCode,
        signal,
        status,
        reportPath,
        durationMs
      });
      resolve({
        actionId: action.id,
        template: action.template,
        title: action.title,
        status,
        durationMs,
        exitCode,
        signal,
        stdoutExcerpt: stdout.slice(-2000),
        stderrExcerpt: stderr.slice(-2000),
        reportPath: fs.existsSync(reportPath) ? reportPath : null,
        warnings: latestReport.warnings,
        substepCount: latestReport.substepCount,
        slowWaits: latestReport.slowWaits,
        evidenceDecision: latestReport.evidenceDecision,
        error: latestReport.error
      });
    });
    child.on("error", (error) => {
      const durationMs = Date.now() - startedAt;
      timing?.end(timingId ?? "", "failed", { error: error.message, durationMs });
      resolve({
        actionId: action.id,
        template: action.template,
        title: action.title,
        status: "error",
        durationMs,
        exitCode: null,
        signal: null,
        stdoutExcerpt: stdout.slice(-2000),
        stderrExcerpt: stderr.slice(-2000),
        reportPath: null,
        warnings: [],
        error: error.message
      });
    });
  });
};

const writeSummary = (runDir: string, summary: HelperPreRunSummary): string => {
  const filePath = path.join(runDir, "output", "helper-pre-run-summary.json");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(summary, null, 2)}\n`);
  return filePath;
};

const writeContinuationSummary = (runDir: string, summary: HelperContinuationSummary): string => {
  const filePath = path.join(runDir, "output", "helper-continuation-summary.json");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(summary, null, 2)}\n`);
  fs.appendFileSync(path.join(runDir, "output", "helper-continuation-summary.jsonl"), `${JSON.stringify(summary)}\n`);
  return filePath;
};

const requestRecord = (request: unknown): Record<string, unknown> | null => {
  return request && typeof request === "object" && !Array.isArray(request) ? (request as Record<string, unknown>) : null;
};

const requestText = (response: AutoApprovedToolBridgeResponseLike): string => {
  const request = requestRecord(response.request);
  return [
    request?.type,
    request?.request_id,
    request?.case,
    request?.caseNo,
    request?.action,
    request?.proposed_action,
    request?.reason,
    response.note,
    response.raw
  ]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .join("\n");
};

const responseMatchesCase = (response: AutoApprovedToolBridgeResponseLike, caseId: string | null): boolean => {
  if (!caseId) return false;
  const request = requestRecord(response.request);
  const explicitCase = request?.case ?? request?.caseNo ?? request?.case_no;
  if (typeof explicitCase === "string" && explicitCase.trim()) return explicitCase.trim() === caseId;
  return requestText(response).includes(caseId);
};

const findApprovalForAction = (
  action: HelperPlanAction,
  caseId: string | null,
  responses: AutoApprovedToolBridgeResponseLike[]
): AutoApprovedToolBridgeResponseLike | null => {
  return (
    responses.find((response) => {
      const request = requestRecord(response.request);
      if (request?.type !== "irreversible_operation") return false;
      if (!responseMatchesCase(response, caseId)) return false;
      const text = requestText(response);
      if (text.includes(action.template) || text.includes(action.title)) return true;
      if (action.template === "collage.saveReport" && /儲存|save/i.test(text)) return true;
      if (action.template === "collage.deleteTemporaryReport" && /刪除|delete|remove/i.test(text)) return true;
      return false;
    }) ?? null
  );
};

const existingActionStatus = (
  runDir: string,
  caseId: string | null,
  action: HelperPlanAction
): { status: HelperPreRunActionResult["status"] | null; warnings: string[]; error?: string } => {
  const reportPath = latestReportPath(runDir, caseId, action.template);
  if (!fs.existsSync(reportPath)) return { status: null, warnings: [] };
  return readLatestReport(runDir, caseId, action, reportPath);
};

const buildPendingHelperToolBridgeRequest = (
  runDir: string,
  caseId: string,
  action: HelperPlanAction
): PendingHelperToolBridgeRequest => {
  const runId = path.basename(path.resolve(runDir));
  const requestId = `${runId}-${caseId}-${sanitizeId(action.template)}-helper-plan`;
  const request = {
    type: "irreversible_operation",
    request_id: requestId,
    case: caseId,
    action: `Agent helper continuation: ${action.title}`,
    reason: `Helper plan completed prior safe actions and the next required action ${action.template} needs Tool Bridge authorization before a BI native dialog or irreversible operation.`,
    proposed_action: `Authorize Mac Agent helper to run ${action.template} for current case ${caseId} only; handle only known BI save/overwrite/delete dialogs and stop on unknown dialogs.`
  };
  return {
    actionId: action.id,
    template: action.template,
    title: action.title,
    requestId,
    request,
    raw: JSON.stringify(request)
  };
};

export const collectPendingHelperToolBridgeRequests = (runDir: string): PendingHelperToolBridgeRequest[] => {
  const planPath = path.join(runDir, "input", "helper-execution-plan.json");
  const plan = readJsonIfExists<HelperExecutionPlan>(planPath);
  const consistency = consistencyStatus(runDir);
  const capabilityGate = capabilityGateAllowsHelperPreRun(runDir);
  if (!plan || !plan.caseId || consistency === "error" || !capabilityGate.allowed) return [];

  for (const action of plan.actions) {
    if (action.optional) break;
    const existing = existingActionStatus(runDir, plan.caseId, action);
    if (existing.status === "ok") continue;
    if (existing.status && existing.status !== "requires_approval") break;
    if (action.requiresToolBridge) {
      return [buildPendingHelperToolBridgeRequest(runDir, plan.caseId, action)];
    }
    break;
  }
  return [];
};

export const runHelperContinuationAfterApprovals = async (
  runDir: string,
  autoResponses: AutoApprovedToolBridgeResponseLike[],
  timing?: RunTimingRecorder
): Promise<HelperContinuationSummary> => {
  const startedAt = Date.now();
  const planPath = path.join(runDir, "input", "helper-execution-plan.json");
  const plan = readJsonIfExists<HelperExecutionPlan>(planPath);
  const consistency = consistencyStatus(runDir);
  const capabilityGate = capabilityGateAllowsHelperPreRun(runDir);
  const skippedReason = !plan
    ? "HELPER_EXECUTION_PLAN_MISSING"
    : autoResponses.length === 0
      ? "AUTO_TOOL_RESPONSES_EMPTY"
      : consistency === "error"
        ? "CONSISTENCY_GATE_ERROR"
        : !capabilityGate.allowed
          ? `CAPABILITY_GATE_SKIPPED_HELPER:${capabilityGate.reason ?? "helper continuation not allowed"}`
          : null;

  if (!plan || skippedReason) {
    const summary: HelperContinuationSummary = {
      schemaVersion: "helper-continuation-v1",
      generatedAt: new Date().toISOString(),
      runDir,
      caseId: plan?.caseId ?? null,
      status: "skipped",
      skippedReason,
      actionCount: 0,
      executedCount: 0,
      durationMs: Date.now() - startedAt,
      autoResponseCount: autoResponses.length,
      actions: []
    };
    writeContinuationSummary(runDir, summary);
    return summary;
  }

  const results: HelperPreRunActionResult[] = [];
  let blockedByExistingAction = false;
  let missingPrerequisiteBeforeApproval = false;
  for (const action of plan.actions) {
    if (action.optional) break;
    const existing = existingActionStatus(runDir, plan.caseId, action);
    if (existing.status === "ok") continue;
    if (existing.status && existing.status !== "requires_approval") {
      blockedByExistingAction = true;
      break;
    }

    if (action.requiresToolBridge) {
      const approval = findApprovalForAction(action, plan.caseId, autoResponses);
      if (!approval) break;
      const approvedToolRequestId = approval.requestId ?? `${plan.caseId ?? "unknown-case"}-${sanitizeId(action.template)}-auto`;
      const result = await runHelperAction(runDir, plan.caseId, action, timing, { approvedToolRequestId });
      results.push(result);
      if (result.status !== "ok") break;
      continue;
    }

    if (results.length === 0) {
      missingPrerequisiteBeforeApproval = true;
      break;
    }
    const result = await runHelperAction(runDir, plan.caseId, action, timing);
    results.push(result);
    if (result.status !== "ok" || result.warnings.some((warning) => /NOT_FULLY_AUTOMATED|REQUIRES_CODEX|MANUAL/i.test(warning))) {
      break;
    }
  }

  const durationMs = Date.now() - startedAt;
  const status: HelperContinuationSummary["status"] =
    results.length > 0 && results.every((item) => item.status === "ok") && !blockedByExistingAction ? "ok" : results.length > 0 ? "partial" : "skipped";
  const summary: HelperContinuationSummary = {
    schemaVersion: "helper-continuation-v1",
    generatedAt: new Date().toISOString(),
    runDir,
    caseId: plan.caseId,
    status,
    skippedReason: status === "skipped"
      ? blockedByExistingAction
        ? "PREVIOUS_HELPER_ACTION_NOT_OK"
        : missingPrerequisiteBeforeApproval
          ? "PREVIOUS_HELPER_ACTION_MISSING_BEFORE_APPROVAL"
          : "NO_MATCHING_PENDING_HELPER_ACTION"
      : null,
    actionCount: plan.actions.length,
    executedCount: results.length,
    durationMs,
    autoResponseCount: autoResponses.length,
    actions: results
  };
  writeContinuationSummary(runDir, summary);
  return summary;
};

export const runSafeHelperActions = async (
  runDir: string,
  timing?: RunTimingRecorder
): Promise<HelperPreRunSummary> => {
  const startedAt = Date.now();
  const planPath = path.join(runDir, "input", "helper-execution-plan.json");
  const plan = readJsonIfExists<HelperExecutionPlan>(planPath);
  const status = consistencyStatus(runDir);
  const capabilityGate = capabilityGateAllowsHelperPreRun(runDir);
  const skippedReason = !plan
    ? "HELPER_EXECUTION_PLAN_MISSING"
    : status === "error"
      ? "CONSISTENCY_GATE_ERROR"
      : !capabilityGate.allowed
        ? `CAPABILITY_GATE_SKIPPED_HELPER:${capabilityGate.reason ?? "helper pre-run not allowed"}`
      : null;

  if (!plan || skippedReason) {
    const summary: HelperPreRunSummary = {
      schemaVersion: "helper-pre-run-v1",
      generatedAt: new Date().toISOString(),
      runDir,
      caseId: plan?.caseId ?? null,
      status: "skipped",
      skippedReason,
      actionCount: 0,
      executedCount: 0,
      durationMs: Date.now() - startedAt,
      actions: []
    };
    writeSummary(runDir, summary);
    return summary;
  }

  const actions = safeActions(plan);
  const results: HelperPreRunActionResult[] = [];
  for (const action of actions) {
    const result = await runHelperAction(runDir, plan.caseId, action, timing);
    results.push(result);
    if (result.status !== "ok" || result.warnings.some((warning) => /NOT_FULLY_AUTOMATED|REQUIRES_CODEX|MANUAL/i.test(warning))) {
      break;
    }
  }

  const durationMs = Date.now() - startedAt;
  const summary: HelperPreRunSummary = {
    schemaVersion: "helper-pre-run-v1",
    generatedAt: new Date().toISOString(),
    runDir,
    caseId: plan.caseId,
    status: results.length === actions.length && results.every((item) => item.status === "ok") ? "ok" : "partial",
    skippedReason: null,
    actionCount: actions.length,
    executedCount: results.length,
    durationMs,
    actions: results
  };
  writeSummary(runDir, summary);
  return summary;
};

export const summarizeHelperPreRun = (summary: HelperPreRunSummary): string => {
  if (summary.status === "skipped") return `helper pre-run skipped: ${summary.skippedReason ?? "unknown"}`;
  const parts = summary.actions.map((item) => {
    const slowCount = item.slowWaits?.length ?? 0;
    const suffix = slowCount > 0 ? `,slow=${slowCount}` : "";
    return `${item.template}=${item.status}(${formatDuration(item.durationMs)}${suffix})`;
  });
  return `helper pre-run ${summary.status}: ${summary.executedCount}/${summary.actionCount} actions in ${formatDuration(summary.durationMs)}${parts.length ? `; ${parts.join(", ")}` : ""}`;
};

export const summarizeHelperContinuation = (summary: HelperContinuationSummary): string => {
  if (summary.status === "skipped") return `helper continuation skipped: ${summary.skippedReason ?? "unknown"}`;
  const parts = summary.actions.map((item) => {
    const slowCount = item.slowWaits?.length ?? 0;
    const suffix = slowCount > 0 ? `,slow=${slowCount}` : "";
    return `${item.template}=${item.status}(${formatDuration(item.durationMs)}${suffix})`;
  });
  return `helper continuation ${summary.status}: ${summary.executedCount}/${summary.actionCount} actions in ${formatDuration(summary.durationMs)}${parts.length ? `; ${parts.join(", ")}` : ""}`;
};
