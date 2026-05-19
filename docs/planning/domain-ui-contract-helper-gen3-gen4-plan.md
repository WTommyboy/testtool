# Domain UI Contract / Helper Gen3-Gen4 Plan

Date: 2026-05-16 Asia/Taipei
Status: planned, dev-tracked; Gen1a/Gen1b contract wiring and short-term bridge are in dev; Gen1c contract hardening added before next live UAT; scope-aware contract refinement recorded after run `81455108-f612-4024-9d71-4f1995e08d7a`; P0 scope runtime guards and observation bridge are in dev; P0 vocabulary-first reset recorded after run `1762c1b2-bc42-47f0-80b6-d1ef10a0f713`
Primary triggers: BIUI_COLLAGE_R001 runs `67990303-2c1b-4559-924a-297a089b5949`, `81455108-f612-4024-9d71-4f1995e08d7a`, `ecc53283-18c4-4b29-a405-e7681626e28b`, and `1762c1b2-bc42-47f0-80b6-d1ef10a0f713`

## 1. Why This Exists

BIUI_COLLAGE_R001 exposed two separate platform problems:

1. Helper generic ability was not sufficient for official UI.
   Many cases were blocked by the same root cause: the helper tried to click global visible text such as `新增帳號數`, while the official collage UI requires a row-scoped flow: select source report first, then select field in the same metric row.

2. Result gate / upload contract had a false-positive class.
   F-01 locally produced a BLOCKED detail, but result upload failed with `TOOL_BRIDGE_RESPONSE_MISSING` because the detail text mentioned Tool Bridge in expected behavior even though the run never reached save/native dialog execution.

The long-term fix is not to keep patching one BI flow at a time. New UI domains need a reusable lifecycle. The original direction remains valid, but run `81455108-f612-4024-9d71-4f1995e08d7a` showed the first phrasing was incomplete because planner fallback, helper fallback, and result gate did not understand case scope.

The refined lifecycle is:

```text
Domain UI Discovery
  -> Domain UI Contract
  -> Case Scope / Intent Contract
  -> Action Template Contract
  -> Evidence Contract
  -> Result / Judgment Contract
  -> Feedback / Drift Loop
  -> Gen 4 Stable Core + Action Interpreter
```

This plan records that direction so later dev/prod promotion work does not lose the architecture decision.

## 2. Non-Goals

- Do not put arbitrary executable helper code inside domain packs.
- Do not make Claude or any agent generate free-form helper code per testcase.
- Do not store full raw HTML/CSS as the primary contract. Raw DOM/screenshots are artifacts for review, not the stable source of truth.
- Do not let helper judge PASS/FAIL. Helper emits evidence; Codex/result logic judges according to testcase and domain rules.
- Do not add BI-specific branching or BI-specific fields to the stable core runtime. The core may understand generic execution concepts; BI fields stay in the BI domain pack and BI testcase packages.
- Do not add small per-domain agents/helpers as a shortcut. Domain packs may provide declarative adapters, aliases, locator maps, action templates, evidence schemas, lint rules, and known hazards, but not arbitrary executable helper logic.

## 2.1 Refined Stack: Scope-Aware Domain Contracts

The refined architecture is still contract-driven, but the contract stack must explicitly carry case scope and judgment rules. The failure pattern in run `81455108-f612-4024-9d71-4f1995e08d7a` was not only "helper cannot click the UI"; it was "planner / helper fallback / result gate did not know what the case was trying to prove."

Core principle:

```text
Core schema stable
Domain schema extensible
Runtime contract-driven
No domain-specific branching in core
```

Responsibility split:

| Layer | Owns | Must not own |
| --- | --- | --- |
| Stable core runtime | browser lease, Tool Bridge, irreversible guard, generic action interpreter, artifact writing, generic result/evidence gate hooks | BI fields such as `sourceReport`, `metrics`, `selectedMetricFields`, `拼貼模式` |
| Domain pack | domain UI map, domain action templates, domain param schema, aliases, locator candidates, evidence schema, lint rules, domain hazards | executable helper code or free-form agent logic |
| Testcase package | concrete case intent, scope, risk, expected evidence, concrete domain values | runtime implementation details or hidden helper assumptions |

Generic runtime fields should be stable across domains:

- `targetPage`
- `testIntent`
- `caseScope`
- `riskLevel`
- `allowedActions`
- `forbiddenActions`
- `requiredEvidence`
- `actionTemplate`
- `cleanupPolicy`
- `judgmentPolicy`

