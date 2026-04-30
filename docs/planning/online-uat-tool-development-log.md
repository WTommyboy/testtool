# 線上 UAT Tool 開發與規劃日誌

最後更新：2026-04-29

本文件記錄「UAT Tool 線上派工 + Mac Agent」這條路徑的歷史決策、設計理由、目前架構與後續待辦。它的用途是跨聊天室、跨 session 交接，不取代 `AGENTS.md`、Layer rules、authoring spec 或實作 spec。

每次修改線上工具的 run packet、Mac Agent、Tool Bridge、rule index、current case pack、result pipeline、evidence gate、部署分支或 production 架構時，請同步更新本文件。

---

## 1. 範圍

本文件涵蓋線上工具端：

- Tommy 從 UAT Tool Web UI 建立 run。
- 上傳 xlsx / 指派文字 / 測試執行說明 / reference files。
- Railway backend 建立 run 並派工。
- Tommy Mac Agent 下載 run workspace。
- Codex 在 `~/.uat-agent/runs/<runId>/` 讀取 `input/` 內的執行包。
- 結果產生到 `output/result.xlsx`，由 Agent 上傳回 Railway。

不涵蓋：

- Tommy 直接在 `/Users/tommy/Downloads/codex_galaxy` 開 Codex 跑本機 xlsx。
- 本機 `outputs/update_case_result.mjs` 直接寫原始 xlsx。
- 本機 ACTIVE runner 的實際操作流程。

本機手動端請看：

- `/Users/tommy/Downloads/codex_galaxy/uat-tool/docs/planning/local-manual-device-development-log.md`

---

## 2. 為什麼需要這份日誌

線上工具的目標不是只把本機手動流程搬上 Web，而是建立更穩定的派工與 evidence pipeline。

過去本機端累積的問題：

- Codex 每次全文讀規則，速度慢且容易混入舊上下文。
- 長對話會 compact，甚至遇到 remote compact stream disconnect。
- 憑聊天記憶維持規則，容易漏掉決策理由。
- testcase 由 Claude 依記憶產生，缺少穩定 authoring spec。
- evidence 與 result 寫回過度依賴 Codex 自律。

線上工具要解決的是：

- 讓 Codex 讀「編譯後的當前題執行包」，而不是全文讀所有規則。
- 讓 backend / Agent 產生必要上下文與安全邊界。
- 讓工具層做 gate，例如缺 evidence、不合法授權、多題混跑、stale evidence 都要 reject。
- 讓本機 demo 與線上 Agent 使用同一套概念：current case、rule index、helper guidance、result evidence。

---

## 3. 核心架構決策

### 3.1 Rules 仍是 source of truth，但執行時讀 run packet

Tommy 曾問：以後是不是不讀 agent 和 rules？

決策是：不是不用 rules，而是不讓 Codex 每次全文讀 rules。

正確架構：

- `AGENTS.md`、`BI_TEST_RULES/`、Layer 1 rules、authoring spec 仍是 source of truth。
- 線上工具由 backend / Mac Agent 先產生 run packet。
- Codex 執行時主要讀 run packet 的最小上下文。
- 只有 run packet 明確要求或遇到灰區，才補讀特定 rules。

這樣不是放鬆，而是把「規則判讀」前移到工具層。

### 3.2 run workspace 是線上模式的唯一執行現場

線上模式不應以 `/Users/tommy/Downloads/codex_galaxy` 作為主要工作目錄。

預期 workspace：

- `~/.uat-agent/runs/<runId>/`

重要檔案：

- `input/run-brief.md`
- `input/current-case.json`
- `input/current-case-pack.json`
- `input/current-case-pack.md`
- `input/run-state.json`
- `input/rule-index.json`
- `input/bi-ui-helper-guidance.md`
- `rules/PROJECT_AGENTS_FULL.md`
- `rules/BI_TEST_RULES/`
- `rules/BI_DATA/metadata.csv`
- `output/result.xlsx`

Codex 不可修改原始上傳 xlsx。線上模式輸出是 `output/result.xlsx`。

### 3.3 Tool Bridge 授權是線上模式唯一有效授權

本機手動模式可以由 Tommy 在 chat 明確授權不可逆操作。

線上工具模式不同：

- 文件內寫「預先批准」不算授權。
- startup prompt 寫「已授權」不算授權。
- 只有 UAT Tool 的 Tool Bridge response 算授權。

遇到以下情境必須停在安全點並輸出 Tool Bridge request：

- SSO。
- 載入失敗。
- native alert / confirm。
- 刪除。
- 覆蓋。
- 儲存既有報表。
- 離開含未儲存變更頁面。
- 不可逆操作。
- 規格歧義需要 PM 判斷。

### 3.4 線上工具不應自動 dispatch 下一題，除非產品設計明確支持

本機 ACTIVE runner 是為了手動 demo 效率，允許 Codex 跑完一題後自己呼叫 runner 更新 ACTIVE。

線上模式原則不同：

- 每次 run 以 `input/current-case.json` 為準。
- 若要逐題暫停執行多題，由工具 / PM 重新派發下一題。
- Agent 不應自行跳到未派發 case，除非線上產品明確設計 queue runner 並提供 gate。

這點要避免把本機 demo 的 ACTIVE runner 行為誤搬到線上 Agent。

### 3.5 目前 production 架構與部署分支

目前線上工具是前後端分離，再加上一個本機 Agent worker：

```text
Vercel Web UI
  -> Railway API / WebSocket / SQLite / storage
  -> Tommy Mac Agent
  -> Codex CLI + Playwright MCP
  -> Agent 上傳 result.xlsx / log 回 Railway
  -> Railway parser / gate 入庫
  -> Vercel Web UI 顯示結果
```

各層責任：

- GitHub `WTommyboy/testtool`：程式碼來源，不保存正式 runtime DB 或 run artifacts。
- Vercel：前端 Web UI production。
- Railway `testtool` service：後端 API、WebSocket hub、result parser、result/evidence gate、SQLite、storage。
- Railway persistent volume：production runtime data。
  - SQLite：`/app/persist/uat.db`
  - storage：`/app/persist/storage`
  - volume：`testtool-volume`
- Tommy Mac Agent：本機執行器，負責下載 run input、啟動 Codex CLI / Playwright、產生 `output/result.xlsx` 與 log，再上傳回 Railway。
- Mac 本機 `~/.uat-agent/runs/<runId>/`：執行副本與除錯 artifacts，不是線上工具正式資料來源。

目前分支紀律：

- 開發 / 工作分支：`refactor/mac-agent-mvp`
- production 部署分支：`codex/uat-tool-mvp`
- Railway production 追蹤：`codex/uat-tool-mvp`
- Vercel production 也依目前工程文件追蹤：`codex/uat-tool-mvp`

因此只推：

```bash
git push origin refactor/mac-agent-mvp
```

不會保證 Railway 重新部署。涉及線上後端或前端 production 的變更，必須同步推部署分支：

```bash
git push origin refactor/mac-agent-mvp
git push origin refactor/mac-agent-mvp:codex/uat-tool-mvp
```

推完後必查：

```bash
git ls-remote --heads origin codex/uat-tool-mvp refactor/mac-agent-mvp
curl -s https://testtool-production.up.railway.app/version
curl -s https://testtool-production.up.railway.app/health
```

注意：`/version` 目前可能只回 deployment id，不一定回 git commit / branch。若 deployment id 沒變，需到 Railway Deployments 檢查 auto deploy trigger、追蹤 branch，必要時手動 redeploy latest commit。

---

## 4. 與本機手動端的共同概念

本機手動端與線上工具端應共用這些概念：

- current case：當前唯一允許執行的 case。
- stale evidence：舊 xlsx / 舊頁面 / 舊截圖不是 current-run evidence。
- rule index：讓 Codex 知道哪些規則可查，不全文讀全部。
- helper guidance：讓 Codex 少摸索 UI，但不能越界。
- required evidence：每題必須取得哪些結構化證據。
- one case guard：一題一跑、一題一寫、一題一驗證。

差異：

- 本機可直接寫原始 xlsx；線上必須輸出 `output/result.xlsx`。
- 本機 Tommy chat 授權可處理高風險操作；線上必須 Tool Bridge response。
- 本機 ACTIVE runner 可自動更新下一題；線上預設不自動 dispatch 下一題。

---

## 5. 半腳本化 / helper 化決策在線上工具的含義

Tommy 曾討論是否改成腳本。最後決策是採「半腳本化 / helper 化」，不採整題固定 Playwright 腳本。

在線上工具端，這代表：

### 可由工具層腳本化

- xlsx 解析。
- case manifest 產生。
- document consistency 檢查。
- run brief 產生。
- rule index 產生。
- current case pack 產生。
- helper guidance 產生。
- result schema 檢查。
- result.xlsx 產生 / 合併。
- evidence presence gate。
- Tool Bridge request / response 對帳。

