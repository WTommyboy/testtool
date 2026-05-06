import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { writeResultTemplate } from "../agent/src/result-template";
import { validateResultWorkbookContract } from "../agent/src/result-contract";
import { ensureBlockedResultCurrentRunEvidence } from "../agent/src/result-evidence-enricher";
import { normalizeCodexResultWorkbook } from "../agent/src/result-workbook-normalizer";
import { repairSingleCaseResultWorkbook } from "../agent/src/result-workbook-repair";
import { parseResultXlsx } from "../src/result-parser/result-xlsx-parser";
import { evaluateResultEvidenceGate } from "../src/result-parser/result-evidence-gate";

const writeBadLegacyWorkbook = async (filePath: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("索引").addRow(["欄位", "值"]);

  const cases = workbook.addWorksheet("測試案例");
  cases.addRow(["群組ID", "群組", "編號", "測試項目", "測試類型", "執行方式", "結果", "失敗分類", "詳細紀錄JSON"]);
  cases.addRow([
    "A",
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
  cases.addRow(["群組ID", "群組", "編號", "測試項目", "測試類型", "執行方式", "結果", "失敗分類", "詳細紀錄JSON"]);
  cases.addRow([
    "A",
    "A",
    "TOOL-A-01",
    "blocked fixture",
    "功能流程",
    "agent",
    "BLOCKED",
    "EVIDENCE_INSUFFICIENT",
	    JSON.stringify({
	      測試目的: "驗證 BLOCKED result 仍保留可稽核主敘述。",
	      設定條件: "fixture helper pre-run partial evidence",
	      預期行為: "無法執行時應留下 blocked reason 與本次 evidence。",
	      實際行為: "fixture blocked before browser evidence was available.",
	      blocked_reason: "fixture blocked without evidence"
	    })
  ]);

  const bugs = workbook.addWorksheet("Bug");
  bugs.addRow(["嚴重度", "Bug ID", "關聯編號", "標題", "描述", "建議", "狀態"]);
  await workbook.xlsx.writeFile(filePath);
};

const writePassWorkbook = async (filePath: string, caseNo: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const index = workbook.addWorksheet("索引");
  index.getCell("A1").value = "schema_version";
  index.getCell("B1").value = "fixture-result-v1";

  const cases = workbook.addWorksheet("測試案例");
  cases.addRow(["群組ID", "群組", "編號", "測試項目", "測試類型", "執行方式", "結果", "失敗分類", "詳細紀錄JSON"]);
  cases.addRow([
    "A",
    "A",
    caseNo,
    "pass fixture",
    "功能流程",
    "agent",
    "PASS",
    "",
    JSON.stringify({
      測試目的: "fixture",
      設定條件: "fixture",
      預期行為: "expected",
      實際行為: "actual"
    })
  ]);

  const bugs = workbook.addWorksheet("Bug");
  bugs.addRow(["嚴重度", "Bug ID", "關聯編號", "標題", "描述", "建議", "狀態"]);
  await workbook.xlsx.writeFile(filePath);
};

const writeLegacySingleCaseWithoutGroupId = async (filePath: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const index = workbook.addWorksheet("索引");
  index.getCell("A1").value = "schema_version";
  index.getCell("B1").value = "fixture-result-v1";

  const cases = workbook.addWorksheet("測試案例");
  cases.addRow(["群組", "編號", "測試項目", "測試類型", "執行方式", "結果", "失敗分類", "詳細紀錄JSON"]);
  cases.addRow([
    "A:拼貼模式工具測試",
    "TOOL-A-01",
    "儲存並重新開啟拼貼報表",
    "功能流程",
    "agent",
    "FAIL",
    "FUNCTIONAL_REGRESSION",
    JSON.stringify({
      測試目的: "fixture",
      設定條件: {},
      預期行為: "重新開啟後應保留日期區間",
      實際行為: "重新開啟後日期區間顯示為過去7天",
      錯誤原因: "date range was reset after reopen",
      根因層級: "frontend_state_persistence",
      驗證方法: "helper pre-run + Codex reopen observation",
      "RD 分派": "frontend"
    })
  ]);

  const bugs = workbook.addWorksheet("Bug");
  bugs.addRow(["嚴重度", "Bug ID", "關聯編號", "標題", "描述", "建議", "狀態"]);
  await workbook.xlsx.writeFile(filePath);
};

const writeTestcaseStyleCodexWorkbook = async (filePath: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const index = workbook.addWorksheet("索引");
  index.addRow(["輪次ID", "位置", "功能主項", "功能細項", "輪次名稱", "日期", "測試者", "MD連結"]);
  index.addRow(["OTTEST004", "數據中心", "BI工具", "拼貼模式", "OTTEST004 fixture", "2026-05-06", "Codex", "fixture"]);

  const sheet = workbook.addWorksheet("測試案例");
  sheet.addRow([
    "輪次ID",
    "群組ID",
    "群組",
    "編號",
    "測試類型",
    "測試項目",
    "風險等級",
    "測試標的",
    "狀態清理",
    "前置條件",
    "步驟",
    "預期結果",
    "結果",
    "執行方式",
    "測試日",
    "詳細紀錄JSON",
    "驗證方法"
  ]);
  sheet.addRow(["OTTEST004", "A", "A:欄位清單檢查", "OTTEST004-A-01", "功能流程", "A-01 fixture", "🟢 觀察", "功能流程", "", "", "", "", "", "", "", "", "DOM"]);
  sheet.addRow([
    "OTTEST004",
    "B",
    "B:日期區間邏輯",
    "OTTEST004-B-04",
    "功能流程",
    "全動態區間 — 「上週」/「本週」",
    "🟢 觀察",
    "功能流程",
    "欄位=新增帳號數;篩選=0組;分組=不影響;時間=上週/本週;顯示=每天",
    "fixture",
    "fixture",
    "fixture",
    "PASS",
    "Agent helper + Codex judgment",
    "2026-05-06",
    JSON.stringify({
      測試目的: "驗證拼貼模式「上週/本週」日期切換。",
      設定條件: "欄位=新增帳號數;顯示=每天",
      預期行為: "上週與本週 dateRange 和 preview 筆數正確。",
      實際行為: "上週 7 筆，本週 3 筆，request dateRange 均符合預期。",
      currentRunEvidence: {
        helperReport: "output/helper-artifacts/OTTEST004-B-04/helper-report.jsonl"
      }
    }),
    "date-variants-preview-evidence.json"
  ]);
  sheet.addRow(["OTTEST004", "B", "B:日期區間邏輯", "OTTEST004-B-05", "功能流程", "B-05 fixture", "🟢 觀察", "功能流程", "", "", "", "", "", "", "", "", "DOM"]);

  const bugs = workbook.addWorksheet("Bug");
  bugs.addRow(["輪次ID", "嚴重度", "關聯編號", "描述", "建議確認方式", "是否已修正", "修正複測日期"]);
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

    const legacySingleCase = path.join(tempRoot, "legacy-single-case-missing-group-id.xlsx");
    await writeLegacySingleCaseWithoutGroupId(legacySingleCase);
    const legacyReport = await validateResultWorkbookContract(legacySingleCase);
    assert.equal(legacyReport.status, "error");
    assert.ok(legacyReport.issues.some((item) => item.message.includes("群組ID")));
    const repairReport = await repairSingleCaseResultWorkbook({
      filePath: legacySingleCase,
      currentCase: {
        groupId: "A",
        groupName: "A:拼貼模式工具測試",
        caseNo: "TOOL-A-01",
        caseTitle: "儲存並重新開啟拼貼報表",
        testType: "功能流程",
        executionMethod: "agent"
      },
      expectedCaseNos: ["TOOL-A-01"]
    });
    assert.equal(repairReport.status, "updated", JSON.stringify(repairReport));
    const repairedReport = await validateResultWorkbookContract(legacySingleCase);
    assert.equal(repairedReport.status, "ok", JSON.stringify(repairedReport.issues));
    const repairedParsed = await parseResultXlsx(legacySingleCase);
    assert.equal(repairedParsed.cases[0]?.groupId, "A");

    const testcaseStyle = path.join(tempRoot, "testcase-style-codex-result.xlsx");
    await writeTestcaseStyleCodexWorkbook(testcaseStyle);
    const testcaseStyleBefore = await validateResultWorkbookContract(testcaseStyle);
    assert.equal(testcaseStyleBefore.status, "error");
    assert.ok(testcaseStyleBefore.issues.some((item) => item.code === "RESULT_XLSX_HEADER_MISSING"));
    const normalizeReport = await normalizeCodexResultWorkbook({
      filePath: testcaseStyle,
      runId: "fixture-run",
      roundId: "OTTEST004_016",
      currentCase: {
        groupId: "B",
        groupName: "B:日期區間邏輯",
        caseNo: "OTTEST004-B-04",
        caseTitle: "全動態區間 — 「上週」/「本週」",
        testType: "功能流程",
        executionMethod: "Agent helper + Codex judgment"
      },
      expectedCaseNos: ["OTTEST004-B-04"]
    });
    assert.equal(normalizeReport.status, "updated", JSON.stringify(normalizeReport));
    assert.equal(normalizeReport.detectedFormat, "testcase-style");
    assert.ok(normalizeReport.backupPath && fs.existsSync(normalizeReport.backupPath));
    const normalizedContract = await validateResultWorkbookContract(testcaseStyle);
    assert.equal(normalizedContract.status, "ok", JSON.stringify(normalizedContract.issues));
    const normalizedParsed = await parseResultXlsx(testcaseStyle);
    assert.equal(normalizedParsed.cases.length, 1);
    assert.equal(normalizedParsed.cases[0]?.caseNo, "OTTEST004-B-04");
    assert.equal(normalizedParsed.cases[0]?.status, "PASS");

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

    const contradictoryPass = path.join(tempRoot, "pass-contradicts-helper-evidence.xlsx");
    await writePassWorkbook(contradictoryPass, "TOOL-A-05");
    fs.mkdirSync(path.join(tempRoot, "output", "helper-artifacts", "TOOL-A-05"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "output", "helper-artifacts", "TOOL-A-05", "collage.reopenReport-latest.json"), JSON.stringify({
      schemaVersion: "bi-ui-helper-report-v1",
      caseId: "TOOL-A-05",
      action: "collage.reopenReport",
      status: "ok",
      evidence: {
        reopenReportEvidence: {
          stateDelta: {
            after: {
              checks: {
                field: true,
                dateRange: false,
                display: true
              }
            }
          }
        }
      }
    }, null, 2));
    const contradictoryReport = await validateResultWorkbookContract(contradictoryPass, undefined, { runDir: tempRoot });
    assert.equal(contradictoryReport.status, "error");
    assert.ok(contradictoryReport.issues.some((item) => item.code === "RESULT_PASS_CONTRADICTS_HELPER_EVIDENCE"));

    const configureMetricContradictoryPass = path.join(tempRoot, "pass-configure-metric-contradicts-helper-evidence.xlsx");
    await writePassWorkbook(configureMetricContradictoryPass, "OTTEST004-B-10");
    fs.mkdirSync(path.join(tempRoot, "output", "helper-artifacts", "OTTEST004-B-10"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "output", "helper-artifacts", "OTTEST004-B-10", "collage.configureMetric-latest.json"), JSON.stringify({
      schemaVersion: "bi-ui-helper-report-v1",
      caseId: "OTTEST004-B-10",
      action: "collage.configureMetric",
      status: "ok",
      evidence: {
        stateDelta: {
          after: {
            checks: {
              field: true,
              dateRange: false,
              display: true
            }
          }
        }
      }
    }, null, 2));
    const configureMetricContradictoryReport = await validateResultWorkbookContract(configureMetricContradictoryPass, undefined, { runDir: tempRoot });
    assert.equal(configureMetricContradictoryReport.status, "error");
    assert.ok(configureMetricContradictoryReport.issues.some((item) => item.code === "RESULT_PASS_CONTRADICTS_HELPER_EVIDENCE"));

    const normalizedDateRangePass = path.join(tempRoot, "pass-configure-metric-normalized-date-evidence.xlsx");
    await writePassWorkbook(normalizedDateRangePass, "OTTEST004-B-09");
    fs.mkdirSync(path.join(tempRoot, "output", "helper-artifacts", "OTTEST004-B-09"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "output", "helper-artifacts", "OTTEST004-B-09", "collage.configureMetric-latest.json"), JSON.stringify({
      schemaVersion: "bi-ui-helper-report-v1",
      caseId: "OTTEST004-B-09",
      action: "collage.configureMetric",
      status: "ok",
      evidence: {
        dateRangeEvidence: {
          ok: true,
          dateUiEvidence: {
            schemaVersion: "date-ui-evidence-v1",
            checks: {
              requestedLabelVisible: true,
              staticRequestedRangeObserved: true,
              representedRangeMatchesRequested: true
            },
            requestedRange: {
              startIso: "2026-03-01",
              endIso: "2026-03-15"
            },
            matchedRepresentedRange: {
              startIso: "2026-03-01",
              endIso: "2026-03-15",
              display: "2026/03/01 ~ 2026/03/15"
            }
          }
        },
        stateDelta: {
          after: {
            checks: {
              field: true,
              dateRange: false,
              display: true
            }
          }
        }
      }
    }, null, 2));
    const normalizedDateRangeReport = await validateResultWorkbookContract(normalizedDateRangePass, undefined, { runDir: tempRoot });
    assert.equal(normalizedDateRangeReport.status, "ok", JSON.stringify(normalizedDateRangeReport.issues));

    console.log(JSON.stringify({
      ok: true,
      fixture: "agent-result-contract",
      checked: [
        "generated result-template follows adapter headers and detail_json fields",
        "generated result-template contains no EX-* example result rows",
        "legacy Bug header 來源 Case is rejected by agent self-check",
        "FAIL detail_json missing required fields is rejected before upload",
        "single-case legacy result workbook missing 群組ID is repaired before self-check",
        "testcase-style Codex output is normalized to one current-case result-contract row before self-check",
        "BLOCKED detail_json with core fields but without current-run evidence is enriched before upload",
        "PASS result contradicting helper false checks is rejected before upload",
        "configureMetric dateRange=false still blocks without normalized date evidence",
        "configureMetric dateRange=false is allowed when date-ui-evidence proves the represented range"
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
