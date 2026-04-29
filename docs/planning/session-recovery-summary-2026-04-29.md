# Session Recovery Summary - 2026-04-29

本文件整理兩個因 remote compact 失敗而難以接續的 Codex session，並同步目前 `uat-tool` planning log 與 production 狀態。用途是讓新對話可直接接手，不必讀完整聊天歷史。

來源 session：

- `019dcf61-191a-7ec3-829b-4b5b324c30ec`
- `019dd683-fb18-7562-861a-7e12b2cdf73f`

相關 planning log：

- `/Users/tommy/Downloads/codex_galaxy/uat-tool/docs/planning/local-manual-device-development-log.md`
- `/Users/tommy/Downloads/codex_galaxy/uat-tool/docs/planning/online-uat-tool-development-log.md`

最後核對時間：2026-04-29 22:47 Asia/Taipei

---

## 1. Compact 失敗原因觀察

session `019dd683-fb18-7562-861a-7e12b2cdf73f` 的 Codex log 顯示，失敗不是單純前端聊天室看起來「訊息很短」：

- last successful API response total tokens 約 `232,896`
- model context window 約 `258,400`
- compact request model-visible bytes 約 `852,199`
- error：`stream disconnected before completion`

也就是模型可見內容其實已非常大，包含 AGENTS.md、長工具輸出、planning log、diff / build / runtime log 等。後續應避免在同一窗反覆貼長輸出；以 planning log / recovery summary 交接。

---

## 2. Session 019dcf61 摘要

主題：線上 UAT Tool / Mac Agent MVP 的真實 UAT 遠端派工閉環與可觀測性修復。

### 2.1 起因

Tommy 貼了線上工具 run log，Web UI 看起來像 Agent 開始後就沒有動靜。檢查本機 `~/.uat-agent/runs/<runId>/` 後確認：

- run 不是完全沒跑。
- Playwright 有進 Galaxy，API 200，不是 SSO 卡住。
- 本機已有 Playwright snapshot、detail JSON、`output/result.xlsx`。
- Web UI 當時缺少即時 Codex / Playwright 進度。
- cancel / failed 後 partial artifacts 沒有完整回傳線上。
- result workbook 中部分結果不可採信，因為 Playwright session 沒有看到完整 UI 操作鏈。
- Tool Bridge 授權不夠硬，Codex 可能在 detail 裡聲稱「已授權」，但沒有真正 Tool Bridge response。

### 2.2 已完成修復

commit：

- `c615f43 fix: surface agent progress artifacts`

主要內容：

- Codex CLI 執行中送出 `run.progress`。
- 前端測試執行頁新增「即時執行 Log / Events」。
- cancel / failed 時也上傳 partial `agent.log` / fallback result 診斷資料。
- Tool Bridge policy violation 加硬：若沒有真正 Tool Bridge response，卻聲稱授權或涉及原生 dialog / 刪除類操作，標為違規。
- Agent doctor 補 macOS Accessibility / Screen Recording / Automation 權限提示。
- 新增 roundtrip smoke，確認 `run.progress`、`run.partial_artifacts` 會進 events/logs。

驗證：

- `npm run verify:all` 通過。
- 已推到 `refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp`。
- 當時重啟本機 launchd Mac Agent。

---

## 3. Session 019dd683 摘要

主題：UAT Tool 從 helper hints / consistency checker / result gate / Tool Bridge / Chrome lifecycle 到 helper-assisted V1 的連續優化。

### 3.1 Helper hints 接線

目標：讓 `測試執行說明_*.md` 中的 Helper hints 可流到本機 ACTIVE prompt 與線上 run packet。

完成：

- 本機 `generate_current_case_prompt.mjs` 可解析單題 Helper hints。
- ACTIVE prompt 會保留 Helper Hints 區塊。
- 線上 `current-case-pack`、`bi-ui-helper-guidance`、`rule-index` 接入 explicit helper hints。
- `requiredEvidence` 支援子類，例如 `network.requestBody.dateRange`。
- 新增 `npm run verify:helper-hints` temporary fixture。

注意：

- DEMO001 v1_4 當時沒有 Helper hints 區塊，所以 prompt 顯示「未找到本題 Helper hints」是預期，不代表 parser 壞。

### 3.2 三文件 / Helper hints consistency checker

目標：派工或產 ACTIVE prompt 前，先檢查 xlsx、Codex 指派文字、測試執行說明、Helper hints 是否一致。

完成：

- 新增 `test-package-consistency` checker。
- error 阻擋，warning 只提醒。
- ACTIVE runner 生成前也會跑 checker。
- 線上 run packet 會輸出 `input/test-package-consistency.json`。
- 新增 `npm run verify:package-consistency`。

驗證重點：

- 好 fixture status=ok。
- 風險等級衝突會 error。
- DEMO001 v1_4 無 blocking error。

### 3.3 Result / evidence gate

