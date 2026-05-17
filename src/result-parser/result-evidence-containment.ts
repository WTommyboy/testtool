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
  "RESULT_SCOPE_OUT_OF_SCOPE_PREVIEW_BLOCKER",
  "RESULT_FRONTEND_OBSERVATION_VISUAL_FALLBACK_REQUIRED",
  "RESULT_TOOL_EXECUTION_UNAVAILABLE_WITHOUT_PREFLIGHT"
]);

const VISUAL_FALLBACK_REQUIRED_CODE = "RESULT_FRONTEND_OBSERVATION_VISUAL_FALLBACK_REQUIRED";
const OUT_OF_SCOPE_PREVIEW_BLOCKER_CODE = "RESULT_SCOPE_OUT_OF_SCOPE_PREVIEW_BLOCKER";
const TOOL_UNAVAILABLE_WITHOUT_PREFLIGHT_CODE = "RESULT_TOOL_EXECUTION_UNAVAILABLE_WITHOUT_PREFLIGHT";

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

const isPrimitive = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

const isScreenshotReference = (keyOrPath: string, value: unknown): boolean => {
  const primitiveValue = isPrimitive(value) ? String(value) : "";
  const text = `${keyOrPath}\n${primitiveValue}`;
  if (/(?:screenshot|截圖).{0,24}(?:unavailable|timeout|failed|missing|失敗|逾時|無法|沒有|未取得)/i.test(text)) {
    return false;
  }
  if (/\.(?:png|jpe?g|webp)(?:\b|$)/i.test(primitiveValue)) return true;
  if (/artifactType/i.test(keyOrPath) && /^screenshot$/i.test(primitiveValue.trim())) return true;
  return /(screenshot|截圖)/i.test(keyOrPath) && isPrimitive(value) && primitiveValue.trim().length > 0;
};

const extractScreenshotReferences = (value: unknown): string[] => {
  const references: string[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown, path = "", depth = 0): void => {
    if (depth > 8 || references.length >= 10) return;
    if (isPrimitive(node) && isScreenshotReference(path, node)) {
      const ref = String(node).trim();
      if (ref && !seen.has(ref)) {
        seen.add(ref);
        references.push(ref);
      }
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      visit(child, path ? `${path}.${key}` : key, depth + 1);
    }
  };
  visit(value);
  return references;
};

const containOutOfScopePreviewBlocker = (item: ParsedResultCase, issues: ResultEvidenceGateIssue[]): void => {
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
      resultGateCode: OUT_OF_SCOPE_PREVIEW_BLOCKER_CODE
    }
  };
  item.detailJsonRaw = JSON.stringify(item.detailJson);
  item.detailParseError = null;
};

const containVisualFallbackRequired = (item: ParsedResultCase, issues: ResultEvidenceGateIssue[]): void => {
  const previousDetail = item.detailJson ?? {};
  const previousFailCategory = item.verdictReason;
  const screenshotReferences = extractScreenshotReferences(previousDetail);
  const screenshotPath =
    screenshotReferences.length === 0
      ? "screenshot evidence referenced in previous detail_json, but no machine-readable path was extracted"
      : screenshotReferences.length === 1
        ? screenshotReferences[0]
        : screenshotReferences;
  item.status = "BLOCKED";
  item.verdictReason = "BLOCKED_NEEDS_VISUAL_REVIEW";
  item.detailJson = {
    測試目的: coreText(previousDetail["測試目的"], "Frontend observation visual fallback containment."),
    設定條件: coreText(previousDetail["設定條件"], "See current-run screenshot evidence and DOM evidence gap metadata."),
    預期行為: coreText(previousDetail["預期行為"] ?? previousDetail["預期結果"], "Case observation must match the declared frontend UI expectation."),
    實際行為:
      "Server result evidence gate detected screenshot evidence for this frontend observation, but the result did not declare an explicit visual fallback contract. The case was contained as BLOCKED_NEEDS_VISUAL_REVIEW instead of a generic evidence-insufficient blocker.",
    blocked_reason: `BLOCKED_NEEDS_VISUAL_REVIEW:${VISUAL_FALLBACK_REQUIRED_CODE}`,
    evidenceSource: "screenshotVisual",
    screenshotPath,
    visualObservation:
      "Screenshot artifact exists for this current run, but the visible assertion was not machine-extracted into structured detail_json. Review the screenshot against the frontend observation expectation.",
    domEvidenceGap:
      "DOM/ARIA/URL structured assertion was missing or insufficient for an automatic frontend-observation judgment.",
    original_result_before_server_containment: "BLOCKED",
    original_fail_category_kind_before_server_containment: previousFailCategory ? "evidence_insufficient_with_screenshot" : null,
    evidence_gate_issues: issues.map(safeIssueSummary),
    currentRunEvidence: {
      source: "server_result_evidence_gate",
      containment: true,
      caseNo: item.caseNo,
      resultGateCode: VISUAL_FALLBACK_REQUIRED_CODE,
      evidenceSource: "screenshotVisual",
      screenshotPath,
      screenshotReferences
    }
  };
  item.detailJsonRaw = JSON.stringify(item.detailJson);
  item.detailParseError = null;
};

