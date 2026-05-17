import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CaseManifestCase, CaseManifestResult } from "../agent/src/case-manifest";
import { evaluateCapabilityGate } from "../agent/src/capability-gate";
import { inferCaseScope } from "../agent/src/case-scope";
import { buildHelperExecutionPlan } from "../agent/src/helper-execution-plan";
import { buildTestPackageConsistencyReport } from "../agent/src/test-package-consistency";
import type { ParsedResultXlsx } from "../src/result-parser/result-xlsx-parser";
import { evaluateResultEvidenceGate } from "../src/result-parser/result-evidence-gate";

const prototypeMode = process.argv.includes("--prototype");
const expectCurrentFailure = process.argv.includes("--expect-current-failure");
const expectFixed = process.argv.includes("--expect-fixed") || (!prototypeMode && !expectCurrentFailure);

const baseCase: CaseManifestCase = {
  order: 1,
  rowNumber: 2,
  groupId: "K",
  groupName: "K:新增/編輯報表設定頁",
  caseNo: "BIUI_COLLAGE_R001-K-01",
  caseTitle: "建構方式 radio 預設選中「拼貼模式」",
  testType: "前端呈現",
  executionMethod: "Codex + Playwright",
  riskLevel: "🟢 觀察",
  testTarget: "前端呈現",
  cleanupChecklist: "欄位=空;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
  preconditions:
    "起始頁面: 拼貼報表新增報表設定頁\n導航路徑: 報表 > 我的自訂 > 拼貼報表 > 任一專案 > 新增自訂報表\n備註: 不選報表、不選欄位、不執行",
  stepsSummary:
    "1. 進入新增報表設定頁\n2. 讀取建構方式 radio 群組\n3. 驗證「拼貼模式」radio checked = true\n4. 不切換,離開",
  expected: "拼貼模式 radio 預設選中；本題不測切換模式後行為。",
  resultStatus: null,
  testDate: null,
  detailJson: null,
  validationMethod: "DOM read radio state;evidence: dom.state",
  currentCaseFile: "fixture/BIUI_COLLAGE_R001-K-01.json"
};

const caseFixture = (overrides: Partial<CaseManifestCase>): CaseManifestCase => ({
  ...baseCase,
  ...overrides
});

const i01 = caseFixture({
  order: 45,
  rowNumber: 46,
  groupId: "I",
  groupName: "I:入口與側邊欄",
  caseNo: "BIUI_COLLAGE_R001-I-01",
  caseTitle: "側欄「公司共享」群組展開/收合",
  cleanupChecklist: "欄位=不影響;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
  preconditions:
    "起始頁面: BI 工具首頁\nURL: https://galaxy.games.gamania.com/bi-dev/zh-TW/home\n登入: 由 Tommy 於同一 Playwright session 完成 SSO\n建構模式: 拼貼模式\n授權需求: 無\n前置資源: 左側側欄已載入\n備註: 不點任何業務報表,只測展開/收合 UI 狀態",
  stepsSummary:
    "1. 進入首頁,確認左側側欄已載入\n   驗證: 側欄含「報表」「指標儀表板」等分類\n2. 點擊「公司共享」群組展開 toggle\n   驗證: 公司共享清單展開,可見每日報表、雙平台營收占比、退費追蹤、beanfun! 導流、商品銷售明細表等項目\n3. 再次點擊收合\n   驗證: 公司共享清單收合",
  expected:
    "1. 公司共享群組可展開,清單顯示 PRD 列出之既有公司共享報表(語意一致即可)\n2. 再次點擊可收合\n3. 操作流暢無錯誤 toast / console error\n本題不測項目: 點擊個別報表內容(屬指標 / 明細群組,非本輪範圍)",
  validationMethod: "DOM read 側欄狀態;evidence: dom.state, screenshot"
});

