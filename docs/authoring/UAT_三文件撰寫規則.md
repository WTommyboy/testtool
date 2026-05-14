# UAT 三文件撰寫規則

> 拆分狀態（2026-05-15）:
> 本檔是目前既有流程仍在引用的 legacy 大檔,內容混有共用規則與 BI 專屬規則。
> 新版規則拆分請先看:
>
> 1. 共用規則草稿: `uat-tool/docs/authoring/UAT_三文件撰寫規則_vNext_共用草稿.md`
> 2. BI 補充規則: `BI_TEST_RULES/BI_UAT_三文件撰寫補充規則.md`
> 3. 各 domain-pack 邊界規則,例如 `other/bi_v1/BI正式UI_拼貼模式_邊界規則.md`
>
> 在 legacy 檔正式瘦身前,若新舊規則有衝突,以「共用 vNext -> BI 補充 -> domain-pack 邊界規則 -> 本輪指派文字」的順序判定。

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

本文件同時支援兩種執行模式。後續 case 步驟、前置條件、測試資料、預期結果、驗證方法共用；差異只在檔案讀取、結果輸出、人工授權方式與續跑策略。

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
- BI domain reference 以 run brief 指定的 `rules/PROJECT_AGENTS_FULL.md`、`rules/BI_TEST_RULES/`、`rules/BI_DATA/metadata.csv` 與 `input/reference-index.json` 為準。
- metadata 對照的 canonical reference 是 `rules/BI_DATA/metadata.csv`；原始中文檔名如 `BI_DATA/metadata＿1.2.5 - 工作表1.csv` 是來源識別欄位，必須寫進 testcase/md，避免多份 reference CSV 上傳時 Codex 需要 bulk-read 全部檔案猜測用途。
- 若 run packet 同時有多份 reference/baseline CSV，metadata case 只讀 `reference-index` key=`bi_metadata_csv` 或檔名完全相符的 metadata 檔；不可為了找參考來源而讀完所有 CSV。
- 結果輸出: 不可修改原始 xlsx；必須產出 `output/result.xlsx`。
- 人工授權: 只有 UAT Tool 的 Tool Bridge response 才算授權。startup instruction 或文件內寫「預先批准」不算授權。
- 若遇到 SSO、載入失敗、native alert/confirm、刪除、覆蓋、不可逆操作或規格歧義，必須輸出 Tool Bridge request 並停在安全點。
- 續跑策略: Agent 模式預設依 case manifest 順序連續執行；每題仍必須單題 helper action、單題 result.xlsx、單題 ingest/evidence gate 完成後才可 advance 到下一題。若本輪需要人工停等，必須用明確 stop directive 另行標註。

### 共通規則

- 後續 case 步驟、前置條件、測試資料、預期結果、驗證方法兩種模式共用。
- xlsx、指派文字、執行說明中的 `風險等級`、`測試標的`、`狀態清理` 必須使用同一套 canonical 值。
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
- `Agent 依 case manifest 順序連續執行；每題完成 ingest/evidence gate 後才 advance 到下一題`

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

### 1.6 本機手動模式必須提供「快跑啟動提示詞」

本機手動 Codex 示範模式的啟動提示詞必須以「快速進入 case 執行」為目標，不可把 Agent 模式的完整規則載入流程照搬到本機。

禁止在本機啟動提示詞中要求：

- `依序讀完以下所有文件`
- `讀完 AGENTS.md 全文`
- `讀完 BI_TEST_RULES 全文`
- `每個 tool call 前都用一句話說明`
- `讀完後等候開工指令`，除非真的要現場教學停等
- 模糊路徑，例如只寫 `AGENTS.md`、`BI_TEST_RULES/...`，但沒有指定 cwd 或絕對路徑

正確做法：

- 明確指定 cwd：`/Users/tommy/Downloads/codex_galaxy`
- 所有文件使用絕對路徑，或明確說「以下皆相對 cwd」
- 先做 Playwright preflight，確認 DEV URL 可達與 SSO 狀態
- 只讀本輪指派文字、執行說明與 xlsx current case row
- 常駐規則只讀必要章節：例如本 case 需要 native dialog 才讀第 13 條，需要狀態清理才讀第 18 條，需要寫結果才讀第 22 條
- BI_TEST_RULES 只按 case 類型讀相關章節，不全文讀
- 進度回報用 phase-level，例如「preflight 完成」「current case 已讀」「開始 UI 操作」，不要每個 click 前都說明

本機快跑提示詞建議模板：

```md
你現在在本機手動 Codex 示範模式。請以快跑模式執行，不要全文讀完所有規則文件。

cwd: /Users/tommy/Downloads/codex_galaxy
DEV URL: https://galaxy.games.gamania.com/biapi-dev/testview/home?gameID=541

本輪文件:
- 指派文字: /Users/tommy/Downloads/codex_galaxy/BI_UAT_ROUNDS/<輪次>/Codex_指派文字_<版本>.md
- 執行說明: /Users/tommy/Downloads/codex_galaxy/BI_UAT_ROUNDS/<輪次>/<測試執行說明>.md
- xlsx: /Users/tommy/Downloads/codex_galaxy/BI_UAT_ROUNDS/<輪次>/<測試案例>.xlsx

請先做 Playwright preflight:
1. 使用現有 Playwright page 或開一個 page 導到 DEV URL。
2. 若 SSO / 載入失敗，停下回報。
3. 若頁面可達，繼續。

文件讀取規則:
1. 只讀指派文字的「執行範圍與起始 case / Source of Truth / 暫停點」。
2. 只讀執行說明中 current case 的章節。
3. 只 dump xlsx current case row，不讀整本。
4. AGENTS.md 與 BI_TEST_RULES 只在遇到該規則需要時按章節讀，不全文讀。

授權規則:
- 已授權本 case 的一般 UI 操作與 preview 執行。
- native alert / confirm、儲存、刪除、覆蓋仍必須停下請求授權。

回報規則:
- 不要每個 tool call 前都解釋。
- 只在 phase 完成或遇到 blocker 時回報。
```

### 1.7 授權語句要分清楚「一般 UI 操作」與「不可逆/原生對話」

不要把所有按鈕都寫成需要授權，否則本機跑測會被安全層與提示詞雙重卡住。

建議定義：

- 一般 UI 操作：展開選單、選欄位、切日期、按 preview `執行`、讀 DOM、讀 network。這些在本 case 開始後視為已授權。
- 高風險操作：儲存、刪除、覆蓋、離開未儲存頁面、native alert / confirm。這些必須逐次授權。

