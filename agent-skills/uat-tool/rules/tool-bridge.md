# Tool Bridge Rule v1.0

本規則定義 CodexRunner 何時必須暫停，並透過 Web UI 等待 human input。

## 核心原則

人工授權不是 `detail_json` 裡的一句話。

只有本 run 的 Tool Bridge response event 才算有效授權。

## 支援的 Actionable Request Types

M1 目前支援的 actionable types：

- `playwright_recovery`：SSO login、page blocker、browser recovery、manual page preparation。
- `irreversible_operation`：delete、overwrite、native alert/confirm acceptance、其他不可逆動作。
- `ambiguity_decision`：testcase、domain、expected result、environment ambiguity 無法安全判斷。

其他 diagnostic requests 可以記錄，但除非 backend 明確視為 actionable，否則不應阻塞流程。

## 必要 Envelope

Codex 必須用以下 envelope emit actionable request：

```text
[TOOL_REQUEST]{"type":"playwright_recovery","request_id":"<uuid>","error":"LOGIN_REQUIRED","proposed_action":"Tommy 在 persistent Chrome window 完成 SSO login，然後點 已處理。"}[/TOOL_REQUEST]
```

每個 actionable request 必須包含：

- `type`
- `request_id`
- 可讀的問題欄位，例如 `error` 或 `reason`
- `proposed_action`

## 何時必須暫停

以下情況必須透過 Tool Bridge pause：

- Galaxy SSO/login required。
- 頁面顯示 login screen、`載入失敗`、401/403、account/session blocker。
- 必須接受 native alert/confirm。
- 操作會 delete、overwrite、reset、永久變更資料、或離開未儲存頁面。
- testcase ambiguous，猜測會讓結果不可信。
- Playwright/browser session broken，需要 Tommy intervene。
- required source file missing 且無法安全推論。

## SSO / Playwright Recovery

SSO 發生時，不可直接 fail run。

應 emit `playwright_recovery`，保持 browser open，等待 Tommy 在 Web UI 點回覆按鈕。

正確流程：

1. 偵測 blocker。
2. 若可行，capture screenshot。
3. emit Tool Bridge request。
4. 停在 safe pause point。
5. 收到 response event 後才 resume。

錯誤行為：

- Tommy 還沒登入就關閉 browser。
- 因為需要 login 就寫 FAIL。
- 沒有 Tool Bridge response 卻聲稱 Tommy 已登入。
- 在 login page 背後繼續 click。

## Irreversible Operations

native confirm/alert 與不可逆操作一律需要 Tool Bridge。

例子：

- Delete report。
- Delete project。
- Overwrite existing report。
- 接受 browser confirm for deletion。
- 離開含未儲存變更的頁面。
- Clear stored run data。

## Consecutive Native Dialog Guard

同一個 save/delete/overwrite/native flow 中，如果已處理第一個 native alert/confirm，接著偵測到或合理推定還有第二個 native dialog：

- 未收到 Tool Bridge response 前，不要嘗試用 Playwright accept/dismiss 任何 dialog。
- 收到 Tool Bridge response 後，Agent helper 只可自動處理已知 BI save flow dialog，例如「報表儲存成功」與「是否返回報表列表？」。
- 未知第二個 dialog 不可直接 accept；需轉成 recovery。
- 不要用 repeated snapshot/read_page 去賭頁面是否已恢復，dialog chain 會讓這些操作 timeout。
- 立即 emit `playwright_recovery` Tool Bridge request。
- 由 Tommy 或 Mac Agent auto approval policy 處理 recovery 後，再繼續同一題。

目的：避免連續 native dialog 在 Playwright MCP 層 timeout，造成 60-120 秒無效等待；同時允許已知且必要的 BI save return-to-list confirm 在同一個已授權 action 內完成。

request 必須說明：

- Operation。
- Target。
- Expected impact。
- 是否為 temporary test resource。

## 授權有效範圍

授權只對該 request 的 operation 有效。

如果 Codex 請求刪除 report A，不能拿同一個 approval 刪除 report B。

如果 approval 後 page state materially changed，必須重新詢問。

## Policy Violation

以下視為 policy violation：

- `detail_json` 說 Tommy approved，但沒有 Tool Bridge response。
- Codex 未經 Tool Bridge 接受 confirm/alert。
- Codex 未經 Tool Bridge 執行 delete/overwrite。
- Codex 偽造 Tool Bridge response。
- Codex 在 SSO blocker 後未等 user response 就繼續。

policy violation 應顯示在 logs，且應阻止 trusted final results。
