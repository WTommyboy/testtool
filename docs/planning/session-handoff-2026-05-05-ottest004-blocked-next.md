# Session handoff - OTTEST004 blocked analysis after `續接 OTTEST002 P0`

Date: 2026-05-05 Asia/Taipei

This handoff summarizes the second Codex thread named `續接 OTTEST002 P0`.
Despite the thread name, the latest active work is OTTEST004 tooling triage.
Use this file to continue in a new chat without loading the raw session JSONL.

## Source thread

- Thread id: `019dea11-3757-7b72-afe2-e7e34363c2b0`
- Thread name: `續接 OTTEST002 P0`
- Local JSONL: `/Users/tommy/.codex/sessions/2026/05/03/rollout-2026-05-03T03-01-30-019dea11-3757-7b72-afe2-e7e34363c2b0.jsonl`
- Size: about `21MB`, `5314` lines.
- Failure mode:
  - `2026-05-05T02:56:56Z`: `Error running remote compact task: stream disconnected before completion`
  - `2026-05-05T03:06:26Z`: same compact stream disconnect again.
- Last observed token counts:
  - `2026-05-05T02:40:15Z`: `209,824` input tokens against `258,400` context window.
  - `2026-05-05T02:40:42Z`: `232,398` input tokens against `258,400` context window.

Do not read the raw JSONL unless this handoff and `online-uat-tool-development-log.md` are insufficient.

## Current production snapshot

- Local branch: `refactor/mac-agent-mvp`
- Deployment branch: `codex/uat-tool-mvp`
- Current commit on both branches: `039568cc0212ac11c1038c54f7262a66bbd28b75`
- Short commit: `039568c`
- Commit subject: `fix collage helper project selection`
- App version: `1.1.2`
- Mac Agent package version: `0.2.6`
- Railway deployment id: `8289819f-d10c-4df7-923f-d992be311b79`
- Railway `/health`: healthy as checked on 2026-05-05.
- Local LaunchAgent: `com.tommy.uat-agent` running, pid `74201`.

## Work completed in this long thread

The thread includes multiple production fixes after the previous OTTEST002 handoff:

1. OTTEST002 P0 closure: root app `1.1.0`, Agent `0.2.0`.
   - BLOCKED detail_json health.
   - A-03 metadata helper wait.
   - reopenReport settle/network evidence.
   - complete run archive MD download.
   - mobile RWD overflow fixes.

2. CSV/helper continuation fixes: app `1.1.1`, Agent `0.2.1`.
   - CSV comparison no longer false-fails on duplicated preview header or `Date` vs `日期`.
   - pending Tool Bridge helper actions can auto-continue after Agent approval.

3. A-05 exact selected field reconciliation: Agent `0.2.2`.
   - Existing-report helper removes duplicate/unwanted fields and verifies selected field exact match.

4. PASS vs helper false-check gate: Agent `0.2.3`.
   - PASS rows are rejected before upload if same-run helper evidence has false expected state checks.

5. OTTEST004 pre-run P0: app `1.1.2`, Agent `0.2.4`.
   - Partial aggregate result download from normalized server state.
   - Tool Bridge response evidence can be read from run events.
   - preview-only helper guard prevents unintended save/reopen.
   - PM skipped rows classified separately in summary/MD.

6. OTTEST004 package consistency parser fix: Agent `0.2.5`.
   - Inline `狀態清理` parsing no longer falsely reports `CLEANUP_CHECKLIST_CONFLICT` across all cases.

7. OTTEST004 project auto-selection fix: Agent `0.2.6`, commit `039568c`.
   - `collage.openProject` without explicit `projectName` now selects visible `拼貼test_001`.
   - `openProject` must see the `新增報表` entry before returning `ok`.
   - `createReport`, `openExistingReport`, `reopenReport`, and report-list CSV recovery use the same project-selection guard.
   - Smoke test passed: no `projectName`, `collage.openProject` selected `拼貼test_001`, `collage.createReport` entered `/testview/edit?...projectId=9&projectName=拼貼test_001`.

## Latest user concern before crash

Tommy supplied:

- `/Users/tommy/Downloads/UAT_report_8c87e614-5166-4f22-a9f4-675dc07f3e30.md`
- `/Users/tommy/Downloads/UAT_result_8c87e614-5166-4f22-a9f4-675dc07f3e30.xlsx`
- `/Users/tommy/Downloads/UAT_archive_8c87e614-5166-4f22-a9f4-675dc07f3e30.md`

Question:

> 你先看看，評估原因。還是那麼多 blocked 不正常吧，只是日期篩選工具怎麼也可以 blocked 呢？對了我先暫停了，因為覺得不正常。

