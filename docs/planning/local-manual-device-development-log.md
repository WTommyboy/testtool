# 本機手動端開發與規劃日誌

最後更新：2026-04-29

本文件記錄「Tommy 本機手動 Codex 跑 UAT」這條路徑的歷史決策、設計理由、目前流程與後續待辦。它的用途是跨聊天室、跨 session 交接，不取代 `AGENTS.md`、`BI_TEST_RULES/` 或 authoring spec。

每次修改本機手動流程、prompt 產生器、demo 簡報或測試啟動方式時，請同步更新本文件。

---

## 1. 範圍

本文件只涵蓋本機手動端：

- Tommy 在 `/Users/tommy/Downloads/codex_galaxy` 開 Codex。
- Codex 透過 Playwright MCP 直接操作 Galaxy BI DEV UI。
- 測試結果可直接寫回本機 `BI_UAT_ROUNDS/<輪次>/<測試案例>.xlsx`。
- 使用本機工具，例如 `outputs/update_case_result.mjs`、`outputs/dump_case_rows.mjs`、`outputs/generate_current_case_prompt.mjs`、`outputs/generate_active_case_prompt.mjs`。

不涵蓋：

- Railway / Web UI run 派工。
- Mac Agent run workspace。
- Tool Bridge 授權封包。
- 線上系統 `input/run-brief.md`、`input/current-case.json`、`output/result.xlsx` 的交付流程。

線上工具路徑請看：

- `/Users/tommy/Downloads/codex_galaxy/uat-tool/docs/planning/online-uat-tool-development-log.md`

---

## 2. 為什麼需要這份日誌

過去本機手動 UAT 主要靠聊天歷史和 Codex 當下讀完整規則文件來維持紀律。這在短任務可行，但在 MR003、DEMO001 這類長輪次會出現幾個問題：

1. Codex 每次開工會全文讀 `AGENTS.md`、`BI_TEST_RULES/`、方法論、背景知識，耗時很長。
2. 長對話累積後觸發 compact，甚至出現 remote compact stream disconnect。
3. Codex 容易把不同輪次或不同 case 的 baseline、evidence、狀態混在一起。
4. Tommy 要不斷重貼上下文，AI 的效率被手動交接抵消。
5. 規則太長時，Codex 會花大量 token 在「讀規則」而不是「執行 case」。

因此本機手動端的優化目標不是放鬆規則，而是把「每題真正需要的上下文」預先編譯好，讓 Codex 快速進入 UI 執行，同時保留永久紅線。

---

## 3. 歷史決策時間線

### 3.1 長提示詞方案被視為過渡

最早的低成本方案是給 Codex 一段完整長提示詞，要求它只讀指定文件、不要全文掃規則。這能立即試跑，但本質上仍把決策責任丟給 Codex：

- Codex 要自己判斷哪些規則該讀。
- Codex 要自己判斷哪些文件過期。
- Codex 仍可能被長上下文拖慢。

結論：長提示詞只適合臨時示範，不適合穩定跑 20、80 題以上的輪次。

### 3.2 改成 `current_case_prompt_<CASE_ID>.md`

後來決定把每題需要的資訊預先產成一份 Markdown：

- `current_case_prompt_DEMO-A-01.md`
- `current_case_prompt_DEMO-B-01.md`

這份檔案只包含單一 case 的最小執行包：

- DEV URL。
- 本輪三文件位置。
- 當前 case row 摘要。
- 狀態清理要求。
- 本題需要的規則摘要。
- evidence 要求。
- xlsx 寫回規則。
- 授權與紅線聲明。

新增工具：

- `/Users/tommy/Downloads/codex_galaxy/outputs/generate_current_case_prompt.mjs`

設計理由：

- 降低 token。
- 降低讀檔時間。
- 降低誤讀舊規則風險。
- 降低跨題混跑風險。
- 對齊未來線上工具的 `current-case` / `run-brief` / `rule-index` 架構。

### 3.3 Claude 回饋後新增 Scope 與 xlsx 綁定防呆

Tommy 將 `current_case_prompt` 做法給 Claude 看。Claude 贊成方向，但要求兩個防呆。這兩點已納入產生器設計。

