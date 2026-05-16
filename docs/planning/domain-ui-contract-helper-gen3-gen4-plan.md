# Domain UI Contract / Helper Gen3-Gen4 Plan

Date: 2026-05-16 Asia/Taipei
Status: planned, dev-tracked
Primary trigger: BIUI_COLLAGE_R001 run `67990303-2c1b-4559-924a-297a089b5949`

## 1. Why This Exists

BIUI_COLLAGE_R001 exposed two separate platform problems:

1. Helper generic ability was not sufficient for official UI.
   Many cases were blocked by the same root cause: the helper tried to click global visible text such as `新增帳號數`, while the official collage UI requires a row-scoped flow: select source report first, then select field in the same metric row.

2. Result gate / upload contract had a false-positive class.
   F-01 locally produced a BLOCKED detail, but result upload failed with `TOOL_BRIDGE_RESPONSE_MISSING` because the detail text mentioned Tool Bridge in expected behavior even though the run never reached save/native dialog execution.

The long-term fix is not to keep patching one BI flow at a time. New UI domains need a reusable lifecycle:

```text
Domain UI Discovery
  -> Domain UI + Action + Evidence Contract
  -> Gen 3 Domain-driven Helper Templates
  -> Gen 4 Stable Core + Action Interpreter
  -> Cloud Feedback Loop
```

This plan records that direction so later dev/prod promotion work does not lose the architecture decision.

## 2. Non-Goals

- Do not put arbitrary executable helper code inside domain packs.
- Do not make Claude or any agent generate free-form helper code per testcase.
- Do not store full raw HTML/CSS as the primary contract. Raw DOM/screenshots are artifacts for review, not the stable source of truth.
- Do not let helper judge PASS/FAIL. Helper emits evidence; Codex/result logic judges according to testcase and domain rules.

## 3. Layer 1: Domain UI Discovery

Discovery runs before or during domain pack creation for a new URL, new feature, or major UI change.

The agent explores the actual target UI and records structured evidence:

- page map: stable routes, page titles, entry points, modals, drawers, popovers.
- component inventory: tables, forms, metric rows, pickers, date panels, save/delete modals, toast areas.
- locator candidates: role/name, visible label, row-local relationship, nearby text, DOM fingerprint, fallback candidates.
- state assertions: how to prove an action completed, such as row source text changed or a preview network request was emitted.
- interaction hazards: stale picker lists, loading states, native dialogs, disabled controls, overlays.

Discovery output belongs to the domain pack lifecycle. It is not just a temporary Claude testcase generation aid.

Recommended domain pack files:

```text
domain-packs/<DOMAIN>/
  ui-contract.json
  action-contracts/
  helper-templates.json
  evidence-schema.json
  lint-rules.json
  locators/
  discovery/
    page-map.json
    component-inventory.json
    locator-candidates.json
    dom-fingerprints.json
    screenshots-manifest.json
```

## 4. Layer 2: Domain UI + Action + Evidence Contract

The UI contract is part of the domain pack and is read by Claude, package lint, helper templates, and result evidence gate logic.

It should define:

- pages and route patterns.
- components and stable component names.
- canonical actions.
- action params schema.
- allowed locator strategy.
- evidence emitted by each action.
- conditional evidence rules.
- safety / Tool Bridge boundaries.

For BI official collage, the first required action contract is `setMetricRows`.

Example contract shape:

```json
{
  "action": "setMetricRows",
  "paramsSchema": {
    "metrics": [
      {
        "sourceReport": "string",
        "field": "string"
      }
    ]
  },
  "declarativeSteps": [
    {"op": "ensurePage", "page": "collageEditor"},
    {"op": "ensureMetricRow", "rowFrom": "metricIndex"},
    {"op": "selectRowSource", "rowFrom": "metricIndex", "valueFrom": "sourceReport"},
    {"op": "assertRowSource", "rowFrom": "metricIndex", "valueFrom": "sourceReport"},
    {"op": "openRowFieldPicker", "rowFrom": "metricIndex"},
    {"op": "waitForPickerSignatureChange", "target": "fieldPicker"},
    {"op": "selectPickerOption", "valueFrom": "field"},
    {"op": "assertRowField", "rowFrom": "metricIndex", "valueFrom": "field"}
  ],
  "requiredEvidence": [
    "metricRows.before",
    "metricRows.after",
    "sourceControlAfter",
    "fieldControlAfter",
    "locatorAttempts"
  ]
}
```

Evidence rules must support conditional requirements. A save case should not require Tool Bridge evidence if preview setup failed before save was reached.

