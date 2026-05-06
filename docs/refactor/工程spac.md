# UAT Tool 最新工程 Spec

**版本**: v2026-05-07
**狀態**: Mac Agent MVP / App 1.1.5 + Agent 0.2.22 / Indexed Guidance + Preflight Safeguards + groupId schema + final/partial aggregate result + complete archive MD export + OTTEST002 Collage helper P0 + metadata dropdown source-group scoping + metadata expected-source fallback + metadata source-scope count guard + list-page CSV row refresh + response-body fallback + preview table evidence + CSV header/date normalization + helper-plan auto continuation + existing-report field exact reconciliation + helper-evidence preflight replacement + support-file profile + result repair guard + degraded BLOCKED result guard + Tool Bridge run-event evidence gate + Tool Bridge lifecycle status panel + Tool Bridge result-gate false-positive guard + negative native-confirm prose guard + formula-modal blocked gate guard + source-result runtime skip ingestion + execute selected-field precondition guard + non-destructive validation alert allowlist + A-06 all-zero field inspection helper + editor-session CSV helper chain + temporary report create/delete helper + formula/calculated-field preview helper + stable formula modal selector helper + create-project helper + dynamic/hybrid date helper support + strict select-all field-count guard + PASS-vs-helper-false-check gate + PM skip classification + preview-only helper skip guards + case-type must-read rules + CSV/metadata/formula authoring contract + exact metadata source filename contract + background-safe browser lease + no-foreground helper policy + field-list loading wait + inline cleanup consistency parser guard / helper project auto-selection guard / manual_ai helper pre-run guard / manual_ai safe navigation prelude guard / date-variants preview evidence helper / multi-variant date visible-UI routing guard / date UI represented-range evidence / Monday-week date preset guard with weekStart override / select-all fields params guard / selected-field code-label reconciliation / Playwright browser_tabs availability guard / active-question-first session handoff contract
**適用分支**: `refactor/mac-agent-mvp` / `codex/uat-tool-mvp`  
**說明**: 檔名沿用 Tommy 提供的 `工程spac.md`;本文內容為工程 spec。

---

## 1. Scope

本文規範目前最新版 UAT Tool 的工程實作狀態與下一階段開發基準。

涵蓋:

- Vercel 前端
- Railway API / WebSocket Hub
- Mac Agent
- CodexRunner
- Tool Bridge
- Layer 1 Skill
- BI Domain Pack / generated guidance
- per-case result.xlsx ingestion
- final aggregate result xlsx
- phase / log / artifact
- docs maintenance discipline

不涵蓋:

- cloud_novnc 正式方案
- 多 Agent 並行 scheduler
- 完整 artifacts table
- 非 BI domain 的正式 domain pack
- 完整 product-grade auth / RBAC

---

## 2. System Components

### 2.1 Frontend

位置:

```text
web/
  src/App.tsx
  src/App.css
```

部署:

```text
Vercel: https://testtool-eight.vercel.app/
```

環境變數:

```env
VITE_API_BASE_URL=https://testtool-production.up.railway.app
```

主要 UI 區塊:

- 對話生成
- 測試執行
- 執行記錄
- Agent 狀態
- run form
- upload xlsx / md / csv
- phase card
- run log/event timeline
- approval / Tool Bridge panel
- case result list
- bug list

### 2.2 Backend

主要位置:

```text
src/server.ts
src/agent/
src/result-parser/
src/xlsx-parser.ts
src/db.ts
```

部署:

```text
Railway: https://testtool-production.up.railway.app
```

重要 API:

```text
GET  /health
GET  /version
GET  /api/agents
POST /api/agents/tokens
GET  /api/domains
GET  /api/domains/:name/rules
POST /api/runs
GET  /api/runs/history
GET  /api/runs/:id/summary
GET  /api/runs/:id/logs
GET  /api/runs/:id/events
GET  /api/runs/:id/cases
POST /api/runs/:id/start
POST /api/runs/:id/cancel
POST /api/runs/:id/export-md
POST /api/runs/:id/export-archive-md
POST /api/runs/:id/tool-response
POST /api/runs/:id/output/result-xlsx
GET  /api/runs/:id/output/result-xlsx
```

WebSocket:

```text
GET /agent-ws
Authorization: Bearer <agent-token>
```

### 2.3 Mac Agent

位置:

```text
agent/
  src/cli.ts
  src/config.ts
  src/connection.ts
  src/task-runner.ts
  src/codex-runner.ts
  src/browser-session.ts
  src/tool-bridge.ts
  src/doctor.ts
  src/launchd.ts
  src/case-manifest.ts
  src/rule-index.ts
  src/bi-ui-helper-guidance.ts
  src/preflight-guidance.ts
  src/run-state-guide.ts
  src/batch-case-detector.ts
```

package:

```text
package name: uat-tool-agent
binary: uat-agent
version: 0.2.22
```

The Agent WebSocket `X-Agent-Version` header and `agent.online.payload.agent_version` are read from `agent/package.json`; they must not be hard-coded in `agent/src/connection.ts`.

本機路徑:

```text
~/.uat-agent/config.json
~/.uat-agent/runs/<runId>/
~/.uat-agent/chrome-profile/
```

launchd:

```text
com.tommy.uat-agent
```

CLI:

```bash
node agent/dist/cli.js login --server <wss-url> --token <token> --device-name "Tommy Mac"
node agent/dist/cli.js status
node agent/dist/cli.js doctor
node agent/dist/cli.js start
node agent/dist/cli.js launchd install
node agent/dist/cli.js launchd start
```

---

## 3. Runtime Data Flow

### 3.1 Run Create

Frontend sends multipart form to backend.

Inputs:

- `testcaseXlsx`
- `testcaseMd` or multiple docs
- optional `referenceCsv`
- `roundId`
- `location`
- `featureMain`
- `featureSub`
- `runName`
- `devUrl`
- `domain`
- `executionMode=interactive`
- selected `agentId`

Current testcase workbook contract:

- `測試案例` sheet uses 17 columns for new BI online runs.
- `群組ID / groupId` is required and must appear before `群組 / groupName`.
- Parser still accepts older workbooks without `群組ID`; in that case it derives a fallback from `groupName` prefix or `caseNo`, but new authoring must not rely on fallback.
- `groupId` is the machine grouping key for manifest groups, progress, ordering, group downloads, and final aggregate result sorting.

Backend actions:

1. Save upload files.
2. Parse testcase xlsx into initial run cases.
3. Create run row.
4. Create run logs.
5. Return selected run summary.

### 3.2 Run Dispatch

Backend builds `task.dispatch`.

Payload includes:

```json
{
  "run_id": "...",
  "round_id": "...",
  "domain": "BI",
  "dev_url": "https://galaxy.games.gamania.com/biapi-dev/testview/home?gameID=541",
  "startup_instruction": "...",
  "input_urls": {
    "domain_rules": "...",
    "domain_schema": "...",
    "domain_result_adapter": "...",
    "domain_startup_template": "...",
    "xlsx": "...",
    "md": "...",
    "startup_instruction": "...",
    "supporting_doc_1": "..."
  },
  "output_urls": {
    "result_xlsx": "...",
    "log": "..."
  }
}
```

Expected backend status transition:

```text
READY/ASSIGNED -> RUNNING
```

### 3.3 Agent Workspace Preparation

Agent creates:

```text
~/.uat-agent/runs/<runId>/
  AGENTS.md
  state.json
  input/
  rules/
  output/
  mcp-output/
  agent-skills/
```

Downloaded input paths:

```text
input/testcase.xlsx
input/testcase.md
input/startup_instruction.md
input/domain_AGENTS.md
input/domain_xlsx_schema.json
input/domain_result_parser_adapter.json
input/domain_startup_prompt_template.md
input/supporting_doc_*.md
```

Generated guidance:

```text
input/run-brief.md
input/codex-context.json
input/downloaded-inputs.json
input/generated-guides.json
input/case-manifest.json
input/current-case.json
input/cases/*.json
input/rule-index.json
input/bi-ui-helper-guidance.md
input/preflight-auth-check.md
input/run-state.json
```

### 3.4 Codex Execution

Agent calls CodexRunner.

Current strategy:

```text
codex exec --json <prompt>
codex exec resume --json <thread_id> <tool-response-prompt>
```

CodexRunner responsibilities:

- Spawn Codex CLI.
- Capture JSON events.
- Capture assistant text.
- Capture stderr.
- Stream summarized progress to backend.
- Detect thread id.
- Support cancellation.
- Persist raw stdout/stderr.

### 3.5 Browser Session

Agent ensures persistent Chrome CDP:

```text
http://127.0.0.1:9222
```

Purpose:

- Maintain Galaxy SSO.
- Avoid opening fresh browser profile for every run.
- Let Tommy manually login in the same browser when required.
- Keep normal UAT execution background-safe so Tommy can use Safari/Finder/other apps while Agent operates the dedicated Chrome tab.

If Chrome CDP unavailable:

- Agent can fallback to default Playwright MCP browser.
- This is lower confidence for SSO persistence.
- Web UI should still surface phase/log clearly.

Browser identity contract:

```text
input/browser-session.json
```

Schema `uat-browser-session-v1` includes `runId`, `caseNo`, `generation`, `sessionId`, `endpoint`, CDP `targetId`, random `token`, `tokenHash`, `windowName`, `devUrl`, `createdAt`, and `updatedAt`.

Agent writes `window.name = uat-tool:<runId>:<caseNo>:<generation>:<token>` and `sessionStorage.__uatToolBrowserSession` into the dedicated tab. Helper actions must resolve the page by this marker before UI operations. URL-only matching, active-tab matching, foreground-window matching, and first-Galaxy-tab fallback are forbidden.

Foreground policy:

- `page.bringToFront()` is not used in normal helper execution.
- CDP `/json/activate` is not used in normal run/case/continuation paths.
- Tab cleanup may close extra page targets inside the dedicated Chrome profile, but it must not activate the remaining tab.
- Opening the dedicated Chrome window/tab at run or case start is allowed.
- Manual recovery is surfaced through Tool Bridge/log events, not foreground stealing.

---

## 4. Generated Guidance Contract

### 4.1 `input/run-brief.md`

Purpose:

- First file Codex should read.
- Compact dispatch packet.
- Contains run id, domain, dev url, workdir, required files.
- Points to current case, rule index, BI helper guidance.
- Repeats hard gates.

Required content:

- `run_id`
- `round_id`
- `domain`
- `dev_url`
- `expected_result_xlsx`
- `case_manifest`
- `current_case`
- `rule_index`
- `bi_ui_helper_guidance`
- `preflight_auth_check`
- `run_state`
- fast path
- hard gates
- Tool Bridge schemas
- visible phases

### 4.2 `input/case-manifest.json`

Purpose:

- Index of testcase rows.
- Navigation aid only.
- Not permission to execute multiple cases in one flow.

Schema:

```ts
type CaseManifest = {
  generatedAt: string;
  workbookPath: string;
  sheetName: string | null;
  totalCases: number;
  groups: Array<{
    id: string | null;
    name: string;
    caseCount: number;
    caseNos: string[];
  }>;
  cases: CaseManifestCase[];
  warnings: string[];
};

type CaseManifestCase = {
  order: number;
  rowNumber: number;
  groupId: string | null;
  groupName: string | null;
  caseNo: string;
  caseTitle: string | null;
  testType: string | null;
  executionMethod: string | null;
  riskLevel: string | null;
  testTarget: string | null;
  cleanupChecklist: string | null;
  stepsSummary: string | null;
  expected: string | null;
  currentCaseFile: string;
};
```

Parser behavior:

- Prefer ExcelJS.
- If ExcelJS fails, fallback to minimal JSZip xlsx XML reader.
- Missing optional headers become `null`.
- Missing `groupId / 群組ID` produces a warning and a fallback derived from group name or case number for backward compatibility.
- Parse failure must not crash the entire run; warnings are written.

### 4.3 `input/current-case.json`

Purpose:

- Start/current case only.
- Codex should read this before full workbook.

Current limitation:

- It is generated at run start.
- If startup instruction explicitly says to start/resume from a case, Agent selects that case instead of the workbook first case.
- It does not yet automatically advance after each case.

Next improvement:

- Add Agent or Codex-side case pointer update after each completed case.

### 4.4 `input/rule-index.json`

Purpose:

- Rule routing index.
- Helps Codex choose minimal rule file.

Schema:

```ts
type RuleIndex = {
  generatedAt: string;
  domain: string;
  entries: RuleIndexEntry[];
  currentCaseRecommendations?: {
    basedOn: string[];
    ruleIds: string[];
    notes: string[];
  };
  loadingPolicy: string[];
};

type RuleIndexEntry = {
  id: string;
  scope: "platform" | "domain" | "input";
  path: string;
  loadWhen: string[];
  summary: string;
};
```

Required entries:

- `preflight-auth-check`
- `document-consistency`
- `reference-index`
- `supporting-docs-manifest`
- `run-state`
- `platform-skill`
- `domain-routing`
- `tool-bridge`
- `evidence-policy`
- `artifacts-and-results`
- `codex-runtime`
- `agent-security`
- `run-lifecycle`
- `bi-domain-entrypoint`
- `bi-project-agents-full`
- `bi-rule-*`
- `case-manifest`
- `current-case`
- `current-case-pack`
- `current-case-pack-json`
- `bi-ui-helper-guidance`
- `evidence-template-index`
- `result-template`
- `network-observation-guidance`
- `browser-session`

Current-case behavior:

- `input/current-case-pack.json.mustReadRuleKeys` is the mandatory first-pass rule bundle.
- `rule-index.currentCaseRecommendations.ruleIds` merges the mandatory bundle with existing recommendation logic and filters it to available files.
- Every BI case mandatory bundle includes platform skill, domain-routing, `PROJECT_AGENTS_FULL.md`, and the three canonical `BI_TEST_RULES/*.md` rulebooks before result judgment.
- CSV/download cases add `reference-index`, `evidence-template-index` and BI helper guidance. Formal CSV evidence is a UI-triggered local CSV parsed by the Agent/Codex; Google Sheets is not part of the trusted evidence path. For list/project-page downloads, the helper targets the current run's saved report row, refreshes/re-targets the list when the post-save page is stale, and compares the CSV with pre-save preview table/chart evidence without reopening the editor. If a visible UI click yields a CSV/attachment response but no browser download event, the helper may persist that UI-triggered response body and labels the source in evidence.
- Metadata/dropdown cases add `reference-index` and the BI metadata rule; canonical CSV path is `rules/BI_DATA/metadata.csv`, confirmed by `bi_metadata_csv` or the testcase source filename such as `metadata＿1.2.5 - 工作表1.csv`. `metadata_dropdown_compare` is helper-assisted by `collage.extractMetadataDropdownFields`, which opens the picker via visible UI, scopes actual fields to the requested source group when group headers such as `DAILY_REPORT` exist, and records DOM-extracted actual fields plus metadata expected fields. Source-specific `expectedFieldCount` remains scoped to the requested source report; all-source comparisons require all-source scope/total-count params. Evidence preserves both exact diff and known-alias normalized diff.
- Optional support files are indexed in `input/supporting-docs-manifest.json` with lightweight profiles. CSV profiles include header, row count and role hints such as `metadata_candidate`; text profiles include headings and line count. Codex should use these profiles to choose which optional file to read, not bulk-read every support file at startup.
- `input/browser-session.json` is generated before helper pre-run and referenced in the run prompt. Codex/browser actions must verify the lease marker before trusting a page.

