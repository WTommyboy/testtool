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

The optional locator filename is currently constrained by the MVP domain loader endpoint. Its content is for official UI collage flows, not DEMO001.
