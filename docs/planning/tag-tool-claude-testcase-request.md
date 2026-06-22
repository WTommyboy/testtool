# Claude Testcase Request - Player Tag Tool

Please create a new UAT three-document package for Galaxy Next BI Web 玩家標籤工具.

## Context

This is a new UAT Tool domain package, not an update to BI official UI collage.

- Domain pack: `TAG_TOOL`
- Primary PRD: `/Users/tommy/Downloads/galaxy_prototype/player_tag_tool/BI工具衍伸_標籤工具_v1_3_4.md`
- Prototype prompt: `/Users/tommy/Downloads/galaxy_prototype/player_tag_tool/codex_prompt_player_tag_tool_prototype.md`
- Dev URL: `https://galaxy.games.gamania.com/bi-dev/zh-TW/tag/player?gameId=541`

## Known Dev Test Data Windows

Use these `gameId=541` dev data windows when writing condition-tag date/time cases. Treat the year as 2026 unless the final run package explicitly overrides it.

- `累積遊戲時間` / 遊玩: `2026-03-04` to `2026-03-31`.
- `累積登入天數`: data exists from `2026-06-01`; use June 2026 onward.
- `消費級距 R` / 累積金額: January 2026 and March 2026 have order data.
- `累積未登入天數`: use June 2026 onward.

Every testcase that depends on these windows must put the exact static/dynamic date range in preconditions or steps, stay within the PRD 90-day limit, and record the chosen range in `detail_json`.

## Required Reading Order

1. Common authoring rules:
   - `uat-tool/docs/authoring/新功能_DomainPack_生成流程.md`
2. Domain intake:
   - `uat-tool/docs/planning/tag-tool-domain-intake-draft.md`
3. Domain boundary rules:
   - `uat-tool/docs/planning/tag-tool-boundary-rules.md`
4. Platform/domain boundary:
   - `uat-tool/agent-skills/uat-tool/rules/platform-domain-boundary.md`
   - `uat-tool/contracts/platform-action-vocabulary.v1.json`
5. Domain pack contracts:
   - `uat-tool/domain-packs/TAG_TOOL/ui-object-vocabulary.json`
   - `uat-tool/domain-packs/TAG_TOOL/action-contracts/`
   - `uat-tool/domain-packs/TAG_TOOL/evidence-schema.json`
   - `uat-tool/domain-packs/TAG_TOOL/lint-rules.json`
6. PRD / prototype:
   - `/Users/tommy/Downloads/galaxy_prototype/player_tag_tool/BI工具衍伸_標籤工具_v1_3_4.md`
   - `/Users/tommy/Downloads/galaxy_prototype/player_tag_tool/codex_prompt_player_tag_tool_prototype.md`

## Specification Priority

1. PRD v1.3.4.
2. Official live dev/RC UI and prototype notes.
3. Existing testcase package, if any.
4. Common UAT rules.

If sources conflict, expected result must follow the highest-priority source. Record lower-priority differences as drift, risk, or possible bugs.

## New Case Requirements

Create a first smoke package with these groups:

- A. Navigation and list inventory.
- B. Create page initial/type-switch states.
- C. Condition tag setup: time types, date panel, empty value editor, add/max condition rows, validation toast.
- D. Manual tag add upload: 2-column CSV guidance, file limits, valid fixture, invalid header fixture, submit-time overall validation if safe.
- E. Read-only condition settings when a prepared condition tag exists.
- F. Tag information pages and member table sort when prepared data exists.
- G. Tag variable settings: current/default values, steppers, invalid-value toasts, history time format.
- H. Dangerous actions: delete/terminate modal open + cancel only in smoke.

## Required Edge Cases

- Manual tag hides condition/time/analysis fields.
- Condition tag initial value setup is empty and only shows `+ 添加`.
- Tag value count upper limit is 10.
- Each tag value has at most 2 numeric conditions.
- Dynamic/static date ranges have a 90-day limit.
- Condition tag after creation is read-only and uses 查看設置.
- Manual edit CSV requires `操作` with add/update/delete.
- Variable setting validation: `X > Y`, `A >= B`, `Z >= 0`, other values >= 1, all integers.

## Execution Rules

- Use visible UI.
- Do not design direct API mutation as a test step.
- Do not use internal JS setters to create state.
- One case at a time.
- Irreversible actions require explicit Tommy approval during execution; testcase prose is not approval.
- Put high-risk confirm cases in a focused package, not in ordinary smoke.
- Use domain UI object ids when available. If missing, flag a domain-pack gap instead of inventing runtime workarounds.

## Output Requirements

- UAT testcase workbook.
- Codex assignment markdown.
- Test execution instruction markdown.
- Mark cases that require prepared data or approval.
- Include fixture references for CSV cases:
  - `domain-packs/TAG_TOOL/fixtures/smoke/manual-tag-add-valid.csv`
  - `domain-packs/TAG_TOOL/fixtures/smoke/manual-tag-add-invalid-header.csv`
  - `domain-packs/TAG_TOOL/fixtures/smoke/manual-tag-edit-valid.csv`
