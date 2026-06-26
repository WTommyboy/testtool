# TAG_TOOL Live UI Inventory - 2026-06-23

Target: `https://galaxy.games.gamania.com/bi-dev/zh-TW/tag/player?gameId=541`

Workspace: `/Users/tommy/Downloads/codex_galaxy_dev/uat-tool`

Capture method: Playwright against the live dev UI after SSO was already available in the browser session.

Safety boundary: no save, delete, terminate, copy, upload, or variable-setting mutation was executed. Captured actions were limited to navigation, opening menus/dropdowns/date panels, switching the unsaved create form between condition/manual modes, and reading visible DOM state.

## Captured Routes

- Player tag list: `/bi-dev/zh-TW/tag/player?gameId=541`
- Create tag: `/bi-dev/zh-TW/tag/player/new?gameId=541`
- Variable settings: `/bi-dev/zh-TW/tag/settings?gameId=541`
- Condition tag read-only settings example: `/bi-dev/zh-TW/tag/player/1/settings?gameId=541`
- Condition tag information example: `/bi-dev/zh-TW/tag/player/1?gameId=541`
- Manual tag information example: `/bi-dev/zh-TW/tag/player/15?gameId=541`
- Manual tag edit example: `/bi-dev/zh-TW/tag/player/15/edit?gameId=541`

Playwright output names captured during discovery:

- `tag-tool-list-2026-06-23.png`
- `tag-tool-list-page2-2026-06-23.png`
- `tag-tool-row-action-menu-2026-06-23.png`
- `tag-tool-create-default-2026-06-23.png`
- `tag-tool-create-date-panel-2026-06-23.png`
- `tag-tool-create-manual-2026-06-23.png`
- `tag-tool-variable-settings-2026-06-23.png`
- `tag-tool-condition-view-settings-2026-06-23.png`
- `tag-tool-condition-info-2026-06-23.png`
- `tag-tool-condition-info-value-dropdown-2026-06-23.png`
- `tag-tool-manual-info-233-2026-06-23.png`
- `tag-tool-manual-edit-233-2026-06-23.png`

## Player Tag List

Observed on 2026-06-23:

- Sidebar section is `工具設定 > 標籤`.
- Sidebar links are `玩家標籤管理` and `標籤變數設定`.
- Breadcrumb is `數據中心 > 主頁 > 標籤 > 玩家標籤管理`.
- Page title is `玩家標籤管理`.
- Toolbar has `刪除` disabled by default and `新增` enabled.
- Table/list headers are `標籤名稱`, `標籤類型`, `條件類別`, `篩選類型`, `排程狀態`, `資料最後更新時間`, `備註`, `操作`.
- Current dev data is not empty: list shows `共 28 筆資料`, `20筆/頁`, pages `1` and `2`.
- Page 1 contains 20 visible rows; page 2 contains 8 visible rows.
- Row action trigger has accessible label `更多操作` and visible text `•••`.

Visible row types and examples:

- Condition tags with condition categories `累積遊戲時間`, `消費級距 R`, `累積登入天數`, `累積未登入天數`.
- One visible manual tag example: `233`, `人工標籤`, last update `2026-06-23 22:48:49`.
- Condition filter types observed in list rows: `動態時間區間`, `靜態時間區間`, `依報表區間設置`, `首次後持續累計`.
- Schedule status values observed: `進行中`, `—`.

Row action menus:

- Condition tag menu: `查看設置`, `標籤資訊`, `終止`, `刪除`, `複製`.
- Manual tag menu: `編輯`, `標籤資訊`, `刪除`, `複製`.

Not captured by design:

- Delete and terminate confirmation modals were not opened because they are destructive paths.

## Create Tag - Condition Mode

Route: `/bi-dev/zh-TW/tag/player/new?gameId=541`

Default state:

- Page title: `新增標籤`.
- `條件標籤` is selected by default.
- `人工標籤` is available as the alternative radio option.
- Form fields: `標籤名稱`, `條件類別`, `篩選類型`, `分析時段`, `備註`.
- Defaults observed: `條件類別 = 消費級距 R`, `篩選類型 = 動態時間區間`, `分析時段 = 過去 7 天`.
- Bottom actions: `取消`, `儲存`.

Condition category dropdown options:

- `消費級距 R`
- `累積登入天數`
- `累積未登入天數`
- `累積遊戲時間`

Filter type dropdown options:

- `動態時間區間`
- `靜態時間區間`
- `依報表區間設置`
- `首次後持續累計`

Sub-tag grade editor:

- Section label: `子標籤級距`.
- Limit text: `標籤值至多 10 個`.
- Add button currently reads `新增標籤`.
- Row fields: `子標籤名稱`, `下限`, `上限`.
- Default validation text visible when empty: `第 1 個子標籤請輸入子標籤名稱`.
- Lower-bound operator dropdown options: `無`, `≥`, `>`, `=`.
- Upper-bound operator dropdown options: `無`, `≤`, `<`.

Date range panel:

- Trigger default: `過去 7 天`.
- Panel title: `日期範圍`.
- On 2026-06-23, default display was `過去 7 天 (2026/06/16 ⭢ 2026/06/22)`.
- Quick options: `昨日`, `今日`, `上週`, `本週`, `上月`, `本月`, `過去 7 天`, `最近 7 天`, `過去 30 天`, `最近 30 天`.
- Panel includes two dynamic day inputs; observed values were `7` and `1`.
- Panel includes two month calendars, month heading `六月 2026`, and footer buttons `取消`, `確定`.
- Escape did not close this panel during capture; clicking panel `取消` closed it.

## Create Tag - Manual Mode

Selecting `人工標籤` hides condition/category, filter/time, analysis period, and sub-tag grade fields.