### 可由 helper guidance 輔助

- 指示 Codex 如何用真實 UI 清空篩選。
- 指示 Codex 如何選欄位、選 operator、輸入值。
- 指示 Codex 如何設定時間與顯示方式。
- 指示 Codex 如何按執行後驗證 network / chart / DOM 變化。
- 指示 Codex 如何讀 Chart.js data 或 DOM list。

### 禁止變成腳本平台

- 不可讓 helper 直接跑完整份 testcase。
- 不可讓 helper 一次跑多題。
- 不可讓 helper 直接判 PASS/FAIL。
- 不可直接打 BI API 取代 UI。
- 不可用 JS setter 設定測試狀態。
- 不可用 `browser_evaluate` 觸發狀態變更繞 UI。

---

## 6. Authoring spec 的角色

原本 testcase 多由 Claude 靠記憶與前次成功樣板產生，缺少明確 authoring rules。

後來決定：

- 不另起一套新規範。
- 直接升級 `/Users/tommy/Downloads/codex_galaxy/uat-tool/docs/authoring/UAT_三文件撰寫規則.md` 成唯一 authoring spec。

已更新的方向：

- 明定本專案採半腳本化 / helper 化。
- 維持 xlsx 核心 16 欄，不先強制新增欄位。
- 在 `測試執行說明_*.md` 每題底下新增 Helper hints。
- Helper hints 可包含：
  - `automationLevel`
  - `operationTemplate`
  - `params`
  - `requiredEvidence`
- Claude 產檔 prompt 與一致性檢查表要同步補上 helper/script 邊界。

線上工具後續應讀取 Helper hints，將其納入 `current-case-pack` 或 `bi-ui-helper-guidance`，而不是只靠關鍵字推斷。

---

## 7. 目前線上工具相關檔案

目前已存在的關鍵檔案：

- `/Users/tommy/Downloads/codex_galaxy/uat-tool/agent/src/current-case-pack.ts`
- `/Users/tommy/Downloads/codex_galaxy/uat-tool/agent/src/rule-index.ts`
- `/Users/tommy/Downloads/codex_galaxy/uat-tool/agent/src/bi-ui-helper-guidance.ts`

### `current-case-pack.ts`

目前功能：

- 讀取 current case。
- 依 case 文字推斷 evidence templates，例如：
  - metadata dropdown。
  - network request。
  - chart datasets。
  - UI workflow。
- 產生 `current-case-pack.json` 與 `current-case-pack.md`。
- 明確聲明 pack 是 plan card，不是 result。
- 要求 current-run evidence 後才能寫 result。

後續方向：

- 接入 authoring spec 的 Helper hints。
- 將 inferred templates 與 explicit helper hints 合併。
- 若 explicit helper hints 與 inferred templates 衝突，標示 warning，不要靜默覆蓋。

### `rule-index.ts`

目前定位：

- 應產生可查詢的 rule index。
- 讓 Codex 不必全文讀所有 rules。
- 將規則切成可引用章節或摘要。

後續方向：

- 針對當前 case 的 `riskLevel`、`testTarget`、`cleanupChecklist`、`operationTemplate`，標出必讀 rule keys。
- 保留 source path 與章節引用，避免摘要失真。

### `bi-ui-helper-guidance.ts`

目前功能：

- 產生 `input/bi-ui-helper-guidance.md`。
- 說明不可越界：
  - 不可內部函式設定狀態。
  - 不可 evaluate 觸發 click/change/input。
  - 不可直接打 BI API。
  - 不可 helper 跑多個 case。
- 說明安全讀取：
  - DOM read。
  - read-only page.evaluate。
  - Chart.js data。
  - network performance entries。
- 提供常見操作節奏：
  - 開啟專案。
  - 新增欄位。
  - 設定時間。
  - 執行與驗證。
  - 儲存 / 刪除 / 原生 Dialog。

後續方向：

- 讓 guidance 根據 current case / operation template 輸出更精準片段。
- 避免每題都輸出過長 generic guidance。
- 明確標記 helper 是輔助，不是授權，也不是批次 runner。

---

## 8. result / evidence gate 應強制的事項

線上工具不能只靠 prompt 要求 Codex 守規矩。工具層要能 reject 明顯不合格結果。

應檢查：

- result 是否只包含 current case。
- 是否試圖一次寫多題。
- 是否缺少 current-run evidence。
- evidence timestamp / run id 是否可追溯。
- 是否把 stale xlsx 欄位或舊結果當 evidence。
- 若有 Tool Bridge request，是否有對應 response。
- 若操作含刪除 / 覆蓋 / native confirm，是否有授權紀錄。
- detail_json 是否可 parse。
- PASS 是否至少有四欄簡化版必要內容。
- FAIL / BLOCKED / PARTIAL 是否有完整原因欄位。

這些 gate 後續應逐步落在 backend / Agent result parser，而不是只寫在 prompt。

---

## 9. 不可回退的紅線

線上工具端必須維持：

- 不可直接打 BI API 取得測試結果。
- API / network 只能觀察 UI 觸發了什麼，不能取代 UI。
- 不可寫爬蟲腳本繞 UI 取得 BI 資料。
- 不可用內部 JS setter 設定測試狀態。
- `browser_evaluate` / `page.evaluate` 只允許讀取，不可用來點擊、改狀態、繞安全層。
- 不可一次 tool call 包含多個 case 的執行邏輯。
- 不可累積多題結果一次寫 xlsx。
- 每題必須有 current-run evidence。
- stale evidence 不採信。
- xlsx 步驟欄指定值不可自行替換。
- 高風險操作必須 Tool Bridge 授權。
- 文件內預先授權不算授權。
- Playwright session 掛掉時，不可改用桌面 Chrome 接手正式 case。

---

## 10. 待辦

### P0

- 檢查 `current-case-pack.ts`、`rule-index.ts`、`bi-ui-helper-guidance.ts` 的現況。
- 將 authoring spec 的 Helper hints 接入 current case pack。
- 讓 run packet 能明確輸出：
  - automation level。
  - operation template。
  - helper params。
  - required evidence。
  - relevant rule keys。
- 保持 one case guard，不允許 run packet 暗示可跑下一題。

### P1

- 將 inferred evidence templates 與 explicit Helper hints 分開顯示。
- 若 Helper hints 缺失，保留目前關鍵字推斷作 fallback。
- 若 Helper hints 和 xlsx case row 明顯衝突，輸出 document consistency warning。
- 將 result parser 加入缺 evidence / 多題寫入 / Tool Bridge 授權缺失檢查。

### P2

- 將 helper template vocabulary 抽成共用資料檔，讓本機與線上工具共用。
- 建立 helper template 測試資料，涵蓋時間、欄位、篩選、分組、CSV、metadata、Chart.js。
- 建立線上工具與本機 ACTIVE runner 的對照測試：同一個 DEMO case 產出相同概念的 guidance。

---

## 11. 日誌更新格式

後續每次更新線上工具流程，請在本節下方追加：

```md
### YYYY-MM-DD HH:mm - 標題

- 背景：
- 決策：
- 修改檔案：
- 驗證：
- 後續影響：
```

### 2026-04-29 - 建立線上 UAT Tool 開發與規劃日誌

- 背景：原聊天歷史過長且 compact 失敗，不能再靠聊天上下文交接。
- 決策：將線上工具端與本機手動端拆成兩份 planning log，長期維護。
- 修改檔案：新增本文件。
- 驗證：文件建立後應可作為新聊天室交接來源。
- 後續影響：後續修改 run packet、Mac Agent、Tool Bridge、rule index、current case pack、helper guidance 時都要更新本文件。

### 2026-04-29 07:56 - Run packet 輸出 Helper guidance

- 背景：線上端 `current-case-pack` 只靠關鍵字推斷 evidence，`bi-ui-helper-guidance` 也只有 generic recipe，尚未讀取 authoring spec 的 Helper hints。
- 決策：新增 Helper hints parser，從已下載的 md / supporting doc 中抓當前 case 的 `Helper hints` JSON；將 explicit hints 與 inferred evidence 分開呈現，再合併成本題 required evidence。
- 修改檔案：`uat-tool/agent/src/helper-hints.ts`、`current-case-pack.ts`、`bi-ui-helper-guidance.ts`、`rule-index.ts`、`task-runner.ts`。
- 驗證：`npm run typecheck --prefix uat-tool/agent`、`npm run build --prefix uat-tool/agent` 通過；以 `tsx` inline sample 驗證 parser 可讀出 `automationLevel`、`operationTemplate`、`params`、`requiredEvidence`。
- 後續影響：run packet 會輸出 case-specific helper guidance 與 recommended rule keys；Helper hints 仍不是授權、不是批次 runner、不能判 PASS/FAIL。

