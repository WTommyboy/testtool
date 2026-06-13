#!/usr/bin/env node
import fs from "node:fs";
import { AgentConnection } from "./connection";
import { defaultAgentConfig, ensureAgentDirectories, readConfig, resolveConfigPath, writeConfig } from "./config";
import { runDoctor } from "./doctor";
import { installLaunchd, uninstallLaunchd } from "./launchd";
import { handleTaskDispatch, handleToolResponse } from "./task-runner";
import { closeChromeDebugSession, openUrlInDedicatedChrome } from "./browser-session";
import { acquireAgentProcessLock } from "./process-lock";
import type { AgentConfig, AgentMessage } from "./types";

const rawArgs = process.argv.slice(2);

const removeFlagWithValue = (argv: string[], name: string): { args: string[]; value?: string } => {
  const next: string[] = [];
  let value: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name) {
      value = argv[index + 1];
      index += 1;
      continue;
    }
    next.push(argv[index]);
  }
  return { args: next, value };
};

const parsedGlobalConfig = removeFlagWithValue(rawArgs, "--config");
const parsedLaunchdLabel = removeFlagWithValue(parsedGlobalConfig.args, "--launchd-label");
const args = parsedLaunchdLabel.args;
const configPath = resolveConfigPath(parsedGlobalConfig.value);
const launchdLabel = parsedLaunchdLabel.value;

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

const codexModelLabel = (model: string): string => model.trim() || "(codex-cli-default)";

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

const asHttpUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const handleBrowserOpenUrl = async (
  connection: AgentConnection,
  config: AgentConfig,
  message: AgentMessage
): Promise<void> => {
  const url = asHttpUrl(message.payload.url);
  const requestId = typeof message.payload.request_id === "string" ? message.payload.request_id : `browser_open_${Date.now()}`;
  const runId = getPayloadRunId(message) ?? requestId;
  if (!url) {
    connection.send("browser.open_failed", {
      run_id: runId,
      request_id: requestId,
      error: "INVALID_URL"
    }, true);
    return;
  }

  connection.send("browser.open_started", {
    run_id: runId,
    request_id: requestId,
    url,
    started_at: new Date().toISOString()
  }, false);

  try {
    const result = await openUrlInDedicatedChrome(config, url, { resetTabs: true, openInitialUrl: true });
    connection.send("browser.open_completed", {
      run_id: runId,
      request_id: requestId,
      url,
      endpoint: result.endpoint,
      target_id: result.target?.id ?? null,
      target_url: result.target?.url ?? null,
      profile_dir: result.profileDir,
      warning: result.warning,
      completed_at: new Date().toISOString()
    }, true);
    printJson({
      event: "browser_open_completed",
      requestId,
      url,
      endpoint: result.endpoint,
      targetId: result.target?.id ?? null,
      warning: result.warning
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    connection.send("browser.open_failed", {
      run_id: runId,
      request_id: requestId,
      url,
      error: messageText
    }, true);
    printJson({
      event: "browser_open_failed",
      requestId,
      url,
      error: messageText
    });
  }
};

const usage = (): void => {
  process.stdout.write(`uat-agent commands:
  --config <path> may be passed before or after the command.
  --launchd-label <label> may be used with install-launchd/uninstall-launchd.
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
    const baseConfig = defaultAgentConfig({}, configPath);
    const config = defaultAgentConfig({
      server,
      token,
      device_name: deviceName ?? baseConfig.device_name,
      codex_workspace_root: workspaceRoot ? fs.realpathSync(workspaceRoot) : baseConfig.codex_workspace_root
    }, configPath);
    ensureAgentDirectories(config);
    writeConfig(config, configPath);
    printJson({ ok: true, configPath, device_name: config.device_name });
    return;
  }

  if (command === "doctor") {
    const config = readConfig(configPath);
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
    if (!fs.existsSync(configPath)) {
      printJson({
        ok: false,
        configured: false,
        configPath,
        message: "Run `uat-agent login --server <url> --token <token>` first."
      });
      return;
    }

    const config = readConfig(configPath);
    printJson({
      ok: true,
      configured: true,
      configPath,
      server: config.server,
      device_name: config.device_name,
      token: maskToken(config.token),
      codex_bin: config.codex_bin,
      codex_model: codexModelLabel(config.codex_model),
      codex_ignore_user_config: config.codex_ignore_user_config,
      codex_service_tier: config.codex_service_tier,
      codex_reasoning_effort: config.codex_reasoning_effort,
      auto_approve_tool_requests: config.auto_approve_tool_requests,
      keep_chrome_warm: config.keep_chrome_warm,
      chrome_debug_port: config.chrome_debug_port,
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
    const config = readConfig(configPath);
    ensureAgentDirectories(config);
    const releaseProcessLock = acquireAgentProcessLock(configPath);
    let stopping = false;
    let activeTask: { runId: string; cancel: (reason?: string) => void } | null = null;
    const readRuntimeConfig = (): AgentConfig => {
      const latestConfig = readConfig(configPath);
      ensureAgentDirectories(latestConfig);
      return latestConfig;
    };
    printJson({
      event: "agent_start",
      pid: process.pid,
      configPath,
      device_name: config.device_name,
      server: config.server,
      codex_model: codexModelLabel(config.codex_model),
      codex_ignore_user_config: config.codex_ignore_user_config,
      codex_service_tier: config.codex_service_tier,
      codex_reasoning_effort: config.codex_reasoning_effort
    });
    const noteActiveTaskConnectionLoss = (status: "closed" | "error", detail?: unknown): void => {
      if (!activeTask || stopping) return;
      printJson({
        event: "task_continues_after_connection_loss",
        runId: activeTask.runId,
        reason: `agent_connection_${status}`,
        detail: detail instanceof Error ? detail.message : detail
      });
    };
    const connection = new AgentConnection({
      config,
      onStatus: (status, detail) => {
        printJson({ event: "status", status, detail: detail instanceof Error ? detail.message : detail });
        if (status === "closed" && activeTask) {
          printJson({
            event: "task_continues_after_connection_closed",
            runId: activeTask.runId,
            reason: "agent_connection_closed"
          });
          noteActiveTaskConnectionLoss(status, detail);
        }
        if (status === "error" && activeTask) {
          noteActiveTaskConnectionLoss(status, detail);
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
            let cancelConfig = config;
            try {
              cancelConfig = readRuntimeConfig();
            } catch {
              // Keep cancellation best-effort even if the config file is temporarily unreadable.
            }
            void closeChromeDebugSession(cancelConfig);
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
          let taskConfig: AgentConfig;
          try {
            taskConfig = readRuntimeConfig();
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            sendRejection(connection, "run.rejected", message, "agent_config_reload_failed", {
              error: errorMessage
            });
            printJson({ event: "task_rejected", type: message.type, id: message.id, reason: "agent_config_reload_failed", error: errorMessage });
            return;
          }
          printJson({
            event: "task_config_loaded",
            runId,
            codex_model: codexModelLabel(taskConfig.codex_model),
            codex_ignore_user_config: taskConfig.codex_ignore_user_config,
            codex_service_tier: taskConfig.codex_service_tier,
            codex_reasoning_effort: taskConfig.codex_reasoning_effort
          });
          void handleTaskDispatch(connection, taskConfig, message, {
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
        if (message.type === "browser.open_url") {
          if (activeTask) {
            sendRejection(connection, "task.rejected", message, "agent_busy", {
              current_run_id: activeTask.runId
            });
            return;
          }
          let browserConfig: AgentConfig;
          try {
            browserConfig = readRuntimeConfig();
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            sendRejection(connection, "task.rejected", message, "agent_config_reload_failed", {
              error: errorMessage
            });
            printJson({ event: "browser_open_rejected", type: message.type, id: message.id, reason: "agent_config_reload_failed", error: errorMessage });
            return;
          }
          void handleBrowserOpenUrl(connection, browserConfig, message).catch((error) => {
            printJson({
              event: "browser_open_error",
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
          let toolConfig: AgentConfig;
          try {
            toolConfig = readRuntimeConfig();
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            sendRejection(connection, "run.rejected", message, "agent_config_reload_failed", {
              error: errorMessage
            });
            printJson({ event: "tool_response_rejected", type: message.type, id: message.id, reason: "agent_config_reload_failed", error: errorMessage });
            return;
          }
          void handleToolResponse(connection, toolConfig, message, {
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
    const stop = (): void => {
      stopping = true;
      if (activeTask) {
        activeTask.cancel("agent_stopping");
        printJson({ event: "task_cancelled", runId: activeTask.runId, reason: "agent_stopping" });
      }
      void closeChromeDebugSession(config);
      connection.close();
      releaseProcessLock();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);

    for (let attempt = 0; !stopping; attempt += 1) {
      try {
        await connection.connect();
        printJson({ event: "connected" });
        attempt = 0;
        await connection.waitUntilClosed();
      } catch (error) {
        printJson({ event: "connection_error", error: error instanceof Error ? error.message : String(error) });
      }

      if (!stopping) {
        const delayMs = Math.min(1_000 * 2 ** Math.min(attempt, 4), 15_000);
        printJson({ event: "reconnect_scheduled", delay_ms: delayMs });
        await sleep(delayMs);
      }
    }
    releaseProcessLock();
    printJson({ event: "stopped" });
    return;
  }

  if (command === "install-launchd") {
    const config = readConfig(configPath);
    ensureAgentDirectories(config);
    printJson(installLaunchd(config, !args.includes("--no-load"), { configPath, label: launchdLabel }));
    return;
  }

  if (command === "uninstall-launchd") {
    printJson(uninstallLaunchd({ label: launchdLabel }));
    return;
  }

  throw new Error(`UNKNOWN_COMMAND:${command}`);
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
