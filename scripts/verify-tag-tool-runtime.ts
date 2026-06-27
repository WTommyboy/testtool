import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateCapabilityGate } from "../agent/src/capability-gate";
import { buildHelperExecutionPlan } from "../agent/src/helper-execution-plan";
import type { CaseManifestCase } from "../agent/src/case-manifest";
import type { HelperHints } from "../agent/src/helper-hints";
import { readOptionalDomainPackFile } from "../src/domain-loader";

const baseCase: CaseManifestCase = {
  order: 1,
  rowNumber: 2,
  groupId: "A",
  groupName: "A: 玩家標籤管理",
  caseNo: "TT-VERIFY-A-01",
  caseTitle: "玩家標籤管理主頁顯示欄位與空狀態",
  testType: "前端呈現",
  executionMethod: "Codex + Playwright",
  riskLevel: "🟢 觀察",
  testTarget: "前端呈現",
  cleanupChecklist: "欄位=不影響;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
  preconditions: "domain=TAG_TOOL; dev url=/tag/player?gameId=541",
  stepsSummary: "1. 開啟玩家標籤管理頁\n2. 讀取標籤名稱、標籤類型、條件類型、時間類型、排程狀態、資料最後更新時間、備註",
  expected: "依 PRD 顯示玩家標籤管理列表欄位與空狀態。",
  resultStatus: null,
  testDate: null,
  detailJson: null,
  validationMethod: "Evidence: tagList.table.state",
  currentCaseFile: null
};

const helperHints = (
  caseId: string,
  operationTemplate: string,
  automationLevel = "helper",
  params: Record<string, unknown> = {}
): HelperHints => ({
  caseId,
  automationLevel,
  operationTemplate,
  params,
  requiredEvidence: ["dom.state"],
  forbiddenAutomation: ["direct_bi_api", "internal_js_setter", "multi_case_batch"],
  aiDecisionRequired: true,
  raw: {},
  sourcePath: "verify-tag-tool-runtime.ts",
  sourceRelativePath: "verify-tag-tool-runtime.ts",
  warnings: []
});

const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "tag-tool-runtime-"));

const assertTagCase = (testCase: CaseManifestCase, expectedTemplate: string, hints: HelperHints | null = null): ReturnType<typeof buildHelperExecutionPlan> => {
  const gate = evaluateCapabilityGate(testCase, hints);
  assert.equal(gate.supportStatus, "supported", `${testCase.caseNo} gate supportStatus`);
  assert.equal(gate.executionMode, "helper_assisted", `${testCase.caseNo} executionMode`);
  assert.equal(gate.helperPreRunAllowed, true, `${testCase.caseNo} helperPreRunAllowed`);
  assert.ok(gate.supportedHelperTemplates.includes(expectedTemplate), `${testCase.caseNo} supported templates include ${expectedTemplate}: ${gate.supportedHelperTemplates.join(",")}`);

  const plan = buildHelperExecutionPlan({ runDir, currentCase: testCase, helperHints: hints });
  assert.equal(plan.actions[0]?.template, expectedTemplate, `${testCase.caseNo} first action template`);
  assert.equal(plan.actions[0]?.canJudgeResult, false, `${testCase.caseNo} helper cannot judge result`);
  assert.ok(plan.actions[0]?.requiredEvidence.length, `${testCase.caseNo} required evidence`);
  return plan;
};

assertTagCase(baseCase, "tagTool.observeList");

assertTagCase({
  ...baseCase,
  caseNo: "TT-VERIFY-A-00-MANUAL-AI",
  caseTitle: "manual_ai 玩家標籤管理列表仍可執行安全 helper pre-run",
  stepsSummary: "1. 開啟玩家標籤管理主頁\n2. 讀取列表欄位與資料列，不進行新增、刪除或終止"
}, "tagTool.observeList", helperHints("TT-VERIFY-A-00-MANUAL-AI", "manual_ai", "manual_ai"));

assertTagCase({
  ...baseCase,
  caseNo: "TT-VERIFY-A-02",
  caseTitle: "玩家標籤管理主頁可達並顯示 breadcrumb、頁名與空狀態",
  stepsSummary: "1. 開啟玩家標籤管理主頁\n2. 讀取 URL、breadcrumb、頁名與空狀態\n3. 若無資料，讀取空狀態文字；不得點擊新增、刪除或更多操作",
  validationMethod: "Evidence: navigation.state, tagList.table.state"
}, "tagTool.observeList");

