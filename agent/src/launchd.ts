import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { AgentConfig } from "./types";

export const launchdLabel = "com.tommy.uat-agent";
export const launchdPlistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${launchdLabel}.plist`);

const escapeXml = (value: string): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

const getAgentCliPath = (): string => path.resolve(__dirname, "cli.js");

const buildPlist = (config: AgentConfig): string => {
  const cliPath = getAgentCliPath();
  const logDir = path.join(os.homedir(), ".uat-agent", "logs");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(launchdLabel)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(process.execPath)}</string>
    <string>${escapeXml(cliPath)}</string>
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

export const installLaunchd = (config: AgentConfig, load = true): Record<string, unknown> => {
  fs.mkdirSync(path.dirname(launchdPlistPath), { recursive: true });
  fs.mkdirSync(path.join(os.homedir(), ".uat-agent", "logs"), { recursive: true });
  fs.writeFileSync(launchdPlistPath, buildPlist(config), { mode: 0o644 });

  const result: Record<string, unknown> = {
    ok: true,
    label: launchdLabel,
    plistPath: launchdPlistPath,
    cliPath: getAgentCliPath(),
    loaded: false
  };

  if (load) {
    const guiTarget = getGuiTarget();
    const bootout = runLaunchctl(["bootout", guiTarget, launchdPlistPath]);
    const bootstrap = runLaunchctl(["bootstrap", guiTarget, launchdPlistPath]);
    const enable = runLaunchctl(["enable", `${guiTarget}/${launchdLabel}`]);
    result.loaded = bootstrap.ok;
    result.launchctl = { bootout, bootstrap, enable };
  }

  return result;
};

export const uninstallLaunchd = (): Record<string, unknown> => {
  const bootout = runLaunchctl(["bootout", getGuiTarget(), launchdPlistPath]);
  const existed = fs.existsSync(launchdPlistPath);
  if (existed) {
    fs.rmSync(launchdPlistPath, { force: true });
  }
  return {
    ok: true,
    label: launchdLabel,
    plistPath: launchdPlistPath,
    removed: existed,
    launchctl: { bootout }
  };
};
