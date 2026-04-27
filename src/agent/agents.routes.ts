import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { createAgentToken, listAgentTokens, revokeAgentToken } from "./agent-tokens";
import { agentRegistry } from "./agent-registry";

const router = Router();

const dispatchSmokeSchema = z.object({
  runId: z.string().min(1).optional(),
  roundId: z.string().min(1).optional(),
  prompt: z.string().min(1).optional()
});

const createTokenSchema = z.object({
  device_name: z.string().min(1).optional(),
  deviceName: z.string().min(1).optional()
});

const getBootstrapSecret = (): string => {
  return process.env.AGENT_BOOTSTRAP_SECRET
    || process.env.MAC_AGENT_BOOTSTRAP_TOKEN
    || (process.env.NODE_ENV === "production" ? "" : "dev-agent-token");
};

const getBootstrapToken = (req: Request): string => {
  const headerToken = req.header("x-agent-bootstrap-token");
  if (headerToken) return headerToken;

  const authHeader = req.header("authorization") ?? "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  return bearerMatch?.[1] ?? "";
};

const requireBootstrapToken = (req: Request, res: Response, next: NextFunction) => {
  const expected = getBootstrapSecret();
  if (!expected) {
    return res.status(503).json({ error: "AGENT_BOOTSTRAP_SECRET_NOT_CONFIGURED" });
  }

  if (getBootstrapToken(req) !== expected) {
    return res.status(401).json({ error: "UNAUTHORIZED_AGENT_BOOTSTRAP" });
  }

  return next();
};

router.get("/", (_req, res) => {
  res.json({
    items: agentRegistry.list()
  });
});

router.post("/tokens", requireBootstrapToken, (req, res) => {
  const parsed = createTokenSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "INVALID_PAYLOAD",
      issues: parsed.error.issues
    });
  }
  const deviceName = parsed.data.device_name ?? parsed.data.deviceName ?? "Tommy Mac";
  const token = createAgentToken(deviceName);
  return res.status(201).json({
    id: token.id,
    token: token.token,
    masked_token: token.maskedToken,
    device_name: token.deviceName
  });
});

router.get("/tokens", requireBootstrapToken, (_req, res) => {
  const onlineAgents = agentRegistry.list();
  const items = listAgentTokens().map((token) => ({
    ...token,
    online: onlineAgents.some((agent) => agent.deviceName === token.device_name)
  }));
  return res.json({ items });
});

router.delete("/tokens/:id", requireBootstrapToken, (req, res) => {
  const tokenId = String(req.params.id);
  const revoked = revokeAgentToken(tokenId);
  if (!revoked) {
    return res.status(404).json({ error: "AGENT_TOKEN_NOT_FOUND" });
  }
  return res.json({ id: tokenId, revoked: true });
});

router.get("/:id", (req, res) => {
  const agent = agentRegistry.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: "AGENT_NOT_FOUND" });
  }
  return res.json(agent);
});

router.post("/:id/dispatch-smoke", requireBootstrapToken, (req, res) => {
  const parsed = dispatchSmokeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "INVALID_PAYLOAD",
      issues: parsed.error.issues
    });
  }

  try {
    const agentId = String(req.params.id);
    const message = agentRegistry.dispatchTask(agentId, {
      run_id: parsed.data.runId ?? `smoke_${Date.now()}`,
      domain: "BI",
      round_id: parsed.data.roundId ?? "SMOKE",
      input_urls: {},
      startup_instruction: parsed.data.prompt ?? "Smoke test: acknowledge task.dispatch and complete without running UAT."
    });

    return res.status(202).json({
      agentId,
      messageId: message.id,
      status: "DISPATCHED"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "AGENT_NOT_FOUND" ? 404 : message === "AGENT_BUSY" ? 409 : 503;
    return res.status(status).json({ error: message });
  }
});

export default router;
