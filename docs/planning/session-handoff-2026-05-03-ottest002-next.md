# Session handoff - OTTEST002 after background-safe lease

Date: 2026-05-03 Asia/Taipei

This handoff summarizes the Codex thread named `續接 OTTEST002 P0`.
Use this file to continue in a new chat without loading the raw session JSONL.

## Source thread

- Thread id: `019de548-1d41-77d2-9cd1-2cf6428a2383`
- Thread name: `續接 OTTEST002 P0`
- Local JSONL: `/Users/tommy/.codex/sessions/2026/05/02/rollout-2026-05-02T04-43-21-019de548-1d41-77d2-9cd1-2cf6428a2383.jsonl`
- Size: about `19MB`, `7392` lines.
- Failure mode: remote compact failed again:
  `Error running remote compact task: stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses/compact)`
- Cause: by the final turn, each request was carrying about `240k` input tokens against a `258,400` token context window.

Do not read the raw JSONL unless this handoff and `online-uat-tool-development-log.md` are insufficient.

## Current production snapshot

- Local branch: `refactor/mac-agent-mvp`
- Deployment branch: `codex/uat-tool-mvp`
- Current production commit: `16f938c759671749bc6808e5c2a459cfd1457a8a`
- Short commit: `16f938c`
- Deployment id: `20bd824e-edc8-45a1-84ae-08318694b728`
- Railway `/health`: healthy as checked in the prior thread.
- Root package version: `1.0.0`
- Agent package version: `0.1.0`

Important: feature work has advanced a lot, but app/agent semantic versions have not. The next implementation should introduce a version discipline.

## Work completed in `續接 OTTEST002 P0`

### P0 result pipeline and groupId

Commit: `b977784 feat: add UAT group ids and aggregate results`

- Added `groupId / 群組ID` before `groupName / 群組`.
- Updated parser, manifest, current-case pack, run state, result parser/writer, and result contract.
- Updated OTTEST002 local xlsx/md to 17 columns with `群組ID=A`.
- Added final aggregate result xlsx generated from normalized server state.
- UI result download now prefers final aggregate xlsx instead of the last raw single-case result.
- Preserved one-case-at-a-time rule: each case still writes/uploads one single-case `output/result.xlsx`.

### Planning/spec sync discipline

Commit: `0587f60 docs: sync uat-tool planning and spec`

- Added tracked `uat-tool/AGENTS.md` with documentation discipline.
- Updated `online-uat-tool-development-log.md`, `docs/refactor/規劃說明.md`, and `docs/refactor/工程spac.md`.
- Rule: any runtime/schema/result/deployment/authoring/helper change must update the matching docs in the same commit.

### Collage helper P0

Commit: `db51666 feat: complete OTTEST002 collage helper P0`

- `collage.configureMetric` parses composite metric strings such as `新增帳號數 + MAU(帳號) + 總營收(TWD)`.
- Added `collage.openExistingReport` for A-05 existing-report modification/overwrite flow.
- Added `collage.downloadCsvAndComparePreview` for CSV download and preview comparison.
- Reduced recovery noise: unknown native dialog without a real handler becomes `blocked`, not recovery-then-skipped.

### groupId repair for legacy single-case result

Commit: `8555703 Fix single-case result groupId repair`

- If Codex writes an old single-case result workbook that only lacks `群組ID`, Agent safely repairs it before self-check/upload.
- Repair applies only when workbook is single-case and case no matches current case.

### Degraded cases produce trusted BLOCKED result

Commit: `a9892f8 Handle degraded cases with blocked results`

- Degraded/no-helper cases without browser automation no longer kill the run with `CODEX_NO_RESULT_XLSX`.
- They produce a trusted single-case `BLOCKED / TOOL_EXECUTION_UNAVAILABLE` result and allow later cases to continue.

### Rule reading and metadata/CSV precision

Commits include `fcb1c96`, `a3f30ac`, `c0715df`, `bda22e7`, `ed50a1b`.

