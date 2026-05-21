import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { writeCodexRuntimeContainmentResultIfNeeded } from "../agent/src/runtime-containment-result";
import { parseResultXlsx } from "../src/result-parser/result-xlsx-parser";
import { evaluateResultEvidenceGate } from "../src/result-parser/result-evidence-gate";

const caseNo = "BIUI_COLLAGE_R001-G-05";

const writeInputWorkbook = async (filePath: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("測試案例");
  sheet.addRow(["群組ID", "群組", "編號", "測試項目", "測試類型", "執行方式"]);
  sheet.addRow(["G", "G:專案與報表流程", caseNo, "返回專案清單後重新進入報表", "功能流程", "Codex + Playwright"]);
  await workbook.xlsx.writeFile(filePath);
};

const writeCommonRunFiles = async (
  runDir: string,
  options: { helperEvidence: boolean; consistencyError?: boolean }
): Promise<void> => {
  fs.mkdirSync(path.join(runDir, "input"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "output", "helper-artifacts", caseNo), { recursive: true });
  await writeInputWorkbook(path.join(runDir, "input", "testcase.xlsx"));
  fs.writeFileSync(path.join(runDir, "input", "test-package-consistency.json"), JSON.stringify({
    status: options.consistencyError ? "error" : "warning",
    issues: options.consistencyError ? [{ severity: "error", code: "PACKAGE_CONFLICT" }] : []
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "input", "document-consistency.json"), JSON.stringify({
    status: "warning",
    issues: []
  }, null, 2));
  const reportPath = path.join(runDir, "output", "helper-artifacts", caseNo, "collage.clickBackToProjectList-latest.json");
  fs.writeFileSync(reportPath, JSON.stringify({
    schemaVersion: "bi-ui-helper-report-v1",
    runId: path.basename(runDir),
    caseId: caseNo,
    action: "collage.clickBackToProjectList",
    status: "blocked",
    helperCanJudgeResult: false,
    reason: "BACK_TO_PROJECT_LIST_BUTTON_NOT_CLICKABLE",
    evidenceMetadata: {
      source: "mac-agent-bi-ui-helper",
      currentRunEvidence: options.helperEvidence,
      runId: path.basename(runDir),
      caseId: caseNo,
      action: "collage.clickBackToProjectList"
    },
    evidence: {}
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "output", "helper-pre-run-summary.json"), JSON.stringify({
    schemaVersion: "helper-pre-run-v1",
    generatedAt: new Date().toISOString(),
    runDir,
    caseId: caseNo,
    status: options.helperEvidence ? "partial" : "skipped",
    skippedReason: options.helperEvidence ? null : "NO_ACTIONS_EXECUTED",
    actionCount: 3,
    executedCount: options.helperEvidence ? 3 : 0,
    durationMs: 1000,
    actions: options.helperEvidence
      ? [
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
            template: "collage.openReportFromProjectList",
            title: "Open report",
            status: "ok",
            durationMs: 300,
            exitCode: 0,
            signal: null,
            stdoutExcerpt: "",
            stderrExcerpt: "",
            reportPath: path.join(runDir, "output", "helper-artifacts", caseNo, "collage.openReportFromProjectList-latest.json"),
            warnings: []
          },
          {
            actionId: "H3",
            template: "collage.clickBackToProjectList",
            title: "Back to project list",
            status: "blocked",
            durationMs: 500,
            exitCode: 1,
            signal: null,
            stdoutExcerpt: "",
            stderrExcerpt: "",
            reportPath,
            warnings: []
          }
        ]
      : []
  }, null, 2));
};

const runNoResultContainment = async (runDir: string) => writeCodexRuntimeContainmentResultIfNeeded({
  runId: path.basename(runDir),
  roundId: "BIUI_COLLAGE_R001",
  runDir,
  xlsxPath: path.join(runDir, "input", "testcase.xlsx"),
  currentCaseNo: caseNo,
  result: {
    exitCode: 0,
    signal: null,
    stderr: "",
    assistantText: "I cannot call browser_tabs in this environment, so no trusted output/result.xlsx was produced."
  },
  failCategory: "CODEX_NO_RESULT_XLSX",
  containmentKind: "no_result_after_success"
});

const main = async (): Promise<void> => {
  const cleanupRoots: string[] = [];
  try {
    const containedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-no-result-containment-"));
    cleanupRoots.push(containedRoot);
    await writeCommonRunFiles(containedRoot, { helperEvidence: true });
    const report = await runNoResultContainment(containedRoot);
    assert.equal(report.status, "written", JSON.stringify(report));
    assert.equal(report.failCategory, "CODEX_NO_RESULT_XLSX");
    assert.ok(fs.existsSync(path.join(containedRoot, "output", "result.xlsx")));
    const parsed = await parseResultXlsx(path.join(containedRoot, "output", "result.xlsx"));
    assert.equal(parsed.cases.length, 1);
    assert.equal(parsed.cases[0]?.caseNo, caseNo);
    assert.equal(parsed.cases[0]?.status, "BLOCKED");
    assert.equal(parsed.cases[0]?.verdictReason, "CODEX_NO_RESULT_XLSX");
    const gate = evaluateResultEvidenceGate({
      parsed,
      resultSource: "codex_generated",
      currentCaseNo: caseNo,
      expectedCaseNos: [caseNo],
      requireSingleCase: true
    });
    assert.equal(gate.status, "ok", JSON.stringify(gate.issues));

    const noEvidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-no-result-containment-no-evidence-"));
    cleanupRoots.push(noEvidenceRoot);
    await writeCommonRunFiles(noEvidenceRoot, { helperEvidence: false });
    const skippedNoEvidence = await runNoResultContainment(noEvidenceRoot);
    assert.equal(skippedNoEvidence.status, "skipped");
    assert.equal(skippedNoEvidence.reason, "NO_CURRENT_RUN_HELPER_EVIDENCE_TO_CONTAIN");

    const consistencyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-no-result-containment-gate-"));
    cleanupRoots.push(consistencyRoot);
    await writeCommonRunFiles(consistencyRoot, { helperEvidence: true, consistencyError: true });
    const skippedByGate = await runNoResultContainment(consistencyRoot);
    assert.equal(skippedByGate.status, "skipped");
    assert.equal(skippedByGate.reason, "CONSISTENCY_GATE_ERROR_REQUIRES_PM_DECISION");

    console.log(JSON.stringify({
      ok: true,
      fixture: "codex-no-result-containment"
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
