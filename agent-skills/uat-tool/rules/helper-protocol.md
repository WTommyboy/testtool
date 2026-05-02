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
- Helper 不可依賴 OS foreground window、active tab 或第一個 Galaxy tab 判斷目標頁；必須讀 `input/browser-session.json` 並用 `window.name` / `sessionStorage.__uatToolBrowserSession` marker 綁定本題 dedicated tab。
- Helper 不可在一般 action 中呼叫 `page.bringToFront()`、CDP `/json/activate`、AppleScript focus 或任何前景搶焦點手段。run/case 一開始建立 dedicated Chrome window/tab 是允許的，後續人工介入需透過 Tool Bridge/log 事件。
- Helper 點不到、actionability 失敗、postcondition 驗證不到時，必須回 `blocked` 或 `requires_approval`，並留下 reason / DOM / screenshot evidence。
- Irreversible action、native alert/confirm、overwrite/delete/save 等流程必須先有 Tool Bridge response；非 SSO/login/auth request 可由 Mac Agent auto approval policy 回覆。
- Helper executor 只能由 Mac Agent 執行；Codex 不可用 shell `command_execution` 直接呼叫 helper executor 或自行連 persistent Chrome CDP。Codex 的職責是讀 helper report、必要時發 Tool Bridge request、再判定並寫 result。
- Helper 若支援多欄位選取,必須把 composite field string 拆成多個欄位逐一透過 visible UI 新增與驗證。
- Helper 可在 `+ 新增欄位` 文字 locator 失敗時嘗試其他 visible button / role / class fallback,但仍必須使用 Playwright actionability click,不可用 force click 或 JS setter。失敗時需留下 visible controls / DOM profile / locator drift evidence。
- Helper 在 `collage.configureMetric` 選欄位前必須等待 `載入欄位中...` 進入可操作狀態；loading timeout 回 `FIELD_LIST_LOAD_TIMEOUT`,載入完成後仍無控制項才回 `ADD_FIELD_BUTTON_NOT_CLICKABLE`。
- Helper 若支援 metadata dropdown 對照,只能透過 visible UI 展開欄位 picker,再以 read-only DOM extraction 擷取欄位清單；expected list 只能讀 run packet 的 `rules/BI_DATA/metadata.csv` 或 `input/reference-index.json` 指定檔,不可打 BI API 或掃描所有 CSV 猜測來源。
- Helper 若支援 CSV 下載,只能透過 visible UI 觸發下載,再讀本機下載檔作 evidence；不可直接打 BI API 取得 CSV,也不可把 Google Sheet 開檔流程當成正式 UAT evidence。若 browser download event 未觸發,但同一次 visible UI click 產生 CSV/attachment response,可保存該 UI-triggered response body 作 evidence 並標示 source。若 testcase 指定從專案/報表清單下載,helper 應定位本輪 saved report row/list control；若 save 後清單 stale,先刷新/重定位；並與儲存前 preview table/chart evidence 比對,不需重開 editor。若前置設定、清單或 preview 已失敗,helper 應標 `failedSubcondition` 與 `csv_comparison_status=not_reached`,讓 Codex 判斷前置流程失敗與 CSV not reached。
- 對同時包含 save/download 或 save/reopen/download 的 CSV case,helper plan 若已產生後續 download actions,只完成 preview 不代表 case 已可判定。Codex 應先要求 Tool Bridge/continuation 執行剩餘必要步驟,或在 helper report 中明確記錄哪個前置必要子條件失敗。

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

### `output/helper-continuation-summary.json`

Mac Agent 在 Tool Bridge auto approval 後，若 current case 還有 pending helper action，會在 Codex resume 前執行 approved helper continuation，並寫入本檔。

必要欄位：

- `schemaVersion = helper-continuation-v1`
- `runDir`
- `caseId`
- `status = ok | partial | skipped`
- `autoResponseCount`
- `actionCount`
- `executedCount`
- `actions[]`

每個 action result 欄位同 `helper-pre-run-summary.json`。Codex 只能引用通過 current-run evidence gate 的 helper report；continuation summary 本身不是 PASS / FAIL / BLOCKED 結果。

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

Helper report 的 `evidence` 可引用 `ui-dom-profile-ref-v1`。它是 Helper 在進入 page / modal / widget context 後抓到的精簡 DOM 結構索引，不是完整 HTML dump。

Helper report 的 `evidence` 也應包含 browser-session evidence:

- `browserSession.schemaVersion = uat-browser-session-v1`
- `browserSession.runId / caseNo / generation / sessionId / targetId / tokenHash / windowNamePrefix / endpoint`
- `targetBinding.resolvedBy = window.name`
- `targetBinding.tokenMatch = true`
- `foregroundPolicy.mode = no-activate`
- `foregroundPolicy.bringToFrontCalled = false`
- `foregroundPolicy.cdpActivateCalled = false`

### `output/helper-artifacts/<case>/dom-profiles/*.json`

必要欄位：

- `schemaVersion = ui-dom-profile-v1`
- `runId`
- `caseId`
- `action`
- `context`
- `signature`
- `url`
- `route`
- `title`
- `viewport`
- `controls.buttons[]`
- `controls.inputs[]`
- `controls.selects[]`
- `widgets.datePicker`
- `widgets.dialogs[]`
- `limits`
- `policy`

DOM profile 原則：

- 只保存 visible structure：button / input / select / modal / widget 的 id、role、name、text、disabled、onclick attribute、selected value、少量 option text、bounding box。
- 不保存完整 HTML，不保存非 visible 大型 DOM tree。
- 每個 profile 以 normalized structure 產生 `signature`；同一 page/modal/widget 結構未變時可重用同一 artifact path。
- Helper 進入新 page、打開 modal/popup、切換 widget tab、或操作會重建 widget 的關鍵節點後，應抓 profile 或 state delta。
- Helper 點擊後仍必須做 postcondition 驗證；DOM profile 只協助辨認元件與診斷 locator drift，不可取代 visible UI action、network/chart/table evidence 或 final PASS/FAIL 判定。

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
- browser session marker 必須與 `input/browser-session.json` 對齊；`BROWSER_SESSION_LEASE_MISSING`、`BROWSER_SESSION_TARGET_MISSING`、`BROWSER_SESSION_TOKEN_MISMATCH`、`BROWSER_SESSION_STALE`、`BROWSER_SESSION_URL_MISMATCH` 都是 helper target gate blocker。

任何檢查失敗，該 helper action 視為 `error`，Codex 不可引用該 artifact 作可信 evidence。

## State Delta Planner

Helper 可讀取目前 UI state 並計算 delta，以減少重複操作。但只能在以下條件下跳過某項設定：

- 目標值來自 current case / helper plan / cleanup checklist。
- 目前 UI 的 visible text、select value、input value 或 DOM state 已可驗證對齊。
- report 必須寫出 `stateDelta.before`、`stateDelta.after`、`checks` 與實際執行/跳過的 `operations`。

若 state delta 為 `false` 或 `unknown`，Helper 必須透過 visible UI 操作修正；修正後仍驗證不到則回 `blocked`。State delta evidence 只證明 UI setup 是否對齊，不代表 testcase 結果已 PASS。

## DOM Profile Policy

Helper 應在以下時機抓取 normalized DOM profile：

- 進入新的 application page 或 report editor。
- 打開 modal、date picker、dropdown、field picker 等 widget context。
- 切換 widget tab 或會改變 widget 結構的控制項，例如日期工具的「動態時間 / 靜態時間」。
- 關鍵點擊後如果該 widget 會自動重算 DOM，例如日期工具點 start day 後 end calendar 可能被重算。
- Helper action blocked / error 前，若 page 仍可讀，必須嘗試抓一份 failure profile。

Profile 的使用邊界：

- Codex 可讀 profile 判斷「Helper 看到的 UI 結構」與 locator drift。
- Codex 不可把 profile 當成已完成測試步驟的證明；完成證明仍需 state delta、network/chart/table/DOM read、screenshot 等 current-run evidence。
- 若 profile signature 與同 action 先前成功 profile 相同，可避免重抓完整結構，只做局部 state delta；若 signature 改變，Helper 必須保守執行 visible UI 操作或 blocked，不可猜測。

## Warm Session Policy

Mac Agent 可保留 dedicated Chrome process 以降低 cold start 成本，但每個 run / case 仍必須：

- 重置為單一 DEV tab，並寫入 `input/browser-session.json`。
- 在該 tab 寫入本題 `window.name` / sessionStorage marker。
- 重新執行 preflight。
- 重新讀 current case cleanup checklist。
- 收集 current-run helper report / DOM / network / chart evidence。

Warm Chrome 不能讓舊頁面、舊 helper artifact、舊 screenshot 或舊 network observation 變成本題 evidence。若 marker 不符，Helper 必須 blocked，不可改抓其他 tab。若 run failed / cancelled，Agent 應關閉 dedicated Chrome 清掉可能殘留的 native dialog 或阻塞狀態。
