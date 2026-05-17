import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defaultAgentConfig } from "../agent/src/config";
import { diagnoseChromeDebugSession, ensureChromeDebugSession } from "../agent/src/browser-session";

const listen = (server: http.Server): Promise<number> => new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    resolve(address.port);
  });
});

const close = (server: http.Server): Promise<void> => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

const main = async (): Promise<void> => {
  const previousPort = process.env.UAT_AGENT_CHROME_DEBUG_PORT;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uat-agent-browser-isolation-"));
  const server = http.createServer((request, response) => {
    if (request.url === "/json/version") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ Browser: "FakeChrome/1.0" }));
      return;
    }
    if (request.url === "/json/list") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("[]");
      return;
    }
    response.writeHead(404);
    response.end();
  });

  try {
    const port = await listen(server);
    delete process.env.UAT_AGENT_CHROME_DEBUG_PORT;
    const config = defaultAgentConfig({
      chrome_debug_port: port,
      workdir_root: path.join(tempDir, "runs"),
      chrome_profile_dir: path.join(tempDir, "chrome-profile")
    });

    const diagnostics = await diagnoseChromeDebugSession(config);
    assert.equal(diagnostics.endpoint, `http://127.0.0.1:${port}`);
    assert.equal(diagnostics.available, true);
    assert.equal(diagnostics.profileMismatch, true);
    assert.equal(diagnostics.profileMatched, false);
    assert.deepEqual(diagnostics.dedicatedPids, []);

    await assert.rejects(
      () => ensureChromeDebugSession(config, "https://example.invalid"),
      /CHROME_CDP_PROFILE_MISMATCH/
    );
  } finally {
    if (previousPort === undefined) {
      delete process.env.UAT_AGENT_CHROME_DEBUG_PORT;
    } else {
      process.env.UAT_AGENT_CHROME_DEBUG_PORT = previousPort;
    }
    await close(server);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  process.stdout.write("Agent browser-session isolation smoke passed.\n");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
