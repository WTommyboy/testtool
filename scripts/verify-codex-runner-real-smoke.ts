import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CodexRunner } from "../agent/src/codex-runner";

const main = async (): Promise<void> => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uat-codex-runner-smoke-"));
  const model = process.env.UAT_AGENT_CODEX_SMOKE_MODEL?.trim() || "gpt-5.4-mini";
  try {
    const runner = new CodexRunner({
      codexBin: process.env.UAT_AGENT_CODEX_BIN?.trim() || "codex",
      model,
      cwd: tempDir,
      timeoutMs: 120_000,
      reasoningEffort: "low",
      ignoreUserConfig: true,
      ephemeralStart: true,
      serviceTier: "fast"
    });
    const result = await runner.start("Reply with exactly OK.");
    assert.equal(result.exitCode, 0, `CodexRunner.start exited ${result.exitCode}; stderr=${result.stderr}`);
    assert.equal(result.assistantText.trim(), "OK", `Unexpected assistant text: ${JSON.stringify(result.assistantText)}`);
    console.log(JSON.stringify({ ok: true, fixture: "codex-runner-real-smoke", model, threadId: result.threadId }, null, 2));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
