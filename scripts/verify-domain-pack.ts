import fs from "node:fs";
import path from "node:path";

const requiredFiles = ["AGENTS.md", "xlsx_schema.json", "result_parser_adapter.json", "startup_prompt_template.md"] as const;
const recommendedFiles = ["README.md", "locators/README.md", "locators/demo001-locator-registry.json"] as const;
const contractFiles = [
  "ui-contract.json",
  "ui-object-vocabulary.json",
  "action-contracts/setMetricRows.json",
  "action-contracts/observeFrontendState.json",
  "evidence-schema.json",
  "lint-rules.json",
  "discovery/page-map.json",
  "discovery/component-inventory.json",
  "discovery/visual-alignment.json"
] as const;

type Finding = {
  level: "error" | "warning";
  message: string;
};

const parseNameArg = (): string | null => {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--name") return args[i + 1] ?? null;
    if (args[i] === "--help" || args[i] === "-h") {
      console.log(`Usage:
  npm run verify:domain-pack -- --name <DOMAIN>

If --name is omitted, all domain packs are verified.
`);
      process.exit(0);
    }
  }
  return null;
};

const parseJson = (filePath: string, findings: Finding[]): Record<string, unknown> | null => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    findings.push({ level: "error", message: `${path.relative(process.cwd(), filePath)} is not valid JSON: ${(error as Error).message}` });
    return null;
  }
};

const includesAny = (content: string, needles: string[]): boolean => {
  const normalized = content.toLowerCase();
  return needles.some((needle) => normalized.includes(needle.toLowerCase()));
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const asRecordArray = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? value.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)) : [];

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];

const requireString = (findings: Finding[], relPath: string, json: Record<string, unknown>, field: string): void => {
  const value = json[field];
  if (typeof value !== "string" || !value.trim()) {
    findings.push({ level: "error", message: `${relPath} missing string field: ${field}` });
  }
};

const requireRecord = (findings: Finding[], relPath: string, json: Record<string, unknown>, field: string): Record<string, unknown> | null => {
  const record = asRecord(json[field]);
  if (!record) findings.push({ level: "error", message: `${relPath} missing object field: ${field}` });
  return record;
};

const requireRecordArray = (findings: Finding[], relPath: string, json: Record<string, unknown>, field: string): Array<Record<string, unknown>> => {
  const records = asRecordArray(json[field]);
  if (records.length === 0) findings.push({ level: "error", message: `${relPath} missing non-empty array field: ${field}` });
  return records;
};

const requireStringArray = (findings: Finding[], relPath: string, json: Record<string, unknown>, field: string): string[] => {
  const values = stringArray(json[field]);
  if (values.length === 0) findings.push({ level: "error", message: `${relPath} missing non-empty string array field: ${field}` });
  return values;
};

const validateUiContract = (relPath: string, json: Record<string, unknown>, findings: Finding[]): void => {
  requireString(findings, relPath, json, "schemaVersion");
  requireString(findings, relPath, json, "domain");
  const pages = requireRecordArray(findings, relPath, json, "pages");
  const components = requireRecordArray(findings, relPath, json, "components");
  const actions = requireRecordArray(findings, relPath, json, "actions");
  for (const [index, page] of pages.entries()) {
    requireString(findings, `${relPath} pages[${index}]`, page, "id");
    requireStringArray(findings, `${relPath} pages[${index}]`, page, "routePatterns");
    requireStringArray(findings, `${relPath} pages[${index}]`, page, "components");
  }
  for (const [index, component] of components.entries()) {
    requireString(findings, `${relPath} components[${index}]`, component, "id");
    requireString(findings, `${relPath} components[${index}]`, component, "type");
    requireStringArray(findings, `${relPath} components[${index}]`, component, "locatorStrategies");
  }
  for (const [index, action] of actions.entries()) {
    requireString(findings, `${relPath} actions[${index}]`, action, "id");
    requireString(findings, `${relPath} actions[${index}]`, action, "contractFile");
    requireStringArray(findings, `${relPath} actions[${index}]`, action, "capabilities");
  }
};

const validateUiObjectVocabulary = (relPath: string, json: Record<string, unknown>, findings: Finding[]): void => {
  requireString(findings, relPath, json, "schemaVersion");
  requireString(findings, relPath, json, "domain");
  const objects = requireRecordArray(findings, relPath, json, "objects");
  const seenIds = new Set<string>();
  for (const [index, object] of objects.entries()) {
    const scopedPath = `${relPath} objects[${index}]`;
    requireString(findings, scopedPath, object, "id");
    requireString(findings, scopedPath, object, "page");
    requireString(findings, scopedPath, object, "component");
    requireString(findings, scopedPath, object, "objectType");
    requireStringArray(findings, scopedPath, object, "aliases");
    requireStringArray(findings, scopedPath, object, "supportedActions");
    requireStringArray(findings, scopedPath, object, "evidenceObjects");
    const id = typeof object.id === "string" ? object.id : null;
    if (id) {
      if (seenIds.has(id)) findings.push({ level: "error", message: `${relPath} duplicate object id: ${id}` });
      seenIds.add(id);
    }
  }
};

