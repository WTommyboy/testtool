import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inferVisibleCollageProjectName } from "../agent/src/bi-ui-helper-executor";
import { summarizeCsvAgainstPreview } from "../agent/src/csv-preview-comparison";
import { collectPendingHelperToolBridgeRequests, validateHelperReportArtifact } from "../agent/src/helper-pre-runner";

const writeJson = (filePath: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const main = (): void => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-helper-report-gate-"));
  try {
    const runDir = path.join(tempRoot, "run-123");
    const caseId = "DEMO-A-01";
    const action = "collage.configureMetric";
    const reportPath = path.join(runDir, "output", "helper-artifacts", caseId, "collage.configureMetric-latest.json");
    const startedAt = new Date().toISOString();
    writeJson(path.join(runDir, "state.json"), {
      run_id: "run-123",
      status: "started",
      started_at: startedAt
    });
    writeJson(reportPath, {
      schemaVersion: "bi-ui-helper-report-v1",
      generatedAt: startedAt,
      runId: "run-123",
      startedAt,
      endedAt: startedAt,
      durationMs: 0,
      caseId,
      action,
      status: "ok",
      helperCanJudgeResult: false,
      params: {},
      evidenceMetadata: {
        source: "mac-agent-bi-ui-helper",
        runId: "run-123",
        caseId,
        action,
        currentRunEvidence: true,
        artifactRoot: path.join(runDir, "output", "helper-artifacts", caseId),
        generatedAt: startedAt,
        startedAt,
        endedAt: startedAt
      },
      evidence: { stateDelta: { checks: { field: true } } },
      artifacts: {},
      warnings: []
    });

    const valid = validateHelperReportArtifact({ runDir, reportPath, expectedCaseId: caseId, expectedAction: action });
    assert.equal(valid.ok, true, `valid helper report should pass: ${valid.error ?? ""}`);
    assert.equal(valid.status, "ok");

    const wrongCase = validateHelperReportArtifact({ runDir, reportPath, expectedCaseId: "DEMO-B-01", expectedAction: action });
    assert.equal(wrongCase.ok, false, "wrong caseId must fail the helper report hard gate");
    assert.match(wrongCase.error ?? "", /caseId/);

    const staleStartedAt = new Date(Date.parse(startedAt) - 60_000).toISOString();
    writeJson(reportPath, {
      schemaVersion: "bi-ui-helper-report-v1",
      generatedAt: staleStartedAt,
      runId: "run-123",
      startedAt: staleStartedAt,
      endedAt: staleStartedAt,
      durationMs: 0,
      caseId,
      action,
      status: "ok",
      helperCanJudgeResult: false,
      params: {},
      evidenceMetadata: {
        source: "mac-agent-bi-ui-helper",
        runId: "run-123",
        caseId,
        action,
        currentRunEvidence: true,
        artifactRoot: path.join(runDir, "output", "helper-artifacts", caseId),
        generatedAt: staleStartedAt,
        startedAt: staleStartedAt,
        endedAt: staleStartedAt
      },
      evidence: {},
      artifacts: {},
      warnings: []
    });
    const stale = validateHelperReportArtifact({ runDir, reportPath, expectedCaseId: caseId, expectedAction: action });
    assert.equal(stale.ok, false, "stale helper report must fail the helper report hard gate");
    assert.match(stale.error ?? "", /stale_startedAt_before_run/);

    const csvComparison = summarizeCsvAgainstPreview(
      [
        "\uFEFF\"日期\",\"MAU(帳號)\"",
        "\"2026-03-31\",\"0\"",
        "\"2026-03-30\",\"0\"",
        "\"2026-03-29\",\"0\""
      ].join("\n"),
      {
        chart: null,
        table: {
          header: ["Date", "MAU(帳號)"],
          rows: [
            ["Date", "MAU(帳號)"],
            ["2026-03-31", "0"],
            ["2026-03-30", "0"],
            ["2026-03-29", "0"]
          ]
        }
      }
    ) as { checks: Record<string, unknown>; preview: Record<string, unknown> };
    assert.equal(csvComparison.checks.rowCountMatchesPreview, true, "CSV comparison should ignore duplicated preview header row");
    assert.equal(csvComparison.checks.tableHeaderMatches, true, "CSV comparison should treat Date and 日期 as the same date column");
    assert.equal(csvComparison.checks.tableRowsMatched, true);
    assert.equal(csvComparison.checks.allSeriesMatched, true);
    assert.equal(csvComparison.preview.tableRowCount, 3);

    const officialMatrixCsvComparison = summarizeCsvAgainstPreview(
      [
        "\"日期\",\"新增帳號數\"",
        "\"2026-03-27\",\"72\"",
        "\"2026-03-26\",\"63\"",
        "\"2026-03-25\",\"57\""
      ].join("\n"),
      {
        chart: null,
        table: {
          header: ["", "區間總和", "2026-03-27 (五)", "2026-03-26 (四)", "2026-03-25 (三)"],
          rows: [
            ["", "區間總和", "2026-03-27 (五)", "2026-03-26 (四)", "2026-03-25 (三)"],
            ["新增帳號數", "192", "72", "63", "57"]
          ]
        }
      }
    ) as { checks: Record<string, unknown>; previewMatrixComparison: Record<string, unknown> };
    assert.equal(officialMatrixCsvComparison.checks.rowCountMatchesPreview, true, "official UI CSV date rows should match preview date columns");
    assert.equal(officialMatrixCsvComparison.checks.tableHeaderMatches, true, "official UI CSV/preview matrix shape should normalize header comparison");
    assert.equal(officialMatrixCsvComparison.checks.tableRowsMatched, true, "official UI CSV/preview matrix values should match after transpose");
    assert.equal(officialMatrixCsvComparison.checks.allSeriesMatched, true);
    assert.equal(officialMatrixCsvComparison.previewMatrixComparison.matched, true);

    const projectHomeText = [
      "📊 報表管理",
      "▶",
      "報表",
      "📂",
      "公司共享",
      "▶",
      "我的自訂",
      "▶",
      "拼貼模式",
      "拼貼test_001",
      "🗑️",
      "UAT_G01測試專案",
      "🗑️",
      "▶",
      "明細檢視",
      "▶",
      "指標趨勢",
      "➕ 新增專案",
      "請從左側選擇專案查看報表"
    ].join("\n");
    assert.equal(
      inferVisibleCollageProjectName(projectHomeText),
      "拼貼test_001",
      "helper should infer the first visible collage project when testcase omits projectName"
    );
    assert.equal(
      inferVisibleCollageProjectName(projectHomeText, "UAT_G01測試專案"),
      "UAT_G01測試專案",
      "explicit projectName should override inferred project"
    );

    const pendingRunDir = path.join(tempRoot, "pending-run");
    const pendingCaseId = "TOOL-A-05";
    const pendingStartedAt = new Date().toISOString();
    writeJson(path.join(pendingRunDir, "state.json"), {
      run_id: "pending-run",
      status: "started",
      started_at: pendingStartedAt
    });
    writeJson(path.join(pendingRunDir, "input", "helper-execution-plan.json"), {
      schemaVersion: "helper-execution-plan-v1",
      generatedAt: pendingStartedAt,
      caseId: pendingCaseId,
      mode: "single_case_helper_assisted_uat",
      executor: { kind: "mac-agent-playwright-cdp", command: "node helper", reportPath: "helper-report.jsonl", artifactRoot: "output/helper-artifacts" },
      policy: [],
      safety: {
        helperMayWriteResultXlsx: false,
        helperMayJudgePassFail: false,
        helperMayRunMultipleCases: false,
        helperMayUseDirectBiApi: false,
        helperMayUseInternalJsSetter: false,
        helperMayBypassActionabilityCheck: false,
        codexMustJudgeResult: true
      },
      helperHints: { found: false, operationTemplate: null, automationLevel: null, aiDecisionRequired: null },
      actions: [
        {
          id: "H1",
          template: "collage.openProject",
          title: "開啟指定拼貼專案",
          params: {},
          mutatesUi: true,
          requiresToolBridge: false,
          optional: false,
          canJudgeResult: false,
          requiredEvidence: ["dom.state"],
          screenshotPolicy: "major_step",
          notes: []
        },
        {
          id: "H2",
          template: "collage.saveReport",
          title: "覆寫既有報表",
          params: {},
          mutatesUi: true,
          requiresToolBridge: true,
          optional: false,
          canJudgeResult: false,
          requiredEvidence: ["toolBridge.response"],
          screenshotPolicy: "required_if_possible",
          notes: []
        }
      ],
      availableTemplates: []
    });
    writeJson(path.join(pendingRunDir, "input", "capability-gate.json"), {
      helperPreRunAllowed: true,
      supportStatus: "supported"
    });
    writeJson(path.join(pendingRunDir, "input", "test-package-consistency.json"), { status: "ok" });
    writeJson(path.join(pendingRunDir, "input", "document-consistency.json"), { status: "ok" });
    writeJson(path.join(pendingRunDir, "output", "helper-artifacts", pendingCaseId, "collage.openProject-latest.json"), {
      schemaVersion: "bi-ui-helper-report-v1",
      generatedAt: pendingStartedAt,
      runId: "pending-run",
      startedAt: pendingStartedAt,
      endedAt: pendingStartedAt,
      durationMs: 0,
      caseId: pendingCaseId,
      action: "collage.openProject",
      status: "ok",
      helperCanJudgeResult: false,
      params: {},
      evidenceMetadata: {
        source: "mac-agent-bi-ui-helper",
        runId: "pending-run",
        caseId: pendingCaseId,
        action: "collage.openProject",
        currentRunEvidence: true,
        artifactRoot: path.join(pendingRunDir, "output", "helper-artifacts", pendingCaseId),
        generatedAt: pendingStartedAt,
        startedAt: pendingStartedAt,
        endedAt: pendingStartedAt
      },
      evidence: {},
      artifacts: {},
      warnings: []
    });
    const pendingRequests = collectPendingHelperToolBridgeRequests(pendingRunDir);
    assert.equal(pendingRequests.length, 1, "pending helper Tool Bridge action should be detected after prior safe actions pass");
    assert.equal(pendingRequests[0]?.template, "collage.saveReport");
    assert.match(pendingRequests[0]?.requestId ?? "", /TOOL-A-05-collage\.saveReport-helper-plan$/);

    console.log("Helper report hard gate passed.");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};

main();
