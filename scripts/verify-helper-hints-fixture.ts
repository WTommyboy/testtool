import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { writeBiUiHelperGuidance } from "../agent/src/bi-ui-helper-guidance";
import { writeCaseManifest } from "../agent/src/case-manifest";
import { writeCurrentCasePack } from "../agent/src/current-case-pack";
import { writeHelperExecutionPlan } from "../agent/src/helper-execution-plan";
import { writeNetworkObservationGuidance } from "../agent/src/network-observation-guidance";
import { writeRuleIndex } from "../agent/src/rule-index";

const toolRoot = process.cwd();
const projectRoot = path.dirname(toolRoot);
const caseId = "FIX-H-01";
const operationTemplate = "metric_filter_operator";
const helperHint = {
  caseId,
  automationLevel: "helper",
  operationTemplate,
  params: {
    mode: "指標趨勢",
    field: "商品單價",
    operator: "大於",
    value: 100,
    dateRange: {
      start: "2026-03-01",
      end: "2026-03-31"
    },
    display: "每天"
  },
  requiredEvidence: ["dom.state.filterRow", "network.requestBody.dateRange", "chart.datasets"],
  forbiddenAutomation: ["direct_bi_api", "internal_js_setter", "multi_case_batch"],
  aiDecisionRequired: true
};

const writeFixtureWorkbook = async (xlsxPath: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("測試案例");
  sheet.addRow([
    "輪次ID",
    "群組",
    "編號",
    "測試類型",
    "測試項目",
    "風險等級",
    "測試標的",
    "狀態清理",
    "前置條件",
    "步驟",
    "預期結果",
    "結果",
    "執行方式",
    "測試日",
    "詳細紀錄JSON",
    "驗證方法"
  ]);
  sheet.addRow([
    "FIXTURE",
    "H:Helper hints fixture",
    caseId,
    "前後端整合",
    "Helper hints flow fixture",
    "🟢 觀察",
    "前後端整合",
    "欄位=新增帳號數;篩選=0組;分組=0組;時間=上月;顯示=每天",
    "起始頁面: DEV URL 首頁",
    "1. 透過 UI 新增篩選 商品單價 大於 100\n2. 按執行並讀取本次 request/chart",
    "request body dateRange 與 chart datasets 皆有 current-run evidence",
    "",
    "",
    "",
    "",
    "DOM read + network request body + Chart.js datasets"
  ]);
  await workbook.xlsx.writeFile(xlsxPath);
};

const writeFixtureInstruction = (filePath: string): void => {
  const body = [
    "# Helper Hints Fixture 測試執行說明",
    "",
    `### ${caseId} — Helper hints flow`,
    "",
    "Helper hints:",
    "```json",
    JSON.stringify(helperHint, null, 2),
    "```",
    ""
  ].join("\n");
  fs.writeFileSync(filePath, body);
};

const writeFixtureAssignment = (filePath: string): void => {
  const body = [
    "# Helper Hints Fixture 指派文字",
    "",
    "## 3. 執行範圍與起始 case",
    "",
    "- 總 case 數: 1",
    `- 本輪 Codex 起始 case: **${caseId}**`,
    `- 本輪 Codex 執行順序: **${caseId}**`,
    "- 跳過 case: 無",
    ""
  ].join("\n");
  fs.writeFileSync(filePath, body);
};

const mustInclude = (text: string, needle: string, label: string): void => {
  assert.ok(text.includes(needle), `${label}: missing ${needle}`);
};

const runNode = (args: string[], cwd = projectRoot): void => {
  execFileSync(process.execPath, args, { cwd, stdio: "pipe" });
};