#### Scope 聲明

每份 `current_case_prompt` 開頭必須聲明：

- 本檔只包含單題資訊。
- 本檔不取代永久紅線。
- `AGENTS.md` / rules 仍是 source of truth。
- 不可因為本檔沒寫禁止事項，就假設可以做。

必須重申的紅線摘要：

- 不可直接打 BI API 取代 UI。
- 不可用內部 JS setter 設定狀態。
- 不可多題混跑。
- 不可一次寫多題。
- stale evidence 不採信。
- 每題必須有 current-run evidence。
- 不可逆操作、SSO、native alert/confirm 必須停下請求授權。

#### xlsx 版本綁定

每份 prompt 必須寫入：

- source xlsx path。
- source xlsx mtime / mtimeMs。
- source xlsx sha256。
- generated at。
- generator version。

Codex 開工前要比對 source xlsx 的 mtime / sha256。不一致就停下要求重產，不可硬跑。

理由：每跑完一題會寫回 xlsx，xlsx hash 會變。若 B-01 prompt 是 A-01 寫回前產生的，B-01 prompt 就是過期衍生檔。

### 3.4 單題 prompt 仍不夠，改成 ACTIVE runner

Tommy 指出：如果 80 題要手動一題一題產 prompt、手動換路徑，就失去 AI 優勢。

因此本機流程改成 ACTIVE runner。

固定檔案：

- `current_case_prompt_ACTIVE.md`
- `current_case_prompt_RUNNER.md`
- `current_case_prompt_RUN_STATE.json`

新增工具：

- `/Users/tommy/Downloads/codex_galaxy/outputs/generate_active_case_prompt.mjs`

核心設計：

- 使用者只初始化 queue 一次。
- Codex 永遠讀同一個固定路徑：`current_case_prompt_ACTIVE.md`。
- ACTIVE 只代表當前一題。
- 其他 case id 存在 `current_case_prompt_RUN_STATE.json` queue 裡。
- Codex 跑完當前 case、寫回 xlsx、dump 驗證後，自己執行 runner。
- runner 重新讀 xlsx，更新 ACTIVE 到下一題。
- Tommy 不需要手動產下一題，也不需要手動換 prompt 路徑。

這是刻意設計，不是漏產 B/C/D。若一開始就產 B/C/D，A-01 寫回後 B/C/D prompt 的 hash 會全部過期。

### 3.5 DEMO001 試跑觀察

Tommy 曾初始化 DEMO001 queue：

```bash
cd /Users/tommy/Downloads/codex_galaxy

node /Users/tommy/Downloads/codex_galaxy/outputs/generate_active_case_prompt.mjs \
  "/Users/tommy/Downloads/codex_galaxy/BI_UAT_ROUNDS/DEMO001_工程團隊示範/DEMO_BI示範_測試案例_v1_4.xlsx" \
  DEMO-A-01 DEMO-B-01 DEMO-C-01 DEMO-D-01 \
  --reset
```

runner 回報：

- active case: `DEMO-A-01`
- queue progress: `1/4`
- queue 內包含 `DEMO-A-01`、`DEMO-B-01`、`DEMO-C-01`、`DEMO-D-01`

Tommy 也曾測過 DEMO-A-01。該次測試有寫入 xlsx 結果，也建立過臨時報表：

- report name: `DEMO_A01_新增帳號趨勢_0428_165402`
- reportId: `33`

後續 Tommy 表示會手動清 xlsx。若未來要重跑 DEMO001，必須先確認 xlsx 是否已清乾淨，並重新 runner reset。

### 3.6 local-manual-demo 簡報已更新到 ACTIVE runner 版本

流程從單題 prompt 改成 ACTIVE runner 後，示範簡報也需要同步。

已更新過：

- `/Users/tommy/Downloads/codex_galaxy/outputs/presentations/local-manual-demo/src/create_deck.js`
- `local-manual-demo.pptx`
- slide preview png

簡報應呈現：

- 使用者只初始化 queue 一次。
- Codex 固定讀 `current_case_prompt_ACTIVE.md`。
- Codex 每題完成後自己呼叫 runner 更新 ACTIVE。
- 不需要 Tommy 每題手動換 prompt 或檔名。

