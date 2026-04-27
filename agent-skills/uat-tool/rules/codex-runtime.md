# Codex Runtime Rule v1.0

本規則定義 CodexRunner 如何使用 Codex CLI 與 Playwright MCP。

## 核心原則

CodexRunner 必須 observable、interruptible，且對結果保守。

不要靠把越來越多 prompt text 塞進 initial prompt 來解決可靠性問題。

## Startup Context

initial prompt 應保持短：

- run id
- workspace paths
- input file paths
- domain key
- Tool Bridge envelope format
- 先讀 Layer 1 skill 的指示
- 用 progressive disclosure route 到 domain rules 的指示

不要把所有 BI rules 貼進 initial prompt。

## Runtime Progress

Codex 必須 emit，或讓 Agent emit，足以讓 Web UI 顯示的 progress。

最低文字 checkpoints：

- `Starting run <run_id>`
- `Loaded platform skill`
- `Routed domain: <domain>`
- `Starting case <case_no>`
- `Captured evidence for <case_no>`
- `Wrote result for <case_no>`
- `Waiting for Tool Bridge response <request_id>`
- `Uploading artifacts`

## Playwright MCP Usage

使用 Playwright MCP 進行 browser operations。

不可用 direct application API calls 取代 UI 操作，除非 domain rule 明確允許 read-only observation。

使用 persistent Chrome CDP session 時：

- Tool Bridge wait 期間保持 browser open。
- SSO required 時不可關閉 Chrome。
- 設定存在時，重用 persistent profile。
- MCP outputs 存到 current run workspace。

## Tool Approvals

CodexRunner 不可假設 hidden approvals。

如果操作需要 human approval，使用 Tool Bridge。不要依賴 Codex CLI interactive approval prompts 來處理 workflow-critical decisions。

如果 Codex CLI 或 MCP 要求 local tool permission，且 Agent 無法繼續，必須清楚 fail 或 pause，不可 silent hang。

## One Case at a Time

逐 case 執行與記錄：

1. 讀 current case。
2. 執行 current case。
3. capture evidence。
4. 寫 current case result。
5. emit progress。
6. 移到 next case。

不可用 opaque tool call 批次執行多個 case。

## Result Conservatism

如果 Codex 不確定 operation 是否完成，不可寫 PASS。

如果 Codex 能證明 runtime/tool blocker，使用 blocked/evidence-insufficient。

如果 Codex 能證明 product behavior 與 expected behavior 衝突，使用 FAIL。

## Cancellation

CodexRunner 應把 cancellation 視為正常 control flow：

- stop subprocess
- flush logs
- preserve partial output
- 讓 Agent upload partial artifacts

若 cancellation 已發生，不要等待 Codex final summary。
