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

const readLocalGitCommitDate = (): string | null => {
  try {
    return execFileSync("git", ["show", "-s", "--format=%cI", "HEAD"], {
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

type VersionInfo = Partial<{
  appVersion: string | null;
  commitSha: string;
  shortCommitSha: string;
  branch: string;
  deploymentId: string;
  serviceId: string;
  serviceName: string;
  environmentId: string;
  environmentName: string;
  projectId: string;
  region: string;
  buildTime: string;
  commitDate: string;
  updatedAt: string;
}>;

type VersionResponse = {
  service?: string;
  nodeEnv?: string;
  timezone?: string;
  version?: VersionInfo;
  rollout?: RolloutInfo;
};

type RolloutInfo = {
  updatedAt?: string;
  production?: {
    status: "pushed" | "not_pushed" | "unknown";
    prodShortCommitSha?: string;
    prodUpdatedAt?: string;
    checkedAt: string;
  };
  devSmoke?: {
    status: "passed" | "not_passed" | "stale" | "unknown";
    shortCommitSha?: string;
    passedAt?: string;
  };
};

type GitHubCommitResponse = {
  commit?: {
    author?: {
      date?: string;
    };
    committer?: {
      date?: string;
    };
  };
};

const buildVersionInfo = () => {
  const localCommitDate = process.env.GIT_COMMIT_DATE ?? readLocalGitCommitDate();
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
    buildTime: process.env.BUILD_TIME,
    commitDate: localCommitDate,
    updatedAt: localCommitDate ?? process.env.BUILD_TIME
  }) as VersionInfo;
};

const isDevDeployment = (version: VersionInfo): boolean => {
  const envName = String(version.environmentName ?? "").toLowerCase();
  const branch = String(version.branch ?? "").toLowerCase();
  return envName === "dev" || branch.startsWith("dev/") || branch.includes("dev");
};

const fetchJsonWithTimeout = async <T,>(url: string, timeoutMs = 1500): Promise<T | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const commitDateCache = new Map<string, string | null>();

const resolveGitHubRepository = (): string | null => {
  const repository = process.env.VERSION_GITHUB_REPOSITORY
    ?? process.env.GITHUB_REPOSITORY
    ?? "WTommyboy/testtool";
  const normalized = repository.trim();
  return /^[\w.-]+\/[\w.-]+$/.test(normalized) ? normalized : null;
};

const resolveCommitDate = async (version: VersionInfo): Promise<string | null> => {
  if (version.commitDate) return version.commitDate;
  if (!version.commitSha) return null;
  if (commitDateCache.has(version.commitSha)) {
    return commitDateCache.get(version.commitSha) ?? null;
  }

  const repository = resolveGitHubRepository();
  if (!repository) {
    commitDateCache.set(version.commitSha, null);
    return null;
  }

  const data = await fetchJsonWithTimeout<GitHubCommitResponse>(
    `https://api.github.com/repos/${repository}/commits/${version.commitSha}`
  );
  const commitDate = data?.commit?.committer?.date ?? data?.commit?.author?.date ?? null;
  commitDateCache.set(version.commitSha, commitDate);
  return commitDate;
};

const buildResolvedVersionInfo = async (version: VersionInfo): Promise<VersionInfo> => {
  const commitDate = await resolveCommitDate(version);
  const updatedAt = commitDate ?? version.updatedAt ?? version.buildTime;
  return compactObject({
    ...version,
    commitDate,
    updatedAt
  }) as VersionInfo;
};

const buildDevSmokeInfo = (version: VersionInfo): RolloutInfo["devSmoke"] => {
  const rawStatus = String(process.env.DEV_SMOKE_STATUS ?? process.env.DEV_VERSION_SMOKE_STATUS ?? "").trim().toLowerCase();
  const smokeCommit = process.env.DEV_SMOKE_COMMIT_SHA ?? process.env.DEV_VERSION_SMOKE_COMMIT_SHA;
  const passedAt = process.env.DEV_SMOKE_PASSED_AT ?? process.env.DEV_VERSION_SMOKE_PASSED_AT;
  const shortCommitSha = smokeCommit ? smokeCommit.slice(0, 7) : undefined;
  const normalizedCurrent = version.commitSha?.trim();
  const normalizedSmoke = smokeCommit?.trim();

  if (["passed", "pass", "true", "1", "yes"].includes(rawStatus)) {
    const status = normalizedCurrent && normalizedSmoke && normalizedCurrent !== normalizedSmoke ? "stale" : "passed";
    return compactObject({ status, shortCommitSha, passedAt }) as RolloutInfo["devSmoke"];
  }

  if (["failed", "fail", "false", "0", "no", "not_passed"].includes(rawStatus)) {
    return compactObject({ status: "not_passed", shortCommitSha, passedAt }) as RolloutInfo["devSmoke"];
  }

  return { status: "unknown" };
};

const buildRolloutInfo = async (version: VersionInfo): Promise<RolloutInfo> => {
  const rollout: RolloutInfo = {
    updatedAt: version.updatedAt ?? version.commitDate ?? version.buildTime
  };

  if (!isDevDeployment(version)) return rollout;

  const prodVersionUrl = process.env.PROD_VERSION_URL ?? "https://testtool-production.up.railway.app/version";
  const prodData = await fetchJsonWithTimeout<VersionResponse>(prodVersionUrl);
  const prodVersion = prodData?.version;
  const prodShortCommitSha = prodVersion?.shortCommitSha;
  const currentShortCommitSha = version.shortCommitSha;

  rollout.production = {
    status: prodShortCommitSha && currentShortCommitSha
      ? (prodShortCommitSha === currentShortCommitSha ? "pushed" : "not_pushed")
      : "unknown",
    prodShortCommitSha,
    prodUpdatedAt: prodVersion?.updatedAt ?? prodVersion?.buildTime ?? prodVersion?.commitDate,
    checkedAt: new Date().toISOString()
  };
  rollout.devSmoke = buildDevSmokeInfo(version);
  return rollout;
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

const runAgentExchangePattern = /^\/[^/]+\/(?:input\/(?:xlsx|md|startup|baseline)|output\/(?:result-xlsx|log|timing-summary|diagnostic-summary|artifacts))$/;
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

app.get("/version", async (_req, res) => {
  const resolvedVersionInfo = await buildResolvedVersionInfo(versionInfo);
  res.json({
    service: "uat-tool-api",
    nodeEnv: config.nodeEnv,
    timezone: config.defaultTimezone,
    version: resolvedVersionInfo,
    rollout: await buildRolloutInfo(resolvedVersionInfo)
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
