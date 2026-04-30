import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import type { AgentCapability, AgentConfig, DoctorCheck } from "./types";

const check = (name: string, condition: boolean, details?: Record<string, unknown>): DoctorCheck => ({
  name,
  verdict: condition ? "PASS" : "FAIL",
  details
});

const skipped = (name: string, details?: Record<string, unknown>): DoctorCheck => ({
  name,
  verdict: "SKIPPED",
  details
});

const run = (command: string, args: string[], timeoutMs = 20_000): Promise<{ exitCode: number | null; stdout: string; stderr: string }> => {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: String(error) });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
};

const ensureWritableDir = (dir: string): boolean => {
  fs.mkdirSync(dir, { recursive: true });
  const probe = `${dir}/.uat-agent-doctor-${Date.now()}`;
  fs.writeFileSync(probe, "ok");
  const ok = fs.readFileSync(probe, "utf8") === "ok";
  fs.unlinkSync(probe);
  return ok;
};

const isDirectory = (dir: string): boolean => {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

export const runDoctor = async (config: AgentConfig): Promise<DoctorCheck[]> => {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const codexVersion = await run(config.codex_bin, ["--version"]);
  const checks: DoctorCheck[] = [
    check("node-version", nodeMajor >= 20, { version: process.version }),
    check("agent-token-present", Boolean(config.token), { hasToken: Boolean(config.token) }),
    check("server-config-present", Boolean(config.server), { server: config.server }),
    check("codex-workspace-root", isDirectory(config.codex_workspace_root), { dir: config.codex_workspace_root }),
    check("codex-workspace-agents", fs.existsSync(`${config.codex_workspace_root}/AGENTS.md`), {
      path: `${config.codex_workspace_root}/AGENTS.md`
    }),
    check("workdir-writable", ensureWritableDir(config.workdir_root), { dir: config.workdir_root }),
    check("chrome-profile-writable", ensureWritableDir(config.chrome_profile_dir), { dir: config.chrome_profile_dir }),
    os.platform() === "darwin"
      ? skipped("macos-ui-automation-permissions", {
          reason: "macOS privacy grants cannot be changed programmatically by Agent doctor.",
          required_for: "Visible Chrome automation, screen observation, and any desktop fallback interaction.",
          recommended_apps: ["Terminal", "Codex", "Google Chrome"],
          grant_in: [
            "System Settings > Privacy & Security > Accessibility",
            "System Settings > Privacy & Security > Screen Recording",
            "System Settings > Privacy & Security > Automation"
          ],
          note: "Persistent Playwright CDP usually works without Accessibility, but visible UI/desktop recovery can stall if these grants are missing."
        })
      : skipped("macos-ui-automation-permissions", {
          reason: "Not running on macOS."
        }),
    check("codex-version", codexVersion.exitCode === 0, {
      version: codexVersion.stdout.trim() || codexVersion.stderr.trim()
    }),
    skipped("playwright-mcp-availability", {
      reason: "Verified during live runs through persistent Chrome CDP; doctor does not launch a Codex MCP session."
    }),
    skipped("galaxy-sso-session", {
      reason: "Open Galaxy URL with persistent profile and ask Tommy to login/confirm"
    }),
    skipped("railway-websocket-token-live", {
      reason: "Implemented in connection smoke once backend /agent-ws exists"
    })
  ];
  return checks;
};

const getCheck = (checks: DoctorCheck[], name: string): DoctorCheck | undefined => checks.find((item) => item.name === name);

const getStringDetail = (checkResult: DoctorCheck | undefined, key: string): string | null => {
  const value = checkResult?.details?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

export const buildAgentCapability = async (config: AgentConfig): Promise<AgentCapability> => {
  const doctorChecks = await runDoctor(config);
  const hasFailedCheck = doctorChecks.some((item) => item.verdict === "FAIL");
  const chromeProfile = getCheck(doctorChecks, "chrome-profile-writable");
  const playwrightMcp = getCheck(doctorChecks, "playwright-mcp-availability");

  return {
    platform: `${os.platform()}-${os.arch()}`,
    codex_version: getStringDetail(getCheck(doctorChecks, "codex-version"), "version"),
    node_version: process.version,
    supported_task_types: ["uat_run"],
    supported_execution_modes: ["interactive", "diagnostic"],
    tool_bridge_versions: ["spike-v1"],
    playwright_mcp_available: playwrightMcp?.verdict === "PASS",
    chrome_profile_ready: chromeProfile?.verdict === "PASS",
    doctor_ok: !hasFailedCheck,
    doctor_checks: doctorChecks
  };
};