---

## 4. 目前推薦的本機手動流程

### 4.1 初始化 queue

```bash
cd /Users/tommy/Downloads/codex_galaxy

node /Users/tommy/Downloads/codex_galaxy/outputs/generate_active_case_prompt.mjs \
  "<本輪 xlsx 絕對路徑>" \
  <CASE-01> <CASE-02> <CASE-03> \
  --reset
```

若不傳 case id，runner 可把 xlsx 內所有 case 排進 queue。但實務上建議先指定本次要跑的範圍。

### 4.2 給 Codex 的固定啟動提示詞

```text
請執行本機 UAT active prompt runner，依序跑完 queue 內所有 case。

固定讀取 ACTIVE prompt：
<本輪資料夾>/current_case_prompt_ACTIVE.md

整個 queue 執行期間，不要要求 Tommy 手動重產 prompt、不要要求 Tommy 手動換檔名、不要要求 Tommy 手動指定下一題。

執行方式：
1. 先讀 ACTIVE prompt。
2. 只執行 ACTIVE prompt 指定的單一 case。
3. 跑完該 case 後，寫回 xlsx，並 dump 讀回驗證。
4. 完成該 case 後，由你自己執行 runner nextCommand 更新 ACTIVE prompt。
5. 如果 runner 回報 completed=false，立刻重新讀取同一個 ACTIVE prompt 路徑，繼續下一題。
6. 如果 runner 回報 completed=true，才輸出總結並停止。

禁止全文讀 AGENTS.md / 方法論 / 背景知識；除非 ACTIVE prompt 明確要求，否則不要讀其他規則文件。
禁止一次跑多題或一次寫多題。
每題開始前只相信 ACTIVE prompt 的當前 case，不使用上一題 evidence。
```

### 4.3 Codex 每題必做

每一題都必須：

1. 讀 ACTIVE prompt。
2. 做 prompt 內的 xlsx mtime / sha256 同步檢查。
3. 只執行 ACTIVE 指定 case。
4. 透過真實 UI 設定狀態，不可用內部 JS setter。
5. 讀取 current-run evidence。
6. 依測試標的 / 風險等級 / 狀態清理規則判定。
7. 寫回 xlsx 單一 row。
8. dump 該 row 讀回驗證。
9. 自己呼叫 runner 更新 ACTIVE。

---

## 5. 本機端規則讀取策略

本機手動端不再要求 Codex 開場全文讀：

- `AGENTS.md`
- `BI_TEST_RULES/*`
- 方法論
- 背景知識

但這不代表規則失效。

新的策略是：

- `AGENTS.md` / `BI_TEST_RULES/` / authoring spec 仍是 source of truth。
- prompt 產生器把當前 case 必要規則摘要編進 ACTIVE prompt。
- Codex 執行時主要讀 ACTIVE prompt。
- 只有 ACTIVE prompt 明確要求，或遇到灰區，才補讀特定規則章節。

目標是減少重複讀檔，不是放鬆紀律。

---

## 6. 半腳本化 / helper 化決策

Tommy 曾提出：是否應該把流程改成腳本？

最後決策是：本專案採「半腳本化 / helper 化」，不採「整題固定 Playwright 腳本化」。

### 可以腳本化

低風險、機械、可重複的部分：

- xlsx 解析。
- ACTIVE prompt 產生。
- xlsx 寫回。
- dump 驗證。
- CSV 計算。
- Chart.js 數值抽取。
- metadata 清單比對。
- stale evidence 標註。
- xlsx mtime / sha256 比對。

### 可以 helper 化

仍透過真實 UI 操作，但可封裝單一 case 內的重複流程：

- 清空篩選。
- 加欄位。
- 選欄位。
- 選 operator。
- 輸入 value。
- 設日期。
- 改顯示方式。
- 按執行。
- 抓 request body / response metadata。
- 抓 chart data。

### 禁止

不可走成固定 Playwright 全自動測試腳本：