目標：不要讓不合格 result.xlsx 被線上工具入庫。

commit：

- `8bed859 feat: add UAT package and result gates`

完成：

- 新增 `src/result-parser/result-evidence-gate.ts`。
- server 在 `result.xlsx` ingest 前跑 gate。
- blocking error 回 422，不寫入 run_cases / bugs。
- 擋多題 result、非 current case、缺 detail_json、invalid JSON、缺 current-run evidence、缺 Tool Bridge response、agent fallback result。
- Agent 上傳時帶 `resultSource`、`currentCaseNo`、`expectedCaseNos`。
- 新增 `npm run verify:result-evidence-gate`。

### 3.4 Production 架構與資料存放確認

確認：

- Vercel：前端 Web UI。
- Railway：後端 API / WebSocket / SQLite / storage。
- Tommy Mac Agent：本機執行器。
- GitHub：程式碼來源，不存正式 runtime DB 或 run artifacts。
- production data 在 Railway volume：
  - `DB_PATH=/app/persist/uat.db`
  - `STORAGE_ROOT=/app/persist/storage`
  - `RAILWAY_VOLUME_MOUNT_PATH=/app/persist`
  - `RAILWAY_VOLUME_NAME=testtool-volume`

部署分支紀律：

- 工作分支：`refactor/mac-agent-mvp`
- production 部署分支：`codex/uat-tool-mvp`
- 要上 production 必須推：
  - `git push origin refactor/mac-agent-mvp`
  - `git push origin refactor/mac-agent-mvp:codex/uat-tool-mvp`

### 3.5 Tool Bridge resume 與 fallback result 修復

問題：

- DEMO001 E2E 在 preview 後正確等待不可逆操作授權。
- Tommy 授權後，Chrome 只多開頁籤，沒有繼續 UI 操作。
- 根因：`codex exec resume` 失敗，stderr 為 `Not inside a trusted directory and --skip-git-repo-check was not specified.`
- Agent 又產 fallback `result.xlsx`，造成 gate 報錯掩蓋真正根因。

commit：

- `2f41e57 fix: resume mac agent after tool bridge approval`

完成：

- `codex exec resume` 補 `--skip-git-repo-check` 與 sandbox 參數。
- fallback workbook 改成 `agent-fallback-result.xlsx`。
- fallback 不再偽裝成可信 `output/result.xlsx`，也不再上傳觸發混淆 gate。
- 新增 `npm run verify:agent-resume`。

### 3.6 Web UI 清空草稿與不可逆操作授權 UX

問題：

- 清空後只清下方結果，上方測試設定、React file state、原生 file input 殘留。
- 重新選檔時 UI 與 submit validation 狀態不一致。
- 授權 UI 文案過於泛用，沒有明確不可逆操作語意。

commit：

- `57401a4 fix: improve run reset and approval UX`

完成：

- 清空草稿完整 reset run/case/log/approval、測試設定、React file state、原生 input value。
- 不可逆授權卡顯示 request id、case、step、action、reason。
- 必須勾選確認後才能按「授權並繼續執行」。
- 保留拒絕 / 跳過 case、取消整個 run。

驗證：

- web build / lint / root typecheck / build 通過。
- production Vercel bundle 已含新版文案。

### 3.7 Mac Agent Chrome tab lifecycle 修復

問題：

- Web log 顯示 Codex 在操作，Tommy 肉眼 Chrome 前景不動。
- 根因不是授權 UI，而是 persistent Chrome 累積多個 Galaxy tab，Playwright 在背景 tab 操作。
- resume 時也會開新 DEV URL tab，破壞原 browser context。

相關 commits：

- `40305ff fix: keep mac agent chrome tab visible`
- `ed3740c fix: activate mac agent chrome target after mcp calls`
- `ea986d7 fix: scope mac agent chrome to each run`
- `ae7598b fix: remove agent chrome new tab`

完成：

- initial run reset / activate dedicated Chrome tab。
- resume 不再開新 tab，改 activate 既有 BI edit/home page。
- Chrome 首次 spawn 後清理 persistent profile 還原出的舊 tab。
- 每次 MCP tool call 後 activate 最佳 tab。
- Agent Chrome 改為 run-scoped resource：run 開始前關閉舊 dedicated Chrome，run 結束 / cancel / failed 後關閉。
- `chrome://newtab/` 殘留修正。

注意：

- OTTEST005 因人工用 CDP 干預 live browser，被標為污染，不可當有效 UAT 結果。

### 3.8 Helper-assisted UAT V1

commit：

- `81b0ad5 feat: add helper-assisted UAT plan`

目的：

- 不再讓 Codex click-by-click 探索所有 UI。
- Helper 做穩定 UI 操作與 evidence 收集。
- Codex 保留判定、detail_json、case 結果寫作。

完成：

- 線上 run packet 新增：
  - `input/helper-execution-plan.json`
  - `input/helper-execution-plan.md`
