# TAG_TOOL Domain Intake Draft

## 1. Basic Info

- Feature / tool name: Galaxy Next BI Web 玩家標籤工具
- Proposed domain pack name: `TAG_TOOL`
- Owner / PM: Tommy
- Target environment: Galaxy dev first; RC/prod only after explicit promotion decision
- Dev URL: `https://galaxy.games.gamania.com/bi-dev/zh-TW/tag/player?gameId=541`
- Production URL, if known: not confirmed
- Required SSO / login precondition: Galaxy SSO in the same browser session
- Target UAT Tool environment for first run: dev

## 2. Why This Is A New Domain Pack

- New UI: `工具設置 > 標籤 > 玩家標籤管理`, not BI report editor or collage project page.
- New product area: tag CRUD/setup, CSV upload, schedule status, tag information, variable settings.
- New execution discipline: file upload and destructive action authorization are first-class concerns.
- New evidence / result contract: list columns, row menus, upload file state, readonly settings, variable history, toasts, and dangerous modals.
- Existing helper / locator reuse: generic BI shell, SSO, date panel evidence pattern, modal/toast/table/download mechanics.

## 3. Source Materials

### PRD / Spec

- Primary PRD: `/Users/tommy/Downloads/galaxy_prototype/player_tag_tool/BI工具衍伸_標籤工具_v1_3_4.md`
- Prototype prompt: `/Users/tommy/Downloads/galaxy_prototype/player_tag_tool/codex_prompt_player_tag_tool_prototype.md`
- Overview deck: `/Users/tommy/Downloads/galaxy_prototype/player_tag_tool/銀河標籤系統_標籤工具_Overview.pptx`

### UI References

- Live preflight: completed on 2026-06-22 in in-app browser after Tommy completed SSO.
- Known UI drift from PRD: see `domain-packs/TAG_TOOL/discovery/live-inventory-2026-06-22.md`.
- Live UI inventory refresh: completed on 2026-06-23 with Playwright against dev URL. See `domain-packs/TAG_TOOL/discovery/live-inventory-2026-06-23-dev-ui.md`.
- 2026-06-23 domain pack updates: refreshed `discovery/page-map.json`, `discovery/component-inventory.json`, `ui-object-vocabulary.json`, `action-contracts/tagList.json`, `action-contracts/manualUpload.json`, and added `action-contracts/tagInfoReadOnly.json`.
- 2026-06-23 live dev state note: player tag list was populated with 28 rows; tests must not assume the previous empty-list state.
- 2026-06-23 live dev route note: tag info uses `/bi-dev/zh-TW/tag/player/:tagId?gameId=:gameId`; condition settings uses `/bi-dev/zh-TW/tag/player/:tagId/settings?gameId=:gameId`.

### Existing Test Assets

- Existing testcase xlsx: none confirmed for TAG_TOOL.
- Existing cases to preserve: none confirmed; BI official UI collage cases must remain separate.

## 4. Scope

### In Scope

- Player tag management list and row action menus.
- Create condition tag and manual tag pages.
- Manual CSV upload guidance and validation.
- Condition tag read-only settings.
- Manual tag edit upload guidance.
- Tag information pages and member table sorting when data exists.
- Tag variable settings and setting history.

### Out Of Scope

- BI official UI collage project/report editor behavior.
- Direct schedule correctness requiring cross-day observation in the first smoke package.
- System-created built-in tags as user-created list entries.
- Direct product API mutation/database checks as primary evidence.

## 5. Specification Priority

1. PRD v1.3.4.
2. Live official dev/RC UI and prototype notes.
3. Uploaded testcase package.
4. Common UAT rules.

Conflict handling:

- PRD vs UI: expected follows PRD; record live actual as drift/bug unless run-specific instruction overrides.
- Existing testcase vs PRD: update testcase intent only after PM decision.
- Screenshots/prototype vs live UI: live UI is actual evidence; PRD remains oracle.

## 6. Test Data And Resource Policy

- Allowed to create temporary resources: yes, dev only, with `UAT_TAG_YYYYMMDD_HHMM_<purpose>` names.
- Allowed to update existing resources: no, unless resource was created by the same run and testcase declares it.
- Allowed to delete temporary resources: only after explicit Tommy approval at action time.
- Allowed to delete existing UAT-created resources: only when origin and approval are clear.
- Resources that must never be deleted: any non-UAT or unclear tag.
- Cleanup expectation after run: leave created resources unless a dedicated cleanup package is approved.

