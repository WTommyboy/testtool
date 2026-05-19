import fs from "node:fs";
import ExcelJS from "exceljs";

export const RESULT_EVIDENCE_UPLOAD_CONTAINMENT_VERSION = "result-evidence-upload-containment-v1";

export type ResultEvidenceUploadContainmentReport = {
  schemaVersion: typeof RESULT_EVIDENCE_UPLOAD_CONTAINMENT_VERSION;
  generatedAt: string;
  status: "updated" | "skipped";
  reason: string;
  updatedCaseNos: string[];
  errorCodes: string[];
  backupPath?: string;
};

type GateIssue = {
  severity?: unknown;
  code?: unknown;
  caseNo?: unknown;
};

type GateReport = {
  status?: unknown;
  currentCaseNo?: unknown;
  issues?: unknown;
};

const hardGateCodes = new Set([
  "RESULT_XLSX_SCHEMA_VERSION_MISSING",
  "AGENT_FALLBACK_RESULT_NOT_TRUSTED",
  "DIAGNOSTIC_RESULT_NOT_TRUSTED",
  "RESULT_CASES_EMPTY",
  "RESULT_MULTIPLE_CASES",
  "RESULT_CASE_NOT_IN_ASSIGNMENT",
  "RESULT_CASE_NOT_CURRENT",
  "RESULT_STATUS_UNSUPPORTED",
  "DETAIL_JSON_PARSE_ERROR",
  "DETAIL_JSON_MISSING",
  "DETAIL_JSON_CASE_SCOPE_CONTRACT_INVALID"
]);

const containableGateCodes = new Set([
  "RESULT_SCOPE_OUT_OF_SCOPE_PREVIEW_BLOCKER",
  "RESULT_FRONTEND_OBSERVATION_VISUAL_FALLBACK_REQUIRED",
  "RESULT_TOOL_EXECUTION_UNAVAILABLE_WITHOUT_PREFLIGHT",
  "TOOL_BRIDGE_RESPONSE_MISSING"
]);

