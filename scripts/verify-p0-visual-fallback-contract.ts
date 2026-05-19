import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { evaluateResultEvidenceGate } from "../src/result-parser/result-evidence-gate";
import { parseResultXlsx } from "../src/result-parser/result-xlsx-parser";

type FixtureCase = {
  caseNo: string;
  status: "PASS" | "FAIL" | "BLOCKED" | "PARTIAL";
  failCategory?: string;
  detailJson: Record<string, unknown>;
};

const visualFallbackCaseNos = [
  "BIUI_COLLAGE_R001-J-03",
  "BIUI_COLLAGE_R001-J-05",
  "BIUI_COLLAGE_R001-J-06",
  "BIUI_COLLAGE_R001-J-15",
  "BIUI_COLLAGE_R001-K-02",
  "BIUI_COLLAGE_R001-M-01",
  "BIUI_COLLAGE_R001-M-02",
  "BIUI_COLLAGE_R001-M-03",
  "BIUI_COLLAGE_R001-M-04",
  "BIUI_COLLAGE_R001-M-05",
  "BIUI_COLLAGE_R001-N-01"
];

const writeWorkbook = async (filePath: string, item: FixtureCase): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const index = workbook.addWorksheet("索引");
  index.addRow(["schema_version", "p0-visual-fallback-contract-fixture-v1"]);

  const cases = workbook.addWorksheet("測試案例");
  cases.addRow(["群組ID", "群組", "編號", "測試項目", "測試類型", "執行方式", "結果", "失敗分類", "詳細紀錄JSON"]);
  cases.addRow([
    item.caseNo.match(/BIUI_COLLAGE_R001-([A-Z])-/)?.[1] ?? "P0",
    "P0.24 visual fallback fixture",
    item.caseNo,
    `${item.caseNo} frontend observation visual fallback contract fixture`,
    "前端呈現",
    "Codex + Playwright",
    item.status,
    item.failCategory ?? "",
    JSON.stringify(item.detailJson, null, 2)
  ]);

  const bugs = workbook.addWorksheet("Bug");
  bugs.addRow(["嚴重度", "Bug ID", "關聯編號", "標題", "描述", "建議", "狀態"]);
  await workbook.xlsx.writeFile(filePath);
};

const screenshotPathFor = (caseNo: string): string =>
  `output/helper-artifacts/${caseNo}/${caseNo}-frontend-observation.png`;

const plainEvidenceInsufficientDetail = (caseNo: string): Record<string, unknown> => ({
  測試目的: `${caseNo} 前端 observation fixture。`,
  設定條件: "已完成本次 UI 導航，previewRequired=false。",
  預期行為: "畫面應符合 testcase 宣告的前端狀態。",
  實際行為: "本次只取得 screenshot artifact，DOM/ARIA/URL 結構化 observation assertion 不足，暫無法自動判 PASS。",
  blocked_reason: "EVIDENCE_INSUFFICIENT: missing structured frontend assertion.",
  previewRequired: false,
  currentRunEvidence: {
    screenshotPath: screenshotPathFor(caseNo),
    dom: {
      visibleText: ["拼貼報表"],
      structuredAssertion: null
    }
  }
});

const incompleteVisualContractDetail = (caseNo: string): Record<string, unknown> => ({
  ...plainEvidenceInsufficientDetail(caseNo),
  blocked_reason: "BLOCKED_NEEDS_VISUAL_REVIEW: screenshot exists but contract is incomplete.",
  evidenceSource: "screenshotVisual",
  screenshotPath: screenshotPathFor(caseNo)
});

const completeVisualContractDetail = (caseNo: string): Record<string, unknown> => ({
  ...plainEvidenceInsufficientDetail(caseNo),
  實際行為:
    "本次 screenshot artifact 可供人工視覺 review，但 DOM/ARIA/URL 結構化 observation assertion 不足，因此不自動判 PASS。",
  blocked_reason: "BLOCKED_NEEDS_VISUAL_REVIEW:RESULT_FRONTEND_OBSERVATION_VISUAL_FALLBACK_REQUIRED",
  evidenceSource: "screenshotVisual",
  screenshotPath: screenshotPathFor(caseNo),
  visualObservation:
    "Screenshot artifact exists and must be reviewed against the declared frontend expectation before converting this case to PASS/FAIL.",
  domEvidenceGap:
    "DOM/ARIA/URL structured assertion is missing, null, or insufficient for automatic frontend-observation judgment."
});

const runGate = async (xlsxPath: string, caseNo: string) => {
  const parsed = await parseResultXlsx(xlsxPath);
  return evaluateResultEvidenceGate({
    parsed,
    currentCaseNo: caseNo,
    expectedCaseNos: [caseNo],
    resultSource: "codex_generated",
    requireSingleCase: true
  });
};

const issueCodes = (report: { issues: Array<{ code: string; severity: string }> }): string[] =>
  report.issues.filter((item) => item.severity === "error").map((item) => item.code);

const main = async (): Promise<void> => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-p0-visual-fallback-contract-"));
  const sampledCases = [
    "BIUI_COLLAGE_R001-J-03",
    "BIUI_COLLAGE_R001-K-02",
    "BIUI_COLLAGE_R001-N-01"
  ];

  for (const caseNo of sampledCases) {
    const plain = path.join(tempRoot, `${caseNo}-plain.xlsx`);
    await writeWorkbook(plain, {
      caseNo,
      status: "BLOCKED",
      failCategory: "EVIDENCE_INSUFFICIENT",
      detailJson: plainEvidenceInsufficientDetail(caseNo)
    });
    const plainReport = await runGate(plain, caseNo);
    assert.equal(plainReport.status, "error", `${caseNo} plain screenshot blocker must not pass gate`);
    assert.ok(
      issueCodes(plainReport).includes("RESULT_FRONTEND_OBSERVATION_VISUAL_FALLBACK_REQUIRED"),
      `${caseNo} plain screenshot blocker must require visual fallback contract`
    );

    const incomplete = path.join(tempRoot, `${caseNo}-incomplete.xlsx`);
    await writeWorkbook(incomplete, {
      caseNo,
      status: "BLOCKED",
      failCategory: "BLOCKED_NEEDS_VISUAL_REVIEW",
      detailJson: incompleteVisualContractDetail(caseNo)
    });
    const incompleteReport = await runGate(incomplete, caseNo);
    assert.equal(incompleteReport.status, "error", `${caseNo} incomplete visual contract must not pass gate`);
    assert.ok(
      issueCodes(incompleteReport).includes("RESULT_FRONTEND_OBSERVATION_VISUAL_FALLBACK_REQUIRED"),
      `${caseNo} incomplete visual contract must still require visualObservation/domEvidenceGap`
    );

    const complete = path.join(tempRoot, `${caseNo}-complete.xlsx`);
    await writeWorkbook(complete, {
      caseNo,
      status: "BLOCKED",
      failCategory: "BLOCKED_NEEDS_VISUAL_REVIEW",
      detailJson: completeVisualContractDetail(caseNo)
    });
    const completeReport = await runGate(complete, caseNo);
    assert.equal(
      completeReport.status,
      "ok",
      `${caseNo} complete visual fallback contract should pass result gate; issues=${JSON.stringify(completeReport.issues)}`
    );
  }

  console.log(JSON.stringify({
    fixture: "p0-visual-fallback-contract",
    status: "ok",
    totalCategoryCases: visualFallbackCaseNos.length,
    sampledCases
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
