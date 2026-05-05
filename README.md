# UAT Tool

Galaxy UAT Tool is the online dispatch platform for running structured UAT cases with a local Mac Agent, Codex CLI, and Playwright-controlled browser.

The current production path is:

```text
Vercel Web UI
  -> Railway API / WebSocket Hub
  -> Tommy Mac Agent
  -> Codex CLI + Playwright MCP
  -> Galaxy BI UI
  -> single-case result.xlsx ingest
  -> final aggregate result.xlsx
```

Production endpoints:

- Web UI: `https://testtool-eight.vercel.app/`
- API: `https://testtool-production.up.railway.app`
- Health: `https://testtool-production.up.railway.app/health`
- Version: `https://testtool-production.up.railway.app/version`

Current semantic versions:

- App/API: `1.1.2`
- Mac Agent: `0.2.12`

Active branches:

- `refactor/mac-agent-mvp`: working branch for implementation and docs.
- `codex/uat-tool-mvp`: GitHub default branch and Railway deployment branch.

## Current Status

The current line is the Mac Agent MVP. It supports:

- Web run creation and file upload.
- Railway dispatch to a connected local Mac Agent.
- Codex run workspace generation under `~/.uat-agent/runs/<runId>/`.
- Layer 1 platform skill and BI domain pack injection.
- Preflight, auth, package consistency, capability gate, and run-state safeguards.
- Tool Bridge for native dialogs, irreversible actions, SSO/auth blockers, and ambiguity handling.
- One-case-at-a-time execution discipline.
- Single-case `output/result.xlsx` upload and evidence gate.
- Server-side normalized result state.
- Final aggregate result workbook download after all cases finish.
- Concise report Markdown download and complete archive Markdown download; the archive includes timeline, logs, events, artifact inventory, timing summary, and per-case state.
- `groupId / 群組ID` testcase schema.
- OTTEST002 collage helper P0 coverage for multi-field preview, table preview evidence, save/reopen, existing-report overwrite, metadata dropdown extraction, and UI-triggered CSV download evidence including report-list row refresh/re-targeting.
- Background-safe dedicated Chrome execution: each run/case writes `input/browser-session.json`, binds helper actions to a token-marked tab, and does not bring Chrome to the foreground during normal helper/Codex phases.
- Helper field setup waits for BI field-list loading to complete before looking for `+ 新增欄位`, so slow `載入欄位中...` states are reported as loading timeouts instead of immediate button blockers.
- Metadata dropdown extraction uses the same field-list wait as metric configuration; A-03 style helpers should not report `ADD_FIELD_BUTTON_NOT_CLICKABLE` while the BI field list is still loading.
- Reopen helpers settle after the report editor reloads and record reopen DOM/network evidence for date/field state restoration cases.
- Metadata dropdown evidence is source-group scoped when the BI picker exposes group headers such as `DAILY_REPORT`; source-list cases compare distinct source groups, missing source groups are recorded as evidence instead of all-items fallback, and source-specific cases preserve exact field-name diffs plus normalized known-alias diffs.
- Source-specific metadata comparisons keep `expectedFieldCount` scoped to the requested source report; all-source comparisons must use all-source scope/total count explicitly, so A-04/A-05 style cases do not silently fall back to all 4 sources.
- Select-all field helpers reconcile selected fields by stable field code and nearby visible label, so code-style buttons such as `MAX_CCU` are not mistaken for missing fields or merged with unrelated labels.
- Multi-variant or dynamic date cases are routed to Codex visible UI instead of helper pre-run, avoiding single-action helper false BLOCKED results for cases such as shortcut comparisons, dynamic offsets, half-dynamic ranges, and 90/91-day boundary checks.
- Date UI evidence is first-class: `collage.configureMetric` writes `date-ui-evidence.json`, and manual/Codex-visible date cases can use `collage.captureDateUiEvidence` to record the requested UI label plus the visible or baseDate-computed represented date range.
- Optional support files are indexed with lightweight profiles in `input/supporting-docs-manifest.json` so Codex can inspect CSV headers/row counts or markdown headings before choosing a full file to read.
- Successful same-run helper browser evidence can satisfy preflight for helper-assisted cases; Codex should not mark `TOOL_EXECUTION_UNAVAILABLE` solely because Codex-side browser tools are absent.
- Codex-side visible-UI cases must first attempt Playwright MCP `browser_tabs`; a successful tab listing proves browser tooling is available and prevents false `TOOL_EXECUTION_UNAVAILABLE`.
- Degraded-case trusted `BLOCKED` result handling when browser/manual UI tools are unavailable.
- Mandatory BI rule loading for each BI case.
- Metadata reference and CSV download authoring contracts.

