# BI Domain Pack

Galaxy BI UAT default domain pack.

This MVP pack validates the domain loader contract. The detailed BI testing rules remain in the uploaded testcase workbook and startup instruction markdown during M1.

## Locator Registry

`locators/demo001-locator-registry.json` provides draft Playwright locator hints for DEMO001 baseline cases.

The registry is guidance only:

- It does not prove PASS/FAIL/BLOCKED.
- It must not be used to bypass visible UI operation.
- It must not contain direct BI API calls, internal JS setters, or `force: true` clicks.
- If a locator fails, fall back to visible UI exploration and record drift in `output/locator-drift.log`.
