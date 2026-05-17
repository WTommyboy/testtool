import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readExpectedMetadataFieldsForTest } from "../agent/src/bi-ui-helper-executor";
import { evaluateCapabilityGate } from "../agent/src/capability-gate";
import { buildHelperExecutionPlan } from "../agent/src/helper-execution-plan";
import type { CaseManifestCase } from "../agent/src/case-manifest";
import type { HelperHints } from "../agent/src/helper-hints";

const collageSaveReopenCase: CaseManifestCase = {
  order: 1,
  rowNumber: 2,
  groupId: "A",
  groupName: "A:拼貼模式工具測試",
  caseNo: "TOOL-A-01",
  caseTitle: "拼貼模式 — 完整建制流程(建立→執行→儲存→重新檢視 4 項設定還原)",
  testType: "功能流程",
  executionMethod: "Codex + Playwright",
  riskLevel: "🟡 建立",
  testTarget: "功能流程",
  cleanupChecklist: "欄位=新增帳號數;篩選=不影響;分組=不影響;時間=2026/03/01~2026/03/31;顯示=每天",
  preconditions: "建構模式: 拼貼\n參考資料: metadata v1.2.5, 來源報表=每日報表",
  stepsSummary: [
    "1. 進入拼貼模式新增報表頁",
    "2. 來源報表選「每日報表」並驗證 dropdown 顯示",
    "3. 加欄位「新增帳號數」",
    "4. 設時間區間 2026/03/01~2026/03/31",
    "5. 按執行",
    "6. 儲存報表(報表名: TOOL_A01_<timestamp>)",
    "7. 從清單重新開啟該報表",
    "8. 確認來源報表/時間/欄位/報表名還原"
  ].join("\n"),
  expected: "圖表顯示具體數值；儲存成功；重開後 4 項設定全部還原",
  resultStatus: null,
  testDate: null,
  detailJson: null,
  validationMethod: "Evidence: DOM read + Playwright snapshot + network request body",
  currentCaseFile: "fixture/TOOL-A-01.json"
};

const filterCase: CaseManifestCase = {
  ...collageSaveReopenCase,
  caseNo: "TOOL-F-01",
  cleanupChecklist: "欄位=新增帳號數;篩選=商品單價 大於 100;分組=不影響;時間=2026/03/01~2026/03/31;顯示=每天",
  stepsSummary: "1. 新增篩選 商品單價 大於 100\n2. 按執行"
};

const collageMultiFieldPreviewCase: CaseManifestCase = {
  ...collageSaveReopenCase,
  order: 2,
  rowNumber: 3,
  caseNo: "TOOL-A-02",
  caseTitle: "拼貼模式 — 同時選 3 個欄位執行 preview,驗證後端能正確回傳多欄資料",
  testType: "資料確認(多欄位 preview)",
  riskLevel: "🟢 觀察",
  testTarget: "後端功能",
  cleanupChecklist: "欄位=新增帳號數 + MAU(帳號) + 總營收(TWD);篩選=不影響;分組=不影響;時間=2026/03/01~2026/03/31;顯示=每天",
  preconditions: "建構模式: 拼貼\n參考資料: metadata v1.2.5, 來源報表=每日報表, 3 個欄位皆屬「每日報表」可選",
  stepsSummary: "1. 進入拼貼模式新增報表頁\n2. 來源報表選「每日報表」\n3. 依序加欄位:新增帳號數、MAU(帳號)、總營收(TWD)\n4. 設時間區間 2026/03/01~2026/03/31\n5. 按執行\n6. 透過 Playwright network observation 抓 preview API response",
  expected: "request body 含 3 個欄位的指標 ID\nresponse 回傳 3 個欄位的 daily 資料,各 31 個資料點",
  validationMethod: "Evidence: network request body + network response body + DOM read"
};

const collageCsvDownloadCase: CaseManifestCase = {
  ...collageSaveReopenCase,
  order: 4,
  rowNumber: 5,
  caseNo: "TOOL-A-04",
  caseTitle: "拼貼模式 — 建制 + 儲存 + 從報表清單下載 CSV,驗證下載資料與 preview 一致",
  testType: "功能流程(含下載)",
  riskLevel: "🟡 建立",
  testTarget: "功能流程",
  cleanupChecklist: "欄位=MAU(帳號);篩選=不影響;分組=不影響;時間=2026/03/01~2026/03/31;顯示=每天",
  stepsSummary: "1. 進入拼貼模式新增報表頁\n2. 加欄位「MAU(帳號)」\n3. 按執行取得 current preview\n4. 儲存報表(報表名: TOOL_A04_<timestamp>)\n5. 回到專案/報表清單頁\n6. 從已儲存報表列點 UI 下載 CSV\n7. 本機讀 CSV 內容比對儲存前 preview 數值",
  expected: "儲存成功\n清單出現該報表\n從清單下載 CSV 成功且本機可讀\nCSV row count / 數值與儲存前 preview 完全一致",
  validationMethod: "Evidence: DOM read + network/chart/table evidence + UI-triggered downloaded CSV + local CSV parser"
};

const collageExistingReportCase: CaseManifestCase = {
  ...collageSaveReopenCase,
  order: 5,
  rowNumber: 6,
  caseNo: "TOOL-A-05",
  caseTitle: "拼貼模式 — 開啟 TOOL-A-01 已儲存報表,修改欄位後儲存覆寫",
  testType: "功能流程(修改既有)",
  riskLevel: "🟠 修改",
  testTarget: "功能流程",
  cleanupChecklist: "欄位=新增帳號數 + 總營收(TWD);篩選=不影響;分組=不影響;時間=2026/03/01~2026/03/31;顯示=每天",
  preconditions: "建構模式: 拼貼\n必須先執行 TOOL-A-01 並建立 TOOL_A01_<timestamp> 報表才能跑本 case",
  stepsSummary: "1. 從清單找到 TOOL_A01_<timestamp> 報表\n2. 點該報表進入編輯\n3. 加欄位「總營收(TWD)」\n4. 按執行\n5. 儲存覆寫(維持原報表名)\n6. 重新開啟該報表",
  expected: "覆寫成功且重開後欄位列為 2 欄(新增帳號數 + 總營收(TWD))"
};

const collageMetadataCompareCase: CaseManifestCase = {
  ...collageSaveReopenCase,
  order: 3,
  rowNumber: 4,
  caseNo: "TOOL-A-03",
  caseTitle: "拼貼模式 — 「每日報表」可設置欄位是否與 metadata v1.2.5 一致",
  testType: "資料確認(metadata 對照)",
  riskLevel: "🟢 觀察",
  testTarget: "前端呈現",
  cleanupChecklist: "欄位=空;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
  preconditions: "建構模式: 拼貼\n參考資料: rules/BI_DATA/metadata.csv;source_filename=metadata＿1.2.5 - 工作表1.csv;reference_index_key=bi_metadata_csv;來源報表=每日報表(規範 32 欄)",
  stepsSummary: "1. 進入拼貼模式新增報表頁\n2. 來源報表選「每日報表」\n3. 點「+ 新增欄位」展開欄位下拉\n4. 抓取下拉清單所有可選欄位\n5. 對照指定 metadata CSV\n6. detail_json 表格化呈現缺少 / 多出與 reference source",
  expected: "「每日報表」可設置欄位完全符合 metadata v1.2.5 規範",
  validationMethod: "Evidence: DOM read(欄位下拉清單)+ rules/BI_DATA/metadata.csv 對照計算"
};

const previewOnlyHints: HelperHints = {
  caseId: "TOOL-D-01",
  automationLevel: "helper",
  operationTemplate: "collage_build_preview_save_reopen",
  params: {
    scope: "preview_only",
    skipSave: true,
    skipReopen: true,
    field: "新增帳號數",
    dateRange: "不影響",
    display: "不影響"
  },
  requiredEvidence: ["network.requestBody", "chart.datasets"],
  forbiddenAutomation: ["direct_bi_api", "internal_js_setter"],
  aiDecisionRequired: true,
  raw: {},
  sourcePath: "fixture/helper-hints.md",
  sourceRelativePath: "fixture/helper-hints.md",
  warnings: []
};

const manualAiDateHints: HelperHints = {
  caseId: "OTTEST004-B-03",
  automationLevel: "manual_ai",
  operationTemplate: "manual_ai",
  params: {
    mode: "拼貼",
    field: "新增帳號數",
    sourceReport: "每日報表",
    dateVariants: ["昨日", "今日"],
    display: "每天",
    doNotSave: true,
    doNotReopen: true,
    doNotDownloadCsv: true,
    scope: "preview_only"
  },
  requiredEvidence: ["dom.state", "network.requestBody", "chart.datasets"],
  forbiddenAutomation: ["direct_bi_api", "internal_js_setter"],
  aiDecisionRequired: true,
  raw: {},
  sourcePath: "fixture/helper-hints.md",
  sourceRelativePath: "fixture/helper-hints.md",
  warnings: []
};

