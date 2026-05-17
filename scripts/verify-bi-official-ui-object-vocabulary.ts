import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type JsonObject = Record<string, any>;

type UiObject = {
  id: string;
  page: string;
  component: string;
  objectType: string;
  aliases: string[];
  supportedActions: string[];
  evidenceObjects: string[];
  locatorHints?: string[];
};

type UiObjectVocabulary = {
  schemaVersion: string;
  domain: string;
  references?: Record<string, string>;
  objects: UiObject[];
};

type VisualAlignment = {
  schemaVersion: string;
  domain: string;
  sources: Array<{
    id: string;
    path: string;
    observedObjects: string[];
  }>;
  objectEvidence: Record<
    string,
    {
      status: string;
      sourceIds: string[];
      screenContext: string;
      visualCues: string[];
      visibleText?: string[];
    }
  >;
  needsHumanConfirmation?: Array<{
    objectId: string;
    reason: string;
  }>;
};

type CoverageFixture = {
  schemaVersion: string;
  requiredObjectsByCase: Array<{
    caseNo: string;
    objectIds: string[];
  }>;
};

const root = process.cwd();
const packDir = path.join(root, "domain-packs", "BI_OFFICIAL_UI_COLLAGE");

const readJson = <T>(filePath: string): T => JSON.parse(fs.readFileSync(filePath, "utf8")) as T;

const objectVocabularyPath = path.join(packDir, "ui-object-vocabulary.json");
const uiContractPath = path.join(packDir, "ui-contract.json");
const inventoryPath = path.join(packDir, "discovery", "component-inventory.json");
const evidenceSchemaPath = path.join(packDir, "evidence-schema.json");
const observeActionPath = path.join(packDir, "action-contracts", "observeFrontendState.json");
const platformActionPath = path.join(root, "contracts", "platform-action-vocabulary.v1.json");
const coverageFixturePath = path.join(root, "fixtures", "ui-object-vocabulary", "biui-collage-r001-p0-required-objects.json");
const visualAlignmentPath = path.join(packDir, "discovery", "visual-alignment.json");

const idsFrom = (items: JsonObject[], key = "id"): Set<string> =>
  new Set(items.map((item) => item[key]).filter((value): value is string => typeof value === "string" && value.length > 0));

