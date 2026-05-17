# Result Gate Decision Table v1

狀態: Draft for review

Owner: Codex implementation owner, based on Tommy + ClaudeCode + Codex architecture review on 2026-05-17.

相關文件:

- `docs/refactor/case-scope-contract-v1.md`
- `docs/planning/domain-ui-contract-helper-gen3-gen4-plan.md`
- `docs/refactor/工程spac.md`

## 1. 目的

本文件定義 result gate 如何把 case scope、action interaction log、evidence assertions 轉成 `PASS` / `FAIL` / `BLOCKED`。

這份 v1 的核心目標:

1. 防止單一 case 的 self-check 或 helper contradiction 讓整輪 run 直接失敗。
2. 防止 B-09 類「最後結果看似正確,但 required UI flow 沒有完成」被判 `PASS`。
3. 防止 J/K/L 類「預期互動失敗或不改變狀態」被錯判成產品 bug。
4. 防止 observation case 被 preview-only evidence,例如 `selectedMetricFields=0`,錯誤牽引成 `BLOCKED`。

## 2. 原則

### 2.1 工具層與產品判定層分開

工具層的責任是 case-level containment:

- self-check contradiction 不應讓整輪 run fail。
- browser/tool fatal error 以外,應把問題寫入該 case result code 後繼續下一題。
- out-of-scope tool action 是工具/契約錯誤,不可偽裝成產品 `PASS`。

產品判定層的責任是依 `testTarget`、action role、expected outcome、actual interaction outcome、evidence assertion 做判定。

### 2.2 actual outcome 不能單獨決定結果

`dispatched_no_change` 不一定是 FAIL。

- 若 action 預期 `succeeded`,actual `dispatched_no_change` 代表互動失敗。
- 若 action 預期 `disabled_or_no_change`,actual `dispatched_no_change` 可能就是正確防呆。

因此 v1 判定軸是:

```text
action role + testTarget + expectedOutcome + actualOutcome + evidenceRequirements
```

不是只看 actual outcome。

### 2.3 unknown outcome 不得自動 PASS

任何未分類 interaction outcome 預設:

```text
BLOCKED_NEEDS_REJUDGMENT
```

並且必須把 unknown outcome 原文寫入 detail/report,供下一版 decision table 分類。

## 3. Test Target

`testTarget` 由 case scope contract 提供,對應 xlsx「測試標的」欄。

| contract value | xlsx 對應 | 說明 |
|---|---|---|
| `backend_function` | 後端功能 | 本題主要驗證後端資料或 API 結果。UI 無法完成前置時通常是 BLOCKED。 |
| `frontend_presentation` | 前端呈現 | 本題主要驗證畫面、文字、按鈕狀態、DOM 呈現。UI 錯通常是 FAIL。 |
| `functional_flow` | 功能流程 | 本題主要驗證使用者流程,例如展開、取消、防呆、刪除流程。流程錯通常是 FAIL。 |
| `integration` | 前後端整合 | 本題驗證 UI 操作是否正確帶出後端 request/response 或結果。必要 UI interaction 失敗通常是 FAIL。 |

## 4. Action Roles

| role | 說明 | 失敗預設 |
|---|---|---|
| `precondition` | 前置設定,不是本題要測的行為。 | `BLOCKED_PRECONDITION_FAILED` |
| `under_test` | 本題測試標的。 | 依本文件 decision table 判定。 |
| `verification` | 為取得 evidence 而執行的讀取或觸發動作,例如按「執行」產生 preview request、讀 DOM/network/chart/result xlsx。Assertion 本身由 evidence requirements 負責。 | v1 預設 `BLOCKED_VERIFICATION_UNAVAILABLE` 或 `BLOCKED_NEEDS_REJUDGMENT`。 |
| `cleanup` | 清理狀態,避免污染後續 case。 | 不改變當前 case 既有判定,但下一題前必須做 isolation check。 |

### 4.1 cleanup 失敗規則

`cleanup` 發生在 `under_test` 與 verification 完成後。cleanup 失敗時:

1. 不回頭改寫當前 case 的 `PASS` / `FAIL` / `BLOCKED` 主判定。
2. 必須在當前 case detail/report 寫入 `cleanup_status=failed` 與殘留狀態。
3. 下一題開始前必須執行 isolation check。
4. isolation check 失敗時,下一題不得繼續執行,應標 `BLOCKED_CLEANUP_ISOLATION_FAILED` 或等價 sentinel。

這避免前一題測完後的清理問題污染下一題證據。

### 4.2 verification 失敗 v1 限制

verification 失敗至少有兩類:

1. `under_test` 成功,但 verifier 讀不到 state。
2. `under_test` 默默失敗,verifier 才測出不一致。

v1 若無法可靠區分,預設 `BLOCKED_NEEDS_REJUDGMENT`。v2 TODO: 在 interaction log 補 `underTestStateChange` 與 `verifierReachability`,讓 result gate 區分 verifier 不可達與產品狀態錯誤。

## 5. Expected Outcomes

v1 支援以下 authored expected outcomes:

| expectedOutcome | 說明 | 典型 case |
|---|---|---|
| `succeeded` | 使用者互動應成功並產生預期狀態變更或 request。 | B-09 靜態區間設定成功。 |
| `disabled_or_no_change` | 控制應 disabled,或點擊後不應產生狀態變更。 | J-02 未勾選時下載/刪除 icon 不可用。 |
| `validation_feedback` | 互動應被防呆攔下,並顯示 validation message 或等價 UI feedback。 | K-10 空設定點計算。 |
| `cancel_no_change` | 取消動作應關閉/返回,且設定狀態不變。 | L-03 點取消後設定不變。 |

## 6. Actual Interaction Outcomes

helper/template/interpreter 應產出 interaction log。v1 支援以下 actual outcomes:

| actualOutcome | 說明 |
|---|---|
| `succeeded` | 互動成功,且驗證到預期狀態變更或 request。 |
| `target_not_found_timeout` | 工具在 timeout 內找不到 target。 |
| `target_absent_verified` | DOM/ARIA/read-only inspection 證實 target 不存在。 |
| `target_disabled_or_blocked` | target 存在但 disabled、被 overlay 擋住,或 UI 顯示不可互動。 |
| `dispatched_no_change` | 使用者互動已 dispatch,但 DOM/request/state 沒有預期變化。 |
| `validation_feedback_shown` | 點擊後出現 validation feedback,且狀態維持安全。 |
| `cancelled_no_change` | 取消/關閉類互動完成,且 before/after state 一致。 |
| `wrong_state_change` | 有狀態變更,但不是 expected target/state。 |
| `programmatic_set` | 工具使用程式化設定狀態,但 case 要求 user interaction。 |
| `out_of_scope_action_attempted` | planner/helper 嘗試執行 forbidden action。 |
| `tool_error` | Playwright/browser/helper throw,或 browser session crash。 |
| `unknown` | 尚未分類的 outcome。 |

可能的 v2 outcome:

- `partial_state_change`
- `state_change_wrong_target`
- `succeeded_but_secondary_error`

v1 遇到這些或其他新類型時,一律 fallback 到 `BLOCKED_NEEDS_REJUDGMENT`。

## 7. Under-Test Interaction Decision Table

以下表格只適用於 `role=under_test` 且 `requiredActions[]` 非空的 case。

多個 required actions 的處理:

1. 每個 required action 依自己的 `role`、`expectedOutcome`、`actualOutcome` 獨立評估。
2. 任一 `under_test` action 產生 FAIL sentinel,case 判定為 FAIL。
3. 沒有 FAIL,但任一 required action 產生 BLOCKED sentinel,case 判定為 BLOCKED。
4. 所有 required actions 都回到「繼續 evidence」時,再依第 9 節 evidence requirements 決定最終 PASS/FAIL/BLOCKED。

### 7.1 expected `succeeded`