若是本機現場示範，可在啟動提示詞中寫：

```md
Tommy 已授權本 case 內所有一般 UI 操作與 preview 執行；遇到 native alert/confirm、儲存、刪除、覆蓋時仍需停下請求授權。
```

### 1.8 半腳本化 / Helper 化原則

UAT 測試包的撰寫目標是「讓 Codex 更快、更穩地執行」，不是把 UAT 變成整份固定 Playwright 腳本。

本專案採用 **半腳本化 / helper 化**：

#### 可以腳本化

這些屬於機械處理，建議交給工具或 helper：

- xlsx 解析、case queue 建立、ACTIVE prompt 產生。
- 寫回結果、dump 讀回驗證、detail_json JSON schema 檢查。
- metadata 清單讀取、命名正規化、欄位差異計算。
- downloaded CSV 計算，例如 sum / avg / distinct / row count。
- Chart.js datasets 唯讀抽取。
- Playwright network request / response body 唯讀整理。

#### 可以 helper 化

這些仍必須透過真實 UI 操作，但可封裝成單一 case 內的 helper：

- 導航到指定模式 / 專案 / 新增報表頁。
- 清空欄位、篩選、分組。
- 加欄位、選來源報表、選篩選欄位、選 operator、輸入值。
- 設定日期區間、顯示方式。
- 按 preview `執行`，並抓取本次 request body / response / chart data。

helper 的邊界：

- helper 只能處理**單一 case 的單一動作或動作片段**。
- helper 不可跨 case 執行。
- helper 不可直接判定 PASS / FAIL / BLOCKED。
- helper 不可一次寫入多個 case 結果。
- helper 不可用內部 JS setter 設定頁面狀態。

#### 不可腳本化

以下禁止寫成固定腳本：

- 一支腳本跑完整份 testcase。
- 一支腳本批次跑 D/E/F/G 整群篩選 case。
- 一次產出多題 result row。
- 腳本直接判定全部 PASS / FAIL / BLOCKED。
- 腳本直接打 BI API 取代 UI 操作。
- 腳本用 `page.evaluate(() => element.click())` 繞過 UI / 安全層限制。

#### Authoring 原則

testcase 仍維持人類可讀。不要要求文件作者撰寫 Playwright selector 或程式碼。

若要支援 helper，應在 `測試執行說明_*.md` 每題加入「Helper hints」結構化區塊，而不是把 xlsx 變成腳本語言。

核心 17 欄 xlsx 目前只新增機器分組用 `群組ID`；helper 所需資訊先由 `測試執行說明_*.md` 提供。未來若工具穩定後，才考慮把 `操作模板 / 參數 JSON / 必要 evidence` 升級為 xlsx 可選欄位。

---

## 2. `測試案例.xlsx` 撰寫規則

### 2.1 必備 sheet

建議固定：

- `測試案例`
- `Bug`
- `版本說明`

### 2.2 `測試案例` 必備欄位

必備欄位固定 17 欄，順序如下。`群組ID` 必須位於 `群組` 前；三個執行控制欄位必須插在「測試項目」後、「前置條件」前，不可放在最後。

| 欄位 | 規則 |
|---|---|
| 輪次ID | 必填，同一輪一致 |
| 群組ID | 必填，穩定機器分組值，如 `A`、`B`、`C`、`D` |
| 群組 | 必填，格式如 `A:拼貼模式正向流程` |
| 編號 | 必填，全域唯一，如 `DEMO-A-01` |
| 測試類型 | 必填，如 `功能流程`、`資料確認(metadata 對照)`、`FAIL bug 重現` |
| 測試項目 | 必填，描述 case 目的 |
| 風險等級 | 必填，只能用 canonical 值：`🟢 觀察`、`🟡 建立`、`🟠 修改`、`🔴 刪除` |
| 測試標的 | 必填，只能用 canonical 值：`後端功能`、`前端呈現`、`前後端整合`、`功能流程` |
| 狀態清理 | 必填，固定 5 項格式：`欄位=...;篩選=...;分組=...;時間=...;顯示=...` |
| 前置條件 | 必填，需機器可執行 |
| 步驟 | 必填，一步一動作 |
| 預期結果 | 必填，含可比對條件 |
| 結果 | 初始空白，除非真的已預先執行 |
| 執行方式 | 建議寫 `Codex + Playwright`，不要寫死單一部署模式 |
| 測試日 | 初始空白 |
| 詳細紀錄JSON | 初始空白，除非真的已預先執行 |
| 驗證方法 | 必填，寫 evidence 類型 |

建議欄位順序：

```text
輪次ID
群組ID
群組
編號
測試類型
測試項目
風險等級
測試標的
狀態清理
前置條件
步驟
預期結果
結果
執行方式
測試日
詳細紀錄JSON
驗證方法
```

### 2.3 三個執行控制欄位寫法

#### 2.3.1 `風險等級`

只能使用以下四個值，不可用 `Low / Medium / High`、自然語句或混合備註：

| 值 | 用途 |
|---|---|
| `🟢 觀察` | 只讀取、比對、preview，不儲存、不修改既有資源 |
| `🟡 建立` | 建立新報表、新資料、新暫存資源 |
| `🟠 修改` | 修改既有報表、設定或資料 |
| `🔴 刪除` | 刪除、覆蓋、永久清除或高風險不可逆操作 |

若 case 會儲存一張新報表，即使是臨時報表，也應標 `🟡 建立`。若 case 只按 preview 查詢且不儲存，通常標 `🟢 觀察`。

#### 2.3.2 `測試標的`

只能使用以下四個值，不可寫長句：

| 值 | 判定重點 |
|---|---|
| `後端功能` | 後端資料、計算、payload、response 是否正確 |
| `前端呈現` | UI 文案、下拉清單、圖表呈現、DOM state 是否正確 |
| `前後端整合` | UI 操作送出的 request 與後端 response 是否對齊 |
| `功能流程` | 建立、執行、儲存、重開、下載等 end-to-end 流程 |

若需要說明「雙標的」或更細的判定原因，寫在 `前置條件`、`驗證方法` 或執行說明內，不要寫進 `測試標的` 欄位。

#### 2.3.3 `狀態清理`

必須固定 5 項，以半形分號分隔，順序不可調換：

```text
欄位=...;篩選=...;分組=...;時間=...;顯示=...
```

