# Case Scope Contract v1

狀態: Draft for review

Owner: Codex implementation owner, based on Tommy + ClaudeCode + Codex architecture review on 2026-05-17.

相關文件:

- `docs/refactor/result-gate-decision-table.md`
- `docs/planning/domain-ui-contract-helper-gen3-gen4-plan.md`
- `docs/refactor/工程spac.md`

## 1. 目的

Case Scope Contract v1 把每個 testcase 從一段自然語言步驟,提升成可由 planner/helper/interpreter/result gate 共用的測試契約。

v1 要解決的問題:

1. Planner 知道這題測什麼、不測什麼。
2. Helper/interpreter 知道哪些 actions 可以做、哪些 forbidden。
3. Result gate 知道哪些 flow evidence / outcome evidence 才能決定 PASS/FAIL/BLOCKED。
4. Observation case 不再被 preview-only precondition 誤判。
5. 預期失敗或預期不變的 UI 互動,例如 disabled icon、防呆、cancel,可以被正確判 PASS/FAIL。

## 2. Runtime Boundary

穩定 core 只理解 generic contract 欄位:

- `version`
- `caseId`
- `domainId`
- `targetPage`
- `testTarget`
- `testIntent`
- `riskLevel`
- `requiredActions`
- `allowedActions`
- `forbiddenActions`
- `evidenceRequirements`
- `judgmentPolicy`
- `cleanupPolicy`

BI-specific value 留在 domain pack 或 testcase params:

- `metrics`
- `sourceReport`
- `dateRange`
- `displayMode`
- `formula.baseFields`
- 其他 BI metadata/display-name/locator alias

Domain pack 可以提供 declarative adapters、locator maps、aliases、action templates、evidence schemas、lint rules、hazards。Domain pack 不應放 arbitrary executable small helpers 或 per-domain agents。

## 3. Schema Overview

```yaml
caseScopeContract:
  version: v1
  caseId: BIUI_COLLAGE_R001-B-09
  domainId: BI_OFFICIAL_UI_COLLAGE
  targetPage: collage_editor
  testTarget: integration
  testIntent: static_date_range_preview
  riskLevel: observation

  requiredActions:
    - actionId: setStaticDateRange
      role: under_test
      expectedOutcome: succeeded
      requiredForPass: true
      params:
        start: 2026-03-01
        end: 2026-03-15
      templateRef: BI_OFFICIAL_UI_COLLAGE.actions.setStaticDateRange

  allowedActions:
    - openProject
    - createReport
    - setMetricRows
    - setStaticDateRange
    - executePreview

  forbiddenActions:
    - saveReport
    - reopenReport
    - downloadCsv

  evidenceRequirements:
    flow:
      - assertionId: static_tab_clicked
        source: interactionLog
        path: actions.setStaticDateRange.steps.openStaticTab.actualOutcome
        operator: equals
        expected: succeeded
        requiredForPass: true
    outcome:
      - assertionId: preview_date_start
        source: previewRequest
        path: body.dateRange.start
        operator: equals
        expected: 2026-03-01
        requiredForPass: true
      - assertionId: preview_date_end
        source: previewRequest
        path: body.dateRange.end
        operator: equals
        expected: 2026-03-15
        requiredForPass: true

  judgmentPolicy:
    decisionTableVersion: result-gate-v1
    unknownOutcomeFallback: BLOCKED_NEEDS_REJUDGMENT
    noAutoPassOnUnknown: true

  cleanupPolicy:
    required: true
    isolationCheckBeforeNextCase: true
```

## 4. Required Fields

| field | required | 說明 |
|---|---:|---|
| `version` | yes | v1 起必填。 |
| `caseId` | yes | xlsx case id 或 normalized case id。 |
| `domainId` | yes | domain pack id,例如 `BI_OFFICIAL_UI_COLLAGE`。 |
| `targetPage` | yes | generic page target,例如 `project_list`, `collage_editor`, `report_list`。 |
| `testTarget` | yes | 四分類之一,見第 5 節。 |
| `testIntent` | yes | domain-neutral 或 domain-scoped intent string,用於 planner/template routing。 |
| `riskLevel` | yes | observation/create/modify/delete 等風險級別,對應授權與 cleanup policy。 |
| `requiredActions` | yes | 可為空陣列。空陣列代表 pure observation path。 |
| `allowedActions` | yes | planner/helper 可執行的 action allowlist。 |
| `forbiddenActions` | yes | planner/helper 不得執行的 action denylist。 |
| `evidenceRequirements` | yes | 至少要有 flow/outcome/observation/network/artifact 其中一類 required assertion。 |
| `judgmentPolicy` | yes | result gate 判定策略與 fallback。 |
| `cleanupPolicy` | yes | 清理與隔離規則。 |