Domain-specific fields remain below the domain pack/testcase layer:

- BI: `metrics`, `sourceReport`, `dateRange`, `displayMode`, `formula.baseFields`.
- Commerce: `sku`, `cart`, `coupon`, `paymentMethod`.
- CRM: `leadStatus`, `owner`, `pipelineStage`.
- Permissions: `role`, `permission`, `resource`.

### Case Scope / Intent Contract

Every case needs an explicit scope before helper planning:

```json
{
  "caseScope": {
    "targetPage": "collageProjectList",
    "testIntent": "frontend_observation",
    "previewRequired": false,
    "saveRequired": false,
    "executionRequired": false,
    "allowedActions": ["collage.openProject", "read.visibleUi"],
    "forbiddenActions": ["collage.configureMetric", "collage.runPreview"],
    "requiredEvidence": ["projectList.visible", "buttonState.visible"],
    "judgmentPolicy": "frontend_observation"
  }
}
```

This contract prevents a no-hints sidebar/list/button observation case from falling into a generic preview helper. If `previewRequired=false`, `EXECUTE_PRECONDITION_NO_SELECTED_FIELDS` is irrelevant unless the case itself reaches a preview action. Reading `selectedMetricFields=0` can be valid UI evidence, but it is not a blocker for a non-preview observation case.

### Action Template Contract

Action templates describe how to execute domain operations through allowlisted declarative steps. They are not small helpers and not free code. If a case needs a domain-specific operation and the domain pack does not define an action template, the correct result is a contract blocker such as `HELPER_CONTRACT_MISSING`, not a fallback into a different preview/save/helper path.

### Evidence Contract

Evidence requirements must be scoped by case intent. A frontend observation case may require visible text, enabled/disabled state, row count, DOM state, or screenshots. A backend preview case may require request/response/chart/table evidence. A save/delete/native-dialog case may require Tool Bridge evidence only if the action was actually reached.

### Result / Judgment Contract

The result gate must judge against case scope, not against whatever downstream helper happened to attempt. Rules:

- If required evidence for the case scope is satisfied, unrelated downstream helper blockers must not override the case.
- If an action required by the case scope was not reached, record the nearest contract/root blocker.
- If no action template exists for the requested domain operation, return `HELPER_CONTRACT_MISSING` or package lint failure, not a generic helper fallback.
- If the case is `frontend_observation`, UI evidence can be sufficient even when preview evidence is absent.
- If the case is `backend_preview` or `integration_preview`, selected fields / preview request / response evidence can be mandatory.

### Feedback / Drift Loop

Run evidence should update contracts, not accumulate one-off patches. The loop should classify failures into at least:

- product bug.
- testcase design issue.
- missing action template.
- stale locator / UI drift.
- domain alias/display-name drift.
- result gate scope error.
- helper fallback misrouting.

Only reviewed feedback becomes a domain pack update. This is how future domains improve without adding a new small helper or small agent for every feature.

## 2.2 Development Phases

The long-term implementation should move in phases so the tool can keep running while the contract model becomes stricter.

Phase 0: Compatibility containment

- Keep current Gen1/Gen2 helper bridges only where live UAT is blocked.
- Add guards that prevent known wrong fallback paths, especially no-hints frontend observation -> generic preview.
- Treat `selectedMetricFields=0` as preview-only blocker only when preview is in scope.
- Keep this phase explicitly temporary; do not grow it into another BI-specific runtime.

Dev status 2026-05-17:

- `agent/src/case-scope.ts` infers the first runtime `testIntent` / `previewRequired` / `executionRequired` / `requiredEvidence` shape from existing case manifest and helper hints.
- `capability-gate` now emits `caseScope` and returns `HELPER_CONTRACT_MISSING:<template>` when an official UI observation requires a missing action template, such as `collage.datePanelObservation`.
- `helper-execution-plan` refuses to generate soft generic prelude actions for missing-template observation cases.
- `result-evidence-gate` rejects BLOCKED results that use `selectedMetricFields=0` / `EXECUTE_PRECONDITION_NO_SELECTED_FIELDS` when `previewRequired=false`.
- `test-package-consistency` promotes missing instruction case sections for `BI_OFFICIAL_UI_COLLAGE` I/J/K/L/M/N frontend observation cases to error.
- `case-feature-detection` treats `拼貼報表` as collage, so project/report-row observation cases are not forced to mention `拼貼模式` exactly to avoid generic preview fallback.
- This is still Phase 0 containment. The authored `caseScope` schema, domain action-template interpreter, and full feedback loop remain Phase 1+ work.

