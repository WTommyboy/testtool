import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeCaseManifest } from "../agent/src/case-manifest";
import { buildHelperExecutionPlan } from "../agent/src/helper-execution-plan";
import { parseTestcaseXlsx } from "../src/xlsx-parser";

type JsonObject = Record<string, any>;

type StructuredContract = {
  caseNo: string;
  routeIntent: string;
  requiresEditor: boolean;
  observationType: string | null;
  requiredActions: Array<{
    actionId: string;
    action: string;
    target: string;
    expectedOutcome: string;
  }>;
};

type Failure = {
  check: string;
  caseNo?: string;
  message: string;
  observed?: unknown;
};

const root = process.cwd();
const defaultRoundDir = "/Users/tommy/Downloads/codex_galaxy/BI_UAT_ROUNDS/p0_scope_smoke_20260517";
const testcaseXlsx =
  process.env.P0_LIVE_PACKET_XLSX ??
  path.join(defaultRoundDir, "P0_SCOPE_SMOKE_測試案例_BIUI_COLLAGE_R001_20260518_vocab_v1.xlsx");
const contractPath = path.join(root, "domain-packs", "BI_OFFICIAL_UI_COLLAGE", "case-scope-runtime-contracts.json");

const readJson = <T>(filePath: string): T => JSON.parse(fs.readFileSync(filePath, "utf8")) as T;

const contracts = (): StructuredContract[] => readJson<{ contracts: StructuredContract[] }>(contractPath).contracts;

const normalizeCaseNo = (value: string | null | undefined): string => (value ?? "").trim().toUpperCase();

const caseByNo = (cases: JsonObject[], caseNo: string): JsonObject | null =>
  cases.find((item) => normalizeCaseNo(item.caseNo) === normalizeCaseNo(caseNo)) ?? null;

const structuredStepsFor = (item: JsonObject | null): JsonObject[] => {
  if (!item) return [];
  if (Array.isArray(item.structuredSteps)) return item.structuredSteps;
  if (Array.isArray(item.steps)) return item.steps;
  return [];
};

const planSummary = (plan: ReturnType<typeof buildHelperExecutionPlan>): JsonObject => ({
  templates: plan.actions.map((item) => item.template),
  actions: plan.actions.map((item) => ({
    template: item.template,
    caseScopeActions: item.caseScopeActions.map((action) => action.actionId),
    params: {
      dateRange: item.params.dateRange,
      field: item.params.field,
      fields: item.params.fields,
      skipDownload: item.params.skipDownload,
      downloadScope: item.params.downloadScope,
      caseScopeContract: item.params.caseScopeContract?.caseNo ?? null,
      routeIntent: item.params.caseScopeContract?.routeIntent ?? null
    }
  }))
});

const includesTemplate = (plan: ReturnType<typeof buildHelperExecutionPlan>, template: string): boolean =>
  plan.actions.some((item) => item.template === template);

const templates = (plan: ReturnType<typeof buildHelperExecutionPlan>): string[] =>
  plan.actions.map((item) => item.template);

const addFailure = (failures: Failure[], failure: Failure): void => {
  failures.push(failure);
};