- 本機 `generate_current_case_prompt.mjs` 也新增 Helper Execution Plan 區塊。
- 新增 `agent/src/helper-execution-plan.ts`。
- 新增 `agent/src/bi-ui-helper-executor.ts`。
- helper executor 走 Agent dedicated Chrome CDP。
- helper 不直接打 BI API、不用內部 JS setter、不寫 result.xlsx、不判 PASS/FAIL。
- V1 已實作或註冊：
  - `collage.openProject`
  - `collage.createReport`
  - `collage.configureMetric`
  - `collage.runPreviewAndCollectEvidence`
  - `collage.saveReport` Tool Bridge gate
  - `reopen/delete/filter/group` 模板先註冊，未完成會回 `not_implemented` 或 `requires_approval`

驗證：

- agent/root build/typecheck 通過。
- `npm run verify:helper-hints`
- `npm run verify:package-consistency`
- `npm run verify:result-evidence-gate`
- 手動 helper executor smoke：openProject -> createReport 成功；saveReport 無 approval 回 `requires_approval`。

### 3.9 Run Log / Events 分頁

問題：

- 即時 Log / Events 只顯示 200 筆，長 run 後看不到後續。
- server `/logs`、`/events` 預設 limit=200，前端 polling 覆蓋 state。

commit：

- `f47d094 fix: paginate run activity logs`

完成：

- `/api/runs/:id/logs`、`/events` 支援 `after_id`、`hasMore`、`total`、`nextAfterId`。
- 前端每批 500 筆，保留已載入資料，用最後 id 往後追。
- UI 改成 `Timeline / Logs / Events` 三頁籤。
- 提供「載入下一批」按鈕。

---

## 4. 目前 repo / production 狀態

最後核對：

- local branch：`refactor/mac-agent-mvp`
- local HEAD：`f47d094 fix: paginate run activity logs`
- origin `refactor/mac-agent-mvp`：`f47d094`
- origin `codex/uat-tool-mvp`：`f47d094`
- Railway `/version`：`f47d094`
- Railway `/health`：healthy

目前本機工作樹有未追蹤本機 artifacts，未納入 git：

- `DEMO-B-01-daily-report-dropdown.png`
- `DEMO-C-01-result.png`
- `artifacts/`
- `scripts/demo_a01_detail.json`
- `scripts/update_case_result_16col.mjs`
- `uat_results/`

這些看起來是本機測試產物，不應在未確認前一起提交。

---

## 5. 目前未完成 / 下一步建議

最新 session 最後停在速度問題：

- 畫面已會動，但速度更慢。
- production / branch / local 都已確認在 `f47d094`。
- helper plan 已進 run packet，但 task-runner 當時仍只是把 plan 路徑交給 Codex，尚未在 Codex 前自動執行 safe helper actions。
- CodexRunner 沒有固定 model / reasoning，會吃全域 Codex 設定，可能導致速度慢。

建議下一步：

1. 不先加新產品功能，先做最小速度優化。
2. Agent 預設使用較低 reasoning 設定，避免每步 UI 操作都用高 reasoning。
3. 在 Codex 啟動前自動執行不需要 Tool Bridge 的 helper actions。
4. `saveReport`、delete、overwrite、native confirm 等 `requiresApproval` action 仍不得自動執行。
5. helper 成功後只把 evidence report 交給 Codex，Codex 再判定 PASS/FAIL/BLOCKED 並寫 result。
6. 完成後用一個小 E2E 驗證：
   - run packet 有 helper plan。
   - safe helper actions 先跑。
   - Tool Bridge action 停住。
   - Codex 不再重複做 helper 已完成的 UI 操作。
   - result/evidence gate 仍可擋不合格結果。

---

## 6. 新對話接手提示詞

可直接給下一個 Codex：

```text
請接續 /Users/tommy/Downloads/codex_galaxy/uat-tool 的線上 UAT Tool 優化。

先讀：
/Users/tommy/Downloads/codex_galaxy/uat-tool/docs/planning/session-recovery-summary-2026-04-29.md
/Users/tommy/Downloads/codex_galaxy/uat-tool/docs/planning/online-uat-tool-development-log.md

目前 production / origin / local 應在 f47d094。下一步不是做新功能，而是處理速度問題：
1. Agent 預設 lower reasoning。
2. Codex 前先自動執行 helper-execution-plan 中不需要 Tool Bridge 的 safe helper actions。
3. save/delete/overwrite/native confirm 等 requiresApproval action 仍必須停在 Tool Bridge。
4. helper 只能收集 current-run evidence，不可判 PASS/FAIL，不可寫 result.xlsx，不可直接打 BI API，不可用 JS setter。
5. 完成後更新 online planning log，跑 typecheck/build/相關 fixture，commit 並推 refactor/mac-agent-mvp 與 codex/uat-tool-mvp。
```