Dev status 2026-05-17 after reduced run `ecc53283-18c4-4b29-a405-e7681626e28b`:

- P0.5 visual fallback is working as containment only. It classifies screenshot-only frontend observation gaps as `BLOCKED_NEEDS_VISUAL_REVIEW`; it does not convert screenshots into automatic PASS evidence.
- The run completed 15 cases but all were `BLOCKED`. This exposed a different gap: frontend observation cases still lack structured observation evidence and domain semantic mapping, so judgeable UI states were not converted into PASS/FAIL assertions.
- The archive repeatedly recorded `mcpToolCallCount=0` / `TOOL_EXECUTION_UNAVAILABLE`, but an independent smoke with the same Playwright MCP/CDP config successfully called `browser_tabs` and saw the logged-in BI page. Runtime must therefore add an MCP preflight/guard before accepting tool-unavailable results.
- Existing DOM/CDP evidence shows the direction is feasible: I-07 user button text and disabled state, K-01 `report-mode` checked state, L-02 date panel contents, and K-10 validation text can be observed without BI API bypass. J-02 also exposes toolbar disabled-state patterns, but needs a BI domain semantic map to assign icon meaning.
- P0.6-P0.12 sequence is now part of Phase 0: browser MCP availability guard, BI official UI semantic contract enrichment, generic DOM extractor upgrade, declarative observation action templates, observation result gate, B-09 outcome-vs-flow scope split, then reduced smoke.
- Do not start another full/reduced Tommy UAT run until the domain data, runtime observation path, and local smoke have all passed.

P0.7 data completion status 2026-05-17:

- `BI_OFFICIAL_UI_COLLAGE/ui-contract.json` now has observation semantic maps for topbar user button, project toolbar icon order, report-mode radio values, date panel required texts, and known validation messages.
- `discovery/component-inventory.json` now records the corresponding components: `topbar.userButton`, `projectToolbar.actionButtons`, `reportMode.radioGroup`, `dateRange.panel`, `validation.messageArea`, and `sidebar.companySharedGroup`.
- `evidence-schema.json` now defines `browserMcp.preflight` plus structured observation evidence objects for those components.
- `action-contracts/observeFrontendState.json` is a declarative contract seed, not executable helper code. It names the supported observation types and the evidence each one must emit.
- Smoke `npm run verify:official-observation-contract` passes for representative I-07, J-02, K-01, L-02, and K-10 semantics. Runtime DOM extractor and result gate wiring are still pending.

P0.6/P0.8/P0.9/P0.10 runtime bridge status 2026-05-17:

- Domain optional inputs now include `action-contracts/observeFrontendState.json`, downloaded as `input/domain_action_observe_frontend_state.json` and listed in run brief/reference/rule indexes.
- Capability gate and helper execution plan can schedule `collage.observeFrontendState` for frontend observation cases after safe navigation/create-report prelude. The plan must not include `collage.configureMetric` or `collage.runPreviewAndCollectEvidence` for those observation-only cases.
- The BI helper executor now has a compatibility implementation for `collage.observeFrontendState`. It emits `frontend-observation-evidence.json` and action reports for user button, project toolbar, report-mode radio, date panel, and validation-message observations. It still cannot judge testcase PASS/FAIL.
- Generic DOM profile extraction now captures checked/aria-checked, aria-disabled, aria-expanded, nearest label, title, and computed style so UI state is not limited to text-only evidence.
- Result evidence gate rejects `TOOL_EXECUTION_UNAVAILABLE` without browser MCP preflight evidence. Case-level containment converts that conflict to `BLOCKED_NEEDS_REJUDGMENT`, preserving run continuity while refusing to accept an unverified tool-unavailable judgment.
- This bridge makes the next reduced UAT materially different from `ecc53283`: I-07/J-02/K-01/L-02/K-10 should have structured helper observation evidence available before Codex writes the result. Full Gen4 interpreter and authored `caseScopeContract.v1` remain later phases.

P0.11 scope split status 2026-05-17:

