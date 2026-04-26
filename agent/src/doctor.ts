import { spawn } from "node:child_process";
import fs from "node:fs";
import type { AgentConfig, DoctorCheck } from "./types";

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

export const runDoctor = async (config: AgentConfig): Promise<DoctorCheck[]> => {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const codexVersion = await run(config.codex_bin, ["--version"]);
  const checks: DoctorCheck[] = [
    check("node-version", nodeMajor >= 20, { version: process.version }),
    check("agent-token-present", Boolean(config.token), { hasToken: Boolean(config.token) }),
    check("server-config-present", Boolean(config.server), { server: config.server }),
    check("workdir-writable", ensureWritableDir(config.workdir_root), { dir: config.workdir_root }),
    check("chrome-profile-writable", ensureWritableDir(config.chrome_profile_dir), { dir: config.chrome_profile_dir }),
    check("codex-version", codexVersion.exitCode === 0, {
      version: codexVersion.stdout.trim() || codexVersion.stderr.trim()
    }),
    skipped("playwright-mcp-availability", {
      reason: "M1 skeleton does not yet launch Codex with MCP doctor prompt"
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
