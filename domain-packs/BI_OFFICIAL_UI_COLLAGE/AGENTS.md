# BI Official UI Collage Domain Pack

You are executing Galaxy Next BI UAT for the official frontend UI, collage mode.

This domain pack is the domain entrypoint downloaded as `input/domain_AGENTS.md` by the UAT Tool Mac Agent. The uploaded testcase workbook and instruction markdown remain the run-specific source of truth, but this file defines the stable domain boundary.

## Scope

In scope:

- Galaxy Next BI official frontend dev/RC site.
- Collage mode only.
- Existing OTTEST004-style data-logic regression cases.
- Official UI behavior cases for entry navigation, sidebar, project page, report editor, time picker, save/update/copy, download, delete, hover, tooltip, modal, toast, and enabled/disabled button states.

Out of scope:

- Full record-centric mode testing.
- Full metric-centric mode testing.
- Right-top game selector switching flow.
- Direct API testing as the primary result source.

Record-centric and metric-centric radio controls may be checked for existence or non-scope guard behavior only when a collage UI case explicitly asks for it.

## Specification Priority

Use this priority order:

1. PRD.
2. Official UI screenshots and live dev/RC site.
3. Existing OTTEST004 44-case test package.
4. Shared BI UAT rules and project instructions.

If PRD and live UI conflict, expected behavior follows the PRD. Record the live UI behavior as actual evidence and judge according to the case target.

## Fixed Preconditions

- Start URL is run-package specific. Supported official UI prefixes are `/bi-dev` and `/bi-rc`; do not hard-code one environment when the uploaded package/run brief points to the other.
- Tommy must complete SSO in the same Playwright session before trusted UAT execution.
- Do not use right-top game selector switching as a test precondition unless the uploaded testcase explicitly asks for it.
- For normal create-project cases, the uploaded package should declare whether the collage project count must be `<= 4`. If the count is already 5 or more, report environment not ready; do not delete projects to reduce the count.
- For project-limit cases, prefer a separate package with an explicit PM-prepared 5-project state or a verified precondition builder and cleanup policy. Do not mix project-limit setup into a long full-run package unless the testcase explicitly scopes that side effect.
- The current official UI does not expose `自某日至昨日` / `自某日至今` as single visible date preset buttons. Do not require them in visible preset-list assertions. If a testcase needs that behavior, model it as a composite start/end date-control flow, not as `dateRange.preset.*`.

## UI Text Judgment

UI text is judged by semantic equivalence, not exact string matching.

PASS is allowed when punctuation, spacing, or wording differs but the user-facing meaning is unchanged.

FAIL is appropriate when the text changes the meaning, omits a required PRD warning, hides a required limit, or misleads the user.

For PRD-defined toasts, modal warnings, and validation messages, always record the actual text in `detail_json`, even when judging semantic equivalence.

For hover or tooltip cases without PRD-specified text, verify that hover/tooltip UI appears. Do not fail only because the wording is absent from the PRD.

## Resource Policy

Allowed:

- Create temporary projects.
- Create temporary reports.
- Delete temporary projects created for the run.
- Delete temporary reports created for the run.
- Delete previous UAT-created reports when the testcase identifies them as test resources.

Forbidden:

- Delete Tommy-designated retained resources.
- Delete main test projects.
- Delete production/business reports.
- Delete existing resources whose source is unclear.

Every delete confirmation is irreversible. Even when the testcase says deletion is in scope, stop before clicking the final confirm/delete button and request explicit Tommy or Tool Bridge authorization. Record the authorization and deletion action in `detail_json`.

## Core Execution Rules

- Execute one case at a time.
- Do not batch multiple cases in one helper or one result write.
- Set BI state through visible UI only.
- Do not call BI APIs directly to obtain trusted test results.
- Do not use internal JavaScript setters or app state mutation.
- Do not use evaluate to click, fill, close, or mutate UI state.
- Read-only DOM, table, Chart.js, and network observation are allowed as evidence after visible UI actions set the state.
- Screenshots are supporting evidence only. `detail_json` must include actual visible text, state, or numbers.

## Action Verification

Every claimed UI action must be verified after the action:

- Expand/collapse -> target list appears or disappears.
- Checkbox select -> checkbox state and batch button state update.
- Button click -> modal, route, toast, table, or disabled/enabled state changes.
- Input -> visible value equals the entered value.
- Dropdown selection -> visible label and DOM state match.
- Time picker confirmation -> button label and request/body semantics match.
- Calculation -> preview request or result table changes.
- Save -> modal closes and report appears in project list.
- Delete cancel -> modal closes and row remains.
- Delete confirm -> row disappears and success/feedback appears.
- Download -> browser download event, attachment response, or user-facing download feedback appears.
- Hover -> expected control or tooltip appears.

If a tool reports success but the page state does not change, do not assume success. Judge according to the case target and evidence.

## Test Target Judgment

- `前端呈現`: UI state, visible text, layout, modal, tooltip, or enabled/disabled behavior can directly PASS/FAIL.
- `功能流程`: flow breakage is FAIL. Minor UI text difference that does not affect the flow can PASS with observation.
- `前後端整合`: UI state, request body, response, and rendered result must align. Any layer mismatch can FAIL.
- `後端功能`: data logic is primary. If UI prevents trusted data execution, mark BLOCKED or create a separate UI bug as instructed by the testcase.

## Expected UI Case Groups

Recommended official UI groups:

- I: Entry and sidebar.
- J: Project page buttons and list states.
- K: New/edit report setting page.
- L: Time range tool.
- M: Save/update/copy.
- N: Download and result table.

The uploaded testcase may use different group letters. Follow the uploaded package when it is more specific.

## Result Writing

Use the BI result parser contract:

- PASS detail_json minimum fields: `測試目的`, `設定條件`, `預期行為`, `實際行為`.
- FAIL detail_json must also include `錯誤原因`, `根因層級`, `驗證方法`, `RD 分派`.
- BLOCKED detail_json must include `blocked_reason`.
- PARTIAL detail_json must include matching and non-matching sub-items.

When writing a FAIL result, create a Bug row whose `關聯編號` exactly matches the failed case number unless the uploaded run-specific instruction says otherwise.
