# Deployment Verification Policy

Date: 2026-05-08 Asia/Taipei
Scope: `uat-tool` engineering work

This policy defines the minimum verification expected before a Codex-made
`uat-tool` change is considered ready for commit, push, deployment, or Mac Agent
restart.

## Core Rule

Any change affecting Agent/helper/runtime behavior must include appropriate
verification before commit, push, deploy, or Agent restart.

Planner, fixture, typecheck, and build results are not interchangeable with a
real helper/UI smoke. If a change affects actual BI UI operation, at least one
affected flow must be exercised through the real helper/Agent/UI path before it
is called deploy-ready.

## Verification Levels

| Change type | Required verification |
|---|---|
| Docs-only | `git diff --check`; relevant doc consistency check if available. |
| Parser / gate / planner only | Targeted fixture plus actual package planner smoke. |
| Helper execution plan affecting UI flow | Planner smoke plus at least one real helper/UI smoke for an affected flow. |
| BI UI helper executor behavior | Real helper/UI smoke is required. |
| Save / download / reopen / row download | Real helper/UI smoke is required, with artifact paths. |
| Tool Bridge / native dialog / irreversible action | Real helper/UI smoke or dedicated Tool Bridge lifecycle smoke is required, with response evidence. |
| Date setting / formula modal / field selection | Real helper/UI smoke is required for at least one representative affected case. |
| Result upload / workbook normalization / evidence gate | Targeted result-contract or evidence-gate fixture plus replay against a real or representative run artifact when available. |
| WebSocket / Agent lifecycle | Synthetic lifecycle smoke plus relevant `verify:*` scripts. |

## Smoke Definitions

`fixture smoke` means a regression fixture exercises the intended code branch.
It proves the branch is covered, not that BI UI works.

`planner smoke` means a real testcase package is converted into a helper plan
and the action chain / params are inspected. It proves the plan shape, not that
the helper can execute the UI.

`real helper/UI smoke` means the changed flow is executed through the helper,
Agent, or BI UI far enough to produce real current-run artifacts. A valid report
must include concrete paths such as helper action report JSON, preview evidence,
CSV evidence, screenshot, Tool Bridge response, or downloaded file evidence,
depending on the flow.

## Required Reporting

Before claiming a change is ready to commit, push, deploy, or restart Agent,
report:

- commands run and whether they passed;
- smoke type: fixture, planner, real helper/UI, lifecycle, or replay;
- run id or local artifact root when a real smoke/replay was used;
- key artifact paths for real helper/UI smoke;
- any verification intentionally skipped and why.

If real smoke is blocked by SSO, Playwright, Agent state, BI UI state, network,
or environment data, report the blocker explicitly and do not claim the change
is deploy-ready.

## Practical Rule For OTTEST / BI Helper Changes

If the change touches any of these areas, a real helper/UI smoke is required
unless Tommy explicitly waives it:

- BI UI clicks or selectors;
- field picker / select-all behavior;
- date picker or date preset behavior;
- formula / calculated-field modal behavior;
- preview execution;
- save report;
- reopen report;
- CSV download from editor or project row;
- Tool Bridge approval or native dialog handling.

For multi-case fixes, smoke at least one representative case per distinct flow.
Example: for F-flow work, one editor-session CSV smoke such as `F-03` and one
project-row CSV smoke such as `F-05` or `F-06` are separate required flows.
