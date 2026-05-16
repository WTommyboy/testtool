import assert from "node:assert/strict";
import { __metricFieldIdentityTestHooks as hooks } from "../agent/src/bi-ui-helper-executor";

const target = {
  label: "退費總金額",
  code: hooks.knownMetricFieldCode("退費總金額")
};

assert.equal(target.code, "TOTAL_REFUND");
assert.deepEqual(hooks.metricFieldIdentitySet("退費總金額").sort(), hooks.metricFieldIdentitySet("總退費金額").sort());
assert.equal(
  hooks.fieldPickerTargetMatches(
    { label: "總退費金額", code: "TOTAL_REFUND", groupLabel: "DAILY_REPORT" },
    target
  ),
  true,
  "legacy testcase label should match the current UI label/code"
);

for (const item of [
  { label: "iOS退費總金額", code: "TOTAL_REFUND_IOS", groupLabel: "REFUND_TRACKING" },
  { label: "Android退費總金額", code: "TOTAL_REFUND_AOS", groupLabel: "REFUND_TRACKING" },
  { label: "線下商城退費總金額", code: "TOTAL_REFUND_WEBSHOP", groupLabel: "REFUND_TRACKING" }
]) {
  assert.equal(
    hooks.fieldPickerTargetMatches(item, target),
    false,
    `${item.label}/${item.code} must not satisfy TOTAL_REFUND alias`
  );
}

assert.equal(
  hooks.formulaFieldTokenMatches(
    { index: 1, text: "總退費金額", id: null, className: "formula-field-btn", onclick: "inputFormula('[TOTAL_REFUND]')" },
    "退費總金額"
  ),
  true,
  "formula modal should use the canonical TOTAL_REFUND token for the legacy label"
);

for (const item of [
  { index: 2, text: "iOS退費總金額", id: null, className: "formula-field-btn", onclick: "inputFormula('[TOTAL_REFUND_IOS]')" },
  { index: 3, text: "Android退費總金額", id: null, className: "formula-field-btn", onclick: "inputFormula('[TOTAL_REFUND_AOS]')" },
  { index: 4, text: "線下商城退費總金額", id: null, className: "formula-field-btn", onclick: "inputFormula('[TOTAL_REFUND_WEBSHOP]')" }
]) {
  assert.equal(
    hooks.formulaFieldTokenMatches(item, "退費總金額"),
    false,
    `${item.text}/${item.onclick} must not satisfy the formula TOTAL_REFUND alias`
  );
}

assert.deepEqual(
  hooks.metricFieldSearchQueries("線下商城GASH總營收"),
  ["線下商城GASH總營收", "線下商城 GASH總營收", "線下商城 GASH 總營收"],
  "official UI search needs spaced offline channel variants"
);

assert.ok(
  hooks.metricFieldSearchQueries("線下商城Coda總營收").includes("線下商城 CODAPAY 總營收"),
  "Coda metadata label should search the official CODAPAY display label"
);

console.log(JSON.stringify({
  ok: true,
  fixture: "helper-field-aliases",
  checked: [
    "退費總金額 maps to TOTAL_REFUND",
    "退費總金額 and 總退費金額 are explicit aliases",
    "platform refund fields do not satisfy TOTAL_REFUND",
    "formula modal uses TOTAL_REFUND and rejects platform refund tokens",
    "offline mall field search emits official spaced channel labels"
  ]
}, null, 2));
