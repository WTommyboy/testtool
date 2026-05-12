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

- App/API: `1.1.8`
- Mac Agent: `0.2.30`

Active branches:

- `refactor/mac-agent-mvp`: working branch for implementation and docs.
- `codex/uat-tool-mvp`: GitHub default branch and Railway deployment branch.

Dev sandbox endpoints:

- Web preview: `testtool-git-dev-uat-agent-config-isolation-*` Vercel preview deployments.
- API: `https://testtool-dev.up.railway.app`
- Agent launchd: `com.tommy.uat-agent-dev`
- Agent config/workdir: `/Users/tommy/.uat-agent-dev`

## Current Status

The current line is the Mac Agent MVP. It supports:

- Web run creation and file upload.
- Railway dispatch to a connected local Mac Agent.
- Codex run workspace generation under `~/.uat-agent/runs/<runId>/`.
- Layer 1 platform skill and BI domain pack injection.
- Preflight, auth, package consistency, capability gate, and run-state safeguards.
- Tool Bridge for native dialogs, irreversible actions, SSO/auth blockers, and ambiguity handling.
- Web run detail now exposes Tool Bridge request lifecycle status (`pending_approval`, `response_sent`, `response_delivered`, `response_missing`) so missing App/Agent responses are distinguishable from Tommy not approving.
- One-case-at-a-time execution discipline.
- Single-case `output/result.xlsx` upload and evidence gate, with Tool Bridge claim detection scoped to explicit approval/native-dialog/irreversible-action claims rather than ordinary testcase prose; negative or insufficient evidence prose such as `無 native confirm` / `缺少 native dialog 驗證` / formula modal blocked wording / `缺少 Tool Bridge response` does not require another Tool Bridge response.
- If Codex accidentally writes a full 17-column testcase-style workbook as `output/result.xlsx`, Mac Agent normalizes only the expected current-case row into the result-contract workbook before self-check/upload; blank or future testcase rows are not sent to the parser.
- Result self-check uses normalized date UI evidence for configureMetric date-range checks, so static dates such as `2026-03-01` vs `2026/03/01` do not false-block a PASS when `date-ui-evidence` proves the represented range; reopen date regressions still block PASS.
- Helper preview/date-variant execution now checks that at least one metric field is selected before clicking BI `執行`; non-destructive BI validation alerts such as `請至少選擇一個欄位` are treated as execute-precondition BLOCKED evidence rather than missing PM authorization.
- A-06 style all-zero-field inspection cases can use `collage.inspectAllZeroFields`: the helper selects all fields for the requested source report through visible UI, guards selected-field count before Execute, captures request/response/chart/table evidence, and writes `all-zero-field-inspection-evidence.json` with all-zero candidates for Codex to judge.
- Formula/calculated-field cases use `openProject -> createReport -> configureCalculatedMetricAndPreview`; formula modal keypad/operator wording no longer gets misclassified as filter helper work.
- Save-only Collage cases create/configure/preview/save a fresh report and suppress open-existing, reopen, and CSV download shortcuts.
- D-02 style structured select-all params map `expectedSources` and `expectedTotalFieldCount` into source-report selection plus strict expected field count evidence.
- Date-variant helpers preserve preset arrays, structured static/preset variant objects, and staged 90/91-day boundary specs including expected UI-block observations.
- Source testcase rows with a prefilled terminal `結果` such as `BLOCKED` are imported as terminal normalized cases; their steps are marked `SKIPPED`, and Agent manifests advance to the next runnable case instead of executing them.
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
- Multi-variant preset date cases and static date regression cases can use `collage.runDateVariantsPreviewEvidence`, which sets each date through visible UI and captures per-variant date UI, request body, chart/table, and screenshot evidence; Codex still judges PASS/FAIL/BLOCKED.
- Static editor-session CSV cases can chain `collage.runDateVariantsPreviewEvidence` directly into `collage.downloadCsvAndComparePreview`, keeping the flow inside the same report editor session without save/reopen/report-list navigation.
- Same-case project-row CSV cases can create a unique report, collect preview/date evidence, save, and then set `downloadScope=report_list` from structured params such as `downloadEntry=project_page_row_download_button`; F-04/F-05 and F-06/F-07/F-08 D0 baseline flows avoid open-existing-report and editor reopen shortcuts.
- OTTEST004 F-flow `0.2.28` was verified with real helper/UI smoke before push: F-03 editor-session CSV run `smoke-ottest004-f03-20260508055838` and F-05 project-row CSV run `smoke-ottest004-f05-20260508060019` both produced current-run preview evidence, CSV download evidence, and preview-vs-CSV 31-row matches.
- Dynamic custom date and half-dynamic date cases can use structured `dateMode=relative|hybrid` with `collage.runDateVariantsPreviewEvidence`, which fills the visible dynamic/static date controls and captures UI/network/chart/table evidence.
- Formula/calculated-field cases can use `collage.configureCalculatedMetricAndPreview`, which adds base fields, opens the formula modal, fills `#calculatedFieldNameInput`, and handles readonly `#formulaInput` by clicking modal field tokens plus keypad/operator buttons before submitting `saveFormula()`; it then sets date/display and captures preview evidence without judging PASS/FAIL.
- Formula/calculated-field testcase packages should use modal-aware helper hints with explicit `baseFields`, `calculatedFieldName`, `formula`, formula modal UI labels, date/display, and `formula.uiState` / request / chart evidence; testcase prose should not rely on a single generic "新增運算欄位" sentence.
- Helper-hints parser accepts the formula helper template and normalizes evidence strings such as `formula.uiState: ...` to canonical evidence tokens for package compatibility; authoring should still prefer pure tokens in `requiredEvidence`.
- Create-project cases can use `collage.createProject` after Tool Bridge approval; the helper selects project mode = `拼貼`, fills a current-case test project name in the modal-scoped input, blocks on `請選擇模式` alerts, accepts known success dialogs, and writes `created-project.json` so same-case create-project-then-report flows continue in the new project.
- Project-page navigation cases can use `collage.openReportFromProjectList` and `collage.clickBackToProjectList` for G-04/G-05-style report-name reopen and return-button smoke checks without falling back to generic `manual_ai` prelude only.
- OTTEST004_027 blocked-reduction helper fixes add strict metric field identity matching by field code/explicit alias, so `累計bf!創帳數` no longer satisfies `bf!創帳數`; create-project names are capped to the BI modal's 20-character limit before submission; project open/back helpers poll real report-list readiness and use read-only DOM fallback evidence when `locator.innerText()` is unstable.
- The 2026-05-08 blocked-reduction patch was verified with real helper/UI smoke runs: H-03 field reconcile `smoke-ottest004-h03-field-reconcile-20260508220946`, A-01 inferred project open `smoke-ottest004-a01-openproject-20260508221252`, F-02 save/reopen `smoke-ottest004-f02-save-reopen-20260508221122`, G-05 back button `smoke-ottest004-g05-back-rerun2-20260508221632`, and G-01 create project `smoke-ottest004-g01-createproject-rerun3-20260508222359`.
- The blocked-reduction runtime patch is deployed through `codex/uat-tool-mvp` as commit `1dcb21d`; Railway production `/health` is healthy and the local `com.tommy.uat-agent` LaunchAgent was restarted to serve Agent `0.2.28`.
- OTTEST004_029 refund alias helper fixes map legacy testcase label `退費總金額` exactly to current UI label/code `總退費金額` / `TOTAL_REFUND`, including the formula modal token picker. The alias is code-guarded so `TOTAL_REFUND_IOS`, `TOTAL_REFUND_AOS`, and `TOTAL_REFUND_WEBSHOP` do not satisfy the total-refund target. Real helper/UI smoke passed for D-01 (`smoke-ottest004-d01-refund-alias-202605090001`) and E-03 (`smoke-ottest004-e03-refund-alias-rerun2-202605090001`).
- Temporary report deletion cases can use `collage.createAndDeleteTemporaryReport`: the helper creates a current-case temp report, requires Tool Bridge approval before delete, accepts only known BI delete confirmation, rejects protected/main report names, and verifies the temp row is gone.
- Date UI evidence is first-class: `collage.configureMetric` writes `date-ui-evidence.json`, and manual/Codex-visible date cases can use `collage.captureDateUiEvidence` to record the requested UI label plus the visible or baseDate-computed represented date range.
- Optional support files are indexed with lightweight profiles in `input/supporting-docs-manifest.json` so Codex can inspect CSV headers/row counts or markdown headings before choosing a full file to read.
- Successful same-run helper browser evidence can satisfy preflight for helper-assisted cases; Codex should not mark `TOOL_EXECUTION_UNAVAILABLE` solely because Codex-side browser tools are absent.
- Codex-side visible-UI cases must first attempt Playwright MCP `browser_tabs`; a successful tab listing proves browser tooling is available and prevents false `TOOL_EXECUTION_UNAVAILABLE`.
- Mac Agent `0.2.30` explicitly injects the Playwright MCP command, Chrome CDP args, and browser tool approval settings into child Codex. This fixes the dev split blocker where child Codex received only `mcp_servers.playwright.args` and therefore could not reliably see `browser_tabs`.
- Dev MCP preflight smoke passed before production promote: Railway dev run `5e420973-8462-4077-8fd7-e33e19a5fe08`, case `MCP-01=PASS`, child Codex called `browser_tabs(action=list)`, read DEV BI URL/title/body through `browser_run_code`, and classified the page as `reachable_galaxy_bi`.
- The web header environment badge is environment-aware: dev/local/preview displays `DEV`, production displays `PROD`, with separate color tones.
- Degraded-case trusted `BLOCKED` result handling when browser/manual UI tools are unavailable.
- Mandatory BI rule loading for each BI case.
- Metadata reference, CSV download, and formula/calculated-field modal authoring contracts.

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

