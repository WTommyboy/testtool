import assert from "node:assert/strict";
import {
  __metricFieldIdentityTestHooks as metricHooks,
  __openProjectRetryTestHooks as hooks
} from "../agent/src/bi-ui-helper-executor";

const blockedProjectHome = [
  "📊 報表管理",
  "▶",
  "報表",
  "📂",
  "公司共享",
  "▶",
  "我的自訂",
  "▶",
  "拼貼模式",
  "拼貼test_001",
  "🗑️",
  "UAT_G01測試專案",
  "🗑️",
  "▶",
  "明細檢視",
  "▶",
  "指標趨勢",
  "➕ 新增專案",
  "請從左側選擇專案查看報表"
].join("\n");

const readyProjectHome = [
  "📊 報表管理",
  "拼貼模式",
  "拼貼test_001",
  "+ 新增報表",
  "報表名稱",
  "資料區間日期",
  "下載",
  "刪除"
].join("\n");

const officialUiSidebarHome = [
  "數據統計中心",
  "公司共享",
  "我的自訂",
  "拼貼報表",
  "BI正式UI測試專案",
  "報表明細",
  "指標趨勢",
  "新增自訂報表"
].join("\n");

const officialUiCollapsedCustomSidebar = [
  "數據統計中心",
  "公司共享",
  "我的自訂",
  "拼貼報表",
  "報表明細",
  "明細模式_test_tommy",
  "指標趨勢",
  "新增自訂報表"
].join("\n");

const officialUiAiDailyCollapsedAfterToggle = [
  "數據統計中心",
  "橘子星球",
  "Tommy LH(劉徐融)",
  "報表",
  "AI 洞察",
  "AI 日報",
  "公司共享",
  "每日報表",
  "雙平台營收占比",
  "退費追蹤",
  "beanfun! 導流",
  "商品銷售明細表",
  "商品退款明細",
  "篩選訂單明細",
  "我的自訂",
  "新增自訂報表",
  "指標儀表板",
  "即時數據",
  "活躍數據",
  "營收數據",
  "留存數據",
  "新用戶數據",
  "數據中心",
  "主頁",
  "AI 洞察",
  "AI 日報",
  "AI 日報",
  "2026-05-24",
  "該日期尚無 AI 日報資料"
].join("\n");

assert.equal(
  hooks.inferVisibleCollageProjectName(blockedProjectHome),
  "拼貼test_001",
  "project inference should still find the visible collage project when the report list is not selected"
);

assert.equal(
  hooks.inferVisibleCollageProjectName(officialUiSidebarHome),
  "BI正式UI測試專案",
  "project inference should support official UI sidebar labels under 我的自訂 > 拼貼報表"
);

assert.equal(
  hooks.inferVisibleCollageProjectName(officialUiCollapsedCustomSidebar),
  null,
  "project inference must not treat structural sidebar labels such as 報表明細 as collage project names"
);

assert.equal(
  hooks.inferVisibleCollageProjectName(officialUiAiDailyCollapsedAfterToggle),
  null,
  "AI 日報 entry page without visible collage children should not invent a project name"
);

assert.deepEqual(
  hooks.officialCollageSidebarPreludeLabels(
    "https://galaxy.games.gamania.com/bi-dev/zh-TW/report/aiInsights/aiDailyReport",
    officialUiCollapsedCustomSidebar
  ),
  ["我的自訂"],
  "official UI navigation should expand 我的自訂 before clicking 拼貼報表 when no collage project is visible"
);

assert.deepEqual(
  hooks.buildOfficialCollageProjectRouteFallback(
    "https://galaxy.games.gamania.com/bi-dev/zh-TW/report/aiInsights/aiDailyReport",
    {},
    null
  ),
  {
    url: "https://galaxy.games.gamania.com/bi-dev/zh-TW/report/myCustom/tileMode/9",
    projectId: "9",
    projectName: "拼貼test_001"
  },
  "AI 日報 entry page should have a stable official collage project route fallback"
);

assert.equal(
  hooks.buildOfficialCollageProjectRouteFallback(
    "https://galaxy.games.gamania.com/bi-dev/zh-TW/report/aiInsights/aiDailyReport",
    {},
    "UAT_G01測試專案"
  ),
  null,
  "explicit project name should not fall back to the default project unless a projectId is provided"
);

assert.deepEqual(
  hooks.buildOfficialCollageProjectRouteFallback(
    "https://galaxy.games.gamania.com/bi-dev/zh-TW/report/aiInsights/aiDailyReport",
    { projectId: "61" },
    "UAT_G01測試專案"
  ),
  {
    url: "https://galaxy.games.gamania.com/bi-dev/zh-TW/report/myCustom/tileMode/61",
    projectId: "61",
    projectName: "UAT_G01測試專案"
  },
  "explicit project route fallback should require the explicit projectId"
);