- B-09-style static date range correctness remains a preview/outcome case when the testing target is request body and preview date correctness. It must not silently inherit save/reopen/download actions, but it should still collect preview/network/chart evidence.
- Static-tab clickability is a separate frontend/flow assertion. It should be authored as an L/date-panel observation case or later as an explicit date-panel action contract, then judged from `dateRange.panel.state` / interaction evidence rather than preview outcome.
- `verify:official-observation-contract` now covers both paths: B-09 preview correctness and representative `BIUI_COLLAGE_R001-L-STATIC-TAB` frontend observation. This prevents future fixes from collapsing outcome evidence and flow evidence into one ambiguous judgment.

P0.12 local smoke status 2026-05-17:

- Local fixture/build validation was not enough; the live dev Chrome helper smoke caught a real user-button timing/extractor gap and forced a runtime fix before Tommy re-ran UAT.
- The bridge now waits for observation-specific UI readiness markers before reading DOM, and user-button observation can fall back to the BI topbar body-text line when official UI does not expose a stable visible button rect immediately.
- Live dev Agent Chrome smokes passed for I-07, J-02, K-01, L-02, and K-10. These cover the exact false-BLOCKED cluster from `ecc53283`: logged-in user text, icon-only toolbar disabled state, default collage radio, date panel expansion, and empty setup validation.
- P0.12 still requires operational closeout: push the dev branch, rebuild/restart `com.tommy.uat-agent-dev`, and record dist mtime + process start time before Tommy runs the next dev UAT.

Phase 1: Scope schema and package lint

- Add `caseScope`, `testIntent`, `previewRequired`, `saveRequired`, `executionRequired`, `allowedActions`, `forbiddenActions`, `requiredEvidence`, and `judgmentPolicy` to the authored contract/testcase path.
- Package lint should warn first, then later block, when official UI cases have no case scope, no operation template, or contradictory scope/actions.
- Observation cases should be linted differently from preview/save/delete cases.

Phase 2: Domain action templates

- Promote reviewed official UI flows into declarative action templates: project/list observation, editor initial-state observation, `setMetricRows`, date preview, formula preview, save/load, CSV download, create/delete temp report.
- Keep action templates data-driven and allowlisted; no free executable helper code in the domain pack.
- Missing template should produce `HELPER_CONTRACT_MISSING`, not generic fallback.

Phase 3: Scope-aware planner and result gate

- Planner should choose helper actions only from `allowedActions` and action templates compatible with `caseScope`.
- Result gate should judge against required scope evidence, not all helper artifacts.
- Downstream helper blockers outside case scope should be diagnostics, not automatic result blockers.

Phase 4: Feedback / drift review loop

- Persist machine-readable classifications for product bug, testcase issue, missing template, stale locator, alias/display-name drift, result gate scope error, and helper fallback misrouting.
- Reviewed feedback becomes domain contract update candidates.
- Repeated patterns should become lint rules or action-template updates, not one-off runtime branches.

Phase 5: Gen 4 stable core + interpreter

- Move from BI helper bridge to a generic action interpreter that executes allowlisted declarative ops.
- Core remains domain-neutral and only owns browser/session/safety/artifact primitives.
- Domain-specific knowledge stays in domain packs and testcase packages.

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

Gen1a/Gen1b implementation note:

- `BI_OFFICIAL_UI_COLLAGE` now includes `ui-contract.json`, `action-contracts/setMetricRows.json`, `evidence-schema.json`, `lint-rules.json`, `discovery/page-map.json`, and `discovery/component-inventory.json`.
- The UAT Tool domain loader/API/run input contract exposes those files when present, and the Agent downloads them into `input/domain_*.json` files for prompt, reference-index, and rule-index usage.
- This is a readability/data-contract step only. Helper execution remains in the existing helper path until the short-term `setMetricRows(metrics[])` bridge and later Gen 3 template runtime are implemented.

Short-term bridge implementation note:

- Existing helper paths now normalize `metrics[]` and legacy `sourceReport + field` params into row-scoped metric row requests.
- On official collage editor pages, `configureMetric`, date variants, formula base-field setup, and all-zero inspection first try visible source-report + field row controls and emit `metric-rows-evidence.json`.
- Preview execute precondition now counts official UI selected metric rows, not only legacy remove-field buttons.
- Result evidence gate now ignores Tool Bridge prose in `測試目的` / `設定條件` / `預期行為`; it only requires Tool Bridge response when actual execution/evidence text claims native dialog, authorization, or irreversible action was reached.
- A-06 hardening adds display-query variants for official field search, including spaced offline mall labels such as `線下商城 GASH 總營收` and `線下商城 CODAPAY 總營收`; large select-all flows add row buffer before opening pickers so dropdown options stay visible; final select-all count uses verified row evidence instead of only currently visible rows in the scroll viewport.

