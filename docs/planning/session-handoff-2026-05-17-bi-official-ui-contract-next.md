# Session handoff - BI official UI contract next

Date: 2026-05-17 Asia/Taipei

## Active User Question / Next Conversation Objective

- Tommy is currently asking for a detailed handoff before moving the next adjusted UAT result review to a new chat.
- The reason is that this conversation became the place where the old "domain pack" concept was pushed toward an actually executable architecture: Domain UI Discovery, UI Contract, Action Contract, Evidence Contract, domain-driven helper templates, and finally stable core + action interpreter.
- The next assistant should answer the active question first, not start with a generic repo inventory.
- Expected first action in the new chat:
  1. Read this handoff.
  2. Briefly confirm the current dev/prod branch status if needed.
  3. If Tommy provides a new `UAT_report` / `UAT_archive`, classify the evidence into:
     - remaining bridge/helper bug,
     - testcase/helper-hints problem,
     - result gate or upload-contract problem,
     - domain UI contract data to preserve,
     - future Gen3/Gen4 architecture work.
  4. Do not treat every new failure as "patch helper code"; decide whether the correct fix belongs in testcase rules, domain contract, helper bridge, result gate, or cloud feedback loop.
- Current mode of this handoff creation: handoff only.
- Recommended mode for the next chat: investigation and classification first. Dev implementation is allowed only after the latest UAT evidence is inspected and the fix scope is explicit. Production promote is not allowed unless Tommy explicitly asks for it.

The most important conceptual answer to preserve:

- The latest dev fix is not the final contract-driven architecture.
- It is a necessary `Gen1/Gen2 compatibility bridge` that makes the current official BI UI live UAT executable while collecting concrete evidence for the future architecture.
- The long-term target remains:

```text
Domain UI Discovery
  -> Domain UI + Action + Evidence Contract
  -> Gen 3 Domain-driven Helper Templates
  -> Gen 4 Stable Core + Action Interpreter
  -> Cloud Feedback Loop
```

## Source Threads / Source Folders

Primary repo used in this work:

- Dev repo: `/Users/tommy/Downloads/codex_galaxy_dev/uat-tool`
- Current branch at handoff creation: `dev/uat-agent-config-isolation`
- Current dev HEAD at handoff creation: `ec6e40e fix: harden official BI helper selection`

Related source package supplied by Tommy:

- `/Users/tommy/Downloads/codex_galaxy/BI_UAT_ROUNDS/new_ui_test001/測試執行說明_BIUI_COLLAGE_R001_v1_6.md`
- `/Users/tommy/Downloads/codex_galaxy/BI_UAT_ROUNDS/new_ui_test001/BI正式UI拼貼_測試案例_BIUI_COLLAGE_R001_v1_6.xlsx`
- `/Users/tommy/Downloads/codex_galaxy/BI_UAT_ROUNDS/new_ui_test001/Codex_指派文字_BIUI_COLLAGE_R001_v1_6.md`

Important previous UAT reports discussed in this thread:

- `/Users/tommy/Downloads/UAT_report_8b3ba38e-28d4-4a86-871d-870b1ee911ff.md`
- `/Users/tommy/Downloads/UAT_archive_8b3ba38e-28d4-4a86-871d-870b1ee911ff.md`
- `/Users/tommy/Downloads/UAT_report_67990303-2c1b-4559-924a-297a089b5949.md`
- `/Users/tommy/Downloads/UAT_archive_67990303-2c1b-4559-924a-297a089b5949.md`
- `/Users/tommy/Downloads/UAT_report_4bf277d7-6193-4943-9770-fc317a11ee1f.md`
- `/Users/tommy/Downloads/UAT_archive_4bf277d7-6193-4943-9770-fc317a11ee1f.md`

Important live smoke run folders:

- A-06 final live smoke:
  - `/Users/tommy/.uat-agent-dev/runs/live-smoke-a06-rerun20-20260516195045`
- B/E/F/G regression live smoke:
  - `/Users/tommy/.uat-agent-dev/runs/live-smoke-regression-befg-20260516195912`

Planning and architecture files created or updated during this thread:

- `/Users/tommy/Downloads/codex_galaxy_dev/uat-tool/docs/planning/domain-ui-contract-helper-gen3-gen4-plan.md`
- `/Users/tommy/Downloads/codex_galaxy_dev/uat-tool/docs/planning/domain-ui-discovery-contract-share-note.md`
- `/Users/tommy/Downloads/codex_galaxy_dev/uat-tool/docs/planning/online-uat-tool-development-log.md`
- `/Users/tommy/Downloads/codex_galaxy_dev/uat-tool/docs/refactor/工程spac.md`

BI official UI collage domain pack files currently present:

- `/Users/tommy/Downloads/codex_galaxy_dev/uat-tool/domain-packs/BI_OFFICIAL_UI_COLLAGE/AGENTS.md`
- `/Users/tommy/Downloads/codex_galaxy_dev/uat-tool/domain-packs/BI_OFFICIAL_UI_COLLAGE/README.md`
- `/Users/tommy/Downloads/codex_galaxy_dev/uat-tool/domain-packs/BI_OFFICIAL_UI_COLLAGE/ui-contract.json`
- `/Users/tommy/Downloads/codex_galaxy_dev/uat-tool/domain-packs/BI_OFFICIAL_UI_COLLAGE/action-contracts/setMetricRows.json`
- `/Users/tommy/Downloads/codex_galaxy_dev/uat-tool/domain-packs/BI_OFFICIAL_UI_COLLAGE/evidence-schema.json`
- `/Users/tommy/Downloads/codex_galaxy_dev/uat-tool/domain-packs/BI_OFFICIAL_UI_COLLAGE/lint-rules.json`
- `/Users/tommy/Downloads/codex_galaxy_dev/uat-tool/domain-packs/BI_OFFICIAL_UI_COLLAGE/discovery/page-map.json`
- `/Users/tommy/Downloads/codex_galaxy_dev/uat-tool/domain-packs/BI_OFFICIAL_UI_COLLAGE/discovery/component-inventory.json`
- `/Users/tommy/Downloads/codex_galaxy_dev/uat-tool/domain-packs/BI_OFFICIAL_UI_COLLAGE/locators/demo001-locator-registry.json`

## Do Not Read / Do Not Touch

- Do not push or promote production unless Tommy explicitly asks.
- Do not assume `ec6e40e` is in production. It is currently a dev branch fix.
- Do not treat the current helper bridge as the final architecture. It is a bridge and evidence-gathering layer.
- Do not rewrite the testcase xlsx unless Tommy explicitly asks for testcase editing.
- Do not read raw Codex session JSONL unless this handoff and the planning docs are insufficient.
- Do not touch `/Users/tommy/Downloads/codex_galaxy/_archive/uat_tool_artifacts/` unless Tommy explicitly asks.
- Do not bypass the UI by directly calling BI APIs to produce UAT results.
- Do not use `browser_evaluate` or helper code to set BI UI state. Read-only DOM/network inspection is allowed; state changes must go through visible UI interactions.
- Do not run destructive UI operations, delete projects/reports, or accept native confirms without the explicit irreversible-action authorization flow.

## Confirmed Facts

### Repo and branch facts

- At handoff creation, local branch is `dev/uat-agent-config-isolation`.
- Local HEAD is `ec6e40e fix: harden official BI helper selection`.
- Remote refs checked at handoff creation:
  - `origin/dev/uat-agent-config-isolation` = `ec6e40e55f20711b8802e12cecb3f1df33f42b70`
  - `origin/refactor/mac-agent-mvp` = `7d5c3a8a75a3ce0a7b1e93ea3eead3297dadbc99`
  - `origin/codex/uat-tool-mvp` = `7d5c3a8a75a3ce0a7b1e93ea3eead3297dadbc99`
- This means the latest official BI helper bridge is on dev, not prod.
- The last known production branch commit from git remote is `7d5c3a8 docs: record fail bug prod promote`.
- Agent source version in dev is `0.2.33`.
- App/API version in the repo line is still `1.1.8`.

### Architecture facts

