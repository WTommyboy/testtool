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
import { parseHelperHintsFromMarkdown } from "../agent/src/helper-hints";
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
  requiredEvidence: ["dom.state.filterRow", "date.uiState", "date.representedRange", "network.requestBody.dateRange", "chart.datasets"],
  forbiddenAutomation: ["direct_bi_api", "internal_js_setter", "multi_case_batch"],
  aiDecisionRequired: true
};

const writeFixtureWorkbook = async (xlsxPath: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("測試案例");
  sheet.addRow([
    "輪次ID",
    "群組ID",
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
    "H",
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
    mustInclude(currentPrompt, "date.representedRange", "current prompt");
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
      mustReadRuleKeys?: string[];
    };
    assert.equal(packJson.helperHints?.found, true, "current-case-pack.json should mark helper hints found");
    assert.equal(packJson.helperHints?.operationTemplate, operationTemplate, "current-case-pack.json operationTemplate");
    assert.deepEqual(packJson.helperHints?.params, helperHint.params, "current-case-pack.json params");
    assert.ok(
      packJson.requiredEvidence?.includes("network.requestBody.dateRange"),
      "current-case-pack.json should include explicit requiredEvidence"
    );
    assert.ok(
      packJson.requiredEvidence?.includes("date.representedRange"),
      "current-case-pack.json should include date UI represented range evidence"
    );
    assert.ok(packJson.mustReadRuleKeys?.includes("helper-protocol"), "current-case-pack.json should include helper-protocol in mustReadRuleKeys");
    assert.ok(packJson.mustReadRuleKeys?.includes("bi-ui-helper-guidance"), "current-case-pack.json should include bi-ui-helper-guidance in mustReadRuleKeys");
    assert.ok(packJson.mustReadRuleKeys?.includes("network-observation-guidance"), "current-case-pack.json should include network-observation-guidance in mustReadRuleKeys");

    const packMarkdown = fs.readFileSync(currentCasePack.markdownPath, "utf8");
    mustInclude(packMarkdown, "## Helper Hints", "current-case-pack.md");
    mustInclude(packMarkdown, `- operationTemplate: ${operationTemplate}`, "current-case-pack.md");
    mustInclude(packMarkdown, "## Must Read Rule Keys", "current-case-pack.md");

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
      !(helperPlanJson.availableTemplates ?? []).some((item) => item.template === "filter.addAndPreview"),
      "helper plan must not advertise unimplemented filter.addAndPreview as available"
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

    const metadataHintsMarkdown = [
      "### META-A-01 — metadata top-level params",
      "",
      "Helper hints:",
      "```json",
      JSON.stringify({
        caseId: "META-A-01",
        automationLevel: "helper",
        operationTemplate: "metadata_dropdown_compare",
        params: {
          mode: "拼貼",
          comparisonScope: "report_sources_only"
        },
        requiredEvidence: ["dom.list"],
        forbiddenAutomation: ["direct_bi_api", "internal_js_setter", "multi_case_batch"],
        aiDecisionRequired: true,
        referenceCsv: "rules/BI_DATA/metadata.csv",
        referenceSourceName: "metadata＿1.2.5 - 工作表1.csv",
        referenceIndexKey: "bi_metadata_csv",
        matchKey: "所屬報表是否可用於拼貼模式主選擇",
        expectedReportSourceCount: 4,
        expectedReportSources: ["每日報表", "各登入渠道狀況(原 beanfun! 導流)", "退費追蹤", "雙平台營收佔比"]
      }, null, 2),
      "```",
      ""
    ].join("\n");
    const parsedMetadataHints = parseHelperHintsFromMarkdown(metadataHintsMarkdown, "META-A-01", "fixture/metadata.md").helperHints;
    assert.ok(parsedMetadataHints, "metadata helper hints should parse");
    assert.deepEqual(
      (parsedMetadataHints.params as Record<string, unknown>).expectedReportSources,
      ["每日報表", "各登入渠道狀況(原 beanfun! 導流)", "退費追蹤", "雙平台營收佔比"],
      "top-level expectedReportSources must be merged into helper params"
    );
    assert.equal(
      (parsedMetadataHints.params as Record<string, unknown>).referenceIndexKey,
      "bi_metadata_csv",
      "top-level referenceIndexKey must be merged into helper params"
    );

    const boldLabelMarkdown = [
      "### BOLD-H-01 — markdown bold helper label",
      "",
      "**Helper hints**:",
      "```json",
      JSON.stringify({
        automationLevel: "helper",
        operationTemplate: "metadata_dropdown_compare",
        params: {
          comparisonScope: "source_report_fields",
          sourceReport: "每日報表"
        },
        requiredEvidence: ["dom.list"],
        forbiddenAutomation: ["direct_bi_api", "internal_js_setter", "multi_case_batch"],
        aiDecisionRequired: true
      }, null, 2),
      "```",
      ""
    ].join("\n");
    const parsedBoldLabelHints = parseHelperHintsFromMarkdown(boldLabelMarkdown, "BOLD-H-01", "fixture/bold.md").helperHints;
    assert.ok(parsedBoldLabelHints, "bold **Helper hints** label should parse even without caseId fallback");
    assert.equal(parsedBoldLabelHints.operationTemplate, "metadata_dropdown_compare");

    const formulaHintsMarkdown = [
      "### OTTEST004-E-01 — formula modal helper",
      "",
      "Helper hints:",
      "```json",
      JSON.stringify({
        caseId: "OTTEST004-E-01",
        automationLevel: "helper",
        operationTemplate: "collage.configureCalculatedMetricAndPreview",
        params: {
          mode: "拼貼",
          baseFields: ["新增帳號數", "MAU(帳號)"],
          calculatedFieldName: "E01_運算",
          formula: "[新增帳號數]+[MAU(帳號)]/2",
          formulaModal: {
            openButtonText: "+ 新增運算欄位",
            nameInputLabel: "欄位名稱",
            formulaInputLabel: "公式",
            submitButtonText: "確認"
          },
          dateRange: {
            start: "2026-03-01",
            end: "2026-03-31"
          },
          display: "每天"
        },
        requiredEvidence: [
          "formula.uiState: DOM 可讀到 calculatedFieldName 與 formula",
          "network.requestBody: request body 含運算欄位定義與 dateRange",
          "chart.datasets: preview/圖表資料可讀取並可與公式抽樣驗算",
          "screenshot"
        ],
        forbiddenAutomation: ["direct_bi_api", "internal_js_setter", "multi_case_batch"],
        aiDecisionRequired: true
      }, null, 2),
      "```",
      ""
    ].join("\n");
    const parsedFormulaHints = parseHelperHintsFromMarkdown(formulaHintsMarkdown, "OTTEST004-E-01", "fixture/formula.md").helperHints;
    assert.ok(parsedFormulaHints, "formula helper hints should parse");
    assert.equal(parsedFormulaHints.operationTemplate, "collage.configureCalculatedMetricAndPreview");
    assert.deepEqual(
      parsedFormulaHints.requiredEvidence,
      ["formula.uiState", "network.requestBody", "chart.datasets", "screenshot"],
      "formula helper evidence should normalize annotation prose to canonical tokens"
    );
    assert.deepEqual(parsedFormulaHints.warnings, [], "formula helper hints should not warn after evidence normalization");

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
            "date UI evidence requiredEvidence accepted",
            "current-case-pack.md Helper Hints section",
            "helper-execution-plan safety and templates",
            "bi-ui-helper-guidance Template Notes",
            "rule-index currentCaseRecommendations",
            "metadata helper top-level reference params merged into params",
            "bold markdown Helper hints label parses without caseId fallback",
            "formula modal helper template and evidence normalization"
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
