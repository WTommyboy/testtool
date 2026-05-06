import path from "node:path";
import ExcelJS from "exceljs";

type ResultWriterInput = {
  runId: string;
  roundId: string;
  outputDir: string;
  sourceCase?: AgentResultSourceCase | null;
  status: "PASS" | "FAIL" | "BLOCKED" | "PARTIAL";
  failCategory?: string | null;
  detailJson: Record<string, unknown>;
  fileName?: string;
};

export type AgentResultSourceCase = {
  groupId: string | null;
  groupName: string | null;
  caseNo: string;
  caseTitle: string | null;
  testType: string | null;
  executionMethod: string | null;
};

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const rich = value as { richText?: Array<{ text?: string }> };
    if (Array.isArray(rich.richText)) {
      return rich.richText.map((item) => item.text ?? "").join("").trim();
    }
  }
  return String(value).trim();
};

const normalizedHeader = (value: unknown): string => cellText(value).toLowerCase().replace(/\s+/g, "");

const findColumn = (row: ExcelJS.Row, names: string[]): number | null => {
  const expected = new Set(names.map((name) => name.toLowerCase().replace(/\s+/g, "")));
  let found: number | null = null;
  row.eachCell((cell, col) => {
    if (expected.has(normalizedHeader(cell.value))) found = col;
  });
  return found;
};

const nullable = (value: string): string | null => (value ? value : null);

const normalizeCaseNo = (value: string): string =>
  value.trim().replace(/\s+/g, "").replace(/^DEMO-/i, "").toUpperCase();

const sameCaseNo = (a: string, b: string): boolean => normalizeCaseNo(a) === normalizeCaseNo(b);

export const readFirstInputCase = async (
  xlsxPath: string | undefined,
  preferredCaseNo?: string | null
): Promise<AgentResultSourceCase | null> => {
  if (!xlsxPath) return null;
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(xlsxPath);
  } catch {
    return null;
  }
  const sheet = workbook.getWorksheet("測試案例") ?? workbook.worksheets[0];
  if (!sheet) return null;

  const header = sheet.getRow(1);
  const columns = {
    groupId: findColumn(header, ["群組ID", "group_id", "groupid", "group id"]),
    groupName: findColumn(header, ["群組", "group", "group_name"]),
    caseNo: findColumn(header, ["編號", "case_no", "caseno", "案例編號"]),
    caseTitle: findColumn(header, ["測試項目", "case_title", "title"]),
    testType: findColumn(header, ["測試類型", "test_type"]),
    executionMethod: findColumn(header, ["執行方式", "execution_method"])
  };
  if (!columns.caseNo) return null;

  let firstCase: AgentResultSourceCase | null = null;
  for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    const caseNo = cellText(row.getCell(columns.caseNo).value);
    if (!caseNo) continue;
    const sourceCase = {
      groupId: columns.groupId ? nullable(cellText(row.getCell(columns.groupId).value)) : null,
      groupName: columns.groupName ? nullable(cellText(row.getCell(columns.groupName).value)) : null,
      caseNo,
      caseTitle: columns.caseTitle ? nullable(cellText(row.getCell(columns.caseTitle).value)) : null,
      testType: columns.testType ? nullable(cellText(row.getCell(columns.testType).value)) : null,
      executionMethod: columns.executionMethod ? nullable(cellText(row.getCell(columns.executionMethod).value)) : null
    };
    if (!firstCase) firstCase = sourceCase;
    if (preferredCaseNo && sameCaseNo(caseNo, preferredCaseNo)) return sourceCase;
  }

  return firstCase;
};

export const writeAgentResultXlsx = async (input: ResultWriterInput): Promise<string> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "uat-tool-agent";
  workbook.created = new Date();

  const index = workbook.addWorksheet("索引");
  index.getCell("A1").value = "schema_version";
  index.getCell("B1").value = "agent-result-v1";
  index.getCell("A2").value = "run_id";
  index.getCell("B2").value = input.runId;
  index.getCell("A3").value = "round_id";
  index.getCell("B3").value = input.roundId;

  const cases = workbook.addWorksheet("測試案例");
  cases.columns = [
    { header: "群組ID", key: "groupId", width: 12 },
    { header: "群組", key: "groupName", width: 18 },
    { header: "編號", key: "caseNo", width: 18 },
    { header: "測試項目", key: "caseTitle", width: 36 },
    { header: "測試類型", key: "testType", width: 16 },
    { header: "執行方式", key: "executionMethod", width: 18 },
    { header: "結果", key: "status", width: 14 },
    { header: "失敗分類", key: "verdictReason", width: 24 },
    { header: "詳細紀錄JSON", key: "detailJson", width: 72 }
  ];
  cases.addRow({
    groupId: input.sourceCase?.groupId ?? "",
    groupName: input.sourceCase?.groupName ?? "M1",
    caseNo: input.sourceCase?.caseNo ?? "AGENT-RESULT",
    caseTitle: input.sourceCase?.caseTitle ?? "Mac Agent Codex execution result",
    testType: input.sourceCase?.testType ?? "Agent",
    executionMethod: input.sourceCase?.executionMethod ?? "uat-agent",
    status: input.status,
    verdictReason: input.failCategory ?? "",
    detailJson: JSON.stringify(input.detailJson, null, 2)
  });
  cases.getRow(1).font = { bold: true };
  cases.getColumn("detailJson").alignment = { wrapText: true, vertical: "top" };

  const bugs = workbook.addWorksheet("Bug");
  bugs.columns = [
    { header: "嚴重度", key: "severity", width: 14 },
    { header: "Bug ID", key: "bugId", width: 18 },
    { header: "關聯編號", key: "relatedCaseNo", width: 16 },
    { header: "標題", key: "title", width: 36 },
    { header: "描述", key: "description", width: 56 },
    { header: "建議", key: "suggestion", width: 56 },
    { header: "狀態", key: "status", width: 14 }
  ];
  bugs.getRow(1).font = { bold: true };

  const filePath = path.join(input.outputDir, input.fileName ?? "agent-fallback-result.xlsx");
  await workbook.xlsx.writeFile(filePath);
  return filePath;
};