const containToolUnavailableWithoutPreflight = (item: ParsedResultCase, issues: ResultEvidenceGateIssue[]): void => {
  const previousDetail = item.detailJson ?? {};
  const previousFailCategory = item.verdictReason;
  item.status = "BLOCKED";
  item.verdictReason = "BLOCKED_NEEDS_REJUDGMENT";
  item.detailJson = {
    測試目的: coreText(previousDetail["測試目的"], "Browser MCP preflight containment."),
    設定條件: coreText(previousDetail["設定條件"], "See current-run browser MCP preflight gate metadata."),
    預期行為: coreText(previousDetail["預期行為"] ?? previousDetail["預期結果"], "Tool unavailable blockers must include browserMcp.preflight evidence."),
    實際行為:
      "Server result evidence gate detected a TOOL_EXECUTION_UNAVAILABLE blocker without browserMcp.preflight/browser_tabs evidence. The case was contained for rejudgment instead of accepting an unverified tool-unavailable classification.",
    blocked_reason: `BLOCKED_NEEDS_REJUDGMENT:${TOOL_UNAVAILABLE_WITHOUT_PREFLIGHT_CODE}`,
    original_result_before_server_containment: "BLOCKED",
    original_fail_category_kind_before_server_containment: previousFailCategory ? "tool_unavailable_without_preflight" : null,
    evidence_gate_issues: issues.map(safeIssueSummary),
    currentRunEvidence: {
      source: "server_result_evidence_gate",
      containment: true,
      caseNo: item.caseNo,
      resultGateCode: TOOL_UNAVAILABLE_WITHOUT_PREFLIGHT_CODE,
      requiredEvidence: "browserMcp.preflight attempted with browser_tabs before TOOL_EXECUTION_UNAVAILABLE can be accepted"
    }
  };
  item.detailJsonRaw = JSON.stringify(item.detailJson);
  item.detailParseError = null;
};

const containCase = (item: ParsedResultCase, issues: ResultEvidenceGateIssue[]): void => {
  if (issues.some((issue) => issue.code === VISUAL_FALLBACK_REQUIRED_CODE)) {
    containVisualFallbackRequired(item, issues);
    return;
  }
  if (issues.some((issue) => issue.code === TOOL_UNAVAILABLE_WITHOUT_PREFLIGHT_CODE)) {
    containToolUnavailableWithoutPreflight(item, issues);
    return;
  }
  containOutOfScopePreviewBlocker(item, issues);
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
    reason: errorIssues.some((issue) => issue.code === VISUAL_FALLBACK_REQUIRED_CODE)
      ? "RESULT_EVIDENCE_GATE_CONTAINED_AS_BLOCKED_NEEDS_VISUAL_REVIEW"
      : errorIssues.some((issue) => issue.code === TOOL_UNAVAILABLE_WITHOUT_PREFLIGHT_CODE)
        ? "RESULT_EVIDENCE_GATE_CONTAINED_AS_BLOCKED_NEEDS_REJUDGMENT_TOOL_PREFLIGHT"
      : "RESULT_EVIDENCE_GATE_CONTAINED_AS_BLOCKED_NEEDS_REJUDGMENT",
    updatedCaseNos
  };
};