const validateSetMetricRowsContract = (relPath: string, json: Record<string, unknown>, findings: Finding[]): void => {
  requireString(findings, relPath, json, "schemaVersion");
  requireString(findings, relPath, json, "domain");
  if (json.action !== "setMetricRows") {
    findings.push({ level: "error", message: `${relPath} action must be setMetricRows` });
  }
  const paramsSchema = requireRecord(findings, relPath, json, "paramsSchema");
  if (paramsSchema && !stringArray(paramsSchema.required).includes("metrics")) {
    findings.push({ level: "error", message: `${relPath} paramsSchema.required must include metrics` });
  }
  requireRecordArray(findings, relPath, json, "declarativePlan");
  requireStringArray(findings, relPath, json, "requiredEvidence");
  const blockerCodes = requireStringArray(findings, relPath, json, "blockerCodes");
  for (const expected of ["FIELD_PICKER_STALE_AFTER_SOURCE_CHANGE", "FIELD_PICKER_SOURCE_MISMATCH"]) {
    if (!blockerCodes.includes(expected)) {
      findings.push({ level: "error", message: `${relPath} blockerCodes must include ${expected}` });
    }
  }
};

const validateObserveFrontendStateContract = (relPath: string, json: Record<string, unknown>, findings: Finding[]): void => {
  requireString(findings, relPath, json, "schemaVersion");
  requireString(findings, relPath, json, "domain");
  if (json.action !== "observeFrontendState") {
    findings.push({ level: "error", message: `${relPath} action must be observeFrontendState` });
  }
  const paramsSchema = requireRecord(findings, relPath, json, "paramsSchema");
  if (paramsSchema && !stringArray(paramsSchema.required).includes("observationType")) {
    findings.push({ level: "error", message: `${relPath} paramsSchema.required must include observationType` });
  }
  const observationTypes = requireRecord(findings, relPath, json, "observationTypes");
  if (observationTypes) {
    for (const expected of ["userButton", "projectToolbar", "reportModeRadio", "datePanel", "validationMessage"]) {
      if (!asRecord(observationTypes[expected])) {
        findings.push({ level: "error", message: `${relPath} observationTypes must include ${expected}` });
      }
    }
  }
  requireRecordArray(findings, relPath, json, "declarativePlan");
  requireStringArray(findings, relPath, json, "requiredEvidence");
};

const validateEvidenceSchema = (relPath: string, json: Record<string, unknown>, findings: Finding[]): void => {
  requireString(findings, relPath, json, "schemaVersion");
  requireString(findings, relPath, json, "domain");
  const evidenceObjects = requireRecord(findings, relPath, json, "evidenceObjects");
  if (evidenceObjects && !asRecord(evidenceObjects["toolBridge.response"])) {
    findings.push({ level: "error", message: `${relPath} evidenceObjects must define toolBridge.response` });
  }
  const rules = requireRecordArray(findings, relPath, json, "conditionalEvidenceRules");
  if (!rules.some((rule) => stringArray(rule.requires).includes("toolBridge.response"))) {
    findings.push({ level: "error", message: `${relPath} conditionalEvidenceRules must include a toolBridge.response requirement` });
  }
};

const validateLintRules = (relPath: string, json: Record<string, unknown>, findings: Finding[]): void => {
  requireString(findings, relPath, json, "schemaVersion");
  requireString(findings, relPath, json, "domain");
  const rules = requireRecordArray(findings, relPath, json, "rules");
  for (const [index, rule] of rules.entries()) {
    requireString(findings, `${relPath} rules[${index}]`, rule, "id");
    requireString(findings, `${relPath} rules[${index}]`, rule, "severity");
    if (!Array.isArray(rule.require) && !Array.isArray(rule.forbid)) {
      findings.push({ level: "error", message: `${relPath} rules[${index}] must define require or forbid` });
    }
  }
};

