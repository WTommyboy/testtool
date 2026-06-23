import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { writeCaseManifest, type CaseManifestResult } from "../agent/src/case-manifest";
import { writeDocumentConsistency } from "../agent/src/document-consistency";
import { parseHelperHintsFromMarkdown } from "../agent/src/helper-hints";
import { buildTestPackageConsistencyReport } from "../agent/src/test-package-consistency";

const headers = [
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
];

const writeWorkbook = async (xlsxPath: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("測試案例");
  sheet.addRow(headers);
  sheet.addRow([
    "BIUI_TAG_R001",
    "A",
    "A: 入口與列表",
    "BIUI_TAG_R001-A-01",
    "前端呈現",
    "玩家標籤管理主頁顯示欄位與空狀態",
    "🟢 觀察",
    "前端呈現",
    "欄位=不影響;篩選=不影響;分組=不影響;時間=不影響;顯示=不影響",
    "開啟玩家標籤管理主頁",
    "1. 開啟玩家標籤管理主頁\n2. 讀取列表欄位與空狀態",
    "列表欄位與空狀態符合 PRD。",
    "",
    "Codex + Playwright",
    "",
    "",
    "Evidence: dom.state, tagList.table.state"
  ]);
  sheet.addRow([
    "BIUI_TAG_R001",
    "D",
    "D: 新增條件標籤",
    "BIUI_TAG_R001-D-01",
    "功能流程",
    "建立消費級距條件標籤",
    "🟡 建立",
    "功能流程",
    "欄位=條件類別=消費級距 R;篩選類型=靜態時間區間;時間=2026-01-01~2026-01-31;子標籤=3 個",
    "使用 visible UI 建立暫存條件標籤",
    "1. 開啟新增標籤\n2. 建立條件標籤\n3. 回列表確認 row",
    "列表出現暫存條件標籤。",
    "",
    "Codex + Playwright",
    "",
    "",
    "Evidence: dom.state, tagList.row.state"
  ]);
  await workbook.xlsx.writeFile(xlsxPath);
};

const helperBlock = (caseId: string, operationTemplate: string, requiredEvidence: string[] = ["dom.state"]): string =>
  [
    `### ${caseId}`,
    "",
    "Helper hints:",
    "```json",
    JSON.stringify(
      {
        caseId,
        automationLevel: "helper",
        operationTemplate,
        params: {},
        requiredEvidence,
        forbiddenAutomation: ["direct_bi_api", "internal_js_setter", "multi_case_batch"],
        aiDecisionRequired: true
      },
      null,
      2
    ),
    "```",
    ""
  ].join("\n");

const writeInstruction = (filePath: string): void => {
  fs.writeFileSync(
    filePath,
    [
      "# TAG_TOOL current-case gate fixture",
      "",
      "## 2. Case 分布與執行順序",
      "",
      "**起始 case**: BIUI_TAG_R001-A-01",
      "**執行順序**: BIUI_TAG_R001-A-01 → BIUI_TAG_R001-D-01",
      "",
      helperBlock("BIUI_TAG_R001-A-01", "manual_ai", ["dom.state", "tagList.table.state"]),
      helperBlock("BIUI_TAG_R001-D-01", "playerTag.createConditionalTag", ["dom.state", "tagList.row.state"])
    ].join("\n")
  );
};

const writeAssignment = (filePath: string): void => {
  fs.writeFileSync(
    filePath,
    [
      "# TAG_TOOL fixture assignment",
      "",
      "## 3. 執行範圍與起始 case",
      "",
      "- 總 case 數: 2",
      "- 本輪 Codex 起始 case: **BIUI_TAG_R001-A-01**",
      "- 本輪 Codex 執行順序: BIUI_TAG_R001-A-01 → BIUI_TAG_R001-D-01",
      ""
    ].join("\n")
  );
};

