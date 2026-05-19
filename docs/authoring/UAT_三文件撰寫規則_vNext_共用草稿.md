# UAT 三文件撰寫規則 vNext 共用草稿

> 狀態:草稿。此檔目標是把原 `UAT_三文件撰寫規則.md` 中「所有 domain 共用」的規則抽出來。
> BI 專屬規則請放在 `BI_TEST_RULES/BI_UAT_三文件撰寫補充規則.md`。
> 單一功能 / 單一 domain-pack 的規則請放在該 domain 自己的邊界規則檔。

---

## 1. 適用範圍

本文件規範每輪 UAT 測試包必備三份文件的共通寫法:

1. `測試案例.xlsx`
2. `Codex_指派文字_*.md`
3. `測試執行說明_*.md`

本文件只放跨 domain 共用規則,不放 BI、拼貼、明細、指標趨勢、metadata、特定 API、特定頁面、特定 helper template 等內容。

建議讀取順序:

1. `uat-tool/docs/authoring/UAT_三文件撰寫規則_vNext_共用草稿.md`
2. `<domain common rules>` 例如 `BI_TEST_RULES/BI_UAT_三文件撰寫補充規則.md`
3. `<domain-pack rules>` 例如 `other/bi_v1/BI正式UI_拼貼模式_邊界規則.md`
4. 本輪 `Codex_指派文字_*.md`
5. 本輪 `測試執行說明_*.md`
6. 本輪 `測試案例.xlsx`

---

## 2. 三文件職責

### 2.1 `測試案例.xlsx`

`xlsx` 是 case 契約與結果載體,必須描述:

- case 編號與群組。
- 測試目的。
- 風險等級。
- 測試標的。
- 狀態清理。
- 前置條件。
- 操作步驟。
- 預期結果。
- 執行方式。
- 驗證方法。
- 執行結果與 detail_json。

`xlsx` 的 `測試案例` sheet 不應塞入大量 helper 實作細節、程式碼、selector、API URL 或只有機器才讀得懂的參數。若需要 structured params,優先放到 `測試執行說明_*.md` 的 helper hints。

若本輪已建立 platform action vocabulary / domain UI object vocabulary,`xlsx` 可以額外包含 structured support sheets,例如 `步驟` 與 `Vocabulary Contract`。這些 sheet 是機器可讀契約,用來把人類可讀步驟對齊到 canonical action、domain UI object、expected outcome、evidence requirements 與 judgment policy。它們不取代 `測試案例` sheet 的 17 欄語意契約,也不應存放 testcase 當時的人工 oracle 答案。

### 2.2 `Codex_指派文字_*.md`

`Codex_指派文字` 是執行入口,必須讓 Codex / Agent 快速知道:

- 本輪任務角色。
- 執行範圍與起始 case。
- 必讀檔案。
- 本輪禁止事項。
- 交付要求。
- 何時暫停。
- 授權規則。

它不應重複所有測試方法論,也不應與 xlsx / 執行說明寫出不同的起始 case、範圍或跳過規則。

### 2.3 `測試執行說明_*.md`

`測試執行說明` 是 case 操作細節與 evidence 規格,必須描述:

- 每個 case 的操作路徑。
- 前置狀態。
- 每步操作後要驗證什麼。
- 必要 evidence。
- helper hints 或 structured params。
- 下載檔、截圖、network、DOM、表格等取證方式。

它可以比 xlsx 更細,但不可改寫 xlsx 的核心預期與判定規則。

---

## 3. 執行模式

三文件必須先宣告本輪支援的執行模式。

### 3.1 本機手動 Codex 示範模式

適用情境:Tommy 在本機直接開 Codex,手動示範或跑測。

三文件需明確寫:

- cwd。
- 常駐規則位置。
- testcase 位置。
- 結果輸出位置。
- 本機可用的 xlsx 寫入工具。
- 人工授權方式。

只有本機手動模式才可寫「直接更新原始 testcase xlsx」。

### 3.2 UAT Tool 線上派工 + Mac Agent 模式

適用情境:UAT Tool 建立 run,上傳 xlsx/md,由 Mac Agent 執行。

三文件需明確寫:

- Agent run workspace。
- run brief / current case / run state 的來源。
- reference 檔案的索引方式。
- 結果輸出不得修改原始 xlsx,必須輸出 `output/result.xlsx`。
- Tool Bridge response 是唯一有效授權。
- 遇到 SSO、規格歧義、不可逆操作、native alert/confirm 時必須停在安全點。

### 3.3 不可混淆模式

以下語句若出現,必須標明「僅本機手動模式」:

- `直接寫入原始 xlsx`
- `使用 update_case_result.mjs`
- `Tommy 在 chat 授權即可`

Agent 模式應寫:

- `輸出 output/result.xlsx`
- `Tool Bridge response 是唯一有效授權`
- `每題完成 ingest/evidence gate 後才 advance`

---

## 4. 授權規則

