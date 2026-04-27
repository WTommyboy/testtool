import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

type JsonObject = Record<string, unknown>;

const rootDir = process.cwd();
const distServer = path.join(rootDir, "dist", "server.js");
const roundtripBootstrapToken = "roundtrip-bootstrap-token";

const randomPort = (): number => 39_000 + Math.floor(Math.random() * 5_000);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const requestJson = async <T = JsonObject>(baseUrl: string, pathName: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${baseUrl}${pathName}`, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) as T : null as T;
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${pathName} ${response.status}: ${text}`);
  }
  return body;
};

const postJson = async <T = JsonObject>(baseUrl: string, pathName: string, body: JsonObject): Promise<T> => {
  return requestJson<T>(baseUrl, pathName, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
};

const postBootstrapJson = async <T = JsonObject>(baseUrl: string, pathName: string, body: JsonObject): Promise<T> => {
  return requestJson<T>(baseUrl, pathName, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-agent-bootstrap-token": roundtripBootstrapToken
    },
    body: JSON.stringify(body)
  });
};

const waitForHealth = async (baseUrl: string, child: ChildProcess): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before health check: ${child.exitCode}`);
    }
    try {
      const health = await requestJson<JsonObject>(baseUrl, "/health");
      if (health.status === "healthy") return;
    } catch {
      await sleep(200);
    }
  }
  throw new Error("Server health check timed out.");
};

const startServer = async (): Promise<{ child: ChildProcess; baseUrl: string; tempDir: string }> => {
  assert.ok(fs.existsSync(distServer), "dist/server.js not found. Run `npm run build` before verify:agent-roundtrip.");
  const port = randomPort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uat-tool-agent-roundtrip-"));
  const child = spawn("node", [distServer], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(tempDir, "data", "uat.db"),
      STORAGE_ROOT: path.join(tempDir, "storage"),
      MAC_AGENT_BOOTSTRAP_TOKEN: roundtripBootstrapToken,
      AUTH_REQUIRED: "false",
      MAC_AGENT_HEARTBEAT_TIMEOUT_MS: "1200",
      MAC_AGENT_HEARTBEAT_SWEEP_INTERVAL_MS: "100",
      NODE_ENV: "development"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.on("exit", (code) => {
    if (code !== null && code !== 0 && stderr.trim()) {
      process.stderr.write(stderr);
    }
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child);
  return { child, baseUrl, tempDir };
};

const stopServer = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    sleep(2_000).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    })
  ]);
};

const waitForRunStatus = async (baseUrl: string, runId: string, status: string): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5_000) {
    const summary = await requestJson<{ runStatus: string }>(baseUrl, `/api/runs/${runId}/summary`);
    if (summary.runStatus === status) return;
    await sleep(100);
  }
  const summary = await requestJson<{ runStatus: string }>(baseUrl, `/api/runs/${runId}/summary`);
  throw new Error(`Run ${runId} did not reach ${status}; current status is ${summary.runStatus}.`);
};

const verifyDomainPackEndpoints = async (baseUrl: string): Promise<void> => {
  const domains = await requestJson<{ items: Array<{ name: string; valid: boolean; schemaVersion: string | null }> }>(baseUrl, "/api/domains");
  const bi = domains.items.find((item) => item.name === "BI");
  assert.ok(bi, "BI domain pack should be listed.");
  assert.equal(bi.valid, true, "BI domain pack should be valid.");
  assert.equal(bi.schemaVersion, "bi-mvp-v1", "BI domain schema version should match MVP fixture.");

  const schema = await requestJson<JsonObject>(baseUrl, "/api/domains/BI/schema");
  assert.equal(schema.displayName, "Galaxy BI");

  const adapter = await requestJson<JsonObject>(baseUrl, "/api/domains/BI/result-adapter");
  assert.equal(adapter.parser, "result-xlsx-parser");

  const templateResponse = await fetch(`${baseUrl}/api/domains/BI/startup-template`);
  assert.equal(templateResponse.ok, true);
  const template = await templateResponse.text();
  assert.match(template, /Galaxy BI UAT Startup Prompt/);
};

const verifyToolResponseRoundtrip = async (baseUrl: string): Promise<void> => {
  const run = await postJson<{ id: string; status: string }>(baseUrl, "/api/runs", {
    domain: "BI",
    roundId: "ROUNDTRIP-001",
    location: "數據中心",
    featureMain: "BI工具",
    featureSub: "agent roundtrip smoke",
    runName: "Agent Roundtrip Smoke",
    devUrl: "https://example.com",
    executionMode: "interactive"
  });
  assert.equal(run.status, "READY");

  await assert.rejects(
    () => postJson(baseUrl, "/api/agents/tokens", { deviceName: "Unauthorized Agent" }),
    /UNAUTHORIZED_AGENT_BOOTSTRAP/,
    "agent token creation should require bootstrap authorization"
  );

  const token = await postBootstrapJson<{ token: string }>(baseUrl, "/api/agents/tokens", { deviceName: "Roundtrip Agent" });
  assert.ok(token.token, "agent token should be returned once");

  const wsUrl = baseUrl.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsUrl}/agent-ws`, {
    headers: { Authorization: `Bearer ${token.token}` }
  });
  const received: JsonObject[] = [];
  let seq = 1;
  const send = (type: string, payload: JsonObject, ackRequired = false): void => {
    ws.send(JSON.stringify({
      id: `msg_roundtrip_${seq}`,
      seq: seq++,
      type,
      timestamp: new Date().toISOString(),
      ack_required: ackRequired,
      payload
    }));
  };

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("tool_response not received")), 5_000);

    ws.on("open", () => {
      send("agent.online", {
        device_name: "Roundtrip Agent",
        agent_version: "smoke",
        status: "busy",
        current_run_id: run.id
      });
      setTimeout(() => {
        send("run.tool_request", {
          run_id: run.id,
          request_id: "roundtrip-req-1",
          request: {
            type: "irreversible_operation",
            request_id: "roundtrip-req-1",
            case: "A-01",
            action: "Delete temporary report",
            reason: "Roundtrip smoke"
          },
          raw: "{}"
        }, true);
      }, 100);
    });

    ws.on("message", async (raw) => {
      const message = JSON.parse(String(raw)) as JsonObject;
      received.push(message);
      if (message.ack_required) {
        send("ack", { in_reply_to: message.id as string });
      }

      if (message.type === "tool_response") {
        clearTimeout(timer);
        resolve();
      }
    });
    ws.on("error", reject);

    setTimeout(async () => {
      const approvals = await requestJson<{ items: Array<{ case_no: string; step_no: number; reason: string }> }>(
        baseUrl,
        `/api/runs/${run.id}/approvals?status=PENDING`
      );
      assert.equal(approvals.items.length, 1, "tool request should create one pending approval");
      assert.match(approvals.items[0]?.reason ?? "", /request_id: roundtrip-req-1/);
      await postJson(baseUrl, `/api/runs/${run.id}/approve`, {
        caseNo: approvals.items[0].case_no,
        stepNo: approvals.items[0].step_no,
        action: "continue",
        resolvedBy: "roundtrip"
      });
    }, 500);
  });

  const toolResponse = received.find((message) => message.type === "tool_response") as { payload?: JsonObject } | undefined;
  assert.equal(toolResponse?.payload?.request_id, "roundtrip-req-1");
  assert.equal(toolResponse?.payload?.approved, true);

  const summary = await requestJson<{ runStatus: string; pendingApprovals: number }>(baseUrl, `/api/runs/${run.id}/summary`);
  assert.equal(summary.runStatus, "RUNNING");
  assert.equal(summary.pendingApprovals, 0);

  ws.close();
};