- `BI_OFFICIAL_UI_COLLAGE` is no longer just a prompt/schema domain pack. It now has draft UI/action/evidence/lint/discovery files.
- The domain pack UI contract files are exposed into Agent run input when present. The Agent downloads them as files like:
  - `input/domain_ui_contract.json`
  - `input/domain_action_set_metric_rows.json`
  - `input/domain_evidence_schema.json`
  - `input/domain_lint_rules.json`
  - `input/domain_discovery_page_map.json`
  - `input/domain_discovery_component_inventory.json`
- This exposure is not the same as a contract-driven runtime. The current helper still contains BI official UI adapter logic in TypeScript.
- Package consistency lint can read `domain_lint_rules.json` and warn about legacy official collage hints that use top-level `sourceReport + field` instead of `metrics[].sourceReport + metrics[].field`.
- `verify:domain-pack` now validates important shape for the BI official UI contract files instead of only parsing JSON.
- Result evidence gate now supports structured execution state and avoids the earlier false positive where expected prose mentioning Tool Bridge/native dialog triggered `TOOL_BRIDGE_RESPONSE_MISSING`.

### Live smoke facts

A-06 final smoke at `/Users/tommy/.uat-agent-dev/runs/live-smoke-a06-rerun20-20260516195045`:

- Case: `BIUI_COLLAGE_R001-A-06`
- Actions run:
  - `collage.openProject`
  - `collage.createReport`
  - `collage.inspectAllZeroFields`
- Result: helper action path completed.
- Important evidence:
  - 32 row-scoped fields were selected and verified.
  - Operation evidence included `field:selectAll:officialFinalSelected:32;visible=13;visibleRows=13`.
  - Preview request went to `/bi-dev/api/bi/report/myCustom/tileMode/preview?gameId=541`.
  - Request included 32 field codes, including offline mall fields such as:
    - `TOTAL_REVENUE_WEBSHOP_GASH`
    - `PAYMENT_ACCOUNTS_WEBSHOP_GASH`
    - `PAYMENT_COUNT_WEBSHOP_GASH`
    - `TOTAL_REVENUE_WEBSHOP_CODAPAY`
    - `PAYMENT_ACCOUNTS_WEBSHOP_CODAPAY`
    - `PAYMENT_COUNT_WEBSHOP_CODAPAY`
    - `TOTAL_REVENUE_WEBSHOP_BEANPOINT`
    - `PAYMENT_ACCOUNTS_WEBSHOP_BEANPOINT`
    - `PAYMENT_COUNT_WEBSHOP_BEANPOINT`
    - `TOTAL_REVENUE_WEBSHOP_BEANPOINTHK`
    - `PAYMENT_ACCOUNTS_WEBSHOP_BEANPOINTHK`
    - `PAYMENT_COUNT_WEBSHOP_BEANPOINTHK`
  - Warning remained: `DATE_UI_CONTROL_TEXT_NOT_FOUND`.
  - Screenshot artifact:
    - `/Users/tommy/.uat-agent-dev/runs/live-smoke-a06-rerun20-20260516195045/BIUI_COLLAGE_R001-A-06/output/helper-artifacts/BIUI_COLLAGE_R001-A-06/BIUI_COLLAGE_R001-A-06-all-zero-field-inspection.png`

B/E/F/G regression smoke at `/Users/tommy/.uat-agent-dev/runs/live-smoke-regression-befg-20260516195912`:

- `BIUI_COLLAGE_R001-B-04`:
  - `openProject`, `createReport`, `runDateVariantsPreviewEvidence` completed.
  - Warnings:
    - `上週:DATE_UI_REPRESENTED_RANGE_NOT_VISIBLE`
    - `上週:DATE_UI_CONTROL_TEXT_NOT_FOUND`
    - `本週:DATE_UI_REPRESENTED_RANGE_NOT_VISIBLE`
    - `本週:DATE_UI_CONTROL_TEXT_NOT_FOUND`
- `BIUI_COLLAGE_R001-E-04`:
  - `openProject`, `createReport`, `configureCalculatedMetricAndPreview` completed.
  - Warning: `DATE_UI_CONTROL_TEXT_NOT_FOUND`
- `BIUI_COLLAGE_R001-F-01`:
  - `openProject`, `createReport`, `configureMetric`, `runPreviewAndCollectEvidence`, `saveReport` completed.
  - Warnings empty.
