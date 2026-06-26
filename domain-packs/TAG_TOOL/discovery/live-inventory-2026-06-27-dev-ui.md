# TAG_TOOL Live UI Inventory - 2026-06-27

Environment: Galaxy dev
URL: `https://galaxy.games.gamania.com/bi-dev/zh-TW/tag/player?gameId=541`
Capture method: logged-in in-app browser, visible UI navigation, and read-only DOM inspection.

Safety boundary:

- No direct product API calls were used as primary evidence.
- No save, delete, terminate, copy confirmation, upload submit, or variable save was executed.
- File inputs, hrefs, text content, route URLs, and form values were read only.

## Player Tag List

Route: `/bi-dev/zh-TW/tag/player?gameId=541`

Visible signals:

- Breadcrumb/page context: `數據中心 > 主頁 > 標籤 > 玩家標籤管理`.
- Page title: `玩家標籤管理`.
- Toolbar: disabled `刪除`; enabled `新增`.
- Table headers: `標籤名稱`, `標籤類型`, `條件類別`, `篩選類型`, `排程狀態`, `資料最後更新時間`, `備註`, `操作`.
- Current dev list state: `共 32 筆資料`, `20筆/頁`, pages 1 and 2.
- Row action trigger: accessible label `更多操作`.

Do not assume an empty-list state in dev. Empty-list cases need a dedicated fixture environment.

### Page 1 Row Inventory

| Index | Name | Type | Category | Filter Type | Schedule | Last Update | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 累積遊戲01_天 | 條件標籤 | 累積遊戲時間 | 動態時間區間 | 進行中 | 2026-06-24 01:36:43 | 累積遊戲01_天 |
| 1 | 累積遊戲02_天 | 條件標籤 | 累積遊戲時間 | 靜態時間區間 | 進行中 |  |  |
| 2 | 累積遊戲03_天 | 條件標籤 | 累積遊戲時間 | 依報表區間設置 | - | - | - |
| 3 | 累積遊戲04_天 | 條件標籤 | 累積遊戲時間 | 首次後持續累計 | 進行中 |  |  |
| 4 | 累積遊戲01_時 | 條件標籤 | 累積遊戲時間 | 動態時間區間 | 進行中 |  |  |
| 5 | 累積遊戲02_時 | 條件標籤 | 累積遊戲時間 | 靜態時間區間 | 進行中 |  |  |
| 6 | 累積遊戲03_時 | 條件標籤 | 累積遊戲時間 | 依報表區間設置 | - | - | - |
| 7 | 累積遊戲04_時 | 條件標籤 | 累積遊戲時間 | 首次後持續累計 | 進行中 |  |  |
| 8 | 累積遊戲01_分 | 條件標籤 | 累積遊戲時間 | 動態時間區間 | 進行中 |  |  |
| 9 | 累積遊戲02_分 | 條件標籤 | 累積遊戲時間 | 靜態時間區間 | 進行中 |  |  |
| 10 | 累積遊戲03_分 | 條件標籤 | 累積遊戲時間 | 依報表區間設置 | - | - | - |
| 11 | 累積遊戲04_分 | 條件標籤 | 累積遊戲時間 | 首次後持續累計 | 進行中 |  |  |
| 12 | 累積遊戲時間01_天_max | 條件標籤 | 累積遊戲時間 | 動態時間區間 | 已結束 | 2026-06-24 01:36:54 | - |
| 13 | 233 | 人工標籤 | - | - | - | 2026-06-23 22:48:49 | 23 |
| 14 | dfdfdf | 條件標籤 | 消費級距 R | 靜態時間區間 | 進行中 | 2026-06-24 01:36:56 | - |
| 15 | 消費01_01 | 條件標籤 | 消費級距 R | 動態時間區間 | 進行中 |  |  |
| 16 | 消費02_01 | 條件標籤 | 消費級距 R | 靜態時間區間 | 已結束 | - | 消費02_01 |
| 17 | 消費03_01 | 條件標籤 | 消費級距 R | 依報表區間設置 | - | - | - |
| 18 | 消費04_01 | 條件標籤 | 消費級距 R | 首次後持續累計 | 進行中 |  |  |
| 19 | 累積登天01_01 | 條件標籤 | 累積登入天數 | 動態時間區間 | 進行中 |  |  |