- 不可整份 testcase 一支 script 跑完。
- 不可整群 D/E/F/G 一次批次跑。
- 不可一次寫多題。
- 不可 helper 直接判 PASS/FAIL。
- 不可直接打 BI API 取代 UI。
- 不可用 `window.addFilter`、`updateFilter`、`selectDateRangePreset` 等內部 setter 設狀態。

理由：要加速機械部分，但保留 Codex 對 spec、灰區、UI 異常、延伸驗證、detail_json 的判斷能力。

---

## 7. 與 testcase authoring spec 的關係

Tommy 提供 `UAT_三文件撰寫規則.md` 後，決定不另起新規範，而是升級它為唯一 authoring spec。

已更新：

- `/Users/tommy/Downloads/codex_galaxy/uat-tool/docs/authoring/UAT_三文件撰寫規則.md`

關鍵設計：

- 維持 xlsx 核心 16 欄，不先強制新增欄位，避免 Claude 產 testcase 變太難。
- 新增 Helper hints，放在 `測試執行說明_*.md` 每題底下。
- Helper hints 可描述：
  - `automationLevel`
  - `operationTemplate`
  - `params`
  - `requiredEvidence`
- Helper hints 是輔助，不是授權，也不是全自動執行腳本。

本機 prompt 產生器後續應讀取或承接 Helper hints，將其轉成 ACTIVE prompt 裡的執行輔助資訊。

---

## 8. 目前相關檔案

本機端產生器：

- `/Users/tommy/Downloads/codex_galaxy/outputs/generate_current_case_prompt.mjs`
- `/Users/tommy/Downloads/codex_galaxy/outputs/generate_active_case_prompt.mjs`

本機 xlsx 工具：

- `/Users/tommy/Downloads/codex_galaxy/outputs/update_case_result.mjs`
- `/Users/tommy/Downloads/codex_galaxy/outputs/dump_case_rows.mjs`
- `/Users/tommy/Downloads/codex_galaxy/outputs/update_bug_row.mjs`
- `/Users/tommy/Downloads/codex_galaxy/outputs/append_bug_row.mjs`

authoring spec：

- `/Users/tommy/Downloads/codex_galaxy/uat-tool/docs/authoring/UAT_三文件撰寫規則.md`

DEMO round：

- `/Users/tommy/Downloads/codex_galaxy/BI_UAT_ROUNDS/DEMO001_工程團隊示範/DEMO_BI示範_測試案例_v1_4.xlsx`

示範簡報：

- `/Users/tommy/Downloads/codex_galaxy/outputs/presentations/local-manual-demo/src/create_deck.js`

---

## 9. 不可回退的紅線

本機手動端即使使用 ACTIVE prompt 和 helper，也必須維持：

- 不可直接打 BI API 取得測試結果。
- API / network 只能觀察 UI 觸發了什麼，不能取代 UI。
- 不可寫爬蟲腳本繞 UI 取得 BI 資料。
- 不可用內部 JS setter 設定測試狀態。
- `browser_evaluate` / `page.evaluate` 只允許讀取，不可用來點擊、改狀態、繞安全層。
- 不可一次 tool call 包含多個 case 的執行邏輯。
- 不可累積多題結果一次寫 xlsx。
- 每題跑完必須立刻寫回 xlsx 並 dump 驗證。
- 每題開始前只相信 current-run evidence，不採信 stale evidence。
- xlsx 步驟欄指定值不可自行替換。
- 不可逆操作要先明確說明影響範圍並取得 Tommy 授權。
- 若測試標的、風險等級、狀態清理欄存在，必須依規則判定。
- Playwright session 掛掉時，不可改用桌面 Chrome 接手正式 case。

---

## 10. 待辦

### P0

- 讓 `generate_current_case_prompt.mjs` 能讀取或承接 `測試執行說明_*.md` 中的 Helper hints。
- 讓 ACTIVE prompt 顯示 helper guidance，但明確標示 helper 不能跨 case、不能判結果。
- 確認 ACTIVE runner 在 case 寫回後能穩定切下一題，不要求 Tommy 人工操作。

### P1

- 補一個「初始化 queue + 產 ACTIVE + 顯示固定啟動提示詞」的更友善 CLI output。
- 增加 prompt 產生器對 xlsx 欄位缺漏的錯誤訊息。
- 增加「預覽 queue」模式，讓 Tommy 可確認 queue 內容，但不產過期 prompt。