- `BIUI_COLLAGE_R001-G-01`:
  - `openProject`, `createProject` completed.
  - Warnings empty.
- F `saveReport` and G `createProject` were run with `--approved-tool-request-id`, because the helper requires explicit approval for those higher-risk visible UI operations.

### Verification facts

After the latest code/doc changes, these passed:

```bash
npm run typecheck --prefix agent
npm run build --prefix agent
npm run verify:helper-field-aliases
git diff --check
```

The latest dev commit `ec6e40e` includes:

- `README.md`
- `agent/package.json`
- `agent/src/bi-ui-helper-executor.ts`
- `docs/planning/domain-ui-contract-helper-gen3-gen4-plan.md`
- `docs/planning/online-uat-tool-development-log.md`
- `docs/refactor/工程spac.md`
- `scripts/verify-helper-field-aliases.ts`

## Unverified Or Risky Assumptions

- A full dev live UAT has not yet been reviewed after `ec6e40e`. The live smoke covered targeted cases, not the whole package.
- Production runtime status was not freshly checked through `/version` or `/health` while writing this handoff. Git remote shows prod branch still at `7d5c3a8`, but deployed runtime should be verified before any prod discussion.
- `DATE_UI_CONTROL_TEXT_NOT_FOUND` and `DATE_UI_REPRESENTED_RANGE_NOT_VISIBLE` warnings are not proven product bugs. They may be helper evidence limitations, official UI text limitations, or testcase assertion granularity issues. Classify them when they appear in the next full UAT.
- The current domain contract files are reviewed draft seeds. They are useful inputs for Claude/package lint/future helper templates, but helper runtime does not yet execute them as the single source of behavior.
- The official UI adapter is still in `agent/src/bi-ui-helper-executor.ts`, so helper complexity is still growing in the short term.
- Testcase quality may still be insufficient for the new official UI model. Some cases may need new structured helper hints, especially `metrics[]`, formula `baseFields[]`, date variants, save/reopen expectations, and explicit frontend observation targets.
- Cloud feedback loop storage is not implemented yet. Drift/blocked observations are currently preserved in run artifacts, reports, docs, and local repo files, not in a durable cloud feedback store.

## Current Repo / Deployment / Run State

Current dev branch state:

```text
repo: /Users/tommy/Downloads/codex_galaxy_dev/uat-tool
branch: dev/uat-agent-config-isolation
HEAD: ec6e40e fix: harden official BI helper selection
remote dev: ec6e40e55f20711b8802e12cecb3f1df33f42b70
```

Current production branch state from git remote:

```text
origin/refactor/mac-agent-mvp: 7d5c3a8 docs: record fail bug prod promote
origin/codex/uat-tool-mvp: 7d5c3a8 docs: record fail bug prod promote
```

Latest relevant dev-only commits after production branch `7d5c3a8`:

```text
ec6e40e fix: harden official BI helper selection
eb64923 fix: guard official UI observation helper routing
8f0fb67 fix: enforce official UI domain contracts
ce12d6f fix: bridge official collage metric rows
3b2756e feat: expose domain UI contracts to agent runs
9786c4e docs: record domain UI contract helper plan
25a451a docs: record official BI picker helper adapter
24e37c9 fix: support official BI field picker extraction
4aeaf0e fix: support official BI collage helper navigation
0f2f480 fix: wait for chrome cdp before opening dev url
fae2a28 feat: open dev url via agent chrome
77f76a8 fix: resolve release date from commit metadata
d42ab68 feat: show release metadata in header
1455906 feat: expose domain pack selection in web UI
02e4115 docs: add domain pack workflow trigger
f659856 chore: standardize domain pack generation workflow
c73f507 feat: add BI official UI collage domain pack
```

Interpretation:

- Dev has significant new official UI/domain-pack work that prod does not yet have.
- `ec6e40e` should be treated as a dev test candidate, not a production-ready release until a full dev live UAT is reviewed.

## Work Completed Since Previous Handoff

This section is intentionally detailed because this thread contains the transition from "domain pack as rules/prompt" to "domain pack as executable UI/action/evidence contract input."

### 1. Official UI domain pack exists and can be selected in Web UI