### Page 2 Row Inventory

| Index | Name | Type | Category | Filter Type | Schedule | Last Update | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 累積登天02_01 | 條件標籤 | 累積登入天數 | 靜態時間區間 | 進行中 | 2026-06-24 01:37:01 | 累積登天02_01 |
| 1 | 累積登天03_01 | 條件標籤 | 累積登入天數 | 依報表區間設置 | - | - | - |
| 2 | 累積登天04_01 | 條件標籤 | 累積登入天數 | 首次後持續累計 | 進行中 |  |  |
| 3 | 累積未登天01_01 | 條件標籤 | 累積未登入天數 | 動態時間區間 | 進行中 |  |  |
| 4 | 累積未登天02_01 | 條件標籤 | 累積未登入天數 | 靜態時間區間 | 進行中 |  |  |
| 5 | 累積未登天03_01 | 條件標籤 | 累積未登入天數 | 依報表區間設置 | - | - | - |
| 6 | 累積未登天04_01 | 條件標籤 | 累積未登入天數 | 首次後持續累計 | 進行中 |  |  |
| 7 | 消費子標籤斷點測試 | 條件標籤 | 消費級距 R | 首次後持續累計 | 進行中 |  |  |
| 8 | 人工01 | 人工標籤 | - | - | - | 2026-06-24 02:33:14 | 人工01 |
| 9 | 人工02 | 人工標籤 | - | - | - | 2026-06-24 02:18:52 | 人工02 |
| 10 | dfdfd | 條件標籤 | 消費級距 R | 動態時間區間 | 進行中 | - | - |
| 11 | ㄔㄔ | 人工標籤 | - | - | - | 2026-06-24 18:35:50 | - |

### Row Action Menus

Observed menu variants:

- Ongoing condition tag: `查看設置`, `標籤資訊`, `終止`, `刪除`, `複製`.
- Ended condition tag: `查看設置`, `標籤資訊`, `刪除`, `複製`; no `終止`.
- Manual tag expected from prior live inventory: `編輯`, `標籤資訊`, `刪除`, `複製`.

Irreversible menu items:

- `終止`: requires explicit approval before confirming.
- `刪除`: requires explicit approval before confirming.
- `複製`: opening the copy flow is navigation, but saving the copied tag creates data.

## Create Condition Tag

Route: `/bi-dev/zh-TW/tag/player/new?gameId=541`

Default state:

- Page title: `新增標籤`.
- `條件標籤` selected by default; `人工標籤` available.
- `條件類別`: default `消費級距 R`.
- `篩選類型`: default `動態時間區間`.
- `分析時段`: default `過去 7 天`.
- Fields: `標籤名稱`, `條件類別`, `篩選類型`, `分析時段`, `備註`, `子標籤級距`.
- Footer: `取消`, `儲存`.

Condition category options:

- `消費級距 R`
- `累積登入天數`
- `累積未登入天數`
- `累積遊戲時間`

Filter type options:

- `動態時間區間`
- `靜態時間區間`
- `依報表區間設置`
- `首次後持續累計`

Sub-tag grade editor:

- Section text: `子標籤級距`.
- Help text:
  - `標籤值至多 10 個`
  - `級距請由大到小排列（第一列為最高區間）`
  - `相鄰級距的數值須連貫，不可有空隙或重疊`
  - `每個子標籤至少需設定下限或上限其中之一`
- Add button text: `新增標籤`.
- Initial row fields: `子標籤名稱`, `下限`, `上限`.
- Numeric inputs:
  - Lower input aria label `第 1 個子標籤下限數值`, placeholder `數值`, value `0`.
  - Upper input aria label `第 1 個子標籤上限數值`, placeholder `數值`, value `0`.
  - Stepper buttons: `增加`, `減少`; decrease is disabled at `0`.
