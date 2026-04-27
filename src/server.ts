import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
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

const readPackageVersion = (): string | null => {
  try {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : null;
  } catch {
    return null;
  }
};

const readLocalGitCommit = (): string | null => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
};

const compactObject = <T extends Record<string, unknown>>(value: T): Partial<T> => {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== "")
  ) as Partial<T>;
};

const buildVersionInfo = () => {
  const commitSha = process.env.RAILWAY_GIT_COMMIT_SHA
    ?? process.env.VERCEL_GIT_COMMIT_SHA
    ?? process.env.GIT_COMMIT_SHA
    ?? readLocalGitCommit();

  const branch = process.env.RAILWAY_GIT_BRANCH
    ?? process.env.VERCEL_GIT_COMMIT_REF
    ?? process.env.GIT_BRANCH;

  return compactObject({
    appVersion: readPackageVersion(),
    commitSha,
    shortCommitSha: commitSha ? commitSha.slice(0, 7) : undefined,
    branch,
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? process.env.VERCEL_DEPLOYMENT_ID,
    serviceId: process.env.RAILWAY_SERVICE_ID,
    serviceName: process.env.RAILWAY_SERVICE_NAME,
    environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
    environmentName: process.env.RAILWAY_ENVIRONMENT_NAME,
    projectId: process.env.RAILWAY_PROJECT_ID,
    region: process.env.RAILWAY_REGION,
    buildTime: process.env.BUILD_TIME
  });
};

ensureDirectory(config.storageRoot);
migrate();
registerAgentRunEventHandlers();

const app = express();
const versionInfo = buildVersionInfo();

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
    timezone: config.defaultTimezone,
    version: versionInfo
  });
});

app.get("/version", (_req, res) => {
  res.json({
    service: "uat-tool-api",
    nodeEnv: config.nodeEnv,
    timezone: config.defaultTimezone,
    version: versionInfo
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