| actualOutcome | backend_function | frontend_presentation | functional_flow | integration |
|---|---|---|---|---|
| `succeeded` | 繼續 outcome evidence | 繼續 outcome evidence | 繼續 outcome evidence | 繼續 outcome evidence |
| `target_not_found_timeout` | `BLOCKED_TOOL_LIMITATION` | `BLOCKED_TOOL_LIMITATION` | `BLOCKED_TOOL_LIMITATION` | `BLOCKED_TOOL_LIMITATION` |
| `target_absent_verified` | `BLOCKED_UI_UNAVAILABLE` | `FAIL_INTERACTION_FAILED` | `FAIL_INTERACTION_FAILED` | `FAIL_INTERACTION_FAILED` |
| `target_disabled_or_blocked` | `BLOCKED_UI_UNAVAILABLE` | `FAIL_INTERACTION_FAILED` | `FAIL_INTERACTION_FAILED` | `FAIL_INTERACTION_FAILED` |
| `dispatched_no_change` | `BLOCKED_UI_UNAVAILABLE` | `FAIL_INTERACTION_FAILED` | `FAIL_INTERACTION_FAILED` | `FAIL_INTERACTION_FAILED` |
| `validation_feedback_shown` | `BLOCKED_UI_UNAVAILABLE` | `FAIL_INTERACTION_FAILED` | `FAIL_INTERACTION_FAILED` | `FAIL_INTERACTION_FAILED` |
| `cancelled_no_change` | `BLOCKED_NEEDS_REJUDGMENT` | `FAIL_INTERACTION_FAILED` | `FAIL_INTERACTION_FAILED` | `FAIL_INTERACTION_FAILED` |
| `wrong_state_change` | `BLOCKED_NEEDS_REJUDGMENT` | `FAIL_INTERACTION_FAILED` | `FAIL_INTERACTION_FAILED` | `FAIL_INTERACTION_FAILED` |
| `programmatic_set` | `BLOCKED_TOOL_CONTRACT_VIOLATION` | `BLOCKED_TOOL_CONTRACT_VIOLATION` | `BLOCKED_TOOL_CONTRACT_VIOLATION` | `BLOCKED_TOOL_CONTRACT_VIOLATION` |
| `out_of_scope_action_attempted` | `BLOCKED_TOOL_CONTRACT_VIOLATION` | `BLOCKED_TOOL_CONTRACT_VIOLATION` | `BLOCKED_TOOL_CONTRACT_VIOLATION` | `BLOCKED_TOOL_CONTRACT_VIOLATION` |
| `tool_error` | `BLOCKED_TOOL_LIMITATION` | `BLOCKED_TOOL_LIMITATION` | `BLOCKED_TOOL_LIMITATION` | `BLOCKED_TOOL_LIMITATION` |
| `unknown` | `BLOCKED_NEEDS_REJUDGMENT` | `BLOCKED_NEEDS_REJUDGMENT` | `BLOCKED_NEEDS_REJUDGMENT` | `BLOCKED_NEEDS_REJUDGMENT` |

### 7.2 expected `disabled_or_no_change`

| actualOutcome | 判定 |
|---|---|
| `target_disabled_or_blocked` | 繼續 evidence -> §9,這是預期防呆。 |
| `dispatched_no_change` | 繼續 evidence -> §9,這是預期無狀態變更。 |
| `succeeded` | `FAIL_UNEXPECTED_SUCCESS` |
| `wrong_state_change` | `FAIL_UNEXPECTED_STATE_CHANGE` |
| `target_not_found_timeout` | `BLOCKED_TOOL_LIMITATION` |
| `target_absent_verified` | `BLOCKED_UI_UNAVAILABLE`,除非 evidence 明確宣告 absence 是預期狀態。 |
| `programmatic_set` | `BLOCKED_TOOL_CONTRACT_VIOLATION` |
| `out_of_scope_action_attempted` | `BLOCKED_TOOL_CONTRACT_VIOLATION` |
| `tool_error` | `BLOCKED_TOOL_LIMITATION` |
| `unknown` | `BLOCKED_NEEDS_REJUDGMENT` |

### 7.3 expected `validation_feedback`

