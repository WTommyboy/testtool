import { randomUUID } from "node:crypto";
import { db } from "../db";
import type { AgentMessage } from "../agent-protocol/messages";
import { insertRunEvent } from "../run-events";
import { agentRegistry, type AgentDisconnectEvent } from "./agent-registry";

let registered = false;

const nowIso = (): string => new Date().toISOString();

const getRunId = (message: AgentMessage): string | null => {
  const runId = message.payload.run_id;
  return typeof runId === "string" && runId.trim() ? runId : null;
};

const runExists = (runId: string): boolean => {
  const row = db.prepare("SELECT id FROM runs WHERE id = ?").get(runId) as { id: string } | undefined;
  return Boolean(row);
};

const getRunStatus = (runId: string): string | null => {
  const row = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string } | undefined;
  return row?.status ?? null;
};

const isTerminalStatus = (status: string | null): boolean => {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
};

const insertRunLog = (
  runId: string,
  level: "INFO" | "WARN" | "ERROR",
  message: string,
  context?: Record<string, unknown>
): void => {
  db.prepare(
    `
      INSERT INTO run_logs (id, run_id, level, message, context_json, created_at)
      VALUES (@id, @run_id, @level, @message, @context_json, @created_at)
    `
  ).run({
    id: randomUUID(),
    run_id: runId,
    level,
    message,
    context_json: context ? JSON.stringify(context) : null,
    created_at: nowIso()
  });
};

const asString = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

const getToolRequest = (message: AgentMessage): Record<string, unknown> => {
  const request = message.payload.request;
  return request && typeof request === "object" && !Array.isArray(request) ? request as Record<string, unknown> : {};
};

const formatToolRequestReason = (message: AgentMessage): string => {
  const request = getToolRequest(message);
  const type = asString(request.type) ?? "tool_request";
  const requestId = asString(request.request_id) ?? asString(message.payload.request_id) ?? "unknown";
  const action = asString(request.action) ?? asString(request.proposed_action) ?? asString(request.context) ?? "PM action required";
  const reason = asString(request.reason) ?? asString(request.error) ?? asString(request.recommendation);
  return [
    `TOOL_REQUEST ${type}: ${action}`,
    `request_id: ${requestId}`,
    reason ? `reason: ${reason}` : null
  ].filter(Boolean).join("\n");
};

const insertToolRequestApproval = (runId: string, message: AgentMessage): void => {
  const now = nowIso();
  const request = getToolRequest(message);
  const caseNo = asString(request.case) ?? "TOOL_REQUEST";
  const requestId = asString(request.request_id) ?? asString(message.payload.request_id) ?? message.id;
  const existing = db
    .prepare("SELECT id FROM approvals WHERE run_id = ? AND reason LIKE ? AND status = 'PENDING'")
    .get(runId, `%request_id: ${requestId}%`) as { id: string } | undefined;
  if (existing) return;

  db.prepare(
    `
      INSERT INTO approvals (
        id, run_id, case_no, step_no, reason, status, snapshot_path, created_at
      ) VALUES (
        @id, @run_id, @case_no, @step_no, @reason, 'PENDING', NULL, @created_at
      )
    `
  ).run({
    id: randomUUID(),
    run_id: runId,
    case_no: caseNo,
    step_no: 0,
    reason: formatToolRequestReason(message),
    created_at: now
  });
};

const setRunStatus = (runId: string, status: string): void => {
  const now = nowIso();
  db.prepare("UPDATE runs SET status = ?, updated_at = ? WHERE id = ?").run(status, now, runId);
  if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(status)) {
    db.prepare("UPDATE runs SET finished_at = ?, updated_at = ? WHERE id = ?").run(now, now, runId);
  }
};

const textFromPayload = (message: AgentMessage): string => {
  const text = message.payload.text ?? message.payload.line ?? message.payload.message;
  return typeof text === "string" ? text : JSON.stringify(message.payload);
};

