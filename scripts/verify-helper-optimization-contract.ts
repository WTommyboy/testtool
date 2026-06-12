import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateHelperReportArtifact } from "../agent/src/helper-pre-runner";
import { RunTimingRecorder } from "../agent/src/timing";
import { writeSlowStepsReport } from "../agent/src/task-runner";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-helper-optimization-"));
const runDir = path.join(tempRoot, "run-smoke");
const runId = path.basename(runDir);
const caseId = "BIUI-HELPER-OPT-01";
const action = "collage.preview";
const artifactDir = path.join(runDir, "output", "helper-artifacts", caseId);
const reportPath = path.join(artifactDir, `${action}-latest.json`);

const writeJson = (filePath: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

try {
  fs.mkdirSync(artifactDir, { recursive: true });
  const runStartedAt = new Date(Date.now() - 60_000).toISOString();
  const startedAt = new Date(Date.now() - 12_000).toISOString();
  const endedAt = new Date(Date.now() - 1_000).toISOString();
  writeJson(path.join(runDir, "state.json"), {
    run_id: runId,
    status: "started",
    started_at: runStartedAt
  });

  const slowWait = {
    name: "download.wait_for_csv_event",
    type: "download_wait",
    status: "ok",
    startedAt,
    endedAt,
    durationMs: 7200,
    context: { timeoutMs: 12000, trigger: "fixture-download" }
  };
  const helperReport = {
    schemaVersion: "bi-ui-helper-report-v1",
    generatedAt: endedAt,
    runId,
    startedAt,
    endedAt,
    durationMs: 11000,
    caseId,
    action,
    status: "ok",
    helperCanJudgeResult: false,
    params: {},
    evidenceMetadata: {
      source: "mac-agent-bi-ui-helper",
      runId,
      caseId,
      action,
      currentRunEvidence: true,
      artifactRoot: artifactDir,
      generatedAt: endedAt,
      startedAt,
      endedAt
    },
    evidence: {
      chart: { rowCount: 3 },
      network: { responses: [{ status: 200 }] }
    },
    artifacts: {
      previewEvidence: path.join(artifactDir, "preview-evidence.json")
    },
    warnings: [],
    substeps: [
      {
        name: "preview.click_execute",
        type: "locator_action",
        status: "ok",
        startedAt,
        endedAt,
        durationMs: 800
      },
      slowWait
    ],
    slowWaits: [slowWait],
    evidenceDecision: {
      schemaVersion: "helper-evidence-decision-v1",
      status: "ok",
      evidenceUsability: "usable_for_codex_review",
      helperCanJudgeResult: false,
      primaryEvidence: ["chart", "network"],
      artifactKeys: ["previewEvidence"],
      warningCount: 0,
      slowWaitCount: 1,
      blockingReason: null,
      notReached: [],
      codexGuidance: "fixture"
    }
  };
  writeJson(reportPath, helperReport);
  fs.appendFileSync(path.join(artifactDir, "helper-report.jsonl"), `${JSON.stringify(helperReport)}\n`);

  const validation = validateHelperReportArtifact({
    runDir,
    reportPath,
    expectedCaseId: caseId,
    expectedAction: action
  });
  assert.equal(validation.ok, true, `helper report with optimization fields should remain valid: ${validation.error ?? validation.warnings.join(",")}`);

  writeJson(path.join(runDir, "output", "helper-pre-run-summary.json"), {
    schemaVersion: "helper-pre-run-v1",
    generatedAt: endedAt,
    runDir,
    caseId,
    status: "ok",
    skippedReason: null,
    actionCount: 1,
    executedCount: 1,
    durationMs: 11000,
    actions: [
      {
        actionId: "preview-1",
        template: action,
        title: "Preview fixture",
        status: "ok",
        durationMs: 11000,
        exitCode: 0,
        signal: null,
        stdoutExcerpt: "",
        stderrExcerpt: "",
        reportPath,
        warnings: [],
        substepCount: 2,
        slowWaits: [slowWait],
        evidenceDecision: helperReport.evidenceDecision
      }
    ]
  });

  const timing = new RunTimingRecorder(runDir, runId);
  const timingId = timing.start("helper_pre_run", "agent_phase", { title: "fixture" });
  timing.end(timingId, "ok", { fixture: true });
  const slowReportPath = writeSlowStepsReport(runDir, runId, timing);
  const slowReport = JSON.parse(fs.readFileSync(slowReportPath, "utf8")) as Record<string, any>;
  assert.equal(slowReport.schemaVersion, "uat-agent-slow-steps-v1");
  assert.equal(slowReport.helperActionCount, 1);
  assert.equal(slowReport.topHelperActions[0].template, action);
  assert.equal(slowReport.topHelperActions[0].slowWaitCount, 1);
  assert.equal(slowReport.topHelperSubsteps[0].name, "download.wait_for_csv_event");
  assert.equal(slowReport.topHelperSubsteps[0].durationMs, 7200);

  console.log(JSON.stringify({
    ok: true,
    helperReportValid: validation.ok,
    slowReportPath,
    topHelperAction: slowReport.topHelperActions[0],
    topHelperSubstep: slowReport.topHelperSubsteps[0]
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