Visible manual fields:

- `標籤名稱`, placeholder `請輸入標籤名稱`.
- `備註`, placeholder `選填`.
- `上傳文件`.
- `選擇檔案`.
- Bottom actions: `取消`, `儲存`.

Manual upload guidance:

- Text says: `請上傳欲設置的標籤值與名單檔案，請參閱 檔案範例檔.csv。僅可上傳 csv 檔`
- Limit text: `每個檔案限 10,000 筆資料，每次設置至多 5 個檔案。`
- Tooltip text says CSV columns are `標籤值名稱`, `銀河帳號ID ( userobjectid )`, `操作`.
- Tooltip says create flow operation can only be `add`; edit flow can use `add`, `update`, `delete`.

## Condition Tag - View Settings

Example route captured: `/bi-dev/zh-TW/tag/player/1/settings?gameId=541`

Observed:

- Breadcrumb ends with `累積遊戲01_天 > 查看設置`.
- Page title: `查看設置`.
- Only visible action is `返回`.
- Fields are read-only presentation fields, not editable inputs.
- Example fields: `標籤名稱`, `條件類別`, `遊戲時間單位`, `篩選類型`, `分析時段`, `排程狀態`, `資料最後更新時間`, `備註`.
- Example values included `條件類別 = 累積遊戲時間`, `遊戲時間單位 = 天`, `篩選類型 = 動態時間區間`, `分析時段 = D-106 ⭢ D-84`, `排程狀態 = 進行中`.
- Section `子標籤級距` lists values and bounds, for example `_A`, `_B`, `_C`.

## Condition Tag - Information

Example route captured: `/bi-dev/zh-TW/tag/player/1?gameId=541`

Observed:

- Page title group: `標籤資訊與每日資訊`.
- Sections: `標籤基本設置`, `最新標籤值資訊`, trend area, daily data area.
- `查看設置` button links back to read-only settings.
- Date trigger: `過去 7 天`; displayed range `2026/06/16 - 2026/06/22`.
- Controls: `顯示數值` switch, `標籤值 (3/3)` dropdown, disabled export/download icon.
- Latest value summary included `總被標籤人數 0`, three tag values, and `數據更新時間`.
- Empty states observed: `尚無趨勢資料`, `尚無每日資料`.

Value dropdown:

- `全選` checkbox.
- One checkbox per tag value.
- In the captured condition example all three values were checked.

## Manual Tag - Information

Example route captured: `/bi-dev/zh-TW/tag/player/15?gameId=541`

Observed:

- Page title group: `標籤資訊與名單列表`.
- Sections: `標籤基本設置`, `最新標籤值資訊`, member list table.
- `編輯設置` button links to manual edit form.
- Example basic fields: `標籤名稱`, `標籤類別`, `標籤備註`.
- Latest value summary included `總授權帳號人數 3`, tag values `一般 (1)` and `VIP (2)`, and `數據更新時間`.
- Table headers: `#`, `標籤值`, `銀河帳號ID`, `被貼標/異動時間(GMT+08:00)`.
- Pagination controls: `上一頁`, page `1`, `下一頁`, page-size options `20筆/頁`, `50筆/頁`, `100筆/頁`.
- `標籤值 (2/2)` dropdown is available for filtering the member list.

## Manual Tag - Edit

Example route captured: `/bi-dev/zh-TW/tag/player/15/edit?gameId=541`

Observed:

- Page title: `編輯標籤`.
- Visible fields: `標籤名稱`, `備註`, `上傳文件`.
- Existing values are prefilled in text inputs.
- Text inputs expose `清除輸入` buttons.
- Upload guidance matches manual create, with one extra edit-only line: `於編輯標籤時，僅需上傳異動(新增/更新/刪除)的名單`.
- Actions: `取消`, `儲存`.
- No file was selected and save was not clicked.

## Tag Variable Settings

Route: `/bi-dev/zh-TW/tag/settings?gameId=541`

Observed:

- Page title: `標籤變數設定`.
- Sections: `ID 狀態`, `玩家生命週期`, `備註`, `設置紀錄`.
- Current values observed on 2026-06-23: `N=5`, `Z=5`, `Y=4`, `X=6`, `A=9`, `B=4`.
- Variables are numeric inputs with stepper controls.
- `備註` is a textarea; current visible value was `Codex revert X after invalid validation smoke`.
- Save button text is `儲存`.
- History table headers: `設置時間`, `N`, `Z`, `Y`, `X`, `A`, `B`, `備註`, `操作人`.
- History page-size control showed `10筆/頁`.
- Current history included rows from `2026.06.23` and `2026.06.22`, operated by `tommy`.

Important drift from 2026-06-22 inventory:

- The player tag list is no longer empty in dev; it currently has 28 records.
- Variable values changed from the 2026-06-22 inventory; tests must not assume the old N/Z/Y/X/A/B values.
- Create condition sub-tag add button observed as `新增標籤` in this capture.

## Candidate Domain Pack Updates

Recommended follow-up updates, not applied in this capture:

- Update `page-map.json` route examples:
  - condition settings uses `/player/:tagId/settings`, not singular `/setting`.
  - tag information uses `/player/:tagId`, not `/player/:tagId/info`.
- Expand `ui-object-vocabulary.json` for:
  - condition/manual row action menu variants.
  - condition category and filter type dropdown options.
  - sub-tag grade operator dropdown options.
  - condition information page value checkbox dropdown.
  - manual information member table and page-size dropdown.
  - manual edit form and edit-only upload guidance.
- Add route-aware contracts so manual and condition tags do not share the same action assumptions.
- Keep destructive confirmation modal capture separate and permission-gated.