const main = async (): Promise<void> => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-helper-hints-fixture-"));
  try {
    const roundDir = path.join(tempRoot, "round");
    const runDir = path.join(tempRoot, "run");
    const inputDir = path.join(runDir, "input");
    fs.mkdirSync(roundDir, { recursive: true });
    fs.mkdirSync(inputDir, { recursive: true });

    const xlsxPath = path.join(roundDir, "HelperHintsFixture_測試案例_v1_0.xlsx");
    const assignmentPath = path.join(roundDir, "Codex_指派文字_HelperHintsFixture_v1_0.md");
    const instructionPath = path.join(roundDir, "HelperHintsFixture_測試執行說明_for_v1_0.md");
    await writeFixtureWorkbook(xlsxPath);
    writeFixtureAssignment(assignmentPath);
    writeFixtureInstruction(instructionPath);

    runNode([path.join(projectRoot, "outputs", "generate_current_case_prompt.mjs"), xlsxPath, caseId]);
    const currentPromptPath = path.join(roundDir, `current_case_prompt_${caseId}.md`);
    const currentPrompt = fs.readFileSync(currentPromptPath, "utf8");
    mustInclude(currentPrompt, "## 10. Helper Hints", "current prompt");
    mustInclude(currentPrompt, `operationTemplate：${operationTemplate}`, "current prompt");
    mustInclude(currentPrompt, "- warnings：none", "current prompt");
    mustInclude(currentPrompt, "network.requestBody.dateRange", "current prompt");

    runNode([path.join(projectRoot, "outputs", "generate_active_case_prompt.mjs"), xlsxPath, caseId, "--reset"]);
    const activePrompt = fs.readFileSync(path.join(roundDir, "current_case_prompt_ACTIVE.md"), "utf8");
    mustInclude(activePrompt, "## 10. Helper Hints", "ACTIVE prompt");
    mustInclude(activePrompt, `operationTemplate：${operationTemplate}`, "ACTIVE prompt");
    mustInclude(activePrompt, "- warnings：none", "ACTIVE prompt");

    const caseManifest = await writeCaseManifest(xlsxPath, inputDir, { preferredStartCaseNo: caseId });
    const currentCase = caseManifest.cases.find((item) => item.caseNo === caseId) ?? null;
    assert.ok(currentCase, "case manifest should include fixture case");
    const currentCasePack = writeCurrentCasePack(
      runDir,
      caseManifest,
      path.join(inputDir, "document-consistency.json"),
      [instructionPath]
    );
    const biUiHelperGuidancePath = writeBiUiHelperGuidance(runDir, {
      currentCase,
      helperHints: currentCasePack.helperHints
    });
    const helperExecutionPlan = writeHelperExecutionPlan({
      runDir,
      currentCase,
      helperHints: currentCasePack.helperHints
    });
    writeNetworkObservationGuidance(runDir);
    const ruleIndexPath = writeRuleIndex(runDir, "BI");

    const packJson = JSON.parse(fs.readFileSync(currentCasePack.jsonPath, "utf8")) as {
      helperHints?: {
        found?: boolean;
        operationTemplate?: string;
        params?: Record<string, unknown>;
      };
      requiredEvidence?: string[];
    };
    assert.equal(packJson.helperHints?.found, true, "current-case-pack.json should mark helper hints found");
    assert.equal(packJson.helperHints?.operationTemplate, operationTemplate, "current-case-pack.json operationTemplate");
    assert.deepEqual(packJson.helperHints?.params, helperHint.params, "current-case-pack.json params");
    assert.ok(
      packJson.requiredEvidence?.includes("network.requestBody.dateRange"),
      "current-case-pack.json should include explicit requiredEvidence"
    );

    const packMarkdown = fs.readFileSync(currentCasePack.markdownPath, "utf8");
    mustInclude(packMarkdown, "## Helper Hints", "current-case-pack.md");
    mustInclude(packMarkdown, `- operationTemplate: ${operationTemplate}`, "current-case-pack.md");

    const helperGuidance = fs.readFileSync(biUiHelperGuidancePath, "utf8");
    mustInclude(helperGuidance, `- operationTemplate: ${operationTemplate}`, "bi-ui-helper-guidance.md");
    mustInclude(helperGuidance, "### Template Notes", "bi-ui-helper-guidance.md");
    mustInclude(helperGuidance, "切到不帶值 operator", "bi-ui-helper-guidance.md");

    const helperPlanJson = JSON.parse(fs.readFileSync(helperExecutionPlan.jsonPath, "utf8")) as {
      schemaVersion?: string;
      safety?: { helperMayJudgePassFail?: boolean; helperMayWriteResultXlsx?: boolean };
      availableTemplates?: Array<{ template?: string }>;
    };
    assert.equal(helperPlanJson.schemaVersion, "helper-execution-plan-v1", "helper execution plan schema");
    assert.equal(helperPlanJson.safety?.helperMayJudgePassFail, false, "helper plan must not judge PASS/FAIL");
    assert.equal(helperPlanJson.safety?.helperMayWriteResultXlsx, false, "helper plan must not write result.xlsx");
    assert.ok(
      helperPlanJson.availableTemplates?.some((item) => item.template === "filter.addAndPreview"),
      "helper plan should include filter.addAndPreview template"
    );
    const helperPlanMarkdown = fs.readFileSync(helperExecutionPlan.markdownPath, "utf8");
    mustInclude(helperPlanMarkdown, "Helper Execution Plan v1", "helper-execution-plan.md");
    mustInclude(helperPlanMarkdown, "helper 不可判 PASS/FAIL/BLOCKED", "helper-execution-plan.md");

    const ruleIndex = JSON.parse(fs.readFileSync(ruleIndexPath, "utf8")) as {
      currentCaseRecommendations?: { ruleIds?: string[] };
    };
    const ruleIds = ruleIndex.currentCaseRecommendations?.ruleIds ?? [];
    assert.ok(ruleIds.includes("bi-ui-helper-guidance"), "rule-index should recommend bi-ui-helper-guidance");
    assert.ok(ruleIds.includes("helper-execution-plan"), "rule-index should recommend helper-execution-plan");
    assert.ok(ruleIds.includes("network-observation-guidance"), "rule-index should recommend network-observation-guidance");

    console.log(
      JSON.stringify(
        {
          ok: true,
          fixture: "helper-hints-flow",
          caseId,
          operationTemplate,
          checked: [
            "current_case_prompt Helper Hints warnings none",
            "ACTIVE prompt Helper Hints preserved",
            "current-case-pack.json helperHints",
            "current-case-pack.md Helper Hints section",
            "helper-execution-plan safety and templates",
            "bi-ui-helper-guidance Template Notes",
            "rule-index currentCaseRecommendations"
          ]
        },
        null,
        2
      )
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
