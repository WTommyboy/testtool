# TAG_TOOL Boundary Rules

## 1. Domain Identity

- Domain pack: `TAG_TOOL`
- Feature: Galaxy Next BI Web 玩家標籤工具
- Version: PRD v1.3.4
- Applies to: `工具設置 > 標籤 > 玩家標籤管理`, `標籤變數設定`
- Does not apply to: BI official UI collage/report editor cases

## 2. Authority And Priority

Specification priority:

1. PRD v1.3.4.
2. Official live dev/RC UI and prototype notes.
3. Testcase package.
4. Common UAT Tool rules.

Conflict handling:

- PRD vs UI: expected follows PRD; record live UI actual.
- PRD vs old testcase: revise testcase package, do not weaken PRD oracle silently.
- UI screenshot vs live UI: live UI is actual evidence; screenshot/prototype is reference.

## 3. Scope

### In Scope

- Tag list columns, row selection, empty/list states, row action menu.
- Create condition/manual tag setup flows.
- Manual CSV upload add/edit format guidance and validation.
- Condition tag read-only settings page.
- Tag info pages and drill/member table sorting where data exists.
- Tag variable settings N/Z/Y/X/A/B, steppers, validation, history time format.

### Out Of Scope

- Full BI report editor/collage lifecycle.
- Backend-only schedule correctness without visible UI evidence.
- Cross-day D+1 termination verification in ordinary smoke.
- Direct API mutation/database checks as oracle.

## 4. Required Preconditions

- URL: `https://galaxy.games.gamania.com/bi-dev/zh-TW/tag/player?gameId=541`
- Login / SSO: Tommy must be logged in in the active browser session.
- Game / tenant / project: `gameId=541` unless run package overrides.
- Test data state: temporary tags must use `UAT_TAG_` prefix.
- Project count / limits: not applicable to this domain.
- Browser session: Playwright visible UI session; no internal JS mutation.

## 5. New Case Design Rules

- Smoke cases should prefer observation, cancel, validation, and fixture upload paths before creating/deleting real data.
- Successful create cases must use clearly named temporary resources and must state cleanup expectations.
- Delete, terminate, variable save, and manual edit submit are high risk; split them into focused packages.
- Manual add CSV fixtures must use two columns: `標籤值名稱,帳號ID`.
- Manual edit CSV fixtures must use three columns: `標籤值名稱,帳號ID,操作`.
- Date panel cases must record mode, visible presets, selected label, 90-day warning/limit, and no unwanted request when applicable.
- Read-only condition settings cases must verify disabled/read-only state and absence of mutation controls.

## 6. Platform / Domain / Testcase Placement

### Platform Reuse

| Requirement | Platform artifact |
| --- | --- |
| Browser/session isolation | platform runtime |
| Generic click/type/select/upload/download/modal actions | `contracts/platform-action-vocabulary.v1.json` |
| Evidence gate mechanics | platform result/evidence gate |
| Irreversible operation approval mechanism | Tool Bridge / platform policy |

### Domain Pack Ownership

| Item | Domain pack artifact | Notes |
| --- | --- | --- |
| UI object vocabulary | `domain-packs/TAG_TOOL/ui-object-vocabulary.json` | Labels, aliases, hazards |
| Page / modal / route map | `domain-packs/TAG_TOOL/discovery/page-map.json` | Dev route patterns pending live verification |
| Component semantics | `domain-packs/TAG_TOOL/discovery/component-inventory.json` | List, form, upload, date panel, modal |
| Reusable domain actions | `domain-packs/TAG_TOOL/action-contracts/*.json` | List, condition create, manual upload, variables, danger |
| Evidence requirements | `domain-packs/TAG_TOOL/evidence-schema.json` | Structured object names |
| Package lint rules | `domain-packs/TAG_TOOL/lint-rules.json` | Dangerous action and CSV format gates |

### Shared Lifecycle Ownership

| Lifecycle | Domain action contract | Required UI objects | Required evidence | Failure boundary |
| --- | --- | --- | --- | --- |
| Create condition tag setup | `createConditionTag.json` | form, date panel, value editor | form state, date panel, value editor, toast | missing UI = BLOCKED; PRD mismatch = FAIL |
| Manual CSV upload | `manualUpload.json` | upload panel, toast | file state, validation toast | file chooser unavailable = BLOCKED |
| Row action delete/terminate cancel | `dangerousActions.json` | row actions, confirm modal | modal text, interaction log | wrong dialog text/options = FAIL |
| Variable settings validation | `tagVariableSettings.json` | variable form, history, toast | values, toast, history | save without approval is blocked by policy |

### Testcase-Only Ownership

- Specific tag names.
- Specific CSV row values.
- Expected created row ordering for a run.
- Whether a high-risk confirm is authorized.
- Cleanup instructions for created tags.
