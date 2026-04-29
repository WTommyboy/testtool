# BI Locator Registry

This directory contains domain-specific Playwright locator hints for Galaxy BI.

The registry is not a result source and is not permission to bypass the UI. It only reduces locator exploration time.

Rules:

- Use visible UI locators only.
- Do not use direct BI API calls.
- Do not use internal JavaScript setters or React state mutation.
- Do not use `force: true` clicks or bypass actionability checks.
- If all candidates fail, fall back to visible UI exploration and write a drift item to `output/locator-drift.log`.
- Do not auto-edit registry files during a UAT run; drift updates require review.

Current file:

- `demo001-locator-registry.json`: draft locator hints for DEMO001 baseline cases.
