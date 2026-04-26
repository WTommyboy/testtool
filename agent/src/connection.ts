import crypto from "node:crypto";
import os from "node:os";
import WebSocket from "ws";
import type { AgentConfig, AgentMessage } from "./types";

export type AgentConnectionOptions = {
  config: AgentConfig;
  onMessage?: (message: AgentMessage) => void;
  onStatus?: (status: "open" | "closed" | "error", detail?: unknown) => void;
};

export class AgentConnection {
  private ws: WebSocket | null = null;
  private seq = 1;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: AgentConnectionOptions) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.options.config.server, {
        headers: {
          Authorization: `Bearer ${this.options.config.token}`,
          "X-Agent-Version": "0.1.0",
          "X-Device-Name": this.options.config.device_name
        }
      });
      this.ws.once("open", () => {
        this.options.onStatus?.("open");
        this.send("agent.online", {
          device_name: this.options.config.device_name,
          agent_version: "0.1.0",
          platform: `${os.platform()}-${os.arch()}`,
          codex_version: "unknown",
          node_version: process.version,
          supported_task_types: ["uat_run"],
          supported_execution_modes: ["interactive"],
          tool_bridge_versions: ["spike-v1"],
          playwright_mcp_available: false,
          chrome_profile_ready: true,
          current_run_id: null
        }, true);
        this.heartbeatTimer = setInterval(() => {
          this.send("agent.heartbeat", { status: "idle", current_run_id: null }, false);
        }, 30_000);
        resolve();
      });
      this.ws.on("message", (data) => this.handleMessage(data.toString("utf8")));
      this.ws.on("close", () => {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.options.onStatus?.("closed");
      });
      this.ws.on("error", (error) => {
        this.options.onStatus?.("error", error);
        reject(error);
      });
    });
  }

  close(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.ws?.close();
  }

  send(type: string, payload: Record<string, unknown>, ackRequired: boolean): AgentMessage {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("AGENT_WS_NOT_OPEN");
    }
    const message: AgentMessage = {
      id: `msg_${crypto.randomUUID()}`,
      seq: this.seq++,
      type,
      timestamp: new Date().toISOString(),
      ack_required: ackRequired,
      payload
    };
    this.ws.send(JSON.stringify(message));
    return message;
  }

  private handleMessage(raw: string): void {
    const message = JSON.parse(raw) as AgentMessage;
    if (message.ack_required) {
      this.send("ack", { in_reply_to: message.id }, false);
    }
    this.options.onMessage?.(message);
  }
}
