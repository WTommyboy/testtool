import assert from "node:assert/strict";
import {
  buildDateUiEvidence,
  computePresetDateRange,
  extractDateUiRanges,
  normalizeDatePresetLabel
} from "../agent/src/date-ui-evidence";

const main = (): void => {
  assert.equal(normalizeDatePresetLabel("昨日(快捷起點)"), "昨日");
  assert.equal(normalizeDatePresetLabel("過去 30 天"), "過去30天");

  const currentRangeText = "日期範圍\n過去7天 (2026/04/28 → 2026/05/04)\n昨日\n今日\n上週\n本週";
  const extracted = extractDateUiRanges(currentRangeText, "popupText");
  assert.equal(extracted.length, 1, "date evidence should parse visible represented range from Galaxy date popup text");
  assert.equal(extracted[0]?.label, "過去7天");
  assert.equal(extracted[0]?.startIso, "2026-04-28");
  assert.equal(extracted[0]?.endIso, "2026-05-04");

  const yesterdayRange = computePresetDateRange("昨日", "2026-05-05");
  assert.equal(yesterdayRange?.startIso, "2026-05-04");
  assert.equal(yesterdayRange?.endIso, "2026-05-04");

  const lastWeekRange = computePresetDateRange("上週", "2026-05-05");
  assert.equal(lastWeekRange?.startIso, "2026-04-26");
  assert.equal(lastWeekRange?.endIso, "2026-05-02");

  const thisWeekRange = computePresetDateRange("本週", "2026-05-05");
  assert.equal(thisWeekRange?.startIso, "2026-05-03");
  assert.equal(thisWeekRange?.endIso, "2026-05-05");

  const past30Range = computePresetDateRange("過去30天", "2026-05-05");
  assert.equal(past30Range?.startIso, "2026-04-05");
  assert.equal(past30Range?.endIso, "2026-05-04");

  const recent30Range = computePresetDateRange("最近30天", "2026-05-05");
  assert.equal(recent30Range?.startIso, "2026-04-06");
  assert.equal(recent30Range?.endIso, "2026-05-05");

  const presetEvidence = buildDateUiEvidence({
    requested: "昨日(快捷)",
    baseDate: "2026-05-05",
    observed: {
      dateRangeButtonText: "昨日",
      dateRangeDisplayText: null,
      popupVisible: false,
      popupText: null,
      bodyText: "日期範圍\n昨日\n新增帳號數"
    }
  });
  assert.equal(presetEvidence.requested.normalizedLabel, "昨日");
  assert.equal(presetEvidence.requestedRange?.display, "2026/05/04 ~ 2026/05/04");
  assert.equal(presetEvidence.checks.requestedLabelVisible, true);
  assert.equal(
    presetEvidence.checks.representedRangeMatchesRequested,
    null,
    "when UI only exposes preset label, represented range must be marked computed/not directly visible"
  );
  assert.ok(presetEvidence.warnings.includes("DATE_UI_REPRESENTED_RANGE_NOT_VISIBLE"));

  const staticEvidence = buildDateUiEvidence({
    requested: "2026/03/01~2026/03/31",
    observed: {
      dateRangeButtonText: "2026/03/01 ~ 2026/03/31",
      dateRangeDisplayText: null,
      popupVisible: false,
      popupText: null,
      bodyText: "日期範圍\n2026/03/01 ~ 2026/03/31"
    }
  });
  assert.equal(staticEvidence.requestedRange?.startIso, "2026-03-01");
  assert.equal(staticEvidence.requestedRange?.endIso, "2026-03-31");
  assert.equal(staticEvidence.checks.staticRequestedRangeObserved, true);
  assert.equal(staticEvidence.checks.representedRangeMatchesRequested, true);

  const mismatchEvidence = buildDateUiEvidence({
    requested: "昨日",
    baseDate: "2026-05-05",
    observed: {
      dateRangeButtonText: "今日",
      dateRangeDisplayText: null,
      popupVisible: false,
      popupText: null,
      bodyText: "日期範圍\n今日"
    }
  });
  assert.equal(mismatchEvidence.checks.requestedLabelVisible, false);
  assert.ok(mismatchEvidence.warnings.includes("DATE_UI_REQUESTED_LABEL_NOT_VISIBLE"));

  console.log(
    JSON.stringify(
      {
        ok: true,
        fixture: "date-ui-evidence",
        checked: [
          "shortcut label normalization",
          "visible represented range parsing",
          "preset represented range computed from baseDate",
          "Sunday-based week shortcut ranges",
          "past/recent rolling day shortcut ranges",
          "static range exact observation",
          "requested label mismatch warning"
        ]
      },
      null,
      2
    )
  );
};

main();