const j12 = caseFixture({
  order: 63,
  rowNumber: 64,
  groupId: "J",
  groupName: "J:專案頁按鈕與列表狀態",
  caseNo: "BIUI_COLLAGE_R001-J-12",
  caseTitle: "專案 5 個上限阻擋與提示",
  cleanupChecklist: "欄位=不影響;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
  preconditions:
    "起始頁面: BI 工具首頁\nURL: https://galaxy.games.gamania.com/bi-dev/zh-TW/home\n登入: 由 Tommy 於同一 Playwright session 完成 SSO\n建構模式: 拼貼模式\n授權需求: 無\n前置資源: 執行前 Tommy 已先確認拼貼專案數可達 4 或 5 個\n備註: 若執行時專案 ≥ 5,直接測上限阻擋;若 < 5,先建臨時專案達 5 個再測;Guard: 若建立超過 5 個失敗應視為 PASS 並記錄",
  stepsSummary:
    "1. 進入首頁,展開拼貼報表\n   驗證: 既有專案數 = N\n2. 若 N < 5,依 J-10 流程建立臨時專案直到 N = 5(每次命名 `BIUI_COLLAGE_J-12_<seq>_<timestamp>`)\n   驗證: 每次建立成功\n3. 達 5 個後再次嘗試開啟新增專案入口\n   驗證: 入口被阻擋(disabled)或開啟後顯示上限提示\n4. 讀取阻擋/提示語意\n   驗證: 語意對應「專案數量已達上限」\n5. detail_json 記錄達上限時的提示文字、所有臨時專案名稱",
  expected:
    "1. 達 5 個時新增入口或儲存被阻擋\n2. 顯示對應提示(語意一致即可)\n3. 若 PRD 有明確上限文案,記錄實際顯示文字\n本題不測項目: 臨時專案刪除(屬 J-13/J-14)"
});

const jIconObservation = caseFixture({
  order: 58,
  rowNumber: 59,
  groupId: "J",
  groupName: "J:專案頁按鈕與列表狀態",
  caseNo: "BIUI_COLLAGE_R001-J-07",
  caseTitle: "報表列下載/刪除 icon 顯示狀態",
  cleanupChecklist: "欄位=不影響;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
  preconditions: "起始頁面: 拼貼報表專案頁\n備註: 只觀察報表列 icon,不點擊下載或刪除",
  stepsSummary: "1. 進入專案頁\n2. 讀取每個報表 row 的下載 icon 與刪除 icon 顯示狀態\n3. 不點擊任何 icon",
  expected: "報表 row 可見下載/刪除 icon；本題不測 CSV 下載事件或刪除流程。",
  validationMethod: "DOM read row action icon state;evidence: dom.state, screenshot"
});

const k01 = baseCase;

const l02 = caseFixture({
  order: 78,
  rowNumber: 79,
  groupId: "L",
  groupName: "L:時間區間工具",
  caseNo: "BIUI_COLLAGE_R001-L-02",
  caseTitle: "點擊時間 button 展開日期面板",
  testType: "功能流程",
  cleanupChecklist: "欄位=空;篩選=不影響;分組=不影響;時間=過去 7 天;顯示=不影響",
  preconditions: "起始頁面: 拼貼報表新增報表設定頁\n備註: 只展開,不選 preset",
  stepsSummary: "1. 進入新增報表設定頁\n2. 點擊時間區間 button\n3. 讀取面板顯示\n4. 不點任何 preset,直接點面板外或 Esc",
  expected: "時間面板可展開，含 preset 清單、月曆、動態/靜態 tab、取消/確定。",
  validationMethod: "DOM read panel state + element presence;evidence: dom.state, dom.list, screenshot"
});

const b04 = caseFixture({
  order: 10,
  rowNumber: 11,
  groupId: "B",
  groupName: "B:日期區間邏輯",
  caseNo: "BIUI_COLLAGE_R001-B-04",
  caseTitle: "全動態區間 — 「上週」/「本週」",
  testType: "功能流程",
  testTarget: "前後端整合",
  cleanupChecklist: "欄位=新增帳號數;篩選=0組;分組=不影響;時間=上週(後切本週);顯示=每天",
  preconditions: "起始頁面: 拼貼模式新增報表設定頁\n來源報表: 每日報表\n固定欄位: 新增帳號數",
  stepsSummary: "1. 加欄位「新增帳號數」\n2. 設上週並執行\n3. 設本週並執行",
  expected: "兩次 request body dateRange 與 preview 筆數一致。",
  validationMethod: "DOM read 時間按鈕 / network request body dateRange / Chart.js datasets 筆數"
});

