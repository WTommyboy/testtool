# TAG_TOOL Live Inventory - 2026-06-22

Target: `https://galaxy.games.gamania.com/bi-dev/zh-TW/tag/player?gameId=541`

Browser session: in-app browser after Tommy completed Galaxy SSO.

## Verified Routes

- Player tag list: `/bi-dev/zh-TW/tag/player?gameId=541`
- Create tag: `/bi-dev/zh-TW/tag/player/new?gameId=541`
- Variable settings: `/bi-dev/zh-TW/tag/settings?gameId=541`

## Player Tag List

Observed:

- Sidebar section text is `工具設定`, not `工具設置`.
- Sidebar links: `玩家標籤管理`, `標籤變數設定`.
- Breadcrumb: `數據中心 > 主頁 > 標籤 > 玩家標籤管理`.
- Page title: `玩家標籤管理`.
- Toolbar: `刪除` disabled, `新增` enabled.
- Empty state text: `尚無標籤資料`.

PRD drift:

- PRD/prototype says empty state `無標籤資料`.
- PRD/prototype uses `工具設置`; live UI uses `工具設定`.

## Create Tag - Condition

Observed:

- Route: `/tag/player/new`.
- Page opens with `條件標籤` selected by default.
- There is no initial unselected tag type state.
- Labels are `條件類別` and `篩選類型`, not PRD `條件類型` and `時間類型`.
- Analysis period button default: `過去 7 天`.
- Date panel opens and shows quick options: `昨日`, `今日`, `上週`, `本週`, `上月`, `本月`, `過去 7 天`, `最近 7 天`, `過去 30 天`, `最近 30 天`.
- Date panel showed current default range `(2026/06/15 ⭢ 2026/06/21)` on 2026-06-22 Asia/Taipei.
- Condition value section is `子標籤級距`.
- One grade row is pre-populated with fields `子標籤名稱`, `下限`, `上限`.
- Add button text is `新增級距`.
- Bottom buttons are `取消` and `儲存`.

PRD drift:

- PRD v1.3.4 requires initial create state before tag type selection.
- PRD v1.3.4 requires condition tag value setup initially empty with only `+ 添加`.
- PRD v1.3.4 names fields `條件類型`, `時間類型`, `標籤值設置`, `確定新增`.

Live blocker:

- Attempted to create `UAT_TAG_20260622_COND_SMOKE` with one grade `UATALL`, lower `>= 0`, upper `<= 999999`.
- Clicking `儲存` via role locator and visible DOM node left the page unchanged.
- No toast, no console error, and no navigation/list refresh was observed.

## Create Tag - Manual

Observed:

- Selecting `人工標籤` hides condition/category, filter/time, and analysis period fields.
- Manual add page shows upload guidance with sample link:
  `https://galaxy-media.s3.ap-northeast-1.amazonaws.com/media/bi/userTag/create_user_tag.csv`
- Guidance tooltip text mentions fields `標籤值名稱`, `銀河帳號ID ( userobjectid )`, and `操作`.
- Guidance says add flow operation can only be `add`; edit flow can use `add`, `update`, `delete`.
- Limit text: `每個檔案限 10,000 筆資料，每次設置至多 5 個檔案。`
- Buttons are `取消` and `儲存`.

PRD drift:

- PRD v1.3.4 says add flow CSV has exactly 2 columns: `標籤值名稱`, `帳號ID`, with no `操作` column.
- PRD v1.3.4 sample file links are Google Sheets, not the live S3 link.

## Tag Variable Settings

Observed route: `/bi-dev/zh-TW/tag/settings?gameId=541`

Observed current values:

- N = 7
- Z = 6
- Y = 3
- X = 7
- A = 10
- B = 5

Observed UI:

- Page title `標籤變數設定`.
- Inputs expose accessible textbox names for each variable.
- Each variable has `增加` and `減少` buttons.
- Save button text is `儲存`.
- Setting history table headers: `設置時間`, `N`, `Z`, `Y`, `X`, `A`, `B`, `備註`, `操作人`.
- Time format observed: `YYYY.MM.DD HH:MM`.

Live bug / environment note:

- Invalid test set `X=3` while `Y=3`; PRD says this must be blocked because `X > Y`.
- Live UI returned success toast `標籤變數設定已儲存`.
- Form was immediately restored to X=7 and saved with note `Codex revert X after invalid validation smoke`.
- History now shows two rows at `2026.06.22 23:33`; both display N7/Z6/Y3/X7/A10/B5, one with the restore note and one with `—`.

PRD drift:

- PRD says success toast is `設定已儲存`; live UI shows `標籤變數設定已儲存`.
- PRD v1.3.4 expected initial example history rows; live environment initially had no rows before the save smoke.
- PRD history columns do not include `操作人`; live table includes `操作人`.