Gen1c contract hardening note:

- `test-package-consistency.json` now applies `input/domain_lint_rules.json` when the run downloads a domain pack with lint rules. The standalone checker also accepts `--domain` and `--domain-lint-rules`.
- `BI_OFFICIAL_UI_COLLAGE/lint-rules.json` warns when new official collage helper hints still use legacy top-level `sourceReport + field` instead of `metrics[].sourceReport + metrics[].field`, and formula templates require `baseFields[].sourceReport + baseFields[].field`.
- `verify:domain-pack` validates the critical contract shape for `ui-contract.json`, `action-contracts/setMetricRows.json`, `evidence-schema.json`, `lint-rules.json`, and discovery files instead of only checking JSON parseability.
- Result evidence gate now supports structured `executionState`. `nativeDialogReached`, `irreversibleActionReached`, `overwriteConfirmReached`, and `deleteConfirmReached` require Tool Bridge response evidence; `setupBlocked`, `previewNotReached`, and `saveNotReached` do not.

## 4. Layer 2: Domain UI + Action + Evidence Contract

The UI contract is part of the domain pack and is read by Claude, package lint, helper templates, and result evidence gate logic. After the scope-aware refinement, this layer should be treated as a contract family rather than one large file:

- UI Contract: pages, components, stable component names, locator strategy, known overlays and hazards.
- Case Scope / Intent Contract: whether the case is observation, preview execution, save/load, delete, permissions, or another intent class.
- Action Template Contract: declarative operations and allowed params.
- Evidence Contract: required evidence by action and by case scope.
- Result / Judgment Contract: how PASS/FAIL/BLOCKED/PARTIAL should be decided when evidence is complete, incomplete, or blocked.

It should define:

- pages and route patterns.
- components and stable component names.
- canonical actions.
- action params schema.
- allowed locator strategy.
- evidence emitted by each action.
- conditional evidence rules.
- safety / Tool Bridge boundaries.
- scope gates, such as whether preview execution is required before selected-field preconditions apply.
- judgment gates, such as whether frontend UI evidence alone can satisfy the case.

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

Evidence rules must support conditional requirements. A save case should not require Tool Bridge evidence if preview setup failed before save was reached. A frontend observation case should not require preview evidence or selected metric fields unless its own case scope explicitly requires preview execution.

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
- planner first validates `caseScope` and only considers templates allowed by that scope.
- capability gate reads template capabilities from the domain pack.
- helper produces current-run evidence only.
- helper does not judge result status.
- no-hints fallback is safe-navigation/read-only only; it must not invent preview/save/configure actions for frontend observation cases.

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
   - distinguish true empty search results from hidden/off-viewport picker options.

4. Fix result evidence gate false positives:
   - do not trigger Tool Bridge response checks from `測試目的`, `設定條件`, or `預期行為`.
   - check actual execution/evidence fields only.
   - if action did not reach save/native dialog, do not require Tool Bridge response.

5. Add package lint for BI official collage:
   - preview/date/formula/save templates should require `metrics[]`.
   - formula `baseFields[]` should include `sourceReport` and `field`.
   - `toolBridge.response` should be conditional, not unconditional, except delete/overwrite/native-dialog execution states.
   - current Gen1c implementation emits warnings for compatibility-period legacy helper hints; Gen3 gate can later promote selected rules from warning to error.

6. Add case-scope guards before helper fallback:
   - `previewRequired=false` means selected-field preconditions are not blocker candidates.
   - frontend observation cases without helper hints may run only safe navigation/read prelude.
   - cases that need a domain action but lack a template should surface `HELPER_CONTRACT_MISSING` or package lint failure.
   - result gate should ignore downstream helper blockers when required scope evidence was already captured.

## 9. Immediate BI Official Collage Priorities

Based on runs `67990303-2c1b-4559-924a-297a089b5949` and `81455108-f612-4024-9d71-4f1995e08d7a`:

1. `setMetricRows(metrics[])`
   Fix the large BLOCKED cluster caused by `VISIBLE_UI_CLICK_BLOCKED: text="新增帳號數"`.

2. result gate false-positive guard
   Prevent F-01-style local BLOCKED evidence from becoming full run upload failure.

3. picker stale signature
   Separate true metadata/UI drift from helper stale picker behavior.

