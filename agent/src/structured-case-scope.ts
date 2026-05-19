import fs from "node:fs";
import path from "node:path";
import type { CaseManifestCase } from "./case-manifest";
import type { HelperHints } from "./helper-hints";

export type StructuredCaseScopeIntent =
  | "frontend_observation"
  | "preview_execution"
  | "download_execution"
  | "report_mutation_flow"
  | "unknown";
export type StructuredCaseTestTarget =
  | "frontend_presentation"
  | "backend_function"
  | "frontend_backend_integration"
  | "functional_flow"
  | "unknown";
export type StructuredActionRole = "precondition" | "under_test" | "verification" | "cleanup";
export type StructuredExpectedOutcome =
  | "succeeded"
  | "disabled_or_no_change"
  | "visible"
  | "hidden"
  | "text_matches"
  | "value_matches"
  | "selected"
  | "checked"
  | "unchecked"
  | "state_changed"
  | "state_unchanged"
  | "request_sent"
  | "request_not_sent"
  | "download_started"
  | "toast_visible"
  | "tooltip_visible";

export type StructuredEvidenceRequirements = {
  flow?: string[];
  outcome?: string[];
  observation?: string[];
  network?: string[];
  artifact?: string[];
};

export type StructuredCaseScopeAction = {
  actionId: string;
  action: string;
  target: string;
  role: StructuredActionRole;
  expectedOutcome: StructuredExpectedOutcome;
  requiredForPass: boolean;
  evidenceRequirements: string[];
  knownProductGap?: string;
};

export type StructuredCaseScopeContract = {
  version: "v1";
  source: string;
  domain: "BI_OFFICIAL_UI_COLLAGE";
  caseNo: string;
  routeIntent: StructuredCaseScopeIntent;
  testTarget: StructuredCaseTestTarget;
  requiresEditor: boolean;
  observationType: string | null;
  requiredActions: StructuredCaseScopeAction[];
  evidenceRequirements: StructuredEvidenceRequirements;
  judgmentPolicy: {
    failWhen: string[];
    blockedWhen: string[];
  };
};

type RuntimeContractFile = {
  schemaVersion?: string;
  domain?: string;
  contracts?: unknown[];
};

type RuntimeContractRecord = Omit<StructuredCaseScopeContract, "version" | "source" | "domain">;

const normalizeCaseNo = (value: string | null | undefined): string =>
  (value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/^DEMO-/i, "")
    .toUpperCase();

const projectRootCandidates = (): string[] => [
  process.cwd(),
  path.resolve(__dirname, "../.."),
  path.resolve(__dirname, "../../..")
];

const contractFileCandidates = (currentCase: CaseManifestCase | null): string[] => {
  const relative = path.join("domain-packs", "BI_OFFICIAL_UI_COLLAGE", "case-scope-runtime-contracts.json");
  const inputRelative = path.join("input", "domain_case_scope_contracts.json");
  const candidates = new Set<string>();
  if (currentCase?.currentCaseFile && path.isAbsolute(currentCase.currentCaseFile)) {
    const caseDir = path.dirname(currentCase.currentCaseFile);
    const inputDir = path.basename(caseDir) === "cases" ? path.dirname(caseDir) : caseDir;
    candidates.add(path.join(inputDir, "domain_case_scope_contracts.json"));
  }
  for (const root of projectRootCandidates()) {
    candidates.add(path.join(root, inputRelative));
    candidates.add(path.join(root, relative));
  }
  return [...candidates];
};

const cachedContracts = new Map<string, Map<string, StructuredCaseScopeContract>>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];

const sanitizeAction = (value: unknown): StructuredCaseScopeAction | null => {
  if (!isRecord(value)) return null;
  const actionId = typeof value.actionId === "string" ? value.actionId.trim() : "";
  const action = typeof value.action === "string" ? value.action.trim() : "";
  const target = typeof value.target === "string" ? value.target.trim() : "";
  const role = typeof value.role === "string" ? value.role.trim() : "";
  const expectedOutcome = typeof value.expectedOutcome === "string" ? value.expectedOutcome.trim() : "";
  if (!actionId || !action || !target || !role || !expectedOutcome) return null;
  return {
    actionId,
    action,
    target,
    role: role as StructuredActionRole,
    expectedOutcome: expectedOutcome as StructuredExpectedOutcome,
    requiredForPass: value.requiredForPass !== false,
    evidenceRequirements: stringArray(value.evidenceRequirements),
    ...(typeof value.knownProductGap === "string" && value.knownProductGap.trim()
      ? { knownProductGap: value.knownProductGap.trim() }
      : {})
  };
};