assert.equal(
  hooks.isCollageReportListReady(blockedProjectHome),
  false,
  "select-project prompt is not a ready report list even when the project name is visible"
);

assert.equal(
  hooks.isCollageReportListReady(readyProjectHome),
  true,
  "report list is ready only when + 新增報表 is visible and the select-project prompt is gone"
);

const candidates = [
  {
    text: "拼貼模式 拼貼test_001 UAT_G01測試專案 請從左側選擇專案查看報表",
    tagName: "div",
    role: null,
    className: "",
    rect: { x: 0, y: 100, width: 320, height: 500 }
  },
  {
    text: "拼貼test_001",
    tagName: "span",
    role: "treeitem",
    className: "tree-node-title",
    rect: { x: 42, y: 180, width: 110, height: 24 }
  },
  {
    text: "拼貼test_001 🗑️",
    tagName: "li",
    role: null,
    className: "project-item",
    rect: { x: 36, y: 180, width: 180, height: 32 }
  }
].sort((a, b) =>
  hooks.scoreCollageProjectClickCandidate(a, "拼貼test_001") -
  hooks.scoreCollageProjectClickCandidate(b, "拼貼test_001")
);

assert.equal(
  candidates[0]?.text,
  "拼貼test_001",
  "retry click scoring should prefer the exact visible project node over a large parent container"
);

assert.equal(
  metricHooks.sourceReportLabelMatches("beanfun!導流", "各登入渠道狀況(原 beanfun! 導流)"),
  true,
  "official source picker label should match the metadata source alias"
);

assert.equal(
  metricHooks.normalizeSourceReportIdentity("雙平台營收占比"),
  metricHooks.normalizeSourceReportIdentity("雙平台營收佔比"),
  "official 占/佔 source spelling should normalize to the same identity"
);

assert.equal(
  metricHooks.cleanFieldPickerLabel("累計帳號數 數值"),
  "累計帳號數",
  "official field picker labels should strip the visible Chinese type badge"
);

assert.deepEqual(
  metricHooks.metricRowsFromParams({
    metrics: [
      { sourceReport: "每日報表", field: "新增帳號數" },
      { sourceReport: "雙平台營收占比", field: "iOS總營收", metricIndex: 2 }
    ]
  }),
  [
    { sourceReport: "每日報表", field: "新增帳號數", metricIndex: 0 },
    { sourceReport: "雙平台營收占比", field: "iOS總營收", metricIndex: 2 }
  ],
  "metrics[] should be preserved as row-scoped official UI params"
);

assert.deepEqual(
  metricHooks.metricRowsFromParams({
    sourceReport: "每日報表",
    field: "新增帳號數 + 活躍帳號數"
  }),
  [
    { sourceReport: "每日報表", field: "新增帳號數", metricIndex: 0 },
    { sourceReport: "每日報表", field: "活躍帳號數", metricIndex: 1 }
  ],
  "legacy field/sourceReport params should normalize to metrics[] for compatibility"
);

assert.deepEqual(
  metricHooks.metricRowsFromBaseFieldsParams({
    baseFields: [
      { sourceReport: "每日報表", field: "新增帳號數" },
      { sourceReport: "退費追蹤", field: "總退費金額" }
    ]
  }),
  [
    { sourceReport: "每日報表", field: "新增帳號數", metricIndex: 0 },
    { sourceReport: "退費追蹤", field: "總退費金額", metricIndex: 1 }
  ],
  "formula baseFields[] objects should preserve source report for official row-scoped setup"
);

assert.equal(
  metricHooks.officialMetricRowHasSelectedField({
    rowIndex: 0,
    sourceButtonIndex: 1,
    sourceText: "每日報表",
    fieldButtonIndex: 2,
    fieldText: "新增帳號數",
    y: 360
  }),
  true,
  "official selected row fields should count as execute precondition evidence"
);

assert.equal(
  metricHooks.officialMetricRowFieldMatches({
    rowIndex: 0,
    sourceButtonIndex: 1,
    sourceText: "每日報表",
    fieldButtonIndex: 2,
    fieldText: "新增帳號數",
    y: 360
  }, "新增帳號數"),
  true,
  "official row selected field should verify against requested metric"
);

console.log(JSON.stringify({
  ok: true,
  fixture: "open-project-retry",
  checked: [
    "visible project inference survives select-project prompt",
    "official UI sidebar project inference",
    "report-list readiness rejects prompt-only pages",
    "report-list readiness accepts + 新增報表 pages",
    "candidate scoring prefers exact project nodes",
    "official source aliases normalize",
    "official field picker type badges are stripped",
    "metrics[] params normalize for official row-scoped setup",
    "legacy sourceReport/field params normalize to metrics[]",
    "formula baseFields[] preserve sourceReport",
    "official selected row fields satisfy execute precondition evidence"
  ]
}, null, 2));
