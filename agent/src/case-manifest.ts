import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";

export type CaseManifestCase = {
  order: number;
  rowNumber: number;
  groupName: string | null;
  caseNo: string;
  caseTitle: string | null;
  testType: string | null;
  executionMethod: string | null;
  riskLevel: string | null;
  testTarget: string | null;
  cleanupChecklist: string | null;
  preconditions: string | null;
  stepsSummary: string | null;
  expected: string | null;
  resultStatus: string | null;
  testDate: string | null;
  detailJson: string | null;
  validationMethod: string | null;
  currentCaseFile: string;
};

export type CaseManifest = {
  generatedAt: string;
  workbookPath: string;
  sheetName: string | null;
  currentCaseNo: string | null;
  currentCaseSelection: CaseManifestCurrentCaseSelection;
  totalCases: number;
  groups: Array<{ name: string; caseCount: number; caseNos: string[] }>;
  cases: CaseManifestCase[];
  warnings: string[];
};

export type CaseManifestCurrentCaseSelection = {
  selectedCaseNo: string | null;
  requestedCaseNo: string | null;
  source: string | null;
  reason: "first_case" | "startup_instruction" | "requested_case_not_found";
};

export type CaseManifestResult = {
  manifestPath: string | null;
  currentCasePath: string | null;
  casesDir: string | null;
  currentCaseNo: string | null;
  currentCaseSelection: CaseManifestCurrentCaseSelection | null;
  cases: CaseManifestCase[];
  totalCases: number;
  warnings: string[];
};

export type CaseManifestOptions = {
  preferredStartCaseNo?: string | null;
  preferredStartCaseSource?: string | null;
};

type HeaderColumns = {
  groupName: number | null;
  caseNo: number | null;
  caseTitle: number | null;
  testType: number | null;
  executionMethod: number | null;
  riskLevel: number | null;
  testTarget: number | null;
  cleanupChecklist: number | null;
  preconditions: number | null;
  stepsSummary: number | null;
  expected: number | null;
  resultStatus: number | null;
  testDate: number | null;
  detailJson: number | null;
  validationMethod: number | null;
};

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const rich = value as { richText?: Array<{ text?: string }>; text?: string; result?: unknown };
    if (Array.isArray(rich.richText)) {
      return rich.richText.map((item) => item.text ?? "").join("").trim();
    }
    if (typeof rich.text === "string") return rich.text.trim();
    if (rich.result !== undefined) return cellText(rich.result);
  }
  return String(value).trim();
};

const normalizeHeader = (value: unknown): string => {
  return cellText(value)
    .replace(/\s+/g, "")
    .replace(/[：:]/g, "")
    .toLowerCase();
};