每項值只能使用三類：

| 類型 | 例子 |
|---|---|
| `空 / 0組` | `欄位=空`、`篩選=0組`、`分組=0組` |
| `不影響` | 本 case 不依賴該狀態，Codex 可跳過比對 |
| 具體目標值 | `欄位=新增帳號數`、`時間=2026/03/01~2026/03/31`、`顯示=每天` |

不要把備註寫進 `狀態清理` 欄位。以下都應移到 `前置條件` 或 `步驟`：

- `預設「過去7天」本 case 將切換為...`
- `不手動設定，讓 UI 自動處理`
- `⚠️ 注意不可語意解讀`
- `拼貼模式無篩選`

好寫法：

```text
欄位=新增帳號數;篩選=不影響;分組=不影響;時間=2026/03/01~2026/03/31;顯示=每天
```

壞寫法：

```text
欄位=空;篩選=不適用(拼貼模式無篩選);分組=不適用;時間=預設「過去7天」(本 case 將切換為 2026/03/01~03/31);顯示=每天
```

### 2.4 若 case 已預先執行，xlsx 必須真的反映

如果 md 寫 `DEMO-A-01 已由 Tommy 預先執行`，xlsx 對應 row 必須：

- `結果` 已填 `PASS / FAIL / BLOCKED / PARTIAL`。
- `詳細紀錄JSON` 已填。
- `測試日` 已填。
- 若有 bug，`Bug` sheet 或外部 Dashboard 引用必須清楚。

如果 xlsx row 結果仍空白，就不得在 md 宣稱該 case 已執行。

### 2.4.1 預先 BLOCKED / PM-skip case

若 Tommy 或 PM 在測試包設計階段決定某題本輪不執行,該題可保留在 case list 中,但必須以 **PM-skip** 方式表達。PM-skip 的 xlsx `結果` 仍填 `BLOCKED`,但它代表「本輪設計時跳過」,不是 Agent runtime evidence 不足。

適用情境:

- 需要 prod / RD raw data / 跨日資料,本輪資料或權限不足。
- 工具缺口已知且會阻塞後續 case,因此先保留 case 供未來補測。
- Tommy 明確決定本輪不執行,但不刪 row,避免編號與後續引用亂掉。

xlsx 對應 row 必須填齊:

- `結果 = BLOCKED`
- `執行方式 = N/A(本輪不執行)`
- `測試日 = <決策日期>`
- `驗證方法 = 本輪不執行;未來執行 evidence: <未來需要的 evidence 類型>`
- `詳細紀錄JSON` 必須可 parse,且至少包含:

```json
{
  "skip_reason": "本輪不執行的具體原因",
  "skip_decided_by": "Tommy",
  "skip_decided_at": "2026-05-05",
  "preserved_for": "未來補測"
}
```

若跳過原因是工具缺口,可額外加:

```json
{
  "根因層級": "UAT Tool orchestration gap"
}
```

三文件必須同步:

- 指派文字與執行說明都列出 PM-skip case 編號與原因。
- 總 case 數、實際執行 case 數、跳過 case 數必須一致。
- 交付要求必須明寫 Agent/Codex 不可執行或改判這些 row；source xlsx 的預填終態由 Railway 匯入並由 Agent manifest 跳過。`output/result.xlsx` 仍是單題 result-contract workbook,不可把整份 source testcase row 複製成結果檔。
- 報表統計應將 `detail_json.skip_decided_by = "Tommy"` 類 case 歸為 PM-skip,不要和 runtime BLOCKED 混在一起。

PM-skip case **不要放 Helper hints block**。預先跳過不是 helper automation level,不需要也不允許用 Helper hints 表達。

禁止寫法:

```json
{
  "automationLevel": "blocked_preassigned",
  "operationTemplate": "n/a",
  "doNotExecute": true
}
```

正確寫法:

- 執行說明該 case 章節寫「本輪不執行,已預寫 BLOCKED,Agent 原樣複製」。
- 直接省略 `Helper hints` 區塊。
- 若要保留未來補測步驟,放在「步驟」或「備註」中,不要放進 Helper hints。

### 2.5 前置條件寫法

前置條件應使用固定欄位式語法，避免只寫自然語言。

建議格式：

```text
起始頁面: DEV URL 首頁 / 編輯頁 / 專案頁
導航路徑: 我的自訂 > 拼貼模式 > <專案名> > +新增報表
建構模式: 拼貼 / 明細 / 指標趨勢
參考資料: rules/BI_DATA/metadata.csv (來源檔名: metadata＿1.2.5 - 工作表1.csv),來源報表=每日報表
授權需求: 無 / 儲存時 Tool Bridge / 刪除時 Tool Bridge
備註: 狀態清理欄未能表達的背景，例如「頁面預設是過去7天，但本 case 目標時間為 2026/03/01~2026/03/31」
```

Metadata 對照 case 必須更明確，至少寫出：

```text
參考資料: rules/BI_DATA/metadata.csv (來源: BI_DATA/metadata＿1.2.5 - 工作表1.csv)
source_filename: metadata＿1.2.5 - 工作表1.csv
reference_index_key: bi_metadata_csv
來源報表: 每日報表
match_key: 欄位名稱
compare_fields: 欄位名稱, 欄位代碼, 資料型態
```

不要只寫「與 metadata 驗證」。若三文件只寫 metadata 版本，Agent 會以 run packet 的 `rules/BI_DATA/metadata.csv` 為準，但這會降低 testcase 可讀性；若同輪上傳多份 CSV，檔名與 `reference_index_key` 是避免誤讀參考檔的必要資訊。

OTTEST004 類 metadata case 必須補上 `comparisonScope`，讓工具知道比對範圍。canonical 寫法如下：

```json
{
  "comparisonScope": "source_list",
  "expectedReportSources": ["每日報表", "商品報表", "訂單報表", "會員報表"]
}
```

```json
{
  "comparisonScope": "source_report_fields",
  "expectedReportSources": ["每日報表"],
  "expectedFieldCount": 31
}
```

```json
{
  "comparisonScope": "all_sources_fields",
  "expectedReportSources": ["每日報表", "商品報表", "訂單報表", "會員報表"],
  "expectedTotalFieldCount": 72
}
```

metadata case 的 `預期結果` 不可只寫「與 metadata 一致」。至少要寫出期望來源報表、欄位數與比對欄位，例如「預期欄位 picker 內存在每日報表來源群組，該群組下可選欄位數為 31，需比對欄位名稱、欄位代碼、資料型態」。除非 case 明確測空集合，否則不得讓 expected metadata 為空集合。

