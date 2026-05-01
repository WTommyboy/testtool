import fs from "node:fs";
import ExcelJS from "exceljs";
import { parseDetailJson } from "./detail-json";

export const RESULT_XLSX_PARSER_VERSION = "result-xlsx-parser-v1";

export type ParsedResultCase = {
  groupId: string | null;
  groupName: string | null;
  caseNo: string;
  caseTitle: string | null;
  testType: string | null;
  executionMethod: string | null;
  status: string;
  verdictReason: string | null;
  detailJson: Record<string, unknown> | null;
  detailJsonRaw: string | null;
  detailParseError: string | null;
};

export type ParsedBug = {
  severity: string;
  bugId: string;
  relatedCaseNo: string | null;
  title: string;
  description: string | null;
  suggestion: string | null;
  status: string;
};

export type ParsedResultXlsx = {
  parserVersion: string;
  schemaVersion: string | null;
  cases: ParsedResultCase[];
  bugs: ParsedBug[];
};

const text = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (typeof value === "object") {
    const rich = value as { richText?: Array<{ text?: string }> };
    if (Array.isArray(rich.richText)) {
      return rich.richText.map((item) => item.text ?? "").join("").trim();
    }
  }
  return String(value).trim();
};

const normalize = (value: unknown): string => {
  return text(value).toLowerCase().replace(/\s+/g, "");
};

const findHeader = (row: ExcelJS.Row, names: string[]): number | undefined => {
  const expected = new Set(names.map((name) => name.toLowerCase().replace(/\s+/g, "")));
  let found: number | undefined;
  row.eachCell((cell, col) => {
    if (expected.has(normalize(cell.value))) found = col;
  });
  return found;
};

const requireHeader = (row: ExcelJS.Row, key: string, names: string[]): number => {
  const index = findHeader(row, names);
  if (!index) throw new Error(`RESULT_XLSX_HEADER_MISSING:${key}`);
  return index;
};

const optionalHeader = (row: ExcelJS.Row, names: string[]): number | null => {
  return findHeader(row, names) ?? null;
};

const nullable = (value: string): string | null => {
  return value ? value : null;
};

const deriveGroupId = (groupId: string | null, groupName: string | null, caseNo: string): string | null => {
  if (groupId) return groupId;
  const fromGroupName = groupName?.match(/^([A-Za-z0-9_-]+)\s*[:：]/)?.[1];
  if (fromGroupName) return fromGroupName;
  return caseNo.match(/^[A-Za-z]+-([A-Za-z0-9]+)-\d+/)?.[1] ?? caseNo.match(/^([A-Za-z0-9]+)-\d+/)?.[1] ?? null;
};

const readSchemaVersion = (sheet: ExcelJS.Worksheet): string | null => {
  const schemaKeys = new Set(["schemaversion", "schema_version"]);
  const maxRows = Math.min(sheet.rowCount, 20);
  for (let rowNo = 1; rowNo <= maxRows; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    if (schemaKeys.has(normalize(row.getCell(1).value))) {
      return nullable(text(row.getCell(2).value));
    }
  }

  const a1 = normalize(sheet.getCell("A1").value);
  const b1 = normalize(sheet.getCell("B1").value);
  if (a1 === "欄位" && b1 === "值") return null;
  return nullable(text(sheet.getCell("B1").value));
};