4. package lint
   Prevent future Claude-generated packages from being human-readable but helper-unexecutable.

   Gen1c status: implemented as a compatibility-period warning in package consistency. This gives Claude/testcase generation feedback without blocking current legacy packages prematurely.

5. cloud feedback storage
   Store helper observations in cloud artifacts for future domain contract updates.

6. frontend observation routing guard
   Until Gen 3 has declarative observation templates, no-hints frontend observation cases must not fall back to generic preview helpers. Project/sidebar/list observations may use `openProject` as a prelude; editor initial-state observations may use `openProject + createReport`; all case-specific assertions require Codex visible UI or a future domain template. This prevents false `EXECUTE_PRECONDITION_NO_SELECTED_FIELDS` blockers like run `4bf277d7-6193-4943-9770-fc317a11ee1f` J/I cases.

7. official display-name drift bridge
   Gen1 bridge now keeps metadata identity matching strict while allowing search-query variants for official display labels. Example: metadata `線下商城GASH總營收` verifies against official `線下商城 GASH 總營收`; metadata `線下商城Coda總營收` searches official `線下商城 CODAPAY 總營收`. This should later move into the domain contract locator/display-name registry rather than staying hardcoded in helper runtime.

8. case scope / judgment contract
   Run `81455108-f612-4024-9d71-4f1995e08d7a` completed end-to-end, but Tommy's manual checkreport showed many invalid BLOCKED and judgment errors. The major class was not a single helper bug: agent planning, helper fallback, and result gate all failed to understand case scope. K/I/J/L/M/N-style UI observation cases must not be judged by preview-only evidence such as `selectedMetricFields=0`; B/L divergence must be classified by missing template/hints versus real UI reachability, not by assuming L could not expand the UI. This priority turns those lessons into contract/lint/gate rules before the next broad UAT report is treated as product defects.

## 10. P0 Scope Oracle and Vocabulary-First Reset

Trigger evidence:

- Dev run `1762c1b2-bc42-47f0-80b6-d1ef10a0f713` completed the reduced P0 scope smoke, but matched Tommy's manual oracle on only the obvious direct cases (`I-07`, `J-02`, `K-01`). The run proved containment and partial observation evidence are improving, but it did not prove result judgment correctness.
- Tommy's oracle file is `/Users/tommy/Downloads/codex_galaxy/BI_UAT_ROUNDS/p0_scope_smoke_20260517/P0_SCOPE_SMOKE_測試案例_BIUI_COLLAGE_R001_20260517_tommy_checkreport copy.md`.
- The oracle is a time-bound calibration artifact for this 15-case reduced smoke. It is not platform source of truth, not BI domain-pack source of truth, and not a mandatory artifact for every future testcase. It records what the product did for this authored testcase at the time Tommy manually verified it.

This resets P0 from "can the run continue?" to "can the tool route and judge authored UI cases correctly?". The next P0 work should be vocabulary-first:

1. Freeze the 15-case oracle as a regression fixture.
   The fixture compares tool judgment against Tommy's manual answers, but must not teach the runtime permanent product truth such as "B-09 always fails." B-09 is FAIL in this reduced testcase because the authored scope includes static-tab clickability. A future B-09-style testcase authored as preview date-range outcome only may still PASS when request/preview evidence is correct.

2. Add a platform action vocabulary.
   Generic verbs should be stable across domains: `click`, `hover`, `type`, `select`, `open`, `close`, `confirm`, `cancel`, `assertVisible`, `assertHidden`, `assertText`, `assertDisabled`, `assertEnabled`, `assertNoRequest`, `assertRequest`, `assertStateChanged`, and `assertStateUnchanged`.

3. Add a domain UI object vocabulary for official BI collage.
   The BI pack should name UI objects such as `dateRange.button`, `dateRange.panel`, `dateRange.timeTypeTab.dynamic`, `dateRange.timeTypeTab.static`, `dateRange.preset.past30Days`, `dateRange.preset.last30Days`, `reportPicker.searchInput`, `reportPicker.option.dailyReport`, `projectToolbar.downloadButton`, `projectToolbar.deleteButton`, `projectToolbar.createButton`, `projectList.rowDeleteAction`, `projectList.rowDeleteTooltip`, `validation.toast`, and `editorToolbar.downloadButton`.

