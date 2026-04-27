# Artifacts and Results Rule v1.0

本規則定義 run 產生檔案的 platform contract。

## 核心原則

Artifacts 是測試結果的一部分。

即使 run failed 或 cancelled，partial artifacts 仍有除錯價值，必須保存。

## Per-Run Workspace

每個 Agent run 必須使用獨立 workspace：

```text
~/.uat-agent/runs/<run_id>/
  input/
  output/
  artifacts/
  mcp-output/
```

不同 run 的 artifacts 不可混用。

## Required Final Artifacts

run 正常完成時，上傳：

- `output/result.xlsx`
- `output/agent.log`
- `output/codex-result.json`，若存在
- MCP output directory summary 或 archive，若存在
- case evidence 引用的 screenshots，若存在

## Required Partial Artifacts

run cancelled、failed、或 lost Agent connection 時，上傳所有已存在內容：

- partial `agent.log`
- partial stdout/stderr
- partial `result.xlsx`
- partial MCP snapshots
- screenshots
- error summary

backend 應記錄 `run.partial_artifacts` event。

## Result xlsx Trust

`result.xlsx` 存在不代表自動可信。

如果 run abnormal ended，UI 必須清楚標示 partial。使用者需要知道 case rows 可能 incomplete 或 untrusted。

如果 Codex 在 evidence 不足時產生 case results，這些 rows 應標為 blocked 或 evidence-insufficient。

## Logs

Agent 應維持 execution log，至少包含：

- run id
- agent id / device name
- CodexRunner start command summary
- browser/CDP preparation
- downloaded inputs
- per-case progress
- Tool Bridge requests and responses
- artifact upload attempts
- cancel/fail reason

不可只依賴 Codex final output。

## Web UI Visibility

Web UI 應顯示：

- live progress events
- latest Agent stdout/stderr snippets
- Tool Bridge waiting cards
- partial artifact availability
- final artifact download links

如果畫面只看到 `uat-agent starting CodexRunner`，代表 observability 不足。

## Screenshot References

Screenshots 可以支援 evidence，但不能取代 structured observations。

例子：

- 不佳：`See screenshot for result.`
- 較佳：`Observed table row count = 31; screenshot path = artifacts/screenshots/B-01_after_execute.png.`

## Artifact Portability

結果中優先保存 logical artifact ids 或 relative run paths。Raw local paths 未來若從 local disk 搬到 cloud storage，可能失效。
