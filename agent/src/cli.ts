#!/usr/bin/env node
import { AgentConnection } from "./connection";
import { defaultAgentConfig, defaultConfigPath, ensureAgentDirectories, readConfig, writeConfig } from "./config";
import { runDoctor } from "./doctor";

const args = process.argv.slice(2);

const getFlag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const printJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
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
    const connection = new AgentConnection({
      config,
      onStatus: (status, detail) => {
        printJson({ event: "status", status, detail: detail instanceof Error ? detail.message : detail });
      },
      onMessage: (message) => {
        printJson({ event: "message", type: message.type, id: message.id });
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