4. Wire the planner and gates through structured action references.
   Testcases may keep Chinese prose, but the execution package should carry structured steps with `action`, `target`, `role`, `expectedOutcome`, and `evidenceRequirements`. Planner routing, capability gate, helper execution plan, interaction log, and result gate should all cite the same action/object identifiers. Route diagnostics must show, for example, that `K-10` targets `validation.toast`, `J-07` targets a hover tooltip, and `B-08/B-09/L-09` target `dateRange.timeTypeTab.static`.

5. Smoke before dev UAT.
   Codex must run offline routing/judgment fixtures and a small live smoke before asking Tommy for another dev run. The live smoke should prove at least one representative case for disabled toolbar state, default report mode, validation toast, date-panel open/cancel, hover tooltip product-gap classification, static-tab failure, source-report picker selection, and calculate/download/toast flow.

6. Regenerate the reduced testcase from the vocabulary.
   The next `P0_SCOPE_SMOKE_測試案例_BIUI_COLLAGE_R001_20260517` version should be generated from the action/object definitions, not hand-reworded only in prose. The Chinese step text can remain human-readable, but the structured execution hints should use canonical verbs and UI object IDs.

Layer ownership:

- Platform layer owns the generic action vocabulary, action lifecycle roles, interaction outcome taxonomy, MCP/browser preflight, DOM/ARIA/accessibility extractor, screenshot fallback, result gate, and oracle fixture runner.
- Domain pack layer owns official BI UI object IDs, aliases, locators, allowed evidence sources, domain action templates, and BI-specific state semantics.
- Testcase/run layer owns case-specific values, expected outcomes, `testTarget`, `judgmentPolicy`, risk level, cleanup policy, and optional structured action steps.
- Oracle fixtures own temporary human-verified expected results for calibration. They must be versioned with run/testcase context and must never be treated as required authoring input for normal UAT.

Recommended continuation of P0:

- P0.13: freeze the 15-case oracle fixture and compare current run output against it. Status 2026-05-18: implemented as `fixtures/p0-scope-smoke-20260517/oracle.json`, `fixtures/p0-scope-smoke-20260517/run-1762-results.json`, and `npm run verify:p0-scope-oracle`. Baseline comparison locks `1762c1b2-bc42-47f0-80b6-d1ef10a0f713` at 3 matches / 12 mismatches, with matching cases `I-07`, `J-02`, and `K-01`.
- P0.14: create platform action vocabulary and schema validation. Status 2026-05-18: implemented as `contracts/platform-action-vocabulary.v1.json`, `docs/refactor/platform-action-vocabulary-v1.md`, `fixtures/action-vocabulary/biui-collage-r001-v1-6-candidates.json`, `npm run verify:platform-action-vocabulary`, and `npm run verify:action-vocabulary-fixtures`. The shared platform contract now contains only generic action vocabulary. The BI/P0 extraction provenance and 15-case reduced-smoke mappings live only in fixture data and the fixture verifier. Platform verifier covers 42 generic actions; fixture verifier covers 23 extracted candidates and all 15 P0 reduced-smoke required action mappings.
- P0.15: complete official BI UI object map only for the 15-case scope first. Status 2026-05-18: implemented as `domain-packs/BI_OFFICIAL_UI_COLLAGE/ui-object-vocabulary.json`, with coverage fixture `fixtures/ui-object-vocabulary/biui-collage-r001-p0-required-objects.json` and verifier `npm run verify:bi-official-ui-object-vocabulary`. The shared domain vocabulary has 29 object ids for date range controls, toolbar buttons, row tooltip, report mode radio, source-report picker, validation/download toasts, and editor download flow. P0/case coverage remains only in fixture data.
- P0.15b: visually align the object vocabulary against the official UI screenshots before wiring runtime. Status 2026-05-18: implemented as `domain-packs/BI_OFFICIAL_UI_COLLAGE/discovery/visual-alignment.json` and verified by `npm run verify:bi-official-ui-object-vocabulary`. Tommy confirmation resolved the row-local action naming (`projectList.rowDeleteAction`), project-limit toast, download toast, and validation toast. The row delete tooltip plus static start/end date inputs are now known product gaps, not tool evidence gaps. `validation.toast` uses the row-indexed pattern `第 {rowIndex} 欄位，欄位未設置完成`; multiple incomplete rows produce multiple stacked messages. There are no remaining visual review items for the 29-object P0.15 scope.
- P0.16: connect planner/capability gate/helper plan/result gate to structured `action + target + expectedOutcome`. Status 2026-05-18: implemented as a runtime bridge via `domain-packs/BI_OFFICIAL_UI_COLLAGE/case-scope-runtime-contracts.json`, `agent/src/structured-case-scope.ts`, and `npm run verify:p0-runtime-wiring`. The bridge covers the 15 reduced P0 cases with `action`, `target`, `role`, `expectedOutcome`, and `evidenceRequirements`, then surfaces the same contract in `current-case-pack.json`, `capability-gate.json`, and `helper-execution-plan.json`. It also exposes `domain_case_scope_contracts` and `domain_ui_object_vocabulary` in run packets and adds result-gate structural validation when a detail_json cites `caseScopeContract`. This is still a compatibility bridge; it does not make the Tommy oracle permanent product truth and does not replace the later authored Gen4 interpreter.
- P0.17: run Codex offline route/judgment smoke against the oracle. Status 2026-05-18: implemented as `fixtures/p0-scope-smoke-20260517/offline-route-judgment-evidence.json` and `npm run verify:p0-offline-route-judgment`. The smoke uses synthetic current-evidence, not live browser state, to verify route and judgment behavior against Tommy's 15-case oracle. Result: 15/15 matches. It also locks the intended boundary that unsupported observation types such as sidebar toggle, row tooltip, project-limit toast, and source-report picker do not fall back to generic preview or the wrong `observeFrontendState` subtype; those require P0.19 template repair.
- P0.18: generate the next reduced xlsx/md from the canonical vocabulary. Status 2026-05-18: implemented as `npm run generate:p0-vocabulary-reduced-package` plus `npm run verify:p0-vocabulary-reduced-package`. The generator reads the 15-case runtime contracts, platform action vocabulary, and BI UI object vocabulary, then writes a new reduced package in `/Users/tommy/Downloads/codex_galaxy/BI_UAT_ROUNDS/p0_scope_smoke_20260517/`: `P0_SCOPE_SMOKE_測試案例_BIUI_COLLAGE_R001_20260518_vocab_v1.xlsx`, `P0_SCOPE_SMOKE_測試執行說明_BIUI_COLLAGE_R001_20260518_vocab_v1.md`, and `P0_SCOPE_SMOKE_Codex_指派文字_BIUI_COLLAGE_R001_20260518_vocab_v1.md`. The xlsx now includes a structured `步驟` sheet with 38 canonical action rows and a `Vocabulary Contract` sheet; the `測試標的` column is aligned to the contract policy, and result/detail fields remain empty so Tommy's oracle is not embedded as product truth.
- P0.19: repair remaining action templates under the new structure. Status 2026-05-18: implemented as `npm run verify:p0-live-action-templates`. The runtime now routes all 11 reduced frontend-observation cases to `collage.observeFrontendState`, including `sidebarGroup`, `rowDeleteTooltip`, `projectLimitToast`, and `sourceReportPicker`, with no preview fallback. The helper executor now performs visible UI actions for sidebar toggle, row delete hover tooltip, project-limit create toast, source-report picker open/search/select, date panel cancel/static tab flows, validation toast/no-request, and editor download toast. Observation helper status remains `ok` when current-run evidence is collected even if `asserted=false`, leaving FAIL/BLOCKED judgment to the case-scope/result layer instead of masking product failures as helper BLOCKED.
- P0.20: run a small live smoke, then ask Tommy for the next dev live UAT only after local evidence is clean.
- P0.21: isolate Codex result-write/runtime failures after helper evidence exists. Status 2026-05-19: implemented after run `e352cf8b-213b-4bbb-8c4a-674070a8df3f` stopped at B-12 despite completed helper evidence. Date-variant helper evidence now exposes stable `networkEvidence`, `tableSummary`, `judgmentSummary`, and `comparison` fields, and Agent writes a single-case `BLOCKED / CODEX_RUNTIME_RESULT_WRITE_FAILED` containment workbook only when Codex crashes after current-run helper evidence and package/document consistency has no error. This is a compatibility fail-isolation bridge, not a Gen4 judgment engine and not a product FAIL/PASS decision.
- P0.22: isolate result upload transport failures. Status 2026-05-19: implemented after run `01e9c8e6-07b5-45ba-9309-48e3863091dd` stopped at B-04 even though Codex had written trusted `output/result.xlsx`. Result workbook upload now retries transient transport/server failures, and partial diagnostics preserve an existing trusted result workbook instead of overwriting the local status as agent-fallback-only. Verification entrypoint: `npm run verify:result-upload-retry`.
