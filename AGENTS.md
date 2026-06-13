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

Before changing runtime, Agent, CodexRunner, helper, browser session, model,
result ingestion, result write, upload, planner routing, or deployment code, run
or explicitly attempt a pre-fix baseline smoke against the currently running
artifact. The baseline smoke must be chosen to reproduce the reported failure at
the smallest useful scope and must record the exact artifact under test:
running launchd pid / Railway commit / dist mtime / run id / stderr / artifact
path as applicable.

If pre-fix smoke is blocked by SSO, unavailable service state, missing artifacts,
or a failure that cannot be safely reproduced, write that blocker down before
editing. Do not silently replace pre-fix smoke with post-fix verification.

After the change, run the matching post-fix smoke and compare it with the
pre-fix baseline. When source is compiled to `dist`, verify the compiled
artifact, not only TypeScript source. When a service uses launchd/Railway,
restart or deploy first, then smoke the running service before telling Tommy to
rerun UAT.

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
- Mac Agent restart smoke must include `doctor` and the
  `agent-singleton-process` check. If the same config has more than one running
  `uat-agent start` process, stop and fix that first; duplicate agents can race
  to claim the same Railway task and make a fresh run use stale runtime code or
  cached config.

## Domain Pack Generation

When Tommy asks to create a new feature domain pack, add a new UI/tool into UAT
Tool, standardize a one-off domain-pack workflow, or prepare Claude to generate
three-document packages for a new domain, read this workflow first:

- `docs/authoring/新功能_DomainPack_生成流程.md`
- `docs/authoring/domain-pack-templates/domain_intake_template.md`
- `docs/authoring/domain-pack-templates/boundary_rules_template.md`
- `docs/authoring/domain-pack-templates/claude_testcase_request_template.md`
- `docs/authoring/domain-pack-templates/domain_pack_completion_checklist.md`
- `agent-skills/uat-tool/rules/platform-domain-boundary.md`

Use the scaffold and verifier when appropriate:

```bash
npm run create:domain-pack -- --name <DOMAIN> --display "<Display Name>"
npm run verify:domain-pack -- --name <DOMAIN>
```

Do not let domain-pack decisions live only in chat. Write durable decisions into
the intake, boundary rules, domain pack, or testcase package. New domain packs
should go through dev branch and dev `/api/domains` verification before any
production promote.

When a proposed fix is not platform-generic, place the reusable semantics in the
domain pack instead of the runtime. If it is only a run/testcase decision, keep it
in the testcase package or run instructions. Any temporary bridge must be named
as such and must state what platform vocabulary or domain-pack contract will
replace it.

## UAT Evidence Review Discipline

When Tommy provides `UAT_report_*.md`, `UAT_archive_*.md`, `result.xlsx`, run
artifacts, or screenshots and asks why a run failed or why BLOCKED is high, do
not infer product quality from aggregate counts alone.

Before giving a product judgment, triage every abnormal case
(`FAIL`, `BLOCKED`, `PARTIAL`, `PENDING`) against the actual evidence:

- Read the report/archive case state, `fail category`, `detail_json`,
  `blocked_reason`, `currentRunEvidence`, and `runtimeContainment`.
- For local Mac Agent runs, inspect the run workspace when available:
  `output/codex-result.json`, `output/runtime-containment-result.json`,
  `output/helper-pre-run-summary.json`, `output/helper-continuation-summary.jsonl`,
  `output/helper-artifacts/`, and `output/helper-artifacts-archive/`.
- For each helper report, check `status`,
  `evidenceDecision.evidenceUsability`, `blockingReason`, `notReached`,
  `warnings`, `slowWaits`, and the available DOM/network/preview/CSV/screenshot
  evidence.
- State whether the case actually reached the tested behavior, where it stopped
  (navigation, setup, execute, download, save, reopen, delete, Codex judgment,
  result write, upload), and whether Codex entered the judgment phase.
- Treat Tommy's manual screenshots or manual verification as evidence. If Tommy
  verifies a case is normal, record it as manual review evidence and do not keep
  presenting that case as a product risk.

Classify each abnormal case by primary cause:

- `product bug`: current-run UI/network/DOM/CSV/preview evidence proves product
  behavior violated the expected result.
- `runtime/lifecycle`: Codex CLI, Agent lifecycle, thread/session, result
  write/upload, post-result exit, or model config failed.
- `helper route/planning`: helper plan used the wrong page/action/order or did
  not satisfy a required precondition.
- `domain pack/contract gap`: vocabulary, locator registry, field alias,
  source/field contract, or visual evidence contract is missing or stale.
- `testcase flaw`: testcase precondition, step, expectation, risk level, target,
  cleanup, or data assumption is wrong or underspecified.
- `tool limitation / visual judge gap`: evidence is screenshot-only or visual
  fallback and lacks deterministic DOM/AX/network judgment.
- `environment/auth/data issue`: SSO, permissions, data pool, project limit,
  URL, browser, Playwright, or local machine state blocked the run.

Hard rules:

- Do not say or imply product risk from "high BLOCKED", `FAILED` run status, or
  percentages without the per-case evidence classification above.
- Do not classify `CODEX_RUNTIME_RESULT_WRITE_FAILED`,
  `CODEX_NO_RESULT_XLSX`, `CODEX_RUN_FAILED`, thread-not-found, model
  unsupported, or result write/upload failures as product bugs unless there is
  separate product evidence.
- Do not classify `BLOCKED_NEEDS_VISUAL_REVIEW` as a product bug. It means the
  tool lacks a deterministic judge, unless structured evidence or Tommy's manual
  verification says otherwise.
- If helper evidence is already sufficient but Codex judgment/result write
  failed, call it `runtime/lifecycle`, not product behavior.
- If helper stopped before the tested behavior, say which helper step failed and
  classify route/planning, domain contract, testcase, tool, or environment
  before considering product.

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
