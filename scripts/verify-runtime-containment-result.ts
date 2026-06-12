import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { writeCodexRuntimeContainmentResultIfNeeded } from "../agent/src/runtime-containment-result";
import { parseResultXlsx } from "../src/result-parser/result-xlsx-parser";
import { evaluateResultEvidenceGate } from "../src/result-parser/result-evidence-gate";

const writeInputWorkbook = async (filePath: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("測試案例");
  sheet.addRow(["群組ID", "群組", "編號", "測試項目", "測試類型", "執行方式"]);
  sheet.addRow(["B", "B:日期區間邏輯", "BIUI_COLLAGE_R001-B-12", "變更區間後重新執行 — 數據更新", "功能流程", "Codex + Playwright"]);
  await workbook.xlsx.writeFile(filePath);
};

const writeCommonRunFiles = async (runDir: string): Promise<void> => {
  fs.mkdirSync(path.join(runDir, "input"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "output", "helper-artifacts", "BIUI_COLLAGE_R001-B-12"), { recursive: true });
  await writeInputWorkbook(path.join(runDir, "input", "testcase.xlsx"));
  fs.writeFileSync(path.join(runDir, "input", "test-package-consistency.json"), JSON.stringify({
    status: "warning",
    issues: []
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "input", "document-consistency.json"), JSON.stringify({
    status: "warning",
    issues: []
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "output", "helper-pre-run-summary.json"), JSON.stringify({
    schemaVersion: "helper-pre-run-v1",
    caseId: "BIUI_COLLAGE_R001-B-12",
    status: "ok",
    actionCount: 3,
    executedCount: 3,
    durationMs: 1000,
    actions: [
      {
        actionId: "H3",
        template: "collage.runDateVariantsPreviewEvidence",
        status: "ok",
        reportPath: path.join(runDir, "output", "helper-artifacts", "BIUI_COLLAGE_R001-B-12", "collage.runDateVariantsPreviewEvidence-latest.json"),
        warnings: []
      }
    ]
  }, null, 2));
  fs.writeFileSync(
    path.join(runDir, "output", "helper-artifacts", "BIUI_COLLAGE_R001-B-12", "collage.runDateVariantsPreviewEvidence-latest.json"),
    JSON.stringify({
      schemaVersion: "bi-ui-helper-report-v1",
      caseId: "BIUI_COLLAGE_R001-B-12",
      action: "collage.runDateVariantsPreviewEvidence",
      status: "ok",
      helperCanJudgeResult: false,
      evidenceMetadata: {
        currentRunEvidence: true
      },
      evidence: {
        dateVariantsPreviewEvidence: {
          variants: []
        }
      }
    }, null, 2)
  );
  fs.writeFileSync(path.join(runDir, "output", "codex-result.json"), JSON.stringify({
    stderr: "CODEX_RUN_FAILED exit=1 signal=none"
  }, null, 2));
};

const main = async (): Promise<void> => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-runtime-containment-"));
  const cleanupRoots = [tempRoot];
  try {
    await writeCommonRunFiles(tempRoot);
    const report = await writeCodexRuntimeContainmentResultIfNeeded({
      runId: path.basename(tempRoot),
      roundId: "BIUI_COLLAGE_R001",
      runDir: tempRoot,
      xlsxPath: path.join(tempRoot, "input", "testcase.xlsx"),
      currentCaseNo: "BIUI_COLLAGE_R001-B-12",
      result: {
        exitCode: null,
        signal: null,
        stderr: "CODEX_RUN_FAILED exit=1 signal=none",
        assistantText: "Agent failed before Codex produced a complete result."
      },
      failCategory: "CODEX_RUNTIME_RESULT_WRITE_FAILED"
    });
    assert.equal(report.status, "written", JSON.stringify(report));
    assert.ok(fs.existsSync(path.join(tempRoot, "output", "result.xlsx")));
    const parsed = await parseResultXlsx(path.join(tempRoot, "output", "result.xlsx"));
    assert.equal(parsed.cases.length, 1);
    assert.equal(parsed.cases[0]?.caseNo, "BIUI_COLLAGE_R001-B-12");
    assert.equal(parsed.cases[0]?.status, "BLOCKED");
    assert.equal(parsed.cases[0]?.verdictReason, "CODEX_RUNTIME_RESULT_WRITE_FAILED");
    const gate = evaluateResultEvidenceGate({
      parsed,
      resultSource: "codex_generated",
      currentCaseNo: "BIUI_COLLAGE_R001-B-12",
      expectedCaseNos: ["BIUI_COLLAGE_R001-B-12"],
      requireSingleCase: true
    });
    assert.equal(gate.status, "ok", JSON.stringify(gate.issues));

    const usageLimitRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-runtime-containment-usage-limit-"));
    cleanupRoots.push(usageLimitRoot);
    await writeCommonRunFiles(usageLimitRoot);
    const usageLimitSkipped = await writeCodexRuntimeContainmentResultIfNeeded({
      runId: path.basename(usageLimitRoot),
      roundId: "BIUI_COLLAGE_R001",
      runDir: usageLimitRoot,
      xlsxPath: path.join(usageLimitRoot, "input", "testcase.xlsx"),
      currentCaseNo: "BIUI_COLLAGE_R001-B-12",
      result: {
        exitCode: 1,
        signal: null,
        rawStdout: [
          JSON.stringify({ type: "thread.started", thread_id: "thread-quota-fixture" }),
          JSON.stringify({ type: "turn.started" }),
          JSON.stringify({ type: "error", message: "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 11:21 PM." }),
          JSON.stringify({ type: "turn.failed", error: { message: "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 11:21 PM." } })
        ].join("\n"),
        stderr: "failed to record rollout items: thread thread-quota-fixture not found",
        assistantText: ""
      }
    });
    assert.equal(usageLimitSkipped.status, "skipped", JSON.stringify(usageLimitSkipped));
    assert.equal(usageLimitSkipped.reason, "CODEX_USAGE_LIMIT_RUN_LEVEL_FAILURE");
    assert.equal(fs.existsSync(path.join(usageLimitRoot, "output", "result.xlsx")), false);

    const blockedByGateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-runtime-containment-gate-"));
    cleanupRoots.push(blockedByGateRoot);
    await writeCommonRunFiles(blockedByGateRoot);
    fs.writeFileSync(path.join(blockedByGateRoot, "input", "test-package-consistency.json"), JSON.stringify({
      status: "error",
      issues: [{ severity: "error", code: "PACKAGE_CONFLICT" }]
    }, null, 2));
    const skipped = await writeCodexRuntimeContainmentResultIfNeeded({
      runId: path.basename(blockedByGateRoot),
      roundId: "BIUI_COLLAGE_R001",
      runDir: blockedByGateRoot,
      xlsxPath: path.join(blockedByGateRoot, "input", "testcase.xlsx"),
      currentCaseNo: "BIUI_COLLAGE_R001-B-12",
      result: {
        exitCode: 1,
        signal: null
      }
    });
    assert.equal(skipped.status, "skipped");
    assert.equal(skipped.reason, "CONSISTENCY_GATE_ERROR_REQUIRES_PM_DECISION");

    console.log(JSON.stringify({
      ok: true,
      fixture: "runtime-containment-result"
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
