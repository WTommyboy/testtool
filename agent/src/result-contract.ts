import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

export type ResultParserAdapter = {
  schemaVersion: string;
  adapterVersion: string;
  parser: string;
  sheets: {
    index: string;
    cases: string;
    bugs: string;
  };
  headers: {
    cases: string[];
    bugs: string[];
    optionalBugHeaders?: string[];
  };
  detailJsonRequiredFields: Record<string, string[]>;
};

export type ResultContractIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  context?: Record<string, unknown>;
};

export type ResultContractReport = {
  schemaVersion: "result-contract-check-v1";
  generatedAt: string;
  status: "ok" | "error";
  adapterVersion: string;
  issues: ResultContractIssue[];
};

export type ResultContractContainmentReport = {
  schemaVersion: "result-contract-containment-v1";
  generatedAt: string;
  status: "updated" | "skipped";
  reason: string;
  updatedCaseNos: string[];
  backupPath?: string;
};

export type ResultContractOptions = {
  runDir?: string;
};

const defaultAdapter: ResultParserAdapter = {
  schemaVersion: "result-parser-adapter-v1",
  adapterVersion: "bi-result-adapter-mvp-v1",
  parser: "result-xlsx-parser",
  sheets: {
    index: "索引",
    cases: "測試案例",
    bugs: "Bug"
  },
  headers: {
    cases: ["群組ID", "群組", "編號", "測試項目", "測試類型", "執行方式", "結果", "失敗分類", "詳細紀錄JSON"],
    bugs: ["嚴重度", "Bug ID", "關聯編號", "標題", "描述", "建議", "狀態"],
    optionalBugHeaders: ["Evidence"]
  },
  detailJsonRequiredFields: {
    PASS: ["測試目的", "設定條件", "預期行為", "實際行為"],
    FAIL: ["測試目的", "設定條件", "預期行為", "實際行為", "錯誤原因", "根因層級", "驗證方法", "RD 分派"],
    BLOCKED: ["測試目的", "設定條件", "預期行為", "實際行為", "blocked_reason"],
    PARTIAL: ["部分符合的子項清單", "不符的子項清單"]
  }
};

const adapterPathCandidates = (): string[] => [
  path.resolve(__dirname, "../../domain-packs/BI/result_parser_adapter.json"),
  path.resolve(process.cwd(), "domain-packs/BI/result_parser_adapter.json"),
  path.resolve(process.cwd(), "../domain-packs/BI/result_parser_adapter.json")
];

const asStringArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length === value.length ? items : null;
};

export const loadResultParserAdapter = (): ResultParserAdapter => {
  const filePath = adapterPathCandidates().find((candidate) => fs.existsSync(candidate));
  if (!filePath) return defaultAdapter;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<ResultParserAdapter>;
    return {
      ...defaultAdapter,
      ...parsed,
      sheets: {
        ...defaultAdapter.sheets,
        ...(parsed.sheets ?? {})
      },
      headers: {
        ...defaultAdapter.headers,
        ...(parsed.headers ?? {}),
        cases: asStringArray(parsed.headers?.cases) ?? defaultAdapter.headers.cases,
        bugs: asStringArray(parsed.headers?.bugs) ?? defaultAdapter.headers.bugs,
        optionalBugHeaders: asStringArray(parsed.headers?.optionalBugHeaders) ?? defaultAdapter.headers.optionalBugHeaders
      },
      detailJsonRequiredFields: {
        ...defaultAdapter.detailJsonRequiredFields,
        ...(parsed.detailJsonRequiredFields ?? {})
      }
    };
  } catch {
    return defaultAdapter;
  }
};

const text = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (typeof value === "object") {
    const rich = value as { richText?: Array<{ text?: string }> };
    if (Array.isArray(rich.richText)) return rich.richText.map((item) => item.text ?? "").join("").trim();
  }
  return String(value).trim();
};

const normalize = (value: unknown): string => text(value).toLowerCase().replace(/\s+/g, "");

const normalizeCaseNo = (value: string | null | undefined): string =>
  (value ?? "").trim().replace(/\s+/g, "").replace(/^DEMO-/i, "").toUpperCase();

