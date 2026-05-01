import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateCapabilityGate } from "../agent/src/capability-gate";
import { buildHelperExecutionPlan } from "../agent/src/helper-execution-plan";
import type { CaseManifestCase } from "../agent/src/case-manifest";

const collageSaveReopenCase: CaseManifestCase = {
  order: 1,
  rowNumber: 2,
  groupId: "A",
  groupName: "A:拼貼模式工具測試",
  caseNo: "TOOL-A-01",
  caseTitle: "拼貼模式 — 完整建制流程(建立→執行→儲存→重新檢視 4 項設定還原)",
  testType: "功能流程",
  executionMethod: "Codex + Playwright",
  riskLevel: "🟡 建立",
  testTarget: "功能流程",
  cleanupChecklist: "欄位=新增帳號數;篩選=不影響;分組=不影響;時間=2026/03/01~2026/03/31;顯示=每天",
  preconditions: "建構模式: 拼貼\n參考資料: metadata v1.2.5, 來源報表=每日報表",
  stepsSummary: [
    "1. 進入拼貼模式新增報表頁",
    "2. 來源報表選「每日報表」並驗證 dropdown 顯示",
    "3. 加欄位「新增帳號數」",
    "4. 設時間區間 2026/03/01~2026/03/31",
    "5. 按執行",
    "6. 儲存報表(報表名: TOOL_A01_<timestamp>)",
    "7. 從清單重新開啟該報表",
    "8. 確認來源報表/時間/欄位/報表名還原"
  ].join("\n"),
  expected: "圖表顯示具體數值；儲存成功；重開後 4 項設定全部還原",
  resultStatus: null,
  testDate: null,
  detailJson: null,
  validationMethod: "Evidence: DOM read + Playwright snapshot + network request body",
  currentCaseFile: "fixture/TOOL-A-01.json"
};

const filterCase: CaseManifestCase = {
  ...collageSaveReopenCase,
  caseNo: "TOOL-F-01",
  cleanupChecklist: "欄位=新增帳號數;篩選=商品單價 大於 100;分組=不影響;時間=2026/03/01~2026/03/31;顯示=每天",
  stepsSummary: "1. 新增篩選 商品單價 大於 100\n2. 按執行"
};

const collageMultiFieldPreviewCase: CaseManifestCase = {
  ...collageSaveReopenCase,
  order: 2,
  rowNumber: 3,
  caseNo: "TOOL-A-02",
  caseTitle: "拼貼模式 — 同時選 3 個欄位執行 preview,驗證後端能正確回傳多欄資料",
  testType: "資料確認(多欄位 preview)",
  riskLevel: "🟢 觀察",
  testTarget: "後端功能",
  cleanupChecklist: "欄位=新增帳號數 + MAU(帳號) + 總營收(TWD);篩選=不影響;分組=不影響;時間=2026/03/01~2026/03/31;顯示=每天",
  preconditions: "建構模式: 拼貼\n參考資料: metadata v1.2.5, 來源報表=每日報表, 3 個欄位皆屬「每日報表」可選",
  stepsSummary: "1. 進入拼貼模式新增報表頁\n2. 來源報表選「每日報表」\n3. 依序加欄位:新增帳號數、MAU(帳號)、總營收(TWD)\n4. 設時間區間 2026/03/01~2026/03/31\n5. 按執行\n6. 透過 Playwright network observation 抓 preview API response",
  expected: "request body 含 3 個欄位的指標 ID\nresponse 回傳 3 個欄位的 daily 資料,各 31 個資料點",
  validationMethod: "Evidence: network request body + network response body + DOM read"
};

const collageMetadataCompareCase: CaseManifestCase = {
  ...collageSaveReopenCase,
  order: 3,
  rowNumber: 4,
  caseNo: "TOOL-A-03",
  caseTitle: "拼貼模式 — 「每日報表」可設置欄位是否與 metadata v1.2.5 一致",
  testType: "資料確認(metadata 對照)",
  riskLevel: "🟢 觀察",
  testTarget: "前端呈現",
  cleanupChecklist: "欄位=空;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
  preconditions: "建構模式: 拼貼\n參考資料: metadata v1.2.5, 來源報表=每日報表(規範 32 欄)",
  stepsSummary: "1. 進入拼貼模式新增報表頁\n2. 來源報表選「每日報表」\n3. 點「+ 新增欄位」展開欄位下拉\n4. 抓取下拉清單所有可選欄位\n5. 對照 metadata CSV\n6. detail_json 表格化呈現缺少 / 多出",
  expected: "「每日報表」可設置欄位完全符合 metadata v1.2.5 規範",
  validationMethod: "Evidence: DOM read(欄位下拉清單)+ metadata CSV 對照計算"
};

const main = (): void => {
  const report = evaluateCapabilityGate(collageSaveReopenCase, null);
  assert.equal(report.supportStatus, "supported", `TOOL-A-01 save/reopen fixture should be helper supported; report=${JSON.stringify(report)}`);
  assert.deepEqual(report.unsupportedFeatures, []);
  assert.equal(report.detected.hasFilter, false, "篩選=不影響 must not be treated as an active filter capability");
  assert.equal(report.detected.hasGroup, false, "分組=不影響 must not be treated as an active group capability");
  assert.equal(report.detected.isMetadataDropdown, false, "metadata reference material must not turn a save/reopen flow into metadata-dropdown comparison");

  const multiField = evaluateCapabilityGate(collageMultiFieldPreviewCase, null);
  assert.equal(multiField.detected.mode, "collage", "`指標 ID` inside a collage preview case must not be treated as metric mode");
  assert.equal(multiField.supportStatus, "supported", JSON.stringify(multiField));
  assert.deepEqual(multiField.unsupportedFeatures, []);

  const metadataCompare = evaluateCapabilityGate(collageMetadataCompareCase, null);
  assert.equal(metadataCompare.detected.mode, "collage", "`detail_json` wording must not be treated as record/detail mode");
  assert.equal(metadataCompare.detected.isMetadataDropdown, true, "metadata compare case should be recognized as dropdown/metadata observation");
  assert.equal(metadataCompare.supportStatus, "degraded", JSON.stringify(metadataCompare));
  assert.deepEqual(metadataCompare.unsupportedFeatures, []);

  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "uat-capability-gate-fixture-"));
  try {
    const plan = buildHelperExecutionPlan({ runDir, currentCase: collageSaveReopenCase, helperHints: null });
    assert.ok(plan.actions.some((item) => item.template === "collage.configureMetric"), "helper plan should include collage.configureMetric");
    assert.ok(plan.actions.some((item) => item.template === "collage.saveReport"), "helper plan should include collage.saveReport");
    assert.ok(plan.actions.some((item) => item.template === "collage.reopenReport"), "helper plan should include collage.reopenReport");
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }

  const blocked = evaluateCapabilityGate(filterCase, null);
  assert.equal(blocked.supportStatus, "unsupported", "active filter cases should remain blocked until filter helper coverage exists");
  assert.ok(blocked.unsupportedFeatures.includes("filter_helper_not_implemented"));

  console.log(
    JSON.stringify(
      {
        ok: true,
        fixture: "capability-gate",
        checked: [
          "neutral cleanup targets do not trigger unsupported filter/group gate",
          "metadata references alone do not trigger metadata-dropdown gate",
          "collage multi-field preview is not misclassified as metric mode",
          "collage metadata compare is not misclassified as record/detail mode",
          "active filter cases remain blocked until helper support exists"
        ]
      },
      null,
      2
    )
  );
};

main();
