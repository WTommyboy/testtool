import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CodexRunner } from "../agent/src/codex-runner";

const main = async (): Promise<void> => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uat-agent-resume-"));
  const fakeCodexPath = path.join(tempDir, "fake-codex.js");
  const argvPath = path.join(tempDir, "argv.json");

  fs.writeFileSync(
    fakeCodexPath,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "fs.writeFileSync(process.env.UAT_FAKE_CODEX_ARGV_PATH, JSON.stringify(process.argv.slice(2), null, 2));",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-from-fake-codex' }));",
      "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'resume ok' } }));"
    ].join("\n")
  );
  fs.chmodSync(fakeCodexPath, 0o755);

  const previousArgvPath = process.env.UAT_FAKE_CODEX_ARGV_PATH;
  const previousPlaywrightMcpCommand = process.env.UAT_AGENT_PLAYWRIGHT_MCP_COMMAND;
  process.env.UAT_FAKE_CODEX_ARGV_PATH = argvPath;
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
    if (previousPlaywrightMcpCommand === undefined) {
      delete process.env.UAT_AGENT_PLAYWRIGHT_MCP_COMMAND;
    } else {
      process.env.UAT_AGENT_PLAYWRIGHT_MCP_COMMAND = previousPlaywrightMcpCommand;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
