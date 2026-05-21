import fs from "node:fs";
import path from "node:path";
import { readFirstInputCase, writeAgentResultXlsx } from "./result-writer";
import type { HelperPreRunActionResult, HelperPreRunSummary } from "./helper-pre-runner";

type RuntimeResultLike = {
  assistantText?: string;
  exitCode: number | null;
  signal: string | null;
  stderr?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
};

export type RuntimeContainmentReport = {
  schemaVersion: "codex-runtime-containment-result-v1";
  generatedAt: string;
  status: "written" | "skipped";
  reason?: string;
  runId: string;
  caseNo: string | null;
  resultXlsxPath?: string;
  failCategory?: string;
  helperPreRunSummaryPath?: string;
};

export type HelperBrowserSessionContainmentReport = {
  schemaVersion: "helper-browser-session-containment-result-v1";
  generatedAt: string;
  status: "written" | "skipped";
  reason?: string;
  runId: string;
  caseNo: string | null;
  resultXlsxPath?: string;
  failCategory?: string;
  helperPreRunSummaryPath?: string;
  blockingActions?: Array<{
    actionId: string;
    template: string;
    status: string;
    reportPath: string | null;
  }>;
};

const readJsonIfExists = <T>(filePath: string): T | null => {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
};

const consistencyGateHasErrors = (runDir: string): boolean => {
  const paths = [
    path.join(runDir, "input", "test-package-consistency.json"),
    path.join(runDir, "input", "document-consistency.json")
  ];
  return paths.some((filePath) => {
    const parsed = readJsonIfExists<{ status?: unknown; issues?: unknown }>(filePath);
    if (!parsed) return false;
    if (String(parsed.status ?? "").toLowerCase() === "error") return true;
    const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
    return issues.some((issue) => {
      if (!issue || typeof issue !== "object" || Array.isArray(issue)) return false;
      return String((issue as { severity?: unknown }).severity ?? "").toLowerCase() === "error";
    });
  });
};

const helperReportsFromSummary = (summary: Record<string, unknown> | null): string[] => {
  const actions = Array.isArray(summary?.actions) ? summary.actions : [];
  return actions.flatMap((action) => {
    if (!action || typeof action !== "object" || Array.isArray(action)) return [];
    const reportPath = (action as { reportPath?: unknown }).reportPath;
    return typeof reportPath === "string" && reportPath.trim() ? [reportPath.trim()] : [];
  });
};

const readTextIfExists = (filePath: string | null | undefined, maxBytes = 20_000): string => {
  if (!filePath || !fs.existsSync(filePath)) return "";
  try {
    const buffer = fs.readFileSync(filePath);
    return buffer.subarray(0, maxBytes).toString("utf8");
  } catch {
    return "";
  }
};

export const isBrowserTargetClosedText = (text: string): boolean => {
  if (!text.trim()) return false;
  return [
    /Target page, context or browser has been closed/i,
    /\bTarget closed\b/i,
    /\bbrowser (?:has been )?closed\b/i,
    /\bcontext (?:has been )?closed\b/i,
    /\bpage (?:has been )?closed\b/i,
    /BROWSER_SESSION_LEASE_MISSING/i,
    /BROWSER_SESSION_TARGET_MISSING/i,
    /BROWSER_SESSION_STALE/i
  ].some((pattern) => pattern.test(text));
};

const helperActionText = (
  action: Partial<HelperPreRunActionResult>,
  options: { readReport?: boolean } = {}
): string => [
  action.status,
  action.error,
  action.stdoutExcerpt,
  action.stderrExcerpt,
  ...(Array.isArray(action.warnings) ? action.warnings : []),
  options.readReport ? readTextIfExists(action.reportPath) : ""
]
  .filter((item): item is string => typeof item === "string" && item.length > 0)
  .join("\n");

const helperActionHasBrowserTargetClosed = (
  action: Partial<HelperPreRunActionResult>,
  options: { readReport?: boolean } = {}
): boolean => {
  const status = String(action.status ?? "").toLowerCase();
  if (status !== "blocked" && status !== "error") return false;
  return isBrowserTargetClosedText(helperActionText(action, options));
};

export const helperSummaryHasBrowserTargetClosed = (
  summary: Pick<HelperPreRunSummary, "actions"> | null | undefined,
  options: { readReports?: boolean } = {}
): boolean => {
  const actions = Array.isArray(summary?.actions) ? summary.actions : [];
  return actions.some((action) => helperActionHasBrowserTargetClosed(action, { readReport: options.readReports ?? true }));
};

