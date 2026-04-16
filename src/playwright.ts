import { Router } from "express";
import { checkPlaywrightHealth } from "./playwright-health";
import { config } from "./config";

const router = Router();

router.get("/health", async (_req, res) => {
  const health = await checkPlaywrightHealth(config.playwrightHealthcheckTimeoutMs);
  if (health.status === "unavailable") {
    return res.status(503).json(health);
  }
  return res.json(health);
});

export default router;