### 4.5 `input/preflight-auth-check.md`

Purpose:

- Define the first browser step before deep domain rule loading.
- Avoid spending tokens on rules if SSO/login/reachability is blocked.
- Convert SSO/login/載入失敗 into Tool Bridge `playwright_recovery`.

Allowed preflight behavior:

- Open DEV URL.
- Confirm persistent Chrome / Playwright page is usable.
- Detect app shell / title / current URL.
- Detect SSO redirect, login page, 401/403, `載入失敗`, blank page, or obvious blocker.
- Treat successful current-run Agent helper browser evidence for the same case as preflight replacement when it already covers the required UI/DOM/network evidence. Codex visible-UI cases must first attempt Playwright MCP `browser_tabs`; if the tab list succeeds, browser tooling is available and must not be reported as `TOOL_EXECUTION_UNAVAILABLE`.

Forbidden preflight behavior:

- testcase step execution
- baseline capture
- field/filter/group/date setup
- save/delete/create report
- deep BI rule reading

Failure:

```text
[TOOL_REQUEST]{"type":"playwright_recovery",...}[/TOOL_REQUEST]
```

### 4.6 `input/run-state.json`

Purpose:

- Define allowed carryover for this run.
- Make previous-case evidence explicitly isolated.
- Prevent Codex from using old workbook rows or previous case UI state as current-case proof.

Schema summary:

```ts
type RunState = {
  schemaVersion: "run-state-v1";
  runId: string;
  currentCase: {
    caseNo: string;
    order: number;
    caseFile: string;
    groupId: string | null;
    groupName: string | null;
  } | null;
  carryover: {
    baseline: CarryoverItem;
    createdReports: CarryoverItem;
    userApprovals: CarryoverItem;
  };
  isolated: {
    lastCaseEvidence: IsolationRule;
    previousCaseUiState: IsolationRule;
    priorWorkbookRows: IsolationRule;
  };
  updateProtocol: string[];
  batchGuard: {
    policy: "ONE_CASE_AT_A_TIME";
    rule: string;
    manifestIsIndexOnly: true;
  };
};
```

Rules:

- `carryover` may be used only when current testcase explicitly requires it.

### 4.7 `input/document-consistency.json`

Purpose:

- Detect conflict between startup instruction and workbook current execution state.
- Stop before browser execution when the startup instruction selects a later case but earlier workbook rows are not completed.
- Convert this conflict into Tool Bridge `ambiguity_decision`.

Schema summary:

```ts
type DocumentConsistency = {
  schemaVersion: "document-consistency-v1";
  status: "ok" | "warning" | "error";
  selectedCaseNo: string | null;
  requestedCaseNo: string | null;
  currentCaseSelection: CaseManifestCurrentCaseSelection | null;
  precedingCases: Array<{
    caseNo: string;
    order: number;
    resultStatus: string | null;
    hasDetailJson: boolean;
  }>;
  issues: Array<{
    severity: "warning" | "error";
    code: string;
    message: string;
    context?: Record<string, unknown>;
  }>;
};
```

Runtime rule:

- If `status=error`, Codex must not touch browser.
- Codex must emit Tool Bridge `ambiguity_decision` with the conflict.

### 4.8 `input/current-case-pack.*`

Purpose:

- Provide a compact current-case execution card.
- Reduce xlsx/supporting-doc reads.
- Make evidence requirements explicit before execution.

Files:

- `input/current-case-pack.md`
- `input/current-case-pack.json`

Required JSON fields:

```ts
type CurrentCasePack = {
  schemaVersion: "current-case-pack-v1";
  policy: string[];
  documentConsistencyPath: string;
  currentCase: CaseManifestCase | null;
  evidenceTemplates: Array<"metadata-dropdown" | "network-request" | "chart-datasets" | "downloaded-csv" | "ui-workflow">;
  requiredEvidence: string[];
  screenshotPolicy: string;
  mustReadRuleKeys: string[];
  recommendedRuleKeys: string[];
  executionRequirement: string;
};
```

Hard rule:

- Current-case pack is not a result.
- It cannot be used to skip UI operation or current-run evidence.
- Only the current case should be exposed in detail; do not provide an all-case plan payload that encourages cross-case batching.

### 4.9 `input/reference-index.json`

Purpose:

- Provide exact file paths for generated inputs, downloaded inputs and copied local references.
- Avoid broad filesystem searches.
- Make supporting document roles explicit.

Runtime rule:

- Codex should check this file before searching the workspace.
- Missing referenced files should be reported, not guessed.

### 4.10 `input/evidence-templates/`

Purpose:

- Provide minimal evidence shape templates.
- Reduce repeated detail_json design work.

M1 templates:

- `metadata-dropdown-evidence.json`
- `network-request-evidence.json`
- `chart-datasets-evidence.json`
- `downloaded-csv-evidence.json`
- `ui-workflow-evidence.json`
- `index.json`

Rules:

- Template is not evidence.
- Codex fills only the template relevant to current-case-pack.
- No multi-case payload arrays.

### 4.11 `input/result-template.xlsx`

Purpose:

- Provide workbook column/shape reference.
- Keep Codex responsible for authoring the current case `output/result.xlsx`.

Rules:

- Do not edit template in place.
- Do not switch to Agent-writing-results without a separate architecture decision.
- Codex writes one case result at a time.
- The template includes `群組ID` before `群組`.
- The template must not contain sample `EX-*` rows; only headers are allowed, so Codex cannot accidentally copy fixture rows into formal output.

### 4.12 `input/network-observation-guidance.md`

Purpose:

- Clarify UI-triggered network observation.
- Prevent direct BI API substitution.

Allowed:

- Observe request/response caused by current UI action.
- Read request body relevant fields.

Forbidden:

- Direct BI API calls as test action.
- DevTools UI as formal test step.
- evaluate-based click/change/input to manufacture a request.
- `isolated` values cannot prove a current case.
- Codex may write `output/run-state.json` only for explicitly allowed carryover produced in the current run.

### 4.7 `input/bi-ui-helper-guidance.md`

Purpose:

- Domain-level helper guidance.
- Reduce repeated UI exploration.
- Preserve safety boundaries.

Must include:

- Prohibited internal state setters.
- Prohibited direct API-as-result.
- Prohibited state-changing `browser_evaluate`.
- One case guard.
- Evidence priority:
  - DOM/form state
  - network observation
  - chart/table data
  - screenshot
