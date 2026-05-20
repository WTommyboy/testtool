# BI Official UI Collage Domain Pack

Domain pack for Galaxy Next BI official frontend UI, collage mode.

This pack is intentionally narrower than the legacy `BI` pack:

- Scope: official UI / collage mode.
- Source of expectation: PRD first, then official UI screenshots and live dev observations.
- Primary run target: test packages that keep OTTEST004 44 data-logic cases and add official UI cases.

Required loader files:

- `AGENTS.md`
- `xlsx_schema.json`
- `result_parser_adapter.json`
- `startup_prompt_template.md`

Optional locator guidance:

- `locators/demo001-locator-registry.json`

Optional UI / action / evidence contract files:

- `ui-contract.json`
- `ui-object-vocabulary.json`
- `action-contracts/setMetricRows.json`
- `action-contracts/setCalculatedFormula.json`
- `action-contracts/observeFrontendState.json`
- `action-contracts/reportLifecycle.json`
- `action-contracts/projectLifecycle.json`
- `action-contracts/projectList.json`
- `action-contracts/dateRangePanel.json`
- `evidence-schema.json`
- `lint-rules.json`
- `discovery/page-map.json`
- `discovery/component-inventory.json`
- `discovery/visual-alignment.json`

The optional locator filename is legacy; its content is for official UI collage flows, not DEMO001. The contract files are Gen1 seeds for Domain UI Discovery and later Gen3/Gen4 helper templates/interpreter work.
