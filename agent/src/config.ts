import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentConfig } from "./types";

const resolveUserPath = (value: string): string => {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
};

const envPath = (name: string): string | null => {
  const value = process.env[name]?.trim();
  return value ? resolveUserPath(value) : null;
};

const envNumber = (name: string, fallback: number): number => {
  const value = Number(process.env[name]?.trim());
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const envConfigPath = envPath("UAT_AGENT_CONFIG_PATH");

export const defaultAgentHome = envPath("UAT_AGENT_HOME")
  ?? (envConfigPath ? path.dirname(envConfigPath) : null)
  ?? path.join(os.homedir(), ".uat-agent");

export const defaultConfigPath = envConfigPath ?? path.join(defaultAgentHome, "config.json");

export const resolveConfigPath = (configPath?: string): string => {
  return configPath?.trim() ? resolveUserPath(configPath.trim()) : defaultConfigPath;
};

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

export const defaultAgentConfig = (
  overrides: Partial<AgentConfig> = {},
  configPath = defaultConfigPath
): AgentConfig => {
  const agentHome = path.dirname(resolveConfigPath(configPath));
  return {
    version: 1,
    server: "wss://testtool-production.up.railway.app/agent-ws",
    token: "",
    device_name: os.hostname(),
    codex_bin: "codex",
    codex_model: process.env.UAT_AGENT_CODEX_MODEL?.trim() || "",
    codex_reasoning_effort: process.env.UAT_AGENT_CODEX_REASONING_EFFORT === "medium" ||
      process.env.UAT_AGENT_CODEX_REASONING_EFFORT === "high" ||
      process.env.UAT_AGENT_CODEX_REASONING_EFFORT === "xhigh"
      ? process.env.UAT_AGENT_CODEX_REASONING_EFFORT
      : "low",
    auto_approve_tool_requests: process.env.UAT_AGENT_AUTO_APPROVE_TOOL_REQUESTS !== "false",
    keep_chrome_warm: process.env.UAT_AGENT_KEEP_CHROME_WARM !== "false",
    chrome_debug_port: envNumber("UAT_AGENT_CHROME_DEBUG_PORT", 9222),
    codex_workspace_root: detectWorkspaceRoot(),
    workdir_root: envPath("UAT_AGENT_WORKDIR_ROOT") ?? path.join(agentHome, "runs"),
    chrome_profile_dir: envPath("UAT_AGENT_CHROME_PROFILE_DIR") ?? path.join(agentHome, "chrome-profile"),
    log_level: "info",
    ...overrides
  };
};

export const readConfig = (configPath = defaultConfigPath): AgentConfig => {
  const resolvedPath = resolveConfigPath(configPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`AGENT_CONFIG_NOT_FOUND:${resolvedPath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as Partial<AgentConfig>;
  return defaultAgentConfig(parsed, resolvedPath);
};

export const writeConfig = (config: AgentConfig, configPath = defaultConfigPath): void => {
  const resolvedPath = resolveConfigPath(configPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(resolvedPath, 0o600);
};

export const ensureAgentDirectories = (config: AgentConfig): void => {
  fs.mkdirSync(config.workdir_root, { recursive: true });
  fs.mkdirSync(config.chrome_profile_dir, { recursive: true });
};
