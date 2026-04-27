import crypto from "node:crypto";
import WebSocket from "ws";
import { buildAgentCapability } from "./doctor";
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
  private status: "idle" | "busy" = "idle";
  private currentRunId: string | null = null;
  private readonly closedPromise: Promise<void>;
  private resolveClosed: (() => void) | null = null;

  constructor(private readonly options: AgentConnectionOptions) {
    this.closedPromise = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
  }

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
        void (async () => {
          const capability = await buildAgentCapability(this.options.config);
          this.send("agent.online", {
            device_name: this.options.config.device_name,
            agent_version: "0.1.0",
            ...capability,
            status: this.status,
            current_run_id: this.currentRunId
          }, true);
          this.heartbeatTimer = setInterval(() => {
            this.send("agent.heartbeat", { status: this.status, current_run_id: this.currentRunId }, false);
          }, 30_000);
          resolve();
        })().catch((error) => {
          reject(error);
          this.options.onStatus?.("error", error);
        });
      });
      this.ws.on("message", (data) => this.handleMessage(data.toString("utf8")));
      this.ws.on("close", (code, reason) => {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.options.onStatus?.("closed", {
          code,
          reason: reason.toString("utf8")
        });
        this.resolveClosed?.();
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

  waitUntilClosed(): Promise<void> {
    return this.closedPromise;
  }

  setRunState(status: "idle" | "busy", runId: string | null): void {
    this.status = status;
    this.currentRunId = runId;
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
