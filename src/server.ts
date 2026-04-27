import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import cors from "cors";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { registerAgentRunEventHandlers } from "./agent/agent-run-events";
import { attachAgentWebSocketServer } from "./agent/agent-ws";
import agentsRouter from "./agent/agents.routes";
import { authRouter, getAllowedAppOrigins, requireUser, requireUserOrAgent } from "./auth";
import { config } from "./config";
import { migrate } from "./db";
import runsRouter from "./runs";
import conversationsRouter from "./conversations";
import playwrightRouter from "./playwright";
import domainsRouter from "./domains";

const ensureDirectory = (dirPath: string): void => {
  fs.mkdirSync(path.resolve(dirPath), { recursive: true });
};

ensureDirectory(config.storageRoot);
migrate();
registerAgentRunEventHandlers();

const app = express();

const allowedOrigins = getAllowedAppOrigins();
app.use(cors({
  credentials: true,
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  }
}));
app.use(express.json({ limit: "5mb" }));

const runAgentExchangePattern = /^\/[^/]+\/(?:input\/(?:xlsx|md|startup|baseline)|output\/(?:result-xlsx|log))$/;
const runsAccess = (req: Request, res: Response, next: NextFunction): void | Response => {
  if (runAgentExchangePattern.test(req.path)) {
    return requireUserOrAgent(req, res, next);
  }
  return requireUser(req, res, next);
};

const domainsAccess = (req: Request, res: Response, next: NextFunction): void | Response => {
  if (req.method === "GET") return requireUserOrAgent(req, res, next);
  return requireUser(req, res, next);
};

const agentsAccess = (req: Request, res: Response, next: NextFunction): void | Response => {
  if (req.path === "/tokens" || req.path.startsWith("/tokens/") || req.path.endsWith("/dispatch-smoke")) {
    return next();
  }
  return requireUser(req, res, next);
};

app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    service: "uat-tool-api",
    timestamp: new Date().toISOString(),
    nodeEnv: config.nodeEnv,
    timezone: config.defaultTimezone
  });
});

app.use("/api/auth", authRouter);
app.use("/api/runs", runsAccess, runsRouter);
app.use("/api/conversations", requireUser, conversationsRouter);
app.use("/api/playwright", requireUser, playwrightRouter);
app.use("/api/agents", agentsAccess, agentsRouter);
app.use("/api/domains", domainsAccess, domainsRouter);

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