const nullable = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const safeFilePart = (value: string): string => {
  const safe = value.replace(/[\\/:"*?<>|#%{}[\]^~`;\s]+/g, "_").replace(/^_+|_+$/g, "");
  return safe || "case";
};

const normalizeCaseNo = (value: string): string => value.trim().replace(/\s+/g, "").toUpperCase();

const findPreferredCase = (cases: CaseManifestCase[], preferred: string): { caseItem: CaseManifestCase | null; ambiguous: boolean } => {
  const target = normalizeCaseNo(preferred);
  const exact = cases.find((item) => normalizeCaseNo(item.caseNo) === target);
  if (exact) return { caseItem: exact, ambiguous: false };
  const demoTarget = target.startsWith("DEMO-") ? target.replace(/^DEMO-/, "") : `DEMO-${target}`;
  const demo = cases.find((item) => normalizeCaseNo(item.caseNo) === demoTarget || normalizeCaseNo(item.caseNo).replace(/^DEMO-/, "") === target);
  if (demo) return { caseItem: demo, ambiguous: false };
  const suffixMatches = cases.filter((item) => normalizeCaseNo(item.caseNo).endsWith(`-${target}`));
  return suffixMatches.length === 1 ? { caseItem: suffixMatches[0] ?? null, ambiguous: false } : { caseItem: null, ambiguous: suffixMatches.length > 1 };
};

const aliases: Record<keyof HeaderColumns, string[]> = {
  groupName: ["群組", "group", "groupname", "group_name", "分類", "章節"],
  caseNo: ["編號", "案例編號", "case_no", "caseno", "caseid", "case_id", "id"],
  caseTitle: ["測試項目", "測試案例", "案例名稱", "case_title", "title", "name"],
  testType: ["測試類型", "test_type", "type"],
  executionMethod: ["執行方式", "execution_method", "executionmethod", "runner"],
  riskLevel: ["風險等級", "risk_level", "risklevel", "risk"],
  testTarget: ["測試標的", "test_target", "testtarget", "target"],
  cleanupChecklist: ["狀態清理", "狀態清理checklist", "cleanup", "cleanup_checklist", "前置清理"],
  preconditions: ["前置條件", "前提條件", "preconditions", "precondition", "setup"],
  stepsSummary: ["執行步驟", "步驟", "操作步驟", "steps", "teststeps", "step"],
  expected: ["預期結果", "expected", "expectedresult", "expectation"],
  resultStatus: ["結果", "result", "status", "result_status"],
  testDate: ["測試日", "測試日期", "test_date", "testdate", "date"],
  detailJson: ["詳細紀錄json", "詳細紀錄JSON", "detail_json", "detailjson", "details"],
  validationMethod: ["驗證方法", "取證方法", "verification", "validation", "evidence"]
};

const aliasSets = Object.fromEntries(
  Object.entries(aliases).map(([key, names]) => [key, new Set(names.map((name) => normalizeHeader(name)))])
) as Record<keyof HeaderColumns, Set<string>>;

const findColumn = (row: ExcelJS.Row, names: Set<string>): number | null => {
  let found: number | null = null;
  row.eachCell((cell, col) => {
    if (names.has(normalizeHeader(cell.value))) found = col;
  });
  return found;
};

const detectHeader = (sheet: ExcelJS.Worksheet): { rowNumber: number; columns: HeaderColumns } | null => {
  const maxRows = Math.min(sheet.rowCount, 12);
  for (let rowNumber = 1; rowNumber <= maxRows; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const columns = Object.fromEntries(
      Object.keys(aliases).map((key) => [key, findColumn(row, aliasSets[key as keyof HeaderColumns])])
    ) as HeaderColumns;
    if (columns.caseNo) {
      return { rowNumber, columns };
    }
  }
  return null;
};

const getCell = (row: ExcelJS.Row, column: number | null): string => {
  return column ? cellText(row.getCell(column).value) : "";
};

const caseGroupKey = (name: string | null): string => name?.trim() || "未分組";

type MinimalXlsxSheet = {
  name: string;
  rows: string[][];
};

const decodeXml = (value: string): string => {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(Number.parseInt(num, 10)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
};

const getXmlAttr = (attrs: string, name: string): string | undefined => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attrs.match(new RegExp(`(?:^|\\s)${escapedName}="([^"]*)"`, "i"));
  return match ? decodeXml(match[1] ?? "") : undefined;
};

const colIndexFromCellRef = (ref: string | undefined): number | undefined => {
  const col = ref?.match(/[A-Z]+/i)?.[0].toUpperCase();
  if (!col) return undefined;
  return [...col].reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0);
};

const textNodes = (xml: string): string[] => {
  return [...xml.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((match) =>
    decodeXml(match[1] ?? "")
  );
};

const valueNode = (xml: string): string | undefined => {
  const match = xml.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/);
  return match ? decodeXml(match[1] ?? "") : undefined;
};

const parseSharedStrings = (xml: string | undefined): string[] => {
  if (!xml) return [];
  return [...xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((match) =>
    textNodes(match[1] ?? "").join("")
  );
};

const parseCellValue = (attrs: string, body: string, sharedStrings: string[]): string => {
  const type = getXmlAttr(attrs, "t");
  const inlineText = textNodes(body);
  if (type === "inlineStr" || inlineText.length > 0) return inlineText.join("").trim();

  const rawValue = valueNode(body) ?? "";
  if (type === "s") return (sharedStrings[Number(rawValue)] ?? "").trim();
  return rawValue.trim();
};

const parseWorksheetRows = (xml: string, sharedStrings: string[]): string[][] => {
  const rows: string[][] = [];
  const rowRegex = /<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g;
  for (const rowMatch of xml.matchAll(rowRegex)) {
    const row: string[] = [];
    const body = rowMatch[1] ?? "";
    const cellRegex = /<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g;
    for (const cellMatch of body.matchAll(cellRegex)) {
      const attrs = cellMatch[1] ?? "";
      const col = colIndexFromCellRef(getXmlAttr(attrs, "r"));
      if (!col) continue;
      row[col] = parseCellValue(attrs, cellMatch[2] ?? "", sharedStrings);
    }
    rows.push(row);
  }
  return rows;
};

const normalizeWorksheetPath = (target: string | undefined, fallbackIndex: number): string => {
  if (!target) return `xl/worksheets/sheet${fallbackIndex}.xml`;
  if (target.startsWith("/")) return target.slice(1);
  if (target.startsWith("xl/")) return target;
  return `xl/${target.replace(/^\.\//, "")}`;
};

const loadMinimalXlsxSheets = async (filePath: string): Promise<MinimalXlsxSheet[]> => {
  const zip = await JSZip.loadAsync(await fs.promises.readFile(filePath));
  const readText = async (file: string): Promise<string | undefined> => zip.file(file)?.async("string");
  const workbookXml = await readText("xl/workbook.xml");
  if (!workbookXml) throw new Error("WORKBOOK_XML_NOT_FOUND");

  const relsXml = await readText("xl/_rels/workbook.xml.rels");
  const rels = new Map<string, string>();
  if (relsXml) {
    for (const relMatch of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const attrs = relMatch[1] ?? "";
      const id = getXmlAttr(attrs, "Id");
      const target = getXmlAttr(attrs, "Target");
      if (id && target) rels.set(id, target);
    }
  }

  const sharedStrings = parseSharedStrings(await readText("xl/sharedStrings.xml"));
  const sheets: MinimalXlsxSheet[] = [];
  let fallbackIndex = 1;
  for (const sheetMatch of workbookXml.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)) {
    const attrs = sheetMatch[1] ?? "";
    const name = getXmlAttr(attrs, "name") ?? `sheet${fallbackIndex}`;
    const relId = getXmlAttr(attrs, "r:id");
    const sheetPath = normalizeWorksheetPath(relId ? rels.get(relId) : undefined, fallbackIndex);
    const worksheetXml = await readText(sheetPath);
    if (worksheetXml) {
      sheets.push({ name, rows: parseWorksheetRows(worksheetXml, sharedStrings) });
    }
    fallbackIndex += 1;
  }
  return sheets;
};

const findArrayColumn = (row: string[], names: Set<string>): number | null => {
  for (let col = 1; col < row.length; col += 1) {
    if (names.has(normalizeHeader(row[col]))) return col;
  }
  return null;
};

const detectArrayHeader = (rows: string[][]): { rowIndex: number; columns: HeaderColumns } | null => {
  const maxRows = Math.min(rows.length, 12);
  for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const columns = Object.fromEntries(
      Object.keys(aliases).map((key) => [key, findArrayColumn(row, aliasSets[key as keyof HeaderColumns])])
    ) as HeaderColumns;
    if (columns.caseNo) return { rowIndex, columns };
  }
  return null;
};

