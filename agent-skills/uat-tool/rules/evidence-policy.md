# Evidence Policy v1.0

本規則定義 case result 何時足以被寫成可信 PASS 或 FAIL。

## 核心原則

No evidence, no trusted result。

case result 必須由實際操作鏈與觀察結果支撐。如果操作鏈不完整，結果就不可信。

## Trusted PASS 的最低 Evidence

寫 PASS 前，Codex 必須有 evidence 證明：

- 已到達預期 page 或 workflow。
- 已執行必要 UI actions。
- action 後 page state 確實如預期改變。
- 已觀察到 expected result。
- actual observation 與 testcase expectation 相符。
- 相關 domain-specific sanity checks 已通過。

## Trusted FAIL 的最低 Evidence

寫 FAIL 前，Codex 必須有 evidence 證明：

- testcase 在當前 environment 可執行。
- required preconditions 已滿足。
- action 確實已嘗試。
- observed behavior 與 expected behavior 衝突。
- 該衝突不是 missing evidence、SSO、stale page state、或 tool failure 造成。

若以上不成立，使用 `BLOCKED` 或目前等價的 `EVIDENCE_INSUFFICIENT`。

## 目前 MVP Result Mapping

如果平台尚未支援 `INCONCLUSIVE`，使用：

- `BLOCKED`
- `fail_category = EVIDENCE_INSUFFICIENT`

不可在 evidence 不足時硬寫 PASS/FAIL。

## 可接受 Evidence Types

可接受 evidence 包含：

- Playwright snapshot 或 action 後 page text。
- action 後 screenshot。
- DOM read 證明 visible state。
- network observation 證明 UI 觸發 request。
- UI 產生的 downloaded file。
- input 後讀回 form value。
- 從 rendered UI 讀取 table/chart data。
- Tool Bridge response event。
- domain rule 允許的 reference comparison。

## Existing Data 不是 Current Evidence

不可把 existing page rows、existing reports、older screenshots、older run artifacts 當成 current run 已完成 workflow 的證據。

例子：

- 頁面上看到 `DEMO_A01_*` report，不代表 current run 建立了它。
- create-save-reopen case 必須在 current run 顯示 create、save、reopen 的 evidence chain。

## Evidence Chain

每個 case 應有簡短 evidence chain：

```text
case started
→ precondition checked
→ action performed
→ page/network/state observed
→ expected vs actual compared
→ result written
```

任何一環缺失，都應標 blocked 或 evidence-insufficient，而不是猜測。

## Domain Rules Still Apply

Layer 1 evidence policy 是 generic。

Domain rules 可以要求更嚴格的 evidence。例如 BI 可能要求 metadata comparison、chart values、date range request bodies、或 UI-specific sanity checks。

較嚴格的規則優先。
