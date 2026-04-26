import fs from "node:fs";
import path from "node:path";
import { CodexRunner } from "./codex-runner";
import type { AgentConfig, AgentMessage } from "./types";
import type { AgentConnection } from "./connection";

const getRunId = (message: AgentMessage): string => {
  const runId = message.payload.run_id;
  if (typeof runId !== "string" || !runId.trim()) {
    throw new Error("TASK_DISPATCH_MISSING_RUN_ID");
  }
  return runId;
};

const getStringPayload = (message: AgentMessage, key: string): string | null => {
  const value = message.payload[key];
  return typeof value === "string" && value.trim() ? value : null;
};

const ensureRunWorkspace = (config: AgentConfig, runId: string): string => {
  const runDir = path.join(config.workdir_root, runId);
  fs.mkdirSync(path.join(runDir, "input"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "rules"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "output"), { recursive: true });
  return runDir;
};

const writeJson = (filePath: string, value: unknown): void => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const buildPrompt = (runId: string, message: AgentMessage, runDir: string): string => {
  const instruction = getStringPayload(message, "startup_instruction") ?? "Acknowledge this UAT run assignment and finish.";
  const domain = getStringPayload(message, "domain") ?? "BI";
  const roundId = getStringPayload(message, "round_id") ?? runId;

  return [
    "You are running inside the Galaxy UAT Tool Mac Agent.",
    "",
    "Execution constraints:",
    "- Treat this as an automated agent turn, not an interactive chat with Tommy.",
    "- Do not perform destructive operations.",
    "- If required input files or credentials are missing, report the missing prerequisites and exit cleanly.",
    "- Keep the response concise and machine-ingestable.",
    "",
    `Run ID: ${runId}`,
    `Domain: ${domain}`,
    `Round ID: ${roundId}`,
    `Agent workdir: ${runDir}`,
    "",
    "Startup instruction:",
    instruction
  ].join("\n");
};

const summarizeStderr = (stderr: string): string => {
  const pluginWarningIndex = stderr.indexOf("failed to warm featured plugin ids cache");
  const relevant = pluginWarningIndex >= 0 ? stderr.slice(0, pluginWarningIndex) : stderr;
  const cleaned = relevant
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return cleaned.slice(0, 1200);
};

export const handleTaskDispatch = async (
  connection: AgentConnection,
  config: AgentConfig,
  message: AgentMessage
): Promise<void> => {
  const runId = getRunId(message);
  const runDir = ensureRunWorkspace(config, runId);
  connection.setRunState("busy", runId);

  try {
    writeJson(path.join(runDir, "input", "dispatch.json"), message);
    writeJson(path.join(runDir, "state.json"), {
      run_id: runId,
      status: "started",
      started_at: new Date().toISOString()
    });

    connection.send(
      "run.started",
      {
        run_id: runId,
        started_at: new Date().toISOString(),
        device_name: config.device_name,
        workdir: runDir
      },
      true
    );
    connection.send(
      "run.stdout",
      {
        run_id: runId,
        text: `uat-agent starting CodexRunner for ${runId}`
      },
      false
    );

    const runner = new CodexRunner({
      codexBin: config.codex_bin,
      cwd: runDir
    });
    const result = await runner.start(buildPrompt(runId, message, runDir));
    fs.writeFileSync(path.join(runDir, "codex.log"), result.rawStdout);
    fs.writeFileSync(path.join(runDir, "codex.stderr.log"), result.stderr);
    writeJson(path.join(runDir, "output", "codex-result.json"), {
      threadId: result.threadId,
      assistantText: result.assistantText,
      exitCode: result.exitCode,
      signal: result.signal,
      stderr: result.stderr,
      parseErrors: result.parseErrors,
      eventCount: result.events.length
    });

    if (result.parseErrors.length > 0) {
      connection.send(
        "run.stderr",
        {
          run_id: runId,
          text: `Codex JSON parse warnings: ${result.parseErrors.length}`
        },
        false
      );
    }

    const stderrSummary = summarizeStderr(result.stderr);
    if (stderrSummary) {
      connection.send(
        "run.stderr",
        {
          run_id: runId,
          text: stderrSummary
        },
        false
      );
    }

    if (result.assistantText.trim()) {
      connection.send(
        "run.stdout",
        {
          run_id: runId,
          text: result.assistantText.slice(0, 8000)
        },
        false
      );
    }

    if (result.exitCode !== 0) {
      throw new Error(`CODEX_RUN_FAILED exit=${result.exitCode} signal=${result.signal ?? "none"}`);
    }

    writeJson(path.join(runDir, "state.json"), {
      run_id: runId,
      status: "completed",
      completed_at: new Date().toISOString(),
      thread_id: result.threadId
    });

    connection.send(
      "run.completed",
      {
        run_id: runId,
        completed_at: new Date().toISOString(),
        result: "codex_completed",
        thread_id: result.threadId,
        workdir: runDir
      },
      true
    );
  } catch (error) {
    writeJson(path.join(runDir, "state.json"), {
      run_id: runId,
      status: "failed",
      failed_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    });
    connection.send(
      "run.failed",
      {
        run_id: runId,
        error: error instanceof Error ? error.message : String(error),
        workdir: runDir
      },
      true
    );
  } finally {
    connection.setRunState("idle", null);
  }
};
