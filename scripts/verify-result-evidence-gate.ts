import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { parseResultXlsx } from "../src/result-parser/result-xlsx-parser";
import { evaluateResultEvidenceGate } from "../src/result-parser/result-evidence-gate";

type FixtureCase = {
  caseNo: string;
  status: string;
  detailJson: string;
};

const goodDetail = {
  測試目的: "驗證 result evidence gate fixture。",
  設定條件: {
    欄位: "新增帳號數",
    時間: "2026-03-01~2026-03-31",
    篩選: "商品單價 大於 100"
  },
  預期行為: "request body dateRange 與 chart datasets 皆來自本次執行。",
  實際行為: "本次 network request body dateRange=2026-03-01~2026-03-31；Chart.js datasets sum=123。",
  currentRunEvidence: {
    dom: {
      filterRow: "商品單價 大於 100"
    },
    network: {
      requestBody: {
        dateRange: {
          start: "2026-03-01",
          end: "2026-03-31"
        }
      }
    },
    chart: {
      datasets: [12, 34, 77]
    }
  }
};

const writeWorkbook = async (filePath: string, cases: FixtureCase[], schemaVersion = "fixture-result-v1"): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const index = workbook.addWorksheet("索引");
  index.getCell("A1").value = "schema_version";
  index.getCell("B1").value = schemaVersion;

  const sheet = workbook.addWorksheet("測試案例");
  sheet.addRow(["群組", "編號", "測試項目", "測試類型", "執行方式", "結果", "失敗分類", "詳細紀錄JSON"]);
  for (const item of cases) {
    sheet.addRow([
      "H:Fixture",
      item.caseNo,
      `${item.caseNo} result evidence gate fixture`,
      "前後端整合",
      "agent",
      item.status,
      "",
      item.detailJson
    ]);
  }

  const bugs = workbook.addWorksheet("Bug");
  bugs.addRow(["嚴重度", "Bug ID", "關聯編號", "標題", "描述", "建議", "狀態"]);
  await workbook.xlsx.writeFile(filePath);
};

const writeLegacyBugHeaderWorkbook = async (filePath: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const index = workbook.addWorksheet("索引");
  index.addRow(["欄位", "值"]);
  index.addRow(["schemaVersion", "legacy-bug-header-fixture-v1"]);

  const sheet = workbook.addWorksheet("測試案例");
  sheet.addRow(["群組", "編號", "測試項目", "測試類型", "執行方式", "結果", "失敗分類", "詳細紀錄JSON"]);
  sheet.addRow([
    "H:Fixture",
    "FIX-H-01",
    "legacy bug header parser fixture",
    "前後端整合",
    "agent",
    "PASS",
    "",
    JSON.stringify(goodDetail)
  ]);

  const bugs = workbook.addWorksheet("Bug");
  bugs.addRow(["Bug ID", "來源 Case", "標題", "嚴重度", "描述", "建議", "Evidence"]);
  bugs.addRow(["BUG-LEGACY-001", "FIX-H-01", "舊欄位相容性", "P2", "legacy fixture", "keep compatible", ""]);

  await workbook.xlsx.writeFile(filePath);
};

const runGate = async (
  xlsxPath: string,
  options: { currentCaseNo?: string | null; expectedCaseNos?: string[]; resultSource?: string | null } = {}
) => {
  const parsed = await parseResultXlsx(xlsxPath);
  return evaluateResultEvidenceGate({
    parsed,
    currentCaseNo: options.currentCaseNo ?? "FIX-H-01",
    expectedCaseNos: options.expectedCaseNos ?? ["FIX-H-01"],
    resultSource: options.resultSource ?? "codex_generated",
    requireSingleCase: true
  });
};

const hasIssue = (report: { issues: Array<{ code: string; severity: string }> }, code: string): boolean =>
  report.issues.some((item) => item.code === code && item.severity === "error");

