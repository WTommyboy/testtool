# Session Handoff — BI Official UI P0 Runtime Next

Date: 2026-05-31

## 1. Branch / Deploy / Agent State

- Active local dev checkout: `/Users/tommy/Downloads/codex_galaxy_dev/uat-tool`
- Active branch: `dev/uat-agent-config-isolation`
- Latest pushed commit: `5fca881 fix: route BI collage observation and CSV blockers`
- Remote pushed: `origin/dev/uat-agent-config-isolation`
- Dev agent service: `com.tommy.uat-agent-dev`
- Service was restarted after build.
- Last confirmed runtime:
  - `agent/dist/cli.js` mtime: `2026-05-30 04:11:54 +0800`
  - process start: `Sat May 30 04:14:10 2026`
  - pid at confirmation time: `3472`
- Prod was not pushed from this session.

Important: The repo still has unrelated dirty docs/domain-pack/package changes that were intentionally not included in commit `5fca881`.

## 2. Latest Runtime Patch Scope

Commit `5fca881` addressed blockers from the latest full-run/reduced-run analysis. The patch is runtime-level, not a per-result override.

Changed files:

- `agent/src/bi-ui-helper-executor.ts`
- `agent/src/capability-gate.ts`
- `agent/src/helper-execution-plan.ts`
- `scripts/verify-capability-gate.ts`

Main behavior changes:

1. `J-06` download tooltip routing:
   - Added `rowDownloadTooltip`.
   - Download tooltip is no longer routed to `rowDeleteTooltip`.
   - Expected route: `openProject -> observeFrontendState(rowDownloadTooltip)`.

2. `K-05 / K-06 / K-07` metric row controls:
   - Added metric row observation routes:
     - `metricRowAdd`
     - `metricRowDuplicate`
     - `metricRowDelete`
     - `metricRowControls`
   - These now use helper visible-UI observation rather than generic preview or manual-only browser steps.

3. Count-only field cleanup handling:
   - `欄位=1欄`, `空→1欄`, and similar text are treated as count/cleanup requirements, not clickable metric labels.
   - For minimal CSV/preview cases, default BI Collage metric is:
     - source report: `每日報表`
     - metric field: `新增帳號數`
   - Goal: prevent `selected metric fields = 0` and prevent searching for literal `空→1欄`.

4. `N-04` project-row download-only route:
   - If a case only tests project-page row download trigger and explicitly does not test CSV content, it stays on report list.
   - Expected route: `openProject -> downloadCsvAndComparePreview(downloadScope=report_list, allowAnyReportListRowDownload=true)`.
   - It must not enter editor/configure metric/run preview.

## 3. Verification Already Run

All passed after the patch:

- `npm run verify:capability-gate`
- `npm run typecheck`
- `npm run build --prefix agent`
- `npm run build`
- `npm run verify:result-evidence-gate`
- `npm run verify:agent-result-contract`
- `git diff --check -- agent/src/bi-ui-helper-executor.ts agent/src/helper-execution-plan.ts agent/src/capability-gate.ts scripts/verify-capability-gate.ts`

Additional route smoke against actual run case JSON from `e712cee7-42a1-4ded-9ed1-41992afda52c` confirmed:

- `BIUI_COLLAGE_R001-J-06` routes to `rowDownloadTooltip`
- `BIUI_COLLAGE_R001-K-05` routes to `metricRowAdd`
- `BIUI_COLLAGE_R001-K-06` routes to `metricRowDuplicate`
- `BIUI_COLLAGE_R001-K-07` routes to `metricRowDelete`
- `BIUI_COLLAGE_R001-K-09` still routes to `fieldPicker`
- `BIUI_COLLAGE_R001-N-04` stays on `report_list`
- `BIUI_COLLAGE_R001-N-08 / N-09` use default minimal metric setup instead of selected fields = 0

## 4. How To Read Next UAT Report / Archive

Do not treat every BLOCKED as a helper bug. Classify each issue by evidence:

1. Runtime/agent lifecycle issue:
   - run stops, task dispatch crash, stale dist, Chrome/session failure, Railway status problem.
   - Check run brief, agent process time, dist mtime, service status, and helper continuation/self-check artifacts.

2. Route/planning issue:
   - helper enters editor when case says project-page row action.
   - helper uses generic preview for frontend observation.
   - helper uses wrong observation type, e.g. delete tooltip for download tooltip.

3. Domain pack / contract gap:
   - case action exists conceptually but observation type/action target is missing or too broad.
   - vocabulary/UI object mismatch causes planner to choose wrong target.

4. Testcase issue:
   - testcase asks for UI option that does not exist in current product.
   - testcase expects an environment precondition not established by the test.
   - testcase mixes flow target and outcome target without explicit priority.

5. Product issue:
   - UI action is reachable but disabled/not implemented when the case tests frontend/function flow.
   - preview/download/request evidence proves actual product behavior is wrong.

6. Tool limitation:
   - visible UI path exists but current tool cannot interact with it safely.
   - Should be reduced over time, but should not be disguised as product FAIL.

## 5. Open Items / Known Cautions

- E formula/helper work should not be mixed into this patch. Formula setup is a larger capability and needs its own smoke path.
- Current dirty docs/domain-pack/package files need separate review before committing.
- `5fca881` includes runtime behavior and smoke coverage only.
- If next run still has many BLOCKED, inspect whether it is using the restarted dev agent and commit `5fca881` before judging behavior.
- If a run uses RC URL, ensure RC support dirty changes are either intentionally committed or otherwise available in the runtime checkout before testing RC.

## 6. Suggested First Message For New Chat

Use this in a new Codex window:

```text
請先讀這份 handoff：

/Users/tommy/Downloads/codex_galaxy_dev/uat-tool/docs/planning/session-handoff-2026-05-31-bi-official-ui-p0-runtime-next.md

讀完後請先回覆你理解到的：
1. 目前 dev 分支、commit、agent/service 狀態
2. 5fca881 修了哪些 route / helper / result-gate 相關問題
3. 下一輪 UAT_report / UAT_archive 要如何分類 BLOCKED / FAILED，而不是全部當 helper bug
4. 哪些事情尚未完成或不該混在這輪修

先不要改程式，也不要推 prod。等你確認理解後，我會提供新的 UAT_report / UAT_archive，請你再依據最新 evidence 判斷真正原因與修正方案。
```

## 7. Suggested File Attachments For New Run Review

When a new UAT finishes, provide:

- `UAT_report_<run_id>.md`
- `UAT_archive_<run_id>.md`
- If available, Tommy manual check report / oracle for the same testcase version
- The exact testcase xlsx/md version used
- Whether the run was dev or RC
- The run ID