## 5. testTarget Enum

| value | xlsx 對應 | 判定重點 |
|---|---|---|
| `backend_function` | 後端功能 | 後端結果錯才 FAIL。UI 前置不可用通常 BLOCKED。 |
| `frontend_presentation` | 前端呈現 | DOM/text/visible state 錯通常 FAIL。 |
| `functional_flow` | 功能流程 | 使用者流程錯通常 FAIL。 |
| `integration` | 前後端整合 | UI action 與 request/response/result 對不上通常 FAIL。 |

若 xlsx 舊格式沒有「測試標的」欄,Gen1/Gen2 可以暫時推導,但 authored v1 package 應視為 lint error。

## 6. Action Role Enum

| role | 說明 | v1 判定原則 |
|---|---|---|
| `precondition` | 建立測試前置狀態,不是本題測試標的。 | 失敗通常 `BLOCKED_PRECONDITION_FAILED`。 |
| `under_test` | 本題真正要測的行為。 | 依 result gate decision table 判定。 |
| `verification` | 為了取得 evidence 而必須執行的讀取或觸發動作,例如按「執行」產生 preview request、讀 chart data、讀 DOM state。它不是 assertion 本身。 | evidence acquisition 不可達通常 `BLOCKED_VERIFICATION_UNAVAILABLE` 或 `BLOCKED_NEEDS_REJUDGMENT`。 |
| `cleanup` | 清理狀態,避免污染後題。 | 不改當前 case 主判定,但下一題必須 isolation check。 |

Action role 讓 interpreter 可以把 case 當成有 lifecycle 的測試單元,而不是一串沒有語意的 UI steps。

`verification` 與 `evidenceRequirements` 的邊界:

- `verification` action 負責取得 evidence,例如觸發 preview request。
- `evidenceRequirements` 負責判斷 evidence 是否符合預期。
- `verification` action 成功不等於 case PASS；仍必須通過 declared assertions。

## 7. expectedOutcome Enum

`expectedOutcome` 必填於 `requiredActions[]` 的每個 action。

| value | 說明 |
|---|---|
| `succeeded` | 互動應成功並產生預期狀態變更或 request。 |
| `disabled_or_no_change` | 控制應 disabled,或點擊後不應產生狀態變更。 |
| `validation_feedback` | UI 應顯示防呆/validation feedback,且狀態維持安全。 |
| `cancel_no_change` | cancel/close 類操作應返回或關閉,且設定狀態不變。 |

新增 expected outcome 需要升級 schema version 或在 v1 以 extension field 標示,且 result gate unknown fallback 必須維持 `BLOCKED_NEEDS_REJUDGMENT`。

## 8. Action Object

```yaml
requiredActions:
  - actionId: clickDownloadIconWhenNothingSelected
    role: under_test
    expectedOutcome: disabled_or_no_change
    requiredForPass: true
    params: {}
    templateRef: BI_OFFICIAL_UI_COLLAGE.actions.clickDownloadIcon
    requiresUserInteraction: true
```

| field | required | 說明 |
|---|---:|---|
| `actionId` | yes | logical action id。不要求全 case 唯一；同一 action 重複出現時,runtime 用 `(actionId, index)` 或 optional `instanceId` 識別。 |
| `instanceId` | no | 同一 `actionId` 多次出現時的穩定 instance key,例如 `initialRange` / `finalRange`。 |
| `role` | yes | `precondition` / `under_test` / `verification` / `cleanup`。 |
| `expectedOutcome` | yes | 見第 7 節。 |
| `requiredForPass` | yes | true 時缺少或失敗不得 PASS。 |
| `params` | no | domain-specific action params。 |
| `templateRef` | recommended | 指到 domain action template。 |
| `requiresUserInteraction` | recommended | true 時不得用 programmatic setter 替代。 |

`requiresUserInteraction=true` 且 actual outcome 為 `programmatic_set` 時,result gate 應回 `BLOCKED_TOOL_CONTRACT_VIOLATION`。

### 8.1 Action Steps

Action 可以由 domain action template 定義 nested `steps[]`。Case scope 不需要手寫所有低階 steps,但可以在 `evidenceRequirements.flow` 指到特定 step。

範例:

```yaml
actionTemplate:
  actionId: setStaticDateRange
  steps:
    - stepId: openDatePanel
      expectedOutcome: succeeded
      requiresUserInteraction: true
    - stepId: openStaticTab
      expectedOutcome: succeeded
      requiresUserInteraction: true
    - stepId: fillStartDate
      expectedOutcome: succeeded
      requiresUserInteraction: true
    - stepId: fillEndDate
      expectedOutcome: succeeded
      requiresUserInteraction: true
    - stepId: confirmDateRange
      expectedOutcome: succeeded
      requiresUserInteraction: true
```