assertTagCase({
  ...baseCase,
  caseNo: "TT-VERIFY-B-01",
  groupName: "B: 新增條件標籤",
  caseTitle: "新增標籤頁初始狀態符合 PRD 未選標籤類型要求",
  stepsSummary: "1. 開啟新增標籤頁\n2. 讀取條件標籤/人工標籤 radio 與條件類型、時間類型、分析時段\n3. 讀取子標籤級距初始狀態",
  validationMethod: "Evidence: tagForm.typeVisibility.state, conditionTag.valueEditor.state"
}, "tagTool.observeCreateForm");

assertTagCase({
  ...baseCase,
  caseNo: "TT-VERIFY-C-01",
  groupName: "C: 新增人工標籤",
  caseTitle: "人工標籤 CSV 上傳格式提示與檔案狀態",
  stepsSummary: "1. 開啟新增標籤頁\n2. 選人工標籤\n3. 上傳 CSV fixture\n4. 讀取上傳狀態與 validation 訊息",
  validationMethod: "Evidence: manualUpload.file.state"
}, "tagTool.uploadManualCsv");

const assertUploadRoute = (caseNo: string, title: string, stepsSummary: string, expectedFlow: string, expectedFixtureKind: string): void => {
  const plan = assertTagCase({
    ...baseCase,
    caseNo,
    groupName: "C: 新增人工標籤",
    caseTitle: title,
    stepsSummary,
    validationMethod: "Evidence: fixtureRef.state, manualUpload.file.state, manualUpload.validation.state"
  }, "tagTool.uploadManualCsv");
  assert.equal(plan.actions[0]?.params.flow, expectedFlow, `${caseNo} inferred flow`);
  assert.equal(plan.actions[0]?.params.fixtureKind, expectedFixtureKind, `${caseNo} inferred fixtureKind`);
  assert.ok(plan.actions[0]?.requiredEvidence.includes("fixtureRef.state"), `${caseNo} upload evidence should include fixtureRef.state`);
};

assertUploadRoute(
  "TT-VERIFY-C-02",
  "上傳區檔案選擇限 csv 原生對話框 accept 屬性",
  "1. 選人工標籤\n2. 讀取 input accept 屬性，確認檔案選擇限 csv",
  "observeFileAccept",
  "validAddCsv"
);
assertUploadRoute(
  "TT-VERIFY-C-03",
  "上傳時即時檢查 CSV 超 10000 筆 toast",
  "1. 選人工標籤\n2. 上傳超過 10000 筆 CSV fixture\n3. 讀取 toast",
  "uploadOverLimitCsv",
  "overLimitCsv"
);
assertUploadRoute(
  "TT-VERIFY-C-04",
  "確定新增時跨檔檢查 同 ID 對多標籤值 toast",
  "1. 選人工標籤\n2. 上傳同 ID 對多標籤值 duplicate conflict CSV fixture\n3. 讀取 toast",
  "uploadDuplicateConflictCsv",
  "duplicateConflictCsv"
);
assertUploadRoute(
  "TT-VERIFY-C-05",
  "確定新增時跨檔檢查 帳號 ID 不存在於專案 toast",
  "1. 選人工標籤\n2. 上傳帳號 ID 不存在 CSV fixture\n3. 讀取 toast",
  "uploadNonexistentAccountCsv",
  "nonexistentAccountCsv"
);
assertUploadRoute(
  "TT-VERIFY-C-06",
  "上傳區檔案類型錯誤 上傳 .txt 行為",
  "1. 選人工標籤\n2. 上傳 .txt 非 csv 檔案\n3. 讀取錯誤 toast",
  "uploadInvalidTypeFile",
  "textFile"
);
assertUploadRoute(
  "TT-VERIFY-C-07",
  "確定新增時 未上傳任何檔案 toast",
  "1. 選人工標籤\n2. 未上傳任何檔案直接點儲存\n3. 讀取未上傳檔案 toast",
  "submitWithoutFile",
  "validAddCsv"
);
assertUploadRoute(
  "TT-VERIFY-C-08",
  "已選檔案區 多檔上傳 刪除 新增檔案按鈕",
  "1. 選人工標籤\n2. 多檔上傳\n3. 讀取已選檔案 chip 並移除檔案",
  "uploadMultipleFiles",
  "validAddCsv"
);

const rowActionPlan = assertTagCase({
  ...baseCase,
  caseNo: "BIUI_TAG_R001-C-05",
  groupName: "C: 玩家標籤列表 row 操作",
  caseTitle: "更多操作可導向 查看設置 標籤資訊 複製",
  stepsSummary: "1. 開啟玩家標籤管理主頁\n2. 對條件標籤 row 開啟更多操作\n3. 依序點擊查看設置、標籤資訊、複製，觀察是否導向查看設置頁、標籤資訊頁、新增頁且名稱欄預填",
  validationMethod: "Evidence: tagRowAction.route.state"
}, "tagTool.openRowActionAndObserve");
assert.equal(rowActionPlan.actions[0]?.params.flow, "verifyRowActionRoutes", "row action flow");
assert.deepEqual(rowActionPlan.actions[0]?.params.rowActionItems, ["查看設置", "標籤資訊", "複製"], "row action items");