const helperBrowserTargetClosedActions = (
  summary: HelperPreRunSummary | Record<string, unknown> | null
): HelperPreRunActionResult[] => {
  const actions = Array.isArray(summary?.actions) ? summary.actions : [];
  return actions.filter((action): action is HelperPreRunActionResult => {
    if (!action || typeof action !== "object" || Array.isArray(action)) return false;
    return helperActionHasBrowserTargetClosed(action as Partial<HelperPreRunActionResult>, { readReport: true });
  });
};

const helperSummaryHasCurrentRunEvidence = (
  summary: Record<string, unknown> | null,
  caseNo: string | null
): boolean => {
  if (!summary) return false;
  if (caseNo && typeof summary.caseId === "string" && summary.caseId.trim() && summary.caseId.trim() !== caseNo) {
    return false;
  }
  const status = String(summary.status ?? "").toLowerCase();
  const executedCount = typeof summary.executedCount === "number" ? summary.executedCount : 0;
  return executedCount > 0 && (status === "ok" || status === "partial");
};

const compactCodexFailure = (result: RuntimeResultLike): Record<string, unknown> => ({
  exitCode: result.exitCode,
  signal: result.signal,
  stderr: result.stderr ? result.stderr.slice(0, 2000) : "",
  assistantText: result.assistantText ? result.assistantText.slice(0, 2000) : "",
  startedAt: result.startedAt ?? null,
  endedAt: result.endedAt ?? null,
  durationMs: result.durationMs ?? null
});

