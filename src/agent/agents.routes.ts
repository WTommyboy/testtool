import { Router } from "express";
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

router.get("/", (_req, res) => {
  res.json({
    items: agentRegistry.list()
  });
});

router.post("/tokens", (req, res) => {
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

router.get("/tokens", (_req, res) => {
  const onlineAgents = agentRegistry.list();
  const items = listAgentTokens().map((token) => ({
    ...token,
    online: onlineAgents.some((agent) => agent.deviceName === token.device_name)
  }));
  return res.json({ items });
});

router.delete("/tokens/:id", (req, res) => {
  const revoked = revokeAgentToken(req.params.id);
  if (!revoked) {
    return res.status(404).json({ error: "AGENT_TOKEN_NOT_FOUND" });
  }
  return res.json({ id: req.params.id, revoked: true });
});

router.get("/:id", (req, res) => {
  const agent = agentRegistry.get(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: "AGENT_NOT_FOUND" });
  }
  return res.json(agent);
});

router.post("/:id/dispatch-smoke", (req, res) => {
  const parsed = dispatchSmokeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "INVALID_PAYLOAD",
      issues: parsed.error.issues
    });
  }

  try {
    const message = agentRegistry.dispatchTask(req.params.id, {
      run_id: parsed.data.runId ?? `smoke_${Date.now()}`,
      domain: "BI",
      round_id: parsed.data.roundId ?? "SMOKE",
      input_urls: {},
      startup_instruction: parsed.data.prompt ?? "Smoke test: acknowledge task.dispatch and complete without running UAT."
    });

    return res.status(202).json({
      agentId: req.params.id,
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
