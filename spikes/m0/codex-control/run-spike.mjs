#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const spikeRoot = path.join(repoRoot, "spikes", "m0", "codex-control");
const outputRoot = path.join(spikeRoot, "output");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(outputRoot, runId);
const fixtureDir = path.join(runDir, "fixture");

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node spikes/m0/codex-control/run-spike.mjs");
  console.log("Runs the M0-1 Codex CLI control spike and writes output under spikes/m0/codex-control/output/.");
  process.exit(0);
}

fs.mkdirSync(fixtureDir, { recursive: true });
fs.writeFileSync(
  path.join(fixtureDir, "README.md"),
  [
    "# Codex Control Spike Fixture",
    "",
    "This directory is intentionally minimal.",
    "The spawned Codex process should not edit files during this spike.",
    ""
  ].join("\n")
);

const codexBin = process.env.CODEX_BIN || "codex";
const baseCodexArgs = [
  "--no-alt-screen",
  "--sandbox",
  "read-only",
  "--ask-for-approval",
  "never",
  "-C",
  fixtureDir
];
const execBaseArgs = [
  "exec",
  "--json",
  "--ephemeral",
  "--sandbox",
  "read-only",
  "--skip-git-repo-check",
  "--ignore-rules",
  "-C",
  fixtureDir
];

const cleanEnv = {
  ...process.env,
  NO_COLOR: "1",
  TERM: "xterm-256color"
};

function writeJson(name, value) {
  fs.writeFileSync(path.join(runDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function runProcess(name, command, args, options = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd || fixtureDir,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeoutMs = options.timeoutMs || 180_000;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, timeoutMs);
    let killTimer = null;
    if (options.killAfterMs) {
      killTimer = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      }, options.killAfterMs);
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    if (options.stdin) {
      child.stdin.write(options.stdin);
      if (options.endStdin !== false) child.stdin.end();
    } else {
      child.stdin.end();
    }
    child.on("error", (error) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        name,
        command,
        args,
        exitCode: null,
        error: String(error),
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr
      });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        name,
        command,
        args,
        exitCode,
        signal,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr
      });
    });
  });
}

function parseJsonl(stdout) {
  const events = [];
  const errors = [];
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      errors.push({ line, error: String(error) });
    }
  }
  return { events, errors };
}

async function runExecJson() {
  const prompt =
    "This is an automated M0 subprocess-control spike. Do not inspect files. Do not run tools. Reply exactly: M0_EXEC_JSON_OK";
  const result = await runProcess("exec-json-basic", codexBin, [...execBaseArgs, prompt], {
    timeoutMs: 180_000
  });
  const parsed = parseJsonl(result.stdout);
  const stdoutContainsSentinel = result.stdout.includes("M0_EXEC_JSON_OK");
  return {
    ...result,
    parsedEventCount: parsed.events.length,
    parseErrorCount: parsed.errors.length,
    stdoutContainsSentinel,
    verdict: result.exitCode === 0 && stdoutContainsSentinel ? "PASS" : "FAIL"
  };
}

async function runExecJsonResume() {
  const firstPrompt =
    "This is an automated M0 exec-resume spike. Do not inspect files. Do not run tools. Remember the token ZEBRA_427. Reply exactly: M0_EXEC_RESUME_FIRST_OK";
  const first = await runProcess("exec-json-resume-first", codexBin, [...execBaseArgs.filter((arg) => arg !== "--ephemeral"), firstPrompt], {
    timeoutMs: 180_000
  });
  const parsed = parseJsonl(first.stdout);
  const threadStarted = parsed.events.find((event) => event?.type === "thread.started");
  const threadId = threadStarted?.thread_id;
  if (!threadId) {
    return {
      name: "exec-json-resume-two-turn",
      first,
      verdict: "FAIL",
      reason: "missing thread_id from first exec"
    };
  }

  const secondPrompt =
    "This is the second turn of the M0 exec-resume spike. If you remember token ZEBRA_427, reply exactly: M0_EXEC_RESUME_SECOND_OK";
  const second = await runProcess(
    "exec-json-resume-second",
    codexBin,
    ["exec", "resume", "--json", threadId, secondPrompt],
    {
      timeoutMs: 180_000,
      cwd: fixtureDir
    }
  );
  const firstOk = first.stdout.includes("M0_EXEC_RESUME_FIRST_OK");
  const secondOk = second.stdout.includes("M0_EXEC_RESUME_SECOND_OK");
  return {
    name: "exec-json-resume-two-turn",
    threadId,
    first,
    second,
    firstOk,
    secondOk,
    verdict: first.exitCode === 0 && second.exitCode === 0 && firstOk && secondOk ? "PASS" : "FAIL"
  };
}