Example:

```json
{
  "template": "saveReport",
  "requiredEvidence": ["preview.result", "save.modalState", "projectList.row"],
  "conditionalEvidence": [
    {
      "when": "nativeDialogAccepted",
      "requires": ["toolBridge.response"]
    },
    {
      "when": "preview.notReached",
      "notRequired": ["save.modalState", "toolBridge.response"]
    }
  ]
}
```

## 5. Layer 3: Gen 3 Domain-Driven Helper Templates

Goal: make domain flows template-driven instead of regex/hardcoded helper routing.

Gen 3 behavior:

- domain pack provides declarative helper templates.
- testcase helper hints select only `template + params`.
- capability gate reads template capabilities from the domain pack.
- helper produces current-run evidence only.
- helper does not judge result status.

Example testcase params should prefer:

```json
{
  "operationTemplate": "collage_date_variants_preview",
  "params": {
    "metrics": [
      {"sourceReport": "每日報表", "field": "新增帳號數"}
    ],
    "dateVariants": [
      {"uiLabel": "昨日"},
      {"uiLabel": "今日"}
    ],
    "display": "每天"
  }
}
```

The old shape remains a compatibility input only:

```json
{
  "sourceReport": "每日報表",
  "field": "新增帳號數"
}
```

New testcase generation should emit `metrics[]` so the official UI row model is explicit.

## 6. Layer 4: Gen 4 Stable Core + Action Interpreter

Goal: helper runtime becomes a generic UAT executor.

Stable core owns:

- browser session lease.
- URL/origin guard.
- Tool Bridge lifecycle.
- irreversible action guard.
- artifact writing.
- screenshot capture.
- DOM read.
- network observation.
- action/evidence event writing.
- stale evidence guard.

Action interpreter owns:

- executing allowlisted declarative ops.
- validating params against action schema.
- resolving locators through domain contract.
- emitting action state and evidence.

Domain packs submit declarative plans and contracts, not executable helper code.

Legacy BI `/biapi-dev/testview` helper behavior should eventually be represented as a legacy domain plan/template, not as privileged hardcoded runtime behavior.

## 7. Layer 5: Cloud Feedback Loop

Every run should preserve machine-readable feedback in cloud artifacts:

- blocker events.
- locator drift.
- stale picker signatures.
- result gate false positives.
- operationTemplate and params shape.
- action/evidence state.

The feedback loop should generate domain contract update candidates. Human/Codex review promotes candidates into domain pack versions.

This is necessary because future domains should improve from run evidence instead of relying on local-machine logs or chat memory.

## 8. Short-Term Compatibility Bridge

Do not wait for full Gen 4 before fixing current BI official UI blockers.

Short-term dev fixes should be shaped like the future contract:

1. Implement `setMetricRows(metrics[])` in the existing helper path.
   It should set source report and field through official row-local controls, verify each row after action, and emit row evidence.

2. Keep accepting legacy `field/sourceReport` params, but normalize them internally into:

```json
{
  "metrics": [
    {"sourceReport": "<sourceReport>", "field": "<field>"}
  ]
}
```

3. Add stale picker detection:
   - `FIELD_PICKER_STALE_AFTER_SOURCE_CHANGE`
   - `FIELD_PICKER_SOURCE_MISMATCH`
   - field list signature before/after source switch

4. Fix result evidence gate false positives:
   - do not trigger Tool Bridge response checks from `測試目的`, `設定條件`, or `預期行為`.
   - check actual execution/evidence fields only.
   - if action did not reach save/native dialog, do not require Tool Bridge response.

5. Add package lint for BI official collage:
   - preview/date/formula/save templates should require `metrics[]`.
   - formula `baseFields[]` should include `sourceReport` and `field`.
   - `toolBridge.response` should be conditional, not unconditional, except delete/overwrite/native-dialog execution states.

## 9. Immediate BI Official Collage Priorities

Based on run `67990303-2c1b-4559-924a-297a089b5949`:

1. `setMetricRows(metrics[])`
   Fix the large BLOCKED cluster caused by `VISIBLE_UI_CLICK_BLOCKED: text="新增帳號數"`.

2. result gate false-positive guard
   Prevent F-01-style local BLOCKED evidence from becoming full run upload failure.

3. picker stale signature
   Separate true metadata/UI drift from helper stale picker behavior.

4. package lint
   Prevent future Claude-generated packages from being human-readable but helper-unexecutable.

5. cloud feedback storage
   Store helper observations in cloud artifacts for future domain contract updates.

