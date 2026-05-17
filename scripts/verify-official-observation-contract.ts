import fs from "node:fs";
import path from "node:path";
import type { CaseManifestCase } from "../agent/src/case-manifest";
import { buildHelperExecutionPlan } from "../agent/src/helper-execution-plan";

type JsonObject = Record<string, any>;

type SmokeResult = {
  caseId: string;
  assertion: string;
};

const packDir = path.join(process.cwd(), "domain-packs", "BI_OFFICIAL_UI_COLLAGE");

const readJson = (relativePath: string): JsonObject => {
  const filePath = path.join(packDir, relativePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonObject;
};

const fail = (message: string): never => {
  console.error(`FAIL ${message}`);
  process.exit(1);
};

const assert = (condition: unknown, message: string): void => {
  if (!condition) fail(message);
};

const requirePath = (relativePath: string): void => {
  const filePath = path.join(packDir, relativePath);
  assert(fs.existsSync(filePath), `missing ${relativePath}`);
};

const componentIds = (inventory: JsonObject): Set<string> =>
  new Set((inventory.components ?? []).map((component: JsonObject) => component.id).filter(Boolean));

const evidenceObjectIds = (schema: JsonObject): Set<string> =>
  new Set(Object.keys(schema.evidenceObjects ?? {}));

const semanticMap = (uiContract: JsonObject, key: string): JsonObject => {
  const map = uiContract.semanticMaps?.[key];
  assert(map, `ui-contract semanticMaps.${key} missing`);
  return map;
};

const fixtureCase = (caseNo: string, title: string, stepsSummary: string, expected: string): CaseManifestCase => ({
  order: 1,
  rowNumber: 2,
  groupId: caseNo.split("-").at(-2) ?? null,
  groupName: "BI official UI observation fixture",
  caseNo,
  caseTitle: title,
  testType: "前端呈現",
  executionMethod: "agent",
  riskLevel: "🟢 觀察",
  testTarget: "前端呈現",
  cleanupChecklist: "欄位=不影響;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
  preconditions: "起始頁面: BI official UI；建構模式: 拼貼模式",
  stepsSummary,
  expected,
  resultStatus: null,
  testDate: null,
  detailJson: null,
  validationMethod: "DOM/read-only observation evidence",
  currentCaseFile: ""
});

const planTemplatesFor = (item: CaseManifestCase): string[] =>
  buildHelperExecutionPlan({
    runDir: process.cwd(),
    currentCase: item,
    helperHints: null
  }).actions.map((action) => action.template);

const helperPlanSmoke = (): SmokeResult[] => {
  const cases = [
    {
      caseId: "BIUI_COLLAGE_R001-I-07",
      case: fixtureCase("BIUI_COLLAGE_R001-I-07", "右上使用者按鈕顯示登入者名稱", "觀察右上使用者按鈕文字", "應顯示登入者名稱")
    },
    {
      caseId: "BIUI_COLLAGE_R001-J-02",
      case: fixtureCase("BIUI_COLLAGE_R001-J-02", "未勾選時下載/刪除 icon disabled", "觀察專案頁 toolbar 下載/刪除 icon disabled state", "下載與刪除 disabled，新增 enabled")
    },
    {
      caseId: "BIUI_COLLAGE_R001-K-01",
      case: fixtureCase("BIUI_COLLAGE_R001-K-01", "新增報表預設為拼貼模式", "進入新增報表頁，讀取建構方式 radio", "拼貼模式 radio checked")
    },
    {
      caseId: "BIUI_COLLAGE_R001-L-02",
      case: fixtureCase("BIUI_COLLAGE_R001-L-02", "時間面板展開", "進入新增報表頁，點擊時間設置 button，觀察時間面板", "動態/靜態與 preset 清單可見")
    },
    {
      caseId: "BIUI_COLLAGE_R001-K-10",
      case: fixtureCase("BIUI_COLLAGE_R001-K-10", "空設定點計算防呆", "進入新增報表頁，第一列空白，點擊計算按鈕", "顯示欄位未設置完成且不觸發 preview request")
    }
  ];
  return cases.map((item) => {
    const templates = planTemplatesFor(item.case);
    assert(templates.includes("collage.observeFrontendState"), `${item.caseId} plan missing collage.observeFrontendState: ${templates.join(",")}`);
    assert(!templates.includes("collage.configureMetric") && !templates.includes("collage.runPreviewAndCollectEvidence"), `${item.caseId} observation plan must not route to preview helpers`);
    return { caseId: item.caseId, assertion: `helper plan includes observeFrontendState without preview fallback (${templates.join(" -> ")})` };
  });
};

const b09ScopeSmoke = (): SmokeResult[] => {
  const b09OutcomeCase: CaseManifestCase = {
    ...fixtureCase(
      "BIUI_COLLAGE_R001-B-09",
      "靜態區間 request/preview dateRange correctness",
      "進入新增報表頁，加入新增帳號數，將時間設為 2026/03/01~2026/03/15，按執行並讀 request body / preview 首日。",
      "request body dateRange=2026-03-01~2026-03-15；preview 首日=2026-03-01；本題不測項目: 儲存、CSV、reopen"
    ),
    testType: "前後端整合",
    testTarget: "前後端整合",
    cleanupChecklist: "欄位=新增帳號數;篩選=0組;分組=不影響;時間=2026/03/01~2026/03/15;顯示=每天",
    validationMethod: "network.requestBody + chart.datasets"
  };
  const b09Templates = planTemplatesFor(b09OutcomeCase);
  assert(
    b09Templates.includes("collage.configureMetric") && b09Templates.includes("collage.runPreviewAndCollectEvidence"),
    `B-09 outcome case must remain preview-execution evidence; templates=${b09Templates.join(",")}`
  );
  assert(
    !b09Templates.includes("collage.saveReport") &&
      !b09Templates.includes("collage.reopenReport") &&
      !b09Templates.includes("collage.downloadCsvAndComparePreview"),
    `B-09 negative scope must not add save/reopen/download; templates=${b09Templates.join(",")}`
  );
  assert(!b09Templates.includes("collage.observeFrontendState"), `B-09 outcome case must not be converted into frontend-only observation; templates=${b09Templates.join(",")}`);

  const staticTabFlowCase = fixtureCase(
    "BIUI_COLLAGE_R001-L-STATIC-TAB",
    "靜態 tab 可見與可展開",
    "進入新增報表頁，點時間區間 button，觀察動態/靜態 tab 與取消/確定按鈕；不按執行、不讀 preview。",
    "時間面板展開後應可見動態、靜態、取消、確定；request delta=0"
  );
  const staticTabTemplates = planTemplatesFor(staticTabFlowCase);
  assert(staticTabTemplates.includes("collage.observeFrontendState"), `static-tab flow case must use observation evidence; templates=${staticTabTemplates.join(",")}`);
  assert(
    !staticTabTemplates.includes("collage.configureMetric") && !staticTabTemplates.includes("collage.runPreviewAndCollectEvidence"),
    `static-tab flow case must not be routed to preview evidence; templates=${staticTabTemplates.join(",")}`
  );

  return [
    { caseId: "BIUI_COLLAGE_R001-B-09", assertion: `outcome correctness stays preview_execution (${b09Templates.join(" -> ")})` },
    {
      caseId: "BIUI_COLLAGE_R001-L-STATIC-TAB",
      assertion: `static-tab clickability is a separate frontend observation flow (${staticTabTemplates.join(" -> ")})`
    }
  ];
};

const caseSmoke = (uiContract: JsonObject): SmokeResult[] => {
  const results: SmokeResult[] = [];

  const userMap = semanticMap(uiContract, "topbarUserButton");
  const userEvidence = {
    visible: true,
    visibleText: "Tommy LH(劉徐融)",
    disabled: true
  };
  const userPatterns = ["Tommy", "劉徐融"];
  assert(
    Array.isArray(userMap.expectedTextSources) &&
      userMap.expectedTextSources.includes("case.expectedUserDisplayName") &&
      userEvidence.visible &&
      userPatterns.every((pattern) => userEvidence.visibleText.includes(pattern)),
    "I-07 user button semantic map cannot assert Tommy user text"
  );
  results.push({ caseId: "BIUI_COLLAGE_R001-I-07", assertion: "topbar user button text is assertable from DOM text/state" });

  const toolbarMap = semanticMap(uiContract, "projectToolbar");
  const toolbarButtons = [
    { index: 0, disabled: true },
    { index: 1, disabled: true },
    { index: 2, disabled: false }
  ];
  for (const rule of toolbarMap.buttonOrder as JsonObject[]) {
    const button = toolbarButtons.find((candidate) => candidate.index === rule.index);
    assert(button, `J-02 toolbar sample missing button index ${rule.index}`);
    const expectedDisabled = rule.expectedWhenNoSelection === "disabled";
    assert(
      button.disabled === expectedDisabled,
      `J-02 toolbar ${rule.action} expected ${rule.expectedWhenNoSelection} but sample was ${button.disabled ? "disabled" : "enabled"}`
    );
  }
  results.push({ caseId: "BIUI_COLLAGE_R001-J-02", assertion: "icon-only toolbar disabled states are interpretable by ordered semantic map" });

  const radioMap = semanticMap(uiContract, "reportModeRadio");
  const radioEvidence = [
    { value: "1", label: "拼貼模式", checked: true },
    { value: "2", label: "明細模式", checked: false },
    { value: "3", label: "指標趨勢模式", checked: false }
  ];
  for (const expected of radioMap.values as JsonObject[]) {
    const actual = radioEvidence.find((candidate) => candidate.value === expected.value);
    assert(actual, `K-01 radio sample missing value ${expected.value}`);
    assert(actual.label === expected.label, `K-01 radio label mismatch for value ${expected.value}`);
    assert(actual.checked === expected.defaultChecked, `K-01 radio checked mismatch for ${expected.label}`);
  }
  results.push({ caseId: "BIUI_COLLAGE_R001-K-01", assertion: "default collage mode can be asserted from report-mode radio checked state" });

  const datePanelMap = semanticMap(uiContract, "dateRangePanel");
  const datePanelEvidence = {
    openedByVisibleUi: true,
    visibleTexts: [
      "昨日",
      "今日",
      "上週",
      "本週",
      "上月",
      "本月",
      "過去 7 天",
      "最近 7 天",
      "過去 30 天",
      "最近 30 天",
      "動態",
      "靜態",
      "取消",
      "確定"
    ],
    requestDelta: 0
  };
  for (const text of datePanelMap.requiredVisibleTexts as string[]) {
    assert(datePanelEvidence.visibleTexts.includes(text), `L-02 date panel sample missing visible text ${text}`);
  }
  assert(datePanelEvidence.openedByVisibleUi && datePanelEvidence.requestDelta === 0, "L-02 date panel open/request policy failed");
  results.push({ caseId: "BIUI_COLLAGE_R001-L-02", assertion: "date panel composition can be asserted without preview request" });

  const validationMap = semanticMap(uiContract, "validationMessages");
  const validationEvidence = {
    visibleText: "第 1 欄位，欄位未設置完成",
    requestDelta: 0
  };
  const incompleteFieldMessage = (validationMap.knownMessages as JsonObject[]).find((message) => message.id === "metricRowFieldIncomplete");
  assert(incompleteFieldMessage, "K-10 validation semantic message metricRowFieldIncomplete missing");
  assert(
    validationEvidence.visibleText.includes(incompleteFieldMessage.contains) && validationEvidence.requestDelta === 0,
    "K-10 validation message semantic map cannot assert no-request validation"
  );
  results.push({ caseId: "BIUI_COLLAGE_R001-K-10", assertion: "empty setup validation can be asserted from visible message and request delta" });

  return results;
};

const main = (): void => {
  requirePath("ui-contract.json");
  requirePath("discovery/component-inventory.json");
  requirePath("evidence-schema.json");
  requirePath("lint-rules.json");
  requirePath("action-contracts/observeFrontendState.json");

  const uiContract = readJson("ui-contract.json");
  const inventory = readJson("discovery/component-inventory.json");
  const evidenceSchema = readJson("evidence-schema.json");
  const lintRules = readJson("lint-rules.json");
  const observationAction = readJson("action-contracts/observeFrontendState.json");

  const requiredComponents = [
    "topbar.userButton",
    "projectToolbar.actionButtons",
    "reportMode.radioGroup",
    "dateRange.panel",
    "validation.messageArea",
    "sidebar.companySharedGroup"
  ];
  const discoveredComponents = componentIds(inventory);
  for (const component of requiredComponents) {
    assert(discoveredComponents.has(component), `component inventory missing ${component}`);
  }

  const requiredEvidenceObjects = [
    "browserMcp.preflight",
    "topbar.userButton.state",
    "projectToolbar.buttons.state",
    "reportMode.radio.state",
    "dateRange.panel.state",
    "validation.message.state"
  ];
  const evidenceObjects = evidenceObjectIds(evidenceSchema);
  for (const evidenceObject of requiredEvidenceObjects) {
    assert(evidenceObjects.has(evidenceObject), `evidence schema missing ${evidenceObject}`);
  }

  const observationTypes = Object.keys(observationAction.observationTypes ?? {});
  for (const type of ["userButton", "projectToolbar", "reportModeRadio", "datePanel", "validationMessage"]) {
    assert(observationTypes.includes(type), `observeFrontendState missing observationType ${type}`);
  }

  const observationRule = (lintRules.rules ?? []).find((rule: JsonObject) => rule.id === "BI_OFFICIAL_COLLAGE_FRONTEND_OBSERVATION_TEMPLATE_REQUIRED");
  assert(observationRule, "lint-rules missing BI_OFFICIAL_COLLAGE_FRONTEND_OBSERVATION_TEMPLATE_REQUIRED");

  const results = caseSmoke(uiContract);
  const planResults = helperPlanSmoke();
  const b09Results = b09ScopeSmoke();
  console.log("Official UI observation contract smoke passed:");
  for (const result of [...results, ...planResults, ...b09Results]) {
    console.log(`- ${result.caseId}: ${result.assertion}`);
  }
};

main();