### 2026-04-29 08:06 - Helper hints 子類與未落地 gate 風險登記

- 背景：authoring spec 允許 `requiredEvidence` 使用類型或子類；同時 Helper hints 接線完成不代表 document-consistency / result evidence gate 已完成。
- 決策：Agent parser 放寬 `requiredEvidence` 子類判定，例如 `network.requestBody.dateRange` 視為 `network.requestBody` 的合法子類；將 Helper hints vs xlsx 衝突、result/evidence gate、fallback source case 風險保留為後續 gate 工作。
- 修改檔案：`uat-tool/agent/src/helper-hints.ts`；本次也同步更新本機 parser，避免本機/線上立即分歧。
- 驗證：待本次 typecheck/build 一併跑。
- 後續影響：P1/P0 待辦仍包含：(1) `document-consistency.ts` 檢查 Helper hints vs xlsx row 衝突並輸出 warning；(2) result parser/evidence gate reject 多題寫入、缺 current-run evidence、缺 Tool Bridge response；(3) `result-writer.readFirstInputCase` fallback 不應在 B-01/C-01 起跑時誤標 workbook 第一題；(4) 中期抽共用 helper vocabulary/fixture，避免本機與 Agent parser drift。

### 2026-04-29 08:14 - 新增 Helper hints run packet fixture

- 背景：需要用 temporary fixture 驗證 Helper hints 可一路流到線上 Agent run packet，而不是只靠 parser unit sample。
- 決策：新增 `npm run verify:helper-hints`，同一個暫存 fixture 同時驗本機 prompt / ACTIVE prompt 與 Agent `current-case-pack`、`bi-ui-helper-guidance`、`rule-index`。
- 修改檔案：`uat-tool/scripts/verify-helper-hints-fixture.ts`、`uat-tool/package.json`。
- 驗證：`npm run verify:helper-hints` 已通過，確認 `current-case-pack.json helperHints.found=true`、`operationTemplate=metric_filter_operator`、`params` 完整、`requiredEvidence` 含子類；`current-case-pack.md` 有 Helper Hints；`bi-ui-helper-guidance.md` 有 Template Notes；`rule-index.json currentCaseRecommendations.ruleIds` 含 `bi-ui-helper-guidance` 與 `network-observation-guidance`。
- 後續影響：fixture 不做 result/evidence gate；後續 gate 工作仍獨立排程。

### 2026-04-29 08:29 - 三文件與 Helper hints consistency checker

- 背景：線上派工前應先擋測試包設計矛盾，而不是等 Codex 執行後才由 result/evidence gate 發現。
- 決策：新增 `test-package-consistency` report，重用 `case-manifest.ts` 解析 xlsx，檢查 xlsx、Codex 指派文字、測試執行說明、Helper hints 的起始 case、執行順序、風險等級、測試標的、狀態清理、helper caseId / vocabulary / evidence 對齊。error 併入 `document-consistency.json` 以阻擋 browser execution；warning 只提醒。
- 修改檔案：`uat-tool/agent/src/test-package-consistency.ts`、`document-consistency.ts`、`task-runner.ts`、`rule-index.ts`、`reference-index.ts`、`uat-tool/scripts/check-test-package-consistency.ts`、`uat-tool/scripts/verify-package-consistency-fixture.ts`、`uat-tool/package.json`。
- 驗證：`npm run verify:package-consistency` 已通過，涵蓋好 fixture status=ok、風險等級衝突 blocking error、DEMO001 v1_4 無 blocking error；`npm run typecheck --prefix uat-tool/agent`、`npm run typecheck --prefix uat-tool`、`npm run build --prefix uat-tool/agent` 均通過。
- 後續影響：run packet 會包含 `input/test-package-consistency.json`，run brief / reference index / rule index 都會標出它。這一步只擋測試包設計矛盾，不做 result/evidence gate。

### 2026-04-29 10:35 - Result/evidence gate 接入 result.xlsx ingest

- 背景：測試包設計矛盾已先擋住；下一層要防止 Codex 執行結果不合格仍被線上工具入庫，特別是多題寫入、缺 current-run evidence、缺 Tool Bridge response、Agent fallback result 誤當可信 UAT 結果。
- 決策：在 server `result.xlsx` ingest 前加入 `result-evidence-gate`，重用既有 `parseResultXlsx`，產出 `*.result-evidence-gate.json` report；blocking error 回 422 並不寫入 run_cases/bugs。Mac Agent 上傳時帶 `resultSource`、`currentCaseNo`、`expectedCaseNos`，fallback workbook 會被 gate 擋下；fallback source case 也優先用 current case metadata，不再只取 workbook 第一題。
- 修改檔案：`uat-tool/src/result-parser/result-evidence-gate.ts`、`uat-tool/src/runs.ts`、`uat-tool/agent/src/task-runner.ts`、`uat-tool/agent/src/result-writer.ts`、`uat-tool/scripts/check-result-evidence-gate.ts`、`uat-tool/scripts/verify-result-evidence-gate.ts`、`uat-tool/package.json`。
- 驗證：`npm run verify:result-evidence-gate` 已通過，涵蓋單題 current-run evidence 通過、多題 result、缺 evidence、agent fallback、缺 Tool Bridge response、invalid detail_json 會被擋；`npm run typecheck --prefix uat-tool`、`npm run typecheck --prefix uat-tool/agent`、`npm run build --prefix uat-tool`、`npm run build --prefix uat-tool/agent` 均通過。
- 後續影響：線上工具現在具備第一層 result/evidence gate，但仍是最小版 heuristic。後續 P1 可把 Helper hints 的 `requiredEvidence` 與實際 detail_json evidence key 做更精準對照，並把 Tool Bridge request/response server-side 關聯納入報告。

### 2026-04-29 11:33 - 補記部署分支與 production 架構

- 背景：`8bed859 feat: add UAT package and result gates` 原先只推到 `refactor/mac-agent-mvp`，Tommy 在 Railway 沒看到部署；檢查後發現 Railway production 實際追蹤的是 `codex/uat-tool-mvp`。
- 決策：線上工具變更若要觸發 production，必須把工作分支同步推到部署分支：`git push origin refactor/mac-agent-mvp:codex/uat-tool-mvp`。只推 `refactor/mac-agent-mvp` 只能代表 code review / 工作分支更新，不代表 Railway 會部署。
- 修改檔案：本文件新增「目前 production 架構與部署分支」章節，明列 Vercel / Railway / Mac Agent / GitHub / Railway volume 的責任邊界與部署驗證命令。
- 驗證：已確認遠端 `origin/refactor/mac-agent-mvp` 與 `origin/codex/uat-tool-mvp` 都指向 `8bed859`；`/health` 正常。`/version` 當時 deployment id 尚未變更，需用 Railway dashboard 確認 auto deploy 或手動 redeploy。
- 後續影響：後續任何需要上線的 uat-tool 變更，完成 push 後都要確認部署分支與 Railway deployment 狀態，避免「已推 GitHub 但 production 未更新」。

### 2026-04-29 17:18 - E2E 試跑發現前端清理與檔案選取狀態殘留

- 背景：Tommy 在線上工具 E2E 試跑時，先前被 result/evidence gate 擋下的測試結果可被「清理」清空，但測試設定區未完整 reset；重新選擇 xlsx / 說明文件後，UI 上檔案 input 看似仍有檔名與「2 個檔案」，但底部未列出正確已選檔狀態，按「開始執行」仍顯示「請上傳 xlsx 和至少一份說明文件」。需重新整理網址才能解除。
- 決策：先登記為 Web UI P1 bug，不在目前 E2E 驗證中追加新功能；修正方向應檢查清理動作是否同時 reset run/testcase form state、file input ref、selected file state、validation state 與 uploaded-doc list。
- 修改檔案：暫無程式修改；本文件補記觀察。截圖來源：`/Users/tommy/Desktop/screenshot/截圖 2026-04-29 下午5.15.13.png`。
- 驗證：未修；現象由 Tommy 截圖與操作描述確認。
- 後續影響：後續修 UI 時需補測兩條流程：(1) gate failed / blocked 後按清理，設定與檔案區應回到乾淨初始狀態；(2) 清理後重新選 xlsx + 多份 md，selected files summary 與 submit validation 必須一致，不需刷新頁面。

### 2026-04-29 17:38 - 修正 Tool Bridge 授權後 Codex resume 失敗與 fallback result 混淆

