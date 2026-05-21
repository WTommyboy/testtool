# 線上 UAT Tool 開發與規劃日誌

最後更新：2026-05-19

本文件記錄「UAT Tool 線上派工 + Mac Agent」這條路徑的歷史決策、設計理由、目前架構與後續待辦。它的用途是跨聊天室、跨 session 交接，不取代 `AGENTS.md`、Layer rules、authoring spec 或實作 spec。

每次修改線上工具的 run packet、Mac Agent、Tool Bridge、rule index、current case pack、result pipeline、evidence gate、部署分支或 production 架構時，請同步更新本文件。

---

## 2026-05-18 - P0 scope oracle and vocabulary-first reset

Latest reduced dev run:

- Run ID: `1762c1b2-bc42-47f0-80b6-d1ef10a0f713`
- Result: the run completed and no longer collapsed into all BLOCKED, but only the simplest direct-observation cases matched Tommy's manual check (`I-07`, `J-02`, `K-01`). The next problem is judgment/routing quality, not only run containment.
- Manual oracle: `/Users/tommy/Downloads/codex_galaxy/BI_UAT_ROUNDS/p0_scope_smoke_20260517/P0_SCOPE_SMOKE_測試案例_BIUI_COLLAGE_R001_20260517_tommy_checkreport copy.md`

Decision:

- The 15-case oracle is a temporary calibration/regression artifact for this reduced testcase and product state. It must not be promoted into the platform layer or the `BI_OFFICIAL_UI_COLLAGE` domain pack as permanent truth.
- Normal future UAT must not require a manual oracle. The oracle is used here because P0 is calibrating route selection and result judgment after several failed reduced runs.
- The next P0 work is vocabulary-first: define stable platform action names, define official BI UI object names in the domain pack, route cases through `action + target + role + expectedOutcome + evidenceRequirements`, and then regenerate the reduced testcase from those definitions.

Planned order:

1. Freeze the 15-case oracle and add an offline comparator.
2. Add platform action vocabulary/schema.
3. Add official BI collage UI object vocabulary for the reduced smoke scope.
4. Wire planner/capability gate/helper plan/result gate to structured action/object references.
5. Run Codex offline route/judgment smoke.
6. Generate the next reduced xlsx/md from the vocabulary.
7. Repair remaining case templates under the new structure.
8. Run a small live smoke before asking Tommy for another dev UAT.

This preserves the long-term architecture: Domain UI Discovery -> UI Contract -> Case Scope -> Action Template -> Evidence Contract -> Result Contract. It does not add per-domain small agents or arbitrary BI-only helpers.

P0.13 implementation:

- Added oracle fixture: `fixtures/p0-scope-smoke-20260517/oracle.json`
- Added 1762 actual baseline fixture: `fixtures/p0-scope-smoke-20260517/run-1762-results.json`
- Added comparator: `scripts/verify-p0-scope-oracle.ts`
- Added npm script: `npm run verify:p0-scope-oracle`
- Verification result: bundled baseline and parsed archive `/Users/tommy/Downloads/UAT_archive_1762c1b2-bc42-47f0-80b6-d1ef10a0f713.md` both produce 3 matches / 12 mismatches, matching cases `BIUI_COLLAGE_R001-I-07`, `BIUI_COLLAGE_R001-J-02`, and `BIUI_COLLAGE_R001-K-01`.

P0.14 implementation:

- Added platform action vocabulary contract: `contracts/platform-action-vocabulary.v1.json`
- Added reference doc: `docs/refactor/platform-action-vocabulary-v1.md`
- Added extracted candidate fixture from 108+15 testcase sources: `fixtures/action-vocabulary/biui-collage-r001-v1-6-candidates.json`
- Added generic verifier: `scripts/verify-platform-action-vocabulary.ts`
- Added fixture coverage verifier: `scripts/verify-action-vocabulary-fixtures.ts`
- Added npm script: `npm run verify:platform-action-vocabulary`
- Added npm script: `npm run verify:action-vocabulary-fixtures`
- Verification result: platform verifier validates 42 generic actions total, including 19 primitives, 17 assertions, 6 composites; fixture verifier covers all 23 extracted candidate action ids and all 15 P0 reduced-smoke required action mappings.
- Design note: xlsx and md should be generated from the same action/object definitions going forward. The xlsx remains the structured testcase source, while md should not invent alternate action wording that drifts from canonical ids.
- Boundary correction: BI/P0 source provenance and testcase-specific mappings must remain in fixture/dev-log files, not in the shared platform contract or reference document.

P0.15 implementation:

- Added BI official UI object vocabulary: `domain-packs/BI_OFFICIAL_UI_COLLAGE/ui-object-vocabulary.json`
- Added reduced-scope object coverage fixture: `fixtures/ui-object-vocabulary/biui-collage-r001-p0-required-objects.json`
- Added screenshot-backed visual alignment discovery: `domain-packs/BI_OFFICIAL_UI_COLLAGE/discovery/visual-alignment.json`
- Added verifier: `scripts/verify-bi-official-ui-object-vocabulary.ts`
- Added npm script: `npm run verify:bi-official-ui-object-vocabulary`
- Updated domain pack files: `ui-contract.json`, `evidence-schema.json`, `discovery/component-inventory.json`, `action-contracts/observeFrontendState.json`
- Verification result: 29 domain UI objects, 15 fixture cases covered, 28 platform action refs checked, 26 screenshot-confirmed objects, 3 known product gaps, 0 visual review items.
- Boundary note: this is domain pack data, not platform action data and not a per-domain executable helper. P0 fixture case mappings remain in `fixtures/`, not in `ui-object-vocabulary.json`.
- P0.15b visual finding after Tommy confirmation: row-local report actions are visible text actions `下載` / `刪除`, so the object id is `projectList.rowDeleteAction`. The row delete tooltip and static date inputs are known product gaps because the tooltip is not implemented and `靜態時間` cannot be clicked. Tommy-provided screenshots confirm `projectLimit.toast` text `已達最高5個專案`, `download.toast` text `數據已開始下載`, and `validation.toast` pattern `第 {rowIndex} 欄位，欄位未設置完成`; multiple incomplete rows produce multiple stacked validation messages.

P0.16 implementation:

- Added structured case-scope runtime contracts: `domain-packs/BI_OFFICIAL_UI_COLLAGE/case-scope-runtime-contracts.json`
- Added runtime loader and bridge: `agent/src/structured-case-scope.ts`
- Wired the structured scope into `case-scope`, `current-case-pack`, `capability-gate`, and `helper-execution-plan`, so runtime diagnostics now carry the same `action + target + role + expectedOutcome + evidenceRequirements` contract.
- Exposed `domain_case_scope_contracts` and `domain_ui_object_vocabulary` as optional domain inputs in run packets, plus run brief, prompt, rule-index, and reference-index entries.
- Added result evidence gate structural validation for detail_json that cites `caseScopeContract`.
- Added verifier: `scripts/verify-p0-runtime-wiring.ts`
- Added npm script: `npm run verify:p0-runtime-wiring`
- Verification result: the P0.16 smoke validates all 15 reduced-smoke contracts, checks action ids against the platform vocabulary, checks targets against the BI UI object vocabulary, confirms capability/helper routing carries the structured scope, and confirms result gate rejects malformed contract detail. This remains a runtime bridge and does not promote Tommy's oracle into permanent product truth.

P0.17 implementation:

- Added synthetic offline evidence fixture: `fixtures/p0-scope-smoke-20260517/offline-route-judgment-evidence.json`
- Added route/judgment verifier: `scripts/verify-p0-offline-route-judgment.ts`
- Added npm script: `npm run verify:p0-offline-route-judgment`
- Verification result: 15/15 reduced-smoke cases match Tommy's oracle without running a browser. The verifier checks route boundaries first, then applies a contract-driven offline judgment pass. It specifically guards against two prior failure modes: frontend observation cases falling back to generic preview helpers, and unsupported observation types being incorrectly guessed into a wrong `observeFrontendState` subtype.
- Boundary note: this is an offline smoke for route/judgment logic only. It does not prove the live templates can execute J-07 tooltip, J-12 project-limit toast, K-08 source-report picker, or N-03 download end to end; those remain P0.19/P0.20 work.

P0.18 implementation:

- Added package generator: `scripts/generate-p0-vocabulary-reduced-package.ts`
- Added package verifier: `scripts/verify-p0-vocabulary-reduced-package.ts`
- Added npm scripts: `npm run generate:p0-vocabulary-reduced-package` and `npm run verify:p0-vocabulary-reduced-package`
- Generated files in `/Users/tommy/Downloads/codex_galaxy/BI_UAT_ROUNDS/p0_scope_smoke_20260517/`:
  - `P0_SCOPE_SMOKE_測試案例_BIUI_COLLAGE_R001_20260518_vocab_v1.xlsx`
  - `P0_SCOPE_SMOKE_測試執行說明_BIUI_COLLAGE_R001_20260518_vocab_v1.md`
  - `P0_SCOPE_SMOKE_Codex_指派文字_BIUI_COLLAGE_R001_20260518_vocab_v1.md`
- Verification result: generated package has 15 cases and 38 structured step rows. Every step action exists in `platform-action-vocabulary.v1.json`, every target exists in `BI_OFFICIAL_UI_COLLAGE/ui-object-vocabulary.json`, every xlsx `測試標的` aligns with the runtime case-scope contract, and the current parser imports the structured `步驟` sheet as 38 steps.
- Boundary note: the generated package deliberately does not embed Tommy's oracle or any previous run result. It is a testcase authoring artifact, while the oracle remains only a time-bound calibration fixture.

P0.19 implementation:

- Added live-template verifier: `scripts/verify-p0-live-action-templates.ts`
- Added npm script: `npm run verify:p0-live-action-templates`
- Expanded `collage.observeFrontendState` routing/support from the first five observation types to the full reduced-smoke set: `sidebarGroup`, `rowDeleteTooltip`, `projectLimitToast`, `sourceReportPicker`, plus date-panel static/cancel flows and download-toast evidence.
- Updated helper executor behavior so frontend observation helpers return current-run evidence with status `ok` even when `asserted=false`; the warning `FRONTEND_OBSERVATION_ASSERTION_FALSE_REQUIRES_CODEX_JUDGMENT` tells Codex/result-gate to judge from the case contract instead of treating the helper as a tool-level BLOCKED.
- Added visible UI action coverage for sidebar company-shared toggle, row delete hover, project-limit create click/toast, source-report picker open/search/select, date-panel static tab and cancel flow, validation toast/no-preview-request, and editor icon-only download/download toast.
- Adjusted `configureMetric` date-range failure handling: static/date UI failures with current-run interaction/date evidence no longer force helper status `blocked`; they remain evidence for downstream FAIL/BLOCKED judgment.
- Boundary note: P0.19 is still a live-template wiring and local smoke milestone. It improves the agent's ability to collect evidence, but P0.20 remains the first small live smoke using the dev Agent profile before asking Tommy for another dev UAT run.

P0.24 visual fallback contract smoke and containment refinement:

- Trigger category: P0.23 classified 11 BLOCKED rows in run `ee0cae6b-f2c4-4cb0-a5aa-d79f5b611ca3` as `result_gate_visual_fallback_contract_gap` (`J-03`, `J-05`, `J-06`, `J-15`, `K-02`, `M-01` through `M-05`, `N-01`). These were not product PASS/FAIL judgments; they were frontend-observation cases where a current-run screenshot existed but DOM/ARIA/URL structured assertion evidence was missing or not written into the required visual fallback contract.
- Added verifier: `npm run verify:p0-visual-fallback-contract`. The smoke samples `J-03`, `K-02`, and `N-01` and proves three paths: plain `BLOCKED / EVIDENCE_INSUFFICIENT` with screenshot is rejected, incomplete `BLOCKED_NEEDS_VISUAL_REVIEW` without `visualObservation` / `domEvidenceGap` is rejected, and a complete visual fallback contract passes result gate.
- Tightened gate semantics: `RESULT_FRONTEND_OBSERVATION_VISUAL_FALLBACK_REQUIRED` now requires a complete contract, not just any marker word. Required fields are `evidenceSource=screenshotVisual`, screenshot evidence, `visualObservation`, and `domEvidenceGap`.
- Runtime containment refinement: Agent-side result upload containment now classifies visual-fallback gate failures as `BLOCKED_NEEDS_VISUAL_REVIEW` instead of generic `BLOCKED_RESULT_GATE_CONTAINMENT`. Other containable result-gate upload failures keep the generic containment classification.
- Boundary: this still does not turn screenshots into automatic PASS evidence. It makes screenshot-only frontend observations explicitly reviewable and prevents opaque generic blockers from hiding that the missing piece is structured UI assertion evidence.
- Regression checks: `npm run verify:p0-visual-fallback-contract`, `npm run verify:result-evidence-upload-containment`, `npm run verify:result-evidence-gate`, `npm run typecheck`, and `npm run build --prefix agent`.

P0.25 save/reopen/row-download flow first slice:

- Trigger category: P0.23 classified 10 BLOCKED rows as `save_reopen_row_download_flow_gap`. The first runtime slice targets the shared official UI navigation/readiness issue behind `F-02`, `F-04`, `G-02`, and `M-07`: after saving, helper remained on `/report/new` and failed to return to the project list, while empty official project pages (`新增自訂報表` + `無數據`) were not treated as ready for create-report.
- Added verifier: `npm run verify:p0-save-reopen-download-flow`. The smoke locks official editor/sidebar disambiguation, official empty-project readiness, same-case `F-02` save/reopen routing, same-case `F-04` project-row CSV routing, and `G-02` create-project-then-create-report routing.
- Runtime fix: official UI sidebar navigation no longer treats editor text `拼貼模式` as the left-nav target. It opens `我的自訂` first when needed and only uses `拼貼報表` as the official sidebar target.
- Runtime fix: official empty project routes such as `/report/myCustom/tileMode/<id>` with `新增自訂報表` and `無數據` now count as project-list-ready, so create-report flows can proceed after creating a new project.
- Runtime fix: back-to-project-list readiness recognizes official `/report/new` as an editor route and attempts project/list reselection instead of polling the editor page as if it were already a list page.
- Boundary: this does not yet implement the remaining specialized templates in the same P0.23 bucket (`K-09` field picker observation, `L-08` two-preset switching, `M-06` save-modal cancel, `M-09/M-10` copy modal/save, `M-11` update-and-reopen). Those should be handled as later P0 slices with their own smoke.
- Regression checks: `npm run verify:p0-save-reopen-download-flow`, `npm run verify:capability-gate`, `npm run verify:open-project-retry`, `npm run verify:p0-live-action-templates`, `npm run verify:p0-108-blocked-triage`, `npm run typecheck`, and `npm run build --prefix agent`.

P0.26 field picker / 30-day date preset action-template slice:

- Trigger category: follow-up to the same P0.23 bucket, but limited to two incomplete frontend-observation helper flows from run `ee0cae6b-f2c4-4cb0-a5aa-d79f5b611ca3`: `K-09` only collected source-report picker evidence, and `L-08` only opened the date panel without clicking `過去 30 天` then `最近 30 天`.
- Added verifier: `npm run verify:p0-field-picker-date-preset-templates`. The smoke locks `K-09 -> observationType=fieldPicker` with `metricRows.fieldControl` / `fieldPicker.option.newAccounts` evidence, and `L-08 -> observationType=datePanel` with both 30-day preset targets.
- Domain contract update: `case-scope-runtime-contracts.json` now covers 17 cases: the original 15 reduced-smoke contracts plus `K-09` and `L-08`. `fieldPicker.option.newAccounts`, `fieldPicker.state`, and `dateRange.presetSwitch.state` were added to the BI official UI vocabulary/evidence data with visual alignment references.
- Runtime fix: `collage.observeFrontendState(fieldPicker)` now uses the official row-scoped source + field picker flow, selecting `每日報表` and `新增帳號數` through visible UI and returning `fieldPicker.signature` + `fieldControl.after` evidence. `datePanel` observation now executes requested preset targets and records per-preset before/after date button text, accepting either explicit preset label text or concrete date-range state changes.
- Boundary: this is still a helper-runtime compatibility slice, not a generic Gen4 interpreter. It removes the evidence gap for `K-09` and `L-08`; `M-06`, `M-09/M-10`, and `M-11` remain separate action-template slices.
- Regression checks: `npm run verify:p0-field-picker-date-preset-templates`, `npm run verify:p0-runtime-wiring`, `npm run verify:p0-live-action-templates`, `npm run verify:official-observation-contract`, `npm run verify:bi-official-ui-object-vocabulary`, `npm run verify:domain-pack`, `npm run verify:capability-gate`, `npm run typecheck`, and `npm run build --prefix agent`.

P0.21 follow-up implementation:

- Trigger run: `ee0cae6b-f2c4-4cb0-a5aa-d79f5b611ca3` reached `BIUI_COLLAGE_R001-N-02` with a local single-case `output/result.xlsx`, but server upload rejected it with `RESULT_EVIDENCE_GATE_FAILED` issue codes `RESULT_FRONTEND_OBSERVATION_VISUAL_FALLBACK_REQUIRED` and `TOOL_BRIDGE_RESPONSE_MISSING`. The whole 108-case run then stopped at 100/108, leaving `N-02` through `N-09` unrun.
- Added Agent-side result evidence upload containment: `agent/src/result-evidence-upload-containment.ts`.
- Added verifier: `scripts/verify-result-evidence-upload-containment.ts`.
- Added npm script: `npm run verify:result-evidence-upload-containment`.
- Runtime behavior: when `codex_generated` single-case result upload receives a server `RESULT_EVIDENCE_GATE_FAILED` 422 and the issue codes are containable, Agent rewrites only the current case row, preserves the previous detail JSON inside the new detail, writes `output/result-evidence-upload-containment.json`, and retries the result upload. Visual fallback disputes are contained as `BLOCKED_NEEDS_VISUAL_REVIEW`; other containable result-gate disputes are contained as `BLOCKED_RESULT_GATE_CONTAINMENT`. This keeps the round moving while making the gate conflict explicit.
- Hard boundary: invalid workbook structure, non-current case, multi-case result, missing/invalid detail JSON, untrusted fallback/diagnostic results, and other hard structural result-gate errors still abort. This is a case-level fail-isolation bridge, not a PASS/FAIL judgment engine and not a permission to hide product bugs as BLOCKED.
- Smoke result: fixture smoke reproduces the N-02 issue-code pair, containment updates the workbook, and the same result evidence gate passes after containment. A second smoke copied the actual N-02 `result.xlsx` from run `ee0cae6b-f2c4-4cb0-a5aa-d79f5b611ca3` into `/tmp`, confirmed the same two issue codes before containment, and confirmed `afterStatus=ok` after containment.
- Regression checks: `npm run build --prefix agent`, `npm run verify:result-evidence-upload-containment`, `npm run verify:result-evidence-gate`, and `git diff --check`.

## 1. 範圍

本文件涵蓋線上工具端：

- Tommy 從 UAT Tool Web UI 建立 run。
- 上傳 xlsx / 指派文字 / 測試執行說明 / reference files。
- Railway backend 建立 run 並派工。
- Tommy Mac Agent 下載 run workspace。
- Codex 在 `~/.uat-agent/runs/<runId>/` 讀取 `input/` 內的執行包。
- 結果產生到 `output/result.xlsx`，由 Agent 上傳回 Railway。

不涵蓋：

- Tommy 直接在 `/Users/tommy/Downloads/codex_galaxy` 開 Codex 跑本機 xlsx。
- 本機 `outputs/update_case_result.mjs` 直接寫原始 xlsx。
- 本機 ACTIVE runner 的實際操作流程。

本機手動端請看：

- `/Users/tommy/Downloads/codex_galaxy/uat-tool/docs/planning/local-manual-device-development-log.md`

---

## 2. 為什麼需要這份日誌

線上工具的目標不是只把本機手動流程搬上 Web，而是建立更穩定的派工與 evidence pipeline。

過去本機端累積的問題：

- Codex 每次全文讀規則，速度慢且容易混入舊上下文。
- 長對話會 compact，甚至遇到 remote compact stream disconnect。
- 憑聊天記憶維持規則，容易漏掉決策理由。
- testcase 由 Claude 依記憶產生，缺少穩定 authoring spec。
- evidence 與 result 寫回過度依賴 Codex 自律。

線上工具要解決的是：

- 讓 Codex 讀「編譯後的當前題執行包」，而不是全文讀所有規則。
- 讓 backend / Agent 產生必要上下文與安全邊界。
- 讓工具層做 gate，例如缺 evidence、不合法授權、多題混跑、stale evidence 都要 reject。
- 讓本機 demo 與線上 Agent 使用同一套概念：current case、rule index、helper guidance、result evidence。

---

## 3. 核心架構決策

### 3.1 Rules 仍是 source of truth，但執行時讀 run packet

Tommy 曾問：以後是不是不讀 agent 和 rules？

決策是：不是不用 rules，而是不讓 Codex 每次全文讀 rules。

正確架構：

- `AGENTS.md`、`BI_TEST_RULES/`、Layer 1 rules、authoring spec 仍是 source of truth。
- 線上工具由 backend / Mac Agent 先產生 run packet。
- Codex 執行時主要讀 run packet 的最小上下文。
- 只有 run packet 明確要求或遇到灰區，才補讀特定 rules。

這樣不是放鬆，而是把「規則判讀」前移到工具層。

### 3.2 run workspace 是線上模式的唯一執行現場

線上模式不應以 `/Users/tommy/Downloads/codex_galaxy` 作為主要工作目錄。

預期 workspace：

- `~/.uat-agent/runs/<runId>/`

重要檔案：

- `input/run-brief.md`
- `input/current-case.json`
- `input/current-case-pack.json`
- `input/current-case-pack.md`
- `input/run-state.json`
- `input/rule-index.json`
- `input/bi-ui-helper-guidance.md`
- `rules/PROJECT_AGENTS_FULL.md`
- `rules/BI_TEST_RULES/`
- `rules/BI_DATA/metadata.csv`
- `output/result.xlsx`

Codex 不可修改原始上傳 xlsx。線上模式輸出是 `output/result.xlsx`。

### 3.3 Tool Bridge 授權是線上模式唯一有效授權

本機手動模式可以由 Tommy 在 chat 明確授權不可逆操作。

線上工具模式不同：

- 文件內寫「預先批准」不算授權。
- startup prompt 寫「已授權」不算授權。
- 只有 UAT Tool 的 Tool Bridge response 算授權。

遇到以下情境必須停在安全點並輸出 Tool Bridge request：

- SSO。
- 載入失敗。
- native alert / confirm。
- 刪除。
- 覆蓋。
- 儲存既有報表。
- 離開含未儲存變更頁面。
- 不可逆操作。
- 規格歧義需要 PM 判斷。

### 3.4 線上工具不應自動 dispatch 下一題，除非產品設計明確支持

本機 ACTIVE runner 是為了手動 demo 效率，允許 Codex 跑完一題後自己呼叫 runner 更新 ACTIVE。

線上模式原則不同：

- 每次 run 以 `input/current-case.json` 為準。
- 若要逐題暫停執行多題，由工具 / PM 重新派發下一題。
- Agent 不應自行跳到未派發 case，除非線上產品明確設計 queue runner 並提供 gate。

這點要避免把本機 demo 的 ACTIVE runner 行為誤搬到線上 Agent。

### 3.5 目前 production 架構與部署分支

目前線上工具是前後端分離，再加上一個本機 Agent worker：

```text
Vercel Web UI
  -> Railway API / WebSocket / SQLite / storage
  -> Tommy Mac Agent
  -> Codex CLI + Playwright MCP
  -> Agent 上傳 result.xlsx / log 回 Railway
  -> Railway parser / gate 入庫
  -> Vercel Web UI 顯示結果
```

各層責任：

- GitHub `WTommyboy/testtool`：程式碼來源，不保存正式 runtime DB 或 run artifacts。
- Vercel：前端 Web UI production。
- Railway `testtool` service：後端 API、WebSocket hub、result parser、result/evidence gate、SQLite、storage。
- Railway persistent volume：production runtime data。
  - SQLite：`/app/persist/uat.db`
  - storage：`/app/persist/storage`
  - volume：`testtool-volume`
- Tommy Mac Agent：本機執行器，負責下載 run input、啟動 Codex CLI / Playwright、產生 `output/result.xlsx` 與 log，再上傳回 Railway。
- Mac 本機 `~/.uat-agent/runs/<runId>/`：執行副本與除錯 artifacts，不是線上工具正式資料來源。

目前分支紀律：

- 開發 / 工作分支：`refactor/mac-agent-mvp`
- production 部署分支：`codex/uat-tool-mvp`
- Railway production 追蹤：`codex/uat-tool-mvp`
- Vercel production 也依目前工程文件追蹤：`codex/uat-tool-mvp`

因此只推：

```bash
git push origin refactor/mac-agent-mvp
```

不會保證 Railway 重新部署。涉及線上後端或前端 production 的變更，必須同步推部署分支：

```bash
git push origin refactor/mac-agent-mvp
git push origin refactor/mac-agent-mvp:codex/uat-tool-mvp
```

推完後必查：

```bash
git ls-remote --heads origin codex/uat-tool-mvp refactor/mac-agent-mvp
curl -s https://testtool-production.up.railway.app/version
curl -s https://testtool-production.up.railway.app/health
```

注意：`/version` 目前可能只回 deployment id，不一定回 git commit / branch。若 deployment id 沒變，需到 Railway Deployments 檢查 auto deploy trigger、追蹤 branch，必要時手動 redeploy latest commit。

### 3.6 Session handoff 必須保留活問題

新聊天室交接不能只產 repo inventory 或 deploy 狀態。每份 handoff，包含未來每日自動產生的 D-1 shared handoff，都必須先寫清楚 Tommy 當下正在追問什麼、下一個 assistant 應先回答什麼、目前允許只排查或可進入實作。

正式規則見 `docs/planning/session-handoff-generation-rules.md`。核心判準：如果新聊天室讀完 handoff 只知道有哪些檔案與 commit，卻不知道 Tommy 的活問題與第一個應答方向，該 handoff 視為不完整。

---

## 4. 與本機手動端的共同概念

本機手動端與線上工具端應共用這些概念：

- current case：當前唯一允許執行的 case。
- stale evidence：舊 xlsx / 舊頁面 / 舊截圖不是 current-run evidence。
- rule index：讓 Codex 知道哪些規則可查，不全文讀全部。
- helper guidance：讓 Codex 少摸索 UI，但不能越界。
- required evidence：每題必須取得哪些結構化證據。
- one case guard：一題一跑、一題一寫、一題一驗證。

差異：

- 本機可直接寫原始 xlsx；線上必須輸出 `output/result.xlsx`。
- 本機 Tommy chat 授權可處理高風險操作；線上必須 Tool Bridge response。
- 本機 ACTIVE runner 可自動更新下一題；線上預設不自動 dispatch 下一題。

---

## 5. 半腳本化 / helper 化決策在線上工具的含義

Tommy 曾討論是否改成腳本。最後決策是採「半腳本化 / helper 化」，不採整題固定 Playwright 腳本。

在線上工具端，這代表：

### 可由工具層腳本化

- xlsx 解析。
- case manifest 產生。
- document consistency 檢查。
- run brief 產生。
- rule index 產生。
- current case pack 產生。
- helper guidance 產生。
- result schema 檢查。
- result.xlsx 產生 / 合併。
- evidence presence gate。
- Tool Bridge request / response 對帳。

### 可由 helper guidance 輔助

- 指示 Codex 如何用真實 UI 清空篩選。
- 指示 Codex 如何選欄位、選 operator、輸入值。
- 指示 Codex 如何設定時間與顯示方式。
- 指示 Codex 如何按執行後驗證 network / chart / DOM 變化。
- 指示 Codex 如何讀 Chart.js data 或 DOM list。

### 禁止變成腳本平台

- 不可讓 helper 直接跑完整份 testcase。
- 不可讓 helper 一次跑多題。
- 不可讓 helper 直接判 PASS/FAIL。
- 不可直接打 BI API 取代 UI。
- 不可用 JS setter 設定測試狀態。
- 不可用 `browser_evaluate` 觸發狀態變更繞 UI。

---

## 6. Authoring spec 的角色

原本 testcase 多由 Claude 靠記憶與前次成功樣板產生，缺少明確 authoring rules。

後來決定：

- 不另起一套新規範。
- 直接升級 `/Users/tommy/Downloads/codex_galaxy/uat-tool/docs/authoring/UAT_三文件撰寫規則.md` 成唯一 authoring spec。

已更新的方向：

- 明定本專案採半腳本化 / helper 化。
- 維持 xlsx 核心 16 欄，不先強制新增欄位。
- 在 `測試執行說明_*.md` 每題底下新增 Helper hints。
- Helper hints 可包含：
  - `automationLevel`
  - `operationTemplate`
  - `params`
  - `requiredEvidence`
- Claude 產檔 prompt 與一致性檢查表要同步補上 helper/script 邊界。

線上工具後續應讀取 Helper hints，將其納入 `current-case-pack` 或 `bi-ui-helper-guidance`，而不是只靠關鍵字推斷。

---

## 7. 目前線上工具相關檔案

目前已存在的關鍵檔案：

- `/Users/tommy/Downloads/codex_galaxy/uat-tool/agent/src/current-case-pack.ts`
- `/Users/tommy/Downloads/codex_galaxy/uat-tool/agent/src/rule-index.ts`
- `/Users/tommy/Downloads/codex_galaxy/uat-tool/agent/src/bi-ui-helper-guidance.ts`

### `current-case-pack.ts`

目前功能：

- 讀取 current case。
- 依 case 文字推斷 evidence templates，例如：
  - metadata dropdown。
  - network request。
  - chart datasets。
  - UI workflow。
- 產生 `current-case-pack.json` 與 `current-case-pack.md`。
- 明確聲明 pack 是 plan card，不是 result。
- 要求 current-run evidence 後才能寫 result。

後續方向：

- 接入 authoring spec 的 Helper hints。
- 將 inferred templates 與 explicit helper hints 合併。
- 若 explicit helper hints 與 inferred templates 衝突，標示 warning，不要靜默覆蓋。

### `rule-index.ts`

目前定位：

- 應產生可查詢的 rule index。
- 讓 Codex 不必全文讀所有 rules。
- 將規則切成可引用章節或摘要。

後續方向：

- 針對當前 case 的 `riskLevel`、`testTarget`、`cleanupChecklist`、`operationTemplate`，標出必讀 rule keys。
- 保留 source path 與章節引用，避免摘要失真。

### `bi-ui-helper-guidance.ts`

目前功能：

- 產生 `input/bi-ui-helper-guidance.md`。
- 說明不可越界：
  - 不可內部函式設定狀態。
  - 不可 evaluate 觸發 click/change/input。
  - 不可直接打 BI API。
  - 不可 helper 跑多個 case。
- 說明安全讀取：
  - DOM read。
  - read-only page.evaluate。
  - Chart.js data。
  - network performance entries。
- 提供常見操作節奏：
  - 開啟專案。
  - 新增欄位。
  - 設定時間。
  - 執行與驗證。
  - 儲存 / 刪除 / 原生 Dialog。

後續方向：

- 讓 guidance 根據 current case / operation template 輸出更精準片段。
- 避免每題都輸出過長 generic guidance。
- 明確標記 helper 是輔助，不是授權，也不是批次 runner。

---

## 8. result / evidence gate 應強制的事項

線上工具不能只靠 prompt 要求 Codex 守規矩。工具層要能 reject 明顯不合格結果。

應檢查：

- result 是否只包含 current case。
- 是否試圖一次寫多題。
- 是否缺少 current-run evidence。
- evidence timestamp / run id 是否可追溯。
- 是否把 stale xlsx 欄位或舊結果當 evidence。
- 若有 Tool Bridge request，是否有對應 response。
- 若操作含刪除 / 覆蓋 / native confirm，是否有授權紀錄。
- detail_json 是否可 parse。
- PASS 是否至少有四欄簡化版必要內容。
- FAIL / BLOCKED / PARTIAL 是否有完整原因欄位。

這些 gate 後續應逐步落在 backend / Agent result parser，而不是只寫在 prompt。

---

## 9. 不可回退的紅線

線上工具端必須維持：

- 不可直接打 BI API 取得測試結果。
- API / network 只能觀察 UI 觸發了什麼，不能取代 UI。
- 不可寫爬蟲腳本繞 UI 取得 BI 資料。
- 不可用內部 JS setter 設定測試狀態。
- `browser_evaluate` / `page.evaluate` 只允許讀取，不可用來點擊、改狀態、繞安全層。
- 不可一次 tool call 包含多個 case 的執行邏輯。
- 不可累積多題結果一次寫 xlsx。
- 每題必須有 current-run evidence。
- stale evidence 不採信。
- xlsx 步驟欄指定值不可自行替換。
- 高風險操作必須 Tool Bridge 授權。
- 文件內預先授權不算授權。
- Playwright session 掛掉時，不可改用桌面 Chrome 接手正式 case。

---

## 10. 待辦

### P0

- 檢查 `current-case-pack.ts`、`rule-index.ts`、`bi-ui-helper-guidance.ts` 的現況。
- 將 authoring spec 的 Helper hints 接入 current case pack。
- 讓 run packet 能明確輸出：
  - automation level。
  - operation template。
  - helper params。
  - required evidence。
  - relevant rule keys。
- 保持 one case guard，不允許 run packet 暗示可跑下一題。

### P1

- 將 inferred evidence templates 與 explicit Helper hints 分開顯示。
- 若 Helper hints 缺失，保留目前關鍵字推斷作 fallback。
- 若 Helper hints 和 xlsx case row 明顯衝突，輸出 document consistency warning。
- 將 result parser 加入缺 evidence / 多題寫入 / Tool Bridge 授權缺失檢查。

### P2

- 將 helper template vocabulary 抽成共用資料檔，讓本機與線上工具共用。
- 建立 helper template 測試資料，涵蓋時間、欄位、篩選、分組、CSV、metadata、Chart.js。
- 建立線上工具與本機 ACTIVE runner 的對照測試：同一個 DEMO case 產出相同概念的 guidance。

---

## 11. 日誌更新格式

後續每次更新線上工具流程，請在本節下方追加：

```md
### YYYY-MM-DD HH:mm - 標題

- 背景：
- 決策：
- 修改檔案：
- 驗證：
- 後續影響：
```

### 2026-04-29 - 建立線上 UAT Tool 開發與規劃日誌

- 背景：原聊天歷史過長且 compact 失敗，不能再靠聊天上下文交接。
- 決策：將線上工具端與本機手動端拆成兩份 planning log，長期維護。
- 修改檔案：新增本文件。
- 驗證：文件建立後應可作為新聊天室交接來源。
- 後續影響：後續修改 run packet、Mac Agent、Tool Bridge、rule index、current case pack、helper guidance 時都要更新本文件。

### 2026-04-29 07:56 - Run packet 輸出 Helper guidance

- 背景：線上端 `current-case-pack` 只靠關鍵字推斷 evidence，`bi-ui-helper-guidance` 也只有 generic recipe，尚未讀取 authoring spec 的 Helper hints。
- 決策：新增 Helper hints parser，從已下載的 md / supporting doc 中抓當前 case 的 `Helper hints` JSON；將 explicit hints 與 inferred evidence 分開呈現，再合併成本題 required evidence。
- 修改檔案：`uat-tool/agent/src/helper-hints.ts`、`current-case-pack.ts`、`bi-ui-helper-guidance.ts`、`rule-index.ts`、`task-runner.ts`。
- 驗證：`npm run typecheck --prefix uat-tool/agent`、`npm run build --prefix uat-tool/agent` 通過；以 `tsx` inline sample 驗證 parser 可讀出 `automationLevel`、`operationTemplate`、`params`、`requiredEvidence`。
- 後續影響：run packet 會輸出 case-specific helper guidance 與 recommended rule keys；Helper hints 仍不是授權、不是批次 runner、不能判 PASS/FAIL。

### 2026-04-29 08:06 - Helper hints 子類與未落地 gate 風險登記

- 背景：authoring spec 允許 `requiredEvidence` 使用類型或子類；同時 Helper hints 接線完成不代表 document-consistency / result evidence gate 已完成。
- 決策：Agent parser 放寬 `requiredEvidence` 子類判定，例如 `network.requestBody.dateRange` 視為 `network.requestBody` 的合法子類；將 Helper hints vs xlsx 衝突、result/evidence gate、fallback source case 風險保留為後續 gate 工作。
- 修改檔案：`uat-tool/agent/src/helper-hints.ts`；本次也同步更新本機 parser，避免本機/線上立即分歧。
- 驗證：待本次 typecheck/build 一併跑。
- 後續影響：P1/P0 待辦仍包含：(1) `document-consistency.ts` 檢查 Helper hints vs xlsx row 衝突並輸出 warning；(2) result parser/evidence gate reject 多題寫入、缺 current-run evidence、缺 Tool Bridge response；(3) `result-writer.readFirstInputCase` fallback 不應在 B-01/C-01 起跑時誤標 workbook 第一題；(4) 中期抽共用 helper vocabulary/fixture，避免本機與 Agent parser drift。

### 2026-04-29 08:14 - 新增 Helper hints run packet fixture

- 背景：需要用 temporary fixture 驗證 Helper hints 可一路流到線上 Agent run packet，而不是只靠 parser unit sample。
- 決策：新增 `npm run verify:helper-hints`，同一個暫存 fixture 同時驗本機 prompt / ACTIVE prompt 與 Agent `current-case-pack`、`bi-ui-helper-guidance`、`rule-index`。
- 修改檔案：`uat-tool/scripts/verify-helper-hints-fixture.ts`、`uat-tool/package.json`。
- 驗證：`npm run verify:helper-hints` 已通過，確認 `current-case-pack.json helperHints.found=true`、`operationTemplate=metric_filter_operator`、`params` 完整、`requiredEvidence` 含子類；`current-case-pack.md` 有 Helper Hints；`bi-ui-helper-guidance.md` 有 Template Notes；`rule-index.json currentCaseRecommendations.ruleIds` 含 `bi-ui-helper-guidance` 與 `network-observation-guidance`。
- 後續影響：fixture 不做 result/evidence gate；後續 gate 工作仍獨立排程。

### 2026-04-29 08:29 - 三文件與 Helper hints consistency checker

- 背景：線上派工前應先擋測試包設計矛盾，而不是等 Codex 執行後才由 result/evidence gate 發現。
- 決策：新增 `test-package-consistency` report，重用 `case-manifest.ts` 解析 xlsx，檢查 xlsx、Codex 指派文字、測試執行說明、Helper hints 的起始 case、執行順序、風險等級、測試標的、狀態清理、helper caseId / vocabulary / evidence 對齊。error 併入 `document-consistency.json` 以阻擋 browser execution；warning 只提醒。
- 修改檔案：`uat-tool/agent/src/test-package-consistency.ts`、`document-consistency.ts`、`task-runner.ts`、`rule-index.ts`、`reference-index.ts`、`uat-tool/scripts/check-test-package-consistency.ts`、`uat-tool/scripts/verify-package-consistency-fixture.ts`、`uat-tool/package.json`。
- 驗證：`npm run verify:package-consistency` 已通過，涵蓋好 fixture status=ok、風險等級衝突 blocking error、DEMO001 v1_4 無 blocking error；`npm run typecheck --prefix uat-tool/agent`、`npm run typecheck --prefix uat-tool`、`npm run build --prefix uat-tool/agent` 均通過。
- 後續影響：run packet 會包含 `input/test-package-consistency.json`，run brief / reference index / rule index 都會標出它。這一步只擋測試包設計矛盾，不做 result/evidence gate。

### 2026-04-29 10:35 - Result/evidence gate 接入 result.xlsx ingest

- 背景：測試包設計矛盾已先擋住；下一層要防止 Codex 執行結果不合格仍被線上工具入庫，特別是多題寫入、缺 current-run evidence、缺 Tool Bridge response、Agent fallback result 誤當可信 UAT 結果。
- 決策：在 server `result.xlsx` ingest 前加入 `result-evidence-gate`，重用既有 `parseResultXlsx`，產出 `*.result-evidence-gate.json` report；blocking error 回 422 並不寫入 run_cases/bugs。Mac Agent 上傳時帶 `resultSource`、`currentCaseNo`、`expectedCaseNos`，fallback workbook 會被 gate 擋下；fallback source case 也優先用 current case metadata，不再只取 workbook 第一題。
- 修改檔案：`uat-tool/src/result-parser/result-evidence-gate.ts`、`uat-tool/src/runs.ts`、`uat-tool/agent/src/task-runner.ts`、`uat-tool/agent/src/result-writer.ts`、`uat-tool/scripts/check-result-evidence-gate.ts`、`uat-tool/scripts/verify-result-evidence-gate.ts`、`uat-tool/package.json`。
- 驗證：`npm run verify:result-evidence-gate` 已通過，涵蓋單題 current-run evidence 通過、多題 result、缺 evidence、agent fallback、缺 Tool Bridge response、invalid detail_json 會被擋；`npm run typecheck --prefix uat-tool`、`npm run typecheck --prefix uat-tool/agent`、`npm run build --prefix uat-tool`、`npm run build --prefix uat-tool/agent` 均通過。
- 後續影響：線上工具現在具備第一層 result/evidence gate，但仍是最小版 heuristic。後續 P1 可把 Helper hints 的 `requiredEvidence` 與實際 detail_json evidence key 做更精準對照，並把 Tool Bridge request/response server-side 關聯納入報告。

### 2026-04-29 11:33 - 補記部署分支與 production 架構

- 背景：`8bed859 feat: add UAT package and result gates` 原先只推到 `refactor/mac-agent-mvp`，Tommy 在 Railway 沒看到部署；檢查後發現 Railway production 實際追蹤的是 `codex/uat-tool-mvp`。
- 決策：線上工具變更若要觸發 production，必須把工作分支同步推到部署分支：`git push origin refactor/mac-agent-mvp:codex/uat-tool-mvp`。只推 `refactor/mac-agent-mvp` 只能代表 code review / 工作分支更新，不代表 Railway 會部署。
- 修改檔案：本文件新增「目前 production 架構與部署分支」章節，明列 Vercel / Railway / Mac Agent / GitHub / Railway volume 的責任邊界與部署驗證命令。
- 驗證：已確認遠端 `origin/refactor/mac-agent-mvp` 與 `origin/codex/uat-tool-mvp` 都指向 `8bed859`；`/health` 正常。`/version` 當時 deployment id 尚未變更，需用 Railway dashboard 確認 auto deploy 或手動 redeploy。
- 後續影響：後續任何需要上線的 uat-tool 變更，完成 push 後都要確認部署分支與 Railway deployment 狀態，避免「已推 GitHub 但 production 未更新」。

### 2026-04-29 17:18 - E2E 試跑發現前端清理與檔案選取狀態殘留

- 背景：Tommy 在線上工具 E2E 試跑時，先前被 result/evidence gate 擋下的測試結果可被「清理」清空，但測試設定區未完整 reset；重新選擇 xlsx / 說明文件後，UI 上檔案 input 看似仍有檔名與「2 個檔案」，但底部未列出正確已選檔狀態，按「開始執行」仍顯示「請上傳 xlsx 和至少一份說明文件」。需重新整理網址才能解除。
- 決策：先登記為 Web UI P1 bug，不在目前 E2E 驗證中追加新功能；修正方向應檢查清理動作是否同時 reset run/testcase form state、file input ref、selected file state、validation state 與 uploaded-doc list。
- 修改檔案：暫無程式修改；本文件補記觀察。截圖來源：`/Users/tommy/Desktop/screenshot/截圖 2026-04-29 下午5.15.13.png`。
- 驗證：未修；現象由 Tommy 截圖與操作描述確認。
- 後續影響：後續修 UI 時需補測兩條流程：(1) gate failed / blocked 後按清理，設定與檔案區應回到乾淨初始狀態；(2) 清理後重新選 xlsx + 多份 md，selected files summary 與 submit validation 必須一致，不需刷新頁面。

### 2026-04-29 17:38 - 修正 Tool Bridge 授權後 Codex resume 失敗與 fallback result 混淆

- 背景：DEMO001 E2E run `98fb20cf-3c96-437c-b183-927885f34bb8` 在 DEMO-A-01 preview 後正確停在 Tool Bridge 不可逆操作授權；Tommy 按授權後，Chrome 只多開一個頁籤且沒有任何可見 UI 操作。檢查本機 run workspace 後確認 `codex-resume` 只跑約 2 秒即失敗，stderr 為 `Not inside a trusted directory and --skip-git-repo-check was not specified.`。Agent 接著產生 fallback `result.xlsx` 並嘗試上傳，導致 result/evidence gate 以 detail_json/evidence 不足擋下，反而遮蔽真正根因。
- 決策：Mac Agent 的 `codex exec resume` 必須和首次 `codex exec` 一樣帶 `--json --sandbox workspace-write --skip-git-repo-check`，讓 `~/.uat-agent/runs/<runId>` 這類非 git workspace 可續跑。Agent 自產 fallback workbook 只可作本機診斷，不可寫成 `output/result.xlsx` 也不可上傳成可信 UAT 結果；若 Codex 未產 `output/result.xlsx`，run 應以 `CODEX_NO_RESULT_XLSX` 或原始 `CODEX_RUN_FAILED` 失敗。
- 修改檔案：`agent/src/codex-runner.ts`、`agent/src/task-runner.ts`、`agent/src/result-writer.ts`、`scripts/verify-agent-resume.ts`、`package.json`。
- 驗證：新增 `npm run verify:agent-resume`，用 fake Codex executable 驗證 resume argv 含 `--skip-git-repo-check` 且順序為 `codex exec --json --sandbox workspace-write --skip-git-repo-check resume <thread> <prompt>`。仍需重新部署後再跑一次線上 E2E 驗證實際 Tool Bridge 授權後會接續原 thread 操作 browser。
- 後續影響：Web UI 仍應改善等待授權狀態與按鈕文案，避免「收集 Evidence」階段看似卡住；但此修正先處理 Agent resume 的硬阻塞與 fallback result 混淆。

### 2026-04-29 18:00 - 修正 Web UI 清空草稿與不可逆操作授權 UX

- 背景：Tommy 回報線上工具按「清空為新測試草稿」後，只清掉下方被 gate 擋下的結果，但上方測試設定與原生 file input 狀態殘留；重新選檔後 UI 仍可能顯示有 xlsx / 多份 md，但 submit validation 讀到的 React state 是空，必須刷新頁面才恢復。另外 Tool Bridge pending card 的主要按鈕仍是泛用「已處理，繼續執行」，不可逆操作沒有明確授權語意。
- 決策：清空草稿改成同時 reset selected run detail、case/log/approval panels、測試設定欄位、React file state 與原生 file input value，並避免清空後 `loadRuns()` 又自動選回最新歷史 run。不可逆 Tool Bridge request 改成 explicit authorization card：顯示 type、request id、case、step、action、reason；必須勾選「只限這個 request id」後，`授權並繼續執行` 才可點；保留 `拒絕 / 跳過此 Case` 與 `取消整個 Run`。
- 修改檔案：`web/src/App.tsx`、`web/src/App.css`。
- 驗證：`npm run build --prefix web` 通過；`npm run lint --prefix web` 無 error，仍有既有 hooks dependency warning；`npm run typecheck` 通過。另以本機 API fixture 驗證 WAITING_APPROVAL 畫面：不可逆授權卡未勾選時按鈕 disabled，勾選後 enabled；按「清空為新測試草稿」後狀態回 DRAFT、approval/case/log 清空、file input 顯示未選檔。
- 後續影響：此為前端 UX 修正，不改 Tool Bridge server protocol。之後若要更完整，後端 approvals table 可新增 structured request payload 欄位，避免 Web UI 從 reason 文字反解析 request id / action / reason。

### 2026-04-29 18:31 - 修正 Mac Agent persistent Chrome 多 tab 與 resume 開新 tab

- 背景：OTTEST003 run `02079de5-7896-4ec9-999e-23eeb6a1581e` 顯示 Codex log 已進入 DEMO-A-01 UI 操作，但 Tommy 肉眼看到 Chrome 畫面幾乎不動，且沒有跳出 Tool Bridge 授權。檢查 run workspace 後確認尚未到儲存授權點；MCP session 實際已點 `拼貼test_001`、`+ 新增報表`、選 `新增帳號數`，並卡在日期面板設定。關鍵線索是 MCP 每次回傳都有 5 個 Galaxy tab，且 `ensureChromeDebugSession()` 在 CDP 已存在時每次都 `/json/new` 開新 tab，resume 也會再開 DEV URL tab，導致 Playwright 可能在背景 tab 操作，Tommy 看到的前景 tab 與受控 tab 不一致。
- 決策：Mac Agent initial run 啟動 persistent Chrome 時，先整理 dedicated `~/.uat-agent/chrome-profile` 內既有 page tabs，再開一個 DEV URL tab 並用 CDP `/json/activate` 置前；Tool Bridge resume 時不再開新 DEV URL tab，只 activate 既有 BI edit/home page，避免授權後破壞原本的 browser context。這不改 Tool Bridge request/response protocol，只修正本機 Agent 對 persistent Chrome tab lifecycle 的管理。
- 修改檔案：`agent/src/browser-session.ts`、`agent/src/task-runner.ts`。
- 驗證：`npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run typecheck`、`npm run build` 均通過；compiled `agent/dist/browser-session.js` / `agent/dist/task-runner.js` 已包含 `resetTabs` 與 `openInitialUrl=false` resume 路徑。
- 後續影響：目前正在跑的 OTTEST003 仍使用舊 Agent process，需取消該 run 並重啟 Mac Agent 後才能套用此修正。下一輪 E2E 需確認：(1) run 開始時 Chrome 只留下單一受控 Galaxy tab；(2) UI 操作在前景可見；(3) 儲存前才出現不可逆 Tool Bridge 授權卡；(4) 授權後 resume 不再新增 home tab，而是接續原 edit tab。

### 2026-04-29 18:43 - 補強 Chrome spawn path 的 resetTabs 與 MCP 後置 activate

- 背景：OTTEST004 run `ff2cf1c8-adae-4b57-8bf8-fbdbe8faf89b` 部署 `40305ff` 後仍出現「Log 已進入 UI 操作，但 Tommy 前景畫面沒動」。檢查本機 `mcp-output/session.md` 確認 Playwright 已成功點進 `拼貼test_001`、`+ 新增報表`、`+ 新增欄位`，並已選到 `新增帳號數` 與打開日期面板；同時 CDP `/json/list` 仍顯示兩個 Galaxy page target：一個 home、一個 edit。這代表前一版只修了「CDP 已存在」路徑，但 Chrome 首次 spawn 時仍會從 persistent profile 還原舊 tab，且 Playwright MCP 操作後沒有保證把受控 tab 拉回前景。
- 決策：`ensureChromeDebugSession()` 在 Chrome 首次 spawn 且 `resetTabs=true` 時，不再把 DEV URL 直接塞進 Chrome args；改為等 CDP ready 後先關閉非 `chrome://` 的 user page targets、等待舊 target 消失，再用 `/json/new` 開唯一 DEV URL tab 並 activate。另在每次 `mcp_tool_call` completed 後排程呼叫 `activateBestExistingTab()`，優先 activate `/testview/edit`，其次 `/testview/home`，讓 Tommy 肉眼看到的 tab 與 Playwright 受控 tab 持續對齊。
- 修改檔案：`agent/src/browser-session.ts`、`agent/src/task-runner.ts`。
- 驗證：`npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run typecheck`、`npm run build` 均通過。OTTEST004 目前仍是舊 Agent process / 舊 dist 已啟動中的 run，應取消後用新 Agent 重跑。
- 後續影響：下一輪 E2E 應特別看三點：(1) run start 後 CDP user page target 只剩單一 Galaxy tab；(2) 點進 edit page 後 Chrome 前景立即跟著切到報表編輯器；(3) 儲存前才出現 Tool Bridge，不應再因看錯 tab 誤判「沒動」。

### 2026-04-29 18:58 - 將 Agent Chrome 改為 run-scoped 並強制單一 user tab

- 背景：只做 tab activate 仍偏軟，若 run 結束後 dedicated Chrome 未關閉，下一輪仍可能從 `~/.uat-agent/chrome-profile` 還原舊 home/edit tabs，造成「Log 有動、前景畫面不同步」的再次發生。
- 決策：把 Agent 管理的 Chrome 視為 run-scoped resource。每次 `task.dispatch` 開始前先關閉既有 dedicated Chrome process，再啟動新 Chrome；每次 run terminal 狀態（completed / failed / cancelled）後關閉 dedicated Chrome。唯一例外是 Tool Bridge waiting 狀態，因 SSO / 授權處理可能需要 Tommy 在同一個 persistent Chrome 中操作，等待期間保留 Chrome；若 waiting 狀態被取消，Agent 收到 `task.cancel` 且沒有 active runner 時也會關閉 Chrome。
- 修改檔案：`agent/src/browser-session.ts`、`agent/src/task-runner.ts`、`agent/src/cli.ts`。
- 技術細節：`closeChromeDebugSession()` 只匹配 `--remote-debugging-port=<port>` 且 `--user-data-dir=<chrome_profile_dir>` 的 dedicated Chrome process，不會關閉 Tommy 日常使用的 Chrome。`ensureSingleUserPageTab()` 會在每個 MCP tool call 後關閉多餘非 `chrome://` user tabs，只保留優先序最高的 `/testview/edit` 或 `/testview/home`。
- 驗證：`npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run typecheck`、`npm run build`、`git diff --check` 均通過。
- 後續影響：下一輪 E2E 除了看畫面是否跟動，也要在 run 完成 / 取消後確認 `ps` 不再有 `--user-data-dir=/Users/tommy/.uat-agent/chrome-profile --remote-debugging-port=9222` 的 Chrome process。

### 2026-04-29 19:06 - 修正 `chrome://newtab/` 殘留與 OTTEST005 污染結論

- 背景：OTTEST005 run `5536c8bc-c472-4a51-9a4a-282f335d847e` 套用 run-scoped Chrome 後，開場已會先關前次 Agent Chrome 並新開 dedicated Chrome；但 CDP target 仍可看到 `chrome://newtab/`，因前一版將所有 `chrome://` 視為內部 target 而不關閉。排查期間手動透過 CDP 關閉 `chrome://newtab/` 造成 page target 消失，該 run 因人工干預視為污染，不能當有效 UAT 結果。
- 決策：把 `chrome://newtab/` 從不可關閉內部 target 中拆出，僅在已經有可保留的 Galaxy / app page target 時才自動關閉；`chrome://omnibox-popup`、`devtools://`、`chrome-extension://` 仍視為不可關閉內部 target。MCP tool call 後的對齊仍以 activate / 關閉多餘 app page 為主，不手動干預 live browser。
- 修改檔案：`agent/src/browser-session.ts`。
- 驗證：`npm run typecheck --prefix agent`、`npm run build --prefix agent` 通過；本機用 dedicated Chrome 做 lifecycle 驗證，啟動後 CDP targets 僅剩 1 個 Galaxy page，加上 omnibox popup internal targets，沒有 `chrome://newtab/`；驗證後 `closeChromeDebugSession()` 成功關閉 Chrome，`127.0.0.1:9222` 不可達。
- 後續影響：下一輪 E2E 應重新從新 run 驗證，不沿用 OTTEST005。觀察點：(1) run 開始後使用者可見頁籤只有 Galaxy；(2) 操作畫面與 log 同步；(3) run cancelled / completed / failed 後 dedicated Chrome 完全關閉；(4) 真正到儲存步驟前才出現 Tool Bridge 授權。

### 2026-04-29 19:36 - Helper-assisted UAT V1 execution layer

- 背景：繼續讓 Codex click-by-click 直接操作 MCP，仍會遇到 locator 探索慢、MCP safety layer 擋可逆 click、UI 重畫 ref 失效、console/network/chart evidence 分散等問題。Tommy 決定改為 helper-assisted UAT：Mac Agent helper 做穩定 UI 操作與 evidence 收集，Codex 做判斷與結果撰寫。
- 決策：新增 `helper-execution-plan` run packet。線上派工時，檔案仍先下載到 `~/.uat-agent/runs/<runId>/input/` 作地端備份；Agent 產生 `current-case-pack` 後，同步產生 `input/helper-execution-plan.json` / `.md`，列出單題 helper actions、required evidence、artifact root、Tool Bridge flags 與安全邊界。helper `status=ok` 只代表該 UI 操作完成並有 evidence，不代表 PASS。
- 修改檔案：`agent/src/helper-execution-plan.ts`、`agent/src/bi-ui-helper-executor.ts`、`agent/src/task-runner.ts`、`agent/src/reference-index.ts`、`agent/src/rule-index.ts`、`scripts/verify-helper-hints-fixture.ts`。
- 技術細節：新增 helper executor CLI `agent/dist/bi-ui-helper-executor.js`，走 Agent dedicated Chrome CDP，不直接打 BI API、不用內部 JS setter、不寫 result.xlsx、不判 PASS/FAIL。V1 已實作 `collage.openProject`、`collage.createReport`、`collage.configureMetric`（欄位輔助 + dateRange warning）、`collage.runPreviewAndCollectEvidence`、`collage.saveReport` 的 Tool Bridge gate；`reopen/delete/filter/group` 已註冊為模板，未完成的會回 `not_implemented` 或 `requires_approval`，不會靜默誤判。
- 驗證：`npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run typecheck`、`npm run build`、`npm run verify:helper-hints`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate` 已通過。手動 helper executor smoke：連續執行 `collage.openProject` → `collage.createReport` 成功進入 `報表編輯器` 並產生 DOM evidence + screenshot；`collage.saveReport` 未帶 approval 時回 `requires_approval`，沒有執行儲存；結束後 dedicated Chrome 關閉。
- 後續影響：下一輪 E2E 應觀察 Codex 是否讀 `helper-execution-plan` 並使用 helper report 作 evidence。V1 不是全模板完成版；下一步 P1 是完成 `collage.configureMetric` 的靜態日期 UI 設定、`collage.reopenReport`、`collage.deleteTemporaryReport`、`filter.addAndPreview`、`group.addAndPreview` 的可執行實作，並把 helper report evidence key 納入 result/evidence gate 精準檢查。

### 2026-04-29 20:18 - Run Log / Events 改為增量載入與頁籤檢視

- 背景：Tommy 試跑時發現線上工具「即時執行 Log / Events」只顯示 200 筆，長 run 很快看不到後續。檢查後確認 server `/api/runs/:id/logs`、`/events` 預設 `limit=200`；前端每次 polling 都重抓同一批資料並覆蓋 state，導致超過上限後新資料不再可見。
- 決策：把 run activity 改成可分頁 / 增量載入。後端 `/logs` 補 `after_id`、`hasMore`、`total`、`nextAfterId`，`/events` 也回同一組 pagination metadata；前端預設每批 500 筆，保留已載入資料並用最後一筆 id 往後追。UI 改成 `Timeline / Logs / Events` 三個頁籤，並提供「載入下一批」按鈕，避免混合視圖在長 run 中難以定位。
- 修改檔案：`src/runs.ts`、`web/src/App.tsx`、`web/src/App.css`。
- 驗證：`npm run typecheck`、`npm run build`、`npm run build --prefix web`、`npm run build --prefix agent` 均通過。
- 後續影響：這次只修可觀測性，不改 UAT 執行策略。速度問題仍存在，下一步應聚焦 helper V1 補齊可執行模板，降低 Codex 逐步讀規則、找 locator、等待 MCP 回合的時間；特別是 `configureMetric` 日期設定、`reopenReport`、`deleteTemporaryReport`、`filter.addAndPreview`、`group.addAndPreview`。

### 2026-04-29 23:00 - 加入 timing summary、低 reasoning 與 safe helper pre-run

- 背景：Tommy 回報畫面已會動但速度更慢，若直接重跑只能靠肉眼猜慢點。檢查後發現現有 `run.phase` 只能看大段流程，缺 Codex item / MCP tool call / helper action 的細粒度耗時；同時 Mac Agent 仍吃 Tommy 全域 Codex 設定 `model_reasoning_effort=xhigh`，對 UI 執行回合過重。
- 決策：先做低風險量測與保守加速。Agent 每個 run 產出 `output/timing-summary.json`，記錄 agent phase、Codex turn、Codex command execution、Codex MCP tool call、helper action 的 startedAt / endedAt / durationMs；helper executor report 也新增 duration。CodexRunner 預設覆蓋 `model_reasoning_effort=low`，可用 `UAT_AGENT_CODEX_REASONING_EFFORT=medium|high|xhigh` 覆蓋。Codex 啟動前先執行 helper-execution-plan 中 `requiresToolBridge=false` 且非 optional 的 safe actions，產出 `output/helper-pre-run-summary.json` 與 `output/helper-artifacts/<case>/helper-report.jsonl`；Codex prompt 明確要求先讀 helper report，避免重複已完成 UI 步驟。
- 安全邊界：helper pre-run 不寫 `result.xlsx`、不判 PASS/FAIL、不跑多 case、不直接打 BI API、不用內部 JS setter；`saveReport`、delete、overwrite、native confirm 等需要 Tool Bridge 的 action 不自動執行。若 helper 回報 `DATE_RANGE_UI_SETTING_NOT_FULLY_AUTOMATED_V1` 這類 warning，pre-run 會停止後續 action，讓 Codex 接手補齊狀態，不會用錯日期直接 preview。
- 修改檔案：`agent/src/timing.ts`、`agent/src/helper-pre-runner.ts`、`agent/src/codex-runner.ts`、`agent/src/task-runner.ts`、`agent/src/bi-ui-helper-executor.ts`、`agent/src/helper-execution-plan.ts`、`agent/src/config.ts`、`agent/src/types.ts`、`agent/src/cli.ts`、`scripts/verify-agent-resume.ts`。
- 驗證：本階段先跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:agent-resume`、`npm run verify:helper-hints`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate`。下一輪 E2E 重點看 `timing-summary.json` 是否能明確指出耗時在 helper、Codex command、MCP tool call、artifact upload 或 Tool Bridge 等哪一段。
- 後續影響：下一輪 E2E 後，應用 `timing-summary.json` 決定下一個優化點。若耗時仍在 Codex 規則讀取，繼續縮 prompt / rule index；若耗時在 helper action，優化 selector / wait strategy；若耗時在 MCP tool call，將該 action 下沉到 helper executor；若耗時在 upload/log polling，再優化 artifact pipeline。

### 2026-04-30 05:24 - 確認 Railway production 已部署加速版本

- 背景：`86f321c feat: add UAT timing and helper pre-run` 已推到 `refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp` 後，初次查 `/version` 時 Railway 仍停在 `f47d094`；Tommy 要求推 Railway。
- 決策：本機沒有 `railway` CLI，因此用 production `/version`、`/health` 與 Git remote branch 指向做部署確認。這次 Railway auto deploy 已自行追到最新 commit，不需手動 redeploy。
- 修改檔案：本文件補記部署確認。
- 驗證：`origin/refactor/mac-agent-mvp` 與 `origin/codex/uat-tool-mvp` 皆指向 `86f321cc26ee393a2bdefa18aa89f8ea1d321840`；Railway `/version` 回 `shortCommitSha=86f321c`、`branch=codex/uat-tool-mvp`、`deploymentId=969a406d-22da-4614-926b-34700f8c45b7`；Railway `/health` 為 healthy。
- 後續影響：下一輪 E2E 可直接使用 production `86f321c` 與本機已重啟的 Mac Agent。觀察重點仍是 `output/timing-summary.json` 與 `output/helper-pre-run-summary.json`。

### 2026-04-30 05:52 - 補 Helper actionability 紅線與 artifact 清理

- 背景：Claude 追問 Helper 所在層級、evidence policy 與是否可能踩到「不可用內部 JS setter / 繞 UI」紅線。Tommy 接受三個答覆，並要求兩個立即補強：短期清掉非本題 helper artifacts；立刻移除 helper `force: true` click。
- 決策：M2 前補正式 `agent-skills/uat-tool/rules/helper-protocol.md`，系統化定義 Helper protocol、職責邊界、hard rules、`helper-execution-plan` / `helper-pre-run-summary` / `helper-report` 契約；M2 再把 BI domain helper templates 搬到 `domains/BI/helpers/`，並把 helper artifact timestamp / caseId / action 驗證納入 hard gate。M0/M1 不搬架構。
- 本次修改：helper plan safety 新增「不可使用 `force: true` 或繞過 browser actionability check」；`bi-ui-helper-executor` 移除 `clickByText()` 的 `force: true` fallback，點不到或 actionability 失敗改回 `blocked` report 並留下 reason / DOM / screenshot；Agent 在產生 current-case helper plan 前，會把 `output/helper-artifacts/` 中非 current case 的 artifact 與不符 current case 的 `helper-pre-run-summary.json` 移到 `output/helper-artifacts-archive/<timestamp>/`，避免 Codex 誤讀上題殘留。
- 後續影響：Helper 仍只可收集 current-run evidence，不可判 PASS/FAIL、不寫 `result.xlsx`、不跑多題、不直接打 BI API、不用內部 JS setter。下一版 result evidence gate 需進一步解析 helper report 的 `caseId` / `action` / `startedAt` / `endedAt`，不能只靠 detail_json 文字命中 current-run evidence 關鍵字。

### 2026-04-30 06:02 - 補 Codex 文件更新與 Git 推送紀律

- 背景：Tommy 指出「只要調文件都要更新日誌」本來就是既有要求，但前面 Helper 新元件雖有 planning log，沒有同步補正式規格 / protocol，也曾發生文件先留在本機未即時推 Git，造成跨 session 交接風險。
- 決策：後續 Codex 修改 uat-tool 時，必須把「文件更新、commit/push、deployment branch」狀態當成交付物的一部分回報，不可只說程式已改。
- 執行紀律：
  - 任何工具流程、Mac Agent、Helper、Tool Bridge、run packet、rule index、current-case-pack、evidence gate、result pipeline、部署分支或 production 架構調整，都必須同步更新本 planning log。
  - 架構級新元件或跨 M 版本會沿用的 protocol，不只寫 planning log，也必須補正式 spec / protocol 文件，或至少在本 planning log 明確列入具體待辦、目標路徑與版本點。
  - 程式變更必須在 typecheck/build/相關 verify 通過後立刻 commit/push；若尚未驗證，回報必須明講「尚未 commit/push」。
  - 文件-only 變更也要 commit 並推 `refactor/mac-agent-mvp`；是否同步推 `codex/uat-tool-mvp` 要明確說明。預設不為純文件更新觸發 Railway redeploy，除非該文件是 production runtime 會讀取的契約或 Tommy 明確要求。
  - 需要上線的程式 / runtime 行為變更，必須同步推 `codex/uat-tool-mvp`，並用 `/version`、`/health` 或 Railway deployment 狀態確認 production 是否真的更新。
  - 每次收尾回報必須列清楚：commit hash、已 push 分支、production commit/deployment 是否更新、本機 Mac Agent 是否需要或已完成重啟。
- 後續影響：這條是 Codex 自身工作紀律，避免未來只把規則留在對話裡，造成 compact / 新 session 後遺忘。

### 2026-04-30 06:18 - DEMO001 locator registry 與 diagnostic mode 規格

- 背景：Tommy 與 Claude 採納速度優化 review，決定三件事並行：Tommy 跑 DEMO001 baseline；Codex 先做 DEMO001 會用到的 BI locator registry；Codex 補 diagnostic mode 規格。Claude 也補充：未來 helper 合併成大 action 時，helper internal 仍需逐 action log + artifact，保留中間步驟可見度。
- 決策：locator registry 先放 BI Domain Pack，不放 Layer 1；Layer 1 只定 locator/diagnostic 的安全邊界。`domain-packs/BI/locators/demo001-locator-registry.json` 先收 15 個 DEMO001 draft locators，全部是 Playwright visible UI locator hints，不含 direct API、internal JS setter 或 `force: true`。runtime 派工時若該 domain pack 有 registry，Railway 會把 `domain_locator_registry` 加進 input URLs，Agent 下載為 `input/domain_locator_registry.json`，並在 run brief / prompt / reference index / rule-index 中列出。它是 guidance，不是 result evidence；locator 失敗要 fallback visible UI 並寫 drift。
- Diagnostic mode：新增正式 spec `docs/refactor/UAT_Tool_Diagnostic_Mode_Spec_v0_1.md` 與 Layer 1 rule `agent-skills/uat-tool/rules/diagnostic-mode.md`。v0.1 僅定義非可信快速迭代模式：可跑單題部分 steps、產 `diagnostic-summary.json` / timing / helper artifacts / drift log，但不可寫可信 `output/result.xlsx`、不可更新 PASS/FAIL/BLOCKED、不可把 partial evidence promoted 成 trusted result。
- 修改檔案：`domain-packs/BI/locators/demo001-locator-registry.json`、`domain-packs/BI/locators/README.md`、`domain-packs/BI/AGENTS.md`、`src/domain-loader.ts`、`src/domains.ts`、`src/runs.ts`、`agent/src/task-runner.ts`、`agent/src/reference-index.ts`、`agent/src/rule-index.ts`、`agent-skills/uat-tool/SKILL.md`、`agent-skills/uat-tool/rules/diagnostic-mode.md`、`docs/refactor/UAT_Tool_Diagnostic_Mode_Spec_v0_1.md`。
- 後續影響：selector-map vs persistent helper session 的優先順序仍等 DEMO001 baseline `timing-summary.json` 判斷。若 selector drift 很重，優先強化 locator registry 與 drift review；若 helper spawn / MCP tool call 佔比高，再優先做 persistent helper session 或合併 helper action。

### 2026-04-30 06:44 - 修正 OTTEST007 result.xlsx ingest header/gate 失敗

- 背景：OTTEST007 run `fe9cc0da-f065-4bbe-9f68-0f6a15865a4a` 實際已完成 DEMO-A-01 並產出 `output/result.xlsx`，但 Agent 上傳時 Railway 回 `RESULT_XLSX_HEADER_MISSING:relatedCaseNo`，run 被標 failed。檢查實際 workbook 後確認 Codex 依舊模板產出 Bug sheet header `來源 Case` 且缺 `狀態`，但 server parser 只接受 `關聯編號 / related_case_no` 並硬要求 `狀態` header。
- 決策：parser 對既有舊模板保持相容，避免已產生或舊 session 的 workbook 因欄名漂移無法讀；同時把 Agent 產出的 result template 改成 server 正式欄名。`Bug` sheet 新契約為 `嚴重度, Bug ID, 關聯編號, 標題, 描述, 建議, 狀態`，`Evidence` 只能當額外欄位，不可取代 `狀態`。
- 本次修改：`src/result-parser/result-xlsx-parser.ts` 對 `relatedCaseNo` 新增 `來源 Case / 來源Case / source case / relatedCaseNo` alias，且缺 `狀態` header 時預設 bug status=`OPEN`；`schemaVersion` 讀取改為掃描 `索引` sheet 的 `schemaVersion/schema_version` row，不再把 `欄位/值` 的 `值` 誤當 schema。`agent/src/result-template.ts` 改用正式 Bug headers，並在 template index 補 PASS/FAIL/BLOCKED/PARTIAL detail_json 必填欄位；`agent/src/task-runner.ts` 與 `agent-skills/uat-tool/rules/artifacts-and-results.md` 補 result workbook contract，明確 FAIL 必填 `錯誤原因 / 根因層級 / 驗證方法 / RD 分派`。
- 額外發現：修掉 header 後，OTTEST007 實際 workbook 仍會被 result evidence gate 擋下，因 DEMO-A-01 是 FAIL 但 detail_json 少了 `錯誤原因 / 根因層級 / 驗證方法 / RD 分派`。這些欄位是既有硬規則，不放寬 gate；改由 prompt/template/rule 直接提示 Codex 寫入，降低下一輪漏欄位風險。
- 驗證：`npm run typecheck`、`npm run typecheck --prefix agent`、`npm run build`、`npm run build --prefix agent`、`npm run verify:result-evidence-gate`、`npm run verify:helper-hints`、`npm run verify:agent-resume`、`npm run verify:package-consistency`、`npm run verify:agent-roundtrip` 均通過。已用新的 parser 直接讀取 OTTEST007 本機 `output/result.xlsx`，確認舊 `來源 Case` header 可解析、bug status 可 fallback 為 `OPEN`。
- 補救結果：production 更新到 `cd7de39` 後，將 OTTEST007 本機 `output/result.xlsx` 另存為 `output/result-patched-for-reupload.xlsx`，只補齊 FAIL 必填 `detail_json` 欄位與 `schemaVersion`，不改變 DEMO-A-01 的 FAIL 結論或 evidence。patched workbook 本機 evidence gate 為 `ok`，重新上傳 production 成功，server 回 201、`resultEvidenceGate.status=ok`、`cases=1`、`bugs=1`。線上 run 仍為 `FAILED` 是因為 case 結果為 FAIL，不是 ingest pipeline 失敗。
- 後續影響：下一輪正式 run 若 DEMO-A-01 仍判 FAIL，Codex 需產出完整 FAIL detail_json，否則 server 會以 `RESULT_EVIDENCE_GATE_FAILED` 擋下。這是正確行為；不應為了讓上傳成功而降低 FAIL result 品質。

### 2026-04-30 07:36 - OTTEST008 前速度與穩定性止血

- 背景：Claude 依 OTTEST007 timing 指出三個必修：Helper pre-run 成功但 Codex turn 內 helper 回 `CHROME_CDP_UNAVAILABLE`、連續 native dialog 造成約 100 秒 timeout、result.xlsx header/detail_json 契約需規格化。Tommy 採納 Codex 建議，先做不換架構的 runtime 穩定化，目標 OTTEST008 壓到 8-9 分鐘且 ingest 不再失敗。
- Native dialog：run brief、Codex prompt 與 Layer 1 `tool-bridge.md` 新增 consecutive native dialog guard。同一 save/delete/overwrite flow 中，第一個 native alert/confirm 已處理後，若偵測或合理推定有第二個 native dialog，不再嘗試 Playwright accept/dismiss，也不做 repeated snapshot/read_page；立即 emit `playwright_recovery`，讓 Tommy 在 persistent Chrome 手動處理。目的為避免 OTTEST007 類似的 dialog-chain timeout。
- Helper pre-run：修正 `safeActions()`，只執行 helper plan 中「第一個 requiresToolBridge/optional action 之前」的連續 safe actions，避免 save 需要授權時卻跳過 H5 直接跑 H6 reopen。`collage.configureMetric` 改為嘗試透過 visible UI 設定靜態日期；日期設定成功才回 `ok` 並讓 H4 preview helper 繼續，設定失敗則回 `blocked` + warning，讓 Codex 接手，不會用錯日期 preview。Helper CDP unavailable 時會寫 helper report，包含 endpoint、CDP availability、dedicated Chrome pid、targets、profile dir、debug port 等診斷，不再只在 Codex log 留一句錯誤。
- Result contract：`domain-packs/BI/result_parser_adapter.json` 補 `schemaVersion`、case/bug headers、optional Bug `Evidence` 欄、PASS/FAIL/BLOCKED/PARTIAL detail_json required fields。Agent `result-template.xlsx` 改由 adapter 產生 headers 與 required-field 說明。Agent 在上傳 real Codex `output/result.xlsx` 前先跑 `result-xlsx-self-check.json`，檢查 sheets、headers 與 status 對應 detail_json 必填欄位；失敗時擋在本機，不再等 server ingest reject。server parser 暫時保留 legacy alias 相容，strict multi-version adapter 留到 M2。
- 修改檔案：`agent/src/browser-session.ts`、`agent/src/bi-ui-helper-executor.ts`、`agent/src/helper-pre-runner.ts`、`agent/src/result-contract.ts`、`agent/src/result-template.ts`、`agent/src/task-runner.ts`、`agent-skills/uat-tool/rules/tool-bridge.md`、`domain-packs/BI/result_parser_adapter.json`、`scripts/verify-agent-result-contract.ts`、`package.json`、本 planning log。
- 驗證：`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:agent-result-contract`、`npm run verify:helper-hints`、`npm run verify:result-evidence-gate`、`npm run verify:agent-resume`、`npm run verify:package-consistency`、`npm run verify:tool-bridge`、`npm run verify:agent-roundtrip`、`git diff --check` 已通過。
- 後續影響：OTTEST008 觀察點：(1) helper pre-run 是否跑到 H4 preview；(2) 若 save 後連續 dialog 再出現，是否 5-10 秒內直接 Tool Bridge recovery；(3) 若 Codex 寫壞 result.xlsx，是否被 Agent self-check 擋下並明確顯示欄位/缺欄位，而不是 server 400/422。

### 2026-04-30 08:09 - 修正多 case run 第一題後即結束

- 背景：OTTEST008 run `fb9a9702-c2b8-463e-8d66-cdb2877d092b` 匯入 `importedCases=4`，但 Agent run packet 只固定 `currentCaseNo=DEMO-A-01`；Codex 完成 DEMO-A-01 並上傳單題 `result.xlsx` 後，Agent 直接送 `run.completed`。同時 server ingest 依單題結果把 run 標成 `FAILED`，即使 B/C/D 仍是 `PENDING`，所以畫面呈現「跑完第一個就結束」。
- 決策：維持 one-case-at-a-time hard gate，不改成一個 workbook 批次寫多題。改由 Mac Agent 做逐題 orchestration：每題仍是獨立 current-case pack、獨立 Codex turn、獨立 `output/result.xlsx` 上傳；完成一題後才切下一題。
- 本次修改：Agent 新增 `output/agent-case-progress.json`，記錄本 run 起始 case、已完成 case 與每題 result/log artifact；每次成功上傳後清掉上一題 `output/result.xlsx` 與 self-check/tool-request 暫存，重新產生下一題 `case-manifest/current-case-pack/run-state/helper-execution-plan/run-brief`，封存非本題 helper artifacts，重置 dedicated Chrome，再跑下一題 safe helper pre-run 與 Codex turn。Tool Bridge pause/resume 後也會依 `state.current_case_no` 或 `generated-guides.json` 回到正確 case，完成後繼續後續 case。
- Server ingest：`ingestResultXlsx()` 改為依整個 run 的 `run_cases` 狀態決定 run status。只要仍有 `PENDING/MANUAL_PENDING`，result ingest 回 `RUNNING`，不因目前單題 `FAIL/BLOCKED/PARTIAL` 提前終結；全部 case 都有結果後，才依是否全為 pass-like (`PASS/MANUAL_PASS/SKIPPED`) 決定 `SUCCEEDED` 或 `FAILED`。Bug ingest 也從「每次刪全 run bugs」改為只替換本次 result 相關 case 的 bug，避免第二題上傳時清掉第一題 bug。
- 安全邊界：server result evidence gate 仍 `requireSingleCase=true`，所以 Codex 不能一次交多題 result workbook；Agent 只是自動切換下一個 current case。若 Codex 嘗試把多題塞進同一份 `result.xlsx`，仍會被 gate 擋下。
- 修改檔案：`agent/src/task-runner.ts`、`src/runs.ts`、本 planning log。
- 驗證：`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:agent-resume`、`npm run verify:agent-result-contract`、`npm run verify:tool-bridge`、`npm run verify:helper-hints`、`npm run verify:result-evidence-gate`、`npm run verify:package-consistency`、`npm run verify:agent-roundtrip`、`git diff --check` 已通過。runtime 修正 commit `fe1a117` 已推 `refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp`；後續 documentation-only commit 不影響 runtime。Railway `/version` 已部署到包含該 runtime 修正的 commit，`/health` healthy；本機 `com.tommy.uat-agent` 已重啟，pid `32063`。
- 後續影響：下一輪 OTTEST008/OTTEST009 應看到 DEMO-A-01 上傳後 run 仍維持 `RUNNING`，並出現「切換到下一個 Case」phase；若下一題再次需要授權，Tool Bridge 仍只針對該題停下，不會把前一題授權 carry over。

### 2026-04-30 09:27 - 結構調整：capability gate、save/reopen helper、PM review flow、Codex model

- 背景：OTTEST009 取消後，Tommy 與 Claude/Codex 重新評估線上工具現況。核心問題不是單一 timeout，而是工具會把未支援的 filter/group/detail/metric case fallback 到慢且不穩的 Codex UI 探索；DEMO-A-01 在 OTTEST007 能走到 reopen evidence 判 FAIL，但 OTTEST008/009 卡在 save 後 native dialog/CDP 恢復，導致只能 BLOCKED；同時需要把 Agent Codex model 統一改成 GPT 5.3 Codex。
- Capability gate：新增 `agent/src/capability-gate.ts`，每個 current case 產生 `input/capability-gate.json/md`，分類為 `supported / degraded / unsupported`。record/detail、metric、filter、group 目前會被標為 `unsupported`，Codex 指令為不可執行 trusted browser testcase steps，需寫 `BLOCKED / UNSUPPORTED_ONLINE_CAPABILITY`；metadata/dropdown 類降級為 `codex_visible_ui` 並停用 helper pre-run。`helper-pre-runner` 會讀 capability gate，`helperPreRunAllowed=false` 時直接 skipped，避免 DEMO-B-01 類 `欄位=空` 仍浪費 20 秒、DEMO-C-01 明細 case 被錯派 collage helper。
- Helper save/reopen：`bi-ui-helper-executor` 補 `collage.saveReport` 的 visible UI 報表名填寫、第一個 native dialog 處理、saved report state artifact；若偵測到第二個 native dialog，立即回 `requires_approval` 並附 `playwright_recovery` request，不再等 Playwright timeout。`collage.reopenReport` 從 saved report state 或 params 取 reportName，回列表尋找並重開該報表，收集 reopened DOM/screenshot evidence。filter/group helper 改為明確 `not_implemented`，不再誤導為需授權後可跑。
- PM review flow：server 新增 `POST /api/runs/:id/pm-review`，可對任一 case 寫入 `MANUAL_PASS / MANUAL_FAIL / MANUAL_BLOCKED`，保留 `Codex建議判定`、`PM最終判定`、複核者、時間與備註；UI 在 case detail 增加 PM 最終判定區。這讓工具產出與 PM 最終交付分層，不把 `BLOCKED` 混同為沒抓到。
- Codex model：Agent config 新增 `codex_model`，預設 `gpt-5.3-codex`，可用 `UAT_AGENT_CODEX_MODEL` 覆蓋；`CodexRunner` 啟動/續跑都會傳 `-m <model>`，progress 也會顯示 model + reasoning。既有 config 沒有 `codex_model` 時會自動套預設，不需手動改 `~/.uat-agent/config.json`。
- 修改檔案：`agent/src/capability-gate.ts`、`agent/src/helper-pre-runner.ts`、`agent/src/helper-execution-plan.ts`、`agent/src/bi-ui-helper-executor.ts`、`agent/src/codex-runner.ts`、`agent/src/config.ts`、`agent/src/types.ts`、`agent/src/cli.ts`、`agent/src/rule-index.ts`、`agent/src/task-runner.ts`、`src/runs.ts`、`web/src/App.tsx`、`web/src/App.css`、`scripts/verify-agent-resume.ts`、`scripts/verify-helper-hints-fixture.ts`、本 planning log。
- 驗證：`npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run typecheck`、`npm run build`、`npm run build --prefix web`、`npm run verify:agent-resume`、`npm run verify:helper-hints`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:package-consistency`、`npm run verify:tool-bridge`、`npm run verify:agent-roundtrip`、`git diff --check` 已通過。
- 後續影響：下一輪不應再把 filter/group/detail/metric case 當 trusted online helper run 硬跑；DEMO-A-01 的重點變成 helper/Tool Bridge 能否穩定完成 save 後回列表與 reopen evidence，而不是讓 Codex 在 CDP wedged 狀態下判斷。PM review 可先用於 BLOCKED/灰區結果的最終交付收尾。

### 2026-04-30 09:47 - 預備調整：Mac Agent 自動授權非 SSO/login Tool Bridge request

- 背景：Tommy 明確要求「除了 SSO / login，其他要授權的由 Mac Agent 直接回覆授權」。目標是減少每次 save/native dialog/recovery/ambiguity 都停下等待 PM 點按，讓線上 run 更接近本機連續執行節奏。
- 預計調整：Agent 解析 Codex `TOOL_REQUEST` 後，若 request 文字未命中 SSO/login/auth blocker，直接產生 `approved=true` 的 auto Tool Bridge response 並 resume 同一個 Codex thread；SSO/login 相關 `playwright_recovery` 仍維持 `WAITING_APPROVAL`，由 PM 手動處理。auto response 需寫入 run log/event/state，並在 Codex resume prompt 內標明 `auto_approved_by=mac_agent`，讓 result evidence gate 能辨識這是本 run 的 Tool Bridge response。
- 回滾方式：若此調整造成誤刪、誤覆蓋、native dialog 卡死或 Codex 反覆 auto-resume，回滾到手動授權模式時需移除/停用 Agent 的 auto Tool Bridge response 分流，讓 `processCodexTurnAfterExit()` 對所有 actionable request 一律走原本 `run.tool_request` + `waiting_user`；同時移除 server 對 auto approval 的 approvals 狀態自動結案邏輯，並將 prompt/log 文案改回「只有 PM Tool Bridge response 算授權」。若要快速 hotfix，可先用環境變數關閉 auto policy（預計實作為 `UAT_AGENT_AUTO_APPROVE_TOOL_REQUESTS=false`）。
- 本次修改：Agent config 新增 `auto_approve_tool_requests`，預設 true，可用 `UAT_AGENT_AUTO_APPROVE_TOOL_REQUESTS=false` 關閉。`processCodexTurnAfterExit()` 會把 actionable Tool Request 分成 auto/manual：非 SSO/login/auth 直接送 `run.tool_request` audit + `tool_response.delivered`，再用 auto response prompt resume 同一 thread；SSO/login/auth 仍進原本 waiting_user。auto resume 設 5 次上限，避免 Codex 反覆輸出同類 request 無限循環。server `agent-run-events` 對帶 `auto_approval` 的 request 直接寫 approvals `APPROVED`，不留下 pending approval。
- 修改檔案：`agent/src/task-runner.ts`、`agent/src/config.ts`、`agent/src/types.ts`、`agent/src/cli.ts`、`agent/src/bi-ui-helper-guidance.ts`、`agent/src/helper-execution-plan.ts`、`src/agent/agent-run-events.ts`、`scripts/verify-agent-roundtrip.ts`、本 planning log。
- 驗證：`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:tool-bridge`、`npm run verify:result-evidence-gate`、`npm run verify:agent-roundtrip`、`npm run verify:agent-resume`、`npm run verify:helper-hints`、`npm run verify:agent-result-contract`、`npm run verify:package-consistency`、`git diff --check` 已通過。`verify:agent-roundtrip` 新增 auto-approved request fixture，確認 auto approval 不留下 pending approval，且 approvals audit row 為 `APPROVED / mac_agent_auto_policy`。
- 後續影響：下一輪 run 中，save/native dialog/irreversible/ambiguity 類 Tool Request 不應再停畫面等 PM 點按；真正 SSO/login/auth blocker 仍會停下。若線上觀察到誤操作或反覆 auto-resume，先在本機 Agent 環境設 `UAT_AGENT_AUTO_APPROVE_TOOL_REQUESTS=false` 並重啟 `com.tommy.uat-agent`，再回滾 runtime commit。

### 2026-04-30 11:35 - 修正 auto approval 競態、上傳 timing/diagnostic artifacts、補 diagnostic runtime

- 背景：重新讀取整個線上工具後，標出三個立即調整點：(1) auto-approved Tool Request 送到 server 時，`agent-registry` 仍把 Agent 暫時標成 `idle/currentRunId=null`，可能讓 UI/server 在 Codex auto-resume 期間誤派新 run；(2) `timing-summary.json` 只留在本機 run workspace，線上 UI 不能直接看瓶頸；(3) Diagnostic mode 只有 spec，尚未形成 runtime 閉環。
- Auto approval 競態：`src/agent/agent-registry.ts` 改為辨識 `run.tool_request.payload.auto_approval.approved=true`。auto-approved request 只寫 audit / approval record，不切 idle；`tool_response.delivered` 若帶 `auto_approved_by=mac_agent` 或 `auto_approval_policy`，維持 Agent `busy/currentRunId`。手動 SSO/login request 仍保留原本 idle/waiting 行為。
- Artifacts 管線：server 新增 `runs.timing_summary_path/timing_summary_uploaded_at/diagnostic_summary_path/diagnostic_summary_uploaded_at`，並新增 `POST/GET /api/runs/:id/output/timing-summary` 與 `POST/GET /api/runs/:id/output/diagnostic-summary`。Agent `finally` 會在 `timing.write()` 後上傳 sidecar artifacts；frontend 在 run detail 顯示「診斷與耗時」卡，列出 top timing buckets 與 diagnostic summary。
- Diagnostic runtime：`execution_mode` 新增 `diagnostic`。Agent capability 宣告支援 `interactive, diagnostic`；diagnostic run 仍會下載 input、產 current-case pack / capability gate / helper execution plan、開 dedicated Chrome、跑 safe helper pre-run，但不啟動 Codex trusted result generation、不寫 `output/result.xlsx`、不更新 PASS/FAIL/BLOCKED。Agent 只產 `output/diagnostic-summary.json`、`output/timing-summary.json`、`output/agent.log` 並上傳。server result evidence gate 新增 `resultSource=diagnostic` 直接拒絕，防止 diagnostic artifact 被當可信結果 ingest。
- 修改檔案：`src/agent/agent-registry.ts`、`src/db.ts`、`src/runs.ts`、`src/server.ts`、`src/result-parser/result-evidence-gate.ts`、`agent/src/doctor.ts`、`agent/src/task-runner.ts`、`web/src/App.tsx`、`web/src/App.css`、`scripts/verify-agent-roundtrip.ts`、`scripts/verify-result-evidence-gate.ts`、`docs/refactor/UAT_Tool_Diagnostic_Mode_Spec_v0_1.md`、`docs/refactor/M1_Mac_Agent_MVP_Runbook.md`、本 planning log。
- 驗證：`npm run typecheck`、`npm run typecheck --prefix agent`、`npm run build`、`npm run build --prefix agent`、`npm run build --prefix web`、`npm run verify:result-evidence-gate`、`npm run verify:agent-roundtrip`、`npm run verify:agent-resume`、`npm run verify:agent-result-contract`、`npm run verify:helper-hints`、`npm run verify:package-consistency`、`npm run verify:tool-bridge`、`git diff --check` 已通過。commit/push 與 production 版本確認在收尾回報列出。
- 後續影響：Diagnostic mode 目前是 helper/timing 最小閉環，尚未實作 UI 可選 `fromStep/untilStep` 或由 Codex 執行 partial steps；這兩項留到下一輪。下一輪速度分析可直接從線上 run detail 讀 timing bucket，不必只靠本機檔案。

### 2026-04-30 22:09 - 保守加速：warm Chrome、state delta planner、Helper evidence hard gate

- 背景：Tommy 要求依前面規劃執行下一批速度優化，並先評估不能降低測試品質。本次只加速「固定且可驗證的 UI 操作」，不放寬 evidence gate、Tool Bridge、one-case-at-a-time 或 result contract。
- Warm Chrome：Agent config 新增 `keep_chrome_warm`，預設 true，可用 `UAT_AGENT_KEEP_CHROME_WARM=false` 回滾成原本 run-scoped Chrome。成功完成 run 後保留 dedicated Chrome process / persistent profile，降低下一輪 cold start；每個 run / case 開始仍會 reset 成單一 DEV tab，重新 preflight 與收集 current-run evidence。run failed / cancelled 時會關閉 dedicated Chrome，避免 native dialog 或 blocker 殘留污染下一輪。
- State delta planner：helper plan 會把 current case `cleanupChecklist` 與 parsed cleanup targets 放進 action params。`collage.configureMetric` 現在會輸出 `stateDelta.before/after/checks/operations`，只有 visible UI / DOM state 已驗證對齊時才跳過重複設定；讀不到或對不上就走真實 UI 操作，仍驗證不到則回 `blocked`。日期設定補支援「上月」等 preset：透過 visible UI 點時間控制與 preset，不用內部 JS setter。
- Helper evidence hard gate：helper report 新增 `runId` 與 `evidenceMetadata`，包含 `source=mac-agent-bi-ui-helper`、`runId`、`caseId`、`action`、timestamps、`currentRunEvidence=true`。`helper-pre-runner` 在接受 report 前會檢查 runId / caseId / action / timestamp / helperCanJudgeResult / evidenceMetadata，一項不符就把該 helper action 視為 `error`，Codex 不可引用 stale artifact。
- Helper protocol：新增 `agent-skills/uat-tool/rules/helper-protocol.md`，正式寫下 Layer 1 Helper 職責邊界、hard rules、三份 artifact 契約、current-run evidence gate、state delta planner 與 warm session policy。`SKILL.md`、`rule-index`、run prompt、BI helper guidance、Agent security rule、M1 runbook 都已同步引用。
- 修改檔案：`agent/src/types.ts`、`agent/src/config.ts`、`agent/src/cli.ts`、`agent/src/doctor.ts`、`agent/src/task-runner.ts`、`agent/src/bi-ui-helper-executor.ts`、`agent/src/helper-execution-plan.ts`、`agent/src/helper-pre-runner.ts`、`agent/src/bi-ui-helper-guidance.ts`、`agent/src/rule-index.ts`、`agent-skills/uat-tool/SKILL.md`、`agent-skills/uat-tool/rules/agent-security.md`、`agent-skills/uat-tool/rules/helper-protocol.md`、`docs/refactor/M1_Mac_Agent_MVP_Runbook.md`、`scripts/verify-helper-report-gate.ts`、`package.json`、本 planning log。
- 回滾方式：若 warm Chrome 造成 UI state 或 native dialog 污染，先在本機 Agent 設 `UAT_AGENT_KEEP_CHROME_WARM=false` 並重啟 `com.tommy.uat-agent`；若 helper report gate 擋下過多 action，回查 `HELPER_REPORT_VALIDATION_FAILED:*` 的欄位，不應關掉 evidence gate，而是修 report metadata 或 action artifact。
- 驗證：`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-report-gate`、`npm run verify:helper-hints`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:package-consistency`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 已通過。runtime commit `6c4df8e` 已推 `refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp`，Railway production 已部署到該版本，本機 Agent 已重啟。

### 2026-05-01 00:17 - M2 優化候選：線上 evidence artifact 與系統產品化

- 背景：Tommy 指出截圖只留在本機，對「線上系統」而言不完整。現況可讓本機 Codex/Helper 快速判斷，但線上 run detail 無法完整重現 evidence；若本機 run workspace 清掉，screenshot evidence 也會失效。
- 決策：列入 M2 優先項，不在 M1 立即阻塞 run。M2 應建立 generic evidence artifact pipeline：Agent 先本機收集，run 結束或 case 完成後非同步上傳必要 artifact，detail_json / helper report / case result 改引用 artifact id / URL，不引用 raw local path。
- M2 artifact scope：
  - 上傳優先順序：FAIL/bug、BLOCKED、Tool Bridge/SSO/native dialog、save/reopen/delete major state transition、final evidence。
  - manifest：新增 `output/evidence-artifacts-manifest.json`，記錄 runId、caseId、action、artifactType、localPath、checksum、createdAt、uploadStatus、remoteUrl/artifactId、retentionClass。
  - backend：新增 run artifact table 或 generic artifact endpoints，至少支援 screenshot/helper-report/trace/json；後續可遷到 object storage。
  - frontend：run detail 顯示 artifact list、inline screenshot preview、artifact download，並讓 PM review 可引用 artifact。
  - policy：structured evidence 仍優先，screenshot 不可取代數值/DOM/network；artifact upload failure 不應把已完成的 trusted result 改成 PASS/FAIL，但需留下 upload warning。
- 其他 M2 優化候選：
  - persistent helper worker/session：減少每個 helper action spawn Node/Playwright connect 的成本；仍需逐 action report + artifact。
  - BI domain helper registry：把 BI templates 搬到 domain pack，Layer 1 只保留 protocol/hard rules。
  - locator drift loop：收集 failed locator、DOM excerpt、screenshot、action template，產出 drift report 給 locator registry 更新。
  - diagnostic partial steps：UI 支援 fromStep/untilStep；仍不可 promote 成 trusted result。
  - helper-aware evidence gate：server 解析 helper report metadata/artifact ids，而不是只靠 detail_json 關鍵字。
  - failure taxonomy dashboard：統計 selector drift、preview no request、SSO/login、tool timeout、unsupported capability、result contract failure。
  - crash-safe resume：Agent reconnect 的 `run_snapshot` 從診斷升級為可恢復的 resume/dispatched state。
  - capability roadmap：filter/group/detail/metric 在 helper 覆蓋前繼續走 unsupported/degraded gate，不再硬跑。
  - storage/retention/privacy：規劃 screenshot redaction、quota、90 天後壓縮或移到 object storage。
  - PM review/product UI：run detail 更清楚呈現 Codex 建議判定、PM final decision、evidence artifact、timing bottleneck。
- 優先順序建議：M2 先做 (1) evidence artifact pipeline，(2) persistent helper worker + BI helper coverage，(3) locator drift + diagnostic partial steps。這三個同時改善線上可信度、速度與失敗診斷。
- 安全邊界：M2 不可放寬 one-case-at-a-time、current-run evidence、UI-only state setting、no direct BI API result、Tool Bridge、result evidence gate。加速只能減少固定操作成本，不能跳過判定或 evidence。

### 2026-05-01 01:11 - M2 第一批：generic evidence artifact pipeline 與 diagnostic step range

- 背景：Tommy 要求開始執行 M2 優化。第一批先做不降低測試品質的基礎設施：讓線上 run detail 能看到 evidence artifacts，並讓 diagnostic mode 的 fromStep/untilStep/purpose 不再只停在 spec。
- Evidence artifact pipeline：server 新增 `run_artifacts` table 與 `POST /api/runs/:id/output/artifacts`、`GET /api/runs/:id/artifacts`、`GET /api/runs/:id/artifacts/:artifactId/download`。Mac Agent 在 final sidecar upload 階段掃描 `output/helper-artifacts/**`、`output/helper-artifacts-archive/**`、`output/screenshots/**`、`artifacts/**`、`mcp-output/**`、`output/*.png/jpg/webp`、`output/locator-drift.log/jsonl`、helper summary，產生 `output/evidence-artifacts-manifest.json`，並把每個 artifact 以 generic endpoint 上傳。manifest 記錄 artifactId、runId、caseId、action、type、relativePath、checksum、uploadStatus、remoteArtifactId/remoteUrl。Agent 會等 sidecar/artifact upload 收尾後才清掉 local activeTask，避免 artifact upload 尚未完成時本機誤收下一個 task。
- UI：run summary 增加 artifact count / screenshot count，run detail 的「Artifacts 與診斷」卡顯示 evidence artifact list 與 download link；timing summary / diagnostic summary 仍保留原本呈現。
- Diagnostic partial：Web UI 可在 diagnostic mode 填 `fromStep` / `untilStep` / `purpose`，server 存成 `diagnostic_config_json` 並在 dispatch payload 帶給 Agent。Agent 會把 step range 寫入 `diagnostic-summary.json`，並把 range 外的步驟列為 `not_executed_in_diagnostic` evidence gap。這仍是非可信 diagnostic，不會寫 trusted `result.xlsx`。
- Locator drift：Codex prompt 明確要求 locator drift 寫到 `output/locator-drift.log`；Agent 會解析 `locator-drift.log/jsonl` 放進 diagnostic summary 的 `locatorDrift`，同時把 drift 檔納入 artifact manifest。registry 本身仍不可由 run 自動修改。
- 安全邊界：artifact upload 只增加線上可追溯性，不影響 result evidence gate；artifact upload failure 只留下 warning，不會把 trusted result 改判。Screenshot 仍不可取代 structured evidence。
- 未納入本批：persistent helper worker/session 與 helper-aware result evidence gate 尚未實作。這兩項需要再看下一輪 timing 與 helper coverage，避免為了減少 spawn 成本而引入 session 狀態污染。
- 驗證：`npm run typecheck`、`npm run typecheck --prefix agent`、`npm run build`、`npm run build --prefix agent`、`npm run build --prefix web`、`npm run verify:helper-report-gate`、`npm run verify:helper-hints`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:package-consistency`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 已通過。`verify:agent-roundtrip` 已新增 generic evidence artifact upload/download smoke。

### 2026-05-01 02:54 - 修正 OTTEST002_02 gate regression：TOOL case id、neutral cleanup、package ambiguity auto-approval

- 背景：Tommy 回報 OTTEST002_02「整個改爛」。檢查 run `14dec64c-6dff-47d8-b9b0-2cef9d8cfee8` 後確認，Codex 完全沒有進瀏覽器。原因不是 artifact pipeline 本身，而是前置 gate 組合錯誤：`start-case` parser 不支援 `TOOL-A-01` 這種三段式 case id，反而抓到文件暫停表格中的「繼續 A-02」，造成 `START_CASE_CONFLICT / START_CASE_NOT_IN_XLSX`；同時 capability gate 把 `篩選=不影響 / 分組=不影響` 和「metadata v1.2.5 參考資料」誤判為 active filter/group/metadata dropdown，導致 `TOOL-A-01` 被標成 `UNSUPPORTED_ONLINE_CAPABILITY`。
- Case id 修正：`agent/src/start-case.ts` 支援 `TOOL-A-01` 形式，並優先解析明確 `起始 case:` 標籤；generic `繼續 A-02` 會略過完成/暫停表格列，避免把下一題提示誤當起始 case。`test-package-consistency` 與 `case-manifest` 新增唯一 suffix alias：當 workbook 有唯一 `TOOL-A-02` 時，文件中的 `A-02` 可解析為同一 case，不再產生 unknown/start conflict。
- Capability 修正：新增 `agent/src/case-feature-detection.ts`，把 `篩選=不影響 / 分組=不影響 / 不限 / 空 / 0組 / none` 視為 neutral cleanup，不再觸發 unsupported filter/group gate；`metadata` 只有在明確 metadata dropdown/欄位清單比對語境才算 metadata dropdown case。對 OTTEST002_02 的實際 input 重算後，`TOOL-A-01` 會變成 `supportStatus=supported`，helper plan 會產生 `collage.openProject/createReport/configureMetric/runPreviewAndCollectEvidence/saveReport/reopenReport`。
- Auto approval 修正：非 SSO/login authorization request 仍依 Tommy 要求自動授權；但 package-gate ambiguity decision（testcase/start-case/document/capability gate 衝突）不再 auto-approve。這類不是「授權 native dialog」而是「測試包/起始 case 判斷」，若再出現必須停下給 PM 決定，不可由 Mac Agent 自行採 recommendation。
- 回歸測試：`scripts/verify-package-consistency-fixture.ts` 新增 TOOL-prefixed fixture，驗證暫停表格中的 `繼續 A-02` 不會造成 start conflict，且可唯一對應 `TOOL-A-02`。新增 `npm run verify:capability-gate`，覆蓋 neutral cleanup 不觸發 unsupported、metadata 參考資料不觸發 metadata dropdown、真正 active filter 仍維持 unsupported。
- 驗證：`npm run verify:package-consistency`、`npm run verify:capability-gate`、`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-report-gate`、`npm run verify:helper-hints`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip` 已通過。另用 OTTEST002_02 實際 run workspace 重算，確認 startHint=`TOOL-A-01`、document/consistency 無 error、capability supported、helper actions 六項齊全。

### 2026-05-01 04:18 - 修正 OTTEST002_03：雙月曆日期 Helper、受限 MCP 誤判、BLOCKED evidence 補強

- 背景：OTTEST002_03 已通過 package/capability gate，但 helper pre-run 在 `collage.configureMetric` 卡住：日期面板不是 date/text input，而是左右兩個月曆，因此舊邏輯回 `DATE_RANGE_INPUTS_NOT_FOUND`。後續 Codex 看到 MCP 只暴露 `navigate/tabs/resize` 就直接寫 `BLOCKED / EVIDENCE_INSUFFICIENT`，而 detail_json 又只有 `blocked_reason`、沒有 `currentRunEvidence`，導致 server 上傳閘門以 `CURRENT_RUN_EVIDENCE_MISSING` 拒收 result.xlsx。
- Helper 日期修正：`bi-ui-helper-executor` 的 `setDateRange()` 在找不到 input 時改走雙月曆 fallback：點左右兩側 `靜態時間`、用可見的 `‹/›` 導到目標年月、分別點開始日與結束日、按 `確認`，最後用畫面文字驗證目標區間。全程使用 Playwright visible locator click，沒有 `force:true`，也沒有內部 JS setter。`readDomState/readStateDelta` 同步改為可辨識無 `name=displayMode` 的顯示下拉，避免 `每天/DAILY` 被誤判成未對齊。
- Codex Runner 指令修正（後續 07:42 已修正權責）：當時為避免 MCP 只剩 navigation/tab/resize 就直接判 `EVIDENCE_INSUFFICIENT`，曾要求 Codex 用 shell 跑 helper executor；OTTEST002_05 證實這會踩到 Codex sandbox / CDP 邊界，因此該做法已撤回，helper executor 改由 Mac Agent 擁有。
- Result evidence 防線：新增 `result-evidence-enricher`。Agent 上傳 Codex-generated result 前，若發現 `BLOCKED` row 缺 `currentRunEvidence`，只針對該 BLOCKED row 補上本 run 的 helper/preflight artifact 指標與 helper pre-run 摘要；不會替 PASS/FAIL 補證據，也不改判定結果。這是為了避免同類 BLOCKED 再因 detail_json 少證據而變成 run failed 422。
- 修改檔案：`agent/src/bi-ui-helper-executor.ts`、`agent/src/task-runner.ts`、`agent/src/result-evidence-enricher.ts`、`scripts/verify-agent-result-contract.ts`、本 planning log。
- 驗證：`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-report-gate`、`npm run verify:capability-gate`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:helper-hints`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 已通過；部署與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-01 05:28 - 修正 OTTEST002_04 測題解析錯誤：拼貼 case 誤判、模板範例列、Agent 自動下一題

- 背景：Tommy 指出 OTTEST002 實際測題全部是拼貼模式，但線上 run 將 `TOOL-A-02` 判成 `metric_mode_helper_not_supported`、`TOOL-A-03` 判成 `record_mode_helper_not_supported`，且文件明寫 Agent 模式每次 run 只跑 `input/current-case.json`，實際卻自動 advance 到下一題。檢查 xlsx 後確認 5 題皆為「拼貼模式」，工具分類與流程控制錯誤。
- Capability mode 修正：`case-feature-detection` 改為先尊重明確 `建構模式: 拼貼/明細/指標` 與導航路徑。`指標 ID` 不再代表指標趨勢模式；`detail_json` 不再因包含 `detail` 被判成明細模式。`TOOL-A-02` 現在維持 `mode=collage/supportStatus=supported`；`TOOL-A-03` 維持 `mode=collage`，因 metadata dropdown observation 無 helper pre-run，改為 `degraded/codex_visible_ui`，不可再 BLOCKED 成 record unsupported。
- Evidence template 修正：`current-case-pack` 不再因前置條件單純提到 `metadata v1.2.5` 就套 metadata-dropdown evidence。只有 metadata 與「對照/比對/欄位清單/欄位數/下拉」同時出現時才套該模板，避免 A-01/A-04 這類建制流程被塞入不相關 metadata evidence。
- Result template 修正：`input/result-template.xlsx` 移除 `EX-01 / EX-FAIL` 範例列，只保留 header。舊模板讓 Codex 複製底稿時把 EX 範例列混進 `output/result.xlsx`，造成 server gate 報 `RESULT_MULTIPLE_CASES / RESULT_CASE_NOT_IN_ASSIGNMENT`。
- Agent 下一題策略：新增 `case-advance-policy`，讀 startup/md/supporting docs。若文件命中「Agent 不會自動 dispatch 下一 case」「每次 run 以 input/current-case.json 為準」「跑完輸出結果即停止」「由工具/PM 重新派發下一題」等語句，Agent 上傳當題結果後停止，不再自動 advance。這修正 OTTEST002 指派文字被忽略的問題。
- 規則讀取策略：generated `AGENTS.md` 與 Codex prompt 改為每題判斷前必讀 `AGENTS.md`、`agent-skills/uat-tool/SKILL.md`、`domain-routing.md`、`rules/PROJECT_AGENTS_FULL.md`，再依 `rule-index.json` 讀取必要規則。這會增加一點耗時，但優先避免誤解測題。
- 修改檔案：`agent/src/case-feature-detection.ts`、`agent/src/current-case-pack.ts`、`agent/src/result-template.ts`、`agent/src/case-advance-policy.ts`、`agent/src/task-runner.ts`、`scripts/verify-capability-gate.ts`、`scripts/verify-agent-result-contract.ts`、`scripts/verify-case-advance-policy.ts`、`package.json`、本 planning log。
- 驗證：`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:capability-gate`、`npm run verify:case-advance-policy`、`npm run verify:agent-result-contract`、`npm run verify:helper-report-gate`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate`、`npm run verify:helper-hints`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 已通過；部署與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-01 05:55 - 未來規劃：文件分層、必讀契約與 xlsx single source of truth

- 背景：OTTEST002 regression 暴露「為了加速而過度依賴 compact/run brief/classifier」的風險。原始三文件其實已清楚寫明 5 題皆為拼貼模式、Agent 模式只跑 `current-case.json`、BI domain reference 以 `PROJECT_AGENTS_FULL.md` / `BI_TEST_RULES/` / metadata 為準；但 capability gate/helper classifier 在 Codex 深讀 domain rules 前就先做錯誤 hard block，導致測題準度下降。
- 短期優先順序：先驗證 OTTEST002 在完整上下文必讀策略下不再亂測，再做文件分層分群。不要在同一輪同時大搬文件架構與調整 runtime 判斷，避免無法判斷 regression 來源。下一輪驗證重點是：`TOOL-A-02` 不再判成 metric、`TOOL-A-03` 不再判成 record、Agent mode 不再違反「跑完 current case 即停止」、result template 不再夾帶 EX 範例列。
- 文件分層目標：
  - L0 Runtime / Infrastructure：Vercel、Railway、Mac Agent、Codex CLI、Chrome/CDP、Playwright MCP、storage；只管在哪裡跑、怎麼連、怎麼存，不判斷 BI case 對錯。
  - L1 Tool / Platform：`agent-skills/uat-tool/`，管 run lifecycle、Tool Bridge、evidence gate、result/artifact contract、agent security、one-case-at-a-time、auto approval；不寫 BI metadata、拼貼操作或 PASS/FAIL/BLOCKED domain 邏輯。
  - L2 Domain / BI：目前來源為 `AGENTS.md`、`BI_TEST_RULES/*`、`BI_DATA/metadata.csv`；未來整理成 `domains/BI/BI_UAT_MASTER_CONTRACT.md` + `domains/BI/rules/` + `domains/BI/references/`。負責 BI 測試硬邊界、metadata、狀態清理、測試標的、detail_json、PASS/FAIL/BLOCKED。
  - L3 Feature / Mode：BI 下再分 Collage / Record / Metric。Collage 專屬 locator、helper template、visible UI recipe 應搬到 `domains/BI/features/collage/`，避免 Layer 1 認得過多 BI 細節。
  - L4 Round / Test Package：每輪的 `Codex_指派文字`、`測試執行說明`、`測試案例.xlsx`、supporting docs。管本輪目的、起始 case、暫停策略、授權要求、資料時間與特殊依賴。
  - L5 Current Case：`current-case.json`、`current-case-pack.*`、`run-state.json`、`capability-gate.*`、`helper-execution-plan.*`。只管目前這一題的 intent、風險、測試標的、狀態清理、步驟、預期與 evidence requirement。
- 必讀策略方向：架構可分多層，但 runtime 不應每題讀每層全文。每個 BI trusted case 固定讀 L1 Tool short contract、L2 BI Master Contract、L3 命中的 Feature Contract、L4 本輪 Agent/暫停/授權段落、L5 current case；只有 metadata 對照、狀態清理疑義、detail_json 疑義、Tool Bridge/不可逆操作、PASS/FAIL/BLOCKED 灰區、hard block 前才回讀原始長文件對應段落。
- Master Contract 定位：`BI_UAT_MASTER_CONTRACT.md` 不是摘要取代原文，而是 BI run 必讀的決策入口。它應保留來源版本/hash，並列明「何時必須回讀原文」。目標不是壓到 200 行；現實上可能需要 300-600 行才保留足夠邊界。
- xlsx single source of truth 方向：長期可朝「PM 只提供 xlsx」前進，但前提是 xlsx schema 承載 run-level 與 case-level 完整資訊，例如 `RunConfig` sheet（domain、feature、devUrl、metadata version、executionMode、startCase、stopPolicy、authorizationPolicy、purpose）、`測試案例` sheet（建構模式、授權需求、case dependency、evidence profile、helper policy、download requirement）與 `RoundNotes/Guide` sheet。屆時 `run-brief.md`、`current-case-pack.md`、`case-execution-guide.md` 由工具從 xlsx 產生，兩份 md 可降為 optional supporting docs。
- 安全邊界：在新版 xlsx schema 與 Master Contract 穩定前，不要立即砍掉 `Codex_指派文字` 與 `測試執行說明`。短期仍維持三文件輸入，並要求 classifier/gate 不可早於 structured case intent + 必讀契約做 hard block；若 gate 低信心或只靠關鍵字命中，必須降級為 Codex visible UI / Tool Bridge ambiguity，而不是直接 BLOCKED。

### 2026-05-01 07:42 - 修正 OTTEST002_05：Helper 執行權責與日曆 day cell

- 背景：OTTEST002 run `9cebf4b5-6ffe-4214-9117-94cf16e26370` 已修正前面的 mode/gate 與單題停止問題，但仍在 `TOOL-A-01` 被判 `BLOCKED`。這次不是題目分類錯，而是兩個 runtime 問題疊加：Codex prompt 仍要求「用 shell command_execution 跑 helper executor」，導致 Codex 在 sandbox 內嘗試連 `127.0.0.1:9222`，回 `CHROME_CDP_UNAVAILABLE`；同時 helper 日期 fallback 只找 `button` day cell，但實際雙月曆的日期格不是 button，畫面上三月日期可見卻回 `DATE_RANGE_CALENDAR_DAY_NOT_CLICKABLE`。
- Helper 執行權責修正：helper executor 改回完全由 Mac Agent 擁有。Codex prompt、BI helper guidance、Layer 1 `helper-protocol.md` 都明確禁止 Codex 透過 shell `command_execution` 直接呼叫 helper executor 或自行連 persistent Chrome CDP。Codex 只負責讀 helper report、必要時發 Tool Bridge request、最後判定並寫 result。
- Tool Bridge 後續 helper：新增 `runHelperContinuationAfterApprovals()`。當 Codex 發出非 SSO/login 的 Tool Bridge request 且 Mac Agent auto-approve 後，Agent 會在 resume Codex 前，於 sandbox 外執行 current case 的 pending helper action（例如 `collage.saveReport` 帶 `--approved-tool-request-id`，再接 `collage.reopenReport`），寫入 `output/helper-continuation-summary.json/jsonl` 與 helper reports，再把 summary 路徑交給 Codex 判斷。
- 日期 UI 修正：`clickCalendarDay()` 保留 button locator 優先，但若找不到 button，改找 visible exact text day cell，限制在左右月曆區域內，使用 Playwright locator click（不使用 `force:true`，不使用內部 JS setter）。`getGalaxyPage()` 也不再 fallback 到 `chrome://omnibox-popup` 等 internal target；非 `openProject` action 若沒有 application page，回明確 `GALAXY_PAGE_NOT_FOUND_FOR_HELPER_ACTION`。
- 其他修正：`reportNamePattern` 清除從指派文字擷取時可能帶入的尾端 `)`，避免臨時報表名稱多出括號。
- 回滾方式：若 helper continuation 造成授權後 action 錯接或重複執行，先將 runtime 回滾到前一個 production commit，或暫時把 `UAT_AGENT_AUTO_APPROVE_TOOL_REQUESTS=false` 關掉 auto approval，讓所有授權回到手動 Tool Bridge；不可回到「Codex shell 跑 helper executor」的作法，因為那會再次遇到 sandbox/CDP 邊界不穩。
- 修改檔案：`agent/src/helper-pre-runner.ts`、`agent/src/task-runner.ts`、`agent/src/bi-ui-helper-executor.ts`、`agent/src/helper-execution-plan.ts`、`agent/src/bi-ui-helper-guidance.ts`、`agent-skills/uat-tool/rules/helper-protocol.md`、本 planning log。

### 2026-05-01 07:50 - 修正 OTTEST002_06：同月日期區間結束日不可固定點右月曆

- 背景：OTTEST002 run `d1f5e4c8-4889-4001-bbed-ffaf71bf0812` 顯示 helper 已成功打開日期工具，截圖中左側是 `三月 2026`、右側是 `四月 2026`，左側 31 號可見；但 helper 仍把 `2026/03/01~2026/03/31` 的結束日固定拿到右側月曆找，右側四月沒有 31，導致 `DATE_RANGE_CALENDAR_DAY_NOT_CLICKABLE`。這是同月區間被錯寫成「start 左、end 右」的假設。
- 本次修正：日期點擊改為依目標年月尋找目前可見的月曆，再在該月曆內點 day cell；若開始與結束同年月，結束日會留在同一側月曆點擊，不再強制右側。warning 也補上 `startClicked/endClicked/sameMonth`，下次若再失敗可直接看是哪一段沒點到。
- 修改檔案：`agent/src/bi-ui-helper-executor.ts`、本 planning log。

### 2026-05-01 07:59 - 修正 OTTEST002_07：日期元件是 start/end calendar，不是左右任意 range picker

- 背景：OTTEST002 run `dfe4d47e-67b0-465a-a821-37f5be006bdc` 顯示 07:50 修正仍不足。Helper 在左側 `startCalendar` 點 3/1 後，再點左側 3/31，結果變成 `2026/03/31 ~ 2026/04/30`；DOM 診斷確認此元件不是任意 range picker，而是兩個固定容器：左側 `#startCalendar` 永遠改 start date，右側 `#endCalendar` 永遠改 end date。
- 本次修正：月曆定位改用 DOM id：`#startCalendarMonth/#endCalendarMonth`、`prevMonth('start'/'end')`、`#startCalendar .calendar-day`、`#endCalendar .calendar-day`。即使起訖同月，也會把右側 end calendar 移到目標月份，然後左側點 start day、右側點 end day；不再用左右座標或同側點兩次猜測。另補 `#datePickerPopup` 開啟狀態檢查，避免面板已開時再點日期按鈕反而把面板關掉。
- 二次診斷補充：實測發現只要點左側 start day，前端會把右側 end calendar 自動重算回下一個月，因此 helper 必須在「點完 start day 之後」再移動 end calendar 並點 end day；不能先把兩邊月份都移好再點。流程已改為 `move start month -> click start day -> move end month -> click end day -> confirm`。
- 修改檔案：`agent/src/bi-ui-helper-executor.ts`、本 planning log。

### 2026-05-01 08:21 - 新增 Helper normalized DOM profile：進頁/彈窗/Widget 後先辨認結構

- 背景：Tommy 指出只靠截圖仍可能看得到日期工具卻誤解互動模型，並提出「每進到一頁或叫出視窗後抓一次 HTML，通過的就不用再抓」的方向。採納其核心概念，但不抓完整 HTML，避免 payload 過大、雜訊過多、拖慢 Codex。
- 本次設計：Helper 新增 `ui-dom-profile-v1` artifact，寫到 `output/helper-artifacts/<case>/dom-profiles/*.json`。profile 只保存 visible structure：buttons、inputs、selects、modal/dialog、date picker widget、id/name/role/text/disabled/onclick attribute、selected value、少量 options 與 bounding box；不保存完整 DOM tree。每份 profile 以 normalized structure 產生 `signature`，同樣 page/modal/widget 結構可重用 artifact，操作後仍以局部 state delta 驗證。
- 日期工具補強：`collage.configureMetric` 會在 `configureMetric.before/after`、`dateRange.popupOpened`、`dateRange.staticTabRequested`、`dateRange.staticCalendar`、`dateRange.afterStartDay`、`dateRange.endCalendarReady`、`dateRange.afterEndDay`、`dateRange.afterConfirm` 等節點留下 profile ref。若再遇到類似「點 start 後 end calendar 被重算」的情境，helper report 可直接顯示 widget 結構與 signature/state 變化。
- Artifact pipeline：`evidence-artifacts` 將 `dom-profiles/*.json` 標為 `ui_dom_profile`，線上 artifact list 可追溯。Profile 是 current-run diagnostic/evidence context，可輔助 Codex 判斷 locator drift 與 UI 結構；但不可取代 visible UI action、postcondition、network/chart/table evidence，也不可直接作為 PASS/FAIL 判定。
- 修改檔案：`agent/src/bi-ui-helper-executor.ts`、`agent/src/evidence-artifacts.ts`、`agent-skills/uat-tool/rules/helper-protocol.md`、本 planning log。

### 2026-05-01 08:48 - 修正 OTTEST002_08：BI save 已知第二彈窗卡住

- 背景：OTTEST002 run `e4ad1b3f-31d2-4fd6-af98-439df1d1c86e` 顯示前一版優化已生效，helper pre-run 以 16 秒完成 `openProject/createReport/configureMetric/runPreviewAndCollectEvidence` 4/4，速度明顯改善。但 save Tool Bridge auto approval 後，畫面卡在原生 confirm「是否返回報表列表？」。本機 artifact `saved-report.json` 證實 helper 已捕捉到兩個 dialog：`報表儲存成功！` 與 `是否返回報表列表？`，但舊 dialog guard 只接受第一個 dialog，第二個只設 recovery flag 卻未 accept/dismiss，導致 Playwright action 無法返回，也沒有產出 `helper-continuation-summary.json`。
- 根因判定：這不是測試文件沒說該點哪個按鈕，而是 runtime 對 BI save flow 的已知 dialog chain 太保守。`是否返回報表列表？` 是 save/reopen 流程的必要且可辨認步驟，而且該 action 已有本 run 的 Tool Bridge response（Mac Agent auto approval），應由 helper 在同一個已授權 save action 內處理。
- 本次修正：`collage.saveReport` 新增 dialog decision：收到 Tool Bridge response 後，已知 BI save dialog（儲存成功、是否新增/建立報表、是否返回報表列表）可自動 accept；SSO/login/auth 類或未知 follow-up dialog 不 auto-accept，改 dismiss 後標記 recovery，避免卡死。save submit 與整段 save flow 也加 timeout guard，避免 dialog handler 或 actionability 問題再次造成 5 分鐘以上無輸出。
- 規則同步：更新 Codex prompt、helper execution plan、BI helper guidance 與 Layer 1 `tool-bridge.md`，把規則改成「未收到 Tool Bridge response 前不可處理 native dialog；收到後只可處理已知 BI save dialog；未知 follow-up native dialog 走 recovery」。避免文件仍要求第二彈窗一律不可處理，和 runtime 互相衝突。
- 回滾方式：若 known dialog whitelist 誤按非預期 dialog，先把 `UAT_AGENT_AUTO_APPROVE_TOOL_REQUESTS=false` 關掉 auto approval 並重啟本機 Agent；必要時回滾本 commit，使 save 後第二 dialog 回到 recovery/人工處理。不可移除 save flow timeout guard，否則會回到 OTTEST002_08 的長時間卡住問題。
- 修改檔案：`agent/src/bi-ui-helper-executor.ts`、`agent/src/task-runner.ts`、`agent/src/helper-execution-plan.ts`、`agent/src/bi-ui-helper-guidance.ts`、`agent-skills/uat-tool/rules/tool-bridge.md`、本 planning log。

### 2026-05-01 09:20 - 更新 OTTEST002 文件：Agent 模式改回連續 advance

- 背景：OTTEST002_09 第一題已完整跑完並成功 ingest，但 Agent 依文件中的「每次 run 以 current-case 為準 / 跑完輸出結果即停止 / Agent 不會自動 dispatch 下一 case」等 stop directive 停在 A-01。這不是 runtime 失敗，而是 OTTEST002 來源文件仍保留舊版單題派工寫法。
- 本次文件修正：更新 `BI_UAT_ROUNDS/onlinetest/OTTEST002/Codex_指派文字_TOOL001_v1_0.md` 與 `拼貼工具測試_測試執行說明_for_v1_0.md`，將 Agent 模式改成依 case manifest 連續執行 `TOOL-A-01 → TOOL-A-05`。每題仍要求單題 helper action、單題 `result.xlsx`、單題 ingest/evidence gate 完成後才可 advance，不允許把多題合併在同一次 UI helper action 或同一份結果寫入。
- Authoring 規則同步：`docs/authoring/UAT_三文件撰寫規則.md` 改為 Agent 模式預設可 auto-advance；若某輪真的需要人工停等，需寫明明確 stop directive，避免默認模板繼續產出舊句子。
- 驗證方式：用 `case-advance-policy` 的 stop pattern 對 OTTEST002 兩份來源檔與 authoring 規則掃描，確認不再命中 `Agent 不會自動 dispatch 下一 case`、`每次 run 以 input/current-case.json 為準`、`跑完輸出結果即停止`、`由工具/PM 重新派發下一題`、`每個 case 跑完必停`。
- 修改檔案：`BI_UAT_ROUNDS/onlinetest/OTTEST002/Codex_指派文字_TOOL001_v1_0.md`、`BI_UAT_ROUNDS/onlinetest/OTTEST002/拼貼工具測試_測試執行說明_for_v1_0.md`、`docs/authoring/UAT_三文件撰寫規則.md`、本 planning log。

### 2026-05-02 04:35 - OTTEST002_10 後續 P0 handoff：聚合結果、groupId、多欄位 helper

- 背景：`019dd9b2-2372-72b3-aa90-706ab5bacb02` 與 `019de250-8046-7222-b886-a2eac014e6e1` 兩個聊天都因舊上下文過大，多次接近 context 上限並觸發 remote compact；其中 `019de250...` 表面上很短，但每輪仍帶約 230k input tokens，最後在 `/backend-api/codex/responses/compact` 串流中斷。為避免新 session 再讀 29MB JSONL，新增短交接檔 `docs/planning/session-handoff-2026-05-02-ottest002-p0.md`。後續新聊天應優先讀此 handoff 與本 planning log，不要直接讀完整 session JSONL。
- 是否納入兩個 session：應納入兩者。`019dd9b2...` 是主要工程歷史串，包含 helper pre-run/timing、diagnostic mode、DOM profile、日期工具、BI save dialog、auto advance 等 runtime 變更；`019de250...` 是短續接串，包含 OTTEST002_10 後的最新 P0 決策與 `groupId` 討論。只保留 `019de250...` 會缺掉前面 runtime 決策，只保留 `019dd9b2...` 會缺掉最新 P0 schema/聚合決策。
- OTTEST002_10 觀察：5 題已連續跑完；`TOOL-A-01` 判 FAIL 合理，因 preview/save 使用 `2026-03-01~2026-03-31`，但 reopen 回到 `過去7天`；`TOOL-A-03` 因 metadata 差距 12 個而 BLOCKED 站得住；`TOOL-A-02` 與 `TOOL-A-05` 的 BLOCKED 主要是工具/helper 能力缺口，不是產品不可測；`TOOL-A-04` 雖缺 CSV evidence，但已觀察到 reopen 日期回退，若 case 預期包含 4 項還原，後續應避免把已知功能失敗蓋成 BLOCKED。
- P0 結果產物決策：仍維持每題單題 `output/result.xlsx`、單題 ingest、單題 evidence gate，不允許 Codex 累積多題後一次寫。但 run/group 完成後，server 應從 normalized run state 產生 group aggregate xlsx 與 final aggregate xlsx；UI 下載應指向 final aggregate，而不是最後一題 raw `result.xlsx`。必要時 Agent 可保留 append-only `output/case-results.jsonl` 作 debug sidecar，但 server DB 是正式來源。
- P0 testcase schema 決策：在目前 `groupName` 前新增 `groupId`，例如 `A/B/C/D`。建議 schema 為 `groupId`、`groupName`、`caseOrder`、`caseNo`。同步更新 testcase xlsx、OTTEST002 companion md、parser/manifest、aggregation builder 與 `docs/authoring/UAT_三文件撰寫規則.md`。`groupId` 用於機器分組、群組進度、群組下載與 final aggregate 排序。
- P0 helper 決策：`collage.configureMetric` 必須能解析 `新增帳號數 + MAU(帳號) + 總營收(TWD)` 這類 composite metric string，依序執行 `+ 新增欄位`、逐欄選取、逐欄驗證；不可再把整段字串當單一 clickable text。`TOOL-A-05` 應走既有報表修改流程：`openProject -> openExistingReport(TOOL_A01_*) -> addFields -> runPreview -> overwriteSave -> reopenReport`，找不到 A-01 報表時才以前置失敗 BLOCKED。
- P1/P2 後續：A-04 判定規則需調整為功能流程 case 只要必要子條件已直接失敗，即可 FAIL，不應因後續 CSV evidence 缺失改成 BLOCKED；另需新增 `collage.downloadCsvAndComparePreview`。若沒有真正的 recovery handler，不要發 Tool Bridge recovery 後又立刻 `PREVIOUS_HELPER_ACTION_NOT_OK` skipped，應直接 BLOCKED 並寫明原因。
- 當前 production snapshot：`refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp` 均在 `c506699`；Railway `/version` 回 `c5066991269c6860d66e41b66289188ff558254d`、deployment `b18bd607-9fa2-4601-887c-a2a026ef816f`；`/health` healthy。

### 2026-05-02 04:58 - OTTEST002 P0：groupId schema 與 final aggregate result xlsx

- 背景：OTTEST002_10 已連續跑完 5 題，但 UI 下載的 `UAT_result_*.xlsx` 只包含最後一題 raw `result.xlsx`；同時後續需要穩定機器分組值，避免只靠 `groupName` 文字推斷群組。
- 決策：維持 one-case-at-a-time hard gate。Codex / Agent 每題仍只寫單題 `output/result.xlsx`、單題 upload、單題 ingest、單題 evidence gate；server ingest 後把單題結果寫入 normalized `run_cases` / `bugs`，當 run cases 全部不再是 `PENDING/MANUAL_PENDING` 時，由 server 從 normalized state 產生 final aggregate result xlsx。`GET /api/runs/:id/output/result-xlsx` 優先回 final aggregate；若 run 尚未完成或 aggregate 尚未可產生，才回現有 raw result path。
- groupId schema：`測試案例` schema 新增 `groupId / 群組ID`，位置在 `groupName / 群組` 前；server xlsx parser、Agent case manifest/current case pack/run-state/helper guidance、result template/self-check、result parser、SQLite normalized state 皆同步支援。若舊 workbook 缺 `groupId`，parser 會從 `groupName` 前綴或 `caseNo` 推得 fallback，但新 authoring spec 以必填處理。
- result artifact：新增 `src/result-aggregate-writer.ts` 產出 `uat-final-aggregate-result-v1` workbook，`測試案例` header 為 `群組ID, 群組, 編號, 測試項目, 測試類型, 執行方式, 結果, 失敗分類, 詳細紀錄JSON`。新增 `runs.aggregate_result_xlsx_path / aggregate_result_generated_at` migration 欄位；`result_xlsx_path` 保留 raw single-case upload path 供手動 re-ingest 使用，不覆蓋成 aggregate。
- 文件同步：更新 OTTEST002 xlsx/md、`docs/authoring/UAT_三文件撰寫規則.md`、Layer 1 result workbook contract、BI result parser adapter。OTTEST002 xlsx 已改為 17 欄，5 題 `群組ID=A`。
- 修改檔案：`src/xlsx-parser.ts`、`agent/src/case-manifest.ts`、`agent/src/current-case-pack.ts`、`agent/src/run-state-guide.ts`、`agent/src/result-writer.ts`、`agent/src/result-contract.ts`、`src/result-parser/result-xlsx-parser.ts`、`src/result-aggregate-writer.ts`、`src/runs.ts`、`src/db.ts`、`src/db/schema.ts`、`domain-packs/BI/result_parser_adapter.json`、`agent-skills/uat-tool/rules/artifacts-and-results.md`、fixture scripts、`package.json`、OTTEST002 source files、authoring rules。
- 驗證：`npm run typecheck`、`npm run typecheck --prefix agent`、`npm run build`、`npm run build --prefix agent`、`npm run build --prefix web`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:final-aggregate-result`、`npm run verify:helper-hints`、`npm run verify:package-consistency`、`npm run verify:capability-gate`、`npm run verify:case-advance-policy`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:helper-report-gate`、`npm run verify:agent-roundtrip`、`git diff --check` 均通過。
- 後續影響：下一輪 production run 完成後，UI 的 XLSX 下載應為多題 final aggregate workbook，不再只拿最後一題 raw `result.xlsx`。P0 後續仍需依 handoff 繼續處理 `collage.configureMetric` composite fields、`TOOL-A-05` existing-report flow、A-04 CSV / partial subcondition judgment、recovery noise。

### 2026-05-02 05:12 - 文件維護紀律入 git：同步更新規劃說明與工程 spec

- 背景：Tommy 指出本次調整雖已更新 planning log，但 `docs/refactor/規劃說明.md` 與 `docs/refactor/工程spac.md` 已久未同步線上版實況；也希望「每次更新調整完都要同步更新文件」不要只靠聊天記憶。
- 決策：新增 tracked `uat-tool/AGENTS.md`，把 uat-tool 工程文件維護列為 repo 常駐指令。任何 runtime/schema/result artifact/Agent/helper/deployment/authoring 變更，需在同一 commit 更新 planning log、規劃說明、工程 spec 與受影響規則文件；若判斷不需更新文件，收尾回報必須明確說明原因。
- 規劃說明更新：`docs/refactor/規劃說明.md` 版本更新為 `v2026-05-02`，補上 production 已部署 `b977784` 後的狀態、`groupId / 群組ID` schema、per-case result ingest、server final aggregate result xlsx、Web UI 下載行為、目前 P0 後續項目與文件維護紀律。
- 工程 spec 更新：`docs/refactor/工程spac.md` 版本更新為 `v2026-05-02`，補上 17 欄 testcase schema、`groupId` manifest/current-case/run-state contract、單題 result workbook contract、final aggregate workbook contract、`runs.aggregate_result_xlsx_path / aggregate_result_generated_at`、result download fallback、verification 與 deployment/doc sync discipline。
- 修改檔案：`AGENTS.md`、`docs/refactor/規劃說明.md`、`docs/refactor/工程spac.md`、本 planning log。
- 驗證：本次是文件與 repo instruction 更新，需至少跑 markdown/doc diff 檢查、`git diff --check`，並以 git commit/push 固定。若後續同 commit 夾帶 runtime 變更，必須回到完整 typecheck/build/verify 流程。

### 2026-05-02 05:37 - OTTEST002 P0 helper 補齊：多欄位、既有報表覆寫、CSV evidence

- 背景：Tommy 追問 A-02/A-04/A-05 相關 helper 缺口為何不先做完。前一個 commit 只完成 handoff 第一批 P0(groupId + final aggregate);若此時直接重跑 production，只能驗證 aggregate pipeline，A-02/A-05 仍可能因 helper 能力缺口 BLOCKED。因此本次補剩餘 OTTEST002 P0 helper/runtime。
- 多欄位 helper：`collage.configureMetric` 現在會把 `新增帳號數 + MAU(帳號) + 總營收(TWD)` 這類 composite string 拆成多個欄位，逐一點 `+ 新增欄位`、逐一選取、逐一用 DOM state 驗證。splitter 會保留括號內的 `+`，避免把 `總金額(A+B)` 錯拆。
- 既有報表修改：新增 `collage.openExistingReport`。A-05 類 case 會走 `openProject -> openExistingReport -> configureMetric -> runPreview -> saveReport(overwriteExisting) -> reopenReport`，不再誤走 `createReport`。openExisting 會優先讀本 run 前置 case 的 `saved-report.json` 找 `TOOL_A01_<timestamp>`，找不到或清單不可見就 blocked 並標前置失敗，不會新建報表替代。
- 覆寫儲存與 recovery noise：`saveReport` 支援 overwriteExisting，優先沿用既有報表名；已知 BI save/overwrite/return-to-list dialog 在 Tool Bridge response 後可由 helper 處理。未知 native dialog 若沒有實際 recovery handler，helper 直接 `blocked` 並留下 dialog evidence，不再發 recovery 後立刻 `PREVIOUS_HELPER_ACTION_NOT_OK` skipped。
- CSV evidence：新增 `collage.downloadCsvAndComparePreview`。helper 透過 visible UI 觸發 CSV download，保存下載檔，讀回 CSV row count / numeric columns，與同 case `preview-evidence.json` 中 Chart.js series 比對。helper 只產生 evidence，不直接判 PASS/FAIL。
- 規則同步：更新 helper guidance、Layer 1 helper protocol、Tool Bridge dialog chain 規則、Codex run brief/native dialog prompt、capability gate 與 fixture verification。
- 修改檔案：`agent/src/bi-ui-helper-executor.ts`、`agent/src/helper-execution-plan.ts`、`agent/src/capability-gate.ts`、`agent/src/bi-ui-helper-guidance.ts`、`agent/src/task-runner.ts`、`agent-skills/uat-tool/rules/helper-protocol.md`、`agent-skills/uat-tool/rules/tool-bridge.md`、`scripts/verify-capability-gate.ts`、本 planning log、refactor 規劃與工程 spec。
- 驗證：`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:capability-gate`、`npm run verify:helper-hints`、`npm run verify:helper-report-gate`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:tool-bridge`、`git diff --check` 已先通過；收尾前需再跑 deployment 需要的 build/verify 組合並確認 Railway `/version`、`/health`。

### 2026-05-02 06:19 - 修正 OTTEST002_12：單題 result.xlsx 缺 `群組ID` 的安全修復 guard

- 背景：OTTEST002_12 run `3f6c3db9-1a9c-408f-9ae5-f8aa2c13df5f` 已成功完成 `TOOL-A-01` helper pre-run、Tool Bridge save/reopen continuation，且 Codex 合理判定產品 FAIL：重開後日期區間從 `2026/03/01~2026/03/31` 回退為 `過去7天`。但 Codex 寫出的 `output/result.xlsx` 是舊 8 欄格式，`測試案例` sheet 缺 `群組ID`，Agent 上傳前 self-check 以 `RESULT_XLSX_HEADER_MISSING` 擋下，導致有效測試結果沒有進 server。
- 根因判定：production deployment 與 input template 是新的；`input/result-template.xlsx` 已含 `群組ID, 群組, 編號...`。失敗點在 Codex 仍依舊格式手寫單題結果 workbook。這不是 helper / Railway ingest / final aggregate 的錯，但 Agent 在 schema 轉換期缺少安全單題修復 guard，讓可修復的舊欄位漂移變成整 run 失敗。
- 本次修正：新增 `agent/src/result-workbook-repair.ts`，在 codex_generated `output/result.xlsx` 上傳前、self-check 前執行。只有符合以下條件才修復：`測試案例` sheet 缺 `群組ID`、header 正好是舊 8 欄 legacy layout、資料列正好只有目前 current case、case no 與 dispatch metadata 相符、`expectedCaseNos` 不超過 1。符合時在 `群組` 前插入 `群組ID`，值優先取 input current case 的 `groupId`，並寫 `output/result-xlsx-repair.json`。
- 安全邊界：多題 result workbook、錯題、缺其他 header、非 legacy layout、無法確認 current case 的情境一律不修；仍由 `result-xlsx-self-check.json` 擋下。這不放寬 server contract，也不允許 Codex 累積多題後一次寫。修復後仍必須通過原本 Agent contract check、server result evidence gate 與單題 ingest。
- 驗證：新增 `verify:agent-result-contract` fixture 覆蓋舊 8 欄單題 workbook，確認修復前 self-check error、修復後 contract ok、parser 讀到 `groupId=A`。另用 OTTEST002_12 實際本機 `output/result.xlsx` 複本測試，確認修復前唯一錯誤為缺 `群組ID`，修復後 contract ok 且保留 `TOOL-A-01 / FAIL / FUNCTIONAL_REGRESSION` 與 detail_json current-run evidence。完整驗證已跑過 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:final-aggregate-result`、`npm run verify:capability-gate`、`npm run verify:helper-hints`、`npm run verify:helper-report-gate`、`npm run verify:tool-bridge`、`npm run verify:case-advance-policy`、`npm run verify:package-consistency`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check`。
- 修改檔案：`agent/src/result-workbook-repair.ts`、`agent/src/task-runner.ts`、`scripts/verify-agent-result-contract.ts`、`agent-skills/uat-tool/rules/artifacts-and-results.md`、本 planning log、refactor 規劃與工程 spec。

### 2026-05-02 06:55 - 修正 OTTEST002_13：degraded case 不可落入 Agent fallback

- 背景：OTTEST002_13 run `e47d033e-2ade-442e-9a05-86d184bc3fd2` 不是單純斷網失敗。A-01 已 `FAIL` 並成功 ingest，A-02 已 `PASS` 並成功 ingest，且 A-02 多欄位 helper/日期/preview/result upload 是目前 P0 改善的正向證據。失敗發生在 A-03：capability gate 為 `degraded`、helper pre-run 被跳過，Codex turn 又沒有 browser automation tool 可做 first browser preflight，於是 Codex 沒寫可信 `output/result.xlsx`，Agent fallback 被正確拒絕上傳，最後 run 以 `CODEX_NO_RESULT_XLSX` 失敗。
- 決策：degraded + browser tool unavailable 是 current case 的可信平台阻塞，應由 Codex 寫單題 `BLOCKED result.xlsx`，`失敗分類=TOOL_EXECUTION_UNAVAILABLE` 或 `EVIDENCE_INSUFFICIENT`，detail_json 必須含 `blocked_reason` 與 current-run evidence（capability gate、helper skipped summary、preflight/tool 狀態、agent log 摘要）。不可再把這種可判定阻塞丟給 Agent fallback；fallback 仍只保留給 process crash/cancel/完全無法寫 workbook 的診斷情境，且仍不可信不上傳。
- 本次修正：`capability-gate` 的 degraded 指令改為 browser/UI path 不可達時寫 `BLOCKED/TOOL_EXECUTION_UNAVAILABLE`；Codex run prompt 的 fast path / hard gate / result workbook contract 同步改掉「不能測就交給 fallback」的舊說法；Layer 1 `artifacts-and-results.md` 補上 degraded helper skipped 的 BLOCKED result contract。
- 驗證：`verify:capability-gate` 新增 A-03 metadata compare fixture assertion，確認 degraded case 的 `codexInstruction` 包含 `TOOL_EXECUTION_UNAVAILABLE`，避免回到 fallback 路徑。已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:capability-gate`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:final-aggregate-result`、`npm run verify:helper-hints`、`npm run verify:helper-report-gate`、`npm run verify:tool-bridge`、`npm run verify:case-advance-policy`、`npm run verify:package-consistency`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 通過；收尾需 commit/push deployment branch 並確認 Railway `/version`、`/health`。
- 修改檔案：`agent/src/capability-gate.ts`、`agent/src/task-runner.ts`、`agent-skills/uat-tool/rules/artifacts-and-results.md`、`scripts/verify-capability-gate.ts`、本 planning log、refactor 規劃與工程 spec。

### 2026-05-02 07:31 - 修正 OTTEST002_14：A-01 欄位 actionability、CSV 分層判定、metadata reference 與 must-read rules

- 背景：Tommy 檢查 OTTEST002_14 後指出三個問題：A-01 本應跑到可判定流程卻因 helper `ADD_FIELD_BUTTON_NOT_CLICKABLE:新增帳號數` 早早 `BLOCKED`；A-04 CSV case 看起來像 Agent 無法驗證下載檔；A-03 metadata case 需要更明確指定「工具設置時提供的參考數據 CSV」。同時也討論到 Codex 是否因未完整讀 Agent/rules 而漏判。
- A-01 helper 修正：`collage.configureMetric` 的欄位新增不再只靠 `+ 新增欄位` 文字 locator。新增 visible UI fallback：role=button、button text、role/class button、visible button index、visible text target；仍全部走 Playwright actionability click，不用 `force:true`、不使用 JS setter。失敗時 reason 會帶 visible buttons / targets，方便下一輪定位 locator drift。
- CSV 判定修正：`collage.downloadCsvAndComparePreview` 在點不到下載按鈕時會先讀 DOM state。若頁面顯示「請選擇欄位/點擊執行/無預覽」等狀態，blocked reason 改為 `CSV_PRECONDITION_NOT_MET_NO_CURRENT_PREVIEW` 並帶 dateRange/fields/buttons。Codex prompt、BI helper guidance、Layer 1 result contract 同步要求 save/reopen + CSV case 先按必要子條件判定：若重開設定或 preview 已失敗，CSV 比對寫 `not_reached`，不可把已知功能 regression 降成 BLOCKED。
- Metadata reference 修正：authoring 規則與 runtime prompt 明確規定 metadata/dropdown case 以 run packet canonical `rules/BI_DATA/metadata.csv` 為準，原始 `BI_DATA/metadata＿1.2.5 - 工作表1.csv` 只作 traceability。metadata detail_json 應包含 `reference_csv`、`source_report`、`match_key`、`compare_fields`、normalization notes 與差異清單。
- Rule loading 修正：`current-case-pack.json` 新增 `mustReadRuleKeys`，依 case type 強制帶入最小必要規則包。所有 case 固定 current case/capability/run-state/evidence/artifacts/Codex runtime；helper/UI workflow/CSV case 加 helper execution plan、helper protocol、BI helper guidance；metadata case 加 reference-index 與 BI metadata rule；CSV case 加 evidence-template-index。`rule-index.currentCaseRecommendations` 會合併此 mandatory bundle。
- Evidence template：新增 `downloaded-csv-evidence.json`，定義 UI-triggered download path、suggested filename、CSV header/row count、preview comparison 與 not-reached reason。current-case-pack 會在 case 文字含 CSV/download/下載/匯出時加入 `downloaded-csv` template。
- 文件同步：更新 `docs/authoring/UAT_三文件撰寫規則.md`，新增 metadata 前置條件寫法、CSV 下載 case 子條件順序與 helper hints 建議；同步更新 `docs/refactor/規劃說明.md` 與 `docs/refactor/工程spac.md`，記錄 must-read rules、CSV/metadata contract 與新的 regression 重跑重點。
- 修改檔案：`agent/src/bi-ui-helper-executor.ts`、`agent/src/current-case-pack.ts`、`agent/src/rule-index.ts`、`agent/src/evidence-templates.ts`、`agent/src/helper-execution-plan.ts`、`agent/src/bi-ui-helper-guidance.ts`、`agent/src/reference-index.ts`、`agent/src/task-runner.ts`、`agent-skills/uat-tool/rules/helper-protocol.md`、`agent-skills/uat-tool/rules/artifacts-and-results.md`、`scripts/verify-helper-hints-fixture.ts`、authoring/refactor docs、本 planning log。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-hints`、`npm run verify:capability-gate`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:helper-report-gate`、`npm run verify:tool-bridge`、`npm run verify:case-advance-policy`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 通過；已推 `refactor/mac-agent-mvp` 與 deployment branch `codex/uat-tool-mvp`，Railway `/version`、`/health` 於收尾查驗。

### 2026-05-02 07:45 - 加強每題 AGENTS / md / BI rules 必讀範圍

- 背景：Tommy 確認是否已加強 Agent、md 與 rules 讀取，並希望「最好都給我有讀」。前一版 `mustReadRuleKeys` 已依 case type 強制載入 helper/CSV/metadata 規則，但 BI 三本 canonical rulebook 仍主要靠推薦與 binding wording，未放進每題 mandatory bundle。
- 本次修正：`current-case-pack.json.mustReadRuleKeys` 的所有 BI case 基礎集合新增 `platform-skill`、`domain-routing`、`bi-project-agents-full` 與三份 canonical BI rulebook：`BI測試標準_共通方法論`、`BI測試_系統背景知識`、`BI系統_metadata摘要`。`task-runner` prompt 同步改成每題判定前必讀 generated AGENTS/platform rules、`PROJECT_AGENTS_FULL.md` 與全部 `rules/BI_TEST_RULES/*.md`。
- 文件同步：`docs/refactor/規劃說明.md` 與 `docs/refactor/工程spac.md` 更新 must-read 規則，明確標示每個 BI case 都會帶入 Layer 1、domain-routing、AGENTS full 與三份 BI rulebook；case-type 規則再額外加 metadata/CSV/helper 專用包。
- 修改檔案：`agent/src/current-case-pack.ts`、`agent/src/task-runner.ts`、本 planning log、refactor 規劃與工程 spec。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:helper-hints`、`npm run verify:capability-gate`、`git diff --check` 通過；收尾需 commit/push deployment branch 並確認 Railway `/version`、`/health`。

### 2026-05-02 08:26 - 收緊 OTTEST002_16：metadata 精確檔名與 CSV 下載正式 evidence

- 背景：Tommy 檢查 OTTEST002_16 後確認 A-03 不是 metadata 未提供，而是多參考檔時需要更明確告訴 Codex 哪一份 CSV 才是 metadata；A-04 則需釐清「Codex/Agent 能不能讀下載 CSV」。本次決策：metadata case 用 exact source filename + reference-index 鎖定來源；CSV case 正式 evidence 走 UI 下載後本機 parser，不導入 Google Sheet 作主流程。
- OTTEST002 source 更新：實際測題來源 `BI_UAT_ROUNDS/onlinetest/OTTEST002/拼貼工具測試_測試案例_v1_0.xlsx` 已更新 A-03/A-04。A-03 明寫 source filename=`metadata＿1.2.5 - 工作表1.csv`、Agent canonical=`rules/BI_DATA/metadata.csv`、reference-index key=`bi_metadata_csv`，並禁止 bulk-read 全部 CSV 猜測來源。A-04 明寫必須完成「儲存→重開→current preview→UI 下載 CSV→本機 CSV parser 比對 preview」，只完成 preview 不可直接判 `BLOCKED/EVIDENCE_INSUFFICIENT`。
- Companion md 更新：`BI_UAT_ROUNDS/onlinetest/OTTEST002/Codex_指派文字_TOOL001_v1_0.md` 與 `拼貼工具測試_測試執行說明_for_v1_0.md` 同步 metadata 檔名、reference-index 與 CSV not-reached/FAIL 分層判定。這兩份目前位於 `uat-tool` git root 外，實體檔已更新，但不會被本 repo commit 追蹤。
- Runtime/rules 更新：authoring 規則、Layer 1 artifacts/results、helper protocol、generated BI helper guidance、reference-index、evidence-template 與 task-runner prompt 同步：metadata 多檔案時只讀 `bi_metadata_csv` 或 exact filename；UI 下載後可讀本機 CSV；Google Sheet 只作人工探索 fallback；save/reopen/download helper plan 未完成前不可直接把 CSV path 判成 evidence insufficient。
- Refactor 文件同步：`docs/refactor/規劃說明.md` 與 `docs/refactor/工程spac.md` 更新最新 planning/spec，將 exact metadata source filename contract、local CSV parser evidence 與 A-04 helper continuation 納入近期 P0 驗證重點。
- 驗證：已跑 OTTEST002 package consistency check（status=warning，唯一 warning 為 legacy package 無 helper hints JSON，無 error）、`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:capability-gate`、`npm run verify:package-consistency`、`npm run verify:helper-hints`、`git diff --check` 通過。

### 2026-05-02 08:35 - README 更新：目前最新版、歷程與 source-of-truth 分層

- 背景：Tommy 詢問 `UAT_三文件撰寫規則.md` 與建議放入 git 的 testcase package 是否用途相同，並指出 Git README 很久沒有更新。釐清後決策：authoring rules 是「怎麼寫測試包」的規範；實際 xlsx/md 測試包是「某輪測試的版本化產物」，兩者用途不同。若要讓 Git 記住 OTTEST002 的實際上傳版本，需另設 tracked package 目錄，例如 `test-packages/OTTEST002/`。
- README 更新：重寫 `README.md`，補上目前 production path、Vercel/Railway/Mac Agent/Codex/Playwright 架構、active branches、Mac Agent MVP 能力、one-case-at-a-time contract、result workbook/final aggregate contract、current-run evidence、Tool Bridge、test package source-of-truth 分層、OTTEST002 最新決策、文件地圖、local dev、Railway deployment notes、常用 API surface 與文件維護紀律。
- 部署判斷：本次只改 README 與 planning log，不改 runtime、schema、Agent/helper 或 production 行為；因此不需要推 deployment branch 觸發 Railway redeploy。為了讓 GitHub default branch README 也更新，仍應將同一 docs-only commit 推到 `codex/uat-tool-mvp`。
- 驗證：需跑 `git diff --check`，不需重跑 TypeScript/build/production health，因為沒有程式或部署行為變更。

### 2026-05-02 10:35 - OTTEST002_16_1 後續：A-03 metadata helper 與 A-04 清單頁 CSV 測題改版

- 背景：Tommy 檢查 OTTEST002_16_1 後確認 A-03 仍無法判讀，但 run evidence 顯示 metadata 其實已正確複製到 `rules/BI_DATA/metadata.csv`，且 `reference-index` 也有 `bi_metadata_csv`；真正 blocker 是 Codex MCP 該輪只有 snapshot/navigation/read tools，缺 click/type/select，無法互動展開欄位 dropdown 取得 DEV actual list。A-04 的 FAIL 則是目前 testcase 綁了 editor reopen/date-range restore，會再次踩到已知日期還原 bug，因此需要把 CSV 驗證切到報表清單列下載。
- A-03 runtime 修正：`capability-gate` 現在把 `metadata_dropdown_compare` 視為 supported/helper-assisted，不再 degraded。`helper-execution-plan` 對 A-03 產生 `collage.openProject -> collage.createReport -> collage.extractMetadataDropdownFields`，不跑 preview、不寫 result。`bi-ui-helper-executor` 新增 `collage.extractMetadataDropdownFields`：先用 visible UI 點 `+ 新增欄位`，再 read-only DOM extraction 擷取 actual picker items / `addFieldToSelection` code，讀 `input/reference-index.json` 或 `rules/BI_DATA/metadata.csv` 取得 expected list，輸出 `metadata-dropdown-evidence.json`，包含 actualVisibleItems、expectedFields、missingFields、extraFields、normalizationNotes。helper 仍不可判 PASS/FAIL。
- A-04 runtime 修正：`collage.downloadCsvAndComparePreview` 新增 list/project-page download path。若 params 或 testcase 指定 `downloadScope=report_list`，helper 會使用本輪 `saved-report.json` 的 reportName 鎖定 saved report row/list control 觸發 CSV download，並與儲存前 `preview-evidence.json` 比對；不重開 editor。helper plan 對明寫「不重開 editor」的 case 不再因文字含 `重開/還原` 產生 `collage.reopenReport`。
- OTTEST002 source 更新：實際測題來源 `BI_UAT_ROUNDS/onlinetest/OTTEST002/拼貼工具測試_測試案例_v1_0.xlsx`、`拼貼工具測試_測試執行說明_for_v1_0.md`、`Codex_指派文字_TOOL001_v1_0.md` 已同步。A-03/A-04 都新增 Helper hints；A-04 改為「preview -> 儲存 -> 回專案/報表清單 -> 從該報表列下載 CSV -> 本機 parser 比對儲存前 preview」，明確不重開 editor、不驗證 date-range restore。OTTEST002 package consistency 已達 `status=ok`、0 issue。這些 source package 檔仍位於 `uat-tool` git root 外，需重新上傳才會被下一輪 run 使用。
- Rules/docs 同步：更新 authoring rules、Layer 1 artifacts/results、helper protocol、BI helper guidance、evidence templates、task-runner prompt、README、refactor 規劃與工程 spec。最新規範：metadata helper evidence 可用但 Codex 仍判定；CSV 正式 evidence 是 UI 下載後本機 parser；清單頁下載要鎖定本輪 saved report row；Google Sheet 仍只作人工探索 fallback。
- 驗證：已跑 OTTEST002 package consistency check（status=ok, issueCount=0）、`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:capability-gate`、`npm run verify:helper-hints`、`npm run verify:helper-report-gate`、`npm run verify:package-consistency`、`npm run verify:final-aggregate-result`、`git diff --check`。另外用 OTTEST002 source 生成 plan 驗證：A-03 actions 為 `openProject/createReport/extractMetadataDropdownFields`；A-04 actions 為 `openProject/createReport/configureMetric/runPreview/saveReport/downloadCsvAndComparePreview`，不含 `reopenReport`，且 `downloadScope=report_list`。

### 2026-05-02 11:20 - OTTEST002_18 診斷：metadata group scope、helper evidence preflight replacement、支援檔 profile

- 背景：Tommy 檢查 OTTEST002_18 後指出 A-03 metadata 仍有異常，並提出是否應在取得題目與補充資料時先讀過/拆解選填支援資料。診斷 run `cbd05716-9d50-4b45-b457-838a6309b388` 後確認 metadata 檔並非沒讀：`reference-index` 已有 `bi_metadata_csv`，`rules/BI_DATA/metadata.csv` 存在，A-03 helper `collage.extractMetadataDropdownFields` 也成功產出 `metadata-dropdown-evidence.json`。
- A-03 根因：helper 擷取 dropdown 時抓到整個欄位 picker 的所有 `addFieldToSelection` item，包含 `DAILY_REPORT` 後面的 `LOGIN_PLATFORM_STATUS / ORDER_MANAGEMENT / REFUND_TRACKING`，導致 actual=69、expected=32 並產生大量 false extra。另有 label 清洗問題：部分 UI badge/code 進入 label，例如 `活躍人數(回訪使用者)RAU`、`iOS總營收 NUMERIC`，以及 metadata 與 UI 的已知命名差異未分 exact diff / normalized diff。
- A-03 修正：`collage.extractMetadataDropdownFields` 現在會偵測 picker group header，`每日報表` 對應 `DAILY_REPORT`，正式 comparison 只比較該 source group；若找不到 group 才 fallback 全部 item 並加 warning。欄位 label 會移除 type badge 與尾端 code，comparison 會套用已知 metadata/UI 命名 alias，並同時保留 `exactMissingFields/exactExtraFields` 與 normalized `missingFields/extraFields`，讓 PM 可分辨「命名差異」與「真差異」。
- A-04 判定層修正：OTTEST002_18 的 A-04 helper 已成功完成 `openProject/createReport/configureMetric/runPreviewAndCollectEvidence`，但 Codex 判定階段因自己沒有 browser/Playwright MCP 而標 `BLOCKED/TOOL_EXECUTION_UNAVAILABLE`。這是 prompt/gate 過度要求 Codex 自己做 browser preflight。現在 run brief、preflight guidance、rule index 與 Codex prompt 明確規定：若同一 run、同一 case 已有 successful Agent helper browser evidence 且涵蓋必要 UI/DOM/network 證據，Codex 應直接讀 helper evidence 判定，不可只因 Codex-side browser tool 不存在而標 TOOL_EXECUTION_UNAVAILABLE。
- 支援資料拆解：新增 `supporting-docs-manifest` 輕量 profile。每個上傳 md/txt/csv 會先記錄 fileName、extension、size；CSV 會記 header、rowCount、roleHints（例如 `metadata_candidate`）；md/txt 會記 headings/lineCount。這不是把所有支援檔全文塞進 prompt，而是在 run workspace 內提供可審計的暫存索引，讓 Codex/Agent 先用 profile 判斷該讀哪份檔。run workspace 仍依既有 retention 保留以便查證，不在測完立刻刪除。
- 修改檔案：`agent/src/bi-ui-helper-executor.ts`、`agent/src/task-runner.ts`、`agent/src/preflight-guidance.ts`、`agent/src/rule-index.ts`、`agent/src/supporting-docs-manifest.ts`、`agent/src/reference-index.ts`、`agent/src/bi-ui-helper-guidance.ts`、本 planning log、refactor 規劃與工程 spec。
- 驗證與部署：已跑 `npm run build --prefix agent`、`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build`、`npm run build --prefix web`、supporting-docs profile smoke、A-03 artifact revised comparison smoke、`npm run verify:helper-hints`、`npm run verify:capability-gate`、`npm run verify:helper-report-gate`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:package-consistency`、`npm run verify:case-advance-policy`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 通過。已推 `refactor/mac-agent-mvp` 與 deployment branch `codex/uat-tool-mvp`；Railway production `/version` 為 `bda22e7`、deployment `8c9d5fe4-c9ba-42d9-94ab-e5546b5fb4be`，`/health` healthy。本機 Mac Agent 已重啟至 launchd pid `71495`。

### 2026-05-02 19:10 - OTTEST002_19：A-04 清單頁 CSV 下載 row refresh、table preview evidence 與 response-body fallback

- 背景：Tommy 檢查 OTTEST002_19 後確認整輪已接近成功，A-03 metadata 已正確發現資料差異並做出合理判斷，剩下 A-04 CSV。診斷 run `366ce4e5-e0cb-41b7-8926-b99df2989958` 後確認 A-04 已完成 preview 與 save，`saved-report.json` 記錄 `TOOL_A04_202605020400`，但 save 後回到清單頁時 DOM/screenshot 仍停在 stale list，清單中沒有本輪新報表；舊 helper 未刷新/重定位 saved row，退去點全域下載文字，最後 `page.waitForEvent("download")` timeout。
- A-04 runtime 修正：`collage.downloadCsvAndComparePreview` 現在對 `downloadScope=report_list` 先用 `saved-report.json.reportName` 讀取本輪 saved row state；若清單 stale 會 reload 並重新點 project 定位，仍找不到時回傳 `workflowStatus=failed_precondition`、`failedSubcondition=saved_report_row_missing`、`csv_comparison_status=not_reached`，讓 Codex 依 testcase 判必要子條件。若 row 存在但沒有該列下載控制，回 `csv_button_missing_on_saved_report_row`，不再錯點其他報表或全域控制。
- CSV evidence 修正：row 下載控制改為支援 icon-only `⬇️`、`onclick=downloadReport(...)`、row-local button/a/role=button。下載成功時 `downloadedCsv.source=browser_download_event`；若 browser download event 未觸發但同一次 visible UI click 產生 CSV/attachment response，helper 會保存該 UI-triggered response body，標 `downloadedCsv.source=ui_triggered_network_response_body`，仍不直接打 BI API。
- Preview 比對修正：`collage.runPreviewAndCollectEvidence` 新增 preview table extraction，會記錄 header、data rows、sample/tail rows 與 numeric summaries。`summarizeCsvAgainstPreview` 現在可用 table evidence 比對 CSV row count、header 與逐列 cell（含日期格式與數字正規化），不再只依賴 Chart.js；拼貼模式表格 case 可真正做 pre-save preview vs CSV comparison。
- Rules/docs 同步：更新 task-runner prompt、helper execution plan、BI helper guidance、evidence templates、current-case-pack、rule-index、Layer 1 helper/artifact rules、authoring rules、README、refactor 規劃與工程 spec。最新規範：清單頁 CSV 必須鎖定本輪 saved row 並可刷新/重定位；正式 evidence 可為 browser download 或同次 UI click 的 CSV response body；CSV 比對目標是 pre-save preview table/chart evidence。
- 修改檔案：`agent/src/bi-ui-helper-executor.ts`、`agent/src/task-runner.ts`、`agent/src/bi-ui-helper-guidance.ts`、`agent/src/helper-execution-plan.ts`、`agent/src/evidence-templates.ts`、`agent/src/current-case-pack.ts`、`agent/src/rule-index.ts`、`agent-skills/uat-tool/rules/artifacts-and-results.md`、`agent-skills/uat-tool/rules/helper-protocol.md`、`docs/authoring/UAT_三文件撰寫規則.md`、`README.md`、refactor docs、本 planning log。
- 驗證與部署：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-hints`、`npm run verify:capability-gate`、`npm run verify:helper-report-gate`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:package-consistency`、`npm run verify:case-advance-policy`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、OTTEST002 source package consistency check（status=ok, issueCount=0）、`git diff --check` 通過。runtime commit `ed50a1b` 已推 `refactor/mac-agent-mvp` 與 deployment branch `codex/uat-tool-mvp`；Railway production `/version` 為 `ed50a1b`、deployment `c7f320e7-0e40-48e9-8960-edd70f85e609`，`/health` healthy。本機 Mac Agent 已重啟至 launchd pid `93284`。

### 2026-05-03 01:45 - Background-safe Browser Session Lease：禁止 helper 搶前景與 A-01/A-02 欄位 loading wait

- 背景：Tommy 觀察 OTTEST002_21 / 後續 run 時，Mac Agent helper 會反覆把 dedicated Chrome 拉回前景，導致 Safari/其他工作被打斷；同時 A-01/A-02 helper 在 BI editor 還顯示 `載入欄位中...` 時，`collage.configureMetric` 約 200ms 就判 `ADD_FIELD_BUTTON_NOT_CLICKABLE`，讓正常 loading 被誤標成 testcase `BLOCKED`。回查 4/29 的歷史決策可知，`/json/activate` / `page.bringToFront()` 當初是為了解決「Tommy 肉眼看到的 tab 與 Playwright 實際受控 tab 不一致」，不是 Playwright 操作 DOM 的必要條件。
- Browser identity 修正：新增 `uat-browser-session-v1` lease，Agent 每個 run/case 會寫 `input/browser-session.json`，包含 `runId`、`caseNo`、`generation`、`sessionId`、CDP `targetId`、random `token` / `tokenHash`、`windowName`、`endpoint` 與 `devUrl`。Agent 在 dedicated tab 寫入 `window.name = uat-tool:<runId>:<caseNo>:<generation>:<token>` 與 `sessionStorage.__uatToolBrowserSession`。Helper 只用 marker/token resolve 目標 page；禁止 fallback 到第一個 Galaxy tab、active tab、OS foreground window 或 URL-only match。找不到或不一致時回 `BROWSER_SESSION_LEASE_MISSING`、`BROWSER_SESSION_TARGET_MISSING`、`BROWSER_SESSION_TOKEN_MISMATCH`、`BROWSER_SESSION_STALE` 或 `BROWSER_SESSION_URL_MISMATCH`。
- No-foreground policy：正式 helper/Codex run path 移除 `page.bringToFront()`、CDP `/json/activate` 與 MCP tool call 後的 `scheduleBrowserActivation()`。`ensureSingleUserPageTab()` 只負責關閉 dedicated profile 裡的多餘 user tabs，不再 activate。run/case 一開始建立 dedicated Chrome window/tab 仍允許；後續人工介入改由 Tool Bridge/log 事件提示，不用搶前景。VM Runner 與 Telegram/WhatsApp/其他通知列為 M2 後續評估，不併入本次 P0。
- A-01/A-02 loading 修正：`collage.configureMetric` 在選欄位前新增 `waitForMetricFieldControls()`，必須等 `載入欄位中...` 清除或 `+ 新增欄位`/等價欄位控制項可見後才點擊。若 loading 持續到 timeout，blocked reason 為 `FIELD_LIST_LOAD_TIMEOUT`；只有 loading 結束後仍無控制項才回 `ADD_FIELD_BUTTON_NOT_CLICKABLE`。
- Evidence / rules 同步：helper report 會補 `browserSession`、`targetBinding`、`foregroundPolicy.mode=no-activate`；task-runner prompt、Layer 1 helper protocol、BI helper guidance、README、refactor 規劃與工程 spec、M1 runbook/M1 spec addendum 都同步寫入 background-safe lease、no-foreground helper policy、field-list loading wait 與 VM 後續評估。
- 修改檔案：`agent/src/browser-session.ts`、`agent/src/bi-ui-helper-executor.ts`、`agent/src/task-runner.ts`、`agent/src/bi-ui-helper-guidance.ts`、`agent-skills/uat-tool/rules/helper-protocol.md`、`README.md`、`docs/refactor/規劃說明.md`、`docs/refactor/工程spac.md`、`docs/refactor/M1_Mac_Agent_MVP_Runbook.md`、`docs/refactor/UAT_Tool_M1_完整實作Spec_v1.md`、本 planning log。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-report-gate`、`npm run verify:helper-hints`、`npm run verify:capability-gate`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:final-aggregate-result`、`npm run verify:case-advance-policy`、`npm run verify:tool-bridge`、`npm run verify:package-consistency`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 通過；另以 `rg` 確認正式 runtime call path 沒有 `page.bringToFront()`、`/json/activate`、`activateBestExistingTab`、`scheduleBrowserActivation`，僅保留 guidance 文字提醒「不可使用」。

### 2026-05-03 02:55 - Session handoff：續接 OTTEST002 P0 compact 後下一輪工作

- 背景：Codex thread `019de548-1d41-77d2-9cd1-2cf6428a2383`（聊天室名稱「續接 OTTEST002 P0」）在討論下一輪小修與版本制度時再次遇到 remote compact stream disconnect。該 session 約 19MB / 7392 行，最後每輪 input 約 240k tokens，接近 258,400 context window；完整 JSONL 不應作為下一輪起點。
- 本次文件交接：新增 `docs/planning/session-handoff-2026-05-03-ottest002-next.md`，整理 `16f938c` production 之後的狀態、OTTEST002_23 觀察、下一輪已同意要做的調整與新聊天開場詞。下一個 Codex session 應讀該 handoff、本 planning log 與 `uat-tool/AGENTS.md`，不要讀 raw session JSONL。
- OTTEST002_23 結論：5 題跑完、單題 result xlsx ingest、final aggregate xlsx 產生、120 個 evidence artifacts 全部上傳，background-safe lease 生效，A-04 CSV list download/preview comparison 已通。正式放大到 40-50 題前，仍建議補 A-03 metadata helper wait、BLOCKED detail_json health、reopen settle/network evidence、Codex warning 降噪、完整紀錄 MD 下載與手機 RWD overflow。
- 版本制度待辦：目前 root package 與 Railway `/version` 仍是 `1.0.0`，Agent package 與 WebSocket header/payload 仍是 `0.1.0`。下一輪 runtime/UI 變更應建立版本紀律，先評估 root `1.1.0`、Agent `0.2.0`，並讓 Agent version 不再硬寫在 `agent/src/connection.ts`。
- 本次交接不含 runtime 行為變更；production 仍是 `16f938c`，`codex/uat-tool-mvp` 不需因本文件-only 交接重新部署。

### 2026-05-03 03:10 - OTTEST002 P0 收斂：版本紀律、A-03 wait、BLOCKED health、reopen evidence、完整紀錄 MD、手機 RWD

- 背景：前一個 `續接 OTTEST002 P0` session 在開始實作前 compact 失敗。依 handoff 接續處理 40-50 case 正式批次前的 P0 工程缺口，不讀 raw JSONL。
- 版本紀律：root app 從 `1.0.0` 升到 `1.1.0`，Mac Agent 從 `0.1.0` 升到 `0.2.0`。`agent/src/connection.ts` 新增 `AGENT_VERSION`，從 `agent/package.json` 讀取並同步用於 WebSocket `X-Agent-Version` 與 `agent.online.payload.agent_version`，不再 hard-code。
- A-03 metadata helper wait：`collage.extractMetadataDropdownFields` 在展開欄位 picker 前改用與 `collage.configureMetric` 相同的 `waitForMetricFieldControls()`。若 BI editor 持續顯示 `載入欄位中...`，helper blocker 會是 `FIELD_LIST_LOAD_TIMEOUT`，不會過早報 `ADD_FIELD_BUTTON_NOT_CLICKABLE`。
- BLOCKED detail_json health：result evidence gate、Agent result contract、BI result adapter 與 generated prompt/模板契約同步加嚴。`BLOCKED` 現在必須包含 `測試目的`、`設定條件`、`預期行為`、`實際行為`、`blocked_reason` 與 current-run evidence；`/detail-health` 也會對 BLOCKED 檢查 core fields + `blocked_reason`。
- reopenReport evidence：`collage.reopenReport` 重開報表後會等待 editor loader/network settle，保存 `reopen-report-evidence.json`，內容包含 expected field/date/display、settle 狀態、前後 state delta、DOM state、UI profile 與 report/detail network requests/responses。此修正不恢復 `bringToFront` 或 CDP activate。
- 完整紀錄 MD：新增 `POST /api/runs/:id/export-archive-md`，與既有 concise `export-md` 分開。Web UI 現在有三個主要下載：`下載結果 XLSX`、`下載報告 MD`、`下載完整紀錄 MD`；完整 archive 包含 run metadata、case state、result counts、timing summary、artifact stats/list、timeline、logs、events。
- 手機 RWD：補 `min-width:0`、long text wrapping、card header action wrapping、case row mobile layout、detail_json wrapping、artifact/log row stacking、file name/agent/dev-url overflow 防護。Playwright 以 desktop `1440x1000` 與 mobile `390x844` 檢查 `documentElement.scrollWidth === clientWidth`，未發現水平 overflow。
- 修改檔案：`package.json`、`package-lock.json`、`agent/package.json`、`agent/src/connection.ts`、`agent/src/bi-ui-helper-executor.ts`、`agent/src/result-contract.ts`、`agent/src/task-runner.ts`、`src/result-parser/result-evidence-gate.ts`、`src/runs.ts`、`domain-packs/BI/result_parser_adapter.json`、`scripts/verify-result-evidence-gate.ts`、`scripts/verify-agent-result-contract.ts`、`web/src/App.tsx`、`web/src/App.css`、`README.md`、`docs/refactor/規劃說明.md`、`docs/refactor/工程spac.md`、`docs/refactor/UAT_Tool_M1_完整實作Spec_v1.md`、`docs/refactor/UAT_Tool_Spec_v1_2_1.md`、本 planning log。
- 驗證：`npm run typecheck`、`npm run typecheck --prefix agent`、`npm run build`、`npm run build --prefix agent`、`npm run build --prefix web`、`npm run verify:helper-report-gate`、`npm run verify:capability-gate`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:helper-hints`、`npm run verify:tool-bridge`、`npm run verify:case-advance-policy`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 皆已通過；另以本機 Vite + API 做 Playwright desktop/mobile overflow 檢查。部署、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-03 04:55 - OTTEST002_25 follow-up：CSV false mismatch 與 A-05 helper continuation

- 背景：Tommy 回報 run archive `f7ab18ce-9feb-4e29-82c8-e12714d12a5a` 中 A-04 CSV 顯示 failed 不合理，且 A-05 被標 `BLOCKED/EVIDENCE_INSUFFICIENT` 不合理，預期應像 A-01 一樣能完成重開還原驗證並判 FAIL。依既有紀律，本次只讀完整紀錄 MD 與當輪 helper artifacts，不讀舊 raw session JSONL。
- A-04 根因：`collage.downloadCsvAndComparePreview` 的 comparison artifact 顯示 CSV 有 31 筆資料列，preview table 也有 31 筆真資料列，但 preview extractor 將 table header `["Date","MAU(帳號)"]` 同時放進 `table.header` 與 `table.rows[0]`。舊 comparator 把 duplicated preview header row 當成資料列，且未把 CSV header `日期` 與 preview header `Date` 視為同一個日期欄，造成 `CSV_PREVIEW_COMPARISON_MISMATCH` false fail。
- A-04 修正：新增 `agent/src/csv-preview-comparison.ts`，集中 CSV parser 與 preview comparison；table comparison 會移除 duplicated header row，header comparison 會正規化 `Date`/`日期`，cell comparison 保留日期與數字正規化。`bi-ui-helper-executor` 改用同一個 helper，`verify-helper-report-gate` 新增 A-04 回歸 fixture，鎖住 31 筆資料列不應因 duplicated header 與日期欄名語言差異誤判。
- A-05 根因：helper execution plan 已包含 H5 `collage.saveReport` 與 H6 `collage.reopenReport`，且 H5 標示 `requiresToolBridge=true`；safe helper pre-run 完成 H1-H4 後，Codex 沒有送出 Tool Bridge request，也沒有讓 Agent auto-approval 接手執行 pending H5/H6，最後直接以 evidence insufficient 標 BLOCKED。這是 UAT tool 控制流程 bug，不是 BI 行為本身。
- A-05 修正：`helper-pre-runner` 新增 `collectPendingHelperToolBridgeRequests()`，會依 current helper plan 與已完成 helper reports 找出第一個 pending required Tool Bridge action。`task-runner` 在 safe helper pre-run 後若 `auto_approve_tool_requests=true`，會產生 Agent-owned auto approval record，送出 `run.tool_request` / `tool_response.delivered` 事件，接著直接跑 `runHelperContinuationAfterApprovals()`，把 H5/H6 evidence 寫入 `output/helper-continuation-summary.json`，並在 Codex prompt/run brief 明確要求判定前讀取該 current-run evidence。
- 版本與文件：root app 升到 `1.1.1`，Mac Agent 升到 `0.2.1`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步補上 CSV header/date normalization 與 helper-plan pending Tool Bridge auto continuation。
- 驗證：本次新增的 `verify:helper-report-gate` fixture 覆蓋 A-04 false mismatch 與 A-05 pending helper Tool Bridge detection。完整 typecheck/build/verify、commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-04 00:20 - OTTEST002_26 follow-up：A-05 既有報表欄位 exact reconciliation

- 背景：Tommy 檢查 run archive `f9104c1e-e7d9-4da9-bb59-98248f012073` 後，A-04/A-05 流程已正常；但回看 A-05 helper evidence 發現覆寫 save body 出現 `NEW_ACCOUNTS` 重複，reopen DOM 也顯示兩個「新增帳號數」加一個「總營收(TWD)」。此問題不影響該輪「日期重開還原失敗」的 FAIL 判定，但會污染 A-05 對「修改欄位後覆寫」的欄位 evidence。
- 根因：`collage.configureMetric` 的 `selectedFieldText()` 只讀 `#fieldSelectionContainer`，而目前 BI editor 該 selector 回 null；helper 因此看不到既有報表原本已有「新增帳號數」，在 A-05 開既有報表後又追加了一次「新增帳號數」與「總營收(TWD)」。
- 修正：`bi-ui-helper-executor` 新增 selected-field DOM fallback，透過 read-only DOM 讀取可見 `removeFieldFromSelection(...)` / `btn-remove-field` 按鈕，取得已選欄位 label/code；`configureMetric` 改為 `reconcileMetricFieldsThroughUi()`，先用真實 UI 點「×」移除多餘或重複欄位，再用正常 `+ 新增欄位` picker 補缺少欄位。`readStateDelta.checks.field` 也改為 selected field exact match，不再只用 body text contains 判定欄位對齊。
- 版本與文件：Mac Agent 升到 `0.2.2`，root app 維持 `1.1.1`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 Agent version 與 existing-report field exact reconciliation。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:helper-report-gate`、`npm run verify:capability-gate`。完整 verify、commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-04 01:58 - OTTEST002_27 follow-up：PASS 與 helper false check 矛盾擋上傳

- 背景：Tommy 提供 run archive `e92f4869-cbd8-4d48-b3f1-f5b7d0f83ea5` 後，確認 A-05 欄位重複已修正：`collage.configureMetric` 的 selected fields 與 save POST body 都只包含 `新增帳號數 / NEW_ACCOUNTS`、`總營收(TWD) / TOTAL_REVENUE`，沒有重複 `NEW_ACCOUNTS`。但 workbook 仍把 A-05 寫成 `PASS`，與 helper evidence 不一致。
- A-05 新觀察：`collage.reopenReport-latest.json` 的 `reopenReportEvidence.stateDelta.after.checks.dateRange=false`，reopen 後 DOM 顯示 `過去7天`，預期仍是 `2026/03/01~2026/03/31`。因此 A-05 應與 A-01 同類，至少不能 PASS；這是 Codex result 判定與 helper evidence 矛盾，不是 field reconciliation 還沒生效。
- 根因：Agent self-check 過去只驗 result workbook schema、detail_json core fields 與 evidence presence；沒有讀同一 run helper report 的 semantic state checks。因此 Codex 即使在 `detail_json` 宣稱「時間區間維持」，只要 JSON 欄位完整，仍可上傳成 PASS。
- 修正：`agent/src/result-contract.ts` 新增 `ResultContractOptions.runDir`，PASS row 會讀取 `output/helper-artifacts/<case>/collage.configureMetric-latest.json` 與 `collage.reopenReport-latest.json`。若 helper 的 `stateDelta.after.checks` 任一 expected state 為 false，self-check 產生 `RESULT_PASS_CONTRADICTS_HELPER_EVIDENCE` error 並阻止 upload/ingest。`task-runner` 上傳前改用 `{ runDir }` 呼叫 self-check。
- Fixture：`verify-agent-result-contract` 新增 PASS workbook + A-05 reopen helper `dateRange=false` fixture，確認 `PASS result contradicting helper false checks is rejected before upload`。
- 實際 run 回驗：用同一版 self-check 檢查 `e92f4869-cbd8-4d48-b3f1-f5b7d0f83ea5/output/result.xlsx`，結果為 `status=error`，issue code `RESULT_PASS_CONTRADICTS_HELPER_EVIDENCE`，falseChecks=`dateRange`，helperReport=`output/helper-artifacts/TOOL-A-05/collage.reopenReport-latest.json`。
- 版本與文件：Mac Agent 升到 `0.2.3`，root app 維持 `1.1.1`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 Agent version 與 PASS-vs-helper-false-check gate。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:helper-report-gate`、`npm run verify:capability-gate`、`npm run verify:helper-hints`、`npm run verify:package-consistency`、`npm run verify:final-aggregate-result`、`npm run verify:case-advance-policy`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 通過。commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-05 03:10 - OTTEST004 pre-run P0：partial aggregate、Tool Bridge evidence 與 preview-only helper guard

- 背景：OTTEST004 v1.2 準備大測前，Tommy 指出上一輪 44 題在剩 8 題時中斷，下載 xlsx 曾容易落到單題 raw result，且新版 testcase 有 D0/preview-only 與 PM skip 類 case，工具側需先避免 helper 誤跑 save/reopen 或把 `不影響` 當 UI 目標。
- Result download 修正：`GET /api/runs/:id/output/result-xlsx` 現在每次先從 normalized server state 產生 aggregate。全部 case terminal 時輸出 `aggregate_mode=final`；run failed/cancelled/interrupted 但已有 completed case rows 時輸出 `aggregate_mode=partial`，保留 PENDING/MANUAL_PENDING row。只有沒有任何 normalized case result 時才 fallback 到 raw `result.xlsx`。
- Evidence gate 修正：`TOOL_BRIDGE_RESPONSE_MISSING` 不再只看 Codex detail_json 內文。若同一 run 的 `tool_response.sent` / `tool_response.delivered` event 可依 request_id/case 對到該 case，即視為 current-run Tool Bridge response evidence，避免 Agent auto-approval 已發生但 Codex 沒手抄 response id 時被誤擋。
- Helper plan 修正：`helperHints.params.scope=preview_only`、`skipSave/doNotSave/noSave`、`skipReopen/doNotReopen/noReopen` 會壓掉 `collage.saveReport` / `collage.reopenReport`，即使 operationTemplate 名稱是 `collage_build_preview_save_reopen` 或步驟文字含儲存/重開。`不影響`、`不限`、`N/A`、`0組` 等 neutral cleanup target 不再進入 date picker / display / field target；`setDatePreset` 對 neutral preset 直接 skip，不再回 `DATE_RANGE_PRESET_NOT_FOUND`。
- PM skip 分類：summary 與 MD export 新增 classified count，將 detail_json 含 `skip_reason` / `本輪不執行` / PM 主動跳過的 `BLOCKED` 顯示為 `PM_SKIPPED`，避免與 runtime BLOCKED 混在一起；xlsx 原始 status 仍保留 `BLOCKED` 以符合既有欄位規則。
- 版本與文件：root app 升到 `1.1.2`，Mac Agent 升到 `0.2.4`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 final/partial aggregate、Tool Bridge run-event evidence gate、preview-only helper skip guard 與 Agent version。
- 驗證與部署：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-hints`、`npm run verify:helper-report-gate`、`npm run verify:package-consistency`、`npm run verify:agent-result-contract`、`npm run verify:case-advance-policy`、`npm run verify:result-evidence-gate`、`npm run verify:final-aggregate-result`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 通過。commit `932c266` 已推 `refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp`；Railway production `/version` 為 App `1.1.2` / commit `932c266` / deployment `861440d8-e4ed-44d3-a160-bc773b8a47b1`，`/health` healthy。本機 `com.tommy.uat-agent` 已重啟至 pid `51556`，Agent package version `0.2.4`。

### 2026-05-05 04:05 - OTTEST004 gate follow-up：inline 狀態清理解析誤判修正

- 背景：Tommy 啟動 OTTEST004 run `78d45a05-1f81-46f2-bb01-22358f80e389` 後，第一題 A-01 在 Step 0 被 Tool Bridge `ambiguity_decision` 擋下，原因為 `input/test-package-consistency.json status=error`，其中 44 題都被標 `CLEANUP_CHECKLIST_CONFLICT`。
- 根因：`agent/src/test-package-consistency.ts` 的 `extractCleanupValue()` 只正確處理 fenced block，遇到 testcase.md 的 inline 格式 `**狀態清理**:\`欄位=...\`` 時會先吃掉該行，再往下抓第一個含 `欄位=` 的步驟或驗證文字，導致 instruction cleanup 被誤判成步驟清單，與 xlsx row 衝突。這是 tool-side parser false positive，不是 OTTEST004 testcase package 真衝突。
- 修正：`extractCleanupValue()` 先讀 `extractLabeledValue(section, "狀態清理")`，若 inline value 含 `欄位=` 即直接使用，不再落到後續步驟掃描。`scripts/verify-package-consistency-fixture.ts` 新增 inline cleanup fixture，並在後續步驟刻意放入 `欄位=新增帳號數`，鎖住「不可抓到後面步驟文字」的回歸。
- 實際 run 回驗：用同一份 OTTEST004 run input 重算 consistency，修正後 `status=warning`、`errors=0`、`CLEANUP_CHECKLIST_CONFLICT=0`；剩餘 warning 為 `D-1` 文字引用與 Helper param visibility，不阻擋 browser execution。
- 版本與文件：Mac Agent 升到 `0.2.5`，root app 維持 `1.1.2`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 Agent version 與 inline cleanup consistency parser guard。
- 驗證：已跑 OTTEST004 實際 input consistency check（修正後 `status=warning`、`errors=0`、`CLEANUP_CHECKLIST_CONFLICT=0`）、`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:package-consistency`、`npm run verify:helper-hints`、`npm run verify:capability-gate`、`npm run verify:case-advance-policy`、`npm run verify:result-evidence-gate`、`npm run verify:agent-resume`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:helper-report-gate`、`npm run verify:tool-bridge`、`npm run verify:agent-roundtrip`、`git diff --check` 通過。commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-05 09:14 - OTTEST004_003 follow-up：helper openProject 未選專案造成大量 BLOCKED

- 背景：Tommy 提供 run `12610479-3517-4ad7-a6a1-740ffbcae377` 的 report/result 後，結果顯示 44 題中 29 題 BLOCKED、14 題 PENDING、1 題 FAIL；多數 BLOCKED 都卡在 `collage.createReport` 找不到 `+ 新增報表`。
- 根因：`collage.openProject` 在 helper hints/testcase 未提供 `projectName` 時，只停在 BI 首頁並直接回 `status=ok`。實際 DOM/screenshot 顯示左側已有「拼貼test_001 / UAT_G01測試專案」，但右側仍是「請從左側選擇專案查看報表」。後續 `createReport` 在未選專案狀態下自然找不到 `+ 新增報表`，造成整輪 helper-assisted case 連鎖 BLOCKED。
- 修正：`bi-ui-helper-executor` 新增 `inferVisibleCollageProjectName()`，可從左側「拼貼模式」區段推斷第一個可見專案；`openProject` 會在沒有 explicit `projectName` 時自動點選該專案，且必須驗證後續可見「新增報表」入口才回 `ok`，否則回 blocked。`createReport` 也會先確保專案已選取，並支援 `+ 新增報表` / `新增報表` / role/button fallback，不再只用單一文字 locator。
- 延伸修正：`openExistingReport`、`reopenReport` 與清單頁 CSV row recovery 在缺少 explicit `projectName` 時也可走同一個專案選取流程，避免儲存/重開/清單下載 case 被同一前置狀態卡死。
- Fixture：`verify-helper-report-gate` 新增左側拼貼專案文字 fixture，確認未指定 `projectName` 時會推斷 `拼貼test_001`，指定 `projectName` 時仍以 explicit 值為準。
- 版本與文件：Mac Agent 升到 `0.2.6`，root app 維持 `1.1.2`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 Agent version 與 helper project auto-selection guard。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-report-gate`、`npm run verify:helper-hints`、`npm run verify:capability-gate`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate`、`npm run verify:case-advance-policy`、`npm run verify:agent-resume`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:tool-bridge`、`npm run verify:agent-roundtrip`、`git diff --check` 通過。commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-05 11:15 - Session handoff：OTTEST004_004 大量 BLOCKED 分析中 compact

- 背景：第二個名為 `續接 OTTEST002 P0` 的 Codex thread `019dea11-3757-7b72-afe2-e7e34363c2b0` 在分析 OTTEST004 run `8c87e614-5166-4f22-a9f4-675dc07f3e30` 時再次 compact stream disconnect。該 JSONL 約 21MB / 5314 行，最後兩輪 input 約 `209k`、`232k` tokens，接近 `258,400` context window。新增 handoff `docs/planning/session-handoff-2026-05-05-ottest004-blocked-next.md`，下一輪應讀 handoff 與本 planning log，不讀 raw JSONL。
- 當前狀態：production 仍是 app `1.1.2` / commit `039568c` / deployment `8289819f-d10c-4df7-923f-d992be311b79`，`/health` healthy；Mac Agent package `0.2.6`，本機 LaunchAgent `com.tommy.uat-agent` pid `74201` running。本次僅文件交接，沒有 runtime change。
- OTTEST004_004 觀察：result xlsx 44 rows，`PENDING=25`、`BLOCKED=13`、`PASS=5`、`FAIL=1`。A-02/A-03/B-01/B-09/D-01 已 PASS，代表前一版 helper project auto-selection 有改善，能進專案/editor 並跑部分 preview；這輪不能直接拿來判 BI 產品結果，主要是工具側還有缺口。
- 初步 root cause：日期快捷 preset 比對過硬，UI 已顯示 `昨日/上週/上月/過去30天`，helper 卻精準找 `昨日(快捷)`、`上週(快捷)`、`上月(快捷)`、`過去30天(快捷)`、`昨日(快捷起點)`，導致 `DATE_RANGE_PRESET_NOT_FOUND`。固定靜態日期 `2026/03/01~2026/03/31` 已可跑通（B-09 PASS），但自訂動態、半動態、90/91 天邊界仍屬 helper capability gap 或需改成 AI/manual-required。
- 其他待修：metadata dropdown source scope/expected 解析仍不穩，A-01/A-04/B-02 出現 expected empty，A-05 把 `雙平台營收佔比` 對到 all-items fallback，actual 80 vs expected 2；D-02 的 `helperHints.params.selectAllFields=true` 被誤解析成要點擊文字 `4 來源報表全選 72 欄`，應改走全選欄位流程。
- 下一輪建議順序：先修 date preset normalization，降低 B 群快捷日期 false BLOCKED；接著處理 dynamic/half-dynamic date support 或 plan 分流；再修 metadata source scope；最後修 D-02 selectAllFields。每項 runtime/helper change 都需同步 README、refactor docs、本 planning log，並跑 typecheck/build/verify、部署、重啟 Agent。

### 2026-05-05 11:35 - OTTEST004_004 recovery：manual_ai gate、日期快捷正規化、selectAllFields params

- 背景：新開的 `重新評估 OTTEST004 跑測結果` thread `019df622-9940-7a73-992f-c64c8a7d98b8` 只 411 行 / 1.4MB，但因連續讀取 run/report/log 與大型 diff，最後 input 仍升到約 `244k` tokens 並在 remote compact stream 斷線。該 thread 掛掉前留下未 commit runtime diff，本次接手補完並驗證。
- 根因補充：除了 handoff 已列的日期 preset 與 D-02 selectAllFields，真正更上層的問題是 `automationLevel=manual_ai` / `operationTemplate=manual_ai` 沒被 capability gate 與 helper plan 尊重，導致 B-03/B-04 這類本來要 Codex visible UI 判斷的 case 也被 helper pre-run，進而因 `昨日(快捷)` 這類 testcase 設計文字 false BLOCKED。另 `helperHints.params.selectAllFields/sourceReports/expectedFieldCount/dateRange object/doNotDownloadCsv` 沒完整傳進 helper action params，造成 D-02 synthetic cleanup text `4 來源報表全選 72 欄` 被當成真實欄位點擊。
- 修正：`capability-gate` 對 `manual_ai` 改為 `supportStatus=degraded`、`executionMode=codex_visible_ui`、`helperPreRunAllowed=false`；`helper-execution-plan` 對 manual_ai 不再產生 helper actions，並保留 `selectAllFields`、`sourceReports`、`expectedFieldCount`、`dateVariants`、dateRange object、`skipSave/skipReopen/skipDownload` 等 helper params。`setDatePreset()` 會把 `昨日(快捷)`、`上週(快捷)`、`上月(快捷)`、`過去30天(快捷)`、`昨日(快捷起點)` 正規化成 UI 可見 label 後再點擊。`collage.configureMetric` 新增 select-all fields 分支，優先從 metadata 依 `sourceReports` 解析預期欄位並透過真實 UI 逐欄選取，不再點擊 `4 來源報表全選 72 欄`。
- Fixture：`verify:capability-gate` 新增 `manual_ai cases disable helper pre-run and build no helper actions` 與 `selectAllFields helper hints preserve sourceReports/expected count and avoid synthetic field text`。
- 版本與文件：Mac Agent 升到 `0.2.7`，root app 維持 `1.1.2`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 Agent version、manual_ai helper pre-run guard 與 select-all fields params guard。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run typecheck`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-hints`、`npm run verify:helper-report-gate`、`npm run verify:capability-gate`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:case-advance-policy`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 通過。commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-05 12:01 - OTTEST004_004 follow-up：metadata source scope 與動態日期分流硬化

- 背景：完成 `9c42683` 排查後，仍需處理下一輪會遇到的殘留項目：A-01/A-04/A-05/B-02 metadata helper 不能再因 top-level helper params 未傳入、expected empty 或 source group 缺失而 false BLOCKED；B 群 multi-variant / dynamic / half-dynamic 日期 case 不能再被單一 `collage.configureMetric` helper pre-run 誤跑。
- 修正：`helper-hints` 會把 metadata compare 所需的 top-level `referenceCsv/referenceSourceName/referenceIndexKey/matchKey/compareFields/expectedReportSources/expectedTotalFieldCount` 合併進 helper params，讓 run packet 與 helper plan 都保留對照依據。`collage.extractMetadataDropdownFields` 新增 source-list 模式與 all-sources 模式：A-01 類 case 比對 distinct source groups；B-02 類 case 依 expected sources scope 欄位；A-05 類指定 source group 若 UI 沒有該 group，不再使用 all-items fallback，而是記錄 `missingSourceReports` 或用 expected field name fallback 產出可判定的 missing/extra evidence。
- 日期分流：`capability-gate` 與 `helper-execution-plan` 會把 multi-variant、動態 offset、半動態、90/91 天邊界與連續切換日期 case 降級為 `codex_visible_ui`，並禁止 helper pre-run。這保護 B-03~B-12 類 case 不會被 helper 先行 false BLOCKED；若未來要全自動化，需要另做真正的 dynamic date UI helper。
- Fixture：`verify:helper-hints` 新增 metadata top-level params merge 檢查；`verify:capability-gate` 新增 multi-variant date helper hints must degrade to Codex visible UI。另用 OTTEST004 `8c87...` input 抽樣確認 A-01/A-04/A-05/B-02/D-02 params 與 B-03 gate/plan 會按新版邏輯生成。
- 版本與文件：Mac Agent 升到 `0.2.8`，root app 維持 `1.1.2`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 metadata expected-source fallback、multi-variant date visible-UI routing guard 與 Agent version。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run typecheck`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-hints`、`npm run verify:capability-gate`、`npm run verify:helper-report-gate`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:case-advance-policy`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`git diff --check` 通過；另用 OTTEST004 `8c87...` input 抽樣確認 metadata params、D-02 select-all params 與 B-03 gate/plan。commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-05 12:24 - OTTEST004 testcase authoring contract：日期、metadata scope、selectAllFields 結構化

- 背景：OTTEST004 false BLOCKED 除了工具側 helper/gate 缺口，也暴露 testcase 撰寫會把 UI label、測試意圖與 helper params 混在自然語言中。工具已在 `b7ee326` 加強容錯，但後續測試包應從 authoring 規範層避免同類問題。
- 決策：正式更新 `docs/authoring/UAT_三文件撰寫規則.md`，要求日期 UI label 不得混入 `(快捷)`、`(快捷起點)`、`(半動態)` 等註解；動態/半動態/多變體日期用 structured params，且標 `automationLevel=manual_ai` / `operationTemplate=manual_ai`。metadata case 必填 `comparisonScope`、`expectedReportSources`、`matchKey`、`compareFields` 與 expected count；欄位全選 case 改用 `selectAllFields/sourceReports/expectedFieldCount`，不可把「4 來源報表全選 72 欄」當可點擊文字。
- 交接文件：新增 `docs/planning/ottest004-testcase-authoring-adjustment-request.md`，可直接交給 Claude 調整 OTTEST004 testcase / companion md / authoring spec。
- 驗證：本次為 docs-only authoring contract 更新，已跑 `git diff --check`；不需重跑 TypeScript/build，也不需 Railway redeploy 或 Mac Agent 重啟。

### 2026-05-05 14:29 - OTTEST004_claude_v1_3 run follow-up：source scope、D-02 選欄辨識、Codex MCP preflight

- 背景：Claude 依 authoring contract 產出 OTTEST004 v1.3 後，production run `2ae665fc-e021-4fc6-bf89-ca7d068ff0ba` 仍出現 `PASS=1`、`FAIL=2`、`BLOCKED=16`、`PENDING=25` 並被取消。這輪不讀 raw session JSONL，只讀 report/archive/xlsx 與 run 產物摘要；結論是 0.2.8 尚未真正修完，主要 false BLOCKED 仍在工具側。
- 根因：第一層是 Codex visible UI case 沒有先嘗試 Playwright MCP `browser_tabs`，直接把可用 browser tool 誤判為 `TOOL_EXECUTION_UNAVAILABLE`。第二層是 metadata helper params 在 `helper-execution-plan` 到 `bi-ui-helper-executor` 之間仍被稀釋：source-specific `expectedFieldCount` 被當成 all-source total count，導致 A-04/A-05 類 case 又落回 4 來源/全欄位對照。第三層是 D-02 selected-field 讀取太粗，已選欄位的 remove button code（例如 `MAX_CCU`）與鄰近 label 沒正規化對齊，可能把已選欄位誤判為缺失或合併到 unrelated label。
- 修正：`helper-execution-plan` 現在保留並傳遞 `comparisonScope/referenceSourcePath/expectedReportSources/expectedReportSourceCount/expectedFieldCount/expectedTotalFieldCount/sourceReports/sourceReport/compareFields`，且 select-all + 多來源時不再從自然語言推導 synthetic `source`。`collage.extractMetadataDropdownFields` 明確分離 source-specific `expectedFieldCount` 與 all-source `expectedTotalFieldCount`，並加 mismatch warning；`collage.configureMetric` 的 selected-field matcher 會正規化 `_/-` 與 code-vs-label，並用 remove button 附近可見文字辨識欄位。`task-runner` 與 preflight guidance 要求 Codex visible UI 先呼叫 `browser_tabs`，`doctor` 也改用 `codex mcp list` 將已 enabled 的 Playwright MCP 視為 available。
- Fixture：`verify:helper-hints` 新增 `**Helper hints**:` bold label parsing；`verify:capability-gate` 新增 metadata source-scope params forwarding、source-specific vs all-source expected-field reader、selectAllFields params preservation。另以 Codex MCP smoke 確認 `browser_tabs` 可被呼叫並回傳 tab list。
- 版本與文件：Mac Agent 升到 `0.2.9`，root app 維持 `1.1.2`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 Agent version、metadata source-scope count guard、selected-field code-label reconciliation 與 Playwright browser_tabs availability guard。
- 驗證：已跑 `npm run verify:helper-hints`、`npm run verify:capability-gate`、`npm run verify:all`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:agent-resume`、`npm run verify:package-consistency`、`node agent/dist/cli.js doctor`、Codex MCP `browser_tabs` smoke、`git diff --check`。commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-05 15:18 - OTTEST004 recovery status：日期 UI evidence 與代表日期 smoke

- 背景：`Review OTTEST004 recovery status` thread `019df63f-64a7-7163-bc68-5b4ce85dc877` 在 `d7047e3` 已部署、Agent 0.2.9 已重啟後再次 compact stream disconnect。斷線前 Tommy 追問「日期工具的設置與它代表的日期是否真的 smoke test」，當時 Codex 承認只有 console/log 觀察，尚未有正式 date UI evidence path。
- 修正：新增 `agent/src/date-ui-evidence.ts`，集中處理日期 UI label normalization、visible represented range parsing、以及 preset 依 `baseDate/testDate` 計算代表起訖日期。`collage.configureMetric` 設定日期後會寫 `output/helper-artifacts/<case>/date-ui-evidence.json`，內容包含 requested raw label、normalized UI label、日期按鈕文字、popup/body 中可見的 represented ranges、computed requested range、match checks 與 warnings。
- Helper plan：`collage.configureMetric` 的 required evidence 新增 `date.uiState/date.representedRange`。manual_ai / multi-variant 日期題仍不允許 helper pre-run，但 `availableTemplates` 會提供 read-only `collage.captureDateUiEvidence`，讓 Codex visible UI 完成切換後可補同一份 `date-ui-evidence.json`，不設定日期、不按執行、不判 PASS/FAIL。
- Generator / package consistency：`helper-hints` parser、`outputs/generate_current_case_prompt.mjs` 與 package consistency evidence text check 都接受 `date.uiState/date.representedRange`，避免新版 helper hints 被誤報 `UNKNOWN_REQUIRED_EVIDENCE`。
- Fixture：新增 `verify:date-ui-evidence`，覆蓋 `昨日(快捷起點)` 正規化成 `昨日`、從 `過去7天 (2026/04/28 → 2026/05/04)` 解析 visible represented range、以 baseDate `2026-05-05` 算出 `昨日=2026/05/04~2026/05/04`、靜態日期 `2026/03/01~2026/03/31` exact observation，以及 requested label mismatch warning。`verify:capability-gate` 也檢查 manual_ai/multi-variant 日期題仍無 pre-run actions，但有可選 date evidence capture helper。
- 版本與文件：Mac Agent 升到 `0.2.10`，root app 維持 `1.1.2`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 Agent version 與 date UI represented-range evidence。
- 驗證與部署：已跑 `npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run typecheck`、`npm run build`、`npm run build --prefix web`、`npm run verify:date-ui-evidence`、`npm run verify:helper-hints`、`npm run verify:capability-gate`、`npm run verify:helper-report-gate`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:case-advance-policy`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`node agent/dist/cli.js doctor`、`git diff --check` 通過。已推 `refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp`；Railway `/version`、`/health` 與本機 Agent 重啟狀態於本輪收尾回報確認。

### 2026-05-05 15:45 - Date UI preset range smoke correction：週起始與 rolling preset 對齊 OTTEST004

- 背景：Tommy 追問「是否真的明確抓到日期工具設置與代表日期」後，檢查 `0.2.10` date UI evidence 發現 smoke 只覆蓋 `昨日` 與靜態日期，未鎖住 `上週/本週` 與 `過去30天/最近30天` 的 OTTEST004 預期。既有 `computePresetDateRange()` 對週類 preset 使用 ISO Monday，與 OTTEST004-B-04 寫明的週日~週六不一致；`過去/最近 N 天` 也未區分 d-1 結束與含今日。
- 修正：`computePresetDateRange()` 改為 Sunday week start。`上週` 代表前一個週日~週六，`本週` 代表本週日~今日；`過去N天` 代表 d-N~d-1，`最近N天` 代表 d-(N-1)~d-0。這讓 date-ui-evidence 對 B-04/B-06 類日期工具 case 能輸出與 testcase 預期一致的 computed represented range。
- Fixture：`verify:date-ui-evidence` 新增 baseDate `2026-05-05` 的 smoke assertions：`上週=2026-04-26~2026-05-02`、`本週=2026-05-03~2026-05-05`、`過去30天=2026-04-05~2026-05-04`、`最近30天=2026-04-06~2026-05-05`。另新增 `verify:date-ui-dom-smoke`，用 Playwright DOM fixture 走 helper 實際 selector 讀取路徑，確認 `#dateRangeBtn/#dateRangeDisplay/#datePickerPopup` 可被讀出並產生 `上週` computed range。
- 版本與文件：Mac Agent 升到 `0.2.11`，root app 維持 `1.1.2`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 Agent version 與 Sunday-week date preset guard。

### 2026-05-05 16:22 - OTTEST004 v1.6 follow-up：週一制 weekStart 與 package lint 誤判修正

- 背景：Tommy 提供 OTTEST004 `_claude_v1_6` 三件套，並指出 PRD v1.3「動態區間」明確定義週為週一到週日。前一版 `0.2.11` 為了 OTTEST004-B-04 smoke 改成 Sunday week start，與 PRD 衝突；同時 v1.6 package consistency 仍因省略式執行順序、inline code 舊 case id、`BUG-08/BUG-09` 與 `D-1` 術語產生誤判。
- 修正：`computePresetDateRange()` 改回 Monday week start 作為預設，`上週` 代表前一個週一~週日，`本週` 代表本週一~今日；新增 `weekStart` 參數，支援 `Monday/週一/iso` 與 `Sunday/週日`，讓未來海外或週日制題目可指定覆寫。`date-ui-evidence` 的 requested/requestedRange 會記錄實際使用的 `weekStart`。
- Package lint：`test-package-consistency` 對「依 xlsx 行順序 A-01 → ... → H-04」這種省略式順序不再硬比對成 partial order；generic unknown-case 掃描會忽略 inline/fenced code、`BUG-xx` bug id 與 `D-1` 這類日期術語，避免 v1.6 異動紀錄被誤報。
- v1.6 實際檢查：修正後重跑 `_claude_v1_6` 三件套 consistency，已清掉 `EXECUTION_ORDER_CONFLICT` 與 `DOC_REFERENCES_UNKNOWN_CASE`；剩餘 blocking error 是真實 testcase 衝突：B-08 / B-09 在 xlsx 為 `🟢 觀察`，但執行說明分別寫 `🟡 建立(動態 + 靜態混合;regression 入口)`、`🟡 建立(靜態 + regression 入口)`。另人工檢視發現指派文字 case table 的 D-02 為 `🟡 建立`，xlsx 與執行說明 D-02 為 `🟢 觀察`，需回給 testcase author 決定 canonical。
- 版本與文件：Mac Agent 升到 `0.2.12`，root app 維持 `1.1.2`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 Agent version 與 Monday-week date preset guard with weekStart override。
- 驗證：已跑 `npm run verify:date-ui-evidence`、`npm run verify:date-ui-dom-smoke`、`npm run verify:package-consistency`、OTTEST004 v1.6 source package consistency check、`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:all`、`npm run verify:helper-hints`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:agent-resume`、`node agent/dist/cli.js doctor`、`git diff --check` 通過；commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-05 19:08 - OTTEST004_008 regression：manual_ai 安全前置導航恢復

- 背景：Tommy 提供 run `ee05828e-9824-47c7-946c-1ab0a773443b` report/archive/result 與 R001 dashboard template，指出新版反而卡在首頁、不展開左側拼貼選單、不進專案頁。未讀 raw session JSONL，只檢查 report/archive/xlsx 與 helper artifact 摘要。
- 根因：`0.2.12` 為避免 B 群 `manual_ai` / multi-variant 日期題被 helper 誤跑，將 degraded case 的 helper pre-run 全關掉；這修掉日期 false BLOCKED，但也把原本可靠的 `collage.openProject` / `collage.createReport` 安全前置導航一併關掉。Codex visible UI 於是從首頁自行找左側選單，低 reasoning/工具可見性下多次停在「請從左側選擇專案查看報表」，造成 A-02/A-03/B-01 類 false FAIL/BLOCKED/PENDING。helper 截圖與 report 證實 `openProject` 本身可成功展開「我的自訂 > 拼貼模式」並選到 `拼貼test_001`。
- 修正：`capability-gate` 對 collage `manual_ai` / dynamic date case 改為 `supportStatus=degraded`、`executionMode=codex_visible_ui`，但若 case 需要拼貼專案/報表頁，允許 `helperPreRunAllowed=true` 只跑安全 navigation prelude。`helper-execution-plan` 在此模式只產生 `collage.openProject`，必要時再產生 `collage.createReport`；嚴禁產生 `collage.configureMetric`、`collage.runPreviewAndCollectEvidence`、CSV 下載或任何可判斷 testcase 結果的 core action。A-02 這種只驗「專案頁 + 新增報表按鈕可見」的 case 會停在 `openProject`，不自動進新增報表頁。
- v1.7 實測 plan 抽樣：`OTTEST004-A-02` → `helperPreRunAllowed=true`、actions=`[collage.openProject]`；`OTTEST004-B-03` → `helperPreRunAllowed=true`、actions=`[collage.openProject, collage.createReport]`；`OTTEST004-D-02` → `helperPreRunAllowed=true`、actions=`[collage.openProject, collage.createReport]`。三者 helper hints warnings 均為空，核心欄位/日期/preview/CSV 仍留給 Codex visible UI。
- 版本與文件：Mac Agent 升到 `0.2.13`，root app 維持 `1.1.2`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 Agent version 與 `manual_ai` safe navigation prelude guard。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:helper-hints`、`npm run verify:helper-report-gate`、`npm run verify:date-ui-evidence`、`npm run verify:capability-gate`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:final-aggregate-result`、`npm run verify:agent-resume`、`npm run verify:package-consistency`、OTTEST004 v1.7 source package consistency check（`status=warning`、`errors=0`）、OTTEST004 v1.7 A-02/B-03/D-02 actual helper plan smoke、`npm run verify:all`、`node agent/dist/cli.js doctor`、`git diff --check` 通過；commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-05 19:23 - OTTEST004 日期合題：date variants preview evidence helper

- 背景：Tommy 追問 `0.2.13` 是否仍會遇到日期工具議題。結論是會：`0.2.13` 修復卡首頁，但 B-03~B-06/B-09 的日期核心仍需 Codex visible UI 操作；這比已驗證過的 helper 導航穩定性差。舊 `collage.configureMetric` 只適合單輪設定，不能代表一題內雙日期切換與 per-variant payload/preview evidence。
- 修正：新增 helper action `collage.runDateVariantsPreviewEvidence`。它會先透過 visible UI 對齊欄位與顯示模式，再對 `dateVariants` / `uiLabels` 每個日期 label 逐輪執行：點日期工具、選 preset 或全靜態日期、按確認、按「執行」、收集 `date.uiState`、`date.representedRange`、`network.requestBody`、chart/table preview 與 screenshot，最後寫出 `date-variants-preview-evidence.json`。helper 仍不判 PASS/FAIL，Codex 必須讀 per-variant evidence 後判斷。
- 分流：OTTEST004 v1.7 實測 plan 變更為 `B-03/B-04/B-05/B-06/B-09 => openProject + createReport + runDateVariantsPreviewEvidence`；`B-07` 自訂動態與 `B-08` 半動態仍只跑 `openProject + createReport`，因為這兩題要測右側動態/靜態切換與天數輸入，不能用靜態日曆或 preset helper 假裝覆蓋。後續若要全自動，需另做 dynamic-date form helper。
- Gate/authoring：`helper-hints` 新增允許 `collage_date_variants_preview` template 名稱供未來 testcase 明確指定；`capability-gate` 對 degraded manual/date case 只列出允許的 helper templates（navigation + date variants evidence），不再把 generic `configureMetric` 列給 Codex 誤用。
- 版本與文件：Mac Agent 升到 `0.2.14`，root app 維持 `1.1.2`；README、refactor 規劃、工程 spec、M1 spec / v1.2.1 spec 同步更新 Agent version 與 date-variants preview evidence helper。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run verify:capability-gate`，並用 OTTEST004 v1.7 B-03/B-04/B-05/B-06/B-07/B-08/B-09 actual helper plan smoke 確認分流。完整 build/verify、commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本次收尾回報補列。

### 2026-05-06 00:18 - OTTEST004_011 incident：A-06 native validation dialog / Tool Bridge response gap

- 背景：Tommy 提供 run `31243914-3666-4430-a4c6-aaad35f1d70e` report/archive 詢問「發生什麼事」。本次未讀 raw session JSONL，只看 report/archive。v1.8.1 package gate 已通過，run 實際執行到 `OTTEST004-A-06` 才中斷；A-01/A-04/A-05 為 metadata/source mismatch 類實測結果，非本次 abort 主因。
- 根因：A-06 helper pre-run 只完成安全導航，核心「選欄位 → 設日期 → 執行 → 判斷全 0 欄位」交給 Codex visible UI。Codex 在未成功選到任何欄位時按下「執行」，BI 跳出 native validation alert `請至少選擇一個欄位`。Codex 有輸出 Tool Bridge `playwright_recovery` request，但 Agent/App 沒有記錄 Tool Bridge response，policy guard 以 `NATIVE_DIALOG_WITHOUT_TOOL_BRIDGE_RESPONSE` 結束整輪。
- 澄清：這不是 Tommy 沒在 chat 按授權造成。Agent 模式只認 App / Agent Tool Bridge response；目前問題是 pending Tool Bridge request 沒有被 UI/Agent 正確承接與回覆，錯誤訊息也容易讓人誤會成「使用者未授權」。
- 待修項：已寫入 `docs/refactor/工程spac.md`。P0 包含 selected-field-count guard before Execute、非破壞性 native validation alert allowlist/recovery、pending Tool Bridge request 顯示、missing Tool Bridge response 的明確錯誤訊息、current-case BLOCKED/recoverable without whole-run abort，以及 A-06 all-zero-field inspection helper/guardrail。
- 狀態：本次只做 docs tracking，未改 runtime code，未部署。

### 2026-05-06 00:42 - Authoring contract：PM-skip / 預先 BLOCKED 不寫 Helper hints

- 背景：OTTEST004 `_claude_v1_8_2` 為了避開 A-06 已知工具缺口，將 A-06 預先 BLOCKED；方向正確，但在執行說明中發明 `automationLevel=blocked_preassigned`、`operationTemplate=n/a` 與 `doNotExecute=true`，造成 package gate 報 `UNKNOWN_AUTOMATION_LEVEL`、`UNKNOWN_OPERATION_TEMPLATE`、`MISSING_FORBIDDEN_AUTOMATION`。v1.8.3 已改成 PM-skip row 並移除 A-06 Helper hints，package consistency 回到 `status=warning / ok=true`。
- 決策：正式補進 `docs/authoring/UAT_三文件撰寫規則.md`：PM-skip / 預先 BLOCKED case 要靠 xlsx `結果=BLOCKED`、`執行方式=N/A(本輪不執行)`、`測試日`、`驗證方法=本輪不執行;未來執行 evidence: ...` 與 `detail_json.skip_reason/skip_decided_by/skip_decided_at/preserved_for` 表達；三文件統計與 skip 清單必須同步；Agent/Codex 不可碰這些 row，只原樣複製到 `output/result.xlsx`。
- Helper hints 契約：PM-skip case 不得放 Helper hints block，因為 skip 不是 helper automation level。明確禁止 `blocked_preassigned`、`operationTemplate: "n/a"`、`doNotExecute`、`skip_reason` 等 PM-skip 控制欄位出現在 Helper hints；若 package lint 遇到應視為 schema error。
- Layer 1：同步補 `agent-skills/uat-tool/rules/artifacts-and-results.md` 的 PM-skip row contract，要求 UI/report 將 PM-skip 與 Agent-runtime BLOCKED 分開分類，不可把 PM-skip 修復成 runtime `EVIDENCE_INSUFFICIENT`。
- 狀態：docs-only 更新，未改 runtime code，未部署。

### 2026-05-06 01:10 - Session handoff 規則：活問題優先於狀態盤點

- 背景：新視窗 `019dfa40-7d25-7630-ba5d-0f0f0d373b72` 雖有讀到前一版 handoff 並完成 repo / production / dirty files 盤點，但 handoff 沒把 Tommy 真正要接續的活問題放在最前面，導致新視窗看起來像不知道 Tommy 在追問 OTTEST004 v1.7 vs v1.8.3、`TOOL_BRIDGE_RESPONSE_MISSING` 自動中止、B-12 後未執行等核心議題。
- 決策：新增 `docs/planning/session-handoff-generation-rules.md`，規定任何 session handoff 與未來每日自動 handoff 都必須以 `Active User Question / Next Conversation Objective` 開頭；repo/run/deploy 狀態只能作為支撐資料，不能取代活問題。若新聊天室讀完只知道檔案與 commit，卻不知道 Tommy 第一個要它回答什麼，該 handoff 視為不完整。
- 修改檔案：`docs/planning/session-handoff-generation-rules.md`、`AGENTS.md`、`docs/planning/online-uat-tool-development-log.md`、`docs/refactor/規劃說明.md`、`docs/refactor/工程spac.md`。
- 驗證：docs-only 規則更新；需以 `git diff --check` 驗證格式。
- 後續影響：每日自動產生 shared D-1 handoff 時，必須偵測並輸出每條工作流的活問題、允許模式、未決事項、來源 thread/folder 與 ready-to-paste prompt；不能只彙整 git diff 或 run 狀態。

### 2026-05-06 07:22 - OTTEST004_014：result gate TOOL_BRIDGE_RESPONSE_MISSING false positive 修正

- 背景：OTTEST004 v1.8.3 / run `6ced1427-6365-49fa-88a5-cf582d99bff6` 實際只跑到 B-12；B-12 local result 已寫 `BLOCKED / EVIDENCE_INSUFFICIENT`，但 server ingest 以 `TOOL_BRIDGE_RESPONSE_MISSING` 中止。排查發現不是 Tommy 取消或未授權，也不是實際 native dialog response 遺失，而是 result evidence gate 的 regex 把 testcase prose「第二次結果需覆蓋第一次」誤判成不可逆 overwrite action claim。
- 修正：`src/result-parser/result-evidence-gate.ts` 收斂 Tool Bridge action claim 偵測，只在明確 `browser_handle_dialog`、Tool Bridge request/approval、Tommy/PM 授權 + destructive/native action、已處理 native dialog、刪除或覆寫儲存等情境要求 Tool Bridge response。不再把一般「覆蓋 preview 顯示 / overwrite previous preview result」語句視為不可逆操作。
- Fixture：`scripts/verify-result-evidence-gate.ts` 新增 benign overwrite prose workbook，確認「同一 session 重新執行，第二次結果覆蓋第一次 preview 顯示」可通過 gate；既有「Tommy 已授權刪除，並已完成刪除動作」仍會被 `TOOL_BRIDGE_RESPONSE_MISSING` 擋下，外部 Tool Bridge event evidence 仍可解除。
- 文件：README、`docs/refactor/工程spac.md`、`docs/refactor/規劃說明.md` 同步說明 result gate false-positive guard。A-06 native validation dialog lifecycle 與 PM-skip runtime ingestion 仍是後續 P0。
- 驗證：已跑 `npm run verify:result-evidence-gate`、`npm run typecheck`、`npm run build`、`git diff --check` 通過；commit/push `refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp` 待本批收尾執行。

### 2026-05-06 11:08 - OTTEST004_014 follow-up：source result / PM-skip runtime skip ingestion

- 背景：Tommy 指出 PM-skip 不應發明 `blocked_preassigned`、`doNotExecute` 等 helper/control schema；更單純的契約是 source testcase row 若已填 `結果=BLOCKED` 等終態，工具直接視為已有結果並跳過 Agent 執行。OTTEST004 A-06 正是這類 case。
- 修正：`src/xlsx-parser.ts` 現在讀取 source xlsx 的 `結果`、`失敗分類`、`測試日`、`驗證方法`。`src/runs.ts` 匯入 terminal source result 時直接寫入 `run_cases.result_status`，保留 source detail/fail category，並把該 case 的 `run_case_steps` 標成 `SKIPPED` / `actual_json.source=source_prefilled_result`。API `POST /api/runs/:id/cases` 與 `POST /api/runs/:id/steps` 也補齊 `fail_category` / `actual_json` binding，避免新 SQL 欄位半套。
- Agent：`agent/src/case-manifest.ts` 會跳過 source workbook 中非 pending `結果` 的 case；若指定 start case 已有結果，manifest 會加 `START_CASE_ALREADY_HAS_RESULT:<case>` warning 並選下一個 runnable case。`agent/src/task-runner.ts` 的 next-case 判斷不再因 `detail_json` 存在就跳過，只認非 pending `結果`。
- Fixture：新增 `scripts/verify-source-prefilled-results.ts` 與 `npm run verify:source-prefilled-results`，覆蓋 source `BLOCKED` 匯入、step skip、detail_json-only runnable case、manifest 跳過已填結果 row。
- 版本與文件：Mac Agent 升到 `0.2.15`；README、`docs/refactor/工程spac.md`、`docs/refactor/規劃說明.md` 同步更新 source-result runtime skip contract。A-06 native validation dialog lifecycle / selected-field guard 仍是下一個 runtime P0。
- 驗證：已跑 `npm run verify:source-prefilled-results`、`npm run verify:result-evidence-gate`、`npm run typecheck`、`npm run typecheck --prefix agent`、`npm run build`、`npm run build --prefix agent`、`git diff --check` 通過；commit/push `refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp` 待本批收尾執行。

### 2026-05-06 11:18 - OTTEST004-A-06 runtime hardening：Execute precondition 與 validation alert allowlist

- 背景：A-06 的根本 runtime 風險是 Codex/helper 在未選到任何欄位時按 BI `執行`，導致 native alert `請至少選擇一個欄位`。這類 alert 是非破壞性 validation，不應等同刪除/覆寫 native dialog，也不應被寫成 Tommy 未授權。
- 修正：`agent/src/bi-ui-helper-executor.ts` 新增 `EXECUTE_PRECONDITION_NO_SELECTED_FIELDS` guard。`collage.runPreviewAndCollectEvidence` 與 `collage.runDateVariantsPreviewEvidence` 在按 `執行` 前先讀 selected metric fields；若 count=0，helper 直接回 `blocked`，留下 DOM/fieldSelection evidence，不按出 native alert。
- Codex guidance：`agent/src/task-runner.ts` 的 generated AGENTS 與 task prompt 明確要求 visible-UI case 按 `執行` 前先驗證 selected field count > 0；若為 0，寫 current-case `BLOCKED / EXECUTE_PRECONDITION_NO_SELECTED_FIELDS`，不要點 Execute。
- Tool Bridge / gate：`agent/src/task-runner.ts` policy scan 與 `src/result-parser/result-evidence-gate.ts` 允許 `請至少選擇一個欄位` / `select at least one field` 這類非破壞性 validation alert 作為 BLOCKED evidence，不再因 `browser_handle_dialog` 字樣本身要求 Tool Bridge response。刪除、覆寫、儲存、SSO/auth 或明確授權 claim 仍維持 Tool Bridge response gate。
- Fixture：`scripts/verify-result-evidence-gate.ts` 新增 non-destructive selected-field validation alert fixture，確認 `BLOCKED / EXECUTE_PRECONDITION_NO_SELECTED_FIELDS` 可通過；刪除/授權類缺 response 仍會擋。
- 版本與文件：Mac Agent 升到 `0.2.16`；README、`docs/refactor/工程spac.md`、`docs/refactor/規劃說明.md` 同步更新。A-06 all-zero-field inspection helper、Web UI pending Tool Bridge request 顯示與完整 current-case BLOCKED without whole-run abort flow 仍是後續 P0。
- 驗證：已跑 `npm run verify:result-evidence-gate`、`npm run typecheck`、`npm run typecheck --prefix agent`、`npm run build`、`npm run build --prefix agent`、`git diff --check` 通過；commit/push `refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp` 待本批收尾執行。

### 2026-05-06 11:45 - OTTEST004-A-06 runtime hardening：all-zero-field inspection helper

- 背景：A-06 原始目的不是讓 Agent 判斷 0 值成因，而是列出 `每日報表` 在靜態區間 `2026/03/01~2026/03/31` 下全 0 欄位清單。v1.8.x 讓 Codex visible UI 自行處理大量欄位全選，導致未選欄位就按 Execute 的 native alert 風險；光有 selected-field guard 還不夠，仍需要 A-06 專用 helper。
- 修正：新增 canonical `operationTemplate=collage_all_zero_field_inspection` 與 helper action `collage.inspectAllZeroFields`。helper plan 對 A-06 類 case 產生 `openProject -> createReport -> inspectAllZeroFields`，不走 generic preview/save/reopen。executor 會透過 visible UI 依 `sourceReport/sourceReports` 與 metadata 全選欄位，驗證 selected field count，設定靜態日期與 display，按 Execute 後收集 request/response、Chart.js datasets、preview table summary，並輸出 `all-zero-field-inspection-evidence.json`。
- Evidence：全 0 候選欄位由 chart datasets、preview table numeric columns 與可讀 JSON response body best-effort 彙整；helper 只列 `allZeroCandidates` 與 selected field labels/codes，不判 PASS/FAIL，不寫 result.xlsx，也不判斷全 0 根因。
- Authoring：`docs/authoring/UAT_三文件撰寫規則.md` 新增 A-06 template 範例，要求 structured params 帶 `sourceReport/sourceReports`、`selectAllFieldsInSourceReport`、`expectedFieldCount`、靜態 `dateRange`、`display` 與 `network.responseBody/chart.datasets` evidence；PM-skip row 仍不得放 Helper hints。
- Fixture：`scripts/verify-capability-gate.ts` 新增 A-06 fixture，確認 capability gate advertises `collage.inspectAllZeroFields`，helper plan 只含三段 dedicated flow，且保留 `sourceReports/expectedFieldCount/dateRange`。
- 版本與文件：Mac Agent 升到 `0.2.17`；README、`docs/refactor/工程spac.md`、`docs/refactor/規劃說明.md`、authoring spec 同步更新。Web UI pending Tool Bridge request 顯示與完整 current-case BLOCKED without whole-run abort flow 仍是後續 P0。
- 驗證：已跑 `npm run verify:capability-gate`、`npm run verify:helper-hints`、`npm run typecheck`、`npm run typecheck --prefix agent`、`npm run build`、`npm run build --prefix agent`、`npm run build --prefix web`、`git diff --check` 通過；commit/push 後 production 已部署至 `d51cd65`。

### 2026-05-06 12:08 - Tool Bridge lifecycle status panel / missing response wording

- 背景：OTTEST004 v1.8.x 的 `TOOL_BRIDGE_RESPONSE_MISSING` 不能再被描述成 Tommy 沒授權或按取消。要讓 App 清楚呈現每個 Tool Bridge request 是 pending、已送出 response、Agent 已 delivered，還是 App/Agent response lifecycle 失敗。
- 修正：`src/runs.ts` 新增 `tool_response.dispatch_failed` run event。當 approval resolved 後找不到原始 `tool_request.created` event，或 App 無法把 response 送到 Mac Agent 時，server 會留下 dispatch_failed event 與 ERROR log。
- API/UI：新增 `GET /api/runs/:id/tool-bridge`，依 request id 回報 `pending_approval`、`rejected`、`response_missing`、`response_sent`、`response_delivered`。Web run detail 的「等待人工處理」卡片新增 lifecycle panel，顯示 request id、case、action、reason、時間戳與 `TOOL_BRIDGE_RESPONSE_MISSING`，並明講這不是 Tommy 取消或未授權。
- Fixture：`scripts/verify-agent-roundtrip.ts` 擴充 manual approval roundtrip：approval 前應為 `pending_approval`，按 continue 後應為 `response_sent`；auto-approval roundtrip 在 Agent 回報 delivered 後應為 `response_delivered`。
- 版本與文件：root App/API 升到 `1.1.3`；README、`docs/refactor/工程spac.md`、`docs/refactor/規劃說明.md` 同步更新。完整 current-case BLOCKED without whole-run abort 的真實 Codex/Playwright regression 仍需後續 production package 驗證。
- 驗證：已跑 `npm run verify:agent-roundtrip`、`npm run verify:tool-bridge`、`npm run typecheck`、`npm run build --prefix web`、`git diff --check` 通過；commit/push 與 Railway `/version` / `/health` 待本批收尾執行。

### 2026-05-06 16:12 - Result workbook contract hardening：testcase-style output normalizer

- 背景：OTTEST004_016 / run `eb2ee3ec-50f8-4962-8263-2db0c0f46d95` 不是 package gate 或 helper 未跑完。A-01~B-03 已成功 ingest，B-04 helper 與 Codex 判定也完成 `PASS`；失敗點在 Agent 上傳前 self-check。Codex 將 `output/result.xlsx` 寫成整份 17 欄 testcase workbook，僅填 B-04 一列，導致 parser 把 A-01~H-04 空白/未跑 row 全部當作 result rows，報 `RESULT_XLSX_HEADER_MISSING`、大量 `RESULT_XLSX_DETAIL_JSON_INVALID` / `RESULT_XLSX_DETAIL_FIELD_MISSING`，整輪標 `FAILED`。
- 修正：新增 `agent/src/result-workbook-normalizer.ts`。Agent 上傳前若偵測 `output/result.xlsx` 已是 result-contract workbook，維持原流程；若偵測為 testcase-style workbook，且 `expectedCaseNos` 只有一題、該 current case row 已有 PASS/FAIL/BLOCKED/PARTIAL 與合法 detail_json，Agent 會備份原檔為 `result.testcase-style-original.xlsx`，只抽該 current case row 轉成單題 result-contract workbook，再進入 evidence enrichment / legacy repair / self-check / upload。若找不到 current case 或該 row 未完成，明確回 `RESULT_XLSX_NORMALIZATION_FAILED`。
- Fixed writer：新增 `agent/src/result-cli.ts`，提供 `node agent/dist/result-cli.js write --run-dir <runDir> --case <caseNo> --status <PASS|FAIL|BLOCKED|PARTIAL> --detail-json <detail.json> [--fail-category <category>]`，讓 Codex 可先產 JSON payload，再由 Agent 固定 writer 輸出合法 result-contract workbook，降低手刻 xlsx schema 風險。
- Prompt/契約：`task-runner` generated AGENTS 與 run brief 補強 `output/result.xlsx` 不是 `input/testcase.xlsx` 複本，必須是單題 result-contract workbook，並列出固定 writer command。authoring spec 與 README 同步澄清 PM-skip/source prefilled rows 由 server/import 與 manifest skip 處理，不應要求 Codex 把整份 source xlsx 複製成結果檔。
- Fixture：`scripts/verify-agent-result-contract.ts` 新增 testcase-style Codex output fixture，模擬整份 17 欄 workbook 只有 `OTTEST004-B-04` 有 PASS 的情境；normalizer 應只抽 B-04 並讓 self-check/parser 通過。
- 版本：Mac Agent 升到 `0.2.18`；App/API 維持 `1.1.3`。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run verify:agent-result-contract` 通過；完整 build、真實 B-04 複本 smoke、git diff check、commit/push 與本機 Agent 重啟狀態由本批收尾回報補列。

### 2026-05-06 19:04 - OTTEST004_017：configureMetric dateRange PASS contradiction false positive

- 背景：OTTEST004_017 / run `61f48100-ce11-4cbb-81b9-f2dfa207aa1d` 已完成並 ingest 到 B-08；B-09 helper 實際完成，Codex 依 current-run helper evidence 判 `PASS`，但 Agent 上傳前 self-check 以 `RESULT_XLSX_SELF_CHECK_FAILED RESULT_PASS_CONTRADICTS_HELPER_EVIDENCE` 擋下。self-check 指向 `collage.configureMetric-latest.json` 的 `stateDelta.after.checks.dateRange=false`；同一 helper report 內的 `dateRangeEvidence.dateUiEvidence` 與獨立 `date-ui-evidence.json` 卻已證明 UI / request / table 都是 `2026-03-01~2026-03-15`。
- 根因：configureMetric 的 raw stateDelta check 仍用文字包含判定，將 testcase target `2026-03-01 ~ 2026-03-15` 與 UI text `2026/03/01 ~ 2026/03/15` 視為不一致；self-check 又直接採用該 raw false，未優先採用 normalized date UI evidence。
- 修正：`agent/src/result-contract.ts` 的 PASS contradiction gate 對 `collage.configureMetric` 新增窄例外：若 false check 只有或包含 `dateRange`，且 `dateRangeEvidence.dateUiEvidence.checks.representedRangeMatchesRequested` 或 `staticRequestedRangeObserved` 為 true，則移除該 dateRange false，不阻斷 upload。`collage.reopenReport` 的 `dateRange=false` 仍維持阻斷，保護 save/reopen 後日期回退的真 regression。
- Fixture：`scripts/verify-agent-result-contract.ts` 新增兩個案例：configureMetric `dateRange=false` 但沒有 normalized date evidence 時仍應擋；configureMetric `dateRange=false` 但 `date-ui-evidence` 證明 represented range 正確時應通過。
- 回驗：用新 self-check 回放 `61f48100-ce11-4cbb-81b9-f2dfa207aa1d/output/result.xlsx`，結果從 `RESULT_PASS_CONTRADICTS_HELPER_EVIDENCE` 變為 `status=ok`。
- 版本：Mac Agent 升到 `0.2.19`；App/API 維持 `1.1.3`。
- 驗證：已跑 `npm run verify:agent-result-contract` 與真實 B-09 self-check 回放通過；完整 typecheck/build、git diff check、commit/push 與本機 Agent 重啟狀態由本批收尾回報補列。

### 2026-05-06 21:35 - OTTEST004_018 follow-up：可跑 case 第一批 runtime 修正

- 背景：Tommy 檢視 run `a9a3d5af-9740-4fb2-85ae-b0170946813e` 後指出部分 case 應可跑但被 BLOCKED/未完整處理，先鎖定第一批 runtime 問題：F-03 同 editor session CSV、G-03 刪除報表，以及 G-05 類「無 native confirm / 缺少 native dialog 驗證」文字被誤判成 Tool Bridge action claim。
- Result gate：`src/result-parser/result-evidence-gate.ts` 在 Tool Bridge claim detection 前先遮罩 negative/missing native-dialog wording，例如 `無 native confirm`、`不出現 native dialog`、`缺少 native dialog 驗證`。這類文字代表 BLOCKED evidence 不足，不代表 Codex 已處理 native dialog，因此不應觸發 `TOOL_BRIDGE_RESPONSE_MISSING`。
- Helper plan：F-03 類 static date + 同 editor session CSV case 現在會產生 `openProject -> createReport -> runDateVariantsPreviewEvidence -> downloadCsvAndComparePreview`，`downloadScope=editor_session`，不 save、不 reopen、不回專案頁。單一日期 variant helper 會同步寫 `preview-evidence.json`，供 CSV comparator 使用。
- Delete helper：新增 `collage.createAndDeleteTemporaryReport`。G-03 類 case 先建立名稱含 `OTTEST004_G03/temp` 的 current-case 臨時報表，Tool Bridge approval 後才點該 row 的刪除控制；只接受已知 BI delete confirm，遇到 auth/未知 native dialog 會 dismiss 並 blocked；刪除後 reload/reselect project 驗證 row 消失。非臨時或疑似主報表名稱直接 blocked。
- Fixture：`scripts/verify-capability-gate.ts` 新增 F-03 editor-session CSV chain 與 G-03 temp report delete helper；`scripts/verify-result-evidence-gate.ts` 新增 negative native-confirm prose fixture。
- 版本與文件：App/API 升到 `1.1.4`，Mac Agent 升到 `0.2.20`；README、`docs/refactor/工程spac.md`、`docs/refactor/規劃說明.md` 同步更新。B-07/B-08 動態/半動態日期、G-01 新增專案、E 群公式/helper authoring 仍是下一批待修。
- 驗證與部署：已跑 `npm run verify:capability-gate`、`npm run verify:result-evidence-gate`、`npm run typecheck`、`npm run typecheck --prefix agent`、`npm run build`、`npm run build --prefix agent`、`git diff --check` 通過。runtime commit `78ce204` 已推 `refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp`；Railway production `/version` 為 App `1.1.4` / commit `78ce204` / deployment `4096ed28-8745-44b8-96ff-883b8fa4b39b`，`/health` healthy。本機 `com.tommy.uat-agent` 已重啟至 pid `22113`，API 顯示 Tommy Mac Agent version `0.2.20` / idle。

### 2026-05-06 22:20 - Session handoff：OTTEST004_018 follow-up compact 後下一輪

- 背景：thread `019dfa40-7d25-7630-ba5d-0f0f0d373b72` 在 Tommy 追問 run `a9a3d5af-9740-4fb2-85ae-b0170946813e` 中 `B-07/B-08/D-02/E-01~E-04/F-03/G-01/G-03` 應可繼續改善後，完成第一批 runtime 修正與部署，但在分析剩餘項目時再次 compact stream disconnect。該 JSONL 約 `14MB` / `4885` 行，最後 input 約 `236k` tokens，且 `2026-05-06T13:02:06Z`、`2026-05-06T14:04:34Z` 兩次 compact stream disconnect 後沒有 final 回覆。
- 交接文件：新增 `docs/planning/session-handoff-2026-05-06-ottest004-018-followup-next.md`。下一輪應讀此 handoff、本 planning log 與 `uat-tool/AGENTS.md`，不要讀完整 raw JSONL。
- 當前狀態：HEAD / production 為 `c387d65`，App `1.1.4`，Railway `/health` healthy；Agent package `0.2.20`。repo 無 tracked dirty files，只有既有未追蹤 demo/artifacts。第一批已完成：F-03 editor-session CSV plan、G-03 temporary delete helper、negative native-dialog prose false positive 修正。下一批仍需處理 B-07/B-08 dynamic/half-dynamic date、D-02 72 欄 selection、E 群 formula helper / modal flow、G-01 create project，以及對 F-03/G-03/G-05-style gate 做 production rerun/smoke。

### 2026-05-06 23:09 - OTTEST004_018 follow-up：第二批 helper wiring 與缺口修補

- 背景：新接續 thread 檢查上一個 compact 斷線留下的未 commit patch 後，確認 B-07/B-08、D-02、E-01~E-04、G-01 已有 gate/plan/executor 雛形，但 E 群 `collage.configureCalculatedMetricAndPreview` 與 G-01 `collage.createProject` 只被 capability gate/helper plan 宣告，executor main switch 尚未接上，實際會落入 `not_implemented`。另 D-02 多來源全選 72 欄雖已會走 select-all + preview + CSV，但 selected count mismatch 對非 A-06 case 仍只是 non-blocking warning，存在少選欄位仍產生 CSV evidence 的風險。
- 修正：`collage.runDateVariantsPreviewEvidence` 支援 structured `dateMode=relative|hybrid`，會透過 visible UI 開日期工具、切左右端點的動態/靜態 tab、填 `#startDayInput/#endDayInput` 或靜態日曆後確認，再收集 date UI / network / chart / table evidence。D-02 類 `selectAllFields + sourceReports + expectedFieldCount + downloadCsv` 現在把 count mismatch 視為 blocked precondition，不再繼續用不完整欄位產 CSV 比對。
- E/G helper wiring：executor main switch 接上 `collage.configureCalculatedMetricAndPreview` 與 `collage.createProject`。公式 helper 會加入 base fields、開「新增運算欄位」modal、用 modal-scoped input/textarea 填名稱與公式、送出後設定日期/顯示並按執行。新增專案 helper 需 Tool Bridge approval，會點 `+ 新增專案`、選模式 `拼貼`、輸入 `OTTEST004_G01_<timestamp>` 類 current-case 測試專案名、送出後驗證左側選單可見；若出現 `請選擇模式` 或 auth/未知 native dialog 則 blocked 並留 evidence。
- Actual package smoke：以 OTTEST004 v1.8.4 三件套產 plan，確認 `B-07/B-08 => openProject/createReport/runDateVariantsPreviewEvidence`，`D-02 => openProject/createReport/runDateVariantsPreviewEvidence/downloadCsvAndComparePreview`，`E-01~E-04 => openProject/createReport/configureCalculatedMetricAndPreview`，`G-01 => openProject/createProject*`，`G-03 => openProject/createAndDeleteTemporaryReport*`。星號表示 Tool Bridge helper action。
- 版本與文件：Mac Agent 升到 `0.2.21`，App/API 維持 `1.1.4`；README、`docs/refactor/工程spac.md`、`docs/refactor/規劃說明.md` 同步更新 dynamic/hybrid date helper、formula helper、create-project helper 與 strict select-all field-count guard。handoff 檔 `session-handoff-2026-05-06-ottest004-018-followup-next.md` 仍作為本輪來源文件保留。
- 驗證：已跑 `git diff --check`、`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:capability-gate`、`npm run verify:helper-hints`、`npm run verify:result-evidence-gate` 通過。OTTEST004 v1.8.4 package consistency check 為 `status=warning / ok=true`，無 error；warnings 為既有 docs/helper params/evidence visibility 類提醒。commit/push、Railway `/version` / `/health`、本機 Agent 重啟與 production smoke 由本批收尾回報補列。

### 2026-05-07 03:24 - OTTEST004_020 E-01 stop：formula modal 與 result gate 修正

- 背景：Tommy 回報 run `7e60be43-d953-4685-a710-794901e94e08` 整體 PASS 數提升，但跑到 `OTTEST004-E-01` 後整輪停止。排查 report/archive 與本機 output 後確認 Codex 已寫出 E-01 `BLOCKED / EVIDENCE_INSUFFICIENT`，但上傳被 `TOOL_BRIDGE_RESPONSE_MISSING` 擋下；同時 helper artifact 顯示公式 modal 中 `#calculatedFieldNameInput` 被填成公式、`#formulaFieldsSearchInput` 被填成 `E01_運算`、`#formulaInput` 仍空，根因是 helper 用 placeholder 猜 input 角色而誤判。
- Result gate：`src/result-parser/result-evidence-gate.ts` 的 negative/missing native-dialog prose mask 改成中性文字 `NEGATED_OR_MISSING_EVIDENCE_TEXT`，避免遮罩後的字串本身含 `TOOL_BRIDGE` 又被第二輪 regex 命中。新增 fixture 覆蓋 `無法完成公式確認與後續執行，未取得 network.requestBody/chart.datasets` 這類 E-01 BLOCKED wording，確認不再要求 Tool Bridge response。
- Formula helper：`agent/src/bi-ui-helper-executor.ts` 的 `collage.configureCalculatedMetricAndPreview` 改用公式 modal 穩定 selector：`#calculatedFieldNameInput` 填 calculated field name、`#formulaInput` 填 formula expression、`button[onclick="saveFormula()"]` 送出；送出前驗證 name/formula input value，若不一致回 `FORMULA_NAME_INPUT_VALUE_MISMATCH` 或 `FORMULA_INPUT_VALUE_MISMATCH`，不再把公式/name/search 欄位互換後繼續。
- 版本與文件：App/API 升到 `1.1.5`，Mac Agent 升到 `0.2.22`；README、`docs/refactor/工程spac.md`、`docs/refactor/規劃說明.md` 同步更新 formula-modal blocked gate guard 與 stable formula modal selector helper。
- 驗證：已跑 `npm run verify:result-evidence-gate`、用 run `7e60be43-d953-4685-a710-794901e94e08/output/result.xlsx` 重放 `npm run check:result-evidence -- --current-case OTTEST004-E-01` 確認 status=ok、`npm run typecheck`、`npm run typecheck --prefix agent`、`npm run build`、`npm run build --prefix agent`、`npm run build --prefix web`、`npm run verify:capability-gate`、`npm run verify:helper-hints`、`npm run verify:agent-result-contract`、`npm run verify:helper-report-gate`、`npm run verify:case-advance-policy`、`npm run verify:tool-bridge`、`npm run verify:agent-resume`、`npm run verify:agent-roundtrip`、`npm run verify:final-aggregate-result`、`npm run verify:package-consistency`、`node agent/dist/cli.js doctor`、`git diff --check` 通過。commit/push、Railway `/version` / `/health` 與本機 Agent 重啟由本批收尾回報補列。

### 2026-05-07 04:38 - E 群 formula modal authoring / BI domain contract 補強

- 背景：Tommy 檢視公式編輯器截圖後確認 E 群「新增運算欄位」不是一般欄位新增流程，而是需進入「公式編輯器 - 新運算欄位」modal 填欄位名稱與公式。前一版 testcase 只寫高階「新增運算欄位,公式=...,命名...」，對人可讀但不足以穩定引導 Agent/helper。
- BI domain：`BI_TEST_RULES/BI測試_系統背景知識.md` 新增拼貼模式運算欄位 / 公式編輯器 modal 的跨輪知識：先加入 base fields、點綠色 `+ 新增運算欄位`、在 modal 填「欄位名稱」與「公式」、按「確認」後驗證 modal 關閉與 preview request body 帶運算欄位定義。此檔在 `uat-tool` git repo 外,但仍是 Agent run packet 會引用的 canonical BI rulebook。
- Authoring：`docs/authoring/UAT_三文件撰寫規則.md` 新增 formula/calculated-field testcase 撰寫契約：`operationTemplate=collage.configureCalculatedMetricAndPreview`、必填 `baseFields`、`calculatedFieldName`、`formula`、`dateRange`、`display`，並要求 `formula.uiState`、`network.requestBody`、`chart.datasets` evidence。明確禁止只靠一句「新增運算欄位」讓 helper 猜 modal input 角色,也禁止在 testcase 寫 CSS selector。
- 文件同步：README、`docs/refactor/工程spac.md`、`docs/refactor/規劃說明.md` 同步標記 formula modal authoring contract。此批為文件 / authoring / domain contract 更新,無 runtime 程式變更,不升 App/API 或 Agent 版本,不需重新部署或重啟 Agent。
- 驗證：已跑 `git diff --check` 與 `npm run verify:helper-hints` 通過,並完成文件 diff review。若後續 Claude 完成 OTTEST004 E-01~E-04 testcase structured params,再以 package consistency / helper-hints smoke 驗證新版測試包。

### 2026-05-07 05:15 - OTTEST004 v1.8.5 formula helper-hints parser compatibility

- 背景：Claude 產出的 OTTEST004 v1.8.5 E-01~E-04 已改成 modal-aware helper hints，但 package consistency 顯示 `UNKNOWN_OPERATION_TEMPLATE:collage.configureCalculatedMetricAndPreview` 與 `UNKNOWN_REQUIRED_EVIDENCE`。根因是 runtime executor 已支援 dot-style formula template，但 helper-hints parser allowlist 尚未同步；另 `requiredEvidence` array 內放了 `formula.uiState: 說明文字` 這類 annotated token。
- 修正：`agent/src/helper-hints.ts` 將 `collage.configureCalculatedMetricAndPreview` 納入 allowed operation templates，新增 `formula.uiState` evidence token，並在 requiredEvidence 檢查前把 `token: prose` / `token：prose` 正規化為 canonical token。這是 package 兼容 guard；authoring contract 仍要求 Claude 在 `requiredEvidence` 寫純 token，把說明文字移到步驟、驗證方法或 notes。
- Fixture：`scripts/verify-helper-hints-fixture.ts` 新增 formula modal helper hints fixture，覆蓋 dot-style operation template 與 annotated evidence normalization，確保 E 群 helper hints 不再被 parser 誤報 unknown vocabulary。
- 版本與文件：Mac Agent 升到 `0.2.23`，App/API 維持 `1.1.5`；README、`docs/refactor/工程spac.md`、`docs/refactor/規劃說明.md` 同步更新 formula helper-hints parser compatibility。
- 驗證：已跑 `npm run verify:helper-hints`、`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`node agent/dist/cli.js doctor`、`git diff --check` 通過。OTTEST004 v1.8.5 package consistency recheck 已確認 parser 修正生效，`UNKNOWN_OPERATION_TEMPLATE` / `UNKNOWN_REQUIRED_EVIDENCE` 清除；目前仍為 `status=error`，唯一 error 是 `OTTEST004-E-03` 在 xlsx 與執行說明的 `RISK_LEVEL_CONFLICT`，其餘為既有 helper params/evidence visibility 與 B-13 doc reference warnings。commit/push 與本機 Agent 重啟狀態由收尾回報補列。

### 2026-05-07 14:30 - OTTEST004_021 BLOCKED 收斂：公式 readonly、row CSV、G/F 流程 helper

- 背景：Tommy 回報 run `7065f9e6-b533-45a7-acbe-56c96c14ef47` 已完整跑完 44 題且 PASS 數提升，但 BLOCKED 偏多。diff review 後分流出主要工具缺口：E-01~E-04 已能開公式 modal 但 `#formulaInput` 是 readonly，不能用 `fill()`；F-04~F-06 在專案頁 row 下載時因 row descendant button 掃描不到而過早 BLOCKED；F-02 被「已儲存報表」字樣誤判成 open-existing flow；G-01/G-02 建專案 evidence 有成功訊號但後置驗證太脆弱；G-04/G-05 manual_ai 只做導航 prelude，沒有真正點報表名稱或返回。
- 修正：`collage.configureCalculatedMetricAndPreview` 若偵測 `#formulaInput.readOnly=true`，會把公式 token 化，依序點可用欄位 token 與 modal keypad/operator buttons，例如 `[新增帳號數]+[MAU(帳號)]/2`；輸入後以正規化公式字串驗證，不再對 readonly input 直接 `fill()`。
- CSV / flow：`collage.downloadCsvAndComparePreview` 對 report-list scope 只在 saved row 找不到時才提前回 precondition；若 row 存在但 descendant download control 掃不到，會繼續嘗試 row-nearby download controls 與既有 UI-triggered response-body fallback。`save_load_flow` / F-02 現在 create/save fresh report 後再 reopen，不再被「已儲存報表」誤導成修改既有報表。
- Project helpers：`collage.createProject` 改用 modal-scoped input 填專案名，接受已知 success dialog 作為非阻塞成功訊號，並寫 `created-project.json` 讓同 case G-02 可在新專案接續 `createReport/configure/preview/save`。新增 `collage.openReportFromProjectList` 與 `collage.clickBackToProjectList`，讓 G-04/G-05 類 project-page smoke 不再停在 manual_ai prelude。
- Planner/gate：manual hybrid D0 CSV baseline case 可串 `collage.runDateVariantsPreviewEvidence -> collage.saveReport -> collage.downloadCsvAndComparePreview`，讓 F-07 類半動態日期先走 structured date helper，再儲存並從 row 下載 CSV。helper-hints allowlist 也補 `collage.createProject`、`collage.openReportFromProjectList`、`collage.clickBackToProjectList`。
- Fixture：`scripts/verify-capability-gate.ts` 新增 F-02 save/load、G-02 create-project-then-report、G-04 report-name navigation、G-05 back button、F-07 hybrid D0 CSV baseline plan assertions。
- 版本與文件：Mac Agent 升到 `0.2.24`，App/API 維持 `1.1.5`；README、`docs/refactor/工程spac.md`、`docs/refactor/規劃說明.md` 同步更新 readonly formula keypad/token input、row-nearby CSV fallback、create-project state carryover、project-page navigation helper 與 save-load create-before-reopen guard。
- 驗證：已跑 `git diff --check`、`npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run typecheck`、`npm run build`、`npm run verify:capability-gate`、`npm run verify:helper-hints`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:helper-report-gate`、`npm run verify:case-advance-policy`、`npm run verify:package-consistency`、OTTEST004 v1.8.6 package consistency check（`status=warning`, `errors=0`）、`node agent/dist/cli.js doctor` 通過。commit/push、部署與 Agent 重啟由本批收尾回報補列。

### 2026-05-07 18:08 - OTTEST004 v1.8.9 P0/P1 helper routing 修復

- 背景：Tommy 要求接續 thread `019e0189-bf3a-7e11-ae80-9d042038e63c`，且不要讀完整舊 raw JSONL。上一窗已 review run `943a0c70-a995-4a8a-b903-c738587ee539`，指出 E-01~E-04 沒真正跑 UI、F-01 save-only 被導去 open existing report / project-list path、F-01 又被 `TOOL_BRIDGE_RESPONSE_MISSING` result gate false positive 擋下、D-02 structured select-all 未走 4 source / 72 field path，以及 B-05/B-10/B-11 日期 helper 邊界不穩。
- Gate / plan：`detectCaseFeatures` 收窄 filter 判斷，只有明確篩選/filter context 才因 operator wording 判 filter，避免公式 keypad/operator 文字誤觸 `filter_helper_not_implemented`。`helper-execution-plan` 與 `capability-gate` 讓 E-01/E-04 維持 `openProject -> createReport -> configureCalculatedMetricAndPreview`；F-01 `saveOnly` 會抑制 project-list report-name/back shortcuts、existing-report modification、reopen 與 CSV download，實際 plan 只剩 `openProject -> createReport -> configureMetric -> runPreviewAndCollectEvidence -> saveReport`。
- D/B helper params：D-02 的 `expectedSources` 會映射為 `sourceReports`，`expectedTotalFieldCount` 會映射為 select-all path 的 `expectedFieldCount=72`，並從 testcase 文字/metadata params 推出 `selectAllFields=true`，不再把 cleanup text 當 synthetic field。B-05 字串 preset array、B-11 static+preset object `dateVariants` 與 B-10 90/91 天 `stages` 都會保留到 `collage.runDateVariantsPreviewEvidence`；executor 支援 structured variant/stage spec、expected row/date range 與 `expectUiBlock`，讓 91 天 UI 阻擋可記為 boundary evidence。
- Result gate：`result-evidence-gate` 新增 `TOOL_BRIDGE_RESPONSE_MISSING` / `缺少 Tool Bridge response` / missing Tool Bridge evidence 的 negative mask。這類文字代表阻塞原因，不代表 Codex 已處理 Tool Bridge response，因此不再要求第二個 Tool Bridge response。
- Fixture：`scripts/verify-capability-gate.ts` 新增 formula helper、F-01 save-only、D-02 actual v1.8.9 structured select-all、B-10 staged 90/91、B-11 structured variants fixtures。`scripts/verify-result-evidence-gate.ts` 新增「缺少 Tool Bridge response」prose fixture。
- Actual package smoke：用 OTTEST004 v1.8.9 xlsx/md 直接產 plan，確認 E-01/E-04 supported 且 actions 為 `openProject/createReport/configureCalculatedMetricAndPreview`；F-01 supported 且 actions 為 `openProject/createReport/configureMetric/runPreviewAndCollectEvidence/saveReport`，沒有 open existing/reopen/download；D-02 degraded visible UI 但 helper pre-run allowed，actions 為 `openProject/createReport/runDateVariantsPreviewEvidence/downloadCsvAndComparePreview` 且 4 sources / 72 fields；B-05/B-10/B-11 都走 date variants helper 並保留 preset/object/stage params。
- 版本與文件：App/API 升到 `1.1.6`，Mac Agent 升到 `0.2.25`；README、`docs/refactor/工程spac.md`、`docs/refactor/規劃說明.md` 同步更新。未動 `docs/authoring/UAT_三文件撰寫規則.md`，該檔在本輪開始前已是 dirty。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run build --prefix web`、`npm run verify:all`、`npm run verify:helper-hints`、`npm run verify:helper-report-gate`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:agent-resume`、`npm run verify:final-aggregate-result`、`npm run verify:package-consistency`、`npm run verify:source-prefilled-results`、OTTEST004 v1.8.9 package consistency check（`status=warning`, `errors=0`, warnings only）、`node agent/dist/cli.js doctor` 通過。commit/push、Railway `/version` / `/health` 與本機 Agent 重啟狀態由本批收尾回報補列。

### 2026-05-07 20:45 - OTTEST004 v1.8.9 smoke-first follow-up：E formula token 與 F/G routing

- 背景：Tommy 重跑後指出 BLOCKED 仍多，尤其 E 群仍同樣議題，要求這次先 smoke test 可行 UI 路徑再 patch。先比對 run `a2980aef-c10b-431b-bd43-f1d90d94feb3` 的 report/archive 與本地 dry-run plan，確認 production/本機執行中的 agent 仍可能是舊 runtime；本地 source dry-run 的 E-01/E-04 已會走 `openProject -> createReport -> configureCalculatedMetricAndPreview`，但實際 UI smoke 發現公式 modal 點欄位 token 後 readonly input 顯示的是 field code formula，而不是 testcase display formula。
- Smoke：手動 UI path 證明 E-01 formula modal 可操作：點 base fields、開新增運算欄位、按 modal token/keypad、確認後 modal 關閉，preview request 發到 `/tileMode/preview`，request body 含 `NEW_ACCOUNTS`、`MAU` 與 calculated field formula `[NEW_ACCOUNTS]+[MAU]/2`。當前 browser auth 狀態下 preview response 為 `401 Unauthorized`，因此本次 smoke 驗證到 helper/UI/request path，未驗證 chart value。
- Formula helper：`collage.configureCalculatedMetricAndPreview` 會從 modal field-token button 的 `onclick` 解析 UI 實際插入值，並接受 testcase display formula 與 UI inserted code formula 等價；evidence 會寫 `fieldTokenMappings`、`expectedFormulaValues` 與 `matchMode=ui_inserted_token_formula`。E-01 patch 後 smoke summary 為 `status=ok`、`formulaValue=[NEW_ACCOUNTS]+[MAU]/2`、`requestCount=1`、`responseStatuses=[401]`。
- Gate / plan：F-02 same-case save/load flow 現在偵測 `saveReportNamePrefix`、`reopenViaClickReportName`、同 case 與不依賴既有報表語意，保留 `<prefix><timestamp>` 報表名，產生 `openProject -> createReport -> configureMetric -> runPreviewAndCollectEvidence -> saveReport -> reopenReport`，不再被導成 open existing/project-list path。G-01 / create-project helper 也接受 `collage.createProject` 類 dotted template，保持 `openProject -> createProject`。
- Fixture：`scripts/verify-capability-gate.ts` 新增 actual F-02 same-case save/reopen prefix fixture 與 dotted `collage.createProject` fixture；既有 F-01 save-only、D-02 structured select-all、B-10/B-11/E formula fixtures 維持通過。`scripts/verify-result-evidence-gate.ts` 仍覆蓋 `缺少 Tool Bridge response` negative wording，避免 false positive 回歸。
- 版本與文件：App/API 升到 `1.1.7`，Mac Agent 升到 `0.2.26`；README、`docs/refactor/工程spac.md`、`docs/refactor/規劃說明.md` 同步更新。未動 `docs/authoring/UAT_三文件撰寫規則.md`，該檔在本輪開始前已是 dirty。
- 驗證與部署：已跑 `npm run typecheck`、`npm run typecheck --prefix agent`、`npm run build`、`npm run build --prefix agent`、`npm run verify:capability-gate`、`npm run verify:result-evidence-gate`、`npm run verify:helper-report-gate`、OTTEST004 v1.8.9 package consistency（`status=warning`, `errors=0`, warnings only）、selected-case plan smoke（E-01/E-04/F-01/F-02/D-02/B-10/B-11/G-01）與 `git diff --check` 通過；E-01 helper smoke 通過到 UI/request 層但受當前 auth 401 限制。runtime commit `621a470` 已推 `refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp`；Railway production `/version` 為 App `1.1.7` / commit `621a470` / deployment `f41fc153-b428-48bb-ba51-061b62864485`，`/health` healthy。本機 `com.tommy.uat-agent` 已重啟至 pid `49357`，API 顯示 Tommy Mac Agent version `0.2.26` / idle，`node agent/dist/cli.js doctor` ok。

### 2026-05-08 01:05 - OTTEST004 run 83f5f3b0 Agent WebSocket 斷線韌性修補

- 背景：Tommy 提供 run `83f5f3b0-cda6-4e32-9a37-c8adbfc3c960` report/archive 後指出仍停住。檢查 helper artifact 顯示 E-01 `collage.configureCalculatedMetricAndPreview` 已真實跑 UI 並取得 `/tileMode/preview` 200 response，公式 evidence 為 `[NEW_ACCOUNTS]+[MAU]/2`、31 rows；中斷點不是 E formula helper，而是 helper pre-run 完成後、Codex 準備判定 E-01 寫 workbook 時 Agent 收到 WebSocket close 1006。
- 根因：舊 `agent/src/cli.ts` 在任意 WebSocket `closed` status 且有 active task 時直接呼叫 `activeTask.cancel("agent_connection_closed")`，導致 run 寫成 `CODEX_RUN_CANCELLED reason=agent_connection_closed`。即使只移除 cancel，舊 reconnect loop 每次建立新的 `AgentConnection`，active runner 仍持有舊 closed connection，最後也可能在 `run.completed` / `run.failed` 送出時碰到 `AGENT_WS_NOT_OPEN`。
- 修正：Mac Agent 改為同一個 `AgentConnection` 物件跨 reconnect 重用，transient close 只記 `task_continues_after_connection_closed`，不取消 active run；明確 `task.cancel` 與 SIGINT/SIGTERM 仍會取消。`AgentConnection.send()` 在 socket closed 時會 queue outbound run events，reconnect 並送出 `agent.online` 後 flush queue，確保 `run.completed` / `run.failed` 不因短暫斷線遺失。
- Smoke：新增 `npm run verify:agent-connection-resilience`，會啟本機 WebSocket server、讓 Agent connect、強制 terminate socket、在 closed 狀態送 `run.completed`、重連後確認 queued completion 被 server 收到；同時靜態 guard 禁止 `activeTask.cancel("agent_connection_closed")` 回歸。
- 版本與文件：App/API 升到 `1.1.8`，Mac Agent 升到 `0.2.27`；README、`docs/refactor/工程spac.md`、`docs/refactor/規劃說明.md` 同步更新。未動 `docs/authoring/UAT_三文件撰寫規則.md`，該檔仍維持本輪開始前既有 dirty 狀態。
- 驗證與部署：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build`、`npm run build --prefix agent`、`npm run build --prefix web`、`npm run verify:all`、`npm run verify:agent-connection-resilience`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:agent-resume`、`npm run verify:final-aggregate-result`、`npm run verify:source-prefilled-results`、`npm run verify:helper-hints`、`npm run verify:package-consistency`、OTTEST004 v1.8.9 package consistency check（`status=warning`, `errors=0`, warnings only）、`node agent/dist/cli.js doctor`、`git diff --check` 通過。runtime fix commit `49b484a` 已推 `refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp`；Railway production `/version` 驗證 App `1.1.8`、branch `codex/uat-tool-mvp`、`/health` healthy，後續 docs-only closeout commit 可能成為 active short SHA 但不改 runtime fix。本機 `com.tommy.uat-agent` 已重啟至 pid `69303`，API 顯示 Tommy Mac Agent version `0.2.27` / idle，`doctorOk=true`。

### 2026-05-08 14:20 - OTTEST004 v1.8.9 F-flow planner 修補與 auto approval evidence guard

- 背景：Tommy 同意先針對 F 區調整預期與 smoke test，上一個 thread 已留下 `agent/src/helper-execution-plan.ts` / `agent/src/task-runner.ts` dirty diff 但未完成驗證。接手後只 review 既有 dirty diff，不讀完整舊 raw JSONL，也未碰既有 dirty authoring spec 或 unrelated artifacts。
- 修正：planner 現在分清「不測另一個下載入口」與「本題完全不下載」。F-03 會用 editor-session CSV，不 save、不 reopen、不回專案頁；F-04/F-05 會同 case 建立報表、preview、儲存後從 project-row/report-list 下載 CSV，不走 open existing report 或 reopen editor。F-06/F-07/F-08 視為 D0 baseline，可 create unique report → preview/date evidence → save → project-row CSV，D+1 comparison deferred。`downloadEntry=project_page_row_download_button` / `doNotUseEditorGlobalDownload=true` 會推導 `downloadScope=report_list`；`downloadFromEditor=true` 保持 `editor_session`。
- Tool Bridge：`agent/src/task-runner.ts` 的 policy scan 現在接受 `output/tool-responses-auto*.json` 中非空 `responses` 作為 durable auto-approval evidence，避免 Mac Agent auto approval 已存在時仍被誤判 `TOOL_BRIDGE_RESPONSE_MISSING` / missing response。
- Fixture / smoke：`scripts/verify-capability-gate.ts` 補 F-03、F-04/F-05、F-06/F-07/F-08 regression assertions；`scripts/verify-tool-bridge.ts` 補 auto-response policy scan fixture。另用 OTTEST004 v1.8.9 xlsx/md 直接產 F-03~F-08 plans，確認 F-03 action chain 為 `openProject/createReport/runDateVariantsPreviewEvidence/downloadCsvAndComparePreview` 且 `downloadScope=editor_session`；F-04~F-08 action chain 為 `openProject/createReport/runDateVariantsPreviewEvidence/saveReport/downloadCsvAndComparePreview` 且 `downloadScope=report_list`，無 open existing / reopen。
- Real helper/UI smoke：補跑 F-03 editor-session CSV smoke，run `smoke-ottest004-f03-20260508055838`，artifact root `/Users/tommy/.uat-agent/runs/smoke-ottest004-f03-20260508055838/output/helper-artifacts/OTTEST004-F-03`，4/4 helper actions ok，`downloadScope=editor_session`，CSV 下載 `downloads/report_2026-05-08.csv`，preview/table vs CSV 31 rows matched。補跑 F-05 project-row CSV smoke，run `smoke-ottest004-f05-20260508060019`，artifact root `/Users/tommy/.uat-agent/runs/smoke-ottest004-f05-20260508060019/output/helper-artifacts/OTTEST004-F-05`，safe pre-run 3/3 ok，Tool Bridge auto approval evidence `output/tool-responses-auto-helper-plan.json`，continuation save/download 2/2 ok，saved report `OTTEST004_F05_202605080600`，row download CSV `downloads/OTTEST004_F05_202605080600.csv`，preview/table vs CSV 31 rows matched。
- 版本與文件：Mac Agent source 升到 `0.2.28`，App/API 維持 `1.1.8`；README、`docs/refactor/工程spac.md`、`docs/refactor/規劃說明.md` 同步更新。未動 `docs/authoring/UAT_三文件撰寫規則.md`，該檔仍為本輪開始前既有 dirty 狀態。
- 驗證：已跑 `git diff --check`、`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:capability-gate`、`npm run verify:tool-bridge`、`npm run verify:result-evidence-gate`、OTTEST004 v1.8.9 F-03~F-08 actual package planner smoke，以及上述 F-03/F-05 real helper/UI smoke。此批可 commit/push；deploy / Mac Agent restart 需另行執行後才會讓 production/local Agent 使用 `0.2.28`。

### 2026-05-08 22:20 - OTTEST004_027 BLOCKED 收斂：field identity、project/back、save/reopen evidence

- 背景：Tommy 提供最新 run `4bc8e4d7-ef87-43f8-b0c8-b6fc06c21598` report/archive，指出 BLOCKED 仍偏高但已跑完，要求先列改善項目，確認後再本地修改並必須 smoke 通過才可推。這批只處理 helper/planner/reporting 可收斂的 false BLOCKED，不改 BI 產品問題本身；既有 dirty authoring spec、demo png、artifacts、uat_results 仍不納入本批。
- Helper field identity：`bi-ui-helper-executor` 移除 selected-field substring match，改用 field code / exact label / explicit alias。`累計bf!創帳數` 對應 `CUMULATIVE_NEW_ACCOUNTS_BEANFUN`，`bf!創帳數` 對應 `NEW_ACCOUNTS_BEANFUN`，避免 H-03 只選到累計欄位就誤以為日增欄位也已滿足。field picker 會優先點 exact DOM target/code。
- Project/navigation helpers：`openProject` 新增 project-selection attempts、click/poll retry、reload retry；`createProject` 會 retry input fill、套用 BI 20 字元專案名上限、驗證 project visible + report-list ready 才回 ok；`clickBackToProjectList` 改為 back 後輪詢 URL/body/report-list readiness，並在 `locator.innerText()` timeout 時用 read-only DOM evaluate fallback 留 evidence。
- Planner/gate/report：F-02 類 manual date save/load 保留 `saveReport -> reopenReport`，同時避免 F-06/F-07/F-08 D0 report-list CSV 從 stale expected prose 繼承 reopen；manual/degraded template filter 允許必要 date-preview/save/reopen helpers。Markdown report summary/detail 使用 `classifiedCaseStatus`，讓 PM 預填本輪不執行 row 顯示 `PM_SKIPPED`。
- Real helper/UI smoke：H-03 run `smoke-ottest004-h03-field-reconcile-20260508220946` 通過 open/create/date-preview，request body 同時含 `CUMULATIVE_NEW_ACCOUNTS_BEANFUN` 與 `NEW_ACCOUNTS_BEANFUN`；A-01 run `smoke-ottest004-a01-openproject-20260508221252` 從 select-project prompt infer `拼貼test_001` 並到 report list；F-02 run `smoke-ottest004-f02-save-reopen-20260508221122` 完成 preview/save/reopen，save report `SMOKE_F02_REOPEN_202605081411`，reopen evidence 產出但 BI UI 日期仍回到 `過去7天`，正式判定應視為產品設定還原 evidence；G-05 run `smoke-ottest004-g05-back-rerun2-20260508221632` 回專案頁 `returnedToProjectList=true`；G-01 run `smoke-ottest004-g01-createproject-rerun3-20260508222359` 建立 `OTTEST004_G01_081424` 並驗證 project/list ready。
- 驗證與部署：已跑 `npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run typecheck`、`npm run build`、`npm run verify:capability-gate`、`npm run verify:source-prefilled-results`、`npm run verify:tool-bridge`、`npm run verify:result-evidence-gate`、`git diff --check` 通過。runtime commit `1dcb21d` 已推 `refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp`；Railway production `/version` 曾在 runtime commit `1dcb21d` 顯示 App/API `1.1.8`、deployment `f8f79a1b-c19b-4309-bdb0-9f7bf1f211de`，`/health` healthy。後續 docs-only closeout commit 可能成為 active short SHA，但不改 runtime fix。本機 `com.tommy.uat-agent` 已重啟至 pid `55488`，API 顯示 Tommy Mac Agent `0.2.28` / idle / `doctorOk=true`。

### 2026-05-09 03:20 - OTTEST004_029 D-01/E-03 total-refund alias helper fix

- 背景：OTTEST004_029 剩餘 6 個 BLOCKED 中，A-04/A-06/B-02/D-02 判定仍屬 metadata/UI 欄位清單大幅差異，不應用 helper 硬改成 PASS；D-01/E-03 則因 testcase/helper 目標使用 `退費總金額`，但當前 UI 與每日報表 metadata 使用 `總退費金額` / `TOTAL_REFUND` 而被 helper exact target 擋下。
- 修正：`bi-ui-helper-executor` 新增精準欄位 alias `退費總金額` ↔ `總退費金額`，兩者只映射到 `TOTAL_REFUND`；formula modal field-token 選擇改讀 `inputFormula('[FIELD_CODE]')` 並透過同一套 field identity/code matcher 精準比對，避免 `退費總金額` 誤命中 `TOTAL_REFUND_IOS` / `TOTAL_REFUND_AOS` / `TOTAL_REFUND_WEBSHOP`。新增 `verify:helper-field-aliases` fixture 覆蓋欄位 picker 與公式 token。
- Real helper/UI smoke：D-01 run `smoke-ottest004-d01-refund-alias-202605090001` 透過 visible UI 選到 `總退費金額`，preview request fields 包含 `TOTAL_REFUND` 並回 200；E-03 rerun `smoke-ottest004-e03-refund-alias-rerun2-202605090001` 透過公式 modal 點到 `inputFormula('[TOTAL_REFUND]')`，request body 送 `formula:"[NEW_ACCOUNTS]/[TOTAL_REFUND]"`，response 200、31 筆，表頭含 `總退費金額` 與 `E03_運算`。
- 版本與文件：Mac Agent source 升到 `0.2.29`，App/API 維持 `1.1.8`；README、`docs/refactor/工程spac.md`、`docs/refactor/規劃說明.md` 同步補 total-refund alias 狀態。未動既有 dirty `docs/authoring/UAT_三文件撰寫規則.md` 與 unrelated artifacts。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:capability-gate`、`npm run verify:helper-hints`、`npm run verify:result-evidence-gate`、`npm run verify:helper-report-gate`、`npm run verify:helper-field-aliases`、`git diff --check` 通過。Tommy 已於 2026-05-09 授權 push/deploy；後續需推 `refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp`，等 Railway `/version` 進到新 commit 後重啟本機 Mac Agent。

### 2026-05-09 11:05 - OTTEST004_030 後續優化分級：暫不開發

- 背景：Tommy 檢視 OTTEST004_030 後認為目前版本已很不錯，要求先把可優化項目寫入規劃，但不要進行開發。OTTEST004_030 已從前一輪 `PASS 28 / BLOCKED 6` 收斂到 `PASS 29 / BLOCKED 5`，D-01/E-03 refund alias 已 PASS；剩餘 A/B/D metadata/source list 差異、B-10 91 天仍送 request、F-02 save/reopen restore、E-02 分母全 0 證據不足，分別屬於產品/metadata、真產品 bug 或 testcase/data 設計問題，不應再用 helper 放寬處理。
- 規劃：`docs/refactor/規劃說明.md` 新增 OTTEST004_030 後續優化停看聽，將候選項目分成三類：report-only 低風險（`PM_SKIPPED` 顯示一致、report 執行時間、artifact archive path）、evidence-only 低到中風險（F-02 多記 save/reopen response、E-02 分母全 0 提示）、以及暫不建議預設啟用的高風險項（A-06 count mismatch 後繼續診斷、D-02/B-02 metadata 大差異後繼續 preview/CSV、放寬 fuzzy matching、E-02 自動換分母、壓掉 B-10 warning）。
- 當時決策：本批先只記錄 planning，不碰 runtime code、不調 helper、不改判定、不部署、不重啟 Mac Agent。2026-05-12 文件整理時補入 Git，不代表新增 runtime 變更；後續若 Tommy 明確要求做報告品質，優先只做 report-only 三項，並用既有 run 重新產報告確認 case 統計完全不變。
- 驗證：文件變更後只需跑 `git diff --check`。因無 runtime、schema、result parser、helper 或 Agent 行為變更，不需 typecheck/build/smoke。

### 2026-05-12 07:56 - Dev Agent 子 Codex Playwright MCP 注入與 dev launchd 分離

- 背景：prod/dev split 後，Railway dev / Vercel dev / dev Agent config 已可連線與 dispatch，但 interactive A-01 preflight run `ac88dd69-5aa4-4c99-8dcb-011c8b19a602` 在子 Codex 內判定 `TOOL_EXECUTION_UNAVAILABLE`。回查子 Codex argv 發現 Agent 只用 `-c mcp_servers.playwright.args=...` 覆寫 CDP args，沒有同步覆寫 `mcp_servers.playwright.command` 與 browser tool approval config；因此 child Codex runtime 可能拿不到完整 Playwright MCP server 定義。
- 修正：`agent/src/codex-runner.ts` 現在在有 Chrome CDP endpoint 時，會明確注入 `mcp_servers.playwright.command`、CDP-backed args（`--cdp-endpoint`, `--shared-browser-context`, `--save-session`, `--output-dir`）與 browser MCP tool approval settings。command 優先使用 `UAT_AGENT_PLAYWRIGHT_MCP_COMMAND`，否則使用 `~/.local/node_modules/.bin/playwright-mcp`，最後 fallback `playwright-mcp`。
- Fixture：`scripts/verify-agent-resume.ts` 新增 fake Codex argv assertion，確認 child Codex 啟動參數同時包含 Playwright MCP command、CDP args 與 `browser_tabs` approval config，避免只注入 args 的回歸。
- Dev launchd：本輪目標是建立獨立 dev Agent 常駐服務 `com.tommy.uat-agent-dev`，使用 `/Users/tommy/.uat-agent-dev/config.json`、`/Users/tommy/.uat-agent-dev/runs` 與 dev Chrome profile，不與 production `com.tommy.uat-agent` 混用。此步只建立/驗證服務，不跑 Galaxy BI smoke。
- 版本：Mac Agent source 升到 `0.2.30`；App/API 仍維持 `1.1.8`。本批不碰 production branch、production Railway、production Agent config。

### 2026-05-12 11:22 - Dev MCP preflight smoke 通過，允許 promote production

- 背景：Tommy 授權先在 dev 驗證 Mac Agent MCP 修正，再決定是否一次 promote production。第一次使用 `dispatch-smoke` 的 no-package run `dev_mcp_preflight_smoke_20260512T031457Z` 被 package gate 擋住，原因是缺 xlsx/md package，這不是 MCP 失敗。
- Smoke package：建立 dev-only 最小 package `/Users/tommy/.uat-agent-dev/smoke-packages/dev_mcp_preflight_20260512T031807Z`，只含 `MCP-01` 觀察 case，禁止登入、欄位設定、執行、baseline、儲存或刪除。
- Real Agent smoke：Railway dev run `5e420973-8462-4077-8fd7-e33e19a5fe08` 通過，`MCP-01` 結果為 `PASS`。子 Codex 成功呼叫 Playwright MCP `browser_tabs(action=list)`，回傳 tab `報表管理系統`，接著用 `browser_run_code` 只讀 DOM，取得 URL `https://galaxy.games.gamania.com/biapi-dev/testview/home?gameID=541`、title `報表管理系統`、非空 body，未偵測 login / 401 / 403 / blank / 載入失敗，classification=`reachable_galaxy_bi`。
- Evidence：result workbook 位於 `/Users/tommy/.uat-agent-dev/runs/5e420973-8462-4077-8fd7-e33e19a5fe08/output/result.xlsx`，detail_json 包含 `currentRunEvidence.browserTabs`、lease `windowName`、observed URL/title 與 classification。Railway dev summary 顯示 `SUCCEEDED`、`caseStats.PASS=1`、`resultXlsxAvailable=true`、`logAvailable=true`、`timingSummaryAvailable=true`。
- 結論：Dev Agent MCP runtime fix 已證明有效，可以 promote 到 production branch。Production promote 仍需維持 prod/dev service 分離：production `com.tommy.uat-agent` 繼續使用 `/Users/tommy/.uat-agent` 與 production Railway，dev `com.tommy.uat-agent-dev` 繼續使用 `/Users/tommy/.uat-agent-dev` 與 Railway dev。

### 2026-05-12 20:42 - FAIL-to-Bug result contract 與 server fallback 修正

- 背景：Tommy 指出 `FAIL` case 沒有寫到 Bug 區，要求修正 Codex/result workbook path 與 server ingest fallback，同時避免 duplicate，且 ordinary `BLOCKED` 不應預設自動產 bug。
- Agent result contract：`agent/src/result-writer.ts` 會在 `FAIL` result 缺少 Bug row 時補 linked Bug row，描述內含 `auto_generated_from_fail=true`、`source=agent_result_writer`、`case_no`、`case_title`、status `OPEN` 與 detail_json 摘要。`agent/src/result-contract.ts` / normalizer / self-check 會阻擋無 linked Bug row 的 FAIL result。
- Server fallback：新增 `src/result-parser/fail-bug-fallback.ts`，server ingest / final aggregate 會為沒有 Bug row 的 FAIL 產生 clearly marked fallback bug candidate；若 Codex/Agent 已寫 Bug row，不再 duplicate。PASS 與 ordinary BLOCKED 不自動產 bug；只有 detail 明確要求 defect tracking 的 BLOCKED 才以 `auto_generated_from_blocked_defect=true` 產 candidate。
- 文件與 prompt：更新 Layer 1 result 規則與 BI startup prompt，明確 FAIL 必須連到 Bug sheet；新增 `scripts/verify-fail-bug-fallback.ts` 與 npm script `verify:fail-bug-fallback`。
- 驗證：已跑 `npm run typecheck`、`npm run build`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:final-aggregate-result`、`npm run verify:fail-bug-fallback`、`git diff --check` 通過。dev commit `9ec1d66` 已推 `dev/uat-agent-config-isolation`，等待 dev UAT smoke。

### 2026-05-12 21:35 - Save/List evidence 與 E-02 全 0 計算判定修正

- 背景：Dev run 初步證明 Bug 區塊出現，但 Tommy 指出 `BLOCKED` 變多，需要釐清 F-01 save/list evidence 與 E-02 全 0 除法判定。結論是 F-01 不應要求舊 helper 額外補 `reportListEvidence` 才能判斷；E-02 應由 testcase/資料設計決定是否需要非 0 分母，不應由 helper 自動找資料或把 BI divide-by-zero=0 視為工具錯。
- Save/list：`collage.saveReport` 與判定 guidance 接受 current-run save API 200、成功 dialog、回清單 row text、`reportListFound=true` / `reportListEvidence.found=true` 作為 F-01 類 PASS evidence；不再因舊 helper 缺精確欄位而誤 BLOCKED。
- Calculation judgment：公式/數據邏輯 case 分成「工具功能可用」與「資料辨識力」。若命題只測運算欄位功能，分母全 0 且結果依 BI divide-by-zero=0 回 0 可視為合理；若命題要證明逐日計算不同於 `sum/sum`，testcase 必須要求可辨識樣本。
- Authoring：後續應請 Claude 調整 E-02 testcase 寫法，而不是由 helper 改資料或換欄位。此原則後續寫入 `docs/authoring/UAT_三文件撰寫規則.md`。
- 驗證：新增 `scripts/verify-save-calculation-judgment.ts` / `verify:save-calculation-judgment`，並跑 typecheck/build、result contract/evidence/final aggregate、fail-bug fallback 與 `git diff --check` 通過。dev commit `fca4a6c` 已推 `dev/uat-agent-config-isolation`。

### 2026-05-12 22:31 - Harden openProject retry 與 authoring rule 更新

- 背景：Tommy 比對 dev run `da77b99a-f05f-46ac-b1ef-55d15043cd46` 與 prod run `b1d14a3c-83f4-4a92-96c7-2f0d16caa4e2` 後，確認 E-02 後續交由 Claude/testcase 調整；Codex 工具側需修的是 `openProject` retry。另 Tommy 要求 `UAT_三文件撰寫規則.md` 補上公式/數據 case 的命題大方向。
- openProject：`agent/src/bi-ui-helper-executor.ts` 新增 prompt/readiness 判斷。含 `請從左側選擇專案查看報表` 的頁面不是 ready state；`+ 新增報表` 必須在 prompt 消失後才算 report list ready。helper 會記錄 attempts、點 visible project candidate、reload/reselect 後再確認 readiness。`createReport` 也沿用此 readiness 判斷，避免 prompt-only 頁面被誤當可新增報表。
- Authoring：`docs/authoring/UAT_三文件撰寫規則.md` 新增公式/數據邏輯 case 必須區分工具功能可用性與資料辨識力，並明寫 divide-by-zero=0 是否是可接受 PASS evidence；若需證明非 `sum/sum`，testcase 必須要求非 0 分母與可辨識資料。
- 驗證：新增 `scripts/verify-open-project-retry.ts` / `verify:open-project-retry`。已跑 `npm run typecheck`、`npm run build`、`npm run build --prefix agent`、`npm run verify:open-project-retry`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:fail-bug-fallback`、`npm run verify:final-aggregate-result`、`npm run verify:save-calculation-judgment`、`git diff --check` 通過。
- Push：dev commit `8c476f3` 已推 `dev/uat-agent-config-isolation`。同一 authoring 文件變更後續隨 production promote 同步到 prod branch；未在未授權前 push/deploy/restart prod。

### 2026-05-13 07:18 - Dev run 530 驗證與 production promote

- Dev validation：Tommy 於 dev 跑 run `530daae6-4b4e-4bcb-9b85-151b9a110dd8`。報告為 PASS 5 / FAIL 2 / BLOCKED 1；工具修復點均成立：F-01 與 G-02 save/list evidence PASS，E-01 formula/openProject path PASS，A-06 ordinary BLOCKED 沒有自動產 bug，A-01/E-02 兩個 FAIL 都出現在 Bug 摘要。
- 結論：A-01 是有效 source-list drift FAIL；A-06 是 testcase/metadata expected count mismatch；E-02 是 testcase 命題需由 Claude 調整，不是工具側再改。此 run 證明 FAIL-to-Bug、duplicate guard、save/list evidence 與 openProject retry 可 promote。
- README：Tommy 提供 `/Users/tommy/Downloads/README.md` 新版精簡說明，套入 repo `README.md`。
- Production promote：commit `1d3f90c` 推到 `dev/uat-agent-config-isolation`、`refactor/mac-agent-mvp`、`codex/uat-tool-mvp`。Railway production `/version` 顯示 branch `codex/uat-tool-mvp`、commit `1d3f90c`，`/health` healthy。
- 本機 prod Agent：`/Users/tommy/Downloads/codex_galaxy/uat-tool` fast-forward 到 `origin/refactor/mac-agent-mvp`；原本 untracked demo/artifacts 保留不動。已跑 prod repo `typecheck`、root/agent `build`、`verify:open-project-retry`、`verify:fail-bug-fallback`、`verify:save-calculation-judgment`、`verify:agent-result-contract`、`git diff --check`。重建 `agent/dist` 後重啟 `com.tommy.uat-agent`，新 pid `18653`，log 顯示重新 connected。

### 2026-05-15 03:35 - 新功能 Domain Pack 生成流程與常駐觸發規則

- 背景：Tommy 指出未來每新增一個功能或正式 UI 測試 domain,不能再靠單一對話框臨場追問「還缺什麼資料」。本次 BI 正式 UI / 拼貼模式是第一個從既有單一 BI domain 走向新 domain pack 的實例,因此同步建立可重複的作業流程。
- Domain pack：新增 `domain-packs/BI_OFFICIAL_UI_COLLAGE/` 並推 dev,包含 `AGENTS.md`、`startup_prompt_template.md`、`xlsx_schema.json`、`result_parser_adapter.json`、locator guidance 與 README。Railway dev `/api/domains` 已顯示 `BI_OFFICIAL_UI_COLLAGE valid=true`。
- Authoring workflow：新增 `docs/authoring/新功能_DomainPack_生成流程.md`,定義角色分工、是否需要新 domain pack 的 Phase 0、intake 決策 gate、規則拆層、Claude 出題資料包、dev smoke 與 prod promote gate。新增樣板 `docs/authoring/domain-pack-templates/`，包含 intake、boundary rules、Claude request、completion checklist。
- Tooling：新增 `npm run create:domain-pack` 與 `npm run verify:domain-pack`,可建立新 domain pack 骨架並檢查 required files、JSON、startup prompt、AGENTS scope / irreversible policy 等最低條件。`BI_OFFICIAL_UI_COLLAGE` verifier 為 PASS。
- 常駐規則：`AGENTS.md` 與 `uat-tool/AGENTS.md` 新增 domain pack generation trigger。未來 Tommy 提到新功能 domain pack、新 UI/工具導入 UAT Tool、或請 Claude 產新 domain 三文件時,Codex 必須先讀 domain pack 生成流程與 templates,不可依賴 chat 記憶。
- 驗證與部署：已跑 `npm run verify:domain-pack -- --name BI_OFFICIAL_UI_COLLAGE`、`npm run typecheck`、`npm run build`、scaffold 暫存目錄 smoke、`git diff --check` 通過。dev commits `c73f507`、`f659856` 已推 `dev/uat-agent-config-isolation`；本批常駐規則補強後續仍只推 dev,不碰 production branch。

### 2026-05-15 03:55 - Web UI domain pack 選擇接線

- 背景：Tommy 詢問「線上工具是否透過提供多個 domain pack 讓 PM 選要測的功能」以及正式 UI domain pack 還缺什麼。檢查後發現 backend / Agent 已支援 run.domain 與 `/api/domains`,但 Web UI 建立 run 表單尚未載入 domain list,送出也未帶 `domain`,因此新 run 會落回預設 `BI`。
- 修正：Web UI 建立 run 表單新增 `Domain Pack` select,從 `/api/domains` 載入 valid packs；送出 `POST /api/runs` 時帶 `domain`。選 `BI_OFFICIAL_UI_COLLAGE` 時,若 Dev URL 仍是已知預設值或空值,自動切成 `https://galaxy.games.gamania.com/bi-dev/zh-TW/home`。Run history 與 summary 顯示 domain。
- Backend guard：`POST /api/runs` 與 conversation push-to-run 會驗證 domain pack 存在,不存在回 `DOMAIN_NOT_FOUND`,避免建立出 dispatch 後才缺 domain files 的 run。
- 驗證：已跑 `npm run typecheck`、`npm run build`、`npm run build --prefix web`、`git diff --check`。本機啟動 API + Web smoke,建立 run 表單看到 `Galaxy BI` / `Galaxy BI Official UI Collage`,選正式 UI pack 後 Dev URL 自動變為 `https://galaxy.games.gamania.com/bi-dev/zh-TW/home`,截圖 `artifacts/domain-pack-selector-smoke.png`。本批待推 dev,不碰 prod。

### 2026-05-16 18:20 - Topbar release metadata panel

- 背景：Tommy 希望在左上角 `DEV` 標籤旁顯示部署資訊,讓 dev/prod 狀態不用靠口頭記憶判斷。DEV 需顯示版本號、是否已推 prod、dev smoke 是否通過、版本更新日期；PROD 只顯示版本號與版本更新日期。
- Backend：`/version` 新增 `version.commitDate` / `version.updatedAt` 與 `rollout` 區塊。更新日期以 git commit date 優先；Railway runtime 若沒有 local git metadata,會用 `VERSION_GITHUB_REPOSITORY` + commit SHA 讀 GitHub commit date,`BUILD_TIME` 只作 fallback。DEV deployment 會以 `PROD_VERSION_URL` 讀 production `/version` 並比對 short commit 判斷 `pushed` / `not_pushed` / `unknown`；dev smoke 狀態只讀 env (`DEV_SMOKE_STATUS`, `DEV_SMOKE_COMMIT_SHA`, `DEV_SMOKE_PASSED_AT`),不由工具自行推測。
- Web UI：topbar `DEV/PROD` pill 旁新增 release panel。DEV 顯示 `版本`、`Prod`、`Smoke`、`更新`；PROD 顯示 `版本`、`更新`。panel 支援 title tooltip 與 mobile wrap,避免 header overflow。
- 驗證：已跑 `npm run typecheck`、`npm run build --prefix web`、`npm run build`、`git diff --check`。本機 API/Web smoke 讀到 `/version` commit `1455906`,DOM 檢查 release panel 顯示 `版本1.1.8 (1455906) / Prod未知 / Smoke未標記 / 更新2026/5/15 03:55:43`,無 console error、desktop 無水平 overflow。dev push 後 Railway dev `/version` 顯示 commit `d42ab68`,`production.status=not_pushed`,`devSmoke.status=unknown`；後續 commit-date fallback 修正將讓 `updatedAt` 顯示 GitHub commit date 而非 Railway stale `BUILD_TIME`。本批目標先推 dev,不碰 prod promote。

### 2026-05-16 18:50 - Dev URL dedicated Chrome open button

- 背景：Tommy 希望在建立 Run 表單的 `Dev URL` 欄旁新增「開啟連結」,先用正式跑測同一套瀏覽器/profile 開頁並完成登入,避免正式 case 開始後才卡在 SSO 或「載入資料失敗」。此功能不能用一般前端 `window.open`,否則登入狀態會留在使用者目前瀏覽器,不一定進入 Mac Agent / Playwright 專用 profile。
- Web UI：`Dev URL` input 右側新增 `開啟連結` button；按鈕使用目前選取的在線 idle Agent。若 URL 無效、未選 Agent、Agent busy、doctor fail、Chrome profile 不 ready 或 Agent 版本未支援 `browser_open_url`,按鈕 disabled 並在 title/錯誤訊息提示原因。
- Backend / Agent：新增 `POST /api/agents/:id/open-url`,送 `browser.open_url` WebSocket message 給 Agent。Agent `0.2.31` 支援 `browser_open_url`,用 dedicated Chrome profile 與 CDP 開啟 URL,reset tabs 後開單一頁；不建立 UAT run、不寫 result workbook、不改 testcase 狀態。
- 驗證：已跑 `npm run typecheck`、`npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run build --prefix web`、`npm run build`。後續需推 dev 後重啟 dev Agent,再用 Vercel dev UI 實際點 `開啟連結` 做 dedicated Chrome smoke。

### 2026-05-16 21:05 - Dev URL open cold Chrome CDP wait fix

- 背景：Tommy 實測 `開啟連結` 只會開啟 dedicated Chrome,但沒有帶入 Dev URL。回查 dev Agent log,WebSocket message 已收到且 URL 正確,但 Agent 回報 `CHROME_CDP_UNAVAILABLE`；原因是 cold Chrome 啟動後,CDP 有時超過原本 5 秒等待才 ready,導致 Agent 放棄建立 target,只留下空白 Chrome 視窗。
- 修正：Agent `openUrlInDedicatedChrome` 將 cold Chrome CDP ready timeout 拉長到 15 秒,`/json/new` 開 target timeout 拉長到 5 秒；若 `ensureChromeDebugSession` 第一次回傳 null,會再針對同一 CDP endpoint 做一次等待並接續開 URL,避免 Chrome 已啟動但 CDP 稍晚 ready 時漏開頁面。
- 版本：Mac Agent source 升到 `0.2.32`。本修正只影響 browser preparation action,不改 UAT run dispatch、result workbook 或 testcase 狀態。

### 2026-05-16 23:58 - BI official UI collage picker extraction 修正

- 背景：BIUI_COLLAGE_R001 A-04 在正確選擇 `BI_OFFICIAL_UI_COLLAGE` domain pack 後仍被 helper 擋住。`openProject` 與 `createReport` 已可進 official `/bi-dev/zh-TW/report/new`,但 `collage.extractMetadataDropdownFields` 仍沿用 legacy `+ 新增欄位` / `addFieldToSelection` 假設,導致 official editor 回 `METADATA_DROPDOWN_NO_VISIBLE_ITEMS_EXTRACTED`。
- 根因：official UI 的欄位流程不是「點 + 新增欄位展開全部來源欄位」。正確流程是第一列先點 `請選擇報表`,選 source,再點該列 `---` 欄位 picker。A-04 的 metadata source `各登入渠道狀況(原 beanfun! 導流)` 在 official UI 顯示為 `beanfun!導流`。
- 修正：`agent/src/bi-ui-helper-executor.ts` 新增 official collage editor adapter。它會偵測 `/bi-dev/.../report/new`,讀 first-row source/field controls,用 source aliases 選 `beanfun!導流`,驗證 control 文字變更,再打開 `---` 欄位 picker並讀 clickable field rows。欄位 row 文字如 `累計帳號數 數值` 會清掉中文 type badge 後寫入既有 `metadataDropdownEvidence.actualVisibleItems`。legacy `/biapi-dev/testview` 的 `addFieldToSelection` 路徑維持不變。
- Alias / fixture：source identity 新增 `beanfun!導流` / `LOGIN_PLATFORM_STATUS` / `各登入渠道狀況` / `各登入渠道狀況(原 beanfun! 導流)` 正規化,以及 `雙平台營收占比` / `雙平台營收佔比` 正規化。`scripts/verify-open-project-retry.ts` 補 fixture 鎖住 official source alias 與中文 type badge 清洗。
- Smoke：已跑 `npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run verify:open-project-retry`、`npm run verify:helper-field-aliases`、`git diff --check`。Live official smoke 從 home 重跑 `collage.openProject -> collage.createReport -> collage.extractMetadataDropdownFields`: openProject `ok`, createReport `ok`, extract `ok`, selected source=`beanfun!導流`, `actualCount=27`, `missingSources=[]`, warnings empty。
- 結論：A-04 不再是 helper DOM blocker。修復後留下的 `missingCount=16` / `extraCount=16` 是 metadata v1.2.5 與 official UI 實際欄位清單的差異 evidence,需由 testcase 判定層處理,不是 `METADATA_DROPDOWN_NO_VISIBLE_ITEMS_EXTRACTED`。
- Push：dev commit `24e37c9 fix: support official BI field picker extraction` 已推 `dev/uat-agent-config-isolation`;本次只推 dev,未推 prod。

### 2026-05-16 23:59 - Domain UI Contract / Helper Gen3-Gen4 plan recorded

- 背景：Tommy 針對 BIUI_COLLAGE_R001 run `67990303-2c1b-4559-924a-297a089b5949` 指出兩個主問題應用通用方式解決：helper 通用能力不足造成大量 `VISIBLE_UI_CLICK_BLOCKED: text="新增帳號數"` BLOCKED，以及 result gate / 上傳契約在 F-01 類 BLOCKED case 出現 `TOOL_BRIDGE_RESPONSE_MISSING` false positive。Tommy 也提出 Domain UI Discovery / UI Contract 應屬於 domain pack lifecycle,不只是 testcase 生成前的臨時資料。
- 決策：新增 planning 文件 `docs/planning/domain-ui-contract-helper-gen3-gen4-plan.md`。完整方向定為五層：Domain UI Discovery -> Domain UI + Action + Evidence Contract -> Gen 3 Domain-driven Helper Templates -> Gen 4 Stable Core + Action Interpreter -> Cloud Feedback Loop。
- 架構邊界：domain pack 不提交 executable helper code；domain pack 應提交 declarative UI/action/evidence contract、helper templates、locator registry、lint rules。stable core 負責 session lease、Tool Bridge、不可逆 guard、artifact/screenshot、DOM/network read；action interpreter 只執行 allowlisted declarative actions。
- 短期 bridge：BI official collage 先以未來 schema 形狀修當前 blocker，包括 `setMetricRows(metrics[])`、legacy `field/sourceReport` 正規化到 `metrics[]`、picker stale signature evidence、result gate 只檢查實際執行/evidence 欄位、package lint 要求 `metrics[].sourceReport + metrics[].field`。
- 文件同步：`docs/refactor/工程spac.md` 新增第 26 節；`docs/authoring/新功能_DomainPack_生成流程.md` 在 domain pack 建立流程補 UI / action / evidence contract 要求。

### 2026-05-17 00:30 - BI official UI contract Gen1a/Gen1b wiring

- Gen1a：`BI_OFFICIAL_UI_COLLAGE` domain pack 新增 `ui-contract.json`、`action-contracts/setMetricRows.json`、`evidence-schema.json`、`lint-rules.json`、`discovery/page-map.json`、`discovery/component-inventory.json`。內容先是 reviewed draft seed,聚焦 official collage row-scoped `metrics[].sourceReport + metrics[].field`、stale picker blocker、conditional Tool Bridge evidence。
- Gen1b：domain loader / API / run input / Agent download filename / run brief / reference-index / rule-index 已接 optional contract files。建立 run 時若 domain pack 有這些檔案,Agent 會下載到 `input/domain_ui_contract.json`、`input/domain_action_set_metric_rows.json`、`input/domain_evidence_schema.json`、`input/domain_lint_rules.json`、`input/domain_discovery_page_map.json`、`input/domain_discovery_component_inventory.json`。
- Tooling：`create:domain-pack` 新增 generic UI/evidence/lint/discovery scaffold；`verify:domain-pack` 會解析 contract JSON,並對 `BI_OFFICIAL_UI_COLLAGE` 缺 contract files 提醒。authoring 文件與 domain README 同步記錄固定 optional 檔名。
- 範圍：本批只讓 contract 進入 domain pack 與 run/Agent 可讀面,尚未把 helper 行為改成 Gen3 template 或 Gen4 interpreter。下一步仍是短期 bridge: `setMetricRows(metrics[])` helper 實作與 result evidence gate false-positive 修正。

### 2026-05-17 01:10 - BI official UI `setMetricRows` bridge 與 result gate 修正

- Helper：`agent/src/bi-ui-helper-executor.ts` 新增 `metrics[]` / legacy `sourceReport + field` 正規化。official collage editor 會優先用 row-scoped source report picker -> field picker 流程設定 metric rows,並輸出 `metric-rows-evidence.json`。套用範圍包含 `collage.configureMetric`、`collage.runDateVariantsPreviewEvidence`、`collage.configureCalculatedMetricAndPreview` 的 base fields、`collage.inspectAllZeroFields` 的明確 metric rows。
- Preview guard：`ensureMetricFieldSelectedBeforeExecute` 不再只看 legacy remove-field buttons；official UI 已選 source/field 的 metric row 也會列入 selected-field precondition evidence,避免正確設定後仍被誤判 `EXECUTE_PRECONDITION_NO_SELECTED_FIELDS`。
- Result gate：`src/result-parser/result-evidence-gate.ts` 的 Tool Bridge response gate 只看實際執行/evidence 文字；`測試目的`、`設定條件`、`預期行為` 裡提到 Tool Bridge/native dialog 不再觸發 `TOOL_BRIDGE_RESPONSE_MISSING`。若 `實際行為` 聲稱 Tommy 已授權刪除/覆寫/native dialog,仍會要求 Tool Bridge response 或外部 Tool Bridge event evidence。
- 驗證：新增/更新 fixture 鎖住 `metrics[]` 正規化、official selected row precondition、Tool Bridge expected-prose false-positive。已跑 agent/root typecheck、agent/root build、`verify:open-project-retry`、`verify:result-evidence-gate`、`verify:capability-gate`、`verify:agent-result-contract`、`verify:helper-report-gate`、`verify:source-prefilled-results`、`git diff --check`。

### 2026-05-17 01:35 - BI official UI contract Gen1c hardening before next live UAT

- Package lint：`agent/src/test-package-consistency.ts` 會讀取 run workspace 的 `input/domain_lint_rules.json`,並依當輪 `domain` 套用 domain lint rules。CLI `check:package-consistency` 新增 `--domain` 與 `--domain-lint-rules`,fixture 已覆蓋 official collage `metrics[]` 合格與 legacy top-level `sourceReport + field` 警告情境。
- Domain contract verifier：`verify:domain-pack` 不再只 parse JSON；現在會驗證 `ui-contract.json`、`action-contracts/setMetricRows.json`、`evidence-schema.json`、`lint-rules.json`、`discovery/page-map.json`、`discovery/component-inventory.json` 的關鍵欄位與 `setMetricRows` blocker codes。
- Result gate：新增 structured `executionState` hook。`nativeDialogReached` / `irreversibleActionReached` / `overwriteConfirmReached` / `deleteConfirmReached` 必須有 Tool Bridge response；`setupBlocked` / `previewNotReached` / `saveNotReached` 不要求。負向文字如「未附 Tool Bridge response」不再被誤當 response evidence。
- Domain lint rules：`BI_OFFICIAL_UI_COLLAGE/lint-rules.json` 補齊實際 helper operation templates,包含 `collage_build_preview_save_reopen`、`download_csv_verify`、`collage.configureCalculatedMetricAndPreview` 等,讓規則跟現有 helper hints 命名一致。
- 驗證：已跑 `npm run typecheck`、`npm run typecheck --prefix agent`、`npm run build`、`npm run build --prefix agent`、`npm run verify:domain-pack -- --name BI_OFFICIAL_UI_COLLAGE`、`npm run verify:package-consistency`、`npm run verify:result-evidence-gate`、`npm run verify:open-project-retry`、`npm run verify:capability-gate`、`npm run verify:agent-result-contract`、`npm run verify:helper-report-gate`、`npm run verify:source-prefilled-results`、`git diff --check`。

### 2026-05-16 - BI official UI run 4bf frontend observation routing guard

- 背景：run `4bf277d7-6193-4943-9770-fc317a11ee1f` 證明 full live UAT 仍不可放行。大量 I/J 類前端觀察、側欄、專案頁 list/button case 因缺少 per-case helper hints,被 fallback 成 `collage.openProject -> collage.createReport -> collage.configureMetric -> collage.runPreviewAndCollectEvidence`,最後以 `EXECUTE_PRECONDITION_NO_SELECTED_FIELDS` BLOCKED。這不是產品結果,是 helper planner 錯路由。
- 修正：`capability-gate` 與 `helper-execution-plan` 新增 no-hints frontend observation prelude guard。若 case 是 official collage 前端呈現/觀察題,且屬專案頁、側欄、list、button、modal、hover、pagination 等 observation 類型,helper 只允許安全前置導航；專案/list 類只跑 `collage.openProject`,editor 初始狀態觀察類最多跑 `collage.openProject + collage.createReport`。不得自動落入 generic `configureMetric/runPreview`。
- 保留：metadata dropdown、explicit helper templates、後端 preview/data case、CSV/download/save/reopen/formula case 不受此 guard 影響,仍走既有專用 helper path。
- 回歸：`scripts/verify-capability-gate.ts` 加入 `BIUI_COLLAGE_R001-J-12` no-hints fixture,鎖定 `supportStatus=degraded`、`supportedHelperTemplates=[collage.openProject]`、helper plan 不含 `createReport/configureMetric/runPreview`。另以 run 4bf 的實際 `input/current-case.json` 重產 plan,確認 J-12 actions 只剩 `collage.openProject`。
- 驗證：已跑 `npm run verify:capability-gate`、`npm run typecheck`、`npm run build --prefix agent`。`npm run verify:helper-hints` 未執行成功,原因是 dev repo layout 下 fixture 仍找 `/Users/tommy/Downloads/codex_galaxy_dev/outputs/generate_current_case_prompt.mjs`,該腳本不在此路徑；與本次 routing guard 無關。

### 2026-05-16 - BI official UI A-06 select-all smoke hardening

- 背景：Tommy 要求在放行前用 live smoke 證明 `BIUI_COLLAGE_R001-A-06 / B-04 / E-04 / F-01 / G-01` 都可走完。A-06 初始仍會在 official editor 欄位 picker 中段 blocked,包含 `平台總營收` / `線下商城GASH總營收` 等 metadata 名稱與 official UI display label 不一致、picker 在 viewport 底部、以及 final count 用可見 rows 誤判的問題。
- Helper 修正：`bi-ui-helper-executor` 的 field alias 搜尋改為保留 display-query 變體,支援 `線下商城 GASH/CODAPAY/樂豆點` 這類 official UI spacing；大量 row-scoped `setMetricRows` 會先補 buffer rows,避免目前列在 scroll container 底部導致 picker 選項不可見；final select-all gate 改採 `metric-rows-evidence.selections[].verified` 數量,可見 rows 只留診斷,避免 scroll viewport 只顯示 13 列時誤判 expected 32 不符。
- Fixture：`scripts/verify-helper-field-aliases.ts` 新增 offline mall search-query regression,鎖住 `線下商城GASH總營收 -> 線下商城 GASH 總營收` 與 `線下商城Coda總營收 -> 線下商城 CODAPAY 總營收`。
- Live smoke：A-06 run `/Users/tommy/.uat-agent-dev/runs/live-smoke-a06-rerun20-20260516195045` 通過 `openProject -> createReport -> inspectAllZeroFields`; preview request 送出 32 個 field code,包含 `TOTAL_REVENUE_WEBSHOP_GASH`, `PAYMENT_ACCOUNTS_WEBSHOP_GASH`, `TOTAL_REVENUE_WEBSHOP_CODAPAY`, `TOTAL_REVENUE_WEBSHOP_BEANPOINT`, `TOTAL_REVENUE_WEBSHOP_BEANPOINTHK` 等,狀態 `ok`,僅保留 `DATE_UI_CONTROL_TEXT_NOT_FOUND` warning。
- Regression smoke：run `/Users/tommy/.uat-agent-dev/runs/live-smoke-regression-befg-20260516195912` 通過 `BIUI_COLLAGE_R001-B-04`、`E-04`、`F-01`、`G-01`。B-04 warnings 為既有 date UI 文案：`DATE_UI_REPRESENTED_RANGE_NOT_VISIBLE` / `DATE_UI_CONTROL_TEXT_NOT_FOUND`; E-04 warning 為 `DATE_UI_CONTROL_TEXT_NOT_FOUND`; F-01 preview/save 與 G-01 createProject 均 `ok` 且無 warnings。
- 驗證：已跑 `npm run typecheck --prefix agent`、`npm run build --prefix agent`、`npm run verify:helper-field-aliases`、`git diff --check`。本批仍只推 dev,不推 prod。

### 2026-05-17 - Scope-aware Domain Contract refinement after run 814

- 背景：BIUI_COLLAGE_R001 run `81455108-f612-4024-9d71-4f1995e08d7a` 至少完整跑完,但 Tommy 的人工 checkreport 指出大量 BLOCKED 與判斷錯誤。這不是單一 helper bug；主要類型是 agent planning / helper fallback / result gate 三層沒有理解 case scope。
- 典型問題：K/I/J/L/M/N 類 UI observation case 被 preview-only evidence 牽引,出現以 `selectedMetricFields=0` 直接 BLOCKED 的錯誤。這個值可以是 UI 狀態 evidence,但若 case scope 不需要 preview,它不是 blocker。B 類能展開設定而 L 類不會,也必須先檢查 B 有明確 helper hints / L 缺少 action template 或 case section,不可直接判成產品 UI 不可達。
- 決策：原本 `Domain UI Discovery + UI Contract + Action Template + Evidence Contract` 方向繼續走,但補成 scope-aware contract stack：Domain UI Discovery -> Domain UI Contract -> Case Scope / Intent Contract -> Action Template Contract -> Evidence Contract -> Result / Judgment Contract -> Feedback / Drift Loop -> Gen 4 Stable Core + Action Interpreter。
- 邊界：不在每個 domain pack 放小 helper 或小 agent。domain pack 可以放 declarative adapters、locator maps、aliases、action templates、evidence schemas、lint rules、hazards；不能放 arbitrary executable helper code。stable core 保持通用,只懂 `targetPage`、`testIntent`、`caseScope`、`riskLevel`、`allowedActions`、`forbiddenActions`、`requiredEvidence`、`actionTemplate`、`cleanupPolicy`、`judgmentPolicy` 等 generic fields；BI 的 `metrics/sourceReport/dateRange/displayMode/formula.baseFields` 留在 BI domain pack/testcase 層。
- 後續方向：package lint 要能抓缺少 `caseScope` / `judgmentPolicy` / operationTemplate 的 observation 或 preview case；planner 若缺 domain action template,應回 `HELPER_CONTRACT_MISSING` 或 lint failure,不能 fallback 到 generic `configureMetric/runPreview`；result gate 要依 declared scope 判斷,已滿足 scope evidence 時不能被 unrelated downstream helper blocker 覆蓋。
- 文件同步：更新 `docs/planning/domain-ui-contract-helper-gen3-gen4-plan.md` 與 `docs/refactor/工程spac.md`。本次只更新規劃/spec,不改 runtime code、不推 production。

### 2026-05-17 - P0 scope contract concept fixture

- 背景：Tommy 確認先做 P0 概念驗證 smoke / regression fixture,確認測試能抓住 run 814 問題後再進 runtime 調整。
- 新增：`scripts/verify-p0-scope-contract.ts` 與 npm script `verify:p0-scope-contract`。此 fixture 不跑 live BI,而是用 run 814 代表 case 建立 offline smoke: I-01/J-12/K-01/L-02 observation、B-04/N-03 preview/download control、result gate out-of-scope selected-field blocker、official UI missing case section severity。
- 三模式：預設模式 `npm run verify:p0-scope-contract` 用來確認目前錯誤可重現且 exit 0；`npm run verify:p0-scope-contract -- --prototype` 用純函式模擬預計解法並應通過；`npm run verify:p0-scope-contract -- --expect-fixed` 是 P0 修完後的 runtime 驗收模式,目前預期紅燈。
- 目前結果：預設模式通過並重現三個 gap: result gate 仍接受 observation case 因 `selectedMetricFields=0` 被 BLOCKED、`INSTRUCTION_CASE_SECTION_MISSING` 仍是 warning-only、L-02 date-panel interaction 仍只是 soft prelude 而非 explicit contract/template missing。`--prototype` 通過,證明預計規則會將 I/J/K/L 歸為 non-preview observation、B/N 維持 preview/download,並將 L-02 分類為 missing `collage.datePanelObservation` action template。`--expect-fixed` 目前在 result gate scope assertion 紅燈,符合尚未修 P0 runtime 的預期。
- 驗證：已跑 `npm run verify:p0-scope-contract`、`npm run verify:p0-scope-contract -- --prototype`、`npm run verify:p0-scope-contract -- --expect-fixed`(預期失敗)、`npm run typecheck`、`git diff --check`。本批仍未修改 runtime code。

### 2026-05-17 - P0 scope runtime guards

- 背景：概念 fixture 已證明能抓住 run 814 的三個核心 gap 後,進入 P0 runtime 調整。此批仍在 dev 工作分支,不推 production,不跑完整 live UAT。
- Runtime：新增 `agent/src/case-scope.ts`,先用現有 case manifest / helper hints 推導 generic `testIntent`、`previewRequired`、`executionRequired`、`requiredEvidence`、`missingActionTemplate`。這是 compatibility containment,不是最終 domain contract schema。
- Planner/capability gate：`capability-gate` 輸出 `caseScope`；L-02 這類 official UI date-panel observation 若缺 action template,會回 `HELPER_CONTRACT_MISSING:collage.datePanelObservation` 且不允許 generic preview fallback。`helper-execution-plan` 同步不產生 soft prelude actions,避免看似有跑但其實沒覆蓋 case scope。mode detection 也把 `拼貼報表` 視為 collage,避免 J 類 project/report-row observation 因沒有寫 `拼貼模式` 而掉入 generic preview。
- Package/result gate：`BI_OFFICIAL_UI_COLLAGE` 的 I/J/K/L/M/N observation case 若 instruction 缺 per-case section,`INSTRUCTION_CASE_SECTION_MISSING` 從 warning 升為 error。`result-evidence-gate` 會拒絕 `caseScope.previewRequired=false` 的 result 用 `selectedMetricFields=0` / `EXECUTE_PRECONDITION_NO_SELECTED_FIELDS` 當 BLOCKED 原因。
- Fixture：`npm run verify:p0-scope-contract` 現在預設就是 fixed 驗收模式；`--prototype` 保留概念模型對照；舊的 current-failure 檢查只作 pre-fix 歷史語意,修完後不再是應通過模式。fixture 覆蓋 I-01/J-12/J-07/K-01/L-02 observation,以及 B-04/N-03 preview/download controls。
- 驗證：已跑 `npm run verify:p0-scope-contract -- --expect-fixed`、`npm run verify:p0-scope-contract`、`npm run verify:p0-scope-contract -- --prototype`、`npm run verify:capability-gate`、`npm run verify:result-evidence-gate`、`npm run verify:package-consistency`、`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`git diff --check`。

### 2026-05-17 - Result gate decision table and Case Scope Contract v1 draft

- 背景：run `f8ae4966-ba2b-4c9d-b870-a4dd447fd820` 暴露 P0 containment 仍不足：B-06 將雙階段日期誤當單一 preset、B-08 fallback 到 generic text click、B-09 因結果 evidence 看似正確而誤判 PASS,但 Tommy 人工確認靜態區間按鈕本身不可完成 required UI flow。這證明 result gate 需要同時理解 case scope、flow evidence、outcome evidence 與 testing target。
- 設計來源：ClaudeCode + Codex + Tommy 共同設計,經 2026-05-17 多輪架構 review 收斂；Codex 為 downstream P0a runtime implementation owner。這次 trace 作為三方協作樣本保留,也作為後續 domain pack / Gen4 interpreter 實作 reference。
- 新增文件：`docs/refactor/result-gate-decision-table.md` 定義 `expectedOutcome × actualOutcome × testTarget` 判定表、pure observation path、fail isolation sentinel、cleanup next-case isolation 與 PASS/FAIL/BLOCKED aggregation。`docs/refactor/case-scope-contract-v1.md` 定義 `caseScopeContract.version=v1`、action roles、`expectedOutcome`、action `steps[]`、source/operator enum、`judgmentPolicy`、`cleanupPolicy` 與 B-06/B-08/B-09 examples。
- 設計決策：維持 Domain UI Discovery -> Domain UI Contract -> Case Scope / Intent Contract -> Action Template Contract -> Evidence Contract -> Result / Judgment Contract -> Feedback / Drift Loop -> Gen 4 Stable Core + Action Interpreter 路線；不新增每個 domain 的 arbitrary small helper 或 per-domain agent。P0a 先以文件契約約束 runtime fail isolation / scope guard / interaction evidence,後續 Phase 1-4 再逐步轉成 authored scope schema、declarative action templates、result gate decision implementation 與 Gen4 action interpreter。
- 驗證：文件修訂後已跑 `git diff --check`。本批只新增規劃/spec 文件,不改 runtime code,不推 production。

### 2026-05-17 - P0a/P0b/P0c runtime containment after contract v1

- 背景：文件 contract land 後,先實作一週 minimum P0 runtime：不中斷、不亂判 PASS、不執行 scope 外動作。本批仍是 Gen1/Gen2 compatibility containment,不是 authored `caseScopeContract.v1` 或 Gen4 interpreter。
- P0a fail isolation：`result-contract` 新增 `containPassContradictionsAsBlocked`。若 self-check 只有 `RESULT_PASS_CONTRADICTS_HELPER_EVIDENCE`,Agent 會把該 PASS row 改成 `BLOCKED / BLOCKED_NEEDS_REJUDGMENT`,寫入原始 detail 與 self-check issues,保留 backup,重新跑 self-check 並上傳,不讓整輪 run fail。其他 contract error 仍維持 hard block。
- P0b scope guard：`case-scope`、`capability-gate`、`helper-execution-plan` 共同辨識「本題不測項目 / 本題不做 / 不測 / 不驗」類負向 scope。B-09 類文字 `本題不測項目: 儲存、CSV、reopen` 不再被推成 `download_execution`,也不再產生 save/reopen/download helper actions。
- P0c flow evidence guard：靜態 date range 設定移除 stale bodyText shortcut,必須嘗試 visible UI 靜態時間 tab；helper report 會輸出 `interactionLog.actions.setStaticDateRange.steps.openStaticTab.actualOutcome`。Result self-check 對 static date range 的 PASS 不再只接受 final represented range,還必須有 static user-flow evidence；缺 flow evidence 會觸發 PASS contradiction,再由 P0a containment 改成 `BLOCKED_NEEDS_REJUDGMENT`。
- Fixture：`verify:agent-result-contract` 覆蓋 PASS contradiction containment 與 B-09 static flow evidence；`verify:capability-gate` 覆蓋 B-09 negative scope 不產生 save/reopen/download；`verify:p0-scope-contract` 加入 B-09 preview-vs-download control。
- 驗證：已跑 `npm run verify:agent-result-contract`、`npm run verify:capability-gate`、`npm run verify:p0-scope-contract`、`npm run verify:p0-scope-contract -- --prototype`、`npm run verify:result-evidence-gate`、`npm run verify:helper-report-gate`、`npm run verify:package-consistency`、`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`git diff --check`。

P0a v1 範圍釐清：containment 只處理唯一 self-check error 為 `RESULT_PASS_CONTRADICTS_HELPER_EVIDENCE` 的情境；若同時有 detail_json invalid、header missing、FAIL missing Bug row 等其他 workbook contract error,仍 hard block。理由是 PASS/helper contradiction 是 case-level rejudgment 問題,其他錯誤多半代表 workbook 不可信。

### 2026-05-17 - P0a v2 / K-10 scope-aware preview blocker containment

- 背景：reduced live run `287c86ba-3d08-4ee8-ba30-fd674a4bf3e9` 已跑到 K-10 才失敗，證明上一批 P0b/P0c 對 B-09 生效，但 K-10 暴露另一個 scope gap：`前端呈現 + previewRequired=false` 的空設定防呆 case 被 generic `runPreviewAndCollectEvidence` helper 前置檢查誤導，Codex 寫成 `BLOCKED / EXECUTE_PRECONDITION_NO_SELECTED_FIELDS`，server result evidence gate 正確以 `RESULT_SCOPE_OUT_OF_SCOPE_PREVIEW_BLOCKER` 擋下後卻讓整輪 FAILED。
- Planner 修正：`capability-gate` 與 `helper-execution-plan` 現在以 `caseScope.testIntent=frontend_observation && previewRequired=false && executionRequired=false` 作為硬邊界。即使 case 文字提到 network observation / request 是否觸發，只要本題不要求完整 preview，就只允許安全前置導航；K-10 類 editor observation 只跑 `collage.openProject + collage.createReport`，不再排 `configureMetric/runPreview`。
- Result gate containment：新增 `src/result-parser/result-evidence-containment.ts`。server ingest 對唯一可 containment 的 `RESULT_SCOPE_OUT_OF_SCOPE_PREVIEW_BLOCKER` 會把該單題轉為 `BLOCKED / BLOCKED_NEEDS_REJUDGMENT` 的 in-memory parsed result，保留 gate issue 摘要與 current-run containment metadata，重新跑 evidence gate；若仍有其他 structural/detail/tool-bridge error，照舊 hard block。
- 邊界：raw result evidence gate 仍會拒絕 out-of-scope selected-field preview blocker；containment 只負責不讓這類 case-level judgment conflict 把整輪 run 打死。這不等於接受原本錯誤 BLOCKED 判斷，也不放寬 invalid JSON、缺 detail、FAIL 無 bug row、Tool Bridge response 缺失等結構問題。
- Fixture：`verify:capability-gate` 新增 K-10 fixture，鎖定 `previewRequired=false` 時 supported templates / helper plan 不含 `collage.configureMetric` 與 `collage.runPreviewAndCollectEvidence`。`verify:result-evidence-gate` 新增 containment fixture，確認 raw gate 會擋、containment 後可供 ingest 繼續。
- 驗證：已跑 `npm run verify:capability-gate`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:p0-scope-contract`、`npm run verify:package-consistency`、`npm run typecheck`、`npm run build`、`npm run build --prefix agent`、`git diff --check`。

### 2026-05-17 - P0.5 frontend observation visual fallback contract

- 背景：Tommy 指出 K-01 類「是否預設選拼貼模式」其實畫面截圖一眼可判，但目前工具只把 screenshot 當輔助 artifact，若 DOM/ARIA/URL selected state 讀不到就容易落成一般 `EVIDENCE_INSUFFICIENT`。這對資安或前端寫法造成 DOM evidence 不完整的頁面不夠實用。
- Runtime：`result-evidence-gate` 新增 `RESULT_FRONTEND_OBSERVATION_VISUAL_FALLBACK_REQUIRED`。若 `BIUI_COLLAGE_R001` I/J/K/L/M/N 前端呈現 observation case 是 `BLOCKED / EVIDENCE_INSUFFICIENT`，且 detail_json 有 current-run screenshot artifact，但沒有 `evidenceSource=screenshotVisual` / `visualObservation` / `domEvidenceGap` / `BLOCKED_NEEDS_VISUAL_REVIEW` 等明確 visual fallback contract，raw gate 會拒絕一般 blocker。
- Containment：server ingest 對唯一此類 case-level gate error 會轉為 `BLOCKED / BLOCKED_NEEDS_VISUAL_REVIEW`，保留 screenshotPath、visualObservation、domEvidenceGap、原始 gate issue 與 current-run containment metadata，再重新跑 gate，避免整輪 run 因「需要人工視覺 review」而 FAILED。
- Agent prompt/guidance：新增規則要求 Codex 在 frontend observation + previewRequired=false + DOM/ARIA/URL 不足但有 screenshot 時，不可寫普通 `EVIDENCE_INSUFFICIENT`；應寫 `BLOCKED_NEEDS_VISUAL_REVIEW`。只有實際檢視截圖並明確描述可見 assertion 時，才可用 `PASS_VISUAL_EVIDENCE`。
- 邊界：這不是通用 AI 看圖自動 PASS 機制，也不讓截圖取代能取得的結構化 DOM/network/chart evidence；它是 P0.5 compatibility contract，讓截圖 evidence 被分類、可 review、不中斷。

### 2026-05-17 - ecc53283 frontend observation evidence gap and P0.6-P0.12 plan

- 背景：Tommy 在 dev 跑 reduced set `ecc53283-18c4-4b29-a405-e7681626e28b` 後，15 題全部 `BLOCKED`。這輪證明 P0.5 只做到 containment / review classification，還沒有把可觀察 UI 狀態轉成機器可判的 observation evidence。
- 主要問題 1：archive 中多次出現 `mcpToolCallCount=0` 與 `TOOL_EXECUTION_UNAVAILABLE`，但獨立 smoke 用同一套 Playwright MCP/CDP config 成功呼叫 `browser_tabs`，且看得到登入後 BI 頁。結論：不是 MCP 必然不可用，而是 runtime/prompt/gate 沒有強制 browser MCP preflight 就接受 tool-unavailable 結果。
- 主要問題 2：既有 artifact 已含有部分可用 evidence，但 extractor / semantic map 不夠。I-07 DOM 已有 `Tommy LH(劉徐融)` 使用者按鈕；K-01 live DOM 可讀 `report-mode value=1` checked 且 label 為 `拼貼模式`；L-02 可打開日期面板並讀到 presets / 動態 / 靜態 / 取消 / 確定；K-10 可觀察空設定點 `計算` 後 request delta 為 0 且頁面出現「欄位未設置完成」驗證文字。J-02 toolbar disabled pattern 可讀，但需 BI semantic map 才能把 icon order 對到下載/刪除/建立等語意。
- 主要問題 3：`domain_ui_contract.json`、`domain_discovery_component_inventory.json`、`domain_evidence_schema.json` 等檔案已被下載到 run workspace，但內容偏粗且尚未接上 observation planner/result gate。需要先補 domain pack 資料，再改 runtime，而不是直接加任意 BI 小 helper。
- P0.6-P0.12 順序：P0.6 加 Browser MCP availability guard；P0.7 補 BI official UI semantic contract data；P0.8 升級通用 DOM/ARIA/accessibility extractor；P0.9 加 declarative observation action templates；P0.10 讓 result gate 依 observation assertion 判 PASS/FAIL/BLOCKED；P0.11 釐清 B-09 outcome correctness 與 static-tab flow clickability；P0.12 跑 local small smoke 後才請 Tommy 再跑 dev UAT。
- 架構邊界：BI 客製資料放 domain pack 層，例如 toolbar/icon/radio/date panel/picker semantic map；tool core 維持通用，負責 MCP preflight、DOM extractor、artifact、observation gate、action-template interpreter 邊界。這仍符合 Domain UI Discovery -> UI Contract -> Action Template -> Evidence Contract -> Result/Judgment Contract -> Gen4 interpreter 的長期方向。

### 2026-05-17 - P0.7 official observation semantic data smoke

- Domain pack：`BI_OFFICIAL_UI_COLLAGE` 補齊 observation semantic data。`ui-contract.json` 新增 topbar user button、project toolbar icon order、report-mode radio value map、date panel required texts、validation messages；`discovery/component-inventory.json` 新增對應 component；`evidence-schema.json` 新增 `browserMcp.preflight` 與 frontend observation evidence objects。
- Action contract：新增 `action-contracts/observeFrontendState.json`，定義 `userButton`、`projectToolbar`、`reportModeRadio`、`datePanel`、`validationMessage` 五種 declarative observation type。這是 domain data/action contract seed，不是可執行小 helper。
- Lint：`lint-rules.json` 新增 frontend observation template rule，提醒 I/J/K/L/M/N 前端呈現或功能流程 case 必須宣告 UI state under test，不可 fallback 到 preview-only selected-field/network evidence。
- Smoke：新增 `npm run verify:official-observation-contract`。fixture 用 `ecc53283` 代表情境驗證 I-07、J-02、K-01、L-02、K-10 的 semantic data 足以支撐後續 structured observation 判定。
- 驗證：已跑 `npm run verify:official-observation-contract`、`npm run verify:domain-pack -- --name BI_OFFICIAL_UI_COLLAGE`、`git diff --check` 通過。下一段才進 runtime：MCP preflight guard、DOM extractor、observation result gate wiring。

### 2026-05-17 - P0 runtime observation bridge

- Input wiring：domain pack optional inputs 新增 `action-contracts/observeFrontendState.json`，API 會提供 `/api/domains/:name/action-contracts/observeFrontendState`，Agent 下載成 `input/domain_action_observe_frontend_state.json`，並寫入 run brief / reference-index / rule-index。
- Helper planning：`capability-gate` 與 `helper-execution-plan` 對 I/J/K/L/M/N observation-only case 可排 `collage.observeFrontendState`。代表 fixture I-07/J-02/K-01/L-02/K-10 現在是 `openProject` / `createReport` / `observeFrontendState`，不再 fallback 到 `configureMetric/runPreview`。
- Helper executor：`bi-ui-helper-executor` 新增 `collage.observeFrontendState` compatibility action，產生 `frontend-observation-evidence.json`。支援 `userButton`、`projectToolbar`、`reportModeRadio`、`datePanel`、`validationMessage` 五種 observation type；datePanel/validationMessage 只用 visible UI click，不用 evaluate 觸發互動。
- DOM extractor：`ui-dom-profile` 補 `checked`、`ariaChecked`、`ariaDisabled`、`ariaExpanded`、`nearestLabel`、`title`、`computedStyle`，讓 radio、disabled icon、pointer-events/opacity 類狀態能變成 structured evidence。
- Result gate：`result-evidence-gate` 新增 `RESULT_TOOL_EXECUTION_UNAVAILABLE_WITHOUT_PREFLIGHT`。任何 `TOOL_EXECUTION_UNAVAILABLE` BLOCKED 必須有 `browserMcp.preflight` / `browser_tabs` evidence；若沒有，server containment 改成 `BLOCKED_NEEDS_REJUDGMENT`，不接受未 preflight 的工具不可用判斷。
- 驗證：已跑 `npm run verify:official-observation-contract`、`npm run verify:domain-pack -- --name BI_OFFICIAL_UI_COLLAGE`、`npm run verify:capability-gate`、`npm run verify:p0-scope-contract`、`npm run verify:p0-scope-contract -- --prototype`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:helper-report-gate`、`npm run typecheck --prefix agent`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`git diff --check`。

### 2026-05-17 - P0.11 B-09 outcome-vs-flow scope smoke

- 釐清：B-09 若測試目的是 `前後端整合 / request + preview 首日正確性`，則 preview request body 與 preview 首日是核心 outcome evidence；靜態 tab 本身可點性不應在同一 case 裡被偷塞成產品 FAIL。若 PM 要驗證靜態 tab 可見/可展開/可切換，應拆成 L 類 `前端呈現` 或 `功能流程` case，走 date-panel observation/flow evidence。
- Fixture：`verify:official-observation-contract` 新增兩個 P0.11 guard。`BIUI_COLLAGE_R001-B-09` 必須仍是 `openProject -> createReport -> configureMetric -> runPreviewAndCollectEvidence`，且負向 scope 不得產生 save/reopen/download；`BIUI_COLLAGE_R001-L-STATIC-TAB` 代表拆分後的 static-tab flow，必須走 `openProject -> createReport -> observeFrontendState`，不得落回 preview helper。
- Runtime 小修：`observeFrontendState.userButton` 不再硬抓 Tommy/劉徐融；改成可由 `expectedTextContains` 提供期望文字，否則使用 account/top-right button heuristic。`projectToolbar` 也優先找同列 `disabled, disabled, enabled` 的 toolbar triplet，避免把頁面其他 button 當下載/刪除/新增。
- 驗證：已跑 `npm run verify:official-observation-contract` 與 `npm run typecheck --prefix agent` 通過。P0.12 還需跑 local small smoke / rebuild / dev Agent restart metadata 後，才請 Tommy 再跑 dev UAT。

### 2026-05-17 - P0.12 local small live helper smoke

- 背景：Claude review 建議 P0.12 不只跑 fixture，而要在請 Tommy 重跑 dev UAT 前，用 dev Agent Chrome profile 做小型 live smoke，避免再次消耗 20+ 分鐘才發現基本 observation bridge 無效。
- Smoke 環境：使用 `/Users/tommy/.uat-agent-dev/config.json`、dev Chrome profile、DEV URL `https://galaxy.games.gamania.com/bi-dev/zh-TW/home`。只做觀察/導航/新增報表頁，不儲存、不下載、不刪除。
- 第一輪 I-07 smoke 抓到真 gap：頁面後續 `domState.bodyTextExcerpt` 有 `Tommy LH(劉徐融)`，但 observation 讀取太早且 button rect 尚不可見，導致 `visible=false`。修正後 `observeFrontendState` 會先等各 observation type 的目標 UI marker 出現，再讀 DOM；user button 也可從 topbar body-text line fallback。
- 通過 smoke：
  - I-07 run `/Users/tommy/.uat-agent-dev/runs/p0-12-observe-i07-20260517232442`：`observe=ok`、`visibleText=Tommy LH(劉徐融)`、`evidenceObject=topbar.userButton.state`。
  - J-02 run `/Users/tommy/.uat-agent-dev/runs/p0-12-observe-j02-20260517232725`：`openProject=ok`、`observe=ok`、download/delete disabled、create enabled，三顆 icon-only buttons 皆從實際 DOM rect/state 擷取。
  - K-01 run `/Users/tommy/.uat-agent-dev/runs/p0-12-observe-k01-20260517232516`：`openProject=ok`、`createReport=ok`、`observe=ok`、`selectedValue=1`、`selectedLabel=拼貼模式`。
  - L-02 run `/Users/tommy/.uat-agent-dev/runs/p0-12-observe-l02-20260517232559`：`openProject=ok`、`createReport=ok`、`observe=ok`、`openedByVisibleUi=true`、`requestDelta=0`、`missingTexts=[]`。
  - K-10 run `/Users/tommy/.uat-agent-dev/runs/p0-12-observe-k10-20260517232642`：`openProject=ok`、`createReport=ok`、`observe=ok`、`visibleText=欄位未設置完成`、`requestDelta=0`。
- 結論：P0.12 proves the observation bridge is no longer merely a stricter blocker. It can collect structured evidence for the exact I/J/K/L cases that became false BLOCKED in `ecc53283`. Before Tommy runs dev UAT, final step is commit/push dev and restart `com.tommy.uat-agent-dev`, then record dist mtime + process start time to avoid stale-code confusion.

### 2026-05-19 - Runtime containment for B-12 Codex result-write failure

- 背景：dev run `e352cf8b-213b-4bbb-8c4a-674070a8df3f` 已完成 A-01 到 B-11，B-12 helper pre-run 也完成 `openProject/createReport/runDateVariantsPreviewEvidence` 並產生兩段日期 evidence，但 Codex subprocess 在讀 evidence / 判定 / 寫 `output/result.xlsx` 前以 `CODEX_RUN_FAILED` 結束。Agent 只產生不可信 `agent-fallback-result.xlsx`，導致整輪 FAILED 且 B-12 之後 85 題停住。
- Date variants evidence：`collage.runDateVariantsPreviewEvidence` 現在會在原本 per-variant evidence 外，補向前相容摘要欄位：`networkEvidence.requestBody/requestDateRange`、`tableSummary.rowCount/firstDate/lastDate/sum/dateHeaders`、`judgmentSummary` 與 top-level `comparison`。這不讓 helper 判 PASS/FAIL，只把 evidence shape 穩定化，避免 Codex 用舊路徑如 `.dateVariants[].tableSummary` 時直接讀不到。
- Runtime containment：新增 `agent/src/runtime-containment-result.ts`。若 Codex exit 非 0 且沒有 `output/result.xlsx`，但 current case 的 helper pre-run 已有 current-run evidence，且 package/document consistency 沒有 error，Agent 會寫可信單題 `output/result.xlsx`：`BLOCKED / CODEX_RUNTIME_RESULT_WRITE_FAILED`，detail_json 保留 helper summary/report paths、Codex failure、artifact dir 與 containment metadata。這是 process isolation，不是產品 PASS/FAIL 判定。
- 邊界：若 package/document consistency 為 error，仍不 containment，必須停等 PM resolve/override；若沒有 current-run helper evidence，也不 containment，避免把真實工具不可達或前置缺失偽裝成可繼續結果。
- 驗證：新增 `npm run verify:date-variants-evidence-summary` 與 `npm run verify:runtime-containment-result`。另已跑 `npm run verify:agent-result-contract`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`。

### 2026-05-19 - Result upload retry for B-04 transport failure

- 背景：dev run `01e9c8e6-07b5-45ba-9309-48e3863091dd` 跑到 `BIUI_COLLAGE_R001-B-04` 時，Codex turn 已成功判定 PASS 並在本機寫出 trusted `output/result.xlsx`，但 Agent `upload_result` phase 於上傳結果 workbook 時收到 `fetch failed`，整輪因此 FAILED，B-05 之後維持 PENDING。這不是 B-12 類 Codex result-write failure，也不是 case 判定錯誤，而是 result upload transport isolation gap。
- 修正：`uploadResultXlsx` 加入 transient retry，針對 `fetch failed`、socket/network 類錯誤，以及 `408/425/429/5xx` result upload response 自動重試 4 次（指數退避，上限 8 秒）。每次 retry 會送出 `run.stderr` 診斷，避免只看到最後一個 `fetch failed`。
- 診斷邊界：若重試後仍失敗但本機已存在 trusted `output/result.xlsx`，partial artifact path 會優先保留/重試該 trusted workbook，不再把狀態誤寫成「只有 agent fallback」。真正的 agent fallback 仍維持 local diagnostic only，不上傳為 UAT 結果。
- 驗證：新增 `npm run verify:result-upload-retry`，並在 2026-05-19 P0.22 follow-up 補強為本機 HTTP server 第一次直接中斷 socket 產生 `fetch failed`、第二次回 503、第三次成功，確認 result upload 對 network/transport error 與 5xx 都會 retry 並成功。另已跑 `npm run typecheck`、`npm run build --prefix agent`。

### 2026-05-19 - P0.23 108-case BLOCKED triage smoke

- 背景：108-case run `ee0cae6b-f2c4-4cb0-a5aa-d79f5b611ca3` 已跑到 N-02 前，但最終報告仍有 48 個 BLOCKED。Tommy 要求後續修法必須先分辨哪些是工具 routing/evidence 問題、哪些是 testcase precondition、domain metadata/field picker、product gap 或需要人工 review，不能再把所有問題都當 helper bug。
- 新增 verifier：`scripts/verify-p0-108-blocked-triage.ts`。
- 新增 npm script：`npm run verify:p0-108-blocked-triage`。
- Baseline：108 total / 48 BLOCKED。分類為：`result_gate_visual_fallback_contract_gap=11`、`save_reopen_row_download_flow_gap=10`、`missing_action_template_or_incomplete_helper_flow=7`、`manual_review_required=7`、`domain_metadata_or_field_picker_gap=5`、`wrong_observation_route_or_missing_case_contract=4`、`date_helper_or_product_gap=2`、`navigation_template_gap=1`、`testcase_precondition_not_met=1`。
- 邊界：這是 triage/regression smoke，不改 runtime、不把 BLOCKED 改判、不把 Tommy oracle 推進 platform/domain pack。下一批 runtime 修正應先挑一個分類做 small smoke，再修改對應 platform/domain/testcase 層。
- 驗證：已跑 `npm run verify:p0-108-blocked-triage`、`npm run typecheck`、`git diff --check`。

### 2026-05-19 - Platform/domain/testcase boundary rule documentation

- 背景：Tommy 在 run `ee0cae6b-f2c4-4cb0-a5aa-d79f5b611ca3` 108 題執行中指出 BLOCKED 變多,並追問接下來修法是否又會變成這次 BI testcase 客製。回顧後確認：早期 P0 確有不少 Gen1/Gen2 compatibility bridge,後續才開始轉向 platform action vocabulary + BI domain UI object vocabulary。需要把「可通用的放平台,不可通用但可重用的放 domain pack,單輪/單題的放 testcase」寫成常駐規則,並更新 domain pack 生成流程。
- 新增規則：`agent-skills/uat-tool/rules/platform-domain-boundary.md` 定義 Platform runtime / Platform vocabulary / Domain pack / Testcase package / Temporary bridge 五層責任、placement rules、domain pack authoring requirements、runtime 禁止事項、temporary bridge policy 與 review checklist。
- Skill/Layer 1 接線：`agent-skills/uat-tool/SKILL.md`、`agent-skills/uat-tool/rules/domain-routing.md`、`uat-tool/AGENTS.md` 都已指向新分層規則,要求 runtime 不永久包含 case id、BI 專案名、source report label 或單題 workaround；必要 bridge 必須命名並指向替代 contract。
- Authoring workflow：`docs/authoring/新功能_DomainPack_生成流程.md`、`domain_intake_template.md`、`boundary_rules_template.md`、`claude_testcase_request_template.md`、`domain_pack_completion_checklist.md` 已補齊 domain UI object vocabulary、action contracts、evidence schema、lint rules、visual alignment、known product gaps 與 temporary bridge 欄位。未來新 domain pack 生成時,不能只產 prompt/xlsx schema/locator guidance。
- 規劃同步：`docs/refactor/規劃說明.md`、`docs/refactor/工程spac.md`、`docs/planning/domain-ui-contract-helper-gen3-gen4-plan.md` 已記錄此分層標準。這批是 documentation-only,不改 runtime、不改 helper、不改 testcase、不推 prod；後續才回頭分析 `ee0cae6b...` 108 題結果並按新邊界修 routing/result gate。

### 2026-05-20 - P0.27 report mutation flow action-template slice

- 背景：P0.25/P0.26 已處理 shared navigation/readiness、K-09 field picker、L-08 dual preset switching；P0.23 的 `save_reopen_row_download_flow_gap` 仍剩 `M-06` save modal cancel、`M-09` copy modal cancel/defaults、`M-10` copy save、`M-11` update-and-reopen。這批先把可驗證的 M 群 report mutation flow 補成 structured route，而不是等 108 題再讓它們全部落成 generic BLOCKED。
- Runtime：新增 `report_mutation_flow` intent。`M-06` route 為 `openProject -> createReport -> observeFrontendState(saveModalCancel)`；`M-09` route 為 `openProject -> openReportFromProjectList -> observeFrontendState(copyModalCancel)`；`M-10` route 為 `openProject -> openReportFromProjectList -> copyReportAndVerify`；`M-11` route 為 `openProject -> openReportFromProjectList -> updateExistingReportAndReopen`。
- Domain pack：`case-scope-runtime-contracts.json` 擴到 21 筆 contracts；`observeFrontendState.json` 支援 `saveModalCancel` 與 `copyModalCancel`；`ui-object-vocabulary.json`、`evidence-schema.json`、`component-inventory.json`、`visual-alignment.json` 補 save/copy modal、copy save、update button、project list row、reopen persistence 的 objects/evidence。
- 邊界：這仍是 helper-runtime compatibility bridge。BI-specific semantics 放 domain pack；runtime branch 只為 P0 補缺的 action template 執行路徑。後續 Gen4 應由 declarative action contract interpreter 執行同一批 action/object/evidence，而不是保留硬編碼流程。
- 驗證：已跑 `npm run verify:p0-report-mutation-templates`、`npm run verify:p0-live-run-packet-regression`、`npm run verify:p0-runtime-wiring`、`npm run verify:p0-live-action-templates`、`npm run verify:bi-official-ui-object-vocabulary`、`npm run verify:official-observation-contract`、`npm run verify:agent-result-contract`、`npm run verify:p0-108-blocked-triage`、`npm run typecheck`、`npm run build --prefix agent`、`git diff --check`。

### 2026-05-20 - P0.28 reduced blocked-smoke triage after run 12594ce2

- 背景：Tommy 跑 v1.9 blocked-type 18-case smoke `12594ce2-1555-432d-800c-3663934913a1`，結果仍有大量 BLOCKED，且 run 自己停住。這輪不是 108-case 放行訊號，而是 post-P0.27 triage evidence。
- Run result：`PASS=1`、`FAIL=1`、`BLOCKED=11`、`PENDING=5`。唯一明確產品/流程 FAIL 是 `G-05` 返回專案頁控制項不可用。`A-04` 是 metadata drift 類，已排除在本次修法優先順序外。
- 停止點：run 完成 `L-05` 後切到 `L-10`，`collage.createReport` 在 helper pre-run 中失敗，錯誤為 `Target page, context or browser has been closed`。因該錯誤沒有被寫成 current-case `BLOCKED` workbook，整輪進入 `FAILED`，`L-10` 與後續 `M-01/M-07/M-10/M-11` 留在 PENDING。
- 判斷：這是 runtime containment gap。下一步不能只重跑，也不能先跑 108。需要先處理 browser target/context closed 的 same-case retry 與 case-level containment，避免單一 Playwright/CDP session failure 讓後續 cases 全部失去 evidence。
- Blocked buckets：日期工具與 action-template gap 包含 `B-07`、`F-07`、`L-05`、`L-10`；workflow/observation evidence gap 包含 `F-02`、`I-04`、`J-03`、`J-08`、`J-10`；testcase/domain mapping or precondition gap 包含 `D-01`、`J-12`。
- 建議順序：先修 browser session recovery/containment，然後修 date panel selector/action templates，再補 project-page observation workflows，最後處理 `D-01` concrete source-report mapping 與 `J-12` five-project precondition builder。修完後重跑同一份 18-case smoke，目標是 run 不 FAILED、`PENDING=0`，並且剩餘 BLOCKED 都能明確落到 testcase precondition、PM review、或真產品不可達。
- 邊界：這仍按 platform/domain/testcase 分層處理。session containment 與 retry 是平台 runtime；date panel/project toolbar/modal/list workflow 是 `BI_OFFICIAL_UI_COLLAGE` domain action/object/evidence；`D-01` 與 `J-12` 的具體 values/preconditions 屬 testcase package 或 explicit precondition builder，不應硬寫成 platform behavior。

### 2026-05-20 - P0.28 implementation + smoke

- Runtime containment：`agent/src/task-runner.ts` 現在會在 helper pre-run 後檢查 `Target page, context or browser has been closed` / `BROWSER_SESSION_*` 類 lifecycle failure。若命中，Agent 會重建 same-case browser lease 並重跑 helper pre-run 一次；若重試仍是 browser/session closed，`agent/src/runtime-containment-result.ts` 會寫可信單題 `output/result.xlsx`：`BLOCKED / BLOCKED_BROWSER_SESSION_CLOSED`，再走正常 result upload / case advance。這是 run isolation，不是產品 PASS/FAIL 判定。
- Date/template slice：`B-07` / `F-07` 類 relative/hybrid date flow 不再只依賴 `#startDayInput/#endDayInput`；若 id selector 不存在，helper 會用目前可見且非報表名稱的 input 依 start/end 位置 fallback，並把 `selectorFallbackFrom`、`fillError`、`observedValue` 留在 endpoint evidence。`L-05` 新增 structured `datePanel` contract，明確要求 `dateRange.preset.lastWeek` 與 `dateRange.preset.currentWeek`，helper 才會真的點 `上週 -> 本週` 並收集 `dateRange.presetSwitch.state`。
- Domain mapping slice：`D-01` 的 `來源報表(多源): 每日報表, 雙平台營收佔比, 退費追蹤` 現在會被解析成 `sourceReports[]`，不再把 `(多源)` 當 literal source option。metric rows 會在 `fields[]` 與 `sourceReports[]` 等長時逐列配對，避免所有欄位都落到 fallback source。
- Domain data：`BI_OFFICIAL_UI_COLLAGE` 補 `dateRange.preset.lastWeek/currentWeek` 到 `ui-object-vocabulary.json` 與 `discovery/visual-alignment.json`，並補 `BIUI_COLLAGE_R001-L-05` 到 `case-scope-runtime-contracts.json`。這是 domain pack 層，不污染 platform vocabulary。
- Verification：已跑 `npm run verify:p0-helper-browser-session-containment`、`npm run verify:p0-live-action-templates`、`npm run verify:bi-official-ui-object-vocabulary`、`npm run verify:official-observation-contract`、`npm run verify:runtime-containment-result`、`npm run verify:result-evidence-gate`、`npm run verify:agent-result-contract`、`npm run verify:p0-live-run-packet-regression`、`npm run verify:p0-108-blocked-triage`、`npm run typecheck --prefix agent`、`npm run build --prefix agent`。
- Remaining scope：`I-04/J-10` project-create modal flow、`J-03/J-08` project-page visual/workflow assertions、`F-02` save/reopen final evidence、`J-12` five-project precondition builder 尚未在本 slice 中實作。下一輪 reduced smoke 目標是先確認 run-level `FAILED/PENDING` 消失，再看剩餘 BLOCKED 是否集中到這些已知分類。

### 2026-05-20 - P0.28 service-level EPERM follow-up

- 背景：reduced run `a18ad789-2ace-442a-a161-e1769bcc6e1e` 在第一題前就 failed。Archive 顯示 helper pre-run 讀 `agent/dist/bi-ui-helper-executor.js` 時發生 `EPERM`，之後 upload/result pre-check 又在 `node_modules/readable-stream/lib/internal/streams/async_iterator.js` 發生同類 `EPERM`。因此平台報告全 18 題都是 `PENDING`，不是 BI product/testcase 判定結果。
- 處理：dev launchd service 已重啟成乾淨 process；新增 `npm run verify:agent-runtime-file-access`，用 child process 檢查 helper executor 可載入到 usage error、platform skill 目錄可列舉、ExcelJS/readable-stream 可 require。這是 service-level deployment hygiene smoke，目標是在 Tommy 再跑 live UAT 前先攔住本機 runtime file-access 問題。
- 邊界：這不改 BI 判斷、不改 testcase、不把 EPERM 轉成產品 BLOCKED。若未來此 smoke 失敗，應先處理本機 service/runtime access，再開始 UAT。

### 2026-05-20 - P0.29 BI official inline formula-builder alignment

- 背景：Tommy 提供 2026-05-20 E 群公式設定截圖後，確認正式 BI 拼貼 UI 的運算欄位不是舊的公式 modal；正確流程是在自訂欄位列點 inline expression area，開啟 keypad，透過「插入欄位」picker 選 source report + field，再用 keypad operator/number 組公式。
- Domain pack：`BI_OFFICIAL_UI_COLLAGE` 已補 `formulaEditor.inlineExpressionArea`、`formulaEditor.keypad`、`formulaEditor.insertFieldButton`、`formulaEditor.sourceReportPicker`、`formulaEditor.fieldPicker`、operator/number/clear/delete buttons，並新增 `action-contracts/setCalculatedFormula.json`。`ui-contract.json`、`ui-object-vocabulary.json`、`component-inventory.json`、`evidence-schema.json`、`lint-rules.json`、`visual-alignment.json` 已同步。
- 判定邊界：visible token/keypad interaction evidence 是產品 PASS/FAIL 的前提；`direct_fill_inline`、DOM mutation、internal JS setter 只能作為工具限制 evidence，不可支撐產品 PASS/FAIL。
- Testcase：產出 v1.13 三文件，將 `BIUI_COLLAGE_R001-E-01` 到 `E-04` 改為 inline formula builder 契約；xlsx 補 `baseFields[]`、`formulaSteps[]`、structured `步驟`、`Vocabulary Contract`。`E-03` 除數修為 `退費追蹤 / 退費總金額`。
- 驗證：`npm run verify:domain-pack -- --name BI_OFFICIAL_UI_COLLAGE` PASS；`npm run verify:bi-official-ui-object-vocabulary` PASS；v1.13 package consistency 仍有其他既有 warning，但 E-01~E-04 相關 warning 已清為 0。
- 邊界：這是 domain pack + testcase contract alignment，不是新增 BI 小 helper，不是平台 runtime patch，也不是最終 Gen4 action interpreter。

### 2026-05-20 - P0.30 shared lifecycle action contracts

- 背景：reduced run `b9b0a41d-e8a6-4423-afd2-28a6bd158688` 已完整跑完 16 題，但還有 `BLOCKED=10`，且集中在 save/list/reopen、copy/save/row lookup、project create modal、delete confirm cancel、toolbar selection state、date preset apply/verify 等共用流程。
- Authoring：`docs/authoring/domain-pack-templates/domain_pack_completion_checklist.md`、`domain_intake_template.md`、`claude_testcase_request_template.md`、`boundary_rules_template.md` 已補 shared lifecycle 檢核。未來新 domain pack 生成時，若多題共用同一 user journey，必須產出 domain action contract、evidence contract、lint rule、smoke fixture。
- Domain pack：`BI_OFFICIAL_UI_COLLAGE` 新增 `action-contracts/reportLifecycle.json`、`projectLifecycle.json`、`projectList.json`、`dateRangePanel.json`，並在 `ui-contract.json` 註冊。`evidence-schema.json` 新增 `interactionLog` 與 lifecycle-specific evidence objects；`lint-rules.json` 新增 report/project/date/delete lifecycle 缺 contract/evidence 的 warning rules。
- 驗證：新增 `npm run verify:shared-lifecycle-action-contracts`。目前 `verify:shared-lifecycle-action-contracts`、`verify:domain-pack -- --name BI_OFFICIAL_UI_COLLAGE`、`verify:bi-official-ui-object-vocabulary` 皆通過。
- 邊界：這是 contract/data preparation，不是 runtime wiring。下一步若要降低 live BLOCKED，需要把 `reportLifecycle/projectLifecycle/projectList/dateRangePanel` 接到 planner/helper executor/result gate。

### 2026-05-20 - P0.31 result evidence gate non-terminal containment fix

- 背景：reduced v1.14 run `5dbc8fa5-1843-4980-9729-3bd7ac4136b7` 跑到 `BIUI_COLLAGE_R001-L-05` 後自動停止。L-05 helper evidence 已完成，Codex 也已寫出單題 `BLOCKED / EVIDENCE_INSUFFICIENT` workbook；真正停止點是 server result evidence gate 誤把一般 UI interaction log `clicked=false, confirmed=false` 當成 native confirm / Tool Bridge response claim，回 `TOOL_BRIDGE_RESPONSE_MISSING`。Agent 隨後有把該 row containment 成 `BLOCKED_RESULT_GATE_CONTAINMENT` 並重傳，但 server 在第一次 422 時已先把 run terminalize 成 `FAILED`，所以 retry 被 `RUN_ALREADY_TERMINAL` 409 拒收。
- Platform fix：`result-evidence-gate` 現在會遮罩 `clicked/confirmed/handled/accepted/dismissed=true|false|null` 這類一般 UI interaction booleans，不再把 date panel / toolbar / modal observation evidence 誤判為 native dialog handling。新增 L-05 fixture 鎖住「`clicked=false, confirmed=false` 不需要 Tool Bridge response」。
- Run lifecycle fix：`POST /api/runs/:id/output/result-xlsx` 遇到 `ResultEvidenceGateError` 時不再立刻 `setRunStatusWithMeta(runId, "FAILED")`。它仍回 422 與 gate report，讓 Agent 有機會執行既有單題 upload containment 並 retry；若 containment 無法處理，Agent 後續仍會把 run fail。非 evidence-gate 的 xlsx ingest error 仍會 terminalize。
- 驗證：已跑 `npm run verify:result-evidence-gate`、`npm run verify:result-evidence-upload-containment`、`npm run verify:zombie-run-guards`、`npm run typecheck`、`npm run build`、`npm run build --prefix agent`。這是平台層 result gate / run lifecycle 修正，不是 BI testcase 客製，也不改產品判定。

### 2026-05-21 - P0.32 Agent control WebSocket active-run resilience regression

- 背景：reduced run `ff1fccf2-9350-4187-8837-42c808fe631d` 已在 dev server `8f513ed` 上執行，排除 P0.31 舊版 result gate 修正未部署的可能。run 在 `BIUI_COLLAGE_R001-J-12` helper pre-run 已完成並產生 `frontend-observation-evidence.json` / screenshot 後，Codex turn 剛開始即因 Agent control WebSocket `1006` / `heartbeat_timeout` 被取消，archive 顯示 `run.interrupted reason=agent_lost`，本機 `codex.stderr.log` 顯示 `CODEX_RUN_CANCELLED reason=agent_connection_closed`。
- 根因：Mac Agent CLI 的 control WebSocket close/error path 仍會在有 `activeTask` 時呼叫 active task cancel 並 exit，這與既有 reconnect/queue 設計目標衝突。短暫 control channel 斷線不代表正在執行的本機 Codex process 或 Chrome helper evidence 無效；取消 active task 會把剩餘 cases 留成 PENDING，且無法交出可信 J-12 判定。
- Platform fix：`agent/src/cli.ts` 將 transient connection close/error 改為只記 `task_continues_after_connection_loss` 與既有 `task_continues_after_connection_closed` diagnostic，不再因 `agent_connection_closed` / `agent_connection_error` cancel active task，不再 exit 讓 launchd 重開。明確 `task.cancel`、SIGINT、SIGTERM 仍保留取消語意。
- Guard：`npm run verify:zombie-run-guards` 改為要求 active-run connection-loss continuation log，並禁止舊的 `abortActiveTaskForConnectionLoss` / `exitingAfterConnectionLoss` / connection-loss cancel path 回歸。
- 驗證：已跑 `npm run verify:zombie-run-guards`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`、`npm run verify:agent-runtime-file-access`、`npm run verify:agent-context-prep`，另以 dev run workspace 手動執行 Codex CLI smoke 確認不是 helper skill xattr/file-access crash。這是平台 run lifecycle 修正，不是 BI testcase 客製，也不改產品 PASS/FAIL/BLOCKED 判定。

### 2026-05-21 - P0.33 reduced-smoke live blocker bridge

- 背景：reduced run `10e944dc-4d9b-4e32-b197-9a8339dd52e5` 已可完整跑完，但仍有不該留下的 BLOCKED。這輪先修 smoke 可證明的 runtime/domain-contract bridge，不把 10e run 的人工結果寫成永久 oracle，也不新增 BI 小 helper/agent。
- B-05 類 date preset：`date-ui-evidence` 仍保留「computed represented range not directly visible」語意；但 result contract 現在允許 preset target 在 `requestedLabelVisible=true` 時通過 requested-range evidence。這避免 UI button 已明確套用「上月/本月」卻因 represented range not visible 被誤 BLOCKED。
- J-08 類 project-list row observation：官方 UI 的報表列有時能在 body text 看到，但 DOM row extractor 抽不到 row。`readProjectListRowsForObservation` 與 `readReportListRowState` 加入 body-text report-list fallback，保留 `fallbackUsed=bodyTextReportList`，讓 delete cancel / row-count 類 evidence 不再因 extractor 太窄而歸 generic BLOCKED。
- L-10 類 from-date preset：planner/executor 新增 `dateRange.preset.fromDateToYesterday` 與 `dateRange.preset.fromDateToToday` label mapping，date panel observation 會填 start-date input 後確認，並把 `fromDateStartInput` 寫入 evidence。
- L-05 類 failed preset interaction：date panel preset switch evidence 現在寫 `actualOutcome`，並在未點到/無 state change 時產生 `recommendedFailureClassification=FAIL_INTERACTION_FAILED`。這讓 result judgment 可區分產品互動失敗與工具 evidence 不足。
- M-11 guard：新增 P0.33 smoke 鎖定 structured plan 必須包含 `collage.updateExistingReportAndReopen`，避免 run packet 回到 open-only path。
- 驗證：`npm run verify:p0-33-live-blocker-regressions`、`npm run verify:official-observation-contract`、`npm run verify:p0-runtime-wiring`、`npm run verify:bi-official-ui-object-vocabulary`、`npm run verify:shared-lifecycle-action-contracts`、`npm run verify:agent-result-contract`、`npm run verify:result-evidence-gate`、`npm run verify:date-ui-evidence`、`npm run verify:p0-live-action-templates`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build` 通過。
- 邊界：這是 Gen1/Gen2 compatibility bridge，通用部分放 result contract / planner / runtime evidence shape；BI 語意仍由 `BI_OFFICIAL_UI_COLLAGE` 的 target/object/action contract 驅動。剩餘是否能全數降到明確 PASS/FAIL，仍需下一輪 reduced live UAT 驗證。

### 2026-05-21 - P0.34 Codex no-result containment after helper evidence

- 背景：run `071a690a-314e-4d93-8589-84772c359d6e` 使用已部署的 P0.33 code，`BIUI_COLLAGE_R001-B-05` 也證明 date preset bridge 已生效；run-level failure 發生在 `BIUI_COLLAGE_R001-G-05`。Helper pre-run 已完成 `openProject` / `openReportFromProjectList`，並在 `collage.clickBackToProjectList` 產生 current-run blocker evidence `BACK_TO_PROJECT_LIST_BUTTON_NOT_CLICKABLE`。Codex turn 隨後因 browser preflight/tooling 不可用而沒有寫 `output/result.xlsx`，Agent fallback workbook 被正確拒絕上傳，最後以 `CODEX_NO_RESULT_XLSX` failed。
- 修正：`agent/src/runtime-containment-result.ts` 現在支援 `containmentKind=no_result_after_success`。當 Codex exit 0 但沒有 trusted workbook、package/document consistency 沒有 error、且 helper pre-run 有 current-case evidence 時，Agent 會在 upload 前寫可信單題 `output/result.xlsx`：`BLOCKED / CODEX_NO_RESULT_XLSX`，detail_json 保留 helper summary/report paths、Codex failure summary、helper artifact dir 與 containment metadata。
- Runtime 接線：fresh run 與 tool-response resume 都在 result upload 前呼叫 no-result containment。若 containment 寫出 workbook，upload 會走 `codex_generated` source，通過 result evidence gate 後正常 case advance；若沒有 helper evidence 或 consistency gate 有 error，仍維持 failed/blocked 給 PM review，避免把真缺 evidence 偽裝成可繼續結果。
- 邊界：這是平台層 process-isolation fix，不是 BI-specific testcase 修正，也不是自動把 `G-05` 判成產品 FAIL。產品判定仍需要 Codex/result gate 基於 action role、test target、actual vs expected outcome 判定；containment 只保證單題 no-result 不會讓後續 cases 全部變 PENDING。
- 驗證：新增 `npm run verify:codex-no-result-containment`。另回歸 `npm run verify:runtime-containment-result`、`npm run verify:p0-helper-browser-session-containment`、`npm run typecheck`、`npm run build --prefix agent`、`npm run build`。

### 2026-05-21 - P0.35 server-side agent disconnect non-terminal policy

- 背景：run `0c1ce924-a4bd-410a-be99-0f880cd525be` 在第一題 `BIUI_COLLAGE_R001-B-05` helper pre-run 已完成三個 helper actions 並產生 current-run evidence 後，control WebSocket 以 `1006 / agent_lost` 斷線。Server 端仍用舊規則把 busy active run 直接標 `FAILED`；Agent 重新連上後回報 local snapshot，server 因 currentStatus 已是 terminal 又派 `task.cancel reason=remote_run_failed`，本機 Codex 因此被取消，archive 顯示 `CODEX_RUN_CANCELLED reason=remote_run_failed`。
- 根因：P0.32 只修了 Mac Agent 本機「斷線不中止 active task」，但 server-side disconnect policy 沒同步。兩邊規則互相矛盾：Agent 想繼續，server 先 terminalize，再用 terminal snapshot cancel 把它殺掉。
- 修正：`src/agent/agent-run-events.ts` 的 `handleAgentDisconnect` 不再對 active run 呼叫 `setRunStatus(runId, "FAILED")`。它仍記錄 `run.interrupted reason=agent_lost`，但 payload 加 `terminalized=false`，log 改為 WARN：`Agent disconnected during active run; run remains non-terminal for reconnect`。Run status 保持 `RUNNING`，讓 reconnect 後的 Agent 可以繼續送 phase/result upload，而不會收到 `remote_run_failed` cancel。
- 邊界：PM 手動取消、Agent 自己回報 `run.failed` / `run.cancelled`、result ingest hard error 仍可 terminalize。這個 patch 只處理 control-channel transient loss，不把真的 testcase/product/runtime judgment 改成 PASS/BLOCKED。
- 驗證：`npm run verify:agent-roundtrip` 已更新並通過，現在覆蓋 explicit websocket close 與 heartbeat timeout 兩種路徑，要求 active run 保持 non-terminal。

### 2026-05-21 - P0.36 reduced-smoke blocked regression bridge

- 背景：run `b7d8833e-3518-45e6-b15d-45cafff31a34` 已不再因 agent disconnect/cancel 停止，但 reduced smoke 仍有 `BLOCKED=8/16`。其中 `B-05` 與 `J-03` 的 helper artifacts 已有 deterministic PASS evidence，卻被保留為 BLOCKED；`G-05`、`M-10`、`M-11` 則仍被舊版既有報表 resolver 鎖在 `TOOL_A01_<timestamp>` / `savedReports=[]`。
- Result evidence bridge：`result-evidence-enricher` 會在 upload 前檢查 BLOCKED rows 是否已有 deterministic helper evidence。若 `date-variants-preview-evidence.json` 全 variants 都有 `status=ok`、`responseStatus=200`、table date columns，且 date UI checks 滿足；或 `frontend-observation-evidence.json` 的 `observationState.asserted=true`，Agent 會把該 row 從 BLOCKED 升成 `PASS`，並保留 `previous_blocked_detail_json` 與 `currentRunEvidence.source=uat-agent-deterministic-helper-judgment`。無 deterministic evidence 的 BLOCKED 不會被改判。
- Existing report bridge：helper plan 現在能從 case 文本推斷「任一可見既有報表」並注入 `existingReportSelectionMode=visible_first`，不再把 G/M 類 open-existing-report case 預設鎖到舊 `TOOL-A-01` source case。Executor 也會讀 `output/helper-artifacts-archive/**/saved-report.json`，讓同一 run 早前建立的 test report 能在後續 M-11 update/reopen case 中被使用。
- Recovery path：`openReportFromProjectList` 若目前頁不是 project list，會先嘗試用本 case `collage.openProject-latest.json` 的 known project URL 回到專案頁，再解析 saved-report 或 visible-first row，避免 editor/new-report 頁面殘留導致找不到報表列。
- 邊界：這仍是 Gen1/Gen2 compatibility bridge，不是最終 Gen4 interpreter。平台層只做 deterministic evidence reconciliation 與通用 existing-report resolution；BI 語意仍由 domain pack case scope/action contracts 提供。`I-04/J-10` 這類 5-project limit precondition conflict、`L-10` date panel clickability 是否應 FAIL，仍需 testcase/domain judgment，不在本 slice 強行改判。
- 驗證：`npm run verify:p0-33-live-blocker-regressions` 新增 b7 regression fixture，覆蓋 `B-05/J-03` BLOCKED→PASS、`I-04` negative remains BLOCKED、`G-05/M-10` visible-first planning、`M-11` current-run saved-report policy。另跑 `npm run typecheck`、`npm run typecheck --prefix agent`、`npm run build`、`npm run build --prefix agent`、`npm run verify:agent-result-contract`。
