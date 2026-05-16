# BI Official UI Collage Locator Guidance

Locator files in this folder are optional guidance only.

They do not prove PASS/FAIL/BLOCKED and must not be used to bypass visible UI operation.

Rules:

- Use visible UI locators only.
- Do not use direct BI API calls.
- Do not use internal JavaScript setters or React state mutation.
- Do not use `force: true` clicks or bypass actionability checks.
- If all candidates fail, fall back to visible UI exploration and write a drift item to `output/locator-drift.log`.
- Do not auto-edit registry files during a UAT run.

Runtime note:

The domain-pack endpoint exposes this legacy-named locator registry and the optional UI/action/evidence contract files in the pack root. The locator filename is legacy; the content in this pack is for official UI collage flows.