The crashed thread began investigating this but did not reach a final response or code changes.

## Run under investigation

- Run id: `8c87e614-5166-4f22-a9f4-675dc07f3e30`
- Local workspace: `/Users/tommy/.uat-agent/runs/8c87e614-5166-4f22-a9f4-675dc07f3e30`
- Report says status: `CANCELLED`.
- Result workbook rows: `44`
- Status counts:
  - `PENDING`: 25
  - `BLOCKED`: 13
  - `PASS`: 5
  - `FAIL`: 1
- Failure category counts:
  - `EVIDENCE_INSUFFICIENT`: 13
  - `FUNCTIONAL_FAILURE`: 1

Important: project auto-selection is no longer the main issue. A-02/A-03/B-01/B-09/D-01 passed, which proves helper can enter the project/editor and execute preview for some cases.

## Current root-cause grouping

### 1. Date shortcut text normalization bug

Affected examples:

- `OTTEST004-B-03`: `DATE_RANGE_PRESET_NOT_FOUND:昨日(快捷)`
- `OTTEST004-B-04`: `DATE_RANGE_PRESET_NOT_FOUND:上週(快捷)`
- `OTTEST004-B-05`: `DATE_RANGE_PRESET_NOT_FOUND:上月(快捷)`
- `OTTEST004-B-06`: `DATE_RANGE_PRESET_NOT_FOUND:過去30天(快捷)`
- `OTTEST004-B-11`: `DATE_RANGE_PRESET_NOT_FOUND:昨日(快捷起點)`

Evidence from B-03 helper artifact:

- Artifact:
  `/Users/tommy/.uat-agent/runs/8c87e614-5166-4f22-a9f4-675dc07f3e30/output/helper-artifacts-archive/2026-05-05T02-23-31-348Z/OTTEST004-B-03/collage.configureMetric-latest.json`
- UI body/buttons clearly contain `昨日`, `今日`, `上週`, `本週`, `上月`, `本月`, `過去30天`, `最近30天`.
- Helper tried to click exact `昨日(快捷)` instead of normalized visible label `昨日`.

Likely fix:

- In `agent/src/bi-ui-helper-executor.ts`, `setDatePreset()` should normalize case-design labels before visible UI lookup:
  - Strip parenthetical suffixes such as `(快捷)` and `(快捷起點)`.
  - Map `昨日(快捷)` -> `昨日`, `上週(快捷)` -> `上週`, `上月(快捷)` -> `上月`, `過去30天(快捷)` -> `過去30天`.
  - Verification should allow visible UI text to contain the normalized UI preset, while evidence should preserve the original requested label.
- Add regression fixture in `scripts/verify-helper-report-gate.ts`.

### 2. Custom/dynamic date-range helper capability gap

Affected examples:

- `OTTEST004-B-07`: custom dynamic `14天前~1天前`.
- `OTTEST004-B-08`: half dynamic/static range, currently result is `FAIL/FUNCTIONAL_FAILURE`.
- `OTTEST004-B-10`: 90/91 day boundary custom date scenario.

Observation:

- The current helper supports fixed static date ranges like `2026/03/01~2026/03/31`; B-09 passed.
- It also can click visible preset labels once labels are normalized.
- It does not yet implement robust dynamic offset entry and half-static/half-dynamic date UI operations.

Next decision:

- Either implement dynamic/half-dynamic date UI support in helper, or make plan generation mark these cases as AI/manual-required rather than trying unsupported `collage.configureMetric` date setup and producing noisy BLOCKED/FAIL.
- Tommy's concern is valid: a common date tool should not remain broadly BLOCKED if OTTEST004 is intended to be automated.

### 3. Metadata dropdown expected/source scope mismatch

Affected examples:

- `OTTEST004-A-01`: `METADATA_EXPECTED_FIELDS_EMPTY`, `METADATA_DROPDOWN_SOURCE_GROUP_SCOPE_NOT_FOUND_USING_ALL_ITEMS`.
- `OTTEST004-A-04`: same expected-empty/source-scope issue.
- `OTTEST004-B-02`: same expected-empty/source-scope issue.
- `OTTEST004-A-05`: helper `ok`, but evidence used all-items fallback; expected `2`, actual `80`, missing `國家地區營收`, `總營收`, extra `80`.

Evidence from A-05:

- Artifact:
  `/Users/tommy/.uat-agent/runs/8c87e614-5166-4f22-a9f4-675dc07f3e30/output/helper-artifacts-archive/2026-05-05T02-18-06-050Z/OTTEST004-A-05/collage.extractMetadataDropdownFields-latest.json`