async function runExecJsonSigterm() {
  const prompt =
    "This is an automated M0 SIGTERM spike. Do not inspect files. Do not run tools. Write a long response of at least 100 numbered lines.";
  const result = await runProcess("exec-json-sigterm", codexBin, [...execBaseArgs, prompt], {
    killAfterMs: 1_000,
    timeoutMs: 30_000
  });
  const terminatedPromptly = result.durationMs < 10_000;
  const wasInterrupted =
    result.signal === "SIGTERM" ||
    result.exitCode !== 0 ||
    (result.stdout.includes('"turn.started"') && !result.stdout.includes('"turn.completed"'));
  return {
    ...result,
    terminatedPromptly,
    wasInterrupted,
    verdict: terminatedPromptly && wasInterrupted && !result.timedOut ? "PASS" : "FAIL"
  };
}

async function runDirectSpawn() {
  const prompt =
    "This is an automated M0 subprocess-control spike. Do not inspect files. Do not run tools. Reply exactly: M0_DIRECT_SPAWN_OK";
  const result = await runProcess("direct-spawn-no-tty", codexBin, [...baseCodexArgs, prompt], {
    timeoutMs: 180_000
  });
  const stdoutContainsSentinel = result.stdout.includes("M0_DIRECT_SPAWN_OK");
  return {
    ...result,
    stdoutContainsSentinel,
    verdict: result.exitCode === 0 && stdoutContainsSentinel ? "PASS" : "FAIL"
  };
}

async function runExpectTwoTurn() {
  const expectPath = "/usr/bin/expect";
  if (!fs.existsSync(expectPath)) {
    return {
      name: "expect-two-turn",
      verdict: "SKIPPED",
      reason: "expect binary not found"
    };
  }
  const scriptPath = path.join(runDir, "two-turn.expect");
  const firstPrompt =
    "This is an automated M0 PTY two-turn spike. Do not inspect files. Do not run tools. Reply exactly with this code word by joining these tokens with underscores: M0 PTY FIRST OK";
  const secondPrompt =
    "Now reply exactly with this code word by joining these tokens with underscores: M0 PTY SECOND OK";
  const escapedCodexArgs = [...baseCodexArgs].map((arg) => arg.replace(/\\/g, "\\\\").replace(/"/g, "\\\""));
  fs.writeFileSync(
    scriptPath,
    [
      "set timeout 240",
      "set env(TERM) dumb",
      "log_user 1",
      `spawn ${codexBin} ${escapedCodexArgs.map((x) => `"${x}"`).join(" ")}`,
      "expect {",
      "  -re {Continue anyway\\? \\[y/N\\]:} { send -- \"y\\r\" }",
      "  -re {Refusing to start} { exit 23 }",
      "  timeout { }",
      "  eof { exit 22 }",
      "}",
      "after 3000",
      `send -- "${firstPrompt}\\r"`,
      "expect {",
      "  -re {M0_PTY_FIRST_OK} {}",
      "  timeout { exit 21 }",
      "  eof { exit 22 }",
      "}",
      `send -- "${secondPrompt}\\r"`,
      "expect {",
      "  -re {M0_PTY_SECOND_OK} {}",
      "  timeout { exit 31 }",
      "  eof { exit 32 }",
      "}",
      "send -- \"\\003\"",
      "expect { eof {} timeout { exit 41 } }",
      ""
    ].join("\n")
  );
  const result = await runProcess("expect-two-turn", expectPath, [scriptPath], {
    timeoutMs: 300_000
  });
  const hasFirst = result.stdout.includes("M0_PTY_FIRST_OK");
  const hasSecond = result.stdout.includes("M0_PTY_SECOND_OK");
  return {
    ...result,
    hasFirst,
    hasSecond,
    verdict: result.exitCode === 0 && hasFirst && hasSecond ? "PASS" : "FAIL"
  };
}

async function main() {
  fs.mkdirSync(runDir, { recursive: true });
  const environment = {
    runId,
    repoRoot,
    spikeRoot,
    runDir,
    fixtureDir,
    codexBin,
    node: process.version,
    platform: `${os.platform()}-${os.arch()}`
  };
  writeJson("environment.json", environment);

  const results = [];
  for (const test of [runExecJson, runExecJsonResume, runExecJsonSigterm, runDirectSpawn, runExpectTwoTurn]) {
    const result = await test();
    results.push(result);
    writeJson(`${result.name}.json`, result);
  }

  const summary = {
    environment,
    results: results.map((r) => ({
      name: r.name,
      verdict: r.verdict,
      exitCode: r.exitCode,
      signal: r.signal,
      timedOut: r.timedOut,
      durationMs: r.durationMs,
      threadId: r.threadId,
      firstOk: r.firstOk,
      secondOk: r.secondOk,
      terminatedPromptly: r.terminatedPromptly,
      wasInterrupted: r.wasInterrupted,
      stdoutContainsSentinel: r.stdoutContainsSentinel,
      hasFirst: r.hasFirst,
      hasSecond: r.hasSecond,
      reason: r.reason
    }))
  };
  writeJson("summary.json", summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
