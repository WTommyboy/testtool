# OTTEST004 Testcase 撰寫優化需求

## 背景

OTTEST004 前幾輪出現多個 false BLOCKED。工具側主因已在 `uat-tool` commit `b7ee326` 修正，但 testcase 撰寫方式仍有幾類可優化點。

這次請優先調整 testcase / companion md / authoring spec，不要把可結構化的資訊只寫成自然語言，避免後續工具、helper、Codex 需要猜測。

核心原則：

> 自然語言給人讀，helper hints / structured params 給工具讀。

## 1. 日期快捷：UI label 與測試意圖分離

### 問題

目前 testcase 可能寫：

```text
昨日(快捷)
上週(快捷)
上月(快捷)
過去30天(快捷)
昨日(快捷起點)
```

這類寫法對人類可讀，但工具容易把整段當成 UI label 去點擊，造成 `DATE_RANGE_PRESET_NOT_FOUND`。

### 請改成

UI 可見文字只放真正 UI label：

```json
{
  "dateMode": "preset",
  "uiLabel": "昨日",
  "dateAssertion": "shortcut_preset"
}
```

其他例子：

```json
{
  "dateMode": "preset",
  "uiLabel": "上週",
  "dateAssertion": "shortcut_preset"
}
```

```json
{
  "dateMode": "preset",
  "uiLabel": "過去30天",
  "dateAssertion": "shortcut_preset"
}
```

### 禁止寫法

```text
時間=昨日(快捷)
時間=上週(快捷)
時間=過去30天(快捷)
```

### 建議寫法

```text
時間=昨日
```

並在 helper hints 或前置條件補：

```json
{
  "dateMode": "preset",
  "uiLabel": "昨日",
  "dateAssertion": "shortcut_preset"
}
```

## 2. 動態 / 半動態日期要結構化

### 問題

自然語言如：

```text
90 天前到昨日
半動態日期
昨日快捷起點
```

會讓 helper 無法判斷該走 preset、custom range，或是否需要 Codex visible UI。

### 請改成

```json
{
  "dateMode": "relative",
  "startOffsetDays": -90,
  "endOffsetDays": -1,
  "timezone": "Asia/Taipei",
  "uiAction": "custom_date_range"
}
```

半動態例子：

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

### automationLevel

這類 case 請標：

```json
{
  "automationLevel": "manual_ai",
  "operationTemplate": "manual_ai"
}
```

## 3. multi-variant 日期 case 優先拆題

### 問題

一題同時測多個日期：

```text
昨日 / 上週 / 上月 / 過去30天
```

會讓 helper plan、detail_json、evidence 都變複雜，也容易誤判是哪個變體失敗。

### 建議

優先拆成多題：

```text
B-03a 昨日快捷
B-03b 上週快捷
B-03c 上月快捷
B-03d 過去30天快捷
```

只有當測試目的明確是「連續切換後狀態不可殘留」時，才保留 multi-variant。

保留時請寫：

```json
{
  "automationLevel": "manual_ai",
  "operationTemplate": "manual_ai",
  "dateVariants": [
    { "dateMode": "preset", "uiLabel": "昨日" },
    { "dateMode": "preset", "uiLabel": "上週" },
    { "dateMode": "preset", "uiLabel": "上月" },
    { "dateMode": "preset", "uiLabel": "過去30天" }
  ],
  "testIntent": "verify_continuous_date_switch_no_state_leak"
}
```

## 4. metadata case 必填 comparisonScope

### 問題

只寫：

```text
與 metadata 一致
```

不足以讓工具知道要比的是：

- 來源報表清單
- 單一來源報表底下欄位
- 多來源報表欄位總集合
- 特定欄位屬性

### 請使用 canonical comparisonScope

#### 4.1 比對來源報表清單

```json
{
  "operationTemplate": "metadata_dropdown_compare",
  "comparisonScope": "source_list",
  "referenceCsv": "rules/BI_DATA/metadata.csv",
  "referenceSourceName": "metadata＿1.2.5 - 工作表1.csv",
  "referenceIndexKey": "bi_metadata_csv",
  "expectedReportSources": ["每日報表", "商品報表", "訂單報表", "會員報表"]
}
```

#### 4.2 比對單一來源報表欄位

```json
{
  "operationTemplate": "metadata_dropdown_compare",
  "comparisonScope": "source_report_fields",
  "referenceCsv": "rules/BI_DATA/metadata.csv",
  "referenceSourceName": "metadata＿1.2.5 - 工作表1.csv",
  "referenceIndexKey": "bi_metadata_csv",
  "expectedReportSources": ["每日報表"],
  "matchKey": "欄位名稱",
  "compareFields": ["欄位名稱", "欄位代碼", "資料型態"],
  "expectedFieldCount": 31
}
```

#### 4.3 比對多來源欄位總集合

```json
{
  "operationTemplate": "metadata_dropdown_compare",
  "comparisonScope": "all_sources_fields",
  "referenceCsv": "rules/BI_DATA/metadata.csv",
  "referenceSourceName": "metadata＿1.2.5 - 工作表1.csv",
  "referenceIndexKey": "bi_metadata_csv",
  "expectedReportSources": ["每日報表", "商品報表", "訂單報表", "會員報表"],
  "matchKey": "欄位名稱",
  "compareFields": ["欄位名稱", "欄位代碼", "資料型態"],
  "expectedTotalFieldCount": 72
}
```

## 5. selectAllFields 不要寫成可點擊文字

### 問題

不要寫：