## Core Contracts

### One Case At A Time

Each testcase must remain isolated:

1. Run one case.
2. Write one single-case `output/result.xlsx`.
3. Upload and ingest that result.
4. Pass evidence gate.
5. Advance to the next case only after the server accepts the previous result.

Codex and helpers must not accumulate multiple case results in memory and write them together.

### Result Workbooks

Codex writes a single-case workbook:

```text
output/result.xlsx
```

Required sheets:

- `索引`
- `測試案例`
- `Bug`

The `測試案例` sheet must include:

- `群組ID`
- `群組`
- `編號`
- `測試項目`
- `測試類型`
- `執行方式`
- `結果`
- `失敗分類`
- `詳細紀錄JSON`

Railway ingests each single-case workbook into normalized state. The UI result download is generated from server-normalized run state: final aggregate when all cases are terminal, partial aggregate when a run fails or is interrupted with completed cases. It should not fall back to the last raw single-case workbook unless no normalized case result exists yet.

`detail_json` is a hard-gated contract. `PASS` and `BLOCKED` both require `測試目的`, `設定條件`, `預期行為`, and `實際行為`; `BLOCKED` additionally requires `blocked_reason` and current-run evidence. `FAIL` adds RD-facing root-cause fields, and `PARTIAL` requires explicit matching/non-matching subitem lists.

### Evidence

Trusted results must use current-run evidence. Old screenshots, old workbooks, old reports, old page data, or compact summaries are not proof.

Evidence priority:

- DOM/form state
- UI-triggered network observation
- chart/table structured data
- downloaded local files produced by visible UI actions
- screenshots as human-facing support

### Browser Session Lease

Mac Agent uses a dedicated Chrome profile, but foreground focus is not part of the trust model. Each run/case starts by creating or reusing one DEV tab and writing:

```text
input/browser-session.json
```

The lease records `runId`, `caseNo`, `generation`, `sessionId`, CDP `targetId`, a random token hash, and the expected `window.name`. The Agent marks the tab with that `window.name` plus `sessionStorage.__uatToolBrowserSession`.

Helper actions must resolve the page by this marker before touching UI. They must not fall back to the first Galaxy tab, the active tab, or the OS foreground window. If the marker is missing or stale, helpers return `BROWSER_SESSION_*` blocked reasons instead of guessing.

Normal runs do not call `page.bringToFront()` or CDP `/json/activate`. Opening the dedicated Chrome window/tab at run or case start is allowed; repeated foreground stealing during helper actions is not.

### Tool Bridge

Native dialogs, irreversible actions, overwrite/delete/save flows, SSO/auth blockers, and ambiguous package conflicts must go through Tool Bridge. Testcase text or startup instructions are not authorization.

The Mac Agent may auto-approve non-auth Tool Bridge requests only when the local policy allows it.

## Test Package Source Of Truth

There are two different things that should not be mixed:

### Authoring Rules

`docs/authoring/UAT_三文件撰寫規則.md`

This is the rulebook for how to write testcase packages. It defines the expected shape of:

- testcase xlsx
- Codex assignment markdown
- test execution instruction markdown
- helper hints
- evidence requirements
- metadata and CSV reference wording

