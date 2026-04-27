# Agent Security Rule v1.0

本規則定義 Mac Agent 的平台層安全邊界。

## 核心原則

Mac Agent 是 UAT run executor，不是遠端 shell。

Railway 可以派發 UAT run，但不應因此取得任意執行 Tommy Mac 指令的能力。

## Agent Task 白名單

Mac Agent 只接受白名單 task type。

M1 MVP 允許：

- `task.dispatch`：派發一個 UAT run 給 Agent。
- `task.cancel`：取消目前正在執行的 run。

M1 MVP 不允許：

- `shell.exec`
- `file.read`
- `file.write`
- `agent.update_self`
- 任意未定義 command
- 任何讓 Railway 直接要求 Mac 執行 shell command 的 task

如果收到未知 task type，Agent 應拒絕並回報 `task.rejected`，不可嘗試推測或執行。

## 啟動指令處理

啟動指令與 startup instruction 是給 CodexRunner / Codex CLI 的上下文，不是給 Agent 自己執行的 shell script。

Agent 可以：

- 將 startup instruction 寫入 run workspace。
- 將 startup instruction 作為 stdin / prompt 交給 CodexRunner。
- 將 testcase files、domain rules、reference files 提供給 CodexRunner。

Agent 不可以：

- 解析 startup instruction 裡的 shell command 並自行執行。
- 執行上傳文件中夾帶的任意 script。
- 讓 Web UI 或 Railway 直接指定本機 shell command。

## Active Run Lock

同一個 Agent 同時只能執行一個 run。

理由：

- Chrome persistent profile 不適合並行，SSO session 可能互相污染。
- Playwright MCP 與 persistent Chrome CDP 並行風險高。
- 多個 CodexRunner 同時操作同一個桌面/browser profile 會讓 evidence 不可信。
- 並行也容易撞 Codex API rate limit 或工具輸出混線。

如果 Agent 已在執行 run，收到第二個 `task.dispatch` 時：

- 不啟動第二個 CodexRunner。
- 回傳 `run.rejected` 或等價事件。
- reason 使用 `agent_busy`。
- backend 應保留該 run 以便稍後重新 dispatch，或讓 PM 手動重派。

## Cancellation 邊界

`task.cancel` 只允許取消目前 active run。

它不應：

- 刪除歷史 run artifacts。
- 清除 Agent token。
- 關閉整個 Agent process，除非 Agent 本身已進入不可恢復狀態。
- 影響其他 run 的檔案。

取消後仍必須走 partial artifacts 保存流程。

## Token 範圍

Agent token 只授權 Agent 做 UAT run 所需的最小操作：

- 連接 `/agent-ws`。
- 接收指派給自己的 run。
- 拉取指定 run 的 input files。
- 上傳指定 run 的 output / partial artifacts。
- 回報 status、progress、Tool Bridge requests、Tool Bridge responses。

Agent token 不應授權：

- 讀取其他未指派 run 的內容。
- 呼叫管理 API。
- 修改使用者、project、domain pack 設定。
- 存取不屬於該 run 的 artifacts。

## Local Filesystem 邊界

Agent 應將 run 檔案限制在 per-run workspace：

```text
~/.uat-agent/runs/<run_id>/
```

除非明確是設定檔或 persistent Chrome profile，Agent 不應把 run output 寫到任意路徑。

允許的常駐路徑：

- `~/.uat-agent/config.json`
- `~/.uat-agent/chrome-profile/`
- `~/.uat-agent/logs/`
- `~/.uat-agent/runs/<run_id>/`

## Policy Violation

以下視為 Agent security policy violation：

- 收到 unknown task type 後仍執行。
- 同一 Agent 同時啟動兩個 CodexRunner。
- 執行上傳文件裡的 shell command。
- 讓 Railway 直接指定本機 shell command。
- 用 Agent token 讀取未指派 run。
- 取消 run 時刪除非本 run artifacts。

policy violation 應寫入 agent log，並讓 run 進入 failed / rejected 狀態。