日期 case 必須把 UI label 與測試意圖分離。`狀態清理` 和步驟中只放真實 UI 可見 label，例如 `時間=昨日`、`時間=上週`、`時間=過去30天`；不要寫 `昨日(快捷)`、`上週(快捷)`、`昨日(快捷起點)`。快捷、動態或半動態意圖放在 helper hints / structured params：

```json
{
  "dateMode": "preset",
  "uiLabel": "昨日",
  "dateAssertion": "shortcut_preset"
}
```

```json
{
  "dateMode": "relative",
  "startOffsetDays": -90,
  "endOffsetDays": -1,
  "timezone": "Asia/Taipei",
  "uiAction": "custom_date_range"
}
```

半動態日期用結構化描述，不要只寫自然語言：

```json
{
  "dateMode": "hybrid",
  "start": {
    "type": "relative",
    "offsetDays": -90
  },
  "end": {
    "type": "preset",
    "uiLabel": "昨日"
  },
  "timezone": "Asia/Taipei",
  "uiAction": "custom_date_range"
}
```

multi-variant 日期 case 優先拆成多題，例如 `B-03a 昨日快捷`、`B-03b 上週快捷`、`B-03c 上月快捷`、`B-03d 過去30天快捷`。只有當測試目的明確是「連續切換後狀態不可殘留」時，才保留 multi-variant，且必須標 `automationLevel=manual_ai` / `operationTemplate=manual_ai`。

欄位全選 case 不要把摘要文字寫成可點擊 UI 文字。避免寫 `點選「4 來源報表全選 72 欄」` 或 `欄位=4 來源報表全選 72 欄`。請改用 structured params：

```json
{
  "selectAllFields": true,
  "sourceReports": ["每日報表", "商品報表", "訂單報表", "會員報表"],
  "expectedFieldCount": 72
}
```

拼貼運算欄位 / 公式 case 不要只寫「新增運算欄位,公式=...」。這類 case 必須明確拆出 modal 操作契約與公式參數,避免 Agent 把「欄位名稱」「公式」「搜尋欄位」等輸入框互相誤判。建議在 `測試執行說明_*.md` 的 Helper hints 使用:

```json
{
  "automationLevel": "helper",
  "operationTemplate": "collage.configureCalculatedMetricAndPreview",
  "params": {
    "mode": "拼貼",
    "baseFields": ["新增帳號數", "MAU(帳號)"],
    "calculatedFieldName": "E01_運算",
    "formula": "[新增帳號數]+[MAU(帳號)]/2",
    "formulaModal": {
      "openButtonText": "+ 新增運算欄位",
      "title": "公式編輯器 - 新運算欄位",
      "nameInputLabel": "欄位名稱",
      "formulaInputLabel": "公式",
      "availableFieldsSection": "可用欄位",
      "requiredFieldButtons": ["新增帳號數", "MAU(帳號)"],
      "submitButtonText": "確認"
    },
    "dateRange": {
      "start": "2026-03-01",
      "end": "2026-03-31"
    },
    "display": "每天"
  },
  "requiredEvidence": [
    "formula.uiState",
    "network.requestBody",
    "network.responseBody",
    "chart.datasets",
    "screenshot"
  ]
}
```

公式 case 的 xlsx 步驟仍要維持人類可讀,但必須逐步寫出:

1. 先加入公式需要的基底欄位。
2. 點「+ 新增運算欄位」。
3. 在「公式編輯器 - 新運算欄位」modal 填「欄位名稱」與「公式」。
4. 按「確認」後驗證 modal 關閉且 DOM / request body 可讀到運算欄位定義。
5. 設定日期與顯示方式,按「執行」取得 preview evidence。

不要在 testcase 寫 CSS selector 或 helper 實作細節;只寫 UI label、case 參數與 evidence requirement。公式、基底欄位、運算欄位名稱必須逐題提供,不可只靠自然語言讓 helper 猜。

公式/數據邏輯 case 必須先分清楚「工具功能可用性」與「資料辨識力」。若命題目標是驗證運算欄位功能實際可用,預期結果應優先寫明 UI 可建立公式、request 帶入公式、preview 成功、結果符合目前資料下的系統行為;資料特性(例如分母全 0、空值多、樣本不足以區分兩種演算法)應記錄為資料限制,不得自動導向 BLOCKED。若命題目標是證明演算法差異(例如「逐日計算」必須能和 `sum/sum` 區分),testcase 必須明確要求可辨識樣本,例如分母存在非 0 且每日值不同;若本輪資料池無法提供該樣本,應在 case 設計階段改寫為 PM-skip/BLOCKED 或調整測試資料,不要讓 Codex 在執行時猜測。

除法/比例類公式尤其要避免把「功能可用」與「演算法差異」混在同一句預期。若接受 BI 對除以 0 回傳 0 作為合理行為,case 應明寫「當分母全為 0 時,以公式成功帶入、preview 成功、運算欄位依系統 divide-by-zero=0 行為回 0 作為 PASS evidence;本題不要求證明非 sum/sum」。若必須驗證非 sum/sum,則預期結果應明寫「需要至少 N 筆非 0 分母資料,且逐日計算結果與 sum/sum 不同」。

`狀態清理` 不要在前置條件重複成另一套 checklist，避免和 xlsx 獨立欄位衝突。若需補充背景，放在 `備註`。

### 2.6 步驟寫法

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

### 2.7 驗證方法必須列 evidence 類型

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

CSV 下載 case 的預期結果必須拆成有順序的子條件，例如：

```text
1. 儲存成功
2. 重開後來源報表/欄位/時間/顯示還原
3. 重開後可產生 current preview
4. UI 下載 CSV 成功
5. CSV row count / 數值與 preview 一致
```

若第 2 或第 3 項已失敗，結果應判斷該必要子條件本身；CSV 比對寫 `not_reached`，不可因後續沒有 CSV 檔就把已知功能流程失敗改成 `BLOCKED`。

CSV 下載驗證的正式 evidence 路徑是 UI 觸發下載後的本機檔案解析。Codex/Agent 可以讀該下載 CSV 的檔名、表頭、row count 與數值；不需要開 Google Sheet，也不應把 Google Sheet 上傳/登入/轉檔流程列為正式 UAT evidence。Google Sheet 只能作人工探索 fallback。

