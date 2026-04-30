import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateHelperReportArtifact } from "../agent/src/helper-pre-runner";

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

    console.log("Helper report hard gate passed.");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};

main();
