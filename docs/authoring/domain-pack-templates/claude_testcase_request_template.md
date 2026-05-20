# Claude Testcase Request Template

> Purpose: prompt Claude to generate a three-document UAT package after the domain intake is ready.
> Replace all placeholders before sending. Attach files if Claude cannot read local paths.

---

Please create a new UAT three-document package for `<FEATURE_NAME>`.

## Context

This is a new UAT Tool domain package, not an ad-hoc one-off testcase update.

Previous version / related package:

- `<OLD_PACKAGE_NAME_OR_NONE>`

What changed:

- `<DESCRIBE_NEW_UI_OR_NEW_FUNCTIONAL_SCOPE>`

What must remain:

- `<DESCRIBE_CASES_OR_RULES_TO_PRESERVE>`

## Required Reading Order

1. Common authoring rules:
   - `<PATH_TO_COMMON_AUTHORING_RULES>`
2. Domain intake:
   - `<PATH_TO_DOMAIN_INTAKE>`
3. Domain boundary rules:
   - `<PATH_TO_BOUNDARY_RULES>`
4. Platform/domain boundary:
   - `uat-tool/agent-skills/uat-tool/rules/platform-domain-boundary.md`
   - `uat-tool/contracts/platform-action-vocabulary.v1.json`
5. Domain pack contracts, if already drafted:
   - `<PATH_TO_UI_OBJECT_VOCABULARY_OR_NONE>`
   - `<PATH_TO_ACTION_CONTRACTS_OR_NONE>`
   - `<PATH_TO_EVIDENCE_SCHEMA_OR_NONE>`
   - `<PATH_TO_SHARED_LIFECYCLE_ACTION_CONTRACTS_OR_NONE>`
6. PRD / spec:
   - `<PATH_TO_PRIMARY_PRD>`
   - `<PATH_TO_SECONDARY_PRD_IF_ANY>`
7. UI references:
   - `<PATH_TO_SCREENSHOT_FOLDER>`
   - `<PATH_TO_LIVE_PREFLIGHT_SCREENSHOTS_IF_ANY>`
8. Existing testcase package:
   - `<PATH_TO_OLD_XLSX>`
   - `<PATH_TO_OLD_CODEX_ASSIGNMENT_MD>`
   - `<PATH_TO_OLD_EXECUTION_INSTRUCTION_MD>`

## Specification Priority

Use this exact priority:

1. `<PRIMARY_PRD_OR_SPEC>`
2. `<OFFICIAL_UI_OR_DESIGN_REFERENCE>`
3. `<OLD_TESTCASE_PACKAGE>`
4. `<COMMON_UAT_RULES>`

If sources conflict, expected result must follow the highest-priority source. Record lower-priority differences as drift, risk, or possible bugs.

## Case Preservation Rules

- Existing cases to preserve: `<COUNT_OR_LIST>`
- Do not delete preserved cases.
- Do not merge preserved cases.
- Do not change preserved cases' validation purpose.
- If the UI path changed, update only preconditions, steps, and execution notes.
- Keep old skipped / blocked status only when the domain intake explicitly says so.

## New Case Requirements

Add new cases for:

- `<GROUP_1>`
- `<GROUP_2>`
- `<GROUP_3>`
- `<GROUP_4>`

Required edge cases:

- Duplicate names:
- Upper limits:
- Empty state:
- Disabled / enabled state:
- Cancel path:
- Delete confirmation path:
- Hover / tooltip:
- Download / export:

## Shared Lifecycle Requirements

Before generating cases, identify any repeated cross-case user journeys. Do not express these only as varied natural-language steps.

For each lifecycle below, state whether it is in scope and which action contract should cover it:

| Lifecycle | In scope? | Existing / required action contract | Notes |
| --- | --- | --- | --- |
| Create resource -> modal -> cancel/save |  |  |  |
| Save resource -> list page -> find row -> reopen |  |  |  |
| Copy resource -> save -> verify copied row |  |  |  |
| Delete action -> confirm modal -> cancel/confirm |  |  |  |
| Picker/date preset -> apply -> verify state |  |  |  |
| Download/export -> artifact/toast/result verify |  |  |  |

If a testcase needs one of these lifecycles but the domain pack does not yet declare it, flag the case as `ACTION_TEMPLATE_MISSING` for Codex review instead of inventing a one-off wording workaround.

## Execution Rules

- Test execution must use visible UI.
- Do not design direct API calls as test steps.
- Do not ask Codex to use internal JS setters to create state.
- Read-only DOM, network, chart, table, or download evidence is allowed after visible UI operations.
- Every case must be independently executable.
- Every case must support one-case-at-a-time result writing.
- Irreversible actions require explicit Tommy approval during execution; testcase prose is not approval.
- Use canonical platform actions where possible, such as `click`, `hover`, `type`, `select`, `openModal`, `cancelModal`, `confirmModal`, `assertVisible`, `assertDisabled`, `assertEnabled`, `assertNoRequest`, `addRow`, `duplicateRow`, and `deleteRow`.
- When a step targets a domain UI element, reference the domain UI object id if available. If no object id exists, record it as a domain-pack gap instead of inventing a runtime workaround in the testcase.
- Do not put reusable UI object definitions, locator hints, helper behavior, or result-gate workarounds in testcase prose. Those belong in the domain pack or platform contracts.
- Do not duplicate shared lifecycle details differently across cases. Use the same lifecycle name and only vary case-specific values such as resource name, expected preset, row count, or expected message.
- If a testcase requires a domain action not yet covered by the domain pack, flag it as `ACTION_TEMPLATE_MISSING` / `DOMAIN_OBJECT_MISSING` for Codex review before live execution.

## Xlsx Format

Use the current UAT v2.0 fields:

`輪次ID, 群組ID, 群組, 編號, 測試類型, 測試項目, 風險等級, 測試標的, 狀態清理, 前置條件, 步驟, 預期結果, 結果, 執行方式, 測試日, 詳細紀錄JSON, 驗證方法`

Leave result fields blank unless the intake explicitly defines prefilled terminal rows.

## Required Output

Produce:

1. `testcase.xlsx`
2. `Codex_指派文字_*.md`
3. `測試執行說明_*.md`
4. Case group summary
5. Risk distribution summary
6. Source conflict / drift list

Before producing final files, first show:

- Your understanding of scope.
- Which existing cases will be preserved.
- Proposed new case groups and counts.
- Any blocking questions.
