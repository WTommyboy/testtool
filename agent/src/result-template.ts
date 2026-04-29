import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

export const writeResultTemplate = async (runDir: string): Promise<string> => {
  const filePath = path.join(runDir, "input", "result-template.xlsx");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "uat-tool-agent";
  workbook.created = new Date();

  const index = workbook.addWorksheet("索引");
  index.addRow(["欄位", "值"]);
  index.addRow(["schemaVersion", "result-template-v1"]);
  index.addRow(["policy", "Codex 仍需寫 output/result.xlsx；本檔只作欄位模板參考。"]);
  index.addRow(["oneCaseAtATime", "每次只寫一個 case 結果，禁止累積多題後一次寫入。"]);
  index.addRow(["passDetailRequired", "測試目的, 設定條件, 預期行為, 實際行為"]);
  index.addRow(["failDetailRequired", "測試目的, 設定條件, 預期行為, 實際行為, 錯誤原因, 根因層級, 驗證方法, RD 分派"]);
  index.addRow(["blockedDetailRequired", "blocked_reason"]);
  index.addRow(["partialDetailRequired", "部分符合的子項清單, 不符的子項清單"]);

  const cases = workbook.addWorksheet("測試案例");
  cases.addRow([
    "群組",
    "編號",
    "測試項目",
    "測試類型",
    "執行方式",
    "結果",
    "失敗分類",
    "詳細紀錄JSON"
  ]);
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
      實際行為: ""
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

  const bugs = workbook.addWorksheet("Bug");
  bugs.addRow(["嚴重度", "Bug ID", "關聯編號", "標題", "描述", "建議", "狀態", "Evidence"]);

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
