import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type ActionDefinition = {
  id: string;
  stability: "v1_supported" | "v1_planned";
};

type Vocabulary = {
  schemaVersion: string;
  actions: ActionDefinition[];
};

type CandidateFixture = {
  schemaVersion: string;
  extractedFromXlsx: Array<{
    actionId: string;
    hitCount: number;
    exampleCaseNos: string[];
  }>;
  p0ScopeSmokeRequiredActions: Array<{
    caseNo: string;
    actionIds: string[];
  }>;
  saasGenericBackfill: string[];
};

const readJson = <T>(filePath: string): T => JSON.parse(fs.readFileSync(filePath, "utf8")) as T;

const vocabularyPath = path.join(process.cwd(), "contracts", "platform-action-vocabulary.v1.json");
const candidatesPath = path.join(process.cwd(), "fixtures", "action-vocabulary", "biui-collage-r001-v1-6-candidates.json");

const main = (): void => {
  const vocabulary = readJson<Vocabulary>(vocabularyPath);
  const candidates = readJson<CandidateFixture>(candidatesPath);

  assert.equal(vocabulary.schemaVersion, "platform-action-vocabulary-v1");
  assert.equal(candidates.schemaVersion, "action-candidate-extraction-v1");

  const byId = new Map(vocabulary.actions.map((action) => [action.id, action]));

  for (const candidate of candidates.extractedFromXlsx) {
    assert(byId.has(candidate.actionId), `extracted candidate action not covered by vocabulary: ${candidate.actionId}`);
    assert(candidate.hitCount > 0, `${candidate.actionId} hitCount should be positive`);
  }

  const p0Missing: string[] = [];
  for (const item of candidates.p0ScopeSmokeRequiredActions) {
    assert(item.caseNo.startsWith("BIUI_COLLAGE_R001-"), `unexpected fixture case id ${item.caseNo}`);
    for (const actionId of item.actionIds) {
      if (!byId.has(actionId)) p0Missing.push(`${item.caseNo}:${actionId}`);
    }
  }
  assert.deepEqual(p0Missing, [], `fixture action coverage missing: ${p0Missing.join(", ")}`);

  for (const actionId of candidates.saasGenericBackfill) {
    assert(byId.has(actionId), `SaaS generic backfill action missing: ${actionId}`);
  }

  for (const highRiskLowFrequency of ["hover", "search", "assertNoRequest", "assertTooltip", "assertToast"]) {
    const action = byId.get(highRiskLowFrequency);
    assert(action, `high-risk low-frequency action missing: ${highRiskLowFrequency}`);
    assert.equal(action.stability, "v1_supported", `${highRiskLowFrequency} must be v1_supported for current BI reduced smoke fixture`);
  }

  console.log("Action vocabulary fixture coverage verified");
  console.log(`candidateCoverage=${candidates.extractedFromXlsx.length}/${candidates.extractedFromXlsx.length}`);
  console.log(`reducedSmokeCases=${candidates.p0ScopeSmokeRequiredActions.length}`);
};

main();
