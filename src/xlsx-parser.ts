import fs from "node:fs";
import ExcelJS from "exceljs";
import JSZip from "jszip";

export type ParsedCase = {
  caseNo: string;
  groupId?: string;
  groupName?: string;
  caseTitle: string;
  testType?: string;
  precondition?: string;
  stepText?: string;
  expectedResult?: string;
  executionMethodRaw?: string;
  executionType: "auto" | "semi" | "manual";
  resultStatusRaw?: string;
  failCategory?: string;
  testDate?: string;
  validationMethod?: string;
  detailJson?: unknown;
};

export type ParsedStep = {
  caseNo: string;
  stepNo: number;
  actionType: string;
  targetType?: string;
  targetValue?: string;
  inputValue?: string;
  expected?: string;
  requireApproval: boolean;
  timeoutMs: number;
  retry: number;
};

const CASE_FALLBACK_COL = {
  groupId: 2,
  groupName: 3,
  caseNo: 4,
  testType: 5,
  caseTitle: 6,
  precondition: 10,
  stepText: 11,
  expectedResult: 12,
  executionType: 14
} as const;

const extractText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (typeof value === "object") {
    const rich = value as { richText?: Array<{ text?: string }> };
    if (Array.isArray(rich.richText)) {
      return rich.richText.map((x) => x.text ?? "").join("").trim();
    }
  }
  return String(value).trim();
};

const normalizeHeader = (value: unknown): string => extractText(value).toLowerCase();

const normalizeExecutionType = (value: unknown): "auto" | "semi" | "manual" => {
  const raw = extractText(value).toLowerCase();
  if (["manual", "手動", "人工"].includes(raw)) return "manual";
  if (["auto", "playwright mcp", "playwright", "自動"].includes(raw)) return "auto";
  if (["semi", "半自動", "claude in chrome"].includes(raw)) return "semi";
  return "auto";
};

const deriveGroupId = (groupId: string, groupName: string, caseNo: string): string => {
  if (groupId) return groupId;
  const fromGroupName = groupName.match(/^([A-Za-z0-9_-]+)\s*[:：]/)?.[1];
  if (fromGroupName) return fromGroupName;
  return caseNo.match(/^[A-Za-z]+-([A-Za-z0-9]+)-\d+/)?.[1] ?? caseNo.match(/^([A-Za-z0-9]+)-\d+/)?.[1] ?? "";
};

const getCellValue = (row: ExcelJS.Row, index: number): string => extractText(row.getCell(index).value);

const headerIndex = (headerMap: Map<string, number>, ...names: string[]): number | undefined => {
  for (const n of names) {
    const idx = headerMap.get(n.toLowerCase());
    if (idx !== undefined) return idx;
  }
  return undefined;
};

