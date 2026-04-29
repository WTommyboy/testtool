import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { writeResultTemplate } from "../agent/src/result-template";
import { validateResultWorkbookContract } from "../agent/src/result-contract";

const writeBadLegacyWorkbook = async (filePath: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("索引").addRow(["欄位", "值"]);

  const cases = workbook.addWorksheet("測試案例");
  cases.addRow(["群組", "編號", "測試項目", "測試類型", "執行方式", "結果", "失敗分類", "詳細紀錄JSON"]);
  cases.addRow([
    "A",
    "DEMO-A-01",
    "fixture",
    "功能流程",
    "agent",
    "FAIL",
    "fixture",
    JSON.stringify({
      測試目的: "fixture",
      設定條件: {},
      預期行為: "expected",
      實際行為: "actual"
    })
  ]);

  const bugs = workbook.addWorksheet("Bug");
  bugs.addRow(["Bug ID", "來源 Case", "標題", "嚴重度", "描述", "建議", "Evidence"]);
  bugs.addRow(["BUG-1", "DEMO-A-01", "legacy", "High", "desc", "suggest", "evidence"]);

  await workbook.xlsx.writeFile(filePath);
};

const main = async (): Promise<void> => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-agent-result-contract-"));
  try {
    await writeResultTemplate(tempRoot);
    const templateReport = await validateResultWorkbookContract(path.join(tempRoot, "input", "result-template.xlsx"));
    assert.equal(templateReport.status, "ok", JSON.stringify(templateReport.issues));

    const bad = path.join(tempRoot, "bad-legacy-result.xlsx");
    await writeBadLegacyWorkbook(bad);
    const badReport = await validateResultWorkbookContract(bad);
    assert.equal(badReport.status, "error");
    assert.ok(badReport.issues.some((item) => item.message.includes("關聯編號")));
    assert.ok(badReport.issues.some((item) => item.message.includes("狀態")));
    assert.ok(badReport.issues.some((item) => item.message.includes("錯誤原因")));

    console.log(JSON.stringify({
      ok: true,
      fixture: "agent-result-contract",
      checked: [
        "generated result-template follows adapter headers and detail_json fields",
        "legacy Bug header 來源 Case is rejected by agent self-check",
        "FAIL detail_json missing required fields is rejected before upload"
      ]
    }, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