const validateDiscoveryPageMap = (relPath: string, json: Record<string, unknown>, findings: Finding[]): void => {
  requireString(findings, relPath, json, "schemaVersion");
  requireString(findings, relPath, json, "domain");
  const pages = requireRecordArray(findings, relPath, json, "pages");
  for (const [index, page] of pages.entries()) {
    requireString(findings, `${relPath} pages[${index}]`, page, "id");
    requireString(findings, `${relPath} pages[${index}]`, page, "routePattern");
    requireStringArray(findings, `${relPath} pages[${index}]`, page, "expectedSignals");
  }
};

const validateDiscoveryComponentInventory = (relPath: string, json: Record<string, unknown>, findings: Finding[]): void => {
  requireString(findings, relPath, json, "schemaVersion");
  requireString(findings, relPath, json, "domain");
  const components = requireRecordArray(findings, relPath, json, "components");
  for (const [index, component] of components.entries()) {
    requireString(findings, `${relPath} components[${index}]`, component, "id");
    requireString(findings, `${relPath} components[${index}]`, component, "page");
    requireString(findings, `${relPath} components[${index}]`, component, "type");
    requireStringArray(findings, `${relPath} components[${index}]`, component, "candidateSignals");
  }
};

const validateDiscoveryVisualAlignment = (relPath: string, json: Record<string, unknown>, findings: Finding[]): void => {
  requireString(findings, relPath, json, "schemaVersion");
  requireString(findings, relPath, json, "domain");
  const sources = requireRecordArray(findings, relPath, json, "sources");
  const objectEvidence = requireRecord(findings, relPath, json, "objectEvidence");
  const sourceIds = new Set<string>();
  for (const [index, source] of sources.entries()) {
    requireString(findings, `${relPath} sources[${index}]`, source, "id");
    requireString(findings, `${relPath} sources[${index}]`, source, "path");
    requireStringArray(findings, `${relPath} sources[${index}]`, source, "observedObjects");
    if (typeof source.id === "string") sourceIds.add(source.id);
  }
  if (objectEvidence) {
    for (const [objectId, evidence] of Object.entries(objectEvidence)) {
      const scopedPath = `${relPath} objectEvidence.${objectId}`;
      const evidenceRecord = asRecord(evidence);
      if (!evidenceRecord) {
        findings.push({ level: "error", message: `${scopedPath} must be an object` });
        continue;
      }
      requireString(findings, scopedPath, evidenceRecord, "status");
      requireString(findings, scopedPath, evidenceRecord, "screenContext");
      requireStringArray(findings, scopedPath, evidenceRecord, "visualCues");
      for (const sourceId of stringArray(evidenceRecord.sourceIds)) {
        if (!sourceIds.has(sourceId)) {
          findings.push({ level: "error", message: `${scopedPath} references unknown sourceId ${sourceId}` });
        }
      }
    }
  }
};

const validateContractFile = (relPath: string, json: Record<string, unknown>, findings: Finding[]): void => {
  if (relPath.endsWith("ui-contract.json")) validateUiContract(relPath, json, findings);
  if (relPath.endsWith("ui-object-vocabulary.json")) validateUiObjectVocabulary(relPath, json, findings);
  if (relPath.endsWith("action-contracts/setMetricRows.json")) validateSetMetricRowsContract(relPath, json, findings);
  if (relPath.endsWith("action-contracts/observeFrontendState.json")) validateObserveFrontendStateContract(relPath, json, findings);
  if (relPath.endsWith("evidence-schema.json")) validateEvidenceSchema(relPath, json, findings);
  if (relPath.endsWith("lint-rules.json")) validateLintRules(relPath, json, findings);
  if (relPath.endsWith("discovery/page-map.json")) validateDiscoveryPageMap(relPath, json, findings);
  if (relPath.endsWith("discovery/component-inventory.json")) validateDiscoveryComponentInventory(relPath, json, findings);
  if (relPath.endsWith("discovery/visual-alignment.json")) validateDiscoveryVisualAlignment(relPath, json, findings);
};

