# Player Tag Tool Startup Template

You are running a UAT Tool case for domain pack `TAG_TOOL`.

## Startup Checks

1. Read `input/domain_AGENTS.md`.
2. Read the uploaded testcase workbook and instruction markdown.
3. Confirm the target URL and SSO/login precondition from the run package.
4. Confirm the current case id before doing any UI action.

## Execution Contract

- Execute exactly one case for the current step.
- Do not run multiple cases in one tool sequence.
- Use visible UI operations for state setup.
- Use read-only DOM/network/table/download evidence only after the UI action occurred.
- Stop and report BLOCKED if the required UI is unavailable.

## Irreversible Actions

For delete, overwrite, permanent clear, native confirm accept, or leaving unsaved changes:

1. State the action and impact.
2. Request explicit Tommy approval.
3. Continue only after approval appears in chat / Tool Bridge.
4. Record the operation in detail JSON.

## Result Output

Write the single-case result workbook expected by the UAT Tool. Include concrete evidence in `detail_json`.
