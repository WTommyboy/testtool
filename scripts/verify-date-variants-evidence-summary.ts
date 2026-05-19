import assert from "node:assert/strict";
import { summarizeDateVariantPreviewEvidenceForJudgment } from "../agent/src/bi-ui-helper-executor";

const variant = (label: string, start: string, end: string, headers: string[], sum: number) => ({
  requestedLabel: label,
  normalizedLabel: label,
  status: "ok",
  setDateResult: {
    interactionLog: {
      schemaVersion: "interaction-log-v1",
      actions: {
        setStaticDateRange: {
          role: "under_test",
          expectedOutcome: "succeeded",
          actualOutcome: "partial_state_change",
          steps: {
            openStaticTab: {
              expectedOutcome: "succeeded",
              actualOutcome: "dispatched_no_change"
            }
          },
          calendarFallback: true
        }
      }
    }
  },
  dateUiEvidence: {
    observed: {
      dateRangeButtonText: null
    },
    matchedRepresentedRange: {
      startIso: start,
      endIso: end,
      rawText: label
    },
    checks: {
      requestedLabelVisible: true,
      representedRangeMatchesRequested: true
    }
  },
  network: {
    requests: [
      {
        url: "https://example.invalid/preview",
        method: "POST",
        postData: JSON.stringify({
          dateRange: { start, end }
        })
      }
    ],
    responses: [
      {
        url: "https://example.invalid/preview",
        status: 200
      }
    ]
  },
  table: {
    header: ["", "區間總和", ...headers],
    dataRowCount: 2,
    numericColumns: [
      {
        columnIndex: 1,
        header: "區間總和",
        values: [sum],
        summary: { count: 1, sum, max: sum, min: sum }
      },
      ...headers.map((header, index) => ({
        columnIndex: index + 2,
        header,
        values: [index + 1],
        summary: { count: 1, sum: index + 1, max: index + 1, min: index + 1 }
      }))
    ]
  },
  warnings: ["DATE_UI_CONTROL_TEXT_NOT_FOUND"]
});

const summary = summarizeDateVariantPreviewEvidenceForJudgment({
  variants: [
    variant("2026-03-01 ~ 2026-03-15", "2026-03-01", "2026-03-15", [
      "2026-03-15 (日)",
      "2026-03-14 (六)",
      "2026-03-13 (五)",
      "2026-03-12 (四)",
      "2026-03-11 (三)",
      "2026-03-10 (二)",
      "2026-03-09 (一)",
      "2026-03-08 (日)",
      "2026-03-07 (六)",
      "2026-03-06 (五)",
      "2026-03-05 (四)",
      "2026-03-04 (三)",
      "2026-03-03 (二)",
      "2026-03-02 (一)",
      "2026-03-01 (日)"
    ], 63),
    variant("2026-03-16 ~ 2026-03-31", "2026-03-16", "2026-03-31", [
      "2026-03-31 (二)",
      "2026-03-30 (一)",
      "2026-03-29 (日)",
      "2026-03-28 (六)",
      "2026-03-27 (五)",
      "2026-03-26 (四)",
      "2026-03-25 (三)",
      "2026-03-24 (二)",
      "2026-03-23 (一)",
      "2026-03-22 (日)",
      "2026-03-21 (六)",
      "2026-03-20 (五)",
      "2026-03-19 (四)",
      "2026-03-18 (三)",
      "2026-03-17 (二)",
      "2026-03-16 (一)"
    ], 908)
  ]
});

assert.equal(summary.schemaVersion, "date-variants-preview-judgment-summary-v1");
const variants = summary.variants as Array<Record<string, unknown>>;
assert.equal(variants.length, 2);
assert.equal((variants[0].tableSummary as Record<string, unknown>).rowCount, 15);
assert.equal((variants[0].tableSummary as Record<string, unknown>).firstDate, "2026-03-01");
assert.equal((variants[0].tableSummary as Record<string, unknown>).lastDate, "2026-03-15");
assert.equal((variants[0].tableSummary as Record<string, unknown>).sum, 63);
assert.deepEqual((variants[1].networkEvidence as Record<string, unknown>).requestDateRange, {
  start: "2026-03-16",
  end: "2026-03-31"
});
assert.equal((summary.comparison as Record<string, unknown>).dateRangesDiffer, true);
assert.equal((summary.comparison as Record<string, unknown>).rowCountsDiffer, true);
assert.equal((summary.comparison as Record<string, unknown>).overlappingDateHeaders, false);

console.log(JSON.stringify({
  ok: true,
  fixture: "date-variants-evidence-summary"
}, null, 2));
