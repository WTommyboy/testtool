import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { AgentConfig } from "./types";
import { defaultConfigPath, resolveConfigPath } from "./config";

export const defaultLaunchdLabel = process.env.UAT_AGENT_LAUNCHD_LABEL?.trim() || "com.tommy.uat-agent";

const getLaunchdPlistPath = (label: string): string => {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
};

export const launchdLabel = defaultLaunchdLabel;
export const launchdPlistPath = getLaunchdPlistPath(launchdLabel);

const escapeXml = (value: string): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

const getAgentCliPath = (): string => path.resolve(__dirname, "cli.js");

type LaunchdOptions = {
  configPath?: string;
  label?: string;
};

const resolveLaunchdLabel = (label?: string): string => {
  return label?.trim() || defaultLaunchdLabel;
};

const buildPlist = (config: AgentConfig, options: LaunchdOptions = {}): string => {
  const cliPath = getAgentCliPath();
  const label = resolveLaunchdLabel(options.label);
  const resolvedConfigPath = resolveConfigPath(options.configPath);
  const logDir = path.join(path.dirname(resolvedConfigPath), "logs");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(process.execPath)}</string>
    <string>${escapeXml(cliPath)}</string>
    <string>--config</string>
    <string>${escapeXml(resolvedConfigPath)}</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(process.cwd())}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(logDir, "launchd.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(logDir, "launchd.err.log"))}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${escapeXml(os.homedir())}</string>
    <key>PATH</key>
    <string>${escapeXml(process.env.PATH ?? "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin")}</string>
    <key>UAT_AGENT_WORKDIR_ROOT</key>
    <string>${escapeXml(config.workdir_root)}</string>
    <key>UAT_AGENT_CONFIG_PATH</key>
    <string>${escapeXml(resolvedConfigPath)}</string>
  </dict>
</dict>
</plist>
`;
};

const runLaunchctl = (args: string[]): { ok: boolean; stdout: string; stderr: string; status: number | null } => {
  const result = spawnSync("launchctl", args, { encoding: "utf8" });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status
  };
};

const getGuiTarget = (): string => {
  if (typeof process.getuid !== "function") {
    throw new Error("LAUNCHD_REQUIRES_POSIX_GETUID");
  }
  return `gui/${process.getuid()}`;
};

export const installLaunchd = (
  config: AgentConfig,
  load = true,
  options: LaunchdOptions = {}
): Record<string, unknown> => {
  const configPath = resolveConfigPath(options.configPath);
  const label = resolveLaunchdLabel(options.label);
  const plistPath = getLaunchdPlistPath(label);
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.mkdirSync(path.join(path.dirname(configPath), "logs"), { recursive: true });
  fs.writeFileSync(plistPath, buildPlist(config, { configPath, label }), { mode: 0o644 });

  const result: Record<string, unknown> = {
    ok: true,
    label,
    plistPath,
    cliPath: getAgentCliPath(),
    configPath,
    loaded: false
  };

  if (load) {
    const guiTarget = getGuiTarget();
    const bootout = runLaunchctl(["bootout", guiTarget, plistPath]);
    const bootstrap = runLaunchctl(["bootstrap", guiTarget, plistPath]);
    const enable = runLaunchctl(["enable", `${guiTarget}/${label}`]);
    result.loaded = bootstrap.ok;
    result.launchctl = { bootout, bootstrap, enable };
  }

  return result;
};

export const uninstallLaunchd = (options: { label?: string } = {}): Record<string, unknown> => {
  const label = resolveLaunchdLabel(options.label);
  const plistPath = getLaunchdPlistPath(label);
  const bootout = runLaunchctl(["bootout", getGuiTarget(), plistPath]);
  const existed = fs.existsSync(plistPath);
  if (existed) {
    fs.rmSync(plistPath, { force: true });
  }
  return {
    ok: true,
    label,
    plistPath,
    removed: existed,
    launchctl: { bootout }
  };
};
