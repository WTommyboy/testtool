# Player Tag Tool Domain Pack

Domain pack: `TAG_TOOL`

Scope: Galaxy Next BI Web player tag management, manual tag upload, condition tag setup, tag information, and tag variable settings.

Current live UI baseline:

- Dev URL: `https://galaxy.games.gamania.com/bi-dev/zh-TW/tag/player?gameId=541`
- Latest Playwright inventory: `discovery/live-inventory-2026-06-23-dev-ui.md`
- 2026-06-23 dev list state: populated, `共 28 筆資料`; do not assume an empty tag list unless a run package explicitly proves one.
- Current tag info route pattern: `/bi-dev/zh-TW/tag/player/:tagId?gameId=:gameId`
- Current condition settings route pattern: `/bi-dev/zh-TW/tag/player/:tagId/settings?gameId=:gameId`

Required loader files:

- `AGENTS.md`
- `xlsx_schema.json`
- `result_parser_adapter.json`
- `startup_prompt_template.md`

Optional locator guidance:

- `locators/demo001-locator-registry.json`

Optional UI / action / evidence contract files:

- `ui-contract.json`
- `action-contracts/<action>.json`
- `action-contracts/tagInfoReadOnly.json`
- `evidence-schema.json`
- `lint-rules.json`
- `discovery/page-map.json`
- `discovery/component-inventory.json`

Recommended local checks after editing this pack:

```bash
npm run verify:domain-pack -- --name TAG_TOOL
npm run verify:tag-tool-runtime
npm run verify:tag-tool-current-case-gate
```

Reference base pack: `BI_OFFICIAL_UI_COLLAGE`
Before using this pack, complete the domain intake and boundary rules described in `docs/authoring/新功能_DomainPack_生成流程.md`.
