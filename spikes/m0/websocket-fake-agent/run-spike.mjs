#!/usr/bin/env node
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import WebSocket, { WebSocketServer } from "ws";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const spikeRoot = path.join(repoRoot, "spikes", "m0", "websocket-fake-agent");
const outputRoot = path.join(spikeRoot, "output");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(outputRoot, runId);
const validToken = "uatagt_m0_secret";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node spikes/m0/websocket-fake-agent/run-spike.mjs");
  console.log("Runs the M0-3 WebSocket fake agent spike.");
  process.exit(0);
}

fs.mkdirSync(runDir, { recursive: true });

function writeJson(name, value) {
  fs.writeFileSync(path.join(runDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function envelope(type, payload = {}, options = {}) {
  return {
    id: options.id || `msg_${crypto.randomUUID()}`,
    seq: options.seq || 0,
    type,
    timestamp: new Date().toISOString(),
    ack_required: Boolean(options.ack_required),
    payload
  };
}

function waitFor(name, predicate, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${name}`));
      }
    }, 25);
  });
}

class FakeRailwayServer extends EventEmitter {
  constructor() {
    super();
    this.events = [];
    this.pendingAcks = new Map();
    this.inboundIds = new Set();
    this.duplicateInboundIds = [];
    this.runStatus = new Map();
    this.connections = new Set();
    this.seq = 1;
    this.currentRunBySocket = new WeakMap();
    this.httpServer = http.createServer();
    this.wss = new WebSocketServer({ noServer: true });
  }

  async start() {
    this.httpServer.on("upgrade", (request, socket, head) => {
      const auth = request.headers.authorization || "";
      if (auth !== `Bearer ${validToken}`) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        this.events.push({ type: "auth.rejected" });
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit("connection", ws, request);
      });
    });

    this.wss.on("connection", (ws, request) => {
      this.connections.add(ws);
      this.events.push({
        type: "agent.connected",
        device: request.headers["x-device-name"],
        version: request.headers["x-agent-version"]
      });
      ws.on("message", (data) => this.handleMessage(ws, data.toString("utf8")));
      ws.on("close", () => {
        this.connections.delete(ws);
        const currentRunId = this.currentRunBySocket.get(ws);
        if (currentRunId && this.runStatus.get(currentRunId) === "AGENT_RUNNING") {
          this.runStatus.set(currentRunId, "AGENT_LOST");
          this.events.push({ type: "run.agent_lost", run_id: currentRunId });
        }
        this.events.push({ type: "agent.disconnected" });
      });
    });

    await new Promise((resolve) => this.httpServer.listen(0, "127.0.0.1", resolve));
    const address = this.httpServer.address();
    this.url = `ws://127.0.0.1:${address.port}/agent-ws`;
    return this.url;
  }

  handleMessage(ws, raw) {
    const message = JSON.parse(raw);
    if (this.inboundIds.has(message.id)) {
      this.duplicateInboundIds.push(message.id);
      this.events.push({ type: "dedupe.inbound_duplicate", message_id: message.id });
      if (message.ack_required) this.sendAck(ws, message.id);
      return;
    }
    this.inboundIds.add(message.id);
    this.events.push({ type: message.type, payload: message.payload, message_id: message.id });

    if (message.ack_required) this.sendAck(ws, message.id);
    if (message.type === "ack") {
      this.pendingAcks.delete(message.payload.in_reply_to);
    }
    if (message.type === "run.started") {
      this.currentRunBySocket.set(ws, message.payload.run_id);
      this.runStatus.set(message.payload.run_id, "AGENT_RUNNING");
    }
    if (message.type === "run.completed") {
      this.runStatus.set(message.payload.run_id, "COMPLETED");
      this.currentRunBySocket.delete(ws);
    }
  }

  sendAck(ws, inReplyTo) {
    ws.send(
      JSON.stringify(
        envelope("ack", {
          in_reply_to: inReplyTo
        })
      )
    );
  }

  send(ws, type, payload = {}, options = {}) {
    const message = envelope(type, payload, {
      ...options,
      seq: this.seq++
    });
    if (message.ack_required) this.pendingAcks.set(message.id, message);
    ws.send(JSON.stringify(message));
    this.events.push({ type: `server.${type}`, payload, message_id: message.id });
    return message;
  }

  latestConnection() {
    return [...this.connections].at(-1);
  }

  async close() {
    for (const ws of this.connections) ws.close();
    this.wss.close();
    await new Promise((resolve) => this.httpServer.close(resolve));
  }
}

class FakeAgent {
  constructor(serverUrl, token = validToken) {
    this.serverUrl = serverUrl;
    this.token = token;
    this.events = [];
    this.seq = 1;
    this.seenInboundIds = new Set();
    this.completedRunIds = new Set();
  }

  connect() {
    this.ws = new WebSocket(this.serverUrl, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        "X-Agent-Version": "0.1.0-spike",
        "X-Device-Name": "M0 Fake Agent"
      }
    });
    this.ws.on("open", () => {
      this.events.push({ type: "open" });
      this.send("agent.online", {
        device_name: "M0 Fake Agent",
        agent_version: "0.1.0-spike",
        platform: `${os.platform()}-${os.arch()}`,
        codex_version: "fake-codex",
        node_version: process.version,
        supported_task_types: ["uat_run"],
        supported_execution_modes: ["interactive"],
        tool_bridge_versions: ["spike-v1"],
        playwright_mcp_available: true,
        chrome_profile_ready: true,
        current_run_id: null
      }, { ack_required: true });
    });
    this.ws.on("message", (data) => this.handleMessage(data.toString("utf8")));
    this.ws.on("close", () => this.events.push({ type: "close" }));
    return this;
  }

  waitOpen() {
    return new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("unexpected-response", (_request, response) => reject(new Error(`unexpected ${response.statusCode}`)));
      this.ws.once("error", reject);
    });
  }

  send(type, payload = {}, options = {}) {
    const message = envelope(type, payload, {
      ...options,
      seq: this.seq++
    });
    this.ws.send(JSON.stringify(message));
    this.events.push({ type: `sent.${type}`, payload, message_id: message.id });
    return message;
  }

  handleMessage(raw) {
    const message = JSON.parse(raw);
    if (this.seenInboundIds.has(message.id)) {
      this.events.push({ type: "dedupe.dispatch_duplicate", message_id: message.id });
      if (message.ack_required) this.send("ack", { in_reply_to: message.id });
      return;
    }
    this.seenInboundIds.add(message.id);
    this.events.push({ type: message.type, payload: message.payload, message_id: message.id });

    if (message.ack_required) this.send("ack", { in_reply_to: message.id });
    if (message.type === "task.dispatch") {
      this.handleTaskDispatch(message.payload);
    }
  }

  handleTaskDispatch(payload) {
    if (this.completedRunIds.has(payload.run_id)) {
      this.events.push({ type: "task.skipped_completed_duplicate", run_id: payload.run_id });
      return;
    }
    this.send("run.started", { run_id: payload.run_id, started_at: new Date().toISOString() }, { ack_required: true });
    if (payload.simulate_disconnect_before_complete) {
      this.events.push({ type: "simulated_drop", run_id: payload.run_id });
      this.ws.close();
      return;
    }
    this.send("agent.heartbeat", { status: "busy", current_run_id: payload.run_id });
    this.send("run.stdout", { run_id: payload.run_id, stream: "stdout", line: "fake case passed" });
    this.send("run.completed", { run_id: payload.run_id, result: "PASS" }, { ack_required: true });
    this.completedRunIds.add(payload.run_id);
  }
}

