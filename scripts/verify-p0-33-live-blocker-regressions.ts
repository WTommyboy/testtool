import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import type { CaseManifestCase } from "../agent/src/case-manifest";
import { buildDateUiEvidence } from "../agent/src/date-ui-evidence";
import { buildHelperExecutionPlan } from "../agent/src/helper-execution-plan";
import { ensureBlockedResultCurrentRunEvidence } from "../agent/src/result-evidence-enricher";
import type { StructuredCaseScopeContract } from "../agent/src/structured-case-scope";

type JsonObject = Record<string, any>;

const root = process.cwd();
const contractPath = path.join(root, "domain-packs", "BI_OFFICIAL_UI_COLLAGE", "case-scope-runtime-contracts.json");
const executorPath = path.join(root, "agent", "src", "bi-ui-helper-executor.ts");
const resultContractPath = path.join(root, "agent", "src", "result-contract.ts");

const readJson = <T>(filePath: string): T => JSON.parse(fs.readFileSync(filePath, "utf8")) as T;

const contracts = (): StructuredCaseScopeContract[] => {
  const file = readJson<JsonObject>(contractPath);
  return (file.contracts as JsonObject[]).map((item) => ({
    version: "v1",
    source: "domain-packs/BI_OFFICIAL_UI_COLLAGE/case-scope-runtime-contracts.json",
    domain: "BI_OFFICIAL_UI_COLLAGE",
    ...item
  })) as StructuredCaseScopeContract[];
};

const chineseTarget = (target: StructuredCaseScopeContract["testTarget"]): string => {
  switch (target) {
    case "frontend_presentation":
      return "前端呈現";
    case "frontend_backend_integration":
      return "前後端整合";
    case "functional_flow":
      return "功能流程";
    case "backend_function":
      return "後端功能";
    default:
      return "功能流程";
  }
};

const fixtureCase = (contract: StructuredCaseScopeContract): CaseManifestCase => ({
  order: 1,
  rowNumber: 2,
  groupId: contract.caseNo.split("-").at(-2) ?? null,
  groupName: "P0.33 live blocker regression fixture",
  caseNo: contract.caseNo,
  caseTitle: `${contract.caseNo} P0.33 regression smoke`,
  testType: chineseTarget(contract.testTarget),
  executionMethod: "agent",
  riskLevel: contract.requiredActions.some((item) => item.evidenceRequirements.includes("toolBridge.response")) ? "🟠 修改" : "🟢 觀察",
  testTarget: chineseTarget(contract.testTarget),
  cleanupChecklist: "欄位=不影響;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
  preconditions: contract.requiresEditor ? "起始頁面: BI official UI；進入拼貼報表新增/既有報表頁。" : "起始頁面: BI official UI。",
  stepsSummary: contract.requiredActions.map((item) => `${item.action}:${item.target}:${item.expectedOutcome}`).join(" "),
  expected: "Expected behavior is defined by caseScopeContract requiredActions and evidenceRequirements.",
  resultStatus: null,
  testDate: null,
  detailJson: null,
  validationMethod: "P0.33 live blocker regression smoke",
  currentCaseFile: path.join(os.tmpdir(), `${contract.caseNo}.json`)
});

const parseRowsFromBodyText = (text: string): string[] => {
  const normalize = (value: string): string => value.trim().replace(/\s+/g, " ");
  const lines = text.split(/\n+/).map(normalize).filter(Boolean);
  const rows: string[] = [];
  for (let index = 0; index < lines.length - 3; index += 1) {
    const [name, period, download, remove] = lines.slice(index, index + 4);
    const looksLikePeriod = /\d{4}[/-]\d{1,2}[/-]\d{1,2}\s*~\s*\d{4}[/-]\d{1,2}[/-]\d{1,2}|過去\s*\d+\s*天|最近\s*\d+\s*天|昨日|今日|上週|本週|上月|本月/.test(period);
    if (!/^(報表名稱|資料週期區間|操作|下載|刪除)$/.test(name) && looksLikePeriod && download === "下載" && remove === "刪除") {
      rows.push(`${name} ${period} ${download} ${remove}`);
    }
  }
  return rows;
};