const editUploadPlan = assertTagCase({
  ...baseCase,
  caseNo: "BIUI_TAG_R001-G-03",
  groupName: "G: 人工標籤編輯頁",
  caseTitle: "編輯標籤頁可上傳異動 CSV",
  stepsSummary: "1. 從人工標籤 row 點擊編輯\n2. 在編輯標籤頁上傳包含 操作 add/update/delete 欄位的 CSV 檔案\n3. 讀取 validation 訊息",
  validationMethod: "Evidence: manualUpload.file.state"
}, "tagTool.uploadManualCsv");
assert.equal(editUploadPlan.actions[0]?.params.flow, "uploadEditCsv", "edit upload flow");
assert.equal(editUploadPlan.actions[0]?.params.fixtureKind, "validEditCsv", "edit upload fixture");
assert.equal(editUploadPlan.actions[0]?.params.mode, "edit", "edit upload mode");

const invalidEditUploadPlan = assertTagCase({
  ...baseCase,
  caseNo: "BIUI_TAG_R001-G-05",
  groupName: "G: 人工標籤編輯頁",
  caseTitle: "編輯時上傳檢查 — 操作欄非 add/update/delete 阻擋",
  stepsSummary: "1. 進入編輯頁\n2. 上傳該 CSV\n3. 驗證操作欄非 add/update/delete 時即時阻擋",
  validationMethod: "Evidence: manualUpload.file.state, manualUpload.validation.state"
}, "tagTool.uploadManualCsv");
assert.equal(invalidEditUploadPlan.actions[0]?.params.flow, "uploadEditCsv", "invalid edit upload flow");
assert.equal(invalidEditUploadPlan.actions[0]?.params.fixtureKind, "invalidEditCsv", "invalid edit upload fixture");
assert.equal(invalidEditUploadPlan.actions[0]?.params.mode, "edit", "invalid edit upload mode");

assertTagCase({
  ...baseCase,
  caseNo: "TT-VERIFY-G-OBS",
  groupName: "G: 人工標籤編輯頁",
  caseTitle: "編輯標籤頁顯示僅需上傳異動名單提示",
  stepsSummary: "1. 從人工標籤 row 點擊編輯\n2. 觀察編輯標籤頁提示文字與檔案 input，不進行儲存",
  validationMethod: "Evidence: manualTag.editForm.state, manualUpload.fileInput.state"
}, "tagTool.observeManualEditForm");

const conditionInfoPlan = assertTagCase({
  ...baseCase,
  caseNo: "BIUI_TAG_R001-H-03",
  groupName: "H: 條件標籤資訊頁",
  caseTitle: "條件標籤資訊與每日資訊可開啟標籤值下拉",
  stepsSummary: "1. 從條件標籤 row 點擊標籤資訊\n2. 在標籤資訊與每日資訊頁點擊 標籤值(N/N) 下拉\n3. 讀取顯示數值控制與列表",
  validationMethod: "Evidence: tagInfo.controls.state"
}, "tagTool.observeTagInfo");
assert.equal(conditionInfoPlan.actions[0]?.params.flow, "openConditionValueFilter", "condition info flow");

const manualInfoPlan = assertTagCase({
  ...baseCase,
  caseNo: "BIUI_TAG_R001-J-02",
  groupName: "J: 人工標籤資訊頁",
  caseTitle: "人工標籤資訊與名單列表顯示基本欄位",
  stepsSummary: "1. 從人工標籤 row 點擊標籤資訊\n2. 觀察標籤資訊與名單列表、編輯設置按鈕與名單 table",
  validationMethod: "Evidence: manualTag.memberTable.state"
}, "tagTool.observeTagInfo");
assert.equal(manualInfoPlan.actions[0]?.params.flow, "observeManualTagInfo", "manual info flow");

const toolbarDeleteModalPlan = assertTagCase({
  ...baseCase,
  caseNo: "BIUI_TAG_R001-L-01",
  groupName: "L: 刪除/終止 modal",
  caseTitle: "刪除 modal — 標題/內文/取消/刪除 按鈕樣式",
  stepsSummary: "1. 在主頁勾選 1 個測試標籤\n2. 點右上「刪除」icon\n3. 讀取 modal 後點取消",
  validationMethod: "Evidence: dangerousModal.state"
}, "tagTool.openDangerousModalAndCancel");
assert.equal(toolbarDeleteModalPlan.actions[0]?.params.flow, "openDeleteAndCancel", "toolbar delete flow");
assert.equal(toolbarDeleteModalPlan.actions[0]?.params.dangerActionScope, "toolbarSelection", "toolbar delete scope");