`output/result.xlsx` is not the uploaded testcase package. Do not copy `input/testcase.xlsx` into `output/result.xlsx`; the result workbook should contain only the current case's result-contract row. As a guardrail, the Mac Agent can normalize a Codex-written testcase-style workbook by extracting the expected current case row and replacing the file with a proper result-contract workbook before self-check.

For deterministic result writing, Codex may write `detail.json` first and use the fixed writer:

```bash
node agent/dist/result-cli.js write --run-dir <runDir> --case <caseNo> --status <PASS|FAIL|BLOCKED|PARTIAL> --detail-json <detail.json> [--fail-category <category>]
```

Railway ingests each single-case workbook into normalized state. The UI result download is generated from server-normalized run state: final aggregate when all cases are terminal, partial aggregate when a run fails or is interrupted with completed cases. It should not fall back to the last raw single-case workbook unless no normalized case result exists yet.

Source testcase xlsx rows may also be prefilled before a run. When the source row has a terminal `結果` (`PASS`, `FAIL`, `BLOCKED`, `PARTIAL`, `SKIPPED`, or manual terminal status), Railway imports that result directly and marks that case's steps `SKIPPED`. Agent manifests and case advancement skip rows with a non-pending result, but do not skip merely because `詳細紀錄JSON` is present.

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