const b09 = caseFixture({
  order: 15,
  rowNumber: 16,
  groupId: "B",
  groupName: "B:日期區間邏輯",
  caseNo: "BIUI_COLLAGE_R001-B-09",
  caseTitle: "靜態區間 — 2026/03/01 ~ 2026/03/15",
  testType: "功能流程",
  testTarget: "前後端整合",
  cleanupChecklist: "欄位=新增帳號數;篩選=0組;分組=不影響;時間=2026/03/01~2026/03/15;顯示=每天",
  preconditions: "起始頁面: 拼貼模式新增報表設定頁\n來源報表: 每日報表\n固定欄位: 新增帳號數",
  stepsSummary: "1. 加欄位「新增帳號數」\n2. 點時間區間 button\n3. 點靜態時間 tab\n4. 設定 2026/03/01~2026/03/15\n5. 按執行",
  expected: "request body dateRange = 2026-03-01~2026-03-15；本題不測項目: 儲存、CSV、reopen",
  validationMethod: "DOM read static tab + network request body"
});

const n03 = caseFixture({
  order: 102,
  rowNumber: 103,
  groupId: "N",
  groupName: "N:下載與結果表格",
  caseNo: "BIUI_COLLAGE_R001-N-03",
  caseTitle: "點擊 editor 右上下載 icon 觸發下載與 toast",
  testType: "功能流程",
  riskLevel: "🟡 建立",
  testTarget: "前後端整合",
  cleanupChecklist: "欄位=1欄;篩選=不影響;分組=不影響;時間=過去 7 天;顯示=不影響",
  preconditions: "起始頁面: 拼貼報表新增報表設定頁\n前置資源: 同 N-02 場景",
  stepsSummary: "1. 完成最小設置,執行計算\n2. 點擊右上下載 icon\n3. 透過 Playwright download API 取得下載檔",
  expected: "觸發下載事件，顯示成功 toast，下載 CSV 檔可取得。",
  validationMethod: "DOM read toast + Playwright download capture;evidence: dom.state, csv.rows, csv.aggregate"
});

const actionTemplates = (currentCase: CaseManifestCase): string[] =>
  buildHelperExecutionPlan({ runDir: os.tmpdir(), currentCase, helperHints: null }).actions.map((item) => item.template);

const hasPreviewAction = (templates: string[]): boolean =>
  templates.some((item) => /runPreview|runDateVariantsPreviewEvidence|downloadCsvAndComparePreview/.test(item));

const parsedResultWithInvalidObservationBlocker = (includeCaseScope = true): ParsedResultXlsx => {
  const currentRunEvidence = includeCaseScope
    ? {
        caseScope: {
          testIntent: "frontend_observation",
          previewRequired: false,
          executionRequired: false
        },
        uiEvidence: {
          modeTextVisible: ["拼貼模式", "指標趨勢", "明細檢視"],
          selectedMetricFields: []
        }
      }
    : {
        uiEvidence: {
          modeTextVisible: ["拼貼模式", "指標趨勢", "明細檢視"],
          selectedMetricFields: []
        }
      };
  return {
    parserVersion: "p0-scope-contract-fixture",
    schemaVersion: "p0-scope-contract-fixture-v1",
    bugs: [],
    cases: [
      {
        groupId: "K",
        groupName: "K:新增/編輯報表設定頁",
        caseNo: "BIUI_COLLAGE_R001-K-01",
        caseTitle: "建構方式 radio 預設選中「拼貼模式」",
        testType: "前端呈現",
        executionMethod: "Codex + Playwright",
        status: "BLOCKED",
        verdictReason: "EXECUTE_PRECONDITION_NO_SELECTED_FIELDS",
        detailJsonRaw: null,
        detailParseError: null,
        detailJson: {
          測試目的: "驗證建構方式 radio 預設選中拼貼模式。",
          設定條件: "新增報表頁；本題不選報表、不選欄位、不執行 preview。",
          預期行為: "拼貼模式 radio checked=true，其他 radio 可見未選中。",
          實際行為:
            "DOM 已讀到三個模式文案且拼貼模式可見，但後續 helper 在 preview 前置檢查發現 selected metric fields = 0，依執行前置規則中止。",
          blocked_reason: "EXECUTE_PRECONDITION_NO_SELECTED_FIELDS",
          currentRunEvidence
        }
      }
    ]
  };
};