export const parseTestcaseXlsx = async (
  filePath: string
): Promise<{ cases: ParsedCase[]; steps: ParsedStep[] }> => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`XLSX_NOT_FOUND: ${filePath}`);
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
  } catch {
    return parseMinimalXlsx(filePath);
  }

  const caseSheet = workbook.getWorksheet("測試案例") ?? workbook.worksheets[0];
  const stepSheet = workbook.getWorksheet("步驟");
  if (!caseSheet) throw new Error("CASE_SHEET_NOT_FOUND");

  const caseHeaderRow = caseSheet.getRow(1);
  const caseHeaderMap = new Map<string, number>();
  caseHeaderRow.eachCell((cell, col) => caseHeaderMap.set(normalizeHeader(cell.value), col));

  const caseNoIdx = headerIndex(caseHeaderMap, "caseno", "case_no", "測試案例", "案例編號", "編號", "case");
  const groupIdIdx = headerIndex(caseHeaderMap, "groupid", "group_id", "group id", "群組id", "群組ID");
  const groupNameIdx = headerIndex(caseHeaderMap, "group", "group_name", "群組", "分類");
  const testTypeIdx = headerIndex(caseHeaderMap, "testtype", "test_type", "測試類型", "類型");
  const caseTitleIdx = headerIndex(caseHeaderMap, "casetitle", "case_title", "測試項目", "測試案例名稱", "title");
  const preconditionIdx = headerIndex(caseHeaderMap, "precondition", "condition", "前置條件", "設定條件");
  const executionTypeIdx = headerIndex(caseHeaderMap, "executiontype", "execution_type", "執行方式");
  const resultStatusIdx = headerIndex(caseHeaderMap, "result", "status", "resultstatus", "result_status", "結果");
  const failCategoryIdx = headerIndex(caseHeaderMap, "failcategory", "fail_category", "verdictreason", "失敗分類");
  const testDateIdx = headerIndex(caseHeaderMap, "testdate", "test_date", "測試日", "測試日期");
  const validationMethodIdx = headerIndex(caseHeaderMap, "validationmethod", "validation_method", "verification", "驗證方法");
  const expectedResultIdx = headerIndex(caseHeaderMap, "expectedresult", "expected_result", "預期結果");
  const detailJsonIdx = headerIndex(caseHeaderMap, "detailjson", "detail_json", "詳細紀錄json");
  const stepsTextIdx = headerIndex(caseHeaderMap, "steps", "步驟", "測試步驟");

  const resolvedCaseNoIdx = caseNoIdx ?? CASE_FALLBACK_COL.caseNo;
  const resolvedGroupIdIdx = groupIdIdx ?? CASE_FALLBACK_COL.groupId;
  const resolvedGroupNameIdx = groupNameIdx ?? CASE_FALLBACK_COL.groupName;
  const resolvedTestTypeIdx = testTypeIdx ?? CASE_FALLBACK_COL.testType;
  const resolvedCaseTitleIdx = caseTitleIdx ?? CASE_FALLBACK_COL.caseTitle;
  const resolvedPreconditionIdx = preconditionIdx ?? CASE_FALLBACK_COL.precondition;
  const resolvedStepsTextIdx = stepsTextIdx ?? CASE_FALLBACK_COL.stepText;
  const resolvedExpectedResultIdx = expectedResultIdx ?? CASE_FALLBACK_COL.expectedResult;
  const resolvedExecutionTypeIdx = executionTypeIdx ?? CASE_FALLBACK_COL.executionType;

  if (!resolvedCaseNoIdx || !resolvedCaseTitleIdx || !resolvedExecutionTypeIdx) {
    throw new Error("CASE_SHEET_HEADER_INVALID");
  }

  const cases: ParsedCase[] = [];
  for (let i = 2; i <= caseSheet.rowCount; i += 1) {
    const row = caseSheet.getRow(i);
    const caseNo = getCellValue(row, resolvedCaseNoIdx);
    if (!caseNo) continue;

    const groupId = getCellValue(row, resolvedGroupIdIdx);
    const groupName = getCellValue(row, resolvedGroupNameIdx);
    const testType = getCellValue(row, resolvedTestTypeIdx);
    const caseTitle = getCellValue(row, resolvedCaseTitleIdx);
    const precondition = getCellValue(row, resolvedPreconditionIdx);
    const stepText = getCellValue(row, resolvedStepsTextIdx);
    const expectedResult = getCellValue(row, resolvedExpectedResultIdx);
    const executionMethodRaw = getCellValue(row, resolvedExecutionTypeIdx);
    const resultStatusRaw = resultStatusIdx ? getCellValue(row, resultStatusIdx) : "";
    const failCategory = failCategoryIdx ? getCellValue(row, failCategoryIdx) : "";
    const testDate = testDateIdx ? getCellValue(row, testDateIdx) : "";
    const validationMethod = validationMethodIdx ? getCellValue(row, validationMethodIdx) : "";

    const baseDetail = {
      測試類型: testType || "未分類",
      測試目的: caseTitle || caseNo,
      設定條件: precondition || "未提供前置條件",
      執行步驟: stepText || "未提供執行步驟",
      預期行為: expectedResult || "未提供預期結果",
      執行方式: executionMethodRaw || "未指定",
      ...(validationMethod ? { 驗證方法: validationMethod } : {}),
      ...(testDate ? { 測試日: testDate } : {})
    } as Record<string, unknown>;

    const detailRaw = detailJsonIdx ? getCellValue(row, detailJsonIdx) : "";
    let detailJson: unknown = baseDetail;
    if (detailRaw) {
      try {
        const parsed = JSON.parse(detailRaw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          detailJson = {
            ...(parsed as Record<string, unknown>),
            ...baseDetail
          };
        } else {
          detailJson = {
            ...baseDetail,
            原始詳細紀錄: detailRaw
          };
        }
      } catch {
        detailJson = {
          ...baseDetail,
          原始詳細紀錄: detailRaw
        };
      }
    }

    cases.push({
      caseNo,
      groupId: deriveGroupId(groupId, groupName, caseNo) || undefined,
      groupName: groupName || undefined,
      caseTitle,
      testType: testType || undefined,
      precondition: precondition || undefined,
      stepText: stepText || undefined,
      expectedResult: expectedResult || undefined,
      executionMethodRaw: executionMethodRaw || undefined,
      executionType: normalizeExecutionType(executionMethodRaw),
      resultStatusRaw: resultStatusRaw || undefined,
      failCategory: failCategory || undefined,
      testDate: testDate || undefined,
      validationMethod: validationMethod || undefined,
      detailJson
    });
  }

  const steps: ParsedStep[] = [];
  if (stepSheet) {
    const stepHeaderRow = stepSheet.getRow(1);
    const stepHeaderMap = new Map<string, number>();
    stepHeaderRow.eachCell((cell, col) => stepHeaderMap.set(normalizeHeader(cell.value), col));

    const sCaseNoIdx = headerIndex(stepHeaderMap, "caseno", "case_no", "案例編號", "測試案例");
    const stepNoIdx = headerIndex(stepHeaderMap, "stepno", "step_no", "步驟序號");
    const actionTypeIdx = headerIndex(stepHeaderMap, "actiontype", "action_type", "動作類型");
    const targetTypeIdx = headerIndex(stepHeaderMap, "targettype", "target_type", "目標類型");
    const targetValueIdx = headerIndex(stepHeaderMap, "targetvalue", "target_value", "目標值");
    const inputValueIdx = headerIndex(stepHeaderMap, "inputvalue", "input_value", "輸入值");
    const expectedIdx = headerIndex(stepHeaderMap, "expected", "預期值");
    const requireApprovalIdx = headerIndex(stepHeaderMap, "requireapproval", "require_approval", "需要人工確認");
    const timeoutMsIdx = headerIndex(stepHeaderMap, "timeoutms", "timeout_ms", "逾時毫秒");
    const retryIdx = headerIndex(stepHeaderMap, "retry", "重試次數");

    if (sCaseNoIdx && stepNoIdx && actionTypeIdx) {
      for (let i = 2; i <= stepSheet.rowCount; i += 1) {
        const row = stepSheet.getRow(i);
        const caseNo = getCellValue(row, sCaseNoIdx);
        if (!caseNo) continue;

        const requireApprovalRaw = requireApprovalIdx ? getCellValue(row, requireApprovalIdx).toLowerCase() : "false";
        steps.push({
          caseNo,
          stepNo: Number(getCellValue(row, stepNoIdx) || 0),
          actionType: getCellValue(row, actionTypeIdx),
          targetType: targetTypeIdx ? getCellValue(row, targetTypeIdx) : undefined,
          targetValue: targetValueIdx ? getCellValue(row, targetValueIdx) : undefined,
          inputValue: inputValueIdx ? getCellValue(row, inputValueIdx) : undefined,
          expected: expectedIdx ? getCellValue(row, expectedIdx) : undefined,
          requireApproval: ["true", "1", "yes", "y"].includes(requireApprovalRaw),
          timeoutMs: Number(timeoutMsIdx ? getCellValue(row, timeoutMsIdx) : 10000) || 10000,
          retry: Number(retryIdx ? getCellValue(row, retryIdx) : 0) || 0
        });
      }
    }
  }

  const caseIndex = new Map(cases.map((c) => [c.caseNo, c] as const));
  if (!stepSheet && resolvedStepsTextIdx) {
    for (const c of cases) {
      const row = caseSheet
        .getRows(2, Math.max(caseSheet.rowCount - 1, 0))
        ?.find((r) => getCellValue(r, resolvedCaseNoIdx) === c.caseNo);
      if (!row) continue;
      const rawStep = getCellValue(row, resolvedStepsTextIdx);
      if (!rawStep) continue;
      const matched = caseIndex.get(c.caseNo);
      steps.push({
        caseNo: c.caseNo,
        stepNo: 1,
        actionType: "custom",
        inputValue: rawStep,
        expected: matched?.expectedResult,
        requireApproval: false,
        timeoutMs: 10000,
        retry: 0
      });
    }
  }

  return { cases, steps };
};