const writeBlockedEvidenceWorkbook = async (filePath: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("測試案例");
  sheet.addRow(["編號", "結果", "失敗分類", "詳細紀錄JSON"]);
  sheet.addRow(["BIUI_COLLAGE_R001-B-05", "BLOCKED", "EVIDENCE_INSUFFICIENT", JSON.stringify({ 測試目的: "B-05 deterministic pass fixture", currentRunEvidence: { old: true } })]);
  sheet.addRow(["BIUI_COLLAGE_R001-J-03", "BLOCKED", "BLOCKED_NEEDS_VISUAL_REVIEW", JSON.stringify({ 測試目的: "J-03 deterministic pass fixture", currentRunEvidence: { old: true } })]);
  sheet.addRow(["BIUI_COLLAGE_R001-L-05", "BLOCKED", "EVIDENCE_INSUFFICIENT", JSON.stringify({ 測試目的: "L-05 deterministic fail fixture", currentRunEvidence: { old: true } })]);
  sheet.addRow(["BIUI_COLLAGE_R001-M-11", "BLOCKED", "EVIDENCE_INSUFFICIENT", JSON.stringify({ 測試目的: "M-11 deterministic report mutation fail fixture", currentRunEvidence: { old: true } })]);
  sheet.addRow(["BIUI_COLLAGE_R001-I-04", "BLOCKED", "EVIDENCE_INSUFFICIENT", JSON.stringify({ 測試目的: "negative fixture", currentRunEvidence: { old: true } })]);
  workbook.addWorksheet("Bug").addRow(["嚴重度", "Bug ID", "關聯編號", "標題", "描述", "建議", "狀態", "Evidence"]);
  await workbook.xlsx.writeFile(filePath);
};

const readWorkbookStatuses = async (filePath: string): Promise<Record<string, { status: string; verdict: string }>> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet("測試案例");
  assert(sheet, "fixture result workbook must contain 測試案例 sheet");
  const result: Record<string, { status: string; verdict: string }> = {};
  for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    result[String(row.getCell(1).value ?? "").trim()] = {
      status: String(row.getCell(2).value ?? "").trim(),
      verdict: String(row.getCell(3).value ?? "").trim()
    };
  }
  return result;
};