文件可以描述某 case 會遇到不可逆操作或 native dialog,但不可在文件內預先授權。

不可寫:

- `預先批准`
- `可直接確認`
- `不需暫停`

正確寫法:

```md
若本機手動模式:Tommy 在對話中明確授權後才可執行。
若 Agent 模式:必須輸出 Tool Bridge request,等待 Tool Bridge response。
```

不可逆操作包含但不限於:

- 刪除。
- 覆蓋。
- 永久清除。
- 離開含未儲存變更的頁面。
- 按 native confirm / alert 的確定。

---

## 5. `測試案例.xlsx` 共通格式

### 5.1 必備 sheet

建議固定 sheet:

- `索引`
- `版本說明`
- `測試案例`
- `Bug`

若 domain pack 已提供 UI / action / evidence contract,建議額外加入:

- `步驟`:逐步 action contract,每列一個 action。
- `Vocabulary Contract`:每題 case scope / required actions / evidence / judgment policy 摘要。

這兩個 structured support sheets 是 optional-but-recommended。若加入,三文件一致性檢查應驗證其中的 case id 都存在於 `測試案例` sheet,且 action / target / evidence 都能對應 platform vocabulary 與 domain pack vocabulary。

### 5.2 `測試案例` 必備欄位

固定 17 欄:

`輪次ID, 群組ID, 群組, 編號, 測試類型, 測試項目, 風險等級, 測試標的, 狀態清理, 前置條件, 步驟, 預期結果, 結果, 執行方式, 測試日, 詳細紀錄JSON, 驗證方法`

欄位要求:

- `群組ID` 必須位於 `群組` 前。
- `風險等級`、`測試標的`、`狀態清理` 必須位於 `測試項目` 後、`前置條件` 前。
- `結果`、`測試日`、`詳細紀錄JSON` 執行前可空白。

### 5.3 風險等級

固定值:

- `🟢 觀察`:不建立、不修改、不刪除。
- `🟡 建立`:建立新資源或暫存資料。
- `🟠 修改`:修改既有設定或資料。
- `🔴 刪除`:刪除或不可逆清除。

風險等級必須與步驟一致。若步驟含刪除但標觀察,文件衝突,不得直接執行。

### 5.4 測試標的

固定值:

- `後端功能`
- `前端呈現`
- `前後端整合`
- `功能流程`

判定原則:

- `後端功能`:以資料與後端行為為主。UI 無法操作導致不能測時,通常是 BLOCKED。
- `前端呈現`:UI 狀態、文案、排版、disabled / enabled、modal、tooltip 錯即可 FAIL。
- `前後端整合`:UI 狀態與 request / response / 畫面結果任一層斷裂即可 FAIL。
- `功能流程`:使用者流程斷掉即可 FAIL;不影響流程的小差異可記錄觀察。

### 5.5 狀態清理

固定格式:

```text
欄位=...;篩選=...;分組=...;時間=...;顯示=...
```

允許值:

- `空` 或 `0組`
- 具體值
- `不限`
- `不影響`
- `沿用 <caseId>`

不要把備註塞入狀態清理欄。背景說明放在 `前置條件` 或 `測試執行說明`。

### 5.6 Structured support sheets

當 testcase 需要降低 agent 語意猜測時,可加入 structured support sheets。

`步驟` 建議欄位:

```text
案例編號, 步驟序號, 動作類型, 目標類型, 目標值, 輸入值, 預期值, 需要人工確認, 逾時毫秒, 重試次數, role, actionId, evidenceRequirements
```

要求:

- `動作類型` 必須來自 platform action vocabulary,例如 `open / click / select / type / read / assertValue / assertToast / execute / compare / create`。
- `目標類型=domain_ui_object` 時,`目標值` 必須來自該 domain pack 的 UI object vocabulary。
- `role` 必須標示 action lifecycle,例如 `precondition / under_test / verification / cleanup`。
- `預期值` 應表達 expected outcome,例如 `succeeded / visible / state_changed / value_matches / toast_visible / request_sent / disabled_or_no_change`。
- `evidenceRequirements` 必須列出本 action 需要的 evidence source,不可只寫「截圖」或「人工確認」。

`Vocabulary Contract` 建議欄位:

```text
caseNo, routeIntent, testTarget, requiresEditor, observationType, requiredActions, evidenceRequirements, judgmentPolicy
```

要求:

- `requiredActions` 是該 case 的 action array,每個 action 至少含 `actionId / action / target / role / expectedOutcome / requiredForPass / evidenceRequirements`。
- `judgmentPolicy` 必須明確列出 `passWhen / failWhen / blockedWhen` 或等價規則。
- testcase-specific input value 與 expected outcome 可以放在這裡;domain UI object 的通用語意不可放在這裡,應放 domain pack。
- 人工 oracle / 歷史 run 正確答案不可放進 structured sheets。oracle 是 fixture 或 review artifact,不是產品真理。

### 5.7 排除與 PM-skip