const verifyAgentDisconnectMarksRunFailed = async (baseUrl: string): Promise<void> => {
  const run = await postJson<{ id: string; status: string }>(baseUrl, "/api/runs", {
    domain: "BI",
    roundId: "ROUNDTRIP-DISCONNECT-001",
    location: "數據中心",
    featureMain: "BI工具",
    featureSub: "agent disconnect smoke",
    runName: "Agent Disconnect Smoke",
    devUrl: "https://example.com",
    executionMode: "interactive"
  });
  assert.equal(run.status, "READY");

  const token = await postBootstrapJson<{ token: string }>(baseUrl, "/api/agents/tokens", { deviceName: "Disconnect Agent" });
  const wsUrl = baseUrl.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsUrl}/agent-ws`, {
    headers: { Authorization: `Bearer ${token.token}` }
  });
  let seq = 1;
  const send = (type: string, payload: JsonObject, ackRequired = false): void => {
    ws.send(JSON.stringify({
      id: `msg_disconnect_${seq}`,
      seq: seq++,
      type,
      timestamp: new Date().toISOString(),
      ack_required: ackRequired,
      payload
    }));
  };

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  send("agent.online", {
    device_name: "Disconnect Agent",
    agent_version: "smoke",
    status: "busy",
    current_run_id: run.id
  });
  send("run.started", { run_id: run.id });
  await waitForRunStatus(baseUrl, run.id, "RUNNING");

  await new Promise<void>((resolve) => {
    ws.once("close", () => resolve());
    ws.close(4000, "roundtrip disconnect smoke");
  });
  await waitForRunStatus(baseUrl, run.id, "FAILED");

  const events = await requestJson<{ items: Array<{ event_type: string; payload: unknown }> }>(
    baseUrl,
    `/api/runs/${run.id}/events?limit=50`
  );
  assert.ok(events.items.some((event) => {
    const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? event.payload as Record<string, unknown>
      : {};
    return event.event_type === "run.interrupted" && payload.reason === "agent_lost";
  }), "agent disconnect should insert run.interrupted event");

  const logs = await requestJson<{ items: Array<{ message: string; level: string }> }>(
    baseUrl,
    `/api/runs/${run.id}/logs?limit=50`
  );
  assert.ok(logs.items.some((log) => (
    log.level === "ERROR" && log.message === "Agent disconnected during active run"
  )), "agent disconnect should insert an ERROR log");
};

const verifyAgentHeartbeatTimeoutMarksRunFailed = async (baseUrl: string): Promise<void> => {
  const run = await postJson<{ id: string; status: string }>(baseUrl, "/api/runs", {
    domain: "BI",
    roundId: "ROUNDTRIP-STALE-001",
    location: "數據中心",
    featureMain: "BI工具",
    featureSub: "agent heartbeat timeout smoke",
    runName: "Agent Heartbeat Timeout Smoke",
    devUrl: "https://example.com",
    executionMode: "interactive"
  });
  assert.equal(run.status, "READY");

  const token = await postBootstrapJson<{ token: string }>(baseUrl, "/api/agents/tokens", { deviceName: "Stale Agent" });
  const wsUrl = baseUrl.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsUrl}/agent-ws`, {
    headers: { Authorization: `Bearer ${token.token}` }
  });
  let seq = 1;
  const send = (type: string, payload: JsonObject, ackRequired = false): void => {
    ws.send(JSON.stringify({
      id: `msg_stale_${seq}`,
      seq: seq++,
      type,
      timestamp: new Date().toISOString(),
      ack_required: ackRequired,
      payload
    }));
  };

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  send("agent.online", {
    device_name: "Stale Agent",
    agent_version: "smoke",
    status: "busy",
    current_run_id: run.id
  });
  send("run.started", { run_id: run.id });
  await waitForRunStatus(baseUrl, run.id, "RUNNING");
  await waitForRunStatus(baseUrl, run.id, "FAILED");

  const events = await requestJson<{ items: Array<{ event_type: string; payload: unknown }> }>(
    baseUrl,
    `/api/runs/${run.id}/events?limit=50`
  );
  assert.ok(events.items.some((event) => {
    const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? event.payload as Record<string, unknown>
      : {};
    return event.event_type === "run.interrupted" && payload.reason === "agent_lost" && payload.closeReason === "heartbeat_timeout";
  }), "heartbeat timeout should insert run.interrupted event");

  const agents = await requestJson<{ items: Array<{ deviceName: string }> }>(baseUrl, "/api/agents");
  assert.equal(agents.items.some((agent) => agent.deviceName === "Stale Agent"), false);

  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close();
  }
};

