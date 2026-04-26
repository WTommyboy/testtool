import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import cors from "cors";
import express from "express";
import { registerAgentRunEventHandlers } from "./agent/agent-run-events";
import { attachAgentWebSocketServer } from "./agent/agent-ws";
import agentsRouter from "./agent/agents.routes";
import { config } from "./config";
import { migrate } from "./db";
import runsRouter from "./runs";
import conversationsRouter from "./conversations";
import playwrightRouter from "./playwright";

const ensureDirectory = (dirPath: string): void => {
  fs.mkdirSync(path.resolve(dirPath), { recursive: true });
};

ensureDirectory(config.storageRoot);
migrate();
registerAgentRunEventHandlers();

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    service: "uat-tool-api",
    timestamp: new Date().toISOString(),
    nodeEnv: config.nodeEnv,
    timezone: config.defaultTimezone
  });
});

app.use("/api/runs", runsRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/playwright", playwrightRouter);
app.use("/api/agents", agentsRouter);

app.use((req, res) => {
  res.status(404).json({
    error: "NOT_FOUND",
    path: req.path
  });
});

const server = http.createServer(app);
attachAgentWebSocketServer(server);

server.listen(config.port, () => {
  // Keep startup log concise for local dev.
  console.log(`[uat-tool] api listening on :${config.port}`);
});
