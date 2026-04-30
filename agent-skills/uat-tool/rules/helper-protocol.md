# Helper Protocol v1.0

本規則定義 Layer 1 Helper protocol。Helper 是 Mac Agent 內的安全 UI 操作元件；它可以加速固定且可驗證的 UI 步驟，但不能取代 Codex 判定，也不能降低 testcase evidence 要求。

## 分層

- Layer 1 定義 Helper protocol、artifact contract、evidence hard gate、Tool Bridge 邊界。
- Domain pack 定義 domain-specific helper templates。BI 的 helper templates 應搬到 `domains/BI/helpers/` 或同等 domain pack 位置。
- Helper report 是 current-run evidence 的候選來源，不是 PASS / FAIL / BLOCKED 結果。

## Hard Rules

- Helper 不可寫 `output/result.xlsx`。
- Helper 不可判 PASS / FAIL / BLOCKED / PARTIAL。
- Helper 不可一次跑多個 case。
- Helper 不可直接打 BI API 取得或設定測試結果；network 只能觀察 UI 觸發的 request/response。
- Helper 不可使用內部 JS setter、React state setter、`window.<action>` 等方式設定測試狀態。
- Helper 不可使用 `force: true` click 或其他方式繞過 Playwright/browser actionability check。
- Helper 點不到、actionability 失敗、postcondition 驗證不到時，必須回 `blocked` 或 `requires_approval`，並留下 reason / DOM / screenshot evidence。
- Irreversible action、native alert/confirm、overwrite/delete/save 等流程必須先有 Tool Bridge response；非 SSO/login/auth request 可由 Mac Agent auto approval policy 回覆。

## Artifacts

Helper 使用三種主要 artifact。

### `input/helper-execution-plan.json`

必要欄位：

- `schemaVersion = helper-execution-plan-v1`
- `caseId`
- `mode = single_case_helper_assisted_uat`
- `executor.kind`
- `policy[]`
- `safety`
- `actions[]`

每個 action 必須包含：

- `id`
- `template`
- `params`
- `requiresToolBridge`
- `optional`
- `canJudgeResult = false`
- `requiredEvidence[]`
- `screenshotPolicy`

### `output/helper-pre-run-summary.json`

必要欄位：

- `schemaVersion = helper-pre-run-v1`
- `runDir`
- `caseId`
- `status = ok | partial | skipped`
- `actionCount`
- `executedCount`
- `actions[]`

每個 action result 必須包含：

- `actionId`
- `template`
- `status`
- `durationMs`
- `reportPath`
- `warnings[]`

### `output/helper-artifacts/<case>/helper-report.jsonl`

每列 report 必須包含：

- `schemaVersion = bi-ui-helper-report-v1`
- `runId`
- `caseId`
- `action`
- `startedAt`
- `endedAt`
- `status`
- `helperCanJudgeResult = false`
- `evidenceMetadata`
- `evidence`
- `artifacts`
- `warnings[]`

`evidenceMetadata` 必須包含：

- `source = mac-agent-bi-ui-helper`
- `runId`
- `caseId`
- `action`
- `currentRunEvidence = true`
- `artifactRoot`
- `generatedAt`
- `startedAt`
- `endedAt`

## Current-Run Evidence Gate

Agent 在接受 helper report 前必須檢查：

- `runId` 等於目前 run workspace id。
- `caseId` 等於目前 current case。
- `action` 等於 helper plan action template。
- `startedAt` / `endedAt` 為合法 timestamp。
- `startedAt` 不可早於本 run `state.started_at`。
- `endedAt >= startedAt`。
- `helperCanJudgeResult = false`。
- `evidenceMetadata.currentRunEvidence = true` 且 metadata 中的 `runId / caseId / action` 與外層一致。

任何檢查失敗，該 helper action 視為 `error`，Codex 不可引用該 artifact 作可信 evidence。

## State Delta Planner

Helper 可讀取目前 UI state 並計算 delta，以減少重複操作。但只能在以下條件下跳過某項設定：

- 目標值來自 current case / helper plan / cleanup checklist。
- 目前 UI 的 visible text、select value、input value 或 DOM state 已可驗證對齊。
- report 必須寫出 `stateDelta.before`、`stateDelta.after`、`checks` 與實際執行/跳過的 `operations`。

若 state delta 為 `false` 或 `unknown`，Helper 必須透過 visible UI 操作修正；修正後仍驗證不到則回 `blocked`。State delta evidence 只證明 UI setup 是否對齊，不代表 testcase 結果已 PASS。

## Warm Session Policy

Mac Agent 可保留 dedicated Chrome process 以降低 cold start 成本，但每個 run / case 仍必須：

- 重置為單一 DEV tab。
- 重新執行 preflight。
- 重新讀 current case cleanup checklist。
- 收集 current-run helper report / DOM / network / chart evidence。

Warm Chrome 不能讓舊頁面、舊 helper artifact、舊 screenshot 或舊 network observation 變成本題 evidence。若 run failed / cancelled，Agent 應關閉 dedicated Chrome 清掉可能殘留的 native dialog 或阻塞狀態。
