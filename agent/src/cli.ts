#!/usr/bin/env node
import fs from "node:fs";
import { AgentConnection } from "./connection";
import { defaultAgentConfig, defaultConfigPath, ensureAgentDirectories, readConfig, writeConfig } from "./config";
import { runDoctor } from "./doctor";
import { installLaunchd, uninstallLaunchd } from "./launchd";
import { handleTaskDispatch, handleToolResponse } from "./task-runner";
import { closeChromeDebugSession } from "./browser-session";

const args = process.argv.slice(2);

const getFlag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const printJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const maskToken = (token: string): string => {
  if (!token) return "";
  if (token.length <= 8) return "********";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const getPayloadRunId = (message: { payload: Record<string, unknown> }): string | null => {
  const runId = message.payload.run_id;
  return typeof runId === "string" && runId.trim() ? runId : null;
};

const sendRejection = (
  connection: AgentConnection,
  type: "run.rejected" | "task.rejected",
  message: { type: string; payload: Record<string, unknown> },
  reason: string,
  extra: Record<string, unknown> = {}
): void => {
  connection.send(
    type,
    {
      run_id: getPayloadRunId(message) ?? "unknown",
      rejected_type: message.type,
      reason,
      ...extra
    },
    true
  );
};

const usage = (): void => {
  process.stdout.write(`uat-agent commands:
  login --server <wss-url> --token <agent-token> [--device-name <name>]
        [--workspace-root <codex-galaxy-root>]
  doctor
  status
  start
  install-launchd [--no-load]
  uninstall-launchd
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
    const workspaceRoot = getFlag("--workspace-root");
    if (!server || !token) {
      throw new Error("LOGIN_REQUIRES_SERVER_AND_TOKEN");
    }
    const config = defaultAgentConfig({
      server,
      token,
      device_name: deviceName ?? defaultAgentConfig().device_name,
      codex_workspace_root: workspaceRoot ? fs.realpathSync(workspaceRoot) : defaultAgentConfig().codex_workspace_root
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

  if (command === "status") {
    if (!fs.existsSync(defaultConfigPath)) {
      printJson({
        ok: false,
        configured: false,
        configPath: defaultConfigPath,
        message: "Run `uat-agent login --server <url> --token <token>` first."
      });
      return;
    }

    const config = readConfig();
    printJson({
      ok: true,
      configured: true,
      configPath: defaultConfigPath,
      server: config.server,
      device_name: config.device_name,
      token: maskToken(config.token),
      codex_bin: config.codex_bin,
      codex_reasoning_effort: config.codex_reasoning_effort,
      codex_workspace_root: config.codex_workspace_root,
      codex_workspace_agents_exists: fs.existsSync(`${config.codex_workspace_root}/AGENTS.md`),
      workdir_root: config.workdir_root,
      chrome_profile_dir: config.chrome_profile_dir,
      workdir_exists: fs.existsSync(config.workdir_root),
      chrome_profile_exists: fs.existsSync(config.chrome_profile_dir)
    });
    return;
  }

  if (command === "start") {
    const config = readConfig();
    ensureAgentDirectories(config);
    let stopping = false;
    let currentConnection: AgentConnection | null = null;
    const stop = (): void => {
      stopping = true;
      void closeChromeDebugSession(config);
      currentConnection?.close();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);

    for (let attempt = 0; !stopping; attempt += 1) {
      let activeTask: { runId: string; cancel: (reason?: string) => void } | null = null;
      const connection = new AgentConnection({
        config,
        onStatus: (status, detail) => {
          printJson({ event: "status", status, detail: detail instanceof Error ? detail.message : detail });
          if (status === "closed" && activeTask) {
            activeTask.cancel("agent_connection_closed");
            printJson({ event: "task_cancelled", runId: activeTask.runId, reason: "agent_connection_closed" });
          }
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
              void closeChromeDebugSession(config);
              printJson({ event: "task_cancel_ignored", runId, reason, activeRunId: activeTask?.runId ?? null });
            }
            return;
          }
          if (message.type === "task.dispatch") {
            const runId = getPayloadRunId(message);
            if (activeTask) {
              sendRejection(connection, "run.rejected", message, "agent_busy", {
                current_run_id: activeTask.runId
              });
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
            return;
          }
          if (message.type === "tool_response") {
            const runId = getPayloadRunId(message);
            if (activeTask) {
              sendRejection(connection, "run.rejected", message, "agent_busy", {
                current_run_id: activeTask.runId
              });
              return;
            }
            void handleToolResponse(connection, config, message, {
              onCancelReady: (readyRunId, cancel) => {
                activeTask = { runId: readyRunId, cancel };
              },
              onCancelClear: (doneRunId) => {
                if (activeTask?.runId === doneRunId) activeTask = null;
              }
            }).catch((error) => {
              if (runId && activeTask?.runId === runId) activeTask = null;
              printJson({
                event: "tool_response_error",
                type: message.type,
                id: message.id,
                error: error instanceof Error ? error.message : String(error)
              });
            });
            return;
          }
          if (message.type !== "ack") {
            sendRejection(connection, "task.rejected", message, "unknown_task_type");
            printJson({
              event: "task_rejected",
              type: message.type,
              id: message.id,
              reason: "unknown_task_type"
            });
          }
        }
      });
      currentConnection = connection;

      try {
        await connection.connect();
        printJson({ event: "connected" });
        attempt = 0;
        await connection.waitUntilClosed();
      } catch (error) {
        printJson({ event: "connection_error", error: error instanceof Error ? error.message : String(error) });
      } finally {
        if (currentConnection === connection) currentConnection = null;
      }

      if (!stopping) {
        const delayMs = Math.min(1_000 * 2 ** Math.min(attempt, 4), 15_000);
        printJson({ event: "reconnect_scheduled", delay_ms: delayMs });
        await sleep(delayMs);
      }
    }
    printJson({ event: "stopped" });
    return;
  }

  if (command === "install-launchd") {
    const config = readConfig();
    ensureAgentDirectories(config);
    printJson(installLaunchd(config, !args.includes("--no-load")));
    return;
  }

  if (command === "uninstall-launchd") {
    printJson(uninstallLaunchd());
    return;
  }

  throw new Error(`UNKNOWN_COMMAND:${command}`);
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
