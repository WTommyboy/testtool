import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import { buildAgentCapability } from "./doctor";
import type { AgentConfig, AgentMessage } from "./types";

export type AgentConnectionOptions = {
  config: AgentConfig;
  onMessage?: (message: AgentMessage) => void;
  onStatus?: (status: "open" | "closed" | "error", detail?: unknown) => void;
};

type RunSnapshot = {
  run_id: string;
  status: string;
  thread_id: string | null;
  tool_request_count: number | null;
  state_path: string;
  updated_at: string;
};

const readAgentVersion = (): string => {
  const candidates = [
    path.resolve(__dirname, "../package.json"),
    path.resolve(__dirname, "../../agent/package.json")
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.trim()) return parsed.version.trim();
    } catch {
      // Continue to the next layout; source and compiled builds resolve differently.
    }
  }
  return "0.0.0-dev";
};

export const AGENT_VERSION = readAgentVersion();

export class AgentConnection {
  private ws: WebSocket | null = null;
  private seq = 1;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private status: "idle" | "busy" = "idle";
  private currentRunId: string | null = null;
  private closedPromise: Promise<void>;
  private resolveClosed: (() => void) | null = null;
  private readonly outboundQueue: AgentMessage[] = [];

  constructor(private readonly options: AgentConnectionOptions) {
    this.closedPromise = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  private resetClosedPromise(): void {
    this.closedPromise = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  private queueMessage(message: AgentMessage): void {
    const maxQueueSize = 500;
    if (this.outboundQueue.length >= maxQueueSize) {
      const disposableIndex = this.outboundQueue.findIndex((item) => !item.ack_required);
      if (disposableIndex >= 0) {
        this.outboundQueue.splice(disposableIndex, 1);
      } else {
        this.outboundQueue.shift();
      }
    }
    this.outboundQueue.push(message);
  }

  private sendMessage(message: AgentMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  private flushOutboundQueue(): void {
    while (this.outboundQueue.length > 0) {
      const message = this.outboundQueue[0];
      if (!this.sendMessage(message)) return;
      this.outboundQueue.shift();
    }
  }

  private buildRunSnapshot(): RunSnapshot | null {
    if (!fs.existsSync(this.options.config.workdir_root)) return null;
    const candidates: RunSnapshot[] = [];
    for (const entry of fs.readdirSync(this.options.config.workdir_root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const statePath = path.join(this.options.config.workdir_root, entry.name, "state.json");
      if (!fs.existsSync(statePath)) continue;
      try {
        const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<string, unknown>;
        const status = typeof state.status === "string" ? state.status : "unknown";
        if (!["started", "waiting_user", "resuming"].includes(status)) continue;
        const updatedAt = fs.statSync(statePath).mtimeMs;
        candidates.push({
          run_id: typeof state.run_id === "string" ? state.run_id : entry.name,
          status,
          thread_id: typeof state.thread_id === "string" ? state.thread_id : null,
          tool_request_count: typeof state.tool_request_count === "number" ? state.tool_request_count : null,
          state_path: statePath,
          updated_at: new Date(updatedAt).toISOString()
        });
      } catch {
        // Ignore malformed state files; they should not block agent startup.
      }
    }
    candidates.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

    return candidates[0] ?? null;
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      const capability = await buildAgentCapability(this.options.config);
      this.send("agent.heartbeat", {
        ...capability,
        status: this.status,
        current_run_id: this.currentRunId
      }, false);
    } catch (error) {
      this.send("agent.heartbeat", {
        status: this.status,
        current_run_id: this.currentRunId,
        doctor_ok: false,
        doctor_checks: [
          {
            name: "agent-heartbeat-doctor",
            verdict: "FAIL",
            details: {
              error: error instanceof Error ? error.message : String(error)
            }
          }
        ]
      }, false);
    }
  }

  connect(): Promise<void> {
    this.resetClosedPromise();
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.options.config.server, {
        headers: {
          Authorization: `Bearer ${this.options.config.token}`,
          "X-Agent-Version": AGENT_VERSION,
          "X-Device-Name": this.options.config.device_name
        }
      });
      this.ws.once("open", () => {
        this.options.onStatus?.("open");
        void (async () => {
          const capability = await buildAgentCapability(this.options.config);
          if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error("AGENT_WS_CLOSED_DURING_ONLINE");
          }
          this.send("agent.online", {
            device_name: this.options.config.device_name,
            agent_version: AGENT_VERSION,
            ...capability,
            status: this.status,
            current_run_id: this.currentRunId,
            run_snapshot: this.buildRunSnapshot()
          }, true);
          this.flushOutboundQueue();
          this.heartbeatTimer = setInterval(() => {
            void this.sendHeartbeat();
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
        this.ws = null;
        this.options.onStatus?.("closed", {
          code,
          reason: reason.toString("utf8")
        });
        this.resolveClosed?.();
      });
      this.ws.on("error", (error) => {
        this.ws = null;
        this.options.onStatus?.("error", error);
        reject(error);
      });
    });
  }

  close(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.ws?.close();
    this.ws = null;
  }

  waitUntilClosed(): Promise<void> {
    return this.closedPromise;
  }

  setRunState(status: "idle" | "busy", runId: string | null): void {
    this.status = status;
    this.currentRunId = runId;
  }

  send(type: string, payload: Record<string, unknown>, ackRequired: boolean): AgentMessage {
    const message: AgentMessage = {
      id: `msg_${crypto.randomUUID()}`,
      seq: this.seq++,
      type,
      timestamp: new Date().toISOString(),
      ack_required: ackRequired,
      payload
    };
    if (!this.sendMessage(message)) {
      this.queueMessage(message);
    }
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