Relevant commits:

- `c73f507 feat: add BI official UI collage domain pack`
- `f659856 chore: standardize domain pack generation workflow`
- `02e4115 docs: add domain pack workflow trigger`
- `1455906 feat: expose domain pack selection in web UI`

What changed:

- Added `domain-packs/BI_OFFICIAL_UI_COLLAGE/`.
- Added domain pack generation workflow and templates.
- Added Web UI domain selector so PM can choose `Galaxy BI` or `Galaxy BI Official UI Collage`.
- Choosing the official UI collage domain can set Dev URL to:

```text
https://galaxy.games.gamania.com/bi-dev/zh-TW/home
```

Why it mattered:

- Earlier failure occurred because a run still used the old/default BI domain pack when the official UI domain pack was needed.
- Correct domain selection is a prerequisite, but it was not sufficient. The helper still needed official UI capability.

### 2. Dev URL open button and dedicated Chrome preparation were added

Relevant commits:

- `fae2a28 feat: open dev url via agent chrome`
- `0f2f480 fix: wait for chrome cdp before opening dev url`

What changed:

- Web UI `Dev URL` field gained an Agent-backed `開啟連結` action.
- It opens the URL in the same dedicated Chrome profile used by the Agent/test run.
- This is for login/session preparation and should not create a UAT run or mutate testcase state.

Why it mattered:

- Tommy needed to log in before live smoke.
- This reduces SSO/session confusion between user browser and Agent browser.

### 3. Official UI helper navigation bridge was added

Relevant commit:

- `4aeaf0e fix: support official BI collage helper navigation`

What changed:

- Helper learned official UI navigation for:
  - home page,
  - left/sidebar custom report area,
  - `我的自訂 > 拼貼報表`,
  - project selection,
  - report creation flow.
- It stopped assuming the old `/biapi-dev/testview` UI shape.

Why it mattered:

- The old helper assumed project/report names or controls were already visible.
- Official UI requires navigating through official sidebar/project pages before editor actions are available.

### 4. Official metadata dropdown field extraction was fixed

Relevant commits:

- `25a451a docs: record official BI picker helper adapter`
- `24e37c9 fix: support official BI field picker extraction`

What changed:

- `collage.extractMetadataDropdownFields` no longer uses the old `+ 新增欄位` / global field list assumption on official UI.
- Official editor path now uses first metric row:
  1. click source report control,
  2. select official source alias,
  3. verify source control,
  4. open field picker,
  5. extract visible field rows.
- Added source alias handling such as:
  - `各登入渠道狀況(原 beanfun! 導流)` -> `beanfun!導流`.
- Field type badges such as `數值` are cleaned before writing dropdown evidence.

Why it mattered:

- A-04 changed from helper DOM blocker (`METADATA_DROPDOWN_NO_VISIBLE_ITEMS_EXTRACTED`) to real metadata-vs-official-UI evidence.

### 5. Domain UI Contract / Helper Gen3-Gen4 plan was recorded

Relevant commit:

- `9786c4e docs: record domain UI contract helper plan`

What changed:

- Added `/docs/planning/domain-ui-contract-helper-gen3-gen4-plan.md`.
- Defined five-layer direction:

```text
Domain UI Discovery
  -> Domain UI + Action + Evidence Contract
  -> Gen 3 Domain-driven Helper Templates
  -> Gen 4 Stable Core + Action Interpreter
  -> Cloud Feedback Loop
```

Core decision:

- Domain packs should not ship arbitrary executable helper code.
- Domain packs should ship declarative UI/action/evidence contracts, helper templates, locator registry, lint rules, and discovery data.
- Helper should eventually become a stable core plus allowlisted action interpreter.

Why it mattered:

- Tommy explicitly pushed back against "fixing just this testcase."
- The plan records that future new UI/features must be made processable through domain contracts, not one-off helper growth.

### 6. UI Discovery / UI Contract share note was written

Relevant commit:

- `3b2756e feat: expose domain UI contracts to agent runs`

The note file:

- `/docs/planning/domain-ui-discovery-contract-share-note.md`

What it explains:

- Domain UI Discovery should be part of domain pack creation, not a temporary testcase-generation step.
- Discovery output should include:
  - page map,
  - component inventory,
  - locator candidates,
  - action primitives,
  - state assertions,
  - evidence schema,
  - hazards.
- The contract should serve Claude, package lint, helper templates, result evidence gate, and feedback/drift updates.

Why it mattered:

- Tommy wanted a shareable explanation of the idea.
- This is the strongest written artifact explaining why UI contract belongs inside domain pack.

### 7. Domain UI contract files are now exposed to Agent runs

Relevant commit:

- `3b2756e feat: expose domain UI contracts to agent runs`

What changed:

- Added draft contract files to `BI_OFFICIAL_UI_COLLAGE`.
- Domain loader/API/run input/Agent download path can now include optional UI contract files.
- Agent run prompts/reference/rule index can read these files.

Important boundary:

- This is data plumbing and readability.
- It does not yet mean helper runtime is executing `setMetricRows.json` as an interpreter.

### 8. `setMetricRows(metrics[])` bridge and result gate fixes were added

Relevant commit:

- `ce12d6f fix: bridge official collage metric rows`

What changed:

- Helper normalizes both:
  - new structured `metrics[]`, and
  - old legacy `sourceReport + field`
  into row-scoped official metric row operations.
- Official UI editor path can now:
  1. choose source report in the correct row,
  2. open that row's field picker,
  3. select the requested field,
  4. verify row text,
  5. emit `metric-rows-evidence.json`.
- Affected helper paths include:
  - `collage.configureMetric`,
  - `collage.runDateVariantsPreviewEvidence`,
  - `collage.configureCalculatedMetricAndPreview`,
  - `collage.inspectAllZeroFields`.
- Preview precondition counts official selected metric rows instead of only legacy selected-field buttons.
- Result evidence gate ignores Tool Bridge/native-dialog prose in `測試目的` / `設定條件` / `預期行為`.
- Result gate still requires Tool Bridge evidence if actual execution/evidence claims native dialog, irreversible action, overwrite, or delete was reached.

Why it mattered:

- Run `67990303-2c1b-4559-924a-297a089b5949` had many `VISIBLE_UI_CLICK_BLOCKED: text="新增帳號數"` failures because helper clicked global text instead of row-scoped controls.
- F-01-like cases hit `TOOL_BRIDGE_RESPONSE_MISSING` false positives because expected text mentioned Tool Bridge even when save/native dialog was never reached.

### 9. Gen1c contract hardening was added

Relevant commit:

- `8f0fb67 fix: enforce official UI domain contracts`

What changed:

- Package consistency checker can read domain lint rules.
- CLI checker supports `--domain` and `--domain-lint-rules`.
- `verify:domain-pack` validates the shape of:
  - `ui-contract.json`,
  - `action-contracts/setMetricRows.json`,
  - `evidence-schema.json`,
  - `lint-rules.json`,
  - `discovery/page-map.json`,
  - `discovery/component-inventory.json`.
- Result gate supports structured `executionState`:
  - `nativeDialogReached`,
  - `irreversibleActionReached`,
  - `overwriteConfirmReached`,
  - `deleteConfirmReached`
  require Tool Bridge response.
  - `setupBlocked`,
  - `previewNotReached`,
  - `saveNotReached`
  do not.

Why it mattered:

- This starts moving execution/result validation away from fragile regex and toward contract/state-based evidence.

### 10. Official UI observation routing guard was added

Relevant commit:

- `eb64923 fix: guard official UI observation helper routing`

Context:

- Run `4bf277d7-6193-4943-9770-fc317a11ee1f` still showed many blocked cases.
- Some I/J frontend observation/list/sidebar/modal/button cases had no per-case helper hints.
- Planner incorrectly fell back to generic helper sequence:

```text
openProject -> createReport -> configureMetric -> runPreview
```

- That caused `EXECUTE_PRECONDITION_NO_SELECTED_FIELDS` and misleading BLOCKED results for cases that were never supposed to run a preview.

What changed:

- Capability gate and helper execution plan now detect no-hints frontend observation cases.
- For official collage observation cases, helper allows only safe prelude navigation:
  - project/list cases: usually `collage.openProject`,
  - editor initial observation cases: at most `collage.openProject + collage.createReport`.
