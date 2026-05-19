import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CaseManifestCase } from "../agent/src/case-manifest";
import { evaluateCapabilityGate } from "../agent/src/capability-gate";
import { inferCaseScope } from "../agent/src/case-scope";
import { buildHelperExecutionPlan } from "../agent/src/helper-execution-plan";
import type { StructuredCaseScopeContract } from "../agent/src/structured-case-scope";
import { evaluateResultEvidenceGate } from "../src/result-parser/result-evidence-gate";
import type { ParsedResultXlsx } from "../src/result-parser/result-xlsx-parser";

type JsonObject = Record<string, any>;

const readJson = (filePath: string): JsonObject => JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonObject;
const root = process.cwd();
const contractPath = path.join(root, "domain-packs", "BI_OFFICIAL_UI_COLLAGE", "case-scope-runtime-contracts.json");
const objectPath = path.join(root, "domain-packs", "BI_OFFICIAL_UI_COLLAGE", "ui-object-vocabulary.json");
const platformPath = path.join(root, "contracts", "platform-action-vocabulary.v1.json");

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

const fixtureCase = (contract: StructuredCaseScopeContract): CaseManifestCase => {
  const targets = contract.requiredActions.map((item) => item.target).join(" ");
  const actions = contract.requiredActions.map((item) => `${item.action}:${item.expectedOutcome}`).join(" ");
  const isDownload = contract.routeIntent === "download_execution";
  const isPreview = contract.routeIntent === "preview_execution";
  return {
    order: 1,
    rowNumber: 2,
    groupId: contract.caseNo.split("-").at(-2) ?? null,
    groupName: "P0.16 runtime wiring fixture",
    caseNo: contract.caseNo,
    caseTitle: `${contract.caseNo} structured action/object runtime wiring`,
    testType: chineseTarget(contract.testTarget),
    executionMethod: "agent",
    riskLevel: "🟢 觀察",
    testTarget: chineseTarget(contract.testTarget),
    cleanupChecklist: contract.requiresEditor
      ? "欄位=新增帳號數;篩選=不影響;分組=不影響;時間=不影響;顯示=每天"
      : "欄位=不影響;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
    preconditions: contract.requiresEditor ? "起始頁面: BI official UI；進入拼貼報表新增報表頁。" : "起始頁面: BI official UI；專案頁或側邊欄。",
    stepsSummary: [
      "拼貼 official UI structured fixture.",
      contract.requiresEditor ? "進入新增報表頁。" : "留在專案頁。",
      isPreview ? "透過 UI 設定欄位、時間並按執行 preview。" : "",
      isDownload ? "透過 UI 設定欄位、按計算後點下載。" : "",
      `targets: ${targets}`,
      `actions: ${actions}`
    ].filter(Boolean).join(" "),
    expected: `Must satisfy structured expected outcomes for ${targets}. 本題 scope 由 caseScopeContract 定義。`,
    resultStatus: null,
    testDate: null,
    detailJson: null,
    validationMethod: "caseScopeContract + current-run evidence",
    currentCaseFile: ""
  };
};

const caseScopeContracts = (): StructuredCaseScopeContract[] => {
  const file = readJson(contractPath);
  return (file.contracts as JsonObject[]).map((item) => ({
    version: "v1",
    source: "domain-packs/BI_OFFICIAL_UI_COLLAGE/case-scope-runtime-contracts.json",
    domain: "BI_OFFICIAL_UI_COLLAGE",
    ...item
  })) as StructuredCaseScopeContract[];
};

const assertVocabularyCoverage = (contracts: StructuredCaseScopeContract[]): void => {
  const platform = readJson(platformPath);
  const objects = readJson(objectPath);
  const actionIds = new Set((platform.actions ?? []).map((item: JsonObject) => item.id));
  const expectedOutcomes = new Set(platform.expectedOutcomes ?? []);
  const objectIds = new Set((objects.objects ?? []).map((item: JsonObject) => item.id));
  assert.equal(contracts.length, 17, "P0 runtime wiring should cover the 15 reduced-smoke cases plus P0.26 K-09/L-08 action-template slices");
  for (const contract of contracts) {
    for (const action of contract.requiredActions) {
      assert.ok(actionIds.has(action.action), `${contract.caseNo} action ${action.action} is not in platform vocabulary`);
      assert.ok(expectedOutcomes.has(action.expectedOutcome), `${contract.caseNo} expectedOutcome ${action.expectedOutcome} is not in platform vocabulary`);
      assert.ok(objectIds.has(action.target), `${contract.caseNo} target ${action.target} is not in BI UI object vocabulary`);
      assert.ok(action.evidenceRequirements.length > 0, `${contract.caseNo} ${action.actionId} missing evidenceRequirements`);
    }
  }
};

const supportedObservationTypes = new Set([
  "userButton",
  "projectToolbar",
  "reportModeRadio",
  "datePanel",
  "validationMessage",
  "sidebarGroup",
  "rowDeleteTooltip",
  "projectLimitToast",
  "sourceReportPicker",
  "fieldPicker",
  "dateTimeTypeTab",
  "datePanelCancel",
  "downloadToast"
]);