- Common operation recipes:
  - project navigation
  - add field
  - set date
  - execute and verify
  - save/delete/dialog Tool Bridge

---

## 5. Layer 1 Skill Contract

Path:

```text
agent-skills/uat-tool/
```

Files:

```text
SKILL.md
rules/run-lifecycle.md
rules/tool-bridge.md
rules/evidence-policy.md
rules/artifacts-and-results.md
rules/domain-routing.md
rules/codex-runtime.md
rules/agent-security.md
```

Hard requirements:

1. Layer 1 must remain domain-neutral.
2. BI rules must not be added to Layer 1.
3. Evidence policy must require current-run evidence.
4. Tool Bridge must be required for SSO/recovery/irreversible/ambiguity.
5. Runtime must require preflight before deep domain rule loading or testcase actions.
6. Runtime must use `run-state.json` for allowed carryover and treat previous-case evidence as isolated.
7. Evidence policy must prefer structured evidence before screenshots, while requiring screenshots for Tool Bridge / FAIL / bug / major state / final evidence when possible.
8. `agent-security.md` must define:
   - task whitelist
   - active run lock
   - token scope
   - local filesystem boundary
   - cancellation boundary
9. Runtime rules must preserve one-case-at-a-time.

---

## 6. Tool Bridge Spec

### 6.1 Envelope

Codex must emit:

```text
[TOOL_REQUEST]{...json...}[/TOOL_REQUEST]
```

Parser must tolerate:

- surrounding assistant text
- multiline JSON
- alias fields
- duplicated request blocks

Parser must not tolerate:

- missing request_id
- unsupported actionable type
- malformed actionable schema

### 6.2 Supported Types

#### `irreversible_operation`

Required fields:

```json
{
  "type": "irreversible_operation",
  "request_id": "<run-id>-<case-no>-<slug>",
  "case": "<case-no>",
  "action": "<short action>",
  "reason": "<why approval is required>",
  "proposed_action": "<exact action>"
}
```

Aliases currently normalized:

- `case_no`
- `caseNo`
- `requested_action`
- `proposed_action`

Case may be inferred from request id pattern such as:

```text
...-demo-a01-save -> DEMO-A-01
```

#### `playwright_recovery`

Required fields:

```json
{
  "type": "playwright_recovery",
  "request_id": "<run-id>-sso",
  "error": "LOGIN_REQUIRED: ...",
  "proposed_action": "Tommy completes SSO/login..."
}
```

#### `ambiguity_decision`

Required fields:

```json
{
  "type": "ambiguity_decision",
  "request_id": "<run-id>-<case-no>-<slug>",
  "case": "<case-no>",
  "context": "<what is ambiguous>",
  "options": ["<option A>", "<option B>"],
  "recommendation": "<recommended option>"
}
```

### 6.3 Policy Guard

If no Tool Bridge response exists in current run, Agent scans for policy violations:

- Codex claimed Tommy/PM approved without Tool Bridge response.
- Native dialog was accepted without Tool Bridge response.
- Destructive click detected without Tool Bridge response.

Result evidence gate scoping:

- The gate must not treat ordinary testcase prose as an irreversible-action claim. For example, date/preview assertions that say the second preview result should "覆蓋" the first preview are not Tool Bridge actions.
- Tool Bridge response evidence is required only for explicit approval claims, native dialog handling claims, `browser_handle_dialog`, or destructive/irreversible action claims such as delete or overwrite-save.
- Negative or insufficient evidence wording such as `無 native confirm`, `不出現 native dialog`, or `缺少 native dialog 驗證` is treated as a BLOCKED evidence statement, not as a claim that a native dialog was handled.

Violation result:

```text
TOOL_BRIDGE_POLICY_VIOLATION
```

Run should not be trusted.

### 6.3.1 Pending Fix: Native Validation Dialog Recovery

Observed in OTTEST004_011 / run `31243914-3666-4430-a4c6-aaad35f1d70e`, case `OTTEST004-A-06`.

Sequence:

1. Helper pre-run only completed safe navigation (`collage.openProject` / `collage.createReport`).
2. Codex visible UI attempted the core case flow, but clicked Execute before any field was actually selected.
3. BI displayed a native validation alert: `請至少選擇一個欄位`.
4. Codex emitted a Tool Bridge `playwright_recovery` request for native dialog recovery.
5. No Tool Bridge response was recorded, so the policy guard failed the whole run with `NATIVE_DIALOG_WITHOUT_TOOL_BRIDGE_RESPONSE`.

Clarification:

- This must not be treated as Tommy failing to approve in chat. In Agent mode, only an App / Agent Tool Bridge response counts.
- A missing Tool Bridge response for a recoverable validation dialog should not silently look like user inaction.

Implemented in Agent `0.2.16`:

- Helper preview and date-variant preview actions now run `EXECUTE_PRECONDITION_NO_SELECTED_FIELDS` before clicking BI `執行`; if no metric field is selected, helper returns current-case `blocked` evidence and does not trigger the native alert.
- Codex run guidance now explicitly requires selected-field-count evidence before pressing BI `執行`.
- `browser_handle_dialog` / result detail mentioning non-destructive BI validation alerts such as `請至少選擇一個欄位` no longer triggers missing Tool Bridge response failure by itself. It should be recorded as execute-precondition BLOCKED evidence.

Implemented in Agent `0.2.17`:

- `collage.inspectAllZeroFields` supports A-06 style all-zero-field inspection. It selects all fields for the requested source report through visible UI, verifies selected field count before Execute, runs preview, and writes `all-zero-field-inspection-evidence.json` with selected labels/codes, network request/response observations, chart/table summaries, and all-zero candidates. Helper output remains evidence only; Codex still judges PASS/BLOCKED.

Implemented in App/API `1.1.4` and Agent `0.2.20`:

- Result evidence gate masks negative/missing native-dialog wording before Tool Bridge claim detection, so current-case BLOCKED rows that say evidence is missing do not fail with `TOOL_BRIDGE_RESPONSE_MISSING`.
- Static editor-session CSV cases can run `collage.runDateVariantsPreviewEvidence` and then `collage.downloadCsvAndComparePreview` in the same editor session, without save/reopen/report-list navigation.
- `collage.createAndDeleteTemporaryReport` supports delete-report cases by creating a temp report first, requiring Tool Bridge approval for delete, accepting only known BI delete confirmation, rejecting protected/main report names, and verifying the temp row disappears.

Implemented in Agent `0.2.21`:

- Structured dynamic and hybrid date params (`dateMode=relative|hybrid`) now route through `collage.runDateVariantsPreviewEvidence`, which fills visible dynamic/static endpoint controls and captures date UI, request, chart/table, and screenshot evidence.
- Multi-source select-all preview/CSV cases with `expectedFieldCount` now treat a selected-field count mismatch as a blocked helper precondition when CSV or multi-source selection is requested.
- `collage.configureCalculatedMetricAndPreview` is wired in the executor for formula/calculated-field cases; it opens the formula modal, fills name/formula through modal-scoped inputs or textareas, then captures preview evidence.
- `collage.createProject` is wired in the executor for G-01 style project creation; after Tool Bridge approval it selects mode = `拼貼`, fills a current-case test project name, blocks on mode-selection alerts, and verifies the project appears in the sidebar.

Implemented in App/API `1.1.5` and Agent `0.2.22`:

- Result evidence gate uses a neutral mask for negative/missing native-dialog prose, so E-group BLOCKED wording such as `無法完成公式確認` no longer turns into a synthetic Tool Bridge claim.
- `collage.configureCalculatedMetricAndPreview` now targets the BI formula modal by stable IDs: `#calculatedFieldNameInput` for the calculated field name, `#formulaInput` for the formula expression, and `button[onclick="saveFormula()"]` for submit. It validates both input values before clicking submit and records a blocked mismatch instead of swapping formula/name/search inputs.

Authoring / BI domain contract update on `2026-05-07`:

- `BI_TEST_RULES/BI測試_系統背景知識.md` documents the Collage calculated-field UI flow as cross-round domain knowledge: base fields first, green `+ 新增運算欄位`, formula editor modal, field name, formula, `確認`, then preview evidence.
- `docs/authoring/UAT_三文件撰寫規則.md` now requires modal-aware formula helper hints for formula/calculated-field cases: `operationTemplate=collage.configureCalculatedMetricAndPreview`, explicit `baseFields`, `calculatedFieldName`, `formula`, formula modal UI labels, date/display, and `formula.uiState` / request / chart evidence.

Implemented in App/API `1.1.3`:

- `dispatchToolResponseIfNeeded` now records `tool_response.dispatch_failed` and an ERROR run log when an approval is resolved but the original Tool Bridge request event cannot be found or the App cannot send the response to the Mac Agent.
- `/api/runs/:id/tool-bridge` reports Tool Bridge request lifecycle state by request id: `pending_approval`, `rejected`, `response_missing`, `response_sent`, or `response_delivered`.
- Web run detail displays Tool Bridge request id, case, action, reason, timestamps, and `TOOL_BRIDGE_RESPONSE_MISSING` wording. This separates App/Agent response lifecycle failure from Tommy not approving.

Required fixes:

1. Add regression fixtures covering the full current-case BLOCKED without whole-run abort flow after a native validation alert appears in a real Codex/Playwright session.

### 6.3.2 Source Prefilled Results / PM-Skip Runtime Contract

Source testcase xlsx rows may already contain a terminal `結果` before a run starts.

Runtime behavior:

- Railway imports terminal source results (`PASS`, `FAIL`, `BLOCKED`, `PARTIAL`, `SKIPPED`, `MANUAL_PASS`, `MANUAL_FAIL`, `MANUAL_BLOCKED`) directly into `run_cases.result_status`.
- The source row's `失敗分類`, `測試日`, `驗證方法`, `執行方式` and `詳細紀錄JSON` are preserved in normalized state.
- Matching `run_case_steps` rows are inserted as `SKIPPED` with `actual_json.source="source_prefilled_result"`.
- Mac Agent `case-manifest.json` and next-case advancement skip rows with a non-pending `結果`.
- A row is not skipped merely because `詳細紀錄JSON` exists. Only a non-pending `結果` completes the source row.

PM-skip usage:

- For known tool gaps such as OTTEST004 A-06, the package should set `結果=BLOCKED`, `執行方式=N/A(本輪不執行)`, and detail JSON fields such as `skip_reason`, `skip_decided_by`, `skip_decided_at`, `preserved_for`.
- The online tool should classify this as PM-skipped/BLOCKED in reports and should not ask Agent to execute the case.

### 6.4 Batch Case Policy Guard

Agent scans Playwright MCP `session.md` after Codex exits or resumes.

If a single Playwright code/tool block contains multiple distinct case IDs and action-like terms, Agent records:

```text
output/batch-case-policy-violations.json
```

and fails the run with:

```text
BATCH_CASE_POLICY_VIOLATION
```

Purpose:

- Detect regression where Codex batches multiple case flows into one tool call.
- Protect evidence attribution.
- Preserve the one-case-at-a-time invariant even while optimizing speed.

This guard is intentionally conservative. It does not replace prompt/rule discipline; it is the last line of defense.

---

## 7. Agent Message Protocol

### 7.1 Agent Registration

Agent connects to:

```text
wss://testtool-production.up.railway.app/agent-ws
Authorization: Bearer <agent token>
```

Agent status fields:

```ts
type AgentItem = {
  id: string;
  deviceName: string;
  agentVersion: string | null;
  platform: string | null;
  codexVersion: string | null;
  nodeVersion: string | null;
  supportedTaskTypes: string[];
  supportedExecutionModes: string[];
  toolBridgeVersions: string[];
  playwrightMcpAvailable: boolean | null;
  chromeProfileReady: boolean | null;
  doctorOk: boolean | null;
  doctorChecks: AgentDoctorCheck[];
  connectedAt: string;
  lastSeenAt: string;
  status: "idle" | "busy" | "unknown";
  currentRunId: string | null;
};
```

### 7.2 Backend to Agent

Supported:

```text
task.dispatch
task.cancel
tool_response
```

Not allowed:

```text
shell.exec
file.read
agent.update_self
arbitrary command
```

### 7.3 Agent to Backend

Current message types:

```text
run.started
run.stdout
run.stderr
run.progress
run.phase
run.tool_request
run.uploading_result
run.partial_artifacts
run.completed
run.failed
run.cancelled
tool_response.delivered
```

### 7.4 `run.phase`

Payload:

```json
{
  "run_id": "...",
  "phase": "prepare_guides",
  "title": "建立執行索引",
  "detail": "解析 case manifest、rule index 與 BI UI helper guidance。",
  "status": "active",
  "context": {},
  "at": "2026-04-28T..."
}
```

Known phases:

```text
prepare_workspace
download_inputs
prepare_guides
browser_start
codex_starting
codex_running
context_loading
preflight_auth
browser_execution
waiting_user
upload_result
completed
failed
cancelled
resuming
codex_resuming
```

Frontend computes duration:

- phase duration = next phase timestamp - current phase timestamp
- active/waiting latest phase = now - current phase timestamp

---

## 8. Run Status Model

Current backend status model still uses the existing app status vocabulary.

Practical states:

```text
READY
RUNNING
WAITING_APPROVAL / WAITING_USER
SUCCEEDED
FAILED
CANCELLED
```

Agent state:

```text
idle
busy
unknown
```

Important distinction:

- `run.completed` from Agent means Agent-side Codex process completed.
- Backend should only mark run successful after result ingestion succeeds.
- If Codex exits 0 but no real UAT result.xlsx exists, fallback result must not become trusted PASS.

---

## 9. Result Workbook Contract

### 9.1 Preferred Codex Output

Codex should write:

```text
output/result.xlsx
```

Important:

- `output/result.xlsx` is a single-case workbook for the current case only.
- Codex must not accumulate multiple case rows in memory and write them at the end.
- Agent uploads and backend ingests each case independently before advancing.

Required sheets:

```text
索引
測試案例
Bug
```

Minimum `測試案例` columns:

```text
群組ID
群組
編號
測試項目
測試類型
執行方式
結果
失敗分類
詳細紀錄JSON
```

Result values:

```text
PASS
FAIL
BLOCKED
PARTIAL
```

Degraded capability behavior:

- If `capability-gate.supportStatus = degraded`, helper pre-run is skipped.
- Codex may continue only if visible browser automation / read-only UI evidence is available.
- If browser automation is unavailable or the UI path is unreachable, Codex must still write a single-case `BLOCKED` workbook.
- Use `失敗分類 = TOOL_EXECUTION_UNAVAILABLE` or `EVIDENCE_INSUFFICIENT`.
- `detail_json` must include the four core fields `測試目的` / `設定條件` / `預期行為` / `實際行為`, plus `blocked_reason` and `currentRunEvidence` pointing to this run's capability gate, helper skipped summary, preflight/tool state, or agent log.
- Do not use Agent fallback for this path; fallback remains a local diagnostic artifact and is not uploaded as trusted UAT output.

### 9.2 Fallback Workbook

Agent may create fallback result.xlsx when:

- Codex failed before writing result.
- Codex was cancelled.
- Tool Bridge schema/policy failed.
- Codex exited 0 but did not write real result.xlsx.

Fallback must:

- never produce trusted UAT PASS for uploaded testcase cases
- include fail category
- include partial artifacts context
- preserve assistant text excerpt and stderr excerpt

Current important category:

```text
CODEX_NO_RESULT_XLSX
```

This prevents the old bug where Codex ran some UI but only wrote `AGENT-RESULT PASS`.

### 9.2.1 Pre-upload Repair Guard

Agent may repair exactly one Codex-generated legacy workbook shape before self-check:

- `測試案例` sheet is missing `群組ID`
- the remaining headers match the previous 8-column single-case result layout
- there is exactly one non-empty case row
- that case row matches the current dispatch case
- `expectedCaseNos` contains at most the current case

Repair behavior:

- insert `群組ID` before `群組`
- populate it from the current input case `groupId`, with group-name / case-no inference only as fallback
- write `output/result-xlsx-repair.json`
- continue through the normal `result-xlsx-self-check.json` and server evidence gate

The guard must not repair multi-case workbooks, wrong-case workbooks, missing non-`群組ID` headers, or non-legacy layouts. Those remain hard failures.

### 9.3 Parser

Backend result parser must:

- parse case rows independently
- parse optional `群組ID` and derive fallback only for legacy workbooks
- preserve invalid detail_json raw value
- not fail entire workbook for one bad detail_json row
- ingest Bug sheet rows
- save parser version

### 9.4 Final Aggregate Workbook

Backend generates the final downloadable xlsx from normalized server state, not from the last uploaded raw workbook.

Generation trigger:

- after a successful single-case result ingest, if all cases in the run are no longer `PENDING` / `MANUAL_PENDING`
- on download request if the run is already complete and the aggregate file is missing

Stored fields:

```text
runs.aggregate_result_xlsx_path
runs.aggregate_result_generated_at
```

Raw upload retention:

- `runs.result_xlsx_url` / raw result path still points to the latest uploaded single-case workbook for audit and manual re-ingest.
- It must not be overwritten with the aggregate workbook path.

Workbook contract:

```text
schema_version = uat-final-aggregate-result-v1
source = normalized-server-state
aggregate_mode = final | partial
```

Sheets:

```text
索引
測試案例
Bug
```

Final `測試案例` columns:

```text
群組ID
群組
編號
測試項目
測試類型
執行方式
結果
失敗分類
詳細紀錄JSON
```

Download behavior:

- `GET /api/runs/:id/output/result-xlsx` first generates an aggregate workbook from normalized server state.
- If all cases are terminal, `aggregate_mode=final`; if a failed/cancelled/interrupted run has completed case rows but still contains `PENDING`/`MANUAL_PENDING`, `aggregate_mode=partial`.
- It falls back to the latest raw `result.xlsx` only when no normalized case result exists yet.

### 9.5 Markdown Downloads

Backend exposes two distinct Markdown exports:

- `POST /api/runs/:id/export-md`: concise PM/RD report with summary, case results, bug summary, and selected detail_json fields.
- `POST /api/runs/:id/export-archive-md`: complete run archive with run metadata, per-case state, result counts, timing summary, artifact stats/list, combined timeline, full logs, and full events.

The archive is generated from normalized database rows and uploaded timing/artifact metadata. It does not replace raw `result.xlsx` or evidence artifacts; it is a downloadable audit index for long 40-50 case runs.

---

## 10. Frontend UI Spec

### 10.1 Execution Form

Required controls:

- testcase source
- execution mode
- agent selector
- round id
- location
- feature main
- feature sub
- run name
- dev url
- testcase xlsx
- testcase files multiple upload
- optional csv
- query
- start
- cancel

Testcase files:

- multiple files accepted
- first file is startup instruction
- remaining files are supporting docs sent to Agent

### 10.2 Agent Status Panel

Shows:

- selected Agent
- status idle/busy
- lastSeenAt
- platform
- Codex version
- Agent version
- Node version
- doctor PASS/FAIL/SKIP counts
- macOS permission reminder

### 10.3 Phase Card

Shows:

- latest phase title/detail/status
- latest phase start time
- latest phase elapsed duration
- last 8 phases
- each phase duration

Purpose:

- identify whether slowness is from context loading, browser, waiting user, result upload, etc.

### 10.4 Run Log / Events

Should show:

- backend logs
- important run events
- filtered duplicate noise
- `run.progress` should not flood main event table if phase card is enough

### 10.5 Approval Panel

Shows:

- Tool Bridge request
- snapshot/log path if available
- `已處理 / 繼續執行`
- skip / cancel

Important:

- Clicking `已處理` should resume the same Codex thread.
- Browser must not be closed while waiting for SSO.

---

## 11. Agent Doctor Spec

Doctor checks:

```text
node-version
agent-token-present
server-config-present
codex-workspace-root
codex-workspace-agents
workdir-writable
chrome-profile-writable
codex-version
playwright-mcp-availability
galaxy-sso-session
railway-websocket-token-live
macos-permission-hint
```

Current behavior:

- Some checks are SKIPPED if not safely automatable.
- macOS permissions cannot be granted programmatically.
- UI should display guidance:
  - Terminal / Codex / Google Chrome
  - Accessibility
  - Screen Recording
  - Automation

---

## 12. Security Boundaries

### 12.1 Agent Command Boundary

Agent only accepts whitelisted protocol messages.

Railway must not be able to instruct Mac Agent to execute arbitrary shell commands.

Startup instruction content is:

- passed to Codex as prompt/input
- not parsed as shell
- not executed by Agent

### 12.2 Active Run Lock

One Agent can run only one active run at a time.

Reason:

- Chrome profile cannot safely support parallel SSO runs.
- Playwright MCP sessions may conflict.
- Codex token/rate/cost pressure.
- Evidence artifacts become hard to attribute.

If second run arrives while busy:

```text
task.rejected reason=agent_busy
```

### 12.3 Filesystem Boundary

Agent writes only:

```text
~/.uat-agent/config.json
~/.uat-agent/runs/
~/.uat-agent/chrome-profile/
~/.uat-agent/logs/ or launchd stdout/stderr paths
```

Agent must not modify arbitrary user files based on cloud instruction.

### 12.4 Token Scope

Agent token permits:

- WebSocket connection
- pulling assigned run inputs
- uploading assigned run outputs

Agent token must not permit:

- listing all runs
- reading unrelated run files
- admin APIs

---

## 13. Performance / Token Strategy

### 13.1 Current Bottlenecks

Known sources:

- Codex startup cost
- Codex reading too many rules
- xlsx exploration
- Playwright snapshot overhead
- UI wait / DOM redraw
- Tool Bridge pauses
- result upload / parse

