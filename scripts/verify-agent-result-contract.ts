import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { writeResultTemplate } from "../agent/src/result-template";
import { validateResultWorkbookContract } from "../agent/src/result-contract";
import { ensureBlockedResultCurrentRunEvidence } from "../agent/src/result-evidence-enricher";
import { parseResultXlsx } from "../src/result-parser/result-xlsx-parser";
import { evaluateResultEvidenceGate } from "../src/result-parser/result-evidence-gate";

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

const writeBlockedWorkbookWithoutEvidence = async (filePath: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const index = workbook.addWorksheet("索引");
  index.getCell("A1").value = "schema_version";
  index.getCell("B1").value = "fixture-result-v1";

  const cases = workbook.addWorksheet("測試案例");
  cases.addRow(["群組", "編號", "測試項目", "測試類型", "執行方式", "結果", "失敗分類", "詳細紀錄JSON"]);
  cases.addRow([
    "A",
    "TOOL-A-01",
    "blocked fixture",
    "功能流程",
    "agent",
    "BLOCKED",
    "EVIDENCE_INSUFFICIENT",
    JSON.stringify({
      blocked_reason: "fixture blocked without evidence"
    })
  ]);

  const bugs = workbook.addWorksheet("Bug");
  bugs.addRow(["嚴重度", "Bug ID", "關聯編號", "標題", "描述", "建議", "狀態"]);
  await workbook.xlsx.writeFile(filePath);
};

const main = async (): Promise<void> => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-agent-result-contract-"));
  try {
    await writeResultTemplate(tempRoot);
    const templateReport = await validateResultWorkbookContract(path.join(tempRoot, "input", "result-template.xlsx"));
    assert.equal(templateReport.status, "ok", JSON.stringify(templateReport.issues));
    const templateWorkbook = new ExcelJS.Workbook();
    await templateWorkbook.xlsx.readFile(path.join(tempRoot, "input", "result-template.xlsx"));
    assert.equal(templateWorkbook.getWorksheet("測試案例")?.rowCount, 1, "result-template must not contain EX-* example result rows");

    const bad = path.join(tempRoot, "bad-legacy-result.xlsx");
    await writeBadLegacyWorkbook(bad);
    const badReport = await validateResultWorkbookContract(bad);
    assert.equal(badReport.status, "error");
    assert.ok(badReport.issues.some((item) => item.message.includes("關聯編號")));
    assert.ok(badReport.issues.some((item) => item.message.includes("狀態")));
    assert.ok(badReport.issues.some((item) => item.message.includes("錯誤原因")));

    fs.mkdirSync(path.join(tempRoot, "output", "helper-artifacts", "TOOL-A-01"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "output", "helper-pre-run-summary.json"), JSON.stringify({
      schemaVersion: "helper-pre-run-v1",
      caseId: "TOOL-A-01",
      status: "partial",
      actionCount: 4,
      executedCount: 3,
      durationMs: 1000,
      actions: [
        { actionId: "H1", template: "collage.openProject", status: "ok", warnings: [] },
        { actionId: "H3", template: "collage.configureMetric", status: "blocked", warnings: ["DATE_RANGE_INPUTS_NOT_FOUND"] }
      ]
    }, null, 2));
    fs.writeFileSync(path.join(tempRoot, "output", "helper-artifacts", "TOOL-A-01", "helper-report.jsonl"), "{\"status\":\"blocked\"}\n");
    const blocked = path.join(tempRoot, "blocked-result.xlsx");
    await writeBlockedWorkbookWithoutEvidence(blocked);
    const enrichment = await ensureBlockedResultCurrentRunEvidence({
      filePath: blocked,
      runId: "fixture-run",
      runDir: tempRoot
    });
    assert.equal(enrichment.status, "updated");
    assert.ok(enrichment.rows.some((item) => item.action === "added_blocked_current_run_evidence"));
    const parsed = await parseResultXlsx(blocked);
    const gate = evaluateResultEvidenceGate({
      parsed,
      resultSource: "codex_generated",
      currentCaseNo: "TOOL-A-01",
      expectedCaseNos: ["TOOL-A-01"],
      requireSingleCase: true
    });
    assert.equal(gate.status, "ok", JSON.stringify(gate.issues));

    console.log(JSON.stringify({
      ok: true,
      fixture: "agent-result-contract",
      checked: [
        "generated result-template follows adapter headers and detail_json fields",
        "generated result-template contains no EX-* example result rows",
        "legacy Bug header 來源 Case is rejected by agent self-check",
        "FAIL detail_json missing required fields is rejected before upload",
        "BLOCKED detail_json without current-run evidence is enriched before upload"
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
