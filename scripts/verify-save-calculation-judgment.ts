import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..");

const read = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const requireIncludes = (relativePath: string, needle: string): void => {
  const content = read(relativePath);
  assert.ok(
    content.includes(needle),
    `${relativePath} should include policy marker: ${needle}`
  );
};

type DialogEvidence = {
  message?: string;
  handledReason?: string;
};

type NetworkResponseEvidence = {
  url?: string;
  status?: number;
};

type SaveEvidence = {
  reportName?: string;
  reportListEvidence?: { found?: boolean };
  dialogs?: DialogEvidence[];
  network?: { responses?: NetworkResponseEvidence[] };
  domState?: Record<string, unknown>;
};

const legacySaveEvidenceSupportsJudgment = (evidence: SaveEvidence): boolean => {
  if (evidence.reportListEvidence?.found === true) return true;
  const reportName = evidence.reportName?.trim();
  const responses = evidence.network?.responses ?? [];
  const dialogs = evidence.dialogs ?? [];
  const hasSaveOk = responses.some((item) =>
    Number(item.status) >= 200 &&
    Number(item.status) < 300 &&
    /save|report|collage|testview|api/i.test(String(item.url ?? ""))
  );
  const hasKnownDialogs = dialogs.some((item) =>
    /儲存成功|報表儲存成功|返回.*列表|回到.*列表/.test(`${item.message ?? ""} ${item.handledReason ?? ""}`)
  );
  const hasDomListSignal = /報表名稱|資料區間日期|下載|刪除|返回/.test(JSON.stringify(evidence.domState ?? {}));
  return Boolean(reportName && hasSaveOk && hasKnownDialogs && hasDomListSignal);
};

type CalculationRow = {
  numerator: number;
  denominator: number;
  calculated: number;
};

const calculatedDivisionEvidenceSupportsPass = (
  formula: string,
  rows: CalculationRow[],
  explicitlyRequiresNonZeroDenominator = false
): boolean => {
  if (explicitlyRequiresNonZeroDenominator) return false;
  if (!/\[新增帳號數\]\s*\/\s*\[MAU\(帳號\)\]/.test(formula)) return false;
  return rows.length > 0 && rows.every((row) =>
    row.denominator === 0 &&
    row.calculated === 0 &&
    Number.isFinite(row.numerator)
  );
};

const main = (): void => {
  requireIncludes(
    "agent/src/bi-ui-helper-executor.ts",
    "reportListEvidence"
  );
  requireIncludes(
    "agent/src/bi-ui-helper-executor.ts",
    "ensureSavedReportListRowVisible(options, page, reportName)"
  );
  requireIncludes(
    "agent/src/task-runner.ts",
    "division_by_zero_behavior=0"
  );
  requireIncludes(
    "agent-skills/uat-tool/rules/artifacts-and-results.md",
    "divide-by-zero=0"
  );
  requireIncludes(
    "agent-skills/uat-tool/rules/helper-protocol.md",
    "collage.saveReport"
  );

  assert.equal(
    legacySaveEvidenceSupportsJudgment({
      reportName: "UAT_F01_20260513",
      dialogs: [
        { message: "報表儲存成功", handledReason: "known_bi_save_success_dialog" },
        { message: "是否返回報表列表", handledReason: "known_bi_save_return_to_list_confirm" }
      ],
      network: {
        responses: [{ url: "/api/collage/report/save", status: 200 }]
      },
      domState: {
        bodyText: "報表名稱 UAT_F01_20260513 資料區間日期 下載 刪除"
      }
    }),
    true,
    "legacy save evidence should be enough to judge without exact reportListEvidence key"
  );

  assert.equal(
    calculatedDivisionEvidenceSupportsPass(
      "[新增帳號數]/[MAU(帳號)]",
      [
        { numerator: 3, denominator: 0, calculated: 0 },
        { numerator: 0, denominator: 0, calculated: 0 }
      ]
    ),
    true,
    "all-zero denominator with BI 0 result should support calculated-field PASS when testcase tests formula behavior"
  );

  assert.equal(
    calculatedDivisionEvidenceSupportsPass(
      "[新增帳號數]/[MAU(帳號)]",
      [{ numerator: 3, denominator: 0, calculated: 0 }],
      true
    ),
    false,
    "explicit non-zero denominator requirement still blocks all-zero samples"
  );

  console.log("verify:save-calculation-judgment ok");
};

main();