async function expectBadTokenRejected(url) {
  const agent = new FakeAgent(url, "bad_token").connect();
  try {
    await agent.waitOpen();
    return { verdict: "FAIL", reason: "bad token unexpectedly opened" };
  } catch (error) {
    return { verdict: String(error).includes("401") ? "PASS" : "FAIL", error: String(error) };
  }
}

async function main() {
  const server = new FakeRailwayServer();
  const url = await server.start();
  const badToken = await expectBadTokenRejected(url);

  const agent = new FakeAgent(url).connect();
  await agent.waitOpen();
  await waitFor("agent.online", () => server.events.some((event) => event.type === "agent.online"));

  const ws = server.latestConnection();
  const firstDispatch = server.send(
    ws,
    "task.dispatch",
    { run_id: "run_m0_1", domain: "BI", round_id: "M0", input_urls: {} },
    { ack_required: true }
  );
  ws.send(JSON.stringify(firstDispatch));
  await waitFor("run_m0_1 completed", () => server.runStatus.get("run_m0_1") === "COMPLETED");

  const duplicateDispatchCount = agent.events.filter((event) => event.type === "dedupe.dispatch_duplicate").length;
  const run1StartedCount = server.events.filter((event) => event.type === "run.started" && event.payload.run_id === "run_m0_1").length;

  const secondDispatch = server.send(
    ws,
    "task.dispatch",
    {
      run_id: "run_m0_2",
      domain: "BI",
      round_id: "M0",
      input_urls: {},
      simulate_disconnect_before_complete: true
    },
    { ack_required: true }
  );
  await waitFor("run_m0_2 agent lost", () => server.runStatus.get("run_m0_2") === "AGENT_LOST");

  const reconnectedAgent = new FakeAgent(url).connect();
  await reconnectedAgent.waitOpen();
  await waitFor("reconnected agent.online", () => server.events.filter((event) => event.type === "agent.online").length >= 2);
  const reconnectedWs = server.latestConnection();
  server.send(
    reconnectedWs,
    "task.dispatch",
    { run_id: "run_m0_2", domain: "BI", round_id: "M0", input_urls: {}, retry_of: secondDispatch.id },
    { ack_required: true }
  );
  await waitFor("run_m0_2 completed after reconnect", () => server.runStatus.get("run_m0_2") === "COMPLETED");

  await waitFor("acks drained", () => server.pendingAcks.size === 0);

  const summary = {
    environment: {
      runId,
      repoRoot,
      spikeRoot,
      runDir,
      node: process.version,
      platform: `${os.platform()}-${os.arch()}`,
      wsUrl: url
    },
    checks: {
      badTokenRejected: badToken.verdict === "PASS",
      agentOnline: server.events.some((event) => event.type === "agent.online"),
      heartbeat: server.events.some((event) => event.type === "agent.heartbeat"),
      taskDispatchAcked: !server.pendingAcks.has(firstDispatch.id),
      runCompleted: server.runStatus.get("run_m0_1") === "COMPLETED",
      duplicateDispatchDeduped: duplicateDispatchCount >= 1 && run1StartedCount === 1,
      agentLostOnDisconnect: server.events.some((event) => event.type === "run.agent_lost" && event.run_id === "run_m0_2"),
      reconnectCompleted: server.runStatus.get("run_m0_2") === "COMPLETED",
      pendingAcksDrained: server.pendingAcks.size === 0
    },
    counts: {
      serverEvents: server.events.length,
      agentEvents: agent.events.length,
      reconnectedAgentEvents: reconnectedAgent.events.length,
      duplicateDispatchCount,
      run1StartedCount
    },
    badToken,
    verdict: "PENDING"
  };
  summary.verdict = Object.values(summary.checks).every(Boolean) ? "PASS" : "FAIL";

  writeJson("summary.json", summary);
  writeJson("server-events.json", server.events);
  writeJson("agent-events.json", { first: agent.events, second: reconnectedAgent.events });
  console.log(JSON.stringify(summary, null, 2));

  await server.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
