import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";

const toolRoot = process.cwd();
const projectRoot = path.dirname(toolRoot);
const checker = path.join(toolRoot, "scripts", "check-test-package-consistency.ts");
const caseId = "FIX-H-01";

const helperHint = {
  caseId,
  automationLevel: "helper",
  operationTemplate: "metric_filter_operator",
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

const writeWorkbook = async (xlsxPath: string): Promise<void> => {
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
    "指標趨勢 Helper hints consistency fixture",
    "🟢 觀察",
    "前後端整合",
    "欄位=新增帳號數;篩選=0組;分組=0組;時間=2026-03-01~2026-03-31;顯示=每天",
    "起始頁面: DEV URL 首頁; 建構模式: 指標趨勢",
    "1. 透過 UI 新增篩選 商品單價 大於 100\n2. 設定 2026-03-01~2026-03-31 且顯示 每天\n3. 按執行並讀取本次 request/chart",
    "request body dateRange 與 chart datasets 皆有 current-run evidence",
    "",
    "",
    "",
    "",
    "DOM read + network request body + Chart.js datasets"
  ]);
  await workbook.xlsx.writeFile(xlsxPath);
};

const writeAssignment = (filePath: string): void => {
  fs.writeFileSync(
    filePath,
    [
      "# Helper Hints Fixture 指派文字",
      "",
      "## 3. 執行範圍與起始 case",
      "",
      "- 總 case 數: 1",
      `- 本輪 Codex 起始 case: **${caseId}**`,
      `- 本輪 Codex 執行順序: **${caseId}**`,
      "- 跳過 case: 無",
      ""
    ].join("\n")
  );
};

const writeInstruction = (filePath: string, riskLevel = "🟢 觀察"): void => {
  fs.writeFileSync(
    filePath,
    [
      "# Helper Hints Fixture 測試執行說明",
      "",
      "## 2. Case 分布與執行順序",
      "",
      `**起始 case**: ${caseId}`,
      `**執行順序**: ${caseId}`,
      "",
      `### ${caseId} — Helper hints consistency`,
      "",
      `**風險等級**: ${riskLevel}`,
      "",
      "**測試標的**: 前後端整合",
      "",
      "**狀態清理**(固定 5 項格式):",
      "```",
      "欄位=新增帳號數;篩選=0組;分組=0組;時間=2026-03-01~2026-03-31;顯示=每天",
      "```",
      "",
      "Helper hints:",
      "```json",
      JSON.stringify(helperHint, null, 2),
      "```",
      ""
    ].join("\n")
  );
};

const runChecker = (xlsx: string, assignment: string, instruction: string, out: string): { status: string; issues: Array<{ code: string; severity: string }> } => {
  try {
    execFileSync("npx", ["tsx", checker, "--xlsx", xlsx, "--assignment", assignment, "--instruction", instruction, "--helper-source", instruction, "--out", out], {
      cwd: toolRoot,
      stdio: "pipe"
    });
  } catch {
    // Error status intentionally exits non-zero; inspect the report below.
  }
  return JSON.parse(fs.readFileSync(out, "utf8")) as { status: string; issues: Array<{ code: string; severity: string }> };
};

const main = async (): Promise<void> => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-package-consistency-fixture-"));
  try {
    const xlsx = path.join(tempRoot, "HelperHintsFixture_測試案例_v1_0.xlsx");
    const assignment = path.join(tempRoot, "Codex_指派文字_HelperHintsFixture_v1_0.md");
    const instruction = path.join(tempRoot, "HelperHintsFixture_測試執行說明_for_v1_0.md");
    await writeWorkbook(xlsx);
    writeAssignment(assignment);
    writeInstruction(instruction);

    const okReport = runChecker(xlsx, assignment, instruction, path.join(tempRoot, "ok-report.json"));
    assert.equal(okReport.status, "ok", `good fixture should pass with status=ok; issues=${JSON.stringify(okReport.issues)}`);
    assert.equal(okReport.issues.length, 0, `good fixture should not emit issues; issues=${JSON.stringify(okReport.issues)}`);

    writeInstruction(instruction, "🔴 刪除");
    const badReport = runChecker(xlsx, assignment, instruction, path.join(tempRoot, "bad-report.json"));
    assert.equal(badReport.status, "error", "risk mismatch fixture should block");
    assert.ok(badReport.issues.some((item) => item.code === "RISK_LEVEL_CONFLICT" && item.severity === "error"));

    const demoDir = path.join(projectRoot, "BI_UAT_ROUNDS", "DEMO001_工程團隊示範");
    const demoXlsx = path.join(demoDir, "DEMO_BI示範_測試案例_v1_4.xlsx");
    const demoAssignment = path.join(demoDir, "Codex_指派文字_DEMO001_v1_4.md");
    const demoInstruction = path.join(demoDir, "DEMO_BI示範_測試執行說明_for_v1_4.md");
    if (fs.existsSync(demoXlsx) && fs.existsSync(demoAssignment) && fs.existsSync(demoInstruction)) {
      const demoReport = runChecker(demoXlsx, demoAssignment, demoInstruction, path.join(tempRoot, "demo-report.json"));
      assert.notEqual(demoReport.status, "error", `DEMO001 v1_4 should not have blocking package consistency errors; issues=${JSON.stringify(demoReport.issues)}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          fixture: "test-package-consistency",
          checked: [
            "good helper hints package status ok",
            "risk-level conflict emits blocking error",
            "DEMO001 v1_4 has no blocking consistency error"
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
