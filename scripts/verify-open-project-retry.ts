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
    "official field picker type badges are stripped"
  ]
}, null, 2));