- Requested source report: `雙平台營收佔比`.
- Expected fields from metadata: `國家地區營收`, `總營收`.
- Actual visible field picker sample starts with daily-report-like fields:
  `新增帳號數`, `MAU(帳號)`, `活躍人數(回訪使用者)`, `MAX CCU`, `AVG CCU`, `總營收(TWD)`, ...
- Artifact says `actualScope.mode=all_items_fallback`, so it did not truly scope to the requested source report group.

Likely fix:

- Revisit `extractMetadataDropdownFields` group scoping:
  - Correctly map testcase source labels to UI/source group labels.
  - Do not treat all field picker items as a requested source group when group scoping fails.
  - If the BI UI currently exposes a global flat picker, separate "global picker evidence" from "source-specific metadata comparison" instead of claiming source-level comparison.
- Revisit metadata name normalization:
  - `總營收` vs `總營收(TWD)` may be a naming normalization issue.
  - But A-05's `actual=80` vs expected `2` is primarily source scope failure, not just naming.

### 4. D-02 "all 72 fields" helper cannot parse aggregate selection phrase

Current active case at crash:

- `OTTEST004-D-02`: all fields once selected, CSV full export.
- Current case pack:
  `/Users/tommy/.uat-agent/runs/8c87e614-5166-4f22-a9f4-675dc07f3e30/input/current-case-pack.md`
- Helper artifact:
  `/Users/tommy/.uat-agent/runs/8c87e614-5166-4f22-a9f4-675dc07f3e30/output/helper-artifacts/OTTEST004-D-02/collage.configureMetric-latest.json`
- Blocker:
  `VISIBLE_UI_CLICK_BLOCKED: text="4 來源報表全選 72 欄"`

Likely fix:

- `helperHints.params.selectAllFields=true`, `sourceReports=[...]`, `expectedFieldCount=72` should override the synthetic field label `4 來源報表全選 72 欄`.
- `collage.configureMetric` should not click that phrase as a real field.
- Implement explicit select-all-fields flow:
  - open field picker
  - collect/select all visible field items or all source report fields according to `sourceReports`
  - verify selected count equals `expectedFieldCount` or explain mismatch.

## Suggested next-chat opening prompt

```text
請先讀：
1. /Users/tommy/Downloads/codex_galaxy/uat-tool/docs/planning/session-handoff-2026-05-05-ottest004-blocked-next.md
2. /Users/tommy/Downloads/codex_galaxy/uat-tool/docs/planning/online-uat-tool-development-log.md
3. /Users/tommy/Downloads/codex_galaxy/uat-tool/AGENTS.md

不要讀「續接 OTTEST002 P0」的 raw JSONL，尤其不要讀：
/Users/tommy/.codex/sessions/2026/05/03/rollout-2026-05-03T03-01-30-019dea11-3757-7b72-afe2-e7e34363c2b0.jsonl

請接續分析並修 `8c87e614-5166-4f22-a9f4-675dc07f3e30` 這輪 OTTEST004 大量 BLOCKED 的工具側問題。優先處理：
1. 日期快捷 preset normalization：`昨日(快捷)`、`上週(快捷)`、`上月(快捷)`、`過去30天(快捷)`、`昨日(快捷起點)` 應映射到 UI 可見的 `昨日/上週/上月/過去30天`。
2. 決定並處理自訂/半動態日期：要嘛實作 helper UI 操作，要嘛在 helper plan 明確標為 AI/manual-required，避免 noisy BLOCKED/false FAIL。
3. 修 metadata dropdown source scope：不要在來源 group scope 失敗時把 80 個全域欄位當成單一來源報表；先釐清 A-01/A-04/B-02 expected empty 與 A-05 all-items fallback。
4. 修 D-02 selectAllFields：`4 來源報表全選 72 欄` 不是可點擊欄位，要根據 helperHints.params.selectAllFields/sourceReports/expectedFieldCount 走全選流程。

修改前先回報你讀到的 root cause 與修改範圍。修改後更新 README、refactor docs、planning log；跑相關 typecheck/build/verify；commit/push `refactor/mac-agent-mvp` 與 `codex/uat-tool-mvp`；確認 Railway `/version`、`/health`；若 Agent code 有改，重啟本機 `com.tommy.uat-agent`。
```

## Immediate recommendation

Do not use run `8c87e614-5166-4f22-a9f4-675dc07f3e30` for BI product judgment.
It is a valid tool-validation run showing that project selection improved, but date preset normalization, dynamic date capability, metadata source scoping, and select-all-fields handling still need tool fixes before restarting the 44-case OTTEST004 run.
