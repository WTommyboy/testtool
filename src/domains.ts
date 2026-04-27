import { Router } from "express";
import { getDomainPack, listDomainPacks, readDomainPackFile } from "./domain-loader";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ items: listDomainPacks() });
});

router.post("/sync", (_req, res) => {
  res.json({
    status: "LOCAL_ONLY",
    message: "M1 MVP reads local domain-packs/. Git sync is intentionally deferred.",
    items: listDomainPacks()
  });
});

router.get("/:name/rules", (req, res) => {
  const pack = getDomainPack(req.params.name);
  if (!pack) return res.status(404).json({ error: "DOMAIN_NOT_FOUND" });
  const content = readDomainPackFile(req.params.name, "AGENTS.md");
  if (content === null) return res.status(409).json({ error: "DOMAIN_RULES_MISSING" });
  return res.type("text/markdown").send(content);
});

router.get("/:name/schema", (req, res) => {
  const pack = getDomainPack(req.params.name);
  if (!pack) return res.status(404).json({ error: "DOMAIN_NOT_FOUND" });
  const content = readDomainPackFile(req.params.name, "xlsx_schema.json");
  if (content === null) return res.status(409).json({ error: "DOMAIN_SCHEMA_MISSING" });
  return res.type("application/json").send(content);
});

export default router;
