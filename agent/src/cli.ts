#!/usr/bin/env node
import { AgentConnection } from "./connection";
import { defaultAgentConfig, defaultConfigPath, ensureAgentDirectories, readConfig, writeConfig } from "./config";
import { runDoctor } from "./doctor";
import { handleTaskDispatch } from "./task-runner";

const args = process.argv.slice(2);

const getFlag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const printJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const getPayloadRunId = (message: { payload: Record<string, unknown> }): string | null => {
  const runId = message.payload.run_id;
  return typeof runId === "string" && runId.trim() ? runId : null;
};

const usage = (): void => {
  process.stdout.write(`uat-agent commands:
  login --server <wss-url> --token <agent-token> [--device-name <name>]
  doctor
  start
`);
};

const main = async (): Promise<void> => {
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "login") {
    const server = getFlag("--server");
    const token = getFlag("--token");
    const deviceName = getFlag("--device-name");
    if (!server || !token) {
      throw new Error("LOGIN_REQUIRES_SERVER_AND_TOKEN");
    }
    const config = defaultAgentConfig({
      server,
      token,
      device_name: deviceName ?? defaultAgentConfig().device_name
    });
    ensureAgentDirectories(config);
    writeConfig(config);
    printJson({ ok: true, configPath: defaultConfigPath, device_name: config.device_name });
    return;
  }

  if (command === "doctor") {
    const config = readConfig();
    ensureAgentDirectories(config);
    const checks = await runDoctor(config);
    const required = checks.filter((check) => check.verdict !== "SKIPPED");
    printJson({
      ok: required.every((check) => check.verdict === "PASS"),
      checks
    });
    return;
  }

  if (command === "start") {
    const config = readConfig();
    ensureAgentDirectories(config);
    let activeTask: { runId: string; cancel: (reason?: string) => void } | null = null;
    const connection = new AgentConnection({
      config,
      onStatus: (status, detail) => {
        printJson({ event: "status", status, detail: detail instanceof Error ? detail.message : detail });
      },
      onMessage: (message) => {
        printJson({ event: "message", type: message.type, id: message.id });
        if (message.type === "task.cancel") {
          const runId = getPayloadRunId(message);
          const reason = typeof message.payload.reason === "string" ? message.payload.reason : "cancelled_by_pm";
          if (activeTask && (!runId || activeTask.runId === runId)) {
            activeTask.cancel(reason);
            printJson({ event: "task_cancelled", runId: activeTask.runId, reason });
          } else {
            printJson({ event: "task_cancel_ignored", runId, reason, activeRunId: activeTask?.runId ?? null });
          }
          return;
        }
        if (message.type === "task.dispatch") {
          const runId = getPayloadRunId(message);
          if (activeTask) {
            connection.send(
              "run.rejected",
              {
                run_id: runId ?? "unknown",
                reason: "AGENT_BUSY",
                current_run_id: activeTask.runId
              },
              true
            );
            return;
          }
          void handleTaskDispatch(connection, config, message, {
            onCancelReady: (readyRunId, cancel) => {
              activeTask = { runId: readyRunId, cancel };
            },
            onCancelClear: (doneRunId) => {
              if (activeTask?.runId === doneRunId) activeTask = null;
            }
          }).catch((error) => {
            if (runId && activeTask?.runId === runId) activeTask = null;
            printJson({
              event: "task_error",
              type: message.type,
              id: message.id,
              error: error instanceof Error ? error.message : String(error)
            });
          });
        }
      }
    });
    await connection.connect();
    return;
  }

  throw new Error(`UNKNOWN_COMMAND:${command}`);
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
