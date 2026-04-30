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

const main = (): void => {
  const report = evaluateCapabilityGate(collageSaveReopenCase, null);
  assert.equal(report.supportStatus, "supported", `TOOL-A-01 save/reopen fixture should be helper supported; report=${JSON.stringify(report)}`);
  assert.deepEqual(report.unsupportedFeatures, []);
  assert.equal(report.detected.hasFilter, false, "篩選=不影響 must not be treated as an active filter capability");
  assert.equal(report.detected.hasGroup, false, "分組=不影響 must not be treated as an active group capability");
  assert.equal(report.detected.isMetadataDropdown, false, "metadata reference material must not turn a save/reopen flow into metadata-dropdown comparison");

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
          "active filter cases remain blocked until helper support exists"
        ]
      },
      null,
      2
    )
  );
};

main();