const verifyPack = (packDir: string): Finding[] => {
  const findings: Finding[] = [];
  const relPackDir = path.relative(process.cwd(), packDir);

  for (const fileName of requiredFiles) {
    const filePath = path.join(packDir, fileName);
    if (!fs.existsSync(filePath)) {
      findings.push({ level: "error", message: `${relPackDir} missing required file: ${fileName}` });
    }
  }

  if (findings.some((finding) => finding.level === "error")) return findings;

  const agents = fs.readFileSync(path.join(packDir, "AGENTS.md"), "utf8");
  const startup = fs.readFileSync(path.join(packDir, "startup_prompt_template.md"), "utf8");
  const schema = parseJson(path.join(packDir, "xlsx_schema.json"), findings);
  const adapter = parseJson(path.join(packDir, "result_parser_adapter.json"), findings);

  if (!includesAny(agents, ["scope"])) findings.push({ level: "warning", message: `${relPackDir}/AGENTS.md should describe scope` });
  if (!includesAny(agents, ["out of scope", "out-of-scope", "不測", "範圍外"])) {
    findings.push({ level: "warning", message: `${relPackDir}/AGENTS.md should describe out-of-scope` });
  }
  if (!includesAny(agents, ["irreversible", "不可逆", "delete", "刪除"])) {
    findings.push({ level: "warning", message: `${relPackDir}/AGENTS.md should define irreversible action policy` });
  }
  if (!includesAny(agents, ["visible ui", "真實 ui", "可見 ui", "ui operations"])) {
    findings.push({ level: "warning", message: `${relPackDir}/AGENTS.md should require visible UI execution` });
  }

  if (!includesAny(startup, ["one case", "one-case", "單題", "exactly one case"])) {
    findings.push({ level: "warning", message: `${relPackDir}/startup_prompt_template.md should mention one-case-at-a-time execution` });
  }
  if (!includesAny(startup, ["result.xlsx", "result workbook"])) {
    findings.push({ level: "warning", message: `${relPackDir}/startup_prompt_template.md should mention result workbook output` });
  }

  if (schema) {
    if (typeof schema.displayName !== "string" || schema.displayName.trim() === "") {
      findings.push({ level: "error", message: `${relPackDir}/xlsx_schema.json missing displayName` });
    }
    if (typeof schema.schemaVersion !== "string" || schema.schemaVersion.trim() === "") {
      findings.push({ level: "error", message: `${relPackDir}/xlsx_schema.json missing schemaVersion` });
    }
  }

  if (adapter) {
    const headers = adapter.headers as { cases?: unknown } | undefined;
    const hasCaseColumns = Array.isArray(adapter.caseKeyColumns) || Array.isArray(headers?.cases);
    const hasResultContract = Array.isArray(adapter.resultValues) || typeof adapter.detailJsonRequiredFields === "object";
    if (!hasCaseColumns) {
      findings.push({ level: "warning", message: `${relPackDir}/result_parser_adapter.json should define case columns` });
    }
    if (!hasResultContract) {
      findings.push({ level: "warning", message: `${relPackDir}/result_parser_adapter.json should define result values or detailJsonRequiredFields` });
    }
  }

  for (const fileName of recommendedFiles) {
    const filePath = path.join(packDir, fileName);
    if (!fs.existsSync(filePath)) {
      findings.push({ level: "warning", message: `${relPackDir} optional file missing: ${fileName}` });
      continue;
    }
    if (fileName.endsWith(".json")) parseJson(filePath, findings);
  }

  for (const fileName of contractFiles) {
    const filePath = path.join(packDir, fileName);
    if (!fs.existsSync(filePath)) {
      if (path.basename(packDir) === "BI_OFFICIAL_UI_COLLAGE") {
        findings.push({ level: "warning", message: `${relPackDir} contract file missing: ${fileName}` });
      }
      continue;
    }
    const parsed = parseJson(filePath, findings);
    if (parsed) validateContractFile(path.relative(process.cwd(), filePath), parsed, findings);
  }

  return findings;
};

const main = (): void => {
  const requestedName = parseNameArg();
  const packsRoot = path.resolve(process.cwd(), "domain-packs");
  if (!fs.existsSync(packsRoot)) throw new Error(`domain-packs directory not found: ${packsRoot}`);

  const packDirs = fs
    .readdirSync(packsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packsRoot, entry.name))
    .filter((packDir) => !requestedName || path.basename(packDir) === requestedName)
    .sort();

  if (packDirs.length === 0) {
    throw new Error(requestedName ? `Domain pack not found: ${requestedName}` : "No domain packs found");
  }

  let errorCount = 0;
  let warningCount = 0;

  for (const packDir of packDirs) {
    const findings = verifyPack(packDir);
    const packName = path.basename(packDir);
    const errors = findings.filter((finding) => finding.level === "error");
    const warnings = findings.filter((finding) => finding.level === "warning");
    errorCount += errors.length;
    warningCount += warnings.length;

    if (findings.length === 0) {
      console.log(`PASS ${packName}`);
      continue;
    }

    console.log(`${errors.length === 0 ? "WARN" : "FAIL"} ${packName}`);
    for (const finding of findings) {
      console.log(`  ${finding.level.toUpperCase()}: ${finding.message}`);
    }
  }

  console.log(`\nDomain pack verification: ${errorCount} error(s), ${warningCount} warning(s)`);
  if (errorCount > 0) process.exit(1);
};

main();
