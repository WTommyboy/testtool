import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import type { AgentResultSourceCase } from "./result-writer";
import { writeAgentResultXlsx } from "./result-writer";
import { loadResultParserAdapter } from "./result-contract";

export type ResultWorkbookNormalizationReport = {
  schemaVersion: "result-workbook-normalization-v1";
  generatedAt: string;
  status: "unchanged" | "updated" | "skipped" | "error";
  detectedFormat: "result-contract" | "testcase-style" | "unknown";
  sourcePath: string;
  normalizedPath?: string;
  backupPath?: string;
  selectedCaseNo?: string | null;
  warnings: string[];
  errors: string[];
};

type NormalizeInput = {
  filePath: string;
  runId: string;
  roundId: string;
  currentCase: AgentResultSourceCase | null;
  expectedCaseNos: string[];
};

type ColumnMap = Record<string, number | null>;

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const rich = value as { richText?: Array<{ text?: string }> };
    if (Array.isArray(rich.richText)) return rich.richText.map((item) => item.text ?? "").join("").trim();
  }
  return String(value).trim();
};

const normalize = (value: unknown): string => cellText(value).toLowerCase().replace(/\s+/g, "");

const sameCaseNo = (a: string, b: string): boolean =>
  normalize(a).replace(/^demo-/i, "") === normalize(b).replace(/^demo-/i, "");

const headerValues = (row: ExcelJS.Row): string[] => {
  const values: string[] = [];
  for (let col = 1; col <= Math.max(row.cellCount, row.actualCellCount); col += 1) {
    values.push(cellText(row.getCell(col).value));
  }
  while (values.length > 0 && !values[values.length - 1]) values.pop();
  return values;
};

const findHeader = (headers: string[], names: string[]): number | null => {
  const expected = new Set(names.map((name) => normalize(name)));
  const index = headers.findIndex((header) => expected.has(normalize(header)));
  return index >= 0 ? index + 1 : null;
};

const hasHeader = (headers: string[], name: string): boolean => findHeader(headers, [name]) !== null;

const isResultContractHeader = (headers: string[]): boolean => {
  const adapter = loadResultParserAdapter();
  return adapter.headers.cases.every((header) => hasHeader(headers, header));
};

const isTestcaseStyleHeader = (headers: string[]): boolean => {
  const markers = ["狀態清理", "前置條件", "步驟", "預期結果", "驗證方法", "測試日"];
  const minimum = ["編號", "測試項目", "測試類型", "執行方式", "結果", "詳細紀錄JSON"];
  return minimum.every((header) => hasHeader(headers, header)) && markers.some((header) => hasHeader(headers, header));
};

