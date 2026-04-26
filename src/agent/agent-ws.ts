import crypto from "node:crypto";
import type http from "node:http";
import { WebSocketServer } from "ws";
import type { AgentMessage } from "../agent-protocol/messages";
import { agentRegistry } from "./agent-registry";

const getAllowedToken = (): string | undefined => {
  return process.env.MAC_AGENT_BOOTSTRAP_TOKEN || process.env.AGENT_BOOTSTRAP_TOKEN;
};

const isAuthorized = (authorization: string | undefined): boolean => {
  const allowed = getAllowedToken();
  if (!allowed) return process.env.NODE_ENV !== "production";
  return authorization === `Bearer ${allowed}`;
};

export const attachAgentWebSocketServer = (server: http.Server): WebSocketServer => {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "", "http://localhost");
    if (url.pathname !== "/agent-ws") {
      socket.destroy();
      return;
    }

    if (!isAuthorized(request.headers.authorization)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (socket, request) => {
    const agentId = `agent_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const deviceName = String(request.headers["x-device-name"] || "unknown-agent");
    const agentVersion = request.headers["x-agent-version"] ? String(request.headers["x-agent-version"]) : null;

    agentRegistry.upsert({
      id: agentId,
      deviceName,
      agentVersion,
      connectedAt: now,
      lastSeenAt: now,
      status: "unknown",
      currentRunId: null,
      socket,
      serverSeq: 1
    });

    socket.on("message", (data) => {
      const message = JSON.parse(data.toString("utf8")) as AgentMessage;
      if (message.ack_required) {
        agentRegistry.send(agentId, "ack", { in_reply_to: message.id }, false);
      }
      agentRegistry.handleMessage(agentId, message);
    });

    socket.on("close", () => {
      agentRegistry.remove(agentId);
    });
  });

  return wss;
};