- 背景：DEMO001 E2E run `98fb20cf-3c96-437c-b183-927885f34bb8` 在 DEMO-A-01 preview 後正確停在 Tool Bridge 不可逆操作授權；Tommy 按授權後，Chrome 只多開一個頁籤且沒有任何可見 UI 操作。檢查本機 run workspace 後確認 `codex-resume` 只跑約 2 秒即失敗，stderr 為 `Not inside a trusted directory and --skip-git-repo-check was not specified.`。Agent 接著產生 fallback `result.xlsx` 並嘗試上傳，導致 result/evidence gate 以 detail_json/evidence 不足擋下，反而遮蔽真正根因。
- 決策：Mac Agent 的 `codex exec resume` 必須和首次 `codex exec` 一樣帶 `--json --sandbox workspace-write --skip-git-repo-check`，讓 `~/.uat-agent/runs/<runId>` 這類非 git workspace 可續跑。Agent 自產 fallback workbook 只可作本機診斷，不可寫成 `output/result.xlsx` 也不可上傳成可信 UAT 結果；若 Codex 未產 `output/result.xlsx`，run 應以 `CODEX_NO_RESULT_XLSX` 或原始 `CODEX_RUN_FAILED` 失敗。
- 修改檔案：`agent/src/codex-runner.ts`、`agent/src/task-runner.ts`、`agent/src/result-writer.ts`、`scripts/verify-agent-resume.ts`、`package.json`。
- 驗證：新增 `npm run verify:agent-resume`，用 fake Codex executable 驗證 resume argv 含 `--skip-git-repo-check` 且順序為 `codex exec --json --sandbox workspace-write --skip-git-repo-check resume <thread> <prompt>`。仍需重新部署後再跑一次線上 E2E 驗證實際 Tool Bridge 授權後會接續原 thread 操作 browser。
- 後續影響：Web UI 仍應改善等待授權狀態與按鈕文案，避免「收集 Evidence」階段看似卡住；但此修正先處理 Agent resume 的硬阻塞與 fallback result 混淆。

### 2026-04-29 18:00 - 修正 Web UI 清空草稿與不可逆操作授權 UX

- 背景：Tommy 回報線上工具按「清空為新測試草稿」後，只清掉下方被 gate 擋下的結果，但上方測試設定與原生 file input 狀態殘留；重新選檔後 UI 仍可能顯示有 xlsx / 多份 md，但 submit validation 讀到的 React state 是空，必須刷新頁面才恢復。另外 Tool Bridge pending card 的主要按鈕仍是泛用「已處理，繼續執行」，不可逆操作沒有明確授權語意。
- 決策：清空草稿改成同時 reset selected run detail、case/log/approval panels、測試設定欄位、React file state 與原生 file input value，並避免清空後 `loadRuns()` 又自動選回最新歷史 run。不可逆 Tool Bridge request 改成 explicit authorization card：顯示 type、request id、case、step、action、reason；必須勾選「只限這個 request id」後，`授權並繼續執行` 才可點；保留 `拒絕 / 跳過此 Case` 與 `取消整個 Run`。
- 修改檔案：`web/src/App.tsx`、`web/src/App.css`。
- 驗證：`npm run build --prefix web` 通過；`npm run lint --prefix web` 無 error，仍有既有 hooks dependency warning；`npm run typecheck` 通過。另以本機 API fixture 驗證 WAITING_APPROVAL 畫面：不可逆授權卡未勾選時按鈕 disabled，勾選後 enabled；按「清空為新測試草稿」後狀態回 DRAFT、approval/case/log 清空、file input 顯示未選檔。
- 後續影響：此為前端 UX 修正，不改 Tool Bridge server protocol。之後若要更完整，後端 approvals table 可新增 structured request payload 欄位，避免 Web UI 從 reason 文字反解析 request id / action / reason。

### 2026-04-29 18:31 - 修正 Mac Agent persistent Chrome 多 tab 與 resume 開新 tab

- 背景：OTTEST003 run `02079de5-7896-4ec9-999e-23eeb6a1581e` 顯示 Codex log 已進入 DEMO-A-01 UI 操作，但 Tommy 肉眼看到 Chrome 畫面幾乎不動，且沒有跳出 Tool Bridge 授權。檢查 run workspace 後確認尚未到儲存授權點；MCP session 實際已點 `拼貼test_001`、`+ 新增報表`、選 `新增帳號數`，並卡在日期面板設定。關鍵線索是 MCP 每次回傳都有 5 個 Galaxy tab，且 `ensureChromeDebugSession()` 在 CDP 已存在時每次都 `/json/new` 開新 tab，resume 也會再開 DEV URL tab，導致 Playwright 可能在背景 tab 操作，Tommy 看到的前景 tab 與受控 tab 不一致。
- 決策：Mac Agent initial run 啟動 persistent Chrome 時，先整理 dedicated `~/.uat-agent/chrome-profile` 內既有 page tabs，再開一個 DEV URL tab 並用 CDP `/json/activate` 置前；Tool Bridge resume 時不再開新 DEV URL tab，只 activate 既有 BI edit/home page，避免授權後破壞原本的 browser context。這不改 Tool Bridge request/response protocol，只修正本機 Agent 對 persistent Chrome tab lifecycle 的管理。
- 修改檔案：`agent/src/browser-session.ts`、`agent/src/task-runner.ts`。
- 驗證：`npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run typecheck`、`npm run build` 均通過；compiled `agent/dist/browser-session.js` / `agent/dist/task-runner.js` 已包含 `resetTabs` 與 `openInitialUrl=false` resume 路徑。
- 後續影響：目前正在跑的 OTTEST003 仍使用舊 Agent process，需取消該 run 並重啟 Mac Agent 後才能套用此修正。下一輪 E2E 需確認：(1) run 開始時 Chrome 只留下單一受控 Galaxy tab；(2) UI 操作在前景可見；(3) 儲存前才出現不可逆 Tool Bridge 授權卡；(4) 授權後 resume 不再新增 home tab，而是接續原 edit tab。

### 2026-04-29 18:43 - 補強 Chrome spawn path 的 resetTabs 與 MCP 後置 activate

- 背景：OTTEST004 run `ff2cf1c8-adae-4b57-8bf8-fbdbe8faf89b` 部署 `40305ff` 後仍出現「Log 已進入 UI 操作，但 Tommy 前景畫面沒動」。檢查本機 `mcp-output/session.md` 確認 Playwright 已成功點進 `拼貼test_001`、`+ 新增報表`、`+ 新增欄位`，並已選到 `新增帳號數` 與打開日期面板；同時 CDP `/json/list` 仍顯示兩個 Galaxy page target：一個 home、一個 edit。這代表前一版只修了「CDP 已存在」路徑，但 Chrome 首次 spawn 時仍會從 persistent profile 還原舊 tab，且 Playwright MCP 操作後沒有保證把受控 tab 拉回前景。
- 決策：`ensureChromeDebugSession()` 在 Chrome 首次 spawn 且 `resetTabs=true` 時，不再把 DEV URL 直接塞進 Chrome args；改為等 CDP ready 後先關閉非 `chrome://` 的 user page targets、等待舊 target 消失，再用 `/json/new` 開唯一 DEV URL tab 並 activate。另在每次 `mcp_tool_call` completed 後排程呼叫 `activateBestExistingTab()`，優先 activate `/testview/edit`，其次 `/testview/home`，讓 Tommy 肉眼看到的 tab 與 Playwright 受控 tab 持續對齊。
- 修改檔案：`agent/src/browser-session.ts`、`agent/src/task-runner.ts`。
- 驗證：`npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run typecheck`、`npm run build` 均通過。OTTEST004 目前仍是舊 Agent process / 舊 dist 已啟動中的 run，應取消後用新 Agent 重跑。
- 後續影響：下一輪 E2E 應特別看三點：(1) run start 後 CDP user page target 只剩單一 Galaxy tab；(2) 點進 edit page 後 Chrome 前景立即跟著切到報表編輯器；(3) 儲存前才出現 Tool Bridge，不應再因看錯 tab 誤判「沒動」。

### 2026-04-29 18:58 - 將 Agent Chrome 改為 run-scoped 並強制單一 user tab

- 背景：只做 tab activate 仍偏軟，若 run 結束後 dedicated Chrome 未關閉，下一輪仍可能從 `~/.uat-agent/chrome-profile` 還原舊 home/edit tabs，造成「Log 有動、前景畫面不同步」的再次發生。
- 決策：把 Agent 管理的 Chrome 視為 run-scoped resource。每次 `task.dispatch` 開始前先關閉既有 dedicated Chrome process，再啟動新 Chrome；每次 run terminal 狀態（completed / failed / cancelled）後關閉 dedicated Chrome。唯一例外是 Tool Bridge waiting 狀態，因 SSO / 授權處理可能需要 Tommy 在同一個 persistent Chrome 中操作，等待期間保留 Chrome；若 waiting 狀態被取消，Agent 收到 `task.cancel` 且沒有 active runner 時也會關閉 Chrome。
- 修改檔案：`agent/src/browser-session.ts`、`agent/src/task-runner.ts`、`agent/src/cli.ts`。
- 技術細節：`closeChromeDebugSession()` 只匹配 `--remote-debugging-port=<port>` 且 `--user-data-dir=<chrome_profile_dir>` 的 dedicated Chrome process，不會關閉 Tommy 日常使用的 Chrome。`ensureSingleUserPageTab()` 會在每個 MCP tool call 後關閉多餘非 `chrome://` user tabs，只保留優先序最高的 `/testview/edit` 或 `/testview/home`。
- 驗證：`npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run typecheck`、`npm run build`、`git diff --check` 均通過。
- 後續影響：下一輪 E2E 除了看畫面是否跟動，也要在 run 完成 / 取消後確認 `ps` 不再有 `--user-data-dir=/Users/tommy/.uat-agent/chrome-profile --remote-debugging-port=9222` 的 Chrome process。