const headerValues = (row: ExcelJS.Row): string[] => {
  const values: string[] = [];
  row.eachCell((cell) => values.push(text(cell.value)));
  return values;
};

const findHeaderIndex = (headers: string[], name: string): number => {
  const target = normalize(name);
  return headers.findIndex((header) => normalize(header) === target);
};

const requireHeaders = (
  issues: ResultContractIssue[],
  sheetName: string,
  actual: string[],
  expected: string[]
): void => {
  for (const header of expected) {
    if (findHeaderIndex(actual, header) === -1) {
      issues.push({
        severity: "error",
        code: "RESULT_XLSX_HEADER_MISSING",
        message: `${sheetName} sheet is missing required header: ${header}`,
        context: { sheetName, header, actualHeaders: actual }
      });
    }
  }
};

const parseDetail = (raw: string): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const readJsonIfExists = <T>(filePath: string): T | null => {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
};

const sanitizePathPart = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown-case";

const record = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
);

const falseChecks = (checks: unknown): string[] => {
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) return [];
  return Object.entries(checks as Record<string, unknown>)
    .filter(([, value]) => value === false)
    .map(([key]) => key);
};

const dateUiEvidenceMatchesRequested = (value: unknown): boolean => {
  const dateUiEvidence = record(value);
  const checks = record(dateUiEvidence?.checks);
  return checks?.representedRangeMatchesRequested === true || checks?.staticRequestedRangeObserved === true;
};

const configureMetricDateRangeVerified = (parsed: Record<string, unknown>): boolean => {
  const evidence = record(parsed.evidence);
  const dateRangeEvidence = record(evidence?.dateRangeEvidence);
  if (dateRangeEvidence?.ok === false) return false;
  if (!staticDateRangeFlowVerified(dateRangeEvidence)) return false;
  return dateUiEvidenceMatchesRequested(dateRangeEvidence?.dateUiEvidence) || dateUiEvidenceMatchesRequested(evidence?.dateUiEvidence);
};

const outcomeSucceeded = (value: unknown): boolean =>
  record(value)?.actualOutcome === "succeeded" || record(value)?.outcome === "succeeded";

const staticDateRangeFlowVerified = (dateRangeEvidence: Record<string, unknown> | null): boolean => {
  if (!dateRangeEvidence) return true;
  const dateUiEvidence = record(dateRangeEvidence.dateUiEvidence);
  const requestedRange = record(dateUiEvidence?.requestedRange);
  const checks = record(dateUiEvidence?.checks);
  const isStaticRequestedRange = requestedRange?.basis === "static_range" || checks?.staticRequestedRangeObserved === true;
  if (!isStaticRequestedRange) return true;

  const interactionLog = record(dateRangeEvidence.interactionLog);
  const actions = record(interactionLog?.actions);
  const setStaticDateRange = record(actions?.setStaticDateRange);
  const steps = record(setStaticDateRange?.steps);
  if (outcomeSucceeded(setStaticDateRange) || outcomeSucceeded(steps?.openStaticTab)) return true;

  const inputs = record(dateRangeEvidence.inputs);
  const startResult = record(inputs?.startResult);
  const endResult = record(inputs?.endResult);
  if (
    startResult?.type === "static" &&
    endResult?.type === "static" &&
    startResult?.tabClicked === true &&
    endResult?.tabClicked === true &&
    startResult?.verified === true &&
    endResult?.verified === true
  ) {
    return true;
  }

  return false;
};

const configureMetricFalseChecksForPass = (parsed: Record<string, unknown>): string[] => {
  const evidence = record(parsed.evidence) ?? {};
  const stateDelta = record(evidence.stateDelta) ?? {};
  const after = record(stateDelta.after) ?? {};
  const failed = falseChecks(after.checks);
  if (!failed.includes("dateRange")) return failed;
  if (!configureMetricDateRangeVerified(parsed)) return failed;
  return failed.filter((item) => item !== "dateRange");
};

