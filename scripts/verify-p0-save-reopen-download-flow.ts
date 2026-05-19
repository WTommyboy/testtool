import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateCapabilityGate } from "../agent/src/capability-gate";
import { buildHelperExecutionPlan } from "../agent/src/helper-execution-plan";
import type { CaseManifestCase } from "../agent/src/case-manifest";
import type { HelperHints } from "../agent/src/helper-hints";
import { __openProjectRetryTestHooks } from "../agent/src/bi-ui-helper-executor";

const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "uat-p0-save-reopen-download-flow-"));

const baseCase = (overrides: Partial<CaseManifestCase>): CaseManifestCase => ({
  order: 1,
  rowNumber: 2,
  groupId: "P0",
  groupName: "P0.25",
  caseNo: "BIUI_COLLAGE_R001-F-02",
  caseTitle: null,
  testType: "功能流程",
  executionMethod: "Codex + Playwright",
  riskLevel: "🟡 建立",
  testTarget: "功能流程",
  cleanupChecklist: "欄位=新增帳號數;篩選=0組;分組=不影響;時間=2026/03/01~2026/03/31;顯示=每天",
  preconditions: "使用本 case 建立的臨時報表，不依賴既有報表。",
  stepsSummary: "",
  expected: "",
  resultStatus: null,
  testDate: null,
  detailJson: null,
  validationMethod: null,
  currentCaseFile: "fixture/current-case.json",
  ...overrides
});

const hints = (overrides: Partial<HelperHints>): HelperHints => ({
  caseId: "BIUI_COLLAGE_R001-F-02",
  automationLevel: "helper",
  operationTemplate: "save_load_flow",
  params: {},
  requiredEvidence: [],
  forbiddenAutomation: [],
  aiDecisionRequired: false,
  raw: {},
  sourcePath: "fixture.md",
  sourceRelativePath: "fixture.md",
  warnings: [],
  ...overrides
});

const actionTemplates = (item: CaseManifestCase, helperHints: HelperHints): string[] =>
  buildHelperExecutionPlan({ runDir, currentCase: item, helperHints }).actions.map((action) => action.template);

