import fs from "node:fs";
import ExcelJS from "exceljs";

export type ParsedCase = {
  caseNo: string;
  caseTitle: string;
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
  const caseTitleIdx = headerIndex(caseHeaderMap, "casetitle", "case_title", "測試項目", "測試案例名稱", "title");
  const executionTypeIdx = headerIndex(caseHeaderMap, "executiontype", "execution_type", "執行方式");
  const detailJsonIdx = headerIndex(caseHeaderMap, "detailjson", "detail_json", "詳細紀錄json");
  const stepsTextIdx = headerIndex(caseHeaderMap, "steps", "步驟", "測試步驟");

  if (!caseNoIdx || !caseTitleIdx || !executionTypeIdx) {
    throw new Error("CASE_SHEET_HEADER_INVALID");
  }

  const cases: ParsedCase[] = [];
  for (let i = 2; i <= caseSheet.rowCount; i += 1) {
    const row = caseSheet.getRow(i);
    const caseNo = getCellValue(row, caseNoIdx);
    if (!caseNo) continue;

    const detailRaw = detailJsonIdx ? getCellValue(row, detailJsonIdx) : "";
    let detailJson: unknown = undefined;
    if (detailRaw) {
      try {
        detailJson = JSON.parse(detailRaw);
      } catch {
        detailJson = { raw: detailRaw };
      }
    }

    cases.push({
      caseNo,
      caseTitle: getCellValue(row, caseTitleIdx),
      executionType: normalizeExecutionType(getCellValue(row, executionTypeIdx)),
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

  if (!stepSheet && stepsTextIdx) {
    for (const c of cases) {
      const row = caseSheet
        .getRows(2, Math.max(caseSheet.rowCount - 1, 0))
        ?.find((r) => getCellValue(r, caseNoIdx) === c.caseNo);
      if (!row) continue;
      const rawStep = getCellValue(row, stepsTextIdx);
      if (!rawStep) continue;
      steps.push({
        caseNo: c.caseNo,
        stepNo: 1,
        actionType: "custom",
        inputValue: rawStep,
        requireApproval: false,
        timeoutMs: 10000,
        retry: 0
      });
    }
  }

  return { cases, steps };
};