const getArrayCell = (row: string[] | undefined, column: number | null): string => {
  if (!row || !column) return "";
  return cellText(row[column]);
};

const writeManifestFiles = (
  xlsxPath: string,
  outputDir: string,
  sheetName: string | null,
  cases: CaseManifestCase[],
  warnings: string[],
  options: CaseManifestOptions = {}
): CaseManifestResult => {
  const grouped = new Map<string, string[]>();
  for (const item of cases) {
    const key = caseGroupKey(item.groupName);
    grouped.set(key, [...(grouped.get(key) ?? []), item.caseNo]);
  }

  const requestedCaseNo = options.preferredStartCaseNo?.trim() ? normalizeCaseNo(options.preferredStartCaseNo) : null;
  const requestedCaseMatch = requestedCaseNo ? findPreferredCase(cases, requestedCaseNo) : { caseItem: null, ambiguous: false };
  const requestedCase = requestedCaseMatch.caseItem;
  const selectedCase = requestedCase ?? cases[0] ?? null;
  if (requestedCaseNo && !requestedCase) {
    warnings.push(`${requestedCaseMatch.ambiguous ? "START_CASE_AMBIGUOUS" : "START_CASE_NOT_FOUND"}:${requestedCaseNo}`);
  }
  const currentCaseSelection: CaseManifestCurrentCaseSelection = {
    selectedCaseNo: selectedCase?.caseNo ?? null,
    requestedCaseNo,
    source: requestedCaseNo ? options.preferredStartCaseSource ?? "startup_instruction" : null,
    reason: requestedCase ? "startup_instruction" : requestedCaseNo ? "requested_case_not_found" : "first_case"
  };

  const manifest: CaseManifest = {
    generatedAt: new Date().toISOString(),
    workbookPath: xlsxPath,
    sheetName,
    currentCaseNo: selectedCase?.caseNo ?? null,
    currentCaseSelection,
    totalCases: cases.length,
    groups: [...grouped.entries()].map(([name, caseNos]) => ({ name, caseCount: caseNos.length, caseNos })),
    cases,
    warnings
  };

  const manifestPath = path.join(outputDir, "case-manifest.json");
  const currentCasePath = path.join(outputDir, "current-case.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (selectedCase) {
    fs.writeFileSync(currentCasePath, `${JSON.stringify(selectedCase, null, 2)}\n`);
  }

  return {
    manifestPath,
    currentCasePath: selectedCase ? currentCasePath : null,
    casesDir: path.join(outputDir, "cases"),
    currentCaseNo: selectedCase?.caseNo ?? null,
    currentCaseSelection,
    cases,
    totalCases: cases.length,
    warnings
  };
};

