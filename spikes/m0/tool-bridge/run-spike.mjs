#!/usr/bin/env node
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseToolRequests } from "./parser.mjs";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const spikeRoot = path.join(repoRoot, "spikes", "m0", "tool-bridge");
const outputRoot = path.join(spikeRoot, "output");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(outputRoot, runId);
const fixtureDir = path.join(runDir, "fixture");

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node spikes/m0/tool-bridge/run-spike.mjs [--codex-count=20]");
  console.log("Validates Tool Bridge parser fixtures and Codex [TOOL_REQUEST] output stability.");
  process.exit(0);
}

const codexCountArg = process.argv.find((arg) => arg.startsWith("--codex-count="));
const codexCount = codexCountArg ? Number(codexCountArg.split("=")[1]) : 20;
const codexBin = process.env.CODEX_BIN || "codex";

fs.mkdirSync(fixtureDir, { recursive: true });
fs.writeFileSync(path.join(fixtureDir, "README.md"), "# Tool Bridge Spike Fixture\n");

const execBaseArgs = [
  "exec",
  "--json",
  "--ephemeral",
  "--sandbox",
  "read-only",
  "--skip-git-repo-check",
  "--ignore-rules",
  "-C",
  fixtureDir
];

const cleanEnv = {
  ...process.env,
  NO_COLOR: "1",
  TERM: "xterm-256color"
};

function writeJson(name, value) {
  fs.writeFileSync(path.join(runDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function runProcess(name, command, args, options = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd || fixtureDir,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, options.timeoutMs || 180_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.stdin.end();
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        name,
        command,
        args,
        exitCode: null,
        signal: null,
        error: String(error),
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr
      });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        name,
        command,
        args,
        exitCode,
        signal,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr
      });
    });
  });
}

function extractAssistantText(stdout) {
  const chunks = [];
  const parseErrors = [];
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      if (event?.type === "item.completed" && event?.item?.type === "agent_message") {
        chunks.push(event.item.text || "");
      }
    } catch (error) {
      parseErrors.push({ line, error: String(error) });
    }
  }
  return { text: chunks.join("\n"), parseErrors };
}

function protocolPrompt(scenario, index) {
  const requestId = `req_m0_${String(index + 1).padStart(2, "0")}_${crypto.randomUUID().slice(0, 8)}`;
  return `# Run Context
- 執行環境: UAT Tool
- Run ID: M0_TOOL_BRIDGE_SPIKE
- Domain: galaxy-bi
- Mac Agent: spike-agent
- Rules Commit: local
- 適用協議: AGENTS_TOOL_BRIDGE_SPIKE.md

# AGENTS_TOOL_BRIDGE_SPIKE.md
You are running under the UAT Tool Bridge Protocol.
When you need PM/user input, output exactly one request block and no prose:
[TOOL_REQUEST]
{ valid JSON object }
[/TOOL_REQUEST]

Rules:
- The markers must be standalone lines.
- JSON may be multi-line.
- Include request_id exactly as provided by the scenario.
- Do not run tools.
- Do not add Markdown fences.
- Do not add any explanation before or after the block.

# Scenario
Return a ${scenario.type} request for:
${scenario.description}

Use this request_id: ${requestId}
Use this JSON schema:
${JSON.stringify(schemaFor(scenario.type), null, 2)}
`;
}

function schemaFor(type) {
  if (type === "irreversible_operation") {
    return {
      type,
      case: "<case_no>",
      action: "<concrete action>",
      reason: "<why this is required>",
      request_id: "<provided request_id>"
    };
  }
  if (type === "ambiguity_decision") {
    return {
      type,
      case: "<case_no>",
      context: "<current ambiguity>",
      options: ["<option A>", "<option B>"],
      recommendation: "<your recommended option>",
      request_id: "<provided request_id>"
    };
  }
  return {
    type,
    error: "<playwright error>",
    proposed_action: "<recovery action>",
    request_id: "<provided request_id>"
  };
}

const scenarioTemplates = [
  {
    type: "irreversible_operation",
    description: "Case F-05 requires deleting the temporary report named M0_delete_probe after verifying the delete icon."
  },
  {
    type: "ambiguity_decision",
    description:
      "Case D-09 found that UI says value is cleared, but request body still contains the previous filter value. Ask PM whether to mark FAIL or rerun after manual reset."
  },
  {
    type: "playwright_recovery",
    description:
      "Playwright failed with Target page, context or browser has been closed and SingletonLock files may block recovery."
  },
  {
    type: "irreversible_operation",
    description:
      "Case A-04 requires overwriting an existing saved report to validate edit persistence. The affected report is a temporary resource."
  },
  {
    type: "ambiguity_decision",
    description:
      "Case B-08 expects half-dynamic date range but the page displays absolute dates. Ask PM which behavior should be canonical."
  }
];