const handleAgentRunMessage = (agentId: string, message: AgentMessage): void => {
  const runId = getRunId(message);
  if (!runId || !runExists(runId)) return;

  if (message.type === "run.started") {
    setRunStatus(runId, "RUNNING");
    insertRunEvent(runId, "run.started", { agentId, payload: message.payload }, message.seq);
    insertRunLog(runId, "INFO", "Agent run started", { agentId, payload: message.payload });
    return;
  }

  if (message.type === "run.stdout") {
    insertRunEvent(runId, "run.stdout", { agentId, text: textFromPayload(message) }, message.seq);
    insertRunLog(runId, "INFO", textFromPayload(message), { agentId, type: message.type });
    return;
  }

  if (message.type === "run.stderr") {
    insertRunEvent(runId, "run.stderr", { agentId, text: textFromPayload(message) }, message.seq);
    insertRunLog(runId, "WARN", textFromPayload(message), { agentId, type: message.type });
    return;
  }

  if (message.type === "run.tool_request") {
    setRunStatus(runId, "WAITING_APPROVAL");
    insertToolRequestApproval(runId, message);
    insertRunEvent(runId, "tool_request.created", { agentId, payload: message.payload }, message.seq);
    insertRunLog(runId, "WARN", "Agent requested PM action", { agentId, payload: message.payload });
    return;
  }

  if (message.type === "tool_response.delivered") {
    const currentStatus = getRunStatus(runId);
    if (!isTerminalStatus(currentStatus)) {
      setRunStatus(runId, "RUNNING");
    }
    insertRunEvent(runId, "tool_response.delivered", { agentId, payload: message.payload, currentStatus }, message.seq);
    insertRunLog(runId, "INFO", "Tool response delivered to Agent", { agentId, payload: message.payload, currentStatus });
    return;
  }

  if (message.type === "run.uploading_result") {
    insertRunEvent(runId, "result.upload_started", { agentId, payload: message.payload }, message.seq);
    insertRunLog(runId, "INFO", "Agent uploading result", { agentId, payload: message.payload });
    return;
  }

  if (message.type === "run.completed") {
    const currentStatus = getRunStatus(runId);
    if (!isTerminalStatus(currentStatus)) {
      setRunStatus(runId, "SUCCEEDED");
    }
    insertRunEvent(runId, "run.completed", { agentId, payload: message.payload, currentStatus }, message.seq);
    insertRunLog(runId, "INFO", "Agent run completed", { agentId, payload: message.payload, currentStatus });
    return;
  }

  if (message.type === "run.cancelled") {
    setRunStatus(runId, "CANCELLED");
    insertRunEvent(runId, "run.interrupted", { agentId, reason: "agent_cancelled", payload: message.payload }, message.seq);
    insertRunLog(runId, "WARN", "Agent run cancelled", { agentId, payload: message.payload });
    return;
  }

  if (message.type === "run.failed" || message.type === "run.rejected") {
    const currentStatus = getRunStatus(runId);
    if (!isTerminalStatus(currentStatus)) {
      setRunStatus(runId, "FAILED");
    }
    insertRunEvent(runId, "run.failed", { agentId, type: message.type, payload: message.payload, currentStatus }, message.seq);
    insertRunLog(runId, "ERROR", "Agent run failed", { agentId, type: message.type, payload: message.payload, currentStatus });
  }
};

const handleAgentDisconnect = (event: AgentDisconnectEvent): void => {
  const runId = event.agent.currentRunId;
  if (!runId || !runExists(runId)) return;

  const currentStatus = getRunStatus(runId);
  if (isTerminalStatus(currentStatus)) return;

  setRunStatus(runId, "FAILED");
  insertRunEvent(runId, "run.interrupted", {
    agentId: event.agentId,
    deviceName: event.agent.deviceName,
    reason: "agent_lost",
    closeCode: event.code,
    closeReason: event.reason,
    previousStatus: currentStatus,
    agentStatus: event.agent.status
  });
  insertRunLog(runId, "ERROR", "Agent disconnected during active run", {
    agentId: event.agentId,
    deviceName: event.agent.deviceName,
    reason: "agent_lost",
    closeCode: event.code,
    closeReason: event.reason,
    previousStatus: currentStatus,
    agentStatus: event.agent.status
  });
};

export const registerAgentRunEventHandlers = (): void => {
  if (registered) return;
  registered = true;
  agentRegistry.onMessage(({ agentId, message }) => {
    try {
      handleAgentRunMessage(agentId, message);
    } catch (error) {
      // Agent events must not crash the WebSocket server.
      const runId = getRunId(message);
      if (runId && runExists(runId)) {
        insertRunLog(runId, "ERROR", "Agent event handling failed", {
          agentId,
          type: message.type,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  });
  agentRegistry.onDisconnect((event) => {
    try {
      handleAgentDisconnect(event);
    } catch (error) {
      const runId = event.agent.currentRunId;
      if (runId && runExists(runId)) {
        insertRunLog(runId, "ERROR", "Agent disconnect handling failed", {
          agentId: event.agentId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  });
};