const terminateModalPlan = assertTagCase({
  ...baseCase,
  caseNo: "BIUI_TAG_R001-L-04",
  groupName: "L: 刪除/終止 modal",
  caseTitle: "終止流程 — 從「⋯」進終止 modal + 取消",
  stepsSummary: "1. 主頁點該 row「⋯ > 終止」\n2. 讀取 modal 標題、內文、按鈕\n3. 點取消",
  validationMethod: "Evidence: dangerousModal.state"
}, "tagTool.openDangerousModalAndCancel");
assert.equal(terminateModalPlan.actions[0]?.params.flow, "openTerminateAndCancel", "terminate flow");

assertTagCase({
  ...baseCase,
  caseNo: "TT-VERIFY-D-01",
  groupName: "D: 標籤變數設定",
  caseTitle: "標籤變數設定頁可讀取目前值、stepper 與設置紀錄格式",
  stepsSummary: "1. 開啟標籤變數設定頁\n2. 讀取 N/Z/Y/X/A/B\n3. 讀取設置紀錄時間格式",
  validationMethod: "Evidence: tagVariables.form.state, tagVariables.history.state"
}, "tagTool.observeVariableSettings");

const playerTagCreatePlan = assertTagCase({
  ...baseCase,
  caseNo: "TT-VERIFY-D-02",
  groupName: "D: 新增條件標籤",
  caseTitle: "playerTag 建立條件標籤 hint 正規化為 approval-gated helper",
  riskLevel: "🟡 建立",
  stepsSummary: "使用 playerTag.createConditionalTag 建立暫存條件標籤",
  validationMethod: "Evidence: toolBridge.response"
}, "tagTool.createConditionTag", helperHints("TT-VERIFY-D-02", "playerTag.createConditionalTag"));
assert.equal(playerTagCreatePlan.actions[0]?.requiresToolBridge, true, "playerTag create must require Tool Bridge approval");

assertTagCase({
  ...baseCase,
  caseNo: "TT-VERIFY-D-03",
  groupName: "D: 標籤變數設定",
  caseTitle: "playerTag saveTagVariables modifyValues=false 僅觀察標籤變數設定",
  stepsSummary: "讀取標籤變數設定與設置紀錄，不修改值",
  validationMethod: "Evidence: tagVariables.form.state, tagVariables.history.state"
}, "tagTool.observeVariableSettings", helperHints("TT-VERIFY-D-03", "playerTag.saveTagVariables", "helper", { modifyValues: false }));

const playerTagSavePlan = assertTagCase({
  ...baseCase,
  caseNo: "TT-VERIFY-D-04",
  groupName: "D: 標籤變數設定",
  caseTitle: "playerTag saveTagVariables modifyValues=true 正規化為 approval-gated save helper",
  riskLevel: "🟠 修改",
  stepsSummary: "修改標籤變數設定並儲存",
  validationMethod: "Evidence: toolBridge.response"
}, "tagTool.saveVariableSettings", helperHints("TT-VERIFY-D-04", "playerTag.saveTagVariables", "helper", { modifyValues: true }));
assert.equal(playerTagSavePlan.actions[0]?.requiresToolBridge, true, "playerTag save must require Tool Bridge approval");

assertTagCase({
  ...baseCase,
  caseNo: "TT-VERIFY-E-01",
  groupName: "E: 危險操作",
  caseTitle: "刪除標籤防呆窗可取消",
  stepsSummary: "1. 找到標籤 row\n2. 開啟刪除確認窗\n3. 取消",
  validationMethod: "Evidence: dangerousModal.state"
}, "tagTool.openDangerousModalAndCancel");

for (const contract of [
  "action-contracts/tagList.json",
  "action-contracts/createConditionTag.json",
  "action-contracts/manualUpload.json",
  "action-contracts/tagInfoReadOnly.json",
  "action-contracts/tagVariableSettings.json",
  "action-contracts/dangerousActions.json"
] as const) {
  assert.ok(readOptionalDomainPackFile("TAG_TOOL", contract), `TAG_TOOL optional contract readable: ${contract}`);
}

assertTagCase({
  ...baseCase,
  caseNo: "TT-VERIFY-F-01",
  groupName: "F: 建立",
  caseTitle: "建立暫存條件標籤",
  riskLevel: "🟡 建立",
  stepsSummary: "使用 approval-gated helper 建立暫存條件標籤",
  validationMethod: "Evidence: toolBridge.response"
}, "tagTool.createConditionTag", helperHints("TT-VERIFY-F-01", "tagTool.createConditionTag"));

console.log(JSON.stringify({ ok: true, checked: "TAG_TOOL runtime gate/plan/contracts" }, null, 2));
