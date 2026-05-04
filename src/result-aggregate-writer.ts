import ExcelJS from "exceljs";

export type AggregateRun = {
  id: string;
  round_id: string | null;
  run_name: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  finished_at?: string | null;
};

export type AggregateCase = {
  group_id: string | null;
  group_name: string | null;
  case_no: string;
  case_title: string | null;
  execution_type: string | null;
  result_status: string | null;
  fail_category: string | null;
  detail_json: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type AggregateBug = {
  id: string;
  severity: string | null;
  related_case_no: string | null;
  description: string | null;
  suggestion: string | null;
  created_at: string | null;
};

export const inferGroupId = (groupId: string | null | undefined, groupName: string | null | undefined, caseNo: string | null | undefined): string | null => {
  const explicit = groupId?.trim();
  if (explicit) return explicit;

  const fromGroupName = groupName?.trim().match(/^([A-Za-z0-9_-]+)\s*[:：]/)?.[1];
  if (fromGroupName) return fromGroupName;

  const normalizedCaseNo = caseNo?.trim() ?? "";
  const fromCaseNo = normalizedCaseNo.match(/^[A-Za-z]+-([A-Za-z0-9]+)-\d+/)?.[1] ?? normalizedCaseNo.match(/^([A-Za-z0-9]+)-\d+/)?.[1];
  return fromCaseNo ?? null;
};

const stringifyDetail = (value: string | null): string => {
  if (!value) return "";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
};

const bugTitle = (description: string | null): string => {
  const firstLine = description?.split(/\r?\n/).find((line) => line.trim())?.trim();
  return firstLine || "Bug";
};

const setWrapAlignment = (sheet: ExcelJS.Worksheet, key: string): void => {
  const column = sheet.columns.find((item) => item.key === key);
  if (column) column.alignment = { wrapText: true, vertical: "top" };
};

export const writeFinalAggregateResultXlsx = async (input: {
  filePath: string;
  run: AggregateRun;
  cases: AggregateCase[];
  bugs: AggregateBug[];
  aggregateMode?: "final" | "partial";
}): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "uat-tool-server";
  workbook.created = new Date();

  const generatedAt = new Date().toISOString();
  const index = workbook.addWorksheet("索引");
  index.addRows([
    ["schema_version", "uat-final-aggregate-result-v1"],
    ["source", "normalized-server-state"],
    ["aggregate_mode", input.aggregateMode ?? "final"],
    ["generated_at", generatedAt],
    ["run_id", input.run.id],
    ["round_id", input.run.round_id ?? ""],
    ["run_name", input.run.run_name ?? ""],
    ["run_status", input.run.status ?? ""],
    ["case_count", input.cases.length],
    ["bug_count", input.bugs.length],
    [
      "policy",
      input.aggregateMode === "partial"
        ? "Partial aggregate generated from server-normalized run state. PENDING/MANUAL_PENDING rows may remain when the run failed, was cancelled, or is still incomplete."
        : "Each case was ingested from a single-case output/result.xlsx before this aggregate workbook was generated."
    ]
  ]);

  const cases = workbook.addWorksheet("測試案例");
  cases.columns = [
    { header: "群組ID", key: "groupId", width: 12 },
    { header: "群組", key: "groupName", width: 24 },
    { header: "編號", key: "caseNo", width: 18 },
    { header: "測試項目", key: "caseTitle", width: 42 },
    { header: "測試類型", key: "testType", width: 18 },
    { header: "執行方式", key: "executionMethod", width: 18 },
    { header: "結果", key: "status", width: 14 },
    { header: "失敗分類", key: "verdictReason", width: 24 },
    { header: "詳細紀錄JSON", key: "detailJson", width: 72 }
  ];
  for (const item of input.cases) {
    cases.addRow({
      groupId: inferGroupId(item.group_id, item.group_name, item.case_no) ?? "",
      groupName: item.group_name ?? "",
      caseNo: item.case_no,
      caseTitle: item.case_title ?? item.case_no,
      testType: "",
      executionMethod: item.execution_type ?? "",
      status: item.result_status ?? "",
      verdictReason: item.fail_category ?? "",
      detailJson: stringifyDetail(item.detail_json)
    });
  }

  const bugs = workbook.addWorksheet("Bug");
  bugs.columns = [
    { header: "嚴重度", key: "severity", width: 14 },
    { header: "Bug ID", key: "bugId", width: 38 },
    { header: "關聯編號", key: "relatedCaseNo", width: 18 },
    { header: "標題", key: "title", width: 42 },
    { header: "描述", key: "description", width: 72 },
    { header: "建議", key: "suggestion", width: 56 },
    { header: "狀態", key: "status", width: 14 }
  ];
  for (const item of input.bugs) {
    bugs.addRow({
      severity: item.severity ?? "INFO",
      bugId: item.id,
      relatedCaseNo: item.related_case_no ?? "",
      title: bugTitle(item.description),
      description: item.description ?? "",
      suggestion: item.suggestion ?? "",
      status: "OPEN"
    });
  }

  for (const sheet of workbook.worksheets) {
    sheet.getRow(1).font = { bold: true };
    setWrapAlignment(sheet, "detailJson");
    setWrapAlignment(sheet, "description");
    setWrapAlignment(sheet, "suggestion");
  }

  await workbook.xlsx.writeFile(input.filePath);
};