const resultGateAcceptsOutOfScopePreviewBlocker = (includeCaseScope = true): boolean => {
  const report = evaluateResultEvidenceGate({
    parsed: parsedResultWithInvalidObservationBlocker(includeCaseScope),
    currentCaseNo: "BIUI_COLLAGE_R001-K-01",
    expectedCaseNos: ["BIUI_COLLAGE_R001-K-01"],
    resultSource: "codex_generated",
    requireSingleCase: true
  });
  return report.status === "ok";
};

type PrototypeCaseScope = {
  testIntent: "frontend_observation" | "preview_execution" | "download_execution";
  previewRequired: boolean;
  executionRequired: boolean;
  requiredEvidence: string[];
  missingActionTemplate: string | null;
};

const joinedCaseText = (item: CaseManifestCase): string =>
  [
    item.caseNo,
    item.groupName,
    item.caseTitle,
    item.testType,
    item.testTarget,
    item.riskLevel,
    item.cleanupChecklist,
    item.preconditions,
    item.stepsSummary,
    item.expected,
    item.validationMethod
  ]
    .filter(Boolean)
    .join("\n");

const prototypeDeriveCaseScope = (item: CaseManifestCase): PrototypeCaseScope => {
  const text = joinedCaseText(item);
  const isFrontendTarget = /前端呈現/.test(`${item.testTarget ?? ""}\n${item.testType ?? ""}`);
  const hasDownloadTerms = /CSV|下載|download/i.test(text);
  const downloadExplicitlyDisabled =
    /(?:本題不測項目|本題不做|本題不測|本題不驗|不測|不做|不驗).{0,40}(?:CSV|下載|download)|(?:CSV|下載|download).{0,20}(?:屬於|屬|不是|非|不測|不做|不驗)/i.test(text);
  const hasDownloadEvidence =
    /csv\.(?:rows|aggregate)|Playwright\s+download|download\s+API|downloaded\s*CSV|下載檔|CSV\s*檔可取得/i.test(text);
  const requiresCsvOrDownload =
    hasDownloadTerms && !downloadExplicitlyDisabled && (!isFrontendTarget || /前後端整合/.test(item.testTarget ?? "") || hasDownloadEvidence);
  const requiresPreview =
    /network\.requestBody|request body|Chart\.js|chart\.datasets|preview|預覽|執行計算|按執行|點計算|點擊.*下載|觸發下載/i.test(text) ||
    /前後端整合/.test(item.testTarget ?? "");
  const isDatePanelInteraction =
    /時間區間工具|時間 button|時間面板|preset 清單|動態\/靜態 tab|點擊時間區間 button/i.test(text) &&
    !requiresPreview &&
    isFrontendTarget;
  if (requiresCsvOrDownload) {
    return {
      testIntent: "download_execution",
      previewRequired: true,
      executionRequired: true,
      requiredEvidence: ["dom.state", "csv.rows", "csv.aggregate"],
      missingActionTemplate: null
    };
  }
  if (requiresPreview && !isFrontendTarget) {
    return {
      testIntent: "preview_execution",
      previewRequired: true,
      executionRequired: true,
      requiredEvidence: ["network.requestBody", "chart.datasets"],
      missingActionTemplate: null
    };
  }
  return {
    testIntent: "frontend_observation",
    previewRequired: false,
    executionRequired: false,
    requiredEvidence: isDatePanelInteraction ? ["dom.state", "dom.list", "screenshot"] : ["dom.state"],
    missingActionTemplate: isDatePanelInteraction ? "collage.datePanelObservation" : null
  };
};

const prototypeRejectsOutOfScopeSelectedFieldBlocker = (): boolean => {
  const parsed = parsedResultWithInvalidObservationBlocker();
  const item = parsed.cases[0];
  const detail = item?.detailJson ?? {};
  const currentRunEvidence = detail.currentRunEvidence && typeof detail.currentRunEvidence === "object"
    ? (detail.currentRunEvidence as Record<string, unknown>)
    : {};
  const scope = currentRunEvidence.caseScope && typeof currentRunEvidence.caseScope === "object"
    ? (currentRunEvidence.caseScope as Record<string, unknown>)
    : {};
  return (
    item?.status === "BLOCKED" &&
    /EXECUTE_PRECONDITION_NO_SELECTED_FIELDS/.test(`${item.verdictReason ?? ""}\n${String(detail.blocked_reason ?? "")}`) &&
    scope.previewRequired === false
  );
};