const helperDateVariantsHints: HelperHints = {
  ...manualAiDateHints,
  automationLevel: "helper",
  operationTemplate: "chart_csv_consistency"
};

const selectAllFieldsHints: HelperHints = {
  caseId: "OTTEST004-D-02",
  automationLevel: "helper",
  operationTemplate: "chart_csv_consistency",
  params: {
    mode: "拼貼",
    sourceReports: ["每日報表", "各登入渠道狀況(原 beanfun! 導流)", "退費追蹤", "雙平台營收佔比"],
    selectAllFields: true,
    expectedFieldCount: 72,
    dateRange: { start: "2026-03-01", end: "2026-03-31" },
    display: "每天",
    downloadCsv: true,
    skipSave: true
  },
  requiredEvidence: ["dom.state", "network.requestBody", "chart.datasets", "csv.rows"],
  forbiddenAutomation: ["direct_bi_api", "internal_js_setter"],
  aiDecisionRequired: true,
  raw: {},
  sourcePath: "fixture/helper-hints.md",
  sourceRelativePath: "fixture/helper-hints.md",
  warnings: []
};

const actualD02StructuredHints: HelperHints = {
  caseId: "OTTEST004-D-02",
  automationLevel: "manual_ai",
  operationTemplate: "manual_ai",
  params: {
    mode: "拼貼",
    expectedSources: ["每日報表", "各登入渠道狀況(原 beanfun! 導流)", "退費追蹤", "雙平台營收佔比"],
    expectedTotalFieldCount: 72,
    dateMode: "static",
    start: { type: "static", date: "2026-03-01" },
    end: { type: "static", date: "2026-03-31" },
    doNotSave: true,
    doNotReopen: true,
    downloadCsv: true
  },
  requiredEvidence: ["dom.state", "dom.list", "network.requestBody", "chart.datasets", "csv.rows"],
  forbiddenAutomation: ["direct_bi_api", "internal_js_setter", "multi_case_batch"],
  aiDecisionRequired: true,
  raw: {},
  sourcePath: "fixture/helper-hints.md",
  sourceRelativePath: "fixture/helper-hints.md",
  warnings: []
};

const allZeroFieldInspectionHints: HelperHints = {
  caseId: "OTTEST004-A-06",
  automationLevel: "helper",
  operationTemplate: "collage_all_zero_field_inspection",
  params: {
    mode: "拼貼",
    sourceReport: "每日報表",
    selectAllFieldsInSourceReport: true,
    expectedFieldCount: 32,
    dateRange: { start: "2026-03-01", end: "2026-03-31" },
    display: "每天",
    scope: "preview_only",
    skipSave: true,
    skipReopen: true,
    skipDownload: true
  },
  requiredEvidence: ["dom.list", "network.requestBody", "network.responseBody", "chart.datasets", "screenshot"],
  forbiddenAutomation: ["direct_bi_api", "internal_js_setter", "multi_case_batch"],
  aiDecisionRequired: true,
  raw: {},
  sourcePath: "fixture/helper-hints.md",
  sourceRelativePath: "fixture/helper-hints.md",
  warnings: []
};

const formulaHelperHints: HelperHints = {
  caseId: "OTTEST004-E-01",
  automationLevel: "helper",
  operationTemplate: "collage.configureCalculatedMetricAndPreview",
  params: {
    mode: "拼貼",
    baseFields: ["新增帳號數", "MAU(帳號)"],
    calculatedFieldNamePrefix: "OTTEST004_E01_calc",
    formula: "[新增帳號數]+[MAU(帳號)]/2",
    dateRange: { start: "2026-03-01", end: "2026-03-31" },
    display: "每天",
    doNotSave: true,
    doNotReopen: true,
    doNotDownloadCsv: true
  },
  requiredEvidence: ["dom.state", "formula.uiState", "network.requestBody", "chart.datasets", "screenshot"],
  forbiddenAutomation: ["direct_bi_api", "internal_js_setter", "multi_case_batch", "type_formula_directly_in_readonly_input"],
  aiDecisionRequired: true,
  raw: {},
  sourcePath: "fixture/helper-hints.md",
  sourceRelativePath: "fixture/helper-hints.md",
  warnings: []
};

const metadataSourceScopeHints: HelperHints = {
  caseId: "OTTEST004-A-04",
  automationLevel: "helper",
  operationTemplate: "metadata_dropdown_compare",
  params: {
    mode: "拼貼",
    comparisonScope: "source_report_fields",
    expectedReportSources: ["各登入渠道狀況(原 beanfun! 導流)"],
    expectedFieldCount: 27,
    sourceReport: "各登入渠道狀況(原 beanfun! 導流)",
    referenceCsv: "rules/BI_DATA/metadata.csv",
    referenceSourceName: "metadata＿1.2.5 - 工作表1.csv",
    referenceSourcePath: "BI_DATA/metadata＿1.2.5 - 工作表1.csv",
    referenceIndexKey: "bi_metadata_csv",
    matchKey: "欄位名稱",
    compareFields: ["欄位名稱", "主分類", "次分類", "資料類型"]
  },
  requiredEvidence: ["dom.list"],
  forbiddenAutomation: ["direct_bi_api", "internal_js_setter", "multi_case_batch"],
  aiDecisionRequired: true,
  raw: {},
  sourcePath: "fixture/helper-hints.md",
  sourceRelativePath: "fixture/helper-hints.md",
  warnings: []
};

