# UAT 三文件撰寫規則

本文件規範每輪 UAT 測試包必備三份文件的寫法：

1. `測試案例.xlsx`
2. `Codex_指派文字_*.md`
3. `測試執行說明_*.md`

目標是讓同一套測試包同時支援兩種模式：

- 本機手動 Codex 示範
- UAT Tool 線上派工 + Mac Agent

三份文件必須互相一致。若 `xlsx`、指派文字、執行說明對「起始 case」「執行範圍」「授權方式」「結果輸出」描述不一致，Agent 或 Codex 應視為文件衝突，而不是自行猜測。

---

## 1. 共通撰寫原則

### 1.1 必須先宣告執行模式

每份 `Codex_指派文字_*.md` 與 `測試執行說明_*.md` 的前段都必須包含「執行模式與檔案位置」。

建議固定模板：

```md
## 0. 執行模式與檔案位置

本文件同時支援兩種執行模式。後續 case 步驟、前置條件、測試資料、預期結果、驗證方法共用；差異只在檔案讀取、結果輸出與人工授權方式。

### A. 本機手動 Codex 示範模式

適用情境：Tommy 在本機終端機直接開 Codex，手動示範測試流程。

- cwd: `/Users/tommy/Downloads/codex_galaxy`
- 常駐規則: `/Users/tommy/Downloads/codex_galaxy/AGENTS.md`
- BI 規則: `BI_TEST_RULES/`
- metadata: `BI_DATA/metadata＿1.2.5 - 工作表1.csv`
- testcase: `<本輪資料夾>/<測試案例.xlsx>`
- 結果輸出: 可直接更新原始 testcase xlsx。
- 本機 xlsx 工具: 只有本機手動模式才可使用 `outputs/update_case_result.mjs`、`outputs/update_bug_row.mjs` 等工具。
- 人工授權: Tommy 在對話中明確授權後，Codex 才可執行不可逆操作或處理 native alert/confirm。

### B. UAT Tool 線上派工 + Mac Agent 模式

適用情境：Tommy 從線上 UAT Tool 建立 run，上傳 xlsx/md，由 Railway 派工給 Tommy Mac Agent 執行。

- Codex 不以 `/Users/tommy/Downloads/codex_galaxy` 作為主要工作目錄。
- Agent 會建立 run workspace: `~/.uat-agent/runs/<runId>/`
- Codex 必須先讀 Agent 產生的 `input/run-brief.md`。
- 起始 case 以 `input/current-case.json` 為準。
- carryover / 不可繼承狀態以 `input/run-state.json` 為準。
- Layer 1 平台規則以 `agent-skills/uat-tool/SKILL.md` 與其 rules 為準。
- BI domain reference 以 run brief 指定的 `rules/PROJECT_AGENTS_FULL.md`、`rules/BI_TEST_RULES/`、`rules/BI_DATA/metadata.csv` 或上傳 reference csv 為準。
- 結果輸出: 不可修改原始 xlsx；必須產出 `output/result.xlsx`。
- 人工授權: 只有 UAT Tool 的 Tool Bridge response 才算授權。startup instruction 或文件內寫「預先批准」不算授權。
- 若遇到 SSO、載入失敗、native alert/confirm、刪除、覆蓋、不可逆操作或規格歧義，必須輸出 Tool Bridge request 並停在安全點。

### 共通規則

- 後續 case 步驟、前置條件、測試資料、預期結果、驗證方法兩種模式共用。
- 不可直接打 BI API 取代 UI 操作。
- 不可用內部 JS setter 設定測試狀態。
- 不可把多個 case 混在一次 tool call 或一次結果寫入。
- 每個 case 必須有 current-run evidence，不能用舊頁面資料或舊 workbook 結果當證據。
```

### 1.2 起始 case 必須唯一且一致

三份文件必須對齊同一個起始 case。

允許：

- 全部文件都寫 `從 DEMO-A-01 開始`。
- 全部文件都寫 `DEMO-A-01 已由 Tommy 預先執行，本輪從 DEMO-B-01 開始`。

禁止：

- `xlsx` 第一題是 `DEMO-A-01` 且結果空白，但 `md` 寫 `A-01 已執行，從 B-01 開始`。
- 指派文字寫 `從 B-01 起跑`，執行說明寫 `執行順序 A → B → C → D`。
- xlsx 版本說明寫 `全部 4 個 case`，指派文字寫 `A=0 已執行`。

若要跳過 case，必須三份都明確表示：

- 被跳過的 case 編號。
- 跳過原因。
- 是否已寫入結果。
- 是否仍計入結果統計。
- Codex 是否禁止碰該 row。

### 1.3 不可把舊本機流程寫成 Agent 模式規則

以下句子必須標明「僅本機手動模式」：

