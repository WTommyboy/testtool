import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { loadResultParserAdapter } from "./result-contract";

export const writeResultTemplate = async (runDir: string): Promise<string> => {
  const filePath = path.join(runDir, "input", "result-template.xlsx");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "uat-tool-agent";
  workbook.created = new Date();
  const adapter = loadResultParserAdapter();

  const index = workbook.addWorksheet(adapter.sheets.index);
  index.addRow(["欄位", "值"]);
  index.addRow(["schemaVersion", "result-template-v1"]);
  index.addRow(["resultParserAdapterVersion", adapter.adapterVersion]);
  index.addRow(["policy", "Codex 仍需寫 output/result.xlsx；本檔只作欄位模板參考。"]);
  index.addRow(["oneCaseAtATime", "每次只寫一個 case 結果，禁止累積多題後一次寫入。"]);
  index.addRow(["passDetailRequired", adapter.detailJsonRequiredFields.PASS.join(", ")]);
  index.addRow(["failDetailRequired", adapter.detailJsonRequiredFields.FAIL.join(", ")]);
  index.addRow(["blockedDetailRequired", adapter.detailJsonRequiredFields.BLOCKED.join(", ")]);
  index.addRow(["partialDetailRequired", adapter.detailJsonRequiredFields.PARTIAL.join(", ")]);

  const cases = workbook.addWorksheet(adapter.sheets.cases);
  cases.addRow(adapter.headers.cases);
  cases.addRow([
    "Example",
    "EX-01",
    "單題結果範例",
    "auto",
    "Codex with Playwright",
    "BLOCKED",
    "EXAMPLE_ONLY",
    JSON.stringify({
      測試目的: "範例，不可當正式結果。",
      設定條件: {},
      預期行為: "",
      實際行為: "",
      blocked_reason: "範例欄位；正式 BLOCKED 必填。"
    })
  ]);
  cases.addRow([
    "Example",
    "EX-FAIL",
    "FAIL 詳細紀錄範例",
    "auto",
    "Codex with Playwright",
    "FAIL",
    "EXAMPLE_ONLY",
    JSON.stringify({
      測試目的: "範例，不可當正式結果。",
      設定條件: {},
      預期行為: "",
      實際行為: "",
      錯誤原因: "",
      根因層級: "",
      驗證方法: "",
      "RD 分派": ""
    })
  ]);

  const bugs = workbook.addWorksheet(adapter.sheets.bugs);
  bugs.addRow([...adapter.headers.bugs, ...(adapter.headers.optionalBugHeaders ?? [])]);

  for (const sheet of workbook.worksheets) {
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((column) => {
      column.width = Math.min(Math.max(String(column.header ?? "").length + 8, 14), 42);
    });
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await workbook.xlsx.writeFile(filePath);
  return filePath;
};