### 2026-04-29 19:06 - 修正 `chrome://newtab/` 殘留與 OTTEST005 污染結論

- 背景：OTTEST005 run `5536c8bc-c472-4a51-9a4a-282f335d847e` 套用 run-scoped Chrome 後，開場已會先關前次 Agent Chrome 並新開 dedicated Chrome；但 CDP target 仍可看到 `chrome://newtab/`，因前一版將所有 `chrome://` 視為內部 target 而不關閉。排查期間手動透過 CDP 關閉 `chrome://newtab/` 造成 page target 消失，該 run 因人工干預視為污染，不能當有效 UAT 結果。
- 決策：把 `chrome://newtab/` 從不可關閉內部 target 中拆出，僅在已經有可保留的 Galaxy / app page target 時才自動關閉；`chrome://omnibox-popup`、`devtools://`、`chrome-extension://` 仍視為不可關閉內部 target。MCP tool call 後的對齊仍以 activate / 關閉多餘 app page 為主，不手動干預 live browser。
- 修改檔案：`agent/src/browser-session.ts`。
- 驗證：`npm run typecheck --prefix agent`、`npm run build --prefix agent` 通過；本機用 dedicated Chrome 做 lifecycle 驗證，啟動後 CDP targets 僅剩 1 個 Galaxy page，加上 omnibox popup internal targets，沒有 `chrome://newtab/`；驗證後 `closeChromeDebugSession()` 成功關閉 Chrome，`127.0.0.1:9222` 不可達。
- 後續影響：下一輪 E2E 應重新從新 run 驗證，不沿用 OTTEST005。觀察點：(1) run 開始後使用者可見頁籤只有 Galaxy；(2) 操作畫面與 log 同步；(3) run cancelled / completed / failed 後 dedicated Chrome 完全關閉；(4) 真正到儲存步驟前才出現 Tool Bridge 授權。

### 2026-04-29 19:36 - Helper-assisted UAT V1 execution layer