- It must not auto-fallback into configureMetric/runPreview.

Why it mattered:

- This protects the future domain contract direction: testcase target type must control helper behavior, not generic fallback guesses.

### 11. A-06 select-all and official picker smoke hardening were added

Relevant commit:

- `ec6e40e fix: harden official BI helper selection`

Context from live smoke:

- Tommy saw the screen stuck at "沒有選欄位" and asked for real live smoke, not just static checks.
- A-06 initially failed at mid-list fields such as:
  - `平台總營收`,
  - `線下商城GASH總營收`,
  - `線下商城Coda總營收`.

Root causes found:

- Official UI display labels do not always match metadata labels exactly.
- Offline mall labels require display-query variants with spaces, for example:
  - metadata: `線下商城GASH總營收`
  - official search/display may need: `線下商城 GASH 總營收`
  - metadata: `線下商城Coda總營收`
  - official search/display may need: `線下商城 CODAPAY 總營收`
- Picker options can be off-viewport if the current row is near the scroll container bottom.
- A-06 selected all 32 rows, but result gate counted only 13 visible rows and falsely blocked with count mismatch.

What changed:

- Added official display search variants for offline mall fields.
- Added row buffering before opening field picker in large select-all flows.
- Added row positioning/scroll before picker open.
- Added evidence-based final selected count using verified selections instead of only visible rows.
- Added `verify:helper-field-aliases` regression for offline mall search variants.
- Bumped Agent source version to `0.2.33`.

Why it mattered:

- A-06 now proves the helper can select all official UI row-scoped fields and run preview in live smoke.

## Open Issues And Decisions

### A. Full dev live UAT is still needed

The targeted live smoke is strong evidence, but it is not the full package.

Tommy's next full dev live UAT should answer:

- Do A/B/E/F/G remain unblocked in the actual run pipeline?
- Do I/J observation cases stop being misrouted to preview helpers?
- Does result upload still hit contract issues?
- Are remaining BLOCKED cases valid product/testcase limitations, or helper bridge gaps?

### B. Date UI warnings need classification

Current known warnings:

- `DATE_UI_CONTROL_TEXT_NOT_FOUND`
- `DATE_UI_REPRESENTED_RANGE_NOT_VISIBLE`

Do not immediately patch helper again. First classify:

- If testcase only needs preview payload/date range evidence, these may be non-blocking helper warnings.
- If testcase target is frontend presentation, they may become FAIL or BLOCKED depending on the expected visible label.
- If the date UI truly cannot expose represented range, the domain evidence contract should record a fallback evidence rule.

### C. Testcase generation likely needs a new contract-based authoring pass

Tommy asked whether Claude should still generate testcase.

Current recommendation:

- Claude can still generate bulk testcase content.
- But Claude should not freely invent UI operations.
- Claude must consume the domain UI/action/evidence contract and emit structured helper hints:
  - `operationTemplate`,
  - `metrics[]`,
  - `baseFields[]`,
  - date variants,
  - evidence expectations,
  - risk level,
  - test target,
  - cleanup state.

The next assistant should not say "Codex should replace Claude" unless there is new evidence. The better direction is Claude generation with stronger domain contract and lint.

### D. Current bridge must not become the permanent pattern

The helper currently still contains official BI UI adapter logic. This was practical for dev unblock and live smoke.

The next architectural move should be a vertical slice:

```text
BI_OFFICIAL_UI_COLLAGE/action-contracts/setMetricRows.json
  -> helper template runtime reads this contract
  -> action interpreter executes allowlisted ops
  -> existing TypeScript path remains fallback
  -> A-06 smoke proves contract path
```

Only after this vertical slice works should B/E/F/G actions be migrated.

### E. Domain pack "small adapter" needs careful wording

Tommy challenged whether "each domain has a small adapter" was previously rejected.

The clarified position:

- Arbitrary executable helper code in every domain pack is not recommended.
- A declarative domain adapter is acceptable and desirable.
- The adapter should be data: UI contract, action templates, locator candidates, evidence schema, and lint rules.
- Stable core/action interpreter executes only allowlisted operations.

### F. Cloud feedback loop is still open

