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

const helperHints = (caseId: string, operationTemplate: string): HelperHints => ({
  caseId,
  automationLevel: "helper",
  operationTemplate,
  params: {},
  requiredEvidence: ["dom.state"],
  forbiddenAutomation: ["direct_bi_api", "internal_js_setter", "multi_case_batch"],
  aiDecisionRequired: true,
  raw: {},
  sourcePath: "verify-tag-tool-runtime.ts",
  sourceRelativePath: "verify-tag-tool-runtime.ts",
  warnings: []
});

const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "tag-tool-runtime-"));

const assertTagCase = (testCase: CaseManifestCase, expectedTemplate: string, hints: HelperHints | null = null): void => {
  const gate = evaluateCapabilityGate(testCase, hints);
  assert.equal(gate.supportStatus, "supported", `${testCase.caseNo} gate supportStatus`);
  assert.equal(gate.executionMode, "helper_assisted", `${testCase.caseNo} executionMode`);
  assert.equal(gate.helperPreRunAllowed, true, `${testCase.caseNo} helperPreRunAllowed`);
  assert.ok(gate.supportedHelperTemplates.includes(expectedTemplate), `${testCase.caseNo} supported templates include ${expectedTemplate}: ${gate.supportedHelperTemplates.join(",")}`);

  const plan = buildHelperExecutionPlan({ runDir, currentCase: testCase, helperHints: hints });
  assert.equal(plan.actions[0]?.template, expectedTemplate, `${testCase.caseNo} first action template`);
  assert.equal(plan.actions[0]?.canJudgeResult, false, `${testCase.caseNo} helper cannot judge result`);
  assert.ok(plan.actions[0]?.requiredEvidence.length, `${testCase.caseNo} required evidence`);
};

assertTagCase(baseCase, "tagTool.observeList");

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

assertTagCase({
  ...baseCase,
  caseNo: "TT-VERIFY-D-01",
  groupName: "D: 標籤變數設定",
  caseTitle: "標籤變數設定頁可讀取目前值、stepper 與設置紀錄格式",
  stepsSummary: "1. 開啟標籤變數設定頁\n2. 讀取 N/Z/Y/X/A/B\n3. 讀取設置紀錄時間格式",
  validationMethod: "Evidence: tagVariables.form.state, tagVariables.history.state"
}, "tagTool.observeVariableSettings");

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