| actualOutcome | 判定 |
|---|---|
| `validation_feedback_shown` | 繼續 evidence,例如 validation 文案、狀態未改變。 |
| `target_disabled_or_blocked` | `BLOCKED_NEEDS_REJUDGMENT`,除非 case 明確允許 disabled 作為 validation。 |
| `dispatched_no_change` | `FAIL_VALIDATION_FEEDBACK_MISSING` |
| `succeeded` | `FAIL_UNEXPECTED_SUCCESS` |
| `wrong_state_change` | `FAIL_UNEXPECTED_STATE_CHANGE` |
| `target_not_found_timeout` | `BLOCKED_TOOL_LIMITATION` |
| `target_absent_verified` | `BLOCKED_UI_UNAVAILABLE` |
| `programmatic_set` | `BLOCKED_TOOL_CONTRACT_VIOLATION` |
| `out_of_scope_action_attempted` | `BLOCKED_TOOL_CONTRACT_VIOLATION` |
| `tool_error` | `BLOCKED_TOOL_LIMITATION` |
| `unknown` | `BLOCKED_NEEDS_REJUDGMENT` |

### 7.4 expected `cancel_no_change`

| actualOutcome | 判定 |
|---|---|
| `cancelled_no_change` | 繼續 evidence -> §9,例如 modal closed and before/after state unchanged。 |
| `dispatched_no_change` | `BLOCKED_NEEDS_REJUDGMENT`,因為可能未真的觸發 cancel。 |
| `succeeded` | 繼續 evidence -> §9,但 evidence 必須驗證 before/after state unchanged。 |
| `wrong_state_change` | `FAIL_UNEXPECTED_STATE_CHANGE` |
| `target_not_found_timeout` | `BLOCKED_TOOL_LIMITATION` |
| `target_absent_verified` | `BLOCKED_UI_UNAVAILABLE` |
| `programmatic_set` | `BLOCKED_TOOL_CONTRACT_VIOLATION` |
| `out_of_scope_action_attempted` | `BLOCKED_TOOL_CONTRACT_VIOLATION` |
| `tool_error` | `BLOCKED_TOOL_LIMITATION` |
| `unknown` | `BLOCKED_NEEDS_REJUDGMENT` |

## 8. Pure Observation Path

當 `requiredActions[]` 為空時,case 不走 interaction decision table。

這類 case 必須有 `evidenceRequirements.observation` 或等價 assertion。判定規則:

| condition | backend_function | frontend_presentation | functional_flow | integration |
|---|---|---|---|---|
| 所有 required evidence assertions 通過 | `PASS` | `PASS` | `PASS` | `PASS` |
| required evidence assertion 失敗 | `FAIL_OUTCOME_ASSERTION_FAILED` if backend evidence exists, else `BLOCKED_EVIDENCE_UNAVAILABLE` | `FAIL_OBSERVATION_ASSERTION_FAILED` | `FAIL_OBSERVATION_ASSERTION_FAILED` | `FAIL_OBSERVATION_ASSERTION_FAILED` |
| evidence 無法取得,頁面不可達,tool/browser error | `BLOCKED_TOOL_LIMITATION` | `BLOCKED_TOOL_LIMITATION` | `BLOCKED_TOOL_LIMITATION` | `BLOCKED_TOOL_LIMITATION` |
| assertion type unknown | `BLOCKED_NEEDS_REJUDGMENT` | `BLOCKED_NEEDS_REJUDGMENT` | `BLOCKED_NEEDS_REJUDGMENT` | `BLOCKED_NEEDS_REJUDGMENT` |

`selectedMetricFields=0`、`previewNotReached`、`saveNotReached` 在 observation case 中只能是 observed state,不得單獨成為 blocker。

## 9. Evidence Requirements

Interaction 只是 flow evidence。即使 interaction decision table 回到「繼續 evidence」,仍必須檢查 declared evidence requirements。

Evidence groups:

- `flow`: 必要 UI interaction 是否發生,例如 static tab user click。
- `outcome`: 最終 DOM/chart/table/request/result 是否符合預期。
- `observation`: 純讀取型 evidence,例如使用者名稱、按鈕文字、列表列數。
- `network`: request/response body assertion。
- `artifact`: CSV/xlsx/screenshot/json artifact assertion。

