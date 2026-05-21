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

const getAutoApproval = (message: AgentMessage): Record<string, unknown> | null => {
  const autoApproval = message.payload.auto_approval;
  return autoApproval && typeof autoApproval === "object" && !Array.isArray(autoApproval)
    ? autoApproval as Record<string, unknown>
    : null;
};

const getRunSnapshot = (message: AgentMessage): Record<string, unknown> | null => {
  const snapshot = message.payload.run_snapshot;
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? snapshot as Record<string, unknown>
    : null;
};

const getRunIdFromSnapshot = (snapshot: Record<string, unknown> | null): string | null => {
  const runId = snapshot?.run_id;
  return typeof runId === "string" && runId.trim() ? runId : null;
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

const insertToolRequestApproval = (runId: string, message: AgentMessage): { autoApproved: boolean; requestId: string } => {
  const now = nowIso();
  const request = getToolRequest(message);
  const autoApproval = getAutoApproval(message);
  const autoApproved = autoApproval?.approved === true;
  const caseNo = asString(request.case) ?? "TOOL_REQUEST";
  const requestId = asString(request.request_id) ?? asString(message.payload.request_id) ?? message.id;
  const existing = db
    .prepare("SELECT id FROM approvals WHERE run_id = ? AND reason LIKE ? AND status IN ('PENDING', 'APPROVED')")
    .get(runId, `%request_id: ${requestId}%`) as { id: string } | undefined;
  if (existing) return { autoApproved, requestId };

  db.prepare(
    `
      INSERT INTO approvals (
        id, run_id, case_no, step_no, reason, status, snapshot_path, created_at, resolved_at, resolved_by, resolution_note
      ) VALUES (
        @id, @run_id, @case_no, @step_no, @reason, @status, NULL, @created_at, @resolved_at, @resolved_by, @resolution_note
      )
    `
  ).run({
    id: randomUUID(),
    run_id: runId,
    case_no: caseNo,
    step_no: 0,
    reason: formatToolRequestReason(message),
    status: autoApproved ? "APPROVED" : "PENDING",
    created_at: now,
    resolved_at: autoApproved ? now : null,
    resolved_by: autoApproved ? asString(autoApproval?.resolved_by) ?? "mac_agent_auto_policy" : null,
    resolution_note: autoApproved ? asString(autoApproval?.note) ?? "Auto-approved by Mac Agent." : null
  });
  return { autoApproved, requestId };
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
  if (message.type === "agent.online") {
    const snapshot = getRunSnapshot(message);
    const snapshotRunId = getRunIdFromSnapshot(snapshot);
    if (!snapshot || !snapshotRunId || !runExists(snapshotRunId)) return;

    const currentStatus = getRunStatus(snapshotRunId);
    insertRunEvent(snapshotRunId, "agent.run_snapshot", {
      agentId,
      snapshot,
      currentStatus
    }, message.seq);
    insertRunLog(snapshotRunId, "WARN", "Agent reported local run snapshot on reconnect", {
      agentId,
      snapshot,
      currentStatus
    });
    if (isTerminalStatus(currentStatus)) {
      try {
        const cancelMessage = agentRegistry.send(
          agentId,
          "task.cancel",
          {
            run_id: snapshotRunId,
            reason: `remote_run_${String(currentStatus).toLowerCase()}`
          },
          true
        );
        insertRunEvent(snapshotRunId, "task.cancelled", {
          agentId,
          reason: "remote_run_terminal_snapshot",
          currentStatus,
          messageId: cancelMessage.id
        }, cancelMessage.seq);
        insertRunLog(snapshotRunId, "WARN", "Cancel dispatched for terminal run snapshot", {
          agentId,
          currentStatus,
          messageId: cancelMessage.id
        });
      } catch (error) {
        insertRunLog(snapshotRunId, "ERROR", "Cancel dispatch for terminal run snapshot failed", {
          agentId,
          currentStatus,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return;
  }

  const runId = getRunId(message);
  if (!runId || !runExists(runId)) return;

  if (message.type === "run.started") {
    const currentStatus = getRunStatus(runId);
    if (!isTerminalStatus(currentStatus)) {
      setRunStatus(runId, "RUNNING");
    }
    insertRunEvent(runId, "run.started", { agentId, payload: message.payload, currentStatus }, message.seq);
    insertRunLog(runId, "INFO", "Agent run started", { agentId, payload: message.payload, currentStatus });
    return;
  }

  if (message.type === "run.stdout") {
    insertRunEvent(runId, "run.stdout", { agentId, text: textFromPayload(message) }, message.seq);
    insertRunLog(runId, "INFO", textFromPayload(message), { agentId, type: message.type });
    return;
  }

  if (message.type === "run.progress") {
    insertRunEvent(runId, "run.progress", { agentId, payload: message.payload, text: textFromPayload(message) }, message.seq);
    insertRunLog(runId, "INFO", textFromPayload(message), { agentId, type: message.type, context: message.payload.context });
    return;
  }

  if (message.type === "run.phase") {
    const title = asString(message.payload.title) ?? asString(message.payload.phase) ?? "Agent phase";
    const detail = asString(message.payload.detail);
    insertRunEvent(runId, "run.phase", { agentId, ...message.payload }, message.seq);
    insertRunLog(runId, "INFO", detail ? `${title}: ${detail}` : title, {
      agentId,
      type: message.type,
      phase: message.payload.phase,
      status: message.payload.status
    });
    return;
  }

  if (message.type === "run.stderr") {
    insertRunEvent(runId, "run.stderr", { agentId, text: textFromPayload(message) }, message.seq);
    insertRunLog(runId, "WARN", textFromPayload(message), { agentId, type: message.type });
    return;
  }

  if (message.type === "run.tool_request") {
    const approval = insertToolRequestApproval(runId, message);
    if (!approval.autoApproved) {
      setRunStatus(runId, "WAITING_APPROVAL");
    }
    insertRunEvent(runId, "tool_request.created", { agentId, payload: message.payload }, message.seq);
    insertRunLog(runId, approval.autoApproved ? "INFO" : "WARN", approval.autoApproved ? "Agent auto-approved Tool Bridge request" : "Agent requested PM action", {
      agentId,
      requestId: approval.requestId,
      payload: message.payload
    });
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

  if (message.type === "run.partial_artifacts") {
    insertRunEvent(runId, "result.partial_artifacts", { agentId, payload: message.payload }, message.seq);
    insertRunLog(runId, "WARN", "Agent uploaded partial artifacts", { agentId, payload: message.payload });
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

  if (message.type === "run.failed" || message.type === "run.rejected" || message.type === "task.rejected") {
    const currentStatus = getRunStatus(runId);
    if (!isTerminalStatus(currentStatus)) {
      setRunStatus(runId, "FAILED");
    }
    insertRunEvent(runId, "run.failed", { agentId, type: message.type, payload: message.payload, currentStatus }, message.seq);
    insertRunLog(runId, "ERROR", message.type === "task.rejected" ? "Agent task rejected" : "Agent run failed", {
      agentId,
      type: message.type,
      payload: message.payload,
      currentStatus
    });
  }
};

const handleAgentDisconnect = (event: AgentDisconnectEvent): void => {
  const runId = event.agent.currentRunId;
  if (!runId || !runExists(runId)) return;

  const currentStatus = getRunStatus(runId);
  if (isTerminalStatus(currentStatus)) return;

  insertRunEvent(runId, "run.interrupted", {
    agentId: event.agentId,
    deviceName: event.agent.deviceName,
    reason: "agent_lost",
    closeCode: event.code,
    closeReason: event.reason,
    previousStatus: currentStatus,
    agentStatus: event.agent.status,
    terminalized: false
  });
  insertRunLog(runId, "WARN", "Agent disconnected during active run; run remains non-terminal for reconnect", {
    agentId: event.agentId,
    deviceName: event.agent.deviceName,
    reason: "agent_lost",
    closeCode: event.code,
    closeReason: event.reason,
    previousStatus: currentStatus,
    agentStatus: event.agent.status,
    terminalized: false
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
