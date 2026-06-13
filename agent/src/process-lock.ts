import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveConfigPath } from "./config";

type ProcessLockOwner = {
  pid: number;
  startedAt: string;
  configPath: string;
  cwd: string;
  argv: string[];
};

export type AgentStartProcess = {
  pid: number;
  command: string;
};

export const agentProcessLockDir = (configPath: string): string =>
  path.join(path.dirname(resolveConfigPath(configPath)), "agent-process.lock");

const ownerPathFor = (lockDir: string): string => path.join(lockDir, "owner.json");

const readOwner = (lockDir: string): ProcessLockOwner | null => {
  try {
    const parsed = JSON.parse(fs.readFileSync(ownerPathFor(lockDir), "utf8")) as Partial<ProcessLockOwner>;
    return typeof parsed.pid === "number" && Number.isInteger(parsed.pid) ? parsed as ProcessLockOwner : null;
  } catch {
    return null;
  }
};

const pidAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const writeOwner = (lockDir: string, configPath: string): void => {
  const owner: ProcessLockOwner = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    configPath: resolveConfigPath(configPath),
    cwd: process.cwd(),
    argv: process.argv
  };
  fs.writeFileSync(ownerPathFor(lockDir), `${JSON.stringify(owner, null, 2)}\n`, { mode: 0o600 });
};

export const acquireAgentProcessLock = (configPath: string): (() => void) => {
  const lockDir = agentProcessLockDir(configPath);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.mkdirSync(lockDir, { mode: 0o700 });
      writeOwner(lockDir, configPath);
      return () => {
        const owner = readOwner(lockDir);
        if (owner?.pid === process.pid) {
          fs.rmSync(lockDir, { recursive: true, force: true });
        }
      };
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (code !== "EEXIST") throw error;
      const owner = readOwner(lockDir);
      if (owner && pidAlive(owner.pid)) {
        throw new Error(`AGENT_ALREADY_RUNNING pid=${owner.pid} config=${resolveConfigPath(configPath)} lock=${lockDir}`);
      }
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  }
  throw new Error(`AGENT_PROCESS_LOCK_FAILED config=${resolveConfigPath(configPath)} lock=${lockDir}`);
};

export const findAgentStartProcessesForConfig = (configPath: string): AgentStartProcess[] => {
  const resolvedConfigPath = resolveConfigPath(configPath);
  const defaultResolvedConfigPath = resolveConfigPath();
  const output = spawnSync("ps", ["axo", "pid=,command="], { encoding: "utf8" });
  if (output.status !== 0) return [];
  return output.stdout
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(.+)$/);
      if (!match) return null;
      return { pid: Number(match[1]), command: match[2] };
    })
    .filter((item): item is AgentStartProcess => {
      if (!item || item.pid === process.pid) return false;
      const command = item.command;
      const usesExplicitConfig = command.includes("--config") && command.includes(resolvedConfigPath);
      const usesDefaultConfig = !command.includes("--config") && resolvedConfigPath === defaultResolvedConfigPath;
      return /^\S*node\s/.test(command) &&
        command.includes("agent/dist/cli.js") &&
        command.includes(" start") &&
        (usesExplicitConfig || usesDefaultConfig);
    });
};
