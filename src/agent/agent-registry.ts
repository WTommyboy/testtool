import type WebSocket from "ws";
import { createAgentMessage, type AgentMessage } from "../agent-protocol/messages";

export type AgentDoctorCheck = {
  name: string;
  verdict: "PASS" | "FAIL" | "SKIPPED";
  details?: Record<string, unknown>;
};

export type ConnectedAgent = {
  id: string;
  deviceName: string;
  agentVersion: string | null;
  platform: string | null;
  codexVersion: string | null;
  nodeVersion: string | null;
  supportedTaskTypes: string[];
  supportedExecutionModes: string[];
  toolBridgeVersions: string[];
  playwrightMcpAvailable: boolean | null;
  chromeProfileReady: boolean | null;
  doctorOk: boolean | null;
  doctorChecks: AgentDoctorCheck[];
  connectedAt: string;
  lastSeenAt: string;
  status: "idle" | "busy" | "unknown";
  currentRunId: string | null;
  socket: WebSocket;
  serverSeq: number;
};

export type AgentSnapshot = Omit<ConnectedAgent, "socket" | "serverSeq">;

export type AgentMessageEvent = {
  agentId: string;
  message: AgentMessage;
};

type AgentMessageListener = (event: AgentMessageEvent) => void;

const isStatus = (value: unknown): value is "idle" | "busy" => value === "idle" || value === "busy";

const asString = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
};

const asBooleanOrNull = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

const asDoctorChecks = (value: unknown): AgentDoctorCheck[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    const name = asString(candidate.name);
    const verdict = candidate.verdict;
    if (!name || (verdict !== "PASS" && verdict !== "FAIL" && verdict !== "SKIPPED")) return [];
    const details = candidate.details && typeof candidate.details === "object" && !Array.isArray(candidate.details)
      ? candidate.details as Record<string, unknown>
      : undefined;
    return [{ name, verdict, details }];
  });
};

class AgentRegistry {
  private readonly agents = new Map<string, ConnectedAgent>();
  private readonly listeners = new Set<AgentMessageListener>();

  upsert(agent: ConnectedAgent): void {
    this.agents.set(agent.id, agent);
  }

  remove(agentId: string): void {
    this.agents.delete(agentId);
  }

  updateHeartbeat(agentId: string, payload: Record<string, unknown>): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.lastSeenAt = new Date().toISOString();
    agent.status = isStatus(payload.status) ? payload.status : agent.status;
    agent.currentRunId = typeof payload.current_run_id === "string" ? payload.current_run_id : null;
  }

  updateOnline(agentId: string, payload: Record<string, unknown>): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.lastSeenAt = new Date().toISOString();
    agent.deviceName = asString(payload.device_name) ?? agent.deviceName;
    agent.agentVersion = asString(payload.agent_version) ?? agent.agentVersion;
    agent.platform = asString(payload.platform);
    agent.codexVersion = asString(payload.codex_version);
    agent.nodeVersion = asString(payload.node_version);
    agent.supportedTaskTypes = asStringArray(payload.supported_task_types);
    agent.supportedExecutionModes = asStringArray(payload.supported_execution_modes);
    agent.toolBridgeVersions = asStringArray(payload.tool_bridge_versions);
    agent.playwrightMcpAvailable = asBooleanOrNull(payload.playwright_mcp_available);
    agent.chromeProfileReady = asBooleanOrNull(payload.chrome_profile_ready);
    agent.doctorOk = asBooleanOrNull(payload.doctor_ok);
    agent.doctorChecks = asDoctorChecks(payload.doctor_checks);
    agent.status = isStatus(payload.status) ? payload.status : "idle";
    agent.currentRunId = typeof payload.current_run_id === "string" ? payload.current_run_id : null;
  }

  list(): AgentSnapshot[] {
    return [...this.agents.values()].map(({ socket: _socket, serverSeq: _serverSeq, ...agent }) => agent);
  }

  get(agentId: string): AgentSnapshot | undefined {
    const agent = this.agents.get(agentId);
    if (!agent) return undefined;
    const { socket: _socket, serverSeq: _serverSeq, ...snapshot } = agent;
    return snapshot;
  }

  findByCurrentRunId(runId: string): AgentSnapshot | undefined {
    const agent = [...this.agents.values()].find((item) => item.currentRunId === runId);
    if (!agent) return undefined;
    const { socket: _socket, serverSeq: _serverSeq, ...snapshot } = agent;
    return snapshot;
  }

  onMessage(listener: AgentMessageListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  send(
    agentId: string,
    type: string,
    payload: Record<string, unknown>,
    ackRequired = true
  ): AgentMessage {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error("AGENT_NOT_FOUND");
    }
    if (agent.socket.readyState !== agent.socket.OPEN) {
      throw new Error("AGENT_SOCKET_NOT_OPEN");
    }

    const message = createAgentMessage(type, payload, {
      seq: agent.serverSeq++,
      ackRequired
    });
    agent.socket.send(JSON.stringify(message));
    return message;
  }

  dispatchTask(agentId: string, payload: Record<string, unknown>): AgentMessage {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error("AGENT_NOT_FOUND");
    }
    if (agent.status === "busy") {
      throw new Error("AGENT_BUSY");
    }

    const message = this.send(agentId, "task.dispatch", payload, true);
    agent.status = "busy";
    agent.lastSeenAt = new Date().toISOString();
    agent.currentRunId = typeof payload.run_id === "string" ? payload.run_id : null;
    return message;
  }

  handleMessage(agentId: string, message: AgentMessage): void {
    if (message.type === "agent.online") {
      this.updateOnline(agentId, message.payload);
    }
    if (message.type === "agent.heartbeat") {
      this.updateHeartbeat(agentId, message.payload);
    }
    if (message.type === "run.started") {
      const agent = this.agents.get(agentId);
      if (agent) {
        agent.status = "busy";
        agent.lastSeenAt = new Date().toISOString();
        agent.currentRunId = typeof message.payload.run_id === "string" ? message.payload.run_id : agent.currentRunId;
      }
    }
    if (message.type === "run.tool_request") {
      const agent = this.agents.get(agentId);
      if (agent) {
        agent.status = "idle";
        agent.lastSeenAt = new Date().toISOString();
        agent.currentRunId = null;
      }
    }
    if (["run.completed", "run.failed", "run.rejected", "run.cancelled"].includes(message.type)) {
      const agent = this.agents.get(agentId);
      if (agent) {
        agent.status = "idle";
        agent.lastSeenAt = new Date().toISOString();
        agent.currentRunId = null;
      }
    }

    for (const listener of this.listeners) {
      listener({ agentId, message });
    }
  }
}

export const agentRegistry = new AgentRegistry();