const readDocumentStatus = (runDir: string): { status: string; issues: Array<{ code: string; severity: string; context?: Record<string, unknown> }> } =>
  JSON.parse(fs.readFileSync(path.join(runDir, "input", "document-consistency.json"), "utf8")) as {
    status: string;
    issues: Array<{ code: string; severity: string; context?: Record<string, unknown> }>;
  };

const assertCurrentCaseScoping = (runDir: string, manifest: CaseManifestResult): void => {
  const futureCaseIssue = {
    severity: "error" as const,
    code: "FUTURE_CASE_FIXTURE_ERROR",
    message: "Future case package error should not block current A-01.",
    context: { caseNo: "BIUI_TAG_R001-D-01" }
  };
  writeDocumentConsistency(runDir, manifest, { caseNo: "BIUI_TAG_R001-A-01", source: "fixture", excerpt: "start A-01" }, [futureCaseIssue]);
  const doc = readDocumentStatus(runDir);
  assert.equal(doc.status, "warning");
  assert.equal(doc.issues[0]?.severity, "warning");
  assert.equal(doc.issues[0]?.context?.executionScope, "non_current_case");
};

const assertPlayerTagHints = (): void => {
  for (const template of [
    "playerTag.createConditionalTag",
    "playerTag.createManualTag",
    "playerTag.editManualTag",
    "playerTag.saveTagVariables",
    "playerTag.deleteTag",
    "playerTag.terminateTag",
    "playerTag.copyTag"
  ]) {
    const caseId = "BIUI_TAG_R001-Z-01";
    const parsed = parseHelperHintsFromMarkdown(helperBlock(caseId, template, ["dom.state", "tagList.row.state"]), caseId, "fixture.md");
    assert.ok(parsed.helperHints, `${template} should parse`);
    assert.deepEqual(parsed.helperHints?.warnings, [], `${template} should not emit helper hint warnings`);
  }
};

const main = async (): Promise<void> => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-tag-tool-current-case-gate-"));
  try {
    const xlsxPath = path.join(tempRoot, "tag-tool-fixture.xlsx");
    const assignmentPath = path.join(tempRoot, "Codex_指派文字.md");
    const instructionPath = path.join(tempRoot, "測試執行說明.md");
    const inputDir = path.join(tempRoot, "input");
    fs.mkdirSync(inputDir, { recursive: true });
    await writeWorkbook(xlsxPath);
    writeAssignment(assignmentPath);
    writeInstruction(instructionPath);

    const manifest = await writeCaseManifest(xlsxPath, inputDir, { preferredStartCaseNo: "BIUI_TAG_R001-A-01" });
    assert.equal(manifest.currentCaseNo, "BIUI_TAG_R001-A-01");

    const report = buildTestPackageConsistencyReport({
      caseManifest: manifest,
      assignmentPath,
      instructionPath,
      helperHintSourcePaths: [instructionPath],
      startCaseHint: { caseNo: "BIUI_TAG_R001-A-01", source: "fixture", excerpt: "start A-01" },
      xlsxPath,
      baseDir: tempRoot,
      domain: "TAG_TOOL"
    });
    assert.equal(report.status, "warning");
    assert.ok(!report.issues.some((issue) => issue.severity === "error"), "TAG_TOOL package fixture should not emit errors");
    assert.ok(report.issues.some((issue) => issue.code === "XLSX_CLEANUP_CHECKLIST_INVALID" && issue.severity === "warning"));
    assert.ok(!report.issues.some((issue) => issue.code.startsWith("HELPER_HINTS_WARNING") && /UNKNOWN_/.test(issue.message)));

    writeDocumentConsistency(tempRoot, manifest, { caseNo: "BIUI_TAG_R001-A-01", source: "fixture", excerpt: "start A-01" }, report.issues);
    assert.notEqual(readDocumentStatus(tempRoot).status, "error");
    assertCurrentCaseScoping(tempRoot, manifest);
    assertPlayerTagHints();

    console.log(JSON.stringify({ ok: true, checked: "TAG_TOOL current-case gate and playerTag helper hints" }, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
