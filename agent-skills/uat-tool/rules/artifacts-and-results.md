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
- `output/evidence-artifacts-manifest.json`

## Required Partial Artifacts

run cancelled、failed、或 lost Agent connection 時，上傳所有已存在內容：

- partial `agent.log`
- partial stdout/stderr
- partial `result.xlsx`
- partial MCP snapshots
- screenshots
- error summary

backend 應記錄 `run.partial_artifacts` event。

## Evidence Artifact Manifest

M2 起，Agent 必須產生 generic evidence artifact manifest：

```text
output/evidence-artifacts-manifest.json
```

manifest entries 至少包含：

- `artifactId`
- `runId`
- `caseId`
- `action`
- `artifactType`
- `relativePath`
- `checksum`
- `sizeBytes`
- `createdAt`
- `source`
- `retentionClass`
- `uploadStatus`
- `remoteArtifactId` / `remoteUrl`，若已上傳

Agent 會把下列檔案列入候選：

- `output/helper-artifacts/**`
- `output/helper-artifacts-archive/**`
- `output/screenshots/**` 與 `output/*.png/jpg/webp`
- `artifacts/**`
- `mcp-output/**`
- `output/locator-drift.log`
- `output/locator-drift.jsonl`
- helper pre-run / cleanup summary

Backend 以 `POST /api/runs/:id/output/artifacts` 接收 generic artifacts，並在 `run_artifacts` 記錄 metadata。Web UI 應顯示 artifact list 與 download link。

Artifact upload 是附加 observability，不得改變 case PASS/FAIL/BLOCKED 判定。若 artifact upload 失敗，Agent 留下 upload warning；trusted result evidence gate 仍依 `result.xlsx` 與 structured evidence contract 判斷。

## Result xlsx Trust

`result.xlsx` 存在不代表自動可信。

如果 run abnormal ended，UI 必須清楚標示 partial。使用者需要知道 case rows 可能 incomplete 或 untrusted。

如果 Codex 在 evidence 不足時產生 case results，這些 rows 應標為 blocked 或 evidence-insufficient。

如果 helper 被 capability gate 跳過、且 Codex turn 沒有可用 browser automation tool 或 UI path 不可達，這仍是目前 current case 的可信平台阻塞。Codex 必須寫單題 `BLOCKED` result workbook，`失敗分類` 使用 `TOOL_EXECUTION_UNAVAILABLE` 或 `EVIDENCE_INSUFFICIENT`，並在 `detail_json.currentRunEvidence` 引用本 run 的 capability gate、helper skipped summary、preflight/browser tool 狀態或 agent log 摘要。不可把這種情境丟給 Agent fallback，因為 fallback 不會上傳成可信 UAT result。

## Result Workbook Contract

`output/result.xlsx` 至少需要三個 sheet：

- `索引`
- `測試案例`
- `Bug`

`測試案例` sheet 至少包含：

- `群組ID`
- `群組`
- `編號`
- `測試項目`
- `測試類型`
- `執行方式`
- `結果`
- `失敗分類`
- `詳細紀錄JSON`

`Bug` sheet 至少包含：

- `嚴重度`
- `Bug ID`
- `關聯編號`
- `標題`
- `描述`
- `建議`
- `狀態`

可額外加入 `Evidence` 欄，但不可用 `Evidence` 取代 `狀態`。

`詳細紀錄JSON` 會被 server evidence gate 檢查：

- `PASS` 必填：`測試目的`、`設定條件`、`預期行為`、`實際行為`
- `FAIL` 必填：PASS 四欄，加上 `錯誤原因`、`根因層級`、`驗證方法`、`RD 分派`
- `BLOCKED` 必填：`blocked_reason`
- `PARTIAL` 必填：`部分符合的子項清單`、`不符的子項清單`

缺少上述欄位時，result ingest 會失敗；不視為 case 完成。

## Result Workbook Repair Guard

Agent 可在上傳前修復一種 schema transition case：

- `output/result.xlsx` 來自 Codex，而不是 Agent fallback
- `測試案例` sheet 缺 `群組ID`
- 其餘 header 正好符合舊 8 欄單題格式
- workbook 只有目前 current case 一筆結果
- case no 與 dispatch metadata 相符

符合時，Agent 在 `群組` 前插入 `群組ID`，值取自 input current case，並寫出：

```text
output/result-xlsx-repair.json
```

此 guard 只處理單題 legacy header 漂移。多題 workbook、錯題、缺其他必要欄位、或無法確認 current case 時不可修復，必須繼續由 self-check / server gate 擋下。

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

detail_json 可引用 artifact id / remote URL，但不可只寫「請見截圖」。數值、DOM、network observation 仍要直接寫進 JSON。
