import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { parseTestcaseXlsx } from "../src/xlsx-parser";

type JsonObject = Record<string, any>;

type StructuredAction = {
  actionId: string;
  action: string;
  target: string;
  role: string;
  expectedOutcome: string;
  evidenceRequirements: string[];
};

type StructuredContract = {
  caseNo: string;
  routeIntent: string;
  testTarget: string;
  requiredActions: StructuredAction[];
};

const root = process.cwd();
const roundDir = "/Users/tommy/Downloads/codex_galaxy/BI_UAT_ROUNDS/p0_scope_smoke_20260517";
const outputXlsx = path.join(roundDir, "P0_SCOPE_SMOKE_測試案例_BIUI_COLLAGE_R001_20260518_vocab_v1.xlsx");
const outputInstructionMd = path.join(roundDir, "P0_SCOPE_SMOKE_測試執行說明_BIUI_COLLAGE_R001_20260518_vocab_v1.md");
const outputStartupMd = path.join(roundDir, "P0_SCOPE_SMOKE_Codex_指派文字_BIUI_COLLAGE_R001_20260518_vocab_v1.md");
const contractPath = path.join(root, "domain-packs", "BI_OFFICIAL_UI_COLLAGE", "case-scope-runtime-contracts.json");
const actionVocabularyPath = path.join(root, "contracts", "platform-action-vocabulary.v1.json");
const uiObjectVocabularyPath = path.join(root, "domain-packs", "BI_OFFICIAL_UI_COLLAGE", "ui-object-vocabulary.json");

const readJson = <T>(filePath: string): T => JSON.parse(fs.readFileSync(filePath, "utf8")) as T;

const normalizeText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const rich = value as { richText?: Array<{ text?: string }> };
    if (Array.isArray(rich.richText)) return rich.richText.map((item) => item.text ?? "").join("").trim();
  }
  return String(value).trim();
};

const headerMap = (sheet: ExcelJS.Worksheet): Map<string, number> => {
  const row = sheet.getRow(1);
  const out = new Map<string, number>();
  row.eachCell((cell, col) => out.set(normalizeText(cell.value), col));
  return out;
};

const chineseTestTarget = (value: string): string => {
  switch (value) {
    case "backend_function":
      return "後端功能";
    case "frontend_presentation":
      return "前端呈現";
    case "frontend_backend_integration":
      return "前後端整合";
    case "functional_flow":
      return "功能流程";
    default:
      return value;
  }
};

