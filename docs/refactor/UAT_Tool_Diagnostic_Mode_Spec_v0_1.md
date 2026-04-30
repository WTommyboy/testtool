# UAT Tool Diagnostic Mode Spec v0.1

## 1. 目的

Diagnostic mode 是給 Tommy / Codex 快速迭代用的非可信執行模式。

它解決的不是正式 UAT 速度，而是「改一個 case wording、locator、helper template 後，要很快知道有沒有方向錯」的迭代成本。

## 2. 非目標

Diagnostic mode 不產生可信 UAT 結果。

不可做的事：

- 不寫可信 `output/result.xlsx`
- 不更新 run case PASS / FAIL / BLOCKED
- 不把 partial step evidence 當完整 case evidence
- 不一次跑多個 case
- 不繞過 UI 操作紅線

正式結果仍必須走 trusted mode：完整 current case action chain、current-run evidence、result evidence gate。

## 3. 模式定義

建議未來 dispatch payload：

```json
{
  "execution_mode": "diagnostic",
  "diagnostic": {
    "caseNo": "DEMO-A-01",
    "fromStep": 1,
    "untilStep": 3,
    "purpose": "verify locator registry candidates",
    "writeTrustedResult": false
  }
}
```

欄位：

| 欄位 | 必填 | 說明 |
|---|---:|---|
| `caseNo` | 是 | 只允許單一 current case |
| `fromStep` | 否 | 從指定 step 開始；前段 step 視為未在本次 diagnostic 執行 |
| `untilStep` | 否 | 執行到指定 step 後停止 |
| `purpose` | 否 | 這次 diagnostic 要驗什麼 |
| `writeTrustedResult` | 是 | 必須為 `false`；若為 true，拒絕 dispatch |

## 4. Evidence Chain 規則

Diagnostic mode 的核心限制是 evidence chain 不完整。

若從 step 4 開始：

- step 1-3 不可視為已在本次 run 證明
- 頁面既有狀態只是 setup context，不是 evidence
- summary 必須列出 skipped steps 與 evidence gaps

若跑到 step 3 停止：

- step 4 之後沒有結果判定
- 不可推論整題 PASS / FAIL
- 可回報「到 step 3 為止 locator/helper 可用」

## 5. Output Contract

Diagnostic mode 寫入：

```text
output/diagnostic-summary.json
output/timing-summary.json
output/locator-drift.log          若有 drift
output/helper-artifacts/<case>/   若使用 helper
```

`diagnostic-summary.json` 格式：

```json
{
  "schemaVersion": "uat-diagnostic-summary-v0.1",
  "generatedAt": "2026-04-30T06:18:00+08:00",
  "runId": "<run-id>",
  "caseNo": "DEMO-A-01",
  "fromStep": 1,
  "untilStep": 3,
  "purpose": "verify locator registry candidates",
  "executedSteps": [
    {
      "stepNo": 1,
      "status": "ok",
      "artifacts": ["output/helper-artifacts/DEMO-A-01/..."]
    }
  ],
  "skippedSteps": [],
  "evidenceGaps": ["steps after 3 not executed"],
  "locatorDrift": [],
  "helperReports": [],
  "canPromoteToTrustedResult": false
}
```

## 6. Result Ingestion Gate

Server 應拒絕 diagnostic output 作為 trusted result。

建議 gate：

- `resultSource=diagnostic` 直接 422
- 若 `output/result.xlsx` 存在但 run mode 是 diagnostic，拒絕 ingest
- UI 顯示 diagnostic artifacts，但不更新正式 case result

## 7. 與 Helper / Locator Registry 的關係

Diagnostic mode 是驗證 helper 和 locator registry 的主要工具。

可用場景：

- 只跑到 field picker 展開，驗證 locator registry 是否命中
- 只跑 helper pre-run，觀察 helper action duration
- 驗證 date range UI 設定是否穩定
- 驗證 selector drift 是否集中在某一組 locator

限制：

- Helper report `status=ok` 仍不等於 PASS
- Locator 命中只代表找到 UI，不代表 case 成功
- Diagnostic artifact 不能改名後上傳成 trusted result

## 8. 建議實作順序

1. 先完成 spec 與 Layer 1 rule。已完成。
2. 加 dispatch payload validation：`execution_mode=diagnostic` 時不得要求 result upload。已完成最小版，trusted result gate 會拒絕 `resultSource=diagnostic`。
3. Agent 支援只產 `diagnostic-summary.json`，不呼叫 trusted result upload。已完成最小版。
4. Web UI 顯示 diagnostic artifacts 與 timing summary。已完成最小版。
5. 再加 `fromStep` / `untilStep` prompt wiring。

## 9. 目前狀態

v0.1 已有最小 runtime dispatch。

目前已支援：

- `execution_mode=diagnostic`
- 下載 input、產 current-case pack / capability gate / helper execution plan
- 重置 dedicated Chrome
- 執行 safe helper pre-run
- 寫出並上傳 `output/diagnostic-summary.json`
- 寫出並上傳 `output/timing-summary.json`
- Web UI 顯示 timing bucket 與 diagnostic 摘要
- result evidence gate 拒絕 `resultSource=diagnostic`

目前尚未支援：

- Web UI 填寫 `fromStep` / `untilStep`
- Codex diagnostic partial-step execution prompt wiring
- locator drift review UI

Diagnostic output 仍不可改名或重上傳成 trusted `output/result.xlsx`。要產正式 UAT 結果，必須用 trusted mode 重新執行完整 current case evidence chain。
