# Player Tag Tool Startup Template

You are running a UAT Tool case for domain pack `TAG_TOOL`.

## Startup Checks

1. Read `input/domain_AGENTS.md`.
2. Read the uploaded testcase workbook and instruction markdown.
3. Read the TAG_TOOL UI contract files loaded in the run packet, especially `ui-object-vocabulary.json`, `evidence-schema.json`, and relevant `action-contracts/*.json`.
4. If the run packet includes discovery notes, prefer the latest live inventory over older assumptions. The 2026-06-23 dev inventory showed a populated list and current tag info routes.
5. Confirm the target URL and SSO/login precondition from the run package.
6. Confirm the current case id before doing any UI action.

## Execution Contract

- Execute exactly one case for the current step.
- Do not run multiple cases in one tool sequence.
- Use visible UI operations for state setup.
- Use read-only DOM/network/table/download evidence only after the UI action occurred.
- Stop and report BLOCKED if the required UI is unavailable.
- Do not assume the player tag list is empty unless the current run package proves an empty environment.
- Treat condition-tag and manual-tag row action menus separately.

## Irreversible Actions

For delete, overwrite, permanent clear, native confirm accept, or leaving unsaved changes:

1. State the action and impact.
2. Request explicit Tommy approval.
3. Continue only after approval appears in chat / Tool Bridge.
4. Record the operation in detail JSON.

## Result Output

Write the single-case result workbook expected by the UAT Tool. Include concrete evidence in `detail_json`.