## 7. UI Text And Visual Rules

- Text matching: semantic for normal labels; exact or near-exact for destructive dialogs, CSV guidance, and validation toasts.
- Tooltip text required: appearance plus PRD text when specified.
- Hover-only controls in scope: yes when referenced by testcase.
- Disabled / enabled states in scope: yes.
- Responsive viewport requirements: desktop first; mobile not in first smoke.

## 8. Execution Constraints

- Must use visible UI: yes.
- API usage allowed only for observation: yes, after visible UI state is set.
- Internal JS setters prohibited: yes.
- Read-only DOM / network extraction allowed: yes.
- One-case-at-a-time requirement: yes.
- Irreversible action approval: required for delete, terminate, variable save, and manual edit mutation.
- Required screenshots / evidence: screenshot supports but does not replace structured DOM/text/file evidence.

## 9. First Smoke Groups

- Navigation/list inventory.
- Create page type-switch states.
- Condition tag date panel and value editor.
- Manual tag upload add-mode guidance and invalid CSV validation.
- Read-only condition settings when a fixture tag exists.
- Tag variable settings default/current values and validation toasts without saving.

## 10. R0007 Layer Classification Baseline

Source run:

- Run ID: `680cb849-29d2-422d-916d-c4e27910aecb`
- Round: `NU_TAG_p0_R0007`
- Result: 14 PASS, 26 BLOCKED, 1 PARTIAL, 47 PENDING; execution stopped at `BIUI_TAG_R001-E-08`.

Baseline judgment:

- Do not interpret high BLOCKED count as product failure by itself.
- TAG_TOOL is a separate domain pack from BI official UI collage. The correct first read is whether the platform, TAG domain pack, testcase, and fixture layer supplied enough contracts/data for Codex to execute and judge.
- Product bug classification requires concrete same-case live evidence after layer gates are satisfied.

Layer classification observed:

- Platform lifecycle / result pipeline:
  - `BIUI_TAG_R001-E-08` generated Tool Bridge request/auto response evidence, then Codex resume failed with `thread/resume failed: no rollout found...`.
  - C-02 produced a contained case row but still surfaced an auto-generated P2 Bug row; this is report/result cleanup, not trusted product evidence.
- Domain pack / action contract:
  - Broad `CAPABILITY_GATE_degraded` / helper skipped means TAG-specific helpers and contracts are still incomplete.
  - Many `TOOL_EXECUTION_UNAVAILABLE` rows lack proper browser preflight evidence. The result gate is right to contain them for rejudgment.
- Testcase / fixture:
  - A-05 requires a known empty-list environment.
  - B-04 requires a known tag with note longer than 20 chars.
  - B/C/F/G/H/J/L/M groups require stable condition/manual/report-period/ended/editable tag fixtures.
  - E/G upload validation cases require controlled CSV fixtures and expected toast strings.
- Product:
  - No R0007 row should be promoted to product bug unless it has current-run UI evidence that survives the above layer checks.

## 11. Required TAG_TOOL Domain Pack Additions

Priority action contracts:

- `tagList.openRowMenu`: locate row by tag type, condition category, filter/time type, schedule status, and optional fixture name; open overflow menu; return visible menu items and URL state.
- `tagList.navigateByName`: click only link-enabled tag names; distinguish non-clickable report-period condition tags.
- `createConditionTag`: complete condition tag flow through visible UI, including condition category, filter type, analysis period, child ranges, validation toasts, and save result.
- `manualUpload`: cover add-mode upload, selected-file chip state, remove-file chip, add-file button, file count limit, CSV validation toast, and save confirmation.
- `manualEditUpload`: cover edit-mode CSV actions `add`, `update`, `delete`, duplicate conflict, nonexistent ID, and empty child-tag cleanup.
- `tagInfoReadOnly`: read condition/manual tag info pages, table rows, chart/list evidence, filters, pagination, and download controls.
- `tagVariableSettings`: read current values/history, validate stepper/manual input, and isolate save flows behind explicit safe sandbox rules.
- `destructiveTagAction`: model delete/terminate modal observation, cancel, and confirmation with Tool Bridge authorization and temporary fixture ownership.

