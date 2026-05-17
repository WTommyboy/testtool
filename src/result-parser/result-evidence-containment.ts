import type { ParsedResultCase, ParsedResultXlsx } from "./result-xlsx-parser";
import type { ResultEvidenceGateIssue, ResultEvidenceGateReport } from "./result-evidence-gate";

export const CASE_LEVEL_RESULT_EVIDENCE_CONTAINMENT_VERSION = "case-level-result-evidence-containment-v1";

export type CaseLevelResultEvidenceContainmentReport = {
  schemaVersion: typeof CASE_LEVEL_RESULT_EVIDENCE_CONTAINMENT_VERSION;
  generatedAt: string;
  status: "updated" | "skipped";
  reason: string;
  updatedCaseNos: string[];
};

const CONTAINABLE_ERROR_CODES = new Set([
  "RESULT_SCOPE_OUT_OF_SCOPE_PREVIEW_BLOCKER"
]);

const normalizeCaseNo = (value: string | null | undefined): string => (value ?? "").trim().toUpperCase();

const isContainableReport = (report: ResultEvidenceGateReport): boolean => {
  const errorIssues = report.issues.filter((item) => item.severity === "error");
  return errorIssues.length > 0 && errorIssues.every((item) => CONTAINABLE_ERROR_CODES.has(item.code));
};

const coreText = (value: unknown, fallback: string): string => {
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
};

const safeIssueSummary = (issue: ResultEvidenceGateIssue): Record<string, unknown> => ({
  code: issue.code,
  message: issue.message
});

const containCase = (item: ParsedResultCase, issues: ResultEvidenceGateIssue[]): void => {
  const previousDetail = item.detailJson ?? {};
  const previousFailCategory = item.verdictReason;
  item.status = "BLOCKED";
  item.verdictReason = "BLOCKED_NEEDS_REJUDGMENT";
  item.detailJson = {
    測試目的: coreText(previousDetail["測試目的"], "Result evidence gate case-level containment."),
    設定條件: coreText(previousDetail["設定條件"], "See current-run result evidence gate containment metadata."),
    預期行為: coreText(previousDetail["預期行為"] ?? previousDetail["預期結果"], "Case result must match the declared case scope."),
    實際行為:
      "Server result evidence gate detected that Codex used an out-of-scope preview precondition as the result reason. The case was contained for rejudgment instead of failing the whole run.",
    blocked_reason: "BLOCKED_NEEDS_REJUDGMENT:RESULT_SCOPE_OUT_OF_SCOPE_PREVIEW_BLOCKER",
    original_result_before_server_containment: "BLOCKED",
    original_fail_category_kind_before_server_containment: previousFailCategory ? "preview_precondition_blocker" : null,
    evidence_gate_issues: issues.map(safeIssueSummary),
    currentRunEvidence: {
      source: "server_result_evidence_gate",
      containment: true,
      caseNo: item.caseNo,
      resultGateCode: "RESULT_SCOPE_OUT_OF_SCOPE_PREVIEW_BLOCKER"
    }
  };
  item.detailJsonRaw = JSON.stringify(item.detailJson);
  item.detailParseError = null;
};

export const containCaseLevelResultEvidenceGateIssues = (
  parsed: ParsedResultXlsx,
  report: ResultEvidenceGateReport
): CaseLevelResultEvidenceContainmentReport => {
  const errorIssues = report.issues.filter((item) => item.severity === "error");
  if (errorIssues.length === 0) {
    return {
      schemaVersion: CASE_LEVEL_RESULT_EVIDENCE_CONTAINMENT_VERSION,
      generatedAt: new Date().toISOString(),
      status: "skipped",
      reason: "NO_RESULT_EVIDENCE_GATE_ERRORS",
      updatedCaseNos: []
    };
  }
  if (!isContainableReport(report)) {
    return {
      schemaVersion: CASE_LEVEL_RESULT_EVIDENCE_CONTAINMENT_VERSION,
      generatedAt: new Date().toISOString(),
      status: "skipped",
      reason: "RESULT_EVIDENCE_GATE_HAS_NON_CONTAINABLE_ERRORS",
      updatedCaseNos: []
    };
  }

  const issuesByCase = new Map<string, ResultEvidenceGateIssue[]>();
  for (const issue of errorIssues) {
    const key = normalizeCaseNo(issue.caseNo);
    if (!key) continue;
    issuesByCase.set(key, [...(issuesByCase.get(key) ?? []), issue]);
  }
  if (issuesByCase.size === 0) {
    return {
      schemaVersion: CASE_LEVEL_RESULT_EVIDENCE_CONTAINMENT_VERSION,
      generatedAt: new Date().toISOString(),
      status: "skipped",
      reason: "CONTAINABLE_RESULT_EVIDENCE_CASE_NO_MISSING",
      updatedCaseNos: []
    };
  }

  const updatedCaseNos: string[] = [];
  for (const item of parsed.cases) {
    const issues = issuesByCase.get(normalizeCaseNo(item.caseNo));
    if (!issues) continue;
    containCase(item, issues);
    updatedCaseNos.push(item.caseNo);
  }

  if (updatedCaseNos.length === 0) {
    return {
      schemaVersion: CASE_LEVEL_RESULT_EVIDENCE_CONTAINMENT_VERSION,
      generatedAt: new Date().toISOString(),
      status: "skipped",
      reason: "NO_PARSED_CASES_MATCHED_CONTAINABLE_ERRORS",
      updatedCaseNos: []
    };
  }

  return {
    schemaVersion: CASE_LEVEL_RESULT_EVIDENCE_CONTAINMENT_VERSION,
    generatedAt: new Date().toISOString(),
    status: "updated",
    reason: "RESULT_EVIDENCE_GATE_CONTAINED_AS_BLOCKED_NEEDS_REJUDGMENT",
    updatedCaseNos
  };
};