const sanitizeEvidenceRequirements = (value: unknown): StructuredEvidenceRequirements => {
  if (!isRecord(value)) return {};
  return {
    flow: stringArray(value.flow),
    outcome: stringArray(value.outcome),
    observation: stringArray(value.observation),
    network: stringArray(value.network),
    artifact: stringArray(value.artifact)
  };
};

const sanitizeContract = (value: unknown): StructuredCaseScopeContract | null => {
  if (!isRecord(value)) return null;
  const caseNo = typeof value.caseNo === "string" ? value.caseNo.trim() : "";
  const routeIntent = typeof value.routeIntent === "string" ? value.routeIntent.trim() : "";
  const testTarget = typeof value.testTarget === "string" ? value.testTarget.trim() : "";
  const actions = Array.isArray(value.requiredActions)
    ? value.requiredActions.map(sanitizeAction).filter((item): item is StructuredCaseScopeAction => Boolean(item))
    : [];
  if (!caseNo || !routeIntent || actions.length === 0) return null;
  const judgmentPolicy = isRecord(value.judgmentPolicy) ? value.judgmentPolicy : {};
  return {
    version: "v1",
    source: "domain-packs/BI_OFFICIAL_UI_COLLAGE/case-scope-runtime-contracts.json",
    domain: "BI_OFFICIAL_UI_COLLAGE",
    caseNo,
    routeIntent: routeIntent as StructuredCaseScopeIntent,
    testTarget: (testTarget || "unknown") as StructuredCaseTestTarget,
    requiresEditor: value.requiresEditor === true,
    observationType: typeof value.observationType === "string" && value.observationType.trim() ? value.observationType.trim() : null,
    requiredActions: actions,
    evidenceRequirements: sanitizeEvidenceRequirements(value.evidenceRequirements),
    judgmentPolicy: {
      failWhen: stringArray(judgmentPolicy.failWhen),
      blockedWhen: stringArray(judgmentPolicy.blockedWhen)
    }
  };
};

const loadContracts = (currentCase: CaseManifestCase | null): Map<string, StructuredCaseScopeContract> => {
  const candidates = contractFileCandidates(currentCase);
  const cacheKey = candidates.join("|");
  const cached = cachedContracts.get(cacheKey);
  if (cached) return cached;
  const contracts = new Map<string, StructuredCaseScopeContract>();
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as RuntimeContractFile;
      for (const raw of parsed.contracts ?? []) {
        const contract = sanitizeContract(raw as RuntimeContractRecord);
        if (contract) contracts.set(normalizeCaseNo(contract.caseNo), contract);
      }
      if (contracts.size > 0) {
        cachedContracts.set(cacheKey, contracts);
        return contracts;
      }
    } catch {
      cachedContracts.set(cacheKey, contracts);
      return contracts;
    }
  }
  cachedContracts.set(cacheKey, contracts);
  return contracts;
};

export const inferStructuredCaseScope = (
  currentCase: CaseManifestCase | null,
  helperHints: HelperHints | null
): StructuredCaseScopeContract | null => {
  const caseNo = normalizeCaseNo(currentCase?.caseNo ?? helperHints?.caseId);
  if (!caseNo) return null;
  return loadContracts(currentCase).get(caseNo) ?? null;
};

export const structuredEvidenceList = (contract: StructuredCaseScopeContract | null): string[] => {
  if (!contract) return [];
  const evidence = new Set<string>();
  for (const values of Object.values(contract.evidenceRequirements)) {
    for (const item of values ?? []) evidence.add(item);
  }
  for (const action of contract.requiredActions) {
    for (const item of action.evidenceRequirements) evidence.add(item);
  }
  return [...evidence];
};

export const structuredTargetIds = (contract: StructuredCaseScopeContract | null): string[] =>
  contract ? [...new Set(contract.requiredActions.map((item) => item.target))] : [];

export const structuredExpectedOutcomes = (contract: StructuredCaseScopeContract | null): string[] =>
  contract ? [...new Set(contract.requiredActions.map((item) => item.expectedOutcome))] : [];