Interaction log 應可被 structured path 讀取,例如:

```text
actions.setStaticDateRange.steps.openStaticTab.actualOutcome
```

若同一 action 多次出現,interaction log 應使用 action instance path,例如:

```text
actions.setDatePreset[finalRange].actualOutcome
```

## 9. allowedActions / forbiddenActions

`allowedActions` 與 `forbiddenActions` 是硬契約,不可從自然語言重新猜。

規則:

1. planner/helper/interpreter 只能執行 `allowedActions`。
2. 任何 `forbiddenActions` 嘗試都產生 `out_of_scope_action_attempted`。
3. out-of-scope action attempt 不得被當成產品 bug,應標 `BLOCKED_TOOL_CONTRACT_VIOLATION`。
4. `forbiddenActions` 優先於 free-text hints。即使步驟或預期文字出現「儲存」「CSV」「reopen」,只要被列為 forbidden,工具不得執行。

B-09 類 case 應明確 forbidden:

```yaml
forbiddenActions:
  - saveReport
  - reopenReport
  - downloadCsv
```

## 10. Evidence Requirements

Evidence requirements 分五類:

```yaml
evidenceRequirements:
  flow: []
  outcome: []
  observation: []
  network: []
  artifact: []
```

| group | 用途 |
|---|---|
| `flow` | required UI interaction 是否真的完成。 |
| `outcome` | 最終 UI/chart/table/request/result 是否符合。 |
| `observation` | 純讀取 DOM/text/state 類 assertion。 |
| `network` | request/response body assertion。 |
| `artifact` | CSV/xlsx/screenshot/json artifact assertion。 |

Assertion object:

```yaml
- assertionId: preview_date_start
  source: previewRequest
  path: body.dateRange.start
  operator: equals
  expected: 2026-03-01
  requiredForPass: true
  onFail: FAIL_OUTCOME_ASSERTION_FAILED
```

| field | required | 說明 |
|---|---:|---|
| `assertionId` | yes | stable id,供 report/detail_json 引用。 |
| `source` | yes | 必須是第 10.1 節的 source enum。 |
| `path` | yes | structured path,不可只用 prose。 |
| `operator` | yes | 必須是第 10.2 節的 operator enum。 |
| `expected` | no | operator 需要時必填。 |
| `requiredForPass` | yes | true 時 assertion 失敗不得 PASS。 |
| `onFail` | recommended | 明確指定 result code,否則套 decision table default。 |

### 10.1 Source Enum

v1 source 必須落在以下 enum。新增 source 需要 schema/runtime 明確支援；未知 source 不得自動 PASS。

| source | evidence group | 說明 |
|---|---|---|
| `interactionLog` | `flow` | action/step actual outcome、user interaction path、programmatic/out-of-scope flags。 |
| `domSnapshot` | `observation` / `outcome` | DOM text、ARIA、visible/disabled state。 |
| `uiStateSnapshot` | `observation` / `outcome` | 結構化 UI 狀態,例如 selected fields、date label、filter rows。 |
| `previewRequest` | `network` / `outcome` | preview request method/url/body。 |
| `previewResponse` | `network` / `outcome` | preview response body/status。 |
| `networkRequest` | `network` | 非 preview 類 request。 |
| `networkResponse` | `network` | 非 preview 類 response。 |
| `chartData` | `outcome` | chart labels/datasets/summary。 |
| `tableData` | `outcome` | preview table headers/rows/cells。 |
| `downloadedCsv` | `artifact` | CSV path、headers、rows、parsed values。 |
| `resultXlsx` | `artifact` | result workbook 寫入結果與 detail_json。 |
| `helperArtifact` | `artifact` | helper structured JSON artifact。 |
| `screenshotMetadata` | `artifact` | 截圖檔名、viewport、hash、關聯 step；截圖本身不可取代數值 evidence。 |

### 10.2 Operator Enum

v1 operator 必須落在以下 enum。未知 operator 不得自動 PASS。

| operator | 說明 |
|---|---|
| `equals` | actual 嚴格等於 expected。 |
| `notEquals` | actual 不等於 expected。 |
| `contains` | actual array/string/object 包含 expected。 |
| `notContains` | actual array/string/object 不包含 expected。 |
| `exists` | path 存在且不為 null/undefined。 |
| `notExists` | path 不存在或為 null/undefined。 |
| `matches` | actual string 符合 expected regex。 |
| `countEquals` | collection count 等於 expected。 |
| `countGreaterThan` | collection count 大於 expected。 |
| `countAtLeast` | collection count 大於等於 expected。 |
| `isDisabled` | target disabled/不可互動。 |
| `isVisible` | target 可見。 |
| `stateUnchanged` | before/after state 相同。 |
| `stateChangedTo` | after state 等於 expected。 |