```text
點選「4 來源報表全選 72 欄」
```

這會讓工具誤以為畫面上有一個叫「4 來源報表全選 72 欄」的欄位或按鈕。

### 請改成

```json
{
  "selectAllFields": true,
  "sourceReports": ["每日報表", "商品報表", "訂單報表", "會員報表"],
  "expectedFieldCount": 72
}
```

若需要保留給人看的步驟，可寫：

```text
透過欄位選擇器，選取 4 個來源報表下所有可用欄位，預期總欄位數 72。
```

但 helper hints 必須帶 structured params。

## 6. automationLevel 要當硬規格

請不要把 automationLevel 當備註。它會直接影響 helper 是否可 pre-run。

### canonical 值

```json
{
  "automationLevel": "helper"
}
```

適用：單一固定 UI 流程，可由 helper 透過 visible UI 加速。

```json
{
  "automationLevel": "manual_ai"
}
```

適用：

- 動態日期
- 半動態日期
- 90/91 天邊界
- 多日期變體連續切換
- 需要 Codex 判斷 UI 異常
- 需要延伸驗證的前端呈現 case

```json
{
  "automationLevel": "script_safe"
}
```

適用：本地 metadata / CSV / xlsx 純計算，不操作 BI UI。

```json
{
  "automationLevel": "blocked_if_no_helper"
}
```

適用：沒有對應 helper 就不應硬跑。

## 7. 預期結果不要 expected empty

### 問題

metadata case 不要只寫：

```text
與 metadata 一致
```

### 建議

至少寫出：

```text
預期欄位 picker 內存在「每日報表」來源群組；該群組下可選欄位數應為 31；需比對欄位名稱、欄位代碼、資料型態。
```

或：

```text
預期欄位 picker 顯示 4 個來源報表群組：每日報表、商品報表、訂單報表、會員報表。
```

或：

```text
預期 4 個來源報表合計可選欄位數為 72，且欄位名稱、欄位代碼、資料型態與 metadata 一致。
```

## 8. 狀態清理欄維持純 checklist

### 好寫法

```text
欄位=空;篩選=0組;分組=0組;時間=上月;顯示=每天
```

### 避免

```text
時間=上月(快捷，若找不到請改選日期)
```

```text
時間=昨日(快捷起點)
```

```text
欄位=4 來源報表全選 72 欄
```

狀態清理欄只放目標狀態，不放操作說明、備註、fallback 策略。

## 9. helper hints 建議格式

每個可 helper-assisted 的 case，建議在 companion md 或 testcase structured block 中放：

```json
{
  "automationLevel": "helper",
  "operationTemplate": "metadata_dropdown_compare",
  "params": {
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
}
```

日期 case：

```json
{
  "automationLevel": "manual_ai",
  "operationTemplate": "manual_ai",
  "params": {
    "dateMode": "relative",
    "startOffsetDays": -90,
    "endOffsetDays": -1,
    "timezone": "Asia/Taipei",
    "uiAction": "custom_date_range"
  }
}
```

select-all case：

```json
{
  "automationLevel": "helper",
  "operationTemplate": "collage_build_preview_save_reopen",
  "params": {
    "selectAllFields": true,
    "sourceReports": ["每日報表", "商品報表", "訂單報表", "會員報表"],
    "expectedFieldCount": 72
  }
}
```

## 10. 建議新增 package lint 規則

請同步設計 package lint，在 run 前擋掉不穩寫法。

### 應擋規則

1. 日期 UI label 含：
   - `(快捷)`
   - `(快捷起點)`
   - `(半動態)`
   - 其他非 UI label 註解

2. metadata case 缺：
   - `comparisonScope`
   - `referenceCsv`
   - `referenceIndexKey`
   - `expectedReportSources`
   - `matchKey`
   - `compareFields`

3. `comparisonScope=source_report_fields` 但缺：
   - `expectedFieldCount`

4. `comparisonScope=all_sources_fields` 但缺：
   - `expectedTotalFieldCount`

5. `selectAllFields=true` 但缺：
   - `sourceReports`
   - `expectedFieldCount` 或 `expectedTotalFieldCount`

6. multi-variant date case 標成：
   - `automationLevel=helper`

   應改為：
   - `automationLevel=manual_ai`

7. `operationTemplate=manual_ai` 但：
   - `automationLevel` 不是 `manual_ai`

8. `automationLevel=helper` 但 params 不足以形成 helper plan。

## 11. 本次 Claude 調整交付物

請 Claude 產出：

1. 更新後的 testcase xlsx。
2. 更新後的 companion md / 指派文字。
3. 若有 authoring spec 權限，更新：
   - `docs/authoring/UAT_三文件撰寫規則.md`
4. 若有 package lint 設計，補一節 lint 規則，不一定要立刻實作 code。
5. 回報每一類調整對應哪些 case：
   - 日期快捷
   - 動態 / 半動態日期
   - multi-variant 日期
   - metadata comparisonScope
   - selectAllFields
   - manual_ai 標記

## 12. 驗收標準

調整後的 testcase 應滿足：

- 日期 UI label 不再混入註解。
- metadata case 都有明確 comparisonScope。
- metadata expected 不會是空集合，除非該 case 明確就是測空集合。
- select all case 不會把「4 來源報表全選 72 欄」當成畫面文字點擊。
- manual_ai case 不會被 helper pre-run。
- helper case 的 params 足以讓工具產生 deterministic helper plan。
- 狀態清理欄維持純 checklist，不放備註。

