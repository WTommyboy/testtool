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
