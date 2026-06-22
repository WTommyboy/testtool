# Player Tag Tool Domain Pack

You are executing Galaxy Next UAT cases for the player tag tool domain pack: `TAG_TOOL`.

This is a BI Web feature domain because the tool supports BI Group By usage, but it is not the BI official UI collage/report-editor domain. Do not apply collage project/report/field-picker contracts unless a testcase explicitly asks for comparison evidence.

## Scope

In scope:

- Galaxy Next BI Web dev/RC player tag management at `工具設置 > 標籤 > 玩家標籤管理`.
- Tag list columns, empty/list states, row checkbox selection, pagination, row action menu, delete/terminate confirmation dialogs, and copy entry flow.
- Create tag page initial state, condition tag setup, manual tag CSV upload setup, validation toasts, and cancel paths.
- Condition tag time type behavior: `動態時間區間`, `靜態時間區間`, `依報表區間設置`, `首次後持續累計`.
- Condition tag value setup: initially empty, add up to 10 tag values, each tag value has at most two numeric conditions.
- Manual tag add/edit CSV behavior: add format has 2 columns; edit format has 3 columns with `add/update/delete`.
- Read-only condition tag settings page.
- Tag information pages for condition/manual tags, including drill list sorting rules when visible data exists.
- Tag variable settings for N/Z/Y/X/A/B, steppers, validation, save confirmation evidence, and setting-history timestamp format.

Out of scope:

- BI collage/report editor project lifecycle, source reports, metric rows, field pickers, chart preview execution, and report download behavior.
- System-created internal tags (`ID狀態`, `玩家生命週期`, `動態標籤`) as editable/listed user resources, except their N/Z/Y/X/A/B variable settings page.
- Direct backend schedule verification that requires cross-day waiting, unless the testcase package declares a focused environment and observation window.
- Direct API mutation or database inspection as the primary PASS/FAIL source.
- Production execution unless the run package explicitly targets prod and Tommy authorizes it.

## Specification Priority

Use this priority order:

1. `BI工具衍伸_標籤工具_v1.3.4` PRD.
2. Official live dev/RC UI and prototype notes from `galaxy_prototype/player_tag_tool`.
3. Uploaded testcase workbook and run-specific instruction markdown.
4. Common UAT Tool rules.

If PRD and live UI conflict, expected behavior follows the PRD unless the run-specific instruction states that live UI is the accepted source for that case. Record the actual live UI as evidence and classify the mismatch as product drift or a product bug according to the testcase target.

## Fixed Preconditions

- Start URL is run-package specific. Current dev preflight URL is `https://galaxy.games.gamania.com/bi-dev/zh-TW/tag/player?gameId=541`.
- Current dev create route is `/bi-dev/zh-TW/tag/player/new?gameId=541`.
- Current dev variable settings route is `/bi-dev/zh-TW/tag/settings?gameId=541`.
- Tommy must complete Galaxy SSO in the same browser session before trusted UAT execution.
- Use the selected `gameId` from the run package. Do not switch game/project unless the case explicitly asks for it.
- Temporary resources must use a clear UAT prefix such as `UAT_TAG_YYYYMMDD_HHMM_<purpose>`.
- Avoid relying on schedule status changes that require D+1 unless the case is in a dedicated cross-day package.

## Dev Test Data Windows

Use these known `gameId=541` dev data windows for condition-tag testcase authoring and execution unless the uploaded run package explicitly overrides them. Treat the year as 2026.

- `累積遊戲時間` / gameplay: use `2026-03-04` through `2026-03-31`.
- `累積登入天數`: data exists from `2026-06-01`; use June 2026 onward.
- `消費級距 R` / accumulated spend: order data exists in January 2026 and March 2026.
- `累積未登入天數`: use June 2026 onward.

For static or dynamic analysis-period tests, keep the selected range within the PRD 90-day limit and record the exact date range in `detail_json`.

## UI Text Judgment

UI text is judged by semantic equivalence for normal labels and helper text. Exact or near-exact text is required for PRD-defined destructive dialogs, validation toasts, CSV format guidance, and variable-setting validation messages.

Always record actual visible text in `detail_json` for dialogs, toasts, upload guidance, row action menus, and setting-history rows.

## Resource Policy

Allowed in ordinary dev smoke:

- Create clearly named temporary condition tags when the case is explicitly about successful create flow.
- Create clearly named temporary manual tags with small synthetic CSV fixtures.
- Open delete/terminate dialogs and cancel them.
- Download sample CSV files or list exports when no sensitive data is exposed.

Forbidden without explicit Tommy approval at action time:

- Confirm delete of any tag.
- Confirm terminate of an active scheduled condition tag.
- Save tag variable settings.
- Submit manual tag edit files that update or delete existing member lists.
- Delete or modify existing resources whose origin is unclear.

Every irreversible action must be approved outside testcase prose. Record the approval and final action in `detail_json`.

## Core Execution Rules

- Execute one case at a time.
- Use visible UI only for setup and execution.
- Do not call product APIs to create tags, update variables, terminate schedules, or inspect database state.
- Do not use internal JavaScript setters, DOM mutation, or forced clicks to bypass UI controls.
- Read-only DOM, network, table, download, console, and screenshot evidence is allowed after visible UI actions.
- Screenshots are supporting evidence only. `detail_json` must include structured visible text, state, values, or artifact paths.

## Action Verification

Every claimed UI action must be verified:

- Navigation -> URL/breadcrumb/page title matches the target page.
- Dropdown selection -> visible selected label and dependent controls update.
- Date panel -> panel opens through visible UI, chosen range is visible, 90-day warning or disabled behavior is captured when relevant.
- Add tag value -> left list and right editor state update.
- CSV upload -> file chip/list state and validation toast or accepted-state text appear.
- Row menu -> menu items match tag type and schedule status.
- Dialog cancel -> modal closes and row/resource remains.
- Variable stepper/input -> visible numeric value changes or validation toast appears.

If a tool reports success but the page state does not change, do not assume success. Judge according to the testcase target and evidence.

## Test Target Judgment

- `前端呈現`: visible UI state, text, layout, disabled/enabled state, dialog, toast, and table/list composition can directly PASS/FAIL.
- `功能流程`: flow breakage is FAIL; minor wording drift can PASS only when meaning and flow are intact.
- `前後端整合`: UI state, request/response when observable, list refresh, and persisted/reopened state must align.
- `後端功能`: direct backend schedule/history correctness usually needs a dedicated package; if the UI prevents trusted observation, mark BLOCKED or split the case.

## Result Writing

Use the common result parser contract:

- PASS detail JSON minimum fields: `測試目的`, `設定條件`, `預期行為`, `實際行為`, `證據`.
- FAIL detail JSON must also include `錯誤原因`, `根因層級`, `驗證方法`, `RD 分派`.
- BLOCKED detail JSON must include `blocked_reason`.
- PARTIAL detail JSON must include matched and non-matched sub-items.

When writing a FAIL result, create a Bug row whose `關聯編號` exactly matches the failed case number unless the uploaded run-specific instruction says otherwise.