Evidence schema additions:

- Stable `tagRow` object with fields: tag name, tag type, condition category, filter type, schedule status, last update time, note, link enabled, row action availability.
- Stable `menuState` object with visible item list, disabled state, active URL before/after click, and screenshot path only as supplemental evidence.
- Stable `uploadState` object with selected files, accepted/rejected rows, unique account count, child-tag values, validation toast, and save request observation.
- Stable `fixtureRef` object to record which precreated tag/resource the case used and why it is safe to mutate or delete.

## 12. Required Test Data / Fixture Inventory

The next TAG_TOOL package should not rely on whatever rows happen to exist in dev. Prepare or document fixture resources before full UAT:

- Empty-list environment or isolated game/project where tag list is intentionally empty.
- Ongoing condition tag fixture with known menu items and link-enabled info page.
- Ended condition tag fixture with expected no-terminate menu behavior.
- Report-period condition tag fixture where tag name is intentionally not clickable.
- Long-note tag fixture with note length greater than 20 characters.
- Manual tag fixture with known members and child-tag values.
- Editable manual tag fixture safe for edit-mode upload tests.
- Tag info fixture with enough daily/list rows for sorting, pagination, filter, chart, and download checks.
- Variable settings sandbox where save can be tested without affecting shared business data.
- CSV fixture files:
  - valid add-mode 2-column CSV,
  - valid edit-mode 3-column CSV,
  - wrong header / malformed row CSV,
  - greater-than-10000-row CSV or generated fixture reference,
  - duplicate ID with conflicting tag value,
  - nonexistent account ID,
  - multi-file set for selected-file chip and limit tests,
  - `.txt` file for type rejection.

Implemented in domain pack on 2026-06-27:

- `domain-packs/TAG_TOOL/fixtures/requirements.json` now records required resource fixtures, file fixtures, and the `BLOCKED_FIXTURE_MISSING_*` judgment policy.
- CSV/text file fixtures now exist for valid add, valid edit, invalid header, duplicate conflict, nonexistent account, and invalid file type.
- `overLimitCsv` is intentionally generated by helper at runtime instead of committed as a large file.
- `fixtureRef.state` is now part of TAG evidence schema and is required by CSV-validation style evidence rules.
- `tagList` action contract now includes list pagination, row-name link navigation, row-action menu opening by row criteria, and row-action route verification.
- `manualUpload` action contract now includes file accept observation, no-file submit validation, upload validation fixture flows, multi-file selection, and selected-file chip removal.
- `createConditionTag` action contract now includes condition category/filter type/bound operator option observation, date preset/range-limit observation, tag-value limit checks, and invalid tag/sub-tag/value/note validation flows.
- `ui-object-vocabulary.json` now names the TAG list row/menu/pagination objects, condition form controls, date range controls, manual upload file/chip controls, tag info read-only objects, and variable history objects needed by those contracts.
- `evidence-schema.json` now includes pagination, row-link, condition form, manual upload file-input, and form-validation state objects so missing evidence can be classified as contract/fixture gap instead of product bug.
- Runtime planning smoke now routes manual upload wording to deterministic flows/fixtures such as `uploadDuplicateConflictCsv`, `uploadNonexistentAccountCsv`, `uploadOverLimitCsv`, `uploadInvalidTypeFile`, `submitWithoutFile`, and `uploadMultipleFiles`.

Still missing real environment resources:

- Empty-list environment.
- Known ongoing / ended / report-period condition tags.
- Known long-note tag.
- Editable manual tag owned by UAT.
- Tag variable settings sandbox safe for save mutation.

## 13. Package Hygiene To Fix Before Next Full TAG Run

- Remove BI/collage wording from TAG report metadata. `功能` should be `標籤工具 / 玩家標籤管理` or the precise TAG subfeature, not `標籤工具 / 拼貼模式`.
- Mark fixture-dependent cases explicitly. If fixture is absent, expected result should be `BLOCKED_FIXTURE_MISSING`, not a generic product fail.
- For frontend observation cases, require either structured DOM evidence or a complete visual fallback contract; screenshot alone is not a PASS/FAIL proof.
- For irreversible actions, prefer temporary fixtures created by the same run and record fixture ownership in `detail_json`.