任何 required evidence 不可達或 assertion type 未知,不得自動 PASS。

## 10. Fail Isolation

P0 runtime 行為:

1. Result self-check contradiction 不讓整輪 run fail。
2. 該 case 寫入最具體 result code。
3. Agent/server 繼續下一題,除非 browser/session fatal。

建議 sentinel:

| sentinel | 用途 |
|---|---|
| `FAIL_INTERACTION_FAILED` | under-test interaction 證實產品 UI/flow 未完成。 |
| `FAIL_UNEXPECTED_SUCCESS` | 預期防呆或 no-op,實際卻成功。 |
| `FAIL_UNEXPECTED_STATE_CHANGE` | 預期不變或特定變化,實際改錯狀態。 |
| `FAIL_VALIDATION_FEEDBACK_MISSING` | 預期 validation feedback,實際沒有 feedback。 |
| `BLOCKED_NEEDS_REJUDGMENT` | evidence 不足以自動分辨產品 bug 或工具限制。 |
| `BLOCKED_TOOL_LIMITATION` | 工具/browser/session 造成不可執行。 |
| `BLOCKED_UI_UNAVAILABLE` | 對非 UI 測試目標,UI 前置不可用造成無法測後端。 |
| `BLOCKED_TOOL_CONTRACT_VIOLATION` | 工具走了 forbidden/programmatic/out-of-scope path。 |
| `BLOCKED_PRECONDITION_FAILED` | precondition 失敗。 |
| `BLOCKED_VERIFICATION_UNAVAILABLE` | verifier 不可用,無法確認結果。 |
| `BLOCKED_CLEANUP_ISOLATION_FAILED` | 前題 cleanup 失敗且 isolation check 不通過；適用 §4.1 next-case isolation check。 |
| `BLOCKED_CONTRACT_VERSION_UNSUPPORTED` | runtime 不支援該 contract major version,且 contract 未宣告可用 v1 compatibility path。 |

## 11. Examples

### 11.1 B-09 static date range

Scope:

- `testTarget=integration` or `functional_flow`
- `role=under_test`
- `expectedOutcome=succeeded`
- required flow evidence: user opens static date tab/button and sets `2026-03-01 ~ 2026-03-15`
- required outcome evidence: preview request dateRange matches start/end

If final request body happens to contain correct date range but interaction log says `target_disabled_or_blocked` or `dispatched_no_change`,result is:

```text
FAIL_INTERACTION_FAILED
```

Reason: outcome evidence cannot override missing required flow evidence.

### 11.2 J-02 disabled download/delete icon

Scope:

- `testTarget=functional_flow` or `frontend_presentation`
- `role=under_test`
- `expectedOutcome=disabled_or_no_change`

If actual is `target_disabled_or_blocked` or `dispatched_no_change`,continue evidence and likely PASS if disabled/no-change assertion passes.

If actual is `succeeded`,result is:

```text
FAIL_UNEXPECTED_SUCCESS
```

### 11.3 I-07 user name display

Scope:

- `requiredActions=[]`
- `testTarget=frontend_presentation`
- `evidenceRequirements.observation` asserts right-top user button text

This case does not need interaction log. It passes or fails by observation assertion.

### 11.4 B-04 preview PASS walkthrough

Scope:

- `testTarget=integration`
- `requiredActions` includes `setMetricRows` as `precondition`, `executePreview` as `verification`
- every required action actual outcome is `succeeded`
- outcome/network evidence asserts preview request has expected metric field and response/table/chart data is non-empty

Decision:

1. No under-test action produced FAIL.
2. No required action produced BLOCKED.
3. Required evidence assertions pass.
4. Result is `PASS`.

## 12. Migration Notes

Current Gen1/Gen2 compatibility bridge may infer scope from manifest/hints. That inference is containment only.

Target state:

1. testcase/domain package authors explicit `caseScopeContract.version=v1`.
2. domain action template emits interaction log with v1 actual outcomes.
3. result gate consumes authored scope plus interaction/evidence artifacts.
4. inferred scope remains fallback only during migration and should not become stable core.
