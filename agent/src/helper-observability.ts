import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type HelperObservationEventType =
  | "action_event"
  | "ui_state_node"
  | "navigation_transition"
  | "locator_attempt"
  | "blocker_event"
  | "evidence_contract_gap";

export type HelperObservationSeverity = "debug" | "info" | "warning" | "blocked" | "error";

type HelperObservationBase = {
  schemaVersion: "helper-observation-v1";
  eventId: string;
  eventType: HelperObservationEventType;
  runId: string;
  caseId: string | null;
  domain: string;
  domainPackVersion: string | null;
  helperAction: string | null;
  operationTemplate: string | null;
  agentVersion: string | null;
  appUrl: string | null;
  timestamp: string;
  severity: HelperObservationSeverity;
};

export type HelperObservationRecord = HelperObservationBase & {
  data: Record<string, unknown>;
  domainExtension?: {
    namespace: string;
    data: Record<string, unknown>;
  };
};

export type HelperObservationInput = {
  eventType: HelperObservationEventType;
  severity?: HelperObservationSeverity;
  appUrl?: string | null;
  helperAction?: string | null;
  operationTemplate?: string | null;
  data?: Record<string, unknown>;
  domainExtension?: {
    namespace: string;
    data: Record<string, unknown>;
  };
};

export type HelperObservationWriter = {
  write(input: HelperObservationInput): void;
};

type HelperObservationContext = {
  runDir: string;
  runId: string;
  caseId: string | null;
  domain: string;
  domainPackVersion: string | null;
  helperAction: string | null;
  operationTemplate: string | null;
  agentVersion: string | null;
};

type ObservationSummary = {
  schemaVersion: "helper-observation-summary-v1";
  observationSchemaVersion: "helper-observation-v1";
  runId: string;
  generatedAt: string;
  updatedAt: string;
  countsByEventType: Partial<Record<HelperObservationEventType, number>>;
  countsBySeverity: Partial<Record<HelperObservationSeverity, number>>;
  files: Partial<Record<HelperObservationEventType, string>>;
  latestEvents: Array<{
    eventId: string;
    eventType: HelperObservationEventType;
    timestamp: string;
    severity: HelperObservationSeverity;
    helperAction: string | null;
    appUrl: string | null;
  }>;
  policy: string;
};

const eventTypeFileNames: Record<HelperObservationEventType, string> = {
  action_event: "action-events.jsonl",
  ui_state_node: "ui-state-nodes.jsonl",
  navigation_transition: "navigation-transitions.jsonl",
  locator_attempt: "locator-attempts.jsonl",
  blocker_event: "blocker-events.jsonl",
  evidence_contract_gap: "evidence-contract-gaps.jsonl"
};

const safeReadJson = (filePath: string): unknown | null => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const getRecord = (value: unknown, key: string): Record<string, unknown> | null => {
  const record = asRecord(value);
  return record ? asRecord(record[key]) : null;
};