type MinimalXlsxSheet = {
  name: string;
  rows: string[][];
};

const getArrayCellValue = (row: string[] | undefined, index: number | undefined): string => {
  if (!row || !index) return "";
  return extractText(row[index]);
};

const decodeXml = (value: string): string =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(Number.parseInt(num, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

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

const textNodes = (xml: string): string[] =>
  [...xml.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => decodeXml(m[1] ?? ""));

const valueNode = (xml: string): string | undefined => {
  const match = xml.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/);
  return match ? decodeXml(match[1] ?? "") : undefined;
};

const parseSharedStrings = (xml: string | undefined): string[] => {
  if (!xml) return [];
  return [...xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) =>
    textNodes(m[1] ?? "").join("")
  );
};

const parseCellValue = (attrs: string, body: string, sharedStrings: string[]): string => {
  const type = getXmlAttr(attrs, "t");
  const inline = textNodes(body);
  if (type === "inlineStr" || inline.length > 0) return inline.join("").trim();

  const rawValue = valueNode(body) ?? "";
  if (type === "s") {
    return (sharedStrings[Number(rawValue)] ?? "").trim();
  }
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
  const readText = async (path: string): Promise<string | undefined> => zip.file(path)?.async("string");

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
    const path = normalizeWorksheetPath(relId ? rels.get(relId) : undefined, fallbackIndex);
    const worksheetXml = await readText(path);
    if (worksheetXml) {
      sheets.push({
        name,
        rows: parseWorksheetRows(worksheetXml, sharedStrings)
      });
    }
    fallbackIndex += 1;
  }

  return sheets;
};