const prototypeMissingInstructionSeverity = (item: CaseManifestCase): "warning" | "error" => {
  const officialUiObservation =
    /^BIUI_COLLAGE_R001-(?:I|J|K|L|M|N)-/.test(item.caseNo) &&
    (/前端呈現/.test(item.testTarget ?? "") || /🟢\s*觀察/.test(item.riskLevel ?? ""));
  return officialUiObservation ? "error" : "warning";
};

const missingInstructionSectionIssueSeverity = (fixtureCase: CaseManifestCase): string | null => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-p0-scope-contract-"));
  try {
    const instructionPath = path.join(tempRoot, "instruction.md");
    fs.writeFileSync(instructionPath, "# Fixture instruction\n\nThis file intentionally has no per-case section.\n");
    const caseManifest: CaseManifestResult = {
      manifestPath: null,
      currentCasePath: null,
      casesDir: null,
      currentCaseNo: fixtureCase.caseNo,
      currentCaseSelection: null,
      cases: [fixtureCase],
      totalCases: 1,
      warnings: []
    };
    const report = buildTestPackageConsistencyReport({
      caseManifest,
      instructionPath,
      helperHintSourcePaths: [],
      baseDir: tempRoot,
      domain: "BI_OFFICIAL_UI_COLLAGE"
    });
    return report.issues.find((item) => item.code === "INSTRUCTION_CASE_SECTION_MISSING")?.severity ?? null;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};

