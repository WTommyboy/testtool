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
  process.env.UAT_FAKE_CODEX_ARGV_PATH = argvPath;
  try {
    const runner = new CodexRunner({
      codexBin: fakeCodexPath,
      cwd: tempDir
    });
    const result = await runner.resume("thread-123", "approved");
    assert.equal(result.exitCode, 0);
    assert.equal(result.threadId, "thread-from-fake-codex");
    assert.match(result.assistantText, /resume ok/);

    const args = JSON.parse(fs.readFileSync(argvPath, "utf8")) as string[];
    assert.deepEqual(args, [
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "resume",
      "thread-123",
      "approved"
    ]);
  } finally {
    if (previousArgvPath === undefined) {
      delete process.env.UAT_FAKE_CODEX_ARGV_PATH;
    } else {
      process.env.UAT_FAKE_CODEX_ARGV_PATH = previousArgvPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