已確認本輪不執行的 case 預設不要放進 active testcase package。這類 case 可放在獨立 archive、後續補測包或規格備註,但不應在 active xlsx 以 `BLOCKED` 預填。

若 PM 明確要求保留在 xlsx 內,必須:

- 在指派文字與執行說明清楚標成 design-excluded / PM-skip。
- 不計入 runtime BLOCKED。
- 不要求 Agent 開 browser 跑該 case。
- 不用 helper hints 或 structured actions 包裝成可執行 case。

---

## 6. 結果與 detail_json

### 6.1 結果值

固定結果:

- `PASS`
- `FAIL`
- `BLOCKED`
- `PARTIAL`

可另用 PM-skip 記錄設計上跳過的 case,但不要和 runtime BLOCKED 混在一起。

### 6.2 PASS detail_json

PASS 可用簡化版,至少包含:

- `測試目的`
- `設定條件`
- `預期行為`
- `實際行為`

`實際行為` 必須含具體文字、狀態或數值,不可只寫「符合預期」。

### 6.3 FAIL / BLOCKED / PARTIAL detail_json

非 PASS 必須寫完整版:

- `測試目的`
- `設定條件`
- `預期行為`
- `實際行為`
- `驗證方法`

FAIL 需補:

- `錯誤原因`
- `根因層級`
- `RD 分派`

BLOCKED 需補:

- `blocked_reason`

PARTIAL 需補:

- `部分符合的子項清單`
- `不符的子項清單`

---

## 7. 步驟與 evidence

### 7.1 步驟

步驟必須一行一個可執行動作,並在必要時寫出動作後驗證。

好的寫法:

```md
1. 進入目標頁面。
   驗證:頁面標題顯示指定名稱。
2. 點擊新增按鈕。
   驗證:新增 modal 開啟。
3. 輸入名稱。
   驗證:input value 等於輸入文字。
```

不好的寫法:

```md
進入頁面後完成所有設定並確認結果正確。
```

若 domain 已有 UI object vocabulary,步驟文字仍要保留真實 UI 可見文字,但不應只靠自由文字讓 Agent 猜。建議搭配 structured support sheets:

- prose 步驟:給人看,描述「點擊『時間區間』按鈕」。
- structured step:`action=click`, `target=dateRange.button`, `expectedOutcome=visible`, `evidenceRequirements=[interactionLog,dateRange.panel.state]`。

同一個 action 的 expected outcome 不能只看 actual outcome。若 case 目標是驗證防呆或 disabled 狀態,`expectedOutcome` 應寫 `disabled_or_no_change` 或等價值,讓 result gate 知道「點了沒變」是預期行為,不是必然 FAIL。

### 7.2 evidence 類型

驗證方法必須列出 evidence 類型,例如:

- DOM 可見文字。
- checkbox / radio / button 狀態。
- route / URL。
- network observation。
- response body。
- 下載檔案。
- 表格資料。
- 截圖。

截圖只能作輔助 evidence。detail_json 必須寫出實際觀察,不能只寫「見截圖」。

### 7.3 不操作 DevTools UI

文件不得要求 Codex / Agent 操作 DevTools UI。

不可寫:

- `打開 DevTools Network`
- `切到 XHR`
- `Console 輸入...`

應寫:

- `透過 Playwright network observation`
- `透過 read-only evaluate 讀取頁面狀態`

---

## 8. Helper 化與腳本化原則

可腳本化:

- 本地 xlsx 解析與寫回。
- 本地下載檔案解析。
- 本地格式檢查。
- 單一 case 的 evidence 整理。

可 helper 化:

- 單一 case 內重複的 UI 操作。
- 單一 case 的狀態讀取。

禁止:

- 一次 helper 執行多個 case。
- 一次累積多個 case 結果再寫回。
- 直接繞過被測系統取得結果。
- 用內部函式設定被測系統狀態。
- 把整份 testcase 寫成固定自動化腳本。

---

## 9. 三文件一致性檢查

三文件必須一致:

- 輪次 ID。
- case 總數。
- 起始 case。
- 執行順序。
- 跳過 case。
- 風險等級。
- 測試標的。
- 狀態清理。
- 前置條件。
- 預期結果。
- 驗證方法。
- 授權規則。
- 結果輸出位置。

若三文件衝突,執行者應回報文件衝突,不可自行猜測。

---

## 10. 不應放在共用規則的內容

以下內容應移到 domain common 或 domain-pack 規則:

- 特定產品背景。
- 特定資料表 / metadata / 欄位清單。
- 特定模式名稱。
- 特定 API 路徑。
- 特定 URL。
- 特定 helper template 名稱。
- 特定 UI 文案判定規則。
- 特定測試資料命名規則。
- 特定刪除資源範圍。

例如 BI 相關內容請放在:

- `BI_TEST_RULES/BI_UAT_三文件撰寫補充規則.md`
- 各 BI domain-pack 自己的邊界規則檔。