### 2.8 Bug sheet 規則

若 bug 是預期重現：

- 可以預留 placeholder。
- 但要寫清楚 Agent 模式只需在 `output/result.xlsx` 的 Bug sheet 產出結果，不必修改原始 xlsx。

若本機手動模式需要更新原 xlsx，才提 `update_bug_row.mjs`。

### 2.9 Helper 化資訊不要塞進 xlsx 必備欄位

`測試案例.xlsx` 的 17 欄是測試語意與結果契約，不是 Playwright 腳本規格。

因此：

- 不要在 `步驟` 欄寫 selector，例如 `#dateRangeBtn`、`.filter-row:nth-child(2)`。
- 不要在 `步驟` 欄寫程式碼，例如 `await page.locator(...).click()`。
- 不要在 `前置條件` 欄塞 JSON 大物件。
- 不要把多個 helper 名稱串成「腳本流程」。

可接受的 xlsx 寫法：

```text
步驟:
1. 點「+ 新增篩選」
   驗證: DOM read 看到新增 1 組篩選列
2. 欄位選「商品單價」
   驗證: DOM read 篩選欄位 value = 商品單價
3. operator 選「大於」
   驗證: DOM read operator value = 大於
4. 輸入 100 並按執行
   驗證: network request body filters 帶 商品單價 > 100
```

helper 對應資訊應寫在 `測試執行說明_*.md` 的 `Helper hints` 區塊，讓工具讀取。

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

Case 清單或 summary 表格中的 `風險等級`、`測試標的` 必須和 xlsx 使用同一套 canonical 值，不可在 summary 表回退成 `Low / Medium` 或自由文字。

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
- `output/result.xlsx` 是單題 result-contract workbook,不是原始 testcase.xlsx 的複本；`測試案例` sheet 只應包含本次 current case 的結果 row。
- `測試案例` sheet 必須至少包含 `群組ID`、`群組`、`編號`、`測試項目`、`測試類型`、`執行方式`、`結果`、`失敗分類`、`詳細紀錄JSON`。原始 17 欄 testcase 設計欄位（前置條件、步驟、預期結果、狀態清理、驗證方法等）不屬於 result contract。
- 建議 Codex 先寫單題 `detail.json`,再用 Agent 固定 writer 產生 result-contract workbook: `node agent/dist/result-cli.js write --run-dir <runDir> --case <caseNo> --status <PASS|FAIL|BLOCKED|PARTIAL> --detail-json <detail.json> [--fail-category <category>]`。
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
- 參考資料:
- 授權需求:

風險等級:

測試標的:

狀態清理:

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

其中 `風險等級`、`測試標的`、`狀態清理` 必須逐字對齊 xlsx。執行說明可以補充背景，但不可在這三個欄位改寫成另一套值。

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

### 4.7 Helper hints 結構化區塊

`測試執行說明_*.md` 可在每題加入 `Helper hints`，讓工具判斷哪些動作可 helper 化。

此區塊是**提示工具加速**，不是 PASS / FAIL 判定來源。若 Helper hints 與 xlsx 步驟衝突，以 xlsx 步驟與預期結果為準。

PM-skip / 預先 BLOCKED case 不應加入 `Helper hints`。跳過題的控制來源是 xlsx 結果欄與 `detail_json.skip_decided_by`,不是 helper plan。若為跳過題發明 `automationLevel=blocked_preassigned`、`operationTemplate=n/a` 或 `doNotExecute=true`,package gate 應視為 schema error。

建議格式：

````md
Helper hints:
```json
{
  "caseId": "DEMO-X-01",
  "automationLevel": "helper",
  "operationTemplate": "metric_filter_operator",
  "params": {
    "mode": "指標趨勢",
    "field": "商品單價",
    "operator": "大於",
    "value": 100,
    "dateRange": {
      "start": "2026-03-01",
      "end": "2026-03-31"
    },
    "display": "每天"
  },
  "requiredEvidence": [
    "dom.state",
    "network.requestBody",
    "chart.datasets"
  ],
  "forbiddenAutomation": [
    "direct_bi_api",
    "internal_js_setter",
    "multi_case_batch"
  ],
  "aiDecisionRequired": true
}
```
````

#### `automationLevel`

只能使用以下值：

| 值 | 意義 |
|---|---|
| `script_safe` | 純本地或唯讀機械處理，可腳本化。例如 metadata 比對、CSV 計算、xlsx 寫回 |
| `helper` | 可用單 case UI helper 加速，但仍須透過真實 UI |
| `manual_ai` | 需要 Codex 判斷、延伸驗證或處理 UI 異常，不應固定腳本化 |
| `blocked_if_no_helper` | 若缺少對應 helper，應先回報，不要臨時硬寫腳本 |

以下 case 預設應標 `manual_ai`。只有當本文件下方列出明確支援的 helper template,且 params 足以 deterministic 執行單一 case 時,才可標 `helper`：

- 動態日期、半動態日期、multi-variant 日期。
- 90/91 天邊界仍應標 `manual_ai`。
- 需要 Codex 判斷 UI 異常或延伸驗證的前端呈現 case。

若 `operationTemplate=manual_ai`，`automationLevel` 也必須是 `manual_ai`。

#### 常用 `operationTemplate`

`operationTemplate` 不是程式碼，只是讓工具知道可套哪類 helper。它是 **UAT Tool / Mac Agent 支援能力的封閉清單**,不可依 case 名稱臨時創造自由文字 template。Claude 產三文件時必須先使用以下 canonical 值；若找不到合適 template,使用 `manual_ai`,不要自創新名稱。

| Template | 用途 |
|---|---|
| `metadata_dropdown_compare` | 展開下拉清單並與 metadata 對照 |
| `collage_build_preview_save_reopen` | 拼貼建立、preview、儲存、重開驗證 |
| `collage_date_variants_preview` | 拼貼日期區間 visible UI 設定、preview evidence；可搭配 save/download params 做 D0 baseline |
| `record_static_fields_date_payload` | 明細靜態欄位與 dateRange payload 檢查 |
| `metric_date_display_preview` | 指標趨勢時間區間 / 顯示方式 preview |
| `metric_filter_operator` | 指標趨勢篩選欄位 + operator + value |
| `metric_group_series` | 指標趨勢分組與多 series 驗證 |
| `chart_csv_consistency` | Chart.js 與 downloaded CSV 數值一致性 |
| `collage_all_zero_field_inspection` | 拼貼欄位全選 preview 後列出全 0 欄位清單 |
| `collage.configureCalculatedMetricAndPreview` | 拼貼新增運算欄位公式 modal、設定日期/顯示並產生 preview evidence |
| `collage.createProject` | 新增拼貼專案並驗證專案可見 |
| `collage.openReportFromProjectList` | 從專案頁點既有報表名稱進入 editor |
| `collage.clickBackToProjectList` | 從 editor 點返回並驗證回專案頁 |
| `download_csv_verify` | 下載檔名、表頭、row count 驗證 |
| `save_load_flow` | 儲存、清單出現、重開還原驗證 |
| `manual_ai` | 無合適 helper 或需要 Codex 判斷時使用 |