const assertRuntimeRouting = (contracts: StructuredCaseScopeContract[]): void => {
  for (const contract of contracts) {
    const currentCase = fixtureCase(contract);
    const scope = inferCaseScope(currentCase, null);
    assert.equal(scope.caseScopeContract?.caseNo, contract.caseNo, `${contract.caseNo} inferCaseScope did not attach structured contract`);
    assert.equal(scope.testIntent, contract.routeIntent, `${contract.caseNo} routeIntent mismatch`);

    const gate = evaluateCapabilityGate(currentCase, null);
    assert.equal(gate.caseScope.caseScopeContract?.caseNo, contract.caseNo, `${contract.caseNo} capability gate missing structured contract`);

    const plan = buildHelperExecutionPlan({
      runDir: os.tmpdir(),
      currentCase,
      helperHints: null
    });
    assert.equal(plan.caseScopeContract?.caseNo, contract.caseNo, `${contract.caseNo} helper plan missing structured contract`);

    const flattenedActions = plan.actions.flatMap((item) => item.caseScopeActions);
    if (contract.routeIntent === "frontend_observation" && supportedObservationTypes.has(contract.observationType ?? "")) {
      assert.ok(
        plan.actions.some((item) => item.template === "collage.observeFrontendState"),
        `${contract.caseNo} supported frontend observation must route to observeFrontendState`
      );
    }
    if (contract.routeIntent === "preview_execution") {
      assert.ok(
        plan.actions.some((item) => item.template === "collage.runPreviewAndCollectEvidence" || item.template === "collage.runDateVariantsPreviewEvidence"),
        `${contract.caseNo} preview scope must include preview evidence helper`
      );
    }
    if (contract.routeIntent === "download_execution") {
      assert.ok(
        plan.actions.some((item) => item.template === "collage.downloadCsvAndComparePreview"),
        `${contract.caseNo} download scope must include download helper`
      );
    }
    for (const target of new Set(contract.requiredActions.map((item) => item.target))) {
      assert.ok(
        flattenedActions.some((item) => item.target === target) || plan.caseScopeContract.requiredActions.some((item) => item.target === target),
        `${contract.caseNo} helper plan lost structured target ${target}`
      );
    }
  }
};

const parsedResult = (detailJson: Record<string, unknown>): ParsedResultXlsx => ({
  parserVersion: "p0-runtime-wiring-fixture",
  schemaVersion: "fixture-result-v1",
  bugs: [],
  cases: [
    {
      groupId: "K",
      groupName: "P0 runtime wiring fixture",
      caseNo: "BIUI_COLLAGE_R001-K-10",
      caseTitle: "structured case scope detail fixture",
      testType: "前端呈現",
      executionMethod: "agent",
      status: "PASS",
      verdictReason: null,
      detailJsonRaw: JSON.stringify(detailJson),
      detailParseError: null,
      detailJson
    }
  ]
});

const assertResultGateStructuredContractValidation = (contracts: StructuredCaseScopeContract[]): void => {
  const k10 = contracts.find((item) => item.caseNo === "BIUI_COLLAGE_R001-K-10");
  assert.ok(k10, "missing K-10 contract");
  const validDetail = {
    測試目的: "fixture",
    設定條件: "fixture",
    預期行為: "fixture",
    實際行為: "current-run DOM evidence shows validation toast.",
    currentRunEvidence: {
      dom: { text: "第 1 欄位，欄位未設置完成" },
      caseScopeContract: k10
    }
  };
  const validReport = evaluateResultEvidenceGate({
    parsed: parsedResult(validDetail),
    currentCaseNo: "BIUI_COLLAGE_R001-K-10",
    expectedCaseNos: ["BIUI_COLLAGE_R001-K-10"],
    resultSource: "codex_generated",
    requireSingleCase: true
  });
  assert.equal(validReport.status, "ok", JSON.stringify(validReport.issues));

  const invalidContract = JSON.parse(JSON.stringify(k10)) as StructuredCaseScopeContract;
  invalidContract.requiredActions[0]!.expectedOutcome = "not_a_real_outcome" as any;
  const invalidReport = evaluateResultEvidenceGate({
    parsed: parsedResult({
      ...validDetail,
      currentRunEvidence: {
        dom: { text: "第 1 欄位，欄位未設置完成" },
        caseScopeContract: invalidContract
      }
    }),
    currentCaseNo: "BIUI_COLLAGE_R001-K-10",
    expectedCaseNos: ["BIUI_COLLAGE_R001-K-10"],
    resultSource: "codex_generated",
    requireSingleCase: true
  });
  assert.equal(invalidReport.status, "error");
  assert.ok(invalidReport.issues.some((item) => item.code === "DETAIL_JSON_CASE_SCOPE_CONTRACT_INVALID"));
};

const main = (): void => {
  const contracts = caseScopeContracts();
  assertVocabularyCoverage(contracts);
  assertRuntimeRouting(contracts);
  assertResultGateStructuredContractValidation(contracts);
  console.log("P0 runtime wiring smoke passed:");
  for (const contract of contracts) {
    console.log(
      `- ${contract.caseNo}: ${contract.routeIntent}; targets=${[
        ...new Set(contract.requiredActions.map((item) => item.target))
      ].join(", ")}`
    );
  }
};

main();
