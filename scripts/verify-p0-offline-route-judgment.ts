import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CaseManifestCase } from "../agent/src/case-manifest";
import { evaluateCapabilityGate } from "../agent/src/capability-gate";
import { inferCaseScope } from "../agent/src/case-scope";
import { buildHelperExecutionPlan } from "../agent/src/helper-execution-plan";
import type { StructuredCaseScopeAction, StructuredCaseScopeContract } from "../agent/src/structured-case-scope";

type CaseStatus = "PASS" | "FAIL" | "BLOCKED" | "PARTIAL";
type ActualOutcome =
  | "succeeded"
  | "visible"
  | "hidden"
  | "text_matches"
  | "value_matches"
  | "selected"
  | "checked"
  | "unchecked"
  | "state_changed"
  | "state_unchanged"
  | "request_sent"
  | "request_not_sent"
  | "download_started"
  | "toast_visible"
  | "tooltip_visible"
  | "target_disabled_or_blocked"
  | "target_not_found_timeout"
  | "target_absent_verified"
  | "dispatched_no_change"
  | "wrong_state_change"
  | "not_reached"
  | "tool_error"
  | "unknown";

type JsonObject = Record<string, any>;

type OracleCase = {
  caseNo: string;
  expectedStatus: CaseStatus;
};

type OracleFixture = {
  schemaVersion: string;
  cases: OracleCase[];
};

type OfflineActionOutcome = {
  actionId: string;
  actualOutcome: ActualOutcome;
  evidenceAvailable: boolean;
  productObservation?: string;
};

type OfflineEvidenceCase = {
  caseNo: string;
  actionOutcomes: OfflineActionOutcome[];
};

type OfflineEvidenceFixture = {
  schemaVersion: string;
  cases: OfflineEvidenceCase[];
};

type ActionDecision = {
  actionId: string;
  target: string;
  role: string;
  expectedOutcome: string;
  actualOutcome: ActualOutcome;
  status: "continue" | "fail" | "blocked";
  sentinel: string | null;
};

type JudgmentRow = {
  caseNo: string;
  routeIntent: string;
  expectedStatus: CaseStatus;
  actualStatus: CaseStatus;
  matched: boolean;
  templates: string[];
  decisions: ActionDecision[];
};

const fixtureDir = path.join(process.cwd(), "fixtures", "p0-scope-smoke-20260517");
const oraclePath = path.join(fixtureDir, "oracle.json");
const evidencePath = path.join(fixtureDir, "offline-route-judgment-evidence.json");
const contractPath = path.join(process.cwd(), "domain-packs", "BI_OFFICIAL_UI_COLLAGE", "case-scope-runtime-contracts.json");

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
  groupName: "P0.17 offline route/judgment fixture",
  caseNo: contract.caseNo,
  caseTitle: `${contract.caseNo} offline route/judgment smoke`,
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
  expected: contract.routeIntent === "download_execution"
    ? "Expected behavior is defined by caseScopeContract requiredActions and evidenceRequirements, including UI-triggered download CSV and download toast."
    : "Expected behavior is defined by caseScopeContract requiredActions and evidenceRequirements.",
  resultStatus: null,
  testDate: null,
  detailJson: null,
  validationMethod: "offline route/judgment smoke",
  currentCaseFile: ""
});

const outcomeSatisfies = (expected: string, actual: ActualOutcome): boolean => {
  if (expected === actual) return true;
  if (expected === "succeeded" && actual === "succeeded") return true;
  if (expected === "disabled_or_no_change") {
    return actual === "target_disabled_or_blocked" || actual === "dispatched_no_change";
  }
  if (expected === "state_unchanged") {
    return actual === "state_unchanged";
  }
  return false;
};

const hardBlockedOutcome = (actual: ActualOutcome): boolean =>
  actual === "target_not_found_timeout" || actual === "tool_error" || actual === "unknown" || actual === "not_reached";

const frontendOrFlowOrIntegration = (contract: StructuredCaseScopeContract): boolean =>
  contract.testTarget === "frontend_presentation" ||
  contract.testTarget === "functional_flow" ||
  contract.testTarget === "frontend_backend_integration";

const decisionForAction = (
  contract: StructuredCaseScopeContract,
  action: StructuredCaseScopeAction,
  outcome: OfflineActionOutcome
): ActionDecision => {
  const base = {
    actionId: action.actionId,
    target: action.target,
    role: action.role,
    expectedOutcome: action.expectedOutcome,
    actualOutcome: outcome.actualOutcome
  };

  if (!outcome.evidenceAvailable || hardBlockedOutcome(outcome.actualOutcome)) {
    return { ...base, status: "blocked", sentinel: outcome.actualOutcome === "not_reached" ? "BLOCKED_ACTION_NOT_REACHED" : "BLOCKED_TOOL_LIMITATION" };
  }

  if (outcomeSatisfies(action.expectedOutcome, outcome.actualOutcome)) {
    return { ...base, status: "continue", sentinel: null };
  }

  if (action.role === "precondition") {
    return { ...base, status: "blocked", sentinel: "BLOCKED_PRECONDITION_FAILED" };
  }

  if (action.expectedOutcome === "disabled_or_no_change" && outcome.actualOutcome === "succeeded") {
    return { ...base, status: "fail", sentinel: "FAIL_UNEXPECTED_SUCCESS" };
  }

  if (
    action.expectedOutcome === "request_not_sent" &&
    outcome.actualOutcome === "request_sent"
  ) {
    return { ...base, status: "fail", sentinel: "FAIL_UNEXPECTED_REQUEST" };
  }

  if (
    action.expectedOutcome === "state_unchanged" &&
    (outcome.actualOutcome === "state_changed" || outcome.actualOutcome === "wrong_state_change")
  ) {
    return { ...base, status: "fail", sentinel: "FAIL_UNEXPECTED_STATE_CHANGE" };
  }

  if (
    frontendOrFlowOrIntegration(contract) &&
    (
      outcome.actualOutcome === "target_absent_verified" ||
      outcome.actualOutcome === "target_disabled_or_blocked" ||
      outcome.actualOutcome === "dispatched_no_change" ||
      outcome.actualOutcome === "wrong_state_change"
    )
  ) {
    return { ...base, status: "fail", sentinel: "FAIL_INTERACTION_OR_ASSERTION_FAILED" };
  }

  return { ...base, status: "blocked", sentinel: "BLOCKED_NEEDS_REJUDGMENT" };
};