const getString = (value: unknown, key: string): string | null => {
  const record = asRecord(value);
  const raw = record?.[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
};

const firstString = (...values: Array<string | null | undefined>): string | null => {
  for (const value of values) {
    if (value?.trim()) return value.trim();
  }
  return null;
};

const readDispatchPayload = (runDir: string): Record<string, unknown> | null => {
  const dispatch = safeReadJson(path.join(runDir, "input", "dispatch.json"));
  return getRecord(dispatch, "payload");
};

const readCurrentCasePack = (runDir: string): Record<string, unknown> | null =>
  asRecord(safeReadJson(path.join(runDir, "input", "current-case-pack.json")));

const readAgentVersion = (): string | null => {
  const packageJson = safeReadJson(path.join(__dirname, "..", "package.json"));
  return getString(packageJson, "version");
};

const inferDomainPackVersion = (runDir: string): string | null => {
  const locatorRegistry = safeReadJson(path.join(runDir, "input", "domain_locator_registry.json"));
  const resultAdapter = safeReadJson(path.join(runDir, "input", "domain_result_parser_adapter.json"));
  const uiContract = safeReadJson(path.join(runDir, "input", "domain_ui_contract.json"));
  const evidenceSchema = safeReadJson(path.join(runDir, "input", "domain_evidence_schema.json"));
  return firstString(
    getString(uiContract, "version"),
    getString(uiContract, "schemaVersion"),
    getString(locatorRegistry, "version"),
    getString(locatorRegistry, "schemaVersion"),
    getString(resultAdapter, "version"),
    getString(resultAdapter, "schemaVersion"),
    getString(evidenceSchema, "version"),
    getString(evidenceSchema, "schemaVersion")
  );
};

const inferObservationContext = (options: {
  runDir: string;
  caseId?: string | null;
  action?: string | null;
  params?: Record<string, unknown>;
}): HelperObservationContext => {
  const runId = path.basename(path.resolve(options.runDir));
  const dispatchPayload = readDispatchPayload(options.runDir);
  const currentCasePack = readCurrentCasePack(options.runDir);
  const helperHints = getRecord(currentCasePack, "helperHints");
  const paramsOperationTemplate = typeof options.params?.operationTemplate === "string" ? options.params.operationTemplate : null;
  return {
    runDir: options.runDir,
    runId,
    caseId: options.caseId?.trim() || getString(getRecord(currentCasePack, "currentCase"), "caseNo"),
    domain: firstString(getString(dispatchPayload, "domain"), getString(currentCasePack, "domain")) ?? "unknown",
    domainPackVersion: inferDomainPackVersion(options.runDir),
    helperAction: options.action?.trim() || null,
    operationTemplate: firstString(paramsOperationTemplate, getString(helperHints, "operationTemplate")),
    agentVersion: readAgentVersion()
  };
};

const observationRoot = (runDir: string): string => path.join(runDir, "output", "helper-observability");

const readSummary = (filePath: string, runId: string): ObservationSummary => {
  const now = new Date().toISOString();
  const existing = asRecord(safeReadJson(filePath));
  if (existing?.schemaVersion === "helper-observation-summary-v1") {
    return {
      schemaVersion: "helper-observation-summary-v1",
      observationSchemaVersion: "helper-observation-v1",
      runId,
      generatedAt: getString(existing, "generatedAt") ?? now,
      updatedAt: now,
      countsByEventType: (asRecord(existing.countsByEventType) as ObservationSummary["countsByEventType"] | null) ?? {},
      countsBySeverity: (asRecord(existing.countsBySeverity) as ObservationSummary["countsBySeverity"] | null) ?? {},
      files: (asRecord(existing.files) as ObservationSummary["files"] | null) ?? {},
      latestEvents: Array.isArray(existing.latestEvents)
        ? existing.latestEvents.filter((item): item is ObservationSummary["latestEvents"][number] => Boolean(asRecord(item))).slice(-25)
        : [],
      policy: getString(existing, "policy") ??
        "Raw helper observations are diagnostic material. They must be reviewed and promoted into approved domain packs, locator registries, or action plans before runtime reuse."
    };
  }
  return {
    schemaVersion: "helper-observation-summary-v1",
    observationSchemaVersion: "helper-observation-v1",
    runId,
    generatedAt: now,
    updatedAt: now,
    countsByEventType: {},
    countsBySeverity: {},
    files: {},
    latestEvents: [],
    policy: "Raw helper observations are diagnostic material. They must be reviewed and promoted into approved domain packs, locator registries, or action plans before runtime reuse."
  };
};

const writeObservation = (context: HelperObservationContext, input: HelperObservationInput): void => {
  const root = observationRoot(context.runDir);
  fs.mkdirSync(root, { recursive: true });
  const timestamp = new Date().toISOString();
  const record: HelperObservationRecord = {
    schemaVersion: "helper-observation-v1",
    eventId: crypto.randomUUID(),
    eventType: input.eventType,
    runId: context.runId,
    caseId: context.caseId,
    domain: context.domain,
    domainPackVersion: context.domainPackVersion,
    helperAction: input.helperAction ?? context.helperAction,
    operationTemplate: input.operationTemplate ?? context.operationTemplate,
    agentVersion: context.agentVersion,
    appUrl: input.appUrl ?? null,
    timestamp,
    severity: input.severity ?? "info",
    data: input.data ?? {},
    ...(input.domainExtension ? { domainExtension: input.domainExtension } : {})
  };

  const fileName = eventTypeFileNames[input.eventType];
  const filePath = path.join(root, fileName);
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);

  const summaryPath = path.join(root, "observation-summary.json");
  const summary = readSummary(summaryPath, context.runId);
  summary.updatedAt = timestamp;
  summary.countsByEventType[input.eventType] = (summary.countsByEventType[input.eventType] ?? 0) + 1;
  summary.countsBySeverity[record.severity] = (summary.countsBySeverity[record.severity] ?? 0) + 1;
  summary.files[input.eventType] = path.relative(context.runDir, filePath);
  summary.latestEvents = [
    ...summary.latestEvents,
    {
      eventId: record.eventId,
      eventType: record.eventType,
      timestamp,
      severity: record.severity,
      helperAction: record.helperAction,
      appUrl: record.appUrl
    }
  ].slice(-25);
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
};

export const createHelperObservationWriter = (options: {
  runDir: string;
  caseId?: string | null;
  action?: string | null;
  params?: Record<string, unknown>;
}): HelperObservationWriter => {
  const context = inferObservationContext(options);
  return {
    write(input: HelperObservationInput): void {
      try {
        writeObservation(context, input);
      } catch {
        // Observability must never affect helper execution or UAT evidence collection.
      }
    }
  };
};
