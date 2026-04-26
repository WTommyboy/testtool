#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { PGlite } from "@electric-sql/pglite";
import WebSocket, { WebSocketServer } from "ws";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const spikeRoot = path.join(repoRoot, "spikes", "m0", "e2e-fake");
const outputRoot = path.join(spikeRoot, "output");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(outputRoot, runId);
const validToken = "uatagt_m0_secret";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node spikes/m0/e2e-fake/run-spike.mjs");
  console.log("Runs a local M0-7 fake Web/API/WebSocket/Agent/Codex/result.xlsx E2E flow.");
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

function waitFor(name, predicate, timeoutMs = 8_000) {
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

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function createResultXlsx(filePath) {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("索引").addRows([
    ["xlsx_schema_version", "bi-result-v1"],
    ["parser_version", "m0-e2e-result-parser-v1"]
  ]);
  const cases = workbook.addWorksheet("測試案例");
  cases.addRow(["群組", "編號", "測試項目", "測試類型", "執行方式", "結果", "失敗分類", "詳細紀錄JSON"]);
  cases.addRow([
    "A",
    "A-01",
    "Fake E2E case",
    "功能流程",
    "interactive",
    "PASS",
    "",
    JSON.stringify({ 測試目的: "M0-7 fake E2E", 實際行為: "fake Codex completed after tool response" })
  ]);
  const bugs = workbook.addWorksheet("Bug");
  bugs.addRow(["嚴重度", "Bug ID", "關聯編號", "標題", "描述", "建議", "狀態"]);
  await workbook.xlsx.writeFile(filePath);
}

function extractText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return String(value).trim();
}

async function parseResultXlsx(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet("測試案例");
  const rows = [];
  for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    const caseNo = extractText(row.getCell(2).value);
    if (!caseNo) continue;
    rows.push({
      group_name: extractText(row.getCell(1).value),
      case_no: caseNo,
      case_title: extractText(row.getCell(3).value),
      test_type: extractText(row.getCell(4).value),
      execution_method: extractText(row.getCell(5).value),
      status: extractText(row.getCell(6).value),
      verdict_reason: extractText(row.getCell(7).value),
      detail_json: JSON.parse(extractText(row.getCell(8).value))
    });
  }
  return rows;
}

class FakeHub {
  constructor() {
    this.events = [];
    this.seq = 1;
    this.agent = null;
    this.db = new PGlite(path.join(runDir, "pglite"));
    this.httpServer = http.createServer((request, response) => this.handleHttp(request, response));
    this.wss = new WebSocketServer({ noServer: true });
  }

  async start() {
    await this.db.exec(`
      CREATE TABLE runs (
        id uuid PRIMARY KEY,
        round_id text NOT NULL,
        status text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE run_events (
        id bigserial PRIMARY KEY,
        run_id uuid,
        event_type text NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE run_case_results (
        id bigserial PRIMARY KEY,
        run_id uuid NOT NULL,
        case_no text NOT NULL,
        group_name text,
        case_title text,
        status text NOT NULL,
        detail_json jsonb
      );
    `);

    this.httpServer.on("upgrade", (request, socket, head) => {
      if (request.url !== "/agent-ws" || request.headers.authorization !== `Bearer ${validToken}`) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (ws) => this.wss.emit("connection", ws, request));
    });
    this.wss.on("connection", (ws) => {
      this.agent = ws;
      this.events.push({ type: "agent.connected" });
      ws.on("message", (data) => this.handleAgentMessage(ws, data.toString("utf8")));
    });

