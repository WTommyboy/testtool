import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { containResultEvidenceUploadFailure } from "../agent/src/result-evidence-upload-containment";
import { evaluateResultEvidenceGate } from "../src/result-parser/result-evidence-gate";
import { parseResultXlsx } from "../src/result-parser/result-xlsx-parser";

const writeWorkbook = async (filePath: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const index = workbook.addWorksheet("索引");
  index.addRow(["schema_version", "agent-result-v1"]);
  index.addRow(["run_id", "fixture-run"]);
  index.addRow(["round_id", "fixture-round"]);

  const cases = workbook.addWorksheet("測試案例");
  cases.addRow(["群組ID", "群組", "編號", "測試項目", "測試類型", "執行方式", "結果", "失敗分類", "詳細紀錄JSON"]);
  cases.addRow([
    "N",
    "N:下載與結果表格",
    "BIUI_COLLAGE_R001-N-02",
    "editor 右上下載 icon 有 preview 結果時 enabled",
    "前端呈現",
    "Codex + Playwright",
    "BLOCKED",
    "EVIDENCE_INSUFFICIENT",
    JSON.stringify({
      測試目的: "驗證 editor download icon enabled。",
      設定條件: "已進入新增報表頁。",
      預期行為: "preview 後下載 icon enabled。",
      實際行為:
        "本次 current-run 可用證據僅顯示 helper 成功導到新增報表頁；後續觀察動作為 rowDeleteTooltip，未取得 download icon enabled DOM evidence。",
      blocked_reason: "EVIDENCE_INSUFFICIENT",
      currentRunEvidence: {
        helperActions: ["collage.openProject: ok", "collage.createReport: ok", "collage.observeFrontendState(rowDeleteTooltip): ok with warning"],
        screenshotPath: "output/helper-artifacts/BIUI_COLLAGE_R001-N-02/BIUI_COLLAGE_R001-N-02-observe-rowDeleteTooltip.png"
      }
    }, null, 2)
  ]);

  workbook.addWorksheet("Bug").addRow(["嚴重度", "Bug ID", "關聯編號", "標題", "描述", "建議", "狀態"]);
  await workbook.xlsx.writeFile(filePath);
};

const resultEvidenceUploadError = (report: unknown): Error =>
  new Error(`RESULT_UPLOAD_FAILED 422 ${JSON.stringify({
    error: "RESULT_EVIDENCE_GATE_FAILED",
    message: "RESULT_EVIDENCE_GATE_FAILED",
    report
  })}`);

const main = async (): Promise<void> => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-result-evidence-upload-containment-"));
  const fixture = path.join(tempRoot, "result.xlsx");
  await writeWorkbook(fixture);

  const beforeParsed = await parseResultXlsx(fixture);
  const beforeReport = evaluateResultEvidenceGate({
    parsed: beforeParsed,
    currentCaseNo: "BIUI_COLLAGE_R001-N-02",
    expectedCaseNos: ["BIUI_COLLAGE_R001-N-02"],
    resultSource: "codex_generated",
    requireSingleCase: true
  });
  assert.equal(beforeReport.status, "error");
  assert.ok(beforeReport.issues.some((item) => item.code === "RESULT_FRONTEND_OBSERVATION_VISUAL_FALLBACK_REQUIRED"));
  assert.ok(beforeReport.issues.some((item) => item.code === "TOOL_BRIDGE_RESPONSE_MISSING"));

  const containmentReport = await containResultEvidenceUploadFailure({
    filePath: fixture,
    error: resultEvidenceUploadError(beforeReport),
    runId: "fixture-run",
    currentCaseNo: "BIUI_COLLAGE_R001-N-02"
  });
  assert.equal(containmentReport.status, "updated");
  assert.deepEqual(containmentReport.updatedCaseNos, ["BIUI_COLLAGE_R001-N-02"]);
  assert.ok(fs.existsSync(containmentReport.backupPath ?? ""), "containment must keep a pre-containment backup");

  const afterParsed = await parseResultXlsx(fixture);
  assert.equal(afterParsed.cases[0]?.status, "BLOCKED");
  assert.equal(afterParsed.cases[0]?.verdictReason, "BLOCKED_RESULT_GATE_CONTAINMENT");
  assert.equal(afterParsed.cases[0]?.detailJson?.["evidenceSource"], "screenshotVisual");
  const afterReport = evaluateResultEvidenceGate({
    parsed: afterParsed,
    currentCaseNo: "BIUI_COLLAGE_R001-N-02",
    expectedCaseNos: ["BIUI_COLLAGE_R001-N-02"],
    resultSource: "codex_generated",
    requireSingleCase: true
  });
  assert.equal(afterReport.status, "ok", JSON.stringify(afterReport.issues));

  const nonContainableReport = await containResultEvidenceUploadFailure({
    filePath: fixture,
    error: resultEvidenceUploadError({
      ...beforeReport,
      issues: [
        ...beforeReport.issues,
        {
          severity: "error",
          code: "CURRENT_RUN_EVIDENCE_MISSING",
          caseNo: "BIUI_COLLAGE_R001-N-02"
        }
      ]
    }),
    runId: "fixture-run",
    currentCaseNo: "BIUI_COLLAGE_R001-N-02"
  });
  assert.equal(nonContainableReport.status, "skipped");
  assert.match(nonContainableReport.reason, /NON_CONTAINABLE/);

  console.log(JSON.stringify({
    fixture: "result-evidence-upload-containment",
    status: "ok",
    beforeIssueCodes: beforeReport.issues.map((item) => item.code),
    containment: containmentReport.reason,
    afterStatus: afterReport.status
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
