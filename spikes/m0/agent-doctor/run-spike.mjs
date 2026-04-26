#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const spikeRoot = path.join(repoRoot, "spikes", "m0", "agent-doctor");
const outputRoot = path.join(spikeRoot, "output");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(outputRoot, runId);
const homeDir = os.homedir();
const defaultConfigPath = path.join(homeDir, ".uat-agent", "config.json");
const defaultWorkdir = path.join(homeDir, ".uat-agent", "runs");
const defaultProfileDir = path.join(homeDir, ".uat-agent", "chrome-profile");

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node spikes/m0/agent-doctor/run-spike.mjs");
  console.log("Runs M0-5 local Agent Doctor checks.");
  process.exit(0);
}

fs.mkdirSync(runDir, { recursive: true });

function writeJson(name, value) {
  fs.writeFileSync(path.join(runDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function runProcess(name, command, args, options = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3_000).unref();
    }, options.timeoutMs || 60_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    if (options.stdin) child.stdin.write(options.stdin);
    child.stdin.end();
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ name, exitCode: null, signal: null, timedOut, stdout, stderr, error: String(error), durationMs: Date.now() - startedAt });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ name, exitCode, signal, timedOut, stdout, stderr, durationMs: Date.now() - startedAt });
    });
  });
}

function pass(name, details = {}) {
  return { name, verdict: "PASS", ...details };
}

function fail(name, details = {}) {
  return { name, verdict: "FAIL", ...details };
}

function skipped(name, details = {}) {
  return { name, verdict: "SKIPPED", ...details };
}

async function checkNode() {
  const major = Number(process.versions.node.split(".")[0]);
  return major >= 20 ? pass("node-version", { version: process.version }) : fail("node-version", { version: process.version });
}

async function checkWritableDir(name, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, `.doctor-${Date.now()}`);
  fs.writeFileSync(probe, "ok");
  const content = fs.readFileSync(probe, "utf8");
  fs.unlinkSync(probe);
  return content === "ok" ? pass(name, { dir }) : fail(name, { dir });
}

async function checkCodex() {
  const version = await runProcess("codex-version", "codex", ["--version"], { timeoutMs: 20_000 });
  const exec = await runProcess(
    "codex-exec",
    "codex",
    [
      "exec",
      "--json",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--ignore-rules",
      "-C",
      runDir,
      "M0 agent doctor check. Do not run tools. Reply exactly: M0_DOCTOR_CODEX_OK"
    ],
    { timeoutMs: 120_000 }
  );
  const execOk = exec.exitCode === 0 && exec.stdout.includes("M0_DOCTOR_CODEX_OK");
  return {
    name: "codex-cli",
    verdict: version.exitCode === 0 && execOk ? "PASS" : "FAIL",
    version: version.stdout.trim() || version.stderr.trim(),
    execOk,
    versionExitCode: version.exitCode,
    execExitCode: exec.exitCode,
    execDurationMs: exec.durationMs
  };
}

async function startLocalServer() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>M0 Doctor</title><main>M0 doctor profile persistence</main>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function checkPlaywrightProfile(profileDir) {
  const local = await startLocalServer();
  const token = `doctor_${Date.now()}`;
  const headed = process.env.M0_HEADED === "1";
  try {
    const firstContext = await chromium.launchPersistentContext(profileDir, {
      headless: !headed,
      viewport: { width: 1000, height: 700 }
    });
    const firstPage = firstContext.pages()[0] || (await firstContext.newPage());
    await firstPage.goto(local.url);
    await firstPage.evaluate((value) => {
      localStorage.setItem("m0_doctor_token", value);
      document.cookie = `m0_doctor_cookie=${value}; path=/; max-age=86400; SameSite=Lax`;
    }, token);
    await firstContext.close();

    const secondContext = await chromium.launchPersistentContext(profileDir, {
      headless: !headed,
      viewport: { width: 1000, height: 700 }
    });
    const secondPage = secondContext.pages()[0] || (await secondContext.newPage());
    await secondPage.goto(local.url);
    const restored = await secondPage.evaluate(() => ({
      localStorageToken: localStorage.getItem("m0_doctor_token"),
      cookie: document.cookie
    }));
    await secondContext.close();

    const cookieOk = restored.cookie.includes(`m0_doctor_cookie=${token}`);
    const localStorageOk = restored.localStorageToken === token;
    return cookieOk && localStorageOk
      ? pass("playwright-persistent-profile", { profileDir, headed, restored })
      : fail("playwright-persistent-profile", { profileDir, headed, restored });
  } finally {
    await local.close();
  }
}

async function main() {
  const configPath = process.env.UAT_AGENT_CONFIG || defaultConfigPath;
  let config = null;
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }
  const workdir = config?.workdir_root || defaultWorkdir;
  const profileDir = process.env.UAT_TOOL_CHROME_PROFILE_DIR || config?.chrome_profile_dir || defaultProfileDir;

  const checks = [];
  checks.push(await checkNode());
  checks.push(
    fs.existsSync(configPath)
      ? pass("agent-config", { configPath, hasServer: Boolean(config?.server), hasToken: Boolean(config?.token) })
      : skipped("agent-config", { configPath, reason: "config file does not exist yet; M1 agent login will create it" })
  );
  checks.push(await checkWritableDir("workdir-writable", workdir));
  checks.push(await checkWritableDir("chrome-profile-writable", profileDir));
  checks.push(await checkCodex());
  checks.push(await checkPlaywrightProfile(profileDir));
  checks.push(
    skipped("playwright-mcp-availability", {
      reason: "Cannot be verified from plain Node spike; verify via Codex tool runtime or uat-agent doctor after M1.2"
    })
  );
  checks.push(
    skipped("galaxy-sso-session", {
      reason: "Doctor can verify profile persistence, but cannot safely automate company SSO login in M0"
    })
  );
  checks.push(
    skipped("railway-agent-token-live", {
      reason: "No Agent WebSocket endpoint/token exists until M1.1/M1.2"
    })
  );

  const required = checks.filter((check) => !["SKIPPED"].includes(check.verdict));
  const summary = {
    environment: {
      runId,
      repoRoot,
      spikeRoot,
      runDir,
      node: process.version,
      platform: `${os.platform()}-${os.arch()}`,
      configPath,
      workdir,
      profileDir
    },
    checks,
    requiredPass: required.every((check) => check.verdict === "PASS"),
    skipped: checks.filter((check) => check.verdict === "SKIPPED").map((check) => check.name),
    verdict: required.every((check) => check.verdict === "PASS") ? "PARTIAL" : "FAIL"
  };
  writeJson("summary.json", summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
