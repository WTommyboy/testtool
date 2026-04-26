import type WebSocket from "ws";
import { createAgentMessage, type AgentMessage } from "../agent-protocol/messages";

export type ConnectedAgent = {
  id: string;
  deviceName: string;
  agentVersion: string | null;
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
    agent.status = payload.status === "idle" || payload.status === "busy" ? payload.status : agent.status;
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
    if (["run.completed", "run.failed", "run.rejected"].includes(message.type)) {
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