### 13.2 Implemented Optimizations

- `run-brief.md`
- `case-manifest.json`
- per-case JSON files
- `rule-index.json`
- `bi-ui-helper-guidance.md`
- `preflight-auth-check.md`
- `run-state.json`
- `document-consistency.json`
- `current-case-pack.md` / `current-case-pack.json`
- `reference-index.json`
- `supporting-docs-manifest.json`
- `evidence-templates/`
- `result-template.xlsx`
- `network-observation-guidance.md`
- `current-case-pack.json.mustReadRuleKeys` for case-type mandatory rule loading
- `groupId / 群組ID` schema in parser, manifest, current-case-pack, run-state and result parser
- final aggregate result xlsx generated from normalized server state
- Collage helper P0:
  - composite metric fields are split and added one by one
  - `+ 新增欄位` action has visible UI fallback candidates and locator drift evidence, without force click or JS setter
  - `collage.configureMetric` and `collage.extractMetadataDropdownFields` wait for `載入欄位中...` to clear before attempting `+ 新增欄位`; persistent loading becomes `FIELD_LIST_LOAD_TIMEOUT`, while a loaded page with no control remains `ADD_FIELD_BUTTON_NOT_CLICKABLE`
  - `collage.reopenReport` waits for editor settle after reopening and writes `reopen-report-evidence.json` with DOM/state/network evidence
  - helper reports include browser-session evidence, target-binding evidence, and `foregroundPolicy.mode=no-activate`
  - existing report modification opens `TOOL_A01_<timestamp>` instead of creating a replacement report
  - overwrite save reuses the existing temporary report name
  - CSV download is triggered through visible UI and compared to current preview table/chart evidence; for report-list downloads, refresh/re-target the current run's saved report row, compare against pre-save preview evidence, and do not reopen the editor
  - CSV precondition failures such as missing current preview, missing saved report row, or missing list-page download control are reported with `failedSubcondition` and `csv_comparison_status=not_reached`; Codex records CSV comparison as `not_reached` when an earlier required workflow subcondition already failed
  - if Playwright does not emit a browser download event but the same visible UI click returns a CSV/attachment response, persist that response body as CSV evidence with `downloadedCsv.source=ui_triggered_network_response_body`
  - unknown native dialog chains are blocked with evidence when no real recovery handler exists
- Metadata compare contract uses `rules/BI_DATA/metadata.csv` as canonical reference and requires reference_csv/source_report/match_key/compare_fields/actualScope in detail_json; helper evidence should include actualVisibleItems, expectedFields, missingFields, extraFields, exactMissingFields and exactExtraFields. For source-list cases the helper compares distinct source groups (`actualSourceReports` vs `expectedReportSources`); for missing source groups it records `missingSourceReports` or expected-field-name fallback evidence instead of treating every visible picker item as the requested source.
- Preset multi-variant, full-static, dynamic-offset, and half-dynamic form cases can use `collage.runDateVariantsPreviewEvidence`, which performs visible UI date setting and preview once per variant and writes per-variant `date.uiState`, `date.representedRange`, `network.requestBody`, chart/table, and screenshot evidence. A single `collage.configureMetric` helper action must not pre-run mixed static/dynamic date cases because it cannot represent both endpoint modes.
- Date UI evidence uses `date-ui-evidence.json` to record requested label, normalized UI label, visible date control text, visible represented ranges, and preset-derived represented ranges computed from `baseDate`/`testDate` when the UI only shows the label. `collage.captureDateUiEvidence` is an optional read-only helper for Codex-visible/manual date cases after Codex performs the UI transition.
- Supporting docs manifest profiles decompose optional CSV/MD inputs into compact metadata before full-file loading.
- Successful helper evidence can replace Codex-owned browser preflight for helper-assisted cases when the evidence is current-run/current-case and covers required steps.
- Agent result contract rejects `PASS` rows that contradict helper state checks, including configure/reopen helper reports with expected state checks recorded as false. For `collage.configureMetric` date-range checks, normalized `date-ui-evidence` is authoritative: if it proves the requested represented range, a raw `stateDelta.after.checks.dateRange=false` caused only by display-format mismatch (`YYYY-MM-DD` vs `YYYY/MM/DD`) must not block upload. Reopen helper `dateRange=false` still blocks PASS.
- Result evidence gate scopes `TOOL_BRIDGE_RESPONSE_MISSING` to explicit approval/native-dialog/irreversible-action claims; benign testcase prose such as preview-result overwrite no longer aborts ingestion.
- structured evidence priority
- batch-case policy detector
- phase duration UI
- Codex command / Playwright tool call count progress
- filtered duplicate event timeline

### 13.3 Required Safety During Optimization

Performance optimizations must not:

- batch multiple case UI execution
- skip current-run evidence
- skip Tool Bridge
- use direct BI API as result
- use internal JS setters
- convert missing result into PASS

### 13.4 Next Performance Work

Recommended:

1. Add case pointer update after each completed case.
2. Add per-case phase:
   - `case_context_loading`
   - `case_state_cleanup`
   - `case_ui_action`
   - `case_evidence_read`
   - `case_result_write`
3. Add domain rule tags:
   - `mode=collage`
   - `mode=record`
   - `mode=metric`
   - `risk=create`
   - `risk=delete`
   - `target=frontend`
   - `target=backend`
4. Add safe Playwright recipe library as guidance first, then code helper only after safety review.
5. Add rule digest + hash validation, with red-line rules preserved verbatim.
6. Add evidence metadata cross-check: required evidence in case-plan/current-case must appear in result detail.
7. Add real token/cost summary if Codex CLI exposes token usage reliably.
8. Add UI summary for command/tool-call count per phase.

---

## 14. Testing / Verification

### 14.1 Standard Verify Command

Run before commit:

```bash
npm run verify:all
```

Expected:

- root typecheck
- agent build
- web build
- Tool Bridge parser fixtures
- Agent roundtrip smoke

For schema/result artifact changes, also run the focused result checks:

```bash
npm run verify:agent-result-contract
npm run verify:result-evidence-gate
npm run verify:final-aggregate-result
npm run verify:package-consistency
git diff --check
```

### 14.2 Agent Specific

```bash
npm run typecheck --prefix agent
npm run build --prefix agent
```

### 14.3 Web Specific

```bash
npm run build --prefix web
```

### 14.4 Manifest Fixture Check

Use DEMO workbook:

```text
/Users/tommy/Downloads/codex_galaxy/BI_UAT_ROUNDS/DEMO001_工程團隊示範/DEMO_BI示範_測試案例_v1_0.xlsx
```

Expected:

- `totalCases = 6`
- first case `DEMO-A-01`
- fallback XML reader works if ExcelJS fails

### 14.5 Deployment Checks

Railway:

```bash
curl -s https://testtool-production.up.railway.app/version | jq
curl -s https://testtool-production.up.railway.app/health | jq
curl -s https://testtool-production.up.railway.app/api/agents | jq
```

Vercel:

- deployment should be READY
- production deployment should point to latest `codex/uat-tool-mvp` commit

Agent:

```bash
launchctl list | rg com.tommy.uat-agent
curl -s https://testtool-production.up.railway.app/api/agents | jq
```

---

## 15. Known Risks

### 15.1 Codex Produces Summary Instead of Real Result

Symptom:

- result.xlsx only has `AGENT-RESULT`
- real testcase cases not written

