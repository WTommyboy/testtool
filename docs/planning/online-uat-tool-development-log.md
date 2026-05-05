# 線上 UAT Tool 開發與規劃日誌

最後更新：2026-05-03

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

### 2026-04-30 11:35 - 修正 auto approval 競態、上傳 timing/diagnostic artifacts、補 diagnostic runtime

- 背景：重新讀取整個線上工具後，標出三個立即調整點：(1) auto-approved Tool Request 送到 server 時，`agent-registry` 仍把 Agent 暫時標成 `idle/currentRunId=null`，可能讓 UI/server 在 Codex auto-resume 期間誤派新 run；(2) `timing-summary.json` 只留在本機 run workspace，線上 UI 不能直接看瓶頸；(3) Diagnostic mode 只有 spec，尚未形成 runtime 閉環。
- Auto approval 競態：`src/agent/agent-registry.ts` 改為辨識 `run.tool_request.payload.auto_approval.approved=true`。auto-approved request 只寫 audit / approval record，不切 idle；`tool_response.delivered` 若帶 `auto_approved_by=mac_agent` 或 `auto_approval_policy`，維持 Agent `busy/currentRunId`。手動 SSO/login request 仍保留原本 idle/waiting 行為。
- Artifacts 管線：server 新增 `runs.timing_summary_path/timing_summary_uploaded_at/diagnostic_summary_path/diagnostic_summary_uploaded_at`，並新增 `POST/GET /api/runs/:id/output/timing-summary` 與 `POST/GET /api/runs/:id/output/diagnostic-summary`。Agent `finally` 會在 `timing.write()` 後上傳 sidecar artifacts；frontend 在 run detail 顯示「診斷與耗時」卡，列出 top timing buckets 與 diagnostic summary。
- Diagnostic runtime：`execution_mode` 新增 `diagnostic`。Agent capability 宣告支援 `interactive, diagnostic`；diagnostic run 仍會下載 input、產 current-case pack / capability gate / helper execution plan、開 dedicated Chrome、跑 safe helper pre-run，但不啟動 Codex trusted result generation、不寫 `output/result.xlsx`、不更新 PASS/FAIL/BLOCKED。Agent 只產 `output/diagnostic-summary.json`、`output/timing-summary.json`、`output/agent.log` 並上傳。server result evidence gate 新增 `resultSource=diagnostic` 直接拒絕，防止 diagnostic artifact 被當可信結果 ingest。
- 修改檔案：`src/agent/agent-registry.ts`、`src/db.ts`、`src/runs.ts`、`src/server.ts`、`src/result-parser/result-evidence-gate.ts`、`agent/src/doctor.ts`、`agent/src/task-runner.ts`、`web/src/App.tsx`、`web/src/App.css`、`scripts/verify-agent-roundtrip.ts`、`scripts/verify-result-evidence-gate.ts`、`docs/refactor/UAT_Tool_Diagnostic_Mode_Spec_v0_1.md`、`docs/refactor/M1_Mac_Agent_MVP_Runbook.md`、本 planning log。
- 驗證：`npm run typecheck`、`npm run typecheck --prefix agent`、`npm run build`、`npm run build --prefix agent`、`npm run build --prefix web`、`npm run verify:result-evidence-gate`、`npm run verify:agent-roundtrip`、`npm run verify:agent-resume`、`npm run verify:agent-result-contract`、`npm run verify:helper-hints`、`npm run verify:package-consistency`、`npm run verify:tool-bridge`、`git diff --check` 已通過。commit/push 與 production 版本確認在收尾回報列出。
- 後續影響：Diagnostic mode 目前是 helper/timing 最小閉環，尚未實作 UI 可選 `fromStep/untilStep` 或由 Codex 執行 partial steps；這兩項留到下一輪。下一輪速度分析可直接從線上 run detail 讀 timing bucket，不必只靠本機檔案。

### 2026-04-30 22:09 - 保守加速：warm Chrome、state delta planner、Helper evidence hard gate