export const parseResultXlsx = async (filePath: string): Promise<ParsedResultXlsx> => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`RESULT_XLSX_NOT_FOUND:${filePath}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const indexSheet = workbook.getWorksheet("索引");
  const schemaVersion = indexSheet ? readSchemaVersion(indexSheet) : null;

  const caseSheet = workbook.getWorksheet("測試案例");
  if (!caseSheet) throw new Error("RESULT_CASE_SHEET_NOT_FOUND");
  const caseHeader = caseSheet.getRow(1);
  const c = {
    groupId: optionalHeader(caseHeader, ["群組ID", "group_id", "groupid", "group id"]),
    groupName: requireHeader(caseHeader, "groupName", ["群組", "group", "group_name"]),
    caseNo: requireHeader(caseHeader, "caseNo", ["編號", "case_no", "caseno", "案例編號"]),
    caseTitle: requireHeader(caseHeader, "caseTitle", ["測試項目", "case_title", "title"]),
    testType: requireHeader(caseHeader, "testType", ["測試類型", "test_type"]),
    executionMethod: requireHeader(caseHeader, "executionMethod", ["執行方式", "execution_method"]),
    status: requireHeader(caseHeader, "status", ["結果", "status", "result_status"]),
    verdictReason: requireHeader(caseHeader, "verdictReason", ["失敗分類", "fail_category", "verdict_reason"]),
    detailJson: requireHeader(caseHeader, "detailJson", ["詳細紀錄json", "detail_json", "detailjson"])
  };

  const cases: ParsedResultCase[] = [];
  for (let rowNo = 2; rowNo <= caseSheet.rowCount; rowNo += 1) {
    const row = caseSheet.getRow(rowNo);
    const caseNo = text(row.getCell(c.caseNo).value);
    if (!caseNo) continue;
    const detail = parseDetailJson(text(row.getCell(c.detailJson).value));
    const groupName = nullable(text(row.getCell(c.groupName).value));
    const groupId = c.groupId ? nullable(text(row.getCell(c.groupId).value)) : null;
    cases.push({
      groupId: deriveGroupId(groupId, groupName, caseNo),
      groupName,
      caseNo,
      caseTitle: nullable(text(row.getCell(c.caseTitle).value)),
      testType: nullable(text(row.getCell(c.testType).value)),
      executionMethod: nullable(text(row.getCell(c.executionMethod).value)),
      status: text(row.getCell(c.status).value).toUpperCase(),
      verdictReason: nullable(text(row.getCell(c.verdictReason).value)),
      detailJson: detail.detailJson,
      detailJsonRaw: detail.detailJsonRaw,
      detailParseError: detail.detailParseError
    });
  }

  const bugs: ParsedBug[] = [];
  const bugSheet = workbook.getWorksheet("Bug");
  if (bugSheet) {
    const bugHeader = bugSheet.getRow(1);
    const b = {
      severity: requireHeader(bugHeader, "severity", ["嚴重度", "severity"]),
      bugId: requireHeader(bugHeader, "bugId", ["bugid", "bug_id", "bug id"]),
      relatedCaseNo: requireHeader(bugHeader, "relatedCaseNo", [
        "關聯編號",
        "related_case_no",
        "relatedCaseNo",
        "來源 Case",
        "來源Case",
        "source case"
      ]),
      title: requireHeader(bugHeader, "title", ["標題", "title"]),
      description: requireHeader(bugHeader, "description", ["描述", "description"]),
      suggestion: requireHeader(bugHeader, "suggestion", ["建議", "suggestion"]),
      status: optionalHeader(bugHeader, ["狀態", "status"])
    };
    for (let rowNo = 2; rowNo <= bugSheet.rowCount; rowNo += 1) {
      const row = bugSheet.getRow(rowNo);
      const bugId = text(row.getCell(b.bugId).value);
      if (!bugId) continue;
      bugs.push({
        severity: text(row.getCell(b.severity).value),
        bugId,
        relatedCaseNo: nullable(text(row.getCell(b.relatedCaseNo).value)),
        title: text(row.getCell(b.title).value),
        description: nullable(text(row.getCell(b.description).value)),
        suggestion: nullable(text(row.getCell(b.suggestion).value)),
        status: b.status ? text(row.getCell(b.status).value) || "OPEN" : "OPEN"
      });
    }
  }

  return {
    parserVersion: RESULT_XLSX_PARSER_VERSION,
    schemaVersion,
    cases,
    bugs
  };
};
