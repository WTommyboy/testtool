import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import {
  helperSummaryHasBrowserTargetClosed,
  writeHelperBrowserSessionContainmentResultIfNeeded
} from "../agent/src/runtime-containment-result";
import { parseResultXlsx } from "../src/result-parser/result-xlsx-parser";
import { evaluateResultEvidenceGate } from "../src/result-parser/result-evidence-gate";

const caseNo = "BIUI_COLLAGE_R001-L-10";

const writeInputWorkbook = async (filePath: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("測試案例");
  sheet.addRow(["群組ID", "群組", "編號", "測試項目", "測試類型", "執行方式"]);
  sheet.addRow(["L", "L:儲存與重開", caseNo, "新增拼貼報表後設定並驗證", "功能流程", "Codex + Playwright"]);
  await workbook.xlsx.writeFile(filePath);
};

const writeCommonRunFiles = async (
  runDir: string,
  options: { browserClosed: boolean; consistencyError?: boolean }
): Promise<void> => {
  const reportPath = path.join(runDir, "output", "helper-artifacts", caseNo, "collage.createReport-latest.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(path.join(runDir, "input"), { recursive: true });
  await writeInputWorkbook(path.join(runDir, "input", "testcase.xlsx"));
  fs.writeFileSync(path.join(runDir, "input", "test-package-consistency.json"), JSON.stringify({
    status: options.consistencyError ? "error" : "warning",
    issues: options.consistencyError ? [{ severity: "error", code: "PACKAGE_CONFLICT" }] : []
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "input", "document-consistency.json"), JSON.stringify({
    status: "warning",
    issues: []
  }, null, 2));
  fs.writeFileSync(reportPath, JSON.stringify({
    schemaVersion: "bi-ui-helper-report-v1",
    runId: path.basename(runDir),
    caseId: caseNo,
    action: "collage.createReport",
    status: "blocked",
    helperCanJudgeResult: false,
    reason: options.browserClosed
      ? "CREATE_REPORT_BUTTON_NOT_CLICKABLE: Target page, context or browser has been closed"
      : "CREATE_REPORT_BUTTON_NOT_CLICKABLE: selector timeout, create button is not visible",
    evidenceMetadata: {
      source: "mac-agent-bi-ui-helper",
      currentRunEvidence: true,
      runId: path.basename(runDir),
      caseId: caseNo,
      action: "collage.createReport"
    },
    evidence: {}
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "output", "helper-pre-run-summary.json"), JSON.stringify({
    schemaVersion: "helper-pre-run-v1",
    generatedAt: new Date().toISOString(),
    runDir,
    caseId: caseNo,
    status: "partial",
    skippedReason: null,
    actionCount: 2,
    executedCount: 2,
    durationMs: 1000,
    actions: [
      {
        actionId: "H1",
        template: "collage.openProject",
        title: "Open project",
        status: "ok",
        durationMs: 200,
        exitCode: 0,
        signal: null,
        stdoutExcerpt: "",
        stderrExcerpt: "",
        reportPath: path.join(runDir, "output", "helper-artifacts", caseNo, "collage.openProject-latest.json"),
        warnings: []
      },
      {
        actionId: "H2",
        template: "collage.createReport",
        title: "Create report",
        status: "blocked",
        durationMs: 800,
        exitCode: 1,
        signal: null,
        stdoutExcerpt: "",
        stderrExcerpt: "",
        reportPath,
        warnings: []
      }
    ]
  }, null, 2));
};

const main = async (): Promise<void> => {
  const cleanupRoots: string[] = [];
  try {
    const containedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-helper-browser-containment-"));
    cleanupRoots.push(containedRoot);
    await writeCommonRunFiles(containedRoot, { browserClosed: true });
    const summary = JSON.parse(fs.readFileSync(path.join(containedRoot, "output", "helper-pre-run-summary.json"), "utf8"));
    assert.equal(helperSummaryHasBrowserTargetClosed(summary), true);
    const report = await writeHelperBrowserSessionContainmentResultIfNeeded({
      runId: path.basename(containedRoot),
      roundId: "BIUI_COLLAGE_R001",
      runDir: containedRoot,
      xlsxPath: path.join(containedRoot, "input", "testcase.xlsx"),
      currentCaseNo: caseNo
    });
    assert.equal(report.status, "written", JSON.stringify(report));
    assert.equal(report.failCategory, "BLOCKED_BROWSER_SESSION_CLOSED");
    const parsed = await parseResultXlsx(path.join(containedRoot, "output", "result.xlsx"));
    assert.equal(parsed.cases.length, 1);
    assert.equal(parsed.cases[0]?.caseNo, caseNo);
    assert.equal(parsed.cases[0]?.status, "BLOCKED");
    assert.equal(parsed.cases[0]?.verdictReason, "BLOCKED_BROWSER_SESSION_CLOSED");
    const gate = evaluateResultEvidenceGate({
      parsed,
      resultSource: "codex_generated",
      currentCaseNo: caseNo,
      expectedCaseNos: [caseNo],
      requireSingleCase: true
    });
    assert.equal(gate.status, "ok", JSON.stringify(gate.issues));

    const consistencyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-helper-browser-containment-gate-"));
    cleanupRoots.push(consistencyRoot);
    await writeCommonRunFiles(consistencyRoot, { browserClosed: true, consistencyError: true });
    const skippedByGate = await writeHelperBrowserSessionContainmentResultIfNeeded({
      runId: path.basename(consistencyRoot),
      roundId: "BIUI_COLLAGE_R001",
      runDir: consistencyRoot,
      xlsxPath: path.join(consistencyRoot, "input", "testcase.xlsx"),
      currentCaseNo: caseNo
    });
    assert.equal(skippedByGate.status, "skipped");
    assert.equal(skippedByGate.reason, "CONSISTENCY_GATE_ERROR_REQUIRES_PM_DECISION");

    const nonBrowserRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-helper-browser-containment-nonbrowser-"));
    cleanupRoots.push(nonBrowserRoot);
    await writeCommonRunFiles(nonBrowserRoot, { browserClosed: false });
    const nonBrowserSummary = JSON.parse(fs.readFileSync(path.join(nonBrowserRoot, "output", "helper-pre-run-summary.json"), "utf8"));
    assert.equal(helperSummaryHasBrowserTargetClosed(nonBrowserSummary), false);
    const skippedNonBrowser = await writeHelperBrowserSessionContainmentResultIfNeeded({
      runId: path.basename(nonBrowserRoot),
      roundId: "BIUI_COLLAGE_R001",
      runDir: nonBrowserRoot,
      xlsxPath: path.join(nonBrowserRoot, "input", "testcase.xlsx"),
      currentCaseNo: caseNo
    });
    assert.equal(skippedNonBrowser.status, "skipped");
    assert.equal(skippedNonBrowser.reason, "NO_HELPER_BROWSER_SESSION_CLOSED_BLOCKER");

    console.log(JSON.stringify({
      ok: true,
      fixture: "p0-helper-browser-session-containment"
    }, null, 2));
  } finally {
    for (const root of cleanupRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