禁止把複合流程自創成新 template。以下名稱**不可使用**：

- `collage.createSaveReopenAndVerifyRestore`
- `collage.createSaveAndDownloadFromProjectRow`
- `collage.createSaveDownloadAndOutputD0Baseline`
- `collage.createProjectOnly`
- `collage.createProjectAndReportFull`
- `collage.createTempReportAndDeleteWithConfirm`
- `collage.createTempReportAndReopenViaName`
- `collage.enterEditorAndClickBack`

複合流程應使用既有 template + structured params + xlsx 步驟表達：

| 測試意圖 | 寫法 |
|---|---|
| 儲存後重開還原 | `operationTemplate=save_load_flow` |
| editor 內 CSV 下載或 project row CSV 下載 | `operationTemplate=download_csv_verify`,並在 params/步驟明寫 `downloadFromProjectListRow`、`skipReopenEditor` 或 `downloadFromEditor` |
| 拼貼日期 preview / D0 baseline | `operationTemplate=collage_date_variants_preview`,並用 `dateMode` / `uiLabel` / `start` / `end` / `save` / `downloadFromProjectListRow` 表達 |
| 新增運算欄位公式 modal | `operationTemplate=collage.configureCalculatedMetricAndPreview` |
| 只新增專案 | `operationTemplate=collage.createProject` |
| 新增專案後接續新增報表、preview、儲存 | `operationTemplate=collage_build_preview_save_reopen` + params: `createNewProject=true` 或 `createProjectThenReport=true`;若不重開,加 `skipReopen=true` |
| 點既有報表名稱進 editor | `operationTemplate=collage.openReportFromProjectList` |
| editor 返回專案頁 | `operationTemplate=collage.clickBackToProjectList` |
| 刪除臨時報表 | `operationTemplate=manual_ai`;case 文字仍須明確寫「刪除報表 / 臨時報表 / Tool Bridge / confirm」讓 Agent 辨識 delete flow |

`metadata_dropdown_compare` 目前有 Mac Agent helper 支援。Helper 只會透過 visible UI 展開欄位 picker,再用 read-only DOM extraction 產生 `metadata-dropdown-evidence.json`;它不判 PASS/FAIL,不打 BI API,也不寫 result.xlsx。Helper hints 建議帶：

```json
{
  "automationLevel": "helper",
  "operationTemplate": "metadata_dropdown_compare",
  "referenceCsv": "rules/BI_DATA/metadata.csv",
  "referenceSourceName": "metadata＿1.2.5 - 工作表1.csv",
  "referenceSourcePath": "BI_DATA/metadata＿1.2.5 - 工作表1.csv",
  "referenceIndexKey": "bi_metadata_csv",
  "comparisonScope": "source_report_fields",
  "expectedReportSources": ["每日報表"],
  "matchKey": "欄位名稱",
  "compareFields": ["欄位名稱", "欄位代碼", "資料型態"],
  "expectedFieldCount": 31
}
```

來源清單 case 改用：

```json
{
  "automationLevel": "helper",
  "operationTemplate": "metadata_dropdown_compare",
  "comparisonScope": "source_list",
  "expectedReportSources": ["每日報表", "商品報表", "訂單報表", "會員報表"]
}
```

多來源欄位總集合 case 改用：

```json
{
  "automationLevel": "helper",
  "operationTemplate": "metadata_dropdown_compare",
  "comparisonScope": "all_sources_fields",
  "expectedReportSources": ["每日報表", "商品報表", "訂單報表", "會員報表"],
  "matchKey": "欄位名稱",
  "compareFields": ["欄位名稱", "欄位代碼", "資料型態"],
  "expectedTotalFieldCount": 72
}
```

快捷日期 case 必須把 UI label 與測試意圖拆開。不要把 `昨日(快捷)`、`上週(快捷)`、`昨日(快捷起點)` 放進 `uiLabel` 或 `狀態清理`；`uiLabel` 只能是真實 UI 文字。

```json
{
  "automationLevel": "helper",
  "operationTemplate": "metric_date_display_preview",
  "dateMode": "preset",
  "uiLabel": "昨日",
  "dateAssertion": "shortcut_preset",
  "baseDate": "2026-05-05",
  "requiredEvidence": ["dom.state", "date.uiState", "date.representedRange", "network.requestBody", "chart.datasets"]
}
```

日期 case 若要求判斷「UI label 代表哪段日期」,必須帶 `date.uiState` 與 `date.representedRange` evidence。若 UI 只顯示 `昨日` 這類 preset label、沒有直接顯示起訖日期,detail_json 應註明代表日期是依 `baseDate/testDate` 計算,不是畫面直接顯示。

動態、半動態、90/91 天邊界或 multi-variant 日期 case 的預設安全寫法是 `manual_ai`,並用結構化 params 表示日期。例外：若該模式已有明確 helper 支援,例如拼貼模式可用 `collage_date_variants_preview`,可標 `helper`,但 params 必須完整、且 xlsx 步驟仍要寫清楚每段 UI 設定與驗證。90/91 天邊界仍建議 `manual_ai`,避免 helper 過早替 testcase 做判斷。

```json
{
  "automationLevel": "manual_ai",
  "operationTemplate": "manual_ai",
  "dateMode": "relative",
  "startOffsetDays": -90,
  "endOffsetDays": -1,
  "timezone": "Asia/Taipei",
  "uiAction": "custom_date_range"
}
```

拼貼模式日期 preview / D0 baseline 可用:

```json
{
  "automationLevel": "helper",
  "operationTemplate": "collage_date_variants_preview",
  "params": {
    "mode": "拼貼",
    "field": "新增帳號數",
    "dateMode": "hybrid",
    "start": {"type": "static", "date": "2026-03-25"},
    "end": {"type": "relative", "offsetDays": -1},
    "display": "每天",
    "save": true,
    "downloadFromProjectListRow": true,
    "skipReopenEditor": true,
    "captureBaseline": ["csv.rows", "chart.datasets", "savedReportName"]
  },
  "requiredEvidence": ["date.uiState", "network.requestBody", "chart.datasets", "csv.rows", "toolBridge.response", "screenshot"]
}
```

D0 baseline case 不應要求 Agent 輸出未實作的專用 artifact 名稱；請在 `detail_json` 記錄實際 helper artifacts 與 evidence,例如 preview evidence、downloaded CSV、`csv.rows`、`chart.datasets`、saved report name。

欄位全選 case 不要把 `4 來源報表全選 72 欄` 寫成可點擊文字；Helper hints 必須帶：

```json
{
  "automationLevel": "helper",
  "operationTemplate": "collage_build_preview_save_reopen",
  "selectAllFields": true,
  "sourceReports": ["每日報表", "商品報表", "訂單報表", "會員報表"],
  "expectedFieldCount": 72
}
```

A-06 類「只列全 0 欄位清單、不判斷根因」case 應使用專用 helper template，不要標 `manual_ai` 讓 Codex 自行摸索大量欄位 picker：

```json
{
  "automationLevel": "helper",
  "operationTemplate": "collage_all_zero_field_inspection",
  "sourceReport": "每日報表",
  "selectAllFieldsInSourceReport": true,
  "expectedFieldCount": 32,
  "dateRange": {
    "start": "2026-03-01",
    "end": "2026-03-31"
  },
  "display": "每天",
  "requiredEvidence": ["dom.list", "network.requestBody", "network.responseBody", "chart.datasets", "screenshot"]
}
```

此 helper 會輸出 `all-zero-field-inspection-evidence.json`。它只列候選全 0 欄位與 evidence；Codex 仍須依 testcase 判定 PASS/BLOCKED，且不得把 helper output 當作全 0 成因結論。

拼貼運算欄位 / 公式 case 應使用 `collage.configureCalculatedMetricAndPreview`。Helper 會透過 visible UI 加入 base fields、開啟「+ 新增運算欄位」modal、依 UI label 填運算欄位名稱與公式、按「確認」後設定日期/顯示並執行 preview。Helper 只產 evidence,不判 PASS/FAIL/BLOCKED。

```json
{
  "automationLevel": "helper",
  "operationTemplate": "collage.configureCalculatedMetricAndPreview",
  "params": {
    "baseFields": ["新增帳號數", "MAU(帳號)"],
    "calculatedFieldName": "E01_運算",
    "formula": "[新增帳號數]+[MAU(帳號)]/2",
    "formulaModal": {
      "openButtonText": "+ 新增運算欄位",
      "nameInputLabel": "欄位名稱",
      "formulaInputLabel": "公式",
      "availableFieldsSection": "可用欄位",
      "submitButtonText": "確認"
    },
    "dateRange": {
      "start": "2026-03-01",
      "end": "2026-03-31"
    },
    "display": "每天"
  },
  "requiredEvidence": ["formula.uiState", "network.requestBody", "network.responseBody", "chart.datasets", "screenshot"]
}
```

公式 case 若缺少 `baseFields`、`calculatedFieldName` 或 `formula`,不得標 `automationLevel=helper`。若本題要測的是 modal UI 異常、公式編輯器文案、或需要 Codex 做延伸判讀,可標 `manual_ai`,但仍須在步驟中完整描述 modal 操作與 evidence。

Helper hints 不應要求 helper 補足資料辨識力。若公式 case 需要非 0 分母、不同日期分布或特定對照樣本,這是 testcase/測試資料設計需求,必須寫在 `預期結果`、`驗證方法` 或 PM-skip 條件中;helper 只負責依 UI 操作收集當前資料 evidence。若 case 只測公式功能可用,helper evidence 中出現全 0 分母時,Codex 應記錄資料限制與 divide-by-zero 行為,不應要求 testcase 額外寫「helper 必須找非 0 樣本」。

`download_csv_verify` 或同時含 `save_load_flow` 的 CSV case，`expected` 與 `requiredEvidence` 要分清楚「重開還原」「preview 存在」「CSV 下載」「CSV 比對」四層，不要把全部混成一句「下載資料一致」。若 helper plan 已產生 save/reopen/download actions，Codex 不可在只完成 preview 後直接判 `BLOCKED/EVIDENCE_INSUFFICIENT`；必須先要求 Tool Bridge/continuation 執行剩餘必要步驟，或明確記錄哪個前置必要子條件失敗。

若 CSV case 的目的只是驗證下載檔與 preview 一致,且已知 editor 重開會混入 date-range restore regression,建議改成「儲存後回專案/報表清單,從該報表列下載 CSV,比對儲存前 preview」。此時 testcase 要明寫:

- 不重開 editor,不驗證儲存後設定還原。
- 清單列必須對應本輪儲存的 report name,不可下載其他報表；若 save 後清單頁 stale,helper 應刷新/重定位清單列後再點該列下載控制。
- CSV 比對目標是儲存前 preview table/chart evidence。
- 若 browser `download` event 未觸發,但同一次可見 UI 點擊產生 CSV/attachment response,可保存該 UI-triggered response body 作 CSV evidence,並標示 evidence source。
- 若儲存或清單列定位失敗,`csv_comparison_status=not_reached`,最終判定回到失敗的必要子條件。

#### `requiredEvidence`

只能使用以下 evidence 類型或其子類：

- `dom.state`
- `dom.list`
- `date.uiState`
- `date.representedRange`
- `formula.uiState`
- `network.requestBody`
- `network.responseBody`
- `chart.datasets`
- `csv.rows`
- `csv.aggregate`
- `screenshot`
- `toolBridge.response`
- `xlsx.readback`

#### 禁止事項

Helper hints 不可包含：

- Playwright selector。
- 可執行程式碼。
- 多個 case 的 queue。
- 直接 API URL。
- 要求 helper 判 PASS / FAIL。
- 要求 helper 寫多題結果。
- PM-skip / 預先 BLOCKED 的控制欄位,例如 `blocked_preassigned`、`operationTemplate: "n/a"`、`doNotExecute`、`skip_reason`。

### 4.4 Package lint 建議規則

Claude 產出 testcase package 後，建議先用以下規則自檢；未來若工具加入 package lint，這些應作為 blocking 或至少 warning：