- `直接寫入 BI_UAT_ROUNDS/...xlsx`
- `使用 update_case_result.mjs`
- `使用 update_bug_row.mjs`
- `使用 append_bug_row.mjs`
- `Codex CLI + Playwright MCP 完整工作流`
- `Tommy 在 chat 授權即可處理 alert/confirm`

Agent 模式的對應寫法：

- `Codex 輸出 output/result.xlsx`
- `Agent 上傳 result.xlsx 給 Railway`
- `Railway 解析 result.xlsx 入庫`
- `Tool Bridge response 是唯一有效授權`

### 1.4 不可在文件內預先授權 Agent

文件可以描述「本 case 預期會出現 alert/confirm」，但不可寫：

- `預先批准，直接處理`
- `不需暫停請求授權`
- `可直接接受 confirm`

正確寫法：

```md
若本機手動模式：Tommy 可在對話中明確授權後處理。
若 Agent 模式：必須輸出 Tool Bridge request，等待 UAT Tool 的 Tool Bridge response。
```

### 1.5 文件不得要求操作 DevTools UI

不要寫：

- `DevTools 已開啟 Network 面板`
- `切到 XHR 過濾`
- `切到 Console 執行 ...`

應改成 Playwright 可執行描述：

- `透過 Playwright network observation 取得 preview request body`
- `透過 read-only page.evaluate 讀取 Chart.js datasets`
- `透過 DOM / performance entries 驗證 UI action 觸發 request`

---

## 2. `測試案例.xlsx` 撰寫規則

### 2.1 必備 sheet

建議固定：

- `測試案例`
- `Bug`
- `版本說明`

### 2.2 `測試案例` 必備欄位

最低欄位：

| 欄位 | 規則 |
|---|---|
| 輪次ID | 必填，同一輪一致 |
| 群組 | 必填，格式如 `A:拼貼模式正向流程` |
| 編號 | 必填，全域唯一，如 `DEMO-A-01` |
| 測試類型 | 必填，如 `功能流程`、`資料確認(metadata 對照)`、`FAIL bug 重現` |
| 測試項目 | 必填，描述 case 目的 |
| 前置條件 | 必填，需機器可執行 |
| 步驟 | 必填，一步一動作 |
| 預期結果 | 必填，含可比對條件 |
| 結果 | 初始空白，除非真的已預先執行 |
| 執行方式 | 建議寫 `Codex + Playwright`，不要寫死單一部署模式 |
| 測試日 | 初始空白 |
| 詳細紀錄JSON | 初始空白，除非真的已預先執行 |
| 驗證方法 | 必填，寫 evidence 類型 |

### 2.3 若 case 已預先執行，xlsx 必須真的反映

如果 md 寫 `DEMO-A-01 已由 Tommy 預先執行`，xlsx 對應 row 必須：

- `結果` 已填 `PASS / FAIL / BLOCKED / PARTIAL`。
- `詳細紀錄JSON` 已填。
- `測試日` 已填。
- 若有 bug，`Bug` sheet 或外部 Dashboard 引用必須清楚。

如果 xlsx row 結果仍空白，就不得在 md 宣稱該 case 已執行。

### 2.4 前置條件寫法

前置條件應使用固定欄位式語法，避免只寫自然語言。

建議格式：

```text
起始頁面: DEV URL 首頁 / 編輯頁 / 專案頁
導航路徑: 我的自訂 > 拼貼模式 > <專案名> > +新增報表
建構模式: 拼貼 / 明細 / 指標趨勢
狀態清理:
- 欄位: 空 / 新增帳號數 / 不影響
- 篩選: 空 / <指定篩選> / 不影響
- 分組: 空 / 銀河帳號狀態 / 不適用
- 時間: 2026/03/01~2026/03/31 / 不影響
- 顯示: 每天 / 不影響
參考資料: metadata v1.2.5, 來源報表=每日報表
授權需求: 無 / 儲存時 Tool Bridge / 刪除時 Tool Bridge
```

### 2.5 步驟寫法

步驟必須一行一個 UI action，並能被 Playwright 執行。

好寫法：

```text
1. 展開左側「我的自訂」
   驗證: sidebar 顯示「拼貼模式」
2. 點擊「拼貼模式」下的目標專案
   驗證: 右側標題顯示專案名稱，且有「+ 新增報表」
3. 點「+ 新增報表」
   驗證: 進入編輯頁，建構模式顯示「拼貼」
4. 點「+ 新增欄位」
   驗證: 欄位 picker 開啟，DOM 可讀到來源報表群組
5. 讀取「每日報表」群組下所有可選欄位
   驗證: 記錄欄位名稱、統計方式、count
```

壞寫法：