function runParserFixtures() {
  const fixtures = [
    {
      name: "valid_multiline",
      input: `[TOOL_REQUEST]
{
  "type": "irreversible_operation",
  "case": "F-05",
  "action": "刪除臨時報表",
  "reason": "驗證刪除流程",
  "request_id": "req_fixture_1"
}
[/TOOL_REQUEST]`,
      expectValid: 1,
      expectWarnings: 0
    },
    {
      name: "ansi_and_noise",
      input: `noise\n\u001b[31m[TOOL_REQUEST]\u001b[0m
{"type":"playwright_recovery","error":"SingletonLock_blocked","proposed_action":"clear lock files","request_id":"req_fixture_2"}
[/TOOL_REQUEST]\nmore noise`,
      expectValid: 1,
      expectWarnings: 0
    },
    {
      name: "invalid_json",
      input: `[TOOL_REQUEST]
{"type":"ambiguity_decision","request_id":"req_bad",
[/TOOL_REQUEST]`,
      expectValid: 0,
      expectWarnings: 1
    },
    {
      name: "truncated",
      input: `[TOOL_REQUEST]
{"type":"playwright_recovery","request_id":"req_truncated"}`,
      expectValid: 0,
      expectWarnings: 1
    },
    {
      name: "duplicate_request_id",
      input: `[TOOL_REQUEST]
{"type":"playwright_recovery","error":"e1","proposed_action":"a1","request_id":"req_dup"}
[/TOOL_REQUEST]
[TOOL_REQUEST]
{"type":"playwright_recovery","error":"e2","proposed_action":"a2","request_id":"req_dup"}
[/TOOL_REQUEST]`,
      expectValid: 2,
      expectWarnings: 1
    }
  ];

  return fixtures.map((fixture) => {
    const parsed = parseToolRequests(fixture.input);
    const validCount = parsed.requests.filter((request) => request.valid).length;
    const requestWarnings = parsed.requests.flatMap((request) => request.warnings);
    const warningCount = parsed.warnings.length + requestWarnings.length;
    return {
      name: fixture.name,
      validCount,
      warningCount,
      verdict:
        validCount === fixture.expectValid && warningCount >= fixture.expectWarnings ? "PASS" : "FAIL",
      parsed
    };
  });
}

async function runCodexScenario(scenario, index) {
  const prompt = protocolPrompt(scenario, index);
  const result = await runProcess(`codex-${String(index + 1).padStart(2, "0")}`, codexBin, [...execBaseArgs, prompt], {
    timeoutMs: 180_000
  });
  const assistant = extractAssistantText(result.stdout);
  const parsed = parseToolRequests(assistant.text);
  const validRequests = parsed.requests.filter((request) => request.valid);
  return {
    index: index + 1,
    type: scenario.type,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    assistantText: assistant.text,
    parseErrors: assistant.parseErrors,
    parsed,
    verdict: result.exitCode === 0 && validRequests.length === 1 ? "PASS" : "FAIL"
  };
}

async function main() {
  fs.mkdirSync(runDir, { recursive: true });
  const environment = {
    runId,
    repoRoot,
    spikeRoot,
    runDir,
    fixtureDir,
    codexBin,
    codexCount,
    node: process.version,
    platform: `${os.platform()}-${os.arch()}`
  };
  writeJson("environment.json", environment);

  const parserFixtures = runParserFixtures();
  writeJson("parser-fixtures.json", parserFixtures);

  const scenarios = Array.from({ length: codexCount }, (_, index) => scenarioTemplates[index % scenarioTemplates.length]);
  const codexRuns = [];
  for (let index = 0; index < scenarios.length; index += 1) {
    const run = await runCodexScenario(scenarios[index], index);
    codexRuns.push(run);
    writeJson(`codex-${String(index + 1).padStart(2, "0")}.json`, run);
  }

  const codexPass = codexRuns.filter((run) => run.verdict === "PASS").length;
  const requestIds = codexRuns.flatMap((run) => run.parsed.requests.map((request) => request.data?.request_id).filter(Boolean));
  const duplicates = requestIds.filter((id, index) => requestIds.indexOf(id) !== index);
  const missingRequestId = codexRuns.filter((run) =>
    run.parsed.requests.some((request) => request.warnings.some((warning) => warning.code === "MISSING_REQUEST_ID"))
  ).length;
  const parserPass = parserFixtures.every((fixture) => fixture.verdict === "PASS");
  const parseRate = codexRuns.length ? codexPass / codexRuns.length : 0;
  const summary = {
    environment,
    parserPass,
    parserFixtures: parserFixtures.map((fixture) => ({
      name: fixture.name,
      verdict: fixture.verdict,
      validCount: fixture.validCount,
      warningCount: fixture.warningCount
    })),
    codexPass,
    codexTotal: codexRuns.length,
    parseRate,
    missingRequestId,
    duplicateRequestIds: [...new Set(duplicates)],
    verdict:
      parserPass && parseRate >= 0.9 && missingRequestId === 0 && duplicates.length === 0 ? "PASS" : "FAIL",
    codexRuns: codexRuns.map((run) => ({
      index: run.index,
      type: run.type,
      verdict: run.verdict,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      durationMs: run.durationMs,
      requestCount: run.parsed.requests.length,
      validRequestCount: run.parsed.requests.filter((request) => request.valid).length,
      warnings: [...run.parsed.warnings, ...run.parsed.requests.flatMap((request) => request.warnings)]
    }))
  };
  writeJson("summary.json", summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
