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
      return "前端呈現";
  }
};

const fixtureCase = (contract: StructuredCaseScopeContract): CaseManifestCase => ({
  order: 1,
  rowNumber: 2,
  groupId: contract.caseNo.split("-").at(-2) ?? null,
  groupName: "P0.26 field picker/date preset fixture",
  caseNo: contract.caseNo,
  caseTitle: `${contract.caseNo} ${contract.requiredActions.map((item) => item.target).join(" ")}`,
  testType: chineseTarget(contract.testTarget),
  executionMethod: "agent",
  riskLevel: "🟢 觀察",
  testTarget: chineseTarget(contract.testTarget),
  cleanupChecklist: "欄位=不影響;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
  preconditions: contract.requiresEditor ? "起始頁面: BI official UI；進入拼貼報表新增報表頁。" : "起始頁面: BI official UI。",
  stepsSummary: contract.requiredActions.map((item) => `${item.action}:${item.target}:${item.expectedOutcome}`).join(" "),
  expected: "Expected behavior is defined by caseScopeContract requiredActions and evidenceRequirements.",
  resultStatus: null,
  testDate: null,
  detailJson: null,
  validationMethod: "P0.26 route/template smoke",
  currentCaseFile: path.join(os.tmpdir(), `${contract.caseNo}.json`)
});

const main = (): void => {
  const allContracts = contracts();
  const byCase = new Map(allContracts.map((item) => [item.caseNo, item]));
  const k09 = byCase.get("BIUI_COLLAGE_R001-K-09");
  const l08 = byCase.get("BIUI_COLLAGE_R001-L-08");
  assert(k09, "K-09 contract must exist");
  assert(l08, "L-08 contract must exist");
  assert.equal(k09.observationType, "fieldPicker", "K-09 must route to fieldPicker observation");
  assert.equal(l08.observationType, "datePanel", "L-08 must route to datePanel observation");

  const observeContract = readJson<JsonObject>(observeContractPath);
  assert(observeContract.observationTypes?.fieldPicker, "observeFrontendState contract must include fieldPicker");
  assert((observeContract.paramsSchema?.properties?.observationType?.enum ?? []).includes("fieldPicker"), "observationType enum must include fieldPicker");

  const executorSource = fs.readFileSync(helperExecutorPath, "utf8");
  for (const snippet of [
    "\"fieldPicker\"",
    "FIELD_PICKER_OBSERVATION_FAILED",
    "dateRange.presetSwitch.state",
    "dateRange.preset.past30Days",
    "dateRange.preset.recent30Days"
  ]) {
    assert(executorSource.includes(snippet), `executor missing P0.26 runtime snippet: ${snippet}`);
  }

  for (const contract of [k09, l08]) {
    const currentCase = fixtureCase(contract);
    const scope = inferCaseScope(currentCase, null);
    assert.equal(scope.caseScopeContract?.caseNo, contract.caseNo, `${contract.caseNo} scope missing structured contract`);
    const gate = evaluateCapabilityGate(currentCase, null);
    assert.ok(gate.supportedHelperTemplates.includes("collage.observeFrontendState"), `${contract.caseNo} gate must support observeFrontendState`);
    const plan = buildHelperExecutionPlan({ runDir: os.tmpdir(), currentCase, helperHints: null });
    const observeAction = plan.actions.find((item) => item.template === "collage.observeFrontendState");
    assert(observeAction, `${contract.caseNo} plan must include observeFrontendState`);
    assert.equal(observeAction.params.observationType, contract.observationType, `${contract.caseNo} observationType drift`);
    for (const target of contract.requiredActions.map((item) => item.target)) {
      assert.ok(observeAction.caseScopeActions.some((item) => item.target === target), `${contract.caseNo} observe action missing target ${target}`);
    }
  }

  assert(k09.requiredActions.some((item) => item.target === "metricRows.fieldControl"), "K-09 must bind row-scoped field control");
  assert(k09.requiredActions.some((item) => item.evidenceRequirements.includes("fieldPicker.signature")), "K-09 must require fieldPicker.signature evidence");
  assert(l08.requiredActions.some((item) => item.target === "dateRange.preset.past30Days"), "L-08 must require past 30 days preset");
  assert(l08.requiredActions.some((item) => item.target === "dateRange.preset.recent30Days"), "L-08 must require recent 30 days preset");

  console.log(JSON.stringify({
    ok: true,
    cases: [k09.caseNo, l08.caseNo],
    observationTypes: [k09.observationType, l08.observationType]
  }, null, 2));
};

main();