const main = (): void => {
  const report = evaluateCapabilityGate(collageSaveReopenCase, null);
  assert.equal(report.supportStatus, "supported", `TOOL-A-01 save/reopen fixture should be helper supported; report=${JSON.stringify(report)}`);
  assert.deepEqual(report.unsupportedFeatures, []);
  assert.equal(report.detected.hasFilter, false, "篩選=不影響 must not be treated as an active filter capability");
  assert.equal(report.detected.hasGroup, false, "分組=不影響 must not be treated as an active group capability");
  assert.equal(report.detected.isMetadataDropdown, false, "metadata reference material must not turn a save/reopen flow into metadata-dropdown comparison");

  const multiField = evaluateCapabilityGate(collageMultiFieldPreviewCase, null);
  assert.equal(multiField.detected.mode, "collage", "`指標 ID` inside a collage preview case must not be treated as metric mode");
  assert.equal(multiField.supportStatus, "supported", JSON.stringify(multiField));
  assert.deepEqual(multiField.unsupportedFeatures, []);

  const metadataCompare = evaluateCapabilityGate(collageMetadataCompareCase, null);
  assert.equal(metadataCompare.detected.mode, "collage", "`detail_json` wording must not be treated as record/detail mode");
  assert.equal(metadataCompare.detected.isMetadataDropdown, true, "metadata compare case should be recognized as dropdown/metadata observation");
  assert.equal(metadataCompare.supportStatus, "supported", JSON.stringify(metadataCompare));
  assert.deepEqual(metadataCompare.unsupportedFeatures, []);
  assert.ok(
    metadataCompare.supportedHelperTemplates.includes("collage.extractMetadataDropdownFields"),
    "metadata compare should be helper-assisted by dedicated dropdown extraction"
  );

  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "uat-capability-gate-fixture-"));
  try {
    const plan = buildHelperExecutionPlan({ runDir, currentCase: collageSaveReopenCase, helperHints: null });
    assert.ok(plan.actions.some((item) => item.template === "collage.configureMetric"), "helper plan should include collage.configureMetric");
    assert.ok(plan.actions.some((item) => item.template === "collage.saveReport"), "helper plan should include collage.saveReport");
    assert.ok(plan.actions.some((item) => item.template === "collage.reopenReport"), "helper plan should include collage.reopenReport");

    const multiFieldPlan = buildHelperExecutionPlan({ runDir, currentCase: collageMultiFieldPreviewCase, helperHints: null });
    const multiFieldConfigure = multiFieldPlan.actions.find((item) => item.template === "collage.configureMetric");
    assert.deepEqual(multiFieldConfigure?.params.fields, ["新增帳號數", "MAU(帳號)", "總營收(TWD)"], "multi-field helper params should split composite metric string");

    const csvPlan = buildHelperExecutionPlan({ runDir, currentCase: collageCsvDownloadCase, helperHints: null });
    assert.ok(csvPlan.actions.some((item) => item.template === "collage.downloadCsvAndComparePreview"), "CSV case should include download/compare helper action");
    assert.ok(!csvPlan.actions.some((item) => item.template === "collage.reopenReport"), "list-page CSV case should not reopen the editor");
    assert.equal(csvPlan.actions.find((item) => item.template === "collage.downloadCsvAndComparePreview")?.params.downloadScope, "report_list", "CSV helper should target saved report row/list-page download");

    const metadataPlan = buildHelperExecutionPlan({ runDir, currentCase: collageMetadataCompareCase, helperHints: null });
    assert.ok(metadataPlan.actions.some((item) => item.template === "collage.extractMetadataDropdownFields"), "metadata compare should include dropdown extraction helper action");
    assert.ok(!metadataPlan.actions.some((item) => item.template === "collage.runPreviewAndCollectEvidence"), "metadata compare should not run preview");

    const metadataSourceScopePlan = buildHelperExecutionPlan({
      runDir,
      currentCase: {
        ...collageMetadataCompareCase,
        caseNo: "OTTEST004-A-04",
        caseTitle: "各登入渠道狀況報表欄位清單對照 metadata",
        preconditions: "建構模式: 拼貼; 來源報表=各登入渠道狀況(原 beanfun! 導流)",
        stepsSummary: "展開欄位 picker 並對照該來源報表的 27 欄"
      },
      helperHints: metadataSourceScopeHints
    });
    const metadataSourceScopeAction = metadataSourceScopePlan.actions.find((item) => item.template === "collage.extractMetadataDropdownFields");
    assert.equal(metadataSourceScopeAction?.params.comparisonScope, "source_report_fields", "metadata comparisonScope must be forwarded to helper action params");
    assert.deepEqual(metadataSourceScopeAction?.params.expectedReportSources, ["各登入渠道狀況(原 beanfun! 導流)"], "metadata expectedReportSources must be forwarded to helper action params");
    assert.equal(metadataSourceScopeAction?.params.expectedFieldCount, 27, "source-specific expectedFieldCount must be forwarded");
    assert.equal(metadataSourceScopeAction?.params.referenceSourcePath, "BI_DATA/metadata＿1.2.5 - 工作表1.csv", "metadata referenceSourcePath must be forwarded");

    const existingPlan = buildHelperExecutionPlan({ runDir, currentCase: collageExistingReportCase, helperHints: null });
    assert.ok(existingPlan.actions.some((item) => item.template === "collage.openExistingReport"), "A-05 should open an existing report instead of creating a new report");
    assert.ok(!existingPlan.actions.some((item) => item.template === "collage.createReport"), "A-05 should not create a new report");
    assert.equal(existingPlan.actions.find((item) => item.template === "collage.saveReport")?.params.overwriteExisting, true, "A-05 save should be overwriteExisting");

    const saveLoadCase = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-F-02",
      caseTitle: "載入已儲存報表 — 設定還原(欄位/時間/顯示)",
      cleanupChecklist: "欄位=新增帳號數;篩選=0組;分組=不影響;時間=2026/03/01~2026/03/31;顯示=每天",
      stepsSummary: "先建一張新報表並儲存，再 reopen 驗設定還原；若時間變過去 7 天則 FAIL"
    };
    const saveLoadHints: HelperHints = {
      ...manualAiDateHints,
      caseId: "OTTEST004-F-02",
      automationLevel: "helper",
      operationTemplate: "save_load_flow",
      params: {
        mode: "拼貼",
        field: "新增帳號數",
        dateRange: { start: "2026-03-01", end: "2026-03-31" },
        display: "每天",
        save: true,
        reopen: true,
        reportNamePattern: "OTTEST004-F-02-<timestamp>"
      }
    };
    const saveLoadPlan = buildHelperExecutionPlan({ runDir, currentCase: saveLoadCase, helperHints: saveLoadHints });
    assert.ok(saveLoadPlan.actions.some((item) => item.template === "collage.createReport"), "F-02 should create a fresh report before save/reopen");
    assert.ok(!saveLoadPlan.actions.some((item) => item.template === "collage.openExistingReport"), "F-02 should not be misclassified as existing-report modification");
    assert.ok(saveLoadPlan.actions.some((item) => item.template === "collage.saveReport"), "F-02 should save the fresh report");
    assert.ok(saveLoadPlan.actions.some((item) => item.template === "collage.reopenReport"), "F-02 should reopen the saved report");

    const actualSaveLoadCase = {
      ...saveLoadCase,
      preconditions: "v1.8.7 同 case 建立後 reopen,不依賴既有報表;報表名稱含 timestamp 確保唯一",
      stepsSummary: "同 case 建立 → 儲存 → 回專案頁 → 點報表名稱 reopen → 驗證設定還原"
    };
    const actualSaveLoadHints: HelperHints = {
      ...saveLoadHints,
      params: {
        mode: "拼貼",
        field: "新增帳號數",
        sourceReport: "每日報表",
        dateMode: "static",
        start: { type: "static", date: "2026-03-01" },
        end: { type: "static", date: "2026-03-31" },
        display: "每天",
        saveReportNamePrefix: "OTTEST004_F02_",
        useTimestamp: true,
        reopenViaClickReportName: true,
        verifyRestoredFields: ["selectedFields", "dateRange", "display"],
        expectedRestoredDateRange: "2026-03-01~2026-03-31",
        scope: "同 case 建立 → 儲存 → 回專案頁 → 點報表名稱 reopen → 驗證設定還原"
      }
    };
    const actualSaveLoadGate = evaluateCapabilityGate(actualSaveLoadCase, actualSaveLoadHints);
    assert.ok(!actualSaveLoadGate.supportedHelperTemplates.includes("collage.openExistingReport"), "actual F-02 same-case flow must not advertise openExistingReport");
    const actualSaveLoadPlan = buildHelperExecutionPlan({ runDir, currentCase: actualSaveLoadCase, helperHints: actualSaveLoadHints });
    assert.deepEqual(
      actualSaveLoadPlan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createReport", "collage.configureMetric", "collage.runPreviewAndCollectEvidence", "collage.saveReport", "collage.reopenReport"],
      "actual F-02 same-case save/reopen should create, save, then reopen the current saved report"
    );
    assert.equal(
      actualSaveLoadPlan.actions.find((item) => item.template === "collage.saveReport")?.params.reportNamePattern,
      "OTTEST004_F02_<timestamp>",
      "actual F-02 saveReportNamePrefix should become a timestamped reportNamePattern"
    );
    const manualDateSaveLoadHints: HelperHints = {
      ...manualAiDateHints,
      caseId: "OTTEST004-F-02",
      automationLevel: "manual_ai",
      operationTemplate: "manual_ai",
      params: {
        mode: "拼貼",
        field: "新增帳號數",
        sourceReport: "每日報表",
        dateMode: "static",
        start: { type: "static", date: "2026-03-01" },
        end: { type: "static", date: "2026-03-31" },
        display: "每天",
        saveReportNamePrefix: "OTTEST004_F02_",
        reopenViaClickReportName: true,
        verifyRestoredFields: ["selectedFields", "dateRange", "display"],
        expectedRestoredDateRange: "2026-03-01~2026-03-31",
        scope: "同 case 建立 → 儲存 → 回專案頁 → 點報表名稱 reopen → 驗證設定還原"
      }
    };
    const manualDateSaveLoadGate = evaluateCapabilityGate(actualSaveLoadCase, manualDateSaveLoadHints);
    assert.ok(
      manualDateSaveLoadGate.supportedHelperTemplates.includes("collage.reopenReport"),
      "manual_ai F-02 date-preview save/reopen gate should advertise reopenReport"
    );
    const manualDateSaveLoadPlan = buildHelperExecutionPlan({ runDir, currentCase: actualSaveLoadCase, helperHints: manualDateSaveLoadHints });
    assert.deepEqual(
      manualDateSaveLoadPlan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createReport", "collage.runDateVariantsPreviewEvidence", "collage.saveReport", "collage.reopenReport"],
      "manual_ai F-02 date-preview save/reopen should save, then reopen the current saved report"
    );

    const saveOnlyCase = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-F-01",
      caseTitle: "儲存報表 — 儲存後出現在清單",
      cleanupChecklist: "欄位=新增帳號數;篩選=0組;分組=不影響;時間=2026/03/01~2026/03/31;顯示=每天",
      stepsSummary: "進入設定頁，加新增帳號數，執行 preview，儲存 OTTEST004_F01_<timestamp>，返回專案頁確認報表名稱出現在清單。本題只測儲存後出現在清單，不測 reopen 設定還原。"
    };
    const saveOnlyHints: HelperHints = {
      ...saveLoadHints,
      caseId: "OTTEST004-F-01",
      params: {
        mode: "拼貼",
        field: "新增帳號數",
        dateRange: { start: "2026-03-01", end: "2026-03-31" },
        display: "每天",
        saveOnly: true,
        skipReopen: true,
        reportNamePattern: "OTTEST004-F-01-<timestamp>"
      }
    };
    const saveOnlyPlan = buildHelperExecutionPlan({ runDir, currentCase: saveOnlyCase, helperHints: saveOnlyHints });
    assert.deepEqual(
      saveOnlyPlan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createReport", "collage.configureMetric", "collage.runPreviewAndCollectEvidence", "collage.saveReport"],
      "F-01 save-only flow should create/configure/preview/save a fresh report without openExisting/reopen/project-list reopen"
    );
    assert.equal(saveOnlyPlan.actions.find((item) => item.template === "collage.saveReport")?.params.openExistingReport, false, "F-01 save-only params must not request existing-report open");

    const formulaCase = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-E-01",
      caseTitle: "基本四則運算 [A]+[B]/2(無括號,測運算優先順序)",
      testType: "後端功能",
      riskLevel: "🟢 觀察",
      testTarget: "後端功能",
      cleanupChecklist: "欄位=新增帳號數,MAU(帳號),運算欄位「OTTEST004_E01_calc_<timestamp>」=[新增帳號數]+[MAU(帳號)]/2;篩選=0組;分組=不影響;時間=2026/03/01~2026/03/31;顯示=每天",
      stepsSummary: "透過 + 新增欄位加入基底欄位，點 + 新增運算欄位，使用可用欄位 token 與 keypad/operator 按鈕組公式 [新增帳號數]+[MAU(帳號)]/2，確認後執行 preview。",
      expected: "helper 完成 modal UI 流程且 chart.datasets 中運算欄位逐日值符合公式。"
    };
    const formulaGate = evaluateCapabilityGate(formulaCase, formulaHelperHints);
    assert.equal(formulaGate.supportStatus, "supported", `formula helper case should be supported, not filter-blocked; report=${JSON.stringify(formulaGate)}`);
    assert.equal(formulaGate.detected.hasFilter, false, "formula operator wording must not be misclassified as a filter operator");
    assert.ok(!formulaGate.unsupportedFeatures.includes("filter_helper_not_implemented"), "formula helper case must not emit filter_helper_not_implemented");
    const formulaPlan = buildHelperExecutionPlan({ runDir, currentCase: formulaCase, helperHints: formulaHelperHints });
    assert.deepEqual(
      formulaPlan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createReport", "collage.configureCalculatedMetricAndPreview"],
      "E-01 formula helper plan should open project, create report, then configure calculated metric preview"
    );
    const formulaE04Plan = buildHelperExecutionPlan({
      runDir,
      currentCase: { ...formulaCase, caseNo: "OTTEST004-E-04", caseTitle: "括號運算優先順序 ([A]+[B])/2" },
      helperHints: {
        ...formulaHelperHints,
        caseId: "OTTEST004-E-04",
        params: { ...(formulaHelperHints.params as Record<string, unknown>), calculatedFieldNamePrefix: "OTTEST004_E04_calc", formula: "([新增帳號數]+[MAU(帳號)])/2" }
      }
    });
    assert.deepEqual(
      formulaE04Plan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createReport", "collage.configureCalculatedMetricAndPreview"],
      "E-04 formula helper plan should use the same calculated metric helper path"
    );

    const createProjectAndReportCase = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-G-02",
      caseTitle: "新增專案後建立報表",
      cleanupChecklist: "欄位=新增帳號數;篩選=0組;分組=不影響;時間=2026/03/01~2026/03/31;顯示=每天",
      stepsSummary: "新增專案 OTTEST004_G02_<timestamp>，在該專案建立報表 OTTEST004_G02_report 並儲存"
    };
    const createProjectAndReportHints: HelperHints = {
      ...manualAiDateHints,
      caseId: "OTTEST004-G-02",
      automationLevel: "helper",
      operationTemplate: "collage_build_preview_save_reopen",
      params: {
        mode: "拼貼",
        createNewProject: true,
        projectNamePattern: "OTTEST004_G02_<timestamp>",
        field: "新增帳號數",
        dateRange: { start: "2026-03-01", end: "2026-03-31" },
        display: "每天",
        save: true,
        reportName: "OTTEST004_G02_report",
        skipReopen: true
      }
    };
    const createProjectAndReportPlan = buildHelperExecutionPlan({ runDir, currentCase: createProjectAndReportCase, helperHints: createProjectAndReportHints });
    assert.deepEqual(
      createProjectAndReportPlan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createProject", "collage.createReport", "collage.configureMetric", "collage.runPreviewAndCollectEvidence", "collage.saveReport"],
      "G-02 should create a project, then create/configure/preview/save a report in that project"
    );

    const createProjectOnlyCase = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-G-01",
      caseTitle: "新增專案 — 建立拼貼專案",
      cleanupChecklist: "欄位=不影響;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
      stepsSummary: "點 + 新增專案，選建構模式=拼貼，輸入專案名稱後建立；獨立 case，只測新增專案，不進入新建報表頁。"
    };
    const createProjectOnlyHints: HelperHints = {
      ...manualAiDateHints,
      caseId: "OTTEST004-G-01",
      automationLevel: "helper",
      operationTemplate: "collage.createProject",
      params: {
        mode: "拼貼",
        projectNamePrefix: "OTTEST004_G01_",
        useTimestamp: true,
        expectModeSelector: true,
        blockOnModeAlert: true,
        scope: "獨立 case;只測新增專案,不進入新建報表頁"
      }
    };
    const createProjectOnlyGate = evaluateCapabilityGate(createProjectOnlyCase, createProjectOnlyHints);
    assert.deepEqual(
      createProjectOnlyGate.supportedHelperTemplates,
      ["collage.openProject", "collage.createProject"],
      "G-01 dotted createProject template should advertise only project creation helpers"
    );
    const createProjectOnlyPlan = buildHelperExecutionPlan({ runDir, currentCase: createProjectOnlyCase, helperHints: createProjectOnlyHints });
    assert.deepEqual(
      createProjectOnlyPlan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createProject"],
      "G-01 dotted createProject template should not fall through to report creation/preview"
    );

    const openReportCase = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-G-04",
      caseTitle: "報表名稱進入編輯(reopen)",
      cleanupChecklist: "欄位=不影響;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
      stepsSummary: "在專案頁點報表名稱 OTTEST004_G02_report 進入設定頁"
    };
    const openReportPlan = buildHelperExecutionPlan({ runDir, currentCase: openReportCase, helperHints: { ...manualAiDateHints, caseId: "OTTEST004-G-04", params: { action: "click report name -> enter editor" } } });
    assert.deepEqual(
      openReportPlan.actions.map((item) => item.template),
      ["collage.openProject", "collage.openReportFromProjectList"],
      "G-04 should use a dedicated report-name navigation helper"
    );

    const backCase = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-G-05",
      caseTitle: "返回按鈕 — 從設定頁回專案頁",
      cleanupChecklist: "欄位=不影響;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
      stepsSummary: "先點報表名稱 OTTEST004_G02_report 進設定頁，再點返回按鈕回專案頁"
    };
    const backPlan = buildHelperExecutionPlan({ runDir, currentCase: backCase, helperHints: { ...manualAiDateHints, caseId: "OTTEST004-G-05", params: { action: "click back button -> return to project page" } } });
    assert.deepEqual(
      backPlan.actions.map((item) => item.template),
      ["collage.openProject", "collage.openReportFromProjectList", "collage.clickBackToProjectList"],
      "G-05 should open a report, then verify the back button returns to the project page"
    );

    const previewOnlyCase = {
      ...collageSaveReopenCase,
      caseNo: "TOOL-D-01",
      cleanupChecklist: "欄位=新增帳號數;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
      stepsSummary: "1. 進入拼貼模式新增報表頁\n2. 加欄位「新增帳號數」\n3. 按執行取得 preview\n4. 本題不儲存、不重開"
    };
    const previewOnlyGate = evaluateCapabilityGate(previewOnlyCase, previewOnlyHints);
    assert.ok(!previewOnlyGate.supportedHelperTemplates.includes("collage.saveReport"), "preview-only helper hints must not advertise saveReport");
    assert.ok(!previewOnlyGate.supportedHelperTemplates.includes("collage.reopenReport"), "preview-only helper hints must not advertise reopenReport");
    const previewOnlyPlan = buildHelperExecutionPlan({ runDir, currentCase: previewOnlyCase, helperHints: previewOnlyHints });
    assert.ok(previewOnlyPlan.actions.some((item) => item.template === "collage.runPreviewAndCollectEvidence"), "preview-only flow should still run preview evidence");
    assert.ok(!previewOnlyPlan.actions.some((item) => item.template === "collage.saveReport"), "skipSave must suppress saveReport even when template name includes save_reopen");
    assert.ok(!previewOnlyPlan.actions.some((item) => item.template === "collage.reopenReport"), "skipReopen must suppress reopenReport even when template name includes save_reopen");
    assert.equal(
      previewOnlyPlan.actions.find((item) => item.template === "collage.configureMetric")?.params.dateRange,
      null,
      "neutral dateRange must not be passed to helper as a clickable date preset"
    );

    const staticDateNegativeScopeCase = {
      ...collageSaveReopenCase,
      caseNo: "BIUI_COLLAGE_R001-B-09",
      caseTitle: "靜態區間 — 2026/03/01 ~ 2026/03/15",
      testTarget: "前後端整合",
      riskLevel: "🟢 觀察",
      cleanupChecklist: "欄位=新增帳號數;篩選=0組;分組=不影響;時間=2026/03/01~2026/03/15;顯示=每天",
      stepsSummary: "1. 加欄位「新增帳號數」\n2. 點時間區間 button\n3. 點靜態時間 tab\n4. 設定 2026/03/01~2026/03/15\n5. 按執行",
      expected: "request body dateRange = 2026-03-01~2026-03-15；本題不測項目: 儲存、CSV、reopen",
      validationMethod: "DOM read static tab + network request body"
    };
    const staticDateNegativeScopeHints: HelperHints = {
      ...previewOnlyHints,
      caseId: "BIUI_COLLAGE_R001-B-09",
      operationTemplate: "collage_build_preview_save_reopen",
      params: {
        mode: "拼貼",
        field: "新增帳號數",
        sourceReport: "每日報表",
        dateRange: "2026/03/01~2026/03/15",
        display: "每天"
      }
    };
    const staticDateNegativeScopeGate = evaluateCapabilityGate(staticDateNegativeScopeCase, staticDateNegativeScopeHints);
    assert.equal(staticDateNegativeScopeGate.caseScope.testIntent, "preview_execution", "negative CSV text must not turn B-09 into download_execution scope");
    assert.ok(!staticDateNegativeScopeGate.supportedHelperTemplates.includes("collage.saveReport"), "本題不測項目: 儲存 must suppress saveReport");
    assert.ok(!staticDateNegativeScopeGate.supportedHelperTemplates.includes("collage.reopenReport"), "本題不測項目: reopen must suppress reopenReport");
    assert.ok(!staticDateNegativeScopeGate.supportedHelperTemplates.includes("collage.downloadCsvAndComparePreview"), "本題不測項目: CSV must suppress download helper");
    const staticDateNegativeScopePlan = buildHelperExecutionPlan({ runDir, currentCase: staticDateNegativeScopeCase, helperHints: staticDateNegativeScopeHints });
    assert.deepEqual(
      staticDateNegativeScopePlan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createReport", "collage.configureMetric", "collage.runPreviewAndCollectEvidence"],
      "B-09 negative scope should preview only; no save/reopen/download helper actions"
    );

    const manualAiCase = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-B-03",
      caseTitle: "全動態 — 昨日 / 今日 快捷",
      cleanupChecklist: "欄位=新增帳號數;篩選=0組;分組=不影響;時間=昨日(快捷);顯示=每天",
      stepsSummary: "1. 用 UI 切換昨日與今日快捷\n2. 各按執行並比較 request/chart"
    };
    const manualAiGate = evaluateCapabilityGate(manualAiCase, manualAiDateHints);
    assert.equal(manualAiGate.supportStatus, "degraded", "manual_ai should not be advertised as fully helper-supported");
    assert.equal(manualAiGate.helperPreRunAllowed, true, "manual_ai collage cases may run safe navigation prelude");
    assert.equal(manualAiGate.executionMode, "codex_visible_ui", "manual_ai should leave execution to Codex visible UI");
    const manualAiPlan = buildHelperExecutionPlan({ runDir, currentCase: manualAiCase, helperHints: manualAiDateHints });
    assert.deepEqual(
      manualAiPlan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createReport", "collage.runDateVariantsPreviewEvidence"],
      "manual_ai preset date cases may build safe navigation plus dedicated date-variants evidence helper"
    );
    assert.ok(!manualAiPlan.actions.some((item) => item.template === "collage.configureMetric"), "manual_ai date helper must not use generic configureMetric");
    assert.ok(!manualAiPlan.actions.some((item) => item.template === "collage.runPreviewAndCollectEvidence"), "manual_ai date helper must not use the single-preview template");
    assert.ok(
      manualAiPlan.availableTemplates.some((item) => item.template === "collage.captureDateUiEvidence"),
      "manual_ai date cases should still expose a read-only date UI evidence capture helper"
    );

    const helperDateVariantsGate = evaluateCapabilityGate(manualAiCase, helperDateVariantsHints);
    assert.equal(helperDateVariantsGate.supportStatus, "degraded", "multi-variant date cases should be routed to Codex visible UI even if authored as helper");
    assert.equal(helperDateVariantsGate.helperPreRunAllowed, true, "multi-variant date cases may run safe navigation prelude");
    assert.equal(helperDateVariantsGate.executionMode, "codex_visible_ui", "multi-variant date cases require visible UI execution");
    const helperDateVariantsPlan = buildHelperExecutionPlan({ runDir, currentCase: manualAiCase, helperHints: helperDateVariantsHints });
    assert.deepEqual(
      helperDateVariantsPlan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createReport", "collage.runDateVariantsPreviewEvidence"],
      "multi-variant date helper hints should use the dedicated per-variant preview evidence helper"
    );
    assert.ok(!helperDateVariantsPlan.actions.some((item) => item.template === "collage.configureMetric"), "multi-variant date helper must not build single configureMetric actions");
    assert.ok(
      helperDateVariantsPlan.availableTemplates.some((item) => item.template === "collage.captureDateUiEvidence"),
      "multi-variant date cases should expose optional date UI evidence capture"
    );

    const boundaryB10Case = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-B-10",
      caseTitle: "90 天上限邊界 — 一題兩階段(2026-01-01~03-31 PASS / 2026-01-01~04-01 UI 阻擋)",
      preconditions: "起始頁面: 拼貼模式新增報表設定頁\n導航路徑: 我的自訂 > 拼貼模式 > 任一專案 > +新增報表\n建構模式: 拼貼",
      cleanupChecklist: "欄位=新增帳號數;篩選=0組;分組=不影響;時間=Step1 2026-01-01~03-31(90天) / Step2 2026-01-01~04-01(91天);顯示=每天",
      stepsSummary: "進入設定頁，加欄位「新增帳號數」。Step 1 設 90 天應 PASS；Step 2 設 91 天應被 UI 阻擋，若 UI 沒擋再驗後端錯誤。"
    };
    const boundaryB10Hints: HelperHints = {
      ...manualAiDateHints,
      caseId: "OTTEST004-B-10",
      params: {
        mode: "拼貼",
        field: "新增帳號數",
        sourceReport: "每日報表",
        stages: [
          { step: 1, label: "90 天 PASS", start: "2026-01-01", end: "2026-03-31", expectedRowCount: 90, expectUiBlock: false },
          { step: 2, label: "91 天 UI 阻擋", start: "2026-01-01", end: "2026-04-01", expectUiBlock: true }
        ],
        doNotSave: true,
        doNotReopen: true,
        doNotDownloadCsv: true
      }
    };
    const boundaryB10Plan = buildHelperExecutionPlan({ runDir, currentCase: boundaryB10Case, helperHints: boundaryB10Hints });
    assert.deepEqual(
      boundaryB10Plan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createReport", "collage.runDateVariantsPreviewEvidence"],
      "B-10 90/91 boundary should use structured staged date preview evidence instead of stopping at navigation"
    );
    assert.deepEqual(
      boundaryB10Plan.actions.find((item) => item.template === "collage.runDateVariantsPreviewEvidence")?.params.stages,
      (boundaryB10Hints.params as Record<string, unknown>).stages,
      "B-10 staged 90/91 date params must be preserved for helper executor"
    );

    const mixedVariantB11Case = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-B-11",
      caseTitle: "筆數一致性 — 不同區間連續切換不殘留(寫死兩段)",
      preconditions: "起始頁面: 拼貼模式新增報表設定頁\n導航路徑: 我的自訂 > 拼貼模式 > 任一專案 > +新增報表\n建構模式: 拼貼",
      cleanupChecklist: "欄位=新增帳號數;篩選=0組;分組=不影響;時間=Step1 2026-03-01~03-31 / Step2 過去 7 天;顯示=每天",
      stepsSummary: "進入設定頁，加欄位「新增帳號數」。Step 1 全靜態 2026-03-01~03-31，Step 2 點 preset「過去 7 天」。"
    };
    const mixedVariantB11Hints: HelperHints = {
      ...helperDateVariantsHints,
      caseId: "OTTEST004-B-11",
      params: {
        mode: "拼貼",
        field: "新增帳號數",
        sourceReport: "每日報表",
        display: "每天",
        dateVariants: [
          { type: "static", start: "2026-03-01", end: "2026-03-31", expectedRowCount: 31, expectedDateRange: "2026-03-01~2026-03-31" },
          { type: "preset", label: "過去 7 天", expectedRowCount: 7, expectedDateRange: "d-7~d-1" }
        ],
        doNotSave: true,
        doNotReopen: true,
        doNotDownloadCsv: true
      }
    };
    const mixedVariantB11Plan = buildHelperExecutionPlan({ runDir, currentCase: mixedVariantB11Case, helperHints: mixedVariantB11Hints });
    assert.deepEqual(
      mixedVariantB11Plan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createReport", "collage.runDateVariantsPreviewEvidence"],
      "B-11 static+preset object dateVariants should use date-variants preview helper"
    );
    assert.deepEqual(
      mixedVariantB11Plan.actions.find((item) => item.template === "collage.runDateVariantsPreviewEvidence")?.params.dateVariants,
      (mixedVariantB11Hints.params as Record<string, unknown>).dateVariants,
      "B-11 object dateVariants must be preserved for helper executor"
    );

    const editorSessionCsvCase = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-F-03",
      caseTitle: "下載 CSV — 與 preview 一致(同 editor session,絕不 save / reopen / 回專案頁)",
      cleanupChecklist: "欄位=新增帳號數;篩選=0組;分組=不影響;時間=2026/03/01~2026/03/31;顯示=每天",
      stepsSummary: "1. 進入設定頁\n2. 設定欄位與 2026/03/01~2026/03/31\n3. 按執行取得 preview\n4. 在同 editor session 下載 CSV，比對 preview；絕不 save / reopen / 回專案頁"
    };
    const editorSessionCsvHints: HelperHints = {
      ...manualAiDateHints,
      caseId: "OTTEST004-F-03",
      params: {
        mode: "拼貼",
        field: "新增帳號數",
        sourceReport: "每日報表",
        dateRange: { start: "2026-03-01", end: "2026-03-31" },
        display: "每天",
        scope: "preview_only",
        doNotSave: true,
        doNotReopen: true
      }
    };
    const editorSessionCsvPlan = buildHelperExecutionPlan({ runDir, currentCase: editorSessionCsvCase, helperHints: editorSessionCsvHints });
    assert.deepEqual(
      editorSessionCsvPlan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createReport", "collage.runDateVariantsPreviewEvidence", "collage.downloadCsvAndComparePreview"],
      "F-03 static editor-session CSV case should chain preview evidence directly into CSV download/compare"
    );
    assert.equal(
      editorSessionCsvPlan.actions.find((item) => item.template === "collage.downloadCsvAndComparePreview")?.params.downloadScope,
      "editor_session",
      "F-03 CSV helper should stay in editor session"
    );
    assert.ok(!editorSessionCsvPlan.actions.some((item) => item.template === "collage.saveReport"), "F-03 editor-session CSV must not save");
    assert.ok(!editorSessionCsvPlan.actions.some((item) => item.template === "collage.reopenReport"), "F-03 editor-session CSV must not reopen");
    assert.ok(!editorSessionCsvPlan.actions.some((item) => item.template === "collage.openExistingReport"), "F-03 editor-session CSV must not open an existing report");

    const rowCsvCase = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-F-04",
      caseTitle: "下載 CSV — 專案頁 project-row 下載與 preview 一致(同 case 建立)",
      cleanupChecklist: "欄位=MAU(帳號);篩選=0組;分組=不影響;時間=2026/03/01~2026/03/31;顯示=每天",
      stepsSummary: "同 case 新增報表 OTTEST004_F04_<timestamp>，設定欄位與日期，按執行取得 preview，save 後回專案頁 project-row CSV 下載並比對；不走 open existing report，不 reopen editor。"
    };
    const rowCsvHints: HelperHints = {
      ...manualAiDateHints,
      caseId: "OTTEST004-F-04",
      automationLevel: "helper",
      operationTemplate: "download_csv_verify",
      params: {
        mode: "拼貼",
        field: "MAU(帳號)",
        sourceReport: "每日報表",
        dateRange: { start: "2026-03-01", end: "2026-03-31" },
        display: "每天",
        save: true,
        saveReportNamePrefix: "OTTEST004_F04_",
        useTimestamp: true,
        downloadCsv: true,
        downloadEntry: "project_page_row_download_button",
        doNotUseEditorGlobalDownload: true,
        skipReopen: true
      }
    };
    const rowCsvPlan = buildHelperExecutionPlan({ runDir, currentCase: rowCsvCase, helperHints: rowCsvHints });
    assert.deepEqual(
      rowCsvPlan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createReport", "collage.runDateVariantsPreviewEvidence", "collage.saveReport", "collage.downloadCsvAndComparePreview"],
      "F-04 same-case project-row CSV should create, preview, save, then row-download without open-existing/reopen"
    );
    assert.equal(
      rowCsvPlan.actions.find((item) => item.template === "collage.downloadCsvAndComparePreview")?.params.downloadScope,
      "report_list",
      "F-04 CSV helper should target the saved report row"
    );
    assert.equal(
      rowCsvPlan.actions.find((item) => item.template === "collage.saveReport")?.params.reportNamePattern,
      "OTTEST004_F04_<timestamp>",
      "F-04 saveReportNamePrefix should become the saved row reportNamePattern"
    );
    assert.ok(!rowCsvPlan.actions.some((item) => item.template === "collage.openExistingReport"), "F-04 must not open an existing report");
    assert.ok(!rowCsvPlan.actions.some((item) => item.template === "collage.reopenReport"), "F-04 must not reopen the editor");

    const rowCsvF05Plan = buildHelperExecutionPlan({
      runDir,
      currentCase: {
        ...rowCsvCase,
        caseNo: "OTTEST004-F-05",
        caseTitle: "下載 CSV — project-row 下載可讀且 row count 與 preview 一致",
        stepsSummary: "同 case 建立新報表 OTTEST004_F05_<timestamp> → preview → 儲存 → 專案頁報表 row 下載 CSV；不是點報表名稱進入既有報表，也不 reopen editor。"
      },
      helperHints: {
        ...rowCsvHints,
        caseId: "OTTEST004-F-05",
        params: {
          ...(rowCsvHints.params as Record<string, unknown>),
          saveReportNamePrefix: "OTTEST004_F05_",
          reportNamePattern: "OTTEST004_F05_<timestamp>"
        }
      }
    });
    assert.deepEqual(
      rowCsvF05Plan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createReport", "collage.runDateVariantsPreviewEvidence", "collage.saveReport", "collage.downloadCsvAndComparePreview"],
      "F-05 same-case project-row CSV should not be misrouted to open existing report"
    );
    assert.equal(rowCsvF05Plan.actions.find((item) => item.template === "collage.downloadCsvAndComparePreview")?.params.downloadScope, "report_list");
    assert.ok(!rowCsvF05Plan.actions.some((item) => item.template === "collage.openExistingReport"), "F-05 must not open an existing report");
    assert.ok(!rowCsvF05Plan.actions.some((item) => item.template === "collage.reopenReport"), "F-05 must not reopen the editor");

    const staticD0CsvCase = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-F-06",
      caseTitle: "隔日下載 — 全靜態 D0 baseline(project-row CSV,D+1 另輪)",
      cleanupChecklist: "欄位=新增帳號數;篩選=0組;分組=不影響;時間=2026/03/01~2026/03/31;顯示=每天",
      stepsSummary: "D0 baseline: create unique report OTTEST004_F06_<timestamp>，設定全靜態日期，preview，save，回 project-row CSV 下載 baseline；D+1 comparison deferred。"
    };
    const staticD0CsvHints: HelperHints = {
      ...manualAiDateHints,
      caseId: "OTTEST004-F-06",
      automationLevel: "manual_ai",
      operationTemplate: "manual_ai",
      params: {
        mode: "拼貼",
        field: "新增帳號數",
        sourceReport: "每日報表",
        dateMode: "static",
        start: { type: "static", date: "2026-03-01" },
        end: { type: "static", date: "2026-03-31" },
        display: "每天",
        save: true,
        saveReportNamePrefix: "OTTEST004_F06_",
        useTimestamp: true,
        downloadCsv: true,
        downloadEntry: "project_page_row_download_button",
        doNotUseEditorGlobalDownload: true,
        d1ComparisonDeferred: true
      }
    };
    const staticD0CsvPlan = buildHelperExecutionPlan({ runDir, currentCase: staticD0CsvCase, helperHints: staticD0CsvHints });
    assert.deepEqual(
      staticD0CsvPlan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createReport", "collage.runDateVariantsPreviewEvidence", "collage.saveReport", "collage.downloadCsvAndComparePreview"],
      "F-06 D0 baseline should create unique report, preview, save, then project-row CSV without D+1 comparison"
    );
    assert.equal(staticD0CsvPlan.actions.find((item) => item.template === "collage.downloadCsvAndComparePreview")?.params.downloadScope, "report_list");
    assert.equal(staticD0CsvPlan.actions.find((item) => item.template === "collage.saveReport")?.params.reportNamePattern, "OTTEST004_F06_<timestamp>");

    const hybridD0CsvCase = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-F-07",
      caseTitle: "隔日下載 — 半動態(D0 baseline,D+1 另輪驗證)",
      cleanupChecklist: "欄位=新增帳號數;篩選=0組;分組=不影響;時間=2026-03-25 ~ 1 天前;顯示=每天",
      stepsSummary: "D0: 設半動態 2026-03-25 ~ 1 天前，執行 preview，儲存，從專案頁清單下載 CSV baseline"
    };
    const hybridD0CsvHints: HelperHints = {
      ...manualAiDateHints,
      caseId: "OTTEST004-F-07",
      automationLevel: "manual_ai",
      operationTemplate: "manual_ai",
      params: {
        mode: "拼貼",
        field: "新增帳號數",
        sourceReport: "每日報表",
        dateMode: "hybrid",
        start: { type: "static", date: "2026-03-25" },
        end: { type: "relative", offsetDays: -1 },
        display: "每天",
        save: true,
        reportNamePattern: "OTTEST004_F07_<timestamp>",
        downloadCsv: true
      }
    };
    const hybridD0CsvPlan = buildHelperExecutionPlan({ runDir, currentCase: hybridD0CsvCase, helperHints: hybridD0CsvHints });
    assert.deepEqual(
      hybridD0CsvPlan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createReport", "collage.runDateVariantsPreviewEvidence", "collage.saveReport", "collage.downloadCsvAndComparePreview"],
      "F-07 manual hybrid D0 CSV baseline should use date preview evidence, then save and row-download without generic date text clicking"
    );
    assert.equal(
      hybridD0CsvPlan.actions.find((item) => item.template === "collage.downloadCsvAndComparePreview")?.params.downloadScope,
      "report_list",
      "F-07 row download should target report-list scope after save"
    );

    const relativeD0CsvCase = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-F-08",
      caseTitle: "隔日下載 — 全動態 D0 baseline(project-row CSV,D+1 另輪)",
      cleanupChecklist: "欄位=新增帳號數;篩選=0組;分組=不影響;時間=30 天前 ~ 1 天前;顯示=每天",
      stepsSummary: "D0 baseline: create unique report OTTEST004_F08_<timestamp>，設定全動態 30 天前 ~ 1 天前，preview，save，回 project-row CSV 下載 baseline；D+1 comparison deferred。"
    };
    const relativeD0CsvHints: HelperHints = {
      ...manualAiDateHints,
      caseId: "OTTEST004-F-08",
      automationLevel: "manual_ai",
      operationTemplate: "manual_ai",
      params: {
        mode: "拼貼",
        field: "新增帳號數",
        sourceReport: "每日報表",
        dateMode: "relative",
        startOffsetDays: -30,
        endOffsetDays: -1,
        display: "每天",
        save: true,
        saveReportNamePrefix: "OTTEST004_F08_",
        useTimestamp: true,
        downloadCsv: true,
        downloadEntry: "project_page_row_download_button",
        doNotUseEditorGlobalDownload: true,
        d1ComparisonDeferred: true
      }
    };
    const relativeD0CsvPlan = buildHelperExecutionPlan({ runDir, currentCase: relativeD0CsvCase, helperHints: relativeD0CsvHints });
    assert.deepEqual(
      relativeD0CsvPlan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createReport", "collage.runDateVariantsPreviewEvidence", "collage.saveReport", "collage.downloadCsvAndComparePreview"],
      "F-08 D0 baseline should create unique report, preview, save, then project-row CSV without D+1 comparison"
    );
    assert.equal(relativeD0CsvPlan.actions.find((item) => item.template === "collage.downloadCsvAndComparePreview")?.params.downloadScope, "report_list");
    assert.equal(relativeD0CsvPlan.actions.find((item) => item.template === "collage.saveReport")?.params.reportNamePattern, "OTTEST004_F08_<timestamp>");

    const deleteReportCase = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-G-03",
      caseTitle: "刪除報表(不可逆,需臨時報表 + Tool Bridge + 確認機制)",
      riskLevel: "🔴 刪除",
      cleanupChecklist: "欄位=不影響;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
      stepsSummary: "建立本輪臨時報表 OTTEST004_G03_temp_<timestamp>，Tool Bridge 授權後刪除該臨時報表並驗證 row 消失"
    };
    const deleteReportHints: HelperHints = {
      ...manualAiDateHints,
      caseId: "OTTEST004-G-03",
      automationLevel: "manual_ai",
      operationTemplate: "manual_ai",
      params: {
        mode: "拼貼",
        projectName: "拼貼test_001"
      }
    };
    const deleteReportGate = evaluateCapabilityGate(deleteReportCase, deleteReportHints);
    assert.equal(deleteReportGate.supportStatus, "supported", `G-03 delete temporary report should be helper-supported; report=${JSON.stringify(deleteReportGate)}`);
    assert.ok(deleteReportGate.supportedHelperTemplates.includes("collage.createAndDeleteTemporaryReport"), "G-03 should advertise the create/delete temporary report helper");
    const deleteReportPlan = buildHelperExecutionPlan({ runDir, currentCase: deleteReportCase, helperHints: deleteReportHints });
    assert.deepEqual(
      deleteReportPlan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createAndDeleteTemporaryReport"],
      "G-03 should create a pending helper action instead of leaving deletion to Codex-only Tool Bridge"
    );
    assert.equal(deleteReportPlan.actions[1]?.requiresToolBridge, true, "G-03 delete helper action must require Tool Bridge");

    const manualProjectNavigationCase = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-A-02",
      caseTitle: "從左側選單進入拼貼模式專案頁",
      preconditions: "起始頁面: 報表管理頁; 導航路徑: 我的自訂 > 拼貼模式",
      stepsSummary: "1. 展開「我的自訂」與「拼貼模式」\n2. 點任一既有專案\n3. 驗證 + 新增報表可見"
    };
    const manualProjectPlan = buildHelperExecutionPlan({ runDir, currentCase: manualProjectNavigationCase, helperHints: { ...manualAiDateHints, caseId: "OTTEST004-A-02", params: { mode: "拼貼" } } });
    assert.deepEqual(
      manualProjectPlan.actions.map((item) => item.template),
      ["collage.openProject"],
      "project-page navigation case should stop at openProject and not enter report editor"
    );

    const projectLimitObservationCase = {
      ...collageSaveReopenCase,
      caseNo: "BIUI_COLLAGE_R001-J-12",
      groupId: "J",
      groupName: "J:專案頁按鈕與列表狀態",
      caseTitle: "專案 5 個上限阻擋與提示",
      testType: "前端呈現",
      riskLevel: "🟢 觀察",
      testTarget: "前端呈現",
      cleanupChecklist: "欄位=不影響;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
      preconditions: "起始頁面: BI 工具首頁\n建構模式: 拼貼模式\n前置資源: 執行前確認拼貼專案數可達 4 或 5 個",
      stepsSummary: "1. 進入首頁,展開拼貼報表\n2. 若 N < 5,依新增專案流程建立臨時專案直到 N = 5\n3. 達 5 個後再次嘗試開啟新增專案入口\n4. 讀取阻擋/提示語意",
      expected: "達 5 個時新增入口或儲存被阻擋，顯示專案數量已達上限提示",
      validationMethod: "DOM read button state + error message; evidence: dom.state, screenshot"
    };
    const projectLimitGate = evaluateCapabilityGate(projectLimitObservationCase, null);
    assert.equal(projectLimitGate.supportStatus, "degraded", "J-12 no-hints frontend observation should not be advertised as fully helper-supported");
    assert.deepEqual(
      projectLimitGate.supportedHelperTemplates,
      ["collage.openProject"],
      "J-12 no-hints frontend observation should only advertise openProject prelude"
    );
    const projectLimitPlan = buildHelperExecutionPlan({ runDir, currentCase: projectLimitObservationCase, helperHints: null });
    assert.deepEqual(
      projectLimitPlan.actions.map((item) => item.template),
      ["collage.openProject"],
      "J-12 no-hints frontend observation must not fall through to createReport/configureMetric/runPreview"
    );

    const selectAllCase = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-D-02",
      caseTitle: "所有欄位一次選取(72 欄)+ CSV 完整輸出驗證",
      cleanupChecklist: "欄位=4 來源報表全選 72 欄;篩選=0組;分組=不影響;時間=2026/03/01~2026/03/31;顯示=每天",
      stepsSummary: "1. 進入設定頁,逐一加入 4 個來源報表的所有欄位(共 72)\n2. 設定時間並下載 CSV"
    };
    const selectAllPlan = buildHelperExecutionPlan({ runDir, currentCase: selectAllCase, helperHints: selectAllFieldsHints });
    const selectAllConfigure = selectAllPlan.actions.find((item) => item.template === "collage.configureMetric");
    assert.equal(selectAllConfigure?.params.selectAllFields, true, "selectAllFields helper param must be preserved");
    assert.deepEqual(selectAllConfigure?.params.fields, [], "synthetic cleanup text must not become a clickable field");
    assert.deepEqual(selectAllConfigure?.params.sourceReports, selectAllFieldsHints.params.sourceReports, "sourceReports must be forwarded to configureMetric");
    assert.equal(selectAllConfigure?.params.expectedFieldCount, 72);
    assert.equal(selectAllConfigure?.params.dateRange, "2026/03/01~2026/03/31", "dateRange object should become a concrete static range");
    assert.ok(selectAllPlan.actions.some((item) => item.template === "collage.downloadCsvAndComparePreview"), "select-all CSV case should still download CSV");
    assert.ok(!selectAllPlan.actions.some((item) => item.template === "collage.saveReport"), "select-all preview case should not save when skipSave is set");

    const actualD02Plan = buildHelperExecutionPlan({ runDir, currentCase: selectAllCase, helperHints: actualD02StructuredHints });
    assert.deepEqual(
      actualD02Plan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createReport", "collage.runDateVariantsPreviewEvidence", "collage.downloadCsvAndComparePreview"],
      "actual v1.8.9 D-02 manual_ai structured params should still run the select-all date preview and CSV helper path"
    );
    const actualD02DateAction = actualD02Plan.actions.find((item) => item.template === "collage.runDateVariantsPreviewEvidence");
    assert.equal(actualD02DateAction?.params.selectAllFields, true, "actual D-02 should infer selectAllFields from expectedSources/72欄 text");
    assert.deepEqual(actualD02DateAction?.params.sourceReports, (actualD02StructuredHints.params as Record<string, unknown>).expectedSources, "actual D-02 expectedSources must become sourceReports");
    assert.equal(actualD02DateAction?.params.expectedFieldCount, 72, "actual D-02 expectedTotalFieldCount must become expectedFieldCount for selected-field guard");
    assert.deepEqual(actualD02DateAction?.params.fields, [], "actual D-02 synthetic cleanup text must not become a clickable field");

    const allZeroCase = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-A-06",
      caseTitle: "全為 0 欄位的合理性釐清(僅列清單,不判 PASS/FAIL)",
      testType: "資料確認(全 0 欄位清單)",
      riskLevel: "🟢 觀察",
      testTarget: "後端功能",
      cleanupChecklist: "欄位=新增帳號數;篩選=0組;分組=不影響;時間=2026/03/01~2026/03/31;顯示=每天",
      preconditions: "建構模式: 拼貼\n來源報表: 每日報表\n參考資料: rules/BI_DATA/metadata.csv",
      stepsSummary: "1. 進入設定頁,選來源報表「每日報表」,加入該來源報表所有可選欄位\n2. 設定時間 = 2026/03/01~2026/03/31\n3. 顯示方式選每天,按執行\n4. 從 preview 表格 / Chart.js datasets 抽每欄位的值,標出整段區間值全為 0 的欄位",
      expected: "列出全 0 欄位清單；本題不判斷全 0 根因"
    };
    const allZeroGate = evaluateCapabilityGate(allZeroCase, allZeroFieldInspectionHints);
    assert.equal(allZeroGate.supportStatus, "supported", `A-06 all-zero inspection should be helper supported; report=${JSON.stringify(allZeroGate)}`);
    assert.ok(allZeroGate.supportedHelperTemplates.includes("collage.inspectAllZeroFields"), "A-06 should advertise the dedicated all-zero inspection helper");
    const allZeroPlan = buildHelperExecutionPlan({ runDir, currentCase: allZeroCase, helperHints: allZeroFieldInspectionHints });
    assert.deepEqual(
      allZeroPlan.actions.map((item) => item.template),
      ["collage.openProject", "collage.createReport", "collage.inspectAllZeroFields"],
      "A-06 all-zero inspection should use the dedicated helper flow instead of generic preview/save actions"
    );
    const allZeroAction = allZeroPlan.actions.find((item) => item.template === "collage.inspectAllZeroFields");
    assert.equal(allZeroAction?.params.selectAllFields, true, "all-zero helper should force select-all semantics");
    assert.deepEqual(allZeroAction?.params.sourceReports, ["每日報表"], "all-zero helper should derive sourceReports from sourceReport when needed");
    assert.equal(allZeroAction?.params.expectedFieldCount, 32);
    assert.equal(allZeroAction?.params.dateRange, "2026/03/01~2026/03/31");
    assert.ok(!allZeroPlan.actions.some((item) => item.template === "collage.runPreviewAndCollectEvidence"), "all-zero helper should not rely on generic runPreview evidence");
    assert.ok(!allZeroPlan.actions.some((item) => item.template === "collage.saveReport"), "all-zero helper should not save reports");

    const metadataCsvPath = path.join(runDir, "metadata-fixture.csv");
    fs.writeFileSync(
      metadataCsvPath,
      [
        "欄位名稱,來源報表,所屬報表是否可用於拼貼模式主選擇",
        "S1-F1,S1,Y",
        "S1-F2,S1,Y",
        "S2-F1,S2,Y",
        "S3-hidden,S3,N"
      ].join("\n")
    );
    const sourceScopedExpected = readExpectedMetadataFieldsForTest({
      runDir,
      caseId: "OTTEST004-A-04",
      action: "collage.extractMetadataDropdownFields",
      approvedToolRequestId: null,
      closeAfter: false,
      params: {
        referenceCsv: metadataCsvPath,
        sourceReport: "S1",
        comparisonScope: "source_report_fields",
        expectedReportSources: ["S1"],
        expectedFieldCount: 2,
        matchKey: "欄位名稱"
      }
    });
    assert.equal(sourceScopedExpected.allSourcesFieldMode, false, "source_report_fields must not become all-sources merely because expectedFieldCount is present");
    assert.deepEqual(sourceScopedExpected.expectedReportSources, ["S1"], "source-scoped metadata evidence should keep the requested source only");
    assert.deepEqual(sourceScopedExpected.expectedFields, ["S1-F1", "S1-F2"], "source-scoped metadata evidence should include only S1 fields");

    const allSourcesExpected = readExpectedMetadataFieldsForTest({
      runDir,
      caseId: "OTTEST004-B-02",
      action: "collage.extractMetadataDropdownFields",
      approvedToolRequestId: null,
      closeAfter: false,
      params: {
        referenceCsv: metadataCsvPath,
        sourceReport: "/",
        comparisonScope: "all_sources_fields",
        expectedReportSources: ["S1", "S2"],
        expectedTotalFieldCount: 3,
        matchKey: "來源報表+欄位名稱"
      }
    });
    assert.equal(allSourcesExpected.allSourcesFieldMode, true, "all_sources_fields must keep all-source mode");
    assert.deepEqual(allSourcesExpected.expectedFields, ["S1-F1", "S1-F2", "S2-F1"], "all-source metadata evidence should include all requested source fields");
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }

  const blocked = evaluateCapabilityGate(filterCase, null);
  assert.equal(blocked.supportStatus, "unsupported", "active filter cases should remain blocked until filter helper coverage exists");
  assert.ok(blocked.unsupportedFeatures.includes("filter_helper_not_implemented"));

  console.log(
    JSON.stringify(
      {
        ok: true,
        fixture: "capability-gate",
        checked: [
          "neutral cleanup targets do not trigger unsupported filter/group gate",
          "metadata references alone do not trigger metadata-dropdown gate",
          "collage multi-field preview is not misclassified as metric mode",
          "collage multi-field helper params split composite metric strings",
          "collage CSV case includes download/compare helper action",
          "collage existing-report modification opens existing report and overwrites",
          "save-load flow creates and saves a fresh report before reopen",
          "actual F-02 same-case save/reopen does not open an existing report and preserves generated report name prefix",
          "save-only flow creates, configures, previews, and saves a fresh report without open-existing/reopen",
          "formula helper cases are not misclassified as filter cases and use calculated metric helper plans",
          "createNewProject report flows create a project before report creation",
          "G-01 dotted createProject helper stays on project creation path",
          "simple project-page report-name/back flows use dedicated helpers",
          "preview-only helper hints suppress save/reopen and neutral dateRange",
          "negative scope text suppresses save/reopen/download and does not misclassify B-09 as download execution",
          "collage metadata compare is not misclassified as record/detail mode",
          "collage metadata compare is helper-assisted by dedicated dropdown extraction",
          "metadata source-scope helper params are forwarded to dropdown extraction",
          "list-page CSV case does not reopen editor and targets saved report row download",
          "manual_ai preset date cases collect dedicated per-variant helper evidence without using configureMetric",
          "manual_ai date cases expose optional read-only date UI evidence capture",
          "multi-variant date helper hints are degraded to Codex visible UI",
          "multi-variant date cases expose optional date UI evidence capture",
          "B-10 staged 90/91 boundary uses date-variants preview evidence with structured stages",
          "B-11 static plus preset object variants are preserved for date helper execution",
          "editor-session CSV cases chain date preview evidence into CSV download without save/reopen",
          "same-case project-row CSV cases create, preview, save, and row-download without open-existing/reopen",
          "static D0 CSV baseline cases create unique reports and defer D+1 comparison",
          "manual hybrid D0 CSV baseline cases chain date preview, save, and report-list download",
          "relative D0 CSV baseline cases create unique reports and defer D+1 comparison",
          "delete temporary report cases create a pending Tool Bridge helper action",
          "no-hints frontend project/list observations run only a safe openProject prelude",
          "selectAllFields helper hints preserve sourceReports/expected count and avoid synthetic field text",
          "actual D-02 expectedSources/expectedTotalFieldCount infer select-all 4-source/72-field helper params",
          "A-06 all-zero field inspection uses a dedicated select-all preview evidence helper",
          "metadata expected-field reader keeps source-specific scope separate from all-source scope",
          "active filter cases remain blocked until helper support exists"
        ]
      },
      null,
      2
    )
  );
};

main();
