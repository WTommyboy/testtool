import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { parseResultXlsx } from "../src/result-parser/result-xlsx-parser";
import { evaluateResultEvidenceGate } from "../src/result-parser/result-evidence-gate";
import { containCaseLevelResultEvidenceGateIssues } from "../src/result-parser/result-evidence-containment";

type FixtureCase = {
  caseNo: string;
  status: string;
  detailJson: string;
  testType?: string;
  failCategory?: string;
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
  sheet.addRow(["群組ID", "群組", "編號", "測試項目", "測試類型", "執行方式", "結果", "失敗分類", "詳細紀錄JSON"]);
  for (const item of cases) {
    sheet.addRow([
      "H",
      "H:Fixture",
      item.caseNo,
      `${item.caseNo} result evidence gate fixture`,
      item.testType ?? "前後端整合",
      "agent",
      item.status,
      item.failCategory ?? "",
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
  sheet.addRow(["群組ID", "群組", "編號", "測試項目", "測試類型", "執行方式", "結果", "失敗分類", "詳細紀錄JSON"]);
  sheet.addRow([
    "H",
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
  options: {
    currentCaseNo?: string | null;
    expectedCaseNos?: string[];
    resultSource?: string | null;
    externalToolBridgeEvidenceByCase?: Record<string, Array<{ requestId?: string | null; eventType?: string | null }>>;
  } = {}
) => {
  const parsed = await parseResultXlsx(xlsxPath);
  return evaluateResultEvidenceGate({
    parsed,
    currentCaseNo: options.currentCaseNo ?? "FIX-H-01",
    expectedCaseNos: options.expectedCaseNos ?? ["FIX-H-01"],
    resultSource: options.resultSource ?? "codex_generated",
    requireSingleCase: true,
    externalToolBridgeEvidenceByCase: options.externalToolBridgeEvidenceByCase
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

    const blockedMissingCore = path.join(tempRoot, "blocked-missing-core-result.xlsx");
    await writeWorkbook(blockedMissingCore, [
      {
        caseNo: "FIX-H-01",
        status: "BLOCKED",
        detailJson: JSON.stringify({
          blocked_reason: "fixture blocked without the required core narrative",
          currentRunEvidence: goodDetail.currentRunEvidence
        })
      }
    ]);
    const blockedMissingCoreReport = await runGate(blockedMissingCore);
    assert.equal(blockedMissingCoreReport.status, "error");
    assert.ok(hasIssue(blockedMissingCoreReport, "DETAIL_JSON_REQUIRED_FIELD_MISSING"));

    const fallbackReport = await runGate(good, { resultSource: "agent_fallback" });
    assert.equal(fallbackReport.status, "error");
    assert.ok(hasIssue(fallbackReport, "AGENT_FALLBACK_RESULT_NOT_TRUSTED"));

    const diagnosticReport = await runGate(good, { resultSource: "diagnostic" });
    assert.equal(diagnosticReport.status, "error");
    assert.ok(hasIssue(diagnosticReport, "DIAGNOSTIC_RESULT_NOT_TRUSTED"));

    const benignOverwriteProse = path.join(tempRoot, "benign-overwrite-prose-result.xlsx");
    await writeWorkbook(benignOverwriteProse, [
      {
        caseNo: "FIX-H-01",
        status: "PASS",
        detailJson: JSON.stringify({
          ...goodDetail,
          預期行為: "同一 session 內變更日期區間後重新執行，第二次結果需覆蓋第一次 preview 顯示。",
          實際行為: "本次 network request body 與 Chart.js datasets 均來自第二次日期區間；未處理 native dialog、未執行不可逆覆寫儲存。"
        })
      }
    ]);
    const benignOverwriteProseReport = await runGate(benignOverwriteProse);
    assert.equal(
      benignOverwriteProseReport.status,
      "ok",
      `benign overwrite prose should not require Tool Bridge response; issues=${JSON.stringify(benignOverwriteProseReport.issues)}`
    );

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

    const allowlistedNativeValidation = path.join(tempRoot, "allowlisted-native-validation-result.xlsx");
    await writeWorkbook(allowlistedNativeValidation, [
      {
        caseNo: "FIX-H-01",
        status: "BLOCKED",
        detailJson: JSON.stringify({
          測試目的: "fixture",
          設定條件: "preview execute precondition fixture",
          預期行為: "Execute should only be clicked after a metric field is selected.",
          實際行為: "browser_handle_dialog observed native alert 請至少選擇一個欄位; this is a non-destructive validation alert and the case was blocked as an execute precondition failure.",
          blocked_reason: "EXECUTE_PRECONDITION_NO_SELECTED_FIELDS",
          currentRunEvidence: goodDetail.currentRunEvidence
        })
      }
    ]);
    const allowlistedNativeValidationReport = await runGate(allowlistedNativeValidation);
    assert.equal(
      allowlistedNativeValidationReport.status,
      "ok",
      `non-destructive validation alert should not require Tool Bridge response; issues=${JSON.stringify(allowlistedNativeValidationReport.issues)}`
    );

    const outOfScopePreviewBlocker = path.join(tempRoot, "out-of-scope-preview-blocker-result.xlsx");
    await writeWorkbook(outOfScopePreviewBlocker, [
      {
        caseNo: "BIUI_COLLAGE_R001-K-10",
        status: "BLOCKED",
        testType: "前端呈現",
        failCategory: "EXECUTE_PRECONDITION_NO_SELECTED_FIELDS",
        detailJson: JSON.stringify({
          測試目的: "空設定/未完成設定點「計算」按鈕的防呆。",
          設定條件: "第一列空白，previewRequired=false。",
          預期行為: "應觀察防呆提示與 request 是否觸發，不應用 preview 前置條件直接阻擋。",
          實際行為: "helper saw selectedMetricFields=0 and returned EXECUTE_PRECONDITION_NO_SELECTED_FIELDS before case-specific frontend observation.",
          blocked_reason: "EXECUTE_PRECONDITION_NO_SELECTED_FIELDS",
          previewRequired: false,
          currentRunEvidence: goodDetail.currentRunEvidence
        })
      }
    ]);
    const outOfScopeParsed = await parseResultXlsx(outOfScopePreviewBlocker);
    const outOfScopeReport = evaluateResultEvidenceGate({
      parsed: outOfScopeParsed,
      currentCaseNo: "BIUI_COLLAGE_R001-K-10",
      expectedCaseNos: ["BIUI_COLLAGE_R001-K-10"],
      resultSource: "codex_generated",
      requireSingleCase: true
    });
    assert.equal(outOfScopeReport.status, "error");
    assert.ok(hasIssue(outOfScopeReport, "RESULT_SCOPE_OUT_OF_SCOPE_PREVIEW_BLOCKER"));
    const containmentReport = containCaseLevelResultEvidenceGateIssues(outOfScopeParsed, outOfScopeReport);
    assert.equal(containmentReport.status, "updated");
    assert.deepEqual(containmentReport.updatedCaseNos, ["BIUI_COLLAGE_R001-K-10"]);
    const containedOutOfScopeReport = evaluateResultEvidenceGate({
      parsed: outOfScopeParsed,
      currentCaseNo: "BIUI_COLLAGE_R001-K-10",
      expectedCaseNos: ["BIUI_COLLAGE_R001-K-10"],
      resultSource: "codex_generated",
      requireSingleCase: true
    });
    assert.equal(
      containedOutOfScopeReport.status,
      "ok",
      `case-level containment should pass evidence gate for ingest continuation; issues=${JSON.stringify(containedOutOfScopeReport.issues)}`
    );

    const frontendObservationScreenshotGap = path.join(tempRoot, "frontend-observation-screenshot-gap-result.xlsx");
    await writeWorkbook(frontendObservationScreenshotGap, [
      {
        caseNo: "BIUI_COLLAGE_R001-K-01",
        status: "BLOCKED",
        testType: "前端呈現",
        failCategory: "EVIDENCE_INSUFFICIENT",
        detailJson: JSON.stringify({
          測試目的: "確認新增報表預設為拼貼模式。",
          設定條件: "已進入新增報表頁，previewRequired=false。",
          預期行為: "畫面應可見拼貼模式為預設選項。",
          實際行為: "已取得本次新增報表頁截圖，但缺少 radio checked / aria-checked / URL mode segment 結構化 evidence，暫無法自動判 PASS。",
          blocked_reason: "EVIDENCE_INSUFFICIENT: 缺少 mode selected structured state。",
          previewRequired: false,
          currentRunEvidence: {
            screenshotPath:
              "output/helper-artifacts/BIUI_COLLAGE_R001-K-01/BIUI_COLLAGE_R001-K-01-create-report.png",
            dom: {
              visibleText: ["拼貼模式", "精算模式 / 指標趨勢", "精算模式 / 明細檢視"],
              checkedState: null
            }
          }
        })
      }
    ]);
    const visualGapParsed = await parseResultXlsx(frontendObservationScreenshotGap);
    const visualGapReport = evaluateResultEvidenceGate({
      parsed: visualGapParsed,
      currentCaseNo: "BIUI_COLLAGE_R001-K-01",
      expectedCaseNos: ["BIUI_COLLAGE_R001-K-01"],
      resultSource: "codex_generated",
      requireSingleCase: true
    });
    assert.equal(visualGapReport.status, "error");
    assert.ok(hasIssue(visualGapReport, "RESULT_FRONTEND_OBSERVATION_VISUAL_FALLBACK_REQUIRED"));
    const visualContainmentReport = containCaseLevelResultEvidenceGateIssues(visualGapParsed, visualGapReport);
    assert.equal(visualContainmentReport.status, "updated");
    assert.equal(visualContainmentReport.reason, "RESULT_EVIDENCE_GATE_CONTAINED_AS_BLOCKED_NEEDS_VISUAL_REVIEW");
    assert.deepEqual(visualContainmentReport.updatedCaseNos, ["BIUI_COLLAGE_R001-K-01"]);
    assert.equal(visualGapParsed.cases[0]?.status, "BLOCKED");
    assert.equal(visualGapParsed.cases[0]?.verdictReason, "BLOCKED_NEEDS_VISUAL_REVIEW");
    assert.equal(visualGapParsed.cases[0]?.detailJson?.["evidenceSource"], "screenshotVisual");
    const containedVisualGapReport = evaluateResultEvidenceGate({
      parsed: visualGapParsed,
      currentCaseNo: "BIUI_COLLAGE_R001-K-01",
      expectedCaseNos: ["BIUI_COLLAGE_R001-K-01"],
      resultSource: "codex_generated",
      requireSingleCase: true
    });
    assert.equal(
      containedVisualGapReport.status,
      "ok",
      `visual fallback containment should pass evidence gate for ingest continuation; issues=${JSON.stringify(containedVisualGapReport.issues)}`
    );

    const blockedNoNativeConfirm = path.join(tempRoot, "blocked-no-native-confirm-result.xlsx");
    await writeWorkbook(blockedNoNativeConfirm, [
      {
        caseNo: "FIX-H-01",
        status: "BLOCKED",
        detailJson: JSON.stringify({
          測試目的: "驗證從設定頁按下返回可回專案頁，且不出現 native confirm。",
          設定條件: "同一 run/case 使用 dedicated browser session。",
          預期行為: "點返回成功回到專案頁，無 native confirm 干擾。",
          實際行為: "現有 current-run helper 證據缺少返回按鈕動作鏈與對應 native dialog 驗證紀錄，無法產生可信 PASS/FAIL。",
          blocked_reason: "EVIDENCE_INSUFFICIENT: 缺少返回後狀態同步證據。",
          currentRunEvidence: goodDetail.currentRunEvidence
        })
      }
    ]);
    const blockedNoNativeConfirmReport = await runGate(blockedNoNativeConfirm);
    assert.equal(
      blockedNoNativeConfirmReport.status,
      "ok",
      `negative or missing native-confirm evidence prose should not require Tool Bridge response; issues=${JSON.stringify(blockedNoNativeConfirmReport.issues)}`
    );

    const formulaModalBlocked = path.join(tempRoot, "formula-modal-blocked-result.xlsx");
    await writeWorkbook(formulaModalBlocked, [
      {
        caseNo: "FIX-H-01",
        status: "BLOCKED",
        detailJson: JSON.stringify({
          測試目的: "驗證拼貼模式運算欄位公式可完成 UI 設定與 preview。",
          設定條件: "helper 已完成開啟專案與進入新增報表頁，第三步在公式視窗送出卡住。",
          預期行為: "成功新增運算欄位並執行 preview。",
          實際行為:
            "helper action H3 於公式編輯器發生 FORMULA_MODAL_SUBMIT_NOT_CLICKABLE，無法完成公式確認與後續執行，未取得本題必需 network.requestBody 與 chart.datasets。",
          blocked_reason: "EVIDENCE_INSUFFICIENT: helper current-run evidence 顯示關鍵 UI 步驟被阻斷。",
          currentRunEvidence: goodDetail.currentRunEvidence
        })
      }
    ]);
    const formulaModalBlockedReport = await runGate(formulaModalBlocked);
    assert.equal(
      formulaModalBlockedReport.status,
      "ok",
      `formula modal blocked wording should not require Tool Bridge response; issues=${JSON.stringify(formulaModalBlockedReport.issues)}`
    );

    const expectedToolBridgeOnly = path.join(tempRoot, "expected-tool-bridge-only-result.xlsx");
    await writeWorkbook(expectedToolBridgeOnly, [
      {
        caseNo: "FIX-H-01",
        status: "BLOCKED",
        detailJson: JSON.stringify({
          測試目的: "驗證儲存流程需等待 Tool Bridge response 後才能處理 native confirm。",
          設定條件: "本題預期儲存時需要 Tommy 授權覆寫。",
          預期行為: {
            description: "Tool Bridge response 到齊後才可點擊儲存並處理 native dialog。",
            executionState: "nativeDialogReached"
          },
          實際行為:
            "helper current-run evidence 顯示欄位設定階段已 blocked，preview/save/native dialog 均未到達，因此本題缺少儲存前置 evidence，未執行不可逆或 native dialog 動作。",
          blocked_reason: "EVIDENCE_INSUFFICIENT: setupBlocked/saveNotReached",
          currentRunEvidence: goodDetail.currentRunEvidence
        })
      }
    ]);
    const expectedToolBridgeOnlyReport = await runGate(expectedToolBridgeOnly);
    assert.equal(
      expectedToolBridgeOnlyReport.status,
      "ok",
      `Tool Bridge prose in purpose/setup/expected fields should not trigger response gate; issues=${JSON.stringify(expectedToolBridgeOnlyReport.issues)}`
    );

    const saveNotReachedExecutionState = path.join(tempRoot, "save-not-reached-execution-state-result.xlsx");
    await writeWorkbook(saveNotReachedExecutionState, [
      {
        caseNo: "FIX-H-01",
        status: "BLOCKED",
        detailJson: JSON.stringify({
          測試目的: "驗證儲存流程需等待 Tool Bridge response 後才能處理 native confirm。",
          設定條件: "helper 已完成設定但 preview 前 blocked。",
          預期行為: "Tool Bridge response 到齊後才可進行儲存。",
          實際行為: "本次 executionState=saveNotReached；未到達 native dialog 或不可逆動作。",
          blocked_reason: "EVIDENCE_INSUFFICIENT: saveNotReached",
          currentRunEvidence: {
            ...goodDetail.currentRunEvidence,
            executionState: "saveNotReached"
          }
        })
      }
    ]);
    const saveNotReachedExecutionStateReport = await runGate(saveNotReachedExecutionState);
    assert.equal(
      saveNotReachedExecutionStateReport.status,
      "ok",
      `saveNotReached executionState should not require Tool Bridge response; issues=${JSON.stringify(saveNotReachedExecutionStateReport.issues)}`
    );

    const nativeDialogReachedMissingResponse = path.join(tempRoot, "native-dialog-reached-missing-response-result.xlsx");
    await writeWorkbook(nativeDialogReachedMissingResponse, [
      {
        caseNo: "FIX-H-01",
        status: "BLOCKED",
        detailJson: JSON.stringify({
          測試目的: "驗證 native dialog reached 時必須有 Tool Bridge response。",
          設定條件: "helper 已到達 save native dialog。",
          預期行為: "Tool Bridge response 到齊後才可處理 native dialog。",
          實際行為: "本次 executionState=nativeDialogReached，但未附 Tool Bridge response。",
          blocked_reason: "TOOL_BRIDGE_RESPONSE_MISSING",
          currentRunEvidence: {
            ...goodDetail.currentRunEvidence,
            executionState: "nativeDialogReached"
          }
        })
      }
    ]);
    const nativeDialogReachedMissingResponseReport = await runGate(nativeDialogReachedMissingResponse);
    assert.equal(nativeDialogReachedMissingResponseReport.status, "error");
    assert.ok(hasIssue(nativeDialogReachedMissingResponseReport, "TOOL_BRIDGE_RESPONSE_MISSING"));

    const missingToolBridgeResponseProse = path.join(tempRoot, "missing-tool-bridge-response-prose-result.xlsx");
    await writeWorkbook(missingToolBridgeResponseProse, [
      {
        caseNo: "FIX-H-01",
        status: "BLOCKED",
        detailJson: JSON.stringify({
          測試目的: "驗證儲存流程若缺少授權回覆 evidence 應停在 BLOCKED。",
          設定條件: "helper 已完成 preview；儲存 continuation 未執行。",
          預期行為: "Tool Bridge response 到齊後才可進行儲存。",
          實際行為: "本次 run 缺少 Tool Bridge response，helper 未取得儲存授權回覆，未執行 native confirm 或不可逆動作。",
          blocked_reason: "TOOL_BRIDGE_RESPONSE_MISSING: 缺少 Tool Bridge response，目前只能判 BLOCKED。",
          currentRunEvidence: goodDetail.currentRunEvidence
        })
      }
    ]);
    const missingToolBridgeResponseProseReport = await runGate(missingToolBridgeResponseProse);
    assert.equal(
      missingToolBridgeResponseProseReport.status,
      "ok",
      `missing Tool Bridge response prose should not be treated as a claim that a response exists; issues=${JSON.stringify(missingToolBridgeResponseProseReport.issues)}`
    );

    const externalToolBridgeReport = await runGate(missingToolBridge, {
      externalToolBridgeEvidenceByCase: {
        "FIX-H-01": [{ requestId: "fixture-FIX-H-01-save", eventType: "tool_response.delivered" }]
      }
    });
    assert.equal(externalToolBridgeReport.status, "ok", `external Tool Bridge evidence should satisfy response gate; issues=${JSON.stringify(externalToolBridgeReport.issues)}`);

    const toolUnavailableWithoutPreflight = path.join(tempRoot, "tool-unavailable-without-preflight-result.xlsx");
    await writeWorkbook(toolUnavailableWithoutPreflight, [
      {
        caseNo: "BIUI_COLLAGE_R001-I-07",
        status: "BLOCKED",
        testType: "前端呈現",
        failCategory: "TOOL_EXECUTION_UNAVAILABLE",
        detailJson: JSON.stringify({
          測試目的: "確認右上使用者按鈕顯示登入者名稱。",
          設定條件: "已進入 BI official UI。",
          預期行為: "應讀取右上使用者按鈕文字。",
          實際行為: "Codex claimed TOOL_EXECUTION_UNAVAILABLE without attempting browser_tabs.",
          blocked_reason: "TOOL_EXECUTION_UNAVAILABLE",
          currentRunEvidence: {
            capabilityGate: "degraded frontend observation"
          }
        })
      }
    ]);
    const toolUnavailableParsed = await parseResultXlsx(toolUnavailableWithoutPreflight);
    const toolUnavailableReport = evaluateResultEvidenceGate({
      parsed: toolUnavailableParsed,
      currentCaseNo: "BIUI_COLLAGE_R001-I-07",
      expectedCaseNos: ["BIUI_COLLAGE_R001-I-07"],
      resultSource: "codex_generated",
      requireSingleCase: true
    });
    assert.equal(toolUnavailableReport.status, "error");
    assert.ok(hasIssue(toolUnavailableReport, "RESULT_TOOL_EXECUTION_UNAVAILABLE_WITHOUT_PREFLIGHT"));
    const toolUnavailableContainmentReport = containCaseLevelResultEvidenceGateIssues(toolUnavailableParsed, toolUnavailableReport);
    assert.equal(toolUnavailableContainmentReport.status, "updated");
    assert.equal(toolUnavailableContainmentReport.reason, "RESULT_EVIDENCE_GATE_CONTAINED_AS_BLOCKED_NEEDS_REJUDGMENT_TOOL_PREFLIGHT");

    const toolUnavailableWithPreflight = path.join(tempRoot, "tool-unavailable-with-preflight-result.xlsx");
    await writeWorkbook(toolUnavailableWithPreflight, [
      {
        caseNo: "BIUI_COLLAGE_R001-I-07",
        status: "BLOCKED",
        testType: "前端呈現",
        failCategory: "TOOL_EXECUTION_UNAVAILABLE",
        detailJson: JSON.stringify({
          測試目的: "確認右上使用者按鈕顯示登入者名稱。",
          設定條件: "已進入 BI official UI。",
          預期行為: "應讀取右上使用者按鈕文字。",
          實際行為: "browser_tabs preflight failed before UI evidence could be collected.",
          blocked_reason: "TOOL_EXECUTION_UNAVAILABLE",
          currentRunEvidence: {
            browserMcp: {
              preflight: {
                attempted: true,
                tool: "browser_tabs",
                status: "failed",
                timestamp: new Date().toISOString()
              }
            }
          }
        })
      }
    ]);
    const toolUnavailableWithPreflightReport = await runGate(toolUnavailableWithPreflight, {
      currentCaseNo: "BIUI_COLLAGE_R001-I-07",
      expectedCaseNos: ["BIUI_COLLAGE_R001-I-07"]
    });
    assert.equal(
      toolUnavailableWithPreflightReport.status,
      "ok",
      `TOOL_EXECUTION_UNAVAILABLE with browserMcp.preflight should be accepted; issues=${JSON.stringify(toolUnavailableWithPreflightReport.issues)}`
    );

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
            "BLOCKED detail_json missing core fields is blocked",
            "agent fallback result is blocked",
            "diagnostic result source is blocked",
            "benign overwrite prose does not require Tool Bridge response",
            "Tool Bridge action claim without response evidence is blocked",
            "non-destructive selected-field validation alert does not require Tool Bridge response",
            "out-of-scope preview blocker can be contained as case-level rejudgment",
            "frontend observation screenshot evidence requires explicit visual fallback and can be contained",
            "TOOL_EXECUTION_UNAVAILABLE requires browserMcp preflight and can be contained when missing",
            "negative or insufficient native-confirm prose does not require Tool Bridge response",
            "formula modal blocked prose does not require Tool Bridge response",
            "Tool Bridge prose in purpose/setup/expected fields does not trigger response gate",
            "saveNotReached executionState does not require Tool Bridge response",
            "nativeDialogReached executionState requires Tool Bridge response",
            "missing Tool Bridge response prose does not require a second Tool Bridge response",
            "Tool Bridge action claim can be satisfied by current-run server event evidence",
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