- BI case packs now force reading generated `AGENTS.md`, Layer 1 rules, `PROJECT_AGENTS_FULL.md`, and the three BI rulebooks.
- Metadata cases now reference canonical `rules/BI_DATA/metadata.csv` and source filename `metadata＿1.2.5 - 工作表1.csv`.
- Added `collage.extractMetadataDropdownFields` helper.
- Added `supporting-docs-manifest` lightweight profile for uploaded support files.
- CSV evidence now supports browser download event and UI-triggered CSV response body, still without directly calling BI API.
- Report-list CSV flow locks to the saved report row and refreshes/re-locates the list if stale.
- Preview evidence now includes table extraction for row/header/cell comparison.

### Background-safe browser session lease

Commit: `16f938c Fix background-safe browser session lease`

- Added `input/browser-session.json` lease with:
  `runId`, `caseNo`, `generation`, `sessionId`, `targetId`, random `token`, `tokenHash`, `windowName`, `endpoint`, `devUrl`.
- Agent marks the dedicated tab with:
  `window.name = "uat-tool:<runId>:<caseNo>:<generation>:<token>"`
  and `sessionStorage.__uatToolBrowserSession`.
- Helper only operates the token-marked page.
- No fallback to first Galaxy tab, active tab, OS foreground tab, or URL-only match.
- Removed official run-path foreground stealing:
  no `page.bringToFront()`, no CDP `/json/activate`, no auto activation after MCP tool call.
- `collage.configureMetric` waits for `載入欄位中...` to clear before looking for field controls.
- Helper artifacts now record `foregroundPolicy=no-activate`, target binding, and browser session diagnostics.

## Latest OTTEST002_23 observation

Input file mentioned by Tommy:

- `/Users/tommy/Downloads/RoundID_ OTTEST002_23.md`

High-level result:

- This was the best run so far and close to a small formal batch test.
- 5 cases ran through.
- Single-case result xlsx files ingested.
- Final aggregate xlsx generated.
- 120 evidence artifacts uploaded.
- Browser session lease worked: logs showed `no-activate`, `bringToFrontCalled=false`, and `cdpActivateCalled=false`.
- A-04 CSV passed: report-list CSV was downloaded and compared with preview evidence.

Remaining concerns before running 40-50 collage cases:

1. A-03 still BLOCKED.
   Root cause appears to be `extractMetadataDropdownFields` not waiting for the field list to finish loading. It checks too early while UI still shows `載入欄位中...`, then reports `ADD_FIELD_BUTTON_NOT_CLICKABLE`. Apply the same field-list wait used by `configureMetric`.

2. A-03 detail_json quality is weak.
   `/detail-health` reported missing core fields: `測試目的`, `設定條件`, `預期行為`, `實際行為`. Result evidence gate was ok, but a report-quality gate should block or warn when BLOCKED detail_json is too thin.

3. A-01/A-05 FAIL is likely real, but reopen evidence should be stronger.
   Save POST payload contains correct date/fields, but reopened editor shows `過去7天`. Add loader settle wait after reopen and record report detail network evidence so RD cannot dismiss it as insufficient wait.

4. Codex warning noise.
   Logs contain repeated `failed to record rollout items: thread ... not found`. It does not block execution/ingest/aggregate, but for 40-50 cases it will be noisy. Consider filtering, downgrading, or documenting as non-blocking diagnostic noise.

5. System-generated complete run archive MD.
   Tommy manually pasted a file containing `timeline / logs / events`. The system should generate this as a downloadable MD.
   Keep three distinct outputs:
   - `下載結果 XLSX`: final aggregate workbook.
   - `下載報告 MD`: concise PM/RD report with case results, bugs, important evidence, important timeline.
   - `下載完整紀錄 MD`: full run archive with timeline, logs, events, artifact stats, timing summary, key per-case state.

6. Mobile RWD overflow.
   On mobile, settings/upload fields and case rows can overflow. Known candidates:
   - `card-header .actions`
   - `case-row`
   - long file names
   - Agent name
   - Dev URL
   - detail_json values
   - Run summary metadata/file chips
   Use `min-width: 0`, `overflow-wrap: anywhere`, stacked mobile layouts, and wrapping actions.

## Final user-approved next task

Tommy approved doing the above adjustments, then asked about versioning.