export const writeCodexRuntimeContainmentResultIfNeeded = async (input: {
  runId: string;
  roundId: string;
  runDir: string;
  xlsxPath?: string;
  currentCaseNo: string | null;
  result: RuntimeResultLike;
  failCategory?: string;
  containmentKind?: "runtime_failure" | "no_result_after_success";
}): Promise<RuntimeContainmentReport> => {
  const generatedAt = new Date().toISOString();
  const reportPath = path.join(input.runDir, "output", "runtime-containment-result.json");
  const resultXlsxPath = path.join(input.runDir, "output", "result.xlsx");
  const writeReport = (report: RuntimeContainmentReport): RuntimeContainmentReport => {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  };

  if (fs.existsSync(resultXlsxPath)) {
    return writeReport({
      schemaVersion: "codex-runtime-containment-result-v1",
      generatedAt,
      status: "skipped",
      reason: "RESULT_XLSX_ALREADY_EXISTS",
      runId: input.runId,
      caseNo: input.currentCaseNo,
      resultXlsxPath
    });
  }

  const containmentKind = input.containmentKind ?? "runtime_failure";
  if (input.result.exitCode === 0 && containmentKind !== "no_result_after_success") {
    return writeReport({
      schemaVersion: "codex-runtime-containment-result-v1",
      generatedAt,
      status: "skipped",
      reason: "CODEX_EXIT_NOT_FAILED",
      runId: input.runId,
      caseNo: input.currentCaseNo
    });
  }

  if (consistencyGateHasErrors(input.runDir)) {
    return writeReport({
      schemaVersion: "codex-runtime-containment-result-v1",
      generatedAt,
      status: "skipped",
      reason: "CONSISTENCY_GATE_ERROR_REQUIRES_PM_DECISION",
      runId: input.runId,
      caseNo: input.currentCaseNo
    });
  }

  const helperPreRunSummaryPath = path.join(input.runDir, "output", "helper-pre-run-summary.json");
  const helperPreRunSummary = readJsonIfExists<Record<string, unknown>>(helperPreRunSummaryPath);
  if (!helperSummaryHasCurrentRunEvidence(helperPreRunSummary, input.currentCaseNo)) {
    return writeReport({
      schemaVersion: "codex-runtime-containment-result-v1",
      generatedAt,
      status: "skipped",
      reason: "NO_CURRENT_RUN_HELPER_EVIDENCE_TO_CONTAIN",
      runId: input.runId,
      caseNo: input.currentCaseNo,
      helperPreRunSummaryPath
    });
  }

  const sourceCase = await readFirstInputCase(input.xlsxPath, input.currentCaseNo) ?? (
    input.currentCaseNo
      ? {
          groupId: null,
          groupName: null,
          caseNo: input.currentCaseNo,
          caseTitle: null,
          testType: null,
          executionMethod: null
        }
      : null
  );
  if (!sourceCase) {
    return writeReport({
      schemaVersion: "codex-runtime-containment-result-v1",
      generatedAt,
      status: "skipped",
      reason: "CURRENT_CASE_UNAVAILABLE",
      runId: input.runId,
      caseNo: input.currentCaseNo,
      helperPreRunSummaryPath
    });
  }

  const failCategory = input.failCategory ?? (
    containmentKind === "no_result_after_success"
      ? "CODEX_NO_RESULT_XLSX"
      : "CODEX_RUNTIME_RESULT_WRITE_FAILED"
  );
  const expectedBehavior = containmentKind === "no_result_after_success"
    ? "Codex 應讀取 current-run helper/browser evidence，完成 case 判定並寫出 output/result.xlsx；若 Codex 無法完成可信判定，Agent 應隔離為單題 BLOCKED，不讓整輪停止。"
    : "Codex runtime 應讀取 current-run helper/browser evidence，完成 case 判定並寫出 output/result.xlsx，且不讓單題 runtime failure 中斷整輪。";
  const actualBehavior = containmentKind === "no_result_after_success"
    ? "Helper pre-run 已產生 current-run evidence，但 Codex turn 結束後沒有可信 output/result.xlsx；Agent 以單題 containment 結果保留 evidence 並讓整輪可繼續。"
    : "Helper pre-run 已產生 current-run evidence，但 Codex subprocess 在判定或寫回 result.xlsx 前失敗；Agent 以單題 containment 結果保留 evidence 並讓整輪可繼續。";
  const blockedReason = containmentKind === "no_result_after_success"
    ? `${failCategory}: Codex completed without a trusted output/result.xlsx after current-run helper evidence was collected.`
    : `${failCategory}: Codex failed after helper evidence collection and before trusted result workbook was produced.`;
  const detailJson = {
    測試目的: sourceCase.caseTitle
      ? `執行並判定 ${sourceCase.caseNo}：${sourceCase.caseTitle}`
      : `執行並判定 ${sourceCase.caseNo}`,
    設定條件: {
      runId: input.runId,
      caseNo: sourceCase.caseNo,
      helperPreRunStatus: helperPreRunSummary?.status ?? null,
      helperExecutedCount: helperPreRunSummary?.executedCount ?? null
    },
    預期行為: expectedBehavior,
    實際行為: actualBehavior,
    blocked_reason: blockedReason,
    currentRunEvidence: {
      helperPreRunSummary: helperPreRunSummaryPath,
      helperReports: helperReportsFromSummary(helperPreRunSummary),
      helperArtifactDir: input.currentCaseNo ? path.join(input.runDir, "output", "helper-artifacts", input.currentCaseNo) : null,
      codexResult: path.join(input.runDir, "output", "codex-result.json")
    },
    runtimeContainment: {
      schemaVersion: "codex-runtime-containment-result-v1",
      generatedAt,
      failCategory,
      containmentKind,
      codexFailure: compactCodexFailure(input.result),
      policy: "This is a trusted single-case BLOCKED containment result for process isolation only. It is not a PASS/FAIL judgment of the product behavior."
    }
  };

  const writtenPath = await writeAgentResultXlsx({
    runId: input.runId,
    roundId: input.roundId,
    outputDir: path.join(input.runDir, "output"),
    sourceCase,
    status: "BLOCKED",
    failCategory,
    detailJson,
    fileName: "result.xlsx"
  });

  return writeReport({
    schemaVersion: "codex-runtime-containment-result-v1",
    generatedAt,
    status: "written",
    runId: input.runId,
    caseNo: sourceCase.caseNo,
    resultXlsxPath: writtenPath,
    failCategory,
    helperPreRunSummaryPath
  });
};