1. 日期 UI label 不得包含 `(快捷)`、`(快捷起點)`、`(半動態)` 或其他非 UI label 註解。
2. metadata case 必須有 `comparisonScope`、`referenceCsv`、`referenceIndexKey`、`expectedReportSources`、`matchKey`、`compareFields`。
3. `comparisonScope=source_report_fields` 必須有 `expectedFieldCount`。
4. `comparisonScope=all_sources_fields` 必須有 `expectedTotalFieldCount`。
5. `selectAllFields=true` 必須有 `sourceReports`，且必須有 `expectedFieldCount` 或 `expectedTotalFieldCount`。
6. `collage_all_zero_field_inspection` 必須有 `sourceReport` 或 `sourceReports`、`selectAllFields` / `selectAllFieldsInSourceReport`、`expectedFieldCount`、靜態 `dateRange`、`display`。
7. `collage.configureCalculatedMetricAndPreview` 必須有 `baseFields`、`calculatedFieldName`、`formula`、`dateRange`、`display`,且 `requiredEvidence` 至少包含 `formula.uiState`、`network.requestBody`、`chart.datasets`。
8. 日期 / multi-variant case 若標 `automationLevel=helper`,必須使用已支援的日期 helper template(例如拼貼 `collage_date_variants_preview`)且 params 足以描述所有 variant / 起訖；否則應標 `automationLevel=manual_ai`。
9. `operationTemplate=manual_ai` 時，`automationLevel` 必須是 `manual_ai`。
10. `automationLevel=helper` 時，params 必須足以形成 deterministic helper plan，不可只靠自然語言讓 helper 猜。
11. PM-skip / 預先 BLOCKED case 不得有 Helper hints block；不得使用 `automationLevel=blocked_preassigned`、`operationTemplate=n/a` 或 `doNotExecute`。
12. `operationTemplate` 必須是本文件 canonical 封閉清單之一；不得出現 `collage.createSaveReopenAndVerifyRestore`、`collage.createSaveAndDownloadFromProjectRow`、`collage.createSaveDownloadAndOutputD0Baseline`、`collage.createProjectOnly`、`collage.createProjectAndReportFull`、`collage.createTempReportAndDeleteWithConfirm`、`collage.createTempReportAndReopenViaName`、`collage.enterEditorAndClickBack` 等自創 template。

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
| A/B/C/D 群組ID與群組命名 | 三份一致，`群組ID` 用穩定機器值，`群組` 用人類可讀名稱 |
| xlsx 欄位結構 | `測試案例` sheet 必須是 17 欄，`群組ID` 位於 `群組` 前，且三個控制欄位位於 `測試項目` 後 |
| 風險等級 | 三份一致，且只用 `🟢 觀察 / 🟡 建立 / 🟠 修改 / 🔴 刪除` |
| 測試標的 | 三份一致，且只用 `後端功能 / 前端呈現 / 前後端整合 / 功能流程` |
| 狀態清理 | 三份一致，且固定 `欄位=...;篩選=...;分組=...;時間=...;顯示=...` |
| metadata 版本 | 三份一致 |
| 日期區間 | 三份一致 |
| baseline 數值 | 三份一致或明確說明不用 |
| Bug ID | xlsx Bug sheet / md 說明一致 |
| 結果輸出 | 本機模式 vs Agent 模式分清楚 |
| 授權方式 | 本機 chat 授權 vs Agent Tool Bridge 分清楚 |
| DevTools 語句 | 不可要求操作 DevTools UI |
| Helper hints | 若有填寫，必須是單一 case、canonical template、不得含 selector / 程式碼 / 多題 queue |
| Helper evidence | `requiredEvidence` 必須和 xlsx `驗證方法` 不衝突 |

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
- xlsx 必須使用 17 欄格式，且在「群組」前插入「群組ID」、在「測試項目」後插入「風險等級」「測試標的」「狀態清理」三欄。
- 「風險等級」只能用 `🟢 觀察 / 🟡 建立 / 🟠 修改 / 🔴 刪除`。
- 「測試標的」只能用 `後端功能 / 前端呈現 / 前後端整合 / 功能流程`。
- 「狀態清理」只能用固定 5 項格式：`欄位=...;篩選=...;分組=...;時間=...;顯示=...`，備註不得混入此欄。
- 指派文字與執行說明的 case summary 表也要使用相同 canonical 值，不可回退成 Low / Medium 或自由文字。
- Agent 模式預設可自動 advance 下一 case；若要人工停等，文件需寫明明確 stop directive，避免和連續執行混淆。
- 前置條件與步驟必須機器可執行：一行一個 UI action，每步列驗證方式與 evidence 類型。
- 日期 UI label 只能寫真實 UI 文字，不可混入 `(快捷)`、`(快捷起點)`、`(半動態)`；快捷、動態、半動態意圖請放 helper hints / structured params。
- metadata case 必須寫明 `comparisonScope`、`expectedReportSources`、`matchKey`、`compareFields` 與 expected count，不可只寫「與 metadata 一致」。
- 欄位全選 case 必須用 `selectAllFields/sourceReports/expectedFieldCount` structured params，不可把「4 來源報表全選 72 欄」寫成可點擊文字。
- 不可要求 Codex 操作 DevTools UI；Network / Console 取證需寫成 Playwright network observation 或 read-only page.evaluate。
- Screenshot 是輔助 evidence，DOM/network/chart data 優先。
- 採半腳本化 / helper 化原則：可腳本化 xlsx 解析、ACTIVE prompt、寫回、dump、CSV 計算、Chart.js 抽取、metadata 比對；可 helper 化單一 case 內的 UI 動作；不可把整份 testcase 或整群 case 寫成固定 Playwright 腳本。
- 若某題適合 helper 化，請在 `測試執行說明_*.md` 該題加入 `Helper hints` JSON 區塊，使用 canonical `automationLevel`、`operationTemplate`、`requiredEvidence`。不要在 xlsx 寫 selector 或程式碼。
- Helper hints 只能描述單一 case，不可包含多題 queue，不可要求 helper 判 PASS / FAIL，不可要求 helper 一次寫多題結果。
- multi-variant / dynamic / half-dynamic 日期 case 預設標 `automationLevel=manual_ai` 與 `operationTemplate=manual_ai`；若使用已支援 helper(例如拼貼 `collage_date_variants_preview`),必須提供完整 structured params 與 requiredEvidence。

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