- Operators:
  - Lower default `≥`.
  - Upper default `≤`.
- Validation text in empty row: `第 1 個子標籤請輸入子標籤名稱`.
- Remove sub-tag button aria label `移除子標籤`; disabled for the first row.

Important drift from earlier assumptions: lower and upper numeric inputs are not blank in this live UI; they default to `0`.

## Date Panel

Opened from `分析時段`.

Observed state when opened from `過去 7 天`:

- Label: `日期範圍`.
- Captured rendered range: `2026/06/20` to `2026/06/26`.
- Dynamic day input sections with `天前` suffix and clear controls.
- Calendar month heading: `六月 2026`.
- Footer: `取消`, `確定`.

Quick options:

- `昨日`
- `今日`
- `上週`
- `本週`
- `上月`
- `本月`
- `過去 7 天`
- `最近 7 天`
- `過去 30 天`
- `最近 30 天`

The exact rendered dates are time-dependent and should not be hardcoded into testcase expected results.

## Create Manual Tag

Route: same create route after selecting `人工標籤`.

Visible fields and text:

- Fields: `標籤名稱`, `備註`, `上傳文件`.
- Guidance: `請上傳欲設置的標籤值與名單檔案，請參閱 檔案範例檔.csv。僅可上傳 csv 檔`.
- Limit: `每個檔案限 10,000 筆資料，每次設置至多 5 個檔案。`
- Button: `選擇檔案`.
- Native file input: hidden, `accept=".csv"`, `multiple=true`, `disabled=false`.
- Example file href: `https://galaxy-media.s3.ap-northeast-1.amazonaws.com/media/bi/userTag/create_user_tag.csv`.
- Tooltip guidance: columns are `標籤值名稱`, `銀河帳號ID ( userobjectid )`, `操作`; create flow operation can only be `add`; edit flow can use `add`, `update`, `delete`.

Test implication: manual upload cases require controlled file fixtures and cannot be judged from screenshots alone.

## Condition Tag Info

Route observed: `/bi-dev/zh-TW/tag/player/14?gameId=541`

Observed sample: `累積遊戲時間01_天_max`.

Visible signals:

- Title group: `標籤資訊與每日資訊`.
- Sections: `標籤基本設置`, `最新標籤值資訊`.
- Button: `查看設置`.
- Basic fields:
  - `標籤名稱`: `累積遊戲時間01_天_max`
  - `標籤類別`: `條件標籤`
  - `條件類型`: `累積遊戲時間`
  - `遊戲時間單位`: `天`
  - `時間類型`: `動態時間區間`
  - `分析時段`: `過去 7 天`
  - `標籤值條件`: `累積遊戲時間`
  - `標籤備註`: `—`
- Latest summary:
  - `總被標籤人數`: `0`
  - Values: A through J, all count `0`.
  - Data updated: `2026-06-24 01:36:54`.
- Controls:
  - `顯示數值`
  - `標籤值 (10/10)`
  - disabled export/download icon
- Empty states:
  - `尚無趨勢資料`
  - `尚無每日資料`

Empty trend/daily states are valid when the selected tag has zero tagged users.

## Condition Settings Readonly

Route observed: `/bi-dev/zh-TW/tag/player/14/settings?gameId=541`

Visible signals:

- Page title: `查看設置`.
- Button: `返回`.
- Fields:
  - `標籤名稱`: `累積遊戲時間01_天_max`
  - `條件類別`: `累積遊戲時間`
  - `遊戲時間單位`: `天`
  - `篩選類型`: `動態時間區間`
  - `分析時段`: `過去 7 天`
  - `排程狀態`: `已結束`
  - `資料最後更新時間`: `2026-06-24 01:36:54`
  - `備註`: `—`