const main = (): void => {
  const objectVocabularyRaw = fs.readFileSync(objectVocabularyPath, "utf8");
  assert(!/BIUI_COLLAGE_R001|P0_SCOPE|1762c1b2|Tommy/.test(objectVocabularyRaw), "domain ui-object vocabulary must not contain testcase/oracle/run-specific provenance");

  const objectVocabulary = readJson<UiObjectVocabulary>(objectVocabularyPath);
  const uiContract = readJson<JsonObject>(uiContractPath);
  const inventory = readJson<JsonObject>(inventoryPath);
  const evidenceSchema = readJson<JsonObject>(evidenceSchemaPath);
  const observeAction = readJson<JsonObject>(observeActionPath);
  const platformActions = readJson<JsonObject>(platformActionPath);
  const coverageFixture = readJson<CoverageFixture>(coverageFixturePath);
  const visualAlignment = readJson<VisualAlignment>(visualAlignmentPath);

  assert.equal(objectVocabulary.schemaVersion, "domain-ui-object-vocabulary-v0.1");
  assert.equal(objectVocabulary.domain, "BI_OFFICIAL_UI_COLLAGE");
  assert.equal(objectVocabulary.references?.visualAlignment, "discovery/visual-alignment.json", "ui-object vocabulary must reference visual alignment discovery data");
  assert(uiContract.uiObjectVocabulary?.file === "ui-object-vocabulary.json", "ui-contract must reference ui-object-vocabulary.json");
  assert.equal(coverageFixture.schemaVersion, "ui-object-coverage-fixture-v1");
  assert.equal(visualAlignment.schemaVersion, "domain-ui-object-visual-alignment-v0.1");
  assert.equal(visualAlignment.domain, "BI_OFFICIAL_UI_COLLAGE");

  const objects = objectVocabulary.objects;
  assert(objects.length >= 25, "official UI object vocabulary should cover leaf controls, messages, pickers, tabs, and toolbar buttons");

  const objectIds = idsFrom(objects);
  assert.equal(objectIds.size, objects.length, "ui object ids must be unique");

  const componentIds = idsFrom(inventory.components ?? []);
  const evidenceObjectIds = new Set(Object.keys(evidenceSchema.evidenceObjects ?? {}));
  const platformActionIds = idsFrom(platformActions.actions ?? []);
  const visualObjectIds = new Set(Object.keys(visualAlignment.objectEvidence ?? {}));
  const visualSourceIds = idsFrom(visualAlignment.sources ?? []);
  const allowedVisualStatuses = new Set(["confirmed", "inferredFromSameSurface", "notCaptured", "visualMismatchNeedsReview", "knownProductGap"]);
  const visualReviewObjectIds = new Set((visualAlignment.needsHumanConfirmation ?? []).map((item) => item.objectId));

  for (const object of objects) {
    assert(object.id.match(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/), `invalid domain object id: ${object.id}`);
    assert(object.page && object.component && object.objectType, `${object.id} missing page/component/objectType`);
    assert(Array.isArray(object.aliases) && object.aliases.length > 0, `${object.id} aliases missing`);
    assert(Array.isArray(object.supportedActions) && object.supportedActions.length > 0, `${object.id} supportedActions missing`);
    assert(Array.isArray(object.evidenceObjects) && object.evidenceObjects.length > 0, `${object.id} evidenceObjects missing`);
    assert(componentIds.has(object.component), `${object.id} references missing component inventory id ${object.component}`);

    for (const actionId of object.supportedActions) {
      assert(platformActionIds.has(actionId), `${object.id} references unknown platform action ${actionId}`);
    }
    for (const evidenceObject of object.evidenceObjects) {
      assert(evidenceObjectIds.has(evidenceObject), `${object.id} references missing evidence object ${evidenceObject}`);
    }

    assert(visualObjectIds.has(object.id), `${object.id} missing visual alignment evidence`);
    const visualEvidence = visualAlignment.objectEvidence[object.id];
    assert(allowedVisualStatuses.has(visualEvidence.status), `${object.id} has invalid visual alignment status ${visualEvidence.status}`);
    assert(typeof visualEvidence.screenContext === "string" && visualEvidence.screenContext.trim().length > 0, `${object.id} missing visual screenContext`);
    assert(Array.isArray(visualEvidence.visualCues) && visualEvidence.visualCues.length > 0, `${object.id} missing visualCues`);
    for (const sourceId of visualEvidence.sourceIds) {
      assert(visualSourceIds.has(sourceId), `${object.id} references unknown visual source ${sourceId}`);
    }
    if (visualEvidence.status !== "confirmed" && visualEvidence.status !== "knownProductGap") {
      assert(visualReviewObjectIds.has(object.id), `${object.id} has non-confirmed visual status but is missing needsHumanConfirmation entry`);
    }
  }

  for (const source of visualAlignment.sources ?? []) {
    assert(source.id && source.path, `visual source missing id/path`);
    for (const objectId of source.observedObjects ?? []) {
      assert(objectIds.has(objectId), `visual source ${source.id} references unknown observed object ${objectId}`);
    }
  }

  for (const objectId of visualObjectIds) {
    assert(objectIds.has(objectId), `visual alignment references unknown object ${objectId}`);
  }
  for (const item of visualAlignment.needsHumanConfirmation ?? []) {
    assert(objectIds.has(item.objectId), `needsHumanConfirmation references unknown object ${item.objectId}`);
    assert(typeof item.reason === "string" && item.reason.trim().length > 0, `${item.objectId} needsHumanConfirmation missing reason`);
  }

  const expectedCoreObjects = [
    "dateRange.button",
    "dateRange.panel",
    "dateRange.timeTypeTab.dynamic",
    "dateRange.timeTypeTab.static",
    "dateRange.preset.past30Days",
    "dateRange.preset.recent30Days",
    "dateRange.action.cancel",
    "projectToolbar.downloadButton",
    "projectToolbar.deleteButton",
    "projectToolbar.createButton",
    "projectLimit.toast",
    "projectList.rowDeleteAction",
    "projectList.rowDeleteTooltip",
    "reportMode.radioGroup",
    "reportMode.option.collage",
    "metricRows.sourceReportControl",
    "sourceReportPicker.searchInput",
    "sourceReportPicker.option.dailyReport",
    "validation.toast",
    "editorToolbar.downloadButton",
    "download.toast"
  ];
  for (const objectId of expectedCoreObjects) {
    assert(objectIds.has(objectId), `missing expected official UI object ${objectId}`);
  }

  for (const observationType of Object.values(observeAction.observationTypes ?? {}) as JsonObject[]) {
    for (const objectId of observationType.objectIds ?? []) {
      assert(objectIds.has(objectId), `observeFrontendState references unknown objectId ${objectId}`);
    }
    for (const evidenceObject of observationType.requiredEvidence ?? []) {
      assert(evidenceObjectIds.has(evidenceObject), `observeFrontendState references missing evidence object ${evidenceObject}`);
    }
  }

  const fixtureMissing: string[] = [];
  for (const item of coverageFixture.requiredObjectsByCase) {
    assert(item.caseNo.startsWith("BIUI_COLLAGE_R001-"), `unexpected fixture caseNo ${item.caseNo}`);
    for (const objectId of item.objectIds) {
      if (!objectIds.has(objectId)) fixtureMissing.push(`${item.caseNo}:${objectId}`);
    }
  }
  assert.deepEqual(fixtureMissing, [], `fixture required object coverage missing: ${fixtureMissing.join(", ")}`);

  console.log("BI official UI object vocabulary verified");
  console.log(`objects=${objects.length}`);
  console.log(`fixtureCases=${coverageFixture.requiredObjectsByCase.length}`);
  console.log(`platformActionRefs=${new Set(objects.flatMap((object) => object.supportedActions)).size}`);
  console.log(`visualConfirmed=${objects.filter((object) => visualAlignment.objectEvidence[object.id].status === "confirmed").length}`);
  console.log(`visualKnownProductGaps=${objects.filter((object) => visualAlignment.objectEvidence[object.id].status === "knownProductGap").length}`);
  console.log(`visualNeedsReview=${visualAlignment.needsHumanConfirmation?.length ?? 0}`);
};

main();
