import fs from "node:fs";
import path from "node:path";
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
    detailJsonSourcePath?: string;
  }>;
  warnings: string[];
};

type RepairInput = {
  filePath: string;
  currentCase: AgentResultSourceCase | null;
  expectedCaseNos: string[];
  runDir?: string;
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

const findHeaderIndex = (headers: string[], names: string[]): number => {
  const expected = new Set(names.map((name) => normalize(name)));
  return headers.findIndex((header) => expected.has(normalize(header))) + 1;
};

const parseJsonObject = (raw: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

const isPathInside = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return relative === "" || (Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative));
};

const resolveRunLocalJsonPath = (
  rawValue: string,
  runDir: string | undefined,
  workbookPath: string
): string | null => {
  if (!runDir) return null;
  const trimmed = rawValue.trim();
  if (!trimmed || trimmed.includes("\n") || trimmed.includes("\r")) return null;
  if (parseJsonObject(trimmed)) return null;

  const candidates = path.isAbsolute(trimmed)
    ? [path.resolve(trimmed)]
    : [
        path.resolve(path.dirname(workbookPath), trimmed),
        path.resolve(runDir, trimmed)
      ];
  const resolvedRunDir = path.resolve(runDir);
  for (const candidate of candidates) {
    if (path.extname(candidate).toLowerCase() !== ".json") continue;
    if (!isPathInside(resolvedRunDir, candidate)) continue;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
};

const repairDetailJsonPathCells = (
  workbook: ExcelJS.Workbook,
  input: RepairInput,
  report: ResultWorkbookRepairReport
): boolean => {
  const adapter = loadResultParserAdapter();
  const sheet = workbook.getWorksheet(adapter.sheets.cases);
  if (!sheet || !input.runDir) return false;

  const headers = rowValues(sheet.getRow(1));
  const caseNoColumn = findHeaderIndex(headers, ["編號", "case_no", "caseno", "案例編號"]);
  const detailColumn = findHeaderIndex(headers, ["詳細紀錄JSON", "詳細紀錄json", "detail_json", "detailjson"]);
  if (caseNoColumn <= 0 || detailColumn <= 0) return false;

  let updated = false;
  for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    const caseNo = cellText(row.getCell(caseNoColumn).value);
    if (!caseNo) continue;
    if (input.expectedCaseNos.length > 0 && !input.expectedCaseNos.some((expected) => sameCaseNo(caseNo, expected))) continue;

    const rawDetail = cellText(row.getCell(detailColumn).value);
    const detailPath = resolveRunLocalJsonPath(rawDetail, input.runDir, input.filePath);
    if (!detailPath) continue;
    const detail = parseJsonObject(fs.readFileSync(detailPath, "utf8"));
    if (!detail) {
      report.warnings.push(`Skipped detail_json path expansion for ${caseNo}; file is not a JSON object: ${detailPath}`);
      continue;
    }

    row.getCell(detailColumn).value = JSON.stringify(detail, null, 2);
    report.repairs.push({
      action: "expand_detail_json_path",
      sheetName: adapter.sheets.cases,
      header: "詳細紀錄JSON",
      rowCount: 1,
      caseNo,
      detailJsonSourcePath: path.relative(path.resolve(input.runDir), detailPath)
    });
    updated = true;
  }
  return updated;
};

const repairBugSheetHeaders = (
  workbook: ExcelJS.Workbook,
  report: ResultWorkbookRepairReport
): boolean => {
  const adapter = loadResultParserAdapter();
  let sheet = workbook.getWorksheet(adapter.sheets.bugs);
  let createdSheet = false;
  if (!sheet) {
    sheet = workbook.addWorksheet(adapter.sheets.bugs);
    createdSheet = true;
  }

  const headers = rowValues(sheet.getRow(1));
  if (headers.length > 0) return false;

  const headerRow = sheet.getRow(1);
  adapter.headers.bugs.forEach((header, index) => {
    headerRow.getCell(index + 1).value = header;
  });
  headerRow.font = { bold: true };
  headerRow.commit();

  report.repairs.push({
    action: createdSheet ? "create_missing_bug_sheet_with_headers" : "insert_empty_bug_sheet_headers",
    sheetName: adapter.sheets.bugs,
    header: adapter.headers.bugs.join(","),
    rowCount: 0
  });
  return true;
};

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

  let workbookUpdated = repairDetailJsonPathCells(workbook, input, report);
  workbookUpdated = repairBugSheetHeaders(workbook, report) || workbookUpdated;
  const expectedHeaders = adapter.headers.cases;
  const groupIdHeader = expectedHeaders[0] ?? "群組ID";
  const legacyHeaders = expectedHeaders.filter((header) => normalize(header) !== normalize(groupIdHeader));
  const headers = rowValues(sheet.getRow(1));

  if (headers.some((header) => normalize(header) === normalize(groupIdHeader))) {
    if (workbookUpdated) {
      await workbook.xlsx.writeFile(input.filePath);
      report.status = "updated";
    }
    return report;
  }

  const isLegacyCaseHeader = legacyHeaders.length === headers.length
    && legacyHeaders.every((header, index) => normalize(headers[index]) === normalize(header));
  if (!isLegacyCaseHeader) {
    if (workbookUpdated) {
      await workbook.xlsx.writeFile(input.filePath);
      report.status = "updated";
      return report;
    }
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
  workbookUpdated = true;

  report.status = "updated";
  report.repairs.push({
    action: "insert_missing_group_id_column",
    sheetName: adapter.sheets.cases,
    header: groupIdHeader,
    rowCount: dataRows.length,
    caseNo: dataRow.caseNo,
    groupId
  });
  if (workbookUpdated) {
    await workbook.xlsx.writeFile(input.filePath);
  }
  return report;
};