const assertStructuredManifest = async (runDir: string, failures: Failure[]): Promise<JsonObject[]> => {
  const parsed = await parseTestcaseXlsx(testcaseXlsx);
  const manifestResult = await writeCaseManifest(testcaseXlsx, path.join(runDir, "input"));
  const manifest = manifestResult.manifestPath ? readJson<JsonObject>(manifestResult.manifestPath) : null;
  const cases = Array.isArray(manifest?.cases) ? manifest!.cases as JsonObject[] : [];
  const expectedStepCount = parsed.steps.length;
  const manifestStepCount =
    typeof manifest?.stepCount === "number"
      ? manifest.stepCount
      : cases.reduce((sum, item) => sum + structuredStepsFor(item).length, 0);

  if (expectedStepCount <= 0) {
    addFailure(failures, {
      check: "generated_xlsx_structured_steps",
      message: "Generated vocabulary xlsx did not parse any structured steps; smoke cannot validate live packet regression.",
      observed: { testcaseXlsx, expectedStepCount }
    });
  }

  if (manifestStepCount !== expectedStepCount) {
    addFailure(failures, {
      check: "case_manifest_structured_steps",
      message: "writeCaseManifest must carry the xlsx 步驟 sheet into the live run packet.",
      observed: {
        expectedStepCount,
        manifestStepCount,
        manifestStepCountField: manifest?.stepCount ?? null
      }
    });
  }

  for (const contract of contracts()) {
    const item = caseByNo(cases, contract.caseNo);
    if (!item) continue;
    const steps = structuredStepsFor(item);
    if (steps.length !== contract.requiredActions.length) {
      addFailure(failures, {
        check: "case_structured_steps",
        caseNo: contract.caseNo,
        message: "Per-case live packet must expose structured steps matching the runtime contract.",
        observed: {
          expected: contract.requiredActions.length,
          actual: steps.length
        }
      });
    }
  }

  return cases;
};

const assertHelperPlans = (runDir: string, cases: JsonObject[], failures: Failure[]): void => {
  const plans = new Map<string, ReturnType<typeof buildHelperExecutionPlan>>();
  for (const contract of contracts()) {
    const currentCase = caseByNo(cases, contract.caseNo);
    if (!currentCase) continue;
    plans.set(contract.caseNo, buildHelperExecutionPlan({ runDir, currentCase: currentCase as any, helperHints: null }));
  }

  const b06 = plans.get("BIUI_COLLAGE_R001-B-06");
  if (b06) {
    if (!includesTemplate(b06, "collage.runDateVariantsPreviewEvidence")) {
      addFailure(failures, {
        check: "b06_multi_variant_preview_route",
        caseNo: "BIUI_COLLAGE_R001-B-06",
        message: "B-06 has two required date variants and must route to a multi-variant preview evidence helper.",
        observed: planSummary(b06)
      });
    }
    const compositeDate = b06.actions
      .filter((item) => item.caseScopeActions.length > 0)
      .map((item) => item.params.dateRange)
      .find((value) => typeof value === "string" && /後切|過去30天.*最近30天|最近30天.*過去30天/.test(value));
    if (compositeDate) {
      addFailure(failures, {
        check: "b06_structured_date_not_shadowed",
        caseNo: "BIUI_COLLAGE_R001-B-06",
        message: "Structured date actions must not be shadowed by the legacy composite cleanup dateRange.",
        observed: { compositeDate, plan: planSummary(b06) }
      });
    }
  }

  const b08 = plans.get("BIUI_COLLAGE_R001-B-08");
  if (b08) {
    if (!includesTemplate(b08, "collage.runDateVariantsPreviewEvidence")) {
      addFailure(failures, {
        check: "b08_structured_preview_route",
        caseNo: "BIUI_COLLAGE_R001-B-08",
        message: "B-08 structured preview_execution scope must route through the date preview evidence helper, not stop at navigation prelude.",
        observed: planSummary(b08)
      });
    }
  }

  const n03 = plans.get("BIUI_COLLAGE_R001-N-03");
  if (n03) {
    if (!includesTemplate(n03, "collage.downloadCsvAndComparePreview")) {
      addFailure(failures, {
        check: "n03_download_execution_route",
        caseNo: "BIUI_COLLAGE_R001-N-03",
        message: "download_execution must keep the download helper even when CSV content comparison is out of scope.",
        observed: planSummary(n03)
      });
    }
    const badFieldAction = n03.actions.find((item) => item.params.field === "1欄" || JSON.stringify(item.params.fields ?? []).includes("1欄"));
    if (badFieldAction) {
      addFailure(failures, {
        check: "n03_cleanup_count_not_metric_field",
        caseNo: "BIUI_COLLAGE_R001-N-03",
        message: "Cleanup target 欄位=1欄 is a count/state requirement, not a metric field label.",
        observed: planSummary(n03)
      });
    }
    const downloadSuppressed = n03.actions.some((item) => item.params.caseScopeContract?.routeIntent === "download_execution" && item.params.skipDownload === true);
    if (downloadSuppressed) {
      addFailure(failures, {
        check: "n03_download_not_suppressed_by_negative_csv_scope",
        caseNo: "BIUI_COLLAGE_R001-N-03",
        message: "Negative CSV comparison scope may disable CSV-vs-preview comparison, but must not set skipDownload on download_execution.",
        observed: planSummary(n03)
      });
    }
  }

  for (const contract of contracts().filter((item) => item.routeIntent === "frontend_observation" && item.requiresEditor === false)) {
    const plan = plans.get(contract.caseNo);
    if (!plan) continue;
    if (templates(plan).includes("collage.createReport")) {
      addFailure(failures, {
        check: "frontend_observation_non_editor_route_context",
        caseNo: contract.caseNo,
        message: "requiresEditor=false frontend observations must not be routed into /report/new by createReport.",
        observed: {
          observationType: contract.observationType,
          requiredTargets: contract.requiredActions.map((item) => item.target),
          plan: planSummary(plan)
        }
      });
    }
    if (!includesTemplate(plan, "collage.observeFrontendState")) {
      addFailure(failures, {
        check: "frontend_observation_missing_observer",
        caseNo: contract.caseNo,
        message: "Supported frontend observation must include observeFrontendState.",
        observed: planSummary(plan)
      });
    }
  }
};

