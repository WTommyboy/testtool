import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultAgentConfig } from "../agent/src/config";
import type { CaseManifestCase, CaseManifestResult } from "../agent/src/case-manifest";
import { writeCodexInputSummary } from "../agent/src/task-runner";
import type { AgentMessage } from "../agent/src/types";

const root = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-codex-input-summary-"));
const runDir = path.join(tempRoot, "run");
const inputDir = path.join(runDir, "input");
const outputDir = path.join(runDir, "output");

const writeJson = (filePath: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

try {
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(runDir, "rules", "BI_DATA"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "rules", "BI_DATA", "metadata.csv"), "field,name\nA,Alpha\n");

  const currentCase: CaseManifestCase = {
    order: 1,
    rowNumber: 2,
    groupId: "C",
    groupName: "Summary smoke",
    caseNo: "BIUI-CODEX-SUMMARY-01",
    caseTitle: "Codex input summary smoke",
    testType: "後端功能",
    executionMethod: "agent",
    riskLevel: "🟢 觀察",
    testTarget: "後端功能",
    cleanupChecklist: "欄位=新增帳號數;篩選=空;分組=空;時間=上月;顯示=每天",
    preconditions: "Fixture only.",
    stepsSummary: "Use helper evidence and visible DOM/chart data to judge the current case.",
    expected: "Codex should read the compact summary first and escalate to full rules only when needed.",
    resultStatus: null,
    testDate: null,
    detailJson: null,
    validationMethod: "current-run helper evidence + result contract",
    currentCaseFile: path.join(inputDir, "current-case.json")
  };

  const paths = {
    currentCase: path.join(inputDir, "current-case.json"),
    currentCasePackJson: path.join(inputDir, "current-case-pack.json"),
    currentCasePackMarkdown: path.join(inputDir, "current-case-pack.md"),
    capabilityGateJson: path.join(inputDir, "capability-gate.json"),
    capabilityGateMarkdown: path.join(inputDir, "capability-gate.md"),
    helperExecutionPlanJson: path.join(inputDir, "helper-execution-plan.json"),
    helperExecutionPlanMarkdown: path.join(inputDir, "helper-execution-plan.md"),
    runState: path.join(inputDir, "run-state.json"),
    ruleIndex: path.join(inputDir, "rule-index.json"),
    referenceIndex: path.join(inputDir, "reference-index.json"),
    helperPreRunSummary: path.join(outputDir, "helper-pre-run-summary.json"),
    helperReport: path.join(outputDir, "helper-artifacts", currentCase.caseNo, "helper-report.jsonl")
  };

  writeJson(paths.currentCase, currentCase);
  fs.writeFileSync(paths.currentCasePackMarkdown, "# Current Case Pack\n");
  writeJson(paths.currentCasePackJson, {
    schemaVersion: "current-case-pack-v1",
    currentCase,
    helperHints: {
      found: true,
      operationTemplate: "collage.preview",
      automationLevel: "safe",
      aiDecisionRequired: false,
      warnings: []
    },
    evidenceTemplates: ["chart-datasets"],
    requiredEvidence: ["chart/table DOM or read-only Chart.js data"],
    screenshotPolicy: "structured_first",
    caseScope: {
      caseScopeContract: {
        caseNo: currentCase.caseNo,
        requiredActions: []
      }
    },
    mustReadRuleKeys: [
      "current-case",
      "current-case-pack-json",
      "bi-project-agents-full",
      "bi-rule-BI測試標準_共通方法論"
    ],
    recommendedRuleKeys: ["network-observation-guidance"]
  });
  fs.writeFileSync(paths.capabilityGateMarkdown, "# Capability Gate\n");
  writeJson(paths.capabilityGateJson, {
    supportStatus: "supported",
    reason: "fixture"
  });
  fs.writeFileSync(paths.helperExecutionPlanMarkdown, "# Helper Execution Plan\n");
  writeJson(paths.helperExecutionPlanJson, {
    actions: [
      {
        actionId: "preview-1",
        template: "collage.preview",
        title: "Preview fixture",
        requiresToolBridge: false
      }
    ]
  });
  writeJson(paths.runState, {});
  writeJson(paths.ruleIndex, {});
  writeJson(paths.referenceIndex, {});
  writeJson(paths.helperPreRunSummary, {
    status: "ok",
    caseId: currentCase.caseNo,
    actionCount: 1,
    executedCount: 1,
    durationMs: 1234,
    actions: [
      {
        actionId: "preview-1",
        template: "collage.preview",
        status: "ok",
        durationMs: 1200,
        reportPath: paths.helperReport,
        warnings: []
      }
    ]
  });

  const caseManifest: CaseManifestResult = {
    manifestPath: path.join(inputDir, "case-manifest.json"),
    totalCases: 1,
    cases: [currentCase],
    currentCasePath: paths.currentCase,
    currentCaseNo: currentCase.caseNo,
    currentCaseSelection: null,
    warnings: []
  };
  const guides = {
    caseManifest,
    ruleIndexPath: paths.ruleIndex,
    biUiHelperGuidancePath: path.join(inputDir, "bi-ui-helper-guidance.md"),
    preflightGuidancePath: path.join(inputDir, "preflight-auth-check.md"),
    runStatePath: paths.runState,
    supportingDocsManifestPath: path.join(inputDir, "supporting-docs-manifest.json"),
    testPackageConsistencyPath: path.join(inputDir, "test-package-consistency.json"),
    documentConsistencyPath: path.join(inputDir, "document-consistency.json"),
    currentCasePackJsonPath: paths.currentCasePackJson,
    currentCasePackMarkdownPath: paths.currentCasePackMarkdown,
    capabilityGateJsonPath: paths.capabilityGateJson,
    capabilityGateMarkdownPath: paths.capabilityGateMarkdown,
    helperExecutionPlanJsonPath: paths.helperExecutionPlanJson,
    helperExecutionPlanMarkdownPath: paths.helperExecutionPlanMarkdown,
    evidenceTemplates: {
      indexPath: path.join(inputDir, "evidence-templates", "index.json"),
      files: []
    },
    resultTemplatePath: path.join(inputDir, "result-template.xlsx"),
    networkObservationGuidancePath: path.join(inputDir, "network-observation-guidance.md"),
    referenceIndexPath: paths.referenceIndex,
    startCaseHint: null
  } as Parameters<typeof writeCodexInputSummary>[5];
  const message: AgentMessage = {
    type: "task.dispatch",
    payload: {
      run_id: "codex-summary-smoke",
      round_id: "R-SMOKE",
      domain: "BI",
      dev_url: "https://dev.example.test"
    }
  };
  const config = defaultAgentConfig({
    codex_workspace_root: root,
    workdir_root: path.join(tempRoot, "runs"),
    chrome_profile_dir: path.join(tempRoot, "chrome-profile"),
    codex_model: "gpt-5-codex"
  });

  const markdownPath = writeCodexInputSummary(
    "codex-summary-smoke",
    message,
    config,
    runDir,
    {
      xlsx: path.join(inputDir, "testcase.xlsx"),
      startup_instruction: path.join(inputDir, "startup.md")
    },
    guides
  );
  const jsonPath = path.join(inputDir, "codex-input-summary.json");
  assert.equal(markdownPath, path.join(inputDir, "codex-input-summary.md"));
  assert.ok(fs.existsSync(markdownPath), "summary markdown should be written");
  assert.ok(fs.existsSync(jsonPath), "summary json should be written");

  const summary = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Record<string, any>;
  assert.equal(summary.schemaVersion, "codex-input-summary-v1");
  assert.equal(summary.fullRulePolicy.defaultMode, "evidence_first");
  assert.equal(summary.currentCase.caseNo, currentCase.caseNo);
  assert.equal(summary.helperPreRun.exists, true);
  assert.equal(summary.helperPreRun.durationMs, 1234);
  assert.equal(summary.helperPreRun.actions[0].template, "collage.preview");
  assert.equal(summary.helperPreRun.actions[0].durationMs, 1200);
  assert.match(summary.ruleShortlist.note, /current-case evidence/);

  const markdown = fs.readFileSync(markdownPath, "utf8");
  assert.match(markdown, /Dispatch artifact/);
  assert.doesNotMatch(markdown, /Summary-first dispatch artifact/);
  assert.match(markdown, /Full Rule Escalation Triggers/);
  assert.match(markdown, /collage\.preview: ok; durationMs=1200/);
  assert.match(markdown, /must_read_keys_as_escalation_pointers/);

  const source = fs.readFileSync(path.join(root, "agent", "src", "task-runner.ts"), "utf8");
  assert.equal(source.includes("This is intentionally slower"), false, "old slow-path prompt instruction should be removed");
  assert.equal(source.includes("Always read the generated `AGENTS.md`"), false, "old always-read prompt instruction should be removed");
  assert.equal(source.includes("straightforward PASS judgment should not reread"), false, "old token-saving PASS shortcut should be removed");
  assert.equal(source.includes("summary-first reading"), false, "old summary-first runtime instruction should be removed");

  console.log(JSON.stringify({
    ok: true,
    summaryMarkdown: markdownPath,
    helperAction: summary.helperPreRun.actions[0],
    defaultMode: summary.fullRulePolicy.defaultMode
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
