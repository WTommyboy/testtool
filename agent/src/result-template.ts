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

  const bugs = workbook.addWorksheet("Bug");
  bugs.addRow(["Bug ID", "來源 Case", "標題", "嚴重度", "描述", "建議", "Evidence"]);

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
