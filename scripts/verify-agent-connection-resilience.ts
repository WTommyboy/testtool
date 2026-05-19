import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { AgentConnection } from "../agent/src/connection";
import { defaultAgentConfig } from "../agent/src/config";
import type { AgentMessage } from "../agent/src/types";

type JsonObject = Record<string, unknown>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async <T>(
  label: string,
  read: () => T | null | undefined,
  timeoutMs = 10_000
): Promise<T> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = read();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const makeCodexStub = (tempDir: string): string => {
  const stubPath = path.join(tempDir, "codex-stub.sh");
  fs.writeFileSync(
    stubPath,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then echo \"codex stub 0.0.0\"; exit 0; fi",
      "if [ \"$1\" = \"mcp\" ] && [ \"$2\" = \"list\" ]; then echo \"playwright enabled\"; exit 0; fi",
      "echo \"codex stub\"",
      "exit 0",
      ""
    ].join("\n")
  );
  fs.chmodSync(stubPath, 0o755);
  return stubPath;
};

const main = async (): Promise<void> => {
  const cliSource = fs.readFileSync(path.join(process.cwd(), "agent", "src", "cli.ts"), "utf8");
  assert.match(
    cliSource,
    /abortActiveTaskForConnectionLoss/,
    "CLI must have an active-run containment path for WebSocket connection loss"
  );
  assert.match(
    cliSource,
    /task_continues_after_connection_closed/,
    "CLI should still log connection-loss diagnostics before aborting the active task"
  );
  assert.match(
    cliSource,
    /agent_connection_closed/,
    "CLI should cancel the active task on WebSocket close instead of allowing a zombie run"
  );
  assert.match(
    cliSource,
    /process\.exit\(1\)/,
    "CLI should exit after active-run connection loss so launchd restarts a clean agent"
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uat-agent-connection-resilience-"));
  const messages: AgentMessage[] = [];
  const sockets: WebSocket[] = [];
  const statusEvents: Array<{ status: string; detail?: unknown }> = [];
  const wss = new WebSocketServer({ port: 0 });

  try {
    wss.on("connection", (socket) => {
      sockets.push(socket);
      socket.on("message", (data) => {
        messages.push(JSON.parse(data.toString("utf8")) as AgentMessage);
      });
    });

    await waitFor("WebSocket server listening", () => wss.address());
    const address = wss.address();
    assert.ok(address && typeof address === "object", "WebSocket server should have a TCP address");

    const connection = new AgentConnection({
      config: defaultAgentConfig({
        server: `ws://127.0.0.1:${address.port}`,
        token: "resilience-token",
        device_name: "Connection Resilience Smoke",
        codex_bin: makeCodexStub(tempDir),
        codex_workspace_root: path.resolve(process.cwd(), ".."),
        workdir_root: path.join(tempDir, "runs"),
        chrome_profile_dir: path.join(tempDir, "chrome-profile")
      }),
      onStatus: (status, detail) => {
        statusEvents.push({ status, detail });
      }
    });

    await connection.connect();
    await waitFor("initial agent.online", () => messages.find((message) => message.type === "agent.online"));
    connection.setRunState("busy", "resilience-run");

    sockets[0]?.terminate();
    await waitFor("client close status", () => statusEvents.find((event) => event.status === "closed"));

    assert.doesNotThrow(() => {
      connection.send(
        "run.completed",
        {
          run_id: "resilience-run",
          result: "codex_completed",
          result_xlsx_uploaded: true
        } satisfies JsonObject,
        true
      );
    }, "send() should queue active-run completion while the WebSocket is closed");
    assert.equal(
      messages.filter((message) => message.type === "run.completed").length,
      0,
      "run.completed should not be delivered until reconnect"
    );

    await connection.connect();
    await waitFor(
      "reconnected agent.online",
      () => messages.filter((message) => message.type === "agent.online").length >= 2 ? true : null
    );
    const completed = await waitFor(
      "queued run.completed after reconnect",
      () => messages.find((message) => message.type === "run.completed")
    );
    assert.equal(completed.payload.run_id, "resilience-run");

    connection.close();
  } finally {
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  process.stdout.write("Agent connection resilience smoke passed.\n");
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