- 背景：繼續讓 Codex click-by-click 直接操作 MCP，仍會遇到 locator 探索慢、MCP safety layer 擋可逆 click、UI 重畫 ref 失效、console/network/chart evidence 分散等問題。Tommy 決定改為 helper-assisted UAT：Mac Agent helper 做穩定 UI 操作與 evidence 收集，Codex 做判斷與結果撰寫。
- 決策：新增 `helper-execution-plan` run packet。線上派工時，檔案仍先下載到 `~/.uat-agent/runs/<runId>/input/` 作地端備份；Agent 產生 `current-case-pack` 後，同步產生 `input/helper-execution-plan.json` / `.md`，列出單題 helper actions、required evidence、artifact root、Tool Bridge flags 與安全邊界。helper `status=ok` 只代表該 UI 操作完成並有 evidence，不代表 PASS。
- 修改檔案：`agent/src/helper-execution-plan.ts`、`agent/src/bi-ui-helper-executor.ts`、`agent/src/task-runner.ts`、`agent/src/reference-index.ts`、`agent/src/rule-index.ts`、`scripts/verify-helper-hints-fixture.ts`。
- 技術細節：新增 helper executor CLI `agent/dist/bi-ui-helper-executor.js`，走 Agent dedicated Chrome CDP，不直接打 BI API、不用內部 JS setter、不寫 result.xlsx、不判 PASS/FAIL。V1 已實作 `collage.openProject`、`collage.createReport`、`collage.configureMetric`（欄位輔助 + dateRange warning）、`collage.runPreviewAndCollectEvidence`、`collage.saveReport` 的 Tool Bridge gate；`reopen/delete/filter/group` 已註冊為模板，未完成的會回 `not_implemented` 或 `requires_approval`，不會靜默誤判。
- 驗證：`npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run typecheck`、`npm run build`、`npm run verify:helper-hints`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate` 已通過。手動 helper executor smoke：連續執行 `collage.openProject` → `collage.createReport` 成功進入 `報表編輯器` 並產生 DOM evidence + screenshot；`collage.saveReport` 未帶 approval 時回 `requires_approval`，沒有執行儲存；結束後 dedicated Chrome 關閉。
- 後續影響：下一輪 E2E 應觀察 Codex 是否讀 `helper-execution-plan` 並使用 helper report 作 evidence。V1 不是全模板完成版；下一步 P1 是完成 `collage.configureMetric` 的靜態日期 UI 設定、`collage.reopenReport`、`collage.deleteTemporaryReport`、`filter.addAndPreview`、`group.addAndPreview` 的可執行實作，並把 helper report evidence key 納入 result/evidence gate 精準檢查。

### 2026-04-29 20:18 - Run Log / Events 改為增量載入與頁籤檢視

- 背景：Tommy 試跑時發現線上工具「即時執行 Log / Events」只顯示 200 筆，長 run 很快看不到後續。檢查後確認 server `/api/runs/:id/logs`、`/events` 預設 `limit=200`；前端每次 polling 都重抓同一批資料並覆蓋 state，導致超過上限後新資料不再可見。
- 決策：把 run activity 改成可分頁 / 增量載入。後端 `/logs` 補 `after_id`、`hasMore`、`total`、`nextAfterId`，`/events` 也回同一組 pagination metadata；前端預設每批 500 筆，保留已載入資料並用最後一筆 id 往後追。UI 改成 `Timeline / Logs / Events` 三個頁籤，並提供「載入下一批」按鈕，避免混合視圖在長 run 中難以定位。
- 修改檔案：`src/runs.ts`、`web/src/App.tsx`、`web/src/App.css`。
- 驗證：`npm run typecheck`、`npm run build`、`npm run build --prefix web`、`npm run build --prefix agent` 均通過。
- 後續影響：這次只修可觀測性，不改 UAT 執行策略。速度問題仍存在，下一步應聚焦 helper V1 補齊可執行模板，降低 Codex 逐步讀規則、找 locator、等待 MCP 回合的時間；特別是 `configureMetric` 日期設定、`reopenReport`、`deleteTemporaryReport`、`filter.addAndPreview`、`group.addAndPreview`。

### 2026-04-29 23:00 - 加入 timing summary、低 reasoning 與 safe helper pre-run

- 背景：Tommy 回報畫面已會動但速度更慢，若直接重跑只能靠肉眼猜慢點。檢查後發現現有 `run.phase` 只能看大段流程，缺 Codex item / MCP tool call / helper action 的細粒度耗時；同時 Mac Agent 仍吃 Tommy 全域 Codex 設定 `model_reasoning_effort=xhigh`，對 UI 執行回合過重。
- 決策：先做低風險量測與保守加速。Agent 每個 run 產出 `output/timing-summary.json`，記錄 agent phase、Codex turn、Codex command execution、Codex MCP tool call、helper action 的 startedAt / endedAt / durationMs；helper executor report 也新增 duration。CodexRunner 預設覆蓋 `model_reasoning_effort=low`，可用 `UAT_AGENT_CODEX_REASONING_EFFORT=medium|high|xhigh` 覆蓋。Codex 啟動前先執行 helper-execution-plan 中 `requiresToolBridge=false` 且非 optional 的 safe actions，產出 `output/helper-pre-run-summary.json` 與 `output/helper-artifacts/<case>/helper-report.jsonl`；Codex prompt 明確要求先讀 helper report，避免重複已完成 UI 步驟。
- 安全邊界：helper pre-run 不寫 `result.xlsx`、不判 PASS/FAIL、不跑多 case、不直接打 BI API、不用內部 JS setter；`saveReport`、delete、overwrite、native confirm 等需要 Tool Bridge 的 action 不自動執行。若 helper 回報 `DATE_RANGE_UI_SETTING_NOT_FULLY_AUTOMATED_V1` 這類 warning，pre-run 會停止後續 action，讓 Codex 接手補齊狀態，不會用錯日期直接 preview。
- 修改檔案：`agent/src/timing.ts`、`agent/src/helper-pre-runner.ts`、`agent/src/codex-runner.ts`、`agent/src/task-runner.ts`、`agent/src/bi-ui-helper-executor.ts`、`agent/src/helper-execution-plan.ts`、`agent/src/config.ts`、`agent/src/types.ts`、`agent/src/cli.ts`、`scripts/verify-agent-resume.ts`。
- 驗證：本階段先跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:agent-resume`、`npm run verify:helper-hints`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate`。下一輪 E2E 重點看 `timing-summary.json` 是否能明確指出耗時在 helper、Codex command、MCP tool call、artifact upload 或 Tool Bridge 等哪一段。
- 後續影響：下一輪 E2E 後，應用 `timing-summary.json` 決定下一個優化點。若耗時仍在 Codex 規則讀取，繼續縮 prompt / rule index；若耗時在 helper action，優化 selector / wait strategy；若耗時在 MCP tool call，將該 action 下沉到 helper executor；若耗時在 upload/log polling，再優化 artifact pipeline。

### 2026-04-30 05:24 - 確認 Railway production 已部署加速版本

- 背景：`86f321c feat: add UAT timing and helper pre-run` 已推到 `refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp` 後，初次查 `/version` 時 Railway 仍停在 `f47d094`；Tommy 要求推 Railway。
- 決策：本機沒有 `railway` CLI，因此用 production `/version`、`/health` 與 Git remote branch 指向做部署確認。這次 Railway auto deploy 已自行追到最新 commit，不需手動 redeploy。
- 修改檔案：本文件補記部署確認。
- 驗證：`origin/refactor/mac-agent-mvp` 與 `origin/codex/uat-tool-mvp` 皆指向 `86f321cc26ee393a2bdefa18aa89f8ea1d321840`；Railway `/version` 回 `shortCommitSha=86f321c`、`branch=codex/uat-tool-mvp`、`deploymentId=969a406d-22da-4614-926b-34700f8c45b7`；Railway `/health` 為 healthy。
- 後續影響：下一輪 E2E 可直接使用 production `86f321c` 與本機已重啟的 Mac Agent。觀察重點仍是 `output/timing-summary.json` 與 `output/helper-pre-run-summary.json`。

### 2026-04-30 05:52 - 補 Helper actionability 紅線與 artifact 清理

- 背景：Claude 追問 Helper 所在層級、evidence policy 與是否可能踩到「不可用內部 JS setter / 繞 UI」紅線。Tommy 接受三個答覆，並要求兩個立即補強：短期清掉非本題 helper artifacts；立刻移除 helper `force: true` click。
- 決策：M2 前補正式 `agent-skills/uat-tool/rules/helper-protocol.md`，系統化定義 Helper protocol、職責邊界、hard rules、`helper-execution-plan` / `helper-pre-run-summary` / `helper-report` 契約；M2 再把 BI domain helper templates 搬到 `domains/BI/helpers/`，並把 helper artifact timestamp / caseId / action 驗證納入 hard gate。M0/M1 不搬架構。
- 本次修改：helper plan safety 新增「不可使用 `force: true` 或繞過 browser actionability check」；`bi-ui-helper-executor` 移除 `clickByText()` 的 `force: true` fallback，點不到或 actionability 失敗改回 `blocked` report 並留下 reason / DOM / screenshot；Agent 在產生 current-case helper plan 前，會把 `output/helper-artifacts/` 中非 current case 的 artifact 與不符 current case 的 `helper-pre-run-summary.json` 移到 `output/helper-artifacts-archive/<timestamp>/`，避免 Codex 誤讀上題殘留。
- 後續影響：Helper 仍只可收集 current-run evidence，不可判 PASS/FAIL、不寫 `result.xlsx`、不跑多題、不直接打 BI API、不用內部 JS setter。下一版 result evidence gate 需進一步解析 helper report 的 `caseId` / `action` / `startedAt` / `endedAt`，不能只靠 detail_json 文字命中 current-run evidence 關鍵字。

### 2026-04-30 06:02 - 補 Codex 文件更新與 Git 推送紀律

- 背景：Tommy 指出「只要調文件都要更新日誌」本來就是既有要求，但前面 Helper 新元件雖有 planning log，沒有同步補正式規格 / protocol，也曾發生文件先留在本機未即時推 Git，造成跨 session 交接風險。
- 決策：後續 Codex 修改 uat-tool 時，必須把「文件更新、commit/push、deployment branch」狀態當成交付物的一部分回報，不可只說程式已改。
- 執行紀律：
  - 任何工具流程、Mac Agent、Helper、Tool Bridge、run packet、rule index、current-case-pack、evidence gate、result pipeline、部署分支或 production 架構調整，都必須同步更新本 planning log。
  - 架構級新元件或跨 M 版本會沿用的 protocol，不只寫 planning log，也必須補正式 spec / protocol 文件，或至少在本 planning log 明確列入具體待辦、目標路徑與版本點。
  - 程式變更必須在 typecheck/build/相關 verify 通過後立刻 commit/push；若尚未驗證，回報必須明講「尚未 commit/push」。
  - 文件-only 變更也要 commit 並推 `refactor/mac-agent-mvp`；是否同步推 `codex/uat-tool-mvp` 要明確說明。預設不為純文件更新觸發 Railway redeploy，除非該文件是 production runtime 會讀取的契約或 Tommy 明確要求。
  - 需要上線的程式 / runtime 行為變更，必須同步推 `codex/uat-tool-mvp`，並用 `/version`、`/health` 或 Railway deployment 狀態確認 production 是否真的更新。
  - 每次收尾回報必須列清楚：commit hash、已 push 分支、production commit/deployment 是否更新、本機 Mac Agent 是否需要或已完成重啟。
- 後續影響：這條是 Codex 自身工作紀律，避免未來只把規則留在對話裡，造成 compact / 新 session 後遺忘。

### 2026-04-30 06:18 - DEMO001 locator registry 與 diagnostic mode 規格

- 背景：Tommy 與 Claude 採納速度優化 review，決定三件事並行：Tommy 跑 DEMO001 baseline；Codex 先做 DEMO001 會用到的 BI locator registry；Codex 補 diagnostic mode 規格。Claude 也補充：未來 helper 合併成大 action 時，helper internal 仍需逐 action log + artifact，保留中間步驟可見度。
- 決策：locator registry 先放 BI Domain Pack，不放 Layer 1；Layer 1 只定 locator/diagnostic 的安全邊界。`domain-packs/BI/locators/demo001-locator-registry.json` 先收 15 個 DEMO001 draft locators，全部是 Playwright visible UI locator hints，不含 direct API、internal JS setter 或 `force: true`。runtime 派工時若該 domain pack 有 registry，Railway 會把 `domain_locator_registry` 加進 input URLs，Agent 下載為 `input/domain_locator_registry.json`，並在 run brief / prompt / reference index / rule-index 中列出。它是 guidance，不是 result evidence；locator 失敗要 fallback visible UI 並寫 drift。
- Diagnostic mode：新增正式 spec `docs/refactor/UAT_Tool_Diagnostic_Mode_Spec_v0_1.md` 與 Layer 1 rule `agent-skills/uat-tool/rules/diagnostic-mode.md`。v0.1 僅定義非可信快速迭代模式：可跑單題部分 steps、產 `diagnostic-summary.json` / timing / helper artifacts / drift log，但不可寫可信 `output/result.xlsx`、不可更新 PASS/FAIL/BLOCKED、不可把 partial evidence promoted 成 trusted result。
- 修改檔案：`domain-packs/BI/locators/demo001-locator-registry.json`、`domain-packs/BI/locators/README.md`、`domain-packs/BI/AGENTS.md`、`src/domain-loader.ts`、`src/domains.ts`、`src/runs.ts`、`agent/src/task-runner.ts`、`agent/src/reference-index.ts`、`agent/src/rule-index.ts`、`agent-skills/uat-tool/SKILL.md`、`agent-skills/uat-tool/rules/diagnostic-mode.md`、`docs/refactor/UAT_Tool_Diagnostic_Mode_Spec_v0_1.md`。
- 後續影響：selector-map vs persistent helper session 的優先順序仍等 DEMO001 baseline `timing-summary.json` 判斷。若 selector drift 很重，優先強化 locator registry 與 drift review；若 helper spawn / MCP tool call 佔比高，再優先做 persistent helper session 或合併 helper action。

### 2026-04-30 06:44 - 修正 OTTEST007 result.xlsx ingest header/gate 失敗

- 背景：OTTEST007 run `fe9cc0da-f065-4bbe-9f68-0f6a15865a4a` 實際已完成 DEMO-A-01 並產出 `output/result.xlsx`，但 Agent 上傳時 Railway 回 `RESULT_XLSX_HEADER_MISSING:relatedCaseNo`，run 被標 failed。檢查實際 workbook 後確認 Codex 依舊模板產出 Bug sheet header `來源 Case` 且缺 `狀態`，但 server parser 只接受 `關聯編號 / related_case_no` 並硬要求 `狀態` header。
- 決策：parser 對既有舊模板保持相容，避免已產生或舊 session 的 workbook 因欄名漂移無法讀；同時把 Agent 產出的 result template 改成 server 正式欄名。`Bug` sheet 新契約為 `嚴重度, Bug ID, 關聯編號, 標題, 描述, 建議, 狀態`，`Evidence` 只能當額外欄位，不可取代 `狀態`。
- 本次修改：`src/result-parser/result-xlsx-parser.ts` 對 `relatedCaseNo` 新增 `來源 Case / 來源Case / source case / relatedCaseNo` alias，且缺 `狀態` header 時預設 bug status=`OPEN`；`schemaVersion` 讀取改為掃描 `索引` sheet 的 `schemaVersion/schema_version` row，不再把 `欄位/值` 的 `值` 誤當 schema。`agent/src/result-template.ts` 改用正式 Bug headers，並在 template index 補 PASS/FAIL/BLOCKED/PARTIAL detail_json 必填欄位；`agent/src/task-runner.ts` 與 `agent-skills/uat-tool/rules/artifacts-and-results.md` 補 result workbook contract，明確 FAIL 必填 `錯誤原因 / 根因層級 / 驗證方法 / RD 分派`。
- 額外發現：修掉 header 後，OTTEST007 實際 workbook 仍會被 result evidence gate 擋下，因 DEMO-A-01 是 FAIL 但 detail_json 少了 `錯誤原因 / 根因層級 / 驗證方法 / RD 分派`。這些欄位是既有硬規則，不放寬 gate；改由 prompt/template/rule 直接提示 Codex 寫入，降低下一輪漏欄位風險。
- 驗證：`npm run typecheck`、`npm run typecheck --prefix agent`、`npm run build`、`npm run build --prefix agent`、`npm run verify:result-evidence-gate`、`npm run verify:helper-hints`、`npm run verify:agent-resume`、`npm run verify:package-consistency`、`npm run verify:agent-roundtrip` 均通過。已用新的 parser 直接讀取 OTTEST007 本機 `output/result.xlsx`，確認舊 `來源 Case` header 可解析、bug status 可 fallback 為 `OPEN`。
- 補救結果：production 更新到 `cd7de39` 後，將 OTTEST007 本機 `output/result.xlsx` 另存為 `output/result-patched-for-reupload.xlsx`，只補齊 FAIL 必填 `detail_json` 欄位與 `schemaVersion`，不改變 DEMO-A-01 的 FAIL 結論或 evidence。patched workbook 本機 evidence gate 為 `ok`，重新上傳 production 成功，server 回 201、`resultEvidenceGate.status=ok`、`cases=1`、`bugs=1`。線上 run 仍為 `FAILED` 是因為 case 結果為 FAIL，不是 ingest pipeline 失敗。
- 後續影響：下一輪正式 run 若 DEMO-A-01 仍判 FAIL，Codex 需產出完整 FAIL detail_json，否則 server 會以 `RESULT_EVIDENCE_GATE_FAILED` 擋下。這是正確行為；不應為了讓上傳成功而降低 FAIL result 品質。

### 2026-04-30 07:36 - OTTEST008 前速度與穩定性止血

- 背景：Claude 依 OTTEST007 timing 指出三個必修：Helper pre-run 成功但 Codex turn 內 helper 回 `CHROME_CDP_UNAVAILABLE`、連續 native dialog 造成約 100 秒 timeout、result.xlsx header/detail_json 契約需規格化。Tommy 採納 Codex 建議，先做不換架構的 runtime 穩定化，目標 OTTEST008 壓到 8-9 分鐘且 ingest 不再失敗。
- Native dialog：run brief、Codex prompt 與 Layer 1 `tool-bridge.md` 新增 consecutive native dialog guard。同一 save/delete/overwrite flow 中，第一個 native alert/confirm 已處理後，若偵測或合理推定有第二個 native dialog，不再嘗試 Playwright accept/dismiss，也不做 repeated snapshot/read_page；立即 emit `playwright_recovery`，讓 Tommy 在 persistent Chrome 手動處理。目的為避免 OTTEST007 類似的 dialog-chain timeout。
- Helper pre-run：修正 `safeActions()`，只執行 helper plan 中「第一個 requiresToolBridge/optional action 之前」的連續 safe actions，避免 save 需要授權時卻跳過 H5 直接跑 H6 reopen。`collage.configureMetric` 改為嘗試透過 visible UI 設定靜態日期；日期設定成功才回 `ok` 並讓 H4 preview helper 繼續，設定失敗則回 `blocked` + warning，讓 Codex 接手，不會用錯日期 preview。Helper CDP unavailable 時會寫 helper report，包含 endpoint、CDP availability、dedicated Chrome pid、targets、profile dir、debug port 等診斷，不再只在 Codex log 留一句錯誤。
- Result contract：`domain-packs/BI/result_parser_adapter.json` 補 `schemaVersion`、case/bug headers、optional Bug `Evidence` 欄、PASS/FAIL/BLOCKED/PARTIAL detail_json required fields。Agent `result-template.xlsx` 改由 adapter 產生 headers 與 required-field 說明。Agent 在上傳 real Codex `output/result.xlsx` 前先跑 `result-xlsx-self-check.json`，檢查 sheets、headers 與 status 對應 detail_json 必填欄位；失敗時擋在本機，不再等 server ingest reject。server parser 暫時保留 legacy alias 相容，strict multi-version adapter 留到 M2。
- 修改檔案：`agent/src/browser-session.ts`、`agent/src/bi-ui-helper-executor.ts`、`agent/src/helper-pre-runner.ts`、`agent/src/result-contract.ts`、`agent/src/result-template.ts`、`agent/src/task-runner.ts`、`agent-skills/uat-tool/rules/tool-bridge.md`、`domain-packs/BI/result_parser_adapter.json`、`scripts/verify-agent-result-contract.ts`、`package.json`、本 planning log。
- 驗證：`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:agent-result-contract`、`npm run verify:helper-hints`、`npm run verify:result-evidence-gate`、`npm run verify:agent-resume`、`npm run verify:package-consistency`、`npm run verify:tool-bridge`、`npm run verify:agent-roundtrip`、`git diff --check` 已通過。
- 後續影響：OTTEST008 觀察點：(1) helper pre-run 是否跑到 H4 preview；(2) 若 save 後連續 dialog 再出現，是否 5-10 秒內直接 Tool Bridge recovery；(3) 若 Codex 寫壞 result.xlsx，是否被 Agent self-check 擋下並明確顯示欄位/缺欄位，而不是 server 400/422。

### 2026-04-30 08:09 - 修正多 case run 第一題後即結束

- 背景：OTTEST008 run `fb9a9702-c2b8-463e-8d66-cdb2877d092b` 匯入 `importedCases=4`，但 Agent run packet 只固定 `currentCaseNo=DEMO-A-01`；Codex 完成 DEMO-A-01 並上傳單題 `result.xlsx` 後，Agent 直接送 `run.completed`。同時 server ingest 依單題結果把 run 標成 `FAILED`，即使 B/C/D 仍是 `PENDING`，所以畫面呈現「跑完第一個就結束」。
- 決策：維持 one-case-at-a-time hard gate，不改成一個 workbook 批次寫多題。改由 Mac Agent 做逐題 orchestration：每題仍是獨立 current-case pack、獨立 Codex turn、獨立 `output/result.xlsx` 上傳；完成一題後才切下一題。
- 本次修改：Agent 新增 `output/agent-case-progress.json`，記錄本 run 起始 case、已完成 case 與每題 result/log artifact；每次成功上傳後清掉上一題 `output/result.xlsx` 與 self-check/tool-request 暫存，重新產生下一題 `case-manifest/current-case-pack/run-state/helper-execution-plan/run-brief`，封存非本題 helper artifacts，重置 dedicated Chrome，再跑下一題 safe helper pre-run 與 Codex turn。Tool Bridge pause/resume 後也會依 `state.current_case_no` 或 `generated-guides.json` 回到正確 case，完成後繼續後續 case。
- Server ingest：`ingestResultXlsx()` 改為依整個 run 的 `run_cases` 狀態決定 run status。只要仍有 `PENDING/MANUAL_PENDING`，result ingest 回 `RUNNING`，不因目前單題 `FAIL/BLOCKED/PARTIAL` 提前終結；全部 case 都有結果後，才依是否全為 pass-like (`PASS/MANUAL_PASS/SKIPPED`) 決定 `SUCCEEDED` 或 `FAILED`。Bug ingest 也從「每次刪全 run bugs」改為只替換本次 result 相關 case 的 bug，避免第二題上傳時清掉第一題 bug。
- 安全邊界：server result evidence gate 仍 `requireSingleCase=true`，所以 Codex 不能一次交多題 result workbook；Agent 只是自動切換下一個 current case。若 Codex 嘗試把多題塞進同一份 `result.xlsx`，仍會被 gate 擋下。
- 修改檔案：`agent/src/task-runner.ts`、`src/runs.ts`、本 planning log。
- 驗證：`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:agent-resume`、`npm run verify:agent-result-contract`、`npm run verify:tool-bridge`、`npm run verify:helper-hints`、`npm run verify:result-evidence-gate`、`npm run verify:package-consistency`、`npm run verify:agent-roundtrip`、`git diff --check` 已通過。runtime 修正 commit `fe1a117` 已推 `refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp`；後續 documentation-only commit 不影響 runtime。Railway `/version` 已部署到包含該 runtime 修正的 commit，`/health` healthy；本機 `com.tommy.uat-agent` 已重啟，pid `32063`。
- 後續影響：下一輪 OTTEST008/OTTEST009 應看到 DEMO-A-01 上傳後 run 仍維持 `RUNNING`，並出現「切換到下一個 Case」phase；若下一題再次需要授權，Tool Bridge 仍只針對該題停下，不會把前一題授權 carry over。

### 2026-04-30 09:27 - 結構調整：capability gate、save/reopen helper、PM review flow、Codex model

- 背景：OTTEST009 取消後，Tommy 與 Claude/Codex 重新評估線上工具現況。核心問題不是單一 timeout，而是工具會把未支援的 filter/group/detail/metric case fallback 到慢且不穩的 Codex UI 探索；DEMO-A-01 在 OTTEST007 能走到 reopen evidence 判 FAIL，但 OTTEST008/009 卡在 save 後 native dialog/CDP 恢復，導致只能 BLOCKED；同時需要把 Agent Codex model 統一改成 GPT 5.3 Codex。
- Capability gate：新增 `agent/src/capability-gate.ts`，每個 current case 產生 `input/capability-gate.json/md`，分類為 `supported / degraded / unsupported`。record/detail、metric、filter、group 目前會被標為 `unsupported`，Codex 指令為不可執行 trusted browser testcase steps，需寫 `BLOCKED / UNSUPPORTED_ONLINE_CAPABILITY`；metadata/dropdown 類降級為 `codex_visible_ui` 並停用 helper pre-run。`helper-pre-runner` 會讀 capability gate，`helperPreRunAllowed=false` 時直接 skipped，避免 DEMO-B-01 類 `欄位=空` 仍浪費 20 秒、DEMO-C-01 明細 case 被錯派 collage helper。
- Helper save/reopen：`bi-ui-helper-executor` 補 `collage.saveReport` 的 visible UI 報表名填寫、第一個 native dialog 處理、saved report state artifact；若偵測到第二個 native dialog，立即回 `requires_approval` 並附 `playwright_recovery` request，不再等 Playwright timeout。`collage.reopenReport` 從 saved report state 或 params 取 reportName，回列表尋找並重開該報表，收集 reopened DOM/screenshot evidence。filter/group helper 改為明確 `not_implemented`，不再誤導為需授權後可跑。
- PM review flow：server 新增 `POST /api/runs/:id/pm-review`，可對任一 case 寫入 `MANUAL_PASS / MANUAL_FAIL / MANUAL_BLOCKED`，保留 `Codex建議判定`、`PM最終判定`、複核者、時間與備註；UI 在 case detail 增加 PM 最終判定區。這讓工具產出與 PM 最終交付分層，不把 `BLOCKED` 混同為沒抓到。
- Codex model：Agent config 新增 `codex_model`，預設 `gpt-5.3-codex`，可用 `UAT_AGENT_CODEX_MODEL` 覆蓋；`CodexRunner` 啟動/續跑都會傳 `-m <model>`，progress 也會顯示 model + reasoning。既有 config 沒有 `codex_model` 時會自動套預設，不需手動改 `~/.uat-agent/config.json`。
- 修改檔案：`agent/src/capability-gate.ts`、`agent/src/helper-pre-runner.ts`、`agent/src/helper-execution-plan.ts`、`agent/src/bi-ui-helper-executor.ts`、`agent/src/codex-runner.ts`、`agent/src/config.ts`、`agent/src/types.ts`、`agent/src/cli.ts`、`agent/src/rule-index.ts`、`agent/src/task-runner.ts`、`src/runs.ts`、`web/src/App.tsx`、`web/src/App.css`、`scripts/verify-agent-resume.ts`、`scripts/verify-helper-hints-fixture.ts`、本 planning log。
- 驗證：`npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run typecheck`、`npm run build`、`npm run build --prefix web`、`npm run verify:agent-resume`、`npm run verify:helper-hints`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:package-consistency`、`npm run verify:tool-bridge`、`npm run verify:agent-roundtrip`、`git diff --check` 已通過。
- 後續影響：下一輪不應再把 filter/group/detail/metric case 當 trusted online helper run 硬跑；DEMO-A-01 的重點變成 helper/Tool Bridge 能否穩定完成 save 後回列表與 reopen evidence，而不是讓 Codex 在 CDP wedged 狀態下判斷。PM review 可先用於 BLOCKED/灰區結果的最終交付收尾。