It is not a specific OTTEST002 package.

### Actual Test Packages

The actual OTTEST002 package currently lives in the wider local workspace:

```text
/Users/tommy/Downloads/codex_galaxy/BI_UAT_ROUNDS/onlinetest/OTTEST002/
```

Those files can be uploaded and used locally, but they are outside this repository root:

```text
/Users/tommy/Downloads/codex_galaxy/uat-tool
```

That means updates to those local xlsx/md files are real on this Mac, but they are not captured by this repo's commits unless we copy or move them into a tracked path.

Recommended tracked location for future stable packages:

```text
test-packages/<RoundId>/
```

Example:

```text
test-packages/OTTEST002/
  拼貼工具測試_測試案例_v1_0.xlsx
  Codex_指派文字_TOOL001_v1_0.md
  拼貼工具測試_測試執行說明_for_v1_0.md
```

This does not replace `UAT_三文件撰寫規則.md`. The rulebook explains how packages should be written; `test-packages/<RoundId>/` would store the exact package version used for a run.

## OTTEST002 Current Decisions

OTTEST002 is the current production regression package for the online UAT Tool / Mac Agent path.

Important current decisions:

- All five cases are collage-mode cases.
- Agent mode runs cases continuously in manifest order, but still with one-case result ingest per case.
- `TOOL-A-01` and `TOOL-A-05` expose a product behavior: reopening a saved report can restore date range as `過去7天` instead of `2026/03/01~2026/03/31`.
- `TOOL-A-02` is the positive multi-field preview path and should remain a regression guard.
- `TOOL-A-03` metadata comparison is helper-assisted: Mac Agent opens the field picker through visible UI, writes `metadata-dropdown-evidence.json`, and Codex judges against `rules/BI_DATA/metadata.csv`.
- `TOOL-A-03` actual fields must be scoped to the requested source group, currently `每日報表` / `DAILY_REPORT`, before comparing with metadata.
- `TOOL-A-03` expected metadata must be confirmed by `input/reference-index.json` key `bi_metadata_csv` or source filename `metadata＿1.2.5 - 工作表1.csv`.
- When multiple CSV/reference files are present, Codex must not bulk-read every file and guess which one is metadata.
- `TOOL-A-04` CSV verification now targets the saved report row on the project/report list page, refreshes/re-targets that row when the post-save list is stale, and compares the CSV to pre-save preview table/chart evidence; it should not reopen the editor or test date-range restoration.
- CSV comparison normalizes preview table exports by dropping a duplicated header row and treating `Date` / `日期` as the same date column, so successful list-page downloads are not reported as false mismatches.
- When a helper plan reaches a pending save/overwrite action and Mac Agent auto-approval is enabled, Agent records a Tool Bridge auto-approval from the helper plan, runs the approved helper continuation, and exposes `helper-continuation-summary.json` before Codex writes the case result.
- Existing-report collage edits reconcile selected fields exactly before save: the Agent reads visible selected-field remove controls, removes extra/duplicated fields through UI clicks, adds missing target fields through the normal picker, and requires exact field evidence instead of mere text containment.
- Result self-check blocks any `PASS` result that contradicts current-run helper state checks, such as `collage.reopenReport` reporting `dateRange=false`.
- If a visible row download click produces a CSV/attachment response but no browser `download` event, the Agent may save that UI-triggered response body as CSV evidence and label `downloadedCsv.source`.
- Google Sheets is only a manual exploratory fallback, not a formal evidence path.
- If save/list-row/download preconditions fail before CSV comparison, write `csv_comparison_status="not_reached"` and judge the failed necessary subcondition directly.

## Documentation Map

Read these first for current project state:

