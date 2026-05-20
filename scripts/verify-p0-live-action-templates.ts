import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CaseManifestCase } from "../agent/src/case-manifest";
import { evaluateCapabilityGate } from "../agent/src/capability-gate";
import { buildHelperExecutionPlan } from "../agent/src/helper-execution-plan";
import { inferCaseScope } from "../agent/src/case-scope";
import type { StructuredCaseScopeContract } from "../agent/src/structured-case-scope";

type JsonObject = Record<string, any>;

const root = process.cwd();
const contractPath = path.join(root, "domain-packs", "BI_OFFICIAL_UI_COLLAGE", "case-scope-runtime-contracts.json");
const observeContractPath = path.join(root, "domain-packs", "BI_OFFICIAL_UI_COLLAGE", "action-contracts", "observeFrontendState.json");
const helperExecutorPath = path.join(root, "agent", "src", "bi-ui-helper-executor.ts");

const readJson = <T>(filePath: string): T => JSON.parse(fs.readFileSync(filePath, "utf8")) as T;

const contracts = (): StructuredCaseScopeContract[] => {
  const file = readJson<JsonObject>(contractPath);
  return (file.contracts as JsonObject[]).map((item) => ({
    version: "v1",
    source: "domain-packs/BI_OFFICIAL_UI_COLLAGE/case-scope-runtime-contracts.json",
    domain: "BI_OFFICIAL_UI_COLLAGE",
    ...item
  })) as StructuredCaseScopeContract[];
};

const chineseTarget = (target: StructuredCaseScopeContract["testTarget"]): string => {
  switch (target) {
    case "frontend_presentation":
      return "前端呈現";
    case "frontend_backend_integration":
      return "前後端整合";
    case "functional_flow":
      return "功能流程";
    case "backend_function":
      return "後端功能";
    default:
      return "前端呈現";
  }
};

const fixtureCase = (contract: StructuredCaseScopeContract): CaseManifestCase => ({
  order: 1,
  rowNumber: 2,
  groupId: contract.caseNo.split("-").at(-2) ?? null,
  groupName: "P0.19 live action template fixture",
  caseNo: contract.caseNo,
  caseTitle: `${contract.caseNo} live action template smoke`,
  testType: chineseTarget(contract.testTarget),
  executionMethod: "agent",
  riskLevel: "🟢 觀察",
  testTarget: chineseTarget(contract.testTarget),
  cleanupChecklist: "欄位=不影響;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
  preconditions: contract.requiresEditor ? "起始頁面: BI official UI；進入拼貼報表新增報表頁。" : "起始頁面: BI official UI。",
  stepsSummary: [
    contract.routeIntent === "download_execution" ? "完成有效 preview 後點擊 editor 下載按鈕，驗證下載 CSV 與下載 toast。" : "",
    contract.routeIntent === "preview_execution" ? "透過 UI 設定欄位、日期並按執行 preview，讀取 request body 與 chart datasets。" : "",
    contract.requiredActions.map((item) => `${item.action}:${item.target}:${item.expectedOutcome}`).join(" ")
  ].filter(Boolean).join(" "),
  expected: "Expected behavior is defined by caseScopeContract requiredActions and evidenceRequirements.",
  resultStatus: null,
  testDate: null,
  detailJson: null,
  validationMethod: "P0.19 live action template smoke",
  currentCaseFile: path.join(os.tmpdir(), `${contract.caseNo}.json`)
});

const requiredObservationTypes = new Set([
  "userButton",
  "projectToolbar",
  "reportModeRadio",
  "datePanel",
  "validationMessage",
  "sidebarGroup",
  "projectCreateModal",
  "rowDeleteTooltip",
  "deleteCancelFlow",
  "projectLimitToast",
  "sourceReportPicker",
  "fieldPicker",
  "dateTimeTypeTab",
  "datePanelCancel",
  "downloadToast",
  "saveModalCancel",
  "copyModalCancel"
]);

const previewTemplates = new Set(["collage.runPreviewAndCollectEvidence", "collage.runDateVariantsPreviewEvidence"]);