    await new Promise((resolve) => this.httpServer.listen(0, "127.0.0.1", resolve));
    const address = this.httpServer.address();
    this.httpUrl = `http://127.0.0.1:${address.port}`;
    this.wsUrl = `ws://127.0.0.1:${address.port}/agent-ws`;
    return { httpUrl: this.httpUrl, wsUrl: this.wsUrl };
  }

  async addEvent(runIdValue, eventType, payload = {}) {
    await this.db.query(`INSERT INTO run_events (run_id, event_type, payload) VALUES ($1,$2,$3::jsonb)`, [
      runIdValue,
      eventType,
      JSON.stringify(payload)
    ]);
    this.events.push({ type: eventType, run_id: runIdValue, payload });
  }

  sendToAgent(type, payload = {}, options = {}) {
    const message = envelope(type, payload, { ...options, seq: this.seq++ });
    this.agent.send(JSON.stringify(message));
    this.events.push({ type: `server.${type}`, payload, message_id: message.id });
    return message;
  }

  async handleAgentMessage(ws, raw) {
    const message = JSON.parse(raw);
    if (message.ack_required) {
      ws.send(JSON.stringify(envelope("ack", { in_reply_to: message.id })));
    }
    this.events.push({ type: message.type, payload: message.payload, message_id: message.id });
    const runIdValue = message.payload?.run_id || null;
    if (runIdValue && message.type !== "ack") await this.addEvent(runIdValue, message.type, message.payload);

    if (message.type === "agent.online") {
      this.events.push({ type: "agent.online.received" });
    }
    if (message.type === "run.started") {
      await this.db.query(`UPDATE runs SET status = 'AGENT_RUNNING' WHERE id = $1`, [message.payload.run_id]);
    }
    if (message.type === "run.tool_request") {
      await this.db.query(`UPDATE runs SET status = 'WAITING_USER' WHERE id = $1`, [message.payload.run_id]);
    }
    if (message.type === "result.uploaded") {
      await this.db.query(`UPDATE runs SET status = 'INGESTING_RESULT' WHERE id = $1`, [message.payload.run_id]);
      await this.addEvent(message.payload.run_id, "result.ingest_started", { path: message.payload.path });
      const cases = await parseResultXlsx(message.payload.path);
      for (const item of cases) {
        await this.db.query(
          `INSERT INTO run_case_results (run_id, case_no, group_name, case_title, status, detail_json)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
          [
            message.payload.run_id,
            item.case_no,
            item.group_name,
            item.case_title,
            item.status,
            JSON.stringify(item.detail_json)
          ]
        );
      }
      await this.addEvent(message.payload.run_id, "result.ingested", { case_count: cases.length });
    }
    if (message.type === "run.completed") {
      await this.db.query(`UPDATE runs SET status = 'COMPLETED' WHERE id = $1`, [message.payload.run_id]);
    }
  }

  async handleHttp(request, response) {
    const url = new URL(request.url, this.httpUrl);
    if (request.method === "POST" && url.pathname === "/api/runs") {
      const body = await readJsonBody(request);
      const id = crypto.randomUUID();
      await this.db.query(`INSERT INTO runs (id, round_id, status) VALUES ($1,$2,'ASSIGNED')`, [id, body.round_id || "M0"]);
      await this.addEvent(id, "run.created", body);
      await waitFor("agent connected before dispatch", () => Boolean(this.agent));
      this.sendToAgent("task.dispatch", { run_id: id, round_id: body.round_id || "M0", startup_instruction: body.startup_instruction }, { ack_required: true });
      await this.addEvent(id, "task.dispatched", { to: "fake-agent" });
      sendJson(response, 201, { id, status: "ASSIGNED" });
      return;
    }
    const toolResponseMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/tool-response$/);
    if (request.method === "POST" && toolResponseMatch) {
      const id = toolResponseMatch[1];
      const body = await readJsonBody(request);
      this.sendToAgent("tool_response", { run_id: id, ...body }, { ack_required: true });
      await this.addEvent(id, "tool_response.sent", body);
      await this.db.query(`UPDATE runs SET status = 'AGENT_RUNNING' WHERE id = $1`, [id]);
      sendJson(response, 200, { ok: true });
      return;
    }
    const summaryMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/summary$/);
    if (request.method === "GET" && summaryMatch) {
      const id = summaryMatch[1];
      const run = await this.db.query(`SELECT id::text, round_id, status FROM runs WHERE id = $1`, [id]);
      const cases = await this.db.query(`SELECT case_no, case_title, status, detail_json FROM run_case_results WHERE run_id = $1 ORDER BY case_no`, [id]);
      const events = await this.db.query(`SELECT event_type, payload FROM run_events WHERE run_id = $1 ORDER BY id`, [id]);
      sendJson(response, 200, { run: run.rows[0], cases: cases.rows, events: events.rows });
      return;
    }
    sendJson(response, 404, { error: "NOT_FOUND" });
  }

  async close() {
    if (this.agent) this.agent.close();
    this.wss.close();
    await this.db.close();
    await new Promise((resolve) => this.httpServer.close(resolve));
  }
}

class FakeAgent {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.seq = 1;
    this.events = [];
  }

  connect() {
    this.ws = new WebSocket(this.wsUrl, {
      headers: {
        Authorization: `Bearer ${validToken}`,
        "X-Agent-Version": "0.1.0-e2e",
        "X-Device-Name": "M0 E2E Fake Agent"
      }
    });
    this.ws.on("open", () => {
      this.send("agent.online", { device_name: "M0 E2E Fake Agent", agent_version: "0.1.0-e2e" }, { ack_required: true });
    });
    this.ws.on("message", (data) => this.handleMessage(data.toString("utf8")));
    return new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve(this));
      this.ws.once("error", reject);
    });
  }

  send(type, payload = {}, options = {}) {
    const message = envelope(type, payload, { ...options, seq: this.seq++ });
    this.ws.send(JSON.stringify(message));
    this.events.push({ type: `sent.${type}`, payload });
    return message;
  }

  async handleMessage(raw) {
    const message = JSON.parse(raw);
    this.events.push({ type: message.type, payload: message.payload });
    if (message.ack_required) this.send("ack", { in_reply_to: message.id });
    if (message.type === "task.dispatch") {
      const runIdValue = message.payload.run_id;
      this.send("run.started", { run_id: runIdValue, started_at: new Date().toISOString() }, { ack_required: true });
      this.send("run.stdout", { run_id: runIdValue, stream: "stdout", line: "fake Codex started" });
      this.send("run.tool_request", {
        run_id: runIdValue,
        request_id: "req_m0_e2e_approval",
        type: "irreversible_operation",
        case: "A-01",
        action: "continue fake E2E",
        reason: "prove tool_response loop"
      }, { ack_required: true });
    }
    if (message.type === "tool_response") {
      const outputPath = path.join(runDir, `result_${message.payload.run_id}.xlsx`);
      await createResultXlsx(outputPath);
      this.send("run.stdout", { run_id: message.payload.run_id, stream: "stdout", line: "fake Codex completed" });
      this.send("result.uploaded", { run_id: message.payload.run_id, path: outputPath }, { ack_required: true });
      this.send("run.completed", { run_id: message.payload.run_id, result: "PASS" }, { ack_required: true });
    }
  }
}

async function main() {
  const hub = new FakeHub();
  const { httpUrl, wsUrl } = await hub.start();
  const agent = new FakeAgent(wsUrl);
  await agent.connect();

  const created = await fetch(`${httpUrl}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ round_id: "M0-E2E", startup_instruction: "fake run" })
  }).then((res) => res.json());
  const runUuid = created.id;

  await waitFor("WAITING_USER", async () => {
    const summary = await fetch(`${httpUrl}/api/runs/${runUuid}/summary`).then((res) => res.json());
    return summary.run?.status === "WAITING_USER";
  });

  await fetch(`${httpUrl}/api/runs/${runUuid}/tool-response`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ request_id: "req_m0_e2e_approval", approved: true, note: "M0 fake approval" })
  });

  await waitFor("COMPLETED", async () => {
    const summary = await fetch(`${httpUrl}/api/runs/${runUuid}/summary`).then((res) => res.json());
    return summary.run?.status === "COMPLETED" && summary.cases?.length === 1;
  });

  const finalSummary = await fetch(`${httpUrl}/api/runs/${runUuid}/summary`).then((res) => res.json());
  const eventTypes = finalSummary.events.map((event) => event.event_type);
  const checks = {
    runCreated: created.status === "ASSIGNED",
    finalStatusCompleted: finalSummary.run.status === "COMPLETED",
    caseVisible: finalSummary.cases.length === 1 && finalSummary.cases[0].case_no === "A-01",
    toolRequestEvent: eventTypes.includes("run.tool_request"),
    toolResponseEvent: eventTypes.includes("tool_response.sent"),
    resultIngestedEvent: eventTypes.includes("result.ingested"),
    completedEvent: eventTypes.includes("run.completed")
  };

  const summary = {
    environment: {
      runId,
      repoRoot,
      spikeRoot,
      runDir,
      node: process.version,
      platform: `${os.platform()}-${os.arch()}`,
      httpUrl,
      wsUrl
    },
    runUuid,
    checks,
    finalSummary,
    hubEvents: hub.events,
    agentEvents: agent.events,
    verdict: Object.values(checks).every(Boolean) ? "PASS" : "FAIL"
  };
  writeJson("summary.json", summary);
  console.log(JSON.stringify(summary, null, 2));
  await hub.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