const main = (): void => {
  const observationCases = [i01, j12, jIconObservation, k01, l02];
  const observationPlans = Object.fromEntries(observationCases.map((item) => [item.caseNo, actionTemplates(item)]));
  const previewPlans = {
    [b04.caseNo]: actionTemplates(b04),
    [b09.caseNo]: actionTemplates(b09),
    [n03.caseNo]: actionTemplates(n03)
  };
  const runtimeScopes = Object.fromEntries(
    [...observationCases, b04, b09, n03].map((item) => [item.caseNo, inferCaseScope(item, null)])
  );

  if (prototypeMode) {
    const prototypeScopes = Object.fromEntries(
      [...observationCases, b04, b09, n03].map((item) => [item.caseNo, prototypeDeriveCaseScope(item)])
    );
    for (const item of observationCases) {
      assert.equal(prototypeScopes[item.caseNo]?.previewRequired, false, `${item.caseNo} prototype scope should not require preview.`);
    }
    assert.equal(prototypeScopes[b04.caseNo]?.previewRequired, true, "B-04 prototype scope should require preview.");
    assert.equal(prototypeScopes[b09.caseNo]?.testIntent, "preview_execution", "B-09 prototype scope should be preview execution, not download execution.");
    assert.equal(prototypeScopes[n03.caseNo]?.testIntent, "download_execution", "N-03 prototype scope should be download execution.");
    assert.equal(
      prototypeRejectsOutOfScopeSelectedFieldBlocker(),
      true,
      "Prototype result gate should reject observation BLOCKED caused only by selectedMetricFields=0."
    );
    assert.equal(prototypeMissingInstructionSeverity(k01), "error", "Prototype lint should promote K-01 missing section to error.");
    assert.equal(
      prototypeScopes[l02.caseNo]?.missingActionTemplate,
      "collage.datePanelObservation",
      "Prototype planner should classify L-02 as missing a date-panel observation action template."
    );
    console.log(
      JSON.stringify(
        {
          ok: true,
          fixture: "p0-scope-contract",
          mode: "prototype-solution",
          prototypeScopes
        },
        null,
        2
      )
    );
    return;
  }

  for (const [caseNo, templates] of Object.entries(observationPlans)) {
    assert.equal(
      hasPreviewAction(templates),
      false,
      `${caseNo} observation fixture must not route to preview/download actions; templates=${templates.join(",")}`
    );
  }
  for (const item of observationCases) {
    assert.equal(runtimeScopes[item.caseNo]?.previewRequired, false, `${item.caseNo} runtime scope should not require preview.`);
  }
  assert.equal(runtimeScopes[b04.caseNo]?.previewRequired, true, "B-04 runtime scope should require preview.");
  assert.equal(runtimeScopes[b09.caseNo]?.testIntent, "preview_execution", "B-09 runtime scope should be preview execution, not download execution.");
  assert.equal(runtimeScopes[n03.caseNo]?.testIntent, "download_execution", "N-03 runtime scope should be download execution.");
  assert.equal(
    runtimeScopes[l02.caseNo]?.missingActionTemplate,
    "collage.datePanelObservation",
    "L-02 runtime scope should require a date-panel observation action template."
  );
  assert.equal(hasPreviewAction(previewPlans[b04.caseNo] ?? []), true, "B-04 control case must still route to preview evidence.");
  assert.equal(hasPreviewAction(previewPlans[b09.caseNo] ?? []), true, "B-09 control case must still route to preview evidence.");
  assert.ok(
    !(previewPlans[b09.caseNo] ?? []).includes("collage.downloadCsvAndComparePreview"),
    "B-09 negative CSV scope must not route to CSV download evidence."
  );
  assert.ok(
    (previewPlans[n03.caseNo] ?? []).includes("collage.downloadCsvAndComparePreview"),
    "N-03 control case must still route to CSV download evidence."
  );

  const l02Gate = evaluateCapabilityGate(l02, null);
  const l02SoftPreludeWithoutContractMissing =
    l02Gate.supportStatus === "degraded" &&
    l02Gate.blockingReason === null &&
    JSON.stringify(observationPlans[l02.caseNo]) === JSON.stringify(["collage.openProject", "collage.createReport"]);
  const resultGateCurrentlyAcceptsInvalidBlocker = resultGateAcceptsOutOfScopePreviewBlocker();
  const resultGateCurrentlyAcceptsInvalidBlockerWithoutScope = resultGateAcceptsOutOfScopePreviewBlocker(false);
  const k01MissingSectionSeverity = missingInstructionSectionIssueSeverity(k01);

  if (expectFixed) {
    assert.equal(
      resultGateCurrentlyAcceptsInvalidBlocker,
      false,
      "P0 fixed mode expects result gate to reject observation cases blocked only by selectedMetricFields=0."
    );
    assert.equal(
      resultGateCurrentlyAcceptsInvalidBlockerWithoutScope,
      false,
      "P0 fixed mode expects result gate to reject selectedMetricFields=0 observation blockers even when detail_json omitted caseScope."
    );
    assert.equal(
      k01MissingSectionSeverity,
      "error",
      "P0 fixed mode expects missing official UI case sections to be an error/requires-review gate, not a warning."
    );
    assert.equal(
      l02SoftPreludeWithoutContractMissing,
      false,
      "P0 fixed mode expects L-02 date-panel interaction to be explicitly classified as missing action template / contract, not only soft prelude."
    );
  } else {
    assert.equal(
      resultGateCurrentlyAcceptsInvalidBlocker,
      true,
      "Current-failure mode expects result gate to still accept the invalid observation blocker before P0 runtime fix."
    );
    assert.equal(
      resultGateCurrentlyAcceptsInvalidBlockerWithoutScope,
      true,
      "Current-failure mode expects result gate to still accept invalid selectedMetricFields=0 blocker without detail_json caseScope before P0 runtime fix."
    );
    assert.equal(
      k01MissingSectionSeverity,
      "warning",
      "Current-failure mode expects missing official UI case section to still be warning-only before P0 lint fix."
    );
    assert.equal(
      l02SoftPreludeWithoutContractMissing,
      true,
      "Current-failure mode expects L-02 to be only soft prelude without explicit HELPER_CONTRACT_MISSING classification."
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        fixture: "p0-scope-contract",
        mode: expectFixed ? "expect-fixed" : "expect-current-failure",
        runtimeScopes,
        controls: {
          observationNoPreview: observationPlans,
          previewCasesStillPreview: previewPlans
        },
        currentGaps: {
          resultGateAcceptsOutOfScopePreviewBlocker: resultGateCurrentlyAcceptsInvalidBlocker,
          resultGateAcceptsOutOfScopePreviewBlockerWithoutCaseScope:
            resultGateCurrentlyAcceptsInvalidBlockerWithoutScope,
          missingOfficialUiCaseSectionSeverity: k01MissingSectionSeverity,
          l02SoftPreludeWithoutContractMissing
        }
      },
      null,
      2
    )
  );
};

main();