const assertExternalRuntimeContractLoading = (runDir: string, failures: Failure[]): void => {
  const inputDir = path.join(runDir, "external-contract", "input");
  const casesDir = path.join(inputDir, "cases");
  fs.mkdirSync(casesDir, { recursive: true });
  const externalCaseNo = "BIUI_COLLAGE_R001-Z-99";
  const currentCaseFile = path.join(casesDir, `001-${externalCaseNo}.json`);
  const currentCase = {
    order: 1,
    rowNumber: 2,
    groupId: "Z",
    groupName: "External contract loading fixture",
    caseNo: externalCaseNo,
    caseTitle: "External runtime contract loading fixture",
    testType: "前端呈現",
    executionMethod: "agent",
    riskLevel: "🟢 觀察",
    testTarget: "前端呈現",
    cleanupChecklist: "欄位=空;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
    preconditions: "起始頁面: 拼貼報表新增報表設定頁",
    stepsSummary: "點擊時間區間 button 展開面板。",
    expected: "時間面板可展開。",
    resultStatus: null,
    testDate: null,
    detailJson: null,
    validationMethod: "external runtime contract smoke",
    currentCaseFile
  };
  fs.writeFileSync(currentCaseFile, `${JSON.stringify(currentCase, null, 2)}\n`);
  fs.writeFileSync(path.join(inputDir, "domain_case_scope_contracts.json"), `${JSON.stringify({
    schemaVersion: "case-scope-runtime-contracts-v1",
    domain: "BI_OFFICIAL_UI_COLLAGE",
    contracts: [
      {
        caseNo: externalCaseNo,
        routeIntent: "frontend_observation",
        testTarget: "frontend_presentation",
        requiresEditor: true,
        observationType: "datePanel",
        requiredActions: [
          {
            actionId: "openDatePanel",
            action: "open",
            target: "dateRange.button",
            role: "under_test",
            expectedOutcome: "visible",
            requiredForPass: true,
            evidenceRequirements: ["dateRange.panel.state", "interactionLog"]
          }
        ],
        evidenceRequirements: {
          flow: ["dateRange.panel.state"],
          observation: ["screenshot"]
        },
        judgmentPolicy: {
          failWhen: ["panel is reachable but does not open"],
          blockedWhen: ["date range button cannot be located"]
        }
      }
    ]
  }, null, 2)}\n`);

  const plan = buildHelperExecutionPlan({ runDir, currentCase: currentCase as any, helperHints: null });
  if (plan.caseScopeContract?.caseNo !== externalCaseNo || !includesTemplate(plan, "collage.observeFrontendState")) {
    addFailure(failures, {
      check: "external_runtime_contract_loading",
      caseNo: externalCaseNo,
      message: "Planner must load structured contracts from input/domain_case_scope_contracts.json beside currentCaseFile, even when the case JSON has no embedded caseScopeContract.",
      observed: planSummary(plan)
    });
  }
};