### P2

- 將常見 helper template 定義成資料檔，而不是散在 prompt 文字中。
- 本機端與線上工具共用 helper template / required evidence vocabulary。
- 將 local-manual-demo 簡報更新機制納入固定驗證清單。

---

## 11. 日誌更新格式

後續每次更新本機端流程，請在本節下方追加：

```md
### YYYY-MM-DD HH:mm - 標題

- 背景：
- 決策：
- 修改檔案：
- 驗證：
- 後續影響：
```

### 2026-04-29 - 建立本機手動端開發與規劃日誌

- 背景：原聊天歷史過長且 compact 失敗，不能再靠聊天上下文交接。
- 決策：將本機手動端與線上工具端拆成兩份 planning log，長期維護。
- 修改檔案：新增本文件。
- 驗證：文件建立後應可作為新聊天室交接來源。
- 後續影響：後續修改 ACTIVE runner、current case prompt、demo 簡報時都要更新本文件。

### 2026-04-29 07:56 - 本機 prompt 承接 Helper hints

- 背景：本機 current_case_prompt / ACTIVE prompt 仍只吃 xlsx row，未承接 `測試執行說明_*.md` 的 Helper hints。
- 決策：讓 `generate_current_case_prompt.mjs` 以本輪同版本「測試執行說明」為來源，解析當前 case 章節下的 `Helper hints` JSON；ACTIVE runner 仍只複製當前單題 prompt，不改成多題派工。
- 修改檔案：`outputs/generate_current_case_prompt.mjs`、`outputs/generate_active_case_prompt.mjs`。
- 驗證：`node --check` 通過；以臨時 xlsx + 臨時執行說明驗證 `current_case_prompt_DEMO-A-01.md` 會輸出 `operationTemplate` 與 `requiredEvidence`。
- 後續影響：Helper hints 只作單題 UI 操作輔助；仍禁止直接打 BI API、JS setter、多題混跑與缺 current-run evidence。

### 2026-04-29 08:06 - Helper hints 子類與 DEMO ACTIVE 節奏修正

- 背景：authoring spec 允許 `requiredEvidence` 使用 canonical 類型或子類，但本機 parser 原本只接受 exact value；另 DEMO v1_4 執行說明仍寫本機每題必停，與 ACTIVE runner 示範流程不完全一致。
- 決策：本機 parser 放寬為 `network.requestBody` 可接受 `network.requestBody.dateRange` 這類子類；DEMO v1_4 改成「一般手動可停等、ACTIVE runner 以 ACTIVE prompt 為準自行切下一題」。
- 修改檔案：`outputs/generate_current_case_prompt.mjs`、`BI_UAT_ROUNDS/DEMO001_工程團隊示範/DEMO_BI示範_測試執行說明_for_v1_4.md`。
- 驗證：待本次程式檢查一併跑；注意 DEMO v1_4 目前仍沒有實際 `Helper hints` 區塊，產 prompt 顯示未找到屬預期。
- 後續影響：短期本機 parser 與 Agent parser 各維護一份 vocabulary；中期應抽共用 vocabulary 或至少補同一組 fixture 測試避免 drift。

### 2026-04-29 08:14 - 新增 Helper hints flow fixture

- 背景：需要一個不污染 DEMO v1_4 的最小 fixture，驗證 Helper hints 可從測試執行說明流到本機 prompt 與 ACTIVE prompt。
- 決策：新增 `npm run verify:helper-hints`，腳本用暫存 round 生成最小 xlsx + `測試執行說明_for_v1_0.md`，跑完自動刪除暫存資料。
- 修改檔案：`uat-tool/scripts/verify-helper-hints-fixture.ts`、`uat-tool/package.json`。
- 驗證：`npm run verify:helper-hints` 已通過，確認 `current_case_prompt_<case>.md` 有 Helper Hints 且 `warnings：none`，`current_case_prompt_ACTIVE.md` 保留同一區塊。
- 後續影響：這個 fixture 可作為本機/Agent helper vocabulary drift 的短期防線；仍不代表 result/evidence gate 已完成。