const parseDetailJson = (raw: string): Record<string, unknown> | null => {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const detailString = (detail: Record<string, unknown>): string => JSON.stringify(detail, null, 2);

const stringField = (detail: Record<string, unknown> | null, keys: string[]): string | null => {
  if (!detail) return null;
  for (const key of keys) {
    const value = detail[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const fallbackFailCategory = (status: string, detail: Record<string, unknown> | null): string => {
  const explicit = stringField(detail, ["失敗分類", "failCategory", "fail_category", "verdictReason", "verdict_reason"]);
  if (explicit) return explicit;
  if (status === "PASS") return "";
  if (status === "FAIL") return stringField(detail, ["根因層級", "rootCauseLayer", "rootCause"]) ?? "UNCLASSIFIED_FAIL";
  if (status === "BLOCKED") return stringField(detail, ["blocked_reason", "blockedReason", "阻塞原因"]) ?? "EVIDENCE_INSUFFICIENT";
  if (status === "PARTIAL") return "PARTIAL";
  return "";
};

const columnsFor = (headers: string[]): ColumnMap => ({
  groupId: findHeader(headers, ["群組ID", "group_id", "groupid", "group id"]),
  groupName: findHeader(headers, ["群組", "group", "group_name"]),
  caseNo: findHeader(headers, ["編號", "case_no", "caseno", "案例編號"]),
  caseTitle: findHeader(headers, ["測試項目", "case_title", "title"]),
  testType: findHeader(headers, ["測試類型", "test_type"]),
  executionMethod: findHeader(headers, ["執行方式", "execution_method"]),
  status: findHeader(headers, ["結果", "status", "result_status"]),
  failCategory: findHeader(headers, ["失敗分類", "fail_category", "verdict_reason"]),
  detailJson: findHeader(headers, ["詳細紀錄JSON", "詳細紀錄json", "detail_json", "detailjson"])
});

const requiredColumn = (columns: ColumnMap, key: string): number => {
  const value = columns[key];
  if (!value) throw new Error(`missing column ${key}`);
  return value;
};

const readSourceCaseFromRow = (
  row: ExcelJS.Row,
  columns: ColumnMap,
  fallback: AgentResultSourceCase | null,
  caseNo: string
): AgentResultSourceCase => ({
  groupId: columns.groupId ? (cellText(row.getCell(columns.groupId).value) || fallback?.groupId || null) : fallback?.groupId ?? null,
  groupName: columns.groupName ? (cellText(row.getCell(columns.groupName).value) || fallback?.groupName || null) : fallback?.groupName ?? null,
  caseNo,
  caseTitle: columns.caseTitle ? (cellText(row.getCell(columns.caseTitle).value) || fallback?.caseTitle || null) : fallback?.caseTitle ?? null,
  testType: columns.testType ? (cellText(row.getCell(columns.testType).value) || fallback?.testType || null) : fallback?.testType ?? null,
  executionMethod: columns.executionMethod ? (cellText(row.getCell(columns.executionMethod).value) || fallback?.executionMethod || null) : fallback?.executionMethod ?? null
});

const normalizedStatus = (value: string): "PASS" | "FAIL" | "BLOCKED" | "PARTIAL" | null => {
  const status = value.trim().toUpperCase();
  return status === "PASS" || status === "FAIL" || status === "BLOCKED" || status === "PARTIAL" ? status : null;
};

const buildBackupPath = (filePath: string): string => {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath) || ".xlsx";
  const base = path.basename(filePath, ext);
  return path.join(dir, `${base}.testcase-style-original${ext}`);
};

export const normalizeCodexResultWorkbook = async (input: NormalizeInput): Promise<ResultWorkbookNormalizationReport> => {
  const report: ResultWorkbookNormalizationReport = {
    schemaVersion: "result-workbook-normalization-v1",
    generatedAt: new Date().toISOString(),
    status: "unchanged",
    detectedFormat: "unknown",
    sourcePath: input.filePath,
    selectedCaseNo: null,
    warnings: [],
    errors: []
  };

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(input.filePath);
  const adapter = loadResultParserAdapter();
  const sheet = workbook.getWorksheet(adapter.sheets.cases);
  if (!sheet) {
    report.status = "skipped";
    report.errors.push(`Missing sheet: ${adapter.sheets.cases}`);
    return report;
  }

  const headers = headerValues(sheet.getRow(1));
  if (isResultContractHeader(headers)) {
    report.detectedFormat = "result-contract";
    return report;
  }
  if (!isTestcaseStyleHeader(headers)) {
    report.status = "skipped";
    report.errors.push("Workbook is neither result-contract nor recognizable testcase-style format.");
    return report;
  }

  report.detectedFormat = "testcase-style";
  const expectedCaseNo = input.expectedCaseNos.length === 1 ? input.expectedCaseNos[0] : null;
  if (!expectedCaseNo) {
    report.status = "error";
    report.errors.push(`Expected exactly one case id for testcase-style normalization, got ${input.expectedCaseNos.length}.`);
    return report;
  }

  const columns = columnsFor(headers);
  let targetRow: ExcelJS.Row | null = null;
  const caseNoColumn = requiredColumn(columns, "caseNo");
  for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    const caseNo = cellText(row.getCell(caseNoColumn).value);
    if (caseNo && sameCaseNo(caseNo, expectedCaseNo)) {
      targetRow = row;
      report.selectedCaseNo = caseNo;
      break;
    }
  }

  if (!targetRow) {
    report.status = "error";
    report.errors.push(`Could not find expected case ${expectedCaseNo} in testcase-style workbook.`);
    return report;
  }

  const status = normalizedStatus(cellText(targetRow.getCell(requiredColumn(columns, "status")).value));
  if (!status) {
    report.status = "error";
    report.errors.push(`Expected case ${expectedCaseNo} has no completed PASS/FAIL/BLOCKED/PARTIAL result.`);
    return report;
  }

  const detailRaw = cellText(targetRow.getCell(requiredColumn(columns, "detailJson")).value);
  const detail = parseDetailJson(detailRaw);
  if (!detail) {
    report.status = "error";
    report.errors.push(`Expected case ${expectedCaseNo} detail_json is missing or invalid; cannot normalize.`);
    return report;
  }

  const failCategory = columns.failCategory
    ? cellText(targetRow.getCell(columns.failCategory).value) || fallbackFailCategory(status, detail)
    : fallbackFailCategory(status, detail);
  const sourceCase = readSourceCaseFromRow(targetRow, columns, input.currentCase, report.selectedCaseNo ?? expectedCaseNo);
  const tempOutputDir = fs.mkdtempSync(path.join(path.dirname(input.filePath), ".normalizing-"));
  try {
    const normalizedPath = await writeAgentResultXlsx({
      runId: input.runId,
      roundId: input.roundId,
      outputDir: tempOutputDir,
      sourceCase,
      status,
      failCategory,
      detailJson: JSON.parse(detailString(detail)) as Record<string, unknown>,
      fileName: path.basename(input.filePath)
    });
    const backupPath = buildBackupPath(input.filePath);
    fs.copyFileSync(input.filePath, backupPath);
    fs.copyFileSync(normalizedPath, input.filePath);
    report.status = "updated";
    report.normalizedPath = input.filePath;
    report.backupPath = backupPath;
    report.warnings.push("Codex wrote testcase-style workbook; Agent normalized only the expected current-case row to result-contract format before upload.");
    return report;
  } finally {
    fs.rmSync(tempOutputDir, { recursive: true, force: true });
  }
};
