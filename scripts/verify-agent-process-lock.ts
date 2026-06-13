import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireAgentProcessLock, agentProcessLockDir } from "../agent/src/process-lock";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-agent-process-lock-"));
const configPath = path.join(tempRoot, "config.json");
fs.writeFileSync(configPath, "{}\n");

const firstRelease = acquireAgentProcessLock(configPath);
const lockDir = agentProcessLockDir(configPath);
assert.equal(fs.existsSync(lockDir), true, "first acquire should create lock dir");

assert.throws(
  () => acquireAgentProcessLock(configPath),
  /AGENT_ALREADY_RUNNING/,
  "second acquire in the same process should be rejected while lock owner is alive"
);

firstRelease();
assert.equal(fs.existsSync(lockDir), false, "release should remove lock dir");

const secondRelease = acquireAgentProcessLock(configPath);
secondRelease();

fs.mkdirSync(lockDir, { recursive: true });
fs.writeFileSync(path.join(lockDir, "owner.json"), `${JSON.stringify({
  pid: 99999999,
  startedAt: new Date().toISOString(),
  configPath,
  cwd: tempRoot,
  argv: ["node", "agent/dist/cli.js", "--config", configPath, "start"]
})}\n`);
const staleRelease = acquireAgentProcessLock(configPath);
staleRelease();

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("verify-agent-process-lock: ok");
