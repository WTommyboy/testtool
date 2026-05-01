# Session handoff - OTTEST002 P0 follow-up

Date: 2026-05-02 Asia/Taipei

This handoff exists so a new Codex chat can continue OTTEST002 work without loading the large session JSONL files that repeatedly triggered remote compact failures.

## Source sessions

- `019dd9b2-2372-72b3-aa90-706ab5bacb02`
  - Primary engineering history thread.
  - Contains the implementation history for timing, helper pre-run, helper protocol, capability gate, diagnostic mode, DOM profile, date picker fixes, BI save dialog continuation, Agent auto-advance authoring, and OTTEST002_10 analysis.
  - Local JSONL: `/Users/tommy/.codex/sessions/2026/04/29/rollout-2026-04-29T22-43-43-019dd9b2-2372-72b3-aa90-706ab5bacb02.jsonl`
- `019de250-8046-7222-b886-a2eac014e6e1`
  - Short continuation thread, but model context was already heavy.
  - Contains the latest P0 decision: final aggregate result artifact, `groupId` schema, and follow-up implementation plan.
  - It ended while starting schema/documentation inspection because remote compact failed again.
  - Local JSONL: `/Users/tommy/.codex/sessions/2026/05/01/rollout-2026-05-01T14-53-39-019de250-8046-7222-b886-a2eac014e6e1.jsonl`

Do not read either raw JSONL unless this handoff and `online-uat-tool-development-log.md` are insufficient. The JSONLs are large enough to push a new chat toward compact again.

## Current production snapshot

- Local uat-tool branch: `refactor/mac-agent-mvp`
- Current local and remote deployment commit: `c506699`
- Railway production branch: `codex/uat-tool-mvp`
- Railway production commit: `c5066991269c6860d66e41b66289188ff558254d`
- Railway deployment id: `b18bd607-9fa2-4601-887c-a2a026ef816f`
- Railway `/health`: healthy as checked on 2026-05-02 Asia/Taipei.

## Latest validated behavior

- OTTEST002_10 completed all 5 cases continuously.
- `TOOL-A-01` FAIL is likely valid: preview/save used `2026-03-01` to `2026-03-31`, but reopen fell back to `過去7天`.
- `TOOL-A-03` BLOCKED is plausible because metadata difference was 12 fields, above the existing `>5` environment/version drift threshold.
- `TOOL-A-02` and `TOOL-A-05` BLOCKED are mostly tool/helper capability gaps, not proven product defects.
- `TOOL-A-04` is suspicious: even without CSV evidence, helper observed the same reopen date fallback, so it likely should not be hidden behind BLOCKED if the case expected reopen state restoration.
- Markdown report aggregated 5 cases, but downloaded `UAT_result_75b1616b-6b92-4a22-b330-d3a17d97f65b.xlsx` only contained the last case `TOOL-A-05`.

Relevant local artifacts:

- `/Users/tommy/Downloads/RoundID_ OTTEST002_10.md`
- `/Users/tommy/Downloads/UAT_report_75b1616b-6b92-4a22-b330-d3a17d97f65b.md`
- `/Users/tommy/Downloads/UAT_result_75b1616b-6b92-4a22-b330-d3a17d97f65b.xlsx`
- `/Users/tommy/.uat-agent/runs/75b1616b-6b92-4a22-b330-d3a17d97f65b`

## Agreed P0 design

### Result artifact aggregation

Keep the one-case-at-a-time safety gate. Do not let Codex write multiple cases into one `output/result.xlsx`.

Target flow:

1. Each case still writes and uploads a single-case `output/result.xlsx`.
2. Server ingests the single case into normalized run state.
3. Agent may keep append-only debug state such as `output/case-results.jsonl`, but server DB remains the canonical source.
4. After a group completes, build a group aggregate xlsx.
5. After the run completes, build a final aggregate xlsx.
6. UI result download should point to the final aggregate workbook, not the raw last-case workbook.

The goal is correctness and recoverability more than speed. XLSX generation is not the main runtime bottleneck; Codex judgment turns are.

### `groupId` schema

Add `groupId` before the existing `groupName` column in testcase schema and generated/expected xlsx files.

Recommended fields:

- `groupId`: stable machine value such as `A`, `B`, `C`, `D`
- `groupName`: human-readable group name such as `A:拼貼模式工具測試`
- `caseOrder`: numeric order inside the group/run
- `caseNo`: full case id such as `TOOL-A-01`

Update all parser/manifest/result aggregation code that currently infers grouping from group text only.

Also update the companion markdown files and authoring rules:

- `/Users/tommy/Downloads/codex_galaxy/BI_UAT_ROUNDS/onlinetest/OTTEST002/*.md`
- `/Users/tommy/Downloads/codex_galaxy/uat-tool/docs/authoring/UAT_三文件撰寫規則.md`

### Multi-field collage helper

`TOOL-A-02` and `TOOL-A-05` exposed that `collage.configureMetric` treats `新增帳號數 + MAU(帳號) + 總營收(TWD)` as one clickable string.

Required change:

- Parse composite metric strings into an ordered array.
- For each field, click `+ 新增欄位`, select the individual field, and verify the selected field list contains every expected field.
- Never use a single `clickByText(fullFieldString)` for multi-field selections.

### Existing report modification flow

`TOOL-A-05` is not a create-new-report case. It should open the report created by `TOOL-A-01`, modify it, overwrite/save, and reopen.

Required change:

- Persist or locate the `TOOL-A-01` saved report state, preferably from `saved-report.json` or normalized server run state.
- Build an A-05 helper plan like:
  `openProject -> openExistingReport(TOOL_A01_*) -> addFields -> runPreview -> overwriteSave -> reopenReport`
- If the A-01 report cannot be found, mark A-05 as prerequisite BLOCKED rather than creating a new report.

### A-04 judgment and CSV helper

`TOOL-A-04` currently became BLOCKED due to missing CSV evidence, but a necessary reopen restoration subcondition already failed.

Required change:

- For function-flow cases, if a required subcondition is directly observed as failed, allow FAIL even when later CSV/download evidence is unavailable.
- Add a CSV helper later: `collage.downloadCsvAndComparePreview`.
- The CSV helper should use a real browser download event, parse the downloaded CSV, and compare against preview/chart/table evidence.

### Recovery noise

When there is no real recovery handler, do not emit Tool Bridge recovery just to resume and immediately skip with `PREVIOUS_HELPER_ACTION_NOT_OK`.

Required change:

- Either implement the recovery handler for the blocked point, or return BLOCKED immediately with a precise reason.

## Suggested implementation order

1. Add `groupId` to testcase schema, parser/manifest, OTTEST002 source xlsx/md, and authoring rules.
2. Implement final aggregate result xlsx generation from normalized server state.
3. Point UI download to final aggregate xlsx after run completion.
4. Fix `collage.configureMetric` multi-field parsing and verification.
5. Fix `TOOL-A-05` existing-report flow.
6. Update A-04 flow judgment and add CSV helper.
7. Reduce recovery noise.

## Context-management rule

For the next chat, start from:

1. This handoff.
2. `/Users/tommy/Downloads/codex_galaxy/uat-tool/docs/planning/online-uat-tool-development-log.md`
3. Current source files only as needed.

Do not paste or load full old chat logs unless a specific missing fact cannot be recovered from the handoff or planning log.