```text
進入拼貼新增報表頁後確認欄位都正確。
```

### 2.6 驗證方法必須列 evidence 類型

建議用這些詞：

- `DOM read`
- `Playwright snapshot`
- `network request body`
- `network response body`
- `Chart.js datasets`
- `downloaded CSV`
- `screenshot`
- `Tool Bridge response`

不要只寫：

- `人工目視確認`
- `截圖佐證`
- `看起來正常`

### 2.7 Bug sheet 規則

若 bug 是預期重現：

- 可以預留 placeholder。
- 但要寫清楚 Agent 模式只需在 `output/result.xlsx` 的 Bug sheet 產出結果，不必修改原始 xlsx。

若本機手動模式需要更新原 xlsx，才提 `update_bug_row.mjs`。

---

## 3. `Codex_指派文字_*.md` 撰寫規則

### 3.1 角色

指派文字是「本輪任務 dispatch brief」，負責說清楚：

- 本輪要跑什麼。
- 起始 case 是哪一題。
- 哪些檔案是 source of truth。
- 哪些 case 跑完要停。
- 交付物是什麼。

它不應重複所有 BI 測試規則，也不應塞大量方法論。

### 3.2 必備章節

建議固定章節：

1. `0. 執行模式與檔案位置`
2. `1. 本輪基本資訊`
3. `2. Source of Truth`
4. `3. 執行範圍與起始 case`
5. `4. Case 清單與順序`
6. `5. 本輪特殊注意事項`
7. `6. 暫停點`
8. `7. 交付要求`
9. `8. 開工確認`

### 3.3 起始 case 寫法

必須用明確欄位，不要藏在段落中。

```md
## 3. 執行範圍與起始 case

- 總 case 數: 4
- 本輪 Codex 起始 case: DEMO-A-01
- 本輪 Codex 執行順序: DEMO-A-01 → DEMO-B-01 → DEMO-C-01 → DEMO-D-01
- 跳過 case: 無
```

如果要跳過：

```md
- 總 case 數: 4
- 本輪 Codex 起始 case: DEMO-B-01
- 本輪 Codex 執行順序: DEMO-B-01 → DEMO-C-01 → DEMO-D-01
- 跳過 case: DEMO-A-01
- 跳過原因: Tommy 已預先執行
- xlsx 狀態: DEMO-A-01 結果欄、測試日、詳細紀錄JSON 已填
- Codex 是否可修改 DEMO-A-01 row: 不可
```

### 3.4 交付要求必須分模式

```md
### 本機手動模式

- 可直接更新原始 xlsx。
- 可使用 `outputs/update_case_result.mjs`、`outputs/update_bug_row.mjs`。

### Agent 模式

- 不可修改原始 xlsx。
- 必須產出 `output/result.xlsx`。
- `output/result.xlsx` 必須包含 `索引`、`測試案例`、`Bug` sheet。
- Agent 會上傳結果並由 Railway parser 入庫。
```

### 3.5 開工確認不要要求回覆後再跑

本機手動模式可以寫「請先回報確認」。

Agent 模式不應依賴 chat roundtrip。建議寫：

```md
本機手動模式: 開工前先回報確認。
Agent 模式: 不需等待聊天確認；若 input 檔案完整且 preflight 通過，直接從 current-case.json 指定 case 開始。
```

### 3.6 不要把「預先批准」寫成 Agent 授權

指派文字可以寫：

```md
本機手動模式可由 Tommy 在對話中授權。
Agent 模式必須走 Tool Bridge。
```

不可寫：

```md
本輪預先批准所有儲存成功 alert / confirm，Codex 可直接處理。
```

---

## 4. `測試執行說明_*.md` 撰寫規則

### 4.1 角色

測試執行說明是「how to execute」文件，負責說清楚：

- 每題要怎麼操作。
- 每題用什麼 evidence。
- 每題怎麼判 PASS / FAIL / BLOCKED。
- 每題何時暫停。

它可以比指派文字詳細，但仍不可和 xlsx / 指派文字衝突。

### 4.2 必備章節

建議固定章節：

1. `0. 執行模式與檔案位置`
2. `1. 文件目的與適用範圍`
3. `2. Case 分布與執行順序`
4. `3. 共通執行紀律`
5. `4. 各題操作說明`
6. `5. Evidence 與判定規則`
7. `6. 暫停點`
8. `7. detail_json 寫法`
9. `8. 結果輸出`
10. `9. 完成回報格式`

### 4.3 Case 分布必須和指派文字一致

若指派文字寫 `DEMO-A-01 → B-01 → C-01 → D-01`，執行說明不可寫 `B-01 → C-01 → D-01`。

若執行說明表格中寫 `DEMO-A-01 Tommy 已執行`，指派文字與 xlsx 必須同步。

