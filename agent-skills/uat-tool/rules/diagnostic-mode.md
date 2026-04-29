# Diagnostic Mode Rule v0.1

This rule defines a non-trusted fast iteration mode for UAT Tool runs.

## Purpose

Diagnostic mode exists to shorten iteration loops when testing testcase wording, locator hints, helper behavior, or browser setup.

It is not a formal UAT execution mode and must not produce trusted PASS/FAIL/BLOCKED results.

## Allowed Uses

Diagnostic mode may:

- Run a single current case only.
- Stop after a requested step or checkpoint.
- Start from a requested step only when the operator accepts that earlier steps are not proven in this diagnostic run.
- Capture DOM, network, chart/table, screenshot, helper, and timing artifacts.
- Produce a diagnostic summary under `output/diagnostic-summary.json`.
- Produce helper reports, locator drift logs, and timing summaries.

Diagnostic mode must not:

- Write trusted `output/result.xlsx`.
- Upload diagnostic output as a trusted UAT result.
- Mark a run case PASS/FAIL/BLOCKED.
- Execute multiple cases in one run.
- Treat previous-step or previous-case artifacts as current-run proof.
- Bypass UI with direct BI API calls, internal JS setters, or forced clicks.

## Evidence Boundary

Artifacts from diagnostic mode are useful for debugging, but they are not sufficient for trusted result ingestion.

Trusted mode must re-run the full current case action chain or otherwise collect complete current-run evidence before writing `output/result.xlsx`.

If a diagnostic run starts at step N:

- Steps before N are `not_executed_in_diagnostic`.
- Any page state inherited from earlier work is setup context, not evidence.
- The diagnostic summary must list missing evidence explicitly.

## Recommended Inputs

Future dispatch payload may include:

```json
{
  "execution_mode": "diagnostic",
  "diagnostic": {
    "caseNo": "DEMO-A-01",
    "fromStep": 1,
    "untilStep": 3,
    "purpose": "verify locator registry candidates",
    "writeTrustedResult": false
  }
}
```

Until runtime support exists, this file is a protocol reference only.

## Output Contract

Diagnostic mode should write:

```text
output/diagnostic-summary.json
output/timing-summary.json
output/locator-drift.log          when locator drift is observed
output/helper-artifacts/<case>/   when helper is used
```

`diagnostic-summary.json` should include:

- `schemaVersion`
- `caseNo`
- `fromStep`
- `untilStep`
- `purpose`
- `executedSteps`
- `skippedSteps`
- `artifacts`
- `evidenceGaps`
- `canPromoteToTrustedResult: false`

## Promotion Rule

Diagnostic artifacts cannot be promoted to a trusted result by renaming files.

To produce trusted UAT output after a diagnostic run, run trusted mode for the full current case and write `output/result.xlsx` through the normal evidence gate.