const main = (): void => {
  const allContracts = contracts();
  const observeContract = readJson<JsonObject>(observeContractPath);
  const observeTypes = new Set(Object.keys(observeContract.observationTypes ?? {}));
  const executorSource = fs.readFileSync(helperExecutorPath, "utf8");

  for (const type of requiredObservationTypes) {
    assert(observeTypes.has(type), `observeFrontendState contract missing observationType ${type}`);
    assert(executorSource.includes(`"${type}"`), `helper executor source does not accept observationType ${type}`);
  }

  for (const snippet of [
    "FRONTEND_OBSERVATION_ASSERTION_FALSE_REQUIRES_CODEX_JUDGMENT",
    "date_range_under_test_not_completed_with_evidence",
    "caseScopeDatePresets",
    "caseScopeDateTimeTypeTab",
    "editor-toolbar-icon-download-control",
    "\"download.toast.state\"",
    "\"projectCreateModal.flow.state\"",
    "\"projectList.deleteCancelFlow.state\"",
    "\"sourceControl.after\"",
    "\"dateRange.preset.lastWeek\"",
    "\"dateRange.preset.currentWeek\"",
    "selectorFallbackFrom"
  ]) {
    assert(executorSource.includes(snippet), `helper executor missing P0.19 live-template guard: ${snippet}`);
  }

  const frontendCases = allContracts.filter((contract) => contract.routeIntent === "frontend_observation");
  assert(frontendCases.length > 0, "fixture should include frontend observation cases");
  for (const contract of frontendCases) {
    const currentCase = fixtureCase(contract);
    const scope = inferCaseScope(currentCase, null);
    assert.equal(scope.caseScopeContract?.caseNo, contract.caseNo, `${contract.caseNo} scope missing structured contract`);
    const gate = evaluateCapabilityGate(currentCase, null);
    assert.ok(gate.supportedHelperTemplates.includes("collage.observeFrontendState"), `${contract.caseNo} gate must support observeFrontendState`);
    const plan = buildHelperExecutionPlan({ runDir: os.tmpdir(), currentCase, helperHints: null });
    const templates = plan.actions.map((item) => item.template);
    assert.ok(templates.includes("collage.observeFrontendState"), `${contract.caseNo} plan must include observeFrontendState`);
    assert.ok(!templates.some((item) => previewTemplates.has(item)), `${contract.caseNo} frontend observation must not route to preview helper`);
    const observeAction = plan.actions.find((item) => item.template === "collage.observeFrontendState");
    assert.equal(observeAction?.params.observationType, contract.observationType, `${contract.caseNo} observationType drift`);
    assert.equal(observeAction?.caseScopeActions.length, contract.requiredActions.length, `${contract.caseNo} observe action lost caseScopeActions`);
    for (const target of contract.requiredActions.map((item) => item.target)) {
      assert.ok(observeAction?.caseScopeActions.some((item) => item.target === target), `${contract.caseNo} observe action missing target ${target}`);
    }
  }

  const downloadCase = allContracts.find((contract) => contract.routeIntent === "download_execution");
  assert(downloadCase, "fixture should include download execution case");
  const downloadPlan = buildHelperExecutionPlan({ runDir: os.tmpdir(), currentCase: fixtureCase(downloadCase), helperHints: null });
  assert.ok(downloadPlan.actions.some((item) => item.template === "collage.downloadCsvAndComparePreview"), "download case must include download helper");
  const minimalDownloadCase = {
    ...fixtureCase(downloadCase),
    caseTitle: `${downloadCase.caseNo} structured download route`,
    stepsSummary: downloadCase.requiredActions.map((item) => `${item.action}:${item.target}:${item.expectedOutcome}`).join(" "),
    expected: "Expected behavior is defined by caseScopeContract only."
  };
  const minimalDownloadPlan = buildHelperExecutionPlan({ runDir: os.tmpdir(), currentCase: minimalDownloadCase, helperHints: null });
  assert.ok(
    minimalDownloadPlan.actions.some((item) => item.template === "collage.downloadCsvAndComparePreview"),
    "download_execution contract must include download helper even when prose lacks 下載/CSV keywords"
  );

  const multiSourceCase: CaseManifestCase = {
    order: 1,
    rowNumber: 2,
    groupId: "D",
    groupName: "D:cross-source",
    caseNo: "BIUI_COLLAGE_R001-D-01",
    caseTitle: "跨報表欄位組合 — 數據獨立性",
    testType: "後端功能",
    executionMethod: "agent",
    riskLevel: "🟢 觀察",
    testTarget: "後端功能",
    cleanupChecklist: "欄位=新增帳號數,總營收,退費總金額;篩選=0組;分組=不影響;時間=2026/03/01~2026/03/31;顯示=不影響",
    preconditions: "起始頁面: 拼貼模式新增報表設定頁\n導航路徑: 我的自訂 > 拼貼報表 > 任一專案 > +新增報表\n建構模式: 拼貼\n來源報表(多源): 每日報表, 雙平台營收佔比, 退費追蹤\n固定欄位: 新增帳號數(每日報表), 總營收(雙平台營收佔比), 退費總金額(退費追蹤)",
    stepsSummary: "選擇三個不同來源報表欄位，按執行 preview。",
    expected: "3 欄都成功 preview，且 source report 不被解析為 literal '(多源)'。",
    resultStatus: null,
    testDate: null,
    detailJson: null,
    validationMethod: "P0.28 multi-source route smoke",
    currentCaseFile: path.join(os.tmpdir(), "BIUI_COLLAGE_R001-D-01.json")
  };
  const multiSourcePlan = buildHelperExecutionPlan({ runDir: os.tmpdir(), currentCase: multiSourceCase, helperHints: null });
  const configureAction = multiSourcePlan.actions.find((item) => item.template === "collage.configureMetric");
  assert(configureAction, "D-01 multi-source case must route to configureMetric");
  assert.deepEqual(configureAction.params.sourceReports, ["每日報表", "雙平台營收佔比", "退費追蹤"]);
  assert.deepEqual(configureAction.params.fields, ["新增帳號數", "總營收", "退費總金額"]);
  assert.notEqual(configureAction.params.source, "(多源):");

  console.log(JSON.stringify({
    ok: true,
    frontendObservationCases: frontendCases.length,
    observationTypes: [...requiredObservationTypes],
    downloadCase: downloadCase.caseNo
  }, null, 2));
};

main();
