import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CodexRunner } from "../agent/src/codex-runner";
import { defaultAgentConfig } from "../agent/src/config";
import { runDoctor } from "../agent/src/doctor";

const main = async (): Promise<void> => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uat-agent-resume-"));
  const fakeCodexPath = path.join(tempDir, "fake-codex.js");
  const argvPath = path.join(tempDir, "argv.json");
  const envPath = path.join(tempDir, "env.json");

  fs.writeFileSync(
    fakeCodexPath,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "if (process.argv[2] === '--version') { console.log('codex fake 0.0.0'); process.exit(0); }",
      "if (process.argv[2] === 'mcp' && process.argv[3] === 'list') { console.log('playwright enabled'); process.exit(0); }",
      "fs.writeFileSync(process.env.UAT_FAKE_CODEX_ARGV_PATH, JSON.stringify(process.argv.slice(2), null, 2));",
      "fs.writeFileSync(process.env.UAT_FAKE_CODEX_ENV_PATH, JSON.stringify({ CODEX_THREAD_ID: process.env.CODEX_THREAD_ID ?? null, CODEX_INTERNAL_ORIGINATOR_OVERRIDE: process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE ?? null }, null, 2));",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-from-fake-codex' }));",
      "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'resume ok' } }));"
    ].join("\n")
  );
  fs.chmodSync(fakeCodexPath, 0o755);

  const previousArgvPath = process.env.UAT_FAKE_CODEX_ARGV_PATH;
  const previousEnvPath = process.env.UAT_FAKE_CODEX_ENV_PATH;
  const previousPlaywrightMcpCommand = process.env.UAT_AGENT_PLAYWRIGHT_MCP_COMMAND;
  const previousCodexThreadId = process.env.CODEX_THREAD_ID;
  const previousCodexOriginator = process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
  process.env.UAT_FAKE_CODEX_ARGV_PATH = argvPath;
  process.env.UAT_FAKE_CODEX_ENV_PATH = envPath;
  process.env.CODEX_THREAD_ID = "desktop-thread-should-not-leak";
  process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = "Codex Desktop";
  try {
    const runner = new CodexRunner({
      codexBin: fakeCodexPath,
      model: "gpt-5.3-codex",
      cwd: tempDir,
      reasoningEffort: "low"
    });
    const result = await runner.resume("thread-123", "approved");
    assert.equal(result.exitCode, 0);
    assert.equal(result.threadId, "thread-from-fake-codex");
    assert.match(result.assistantText, /resume ok/);

    const args = JSON.parse(fs.readFileSync(argvPath, "utf8")) as string[];
    assert.deepEqual(args, [
      "-m",
      "gpt-5.3-codex",
      "-c",
      'model_reasoning_effort="low"',
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "resume",
      "thread-123",
      "approved"
    ]);
    const childEnv = JSON.parse(fs.readFileSync(envPath, "utf8")) as Record<string, string | null>;
    assert.equal(childEnv.CODEX_THREAD_ID, null, "CodexRunner must not leak desktop CODEX_THREAD_ID into child Codex");
    assert.equal(childEnv.CODEX_INTERNAL_ORIGINATOR_OVERRIDE, null, "CodexRunner must not leak desktop originator into child Codex");

    const defaultModelRunner = new CodexRunner({
      codexBin: fakeCodexPath,
      model: "",
      cwd: tempDir,
      reasoningEffort: "low"
    });
    const defaultModelResult = await defaultModelRunner.start("default model argv smoke");
    assert.equal(defaultModelResult.exitCode, 0);
    const defaultModelArgs = JSON.parse(fs.readFileSync(argvPath, "utf8")) as string[];
    assert.equal(defaultModelArgs.includes("-m"), false, "Empty codex_model should let Codex CLI use its default model");

    const unsupportedDoctor = await runDoctor(defaultAgentConfig({
      codex_bin: fakeCodexPath,
      token: "doctor-token",
      codex_model: "gpt-5.3-codex",
      workdir_root: path.join(tempDir, "doctor-runs"),
      chrome_profile_dir: path.join(tempDir, "doctor-chrome")
    }));
    assert.equal(
      unsupportedDoctor.find((item) => item.name === "codex-model-config")?.verdict,
      "FAIL",
      "doctor should reject the local unsupported gpt-5.3-codex config"
    );
    const defaultDoctor = await runDoctor(defaultAgentConfig({
      codex_bin: fakeCodexPath,
      token: "doctor-token",
      codex_model: "",
      workdir_root: path.join(tempDir, "doctor-runs-default"),
      chrome_profile_dir: path.join(tempDir, "doctor-chrome-default")
    }));
    assert.equal(
      defaultDoctor.find((item) => item.name === "codex-model-config")?.verdict,
      "PASS",
      "doctor should allow empty codex_model so Codex CLI can use its default"
    );

    process.env.UAT_AGENT_PLAYWRIGHT_MCP_COMMAND = "/tmp/fake-playwright-mcp";
    const browserRunner = new CodexRunner({
      codexBin: fakeCodexPath,
      model: "gpt-5.3-codex",
      cwd: tempDir,
      reasoningEffort: "low",
      playwrightCdpEndpoint: "http://127.0.0.1:9222",
      playwrightOutputDir: path.join(tempDir, "mcp-output")
    });
    const browserResult = await browserRunner.start("browser argv smoke");
    assert.equal(browserResult.exitCode, 0);

    const browserArgs = JSON.parse(fs.readFileSync(argvPath, "utf8")) as string[];
    assert.ok(
      browserArgs.includes('-c') && browserArgs.includes('mcp_servers.playwright.command="/tmp/fake-playwright-mcp"'),
      "CodexRunner should inject the Playwright MCP command, not only args"
    );
    assert.ok(
      browserArgs.includes(
        `mcp_servers.playwright.args=${JSON.stringify([
          "--cdp-endpoint",
          "http://127.0.0.1:9222",
          "--shared-browser-context",
          "--save-session",
          "--output-dir",
          path.join(tempDir, "mcp-output")
        ])}`
      ),
      "CodexRunner should inject the CDP-backed Playwright MCP args"
    );
    assert.ok(
      browserArgs.includes('mcp_servers.playwright.tools.browser_tabs.approval_mode="approve"'),
      "CodexRunner should preserve browser_tabs tool approval config for child Codex"
    );
  } finally {
    if (previousArgvPath === undefined) {
      delete process.env.UAT_FAKE_CODEX_ARGV_PATH;
    } else {
      process.env.UAT_FAKE_CODEX_ARGV_PATH = previousArgvPath;
    }
    if (previousEnvPath === undefined) {
      delete process.env.UAT_FAKE_CODEX_ENV_PATH;
    } else {
      process.env.UAT_FAKE_CODEX_ENV_PATH = previousEnvPath;
    }
    if (previousPlaywrightMcpCommand === undefined) {
      delete process.env.UAT_AGENT_PLAYWRIGHT_MCP_COMMAND;
    } else {
      process.env.UAT_AGENT_PLAYWRIGHT_MCP_COMMAND = previousPlaywrightMcpCommand;
    }
    if (previousCodexThreadId === undefined) {
      delete process.env.CODEX_THREAD_ID;
    } else {
      process.env.CODEX_THREAD_ID = previousCodexThreadId;
    }
    if (previousCodexOriginator === undefined) {
      delete process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
    } else {
      process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = previousCodexOriginator;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
