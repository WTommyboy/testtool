import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

export type ResultParserAdapter = {
  schemaVersion: string;
  adapterVersion: string;
  parser: string;
  sheets: {
    index: string;
    cases: string;
    bugs: string;
  };
  headers: {
    cases: string[];
    bugs: string[];
    optionalBugHeaders?: string[];
  };
  detailJsonRequiredFields: Record<string, string[]>;
};

export type ResultContractIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  context?: Record<string, unknown>;
};

export type ResultContractReport = {
  schemaVersion: "result-contract-check-v1";
  generatedAt: string;
  status: "ok" | "error";
  adapterVersion: string;
  issues: ResultContractIssue[];
};

const defaultAdapter: ResultParserAdapter = {
  schemaVersion: "result-parser-adapter-v1",
  adapterVersion: "bi-result-adapter-mvp-v1",
  parser: "result-xlsx-parser",
  sheets: {
    index: "索引",
    cases: "測試案例",
    bugs: "Bug"
  },
  headers: {
    cases: ["群組ID", "群組", "編號", "測試項目", "測試類型", "執行方式", "結果", "失敗分類", "詳細紀錄JSON"],
    bugs: ["嚴重度", "Bug ID", "關聯編號", "標題", "描述", "建議", "狀態"],
    optionalBugHeaders: ["Evidence"]
  },
  detailJsonRequiredFields: {
    PASS: ["測試目的", "設定條件", "預期行為", "實際行為"],
    FAIL: ["測試目的", "設定條件", "預期行為", "實際行為", "錯誤原因", "根因層級", "驗證方法", "RD 分派"],
    BLOCKED: ["blocked_reason"],
    PARTIAL: ["部分符合的子項清單", "不符的子項清單"]
  }
};

const adapterPathCandidates = (): string[] => [
  path.resolve(__dirname, "../../domain-packs/BI/result_parser_adapter.json"),
  path.resolve(process.cwd(), "domain-packs/BI/result_parser_adapter.json"),
  path.resolve(process.cwd(), "../domain-packs/BI/result_parser_adapter.json")
];

const asStringArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length === value.length ? items : null;
};

export const loadResultParserAdapter = (): ResultParserAdapter => {
  const filePath = adapterPathCandidates().find((candidate) => fs.existsSync(candidate));
  if (!filePath) return defaultAdapter;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<ResultParserAdapter>;
    return {
      ...defaultAdapter,
      ...parsed,
      sheets: {
        ...defaultAdapter.sheets,
        ...(parsed.sheets ?? {})
      },
      headers: {
        ...defaultAdapter.headers,
        ...(parsed.headers ?? {}),
        cases: asStringArray(parsed.headers?.cases) ?? defaultAdapter.headers.cases,
        bugs: asStringArray(parsed.headers?.bugs) ?? defaultAdapter.headers.bugs,
        optionalBugHeaders: asStringArray(parsed.headers?.optionalBugHeaders) ?? defaultAdapter.headers.optionalBugHeaders
      },
      detailJsonRequiredFields: {
        ...defaultAdapter.detailJsonRequiredFields,
        ...(parsed.detailJsonRequiredFields ?? {})
      }
    };
  } catch {
    return defaultAdapter;
  }
};

const text = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (typeof value === "object") {
    const rich = value as { richText?: Array<{ text?: string }> };
    if (Array.isArray(rich.richText)) return rich.richText.map((item) => item.text ?? "").join("").trim();
  }
  return String(value).trim();
};

const normalize = (value: unknown): string => text(value).toLowerCase().replace(/\s+/g, "");

const headerValues = (row: ExcelJS.Row): string[] => {
  const values: string[] = [];
  row.eachCell((cell) => values.push(text(cell.value)));
  return values;
};

const findHeaderIndex = (headers: string[], name: string): number => {
  const target = normalize(name);
  return headers.findIndex((header) => normalize(header) === target);
};

const requireHeaders = (
  issues: ResultContractIssue[],
  sheetName: string,
  actual: string[],
  expected: string[]
): void => {
  for (const header of expected) {
    if (findHeaderIndex(actual, header) === -1) {
      issues.push({
        severity: "error",
        code: "RESULT_XLSX_HEADER_MISSING",
        message: `${sheetName} sheet is missing required header: ${header}`,
        context: { sheetName, header, actualHeaders: actual }
      });
    }
  }
};

const parseDetail = (raw: string): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

export const validateResultWorkbookContract = async (
  filePath: string,
  adapter = loadResultParserAdapter()
): Promise<ResultContractReport> => {
  const issues: ResultContractIssue[] = [];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const caseSheet = workbook.getWorksheet(adapter.sheets.cases);
  const bugSheet = workbook.getWorksheet(adapter.sheets.bugs);
  if (!workbook.getWorksheet(adapter.sheets.index)) {
    issues.push({ severity: "error", code: "RESULT_XLSX_SHEET_MISSING", message: `Missing sheet: ${adapter.sheets.index}` });
  }
  if (!caseSheet) {
    issues.push({ severity: "error", code: "RESULT_XLSX_SHEET_MISSING", message: `Missing sheet: ${adapter.sheets.cases}` });
  }
  if (!bugSheet) {
    issues.push({ severity: "error", code: "RESULT_XLSX_SHEET_MISSING", message: `Missing sheet: ${adapter.sheets.bugs}` });
  }

  if (caseSheet) {
    const headers = headerValues(caseSheet.getRow(1));
    requireHeaders(issues, adapter.sheets.cases, headers, adapter.headers.cases);
    const caseNoIdx = findHeaderIndex(headers, "編號");
    const statusIdx = findHeaderIndex(headers, "結果");
    const detailIdx = findHeaderIndex(headers, "詳細紀錄JSON");
    if (caseNoIdx !== -1 && statusIdx !== -1 && detailIdx !== -1) {
      for (let rowNo = 2; rowNo <= caseSheet.rowCount; rowNo += 1) {
        const row = caseSheet.getRow(rowNo);
        const caseNo = text(row.getCell(caseNoIdx + 1).value);
        if (!caseNo) continue;
        const status = text(row.getCell(statusIdx + 1).value).toUpperCase();
        const detail = parseDetail(text(row.getCell(detailIdx + 1).value));
        const required = adapter.detailJsonRequiredFields[status] ?? [];
        if (!detail) {
          issues.push({
            severity: "error",
            code: "RESULT_XLSX_DETAIL_JSON_INVALID",
            message: `${caseNo} detail_json is missing or invalid JSON object.`,
            context: { rowNo, caseNo, status }
          });
          continue;
        }
        for (const field of required) {
          if (!Object.prototype.hasOwnProperty.call(detail, field)) {
            issues.push({
              severity: "error",
              code: "RESULT_XLSX_DETAIL_FIELD_MISSING",
              message: `${caseNo} ${status} detail_json is missing required field: ${field}`,
              context: { rowNo, caseNo, status, field }
            });
          }
        }
      }
    }
  }

  if (bugSheet) {
    requireHeaders(issues, adapter.sheets.bugs, headerValues(bugSheet.getRow(1)), adapter.headers.bugs);
  }

  return {
    schemaVersion: "result-contract-check-v1",
    generatedAt: new Date().toISOString(),
    status: issues.some((item) => item.severity === "error") ? "error" : "ok",
    adapterVersion: adapter.adapterVersion,
    issues
  };
};