Tommy explicitly wants future data to be stored in cloud, not only local files.

Needed future design:

- Store blocked reason taxonomy.
- Store locator drift.
- Store stale picker signatures.
- Store result gate false positives.
- Store upload contract mismatches.
- Link feedback to:
  - domain,
  - action template,
  - case id,
  - UI route,
  - helper version,
  - commit,
  - artifact paths.

This is not implemented yet.

## Recommended Next Steps

### If the next chat receives a new UAT report/archive

1. Read this handoff first.
2. Read the provided `UAT_report` and `UAT_archive`.
3. Do not immediately edit code.
4. Build a table of remaining problems by category:

```text
case id
status
reported blocker/failure
actual reached action
expected action/template
classification:
  helper bridge bug
  testcase/helper-hints issue
  result gate/upload contract issue
  domain UI contract missing data
  product/frontend/backend issue
  expected/non-blocking warning
recommended owner:
  Codex tool fix
  testcase/Claude authoring fix
  domain contract update
  result gate update
  PM/product decision
```

5. For helper-related items, check whether the fix should be:
   - short-term bridge patch, or
   - domain contract/template update, or
   - Gen3 vertical-slice work.
6. Only after classification, propose a targeted fix plan.

### If the next chat is asked to implement

Use this order unless the latest UAT evidence says otherwise:

1. Fix true bridge regressions that block broad test execution.
2. Fix result gate/upload contract false positives.
3. Update domain contract/lint rules for newly discovered UI drift.
4. Add focused fixtures.
5. Run targeted live smoke for affected cases.
6. Push dev only.
7. Do not promote prod until Tommy approves after a full dev live UAT.

### Suggested Gen3 vertical slice

Start with `setMetricRows(metrics[])` because:

- It was the main root cause of many official UI blockers.
- A-06 is a strong live-smoke proof case.
- Existing bridge evidence already maps well to an action contract.

Minimum deliverable:

- `setMetricRows` contract path can read:
  - row source selector,
  - field picker,
  - search variants,
  - row scroll/buffer behavior,
  - overlay dismiss behavior,
  - row verification,
  - evidence schema.
- Helper runtime executes that through an allowlisted action interpreter.
- Existing TypeScript bridge path remains fallback.
- A-06 live smoke proves contract path.

### Suggested testcase authoring adjustment

Before another large official UI testcase generation round, require Claude/testcase package to include:

- `domain=BI_OFFICIAL_UI_COLLAGE`
- explicit `operationTemplate`
- `metrics[].sourceReport`
- `metrics[].field`
- formula `baseFields[].sourceReport`
- formula `baseFields[].field`
- structured evidence expectations
- frontend observation cases marked so helper only navigates/observes and does not run preview
- date assertion mode:
  - visible UI label required,
  - payload date range sufficient,
  - both required.

### Suggested result gate direction

Continue replacing fragile text regex with structured state:

- `setupBlocked`
- `previewReached`
- `previewNotReached`
- `saveReached`
- `saveNotReached`
- `nativeDialogReached`
- `irreversibleActionReached`
- `toolBridgeResponsePresent`

This prevents another `TOOL_BRIDGE_RESPONSE_MISSING` false positive when text merely describes expected irreversible behavior.

## Ready-To-Paste New Chat Prompt

```text
請先讀這份 handoff：

/Users/tommy/Downloads/codex_galaxy_dev/uat-tool/docs/planning/session-handoff-2026-05-17-bi-official-ui-contract-next.md

讀完後請先回覆你理解到的：
1. 目前 dev/prod 分支與部署狀態
2. 這輪已完成的 BI official UI helper bridge 與 live smoke 結果
3. 為什麼這次修復只是 Gen1/Gen2 compatibility bridge，不是最終通用 helper 架構
4. Domain UI Discovery / UI Contract / Action Contract / Evidence Contract 已經落地到哪裡，還沒落地到哪裡
5. 下一輪 UAT report/archive 應該如何分類判讀，而不是只把所有問題都當 helper bug

先不要改程式，也不要推 prod。等你確認理解後，我會提供新的 UAT_report / UAT_archive，請你再依據最新 evidence 判斷真正原因與修正方案。
```