const main = async (): Promise<void> => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-result-evidence-gate-"));
  try {
    const good = path.join(tempRoot, "good-result.xlsx");
    await writeWorkbook(good, [
      {
        caseNo: "FIX-H-01",
        status: "PASS",
        detailJson: JSON.stringify(goodDetail)
      }
    ]);
    const goodReport = await runGate(good);
    assert.equal(goodReport.status, "ok", `good result should pass; issues=${JSON.stringify(goodReport.issues)}`);

    const legacyBugHeader = path.join(tempRoot, "legacy-bug-header-result.xlsx");
    await writeLegacyBugHeaderWorkbook(legacyBugHeader);
    const legacyParsed = await parseResultXlsx(legacyBugHeader);
    assert.equal(legacyParsed.schemaVersion, "legacy-bug-header-fixture-v1");
    assert.equal(legacyParsed.bugs.length, 1);
    assert.equal(legacyParsed.bugs[0]?.relatedCaseNo, "FIX-H-01");
    assert.equal(legacyParsed.bugs[0]?.status, "OPEN");

    const multi = path.join(tempRoot, "multi-result.xlsx");
    await writeWorkbook(multi, [
      { caseNo: "FIX-H-01", status: "PASS", detailJson: JSON.stringify(goodDetail) },
      { caseNo: "FIX-H-02", status: "PASS", detailJson: JSON.stringify(goodDetail) }
    ]);
    const multiReport = await runGate(multi, { expectedCaseNos: ["FIX-H-01", "FIX-H-02"] });
    assert.equal(multiReport.status, "error");
    assert.ok(hasIssue(multiReport, "RESULT_MULTIPLE_CASES"));

    const missingEvidence = path.join(tempRoot, "missing-evidence-result.xlsx");
    await writeWorkbook(missingEvidence, [
      {
        caseNo: "FIX-H-01",
        status: "PASS",
        detailJson: JSON.stringify({
          測試目的: "fixture",
          設定條件: "照步驟設定",
          預期行為: "應 PASS",
          實際行為: "看起來 PASS，但沒有任何可稽核材料。"
        })
      }
    ]);
    const missingEvidenceReport = await runGate(missingEvidence);
    assert.equal(missingEvidenceReport.status, "error");
    assert.ok(hasIssue(missingEvidenceReport, "CURRENT_RUN_EVIDENCE_MISSING"));

    const fallbackReport = await runGate(good, { resultSource: "agent_fallback" });
    assert.equal(fallbackReport.status, "error");
    assert.ok(hasIssue(fallbackReport, "AGENT_FALLBACK_RESULT_NOT_TRUSTED"));

    const missingToolBridge = path.join(tempRoot, "missing-tool-bridge-result.xlsx");
    await writeWorkbook(missingToolBridge, [
      {
        caseNo: "FIX-H-01",
        status: "PASS",
        detailJson: JSON.stringify({
          ...goodDetail,
          實際行為: "本次 network request body 已驗證；Tommy 已授權刪除，並已完成刪除動作。"
        })
      }
    ]);
    const missingToolBridgeReport = await runGate(missingToolBridge);
    assert.equal(missingToolBridgeReport.status, "error");
    assert.ok(hasIssue(missingToolBridgeReport, "TOOL_BRIDGE_RESPONSE_MISSING"));

    const invalidJson = path.join(tempRoot, "invalid-json-result.xlsx");
    await writeWorkbook(invalidJson, [
      {
        caseNo: "FIX-H-01",
        status: "PASS",
        detailJson: "{not-json"
      }
    ]);
    const invalidJsonReport = await runGate(invalidJson);
    assert.equal(invalidJsonReport.status, "error");
    assert.ok(hasIssue(invalidJsonReport, "DETAIL_JSON_PARSE_ERROR"));

    console.log(
      JSON.stringify(
        {
          ok: true,
          fixture: "result-evidence-gate",
          checked: [
            "single current-case result with current-run evidence passes",
            "legacy Bug sheet header 來源 Case without 狀態 is parsed as OPEN",
            "multi-case result is blocked",
            "missing current-run evidence is blocked",
            "agent fallback result is blocked",
            "Tool Bridge action claim without response evidence is blocked",
            "invalid detail_json is blocked"
          ]
        },
        null,
        2
      )
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