The last thread crashed before edits began. No tracked code changes were left after the final prompt.

Next implementation scope:

1. Add version discipline.
   - Current root version is `1.0.0`.
   - Current Agent version is `0.1.0`.
   - Prior thread proposed bumping root to `1.1.0` and Agent to `0.2.0`.
   - `/version` already reads root `package.json`.
   - Agent currently sends hard-coded `0.1.0` in `agent/src/connection.ts`; update it to read/sync from `agent/package.json` or a shared version constant.
   - Record version changes in git, docs, and deployment notes.

2. Fix A-03 metadata helper wait.
   - Reuse or factor the `waitForMetricFieldControls()` logic around `agent/src/bi-ui-helper-executor.ts`.
   - `extractMetadataDropdownFields` should wait for loading to end or field picker controls to become available.
   - Timeout should be `FIELD_LIST_LOAD_TIMEOUT`, not `ADD_FIELD_BUTTON_NOT_CLICKABLE`.

3. Strengthen BLOCKED detail_json health.
   - Add or tighten gate/warning for `測試目的`, `設定條件`, `預期行為`, `實際行為` even for BLOCKED.
   - Existing endpoint: `GET /api/runs/:id/detail-health`.
   - Existing evidence gate: `src/result-parser/result-evidence-gate.ts`.

4. Strengthen `reopenReport` settle/network evidence.
   - File: `agent/src/bi-ui-helper-executor.ts`, function `reopenReport`.
   - Wait for field/filter/group/date state loaders to settle after reopening.
   - Capture report detail network evidence where possible.
   - Do not reintroduce foreground activation.

5. Add complete run archive MD download.
   - Existing concise MD endpoint: `POST /api/runs/:id/export-md` in `src/runs.ts`.
   - Existing UI download handler around `web/src/App.tsx` export/download functions.
   - Add a separate archive endpoint/button instead of overloading report MD.
   - Include timeline/logs/events with enough filtering to be useful for 40-50 cases.

6. Fix mobile RWD overflow.
   - Files: `web/src/App.tsx`, `web/src/App.css`.
   - Target run summary, upload controls, action buttons, case rows, detail table/detail_json, artifact/download sections.

7. Update docs and verification.
   - Must update `online-uat-tool-development-log.md`, `docs/refactor/規劃說明.md`, `docs/refactor/工程spac.md`, README if version/download/RWD behavior changes.
   - Run typecheck/build/verification relevant to agent/server/web.
   - Commit and push both `refactor/mac-agent-mvp` and `codex/uat-tool-mvp` for runtime/UI changes.
   - Confirm Railway `/version` and `/health`.
   - Restart local Mac Agent if Agent code/version changed.

## Suggested new-chat opening prompt

Use this in the next Codex chat:

```text
請先讀：
1. /Users/tommy/Downloads/codex_galaxy/uat-tool/docs/planning/session-handoff-2026-05-03-ottest002-next.md
2. /Users/tommy/Downloads/codex_galaxy/uat-tool/docs/planning/online-uat-tool-development-log.md
3. /Users/tommy/Downloads/codex_galaxy/uat-tool/AGENTS.md

不要讀舊 raw session JSONL，尤其不要讀「續接 OTTEST002 P0」的完整 JSONL，避免再次 compact 掛掉。

請接續 `續接 OTTEST002 P0` 最後未完成的工作：
- 建立版本紀律：root app 從 1.0.0 升到 1.1.0、Agent 從 0.1.0 升到 0.2.0；Agent version 不要再 hard-code 0.1.0。
- 修 A-03 metadata helper wait，讓 extractMetadataDropdownFields 等欄位清單載入完成。
- 強化 BLOCKED detail_json health。
- 強化 reopenReport settle/network evidence。
- 新增「完整紀錄 MD」下載，包含 timeline/logs/events/artifact/timing。
- 修手機 RWD overflow。

修改前先回報你讀到的重點與具體修改範圍。修改後更新 planning log、refactor docs、README/spec；跑 typecheck/build/verify；commit/push 工作分支與 deployment branch；確認 Railway /version、/health；必要時重啟本機 Agent。
```
