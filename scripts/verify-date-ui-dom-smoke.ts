import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readDateUiEvidence } from "../agent/src/bi-ui-helper-executor";

const main = async (): Promise<void> => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <!doctype html>
      <html>
        <body>
          <button id="dateRangeBtn">上週</button>
          <div id="dateRangeDisplay">上週</div>
          <div id="datePickerPopup" style="display:block;width:420px;height:180px;">
            日期範圍
            過去7天 (2026/04/28 → 2026/05/04)
            昨日
            今日
            上週
            本週
          </div>
          <section>新增帳號數</section>
        </body>
      </html>
    `);

    const evidence = await readDateUiEvidence(page, "上週(快捷)", { baseDate: "2026-05-05" });
    assert.equal(evidence.observed.dateRangeButtonText, "上週");
    assert.equal(evidence.observed.dateRangeDisplayText, "上週");
    assert.equal(evidence.observed.popupVisible, true);
    assert.equal(evidence.requested.normalizedLabel, "上週");
    assert.equal(evidence.requestedRange?.startIso, "2026-04-26");
    assert.equal(evidence.requestedRange?.endIso, "2026-05-02");
    assert.equal(evidence.checks.requestedLabelVisible, true);
    assert.equal(evidence.warnings.includes("DATE_UI_CONTROL_TEXT_NOT_FOUND"), false);

    console.log(
      JSON.stringify(
        {
          ok: true,
          fixture: "date-ui-dom-smoke",
          checked: [
            "#dateRangeBtn selector read",
            "#dateRangeDisplay selector read",
            "#datePickerPopup visibility/text read",
            "shortcut label normalization from selector-captured DOM",
            "Sunday-week represented range computed from baseDate"
          ]
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
  }
};

void main();