- Section: `子標籤級距`, `標籤值至多 10 個`.
- Grade examples:
  - A: lower `≥ 100`, upper `—`
  - B: lower `≥ 90`, upper `≤ 99`
  - C: lower `≥ 80`, upper `≤ 89`
  - D: lower `≥ 70`, upper `≤ 79`
  - E: lower `≥ 60`, upper `≤ 69`
  - F: lower `≥ 50`, upper `≤ 59`
  - G: lower `≥ 40`, upper `≤ 49`
  - H: lower `≥ 30`, upper `≤ 39`
  - I: lower `≥ 20`, upper `≤ 29`
  - J: lower `—`, upper `≤ 19`

This page is read-only.

## Manual Tag Info

Route observed: `/bi-dev/zh-TW/tag/player/15?gameId=541`

Observed sample: `233`.

Visible signals:

- Title group: `標籤資訊與名單列表`.
- Sections: `標籤基本設置`, `最新標籤值資訊`.
- Button: `編輯設置`.
- Basic fields:
  - `標籤名稱`: `233`
  - `標籤類別`: `人工標籤`
  - `標籤備註`: `23`
- Latest summary:
  - `總授權帳號人數`: `3`
  - Tag values: `一般 (1)`, `VIP (2)`
  - `數據更新時間`: `2026-06-23 22:48:49`
- Member list:
  - `共 3 筆資料`
  - Filter: `標籤值 (2/2)`
  - Headers: `#`, `標籤值`, `銀河帳號ID`, `被貼標/異動時間(GMT+08:00)`
  - Rows:
    - `1`, `一般`, `1589538`, `2026-06-23 22:48:49`
    - `2`, `VIP`, `1589536`, `2026-06-23 22:48:49`
    - `3`, `VIP`, `1589537`, `2026-06-23 22:48:49`
  - Page-size options: `20筆/頁`, `50筆/頁`, `100筆/頁`

## Manual Tag Edit

Route observed: `/bi-dev/zh-TW/tag/player/15/edit?gameId=541`

Visible signals:

- Page title: `編輯標籤`.
- `標籤名稱` value `233`, placeholder `請輸入標籤名稱`, clear button `清除輸入`.
- `備註` value `23`, placeholder `選填`, clear button `清除輸入`.
- Upload guidance includes the create-mode text plus `於編輯標籤時，僅需上傳異動(新增/更新/刪除)的名單`.
- Example file href: `https://galaxy-media.s3.ap-northeast-1.amazonaws.com/media/bi/userTag/update_user_tag.csv`.
- Native file input: hidden, `accept=".csv"`, `multiple=true`, `disabled=false`.
- Footer: `取消`, `儲存`.

Do not click `儲存` on shared dev data unless a testcase declares an owned editable fixture and the action is authorized.

## Tag Variable Settings

Route: `/bi-dev/zh-TW/tag/settings?gameId=541`

Visible signals:

- Page title: `標籤變數設定`.
- Sections: `ID 狀態`, `玩家生命週期`, `備註`, `設置紀錄`.
- Current captured values:
  - N: `5`
  - Z: `5`
  - Y: `4`
  - X: `6`
  - A: `9`
  - B: `4`
  - Note: `Codex revert X after invalid validation smoke`
- Each numeric field has `增加` and `減少` stepper buttons.
- Textarea placeholder: `輸入本次調整的說明（選填，上限 200 字）`.
- Save button: `儲存`.
- Validation/help text: `防呆（按「儲存」時）：X > Y、A ≥ B、Z ≥ 0 其餘 ≥ 1 且皆為整數；通過後寫入並於設置紀錄新增一筆，變更向前生效（不回溯重算歷史名單）。`
- History headers: `設置時間`, `N`, `Z`, `Y`, `X`, `A`, `B`, `備註`, `操作人`.
- Page-size options: `10筆/頁`, `20筆/頁`, `50筆/頁`.

Saving changes affects future calculations and is not an ordinary read-only smoke action.