const main = async (): Promise<void> => {
  for (const filePath of [outputXlsx, outputInstructionMd, outputStartupMd]) {
    assert(fs.existsSync(filePath), `generated file missing: ${filePath}`);
  }

  const contractFile = readJson<{ contracts: StructuredContract[] }>(contractPath);
  const actionVocabulary = readJson<JsonObject>(actionVocabularyPath);
  const uiObjectVocabulary = readJson<JsonObject>(uiObjectVocabularyPath);
  const contracts = contractFile.contracts;
  const actionIds = new Set((actionVocabulary.actions as JsonObject[]).map((item) => item.id));
  const objectIds = new Set((uiObjectVocabulary.objects as JsonObject[]).map((item) => item.id));
  const contractCaseNos = contracts.map((item) => item.caseNo);
  const expectedStepCount = contracts.reduce((sum, item) => sum + item.requiredActions.length, 0);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(outputXlsx);
  const caseSheet = workbook.getWorksheet("測試案例");
  const stepSheet = workbook.getWorksheet("步驟");
  const contractSheet = workbook.getWorksheet("Vocabulary Contract");
  assert(caseSheet, "generated workbook missing 測試案例 sheet");
  assert(stepSheet, "generated workbook missing 步驟 sheet");
  assert(contractSheet, "generated workbook missing Vocabulary Contract sheet");

  const caseHeaders = headerMap(caseSheet);
  const caseNoCol = caseHeaders.get("編號");
  const stepsCol = caseHeaders.get("步驟");
  const testTargetCol = caseHeaders.get("測試標的");
  const resultCol = caseHeaders.get("結果");
  const detailCol = caseHeaders.get("詳細紀錄JSON");
  assert(caseNoCol && stepsCol && testTargetCol && resultCol && detailCol, "generated workbook missing required case headers");

  const generatedCaseNos: string[] = [];
  for (let rowNo = 2; rowNo <= caseSheet.rowCount; rowNo += 1) {
    const row = caseSheet.getRow(rowNo);
    const caseNo = normalizeText(row.getCell(caseNoCol).value);
    if (!caseNo) continue;
    generatedCaseNos.push(caseNo);
    const contract = contracts.find((item) => item.caseNo === caseNo);
    assert(contract, `generated case not in contract: ${caseNo}`);
    assert.equal(normalizeText(row.getCell(testTargetCol).value), chineseTestTarget(contract.testTarget), `${caseNo} xlsx test target must align with contract`);
    const stepsText = normalizeText(row.getCell(stepsCol).value);
    assert(stepsText.includes("P0.18 vocabulary-aligned steps"), `${caseNo} missing P0.18 steps marker`);
    assert.equal(normalizeText(row.getCell(resultCol).value), "", `${caseNo} result must not be prefilled`);
    assert.equal(normalizeText(row.getCell(detailCol).value), "", `${caseNo} detail_json must not be prefilled`);
    for (const action of contract.requiredActions) {
      assert(stepsText.includes(`${action.action}(${action.target})`), `${caseNo} steps text missing ${action.action}(${action.target})`);
      assert(actionIds.has(action.action), `${caseNo} unknown platform action ${action.action}`);
      assert(objectIds.has(action.target), `${caseNo} unknown domain UI object ${action.target}`);
    }
  }
  assert.deepEqual(generatedCaseNos, contractCaseNos, "generated case order must match runtime contracts");

  const stepHeaders = headerMap(stepSheet);
  const sCaseNo = stepHeaders.get("案例編號");
  const sStepNo = stepHeaders.get("步驟序號");
  const sAction = stepHeaders.get("動作類型");
  const sTargetType = stepHeaders.get("目標類型");
  const sTarget = stepHeaders.get("目標值");
  const sExpected = stepHeaders.get("預期值");
  assert(sCaseNo && sStepNo && sAction && sTargetType && sTarget && sExpected, "generated 步驟 sheet headers invalid");
  assert.equal(stepSheet.rowCount - 1, expectedStepCount, "structured step count mismatch");
  for (let rowNo = 2; rowNo <= stepSheet.rowCount; rowNo += 1) {
    const row = stepSheet.getRow(rowNo);
    const caseNo = normalizeText(row.getCell(sCaseNo).value);
    const action = normalizeText(row.getCell(sAction).value);
    const target = normalizeText(row.getCell(sTarget).value);
    assert(contractCaseNos.includes(caseNo), `step references unknown case ${caseNo}`);
    assert(actionIds.has(action), `step references unknown platform action ${action}`);
    assert(objectIds.has(target), `step references unknown domain object ${target}`);
    assert.equal(normalizeText(row.getCell(sTargetType).value), "domain_ui_object", `step target type must be domain_ui_object for ${caseNo}`);
  }

  const parsed = await parseTestcaseXlsx(outputXlsx);
  assert.equal(parsed.cases.length, contracts.length, "parser case count mismatch");
  assert.equal(parsed.steps.length, expectedStepCount, "parser structured step count mismatch");

  const instruction = fs.readFileSync(outputInstructionMd, "utf8");
  const startup = fs.readFileSync(outputStartupMd, "utf8");
  assert(instruction.includes("P0.18 reduced smoke package"), "instruction md missing P0.18 purpose");
  assert(startup.includes("步驟") && startup.includes("結構化步驟的權威來源"), "startup md missing structured sheet boundary");
  for (const contract of contracts) {
    assert(instruction.includes(contract.caseNo), `instruction md missing ${contract.caseNo}`);
    assert(startup.includes(contract.caseNo), `startup md missing ${contract.caseNo}`);
  }
  assert(!/expectedStatus|1762c1b2/.test(instruction + startup), "generated md must not embed oracle/run result truth");

  console.log(JSON.stringify({
    ok: true,
    cases: parsed.cases.length,
    structuredSteps: parsed.steps.length,
    outputXlsx,
    outputInstructionMd,
    outputStartupMd
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