export const writeHelperBrowserSessionContainmentResultIfNeeded = async (input: {
  runId: string;
  roundId: string;
  runDir: string;
  xlsxPath?: string;
  currentCaseNo: string | null;
}): Promise<HelperBrowserSessionContainmentReport> => {
  const generatedAt = new Date().toISOString();
  const reportPath = path.join(input.runDir, "output", "helper-browser-session-containment-result.json");
  const resultXlsxPath = path.join(input.runDir, "output", "result.xlsx");
  const helperPreRunSummaryPath = path.join(input.runDir, "output", "helper-pre-run-summary.json");
  const writeReport = (report: HelperBrowserSessionContainmentReport): HelperBrowserSessionContainmentReport => {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  };

  if (fs.existsSync(resultXlsxPath)) {
    return writeReport({
      schemaVersion: "helper-browser-session-containment-result-v1",
      generatedAt,
      status: "skipped",
      reason: "RESULT_XLSX_ALREADY_EXISTS",
      runId: input.runId,
      caseNo: input.currentCaseNo,
      resultXlsxPath,
      helperPreRunSummaryPath
    });
  }

  if (consistencyGateHasErrors(input.runDir)) {
    return writeReport({
      schemaVersion: "helper-browser-session-containment-result-v1",
      generatedAt,
      status: "skipped",
      reason: "CONSISTENCY_GATE_ERROR_REQUIRES_PM_DECISION",
      runId: input.runId,
      caseNo: input.currentCaseNo,
      helperPreRunSummaryPath
    });
  }

  const helperPreRunSummary = readJsonIfExists<HelperPreRunSummary>(helperPreRunSummaryPath);
  if (!helperSummaryHasCurrentRunEvidence(helperPreRunSummary as unknown as Record<string, unknown> | null, input.currentCaseNo)) {
    return writeReport({
      schemaVersion: "helper-browser-session-containment-result-v1",
      generatedAt,
      status: "skipped",
      reason: "NO_CURRENT_RUN_HELPER_EVIDENCE_TO_CONTAIN",
      runId: input.runId,
      caseNo: input.currentCaseNo,
      helperPreRunSummaryPath
    });
  }

  const blockingActions = helperBrowserTargetClosedActions(helperPreRunSummary);
  if (blockingActions.length === 0) {
    return writeReport({
      schemaVersion: "helper-browser-session-containment-result-v1",
      generatedAt,
      status: "skipped",
      reason: "NO_HELPER_BROWSER_SESSION_CLOSED_BLOCKER",
      runId: input.runId,
      caseNo: input.currentCaseNo,
      helperPreRunSummaryPath
    });
  }

  const sourceCase = await readFirstInputCase(input.xlsxPath, input.currentCaseNo) ?? (
    input.currentCaseNo
      ? {
          groupId: null,
          groupName: null,
          caseNo: input.currentCaseNo,
          caseTitle: null,
          testType: null,
          executionMethod: null
        }
      : null
  );
  if (!sourceCase) {
    return writeReport({
      schemaVersion: "helper-browser-session-containment-result-v1",
      generatedAt,
      status: "skipped",
      reason: "CURRENT_CASE_UNAVAILABLE",
      runId: input.runId,
      caseNo: input.currentCaseNo,
      helperPreRunSummaryPath
    });
  }

  const failCategory = "BLOCKED_BROWSER_SESSION_CLOSED";
  const compactActions = blockingActions.map((action) => ({
    actionId: action.actionId,
    template: action.template,
    status: action.status,
    reportPath: action.reportPath
  }));
  const detailJson = {
    測試目的: sourceCase.caseTitle
      ? `執行並判定 ${sourceCase.caseNo}：${sourceCase.caseTitle}`
      : `執行並判定 ${sourceCase.caseNo}`,
    設定條件: {
      runId: input.runId,
      caseNo: sourceCase.caseNo,
      helperPreRunStatus: helperPreRunSummary?.status ?? null,
      helperExecutedCount: helperPreRunSummary?.executedCount ?? null,
      blockingActions: compactActions
    },
    預期行為: "Helper pre-run 若遇到 browser/page/context lifecycle failure，Agent 應隔離為當前單題 BLOCKED，不能讓整輪 run failed 或留下後續 PENDING。",
    實際行為: "Helper pre-run 已產生 current-run evidence，但 helper action 回報 browser/page/context 已關閉；Agent 以單題 containment 結果保留 evidence 並讓整輪可繼續。",
    blocked_reason: `${failCategory}: helper browser/page/context target closed during current-case helper pre-run.`,
    currentRunEvidence: {
      helperPreRunSummary: helperPreRunSummaryPath,
      helperReports: helperReportsFromSummary(helperPreRunSummary as unknown as Record<string, unknown> | null),
      browserSessionContainment: reportPath,
      helperArtifactDir: path.join(input.runDir, "output", "helper-artifacts", sourceCase.caseNo)
    },
    runtimeContainment: {
      schemaVersion: "helper-browser-session-containment-result-v1",
      generatedAt,
      failCategory,
      policy: "This is a trusted single-case BLOCKED containment result for browser/session lifecycle isolation only. It is not a PASS/FAIL judgment of the product behavior."
    }
  };

  const writtenPath = await writeAgentResultXlsx({
    runId: input.runId,
    roundId: input.roundId,
    outputDir: path.join(input.runDir, "output"),
    sourceCase,
    status: "BLOCKED",
    failCategory,
    detailJson,
    fileName: "result.xlsx"
  });

  return writeReport({
    schemaVersion: "helper-browser-session-containment-result-v1",
    generatedAt,
    status: "written",
    runId: input.runId,
    caseNo: sourceCase.caseNo,
    resultXlsxPath: writtenPath,
    failCategory,
    helperPreRunSummaryPath,
    blockingActions: compactActions
  });
};
