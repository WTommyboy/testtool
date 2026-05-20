import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type JsonObject = Record<string, any>;

const root = process.cwd();
const packDir = path.join(root, "domain-packs", "BI_OFFICIAL_UI_COLLAGE");

const readJson = <T = JsonObject>(relativePath: string): T =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8")) as T;

const readText = (relativePath: string): string => fs.readFileSync(path.join(root, relativePath), "utf8");

const actionContractPaths = [
  "domain-packs/BI_OFFICIAL_UI_COLLAGE/action-contracts/reportLifecycle.json",
  "domain-packs/BI_OFFICIAL_UI_COLLAGE/action-contracts/projectLifecycle.json",
  "domain-packs/BI_OFFICIAL_UI_COLLAGE/action-contracts/projectList.json",
  "domain-packs/BI_OFFICIAL_UI_COLLAGE/action-contracts/dateRangePanel.json"
];

const collectTargets = (value: unknown, output: string[] = []): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) collectTargets(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  const item = value as JsonObject;
  if (typeof item.target === "string") output.push(item.target);
  for (const child of Object.values(item)) collectTargets(child, output);
  return output;
};

const collectEvidenceRefs = (value: unknown, output: string[] = []): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) collectEvidenceRefs(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  const item = value as JsonObject;
  for (const key of ["requiredEvidence", "evidenceRequirements"]) {
    if (Array.isArray(item[key])) {
      for (const ref of item[key]) {
        if (typeof ref === "string") output.push(ref);
      }
    }
  }
  for (const child of Object.values(item)) collectEvidenceRefs(child, output);
  return output;
};

const main = (): void => {
  assert(fs.existsSync(packDir), "BI_OFFICIAL_UI_COLLAGE pack must exist");

  const uiContract = readJson("domain-packs/BI_OFFICIAL_UI_COLLAGE/ui-contract.json");
  const evidenceSchema = readJson("domain-packs/BI_OFFICIAL_UI_COLLAGE/evidence-schema.json");
  const lintRules = readJson("domain-packs/BI_OFFICIAL_UI_COLLAGE/lint-rules.json");
  const vocabulary = readJson("domain-packs/BI_OFFICIAL_UI_COLLAGE/ui-object-vocabulary.json");

  const actionEntries = new Map((uiContract.actions ?? []).map((item: JsonObject) => [item.id, item]));
  for (const actionId of ["reportLifecycle", "projectLifecycle", "projectList", "dateRangePanel"]) {
    assert(actionEntries.has(actionId), `ui-contract missing shared lifecycle action ${actionId}`);
  }

  const objectIds = new Set((vocabulary.objects ?? []).map((item: JsonObject) => item.id).filter(Boolean));
  const evidenceIds = new Set(Object.keys(evidenceSchema.evidenceObjects ?? {}));
  const abstractTargets = new Set([
    "dateRange.preset",
    "reportPersistence.reopenState"
  ]);

  for (const relativePath of actionContractPaths) {
    const contract = readJson(relativePath);
    assert.equal(contract.schemaVersion, "domain-action-contract-v0.1", `${relativePath} schemaVersion drift`);
    assert.equal(contract.domain, "BI_OFFICIAL_UI_COLLAGE", `${relativePath} domain drift`);
    assert(contract.action, `${relativePath} missing action`);
    assert(contract.sharedFlows && Object.keys(contract.sharedFlows).length > 0, `${relativePath} must define sharedFlows`);
    assert(Array.isArray(contract.requiredEvidence) && contract.requiredEvidence.length > 0, `${relativePath} missing requiredEvidence`);
    assert(Array.isArray(contract.blockerCodes) && contract.blockerCodes.length > 0, `${relativePath} missing blockerCodes`);
    assert(contract.judgmentPolicy?.failWhen?.length > 0, `${relativePath} missing failWhen policy`);
    assert(contract.judgmentPolicy?.blockedWhen?.length > 0, `${relativePath} missing blockedWhen policy`);

    for (const evidenceRef of new Set(collectEvidenceRefs(contract))) {
      assert(evidenceIds.has(evidenceRef), `${relativePath} references missing evidence object ${evidenceRef}`);
    }

    for (const target of new Set(collectTargets(contract))) {
      if (target.includes("From")) continue;
      if (abstractTargets.has(target)) continue;
      assert(objectIds.has(target), `${relativePath} references missing UI object target ${target}`);
    }
  }

  const rowObject = (vocabulary.objects ?? []).find((item: JsonObject) => item.id === "projectList.reportRow");
  assert(rowObject?.supportedActions?.includes("select"), "projectList.reportRow must support select for toolbar-selection lifecycle");

  const requiredEvidenceObjects = [
    "projectList.readiness.state",
    "projectToolbar.selectionFlow.state",
    "deleteConfirmModal.state",
    "projectList.deleteCancelFlow.state",
    "projectCreateModal.flow.state",
    "dateRange.button.state",
    "dateRange.applyPreset.state"
  ];
  for (const evidenceObject of requiredEvidenceObjects) {
    assert(evidenceIds.has(evidenceObject), `evidence-schema missing shared lifecycle object ${evidenceObject}`);
  }

  const requiredLintRules = [
    "BI_OFFICIAL_COLLAGE_SHARED_LIFECYCLE_ACTION_REQUIRED",
    "BI_OFFICIAL_COLLAGE_REPORT_LIFECYCLE_ROW_EVIDENCE_REQUIRED",
    "BI_OFFICIAL_COLLAGE_DELETE_CANCEL_FLOW_REQUIRED",
    "BI_OFFICIAL_COLLAGE_DATE_LIFECYCLE_EVIDENCE_REQUIRED"
  ];
  const lintIds = new Set((lintRules.rules ?? []).map((item: JsonObject) => item.id));
  for (const ruleId of requiredLintRules) {
    assert(lintIds.has(ruleId), `lint-rules missing ${ruleId}`);
  }

  for (const docPath of [
    "docs/authoring/domain-pack-templates/domain_pack_completion_checklist.md",
    "docs/authoring/domain-pack-templates/domain_intake_template.md",
    "docs/authoring/domain-pack-templates/claude_testcase_request_template.md",
    "docs/authoring/domain-pack-templates/boundary_rules_template.md"
  ]) {
    const content = readText(docPath);
    assert(/Shared Lifecycle|shared lifecycle|生命週期|user journeys/.test(content), `${docPath} missing shared lifecycle authoring guidance`);
  }

  console.log(JSON.stringify({
    ok: true,
    actionContracts: actionContractPaths.map((item) => path.basename(item)),
    evidenceObjects: requiredEvidenceObjects,
    lintRules: requiredLintRules
  }, null, 2));
};

main();
