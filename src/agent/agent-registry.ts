import type WebSocket from "ws";
import type { AgentMessage } from "../agent-protocol/messages";

export type ConnectedAgent = {
  id: string;
  deviceName: string;
  agentVersion: string | null;
  connectedAt: string;
  lastSeenAt: string;
  status: "idle" | "busy" | "unknown";
  currentRunId: string | null;
  socket: WebSocket;
};

export type AgentSnapshot = Omit<ConnectedAgent, "socket">;

class AgentRegistry {
  private readonly agents = new Map<string, ConnectedAgent>();

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
    return [...this.agents.values()].map(({ socket: _socket, ...agent }) => agent);
  }

  handleMessage(agentId: string, message: AgentMessage): void {
    if (message.type === "agent.heartbeat") {
      this.updateHeartbeat(agentId, message.payload);
    }
  }
}

export const agentRegistry = new AgentRegistry();
