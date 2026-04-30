import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentConfig } from "./types";

export const defaultConfigPath = path.join(os.homedir(), ".uat-agent", "config.json");

const hasAgentsFile = (dir: string): boolean => fs.existsSync(path.join(dir, "AGENTS.md"));

const detectWorkspaceRoot = (): string => {
  const envRoot = process.env.UAT_AGENT_CODEX_WORKSPACE_ROOT?.trim();
  const candidates = [
    envRoot ? path.resolve(envRoot) : "",
    path.resolve(__dirname, "../../.."),
    path.resolve(process.cwd(), ".."),
    process.cwd()
  ].filter(Boolean);
  return candidates.find(hasAgentsFile) ?? process.cwd();
};

export const defaultAgentConfig = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  version: 1,
  server: "wss://testtool-production.up.railway.app/agent-ws",
  token: "",
  device_name: os.hostname(),
  codex_bin: "codex",
  codex_model: process.env.UAT_AGENT_CODEX_MODEL?.trim() || "gpt-5.3-codex",
  codex_reasoning_effort: process.env.UAT_AGENT_CODEX_REASONING_EFFORT === "medium" ||
    process.env.UAT_AGENT_CODEX_REASONING_EFFORT === "high" ||
    process.env.UAT_AGENT_CODEX_REASONING_EFFORT === "xhigh"
    ? process.env.UAT_AGENT_CODEX_REASONING_EFFORT
    : "low",
  auto_approve_tool_requests: process.env.UAT_AGENT_AUTO_APPROVE_TOOL_REQUESTS !== "false",
  keep_chrome_warm: process.env.UAT_AGENT_KEEP_CHROME_WARM !== "false",
  codex_workspace_root: detectWorkspaceRoot(),
  workdir_root: path.join(os.homedir(), ".uat-agent", "runs"),
  chrome_profile_dir: path.join(os.homedir(), ".uat-agent", "chrome-profile"),
  log_level: "info",
  ...overrides
});

export const readConfig = (configPath = defaultConfigPath): AgentConfig => {
  if (!fs.existsSync(configPath)) {
    throw new Error(`AGENT_CONFIG_NOT_FOUND:${configPath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<AgentConfig>;
  return defaultAgentConfig(parsed);
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
