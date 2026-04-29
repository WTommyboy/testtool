import { Router } from "express";
import { getDomainPack, listDomainPacks, readDomainPackFile, readOptionalDomainPackFile } from "./domain-loader";

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

router.get("/:name/result-adapter", (req, res) => {
  const pack = getDomainPack(req.params.name);
  if (!pack) return res.status(404).json({ error: "DOMAIN_NOT_FOUND" });
  const content = readDomainPackFile(req.params.name, "result_parser_adapter.json");
  if (content === null) return res.status(409).json({ error: "DOMAIN_RESULT_ADAPTER_MISSING" });
  return res.type("application/json").send(content);
});

router.get("/:name/startup-template", (req, res) => {
  const pack = getDomainPack(req.params.name);
  if (!pack) return res.status(404).json({ error: "DOMAIN_NOT_FOUND" });
  const content = readDomainPackFile(req.params.name, "startup_prompt_template.md");
  if (content === null) return res.status(409).json({ error: "DOMAIN_STARTUP_TEMPLATE_MISSING" });
  return res.type("text/markdown").send(content);
});

router.get("/:name/locator-registry", (req, res) => {
  const pack = getDomainPack(req.params.name);
  if (!pack) return res.status(404).json({ error: "DOMAIN_NOT_FOUND" });
  const content = readOptionalDomainPackFile(req.params.name, "locators/demo001-locator-registry.json");
  if (content === null) return res.status(404).json({ error: "DOMAIN_LOCATOR_REGISTRY_MISSING" });
  return res.type("application/json").send(content);
});

export default router;
