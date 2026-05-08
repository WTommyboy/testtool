# AGENTS.md - uat-tool project instructions

This file applies to engineering work inside `uat-tool/`.

## Documentation Discipline

For every uat-tool change that affects runtime behavior, schema, result artifacts,
deployment, authoring rules, Agent behavior, helper behavior, or production
operation, update the matching tracked docs in the same commit:

- `docs/planning/online-uat-tool-development-log.md`: append the engineering
  log entry with background, decision, files changed, verification, deployment
  status, and follow-up.
- `docs/refactor/規劃說明.md`: update when planning, user flow, rollout status,
  roadmap, or operating model changes.
- `docs/refactor/工程spac.md`: update when APIs, schema, generated files,
  result contracts, DB fields, Agent protocol, verification, or deployment
  details change.
- Domain, Layer 1, authoring, and round source docs must be updated when their
  contract changes.

If a code change does not require a docs change, say that explicitly in the
final response and explain why.

## Pre-Commit / Pre-Deploy Verification

Before claiming a `uat-tool` change is ready for commit, push, deployment, or
Mac Agent restart, follow
`docs/planning/deployment-verification-policy.md`.

In particular:

- Planner/gate/parser changes require targeted fixtures plus actual package
  planner smoke.
- Changes that affect BI UI helper execution, save, download, reopen, row
  download, Tool Bridge, native dialogs, date setting, formula modals, field
  selection, or result upload require a matching real helper/UI smoke or an
  explicitly appropriate lifecycle/replay smoke.
- Planner smoke and fixture verification are not substitutes for real helper/UI
  smoke when the changed behavior operates the BI UI.
- Real helper/UI smoke reports must include concrete run ids or artifact paths.
- If real smoke is blocked by SSO, Playwright, Agent state, BI UI state,
  network, or data conditions, report the blocker clearly and do not claim the
  change is deploy-ready.

## Session History Hygiene

Do not read raw old session JSONL files unless Tommy explicitly asks. Prefer
the handoff files under `docs/planning/` and the development log.

When producing a session handoff or future daily automated handoff, follow
`docs/planning/session-handoff-generation-rules.md`. The handoff must start
with Tommy's active question / next conversation objective before repo status.
If a new chat would know the files but not what Tommy was asking, the handoff is
incomplete.

## Result Safety

Preserve one-case-at-a-time execution. Each case still needs its own
`output/result.xlsx`, ingest, and evidence gate. Final aggregate workbooks must
be generated from normalized server state, not by having Codex accumulate
multiple case rows in memory.