const parseMinimalXlsx = async (filePath: string): Promise<{ cases: ParsedCase[]; steps: ParsedStep[] }> => {
  const workbook = await loadMinimalXlsxSheets(filePath);
  const caseSheet = workbook.find((sheet) => sheet.name === "測試案例") ?? workbook[0];
  const stepSheet = workbook.find((sheet) => sheet.name === "步驟");
  if (!caseSheet) throw new Error("CASE_SHEET_NOT_FOUND");

  const caseHeaderRow = caseSheet.rows[0] ?? [];
  const caseHeaderMap = new Map<string, number>();
  caseHeaderRow.forEach((value, col) => {
    if (col > 0) caseHeaderMap.set(normalizeHeader(value), col);
  });

  const caseNoIdx = headerIndex(caseHeaderMap, "caseno", "case_no", "測試案例", "案例編號", "編號", "case");
  const groupIdIdx = headerIndex(caseHeaderMap, "groupid", "group_id", "group id", "群組id", "群組ID");
  const groupNameIdx = headerIndex(caseHeaderMap, "group", "group_name", "群組", "分類");
  const testTypeIdx = headerIndex(caseHeaderMap, "testtype", "test_type", "測試類型", "類型");
  const caseTitleIdx = headerIndex(caseHeaderMap, "casetitle", "case_title", "測試項目", "測試案例名稱", "title");
  const preconditionIdx = headerIndex(caseHeaderMap, "precondition", "condition", "前置條件", "設定條件");
  const executionTypeIdx = headerIndex(caseHeaderMap, "executiontype", "execution_type", "執行方式");
  const resultStatusIdx = headerIndex(caseHeaderMap, "result", "status", "resultstatus", "result_status", "結果");
  const failCategoryIdx = headerIndex(caseHeaderMap, "failcategory", "fail_category", "verdictreason", "失敗分類");
  const testDateIdx = headerIndex(caseHeaderMap, "testdate", "test_date", "測試日", "測試日期");
  const validationMethodIdx = headerIndex(caseHeaderMap, "validationmethod", "validation_method", "verification", "驗證方法");
  const expectedResultIdx = headerIndex(caseHeaderMap, "expectedresult", "expected_result", "預期結果");
  const detailJsonIdx = headerIndex(caseHeaderMap, "detailjson", "detail_json", "詳細紀錄json");
  const stepsTextIdx = headerIndex(caseHeaderMap, "steps", "步驟", "測試步驟");

  const resolvedCaseNoIdx = caseNoIdx ?? CASE_FALLBACK_COL.caseNo;
  const resolvedGroupIdIdx = groupIdIdx ?? CASE_FALLBACK_COL.groupId;
  const resolvedGroupNameIdx = groupNameIdx ?? CASE_FALLBACK_COL.groupName;
  const resolvedTestTypeIdx = testTypeIdx ?? CASE_FALLBACK_COL.testType;
  const resolvedCaseTitleIdx = caseTitleIdx ?? CASE_FALLBACK_COL.caseTitle;
  const resolvedPreconditionIdx = preconditionIdx ?? CASE_FALLBACK_COL.precondition;
  const resolvedStepsTextIdx = stepsTextIdx ?? CASE_FALLBACK_COL.stepText;
  const resolvedExpectedResultIdx = expectedResultIdx ?? CASE_FALLBACK_COL.expectedResult;
  const resolvedExecutionTypeIdx = executionTypeIdx ?? CASE_FALLBACK_COL.executionType;

  if (!resolvedCaseNoIdx || !resolvedCaseTitleIdx || !resolvedExecutionTypeIdx) {
    throw new Error("CASE_SHEET_HEADER_INVALID");
  }

  const cases: ParsedCase[] = [];
  for (const row of caseSheet.rows.slice(1)) {
    const caseNo = getArrayCellValue(row, resolvedCaseNoIdx);
    if (!caseNo) continue;

    const groupId = getArrayCellValue(row, resolvedGroupIdIdx);
    const groupName = getArrayCellValue(row, resolvedGroupNameIdx);
    const testType = getArrayCellValue(row, resolvedTestTypeIdx);
    const caseTitle = getArrayCellValue(row, resolvedCaseTitleIdx);
    const precondition = getArrayCellValue(row, resolvedPreconditionIdx);
    const stepText = getArrayCellValue(row, resolvedStepsTextIdx);
    const expectedResult = getArrayCellValue(row, resolvedExpectedResultIdx);
    const executionMethodRaw = getArrayCellValue(row, resolvedExecutionTypeIdx);
    const resultStatusRaw = getArrayCellValue(row, resultStatusIdx);
    const failCategory = getArrayCellValue(row, failCategoryIdx);
    const testDate = getArrayCellValue(row, testDateIdx);
    const validationMethod = getArrayCellValue(row, validationMethodIdx);

    const baseDetail = {
      測試類型: testType || "未分類",
      測試目的: caseTitle || caseNo,
      設定條件: precondition || "未提供前置條件",
      執行步驟: stepText || "未提供執行步驟",
      預期行為: expectedResult || "未提供預期結果",
      執行方式: executionMethodRaw || "未指定",
      ...(validationMethod ? { 驗證方法: validationMethod } : {}),
      ...(testDate ? { 測試日: testDate } : {})
    } as Record<string, unknown>;

    const detailRaw = detailJsonIdx ? getArrayCellValue(row, detailJsonIdx) : "";
    let detailJson: unknown = baseDetail;
    if (detailRaw) {
      try {
        const parsed = JSON.parse(detailRaw) as unknown;
        detailJson =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? { ...(parsed as Record<string, unknown>), ...baseDetail }
            : { ...baseDetail, 原始詳細紀錄: detailRaw };
      } catch {
        detailJson = {
          ...baseDetail,
          原始詳細紀錄: detailRaw
        };
      }
    }

    cases.push({
      caseNo,
      groupId: deriveGroupId(groupId, groupName, caseNo) || undefined,
      groupName: groupName || undefined,
      caseTitle,
      testType: testType || undefined,
      precondition: precondition || undefined,
      stepText: stepText || undefined,
      expectedResult: expectedResult || undefined,
      executionMethodRaw: executionMethodRaw || undefined,
      executionType: normalizeExecutionType(executionMethodRaw),
      resultStatusRaw: resultStatusRaw || undefined,
      failCategory: failCategory || undefined,
      testDate: testDate || undefined,
      validationMethod: validationMethod || undefined,
      detailJson
    });
  }

  const steps: ParsedStep[] = [];
  if (stepSheet) {
    const stepHeaderRow = stepSheet.rows[0] ?? [];
    const stepHeaderMap = new Map<string, number>();
    stepHeaderRow.forEach((value, col) => {
      if (col > 0) stepHeaderMap.set(normalizeHeader(value), col);
    });

    const sCaseNoIdx = headerIndex(stepHeaderMap, "caseno", "case_no", "案例編號", "測試案例");
    const stepNoIdx = headerIndex(stepHeaderMap, "stepno", "step_no", "步驟序號");
    const actionTypeIdx = headerIndex(stepHeaderMap, "actiontype", "action_type", "動作類型");
    const targetTypeIdx = headerIndex(stepHeaderMap, "targettype", "target_type", "目標類型");
    const targetValueIdx = headerIndex(stepHeaderMap, "targetvalue", "target_value", "目標值");
    const inputValueIdx = headerIndex(stepHeaderMap, "inputvalue", "input_value", "輸入值");
    const expectedIdx = headerIndex(stepHeaderMap, "expected", "預期值");
    const requireApprovalIdx = headerIndex(stepHeaderMap, "requireapproval", "require_approval", "需要人工確認");
    const timeoutMsIdx = headerIndex(stepHeaderMap, "timeoutms", "timeout_ms", "逾時毫秒");
    const retryIdx = headerIndex(stepHeaderMap, "retry", "重試次數");

    if (sCaseNoIdx && stepNoIdx && actionTypeIdx) {
      for (const row of stepSheet.rows.slice(1)) {
        const caseNo = getArrayCellValue(row, sCaseNoIdx);
        if (!caseNo) continue;

        const requireApprovalRaw = getArrayCellValue(row, requireApprovalIdx).toLowerCase() || "false";
        steps.push({
          caseNo,
          stepNo: Number(getArrayCellValue(row, stepNoIdx) || 0),
          actionType: getArrayCellValue(row, actionTypeIdx),
          targetType: getArrayCellValue(row, targetTypeIdx) || undefined,
          targetValue: getArrayCellValue(row, targetValueIdx) || undefined,
          inputValue: getArrayCellValue(row, inputValueIdx) || undefined,
          expected: getArrayCellValue(row, expectedIdx) || undefined,
          requireApproval: ["true", "1", "yes", "y"].includes(requireApprovalRaw),
          timeoutMs: Number(getArrayCellValue(row, timeoutMsIdx) || 10000) || 10000,
          retry: Number(getArrayCellValue(row, retryIdx) || 0) || 0
        });
      }
    }
  }

  if (steps.length === 0 && resolvedStepsTextIdx) {
    for (const c of cases) {
      if (!c.stepText) continue;
      steps.push({
        caseNo: c.caseNo,
        stepNo: 1,
        actionType: "custom",
        inputValue: c.stepText,
        expected: c.expectedResult,
        requireApproval: false,
        timeoutMs: 10000,
        retry: 0
      });
    }
  }

  return { cases, steps };
};
