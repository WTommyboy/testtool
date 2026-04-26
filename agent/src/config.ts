import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentConfig } from "./types";

export const defaultConfigPath = path.join(os.homedir(), ".uat-agent", "config.json");

export const defaultAgentConfig = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  version: 1,
  server: "wss://testtool-production.up.railway.app/agent-ws",
  token: "",
  device_name: os.hostname(),
  codex_bin: "codex",
  workdir_root: path.join(os.homedir(), ".uat-agent", "runs"),
  chrome_profile_dir: path.join(os.homedir(), ".uat-agent", "chrome-profile"),
  log_level: "info",
  ...overrides
});

export const readConfig = (configPath = defaultConfigPath): AgentConfig => {
  if (!fs.existsSync(configPath)) {
    throw new Error(`AGENT_CONFIG_NOT_FOUND:${configPath}`);
  }
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as AgentConfig;
};

export const writeConfig = (config: AgentConfig, configPath = defaultConfigPath): void => {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(configPath, 0o600);
};

export const ensureAgentDirectories = (config: AgentConfig): void => {
  fs.mkdirSync(config.workdir_root, { recursive: true });
  fs.mkdirSync(config.chrome_profile_dir, { recursive: true });
};
