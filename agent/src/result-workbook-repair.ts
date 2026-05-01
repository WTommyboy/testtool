import ExcelJS from "exceljs";
import type { AgentResultSourceCase } from "./result-writer";
import { loadResultParserAdapter } from "./result-contract";

export type ResultWorkbookRepairReport = {
  schemaVersion: "result-workbook-repair-v1";
  generatedAt: string;
  status: "unchanged" | "updated" | "skipped";
  repairs: Array<{
    action: string;
    sheetName: string;
    header?: string;
    rowCount?: number;
    caseNo?: string | null;
    groupId?: string | null;
  }>;
  warnings: string[];
};

type RepairInput = {
  filePath: string;
  currentCase: AgentResultSourceCase | null;
  expectedCaseNos: string[];
};

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const rich = value as { richText?: Array<{ text?: string }> };
    if (Array.isArray(rich.richText)) return rich.richText.map((item) => item.text ?? "").join("").trim();
  }
  return String(value).trim();
};

const normalize = (value: unknown): string => cellText(value).toLowerCase().replace(/\s+/g, "");

const rowValues = (row: ExcelJS.Row): string[] => {
  const values: string[] = [];
  for (let col = 1; col <= row.cellCount; col += 1) {
    values.push(cellText(row.getCell(col).value));
  }
  while (values.length > 0 && !values[values.length - 1]) values.pop();
  return values;
};

const sameCaseNo = (a: string, b: string): boolean =>
  normalize(a).replace(/^demo-/i, "") === normalize(b).replace(/^demo-/i, "");

const inferGroupId = (sourceCase: AgentResultSourceCase | null, groupName: string, caseNo: string): string | null => {
  const explicit = sourceCase?.groupId?.trim();
  if (explicit) return explicit;

  const groupMatch = (sourceCase?.groupName ?? groupName).trim().match(/^([A-Za-z0-9_-]+)\s*[:：]/);
  if (groupMatch?.[1]) return groupMatch[1];

  const caseMatch = caseNo.trim().match(/^[A-Za-z]+-([A-Za-z0-9]+)-\d+$/);
  if (caseMatch?.[1]) return caseMatch[1];

  return null;
};

export const repairSingleCaseResultWorkbook = async (input: RepairInput): Promise<ResultWorkbookRepairReport> => {
  const report: ResultWorkbookRepairReport = {
    schemaVersion: "result-workbook-repair-v1",
    generatedAt: new Date().toISOString(),
    status: "unchanged",
    repairs: [],
    warnings: []
  };

  const adapter = loadResultParserAdapter();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(input.filePath);

  const sheet = workbook.getWorksheet(adapter.sheets.cases);
  if (!sheet) {
    report.status = "skipped";
    report.warnings.push(`Missing sheet: ${adapter.sheets.cases}`);
    return report;
  }

  const expectedHeaders = adapter.headers.cases;
  const groupIdHeader = expectedHeaders[0] ?? "群組ID";
  const legacyHeaders = expectedHeaders.filter((header) => normalize(header) !== normalize(groupIdHeader));
  const headers = rowValues(sheet.getRow(1));

  if (headers.some((header) => normalize(header) === normalize(groupIdHeader))) {
    return report;
  }

  const isLegacyCaseHeader = legacyHeaders.length === headers.length
    && legacyHeaders.every((header, index) => normalize(headers[index]) === normalize(header));
  if (!isLegacyCaseHeader) {
    report.status = "skipped";
    report.warnings.push(`Case sheet is missing ${groupIdHeader}, but headers do not match the legacy single-case layout.`);
    return report;
  }

  const caseNoColumn = legacyHeaders.findIndex((header) => normalize(header) === normalize("編號")) + 1;
  const groupNameColumn = legacyHeaders.findIndex((header) => normalize(header) === normalize("群組")) + 1;
  if (caseNoColumn <= 0 || groupNameColumn <= 0) {
    report.status = "skipped";
    report.warnings.push("Legacy case sheet is missing 編號 or 群組 column.");
    return report;
  }

  const dataRows: Array<{ rowNo: number; caseNo: string; groupName: string }> = [];
  for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    const caseNo = cellText(row.getCell(caseNoColumn).value);
    if (!caseNo) continue;
    dataRows.push({
      rowNo,
      caseNo,
      groupName: cellText(row.getCell(groupNameColumn).value)
    });
  }

  if (dataRows.length !== 1) {
    report.status = "skipped";
    report.warnings.push(`Refusing to repair ${dataRows.length} case rows; only a single current-case result can be repaired.`);
    return report;
  }

  const dataRow = dataRows[0];
  const expectedCaseNo = input.expectedCaseNos.length === 1 ? input.expectedCaseNos[0] : null;
  if (!expectedCaseNo) {
    report.status = "skipped";
    report.warnings.push("Refusing to repair because current dispatch case metadata is unavailable.");
    return report;
  }
  if (!sameCaseNo(dataRow.caseNo, expectedCaseNo)) {
    report.status = "skipped";
    report.warnings.push(`Refusing to repair case ${dataRow.caseNo}; expected current case ${expectedCaseNo}.`);
    return report;
  }
  if (input.expectedCaseNos.length > 1) {
    report.status = "skipped";
    report.warnings.push(`Refusing to repair with multiple expected case ids: ${input.expectedCaseNos.join(",")}.`);
    return report;
  }

  const groupId = inferGroupId(input.currentCase, dataRow.groupName, dataRow.caseNo);
  if (!groupId) {
    report.warnings.push(`Inserted ${groupIdHeader} header with blank value because current case groupId could not be inferred.`);
  }

  sheet.spliceColumns(1, 0, [groupIdHeader, groupId ?? ""]);
  sheet.getRow(1).font = { bold: true };
  await workbook.xlsx.writeFile(input.filePath);

  report.status = "updated";
  report.repairs.push({
    action: "insert_missing_group_id_column",
    sheetName: adapter.sheets.cases,
    header: groupIdHeader,
    rowCount: dataRows.length,
    caseNo: dataRow.caseNo,
    groupId
  });
  return report;
};