const writeMinimalCaseManifest = async (
  xlsxPath: string,
  outputDir: string,
  warnings: string[],
  options: CaseManifestOptions = {}
): Promise<CaseManifestResult> => {
  const sheets = await loadMinimalXlsxSheets(xlsxPath);
  const sheet = sheets.find((item) => item.name === "測試案例") ?? sheets[0];
  if (!sheet) {
    return { manifestPath: null, currentCasePath: null, casesDir: null, currentCaseNo: null, currentCaseSelection: null, cases: [], totalCases: 0, warnings: [...warnings, "XLSX_NO_WORKSHEET"] };
  }

  const header = detectArrayHeader(sheet.rows);
  if (!header) {
    return { manifestPath: null, currentCasePath: null, casesDir: null, currentCaseNo: null, currentCaseSelection: null, cases: [], totalCases: 0, warnings: [...warnings, "CASE_HEADER_NOT_FOUND"] };
  }

  const casesDir = path.join(outputDir, "cases");
  fs.mkdirSync(casesDir, { recursive: true });

  const cases: CaseManifestCase[] = [];
  let currentGroup: string | null = null;
  for (let rowIndex = header.rowIndex + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex];
    const groupText = nullable(getArrayCell(row, header.columns.groupName));
    const caseNo = getArrayCell(row, header.columns.caseNo);
    if (!caseNo) {
      if (groupText) currentGroup = groupText;
      continue;
    }

    currentGroup = groupText ?? currentGroup;
    const caseFileName = `${String(cases.length + 1).padStart(3, "0")}-${safeFilePart(caseNo)}.json`;
    const currentCaseFile = path.join(casesDir, caseFileName);
    const item: CaseManifestCase = {
      order: cases.length + 1,
      rowNumber: rowIndex + 1,
      groupName: currentGroup,
      caseNo,
      caseTitle: nullable(getArrayCell(row, header.columns.caseTitle)),
      testType: nullable(getArrayCell(row, header.columns.testType)),
      executionMethod: nullable(getArrayCell(row, header.columns.executionMethod)),
      riskLevel: nullable(getArrayCell(row, header.columns.riskLevel)),
      testTarget: nullable(getArrayCell(row, header.columns.testTarget)),
      cleanupChecklist: nullable(getArrayCell(row, header.columns.cleanupChecklist)),
      preconditions: nullable(getArrayCell(row, header.columns.preconditions)),
      stepsSummary: nullable(getArrayCell(row, header.columns.stepsSummary)),
      expected: nullable(getArrayCell(row, header.columns.expected)),
      resultStatus: nullable(getArrayCell(row, header.columns.resultStatus)),
      testDate: nullable(getArrayCell(row, header.columns.testDate)),
      detailJson: nullable(getArrayCell(row, header.columns.detailJson)),
      validationMethod: nullable(getArrayCell(row, header.columns.validationMethod)),
      currentCaseFile
    };
    cases.push(item);
    fs.writeFileSync(currentCaseFile, `${JSON.stringify(item, null, 2)}\n`);
  }

  return writeManifestFiles(xlsxPath, outputDir, sheet.name, cases, warnings, options);
};