const verifyAgentRunSnapshotIsRecorded = async (baseUrl: string): Promise<void> => {
  const run = await postJson<{ id: string; status: string }>(baseUrl, "/api/runs", {
    domain: "BI",
    roundId: "ROUNDTRIP-SNAPSHOT-001",
    location: "數據中心",
    featureMain: "BI工具",
    featureSub: "agent reconnect snapshot smoke",
    runName: "Agent Reconnect Snapshot Smoke",
    devUrl: "https://example.com",
    executionMode: "interactive"
  });
  assert.equal(run.status, "READY");

  const token = await postBootstrapJson<{ token: string }>(baseUrl, "/api/agents/tokens", { deviceName: "Snapshot Agent" });
  const wsUrl = baseUrl.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsUrl}/agent-ws`, {
    headers: { Authorization: `Bearer ${token.token}` }
  });
  let seq = 1;
  const send = (type: string, payload: JsonObject, ackRequired = false): void => {
    ws.send(JSON.stringify({
      id: `msg_snapshot_${seq}`,
      seq: seq++,
      type,
      timestamp: new Date().toISOString(),
      ack_required: ackRequired,
      payload
    }));
  };

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  send("agent.online", {
    device_name: "Snapshot Agent",
    agent_version: "smoke",
    status: "idle",
    current_run_id: null,
    run_snapshot: {
      run_id: run.id,
      status: "waiting_user",
      thread_id: "thread_snapshot_smoke",
      tool_request_count: 1,
      state_path: "/tmp/uat-agent/snapshot/state.json"
    }
  });
  await sleep(300);

  const events = await requestJson<{ items: Array<{ event_type: string; payload: unknown }> }>(
    baseUrl,
    `/api/runs/${run.id}/events?limit=50`
  );
  assert.ok(events.items.some((event) => {
    const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? event.payload as Record<string, unknown>
      : {};
    const snapshot = payload.snapshot && typeof payload.snapshot === "object" && !Array.isArray(payload.snapshot)
      ? payload.snapshot as Record<string, unknown>
      : {};
    return event.event_type === "agent.run_snapshot" && snapshot.thread_id === "thread_snapshot_smoke";
  }), "agent.online run_snapshot should be recorded as run event");

  const logs = await requestJson<{ items: Array<{ message: string; level: string }> }>(
    baseUrl,
    `/api/runs/${run.id}/logs?limit=50`
  );
  assert.ok(logs.items.some((log) => (
    log.level === "WARN" && log.message === "Agent reported local run snapshot on reconnect"
  )), "agent.online run_snapshot should be recorded as run log");

  ws.close();
};

const main = async (): Promise<void> => {
  const { child, baseUrl, tempDir } = await startServer();
  try {
    await verifyDomainPackEndpoints(baseUrl);
    await verifyToolResponseRoundtrip(baseUrl);
    await verifyAgentDisconnectMarksRunFailed(baseUrl);
    await verifyAgentHeartbeatTimeoutMarksRunFailed(baseUrl);
    await verifyAgentRunSnapshotIsRecorded(baseUrl);
    console.log("Agent roundtrip smoke passed.");
  } finally {
    await stopServer(child);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
