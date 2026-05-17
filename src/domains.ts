import { type Response, Router } from "express";
import {
  getDomainPack,
  listDomainPacks,
  readDomainPackFile,
  readOptionalDomainPackFile,
  type OptionalDomainPackFile
} from "./domain-loader";

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

const sendOptionalJsonFile = (name: string, fileName: OptionalDomainPackFile, missingError: string, res: Response) => {
  const pack = getDomainPack(name);
  if (!pack) return res.status(404).json({ error: "DOMAIN_NOT_FOUND" });
  const content = readOptionalDomainPackFile(name, fileName);
  if (content === null) return res.status(404).json({ error: missingError });
  return res.type("application/json").send(content);
};

router.get("/:name/locator-registry", (req, res) => {
  return sendOptionalJsonFile(req.params.name, "locators/demo001-locator-registry.json", "DOMAIN_LOCATOR_REGISTRY_MISSING", res);
});

router.get("/:name/ui-contract", (req, res) => {
  return sendOptionalJsonFile(req.params.name, "ui-contract.json", "DOMAIN_UI_CONTRACT_MISSING", res);
});

router.get("/:name/action-contracts/setMetricRows", (req, res) => {
  return sendOptionalJsonFile(req.params.name, "action-contracts/setMetricRows.json", "DOMAIN_ACTION_SET_METRIC_ROWS_MISSING", res);
});

router.get("/:name/action-contracts/observeFrontendState", (req, res) => {
  return sendOptionalJsonFile(req.params.name, "action-contracts/observeFrontendState.json", "DOMAIN_ACTION_OBSERVE_FRONTEND_STATE_MISSING", res);
});

router.get("/:name/evidence-schema", (req, res) => {
  return sendOptionalJsonFile(req.params.name, "evidence-schema.json", "DOMAIN_EVIDENCE_SCHEMA_MISSING", res);
});

router.get("/:name/lint-rules", (req, res) => {
  return sendOptionalJsonFile(req.params.name, "lint-rules.json", "DOMAIN_LINT_RULES_MISSING", res);
});

router.get("/:name/discovery/page-map", (req, res) => {
  return sendOptionalJsonFile(req.params.name, "discovery/page-map.json", "DOMAIN_DISCOVERY_PAGE_MAP_MISSING", res);
});

router.get("/:name/discovery/component-inventory", (req, res) => {
  return sendOptionalJsonFile(req.params.name, "discovery/component-inventory.json", "DOMAIN_DISCOVERY_COMPONENT_INVENTORY_MISSING", res);
});

router.get("/:name/discovery/:artifact", (req, res) => {
  const pack = getDomainPack(req.params.name);
  if (!pack) return res.status(404).json({ error: "DOMAIN_NOT_FOUND" });
  return res.status(404).json({ error: "DOMAIN_DISCOVERY_ARTIFACT_NOT_EXPOSED" });
});

export default router;