const normalizeCode = (value: unknown): string => (typeof value === "string" ? value.trim().toUpperCase() : "");
const normalizeCaseNo = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const getErrorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const parseUploadErrorBody = (error: unknown): Record<string, unknown> | null => {
  const message = getErrorMessage(error);
  if (!/RESULT_UPLOAD_FAILED\s+422\b/.test(message)) return null;
  const jsonStart = message.indexOf("{");
  if (jsonStart < 0) return null;
  try {
    const parsed = JSON.parse(message.slice(jsonStart)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const parseGateReport = (error: unknown): GateReport | null => {
  const body = parseUploadErrorBody(error);
  if (!body) return null;
  if (body.error !== "RESULT_EVIDENCE_GATE_FAILED") return null;
  const report = body.report;
  if (!report || typeof report !== "object" || Array.isArray(report)) return null;
  return report as GateReport;
};

const gateErrorIssues = (report: GateReport): GateIssue[] => {
  if (!Array.isArray(report.issues)) return [];
  return report.issues.filter((item): item is GateIssue =>
    Boolean(item && typeof item === "object" && !Array.isArray(item) && (item as GateIssue).severity === "error")
  );
};

const textValue = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const parseDetailJson = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

const headerMap = (worksheet: ExcelJS.Worksheet): Map<string, number> => {
  const row = worksheet.getRow(1);
  const headers = new Map<string, number>();
  row.eachCell((cell, colNumber) => {
    const key = String(cell.value ?? "").trim();
    if (key) headers.set(key, colNumber);
  });
  return headers;
};

const getCellText = (row: ExcelJS.Row, headers: Map<string, number>, header: string): string => {
  const col = headers.get(header);
  if (!col) return "";
  const value = row.getCell(col).value;
  if (value == null) return "";
  if (typeof value === "object" && "text" in value && typeof value.text === "string") return value.text;
  return String(value);
};

const setCell = (row: ExcelJS.Row, headers: Map<string, number>, header: string, value: unknown): void => {
  const col = headers.get(header);
  if (!col) return;
  row.getCell(col).value = value as ExcelJS.CellValue;
};

const extractScreenshotReferences = (value: unknown): string[] => {
  const references: string[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown, depth = 0): void => {
    if (depth > 8 || references.length >= 10) return;
    if (typeof node === "string" && /\.(?:png|jpe?g|webp)(?:\b|$)/i.test(node)) {
      const ref = node.trim();
      if (ref && !seen.has(ref)) {
        seen.add(ref);
        references.push(ref);
      }
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, depth + 1));
      return;
    }
    for (const child of Object.values(node as Record<string, unknown>)) visit(child, depth + 1);
  };
  visit(value);
  return references;
};

export const containResultEvidenceUploadFailure = async (input: {
  filePath: string;
  error: unknown;
  runId?: string | null;
  currentCaseNo?: string | null;
}): Promise<ResultEvidenceUploadContainmentReport> => {
  const report = parseGateReport(input.error);
  const issues = report ? gateErrorIssues(report) : [];
  const errorCodes = issues.map((item) => normalizeCode(item.code)).filter(Boolean);
  const generatedAt = new Date().toISOString();

  if (!report || issues.length === 0) {
    return {
      schemaVersion: RESULT_EVIDENCE_UPLOAD_CONTAINMENT_VERSION,
      generatedAt,
      status: "skipped",
      reason: "NOT_RESULT_EVIDENCE_GATE_UPLOAD_ERROR",
      updatedCaseNos: [],
      errorCodes
    };
  }

  const hardCodes = errorCodes.filter((code) => hardGateCodes.has(code));
  if (hardCodes.length > 0) {
    return {
      schemaVersion: RESULT_EVIDENCE_UPLOAD_CONTAINMENT_VERSION,
      generatedAt,
      status: "skipped",
      reason: `RESULT_EVIDENCE_GATE_HAS_HARD_ERRORS:${hardCodes.join(",")}`,
      updatedCaseNos: [],
      errorCodes
    };
  }
  const nonContainableCodes = errorCodes.filter((code) => !containableGateCodes.has(code));
  if (nonContainableCodes.length > 0) {
    return {
      schemaVersion: RESULT_EVIDENCE_UPLOAD_CONTAINMENT_VERSION,
      generatedAt,
      status: "skipped",
      reason: `RESULT_EVIDENCE_GATE_HAS_NON_CONTAINABLE_ERRORS:${nonContainableCodes.join(",")}`,
      updatedCaseNos: [],
      errorCodes
    };
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(input.filePath);
  const worksheet = workbook.getWorksheet("測試案例");
  if (!worksheet) {
    return {
      schemaVersion: RESULT_EVIDENCE_UPLOAD_CONTAINMENT_VERSION,
      generatedAt,
      status: "skipped",
      reason: "RESULT_WORKBOOK_CASE_SHEET_MISSING",
      updatedCaseNos: [],
      errorCodes
    };
  }

  const headers = headerMap(worksheet);
  const caseHeader = headers.has("編號") ? "編號" : "case_no";
  const targetCaseNo = normalizeCaseNo(input.currentCaseNo) || normalizeCaseNo(report.currentCaseNo) || normalizeCaseNo(issues[0]?.caseNo);
  if (!targetCaseNo) {
    return {
      schemaVersion: RESULT_EVIDENCE_UPLOAD_CONTAINMENT_VERSION,
      generatedAt,
      status: "skipped",
      reason: "RESULT_EVIDENCE_GATE_CURRENT_CASE_UNKNOWN",
      updatedCaseNos: [],
      errorCodes
    };
  }
  let targetRow: ExcelJS.Row | null = null;
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (getCellText(row, headers, caseHeader).trim() === targetCaseNo) {
      targetRow = row;
      break;
    }
  }
  if (!targetRow) {
    return {
      schemaVersion: RESULT_EVIDENCE_UPLOAD_CONTAINMENT_VERSION,
      generatedAt,
      status: "skipped",
      reason: "RESULT_WORKBOOK_CURRENT_CASE_ROW_MISSING",
      updatedCaseNos: [],
      errorCodes
    };
  }

  const caseNo = getCellText(targetRow, headers, caseHeader).trim() || targetCaseNo;
  const previousStatus = getCellText(targetRow, headers, "結果").trim();
  const previousFailCategory = getCellText(targetRow, headers, "失敗分類").trim();
  const previousDetail = parseDetailJson(getCellText(targetRow, headers, "詳細紀錄JSON"));
  const screenshotReferences = extractScreenshotReferences(previousDetail);
  const issueCodes = [...new Set(errorCodes)];
  const detail = {
    測試目的: textValue(previousDetail["測試目的"], "Result evidence gate upload containment."),
    設定條件: textValue(previousDetail["設定條件"], "See current-run result evidence gate containment metadata."),
    預期行為: textValue(previousDetail["預期行為"] ?? previousDetail["預期結果"], "Result upload should not terminate the whole run for a containable single-case evidence gate issue."),
    實際行為:
      "Agent upload preflight received a result evidence gate rejection for this single case. The row was contained as BLOCKED_RESULT_GATE_CONTAINMENT so the run can continue to later cases instead of failing the whole run.",
    blocked_reason: `BLOCKED_RESULT_GATE_CONTAINMENT:${issueCodes.join(",")}`,
    evidenceSource: screenshotReferences.length > 0 ? "screenshotVisual" : "resultEvidenceGate",
    screenshotPath: screenshotReferences.length === 0 ? undefined : screenshotReferences.length === 1 ? screenshotReferences[0] : screenshotReferences,
    visualObservation:
      issueCodes.includes("RESULT_FRONTEND_OBSERVATION_VISUAL_FALLBACK_REQUIRED")
        ? "Screenshot artifact exists for this current run, but the visible assertion was not machine-extracted into structured detail_json."
        : undefined,
    domEvidenceGap:
      issueCodes.includes("RESULT_FRONTEND_OBSERVATION_VISUAL_FALLBACK_REQUIRED")
        ? "DOM/ARIA/URL structured assertion was missing or insufficient for an automatic frontend-observation judgment."
        : undefined,
    original_result_before_agent_upload_containment: previousStatus || null,
    original_fail_category_before_agent_upload_containment: previousFailCategory || null,
    evidence_gate_issue_codes: issueCodes,
    currentRunEvidence: {
      source: "agent_result_upload_preflight",
      containment: true,
      runId: input.runId ?? null,
      caseNo,
      resultGateCodes: issueCodes,
      policy: "single-case evidence gate containment before result upload retry"
    }
  };

  setCell(targetRow, headers, "結果", "BLOCKED");
  setCell(targetRow, headers, "失敗分類", "BLOCKED_RESULT_GATE_CONTAINMENT");
  setCell(targetRow, headers, "詳細紀錄JSON", JSON.stringify(detail, null, 2));
  targetRow.commit();

  const backupPath = `${input.filePath}.pre-result-evidence-upload-containment-${generatedAt.replace(/[:.]/g, "-")}.bak`;
  fs.copyFileSync(input.filePath, backupPath);
  await workbook.xlsx.writeFile(input.filePath);

  return {
    schemaVersion: RESULT_EVIDENCE_UPLOAD_CONTAINMENT_VERSION,
    generatedAt,
    status: "updated",
    reason: "RESULT_EVIDENCE_GATE_CONTAINED_AS_BLOCKED_RESULT_GATE_CONTAINMENT",
    updatedCaseNos: [caseNo],
    errorCodes: issueCodes,
    backupPath
  };
};