Run detail includes a Tool Bridge status panel and `/api/runs/:id/tool-bridge` API. It shows request id, case, action, approval status, response dispatch/delivery timestamps, and flags `TOOL_BRIDGE_RESPONSE_MISSING` when an approval was resolved but the App/Agent did not send or bind a response.

The result evidence gate only requires Tool Bridge response evidence when `detail_json` explicitly claims approval, native dialog handling, or an irreversible action. Test language such as "second preview result overwrites the first preview display" is treated as ordinary evidence prose, not an irreversible overwrite/save claim. Negative or insufficient evidence wording such as "no native confirm" or "missing native dialog evidence" is also treated as a BLOCKED evidence statement, not as a claim that a native dialog was handled.

Non-destructive validation alerts caused by failed execute preconditions, such as `請至少選擇一個欄位`, are not treated as Tool Bridge authorization failures. The correct result is a current-case `BLOCKED` with explicit DOM/alert evidence.

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
- Result self-check blocks any `PASS` result that contradicts current-run helper state checks, such as `collage.reopenReport` reporting `dateRange=false`; configureMetric dateRange checks are allowed only when normalized `date-ui-evidence` proves the requested represented range.
- If a visible row download click produces a CSV/attachment response but no browser `download` event, the Agent may save that UI-triggered response body as CSV evidence and label `downloadedCsv.source`. Report-list CSV helpers now attempt row-nearby download controls even when the first row-state scan does not find a descendant download button, reducing false `csv_button_missing_on_saved_report_row` blockers.
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
