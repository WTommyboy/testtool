import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

    const existingPlan = buildHelperExecutionPlan({ runDir, currentCase: collageExistingReportCase, helperHints: null });
    assert.ok(existingPlan.actions.some((item) => item.template === "collage.openExistingReport"), "A-05 should open an existing report instead of creating a new report");
    assert.ok(!existingPlan.actions.some((item) => item.template === "collage.createReport"), "A-05 should not create a new report");
    assert.equal(existingPlan.actions.find((item) => item.template === "collage.saveReport")?.params.overwriteExisting, true, "A-05 save should be overwriteExisting");

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

    const manualAiCase = {
      ...collageSaveReopenCase,
      caseNo: "OTTEST004-B-03",
      caseTitle: "全動態 — 昨日 / 今日 快捷",
      cleanupChecklist: "欄位=新增帳號數;篩選=0組;分組=不影響;時間=昨日(快捷);顯示=每天",
      stepsSummary: "1. 用 UI 切換昨日與今日快捷\n2. 各按執行並比較 request/chart"
    };
    const manualAiGate = evaluateCapabilityGate(manualAiCase, manualAiDateHints);
    assert.equal(manualAiGate.supportStatus, "degraded", "manual_ai should not be advertised as fully helper-supported");
    assert.equal(manualAiGate.helperPreRunAllowed, false, "manual_ai must disable helper pre-run");
    assert.equal(manualAiGate.executionMode, "codex_visible_ui", "manual_ai should leave execution to Codex visible UI");
    const manualAiPlan = buildHelperExecutionPlan({ runDir, currentCase: manualAiCase, helperHints: manualAiDateHints });
    assert.equal(manualAiPlan.actions.length, 0, "manual_ai cases must not build helper actions that can false-block before Codex UI work");

    const helperDateVariantsGate = evaluateCapabilityGate(manualAiCase, helperDateVariantsHints);
    assert.equal(helperDateVariantsGate.supportStatus, "degraded", "multi-variant date cases should be routed to Codex visible UI even if authored as helper");
    assert.equal(helperDateVariantsGate.helperPreRunAllowed, false, "multi-variant date cases must disable helper pre-run");
    assert.equal(helperDateVariantsGate.executionMode, "codex_visible_ui", "multi-variant date cases require visible UI execution");
    const helperDateVariantsPlan = buildHelperExecutionPlan({ runDir, currentCase: manualAiCase, helperHints: helperDateVariantsHints });
    assert.equal(helperDateVariantsPlan.actions.length, 0, "multi-variant date helper hints must not build single configureMetric actions");

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
          "preview-only helper hints suppress save/reopen and neutral dateRange",
          "collage metadata compare is not misclassified as record/detail mode",
          "collage metadata compare is helper-assisted by dedicated dropdown extraction",
          "list-page CSV case does not reopen editor and targets saved report row download",
          "manual_ai cases disable helper pre-run and build no helper actions",
          "multi-variant date helper hints are degraded to Codex visible UI",
          "selectAllFields helper hints preserve sourceReports/expected count and avoid synthetic field text",
          "active filter cases remain blocked until helper support exists"
        ]
      },
      null,
      2
    )
  );
};

main();