const writeDeterministicEvidenceFixture = (runDir: string): void => {
  const b05Dir = path.join(runDir, "output", "helper-artifacts-archive", "2026-05-21T00-00-00-000Z", "BIUI_COLLAGE_R001-B-05");
  fs.mkdirSync(b05Dir, { recursive: true });
  fs.writeFileSync(path.join(b05Dir, "date-variants-preview-evidence.json"), JSON.stringify({
    schemaVersion: "date-variants-preview-evidence-v1",
    variants: [
      {
        status: "ok",
        requestedLabel: "上月",
        networkEvidence: { responseStatus: 200, requestDateRange: "m1~m1" },
        tableSummary: { dateColumnCount: 30 },
        dateUiEvidence: { checks: { requestedLabelVisible: true } },
        warnings: ["DATE_UI_CONTROL_TEXT_NOT_FOUND"]
      },
      {
        status: "ok",
        requestedLabel: "本月",
        networkEvidence: { responseStatus: 200, requestDateRange: "m0~m0" },
        tableSummary: { dateColumnCount: 21 },
        dateUiEvidence: { checks: { requestedLabelVisible: true } },
        warnings: ["DATE_UI_CONTROL_TEXT_NOT_FOUND"]
      }
    ],
    judgmentSummary: { comparison: { variantCount: 2 } }
  }, null, 2));

  const j03Dir = path.join(runDir, "output", "helper-artifacts-archive", "2026-05-21T00-01-00-000Z", "BIUI_COLLAGE_R001-J-03");
  fs.mkdirSync(j03Dir, { recursive: true });
  fs.writeFileSync(path.join(j03Dir, "frontend-observation-evidence.json"), JSON.stringify({
    schemaVersion: "frontend-observation-evidence-v1",
    observationType: "projectToolbar",
    observationState: {
      evidenceObject: "projectToolbar.reportRowSelectionState",
      asserted: true,
      assertions: {
        rowSelectedByVisibleUi: true,
        downloadEnabledAfterSelection: true,
        deleteEnabledAfterSelection: true,
        createEnabledAfterSelection: true
      }
    }
  }, null, 2));

  const l05Dir = path.join(runDir, "output", "helper-artifacts-archive", "2026-05-21T00-02-00-000Z", "BIUI_COLLAGE_R001-L-05");
  fs.mkdirSync(l05Dir, { recursive: true });
  fs.writeFileSync(path.join(l05Dir, "frontend-observation-evidence.json"), JSON.stringify({
    schemaVersion: "frontend-observation-evidence-v1",
    observationType: "datePanel",
    observationState: {
      evidenceObject: "dateRange.presetSwitch.state",
      asserted: false,
      recommendedFailureClassification: "FAIL_INTERACTION_FAILED",
      failedPresetSwitches: [
        {
          target: "dateRange.preset.lastWeek",
          actualOutcome: "target_absent_or_not_clickable",
          clicked: false
        }
      ],
      interactionLog: [
        { action: "select", target: "dateRange.preset.lastWeek", clicked: false }
      ]
    }
  }, null, 2));

  const m11Dir = path.join(runDir, "output", "helper-artifacts-archive", "2026-05-21T00-03-00-000Z", "BIUI_COLLAGE_R001-M-11");
  fs.mkdirSync(m11Dir, { recursive: true });
  fs.writeFileSync(path.join(m11Dir, "update-reopen-evidence.json"), JSON.stringify({
    workflowStatus: "blocked",
    reportName: "BIUICOL05219999",
    targetDateRange: "昨日",
    recommendedFailureClassification: "FAIL_INTERACTION_FAILED",
    dateRangeUpdate: {
      ok: true,
      requested: "昨日",
      finalButtonText: "昨日"
    },
    updatePrerequisite: {
      before: { text: "更新設定", disabled: false, ariaDisabled: false },
      calculateClicked: false,
      after: { text: "更新設定", disabled: false, ariaDisabled: false }
    },
    updateAction: {
      result: {
        clicked: false,
        successTextObserved: false,
        bodyTextExcerpt: "自訂報表 複製副本 更新設定 計算 昨日"
      },
      network: { requests: [], responses: [] },
      dialogs: []
    },
    backToList: null,
    reopen: null,
    persisted: false
  }, null, 2));
};

