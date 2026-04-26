import { Router } from "express";
import { agentRegistry } from "./agent-registry";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    items: agentRegistry.list()
  });
});

export default router;
