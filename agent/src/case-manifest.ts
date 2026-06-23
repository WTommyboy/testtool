import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";

export type CaseManifestCase = {
  order: number;
  rowNumber: number;
  groupId: string | null;
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
  structuredSteps?: CaseManifestStructuredStep[];
  currentCaseFile: string;
};

export type CaseManifestStructuredStep = {
  caseNo: string;
  stepNo: number;
  actionType: string;
  targetType: string | null;
  targetValue: string | null;
  inputValue: string | null;
  expected: string | null;
  requireApproval: boolean;
  timeoutMs: number;
  retry: number;
  role: string | null;
  actionId: string | null;
  evidenceRequirements: string[];
};

export type CaseManifest = {
  generatedAt: string;
  workbookPath: string;
  sheetName: string | null;
  currentCaseNo: string | null;
  currentCaseSelection: CaseManifestCurrentCaseSelection;
  totalCases: number;
  stepCount: number;
  groups: Array<{ id: string | null; name: string; caseCount: number; caseNos: string[] }>;
  cases: CaseManifestCase[];
  warnings: string[];
};

export type CaseManifestCurrentCaseSelection = {
  selectedCaseNo: string | null;
  requestedCaseNo: string | null;
  source: string | null;
  reason: "first_case" | "first_runnable_case" | "startup_instruction" | "requested_case_not_found" | "requested_case_has_result";
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
  groupId: number | null;
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

const TERMINAL_WORKBOOK_RESULT_STATUSES = new Set([
  "PASS",
  "FAIL",
  "BLOCKED",
  "PARTIAL",
  "SKIPPED",
  "MANUAL_PASS",
  "MANUAL_FAIL",
  "MANUAL_BLOCKED"
]);

const normalizeWorkbookResultStatus = (value: string | null | undefined): string =>
  value?.trim().toUpperCase().replace(/\s+/g, "_") ?? "";

const hasWorkbookTerminalResult = (item: Pick<CaseManifestCase, "resultStatus">): boolean => {
  const status = normalizeWorkbookResultStatus(item.resultStatus);
  return TERMINAL_WORKBOOK_RESULT_STATUSES.has(status);
};

const isUnrecognizedWorkbookResultStatus = (value: string | null | undefined): boolean => {
  const status = normalizeWorkbookResultStatus(value);
  return Boolean(status && status !== "PENDING" && status !== "MANUAL_PENDING" && !TERMINAL_WORKBOOK_RESULT_STATUSES.has(status));
};

const firstRunnableCase = (cases: CaseManifestCase[], minOrder = 1): CaseManifestCase | null =>
  cases.find((item) => item.order >= minOrder && !hasWorkbookTerminalResult(item)) ?? null;

const deriveGroupId = (groupId: string | null, groupName: string | null, caseNo: string): string | null => {
  const explicit = groupId?.trim();
  if (explicit) return explicit;
  const fromGroupName = groupName?.trim().match(/^([A-Za-z0-9_-]+)\s*[:：]/)?.[1];
  if (fromGroupName) return fromGroupName;
  return caseNo.match(/^[A-Za-z]+-([A-Za-z0-9]+)-\d+/)?.[1] ?? caseNo.match(/^([A-Za-z0-9]+)-\d+/)?.[1] ?? null;
};

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
  groupId: ["群組ID", "群組id", "group_id", "groupid", "group id"],
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

const numberCell = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const boolCell = (value: string): boolean => /^(true|1|yes|y|是)$/i.test(value.trim());

const evidenceList = (value: string): string[] =>
  value
    .split(/[,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

type StepColumns = {
  caseNo: number | null;
  stepNo: number | null;
  actionType: number | null;
  targetType: number | null;
  targetValue: number | null;
  inputValue: number | null;
  expected: number | null;
  requireApproval: number | null;
  timeoutMs: number | null;
  retry: number | null;
  role: number | null;
  actionId: number | null;
  evidenceRequirements: number | null;
};

const stepAliases: Record<keyof StepColumns, string[]> = {
  caseNo: ["案例編號", "測試案例", "case_no", "caseno", "caseid", "case_id"],
  stepNo: ["步驟序號", "step_no", "stepno", "step"],
  actionType: ["動作類型", "action_type", "actiontype", "action"],
  targetType: ["目標類型", "target_type", "targettype"],
  targetValue: ["目標值", "target_value", "targetvalue", "target"],
  inputValue: ["輸入值", "input_value", "inputvalue", "value"],
  expected: ["預期值", "expected", "expected_outcome", "expectedoutcome"],
  requireApproval: ["需要人工確認", "require_approval", "requireapproval", "approval"],
  timeoutMs: ["逾時毫秒", "timeout_ms", "timeoutms"],
  retry: ["重試次數", "retry", "retries"],
  role: ["role", "角色"],
  actionId: ["actionid", "action_id", "動作id", "動作ID"],
  evidenceRequirements: ["evidencerequirements", "evidence_requirements", "取證需求", "證據需求"]
};

const stepAliasSets = Object.fromEntries(
  Object.entries(stepAliases).map(([key, names]) => [key, new Set(names.map((name) => normalizeHeader(name)))])
) as Record<keyof StepColumns, Set<string>>;

const findStepColumn = (row: ExcelJS.Row, names: Set<string>): number | null => {
  let found: number | null = null;
  row.eachCell((cell, col) => {
    if (names.has(normalizeHeader(cell.value))) found = col;
  });
  return found;
};

const findArrayStepColumn = (row: string[], names: Set<string>): number | null => {
  for (let col = 1; col < row.length; col += 1) {
    if (names.has(normalizeHeader(row[col]))) return col;
  }
  return null;
};

const detectStepColumns = (row: ExcelJS.Row): StepColumns => Object.fromEntries(
  Object.keys(stepAliases).map((key) => [key, findStepColumn(row, stepAliasSets[key as keyof StepColumns])])
) as StepColumns;

const detectArrayStepColumns = (row: string[]): StepColumns => Object.fromEntries(
  Object.keys(stepAliases).map((key) => [key, findArrayStepColumn(row, stepAliasSets[key as keyof StepColumns])])
) as StepColumns;

const groupStructuredSteps = (steps: CaseManifestStructuredStep[]): Map<string, CaseManifestStructuredStep[]> => {
  const grouped = new Map<string, CaseManifestStructuredStep[]>();
  for (const step of steps) {
    const key = normalizeCaseNo(step.caseNo);
    const list = grouped.get(key) ?? [];
    list.push(step);
    grouped.set(key, list);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.stepNo - b.stepNo);
  }
  return grouped;
};

const parseStructuredStepsFromSheet = (workbook: ExcelJS.Workbook): Map<string, CaseManifestStructuredStep[]> => {
  const stepSheet = workbook.getWorksheet("步驟");
  if (!stepSheet) return new Map();
  const columns = detectStepColumns(stepSheet.getRow(1));
  if (!columns.caseNo || !columns.stepNo || !columns.actionType) return new Map();
  const steps: CaseManifestStructuredStep[] = [];
  for (let rowNumber = 2; rowNumber <= stepSheet.rowCount; rowNumber += 1) {
    const row = stepSheet.getRow(rowNumber);
    const caseNo = getCell(row, columns.caseNo);
    if (!caseNo) continue;
    steps.push({
      caseNo,
      stepNo: numberCell(getCell(row, columns.stepNo), 0),
      actionType: getCell(row, columns.actionType),
      targetType: nullable(getCell(row, columns.targetType)),
      targetValue: nullable(getCell(row, columns.targetValue)),
      inputValue: nullable(getCell(row, columns.inputValue)),
      expected: nullable(getCell(row, columns.expected)),
      requireApproval: boolCell(getCell(row, columns.requireApproval)),
      timeoutMs: numberCell(getCell(row, columns.timeoutMs), 10000),
      retry: numberCell(getCell(row, columns.retry), 0),
      role: nullable(getCell(row, columns.role)),
      actionId: nullable(getCell(row, columns.actionId)),
      evidenceRequirements: evidenceList(getCell(row, columns.evidenceRequirements))
    });
  }
  return groupStructuredSteps(steps);
};

const parseStructuredStepsFromRows = (sheets: MinimalXlsxSheet[]): Map<string, CaseManifestStructuredStep[]> => {
  const stepSheet = sheets.find((item) => item.name === "步驟");
  const headerRow = stepSheet?.rows[0];
  if (!stepSheet || !headerRow) return new Map();
  const columns = detectArrayStepColumns(headerRow);
  if (!columns.caseNo || !columns.stepNo || !columns.actionType) return new Map();
  const steps: CaseManifestStructuredStep[] = [];
  for (const row of stepSheet.rows.slice(1)) {
    const caseNo = getArrayCell(row, columns.caseNo);
    if (!caseNo) continue;
    steps.push({
      caseNo,
      stepNo: numberCell(getArrayCell(row, columns.stepNo), 0),
      actionType: getArrayCell(row, columns.actionType),
      targetType: nullable(getArrayCell(row, columns.targetType)),
      targetValue: nullable(getArrayCell(row, columns.targetValue)),
      inputValue: nullable(getArrayCell(row, columns.inputValue)),
      expected: nullable(getArrayCell(row, columns.expected)),
      requireApproval: boolCell(getArrayCell(row, columns.requireApproval)),
      timeoutMs: numberCell(getArrayCell(row, columns.timeoutMs), 10000),
      retry: numberCell(getArrayCell(row, columns.retry), 0),
      role: nullable(getArrayCell(row, columns.role)),
      actionId: nullable(getArrayCell(row, columns.actionId)),
      evidenceRequirements: evidenceList(getArrayCell(row, columns.evidenceRequirements))
    });
  }
  return groupStructuredSteps(steps);
};

const caseGroupKey = (id: string | null, name: string | null): string => `${id?.trim() || "NO_GROUP_ID"}::${name?.trim() || "未分組"}`;
const caseGroupName = (name: string | null): string => name?.trim() || "未分組";

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
  const grouped = new Map<string, { id: string | null; name: string; caseNos: string[] }>();
  for (const item of cases) {
    if (isUnrecognizedWorkbookResultStatus(item.resultStatus)) {
      warnings.push(`UNRECOGNIZED_RESULT_STATUS_IGNORED:${item.caseNo}:${item.resultStatus}`);
    }
    const key = caseGroupKey(item.groupId, item.groupName);
    const existing = grouped.get(key);
    if (existing) {
      existing.caseNos.push(item.caseNo);
    } else {
      grouped.set(key, { id: item.groupId, name: caseGroupName(item.groupName), caseNos: [item.caseNo] });
    }
  }

  const requestedCaseNo = options.preferredStartCaseNo?.trim() ? normalizeCaseNo(options.preferredStartCaseNo) : null;
  const requestedCaseMatch = requestedCaseNo ? findPreferredCase(cases, requestedCaseNo) : { caseItem: null, ambiguous: false };
  const requestedCase = requestedCaseMatch.caseItem;
  if (requestedCaseNo && !requestedCase) {
    warnings.push(`${requestedCaseMatch.ambiguous ? "START_CASE_AMBIGUOUS" : "START_CASE_NOT_FOUND"}:${requestedCaseNo}`);
  }
  let selectedCase: CaseManifestCase | null = null;
  let selectionReason: CaseManifestCurrentCaseSelection["reason"];
  if (requestedCase && hasWorkbookTerminalResult(requestedCase)) {
    warnings.push(`START_CASE_ALREADY_HAS_RESULT:${requestedCase.caseNo}`);
    selectedCase = firstRunnableCase(cases, requestedCase.order + 1) ?? firstRunnableCase(cases);
    selectionReason = "requested_case_has_result";
  } else if (requestedCase) {
    selectedCase = requestedCase;
    selectionReason = "startup_instruction";
  } else {
    selectedCase = firstRunnableCase(cases);
    selectionReason = requestedCaseNo
      ? "requested_case_not_found"
      : selectedCase?.order === cases[0]?.order
        ? "first_case"
        : "first_runnable_case";
  }
  const currentCaseSelection: CaseManifestCurrentCaseSelection = {
    selectedCaseNo: selectedCase?.caseNo ?? null,
    requestedCaseNo,
    source: requestedCaseNo ? options.preferredStartCaseSource ?? "startup_instruction" : null,
    reason: selectionReason
  };
  const stepCount = cases.reduce((sum, item) => sum + (item.structuredSteps?.length ?? 0), 0);

  const manifest: CaseManifest = {
    generatedAt: new Date().toISOString(),
    workbookPath: xlsxPath,
    sheetName,
    currentCaseNo: selectedCase?.caseNo ?? null,
    currentCaseSelection,
    totalCases: cases.length,
    stepCount,
    groups: [...grouped.values()].map((group) => ({
      id: group.id,
      name: group.name,
      caseCount: group.caseNos.length,
      caseNos: group.caseNos
    })),
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
  const structuredStepsByCase = parseStructuredStepsFromRows(sheets);
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
  let currentGroupId: string | null = null;
  let currentGroup: string | null = null;
  for (let rowIndex = header.rowIndex + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex];
    const groupIdText = nullable(getArrayCell(row, header.columns.groupId));
    const groupText = nullable(getArrayCell(row, header.columns.groupName));
    const caseNo = getArrayCell(row, header.columns.caseNo);
    if (!caseNo) {
      if (groupIdText) currentGroupId = groupIdText;
      if (groupText) currentGroup = groupText;
      continue;
    }

    currentGroupId = groupIdText ?? currentGroupId;
    currentGroup = groupText ?? currentGroup;
    const groupId = deriveGroupId(currentGroupId, currentGroup, caseNo);
    const caseFileName = `${String(cases.length + 1).padStart(3, "0")}-${safeFilePart(caseNo)}.json`;
    const currentCaseFile = path.join(casesDir, caseFileName);
    const item: CaseManifestCase = {
      order: cases.length + 1,
      rowNumber: rowIndex + 1,
      groupId,
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
      structuredSteps: structuredStepsByCase.get(normalizeCaseNo(caseNo)) ?? [],
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
  if (!header.columns.groupId) warnings.push("GROUP_ID_COLUMN_NOT_FOUND");
  if (!header.columns.caseTitle) warnings.push("CASE_TITLE_COLUMN_NOT_FOUND");
  const structuredStepsByCase = parseStructuredStepsFromSheet(workbook);

  const casesDir = path.join(outputDir, "cases");
  fs.mkdirSync(casesDir, { recursive: true });

  const cases: CaseManifestCase[] = [];
  let currentGroupId: string | null = null;
  let currentGroup: string | null = null;
  for (let rowNumber = header.rowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const groupIdText = nullable(getCell(row, header.columns.groupId));
    const groupText = nullable(getCell(row, header.columns.groupName));
    const caseNo = getCell(row, header.columns.caseNo);

    if (!caseNo) {
      if (groupIdText) currentGroupId = groupIdText;
      if (groupText) currentGroup = groupText;
      continue;
    }

    currentGroupId = groupIdText ?? currentGroupId;
    currentGroup = groupText ?? currentGroup;
    const groupId = deriveGroupId(currentGroupId, currentGroup, caseNo);
    const caseFileName = `${String(cases.length + 1).padStart(3, "0")}-${safeFilePart(caseNo)}.json`;
    const currentCaseFile = path.join(casesDir, caseFileName);
    const item: CaseManifestCase = {
      order: cases.length + 1,
      rowNumber,
      groupId,
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
      structuredSteps: structuredStepsByCase.get(normalizeCaseNo(caseNo)) ?? [],
      currentCaseFile
    };
    cases.push(item);
    fs.writeFileSync(currentCaseFile, `${JSON.stringify(item, null, 2)}\n`);
  }

  return writeManifestFiles(xlsxPath, outputDir, sheet.name, cases, warnings, options);
};
