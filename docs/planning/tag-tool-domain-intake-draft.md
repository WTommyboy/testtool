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