Mitigation already added:

- if uploaded testcase exists and no Codex-generated `output/result.xlsx`, fallback is not trusted PASS

Recommended next guard:

- backend rejects `AGENT-RESULT PASS` as full success when run has imported cases > 0

### 15.2 Multi-case Batching Regression

Symptom:

- Codex executes multiple testcase flows in one tool call
- detail_json written later from memory
- evidence attribution unclear

Current mitigations:

- Layer 1 one-case-at-a-time
- run brief hard gate
- prompt hard gate
- rule index warning
- BI helper one case guard
- run-state isolated evidence rule
- Agent session log scan for `BATCH_CASE_POLICY_VIOLATION`

Recommended next guard:

- result parser checks every case detail has independent evidence metadata
- Web UI surfaces batch-case policy violations prominently

### 15.3 SSO Wait Does Not Trigger

Symptom:

- Browser opens and closes or fails without Tool Bridge

Current mitigations:

- persistent Chrome profile
- Tool Bridge recovery schema
- phase/log visibility
- `input/preflight-auth-check.md`
- `preflight_auth` phase
- prompt requires preflight before deep rule loading

Recommended next guard:

- Web UI displays preflight result details and screenshot/log path when available.
- Add explicit preflight timeout classification if browser opens but app shell never appears.

### 15.4 Token/Time Cost Too High

Symptom:

- long context loading before browser action

Current mitigations:

- run brief
- current case JSON
- rule index
- BI helper
- preflight-first
- run-state explicit carryover
- structured evidence priority
- phase duration

Recommended:

- summarize stable Layer 1 in Agent-generated brief by version/hash

### 15.5 Tool Bridge Format Drift

Symptom:

- Codex emits request missing `case` or `action`

Current mitigations:

- parser aliases
- case inference
- invalid actionable schema fails run

Recommended:

- show schema validation errors in UI
- add self-repair prompt before failing if safe

---

## 16. Development Rules

### 16.1 Dirty Files

Before editing, check:

```bash
git status --short --branch
```

Pre-existing untracked local demo/output files are common in this workspace. Unless explicitly requested, do not stage, delete, or revert unrelated files.

### 16.2 Commit Discipline

Before commit:

```bash
git status --short
npm run verify:all
```

Only stage files related to the current change.

### 16.3 Documentation Sync Discipline

Every runtime/schema/deployment/authoring change must update tracked docs in the same commit:

- `docs/planning/online-uat-tool-development-log.md`
- `docs/refactor/規劃說明.md`
- `docs/refactor/工程spac.md`
- any affected Layer 1, BI domain, authoring, or round source files

`uat-tool/AGENTS.md` records this as a standing repo instruction so future sessions do not rely on chat memory.

### 16.4 Session Handoff Contract

Session handoffs and future daily automated handoffs must follow:

```text
docs/planning/session-handoff-generation-rules.md
```

Required engineering rule:

- The first substantive handoff section is `Active User Question / Next Conversation Objective`.
- Repo status, dirty files, production version, run ids and commits are supporting context, not the handoff's lead.
- Daily automation must emit active questions and ready-to-paste prompts per work stream, and mark handoffs as `DRAFT / PARTIAL` when a source thread, deploy or run may still be in progress.
- A handoff that lets a new chat know file state but not Tommy's first expected answer is incomplete.

### 16.5 Deployment Branches

Push both:

```bash
git push origin refactor/mac-agent-mvp
git push origin refactor/mac-agent-mvp:codex/uat-tool-mvp
```

Railway tracks:

```text
codex/uat-tool-mvp
```

Vercel production also tracks:

```text
codex/uat-tool-mvp
```

---

## 17. Recommended Next Engineering Tasks

### P0

1. Finish OTTEST004-A-06 runtime recovery: full current-case BLOCKED recovery without whole-run abort. Selected-field-count guard / non-destructive validation alert allowlist are implemented in Agent `0.2.16`; A-06 all-zero-field inspection helper is implemented in Agent `0.2.17`; visible Tool Bridge pending state and missing-response wording are implemented in App/API `1.1.3`; result-gate negative native-confirm prose handling is implemented in App/API `1.1.4`; formula-modal blocked wording is covered in App/API `1.1.5`.
2. Run OTTEST002 production regression against the deployed helper P0, metadata dropdown source-group scoping, list-page CSV helper, helper-evidence preflight replacement, case-type must-read rules, exact metadata source filename contract and final aggregate pipeline.
3. Verify A-01 field-add actionability fallback and A-03 metadata dropdown helper writes `metadata-dropdown-evidence.json` with source-group scoped DOM actual list, exact diff, normalized diff and metadata expected list.
4. Verify the Agent pre-upload repair guard with OTTEST002 Codex-generated result workbooks that still omit `群組ID`.
5. Add Web UI display for `BATCH_CASE_POLICY_VIOLATION`, result gate errors, and Tool Bridge schema errors with clear explanation. Tool Bridge pending/missing-response status is covered by `/api/runs/:id/tool-bridge` and the run detail panel.
6. Add per-case progress events and current-case pointer visibility.
7. If OTTEST002 exposes BI locator drift, metadata dropdown DOM mismatch, helper continuation gap, list-page CSV control mismatch or CSV format mismatch, tune `collage.configureMetric` / `collage.extractMetadataDropdownFields` / `collage.openExistingReport` / `collage.downloadCsvAndComparePreview` using the helper DOM profile artifacts.

### P1

1. Split BI helper guidance into recipe files.
2. Split and version rule-index tags by case metadata after the new `mustReadRuleKeys` production run proves the coarse bundles.
3. Add result evidence metadata columns.
4. Add artifact table.
5. Add session log download link.

### P2

1. Remote machine Agent.
2. Multi-agent registry and scheduler.
3. Non-BI domain pack.
4. Notification integration.
5. Cost/token dashboard.

---

## 18. Acceptance Criteria For Current MVP

The current MVP is acceptable if:

1. Web UI can create a BI run with xlsx + multiple md.
2. Mac Agent is online and selected.
3. Railway dispatches to Mac Agent.
4. Agent downloads inputs and generates indexed guidance.
5. Chrome CDP opens with persistent SSO profile.
6. Codex starts and emits phase/progress.
7. Codex reads current case first, not full workbook first.
8. Codex performs UI operation for at least one real case.
9. Tool Bridge request appears for save/confirm or SSO.
10. After approval, Codex resumes same thread.
11. Agent repairs only safe legacy single-case `群組ID` drift, then uploads real single-case result.xlsx or safe fallback.
12. Backend does not mark fake/fallback result as trusted PASS.
13. Backend ingests each case into normalized state and can generate final aggregate result xlsx after all cases terminal.
14. Web UI shows phase duration and useful logs.

---

## 19. Current Engineering Judgment

The current system should optimize context loading and UI recipes, not relax correctness rules.

Keep strict:

- evidence gate
- Tool Bridge
- one-case-at-a-time
- no direct API-as-result
- no internal state setters
- stale evidence rejection
- partial artifact preservation

Optimize:

- run brief
- case manifest
- rule index
- domain helper guidance
- preflight-first
- explicit run-state carryover
- server-side final aggregate from normalized state
- structured evidence priority
- phase duration
- case pointer
- per-case progress

This is the safest path to reduce token/time cost without recreating the old class of false results caused by batching or insufficient evidence.