- 背景：Tommy 要求依前面規劃執行下一批速度優化，並先評估不能降低測試品質。本次只加速「固定且可驗證的 UI 操作」，不放寬 evidence gate、Tool Bridge、one-case-at-a-time 或 result contract。
- Warm Chrome：Agent config 新增 `keep_chrome_warm`，預設 true，可用 `UAT_AGENT_KEEP_CHROME_WARM=false` 回滾成原本 run-scoped Chrome。成功完成 run 後保留 dedicated Chrome process / persistent profile，降低下一輪 cold start；每個 run / case 開始仍會 reset 成單一 DEV tab，重新 preflight 與收集 current-run evidence。run failed / cancelled 時會關閉 dedicated Chrome，避免 native dialog 或 blocker 殘留污染下一輪。
- State delta planner：helper plan 會把 current case `cleanupChecklist` 與 parsed cleanup targets 放進 action params。`collage.configureMetric` 現在會輸出 `stateDelta.before/after/checks/operations`，只有 visible UI / DOM state 已驗證對齊時才跳過重複設定；讀不到或對不上就走真實 UI 操作，仍驗證不到則回 `blocked`。日期設定補支援「上月」等 preset：透過 visible UI 點時間控制與 preset，不用內部 JS setter。
- Helper evidence hard gate：helper report 新增 `runId` 與 `evidenceMetadata`，包含 `source=mac-agent-bi-ui-helper`、`runId`、`caseId`、`action`、timestamps、`currentRunEvidence=true`。`helper-pre-runner` 在接受 report 前會檢查 runId / caseId / action / timestamp / helperCanJudgeResult / evidenceMetadata，一項不符就把該 helper action 視為 `error`，Codex 不可引用 stale artifact。
- Helper protocol：新增 `agent-skills/uat-tool/rules/helper-protocol.md`，正式寫下 Layer 1 Helper 職責邊界、hard rules、三份 artifact 契約、current-run evidence gate、state delta planner 與 warm session policy。`SKILL.md`、`rule-index`、run prompt、BI helper guidance、Agent security rule、M1 runbook 都已同步引用。
- 修改檔案：`agent/src/types.ts`、`agent/src/config.ts`、`agent/src/cli.ts`、`agent/src/doctor.ts`、`agent/src/task-runner.ts`、`agent/src/bi-ui-helper-executor.ts`、`agent/src/helper-execution-plan.ts`、`agent/src/helper-pre-runner.ts`、`agent/src/bi-ui-helper-guidance.ts`、`agent/src/rule-index.ts`、`agent-skills/uat-tool/SKILL.md`、`agent-skills/uat-tool/rules/agent-security.md`、`agent-skills/uat-tool/rules/helper-protocol.md`、`docs/refactor/M1_Mac_Agent_MVP_Runbook.md`、`scripts/verify-helper-report-gate.ts`、`package.json`、本 planning log。
- 回滾方式：若 warm Chrome 造成 UI state 或 native dialog 污染，先在本機 Agent 設 `UAT_AGENT_KEEP_CHROME_WARM=false` 並重啟 `com.tommy.uat-agent`；若 helper report gate 擋下過多 action，回查 `HELPER_REPORT_VALIDATION_FAILED:*` 的欄位，不應關掉 evidence gate，而是修 report metadata 或 action artifact。
- 驗證：`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-report-gate`、`npm run verify:helper-hints`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:package-consistency`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 已通過。runtime commit `6c4df8e` 已推 `refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp`，Railway production 已部署到該版本，本機 Agent 已重啟。

### 2026-05-01 00:17 - M2 優化候選：線上 evidence artifact 與系統產品化

- 背景：Tommy 指出截圖只留在本機，對「線上系統」而言不完整。現況可讓本機 Codex/Helper 快速判斷，但線上 run detail 無法完整重現 evidence；若本機 run workspace 清掉，screenshot evidence 也會失效。
- 決策：列入 M2 優先項，不在 M1 立即阻塞 run。M2 應建立 generic evidence artifact pipeline：Agent 先本機收集，run 結束或 case 完成後非同步上傳必要 artifact，detail_json / helper report / case result 改引用 artifact id / URL，不引用 raw local path。
- M2 artifact scope：
  - 上傳優先順序：FAIL/bug、BLOCKED、Tool Bridge/SSO/native dialog、save/reopen/delete major state transition、final evidence。
  - manifest：新增 `output/evidence-artifacts-manifest.json`，記錄 runId、caseId、action、artifactType、localPath、checksum、createdAt、uploadStatus、remoteUrl/artifactId、retentionClass。
  - backend：新增 run artifact table 或 generic artifact endpoints，至少支援 screenshot/helper-report/trace/json；後續可遷到 object storage。
  - frontend：run detail 顯示 artifact list、inline screenshot preview、artifact download，並讓 PM review 可引用 artifact。
  - policy：structured evidence 仍優先，screenshot 不可取代數值/DOM/network；artifact upload failure 不應把已完成的 trusted result 改成 PASS/FAIL，但需留下 upload warning。
- 其他 M2 優化候選：
  - persistent helper worker/session：減少每個 helper action spawn Node/Playwright connect 的成本；仍需逐 action report + artifact。
  - BI domain helper registry：把 BI templates 搬到 domain pack，Layer 1 只保留 protocol/hard rules。
  - locator drift loop：收集 failed locator、DOM excerpt、screenshot、action template，產出 drift report 給 locator registry 更新。
  - diagnostic partial steps：UI 支援 fromStep/untilStep；仍不可 promote 成 trusted result。
  - helper-aware evidence gate：server 解析 helper report metadata/artifact ids，而不是只靠 detail_json 關鍵字。
  - failure taxonomy dashboard：統計 selector drift、preview no request、SSO/login、tool timeout、unsupported capability、result contract failure。
  - crash-safe resume：Agent reconnect 的 `run_snapshot` 從診斷升級為可恢復的 resume/dispatched state。
  - capability roadmap：filter/group/detail/metric 在 helper 覆蓋前繼續走 unsupported/degraded gate，不再硬跑。
  - storage/retention/privacy：規劃 screenshot redaction、quota、90 天後壓縮或移到 object storage。
  - PM review/product UI：run detail 更清楚呈現 Codex 建議判定、PM final decision、evidence artifact、timing bottleneck。
- 優先順序建議：M2 先做 (1) evidence artifact pipeline，(2) persistent helper worker + BI helper coverage，(3) locator drift + diagnostic partial steps。這三個同時改善線上可信度、速度與失敗診斷。
- 安全邊界：M2 不可放寬 one-case-at-a-time、current-run evidence、UI-only state setting、no direct BI API result、Tool Bridge、result evidence gate。加速只能減少固定操作成本，不能跳過判定或 evidence。

### 2026-05-01 01:11 - M2 第一批：generic evidence artifact pipeline 與 diagnostic step range

- 背景：Tommy 要求開始執行 M2 優化。第一批先做不降低測試品質的基礎設施：讓線上 run detail 能看到 evidence artifacts，並讓 diagnostic mode 的 fromStep/untilStep/purpose 不再只停在 spec。
- Evidence artifact pipeline：server 新增 `run_artifacts` table 與 `POST /api/runs/:id/output/artifacts`、`GET /api/runs/:id/artifacts`、`GET /api/runs/:id/artifacts/:artifactId/download`。Mac Agent 在 final sidecar upload 階段掃描 `output/helper-artifacts/**`、`output/helper-artifacts-archive/**`、`output/screenshots/**`、`artifacts/**`、`mcp-output/**`、`output/*.png/jpg/webp`、`output/locator-drift.log/jsonl`、helper summary，產生 `output/evidence-artifacts-manifest.json`，並把每個 artifact 以 generic endpoint 上傳。manifest 記錄 artifactId、runId、caseId、action、type、relativePath、checksum、uploadStatus、remoteArtifactId/remoteUrl。Agent 會等 sidecar/artifact upload 收尾後才清掉 local activeTask，避免 artifact upload 尚未完成時本機誤收下一個 task。
- UI：run summary 增加 artifact count / screenshot count，run detail 的「Artifacts 與診斷」卡顯示 evidence artifact list 與 download link；timing summary / diagnostic summary 仍保留原本呈現。
- Diagnostic partial：Web UI 可在 diagnostic mode 填 `fromStep` / `untilStep` / `purpose`，server 存成 `diagnostic_config_json` 並在 dispatch payload 帶給 Agent。Agent 會把 step range 寫入 `diagnostic-summary.json`，並把 range 外的步驟列為 `not_executed_in_diagnostic` evidence gap。這仍是非可信 diagnostic，不會寫 trusted `result.xlsx`。
- Locator drift：Codex prompt 明確要求 locator drift 寫到 `output/locator-drift.log`；Agent 會解析 `locator-drift.log/jsonl` 放進 diagnostic summary 的 `locatorDrift`，同時把 drift 檔納入 artifact manifest。registry 本身仍不可由 run 自動修改。
- 安全邊界：artifact upload 只增加線上可追溯性，不影響 result evidence gate；artifact upload failure 只留下 warning，不會把 trusted result 改判。Screenshot 仍不可取代 structured evidence。
- 未納入本批：persistent helper worker/session 與 helper-aware result evidence gate 尚未實作。這兩項需要再看下一輪 timing 與 helper coverage，避免為了減少 spawn 成本而引入 session 狀態污染。
- 驗證：`npm run typecheck`、`npm run typecheck --prefix agent`、`npm run build`、`npm run build --prefix agent`、`npm run build --prefix web`、`npm run verify:helper-report-gate`、`npm run verify:helper-hints`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:package-consistency`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 已通過。`verify:agent-roundtrip` 已新增 generic evidence artifact upload/download smoke。

### 2026-05-01 02:54 - 修正 OTTEST002_02 gate regression：TOOL case id、neutral cleanup、package ambiguity auto-approval

- 背景：Tommy 回報 OTTEST002_02「整個改爛」。檢查 run `14dec64c-6dff-47d8-b9b0-2cef9d8cfee8` 後確認，Codex 完全沒有進瀏覽器。原因不是 artifact pipeline 本身，而是前置 gate 組合錯誤：`start-case` parser 不支援 `TOOL-A-01` 這種三段式 case id，反而抓到文件暫停表格中的「繼續 A-02」，造成 `START_CASE_CONFLICT / START_CASE_NOT_IN_XLSX`；同時 capability gate 把 `篩選=不影響 / 分組=不影響` 和「metadata v1.2.5 參考資料」誤判為 active filter/group/metadata dropdown，導致 `TOOL-A-01` 被標成 `UNSUPPORTED_ONLINE_CAPABILITY`。
- Case id 修正：`agent/src/start-case.ts` 支援 `TOOL-A-01` 形式，並優先解析明確 `起始 case:` 標籤；generic `繼續 A-02` 會略過完成/暫停表格列，避免把下一題提示誤當起始 case。`test-package-consistency` 與 `case-manifest` 新增唯一 suffix alias：當 workbook 有唯一 `TOOL-A-02` 時，文件中的 `A-02` 可解析為同一 case，不再產生 unknown/start conflict。
- Capability 修正：新增 `agent/src/case-feature-detection.ts`，把 `篩選=不影響 / 分組=不影響 / 不限 / 空 / 0組 / none` 視為 neutral cleanup，不再觸發 unsupported filter/group gate；`metadata` 只有在明確 metadata dropdown/欄位清單比對語境才算 metadata dropdown case。對 OTTEST002_02 的實際 input 重算後，`TOOL-A-01` 會變成 `supportStatus=supported`，helper plan 會產生 `collage.openProject/createReport/configureMetric/runPreviewAndCollectEvidence/saveReport/reopenReport`。
- Auto approval 修正：非 SSO/login authorization request 仍依 Tommy 要求自動授權；但 package-gate ambiguity decision（testcase/start-case/document/capability gate 衝突）不再 auto-approve。這類不是「授權 native dialog」而是「測試包/起始 case 判斷」，若再出現必須停下給 PM 決定，不可由 Mac Agent 自行採 recommendation。
- 回歸測試：`scripts/verify-package-consistency-fixture.ts` 新增 TOOL-prefixed fixture，驗證暫停表格中的 `繼續 A-02` 不會造成 start conflict，且可唯一對應 `TOOL-A-02`。新增 `npm run verify:capability-gate`，覆蓋 neutral cleanup 不觸發 unsupported、metadata 參考資料不觸發 metadata dropdown、真正 active filter 仍維持 unsupported。
- 驗證：`npm run verify:package-consistency`、`npm run verify:capability-gate`、`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-report-gate`、`npm run verify:helper-hints`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip` 已通過。另用 OTTEST002_02 實際 run workspace 重算，確認 startHint=`TOOL-A-01`、document/consistency 無 error、capability supported、helper actions 六項齊全。

### 2026-05-01 04:18 - 修正 OTTEST002_03：雙月曆日期 Helper、受限 MCP 誤判、BLOCKED evidence 補強

- 背景：OTTEST002_03 已通過 package/capability gate，但 helper pre-run 在 `collage.configureMetric` 卡住：日期面板不是 date/text input，而是左右兩個月曆，因此舊邏輯回 `DATE_RANGE_INPUTS_NOT_FOUND`。後續 Codex 看到 MCP 只暴露 `navigate/tabs/resize` 就直接寫 `BLOCKED / EVIDENCE_INSUFFICIENT`，而 detail_json 又只有 `blocked_reason`、沒有 `currentRunEvidence`，導致 server 上傳閘門以 `CURRENT_RUN_EVIDENCE_MISSING` 拒收 result.xlsx。
- Helper 日期修正：`bi-ui-helper-executor` 的 `setDateRange()` 在找不到 input 時改走雙月曆 fallback：點左右兩側 `靜態時間`、用可見的 `‹/›` 導到目標年月、分別點開始日與結束日、按 `確認`，最後用畫面文字驗證目標區間。全程使用 Playwright visible locator click，沒有 `force:true`，也沒有內部 JS setter。`readDomState/readStateDelta` 同步改為可辨識無 `name=displayMode` 的顯示下拉，避免 `每天/DAILY` 被誤判成未對齊。
- Codex Runner 指令修正（後續 07:42 已修正權責）：當時為避免 MCP 只剩 navigation/tab/resize 就直接判 `EVIDENCE_INSUFFICIENT`，曾要求 Codex 用 shell 跑 helper executor；OTTEST002_05 證實這會踩到 Codex sandbox / CDP 邊界，因此該做法已撤回，helper executor 改由 Mac Agent 擁有。
- Result evidence 防線：新增 `result-evidence-enricher`。Agent 上傳 Codex-generated result 前，若發現 `BLOCKED` row 缺 `currentRunEvidence`，只針對該 BLOCKED row 補上本 run 的 helper/preflight artifact 指標與 helper pre-run 摘要；不會替 PASS/FAIL 補證據，也不改判定結果。這是為了避免同類 BLOCKED 再因 detail_json 少證據而變成 run failed 422。
- 修改檔案：`agent/src/bi-ui-helper-executor.ts`、`agent/src/task-runner.ts`、`agent/src/result-evidence-enricher.ts`、`scripts/verify-agent-result-contract.ts`、本 planning log。
- 驗證：`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-report-gate`、`npm run verify:capability-gate`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:helper-hints`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 已通過；部署與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-01 05:28 - 修正 OTTEST002_04 測題解析錯誤：拼貼 case 誤判、模板範例列、Agent 自動下一題

- 背景：Tommy 指出 OTTEST002 實際測題全部是拼貼模式，但線上 run 將 `TOOL-A-02` 判成 `metric_mode_helper_not_supported`、`TOOL-A-03` 判成 `record_mode_helper_not_supported`，且文件明寫 Agent 模式每次 run 只跑 `input/current-case.json`，實際卻自動 advance 到下一題。檢查 xlsx 後確認 5 題皆為「拼貼模式」，工具分類與流程控制錯誤。
- Capability mode 修正：`case-feature-detection` 改為先尊重明確 `建構模式: 拼貼/明細/指標` 與導航路徑。`指標 ID` 不再代表指標趨勢模式；`detail_json` 不再因包含 `detail` 被判成明細模式。`TOOL-A-02` 現在維持 `mode=collage/supportStatus=supported`；`TOOL-A-03` 維持 `mode=collage`，因 metadata dropdown observation 無 helper pre-run，改為 `degraded/codex_visible_ui`，不可再 BLOCKED 成 record unsupported。
- Evidence template 修正：`current-case-pack` 不再因前置條件單純提到 `metadata v1.2.5` 就套 metadata-dropdown evidence。只有 metadata 與「對照/比對/欄位清單/欄位數/下拉」同時出現時才套該模板，避免 A-01/A-04 這類建制流程被塞入不相關 metadata evidence。
- Result template 修正：`input/result-template.xlsx` 移除 `EX-01 / EX-FAIL` 範例列，只保留 header。舊模板讓 Codex 複製底稿時把 EX 範例列混進 `output/result.xlsx`，造成 server gate 報 `RESULT_MULTIPLE_CASES / RESULT_CASE_NOT_IN_ASSIGNMENT`。
- Agent 下一題策略：新增 `case-advance-policy`，讀 startup/md/supporting docs。若文件命中「Agent 不會自動 dispatch 下一 case」「每次 run 以 input/current-case.json 為準」「跑完輸出結果即停止」「由工具/PM 重新派發下一題」等語句，Agent 上傳當題結果後停止，不再自動 advance。這修正 OTTEST002 指派文字被忽略的問題。
- 規則讀取策略：generated `AGENTS.md` 與 Codex prompt 改為每題判斷前必讀 `AGENTS.md`、`agent-skills/uat-tool/SKILL.md`、`domain-routing.md`、`rules/PROJECT_AGENTS_FULL.md`，再依 `rule-index.json` 讀取必要規則。這會增加一點耗時，但優先避免誤解測題。
- 修改檔案：`agent/src/case-feature-detection.ts`、`agent/src/current-case-pack.ts`、`agent/src/result-template.ts`、`agent/src/case-advance-policy.ts`、`agent/src/task-runner.ts`、`scripts/verify-capability-gate.ts`、`scripts/verify-agent-result-contract.ts`、`scripts/verify-case-advance-policy.ts`、`package.json`、本 planning log。
- 驗證：`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:capability-gate`、`npm run verify:case-advance-policy`、`npm run verify:agent-result-contract`、`npm run verify:helper-report-gate`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate`、`npm run verify:helper-hints`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 已通過；部署與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-01 05:55 - 未來規劃：文件分層、必讀契約與 xlsx single source of truth

- 背景：OTTEST002 regression 暴露「為了加速而過度依賴 compact/run brief/classifier」的風險。原始三文件其實已清楚寫明 5 題皆為拼貼模式、Agent 模式只跑 `current-case.json`、BI domain reference 以 `PROJECT_AGENTS_FULL.md` / `BI_TEST_RULES/` / metadata 為準；但 capability gate/helper classifier 在 Codex 深讀 domain rules 前就先做錯誤 hard block，導致測題準度下降。
- 短期優先順序：先驗證 OTTEST002 在完整上下文必讀策略下不再亂測，再做文件分層分群。不要在同一輪同時大搬文件架構與調整 runtime 判斷，避免無法判斷 regression 來源。下一輪驗證重點是：`TOOL-A-02` 不再判成 metric、`TOOL-A-03` 不再判成 record、Agent mode 不再違反「跑完 current case 即停止」、result template 不再夾帶 EX 範例列。
- 文件分層目標：
  - L0 Runtime / Infrastructure：Vercel、Railway、Mac Agent、Codex CLI、Chrome/CDP、Playwright MCP、storage；只管在哪裡跑、怎麼連、怎麼存，不判斷 BI case 對錯。
  - L1 Tool / Platform：`agent-skills/uat-tool/`，管 run lifecycle、Tool Bridge、evidence gate、result/artifact contract、agent security、one-case-at-a-time、auto approval；不寫 BI metadata、拼貼操作或 PASS/FAIL/BLOCKED domain 邏輯。
  - L2 Domain / BI：目前來源為 `AGENTS.md`、`BI_TEST_RULES/*`、`BI_DATA/metadata.csv`；未來整理成 `domains/BI/BI_UAT_MASTER_CONTRACT.md` + `domains/BI/rules/` + `domains/BI/references/`。負責 BI 測試硬邊界、metadata、狀態清理、測試標的、detail_json、PASS/FAIL/BLOCKED。
  - L3 Feature / Mode：BI 下再分 Collage / Record / Metric。Collage 專屬 locator、helper template、visible UI recipe 應搬到 `domains/BI/features/collage/`，避免 Layer 1 認得過多 BI 細節。
  - L4 Round / Test Package：每輪的 `Codex_指派文字`、`測試執行說明`、`測試案例.xlsx`、supporting docs。管本輪目的、起始 case、暫停策略、授權要求、資料時間與特殊依賴。
  - L5 Current Case：`current-case.json`、`current-case-pack.*`、`run-state.json`、`capability-gate.*`、`helper-execution-plan.*`。只管目前這一題的 intent、風險、測試標的、狀態清理、步驟、預期與 evidence requirement。
- 必讀策略方向：架構可分多層，但 runtime 不應每題讀每層全文。每個 BI trusted case 固定讀 L1 Tool short contract、L2 BI Master Contract、L3 命中的 Feature Contract、L4 本輪 Agent/暫停/授權段落、L5 current case；只有 metadata 對照、狀態清理疑義、detail_json 疑義、Tool Bridge/不可逆操作、PASS/FAIL/BLOCKED 灰區、hard block 前才回讀原始長文件對應段落。
- Master Contract 定位：`BI_UAT_MASTER_CONTRACT.md` 不是摘要取代原文，而是 BI run 必讀的決策入口。它應保留來源版本/hash，並列明「何時必須回讀原文」。目標不是壓到 200 行；現實上可能需要 300-600 行才保留足夠邊界。
- xlsx single source of truth 方向：長期可朝「PM 只提供 xlsx」前進，但前提是 xlsx schema 承載 run-level 與 case-level 完整資訊，例如 `RunConfig` sheet（domain、feature、devUrl、metadata version、executionMode、startCase、stopPolicy、authorizationPolicy、purpose）、`測試案例` sheet（建構模式、授權需求、case dependency、evidence profile、helper policy、download requirement）與 `RoundNotes/Guide` sheet。屆時 `run-brief.md`、`current-case-pack.md`、`case-execution-guide.md` 由工具從 xlsx 產生，兩份 md 可降為 optional supporting docs。
- 安全邊界：在新版 xlsx schema 與 Master Contract 穩定前，不要立即砍掉 `Codex_指派文字` 與 `測試執行說明`。短期仍維持三文件輸入，並要求 classifier/gate 不可早於 structured case intent + 必讀契約做 hard block；若 gate 低信心或只靠關鍵字命中，必須降級為 Codex visible UI / Tool Bridge ambiguity，而不是直接 BLOCKED。

### 2026-05-01 07:42 - 修正 OTTEST002_05：Helper 執行權責與日曆 day cell

- 背景：OTTEST002 run `9cebf4b5-6ffe-4214-9117-94cf16e26370` 已修正前面的 mode/gate 與單題停止問題，但仍在 `TOOL-A-01` 被判 `BLOCKED`。這次不是題目分類錯，而是兩個 runtime 問題疊加：Codex prompt 仍要求「用 shell command_execution 跑 helper executor」，導致 Codex 在 sandbox 內嘗試連 `127.0.0.1:9222`，回 `CHROME_CDP_UNAVAILABLE`；同時 helper 日期 fallback 只找 `button` day cell，但實際雙月曆的日期格不是 button，畫面上三月日期可見卻回 `DATE_RANGE_CALENDAR_DAY_NOT_CLICKABLE`。
- Helper 執行權責修正：helper executor 改回完全由 Mac Agent 擁有。Codex prompt、BI helper guidance、Layer 1 `helper-protocol.md` 都明確禁止 Codex 透過 shell `command_execution` 直接呼叫 helper executor 或自行連 persistent Chrome CDP。Codex 只負責讀 helper report、必要時發 Tool Bridge request、最後判定並寫 result。
- Tool Bridge 後續 helper：新增 `runHelperContinuationAfterApprovals()`。當 Codex 發出非 SSO/login 的 Tool Bridge request 且 Mac Agent auto-approve 後，Agent 會在 resume Codex 前，於 sandbox 外執行 current case 的 pending helper action（例如 `collage.saveReport` 帶 `--approved-tool-request-id`，再接 `collage.reopenReport`），寫入 `output/helper-continuation-summary.json/jsonl` 與 helper reports，再把 summary 路徑交給 Codex 判斷。
- 日期 UI 修正：`clickCalendarDay()` 保留 button locator 優先，但若找不到 button，改找 visible exact text day cell，限制在左右月曆區域內，使用 Playwright locator click（不使用 `force:true`，不使用內部 JS setter）。`getGalaxyPage()` 也不再 fallback 到 `chrome://omnibox-popup` 等 internal target；非 `openProject` action 若沒有 application page，回明確 `GALAXY_PAGE_NOT_FOUND_FOR_HELPER_ACTION`。
- 其他修正：`reportNamePattern` 清除從指派文字擷取時可能帶入的尾端 `)`，避免臨時報表名稱多出括號。
- 回滾方式：若 helper continuation 造成授權後 action 錯接或重複執行，先將 runtime 回滾到前一個 production commit，或暫時把 `UAT_AGENT_AUTO_APPROVE_TOOL_REQUESTS=false` 關掉 auto approval，讓所有授權回到手動 Tool Bridge；不可回到「Codex shell 跑 helper executor」的作法，因為那會再次遇到 sandbox/CDP 邊界不穩。
- 修改檔案：`agent/src/helper-pre-runner.ts`、`agent/src/task-runner.ts`、`agent/src/bi-ui-helper-executor.ts`、`agent/src/helper-execution-plan.ts`、`agent/src/bi-ui-helper-guidance.ts`、`agent-skills/uat-tool/rules/helper-protocol.md`、本 planning log。

### 2026-05-01 07:50 - 修正 OTTEST002_06：同月日期區間結束日不可固定點右月曆

- 背景：OTTEST002 run `d1f5e4c8-4889-4001-bbed-ffaf71bf0812` 顯示 helper 已成功打開日期工具，截圖中左側是 `三月 2026`、右側是 `四月 2026`，左側 31 號可見；但 helper 仍把 `2026/03/01~2026/03/31` 的結束日固定拿到右側月曆找，右側四月沒有 31，導致 `DATE_RANGE_CALENDAR_DAY_NOT_CLICKABLE`。這是同月區間被錯寫成「start 左、end 右」的假設。
- 本次修正：日期點擊改為依目標年月尋找目前可見的月曆，再在該月曆內點 day cell；若開始與結束同年月，結束日會留在同一側月曆點擊，不再強制右側。warning 也補上 `startClicked/endClicked/sameMonth`，下次若再失敗可直接看是哪一段沒點到。
- 修改檔案：`agent/src/bi-ui-helper-executor.ts`、本 planning log。

### 2026-05-01 07:59 - 修正 OTTEST002_07：日期元件是 start/end calendar，不是左右任意 range picker

- 背景：OTTEST002 run `dfe4d47e-67b0-465a-a821-37f5be006bdc` 顯示 07:50 修正仍不足。Helper 在左側 `startCalendar` 點 3/1 後，再點左側 3/31，結果變成 `2026/03/31 ~ 2026/04/30`；DOM 診斷確認此元件不是任意 range picker，而是兩個固定容器：左側 `#startCalendar` 永遠改 start date，右側 `#endCalendar` 永遠改 end date。
- 本次修正：月曆定位改用 DOM id：`#startCalendarMonth/#endCalendarMonth`、`prevMonth('start'/'end')`、`#startCalendar .calendar-day`、`#endCalendar .calendar-day`。即使起訖同月，也會把右側 end calendar 移到目標月份，然後左側點 start day、右側點 end day；不再用左右座標或同側點兩次猜測。另補 `#datePickerPopup` 開啟狀態檢查，避免面板已開時再點日期按鈕反而把面板關掉。
- 二次診斷補充：實測發現只要點左側 start day，前端會把右側 end calendar 自動重算回下一個月，因此 helper 必須在「點完 start day 之後」再移動 end calendar 並點 end day；不能先把兩邊月份都移好再點。流程已改為 `move start month -> click start day -> move end month -> click end day -> confirm`。
- 修改檔案：`agent/src/bi-ui-helper-executor.ts`、本 planning log。

### 2026-05-01 08:21 - 新增 Helper normalized DOM profile：進頁/彈窗/Widget 後先辨認結構

- 背景：Tommy 指出只靠截圖仍可能看得到日期工具卻誤解互動模型，並提出「每進到一頁或叫出視窗後抓一次 HTML，通過的就不用再抓」的方向。採納其核心概念，但不抓完整 HTML，避免 payload 過大、雜訊過多、拖慢 Codex。
- 本次設計：Helper 新增 `ui-dom-profile-v1` artifact，寫到 `output/helper-artifacts/<case>/dom-profiles/*.json`。profile 只保存 visible structure：buttons、inputs、selects、modal/dialog、date picker widget、id/name/role/text/disabled/onclick attribute、selected value、少量 options 與 bounding box；不保存完整 DOM tree。每份 profile 以 normalized structure 產生 `signature`，同樣 page/modal/widget 結構可重用 artifact，操作後仍以局部 state delta 驗證。
- 日期工具補強：`collage.configureMetric` 會在 `configureMetric.before/after`、`dateRange.popupOpened`、`dateRange.staticTabRequested`、`dateRange.staticCalendar`、`dateRange.afterStartDay`、`dateRange.endCalendarReady`、`dateRange.afterEndDay`、`dateRange.afterConfirm` 等節點留下 profile ref。若再遇到類似「點 start 後 end calendar 被重算」的情境，helper report 可直接顯示 widget 結構與 signature/state 變化。
- Artifact pipeline：`evidence-artifacts` 將 `dom-profiles/*.json` 標為 `ui_dom_profile`，線上 artifact list 可追溯。Profile 是 current-run diagnostic/evidence context，可輔助 Codex 判斷 locator drift 與 UI 結構；但不可取代 visible UI action、postcondition、network/chart/table evidence，也不可直接作為 PASS/FAIL 判定。
- 修改檔案：`agent/src/bi-ui-helper-executor.ts`、`agent/src/evidence-artifacts.ts`、`agent-skills/uat-tool/rules/helper-protocol.md`、本 planning log。

### 2026-05-01 08:48 - 修正 OTTEST002_08：BI save 已知第二彈窗卡住

- 背景：OTTEST002 run `e4ad1b3f-31d2-4fd6-af98-439df1d1c86e` 顯示前一版優化已生效，helper pre-run 以 16 秒完成 `openProject/createReport/configureMetric/runPreviewAndCollectEvidence` 4/4，速度明顯改善。但 save Tool Bridge auto approval 後，畫面卡在原生 confirm「是否返回報表列表？」。本機 artifact `saved-report.json` 證實 helper 已捕捉到兩個 dialog：`報表儲存成功！` 與 `是否返回報表列表？`，但舊 dialog guard 只接受第一個 dialog，第二個只設 recovery flag 卻未 accept/dismiss，導致 Playwright action 無法返回，也沒有產出 `helper-continuation-summary.json`。
- 根因判定：這不是測試文件沒說該點哪個按鈕，而是 runtime 對 BI save flow 的已知 dialog chain 太保守。`是否返回報表列表？` 是 save/reopen 流程的必要且可辨認步驟，而且該 action 已有本 run 的 Tool Bridge response（Mac Agent auto approval），應由 helper 在同一個已授權 save action 內處理。
- 本次修正：`collage.saveReport` 新增 dialog decision：收到 Tool Bridge response 後，已知 BI save dialog（儲存成功、是否新增/建立報表、是否返回報表列表）可自動 accept；SSO/login/auth 類或未知 follow-up dialog 不 auto-accept，改 dismiss 後標記 recovery，避免卡死。save submit 與整段 save flow 也加 timeout guard，避免 dialog handler 或 actionability 問題再次造成 5 分鐘以上無輸出。
- 規則同步：更新 Codex prompt、helper execution plan、BI helper guidance 與 Layer 1 `tool-bridge.md`，把規則改成「未收到 Tool Bridge response 前不可處理 native dialog；收到後只可處理已知 BI save dialog；未知 follow-up native dialog 走 recovery」。避免文件仍要求第二彈窗一律不可處理，和 runtime 互相衝突。
- 回滾方式：若 known dialog whitelist 誤按非預期 dialog，先把 `UAT_AGENT_AUTO_APPROVE_TOOL_REQUESTS=false` 關掉 auto approval 並重啟本機 Agent；必要時回滾本 commit，使 save 後第二 dialog 回到 recovery/人工處理。不可移除 save flow timeout guard，否則會回到 OTTEST002_08 的長時間卡住問題。
- 修改檔案：`agent/src/bi-ui-helper-executor.ts`、`agent/src/task-runner.ts`、`agent/src/helper-execution-plan.ts`、`agent/src/bi-ui-helper-guidance.ts`、`agent-skills/uat-tool/rules/tool-bridge.md`、本 planning log。

### 2026-05-01 09:20 - 更新 OTTEST002 文件：Agent 模式改回連續 advance

- 背景：OTTEST002_09 第一題已完整跑完並成功 ingest，但 Agent 依文件中的「每次 run 以 current-case 為準 / 跑完輸出結果即停止 / Agent 不會自動 dispatch 下一 case」等 stop directive 停在 A-01。這不是 runtime 失敗，而是 OTTEST002 來源文件仍保留舊版單題派工寫法。
- 本次文件修正：更新 `BI_UAT_ROUNDS/onlinetest/OTTEST002/Codex_指派文字_TOOL001_v1_0.md` 與 `拼貼工具測試_測試執行說明_for_v1_0.md`，將 Agent 模式改成依 case manifest 連續執行 `TOOL-A-01 → TOOL-A-05`。每題仍要求單題 helper action、單題 `result.xlsx`、單題 ingest/evidence gate 完成後才可 advance，不允許把多題合併在同一次 UI helper action 或同一份結果寫入。
- Authoring 規則同步：`docs/authoring/UAT_三文件撰寫規則.md` 改為 Agent 模式預設可 auto-advance；若某輪真的需要人工停等，需寫明明確 stop directive，避免默認模板繼續產出舊句子。
- 驗證方式：用 `case-advance-policy` 的 stop pattern 對 OTTEST002 兩份來源檔與 authoring 規則掃描，確認不再命中 `Agent 不會自動 dispatch 下一 case`、`每次 run 以 input/current-case.json 為準`、`跑完輸出結果即停止`、`由工具/PM 重新派發下一題`、`每個 case 跑完必停`。
- 修改檔案：`BI_UAT_ROUNDS/onlinetest/OTTEST002/Codex_指派文字_TOOL001_v1_0.md`、`BI_UAT_ROUNDS/onlinetest/OTTEST002/拼貼工具測試_測試執行說明_for_v1_0.md`、`docs/authoring/UAT_三文件撰寫規則.md`、本 planning log。

### 2026-05-02 04:35 - OTTEST002_10 後續 P0 handoff：聚合結果、groupId、多欄位 helper

- 背景：`019dd9b2-2372-72b3-aa90-706ab5bacb02` 與 `019de250-8046-7222-b886-a2eac014e6e1` 兩個聊天都因舊上下文過大，多次接近 context 上限並觸發 remote compact；其中 `019de250...` 表面上很短，但每輪仍帶約 230k input tokens，最後在 `/backend-api/codex/responses/compact` 串流中斷。為避免新 session 再讀 29MB JSONL，新增短交接檔 `docs/planning/session-handoff-2026-05-02-ottest002-p0.md`。後續新聊天應優先讀此 handoff 與本 planning log，不要直接讀完整 session JSONL。
- 是否納入兩個 session：應納入兩者。`019dd9b2...` 是主要工程歷史串，包含 helper pre-run/timing、diagnostic mode、DOM profile、日期工具、BI save dialog、auto advance 等 runtime 變更；`019de250...` 是短續接串，包含 OTTEST002_10 後的最新 P0 決策與 `groupId` 討論。只保留 `019de250...` 會缺掉前面 runtime 決策，只保留 `019dd9b2...` 會缺掉最新 P0 schema/聚合決策。
- OTTEST002_10 觀察：5 題已連續跑完；`TOOL-A-01` 判 FAIL 合理，因 preview/save 使用 `2026-03-01~2026-03-31`，但 reopen 回到 `過去7天`；`TOOL-A-03` 因 metadata 差距 12 個而 BLOCKED 站得住；`TOOL-A-02` 與 `TOOL-A-05` 的 BLOCKED 主要是工具/helper 能力缺口，不是產品不可測；`TOOL-A-04` 雖缺 CSV evidence，但已觀察到 reopen 日期回退，若 case 預期包含 4 項還原，後續應避免把已知功能失敗蓋成 BLOCKED。
- P0 結果產物決策：仍維持每題單題 `output/result.xlsx`、單題 ingest、單題 evidence gate，不允許 Codex 累積多題後一次寫。但 run/group 完成後，server 應從 normalized run state 產生 group aggregate xlsx 與 final aggregate xlsx；UI 下載應指向 final aggregate，而不是最後一題 raw `result.xlsx`。必要時 Agent 可保留 append-only `output/case-results.jsonl` 作 debug sidecar，但 server DB 是正式來源。
- P0 testcase schema 決策：在目前 `groupName` 前新增 `groupId`，例如 `A/B/C/D`。建議 schema 為 `groupId`、`groupName`、`caseOrder`、`caseNo`。同步更新 testcase xlsx、OTTEST002 companion md、parser/manifest、aggregation builder 與 `docs/authoring/UAT_三文件撰寫規則.md`。`groupId` 用於機器分組、群組進度、群組下載與 final aggregate 排序。
- P0 helper 決策：`collage.configureMetric` 必須能解析 `新增帳號數 + MAU(帳號) + 總營收(TWD)` 這類 composite metric string，依序執行 `+ 新增欄位`、逐欄選取、逐欄驗證；不可再把整段字串當單一 clickable text。`TOOL-A-05` 應走既有報表修改流程：`openProject -> openExistingReport(TOOL_A01_*) -> addFields -> runPreview -> overwriteSave -> reopenReport`，找不到 A-01 報表時才以前置失敗 BLOCKED。
- P1/P2 後續：A-04 判定規則需調整為功能流程 case 只要必要子條件已直接失敗，即可 FAIL，不應因後續 CSV evidence 缺失改成 BLOCKED；另需新增 `collage.downloadCsvAndComparePreview`。若沒有真正的 recovery handler，不要發 Tool Bridge recovery 後又立刻 `PREVIOUS_HELPER_ACTION_NOT_OK` skipped，應直接 BLOCKED 並寫明原因。
- 當前 production snapshot：`refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp` 均在 `c506699`；Railway `/version` 回 `c5066991269c6860d66e41b66289188ff558254d`、deployment `b18bd607-9fa2-4601-887c-a2a026ef816f`；`/health` healthy。

### 2026-05-02 04:58 - OTTEST002 P0：groupId schema 與 final aggregate result xlsx

- 背景：OTTEST002_10 已連續跑完 5 題，但 UI 下載的 `UAT_result_*.xlsx` 只包含最後一題 raw `result.xlsx`；同時後續需要穩定機器分組值，避免只靠 `groupName` 文字推斷群組。
- 決策：維持 one-case-at-a-time hard gate。Codex / Agent 每題仍只寫單題 `output/result.xlsx`、單題 upload、單題 ingest、單題 evidence gate；server ingest 後把單題結果寫入 normalized `run_cases` / `bugs`，當 run cases 全部不再是 `PENDING/MANUAL_PENDING` 時，由 server 從 normalized state 產生 final aggregate result xlsx。`GET /api/runs/:id/output/result-xlsx` 優先回 final aggregate；若 run 尚未完成或 aggregate 尚未可產生，才回現有 raw result path。
- groupId schema：`測試案例` schema 新增 `groupId / 群組ID`，位置在 `groupName / 群組` 前；server xlsx parser、Agent case manifest/current case pack/run-state/helper guidance、result template/self-check、result parser、SQLite normalized state 皆同步支援。若舊 workbook 缺 `groupId`，parser 會從 `groupName` 前綴或 `caseNo` 推得 fallback，但新 authoring spec 以必填處理。
- result artifact：新增 `src/result-aggregate-writer.ts` 產出 `uat-final-aggregate-result-v1` workbook，`測試案例` header 為 `群組ID, 群組, 編號, 測試項目, 測試類型, 執行方式, 結果, 失敗分類, 詳細紀錄JSON`。新增 `runs.aggregate_result_xlsx_path / aggregate_result_generated_at` migration 欄位；`result_xlsx_path` 保留 raw single-case upload path 供手動 re-ingest 使用，不覆蓋成 aggregate。
- 文件同步：更新 OTTEST002 xlsx/md、`docs/authoring/UAT_三文件撰寫規則.md`、Layer 1 result workbook contract、BI result parser adapter。OTTEST002 xlsx 已改為 17 欄，5 題 `群組ID=A`。
- 修改檔案：`src/xlsx-parser.ts`、`agent/src/case-manifest.ts`、`agent/src/current-case-pack.ts`、`agent/src/run-state-guide.ts`、`agent/src/result-writer.ts`、`agent/src/result-contract.ts`、`src/result-parser/result-xlsx-parser.ts`、`src/result-aggregate-writer.ts`、`src/runs.ts`、`src/db.ts`、`src/db/schema.ts`、`domain-packs/BI/result_parser_adapter.json`、`agent-skills/uat-tool/rules/artifacts-and-results.md`、fixture scripts、`package.json`、OTTEST002 source files、authoring rules。
- 驗證：`npm run typecheck`、`npm run typecheck --prefix agent`、`npm run build`、`npm run build --prefix agent`、`npm run build --prefix web`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:final-aggregate-result`、`npm run verify:helper-hints`、`npm run verify:package-consistency`、`npm run verify:capability-gate`、`npm run verify:case-advance-policy`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:helper-report-gate`、`npm run verify:agent-roundtrip`、`git diff --check` 均通過。
- 後續影響：下一輪 production run 完成後，UI 的 XLSX 下載應為多題 final aggregate workbook，不再只拿最後一題 raw `result.xlsx`。P0 後續仍需依 handoff 繼續處理 `collage.configureMetric` composite fields、`TOOL-A-05` existing-report flow、A-04 CSV / partial subcondition judgment、recovery noise。

### 2026-05-02 05:12 - 文件維護紀律入 git：同步更新規劃說明與工程 spec

- 背景：Tommy 指出本次調整雖已更新 planning log，但 `docs/refactor/規劃說明.md` 與 `docs/refactor/工程spac.md` 已久未同步線上版實況；也希望「每次更新調整完都要同步更新文件」不要只靠聊天記憶。
- 決策：新增 tracked `uat-tool/AGENTS.md`，把 uat-tool 工程文件維護列為 repo 常駐指令。任何 runtime/schema/result artifact/Agent/helper/deployment/authoring 變更，需在同一 commit 更新 planning log、規劃說明、工程 spec 與受影響規則文件；若判斷不需更新文件，收尾回報必須明確說明原因。
- 規劃說明更新：`docs/refactor/規劃說明.md` 版本更新為 `v2026-05-02`，補上 production 已部署 `b977784` 後的狀態、`groupId / 群組ID` schema、per-case result ingest、server final aggregate result xlsx、Web UI 下載行為、目前 P0 後續項目與文件維護紀律。
- 工程 spec 更新：`docs/refactor/工程spac.md` 版本更新為 `v2026-05-02`，補上 17 欄 testcase schema、`groupId` manifest/current-case/run-state contract、單題 result workbook contract、final aggregate workbook contract、`runs.aggregate_result_xlsx_path / aggregate_result_generated_at`、result download fallback、verification 與 deployment/doc sync discipline。
- 修改檔案：`AGENTS.md`、`docs/refactor/規劃說明.md`、`docs/refactor/工程spac.md`、本 planning log。
- 驗證：本次是文件與 repo instruction 更新，需至少跑 markdown/doc diff 檢查、`git diff --check`，並以 git commit/push 固定。若後續同 commit 夾帶 runtime 變更，必須回到完整 typecheck/build/verify 流程。

### 2026-05-02 05:37 - OTTEST002 P0 helper 補齊：多欄位、既有報表覆寫、CSV evidence

- 背景：Tommy 追問 A-02/A-04/A-05 相關 helper 缺口為何不先做完。前一個 commit 只完成 handoff 第一批 P0(groupId + final aggregate);若此時直接重跑 production，只能驗證 aggregate pipeline，A-02/A-05 仍可能因 helper 能力缺口 BLOCKED。因此本次補剩餘 OTTEST002 P0 helper/runtime。
- 多欄位 helper：`collage.configureMetric` 現在會把 `新增帳號數 + MAU(帳號) + 總營收(TWD)` 這類 composite string 拆成多個欄位，逐一點 `+ 新增欄位`、逐一選取、逐一用 DOM state 驗證。splitter 會保留括號內的 `+`，避免把 `總金額(A+B)` 錯拆。
- 既有報表修改：新增 `collage.openExistingReport`。A-05 類 case 會走 `openProject -> openExistingReport -> configureMetric -> runPreview -> saveReport(overwriteExisting) -> reopenReport`，不再誤走 `createReport`。openExisting 會優先讀本 run 前置 case 的 `saved-report.json` 找 `TOOL_A01_<timestamp>`，找不到或清單不可見就 blocked 並標前置失敗，不會新建報表替代。
- 覆寫儲存與 recovery noise：`saveReport` 支援 overwriteExisting，優先沿用既有報表名；已知 BI save/overwrite/return-to-list dialog 在 Tool Bridge response 後可由 helper 處理。未知 native dialog 若沒有實際 recovery handler，helper 直接 `blocked` 並留下 dialog evidence，不再發 recovery 後立刻 `PREVIOUS_HELPER_ACTION_NOT_OK` skipped。
- CSV evidence：新增 `collage.downloadCsvAndComparePreview`。helper 透過 visible UI 觸發 CSV download，保存下載檔，讀回 CSV row count / numeric columns，與同 case `preview-evidence.json` 中 Chart.js series 比對。helper 只產生 evidence，不直接判 PASS/FAIL。
- 規則同步：更新 helper guidance、Layer 1 helper protocol、Tool Bridge dialog chain 規則、Codex run brief/native dialog prompt、capability gate 與 fixture verification。
- 修改檔案：`agent/src/bi-ui-helper-executor.ts`、`agent/src/helper-execution-plan.ts`、`agent/src/capability-gate.ts`、`agent/src/bi-ui-helper-guidance.ts`、`agent/src/task-runner.ts`、`agent-skills/uat-tool/rules/helper-protocol.md`、`agent-skills/uat-tool/rules/tool-bridge.md`、`scripts/verify-capability-gate.ts`、本 planning log、refactor 規劃與工程 spec。
- 驗證：`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:capability-gate`、`npm run verify:helper-hints`、`npm run verify:helper-report-gate`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:tool-bridge`、`git diff --check` 已先通過；收尾前需再跑 deployment 需要的 build/verify 組合並確認 Railway `/version`、`/health`。

### 2026-05-02 06:19 - 修正 OTTEST002_12：單題 result.xlsx 缺 `群組ID` 的安全修復 guard

- 背景：OTTEST002_12 run `3f6c3db9-1a9c-408f-9ae5-f8aa2c13df5f` 已成功完成 `TOOL-A-01` helper pre-run、Tool Bridge save/reopen continuation，且 Codex 合理判定產品 FAIL：重開後日期區間從 `2026/03/01~2026/03/31` 回退為 `過去7天`。但 Codex 寫出的 `output/result.xlsx` 是舊 8 欄格式，`測試案例` sheet 缺 `群組ID`，Agent 上傳前 self-check 以 `RESULT_XLSX_HEADER_MISSING` 擋下，導致有效測試結果沒有進 server。
- 根因判定：production deployment 與 input template 是新的；`input/result-template.xlsx` 已含 `群組ID, 群組, 編號...`。失敗點在 Codex 仍依舊格式手寫單題結果 workbook。這不是 helper / Railway ingest / final aggregate 的錯，但 Agent 在 schema 轉換期缺少安全單題修復 guard，讓可修復的舊欄位漂移變成整 run 失敗。
- 本次修正：新增 `agent/src/result-workbook-repair.ts`，在 codex_generated `output/result.xlsx` 上傳前、self-check 前執行。只有符合以下條件才修復：`測試案例` sheet 缺 `群組ID`、header 正好是舊 8 欄 legacy layout、資料列正好只有目前 current case、case no 與 dispatch metadata 相符、`expectedCaseNos` 不超過 1。符合時在 `群組` 前插入 `群組ID`，值優先取 input current case 的 `groupId`，並寫 `output/result-xlsx-repair.json`。
- 安全邊界：多題 result workbook、錯題、缺其他 header、非 legacy layout、無法確認 current case 的情境一律不修；仍由 `result-xlsx-self-check.json` 擋下。這不放寬 server contract，也不允許 Codex 累積多題後一次寫。修復後仍必須通過原本 Agent contract check、server result evidence gate 與單題 ingest。
- 驗證：新增 `verify:agent-result-contract` fixture 覆蓋舊 8 欄單題 workbook，確認修復前 self-check error、修復後 contract ok、parser 讀到 `groupId=A`。另用 OTTEST002_12 實際本機 `output/result.xlsx` 複本測試，確認修復前唯一錯誤為缺 `群組ID`，修復後 contract ok 且保留 `TOOL-A-01 / FAIL / FUNCTIONAL_REGRESSION` 與 detail_json current-run evidence。完整驗證已跑過 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:final-aggregate-result`、`npm run verify:capability-gate`、`npm run verify:helper-hints`、`npm run verify:helper-report-gate`、`npm run verify:tool-bridge`、`npm run verify:case-advance-policy`、`npm run verify:package-consistency`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check`。
- 修改檔案：`agent/src/result-workbook-repair.ts`、`agent/src/task-runner.ts`、`scripts/verify-agent-result-contract.ts`、`agent-skills/uat-tool/rules/artifacts-and-results.md`、本 planning log、refactor 規劃與工程 spec。

### 2026-05-02 06:55 - 修正 OTTEST002_13：degraded case 不可落入 Agent fallback

- 背景：OTTEST002_13 run `e47d033e-2ade-442e-9a05-86d184bc3fd2` 不是單純斷網失敗。A-01 已 `FAIL` 並成功 ingest，A-02 已 `PASS` 並成功 ingest，且 A-02 多欄位 helper/日期/preview/result upload 是目前 P0 改善的正向證據。失敗發生在 A-03：capability gate 為 `degraded`、helper pre-run 被跳過，Codex turn 又沒有 browser automation tool 可做 first browser preflight，於是 Codex 沒寫可信 `output/result.xlsx`，Agent fallback 被正確拒絕上傳，最後 run 以 `CODEX_NO_RESULT_XLSX` 失敗。
- 決策：degraded + browser tool unavailable 是 current case 的可信平台阻塞，應由 Codex 寫單題 `BLOCKED result.xlsx`，`失敗分類=TOOL_EXECUTION_UNAVAILABLE` 或 `EVIDENCE_INSUFFICIENT`，detail_json 必須含 `blocked_reason` 與 current-run evidence（capability gate、helper skipped summary、preflight/tool 狀態、agent log 摘要）。不可再把這種可判定阻塞丟給 Agent fallback；fallback 仍只保留給 process crash/cancel/完全無法寫 workbook 的診斷情境，且仍不可信不上傳。
- 本次修正：`capability-gate` 的 degraded 指令改為 browser/UI path 不可達時寫 `BLOCKED/TOOL_EXECUTION_UNAVAILABLE`；Codex run prompt 的 fast path / hard gate / result workbook contract 同步改掉「不能測就交給 fallback」的舊說法；Layer 1 `artifacts-and-results.md` 補上 degraded helper skipped 的 BLOCKED result contract。
- 驗證：`verify:capability-gate` 新增 A-03 metadata compare fixture assertion，確認 degraded case 的 `codexInstruction` 包含 `TOOL_EXECUTION_UNAVAILABLE`，避免回到 fallback 路徑。已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:capability-gate`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:final-aggregate-result`、`npm run verify:helper-hints`、`npm run verify:helper-report-gate`、`npm run verify:tool-bridge`、`npm run verify:case-advance-policy`、`npm run verify:package-consistency`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 通過；收尾需 commit/push deployment branch 並確認 Railway `/version`、`/health`。
- 修改檔案：`agent/src/capability-gate.ts`、`agent/src/task-runner.ts`、`agent-skills/uat-tool/rules/artifacts-and-results.md`、`scripts/verify-capability-gate.ts`、本 planning log、refactor 規劃與工程 spec。

### 2026-05-02 07:31 - 修正 OTTEST002_14：A-01 欄位 actionability、CSV 分層判定、metadata reference 與 must-read rules

- 背景：Tommy 檢查 OTTEST002_14 後指出三個問題：A-01 本應跑到可判定流程卻因 helper `ADD_FIELD_BUTTON_NOT_CLICKABLE:新增帳號數` 早早 `BLOCKED`；A-04 CSV case 看起來像 Agent 無法驗證下載檔；A-03 metadata case 需要更明確指定「工具設置時提供的參考數據 CSV」。同時也討論到 Codex 是否因未完整讀 Agent/rules 而漏判。
- A-01 helper 修正：`collage.configureMetric` 的欄位新增不再只靠 `+ 新增欄位` 文字 locator。新增 visible UI fallback：role=button、button text、role/class button、visible button index、visible text target；仍全部走 Playwright actionability click，不用 `force:true`、不使用 JS setter。失敗時 reason 會帶 visible buttons / targets，方便下一輪定位 locator drift。
- CSV 判定修正：`collage.downloadCsvAndComparePreview` 在點不到下載按鈕時會先讀 DOM state。若頁面顯示「請選擇欄位/點擊執行/無預覽」等狀態，blocked reason 改為 `CSV_PRECONDITION_NOT_MET_NO_CURRENT_PREVIEW` 並帶 dateRange/fields/buttons。Codex prompt、BI helper guidance、Layer 1 result contract 同步要求 save/reopen + CSV case 先按必要子條件判定：若重開設定或 preview 已失敗，CSV 比對寫 `not_reached`，不可把已知功能 regression 降成 BLOCKED。
- Metadata reference 修正：authoring 規則與 runtime prompt 明確規定 metadata/dropdown case 以 run packet canonical `rules/BI_DATA/metadata.csv` 為準，原始 `BI_DATA/metadata＿1.2.5 - 工作表1.csv` 只作 traceability。metadata detail_json 應包含 `reference_csv`、`source_report`、`match_key`、`compare_fields`、normalization notes 與差異清單。
- Rule loading 修正：`current-case-pack.json` 新增 `mustReadRuleKeys`，依 case type 強制帶入最小必要規則包。所有 case 固定 current case/capability/run-state/evidence/artifacts/Codex runtime；helper/UI workflow/CSV case 加 helper execution plan、helper protocol、BI helper guidance；metadata case 加 reference-index 與 BI metadata rule；CSV case 加 evidence-template-index。`rule-index.currentCaseRecommendations` 會合併此 mandatory bundle。
- Evidence template：新增 `downloaded-csv-evidence.json`，定義 UI-triggered download path、suggested filename、CSV header/row count、preview comparison 與 not-reached reason。current-case-pack 會在 case 文字含 CSV/download/下載/匯出時加入 `downloaded-csv` template。
- 文件同步：更新 `docs/authoring/UAT_三文件撰寫規則.md`，新增 metadata 前置條件寫法、CSV 下載 case 子條件順序與 helper hints 建議；同步更新 `docs/refactor/規劃說明.md` 與 `docs/refactor/工程spac.md`，記錄 must-read rules、CSV/metadata contract 與新的 regression 重跑重點。
- 修改檔案：`agent/src/bi-ui-helper-executor.ts`、`agent/src/current-case-pack.ts`、`agent/src/rule-index.ts`、`agent/src/evidence-templates.ts`、`agent/src/helper-execution-plan.ts`、`agent/src/bi-ui-helper-guidance.ts`、`agent/src/reference-index.ts`、`agent/src/task-runner.ts`、`agent-skills/uat-tool/rules/helper-protocol.md`、`agent-skills/uat-tool/rules/artifacts-and-results.md`、`scripts/verify-helper-hints-fixture.ts`、authoring/refactor docs、本 planning log。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-hints`、`npm run verify:capability-gate`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:helper-report-gate`、`npm run verify:tool-bridge`、`npm run verify:case-advance-policy`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 通過；已推 `refactor/mac-agent-mvp` 與 deployment branch `codex/uat-tool-mvp`，Railway `/version`、`/health` 於收尾查驗。

### 2026-05-02 07:45 - 加強每題 AGENTS / md / BI rules 必讀範圍

- 背景：Tommy 確認是否已加強 Agent、md 與 rules 讀取，並希望「最好都給我有讀」。前一版 `mustReadRuleKeys` 已依 case type 強制載入 helper/CSV/metadata 規則，但 BI 三本 canonical rulebook 仍主要靠推薦與 binding wording，未放進每題 mandatory bundle。
- 本次修正：`current-case-pack.json.mustReadRuleKeys` 的所有 BI case 基礎集合新增 `platform-skill`、`domain-routing`、`bi-project-agents-full` 與三份 canonical BI rulebook：`BI測試標準_共通方法論`、`BI測試_系統背景知識`、`BI系統_metadata摘要`。`task-runner` prompt 同步改成每題判定前必讀 generated AGENTS/platform rules、`PROJECT_AGENTS_FULL.md` 與全部 `rules/BI_TEST_RULES/*.md`。
- 文件同步：`docs/refactor/規劃說明.md` 與 `docs/refactor/工程spac.md` 更新 must-read 規則，明確標示每個 BI case 都會帶入 Layer 1、domain-routing、AGENTS full 與三份 BI rulebook；case-type 規則再額外加 metadata/CSV/helper 專用包。
- 修改檔案：`agent/src/current-case-pack.ts`、`agent/src/task-runner.ts`、本 planning log、refactor 規劃與工程 spec。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:helper-hints`、`npm run verify:capability-gate`、`git diff --check` 通過；收尾需 commit/push deployment branch 並確認 Railway `/version`、`/health`。

### 2026-05-02 08:26 - 收緊 OTTEST002_16：metadata 精確檔名與 CSV 下載正式 evidence

- 背景：Tommy 檢查 OTTEST002_16 後確認 A-03 不是 metadata 未提供，而是多參考檔時需要更明確告訴 Codex 哪一份 CSV 才是 metadata；A-04 則需釐清「Codex/Agent 能不能讀下載 CSV」。本次決策：metadata case 用 exact source filename + reference-index 鎖定來源；CSV case 正式 evidence 走 UI 下載後本機 parser，不導入 Google Sheet 作主流程。
- OTTEST002 source 更新：實際測題來源 `BI_UAT_ROUNDS/onlinetest/OTTEST002/拼貼工具測試_測試案例_v1_0.xlsx` 已更新 A-03/A-04。A-03 明寫 source filename=`metadata＿1.2.5 - 工作表1.csv`、Agent canonical=`rules/BI_DATA/metadata.csv`、reference-index key=`bi_metadata_csv`，並禁止 bulk-read 全部 CSV 猜測來源。A-04 明寫必須完成「儲存→重開→current preview→UI 下載 CSV→本機 CSV parser 比對 preview」，只完成 preview 不可直接判 `BLOCKED/EVIDENCE_INSUFFICIENT`。
- Companion md 更新：`BI_UAT_ROUNDS/onlinetest/OTTEST002/Codex_指派文字_TOOL001_v1_0.md` 與 `拼貼工具測試_測試執行說明_for_v1_0.md` 同步 metadata 檔名、reference-index 與 CSV not-reached/FAIL 分層判定。這兩份目前位於 `uat-tool` git root 外，實體檔已更新，但不會被本 repo commit 追蹤。
- Runtime/rules 更新：authoring 規則、Layer 1 artifacts/results、helper protocol、generated BI helper guidance、reference-index、evidence-template 與 task-runner prompt 同步：metadata 多檔案時只讀 `bi_metadata_csv` 或 exact filename；UI 下載後可讀本機 CSV；Google Sheet 只作人工探索 fallback；save/reopen/download helper plan 未完成前不可直接把 CSV path 判成 evidence insufficient。
- Refactor 文件同步：`docs/refactor/規劃說明.md` 與 `docs/refactor/工程spac.md` 更新最新 planning/spec，將 exact metadata source filename contract、local CSV parser evidence 與 A-04 helper continuation 納入近期 P0 驗證重點。
- 驗證：已跑 OTTEST002 package consistency check（status=warning，唯一 warning 為 legacy package 無 helper hints JSON，無 error）、`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:capability-gate`、`npm run verify:package-consistency`、`npm run verify:helper-hints`、`git diff --check` 通過。

### 2026-05-02 08:35 - README 更新：目前最新版、歷程與 source-of-truth 分層

- 背景：Tommy 詢問 `UAT_三文件撰寫規則.md` 與建議放入 git 的 testcase package 是否用途相同，並指出 Git README 很久沒有更新。釐清後決策：authoring rules 是「怎麼寫測試包」的規範；實際 xlsx/md 測試包是「某輪測試的版本化產物」，兩者用途不同。若要讓 Git 記住 OTTEST002 的實際上傳版本，需另設 tracked package 目錄，例如 `test-packages/OTTEST002/`。
- README 更新：重寫 `README.md`，補上目前 production path、Vercel/Railway/Mac Agent/Codex/Playwright 架構、active branches、Mac Agent MVP 能力、one-case-at-a-time contract、result workbook/final aggregate contract、current-run evidence、Tool Bridge、test package source-of-truth 分層、OTTEST002 最新決策、文件地圖、local dev、Railway deployment notes、常用 API surface 與文件維護紀律。
- 部署判斷：本次只改 README 與 planning log，不改 runtime、schema、Agent/helper 或 production 行為；因此不需要推 deployment branch 觸發 Railway redeploy。為了讓 GitHub default branch README 也更新，仍應將同一 docs-only commit 推到 `codex/uat-tool-mvp`。
- 驗證：需跑 `git diff --check`，不需重跑 TypeScript/build/production health，因為沒有程式或部署行為變更。

### 2026-05-02 10:35 - OTTEST002_16_1 後續：A-03 metadata helper 與 A-04 清單頁 CSV 測題改版

- 背景：Tommy 檢查 OTTEST002_16_1 後確認 A-03 仍無法判讀，但 run evidence 顯示 metadata 其實已正確複製到 `rules/BI_DATA/metadata.csv`，且 `reference-index` 也有 `bi_metadata_csv`；真正 blocker 是 Codex MCP 該輪只有 snapshot/navigation/read tools，缺 click/type/select，無法互動展開欄位 dropdown 取得 DEV actual list。A-04 的 FAIL 則是目前 testcase 綁了 editor reopen/date-range restore，會再次踩到已知日期還原 bug，因此需要把 CSV 驗證切到報表清單列下載。
- A-03 runtime 修正：`capability-gate` 現在把 `metadata_dropdown_compare` 視為 supported/helper-assisted，不再 degraded。`helper-execution-plan` 對 A-03 產生 `collage.openProject -> collage.createReport -> collage.extractMetadataDropdownFields`，不跑 preview、不寫 result。`bi-ui-helper-executor` 新增 `collage.extractMetadataDropdownFields`：先用 visible UI 點 `+ 新增欄位`，再 read-only DOM extraction 擷取 actual picker items / `addFieldToSelection` code，讀 `input/reference-index.json` 或 `rules/BI_DATA/metadata.csv` 取得 expected list，輸出 `metadata-dropdown-evidence.json`，包含 actualVisibleItems、expectedFields、missingFields、extraFields、normalizationNotes。helper 仍不可判 PASS/FAIL。
- A-04 runtime 修正：`collage.downloadCsvAndComparePreview` 新增 list/project-page download path。若 params 或 testcase 指定 `downloadScope=report_list`，helper 會使用本輪 `saved-report.json` 的 reportName 鎖定 saved report row/list control 觸發 CSV download，並與儲存前 `preview-evidence.json` 比對；不重開 editor。helper plan 對明寫「不重開 editor」的 case 不再因文字含 `重開/還原` 產生 `collage.reopenReport`。
- OTTEST002 source 更新：實際測題來源 `BI_UAT_ROUNDS/onlinetest/OTTEST002/拼貼工具測試_測試案例_v1_0.xlsx`、`拼貼工具測試_測試執行說明_for_v1_0.md`、`Codex_指派文字_TOOL001_v1_0.md` 已同步。A-03/A-04 都新增 Helper hints；A-04 改為「preview -> 儲存 -> 回專案/報表清單 -> 從該報表列下載 CSV -> 本機 parser 比對儲存前 preview」，明確不重開 editor、不驗證 date-range restore。OTTEST002 package consistency 已達 `status=ok`、0 issue。這些 source package 檔仍位於 `uat-tool` git root 外，需重新上傳才會被下一輪 run 使用。
- Rules/docs 同步：更新 authoring rules、Layer 1 artifacts/results、helper protocol、BI helper guidance、evidence templates、task-runner prompt、README、refactor 規劃與工程 spec。最新規範：metadata helper evidence 可用但 Codex 仍判定；CSV 正式 evidence 是 UI 下載後本機 parser；清單頁下載要鎖定本輪 saved report row；Google Sheet 仍只作人工探索 fallback。
- 驗證：已跑 OTTEST002 package consistency check（status=ok, issueCount=0）、`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:capability-gate`、`npm run verify:helper-hints`、`npm run verify:helper-report-gate`、`npm run verify:package-consistency`、`npm run verify:final-aggregate-result`、`git diff --check`。另外用 OTTEST002 source 生成 plan 驗證：A-03 actions 為 `openProject/createReport/extractMetadataDropdownFields`；A-04 actions 為 `openProject/createReport/configureMetric/runPreview/saveReport/downloadCsvAndComparePreview`，不含 `reopenReport`，且 `downloadScope=report_list`。

### 2026-05-02 11:20 - OTTEST002_18 診斷：metadata group scope、helper evidence preflight replacement、支援檔 profile

- 背景：Tommy 檢查 OTTEST002_18 後指出 A-03 metadata 仍有異常，並提出是否應在取得題目與補充資料時先讀過/拆解選填支援資料。診斷 run `cbd05716-9d50-4b45-b457-838a6309b388` 後確認 metadata 檔並非沒讀：`reference-index` 已有 `bi_metadata_csv`，`rules/BI_DATA/metadata.csv` 存在，A-03 helper `collage.extractMetadataDropdownFields` 也成功產出 `metadata-dropdown-evidence.json`。
- A-03 根因：helper 擷取 dropdown 時抓到整個欄位 picker 的所有 `addFieldToSelection` item，包含 `DAILY_REPORT` 後面的 `LOGIN_PLATFORM_STATUS / ORDER_MANAGEMENT / REFUND_TRACKING`，導致 actual=69、expected=32 並產生大量 false extra。另有 label 清洗問題：部分 UI badge/code 進入 label，例如 `活躍人數(回訪使用者)RAU`、`iOS總營收 NUMERIC`，以及 metadata 與 UI 的已知命名差異未分 exact diff / normalized diff。
- A-03 修正：`collage.extractMetadataDropdownFields` 現在會偵測 picker group header，`每日報表` 對應 `DAILY_REPORT`，正式 comparison 只比較該 source group；若找不到 group 才 fallback 全部 item 並加 warning。欄位 label 會移除 type badge 與尾端 code，comparison 會套用已知 metadata/UI 命名 alias，並同時保留 `exactMissingFields/exactExtraFields` 與 normalized `missingFields/extraFields`，讓 PM 可分辨「命名差異」與「真差異」。
- A-04 判定層修正：OTTEST002_18 的 A-04 helper 已成功完成 `openProject/createReport/configureMetric/runPreviewAndCollectEvidence`，但 Codex 判定階段因自己沒有 browser/Playwright MCP 而標 `BLOCKED/TOOL_EXECUTION_UNAVAILABLE`。這是 prompt/gate 過度要求 Codex 自己做 browser preflight。現在 run brief、preflight guidance、rule index 與 Codex prompt 明確規定：若同一 run、同一 case 已有 successful Agent helper browser evidence 且涵蓋必要 UI/DOM/network 證據，Codex 應直接讀 helper evidence 判定，不可只因 Codex-side browser tool 不存在而標 TOOL_EXECUTION_UNAVAILABLE。
- 支援資料拆解：新增 `supporting-docs-manifest` 輕量 profile。每個上傳 md/txt/csv 會先記錄 fileName、extension、size；CSV 會記 header、rowCount、roleHints（例如 `metadata_candidate`）；md/txt 會記 headings/lineCount。這不是把所有支援檔全文塞進 prompt，而是在 run workspace 內提供可審計的暫存索引，讓 Codex/Agent 先用 profile 判斷該讀哪份檔。run workspace 仍依既有 retention 保留以便查證，不在測完立刻刪除。
- 修改檔案：`agent/src/bi-ui-helper-executor.ts`、`agent/src/task-runner.ts`、`agent/src/preflight-guidance.ts`、`agent/src/rule-index.ts`、`agent/src/supporting-docs-manifest.ts`、`agent/src/reference-index.ts`、`agent/src/bi-ui-helper-guidance.ts`、本 planning log、refactor 規劃與工程 spec。
- 驗證與部署：已跑 `npm run build --prefix agent`、`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build`、`npm run build --prefix web`、supporting-docs profile smoke、A-03 artifact revised comparison smoke、`npm run verify:helper-hints`、`npm run verify:capability-gate`、`npm run verify:helper-report-gate`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:package-consistency`、`npm run verify:case-advance-policy`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 通過。已推 `refactor/mac-agent-mvp` 與 deployment branch `codex/uat-tool-mvp`；Railway production `/version` 為 `bda22e7`、deployment `8c9d5fe4-c9ba-42d9-94ab-e5546b5fb4be`，`/health` healthy。本機 Mac Agent 已重啟至 launchd pid `71495`。

### 2026-05-02 19:10 - OTTEST002_19：A-04 清單頁 CSV 下載 row refresh、table preview evidence 與 response-body fallback

- 背景：Tommy 檢查 OTTEST002_19 後確認整輪已接近成功，A-03 metadata 已正確發現資料差異並做出合理判斷，剩下 A-04 CSV。診斷 run `366ce4e5-e0cb-41b7-8926-b99df2989958` 後確認 A-04 已完成 preview 與 save，`saved-report.json` 記錄 `TOOL_A04_202605020400`，但 save 後回到清單頁時 DOM/screenshot 仍停在 stale list，清單中沒有本輪新報表；舊 helper 未刷新/重定位 saved row，退去點全域下載文字，最後 `page.waitForEvent("download")` timeout。
- A-04 runtime 修正：`collage.downloadCsvAndComparePreview` 現在對 `downloadScope=report_list` 先用 `saved-report.json.reportName` 讀取本輪 saved row state；若清單 stale 會 reload 並重新點 project 定位，仍找不到時回傳 `workflowStatus=failed_precondition`、`failedSubcondition=saved_report_row_missing`、`csv_comparison_status=not_reached`，讓 Codex 依 testcase 判必要子條件。若 row 存在但沒有該列下載控制，回 `csv_button_missing_on_saved_report_row`，不再錯點其他報表或全域控制。
- CSV evidence 修正：row 下載控制改為支援 icon-only `⬇️`、`onclick=downloadReport(...)`、row-local button/a/role=button。下載成功時 `downloadedCsv.source=browser_download_event`；若 browser download event 未觸發但同一次 visible UI click 產生 CSV/attachment response，helper 會保存該 UI-triggered response body，標 `downloadedCsv.source=ui_triggered_network_response_body`，仍不直接打 BI API。
- Preview 比對修正：`collage.runPreviewAndCollectEvidence` 新增 preview table extraction，會記錄 header、data rows、sample/tail rows 與 numeric summaries。`summarizeCsvAgainstPreview` 現在可用 table evidence 比對 CSV row count、header 與逐列 cell（含日期格式與數字正規化），不再只依賴 Chart.js；拼貼模式表格 case 可真正做 pre-save preview vs CSV comparison。
- Rules/docs 同步：更新 task-runner prompt、helper execution plan、BI helper guidance、evidence templates、current-case-pack、rule-index、Layer 1 helper/artifact rules、authoring rules、README、refactor 規劃與工程 spec。最新規範：清單頁 CSV 必須鎖定本輪 saved row 並可刷新/重定位；正式 evidence 可為 browser download 或同次 UI click 的 CSV response body；CSV 比對目標是 pre-save preview table/chart evidence。
- 修改檔案：`agent/src/bi-ui-helper-executor.ts`、`agent/src/task-runner.ts`、`agent/src/bi-ui-helper-guidance.ts`、`agent/src/helper-execution-plan.ts`、`agent/src/evidence-templates.ts`、`agent/src/current-case-pack.ts`、`agent/src/rule-index.ts`、`agent-skills/uat-tool/rules/artifacts-and-results.md`、`agent-skills/uat-tool/rules/helper-protocol.md`、`docs/authoring/UAT_三文件撰寫規則.md`、`README.md`、refactor docs、本 planning log。
- 驗證與部署：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-hints`、`npm run verify:capability-gate`、`npm run verify:helper-report-gate`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:package-consistency`、`npm run verify:case-advance-policy`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、OTTEST002 source package consistency check（status=ok, issueCount=0）、`git diff --check` 通過。runtime commit `ed50a1b` 已推 `refactor/mac-agent-mvp` 與 deployment branch `codex/uat-tool-mvp`；Railway production `/version` 為 `ed50a1b`、deployment `c7f320e7-0e40-48e9-8960-edd70f85e609`，`/health` healthy。本機 Mac Agent 已重啟至 launchd pid `93284`。

### 2026-05-03 01:45 - Background-safe Browser Session Lease：禁止 helper 搶前景與 A-01/A-02 欄位 loading wait

- 背景：Tommy 觀察 OTTEST002_21 / 後續 run 時，Mac Agent helper 會反覆把 dedicated Chrome 拉回前景，導致 Safari/其他工作被打斷；同時 A-01/A-02 helper 在 BI editor 還顯示 `載入欄位中...` 時，`collage.configureMetric` 約 200ms 就判 `ADD_FIELD_BUTTON_NOT_CLICKABLE`，讓正常 loading 被誤標成 testcase `BLOCKED`。回查 4/29 的歷史決策可知，`/json/activate` / `page.bringToFront()` 當初是為了解決「Tommy 肉眼看到的 tab 與 Playwright 實際受控 tab 不一致」，不是 Playwright 操作 DOM 的必要條件。
- Browser identity 修正：新增 `uat-browser-session-v1` lease，Agent 每個 run/case 會寫 `input/browser-session.json`，包含 `runId`、`caseNo`、`generation`、`sessionId`、CDP `targetId`、random `token` / `tokenHash`、`windowName`、`endpoint` 與 `devUrl`。Agent 在 dedicated tab 寫入 `window.name = uat-tool:<runId>:<caseNo>:<generation>:<token>` 與 `sessionStorage.__uatToolBrowserSession`。Helper 只用 marker/token resolve 目標 page；禁止 fallback 到第一個 Galaxy tab、active tab、OS foreground window 或 URL-only match。找不到或不一致時回 `BROWSER_SESSION_LEASE_MISSING`、`BROWSER_SESSION_TARGET_MISSING`、`BROWSER_SESSION_TOKEN_MISMATCH`、`BROWSER_SESSION_STALE` 或 `BROWSER_SESSION_URL_MISMATCH`。
- No-foreground policy：正式 helper/Codex run path 移除 `page.bringToFront()`、CDP `/json/activate` 與 MCP tool call 後的 `scheduleBrowserActivation()`。`ensureSingleUserPageTab()` 只負責關閉 dedicated profile 裡的多餘 user tabs，不再 activate。run/case 一開始建立 dedicated Chrome window/tab 仍允許；後續人工介入改由 Tool Bridge/log 事件提示，不用搶前景。VM Runner 與 Telegram/WhatsApp/其他通知列為 M2 後續評估，不併入本次 P0。
- A-01/A-02 loading 修正：`collage.configureMetric` 在選欄位前新增 `waitForMetricFieldControls()`，必須等 `載入欄位中...` 清除或 `+ 新增欄位`/等價欄位控制項可見後才點擊。若 loading 持續到 timeout，blocked reason 為 `FIELD_LIST_LOAD_TIMEOUT`；只有 loading 結束後仍無控制項才回 `ADD_FIELD_BUTTON_NOT_CLICKABLE`。
- Evidence / rules 同步：helper report 會補 `browserSession`、`targetBinding`、`foregroundPolicy.mode=no-activate`；task-runner prompt、Layer 1 helper protocol、BI helper guidance、README、refactor 規劃與工程 spec、M1 runbook/M1 spec addendum 都同步寫入 background-safe lease、no-foreground helper policy、field-list loading wait 與 VM 後續評估。
- 修改檔案：`agent/src/browser-session.ts`、`agent/src/bi-ui-helper-executor.ts`、`agent/src/task-runner.ts`、`agent/src/bi-ui-helper-guidance.ts`、`agent-skills/uat-tool/rules/helper-protocol.md`、`README.md`、`docs/refactor/規劃說明.md`、`docs/refactor/工程spac.md`、`docs/refactor/M1_Mac_Agent_MVP_Runbook.md`、`docs/refactor/UAT_Tool_M1_完整實作Spec_v1.md`、本 planning log。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-report-gate`、`npm run verify:helper-hints`、`npm run verify:capability-gate`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:final-aggregate-result`、`npm run verify:case-advance-policy`、`npm run verify:tool-bridge`、`npm run verify:package-consistency`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 通過；另以 `rg` 確認正式 runtime call path 沒有 `page.bringToFront()`、`/json/activate`、`activateBestExistingTab`、`scheduleBrowserActivation`，僅保留 guidance 文字提醒「不可使用」。

### 2026-05-03 02:55 - Session handoff：續接 OTTEST002 P0 compact 後下一輪工作

- 背景：Codex thread `019de548-1d41-77d2-9cd1-2cf6428a2383`（聊天室名稱「續接 OTTEST002 P0」）在討論下一輪小修與版本制度時再次遇到 remote compact stream disconnect。該 session 約 19MB / 7392 行，最後每輪 input 約 240k tokens，接近 258,400 context window；完整 JSONL 不應作為下一輪起點。
- 本次文件交接：新增 `docs/planning/session-handoff-2026-05-03-ottest002-next.md`，整理 `16f938c` production 之後的狀態、OTTEST002_23 觀察、下一輪已同意要做的調整與新聊天開場詞。下一個 Codex session 應讀該 handoff、本 planning log 與 `uat-tool/AGENTS.md`，不要讀 raw session JSONL。
- OTTEST002_23 結論：5 題跑完、單題 result xlsx ingest、final aggregate xlsx 產生、120 個 evidence artifacts 全部上傳，background-safe lease 生效，A-04 CSV list download/preview comparison 已通。正式放大到 40-50 題前，仍建議補 A-03 metadata helper wait、BLOCKED detail_json health、reopen settle/network evidence、Codex warning 降噪、完整紀錄 MD 下載與手機 RWD overflow。
- 版本制度待辦：目前 root package 與 Railway `/version` 仍是 `1.0.0`，Agent package 與 WebSocket header/payload 仍是 `0.1.0`。下一輪 runtime/UI 變更應建立版本紀律，先評估 root `1.1.0`、Agent `0.2.0`，並讓 Agent version 不再硬寫在 `agent/src/connection.ts`。
- 本次交接不含 runtime 行為變更；production 仍是 `16f938c`，`codex/uat-tool-mvp` 不需因本文件-only 交接重新部署。

### 2026-05-03 03:10 - OTTEST002 P0 收斂：版本紀律、A-03 wait、BLOCKED health、reopen evidence、完整紀錄 MD、手機 RWD

- 背景：前一個 `續接 OTTEST002 P0` session 在開始實作前 compact 失敗。依 handoff 接續處理 40-50 case 正式批次前的 P0 工程缺口，不讀 raw JSONL。
- 版本紀律：root app 從 `1.0.0` 升到 `1.1.0`，Mac Agent 從 `0.1.0` 升到 `0.2.0`。`agent/src/connection.ts` 新增 `AGENT_VERSION`，從 `agent/package.json` 讀取並同步用於 WebSocket `X-Agent-Version` 與 `agent.online.payload.agent_version`，不再 hard-code。
- A-03 metadata helper wait：`collage.extractMetadataDropdownFields` 在展開欄位 picker 前改用與 `collage.configureMetric` 相同的 `waitForMetricFieldControls()`。若 BI editor 持續顯示 `載入欄位中...`，helper blocker 會是 `FIELD_LIST_LOAD_TIMEOUT`，不會過早報 `ADD_FIELD_BUTTON_NOT_CLICKABLE`。
- BLOCKED detail_json health：result evidence gate、Agent result contract、BI result adapter 與 generated prompt/模板契約同步加嚴。`BLOCKED` 現在必須包含 `測試目的`、`設定條件`、`預期行為`、`實際行為`、`blocked_reason` 與 current-run evidence；`/detail-health` 也會對 BLOCKED 檢查 core fields + `blocked_reason`。
- reopenReport evidence：`collage.reopenReport` 重開報表後會等待 editor loader/network settle，保存 `reopen-report-evidence.json`，內容包含 expected field/date/display、settle 狀態、前後 state delta、DOM state、UI profile 與 report/detail network requests/responses。此修正不恢復 `bringToFront` 或 CDP activate。
- 完整紀錄 MD：新增 `POST /api/runs/:id/export-archive-md`，與既有 concise `export-md` 分開。Web UI 現在有三個主要下載：`下載結果 XLSX`、`下載報告 MD`、`下載完整紀錄 MD`；完整 archive 包含 run metadata、case state、result counts、timing summary、artifact stats/list、timeline、logs、events。
- 手機 RWD：補 `min-width:0`、long text wrapping、card header action wrapping、case row mobile layout、detail_json wrapping、artifact/log row stacking、file name/agent/dev-url overflow 防護。Playwright 以 desktop `1440x1000` 與 mobile `390x844` 檢查 `documentElement.scrollWidth === clientWidth`，未發現水平 overflow。
- 修改檔案：`package.json`、`package-lock.json`、`agent/package.json`、`agent/src/connection.ts`、`agent/src/bi-ui-helper-executor.ts`、`agent/src/result-contract.ts`、`agent/src/task-runner.ts`、`src/result-parser/result-evidence-gate.ts`、`src/runs.ts`、`domain-packs/BI/result_parser_adapter.json`、`scripts/verify-result-evidence-gate.ts`、`scripts/verify-agent-result-contract.ts`、`web/src/App.tsx`、`web/src/App.css`、`README.md`、`docs/refactor/規劃說明.md`、`docs/refactor/工程spac.md`、`docs/refactor/UAT_Tool_M1_完整實作Spec_v1.md`、`docs/refactor/UAT_Tool_Spec_v1_2_1.md`、本 planning log。
- 驗證：`npm run typecheck`、`npm run typecheck --prefix agent`、`npm run build`、`npm run build --prefix agent`、`npm run build --prefix web`、`npm run verify:helper-report-gate`、`npm run verify:capability-gate`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:helper-hints`、`npm run verify:tool-bridge`、`npm run verify:case-advance-policy`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 皆已通過；另以本機 Vite + API 做 Playwright desktop/mobile overflow 檢查。部署、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-03 04:55 - OTTEST002_25 follow-up：CSV false mismatch 與 A-05 helper continuation

- 背景：Tommy 回報 run archive `f7ab18ce-9feb-4e29-82c8-e12714d12a5a` 中 A-04 CSV 顯示 failed 不合理，且 A-05 被標 `BLOCKED/EVIDENCE_INSUFFICIENT` 不合理，預期應像 A-01 一樣能完成重開還原驗證並判 FAIL。依既有紀律，本次只讀完整紀錄 MD 與當輪 helper artifacts，不讀舊 raw session JSONL。
- A-04 根因：`collage.downloadCsvAndComparePreview` 的 comparison artifact 顯示 CSV 有 31 筆資料列，preview table 也有 31 筆真資料列，但 preview extractor 將 table header `["Date","MAU(帳號)"]` 同時放進 `table.header` 與 `table.rows[0]`。舊 comparator 把 duplicated preview header row 當成資料列，且未把 CSV header `日期` 與 preview header `Date` 視為同一個日期欄，造成 `CSV_PREVIEW_COMPARISON_MISMATCH` false fail。
- A-04 修正：新增 `agent/src/csv-preview-comparison.ts`，集中 CSV parser 與 preview comparison；table comparison 會移除 duplicated header row，header comparison 會正規化 `Date`/`日期`，cell comparison 保留日期與數字正規化。`bi-ui-helper-executor` 改用同一個 helper，`verify-helper-report-gate` 新增 A-04 回歸 fixture，鎖住 31 筆資料列不應因 duplicated header 與日期欄名語言差異誤判。
- A-05 根因：helper execution plan 已包含 H5 `collage.saveReport` 與 H6 `collage.reopenReport`，且 H5 標示 `requiresToolBridge=true`；safe helper pre-run 完成 H1-H4 後，Codex 沒有送出 Tool Bridge request，也沒有讓 Agent auto-approval 接手執行 pending H5/H6，最後直接以 evidence insufficient 標 BLOCKED。這是 UAT tool 控制流程 bug，不是 BI 行為本身。
- A-05 修正：`helper-pre-runner` 新增 `collectPendingHelperToolBridgeRequests()`，會依 current helper plan 與已完成 helper reports 找出第一個 pending required Tool Bridge action。`task-runner` 在 safe helper pre-run 後若 `auto_approve_tool_requests=true`，會產生 Agent-owned auto approval record，送出 `run.tool_request` / `tool_response.delivered` 事件，接著直接跑 `runHelperContinuationAfterApprovals()`，把 H5/H6 evidence 寫入 `output/helper-continuation-summary.json`，並在 Codex prompt/run brief 明確要求判定前讀取該 current-run evidence。
- 版本與文件：root app 升到 `1.1.1`，Mac Agent 升到 `0.2.1`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步補上 CSV header/date normalization 與 helper-plan pending Tool Bridge auto continuation。
- 驗證：本次新增的 `verify:helper-report-gate` fixture 覆蓋 A-04 false mismatch 與 A-05 pending helper Tool Bridge detection。完整 typecheck/build/verify、commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-04 00:20 - OTTEST002_26 follow-up：A-05 既有報表欄位 exact reconciliation

- 背景：Tommy 檢查 run archive `f9104c1e-e7d9-4da9-bb59-98248f012073` 後，A-04/A-05 流程已正常；但回看 A-05 helper evidence 發現覆寫 save body 出現 `NEW_ACCOUNTS` 重複，reopen DOM 也顯示兩個「新增帳號數」加一個「總營收(TWD)」。此問題不影響該輪「日期重開還原失敗」的 FAIL 判定，但會污染 A-05 對「修改欄位後覆寫」的欄位 evidence。
- 根因：`collage.configureMetric` 的 `selectedFieldText()` 只讀 `#fieldSelectionContainer`，而目前 BI editor 該 selector 回 null；helper 因此看不到既有報表原本已有「新增帳號數」，在 A-05 開既有報表後又追加了一次「新增帳號數」與「總營收(TWD)」。
- 修正：`bi-ui-helper-executor` 新增 selected-field DOM fallback，透過 read-only DOM 讀取可見 `removeFieldFromSelection(...)` / `btn-remove-field` 按鈕，取得已選欄位 label/code；`configureMetric` 改為 `reconcileMetricFieldsThroughUi()`，先用真實 UI 點「×」移除多餘或重複欄位，再用正常 `+ 新增欄位` picker 補缺少欄位。`readStateDelta.checks.field` 也改為 selected field exact match，不再只用 body text contains 判定欄位對齊。
- 版本與文件：Mac Agent 升到 `0.2.2`，root app 維持 `1.1.1`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 Agent version 與 existing-report field exact reconciliation。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:helper-report-gate`、`npm run verify:capability-gate`。完整 verify、commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-04 01:58 - OTTEST002_27 follow-up：PASS 與 helper false check 矛盾擋上傳

- 背景：Tommy 提供 run archive `e92f4869-cbd8-4d48-b3f1-f5b7d0f83ea5` 後，確認 A-05 欄位重複已修正：`collage.configureMetric` 的 selected fields 與 save POST body 都只包含 `新增帳號數 / NEW_ACCOUNTS`、`總營收(TWD) / TOTAL_REVENUE`，沒有重複 `NEW_ACCOUNTS`。但 workbook 仍把 A-05 寫成 `PASS`，與 helper evidence 不一致。
- A-05 新觀察：`collage.reopenReport-latest.json` 的 `reopenReportEvidence.stateDelta.after.checks.dateRange=false`，reopen 後 DOM 顯示 `過去7天`，預期仍是 `2026/03/01~2026/03/31`。因此 A-05 應與 A-01 同類，至少不能 PASS；這是 Codex result 判定與 helper evidence 矛盾，不是 field reconciliation 還沒生效。
- 根因：Agent self-check 過去只驗 result workbook schema、detail_json core fields 與 evidence presence；沒有讀同一 run helper report 的 semantic state checks。因此 Codex 即使在 `detail_json` 宣稱「時間區間維持」，只要 JSON 欄位完整，仍可上傳成 PASS。
- 修正：`agent/src/result-contract.ts` 新增 `ResultContractOptions.runDir`，PASS row 會讀取 `output/helper-artifacts/<case>/collage.configureMetric-latest.json` 與 `collage.reopenReport-latest.json`。若 helper 的 `stateDelta.after.checks` 任一 expected state 為 false，self-check 產生 `RESULT_PASS_CONTRADICTS_HELPER_EVIDENCE` error 並阻止 upload/ingest。`task-runner` 上傳前改用 `{ runDir }` 呼叫 self-check。
- Fixture：`verify-agent-result-contract` 新增 PASS workbook + A-05 reopen helper `dateRange=false` fixture，確認 `PASS result contradicting helper false checks is rejected before upload`。
- 實際 run 回驗：用同一版 self-check 檢查 `e92f4869-cbd8-4d48-b3f1-f5b7d0f83ea5/output/result.xlsx`，結果為 `status=error`，issue code `RESULT_PASS_CONTRADICTS_HELPER_EVIDENCE`，falseChecks=`dateRange`，helperReport=`output/helper-artifacts/TOOL-A-05/collage.reopenReport-latest.json`。
- 版本與文件：Mac Agent 升到 `0.2.3`，root app 維持 `1.1.1`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 Agent version 與 PASS-vs-helper-false-check gate。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:helper-report-gate`、`npm run verify:capability-gate`、`npm run verify:helper-hints`、`npm run verify:package-consistency`、`npm run verify:final-aggregate-result`、`npm run verify:case-advance-policy`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 通過。commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-05 03:10 - OTTEST004 pre-run P0：partial aggregate、Tool Bridge evidence 與 preview-only helper guard

- 背景：OTTEST004 v1.2 準備大測前，Tommy 指出上一輪 44 題在剩 8 題時中斷，下載 xlsx 曾容易落到單題 raw result，且新版 testcase 有 D0/preview-only 與 PM skip 類 case，工具側需先避免 helper 誤跑 save/reopen 或把 `不影響` 當 UI 目標。
- Result download 修正：`GET /api/runs/:id/output/result-xlsx` 現在每次先從 normalized server state 產生 aggregate。全部 case terminal 時輸出 `aggregate_mode=final`；run failed/cancelled/interrupted 但已有 completed case rows 時輸出 `aggregate_mode=partial`，保留 PENDING/MANUAL_PENDING row。只有沒有任何 normalized case result 時才 fallback 到 raw `result.xlsx`。
- Evidence gate 修正：`TOOL_BRIDGE_RESPONSE_MISSING` 不再只看 Codex detail_json 內文。若同一 run 的 `tool_response.sent` / `tool_response.delivered` event 可依 request_id/case 對到該 case，即視為 current-run Tool Bridge response evidence，避免 Agent auto-approval 已發生但 Codex 沒手抄 response id 時被誤擋。
- Helper plan 修正：`helperHints.params.scope=preview_only`、`skipSave/doNotSave/noSave`、`skipReopen/doNotReopen/noReopen` 會壓掉 `collage.saveReport` / `collage.reopenReport`，即使 operationTemplate 名稱是 `collage_build_preview_save_reopen` 或步驟文字含儲存/重開。`不影響`、`不限`、`N/A`、`0組` 等 neutral cleanup target 不再進入 date picker / display / field target；`setDatePreset` 對 neutral preset 直接 skip，不再回 `DATE_RANGE_PRESET_NOT_FOUND`。
- PM skip 分類：summary 與 MD export 新增 classified count，將 detail_json 含 `skip_reason` / `本輪不執行` / PM 主動跳過的 `BLOCKED` 顯示為 `PM_SKIPPED`，避免與 runtime BLOCKED 混在一起；xlsx 原始 status 仍保留 `BLOCKED` 以符合既有欄位規則。
- 版本與文件：root app 升到 `1.1.2`，Mac Agent 升到 `0.2.4`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 final/partial aggregate、Tool Bridge run-event evidence gate、preview-only helper skip guard 與 Agent version。
- 驗證與部署：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-hints`、`npm run verify:helper-report-gate`、`npm run verify:package-consistency`、`npm run verify:agent-result-contract`、`npm run verify:case-advance-policy`、`npm run verify:result-evidence-gate`、`npm run verify:final-aggregate-result`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 通過。commit `932c266` 已推 `refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp`；Railway production `/version` 為 App `1.1.2` / commit `932c266` / deployment `861440d8-e4ed-44d3-a160-bc773b8a47b1`，`/health` healthy。本機 `com.tommy.uat-agent` 已重啟至 pid `51556`，Agent package version `0.2.4`。

### 2026-05-05 04:05 - OTTEST004 gate follow-up：inline 狀態清理解析誤判修正

- 背景：Tommy 啟動 OTTEST004 run `78d45a05-1f81-46f2-bb01-22358f80e389` 後，第一題 A-01 在 Step 0 被 Tool Bridge `ambiguity_decision` 擋下，原因為 `input/test-package-consistency.json status=error`，其中 44 題都被標 `CLEANUP_CHECKLIST_CONFLICT`。
- 根因：`agent/src/test-package-consistency.ts` 的 `extractCleanupValue()` 只正確處理 fenced block，遇到 testcase.md 的 inline 格式 `**狀態清理**:\`欄位=...\`` 時會先吃掉該行，再往下抓第一個含 `欄位=` 的步驟或驗證文字，導致 instruction cleanup 被誤判成步驟清單，與 xlsx row 衝突。這是 tool-side parser false positive，不是 OTTEST004 testcase package 真衝突。
- 修正：`extractCleanupValue()` 先讀 `extractLabeledValue(section, "狀態清理")`，若 inline value 含 `欄位=` 即直接使用，不再落到後續步驟掃描。`scripts/verify-package-consistency-fixture.ts` 新增 inline cleanup fixture，並在後續步驟刻意放入 `欄位=新增帳號數`，鎖住「不可抓到後面步驟文字」的回歸。
- 實際 run 回驗：用同一份 OTTEST004 run input 重算 consistency，修正後 `status=warning`、`errors=0`、`CLEANUP_CHECKLIST_CONFLICT=0`；剩餘 warning 為 `D-1` 文字引用與 Helper param visibility，不阻擋 browser execution。
- 版本與文件：Mac Agent 升到 `0.2.5`，root app 維持 `1.1.2`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 Agent version 與 inline cleanup consistency parser guard。
- 驗證：已跑 OTTEST004 實際 input consistency check（修正後 `status=warning`、`errors=0`、`CLEANUP_CHECKLIST_CONFLICT=0`）、`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:package-consistency`、`npm run verify:helper-hints`、`npm run verify:capability-gate`、`npm run verify:case-advance-policy`、`npm run verify:result-evidence-gate`、`npm run verify:agent-resume`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:helper-report-gate`、`npm run verify:tool-bridge`、`npm run verify:agent-roundtrip`、`git diff --check` 通過。commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-05 09:14 - OTTEST004_003 follow-up：helper openProject 未選專案造成大量 BLOCKED

- 背景：Tommy 提供 run `12610479-3517-4ad7-a6a1-740ffbcae377` 的 report/result 後，結果顯示 44 題中 29 題 BLOCKED、14 題 PENDING、1 題 FAIL；多數 BLOCKED 都卡在 `collage.createReport` 找不到 `+ 新增報表`。
- 根因：`collage.openProject` 在 helper hints/testcase 未提供 `projectName` 時，只停在 BI 首頁並直接回 `status=ok`。實際 DOM/screenshot 顯示左側已有「拼貼test_001 / UAT_G01測試專案」，但右側仍是「請從左側選擇專案查看報表」。後續 `createReport` 在未選專案狀態下自然找不到 `+ 新增報表`，造成整輪 helper-assisted case 連鎖 BLOCKED。
- 修正：`bi-ui-helper-executor` 新增 `inferVisibleCollageProjectName()`，可從左側「拼貼模式」區段推斷第一個可見專案；`openProject` 會在沒有 explicit `projectName` 時自動點選該專案，且必須驗證後續可見「新增報表」入口才回 `ok`，否則回 blocked。`createReport` 也會先確保專案已選取，並支援 `+ 新增報表` / `新增報表` / role/button fallback，不再只用單一文字 locator。
- 延伸修正：`openExistingReport`、`reopenReport` 與清單頁 CSV row recovery 在缺少 explicit `projectName` 時也可走同一個專案選取流程，避免儲存/重開/清單下載 case 被同一前置狀態卡死。
- Fixture：`verify-helper-report-gate` 新增左側拼貼專案文字 fixture，確認未指定 `projectName` 時會推斷 `拼貼test_001`，指定 `projectName` 時仍以 explicit 值為準。
- 版本與文件：Mac Agent 升到 `0.2.6`，root app 維持 `1.1.2`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 Agent version 與 helper project auto-selection guard。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-report-gate`、`npm run verify:helper-hints`、`npm run verify:capability-gate`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate`、`npm run verify:case-advance-policy`、`npm run verify:agent-resume`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:tool-bridge`、`npm run verify:agent-roundtrip`、`git diff --check` 通過。commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-05 11:15 - Session handoff：OTTEST004_004 大量 BLOCKED 分析中 compact

- 背景：第二個名為 `續接 OTTEST002 P0` 的 Codex thread `019dea11-3757-7b72-afe2-e7e34363c2b0` 在分析 OTTEST004 run `8c87e614-5166-4f22-a9f4-675dc07f3e30` 時再次 compact stream disconnect。該 JSONL 約 21MB / 5314 行，最後兩輪 input 約 `209k`、`232k` tokens，接近 `258,400` context window。新增 handoff `docs/planning/session-handoff-2026-05-05-ottest004-blocked-next.md`，下一輪應讀 handoff 與本 planning log，不讀 raw JSONL。
- 當前狀態：production 仍是 app `1.1.2` / commit `039568c` / deployment `8289819f-d10c-4df7-923f-d992be311b79`，`/health` healthy；Mac Agent package `0.2.6`，本機 LaunchAgent `com.tommy.uat-agent` pid `74201` running。本次僅文件交接，沒有 runtime change。
- OTTEST004_004 觀察：result xlsx 44 rows，`PENDING=25`、`BLOCKED=13`、`PASS=5`、`FAIL=1`。A-02/A-03/B-01/B-09/D-01 已 PASS，代表前一版 helper project auto-selection 有改善，能進專案/editor 並跑部分 preview；這輪不能直接拿來判 BI 產品結果，主要是工具側還有缺口。
- 初步 root cause：日期快捷 preset 比對過硬，UI 已顯示 `昨日/上週/上月/過去30天`，helper 卻精準找 `昨日(快捷)`、`上週(快捷)`、`上月(快捷)`、`過去30天(快捷)`、`昨日(快捷起點)`，導致 `DATE_RANGE_PRESET_NOT_FOUND`。固定靜態日期 `2026/03/01~2026/03/31` 已可跑通（B-09 PASS），但自訂動態、半動態、90/91 天邊界仍屬 helper capability gap 或需改成 AI/manual-required。
- 其他待修：metadata dropdown source scope/expected 解析仍不穩，A-01/A-04/B-02 出現 expected empty，A-05 把 `雙平台營收佔比` 對到 all-items fallback，actual 80 vs expected 2；D-02 的 `helperHints.params.selectAllFields=true` 被誤解析成要點擊文字 `4 來源報表全選 72 欄`，應改走全選欄位流程。
- 下一輪建議順序：先修 date preset normalization，降低 B 群快捷日期 false BLOCKED；接著處理 dynamic/half-dynamic date support 或 plan 分流；再修 metadata source scope；最後修 D-02 selectAllFields。每項 runtime/helper change 都需同步 README、refactor docs、本 planning log，並跑 typecheck/build/verify、部署、重啟 Agent。

### 2026-05-05 11:35 - OTTEST004_004 recovery：manual_ai gate、日期快捷正規化、selectAllFields params

- 背景：新開的 `重新評估 OTTEST004 跑測結果` thread `019df622-9940-7a73-992f-c64c8a7d98b8` 只 411 行 / 1.4MB，但因連續讀取 run/report/log 與大型 diff，最後 input 仍升到約 `244k` tokens 並在 remote compact stream 斷線。該 thread 掛掉前留下未 commit runtime diff，本次接手補完並驗證。
- 根因補充：除了 handoff 已列的日期 preset 與 D-02 selectAllFields，真正更上層的問題是 `automationLevel=manual_ai` / `operationTemplate=manual_ai` 沒被 capability gate 與 helper plan 尊重，導致 B-03/B-04 這類本來要 Codex visible UI 判斷的 case 也被 helper pre-run，進而因 `昨日(快捷)` 這類 testcase 設計文字 false BLOCKED。另 `helperHints.params.selectAllFields/sourceReports/expectedFieldCount/dateRange object/doNotDownloadCsv` 沒完整傳進 helper action params，造成 D-02 synthetic cleanup text `4 來源報表全選 72 欄` 被當成真實欄位點擊。
- 修正：`capability-gate` 對 `manual_ai` 改為 `supportStatus=degraded`、`executionMode=codex_visible_ui`、`helperPreRunAllowed=false`；`helper-execution-plan` 對 manual_ai 不再產生 helper actions，並保留 `selectAllFields`、`sourceReports`、`expectedFieldCount`、`dateVariants`、dateRange object、`skipSave/skipReopen/skipDownload` 等 helper params。`setDatePreset()` 會把 `昨日(快捷)`、`上週(快捷)`、`上月(快捷)`、`過去30天(快捷)`、`昨日(快捷起點)` 正規化成 UI 可見 label 後再點擊。`collage.configureMetric` 新增 select-all fields 分支，優先從 metadata 依 `sourceReports` 解析預期欄位並透過真實 UI 逐欄選取，不再點擊 `4 來源報表全選 72 欄`。
- Fixture：`verify:capability-gate` 新增 `manual_ai cases disable helper pre-run and build no helper actions` 與 `selectAllFields helper hints preserve sourceReports/expected count and avoid synthetic field text`。
- 版本與文件：Mac Agent 升到 `0.2.7`，root app 維持 `1.1.2`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 Agent version、manual_ai helper pre-run guard 與 select-all fields params guard。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run typecheck`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-hints`、`npm run verify:helper-report-gate`、`npm run verify:capability-gate`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:case-advance-policy`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 通過。commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-05 12:01 - OTTEST004_004 follow-up：metadata source scope 與動態日期分流硬化

- 背景：完成 `9c42683` 排查後，仍需處理下一輪會遇到的殘留項目：A-01/A-04/A-05/B-02 metadata helper 不能再因 top-level helper params 未傳入、expected empty 或 source group 缺失而 false BLOCKED；B 群 multi-variant / dynamic / half-dynamic 日期 case 不能再被單一 `collage.configureMetric` helper pre-run 誤跑。
- 修正：`helper-hints` 會把 metadata compare 所需的 top-level `referenceCsv/referenceSourceName/referenceIndexKey/matchKey/compareFields/expectedReportSources/expectedTotalFieldCount` 合併進 helper params，讓 run packet 與 helper plan 都保留對照依據。`collage.extractMetadataDropdownFields` 新增 source-list 模式與 all-sources 模式：A-01 類 case 比對 distinct source groups；B-02 類 case 依 expected sources scope 欄位；A-05 類指定 source group 若 UI 沒有該 group，不再使用 all-items fallback，而是記錄 `missingSourceReports` 或用 expected field name fallback 產出可判定的 missing/extra evidence。
- 日期分流：`capability-gate` 與 `helper-execution-plan` 會把 multi-variant、動態 offset、半動態、90/91 天邊界與連續切換日期 case 降級為 `codex_visible_ui`，並禁止 helper pre-run。這保護 B-03~B-12 類 case 不會被 helper 先行 false BLOCKED；若未來要全自動化，需要另做真正的 dynamic date UI helper。
- Fixture：`verify:helper-hints` 新增 metadata top-level params merge 檢查；`verify:capability-gate` 新增 multi-variant date helper hints must degrade to Codex visible UI。另用 OTTEST004 `8c87...` input 抽樣確認 A-01/A-04/A-05/B-02/D-02 params 與 B-03 gate/plan 會按新版邏輯生成。
- 版本與文件：Mac Agent 升到 `0.2.8`，root app 維持 `1.1.2`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 metadata expected-source fallback、multi-variant date visible-UI routing guard 與 Agent version。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run typecheck`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-hints`、`npm run verify:capability-gate`、`npm run verify:helper-report-gate`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:case-advance-policy`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 通過；另用 OTTEST004 `8c87...` input 抽樣確認 metadata params、D-02 select-all params 與 B-03 gate/plan。commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-05 12:24 - OTTEST004 testcase authoring contract：日期、metadata scope、selectAllFields 結構化

- 背景：OTTEST004 false BLOCKED 除了工具側 helper/gate 缺口，也暴露 testcase 撰寫會把 UI label、測試意圖與 helper params 混在自然語言中。工具已在 `b7ee326` 加強容錯，但後續測試包應從 authoring 規範層避免同類問題。
- 決策：正式更新 `docs/authoring/UAT_三文件撰寫規則.md`，要求日期 UI label 不得混入 `(快捷)`、`(快捷起點)`、`(半動態)` 等註解；動態/半動態/多變體日期用 structured params，且標 `automationLevel=manual_ai` / `operationTemplate=manual_ai`。metadata case 必填 `comparisonScope`、`expectedReportSources`、`matchKey`、`compareFields` 與 expected count；欄位全選 case 改用 `selectAllFields/sourceReports/expectedFieldCount`，不可把「4 來源報表全選 72 欄」當可點擊文字。
- 交接文件：新增 `docs/planning/ottest004-testcase-authoring-adjustment-request.md`，可直接交給 Claude 調整 OTTEST004 testcase / companion md / authoring spec。
- 驗證：本次為 docs-only authoring contract 更新，已跑 `git diff --check`；不需重跑 TypeScript/build，也不需 Railway redeploy 或 Mac Agent 重啟。

### 2026-05-05 14:29 - OTTEST004_claude_v1_3 run follow-up：source scope、D-02 選欄辨識、Codex MCP preflight

- 背景：Claude 依 authoring contract 產出 OTTEST004 v1.3 後，production run `2ae665fc-e021-4fc6-bf89-ca7d068ff0ba` 仍出現 `PASS=1`、`FAIL=2`、`BLOCKED=16`、`PENDING=25` 並被取消。這輪不讀 raw session JSONL，只讀 report/archive/xlsx 與 run 產物摘要；結論是 0.2.8 尚未真正修完，主要 false BLOCKED 仍在工具側。
- 根因：第一層是 Codex visible UI case 沒有先嘗試 Playwright MCP `browser_tabs`，直接把可用 browser tool 誤判為 `TOOL_EXECUTION_UNAVAILABLE`。第二層是 metadata helper params 在 `helper-execution-plan` 到 `bi-ui-helper-executor` 之間仍被稀釋：source-specific `expectedFieldCount` 被當成 all-source total count，導致 A-04/A-05 類 case 又落回 4 來源/全欄位對照。第三層是 D-02 selected-field 讀取太粗，已選欄位的 remove button code（例如 `MAX_CCU`）與鄰近 label 沒正規化對齊，可能把已選欄位誤判為缺失或合併到 unrelated label。
- 修正：`helper-execution-plan` 現在保留並傳遞 `comparisonScope/referenceSourcePath/expectedReportSources/expectedReportSourceCount/expectedFieldCount/expectedTotalFieldCount/sourceReports/sourceReport/compareFields`，且 select-all + 多來源時不再從自然語言推導 synthetic `source`。`collage.extractMetadataDropdownFields` 明確分離 source-specific `expectedFieldCount` 與 all-source `expectedTotalFieldCount`，並加 mismatch warning；`collage.configureMetric` 的 selected-field matcher 會正規化 `_/-` 與 code-vs-label，並用 remove button 附近可見文字辨識欄位。`task-runner` 與 preflight guidance 要求 Codex visible UI 先呼叫 `browser_tabs`，`doctor` 也改用 `codex mcp list` 將已 enabled 的 Playwright MCP 視為 available。
- Fixture：`verify:helper-hints` 新增 `**Helper hints**:` bold label parsing；`verify:capability-gate` 新增 metadata source-scope params forwarding、source-specific vs all-source expected-field reader、selectAllFields params preservation。另以 Codex MCP smoke 確認 `browser_tabs` 可被呼叫並回傳 tab list。
- 版本與文件：Mac Agent 升到 `0.2.9`，root app 維持 `1.1.2`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 Agent version、metadata source-scope count guard、selected-field code-label reconciliation 與 Playwright browser_tabs availability guard。
- 驗證：已跑 `npm run verify:helper-hints`、`npm run verify:capability-gate`、`npm run verify:all`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:agent-resume`、`npm run verify:package-consistency`、`node agent/dist/cli.js doctor`、Codex MCP `browser_tabs` smoke、`git diff --check`。commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。