const helperEvidenceFalseChecksForPass = (runDir: string, caseNo: string): Array<{ reportPath: string; falseChecks: string[] }> => {
  const caseDir = path.join(runDir, "output", "helper-artifacts", sanitizePathPart(caseNo));
  const reports = [
    {
      fileName: "collage.configureMetric-latest.json",
      readFalseChecks: configureMetricFalseChecksForPass
    },
    {
      fileName: "collage.reopenReport-latest.json",
      readFalseChecks: (parsed: Record<string, unknown>) => {
        const evidence = record(parsed.evidence) ?? {};
        const reopen = record(evidence.reopenReportEvidence) ?? {};
        const stateDelta = record(reopen.stateDelta) ?? {};
        const after = record(stateDelta.after) ?? {};
        return falseChecks(after.checks);
      }
    }
  ];
  return reports.flatMap(({ fileName, readFalseChecks }) => {
    const reportPath = path.join(caseDir, fileName);
    const parsed = readJsonIfExists<Record<string, unknown>>(reportPath);
    if (!parsed) return [];
    const failed = readFalseChecks(parsed);
    return failed.length > 0 ? [{ reportPath: path.relative(runDir, reportPath), falseChecks: failed }] : [];
  });
};

export const validateResultWorkbookContract = async (
  filePath: string,
  adapter = loadResultParserAdapter(),
  options: ResultContractOptions = {}
): Promise<ResultContractReport> => {
  const issues: ResultContractIssue[] = [];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const caseSheet = workbook.getWorksheet(adapter.sheets.cases);
  const bugSheet = workbook.getWorksheet(adapter.sheets.bugs);
  if (!workbook.getWorksheet(adapter.sheets.index)) {
    issues.push({ severity: "error", code: "RESULT_XLSX_SHEET_MISSING", message: `Missing sheet: ${adapter.sheets.index}` });
  }
  if (!caseSheet) {
    issues.push({ severity: "error", code: "RESULT_XLSX_SHEET_MISSING", message: `Missing sheet: ${adapter.sheets.cases}` });
  }
  if (!bugSheet) {
    issues.push({ severity: "error", code: "RESULT_XLSX_SHEET_MISSING", message: `Missing sheet: ${adapter.sheets.bugs}` });
  }

  if (caseSheet) {
    const headers = headerValues(caseSheet.getRow(1));
    requireHeaders(issues, adapter.sheets.cases, headers, adapter.headers.cases);
    const caseNoIdx = findHeaderIndex(headers, "編號");
    const statusIdx = findHeaderIndex(headers, "結果");
    const detailIdx = findHeaderIndex(headers, "詳細紀錄JSON");
    const failCaseNos: Array<{ rowNo: number; caseNo: string }> = [];
    if (caseNoIdx !== -1 && statusIdx !== -1 && detailIdx !== -1) {
      for (let rowNo = 2; rowNo <= caseSheet.rowCount; rowNo += 1) {
        const row = caseSheet.getRow(rowNo);
        const caseNo = text(row.getCell(caseNoIdx + 1).value);
        if (!caseNo) continue;
        const status = text(row.getCell(statusIdx + 1).value).toUpperCase();
        if (status === "FAIL") failCaseNos.push({ rowNo, caseNo });
        const detail = parseDetail(text(row.getCell(detailIdx + 1).value));
        const required = adapter.detailJsonRequiredFields[status] ?? [];
        if (!detail) {
          issues.push({
            severity: "error",
            code: "RESULT_XLSX_DETAIL_JSON_INVALID",
            message: `${caseNo} detail_json is missing or invalid JSON object.`,
            context: { rowNo, caseNo, status }
          });
          continue;
        }
        for (const field of required) {
          if (!Object.prototype.hasOwnProperty.call(detail, field)) {
            issues.push({
              severity: "error",
              code: "RESULT_XLSX_DETAIL_FIELD_MISSING",
              message: `${caseNo} ${status} detail_json is missing required field: ${field}`,
              context: { rowNo, caseNo, status, field }
            });
          }
        }
        if (status === "PASS" && options.runDir) {
          for (const contradiction of helperEvidenceFalseChecksForPass(options.runDir, caseNo)) {
            issues.push({
              severity: "error",
              code: "RESULT_PASS_CONTRADICTS_HELPER_EVIDENCE",
              message: `${caseNo} is PASS but helper evidence has failed check(s): ${contradiction.falseChecks.join(",")}`,
              context: {
                rowNo,
                caseNo,
                status,
                helperReport: contradiction.reportPath,
                falseChecks: contradiction.falseChecks
              }
            });
          }
        }
      }
    }
    if (failCaseNos.length > 0 && bugSheet) {
      const bugHeaders = headerValues(bugSheet.getRow(1));
      const relatedCaseNoIdx = findHeaderIndex(bugHeaders, "關聯編號");
      const bugIdIdx = findHeaderIndex(bugHeaders, "Bug ID");
      const titleIdx = findHeaderIndex(bugHeaders, "標題");
      const descriptionIdx = findHeaderIndex(bugHeaders, "描述");
      const bugCaseKeys = new Set<string>();
      if (relatedCaseNoIdx !== -1) {
        for (let rowNo = 2; rowNo <= bugSheet.rowCount; rowNo += 1) {
          const row = bugSheet.getRow(rowNo);
          const relatedCaseNo = text(row.getCell(relatedCaseNoIdx + 1).value);
          const hasBugContent = [bugIdIdx, titleIdx, descriptionIdx]
            .filter((idx) => idx !== -1)
            .some((idx) => Boolean(text(row.getCell(idx + 1).value)));
          const key = normalizeCaseNo(relatedCaseNo);
          if (key && hasBugContent) bugCaseKeys.add(key);
        }
      }
      for (const item of failCaseNos) {
        if (bugCaseKeys.has(normalizeCaseNo(item.caseNo))) continue;
        issues.push({
          severity: "error",
          code: "RESULT_FAIL_BUG_ROW_MISSING",
          message: `${item.caseNo} is FAIL but Bug sheet has no row linked by 關聯編號.`,
          context: { rowNo: item.rowNo, caseNo: item.caseNo, expectedBugRelatedCaseNo: item.caseNo }
        });
      }
    }
  }

  if (bugSheet) {
    requireHeaders(issues, adapter.sheets.bugs, headerValues(bugSheet.getRow(1)), adapter.headers.bugs);
  }

  return {
    schemaVersion: "result-contract-check-v1",
    generatedAt: new Date().toISOString(),
    status: issues.some((item) => item.severity === "error") ? "error" : "ok",
    adapterVersion: adapter.adapterVersion,
    issues
  };
};