const main = async (): Promise<void> => {
  const executorSource = fs.readFileSync(executorPath, "utf8");
  const resultContractSource = fs.readFileSync(resultContractPath, "utf8");
  const byCase = new Map(contracts().map((item) => [item.caseNo, item]));

  const b05DateEvidence = buildDateUiEvidence({
    requested: "本月",
    baseDate: "2026-05-21",
    observed: {
      dateRangeButtonText: null,
      dateRangeDisplayText: null,
      popupVisible: null,
      popupText: null,
      bodyText: "自訂報表 欄位選擇 計算 本月 區間總和 2026-05-21 2026-05-20"
    }
  });
  assert.equal(b05DateEvidence.checks.requestedLabelVisible, true, "B-05-style preset label must be visible in body text");
  assert.equal(b05DateEvidence.checks.representedRangeMatchesRequested, null, "preset-only UI still records represented range as computed/not directly visible");
  const b07DynamicLabelEvidence = buildDateUiEvidence({
    requested: "14 天前 ~ 1 天前",
    baseDate: "2026-05-26",
    observed: {
      dateRangeButtonText: null,
      dateRangeDisplayText: null,
      popupVisible: false,
      popupText: null,
      bodyText: "自訂報表 儲存報表 計算 14 天前 > 1 天前"
    }
  });
  assert.equal(b07DynamicLabelEvidence.checks.requestedLabelVisible, true, "B-07 dynamic range label must accept Galaxy > separator");
  assert(resultContractSource.includes("requestedRange?.basis === \"preset\" && checks?.requestedLabelVisible === true"), "result contract must accept visible preset label as date UI match");

  const bodyText = [
    "報表名稱",
    "資料週期區間",
    "操作",
    "BIUICOL05210316",
    "2026-03-25 ~ 2026-05-20",
    "下載",
    "刪除",
    "BIUICOL05210310",
    "2026-03-01 ~ 2026-03-31",
    "下載",
    "刪除"
  ].join("\n");
  const rows = parseRowsFromBodyText(bodyText);
  assert.equal(rows.length, 2, "J-08-style body text should yield report rows");
  assert(executorSource.includes("bodyTextReportList"), "executor must keep project-list body text row fallback");
  assert(executorSource.includes("rowDeleteButtonContext"), "executor must recover official project-list rows from row-local delete icon context");
  assert(executorSource.includes("projectListRowDeleteButtonCandidate"), "executor must locate row-local delete icon buttons by DOM/ARIA context");
  assert(executorSource.includes("rowBeforeCancel: rowBefore"), "J-08 delete/cancel evidence must expose the before row snapshot under the result-facing key");
  assert(executorSource.includes("modalInteractionObserved"), "frontend modal observations must accept successful cancel/type interactions as modal evidence when DOM dialog wrappers are absent");
  assert(executorSource.includes("aria-label=\"刪除\""), "executor must support official UI delete icon aria-label fallback");
  assert(executorSource.includes("button[aria-label=\"返回\"]"), "G-05 back action must support official UI icon-only aria-label return button");
  assert(executorSource.includes("hasVisibleCollageProjectAfterCollageLabel"), "M-10 openProject must guard against treating structural sidebar labels as project names");
  assert(executorSource.includes("buildOfficialCollageProjectRouteFallback"), "openProject must have a route fallback when the official UI entry page hides collage project children");
  assert(executorSource.includes("official_collage_route_fallback"), "openProject route fallback must emit observability events");

  const j10 = byCase.get("BIUI_COLLAGE_R001-J-10");
  assert(j10, "J-10 contract must exist");
  const j10Plan = buildHelperExecutionPlan({ runDir: os.tmpdir(), currentCase: fixtureCase(j10), helperHints: null });
  const j10ObserveAction = j10Plan.actions.find((item) => item.template === "collage.observeFrontendState");
  assert.equal(j10ObserveAction?.params.observationType, "projectCreateModal", "J-10 must route to projectCreateModal observation");
  assert(executorSource.includes("PROJECT_CREATE_MODAL_PRECONDITION_PROJECT_LIMIT_REACHED"), "projectCreateModal must short-circuit when sidebar project limit is already reached");
  assert(executorSource.includes("readProjectLimitToastState"), "projectCreateModal must detect project-limit toast after clicking create");
  assert(executorSource.includes("projectLimitToastAfterClick"), "projectCreateModal evidence must preserve post-click project-limit toast state");
  assert(executorSource.includes("isTextLikeInputType"), "projectCreateModal name input helper must only fill text-like inputs");
  assert(!executorSource.includes("modalInputs.at(-1)"), "projectCreateModal must not fallback to arbitrary modal input");

  const l10 = byCase.get("BIUI_COLLAGE_R001-L-10");
  assert(l10, "L-10 contract must exist");
  const l10Plan = buildHelperExecutionPlan({ runDir: os.tmpdir(), currentCase: fixtureCase(l10), helperHints: null });
  const observeAction = l10Plan.actions.find((item) => item.template === "collage.observeFrontendState");
  assert.equal(observeAction?.params.observationType, "datePanel", "L-10 must route to datePanel observation");
  assert.deepEqual(
    observeAction?.caseScopeActions.map((item) => item.target),
    ["dateRange.preset.fromDateToYesterday", "dateRange.preset.fromDateToToday"],
    "L-10 must preserve from-date preset targets"
  );
  for (const snippet of [
    "dateRange.preset.fromDateToYesterday",
    "dateRange.preset.fromDateToToday",
    "自某日至昨日",
    "自某日至今",
    "fromDatePresetSpecFromTarget",
    "setStructuredDateRange(options, page, spec)",
    "clickVisibleTextByCoordinates",
    "prepareSaveReportButton",
    "recommendedFailureClassification",
    "prepareUpdateSettingButton",
    "UPDATE_SETTING_PRECONDITION_CALCULATE_CLICKED",
    "UPDATE_REOPEN_SKIPPED_AFTER_UPDATE_NOT_CLICKED"
  ]) {
    assert(executorSource.includes(snippet), `executor missing P0.33 snippet: ${snippet}`);
  }

  const m11 = byCase.get("BIUI_COLLAGE_R001-M-11");
  assert(m11, "M-11 contract must exist");
  const m11Templates = buildHelperExecutionPlan({ runDir: os.tmpdir(), currentCase: fixtureCase(m11), helperHints: null }).actions.map((item) => item.template);
  assert.deepEqual(
    m11Templates,
    ["collage.openProject", "collage.openReportFromProjectList", "collage.updateExistingReportAndReopen"],
    "M-11 must not regress to open-only helper plan"
  );
  const m11LiveLikeCase: CaseManifestCase = {
    ...fixtureCase(m11),
    structuredSteps: [
      {
        caseNo: "BIUI_COLLAGE_R001-M-11",
        stepNo: 1,
        actionType: "open",
        targetType: "domain_ui_object",
        targetValue: "projectList.reportRow",
        inputValue: null,
        expected: "visible",
        requireApproval: false,
        timeoutMs: 8000,
        retry: 1,
        role: "precondition",
        actionId: "openExistingReportBeforeUpdate",
        evidenceRequirements: ["projectList.reportRow.state", "screenshot"]
      }
    ]
  };
  assert.deepEqual(
    buildHelperExecutionPlan({ runDir: os.tmpdir(), currentCase: m11LiveLikeCase, helperHints: null }).actions.map((item) => item.template),
    ["collage.openProject", "collage.openReportFromProjectList", "collage.updateExistingReportAndReopen"],
    "M-11 live structured-step precondition must not be swallowed by generic open-report route"
  );

  const m01 = byCase.get("BIUI_COLLAGE_R001-M-01");
  assert(m01, "M-01 contract must exist");
  const m01Plan = buildHelperExecutionPlan({ runDir: os.tmpdir(), currentCase: fixtureCase(m01), helperHints: null });
  const m01ObserveAction = m01Plan.actions.find((item) => item.template === "collage.observeFrontendState");
  assert.equal(m01ObserveAction?.params.observationType, "saveReportDisabled", "M-01 must observe editor save button disabled state, not row delete tooltip");

  const g05VisibleReportCase: CaseManifestCase = {
    ...fixtureCase(m11),
    caseNo: "BIUI_COLLAGE_R001-G-05",
    caseTitle: "返回按鈕 — 從 editor 回專案頁(進既有報表後再返回)",
    stepsSummary: "使用專案頁任一可見既有報表 row，點擊既有報表名稱進入 editor。",
    expected: "可進入 editor 後返回專案頁。"
  };
  const m10VisibleReportCase: CaseManifestCase = {
    ...fixtureCase(m11),
    caseNo: "BIUI_COLLAGE_R001-M-10",
    caseTitle: "複製副本儲存成功後新報表出現",
    stepsSummary: "使用專案頁任一可見既有報表 row，點擊既有報表名稱進入 editor 後另存副本。",
    expected: "新副本報表會出現在專案頁。"
  };
  for (const currentCase of [g05VisibleReportCase, m10VisibleReportCase]) {
    const openReportAction = buildHelperExecutionPlan({ runDir: os.tmpdir(), currentCase, helperHints: null })
      .actions.find((item) => item.template === "collage.openReportFromProjectList");
    assert.equal(openReportAction?.params.existingReportSelectionMode, "visible_first", `${currentCase.caseNo} must allow any visible existing report row`);
    assert.equal(openReportAction?.params.existingReportNamePattern, null, `${currentCase.caseNo} must not force stale TOOL_A01 report pattern`);
    assert.equal(openReportAction?.params.existingReportSourceCaseNo, null, `${currentCase.caseNo} must not force stale TOOL-A-01 source case`);
  }

  const m11OpenReportAction = buildHelperExecutionPlan({ runDir: os.tmpdir(), currentCase: fixtureCase(m11), helperHints: null })
    .actions.find((item) => item.template === "collage.openReportFromProjectList");
  assert.equal(m11OpenReportAction?.params.existingReportNamePattern, null, "M-11 must use current-run saved-report state instead of stale TOOL_A01 pattern");
  assert.equal(m11OpenReportAction?.params.existingReportSourceCaseNo, null, "M-11 must not force stale TOOL-A-01 source case");
  assert(executorSource.includes("helper-artifacts-archive"), "executor must read saved-report state from archived helper artifacts");
  assert(executorSource.includes("visible-first-report-list-row"), "executor must support visible-first existing report selection");
  assert(executorSource.includes("ensureSavedReportListRowVisible(options, page, copyReportName)"), "M-10 copy flow must recover back to the project list before judging copied row visibility");
  assert(executorSource.includes("COPY_REPORT_ROW_NOT_VERIFIED"), "M-10 copy flow must keep row verification as evidence instead of accepting save toast alone");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p0-33-result-enricher-"));
  const fixtureResult = path.join(tempRoot, "blocked-result.xlsx");
  writeDeterministicEvidenceFixture(tempRoot);
  await writeBlockedEvidenceWorkbook(fixtureResult);
  const enrichment = await ensureBlockedResultCurrentRunEvidence({
    filePath: fixtureResult,
    runId: "p0-33-fixture-run",
    runDir: tempRoot
  });
  assert.equal(enrichment.status, "updated", "deterministic helper evidence should update blocked workbook");
  assert(enrichment.rows.some((item) => item.caseNo === "BIUI_COLLAGE_R001-B-05" && item.action === "deterministic_helper_pass"), "B-05 deterministic date evidence must promote BLOCKED to PASS");
  assert(enrichment.rows.some((item) => item.caseNo === "BIUI_COLLAGE_R001-J-03" && item.action === "deterministic_helper_pass"), "J-03 deterministic frontend observation must promote BLOCKED to PASS");
  assert(enrichment.rows.some((item) => item.caseNo === "BIUI_COLLAGE_R001-L-05" && item.action === "deterministic_helper_fail"), "L-05 deterministic frontend interaction failure must promote BLOCKED to FAIL");
  assert(enrichment.rows.some((item) => item.caseNo === "BIUI_COLLAGE_R001-M-11" && item.action === "deterministic_helper_fail"), "M-11 deterministic report mutation failure must promote BLOCKED to FAIL");
  const statuses = await readWorkbookStatuses(fixtureResult);
  assert.equal(statuses["BIUI_COLLAGE_R001-B-05"]?.status, "PASS", "B-05 should become PASS");
  assert.equal(statuses["BIUI_COLLAGE_R001-J-03"]?.status, "PASS", "J-03 should become PASS");
  assert.equal(statuses["BIUI_COLLAGE_R001-L-05"]?.status, "FAIL", "L-05 should become FAIL");
  assert.equal(statuses["BIUI_COLLAGE_R001-L-05"]?.verdict, "FAIL_INTERACTION_FAILED", "L-05 should carry a deterministic failure classification");
  assert.equal(statuses["BIUI_COLLAGE_R001-M-11"]?.status, "FAIL", "M-11 should become FAIL");
  assert.equal(statuses["BIUI_COLLAGE_R001-M-11"]?.verdict, "FAIL_INTERACTION_FAILED", "M-11 should carry a deterministic failure classification");
  assert.equal(statuses["BIUI_COLLAGE_R001-I-04"]?.status, "BLOCKED", "negative non-deterministic observation should remain BLOCKED");

  const prereqRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p0-33-update-prereq-"));
  const prereqWorkbook = path.join(prereqRoot, "blocked-result.xlsx");
  await writeBlockedEvidenceWorkbook(prereqWorkbook);
  const prereqM11Dir = path.join(prereqRoot, "output", "helper-artifacts", "BIUI_COLLAGE_R001-M-11");
  fs.mkdirSync(prereqM11Dir, { recursive: true });
  fs.writeFileSync(path.join(prereqM11Dir, "update-reopen-evidence.json"), JSON.stringify({
    workflowStatus: "blocked",
    reportName: "BIUICOL05219998",
    targetDateRange: "昨日",
    recommendedFailureClassification: "FAIL_INTERACTION_FAILED",
    dateRangeUpdate: { ok: true, requested: "昨日" },
    updatePrerequisite: {
      before: { text: "更新設定", disabled: true, ariaDisabled: false },
      calculateClicked: false,
      after: { text: "更新設定", disabled: true, ariaDisabled: false }
    },
    updateAction: {
      result: {
        clicked: false,
        successTextObserved: false,
        bodyTextExcerpt: "自訂報表 複製副本 更新設定 請先計算，在進行儲存 計算 昨日"
      },
      network: { requests: [], responses: [] },
      dialogs: []
    },
    persisted: false
  }, null, 2));
  const prereqEnrichment = await ensureBlockedResultCurrentRunEvidence({
    filePath: prereqWorkbook,
    runId: "p0-33-update-prereq-fixture-run",
    runDir: prereqRoot
  });
  const prereqStatuses = await readWorkbookStatuses(prereqWorkbook);
  assert(!prereqEnrichment.rows.some((item) => item.caseNo === "BIUI_COLLAGE_R001-M-11" && item.action === "deterministic_helper_fail"), "M-11 update button disabled by calculation prerequisite must not be promoted to product FAIL");
  assert.equal(prereqStatuses["BIUI_COLLAGE_R001-M-11"]?.status, "BLOCKED", "M-11 should remain BLOCKED when update was not actionable because calculation prerequisite was unmet");

  console.log(JSON.stringify({
    ok: true,
    checks: [
      "B-05 preset label evidence accepted by result contract",
      "J-08 report rows recoverable from body text",
      "J-08 delete/cancel can target row-local aria-label delete icons",
      "J-10 projectCreateModal short-circuits on established project-limit precondition",
      "J-10 projectCreateModal short-circuits on post-click project-limit toast",
      "J-10 projectCreateModal never fills arbitrary non-text inputs",
      "L-10 from-date preset targets routed to executable datePanel actions",
      "B-07 dynamic date label separator normalized",
      "L-05 visible non-button preset labels have coordinate-click fallback",
      "L-10 from-date targets use structured endpoint controls instead of phantom preset buttons",
      "F-07 save flow calculates before save when save button is disabled",
      "M-11 update existing report helper is planned",
      "M-11 update helper calculates before clicking disabled 更新設定",
      "M-11 live structured precondition does not bypass report mutation helper",
      "M-01 routes to saveReportDisabled observation",
      "G-05/M-10 allow visible-first existing report selection",
      "M-10 copy flow recovers to project list before row verification",
      "M-11 uses current-run saved-report state instead of stale TOOL_A01 pattern",
      "B-05/J-03 deterministic helper evidence promotes BLOCKED to PASS",
      "L-05 deterministic helper failure promotes BLOCKED to FAIL",
      "M-11 deterministic report mutation failure promotes BLOCKED to FAIL",
      "M-11 disabled-by-calculation prerequisite does not promote to product FAIL"
    ]
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