export const writeCaseManifest = async (
  xlsxPath: string | undefined,
  outputDir: string,
  options: CaseManifestOptions = {}
): Promise<CaseManifestResult> => {
  const warnings: string[] = [];
  if (!xlsxPath) {
    return { manifestPath: null, currentCasePath: null, casesDir: null, currentCaseNo: null, currentCaseSelection: null, cases: [], totalCases: 0, warnings: ["XLSX_INPUT_MISSING"] };
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(xlsxPath);
  } catch (error) {
    try {
      return await writeMinimalCaseManifest(
        xlsxPath,
        outputDir,
        [`EXCELJS_READ_FALLBACK:${error instanceof Error ? error.message : String(error)}`],
        options
      );
    } catch (fallbackError) {
      return {
        manifestPath: null,
        currentCasePath: null,
        casesDir: null,
        currentCaseNo: null,
        currentCaseSelection: null,
        cases: [],
        totalCases: 0,
        warnings: [
          `XLSX_READ_FAILED:${error instanceof Error ? error.message : String(error)}`,
          `MINIMAL_XLSX_READ_FAILED:${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
        ]
      };
    }
  }

  const sheet = workbook.getWorksheet("測試案例") ?? workbook.worksheets[0];
  if (!sheet) {
    return { manifestPath: null, currentCasePath: null, casesDir: null, currentCaseNo: null, currentCaseSelection: null, cases: [], totalCases: 0, warnings: ["XLSX_NO_WORKSHEET"] };
  }

  const header = detectHeader(sheet);
  if (!header) {
    return { manifestPath: null, currentCasePath: null, casesDir: null, currentCaseNo: null, currentCaseSelection: null, cases: [], totalCases: 0, warnings: ["CASE_HEADER_NOT_FOUND"] };
  }

  if (!header.columns.groupName) warnings.push("GROUP_COLUMN_NOT_FOUND");
  if (!header.columns.caseTitle) warnings.push("CASE_TITLE_COLUMN_NOT_FOUND");

  const casesDir = path.join(outputDir, "cases");
  fs.mkdirSync(casesDir, { recursive: true });

  const cases: CaseManifestCase[] = [];
  let currentGroup: string | null = null;
  for (let rowNumber = header.rowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const groupText = nullable(getCell(row, header.columns.groupName));
    const caseNo = getCell(row, header.columns.caseNo);

    if (!caseNo) {
      if (groupText) currentGroup = groupText;
      continue;
    }

    currentGroup = groupText ?? currentGroup;
    const caseFileName = `${String(cases.length + 1).padStart(3, "0")}-${safeFilePart(caseNo)}.json`;
    const currentCaseFile = path.join(casesDir, caseFileName);
    const item: CaseManifestCase = {
      order: cases.length + 1,
      rowNumber,
      groupName: currentGroup,
      caseNo,
      caseTitle: nullable(getCell(row, header.columns.caseTitle)),
      testType: nullable(getCell(row, header.columns.testType)),
      executionMethod: nullable(getCell(row, header.columns.executionMethod)),
      riskLevel: nullable(getCell(row, header.columns.riskLevel)),
      testTarget: nullable(getCell(row, header.columns.testTarget)),
      cleanupChecklist: nullable(getCell(row, header.columns.cleanupChecklist)),
      preconditions: nullable(getCell(row, header.columns.preconditions)),
      stepsSummary: nullable(getCell(row, header.columns.stepsSummary)),
      expected: nullable(getCell(row, header.columns.expected)),
      resultStatus: nullable(getCell(row, header.columns.resultStatus)),
      testDate: nullable(getCell(row, header.columns.testDate)),
      detailJson: nullable(getCell(row, header.columns.detailJson)),
      validationMethod: nullable(getCell(row, header.columns.validationMethod)),
      currentCaseFile
    };
    cases.push(item);
    fs.writeFileSync(currentCaseFile, `${JSON.stringify(item, null, 2)}\n`);
  }

  return writeManifestFiles(xlsxPath, outputDir, sheet.name, cases, warnings, options);
};