export const containPassContradictionsAsBlocked = async (
  filePath: string,
  contractReport: ResultContractReport,
  adapter = loadResultParserAdapter()
): Promise<ResultContractContainmentReport> => {
  const errorIssues = contractReport.issues.filter((item) => item.severity === "error");
  if (errorIssues.length === 0) {
    return {
      schemaVersion: "result-contract-containment-v1",
      generatedAt: new Date().toISOString(),
      status: "skipped",
      reason: "NO_SELF_CHECK_ERRORS",
      updatedCaseNos: []
    };
  }
  if (errorIssues.some((item) => item.code !== "RESULT_PASS_CONTRADICTS_HELPER_EVIDENCE")) {
    return {
      schemaVersion: "result-contract-containment-v1",
      generatedAt: new Date().toISOString(),
      status: "skipped",
      reason: "SELF_CHECK_HAS_NON_CONTAINABLE_ERRORS",
      updatedCaseNos: []
    };
  }

  const targetCaseNos = [...new Set(errorIssues.flatMap((item) => {
    const caseNo = item.context?.caseNo;
    return typeof caseNo === "string" && caseNo.trim() ? [caseNo.trim()] : [];
  }))];
  if (targetCaseNos.length === 0) {
    return {
      schemaVersion: "result-contract-containment-v1",
      generatedAt: new Date().toISOString(),
      status: "skipped",
      reason: "SELF_CHECK_CONTRADICTION_CASE_NO_MISSING",
      updatedCaseNos: []
    };
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const caseSheet = workbook.getWorksheet(adapter.sheets.cases);
  if (!caseSheet) {
    return {
      schemaVersion: "result-contract-containment-v1",
      generatedAt: new Date().toISOString(),
      status: "skipped",
      reason: "CASE_SHEET_MISSING",
      updatedCaseNos: []
    };
  }

  const headers = headerValues(caseSheet.getRow(1));
  const caseNoIdx = findHeaderIndex(headers, "編號");
  const statusIdx = findHeaderIndex(headers, "結果");
  const failCategoryIdx = findHeaderIndex(headers, "失敗分類");
  const detailIdx = findHeaderIndex(headers, "詳細紀錄JSON");
  if (caseNoIdx === -1 || statusIdx === -1 || failCategoryIdx === -1 || detailIdx === -1) {
    return {
      schemaVersion: "result-contract-containment-v1",
      generatedAt: new Date().toISOString(),
      status: "skipped",
      reason: "CASE_REQUIRED_HEADERS_MISSING",
      updatedCaseNos: []
    };
  }

  const targetSet = new Set(targetCaseNos.map(normalizeCaseNo));
  const issueByCase = new Map<string, ResultContractIssue[]>();
  for (const issue of errorIssues) {
    const caseNo = typeof issue.context?.caseNo === "string" ? issue.context.caseNo : "";
    const key = normalizeCaseNo(caseNo);
    if (!key) continue;
    issueByCase.set(key, [...(issueByCase.get(key) ?? []), issue]);
  }

  const updatedCaseNos: string[] = [];
  for (let rowNo = 2; rowNo <= caseSheet.rowCount; rowNo += 1) {
    const row = caseSheet.getRow(rowNo);
    const caseNo = text(row.getCell(caseNoIdx + 1).value);
    const key = normalizeCaseNo(caseNo);
    if (!targetSet.has(key)) continue;
    const status = text(row.getCell(statusIdx + 1).value).toUpperCase();
    if (status !== "PASS") continue;
    const previousDetail = parseDetail(text(row.getCell(detailIdx + 1).value)) ?? {};
    const issueSummaries = (issueByCase.get(key) ?? []).map((item) => ({
      code: item.code,
      message: item.message,
      context: item.context ?? {}
    }));
    row.getCell(statusIdx + 1).value = "BLOCKED";
    row.getCell(failCategoryIdx + 1).value = "BLOCKED_NEEDS_REJUDGMENT";
    row.getCell(detailIdx + 1).value = JSON.stringify({
      測試目的: previousDetail["測試目的"] ?? "Agent self-check containment for PASS/helper evidence contradiction.",
      設定條件: previousDetail["設定條件"] ?? "See original Codex detail_json before containment.",
      預期行為: previousDetail["預期行為"] ?? "PASS requires helper/evidence checks to support the required case scope.",
      實際行為: `${text(previousDetail["實際行為"]) || "Codex wrote PASS."} Agent self-check found PASS contradicts helper evidence, so this case was contained as BLOCKED_NEEDS_REJUDGMENT instead of failing the whole run.`,
      blocked_reason: "BLOCKED_NEEDS_REJUDGMENT:RESULT_PASS_CONTRADICTS_HELPER_EVIDENCE",
      original_result_before_agent_containment: "PASS",
      self_check_issues: issueSummaries,
      previous_detail_json: previousDetail
    });
    updatedCaseNos.push(caseNo);
  }

  if (updatedCaseNos.length === 0) {
    return {
      schemaVersion: "result-contract-containment-v1",
      generatedAt: new Date().toISOString(),
      status: "skipped",
      reason: "NO_PASS_ROWS_MATCHED",
      updatedCaseNos: []
    };
  }

  const backupPath = `${filePath}.pre-self-check-containment-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
  fs.copyFileSync(filePath, backupPath);
  await workbook.xlsx.writeFile(filePath);
  return {
    schemaVersion: "result-contract-containment-v1",
    generatedAt: new Date().toISOString(),
    status: "updated",
    reason: "PASS_CONTRADICTION_CONTAINED_AS_BLOCKED_NEEDS_REJUDGMENT",
    updatedCaseNos,
    backupPath
  };
};
