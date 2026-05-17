import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type ActionKind = "primitive" | "assertion" | "composite";
type ActionStability = "v1_supported" | "v1_planned";

type ActionDefinition = {
  id: string;
  kind: ActionKind;
  stability: ActionStability;
  summary: string;
  aliases?: string[];
  requiresUserInteraction: boolean;
  allowedRoles: string[];
  defaultEvidence?: string[];
  composedOf?: string[];
};

type Vocabulary = {
  schemaVersion: string;
  status: string;
  roles: string[];
  expectedOutcomes: string[];
  actions: ActionDefinition[];
};

const readJson = <T>(filePath: string): T => JSON.parse(fs.readFileSync(filePath, "utf8")) as T;

const vocabularyPath = path.join(process.cwd(), "contracts", "platform-action-vocabulary.v1.json");

const unique = <T>(items: T[]): T[] => [...new Set(items)];

const main = (): void => {
  const vocabulary = readJson<Vocabulary>(vocabularyPath);

  assert.equal(vocabulary.schemaVersion, "platform-action-vocabulary-v1");
  assert.equal(vocabulary.status, "draft");

  const actions = vocabulary.actions;
  assert(actions.length >= 35, "platform vocabulary should include primitive, assertion, and composite coverage");

  const ids = actions.map((action) => action.id);
  assert.equal(ids.length, unique(ids).length, "action ids must be unique");

  const byId = new Map(actions.map((action) => [action.id, action]));
  for (const required of ["primitive", "assertion", "composite"] satisfies ActionKind[]) {
    assert(actions.some((action) => action.kind === required), `missing action kind ${required}`);
  }

  for (const action of actions) {
    assert(action.id.match(/^[a-z][A-Za-z0-9]*$/), `invalid action id ${action.id}`);
    assert(action.summary.trim().length > 12, `${action.id} summary is too short`);
    assert(action.allowedRoles.length > 0, `${action.id} allowedRoles missing`);
    for (const role of action.allowedRoles) {
      assert(vocabulary.roles.includes(role), `${action.id} references unknown role ${role}`);
    }
    if (action.kind === "composite") {
      assert(action.composedOf && action.composedOf.length > 1, `${action.id} composite must define composedOf`);
      for (const childId of action.composedOf ?? []) {
        assert(byId.has(childId), `${action.id} composedOf missing child action ${childId}`);
        assert.notEqual(byId.get(childId)?.kind, "composite", `${action.id} should compose primitives/assertions, not nested composites`);
      }
    }
  }

  for (const expectedOutcome of [
    "succeeded",
    "disabled_or_no_change",
    "state_changed",
    "state_unchanged",
    "request_sent",
    "request_not_sent",
    "download_started",
    "toast_visible",
    "tooltip_visible"
  ]) {
    assert(vocabulary.expectedOutcomes.includes(expectedOutcome), `missing expectedOutcome ${expectedOutcome}`);
  }

  console.log("Platform action vocabulary verified");
  console.log(`actions=${actions.length}`);
  console.log(`primitive=${actions.filter((action) => action.kind === "primitive").length}`);
  console.log(`assertion=${actions.filter((action) => action.kind === "assertion").length}`);
  console.log(`composite=${actions.filter((action) => action.kind === "composite").length}`);
};

main();
