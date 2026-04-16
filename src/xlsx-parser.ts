import fs from "node:fs";
import ExcelJS from "exceljs";

export type ParsedCase = {
  caseNo: string;
  groupName?: string;
  caseTitle: string;
  testType?: string;
  precondition?: string;
  stepText?: string;
  expectedResult?: string;
  executionMethodRaw?: string;
  executionType: "auto" | "semi" | "manual";
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
  groupName: 2,
  caseNo: 3,
  testType: 4,
  caseTitle: 5,
  precondition: 6,
  stepText: 7,
  expectedResult: 8,
  executionType: 10
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
  if (["auto", "playwright mcp", "playwright", "自動"].includes(raw)) return "auto";
  if (["semi", "半自動", "claude in chrome"].includes(raw)) return "semi";
  return "manual";
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
  await workbook.xlsx.readFile(filePath);

  const caseSheet = workbook.getWorksheet("測試案例") ?? workbook.worksheets[0];
  const stepSheet = workbook.getWorksheet("步驟");
  if (!caseSheet) throw new Error("CASE_SHEET_NOT_FOUND");

  const caseHeaderRow = caseSheet.getRow(1);
  const caseHeaderMap = new Map<string, number>();
  caseHeaderRow.eachCell((cell, col) => caseHeaderMap.set(normalizeHeader(cell.value), col));

  const caseNoIdx = headerIndex(caseHeaderMap, "caseno", "case_no", "測試案例", "案例編號", "編號", "case");
  const groupNameIdx = headerIndex(caseHeaderMap, "group", "group_name", "群組", "分類");
  const testTypeIdx = headerIndex(caseHeaderMap, "testtype", "test_type", "測試類型", "類型");
  const caseTitleIdx = headerIndex(caseHeaderMap, "casetitle", "case_title", "測試項目", "測試案例名稱", "title");
  const preconditionIdx = headerIndex(caseHeaderMap, "precondition", "condition", "前置條件", "設定條件");
  const executionTypeIdx = headerIndex(caseHeaderMap, "executiontype", "execution_type", "執行方式");
  const expectedResultIdx = headerIndex(caseHeaderMap, "expectedresult", "expected_result", "預期結果");
  const detailJsonIdx = headerIndex(caseHeaderMap, "detailjson", "detail_json", "詳細紀錄json");
  const stepsTextIdx = headerIndex(caseHeaderMap, "steps", "步驟", "測試步驟");

  const resolvedCaseNoIdx = caseNoIdx ?? CASE_FALLBACK_COL.caseNo;
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

    const groupName = getCellValue(row, resolvedGroupNameIdx);
    const testType = getCellValue(row, resolvedTestTypeIdx);
    const caseTitle = getCellValue(row, resolvedCaseTitleIdx);
    const precondition = getCellValue(row, resolvedPreconditionIdx);
    const stepText = getCellValue(row, resolvedStepsTextIdx);
    const expectedResult = getCellValue(row, resolvedExpectedResultIdx);
    const executionMethodRaw = getCellValue(row, resolvedExecutionTypeIdx);

    const baseDetail = {
      測試類型: testType || "未分類",
      測試目的: caseTitle || caseNo,
      設定條件: precondition || "未提供前置條件",
      執行步驟: stepText || "未提供執行步驟",
      預期行為: expectedResult || "未提供預期結果",
      執行方式: executionMethodRaw || "未指定"
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
      groupName: groupName || undefined,
      caseTitle,
      testType: testType || undefined,
      precondition: precondition || undefined,
      stepText: stepText || undefined,
      expectedResult: expectedResult || undefined,
      executionMethodRaw: executionMethodRaw || undefined,
      executionType: normalizeExecutionType(executionMethodRaw),
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