### 4.4 各題操作說明格式

每題建議固定格式：

```md
### DEMO-X-XX — <標題>

目的:
- ...

前置條件:
- 起始頁面:
- 導航路徑:
- 狀態清理:
- 參考資料:
- 授權需求:

步驟:
1. <UI action>
   驗證:
   Evidence:
2. <UI action>
   驗證:
   Evidence:

預期:
- ...

判定:
- PASS:
- FAIL:
- BLOCKED:

detail_json 要點:
- PASS 簡化 / FAIL 完整 / BLOCKED 原因

暫停點:
- 無 / 跑完本 case 後暫停 / Tool Bridge 條件
```

### 4.5 Network / Console 類取證寫法

不要寫「開 DevTools」。

應寫：

```md
Network 取證:
- 透過 Playwright network observation 或 performance entries 找最新 preview request。
- 記錄 request body 中的 dateRange / filters / groups。
- 若找不到 preview request，標 BLOCKED，不可直接打 API 補資料。

Chart.js 取證:
- 使用 read-only page.evaluate 讀 `Object.values(window.Chart.instances)[0].data.datasets`。
- 僅允許讀取，不可修改 chart 或頁面 state。
```

### 4.6 Screenshot 規則

執行說明可要求 screenshot，但必須同時允許結構化 evidence 優先。

```md
Screenshot 是人類佐證，不取代 DOM/network/chart data。
若 DOM/network/chart data 已足以判定，且 screenshot timeout，最多改試一次小截圖；仍失敗時，在 detail_json 寫 screenshot_unavailable_reason，不可反覆重試。
```

---

## 5. 三文件一致性檢查表

Claude 產出三文件後，必須逐項檢查：

| 檢查項 | 必須一致 |
|---|---|
| 輪次 ID | xlsx / 指派文字 / 執行說明一致 |
| case 總數 | 三份一致 |
| 起始 case | 三份一致 |
| 執行順序 | 三份一致 |
| 跳過 case | 三份一致，且 xlsx 已填結果 |
| A/B/C/D 群組命名 | 三份一致 |
| metadata 版本 | 三份一致 |
| 日期區間 | 三份一致 |
| baseline 數值 | 三份一致或明確說明不用 |
| Bug ID | xlsx Bug sheet / md 說明一致 |
| 結果輸出 | 本機模式 vs Agent 模式分清楚 |
| 授權方式 | 本機 chat 授權 vs Agent Tool Bridge 分清楚 |
| DevTools 語句 | 不可要求操作 DevTools UI |

---

## 6. Claude 產檔 Prompt 建議

可直接給 Claude：

```md
請依照 `UAT_三文件撰寫規則.md` 產出本輪 UAT 測試包三份文件：

1. `測試案例.xlsx`
2. `Codex_指派文字_<輪次>_<版本>.md`
3. `測試執行說明_<輪次>_<版本>.md`

要求：

- 同一份文件需支援「本機手動 Codex 示範」與「UAT Tool 線上派工 + Mac Agent」雙模式。
- 三份文件的輪次 ID、case 總數、起始 case、執行順序、跳過 case、metadata 版本、日期區間、Bug ID 必須一致。
- 若要跳過任何 case，xlsx 該 case 必須已填結果、測試日、detail_json；否則不得寫跳過。
- Agent 模式不可直接修改原始 xlsx，只能輸出 `output/result.xlsx`。
- Agent 模式的人工授權只能走 Tool Bridge，不可在文件內預先批准 alert/confirm。
- 前置條件與步驟必須機器可執行：一行一個 UI action，每步列驗證方式與 evidence 類型。
- 不可要求 Codex 操作 DevTools UI；Network / Console 取證需寫成 Playwright network observation 或 read-only page.evaluate。
- Screenshot 是輔助 evidence，DOM/network/chart data 優先。

產出後請附一份「三文件一致性檢查表」，逐項確認是否通過。
```

---

## 7. 對 DEMO001 v1.1 的已知修正方向

目前 `DEMO001 v1.1` 的三文件有以下衝突，下一版應修：

- `xlsx` 第一題是 `DEMO-A-01` 且結果空白，但兩份 md 多處寫 `A-01 已由 Tommy 執行，從 B-01 起跑`。
- `Codex_指派文字` 寫 `B-01 → C-01 → D-01`，但 `測試執行說明` 寫 `A → B → C → D`。
- `測試執行說明` 寫 `預先批准 alert / confirm`，不符合 Agent 模式 Tool Bridge 規則。
- 兩份 md 都有本機手動寫 xlsx 的描述，但沒有清楚限定只適用本機手動模式。
- `DevTools Network / Console` 語句應改為 Playwright 可執行的 network observation / read-only page.evaluate。