## 11. Pure Observation Cases

當 `requiredActions=[]`:

1. 不需要 interaction log。
2. 必須有 `evidenceRequirements.observation` 或等價 assertion。
3. 判定由 evidence assertions 直接決定。
4. preview-only concepts,例如 `selectedMetricFields=0`,不得當成 blocker。

範例:

```yaml
caseScopeContract:
  version: v1
  caseId: BIUI_COLLAGE_R001-I-07
  domainId: BI_OFFICIAL_UI_COLLAGE
  targetPage: collage_editor
  testTarget: frontend_presentation
  testIntent: verify_current_user_button_text
  riskLevel: observation
  requiredActions: []
  allowedActions:
    - openProject
  forbiddenActions:
    - configureMetric
    - executePreview
    - saveReport
    - reopenReport
    - downloadCsv
  evidenceRequirements:
    observation:
      - assertionId: user_button_text_visible
        source: domSnapshot
        path: rightTopUserButton.text
        operator: exists
        requiredForPass: true
  judgmentPolicy:
    decisionTableVersion: result-gate-v1
    unknownOutcomeFallback: BLOCKED_NEEDS_REJUDGMENT
    noAutoPassOnUnknown: true
  cleanupPolicy:
    required: false
    isolationCheckBeforeNextCase: true
```

## 12. Expected Failure / No-Change Cases

防呆、disabled、cancel 類 case 應用 `expectedOutcome` 表達「預期不成功」。

### 12.1 Disabled icon

```yaml
requiredActions:
  - actionId: clickDownloadIconWhenNothingSelected
    role: under_test
    expectedOutcome: disabled_or_no_change
    requiredForPass: true
```

Actual `target_disabled_or_blocked` 或 `dispatched_no_change` 不是 FAIL,而是繼續驗證 disabled/no-change evidence。

Actual `succeeded` 是:

```text
FAIL_UNEXPECTED_SUCCESS
```

### 12.2 Validation feedback

```yaml
requiredActions:
  - actionId: calculateWithEmptySetting
    role: under_test
    expectedOutcome: validation_feedback
    requiredForPass: true
```

Actual `validation_feedback_shown` 才是正向 evidence。若只是 `dispatched_no_change` 但沒有 feedback,應標 `FAIL_VALIDATION_FEEDBACK_MISSING`。

### 12.3 Cancel keeps state

```yaml
requiredActions:
  - actionId: cancelDateRangeChange
    role: under_test
    expectedOutcome: cancel_no_change
    requiredForPass: true
```

Evidence 必須包含 before/after state comparison。只看到 click success 不足以 PASS。

## 13. judgmentPolicy

```yaml
judgmentPolicy:
  decisionTableVersion: result-gate-v1
  unknownOutcomeFallback: BLOCKED_NEEDS_REJUDGMENT
  noAutoPassOnUnknown: true
  failOn:
    - FAIL_INTERACTION_FAILED
    - FAIL_UNEXPECTED_SUCCESS
    - FAIL_UNEXPECTED_STATE_CHANGE
    - FAIL_VALIDATION_FEEDBACK_MISSING
  blockedOn:
    - BLOCKED_TOOL_LIMITATION
    - BLOCKED_TOOL_CONTRACT_VIOLATION
    - BLOCKED_PRECONDITION_FAILED
    - BLOCKED_VERIFICATION_UNAVAILABLE
```

`judgmentPolicy` 不應複製整張 decision table 到每個 case。Case 只需要指定 decision table version、fallback、必要 override。通用判定表放在 `result-gate-decision-table.md` 與 runtime implementation。

## 14. cleanupPolicy

```yaml
cleanupPolicy:
  required: true
  isolationCheckBeforeNextCase: true
  onCleanupFailure: preserveCurrentCaseJudgment_and_blockNextIfIsolationFails
```

規則:

1. cleanup 失敗不改當前 case 主判定。
2. cleanup 失敗必須留下 residual state evidence。
3. 下一題前必須跑 isolation check。
4. isolation 不通過時,下一題標 `BLOCKED_CLEANUP_ISOLATION_FAILED`,不可硬跑。

## 15. Versioning

v1 規則:

1. `version: v1` 必填。
2. unknown `expectedOutcome`、unknown `actualOutcome`、unknown assertion operator 不得 PASS。
3. 新增 outcome 類型時,若 v1 runtime 不認得,必須 fallback `BLOCKED_NEEDS_REJUDGMENT`。
4. v1 runtime 遇到 `version: v2` 或更高 major version 時,不得部分執行；應回 `BLOCKED_CONTRACT_VERSION_UNSUPPORTED`,除非 contract 明確宣告 `compatibleWith: [v1]` 且只使用 v1 enum/source/operator。
5. v2 可以新增 outcome,但必須保留 v1 fallback 行為。

## 16. Migration Plan

### Phase 0: Gen1/Gen2 containment

目前 `agent/src/case-scope.ts` 可從 manifest/hints 推導初版 scope。這只是 containment,不是穩定 schema。

### Phase 1: authored v1 contract

新 testcase package 應開始提供 authored `caseScopeContract.version=v1`。

Package lint:

- missing `caseScopeContract` starts as warning for legacy packages。
- official UI observation/preview/save/delete packages can promote selected rules to error。
- contradictory allowed/forbidden actions must be error。

### Phase 2: declarative action templates

Domain pack action templates define:

- locator strategy
- allowed UI interaction path
- expected interaction log shape
- evidence emitted by the action

Case supplies params,not raw selector details。

### Phase 3: result gate consumes authored scope

Result gate should stop relying on prose regex or helper artifact quirks, and instead evaluate:

```text
caseScopeContract + interactionLog + evidenceArtifacts
```

### Phase 4: Gen4 action interpreter

Compatibility bridge is replaced by stable interpreter that executes declarative domain action templates.

## 17. BI Examples

### 17.1 B-09 static range

```yaml
caseScopeContract:
  version: v1
  caseId: BIUI_COLLAGE_R001-B-09
  domainId: BI_OFFICIAL_UI_COLLAGE
  targetPage: collage_editor
  testTarget: integration
  testIntent: static_date_range_preview
  riskLevel: observation
  requiredActions:
    - actionId: setMetricRows
      role: precondition
      expectedOutcome: succeeded
      requiredForPass: true
      params:
        metrics:
          - sourceReport: 每日報表
            field: 新增帳號數
    - actionId: setStaticDateRange
      role: under_test
      expectedOutcome: succeeded
      requiredForPass: true
      params:
        start: 2026-03-01
        end: 2026-03-15
    - actionId: executePreview
      role: verification
      expectedOutcome: succeeded
      requiredForPass: true
  allowedActions:
    - openProject
    - createReport
    - setMetricRows
    - setStaticDateRange
    - executePreview
  forbiddenActions:
    - saveReport
    - reopenReport
    - downloadCsv
  evidenceRequirements:
    flow:
      - assertionId: static_date_user_flow_completed
        source: interactionLog
        path: actions.setStaticDateRange.actualOutcome
        operator: equals
        expected: succeeded
        requiredForPass: true
    outcome:
      - assertionId: preview_request_static_start
        source: previewRequest
        path: body.dateRange.start
        operator: equals
        expected: 2026-03-01
        requiredForPass: true
      - assertionId: preview_request_static_end
        source: previewRequest
        path: body.dateRange.end
        operator: equals
        expected: 2026-03-15
        requiredForPass: true
```

若 `setStaticDateRange` 的 actual outcome 是 `target_disabled_or_blocked` 或 `dispatched_no_change`,不可因 preview request 最後看似正確而判 PASS。

### 17.2 B-06 staged date switch

B-06 不能把 `過去30天(後切最近30天)` 當成單一 preset。應用 structured actions:

```yaml
requiredActions:
  - actionId: setDatePreset
    instanceId: initialRange
    role: precondition
    expectedOutcome: succeeded
    params:
      preset: 過去30天
  - actionId: setDatePreset
    instanceId: finalRange
    role: under_test
    expectedOutcome: succeeded
    params:
      preset: 最近30天
```

### 17.3 B-08 hybrid route

B-08 若需要 official metric setup,應 routed to `setMetricRows` action template。不可 fallback 到 generic `getByText('新增帳號數')`。

## 18. Open v2 Items

1. Split verification failure into verifier unavailable vs product state contradiction.
2. Add finer actual outcomes such as `partial_state_change`, `state_change_wrong_target`, `succeeded_but_secondary_error`.
3. Define machine-readable JSON Schema after Tommy reviews this markdown draft.
4. Promote selected package lint warnings to errors after one or two reviewed UAT rounds.
5. Add positive PASS walkthroughs for common preview, observation, and disabled-control cases after the first implementation pass.
6. Add machine-readable action template step schema once one or two BI templates have been implemented.