### 2026-04-30 09:47 - 預備調整：Mac Agent 自動授權非 SSO/login Tool Bridge request

- 背景：Tommy 明確要求「除了 SSO / login，其他要授權的由 Mac Agent 直接回覆授權」。目標是減少每次 save/native dialog/recovery/ambiguity 都停下等待 PM 點按，讓線上 run 更接近本機連續執行節奏。
- 預計調整：Agent 解析 Codex `TOOL_REQUEST` 後，若 request 文字未命中 SSO/login/auth blocker，直接產生 `approved=true` 的 auto Tool Bridge response 並 resume 同一個 Codex thread；SSO/login 相關 `playwright_recovery` 仍維持 `WAITING_APPROVAL`，由 PM 手動處理。auto response 需寫入 run log/event/state，並在 Codex resume prompt 內標明 `auto_approved_by=mac_agent`，讓 result evidence gate 能辨識這是本 run 的 Tool Bridge response。
- 回滾方式：若此調整造成誤刪、誤覆蓋、native dialog 卡死或 Codex 反覆 auto-resume，回滾到手動授權模式時需移除/停用 Agent 的 auto Tool Bridge response 分流，讓 `processCodexTurnAfterExit()` 對所有 actionable request 一律走原本 `run.tool_request` + `waiting_user`；同時移除 server 對 auto approval 的 approvals 狀態自動結案邏輯，並將 prompt/log 文案改回「只有 PM Tool Bridge response 算授權」。若要快速 hotfix，可先用環境變數關閉 auto policy（預計實作為 `UAT_AGENT_AUTO_APPROVE_TOOL_REQUESTS=false`）。
- 本次修改：Agent config 新增 `auto_approve_tool_requests`，預設 true，可用 `UAT_AGENT_AUTO_APPROVE_TOOL_REQUESTS=false` 關閉。`processCodexTurnAfterExit()` 會把 actionable Tool Request 分成 auto/manual：非 SSO/login/auth 直接送 `run.tool_request` audit + `tool_response.delivered`，再用 auto response prompt resume 同一 thread；SSO/login/auth 仍進原本 waiting_user。auto resume 設 5 次上限，避免 Codex 反覆輸出同類 request 無限循環。server `agent-run-events` 對帶 `auto_approval` 的 request 直接寫 approvals `APPROVED`，不留下 pending approval。
- 修改檔案：`agent/src/task-runner.ts`、`agent/src/config.ts`、`agent/src/types.ts`、`agent/src/cli.ts`、`agent/src/bi-ui-helper-guidance.ts`、`agent/src/helper-execution-plan.ts`、`src/agent/agent-run-events.ts`、`scripts/verify-agent-roundtrip.ts`、本 planning log。
- 驗證：`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:tool-bridge`、`npm run verify:result-evidence-gate`、`npm run verify:agent-roundtrip`、`npm run verify:agent-resume`、`npm run verify:helper-hints`、`npm run verify:agent-result-contract`、`npm run verify:package-consistency`、`git diff --check` 已通過。`verify:agent-roundtrip` 新增 auto-approved request fixture，確認 auto approval 不留下 pending approval，且 approvals audit row 為 `APPROVED / mac_agent_auto_policy`。
- 後續影響：下一輪 run 中，save/native dialog/irreversible/ambiguity 類 Tool Request 不應再停畫面等 PM 點按；真正 SSO/login/auth blocker 仍會停下。若線上觀察到誤操作或反覆 auto-resume，先在本機 Agent 環境設 `UAT_AGENT_AUTO_APPROVE_TOOL_REQUESTS=false` 並重啟 `com.tommy.uat-agent`，再回滾 runtime commit。
