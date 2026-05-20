import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (relativePath: string): string => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

const main = (): void => {
  const cliSource = read("agent/src/cli.ts");
  const agentRunEventsSource = read("src/agent/agent-run-events.ts");
  const runsSource = read("src/runs.ts");

  assert.match(
    cliSource,
    /abortActiveTaskForConnectionLoss/,
    "Mac Agent CLI must abort active tasks when the control WebSocket is lost."
  );
  assert.match(
    cliSource,
    /process\.exit\(1\)/,
    "Mac Agent CLI must exit after active-run connection loss so launchd starts a clean worker."
  );

  assert.match(
    agentRunEventsSource,
    /remote_run_terminal_snapshot/,
    "Server must dispatch cancellation when an agent reconnects with a local snapshot for a terminal run."
  );
  assert.match(
    agentRunEventsSource,
    /agentRegistry\.send\(\s*agentId,\s*["']task\.cancel["']/s,
    "Server reconnect handler must send task.cancel for terminal run snapshots."
  );
  assert.match(
    agentRunEventsSource,
    /message\.type === ["']run\.started["'][\s\S]*?!isTerminalStatus\(currentStatus\)[\s\S]*?setRunStatus\(runId, ["']RUNNING["']\)/,
    "run.started must not resurrect a terminal run."
  );

  assert.match(
    runsSource,
    /TERMINAL_STATUSES\.has\(currentStatus\)[\s\S]*?RUN_ALREADY_TERMINAL[\s\S]*?result\.upload_rejected/s,
    "Result upload endpoint must reject result.xlsx uploads after the run is terminal."
  );
  assert.match(
    runsSource,
    /const isResultEvidenceGateError = error instanceof ResultEvidenceGateError;[\s\S]*?if \(!isResultEvidenceGateError\) \{[\s\S]*?setRunStatusWithMeta\(runId, ["']FAILED["']\)/,
    "Result evidence gate upload errors must not terminalize the run before the Agent can apply case-level containment and retry."
  );

  process.stdout.write("Zombie run guard smoke passed.\n");
};

main();
