import assert from "node:assert/strict";
import fs from "node:fs";

type CaseStatus = "PASS" | "FAIL" | "BLOCKED" | "PM_SKIPPED" | "PENDING" | "PARTIAL";

type SummaryCase = {
  caseNo: string;
  title: string;
  status: CaseStatus;
  note: string;
};

type CategoryKey =
  | "result_gate_visual_fallback_contract_gap"
  | "wrong_observation_route_or_missing_case_contract"
  | "missing_action_template_or_incomplete_helper_flow"
  | "testcase_precondition_not_met"
  | "domain_metadata_or_field_picker_gap"
  | "date_helper_or_product_gap"
  | "save_reopen_row_download_flow_gap"
  | "navigation_template_gap"
  | "manual_review_required";

const defaultReportPath = "/Users/tommy/Downloads/UAT_report_ee0cae6b-f2c4-4cb0-a5aa-d79f5b611ca3-3.md";

const expectedBaseline = {
  totalCases: 108,
  blockedCases: 48,
  categories: {
    result_gate_visual_fallback_contract_gap: 11,
    wrong_observation_route_or_missing_case_contract: 4,
    missing_action_template_or_incomplete_helper_flow: 7,
    testcase_precondition_not_met: 1,
    domain_metadata_or_field_picker_gap: 5,
    date_helper_or_product_gap: 2,
    save_reopen_row_download_flow_gap: 10,
    navigation_template_gap: 1,
    manual_review_required: 7
  } satisfies Record<CategoryKey, number>
};

const stripMarkdown = (value: string): string =>
  value.replace(/\*\*/g, "").replace(/`/g, "").trim();

const splitMarkdownRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => stripMarkdown(cell));

const normalizeStatus = (value: string): CaseStatus | null => {
  const normalized = stripMarkdown(value).toUpperCase();
  if (normalized === "PASS") return "PASS";
  if (normalized === "FAIL" || normalized === "FAILED") return "FAIL";
  if (normalized === "BLOCKED") return "BLOCKED";
  if (normalized === "PM_SKIPPED") return "PM_SKIPPED";
  if (normalized === "PENDING") return "PENDING";
  if (normalized === "PARTIAL") return "PARTIAL";
  return null;
};

const parseSummaryCases = (reportPath: string): SummaryCase[] => {
  const content = fs.readFileSync(reportPath, "utf8");
  const casesByNo = new Map<string, SummaryCase>();
  for (const line of content.split(/\r?\n/)) {
    if (!line.startsWith("| BIUI_COLLAGE_R001-")) continue;
    const cells = splitMarkdownRow(line);
    const caseNo = cells[0]?.match(/BIUI_COLLAGE_R001-[A-Z]-\d{2}/)?.[0];
    const status = cells.map(normalizeStatus).find((item): item is CaseStatus => item !== null);
    if (!caseNo || !status || casesByNo.has(caseNo)) continue;
    casesByNo.set(caseNo, {
      caseNo,
      title: cells[1] ?? "",
      status,
      note: cells[cells.length - 1] ?? ""
    });
  }
  return [...casesByNo.values()];
};

const classifyBlocked = (item: SummaryCase): CategoryKey => {
  const text = `${item.title}\n${item.note}`;

  if (/Server result evidence gate detected screenshot evidence/.test(text)) {
    return "result_gate_visual_fallback_contract_gap";
  }
  if (/observationType.*rowDeleteTooltip|僅對 projectList\.rowDeleteAction|僅完成.*sidebar|僅執行.*rowDeleteTooltip|使用 observationType=projectLimitToast|本次僅取得.*rowDeleteTooltip/.test(text)) {
    return "wrong_observation_route_or_missing_case_contract";
  }
  if (/前置條件未成立|4\(<5\)|專案數\s*4/.test(text)) {
    return "testcase_precondition_not_met";
  }
  if (/metadata|trueDifferenceCount|OFFICIAL_SOURCE_OPTION_NOT_FOUND|FIELD_PICKER_STALE|欄位選擇器|欄位配置/.test(text)) {
    return "domain_metadata_or_field_picker_gap";
  }
  if (/locator.*timeout|#startDayInput|日期變體|DATE_RANGE|靜態/.test(text)) {
    return "date_helper_or_product_gap";
  }
  if (/BACK_TO_PROJECT_LIST|返回按鈕|返回操作/.test(text)) {
    return "navigation_template_gap";
  }
  if (/儲存|清單|reopen|row-download|報表列|saved report|複製副本/.test(text)) {
    return "save_reopen_row_download_flow_gap";
  }
  if (/未執行|未提供|未包含|未取得.*完整|可用證據僅到前置|僅取得 helper 前置導航|未取得執行|未見.*證據鏈/.test(text)) {
    return "missing_action_template_or_incomplete_helper_flow";
  }
  return "manual_review_required";
};

const parseArgs = (): { reportPath: string; allowDrift: boolean } => {
  let reportPath = defaultReportPath;
  let allowDrift = false;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    const next = process.argv[index + 1];
    if (arg === "--report") {
      if (!next) throw new Error("--report requires a path");
      reportPath = next;
      index += 1;
    } else if (arg === "--allow-drift") {
      allowDrift = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { reportPath, allowDrift };
};

const main = (): void => {
  const { reportPath, allowDrift } = parseArgs();
  const rows = parseSummaryCases(reportPath);
  const blocked = rows.filter((item) => item.status === "BLOCKED");
  const grouped = new Map<CategoryKey, SummaryCase[]>();
  for (const item of blocked) {
    const key = classifyBlocked(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  const categoryCounts = Object.fromEntries(
    Object.keys(expectedBaseline.categories).map((key) => [key, grouped.get(key as CategoryKey)?.length ?? 0])
  ) as Record<CategoryKey, number>;

  const summary = {
    fixture: "p0-108-blocked-triage",
    reportPath,
    totalCases: rows.length,
    blockedCases: blocked.length,
    categoryCounts,
    categories: Object.fromEntries(
      [...grouped.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([key, cases]) => [key, cases.map((item) => item.caseNo)])
    )
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!allowDrift) {
    assert.equal(rows.length, expectedBaseline.totalCases, "108-run report parser must see every testcase row");
    assert.equal(blocked.length, expectedBaseline.blockedCases, "baseline BLOCKED count drifted");
    assert.deepEqual(categoryCounts, expectedBaseline.categories, "blocked triage category baseline drifted");
  }
};

main();