const judgeCase = (
  contract: StructuredCaseScopeContract,
  evidence: OfflineEvidenceCase
): { status: CaseStatus; decisions: ActionDecision[] } => {
  const evidenceByAction = new Map(evidence.actionOutcomes.map((item) => [item.actionId, item]));
  const decisions = contract.requiredActions.map((action) => {
    const outcome = evidenceByAction.get(action.actionId) ?? {
      actionId: action.actionId,
      actualOutcome: "not_reached" as const,
      evidenceAvailable: false
    };
    return decisionForAction(contract, action, outcome);
  });
  if (decisions.some((item) => item.status === "fail")) return { status: "FAIL", decisions };
  if (decisions.some((item) => item.status === "blocked")) return { status: "BLOCKED", decisions };
  return { status: "PASS", decisions };
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
  "dateTimeTypeTab",
  "datePanelCancel",
  "dateRangeLimit",
  "downloadToast"
]);
const previewTemplates = new Set(["collage.runPreviewAndCollectEvidence", "collage.runDateVariantsPreviewEvidence"]);

const assertRoute = (contract: StructuredCaseScopeContract): string[] => {
  const currentCase = fixtureCase(contract);
  const scope = inferCaseScope(currentCase, null);
  assert.equal(scope.caseScopeContract?.caseNo, contract.caseNo, `${contract.caseNo} caseScopeContract missing`);

  const gate = evaluateCapabilityGate(currentCase, null);
  assert.equal(gate.caseScope.caseScopeContract?.caseNo, contract.caseNo, `${contract.caseNo} capability gate missing contract`);

  const plan = buildHelperExecutionPlan({
    runDir: os.tmpdir(),
    currentCase,
    helperHints: null
  });
  const templates = plan.actions.map((item) => item.template);
  assert.equal(plan.caseScopeContract?.caseNo, contract.caseNo, `${contract.caseNo} helper plan missing contract`);

  if (contract.routeIntent === "frontend_observation") {
    assert.ok(!templates.some((item) => previewTemplates.has(item)), `${contract.caseNo} frontend observation must not route to preview helpers`);
    if (supportedObservationTypes.has(contract.observationType ?? "")) {
      assert.ok(templates.includes("collage.observeFrontendState"), `${contract.caseNo} supported observation must include observeFrontendState`);
    }
  }

  if (contract.routeIntent === "preview_execution") {
    assert.ok(templates.some((item) => previewTemplates.has(item)), `${contract.caseNo} preview execution must route to preview helper`);
  }

  if (contract.routeIntent === "download_execution") {
    assert.ok(templates.includes("collage.downloadCsvAndComparePreview"), `${contract.caseNo} download execution must route to download helper`);
  }

  return templates;
};

const main = (): void => {
  const oracle = readJson<OracleFixture>(oraclePath);
  const evidence = readJson<OfflineEvidenceFixture>(evidencePath);
  assert.equal(oracle.schemaVersion, "p0-scope-smoke-oracle-v1");
  assert.equal(evidence.schemaVersion, "p0-offline-route-judgment-evidence-v1");

  const contractsByCase = new Map(contracts().map((item) => [item.caseNo, item]));
  const evidenceByCase = new Map(evidence.cases.map((item) => [item.caseNo, item]));
  const rows: JudgmentRow[] = [];

  for (const expected of oracle.cases) {
    const contract = contractsByCase.get(expected.caseNo);
    const evidenceCase = evidenceByCase.get(expected.caseNo);
    assert.ok(contract, `${expected.caseNo} missing structured contract`);
    assert.ok(evidenceCase, `${expected.caseNo} missing offline evidence`);
    const templates = assertRoute(contract);
    const judged = judgeCase(contract, evidenceCase);
    rows.push({
      caseNo: expected.caseNo,
      routeIntent: contract.routeIntent,
      expectedStatus: expected.expectedStatus,
      actualStatus: judged.status,
      matched: judged.status === expected.expectedStatus,
      templates,
      decisions: judged.decisions
    });
  }

  const matches = rows.filter((row) => row.matched);
  const mismatches = rows.filter((row) => !row.matched);
  console.log("P0 offline route/judgment smoke");
  console.log(`cases=${rows.length}`);
  console.log(`matches=${matches.length}`);
  console.log(`mismatches=${mismatches.length}`);

  for (const row of rows) {
    const nonContinue = row.decisions.filter((item) => item.status !== "continue");
    console.log(
      `- ${row.caseNo}: expected=${row.expectedStatus}; judged=${row.actualStatus}; route=${row.routeIntent}; templates=${row.templates.join(" -> ") || "(prelude/manual)"}${nonContinue.length > 0 ? `; sentinels=${nonContinue.map((item) => `${item.actionId}:${item.sentinel}`).join(",")}` : ""}`
    );
  }

  assert.equal(rows.length, 15);
  assert.equal(mismatches.length, 0, `offline judgment mismatches: ${mismatches.map((item) => `${item.caseNo}:${item.expectedStatus}->${item.actualStatus}`).join(", ")}`);
};

main();