const assertRepoContractFallbackWhenInputSnapshotIsPartial = (runDir: string, failures: Failure[]): void => {
  const inputDir = path.join(runDir, "repo-fallback-contract", "input");
  const casesDir = path.join(inputDir, "cases");
  fs.mkdirSync(casesDir, { recursive: true });
  const l11CaseNo = "BIUI_COLLAGE_R001-L-11";
  const currentCaseFile = path.join(casesDir, `001-${l11CaseNo}.json`);
  const currentCase = {
    order: 1,
    rowNumber: 2,
    groupId: "L",
    groupName: "Date range frontend observation fixture",
    caseNo: l11CaseNo,
    caseTitle: "日期區間 90 天上限驗證",
    testType: "前端呈現",
    executionMethod: "agent",
    riskLevel: "🟢 觀察",
    testTarget: "前端呈現",
    cleanupChecklist: "欄位=新增帳號數;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
    preconditions: "起始頁面: 拼貼報表新增報表設定頁",
    stepsSummary: "設定 91 天區間應被阻擋；改成 90 天區間應可接受。本題不測 preview。",
    expected: "日期面板正確執行 90 天上限防呆。",
    resultStatus: null,
    testDate: null,
    detailJson: null,
    validationMethod: "caseScopeContract + current-run evidence",
    currentCaseFile
  };
  fs.writeFileSync(currentCaseFile, `${JSON.stringify(currentCase, null, 2)}\n`);
  fs.writeFileSync(path.join(inputDir, "domain_case_scope_contracts.json"), `${JSON.stringify({
    schemaVersion: "case-scope-runtime-contracts-v1",
    domain: "BI_OFFICIAL_UI_COLLAGE",
    contracts: [
      {
        caseNo: "BIUI_COLLAGE_R001-Z-00",
        routeIntent: "frontend_observation",
        testTarget: "frontend_presentation",
        requiresEditor: false,
        observationType: "userButton",
        requiredActions: [
          {
            actionId: "observeUserButton",
            action: "assertVisible",
            target: "topbar.userButton",
            role: "under_test",
            expectedOutcome: "visible",
            requiredForPass: true,
            evidenceRequirements: ["topbar.userButton.state"]
          }
        ],
        evidenceRequirements: { observation: ["topbar.userButton.state"] },
        judgmentPolicy: { failWhen: [], blockedWhen: [] }
      }
    ]
  }, null, 2)}\n`);

  const plan = buildHelperExecutionPlan({ runDir, currentCase: currentCase as any, helperHints: null });
  if (plan.caseScopeContract?.caseNo !== l11CaseNo || plan.caseScopeContract?.observationType !== "dateRangeLimit") {
    addFailure(failures, {
      check: "repo_contract_fallback_when_input_snapshot_is_partial",
      caseNo: l11CaseNo,
      message: "Planner must let repo domain case-scope contracts fill cases missing from a non-empty input/domain_case_scope_contracts.json snapshot.",
      observed: planSummary(plan)
    });
  }
};

const main = async (): Promise<void> => {
  if (!fs.existsSync(testcaseXlsx)) {
    throw new Error(`P0 live packet xlsx missing: ${testcaseXlsx}`);
  }

  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "p0-live-run-packet-regression-"));
  const failures: Failure[] = [];
  try {
    const cases = await assertStructuredManifest(runDir, failures);
    assertHelperPlans(runDir, cases, failures);
    assertExternalRuntimeContractLoading(runDir, failures);
    assertRepoContractFallbackWhenInputSnapshotIsPartial(runDir, failures);

    const result = {
      ok: failures.length === 0,
      testcaseXlsx,
      failureCount: failures.length,
      failures
    };
    console.log(JSON.stringify(result, null, 2));
    if (failures.length > 0) process.exitCode = 1;
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