const main = (): void => {
  const officialEditorUrl = "https://galaxy.games.gamania.com/bi-dev/zh-TW/report/new";
  const officialProjectUrl = "https://galaxy.games.gamania.com/bi-dev/zh-TW/report/myCustom/tileMode/61";
  const officialEditorText = [
    "數據統計中心",
    "我的自訂",
    "自訂報表",
    "拼貼模式 - BIUICOL05191125",
    "欄位選擇",
    "儲存報表",
    "計算"
  ].join("\n");
  assert.deepEqual(
    __openProjectRetryTestHooks.officialCollageSidebarPreludeLabels(officialEditorUrl, officialEditorText),
    ["我的自訂"],
    "official editor text containing 拼貼模式 must still reopen 我的自訂 before searching the sidebar target"
  );
  assert.equal(
    __openProjectRetryTestHooks.officialCollageSidebarTargetLabel(officialEditorUrl, officialEditorText),
    null,
    "official editor text must not treat editor radio/heading 拼貼模式 as the sidebar target"
  );

  const officialSidebarText = `${officialEditorText}\n拼貼報表\n報表明細\n指標趨勢`;
  assert.equal(
    __openProjectRetryTestHooks.officialCollageSidebarTargetLabel(officialEditorUrl, officialSidebarText),
    "拼貼報表",
    "official UI must prefer sidebar 拼貼報表 when it is visible"
  );

  const emptyProjectText = [
    "數據統計中心",
    "報表",
    "我的自訂",
    "拼貼報表",
    "新增自訂報表",
    "BIUICOL05191156",
    "無數據"
  ].join("\n");
  assert.equal(
    __openProjectRetryTestHooks.isOfficialCollageReportListReadyForUrl(officialProjectUrl, emptyProjectText),
    true,
    "official empty project page with 新增自訂報表/無數據 is still ready for createReport"
  );

  const f02 = baseCase({
    caseNo: "BIUI_COLLAGE_R001-F-02",
    caseTitle: "載入已儲存報表 — 設定還原(同 case 內建立後 reopen,不依賴既有報表)",
    stepsSummary: "同 case 建立 → 儲存 → 回專案頁 → 點報表名稱 reopen → 驗證設定還原。"
  });
  const f02Hints = hints({
    caseId: f02.caseNo,
    params: {
      mode: "拼貼",
      field: "新增帳號數",
      sourceReport: "每日報表",
      dateMode: "static",
      start: { type: "static", date: "2026-03-01" },
      end: { type: "static", date: "2026-03-31" },
      display: "每天",
      saveReportNamePrefix: "BIUIF02_",
      reopenViaClickReportName: true,
      verifyRestoredFields: ["selectedFields", "dateRange", "display"]
    }
  });
  assert.deepEqual(
    actionTemplates(f02, f02Hints),
    ["collage.openProject", "collage.createReport", "collage.configureMetric", "collage.runPreviewAndCollectEvidence", "collage.saveReport", "collage.reopenReport"],
    "F-02 same-case save/reopen must create, preview, save, then reopen the saved current-case report"
  );

  const f04 = baseCase({
    caseNo: "BIUI_COLLAGE_R001-F-04",
    caseTitle: "專案頁清單該 row 下載 CSV — 動態區間「過去 7 天」(同 case 建立 → 專案頁 row download)",
    preconditions: "建構模式: 拼貼; 來源報表=每日報表; 本題同 case 建立新報表。",
    stepsSummary: "同 case 新增報表 BIUIF04_<timestamp>，設定欄位與日期，按執行取得 preview，save 後回專案頁 project-row CSV 下載並比對；不走 open existing report，不 reopen editor。"
  });
  const f04Hints = hints({
    caseId: f04.caseNo,
    operationTemplate: "download_csv_verify",
    params: {
      mode: "拼貼",
      field: "新增帳號數",
      sourceReport: "每日報表",
      dateRange: { start: "2026-03-01", end: "2026-03-31" },
      display: "每天",
      save: true,
      saveReportNamePrefix: "BIUIF04_",
      downloadCsv: true,
      downloadScope: "report_list",
      skipReopen: true
    }
  });
  const f04Templates = actionTemplates(f04, f04Hints);
  assert.deepEqual(
    f04Templates,
    ["collage.openProject", "collage.createReport", "collage.runDateVariantsPreviewEvidence", "collage.saveReport", "collage.downloadCsvAndComparePreview"],
    "F-04 row CSV flow must save and use project-row download without reopen"
  );

  const g02 = baseCase({
    caseNo: "BIUI_COLLAGE_R001-G-02",
    caseTitle: "完整流程(同 case 內新增專案 → 新增報表 → 加欄位 → 執行 → 儲存)",
    stepsSummary: "新增本 case 拼貼專案後，在新專案內新增報表、加欄位、執行 preview 並儲存。"
  });
  const g02Hints = hints({
    caseId: g02.caseNo,
    operationTemplate: "collage_build_preview_save_reopen",
    params: {
      mode: "拼貼",
      createNewProject: true,
      projectNamePrefix: "BIUIG02_",
      field: "新增帳號數",
      sourceReport: "每日報表",
      datePreset: "過去 7 天",
      save: true,
      reportNamePattern: "BIUIG02_report_<timestamp>",
      skipReopen: true
    }
  });
  const g02Gate = evaluateCapabilityGate(g02, g02Hints);
  assert.ok(g02Gate.supportedHelperTemplates.includes("collage.createProject"));
  assert.ok(g02Gate.supportedHelperTemplates.includes("collage.createReport"));
  assert.deepEqual(
    actionTemplates(g02, g02Hints),
    ["collage.openProject", "collage.createProject", "collage.createReport", "collage.configureMetric", "collage.runPreviewAndCollectEvidence", "collage.saveReport"],
    "G-02 must create a project and then treat the empty project page as ready for createReport"
  );

  console.log(JSON.stringify({
    fixture: "p0-save-reopen-download-flow",
    status: "ok",
    checked: [
      "official editor sidebar target disambiguation",
      "official empty project list readiness",
      "F-02 same-case save/reopen route",
      "F-04 same-case row CSV route",
      "G-02 create project then create report route"
    ]
  }, null, 2));
};

main();
