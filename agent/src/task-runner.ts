import type { AgentConfig, AgentMessage } from "./types";
import type { AgentConnection } from "./connection";

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const getRunId = (message: AgentMessage): string => {
  const runId = message.payload.run_id;
  if (typeof runId !== "string" || !runId.trim()) {
    throw new Error("TASK_DISPATCH_MISSING_RUN_ID");
  }
  return runId;
};

export const handleTaskDispatch = async (
  connection: AgentConnection,
  config: AgentConfig,
  message: AgentMessage
): Promise<void> => {
  const runId = getRunId(message);
  connection.setRunState("busy", runId);

  try {
    connection.send(
      "run.started",
      {
        run_id: runId,
        started_at: new Date().toISOString(),
        device_name: config.device_name
      },
      true
    );
    connection.send(
      "run.stdout",
      {
        run_id: runId,
        text: `uat-agent received task.dispatch for ${runId}`
      },
      false
    );

    // M1 dispatch smoke: prove the WebSocket task path before plugging in CodexRunner.
    await delay(300);

    connection.send(
      "run.completed",
      {
        run_id: runId,
        completed_at: new Date().toISOString(),
        result: "dispatch_smoke_completed"
      },
      true
    );
  } catch (error) {
    connection.send(
      "run.failed",
      {
        run_id: runId,
        error: error instanceof Error ? error.message : String(error)
      },
      true
    );
  } finally {
    connection.setRunState("idle", null);
  }
};