### 2026-04-29 08:29 - ACTIVE 前測試包一致性檢查

- 背景：下一步要先擋「測試包設計矛盾」，再做 result/evidence gate；本機 ACTIVE runner 產生前也應先檢查 xlsx、Codex 指派文字、測試執行說明與 Helper hints 是否一致。
- 決策：新增 `test-package-consistency` checker，輸出 warning/error report，不自動改文件；`generate_active_case_prompt.mjs` 生成 ACTIVE prompt 前會執行 checker，若 status=error 則停止。
- 修改檔案：`uat-tool/agent/src/test-package-consistency.ts`、`uat-tool/scripts/check-test-package-consistency.ts`、`uat-tool/scripts/verify-package-consistency-fixture.ts`、`outputs/generate_active_case_prompt.mjs`、`uat-tool/package.json`。
- 驗證：`npm run verify:package-consistency` 已通過，確認好 fixture status=ok、風險等級衝突會 error、DEMO001 v1_4 無 blocking error；`npm run verify:helper-hints` 仍通過。
- 後續影響：ACTIVE runner 會在本輪資料夾輸出 `test_package_consistency_ACTIVE.json`；warning 不阻擋，error 阻擋。這仍不做 Codex result/evidence gate。

### 2026-04-29 10:35 - Result/evidence gate 最小版

- 背景：三文件 / Helper hints consistency checker 已先落地，下一步要開始擋「Codex 執行結果不合格」，避免多題寫入、缺 current-run evidence、fallback result 被誤入庫。
- 決策：新增共用 result evidence gate，重用既有 `result-xlsx-parser`，只輸出 report 與 blocking error，不自動修改 result workbook；本機側新增 `check:result-evidence` 與 fixture 驗證腳本，方便手動檢查 result.xlsx。
- 修改檔案：`uat-tool/src/result-parser/result-evidence-gate.ts`、`uat-tool/scripts/check-result-evidence-gate.ts`、`uat-tool/scripts/verify-result-evidence-gate.ts`、`uat-tool/package.json`。
- 驗證：`npm run verify:result-evidence-gate` 已通過，涵蓋單題 current-run evidence 通過、多題 result、缺 evidence、agent fallback、缺 Tool Bridge response、invalid detail_json 會被擋；`npm run typecheck --prefix uat-tool`、`npm run build --prefix uat-tool` 均通過。
- 後續影響：本機若要檢查某個 result.xlsx，可跑 `npm run check:result-evidence -- --xlsx <result.xlsx> --current-case <caseNo>`；這仍是最小 gate，後續可再把 requiredEvidence vocabulary 與 Helper hints 模板做更細對照。

### 2026-04-29 19:35 - 本機 current_case_prompt 新增 Helper Execution Plan

- 背景：Tommy 決定採用 helper-assisted UAT：helper 負責穩定 UI 操作與 evidence 收集，Codex 保留 PASS/FAIL/BLOCKED 判定與 detail_json 寫作。需要讓本機 prompt 產生器也能把 testcase row 切成「文字單題卡 + helper execution plan」。
- 決策：`generate_current_case_prompt.mjs` 在 Helper Hints 後新增 `Helper Execution Plan` 區塊，依當前 case row 推斷建議 helper actions、required evidence、Tool Bridge flags 與 optional templates。helper plan 明確標示不可寫 result.xlsx、不可判結果、不可多題批次、不可 direct BI API、不可 JS setter。
- 修改檔案：`outputs/generate_current_case_prompt.mjs`；重新產生 `BI_UAT_ROUNDS/DEMO001_工程團隊示範/current_case_prompt_DEMO-A-01.md`。
- 驗證：`node --check outputs/generate_current_case_prompt.mjs`、`node --check outputs/generate_active_case_prompt.mjs` 通過；重產 DEMO-A-01 後確認 prompt 包含 `Helper Execution Plan`、`collage.openProject`、`filter.addAndPreview` 等區塊。
- 後續影響：本機 ACTIVE runner 仍維持單題 prompt 固定入口；helper execution plan 是執行輔助，不代表 helper 已完成所有模板實作。Codex 仍須逐 case 寫回 xlsx 並 dump 驗證。
