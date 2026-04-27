# Run Lifecycle Rule v1.0

本規則定義 Galaxy UAT Tool 的平台層 run lifecycle。

## 核心原則

run 不是單純的 background job，而是可稽核的 workflow。它必須有明確狀態、可恢復的 partial artifacts，以及可追蹤的人工暫停點。

平台必須讓以下資訊可見：

- run 由誰建立。
- 哪個 Agent 正在執行。
- Agent 目前正在做什麼。
- run 是否正在等待 human decision。
- run cancelled 或 failed 時，留下哪些 artifacts。

## 預期高階流程

1. Web UI 建立 run。
2. API 儲存上傳的 testcase files 與 run metadata。
3. API 將 run dispatch 給可用 Agent。
4. Agent 將 input files 下載到 per-run workspace。
5. Agent 啟動 CodexRunner。
6. CodexRunner streaming progress 與 Tool Bridge requests。
7. Agent 上傳 final 或 partial artifacts。
8. API ingest result artifacts 並更新 run status。

## 狀態紀律

狀態轉移必須清楚，不可沒有 log 就從 created 直接跳 failed。

建議 semantic states：

- `READY`：run 已建立，可被 dispatch。
- `ASSIGNED`：run 已指派給 Agent。
- `AGENT_RUNNING`：Agent 已開始執行。
- `WAITING_USER`：Agent/Codex 正在等待 Tommy 或其他人工處理。
- `UPLOADING_RESULT`：Agent 正在上傳 output artifacts。
- `INGESTING_RESULT`：API 正在解析與入庫結果。
- `SUCCEEDED`：所有必要 case 完成且結果已入庫。
- `FAILED`：runtime / tool / system failure 導致 run 結束。
- `CANCELLED`：PM 或系統取消執行。

如果目前 DB enum 尚未完全一致，實作可先 map 到現有 enum，但 logs 必須保留上述語意。

## Progress Events

CodexRunner 與 Agent 必須足夠頻繁地 emit progress，讓 Web UI 在執行中有用。

最低限度 checkpoints：

- Agent accepted run。
- Input files downloaded。
- CodexRunner started。
- Browser/CDP session prepared。
- Domain rules selected。
- Current case started。
- Current case action completed。
- Current case evidence captured。
- Current case result written。
- Tool Bridge pause requested。
- Partial artifacts uploaded。
- Final artifacts uploaded。

## Cancellation

Cancellation 是一條正式流程，不是事後 error。

run 被 cancelled 時：

- 盡可能停止 CodexRunner。
- 保存已收集的 stdout/stderr。
- 保存 MCP output。
- 保存 screenshots。
- 保存 partial result xlsx。
- 用 `run.partial_artifacts` 上傳 partial artifacts。
- 記錄 cancellation reason。

不可因為 run 未完成就丟掉 local evidence。

## Failure

execution failed 時：

- 儲存 error message。
- 儲存 failed phase。
- 儲存 partial artifacts。
- runtime/system failure 使用 `FAILED`。
- 平台仍活著、但 case 缺乏可信 evidence 時，優先用 case-level `BLOCKED` 或 `EVIDENCE_INSUFFICIENT`。

## Resume

Resume 必須明確。

如果 run 在 `WAITING_USER`，只能在收到 Tool Bridge response 後繼續。response 必須先寫入 run events，再讓 CodexRunner resume。
