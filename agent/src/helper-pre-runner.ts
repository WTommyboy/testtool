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

const readLatestReport = (
  runDir: string,
  caseId: string | null,
  action: HelperPlanAction,
  filePath: string
): { status: HelperPreRunActionResult["status"] | null; warnings: string[]; error?: string } => {
  const validation = validateHelperReportArtifact({
    runDir,
    reportPath: filePath,
    expectedCaseId: caseId,
    expectedAction: action.template
  });
  return {
    status: validation.ok ? validation.status : "error",
    warnings: validation.warnings,
    error: validation.error ?? undefined
  };
};

const runHelperAction = async (
  runDir: string,
  caseId: string | null,
  action: HelperPlanAction,
  timing?: RunTimingRecorder
): Promise<HelperPreRunActionResult> => {
  const startedAt = Date.now();
  const timingId = timing?.start(`helper.${action.template}`, "helper_action", {
    actionId: action.id,
    title: action.title
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
  const parts = summary.actions.map((item) => `${item.template}=${item.status}(${formatDuration(item.durationMs)})`);
  return `helper pre-run ${summary.status}: ${summary.executedCount}/${summary.actionCount} actions in ${formatDuration(summary.durationMs)}${parts.length ? `; ${parts.join(", ")}` : ""}`;
};