- `docs/refactor/規劃說明.md`: current planning view, roadmap, operating model.
- `docs/refactor/工程spac.md`: current engineering spec. The filename is kept as provided, but the document is the engineering spec.
- `docs/planning/online-uat-tool-development-log.md`: chronological engineering log and decisions.
- `docs/authoring/UAT_三文件撰寫規則.md`: testcase package authoring rules.
- `agent-skills/uat-tool/SKILL.md`: Layer 1 platform skill entrypoint.
- `agent-skills/uat-tool/rules/`: Layer 1 platform rules.
- `domain-packs/BI/`: BI domain pack.

Project-local engineering instruction:

- `AGENTS.md`

This file requires planning/spec/log updates whenever runtime, schema, result artifact, Agent/helper behavior, deployment, or authoring contracts change.

## Local Development

Install and run API locally:

```bash
npm install
npx playwright install chromium
npm run dev
```

The API starts at:

```text
http://localhost:3000
```

Build and verify:

```bash
npm run typecheck
npm run build
npm run typecheck --prefix agent
npm run build --prefix agent
npm run build --prefix web
npm run verify:capability-gate
npm run verify:package-consistency
npm run verify:helper-hints
npm run verify:agent-result-contract
npm run verify:result-evidence-gate
npm run verify:final-aggregate-result
npm run verify:helper-report-gate
npm run verify:tool-bridge
npm run verify:case-advance-policy
npm run verify:agent-resume
npm run verify:agent-roundtrip
git diff --check
```

Start the local Mac Agent:

```bash
npm run build --prefix agent
node agent/dist/cli.js start
```

Typical local Agent runtime files:

```text
~/.uat-agent/config.json
~/.uat-agent/agent.pid
~/.uat-agent/logs/
~/.uat-agent/runs/<runId>/
~/.uat-agent/chrome-profile/
```

## Railway Deployment Notes

Railway deploys from `codex/uat-tool-mvp`.

Playwright notes:

- `postinstall` runs `playwright install chromium`.
- Do not set `PLAYWRIGHT_BROWSERS_PATH=0` on Railway.
- Prefer `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` or leave it unset when using the provided Dockerfile.
- `nixpacks.toml` installs the Linux packages needed by Playwright Chromium.
- If Railway reports missing browser executables, redeploy with cleared build cache.
- If errors mention missing shared libraries, confirm Railway rebuilt with the current `nixpacks.toml` or use the project `Dockerfile`.

Deployment verification:

```bash
curl -fsS https://testtool-production.up.railway.app/version
curl -fsS https://testtool-production.up.railway.app/health
```

## API Surface

Common endpoints:

- `GET /health`
- `GET /version`
- `GET /api/runs`
- `GET /api/runs/history`
- `POST /api/runs`
- `GET /api/runs/:id`
- `POST /api/runs/:id/import-xlsx`
- `POST /api/runs/:id/start`
- `POST /api/runs/:id/status`
- `POST /api/runs/:id/cancel`
- `POST /api/runs/:id/export-md`
- `POST /api/runs/:id/export-archive-md`
- `GET /api/runs/:id/cases`
- `GET /api/runs/:id/logs`
- `GET /api/runs/:id/events`
- `GET /api/runs/:id/output/result-xlsx`
- `GET /api/runs/:id/output/log`
- `POST /api/runs/:id/output/result-xlsx`
- `POST /api/runs/:id/output/artifacts`

Agent path:

- Railway stores uploaded xlsx/md/reference files.
- Agent downloads a run packet.
- Agent writes generated run guidance under `~/.uat-agent/runs/<runId>/input/`.
- Codex writes `output/result.xlsx`.
- Agent performs pre-upload self-check and upload.
- Railway parses and gates the result.

## Maintenance Discipline

When changing runtime behavior, schemas, result artifacts, Agent/helper behavior, deployment behavior, or authoring contracts, update these in the same commit:

- `docs/planning/online-uat-tool-development-log.md`
- `docs/refactor/規劃說明.md`
- `docs/refactor/工程spac.md`
- affected Layer 1 / BI / authoring rules
- README when the public project overview changes

If a change intentionally does not update those files, explain why in the final handoff.
