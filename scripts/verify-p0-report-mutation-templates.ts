import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CaseManifestCase } from "../agent/src/case-manifest";
import { evaluateCapabilityGate } from "../agent/src/capability-gate";
import { inferCaseScope } from "../agent/src/case-scope";
import { buildHelperExecutionPlan } from "../agent/src/helper-execution-plan";
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
      return "功能流程";
  }
};

const fixtureCase = (contract: StructuredCaseScopeContract): CaseManifestCase => ({
  order: 1,
  rowNumber: 2,
  groupId: "M",
  groupName: "P0.27 report mutation fixture",
  caseNo: contract.caseNo,
  caseTitle: `${contract.caseNo} report mutation route smoke`,
  testType: chineseTarget(contract.testTarget),
  executionMethod: "agent",
  riskLevel: contract.requiredActions.some((item) => item.evidenceRequirements.includes("toolBridge.response")) ? "🟠 修改" : "🟢 觀察",
  testTarget: chineseTarget(contract.testTarget),
  cleanupChecklist: "欄位=不影響;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
  preconditions: "起始頁面: BI official UI；拼貼專案中至少有一筆既有報表可開啟。",
  stepsSummary: contract.requiredActions.map((item) => `${item.action}:${item.target}:${item.expectedOutcome}`).join(" "),
  expected: "Expected behavior is defined by caseScopeContract requiredActions and evidenceRequirements.",
  resultStatus: null,
  testDate: null,
  detailJson: null,
  validationMethod: "P0.27 report mutation template smoke",
  currentCaseFile: path.join(os.tmpdir(), `${contract.caseNo}.json`)
});

const templatesFor = (contract: StructuredCaseScopeContract): string[] =>
  buildHelperExecutionPlan({ runDir: os.tmpdir(), currentCase: fixtureCase(contract), helperHints: null }).actions.map((item) => item.template);

const templatesForManualAiHints = (contract: StructuredCaseScopeContract): string[] =>
  buildHelperExecutionPlan({
    runDir: os.tmpdir(),
    currentCase: fixtureCase(contract),
    helperHints: {
      caseId: contract.caseNo,
      automationLevel: "manual_ai",
      operationTemplate: "manual_ai",
      params: {
        cleanupChecklist: "欄位=不影響;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
        skipSave: true,
        skipDownload: false,
        openExistingReport: false
      },
      requiredEvidence: [],
      forbiddenAutomation: [],
      aiDecisionRequired: true,
      raw: {},
      sourcePath: "fixture",
      sourceRelativePath: null,
      warnings: []
    }
  }).actions.map((item) => item.template);

const main = (): void => {
  const byCase = new Map(contracts().map((item) => [item.caseNo, item]));
  const cases = ["BIUI_COLLAGE_R001-M-06", "BIUI_COLLAGE_R001-M-09", "BIUI_COLLAGE_R001-M-10", "BIUI_COLLAGE_R001-M-11"];
  const required = cases.map((caseNo) => {
    const contract = byCase.get(caseNo);
    assert(contract, `${caseNo} contract must exist`);
    assert.equal(contract.routeIntent, "report_mutation_flow", `${caseNo} must use report_mutation_flow`);
    return contract;
  });

  const observeContract = readJson<JsonObject>(observeContractPath);
  for (const type of ["saveModalCancel", "copyModalCancel"]) {
    assert(observeContract.observationTypes?.[type], `observeFrontendState must declare ${type}`);
    assert((observeContract.paramsSchema?.properties?.observationType?.enum ?? []).includes(type), `observationType enum missing ${type}`);
  }

  const expectedTemplates: Record<string, string[]> = {
    "BIUI_COLLAGE_R001-M-06": [
      "collage.openProject",
      "collage.createReport",
      "collage.configureMetric",
      "collage.runPreviewAndCollectEvidence",
      "collage.observeFrontendState"
    ],
    "BIUI_COLLAGE_R001-M-09": ["collage.openProject", "collage.openReportFromProjectList", "collage.observeFrontendState"],
    "BIUI_COLLAGE_R001-M-10": ["collage.openProject", "collage.openReportFromProjectList", "collage.copyReportAndVerify"],
    "BIUI_COLLAGE_R001-M-11": ["collage.openProject", "collage.openReportFromProjectList", "collage.updateExistingReportAndReopen"]
  };

  for (const contract of required) {
    const currentCase = fixtureCase(contract);
    const scope = inferCaseScope(currentCase, null);
    assert.equal(scope.caseScopeContract?.caseNo, contract.caseNo, `${contract.caseNo} scope missing structured contract`);
    assert.equal(scope.executionRequired, true, `${contract.caseNo} report mutation must be execution-required`);
    const gate = evaluateCapabilityGate(currentCase, null);
    assert.equal(gate.supportStatus, "supported", `${contract.caseNo} gate must support report mutation helper`);
    for (const template of expectedTemplates[contract.caseNo] ?? []) {
      assert.ok(gate.supportedHelperTemplates.includes(template), `${contract.caseNo} gate missing ${template}`);
    }
    const templates = templatesFor(contract);
    assert.deepEqual(templates, expectedTemplates[contract.caseNo], `${contract.caseNo} template route drift`);
    const hintedTemplates = templatesForManualAiHints(contract);
    assert.deepEqual(hintedTemplates, expectedTemplates[contract.caseNo], `${contract.caseNo} manual_ai hint route drift`);
    const plan = buildHelperExecutionPlan({ runDir: os.tmpdir(), currentCase, helperHints: null });
    const terminalAction = plan.actions.at(-1);
    assert(terminalAction, `${contract.caseNo} plan has no terminal action`);
    if (contract.caseNo === "BIUI_COLLAGE_R001-M-10" || contract.caseNo === "BIUI_COLLAGE_R001-M-11") {
      assert.equal(terminalAction.requiresToolBridge, true, `${contract.caseNo} mutation helper must require Tool Bridge`);
      assert.ok(terminalAction.requiredEvidence.includes("toolBridge.response"), `${contract.caseNo} must require Tool Bridge evidence`);
    }
    if (contract.caseNo === "BIUI_COLLAGE_R001-M-06") {
      assert.equal(terminalAction.params.observationType, "saveModalCancel");
    }
    if (contract.caseNo === "BIUI_COLLAGE_R001-M-09") {
      assert.equal(terminalAction.params.observationType, "copyModalCancel");
    }
  }

  const executorSource = fs.readFileSync(helperExecutorPath, "utf8");
  for (const snippet of [
    "observeSaveModalCancelFlow",
    "observeCopyModalCancelFlow",
    "copyReportAndVerify",
    "updateExistingReportAndReopen",
    "saveModal.cancelFlow.state",
    "copyModal.saveFlow.state",
    "reportPersistence.reopenState"
  ]) {
    assert(executorSource.includes(snippet), `executor missing P0.27 runtime snippet: ${snippet}`);
  }

  console.log(JSON.stringify({
    ok: true,
    cases,
    routes: cases.map((caseNo) => ({ caseNo, templates: expectedTemplates[caseNo] }))
  }, null, 2));
};

main();
