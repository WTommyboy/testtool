import fs from "node:fs";
import path from "node:path";
import type { CaseManifestCase } from "./case-manifest";
import type { HelperHints } from "./helper-hints";
import { detectCaseFeatures, isNeutralCleanupTarget, parseCleanupTargets } from "./case-feature-detection";

export type HelperPlanAction = {
  id: string;
  template: string;
  title: string;
  params: Record<string, unknown>;
  mutatesUi: boolean;
  requiresToolBridge: boolean;
  optional: boolean;
  canJudgeResult: false;
  requiredEvidence: string[];
  screenshotPolicy: "major_step" | "required_if_possible" | "failure_only";
  notes: string[];
};

export type HelperExecutionPlan = {
  schemaVersion: "helper-execution-plan-v1";
  generatedAt: string;
  caseId: string | null;
  mode: "single_case_helper_assisted_uat";
  executor: {
    kind: "mac-agent-playwright-cdp";
    command: string;
    reportPath: string;
    artifactRoot: string;
  };
  policy: string[];
  safety: {
    helperMayWriteResultXlsx: false;
    helperMayJudgePassFail: false;
    helperMayRunMultipleCases: false;
    helperMayUseDirectBiApi: false;
    helperMayUseInternalJsSetter: false;
    helperMayBypassActionabilityCheck: false;
    codexMustJudgeResult: true;
  };
  helperHints: {
    found: boolean;
    operationTemplate: string | null;
    automationLevel: string | null;
    aiDecisionRequired: boolean | null;
  };
  actions: HelperPlanAction[];
  availableTemplates: HelperPlanAction[];
};

type WriteHelperExecutionPlanOptions = {
  runDir: string;
  currentCase: CaseManifestCase | null;
  helperHints: HelperHints | null;
};

const textBlob = (item: CaseManifestCase | null): string =>
  [
    item?.groupId,
    item?.groupName,
    item?.caseNo,
    item?.caseTitle,
    item?.testType,
    item?.riskLevel,
    item?.testTarget,
    item?.cleanupChecklist,
    item?.preconditions,
    item?.stepsSummary,
    item?.expected,
    item?.validationMethod
  ]
    .filter(Boolean)
    .join("\n");

const firstMatch = (text: string, patterns: RegExp[]): string | null => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return null;
};

const paramsObject = (helperHints: HelperHints | null): Record<string, unknown> => {
  return helperHints?.params && typeof helperHints.params === "object" && !Array.isArray(helperHints.params)
    ? (helperHints.params as Record<string, unknown>)
    : {};
};

const stringParam = (params: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const booleanishParam = (params: Record<string, unknown>, keys: string[]): boolean => {
  for (const key of keys) {
    const value = params[key];
    if (value === true) return true;
    if (typeof value === "string" && /^(true|yes|y|1|是|要)$/i.test(value.trim())) return true;
  }
  return false;
};

const nonNeutral = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed || isNeutralCleanupTarget(trimmed)) return null;
  return trimmed;
};

const helperScope = (params: Record<string, unknown>): string | null => stringParam(params, ["scope", "executionScope", "helperScope"]);

const helperRequestsPreviewOnly = (params: Record<string, unknown>): boolean =>
  /^(preview_only|preview-only|preview|d0|d0_only|d0-only)$/i.test(helperScope(params) ?? "");

const helperRequestsNoSave = (params: Record<string, unknown>): boolean =>
  helperRequestsPreviewOnly(params) || booleanishParam(params, ["skipSave", "doNotSave", "noSave", "previewOnly"]);

const helperRequestsNoReopen = (params: Record<string, unknown>): boolean =>
  helperRequestsPreviewOnly(params) || booleanishParam(params, ["skipReopen", "doNotReopen", "noReopen", "previewOnly"]);

const helperRequestsDownload = (params: Record<string, unknown>): boolean =>
  booleanishParam(params, ["downloadCsv", "doDownloadCsv", "downloadCSV", "download", "csvDownload", "needCsv"]);

const helperExplicitlyDisablesDownload = (params: Record<string, unknown>): boolean =>
  booleanishParam(params, ["skipDownload", "doNotDownload", "noDownload", "doNotDownloadCsv", "skipCsv", "noCsv"]);

const helperRequestsNoDownload = (params: Record<string, unknown>): boolean =>
  helperRequestsDownload(params)
    ? false
    : helperRequestsPreviewOnly(params) || helperExplicitlyDisablesDownload(params);

const helperHintsRequestManualAi = (helperHints: HelperHints | null): boolean =>
  helperHints?.automationLevel === "manual_ai" || helperHints?.operationTemplate === "manual_ai";

const isAllZeroFieldInspectionCase = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  const operationTemplate = helperHints?.operationTemplate ?? "";
  const isA06LikeCase = /(?:^|[-_])A[-_]?06$/i.test(currentCase?.caseNo ?? "");
  return operationTemplate === "collage_all_zero_field_inspection" ||
    (isA06LikeCase && /全為\s*0\s*欄位|全\s*0\s*欄位|值全為\s*0|all[-_ ]?zero/i.test(textBlob(currentCase)));
};

const isDeleteReportFlow = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  const operationTemplate = helperHints?.operationTemplate ?? "";
  const text = textBlob(currentCase);
  return operationTemplate === "collage_delete_temporary_report" ||
    /刪除報表|刪除.*臨時報表|delete\s+(?:temporary\s+)?report|delete-temp-report/i.test(text);
};

const needsCollageNavigationPrelude = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  const features = detectCaseFeatures(currentCase, helperHints);
  if (features.mode !== "collage" || features.hasFilter || features.hasGroup) return false;
  const text = textBlob(currentCase);
  if (/新增專案/.test(text) && !/新增報表|報表設定|設定頁|\+\s*新增欄位|欄位選擇|時間區間|preview|預覽|執行/.test(text)) {
    return false;
  }
  return /拼貼模式|專案頁|新增報表|報表設定|設定頁|\+\s*新增欄位|欄位選擇|時間區間|preview|預覽|執行/.test(text);
};

const needsReportEditorPrelude = (currentCase: CaseManifestCase | null): boolean => {
  const titleAndSteps = [currentCase?.caseTitle, currentCase?.preconditions, currentCase?.stepsSummary]
    .filter(Boolean)
    .join("\n");
  const explicitlyOpensEditor =
    /新增報表頁|報表設定|設定頁|\+\s*新增欄位|欄位選擇|時間區間|dateRange|preview|預覽|按執行|點「?執行/.test(titleAndSteps) ||
    /(點|按|點擊|開啟|進入).{0,12}(\+\s*)?新增報表/.test(titleAndSteps);
  if (/專案頁/.test(titleAndSteps) && !explicitlyOpensEditor) return false;
  const text = textBlob(currentCase);
  return (
    explicitlyOpensEditor ||
    /報表設定|設定頁|\+\s*新增欄位|欄位選擇|時間區間|dateRange|preview|預覽|按執行|點「?執行/.test(text)
  );
};

const dateRequiresCodexVisibleUi = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  const params = paramsObject(helperHints);
  const cleanup = parseCleanupTargets(currentCase?.cleanupChecklist);
  const dateVariants = firstStringArrayParam(params, ["dateVariants", "uiLabels"]);
  if (dateVariants.length > 1) return true;
  const dateText = [
    stringParam(params, ["dateRange", "timeRange"]),
    dateObjectParam(params.dateRange),
    ...dateVariants,
    cleanup["時間"],
    currentCase?.stepsSummary,
    currentCase?.expected
  ]
    .filter(Boolean)
    .join("\n");
  return /半動態|自訂動態|動態區間|天前|天後|快捷起點|快捷訖點|快捷終點|跨\s*9[01]\s*天|90\s*天|91\s*天|連續切換|不同區間/.test(dateText);
};

const cleanReportNamePattern = (value: string | null): string | null => {
  if (!value) return null;
  const cleaned = value.replace(/[)）]\s*$/, "").trim();
  return cleaned || null;
};

const splitCompositeMetricFields = (value: string | null): string[] => {
  if (!value) return [];
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of value) {
    if (char === "(" || char === "（" || char === "[" || char === "【") depth += 1;
    if (char === ")" || char === "）" || char === "]" || char === "】") depth = Math.max(0, depth - 1);
    if (depth === 0 && (char === "+" || char === "＋" || char === "、" || char === "," || char === "，")) {
      const part = current.trim();
      if (part) parts.push(part);
      current = "";
      continue;
    }
    current += char;
  }
  const tail = current.trim();
  if (tail) parts.push(tail);
  return [...new Set(parts)];
};

const stringArrayParam = (params: Record<string, unknown>, key: string): string[] => {
  const value = params[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
};

const firstStringArrayParam = (params: Record<string, unknown>, keys: string[]): string[] => {
  for (const key of keys) {
    const values = stringArrayParam(params, key);
    if (values.length > 0) return values;
  }
  return [];
};

const rawArrayParam = (params: Record<string, unknown>, key: string): unknown[] | null =>
  Array.isArray(params[key]) ? (params[key] as unknown[]) : null;

const dateObjectParam = (value: unknown): string | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const start = typeof record.start === "string" ? record.start.trim() : "";
  const end = typeof record.end === "string" ? record.end.trim() : "";
  if (!start || !end) return null;
  return `${start.replaceAll("-", "/")}~${end.replaceAll("-", "/")}`;
};

const structuredStaticDateRangeParam = (params: Record<string, unknown>): string | null => {
  const start = params.start;
  const end = params.end;
  if (!start || !end || typeof start !== "object" || typeof end !== "object" || Array.isArray(start) || Array.isArray(end)) {
    return null;
  }
  const startRecord = start as Record<string, unknown>;
  const endRecord = end as Record<string, unknown>;
  const startType = typeof startRecord.type === "string" ? startRecord.type.trim().toLowerCase() : "";
  const endType = typeof endRecord.type === "string" ? endRecord.type.trim().toLowerCase() : "";
  const startDate = typeof startRecord.date === "string" ? startRecord.date.trim() : "";
  const endDate = typeof endRecord.date === "string" ? endRecord.date.trim() : "";
  if (startType !== "static" || endType !== "static" || !startDate || !endDate) return null;
  return `${startDate.replaceAll("-", "/")}~${endDate.replaceAll("-", "/")}`;
};

const numberParam = (params: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
};

const inferReportNamePattern = (text: string, params: Record<string, unknown>): string | null =>
  cleanReportNamePattern(
    stringParam(params, ["reportName", "reportNamePattern"]) ??
      firstMatch(text, [/報表名[：:]\s*([^\n]+)/, /報表名稱[：:]\s*([^\n]+)/, /(OTTEST\d+_[A-Z]\d{2}_[A-Za-z0-9_-]+(?:_<timestamp>)?)/i, /(TOOL_[A-Z]\d{2}_<timestamp>)/i, /(TOOL_[A-Z]\d{2}_[A-Za-z0-9_-]+)/i])
  );

const inferExistingReportNamePattern = (text: string, params: Record<string, unknown>, fallbackReportNamePattern: string | null): string | null =>
  cleanReportNamePattern(
    stringParam(params, ["existingReportName", "existingReportNamePattern", "savedReportName"]) ??
      firstMatch(text, [/(OTTEST\d+_[A-Z]\d{2}_[A-Za-z0-9_-]+(?:_<timestamp>)?)/i, /(TOOL_A01_<timestamp>)/i, /(TOOL_A01_[A-Za-z0-9_-]+)/i, /(TOOL_[A-Z]\d{2}_<timestamp>)/i]) ??
      fallbackReportNamePattern
  );

const inferCollageParams = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): Record<string, unknown> => {
  const text = textBlob(currentCase);
  const cleanup = parseCleanupTargets(currentCase?.cleanupChecklist);
  const params = paramsObject(helperHints);
  const allZeroFieldInspection = isAllZeroFieldInspectionCase(currentCase, helperHints);
  const selectAllFields =
    allZeroFieldInspection ||
    booleanishParam(params, ["selectAllFields", "selectAll", "selectAllMetrics"]) ||
    booleanishParam(params, ["selectAllFieldsInSourceReport", "selectAllSourceFields"]);
  const dateVariants = firstStringArrayParam(params, ["dateVariants", "uiLabels"]);
  const field = selectAllFields
    ? null
    : nonNeutral(stringParam(params, ["field", "metric", "metricField"])) ??
      nonNeutral(cleanup["欄位"]) ??
      nonNeutral(firstMatch(text, [/欄位[「=：: ]+([^」\n,，;；]+)/]));
  const fields = splitCompositeMetricFields(field);
  const reportNamePattern = inferReportNamePattern(text, params);
  const modifiesExistingReport =
    booleanishParam(params, ["openExistingReport", "modifyExistingReport", "overwriteExisting"]) ||
    /修改既有|既有報表.{0,20}(?:修改|覆寫|覆盖)|已儲存報表.{0,20}(?:修改|覆寫|覆盖)|儲存覆寫|覆寫|覆盖/.test(text);
  const existingReportNamePattern = inferExistingReportNamePattern(text, params, reportNamePattern);
  const dateRangeText =
    nonNeutral(stringParam(params, ["dateRange", "timeRange"])) ??
    nonNeutral(dateObjectParam(params.dateRange)) ??
    nonNeutral(structuredStaticDateRangeParam(params)) ??
    (dateVariants.length === 1 ? nonNeutral(dateVariants[0]) : null) ??
    nonNeutral(cleanup["時間"]) ??
    firstMatch(text, [/(\d{4}\/\d{2}\/\d{2}\s*[~～-]\s*\d{4}\/\d{2}\/\d{2})/]);
  const sourceReportsParam = stringArrayParam(params, "sourceReports");
  const explicitSource = stringParam(params, ["source", "sourceReport"]);
  const inferredSource = selectAllFields && sourceReportsParam.length > 0
    ? null
    : firstMatch(text, [/來源報表[=：: ]*「?([^」\n,， ]+)/]);
  const effectiveSource = explicitSource ?? inferredSource;
  const sourceReports = sourceReportsParam.length > 0
    ? sourceReportsParam
    : allZeroFieldInspection && effectiveSource
      ? [effectiveSource]
      : sourceReportsParam;

  return {
    ...params,
    devUrl: stringParam(params, ["devUrl"]) ?? null,
    projectName: stringParam(params, ["projectName", "project"]) ?? firstMatch(text, [/(拼貼test[_\d]+)/i]),
    source: explicitSource ?? inferredSource,
    referenceCsv: stringParam(params, ["referenceCsv"]) ?? "rules/BI_DATA/metadata.csv",
    referenceSourcePath: stringParam(params, ["referenceSourcePath"]) ?? null,
    referenceSourceName: stringParam(params, ["referenceSourceName"]) ?? firstMatch(text, [/原始指定檔名[=：: ]+`?([^`\n;]+)/, /source filename[=：: ]+`?([^`\n;]+)/i]),
    referenceIndexKey: stringParam(params, ["referenceIndexKey"]) ?? firstMatch(text, [/reference-index key[=：: ]+`?([^`\n;]+)/i, /reference_index_key[=：: ]+`?([^`\n;]+)/i]) ?? "bi_metadata_csv",
    matchKey: stringParam(params, ["matchKey"]) ?? "欄位名稱",
    compareFields: rawArrayParam(params, "compareFields") ?? ["欄位名稱", "資料類型"],
    comparisonScope: stringParam(params, ["comparisonScope"]) ?? null,
    downloadScope: stringParam(params, ["downloadScope"]) ??
      (helperRequestsDownload(params) && helperRequestsNoSave(params)
        ? "editor_session"
        : /同\s*editor|editor\s*session|設定頁|絕不\s*(?:save|儲存|reopen|重開|回專案頁)|不\s*(?:save|儲存|reopen|重開)/i.test(text)
        ? "editor_session"
        : /清單|列表|專案頁|報表列|report list/i.test(text)
          ? "report_list"
          : null),
    allZeroFieldInspection,
    field,
    fields,
    sourceReports,
    sourceReport: stringParam(params, ["sourceReport"]) ?? stringParam(params, ["source"]) ?? effectiveSource,
    expectedReportSources: stringArrayParam(params, "expectedReportSources"),
    expectedReportSourceCount: numberParam(params, ["expectedReportSourceCount"]),
    expectedTotalFieldCount: numberParam(params, ["expectedTotalFieldCount", "totalFieldCount"]),
    selectAllFields,
    selectAllFieldsInSourceReport: booleanishParam(params, ["selectAllFieldsInSourceReport", "selectAllSourceFields"]),
    expectedFieldCount: numberParam(params, ["expectedFieldCount", "fieldCount", "expectedFieldsCount"]),
    dateVariants,
    dateRange: dateRangeText,
    display: nonNeutral(stringParam(params, ["display", "displayMode"])) ?? nonNeutral(cleanup["顯示"]) ?? null,
    skipSave: helperRequestsNoSave(params),
    skipReopen: helperRequestsNoReopen(params),
    skipDownload: helperRequestsNoDownload(params),
    cleanupChecklist: currentCase?.cleanupChecklist ?? null,
    cleanupTargets: cleanup,
    reportNamePattern,
    existingReportNamePattern,
    existingReportSourceCaseNo: modifiesExistingReport ? "TOOL-A-01" : null,
    openExistingReport: modifiesExistingReport,
    overwriteExisting: modifiesExistingReport
  };
};

const canRunDatePreviewEvidenceHelper = (params: Record<string, unknown>, currentCase: CaseManifestCase | null): boolean => {
  const dateVariants = stringArrayParam(params, "dateVariants");
  const dateMode = String(params.dateMode ?? "").trim().toLowerCase();
  const dateRange = typeof params.dateRange === "string" ? params.dateRange.trim() : "";
  if (dateVariants.length > 0 && (!dateMode || dateMode === "preset")) return true;
  if (
    (dateMode === "relative" || dateMode === "hybrid") &&
    (typeof params.startOffsetDays === "number" || typeof params.endOffsetDays === "number" || params.start || params.end)
  ) {
    return true;
  }
  if (dateMode === "static" && dateRange) return true;
  if ((dateRange.match(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/g) ?? []).length >= 2) return true;
  if (dateObjectParam(params.dateRange)) return true;
  if (structuredStaticDateRangeParam(params)) return true;
  return /operationTemplate[：:]\s*collage_date_variants_preview/.test(textBlob(currentCase));
};

const hasFormulaParams = (params: Record<string, unknown>): boolean =>
  typeof params.formula === "string" && params.formula.trim().length > 0;

const isCreateProjectFlow = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  const operationTemplate = helperHints?.operationTemplate ?? "";
  const text = textBlob(currentCase);
  const params = paramsObject(helperHints);
  return operationTemplate === "collage_create_project" ||
    Boolean(stringParam(params, ["projectNamePrefix", "projectNamePattern"])) ||
    /新增專案|create\s+project/i.test(text);
};

const isCreateProjectOnlyFlow = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  if (!isCreateProjectFlow(currentCase, helperHints)) return false;
  const params = paramsObject(helperHints);
  if (booleanishParam(params, ["createNewProject", "createProjectThenReport"])) return false;
  const operationTemplate = helperHints?.operationTemplate ?? "";
  if (/collage_build_preview_save_reopen|download_csv_verify|save_load_flow/.test(operationTemplate)) return false;
  const text = textBlob(currentCase);
  return !/新增報表|報表設定|欄位|時間區間|preview|預覽|執行|儲存報表|儲存|下載|CSV|reopen|重開|返回/.test(text);
};

const isOpenReportFromProjectListFlow = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  const params = paramsObject(helperHints);
  const text = `${textBlob(currentCase)}\n${stringParam(params, ["action", "verifyOnly"]) ?? ""}`;
  return /報表名稱.{0,20}(?:進入|編輯|reopen)|點.*報表名稱|click\s+report\s+name|enter\s+editor/i.test(text);
};

const isBackToProjectListFlow = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  const params = paramsObject(helperHints);
  const text = `${textBlob(currentCase)}\n${stringParam(params, ["action", "verifyOnly"]) ?? ""}`;
  return /返回按鈕|點.*返回|click\s+back|return\s+to\s+project/i.test(text);
};

const action = (
  id: string,
  template: string,
  title: string,
  params: Record<string, unknown>,
  overrides: Partial<Omit<HelperPlanAction, "id" | "template" | "title" | "params" | "canJudgeResult">> = {}
): HelperPlanAction => ({
  id,
  template,
  title,
  params,
  mutatesUi: true,
  requiresToolBridge: false,
  optional: false,
  canJudgeResult: false,
  requiredEvidence: ["dom.state", "screenshot"],
  screenshotPolicy: "major_step",
  notes: [],
  ...overrides
});

const buildActions = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): HelperPlanAction[] => {
  if (!currentCase) return [];
  const text = textBlob(currentCase);
  const operationTemplate = helperHints?.operationTemplate ?? "";
  const params = inferCollageParams(currentCase, helperHints);
  const helperParams = paramsObject(helperHints);
  const actions: HelperPlanAction[] = [];
  const features = detectCaseFeatures(currentCase, helperHints);
  const unsupportedHelperTarget =
    features.mode === "record" ||
    features.mode === "metric" ||
    features.hasFilter ||
    features.hasGroup;
  const metadataOnly = features.isMetadataDropdown;
  if (unsupportedHelperTarget) return [];
  const createProjectFlow = isCreateProjectOnlyFlow(currentCase, helperHints);
  if (createProjectFlow) {
    const projectParams = {
      ...params,
      projectNamePrefix: stringParam(helperParams, ["projectNamePrefix"]) ?? "OTTEST004_G01_",
      projectMode: stringParam(helperParams, ["projectMode", "mode"]) ?? "拼貼"
    };
    return [
      action("H1", "collage.openProject", "開啟報表管理頁並定位拼貼區塊", projectParams, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"],
        notes: ["只定位報表管理頁 / 拼貼模式區塊，不建立專案。"]
      }),
      action("H2", "collage.createProject", "新增本輪測試拼貼專案並驗證左側選單", projectParams, {
        requiresToolBridge: true,
        requiredEvidence: ["toolBridge.response", "dom.state", "nativeDialog", "screenshot"],
        screenshotPolicy: "required_if_possible",
        notes: [
          "單一授權只允許本 current case 建立名稱含 OTTEST004_G01 的測試專案。",
          "helper 必須透過 visible UI 點 + 新增專案、選建構模式=拼貼、輸入專案名稱、點建立。",
          "若出現「請選擇模式」alert，代表模式選擇未生效，helper 必須 blocked 並留下 dialog evidence。"
        ]
      })
    ];
  }
  const deleteReportFlow = isDeleteReportFlow(currentCase, helperHints);
  if (deleteReportFlow) {
    const requestedFields = firstStringArrayParam(params, ["fields", "metrics"]);
    const deleteParams = {
      ...params,
      reportNamePattern: stringParam(helperParams, ["reportName", "reportNamePattern", "name"]) ?? "OTTEST004_G03_temp_<timestamp>",
      field: nonNeutral(stringParam(params, ["field", "metric", "metricField"])) ?? "新增帳號數",
      fields: requestedFields.length > 0 ? requestedFields : ["新增帳號數"],
      dateRange: nonNeutral(stringParam(params, ["dateRange", "timeRange"])) ?? "2026/03/01~2026/03/31",
      display: nonNeutral(stringParam(params, ["display", "displayMode"])) ?? "每天",
      skipSave: false,
      skipReopen: true,
      skipDownload: true
    };
    return [
      action("H1", "collage.openProject", "開啟指定拼貼專案", deleteParams, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"],
        notes: ["先定位拼貼專案頁，不執行刪除。"]
      }),
      action("H2", "collage.createAndDeleteTemporaryReport", "建立本輪臨時報表後刪除並驗證", deleteParams, {
        requiresToolBridge: true,
        requiredEvidence: ["toolBridge.response", "dom.state", "network.requestBody", "nativeDialog", "screenshot"],
        screenshotPolicy: "required_if_possible",
        notes: [
          "單一授權只允許本 current case 建立並刪除名稱含 temp 的臨時報表。",
          "helper 必須先建立臨時報表，再點該報表列刪除控制，處理已知刪除 confirm，最後驗證該 row 不再可見。",
          "helper 不可刪除非臨時報表；找不到臨時 row 或遇到未知 native dialog 必須 blocked。"
        ]
      })
    ];
  }
  if (isBackToProjectListFlow(currentCase, helperHints)) {
    return [
      action("H1", "collage.openProject", "開啟指定拼貼專案", params, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"],
        notes: ["先定位拼貼專案頁，準備點既有報表進入設定頁。"]
      }),
      action("H2", "collage.openReportFromProjectList", "點報表名稱進入設定頁", params, {
        requiredEvidence: ["dom.state", "screenshot"],
        notes: ["只點報表名稱進 editor，不點下載/刪除控制。"]
      }),
      action("H3", "collage.clickBackToProjectList", "點返回並驗證回專案頁", params, {
        requiredEvidence: ["dom.state", "screenshot"],
        screenshotPolicy: "required_if_possible",
        notes: ["不修改設定；若出現 native confirm，helper 會 blocked 並留下 dialog evidence。"]
      })
    ];
  }
  if (isOpenReportFromProjectListFlow(currentCase, helperHints)) {
    return [
      action("H1", "collage.openProject", "開啟指定拼貼專案", params, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"],
        notes: ["先定位拼貼專案頁，不進新增報表頁。"]
      }),
      action("H2", "collage.openReportFromProjectList", "點報表名稱進入設定頁", params, {
        requiredEvidence: ["dom.state", "screenshot"],
        screenshotPolicy: "required_if_possible",
        notes: ["只點報表名稱進 editor，不點下載/刪除控制。"]
      })
    ];
  }
  const formulaHelperFlow = hasFormulaParams(helperParams) || hasFormulaParams(params);
  if (formulaHelperFlow) {
    return [
      action("H1", "collage.openProject", "開啟指定拼貼專案", params, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"],
        notes: ["只開啟/切換專案，不判斷 testcase 結果。"]
      }),
      action("H2", "collage.createReport", "進入新增報表頁", params, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"]
      }),
      action("H3", "collage.configureCalculatedMetricAndPreview", "新增運算欄位、設定日期並執行 preview evidence", params, {
        requiredEvidence: ["dom.state", "formula.uiState", "network.requestBody", "network.responseBody", "chart.datasets", "screenshot"],
        screenshotPolicy: "required_if_possible",
        notes: [
          "helper 會透過 visible UI 加入 fieldA/fieldB、開啟「+ 新增運算欄位」modal、輸入名稱與公式、按確認後設定日期/顯示並按執行。",
          "helper 不驗算公式正確性、不判 PASS/FAIL；Codex 必須用 chart/network evidence 做逐日驗算。",
          "若公式 modal 無可見可輸入欄位、關不掉或攔截後續點擊，helper 必須 blocked 並留下 modal DOM profile。"
        ]
      })
    ];
  }
  const helperMustLeaveCoreToCodex = helperHintsRequestManualAi(helperHints) || dateRequiresCodexVisibleUi(currentCase, helperHints);
  if (helperMustLeaveCoreToCodex) {
    if (!needsCollageNavigationPrelude(currentCase, helperHints)) return [];
    const editorPreludeNeeded = needsReportEditorPrelude(currentCase);
    const prelude: HelperPlanAction[] = [
      action("H1", "collage.openProject", "開啟指定拼貼專案（manual_ai 前置導航）", params, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"],
        notes: ["manual_ai / 動態日期題只允許 helper 做安全前置導航；不可判斷 testcase 結果。"]
      })
    ];
    if (editorPreludeNeeded) {
      prelude.push(
        action("H2", "collage.createReport", "進入新增報表頁（manual_ai 前置導航）", params, {
          requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"],
          notes: ["到達報表設定頁後即停止；欄位、日期、preview、CSV 等核心驗證必須由 Codex visible UI 逐步執行。"]
        })
      );
    }
    if (editorPreludeNeeded && canRunDatePreviewEvidenceHelper(params, currentCase)) {
      prelude.push(
        action("H3", "collage.runDateVariantsPreviewEvidence", "逐輪設定日期並收集 preview evidence（manual_ai 日期合題）", params, {
          requiredEvidence: ["dom.state", "date.uiState", "date.representedRange", "network.requestBody", "chart.datasets", "screenshot"],
          screenshotPolicy: "required_if_possible",
          notes: [
            "此 helper 適用 preset dateVariants/uiLabels、全靜態 start/end 日期，以及 structured relative/hybrid dateMode（例如 B-07/B-08）。",
            "每個日期 variant 必須透過 visible UI 設定後按執行，收集 per-variant date UI、network request body、chart/table evidence。",
            "helper 不判 PASS/FAIL；Codex 必須比對 UI label、representedRange、requestBody.dateRange 與 preview 筆數後寫 result.xlsx。"
          ]
        })
      );
    }
    const manualDateSave =
      /儲存/.test(text) &&
      !helperRequestsNoSave({ ...params, ...helperParams }) &&
      editorPreludeNeeded &&
      canRunDatePreviewEvidenceHelper(params, currentCase);
    if (manualDateSave) {
      prelude.push(
        action(`H${prelude.length + 1}`, "collage.saveReport", "儲存日期 preview baseline 報表", params, {
          requiresToolBridge: true,
          requiredEvidence: ["toolBridge.response", "dom.state", "screenshot"],
          screenshotPolicy: "required_if_possible",
          notes: [
            "適用 F-06/F-07 類 D0 baseline：先由 date preview helper 透過 visible UI 設定日期並按執行，再儲存當前報表。",
            "helper 只保存 evidence，不判 PASS/FAIL；Codex 必須確認 dateRange、preview 與後續 CSV baseline。"
          ]
        })
      );
    }
    const manualDateCsvDownload =
      /下載|CSV/i.test(text) &&
      !helperExplicitlyDisablesDownload(helperParams) &&
      editorPreludeNeeded &&
      canRunDatePreviewEvidenceHelper(params, currentCase);
    if (manualDateCsvDownload) {
      prelude.push(
        action(`H${prelude.length + 1}`, "collage.downloadCsvAndComparePreview", manualDateSave ? "從專案頁 row 下載 CSV 並與 preview evidence 比對" : "在 editor session 下載 CSV 並與 preview evidence 比對", params, {
          requiredEvidence: ["downloaded.csv", "csv.rows", "preview.table_or_chart", "screenshot"],
          screenshotPolicy: "required_if_possible",
          notes: [
            manualDateSave
              ? "儲存後回專案頁清單，鎖定本 case saved-report row 下載；不 reopen editor。"
              : "僅在同一 editor session 已由 date preview helper 產生 preview evidence 後執行。",
            "CSV 必須由 UI 下載控制觸發並與目前 preview 比對。"
          ]
        })
      );
    }
    return prelude;
  }

  if (metadataOnly) {
    return [
      action("H1", "collage.openProject", "開啟指定拼貼專案", params, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"],
        notes: ["只開啟/切換專案，不判斷 testcase 結果。"]
      }),
      action("H2", "collage.createReport", "進入新增報表頁", params, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"]
      }),
      action("H3", "collage.extractMetadataDropdownFields", "展開欄位 picker 並擷取 metadata 對照 evidence", params, {
        requiredEvidence: ["dom.list", "metadata.csv", "comparison", "screenshot"],
        screenshotPolicy: "required_if_possible",
        notes: [
          "helper 只能透過 visible `+ 新增欄位` 開啟 picker，之後用 read-only DOM extraction 擷取欄位清單。",
          "expected list 必須來自 run packet 的 `rules/BI_DATA/metadata.csv` 或 reference-index 指向檔案；不可打 BI API 或 broad-read 所有 CSV。",
          "helper 只產生 actual/expected/missing/extra evidence；Codex 仍需依 testcase 規則判 PASS/FAIL/BLOCKED。"
        ]
      })
    ];
  }
  const allZeroFieldInspection = isAllZeroFieldInspectionCase(currentCase, helperHints);
  if (allZeroFieldInspection) {
    return [
      action("H1", "collage.openProject", "開啟指定拼貼專案", params, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"],
        notes: ["只開啟/切換專案，不判斷 testcase 結果。"]
      }),
      action("H2", "collage.createReport", "進入新增報表頁", params, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"]
      }),
      action("H3", "collage.inspectAllZeroFields", "全選指定來源欄位並收集全 0 欄位 evidence", params, {
        requiredEvidence: ["dom.list", "network.requestBody", "network.responseBody", "chart.datasets", "dom.previewState", "screenshot"],
        screenshotPolicy: "required_if_possible",
        notes: [
          "此 helper 只負責目前 case 的 A-06 類 evidence：透過 visible UI 選欄位、設定日期/顯示、按執行前做 selected-field-count guard。",
          "helper 會輸出 `all-zero-field-inspection-evidence.json`，包含 selected fields、request/response observation、chart/table summaries 與 allZeroCandidates。",
          "helper 不判 PASS/FAIL；Codex 必須確認全 0 清單是否可讀、是否符合 testcase 本題範圍，再寫 result.xlsx。"
        ]
      })
    ];
  }
  const isCollageFlow = /collage_build_preview_save_reopen/.test(operationTemplate) || /拼貼|新增報表|儲存報表|重開|重新檢視/.test(text);
  const modifiesExistingReport = params.openExistingReport === true;
  const noSave = helperRequestsNoSave({ ...params, ...helperParams });
  const noDownload =
    helperRequestsNoDownload({ ...params, ...helperParams }) &&
    !(/下載|CSV/i.test(text) && !helperExplicitlyDisablesDownload({ ...params, ...helperParams }));
  const explicitlyNoReopen =
    helperRequestsNoReopen({ ...params, ...helperParams }) ||
    /不(?:需|要|應)?重開|不要重開|無需重開|不用重開|不重開\s*editor|不應產生\s*reopen/i.test(text);
  const needsReopen = !explicitlyNoReopen && /重開|重新檢視|還原|載入/.test(text);
  const createNewProjectRequested = booleanishParam(helperParams, ["createNewProject", "createProjectThenReport"]);

  if (isCollageFlow) {
    actions.push(
      action(`H${actions.length + 1}`, "collage.openProject", "開啟指定拼貼專案", params, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"],
        notes: ["只開啟/切換專案，不判斷 testcase 結果。"]
      })
    );
    if (createNewProjectRequested) {
      actions.push(
        action(`H${actions.length + 1}`, "collage.createProject", "新增本 case 拼貼專案並接續報表建立", params, {
          requiresToolBridge: true,
          requiredEvidence: ["toolBridge.response", "dom.state", "nativeDialog", "screenshot"],
          screenshotPolicy: "required_if_possible",
          notes: [
            "單一授權只允許本 current case 建立名稱符合 helper params 的測試專案。",
            "helper 會寫入 created-project.json，後續 createReport 會選取同一個新專案。"
          ]
        })
      );
    }
    actions.push(
      modifiesExistingReport
        ? action(`H${actions.length + 1}`, "collage.openExistingReport", "開啟既有報表進入編輯", params, {
            requiredEvidence: ["dom.state", "screenshot"],
            notes: ["若找不到既有報表，helper 必須 blocked 並標記前置失敗，不可改建新報表替代。"]
          })
        : action(`H${actions.length + 1}`, "collage.createReport", "進入新增報表頁", params, {
            requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"]
          }),
      action(`H${actions.length + 2}`, "collage.configureMetric", "設定來源、欄位、日期與顯示", params, {
        requiredEvidence: ["dom.state", "state.delta", "date.uiState", "date.representedRange", "screenshot"],
        notes: [
          "所有設定都必須透過 visible UI；不可使用內部 JS setter。",
          "可用 state delta planner 跳過已逐字/DOM 驗證對齊的項目；讀不到或不確定時必須操作 UI 或回 blocked。",
          "多欄位字串必須拆成多個欄位逐一新增/驗證，不可把整段 composite string 當作單一 clickable text。",
          "日期設定完成後 helper 必須輸出 date-ui-evidence.json，包含 UI label 與其可見或可計算的代表日期區間。",
          "若 `+ 新增欄位` 文字 locator 失敗，helper 可嘗試其他 visible button/role/class fallback 並留下 locator drift evidence；不可用 force click 或內部 JS setter。"
        ]
      }),
      action(`H${actions.length + 3}`, "collage.runPreviewAndCollectEvidence", "執行 preview 並收集 evidence", params, {
        requiredEvidence: ["network.requestBody", "network.responseBody", "chart.datasets", "dom.previewState", "screenshot"],
        screenshotPolicy: "required_if_possible",
        notes: ["preview request 必須由 UI 按執行觸發；network 只作觀察，不可直接呼叫 API。"]
      })
    );

    if (!noSave && /儲存|覆寫/.test(text)) {
      actions.push(
        action(`H${actions.length + 1}`, "collage.saveReport", modifiesExistingReport ? "覆寫既有報表" : "儲存本輪臨時報表", params, {
          requiresToolBridge: true,
          requiredEvidence: ["toolBridge.response", "dom.state", "screenshot"],
          screenshotPolicy: "required_if_possible",
          notes: ["Agent 模式需先取得 Tool Bridge response；非 SSO/login request 由 Mac Agent 自動回覆；helper 只可處理已知 BI save/overwrite dialog；未知 native dialog 若沒有實際 recovery handler 必須 blocked 並留下 evidence。"]
        })
      );
    }

    if (needsReopen) {
      actions.push(
        action(`H${actions.length + 1}`, "collage.reopenReport", "從清單重開報表並驗證設定", params, {
          requiredEvidence: ["dom.state", "network.requestBody", "screenshot"],
          screenshotPolicy: "required_if_possible"
        })
      );
    }

    if (!noDownload && /下載|CSV/i.test(text)) {
      actions.push(
        action(`H${actions.length + 1}`, "collage.downloadCsvAndComparePreview", "下載 CSV 並與 preview evidence 比對", params, {
          requiredEvidence: ["downloaded.csv", "csv.rows", "preview.table_or_chart", "screenshot"],
          screenshotPolicy: "required_if_possible",
          notes: [
            "下載是合法輸出，不需 Tool Bridge；helper 只產生 CSV/preview 比對 evidence，Codex 仍負責最終判定。",
            "若重開後設定或 preview 已不存在，helper 應記錄 failedSubcondition；Codex 應把 CSV 比對記為 not reached，先判斷前置流程失敗是否已構成 FAIL。",
            "若專案/報表清單 stale，helper 應刷新/重定位本輪 saved report row；若 browser download event 未觸發但同一次 UI click 產生 CSV/attachment response，可保存 response body 作 CSV evidence。"
          ]
        })
      );
    }
  }

  return actions;
};

const buildAvailableTemplates = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): HelperPlanAction[] => {
  const params = inferCollageParams(currentCase, helperHints);
  const features = detectCaseFeatures(currentCase, helperHints);
  const available: HelperPlanAction[] = [
    action("T-date-ui", "collage.captureDateUiEvidence", "讀取日期 UI label 與代表日期區間 evidence", params, {
      mutatesUi: false,
      optional: true,
      requiredEvidence: ["dom.state", "date.uiState", "date.representedRange", "screenshot"],
      screenshotPolicy: "required_if_possible",
      notes: [
        "此模板只讀取目前頁面的日期控制文字與 visible DOM，不設定日期、不按執行、不判 PASS/FAIL。",
        "manual_ai / multi-variant 日期題由 Codex visible UI 完成切換後，可用此模板補 `date-ui-evidence.json`。"
      ]
    }),
    action("T-delete", "collage.deleteTemporaryReport", "刪除本輪臨時報表 helper（需授權）", params, {
      optional: true,
      requiresToolBridge: true,
      requiredEvidence: ["toolBridge.response", "dom.state", "screenshot"],
      screenshotPolicy: "required_if_possible",
      notes: ["只可刪除本輪建立且名稱可比對的臨時資源；不可刪除既有主資源。"]
    })
  ];

  if (features.hasFilter || features.hasGroup) return [];
  return available;
};

export const helperExecutorPath = (): string => {
  const runtimeDir = path.basename(__dirname) === "src" ? path.resolve(__dirname, "../dist") : __dirname;
  return path.join(runtimeDir, "bi-ui-helper-executor.js");
};

export const buildHelperExecutionPlan = ({ runDir, currentCase, helperHints }: WriteHelperExecutionPlanOptions): HelperExecutionPlan => {
  const caseId = currentCase?.caseNo ?? helperHints?.caseId ?? null;
  const artifactRoot = path.join(runDir, "output", "helper-artifacts", caseId ?? "unknown-case");
  return {
    schemaVersion: "helper-execution-plan-v1",
    generatedAt: new Date().toISOString(),
    caseId,
    mode: "single_case_helper_assisted_uat",
    executor: {
      kind: "mac-agent-playwright-cdp",
      command: `node ${helperExecutorPath()} --run-dir "${runDir}" --case "${caseId ?? ""}" --action <template> --params-json '<json>'`,
      reportPath: path.join(artifactRoot, "helper-report.jsonl"),
      artifactRoot
    },
    policy: [
      "Helper plan is an execution aid, not a testcase result.",
      "Helper actions may operate the UI and collect evidence, but Codex must judge PASS/FAIL/BLOCKED.",
      "Helper actions must not write result.xlsx and must not run multiple cases.",
      "Helper actions must not use force:true clicks or bypass browser actionability checks.",
      "Irreversible actions and native dialogs require Tool Bridge response in Agent mode; non-SSO/login authorization requests may be auto-approved by Mac Agent policy, and only known BI save/overwrite dialogs may be handled by helper after approval."
    ],
    safety: {
      helperMayWriteResultXlsx: false,
      helperMayJudgePassFail: false,
      helperMayRunMultipleCases: false,
      helperMayUseDirectBiApi: false,
      helperMayUseInternalJsSetter: false,
      helperMayBypassActionabilityCheck: false,
      codexMustJudgeResult: true
    },
    helperHints: {
      found: Boolean(helperHints),
      operationTemplate: helperHints?.operationTemplate ?? null,
      automationLevel: helperHints?.automationLevel ?? null,
      aiDecisionRequired: helperHints?.aiDecisionRequired ?? null
    },
    actions: buildActions(currentCase, helperHints),
    availableTemplates: buildAvailableTemplates(currentCase, helperHints)
  };
};

export const writeHelperExecutionPlan = (options: WriteHelperExecutionPlanOptions): { jsonPath: string; markdownPath: string; plan: HelperExecutionPlan } => {
  const plan = buildHelperExecutionPlan(options);
  const inputDir = path.join(options.runDir, "input");
  const jsonPath = path.join(inputDir, "helper-execution-plan.json");
  const markdownPath = path.join(inputDir, "helper-execution-plan.md");

  fs.writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(
    markdownPath,
    [
      "# Helper Execution Plan v1",
      "",
      "本檔是 current case 的 helper-assisted UAT 操作計畫。它不是結果，也不是 PASS/FAIL 判定。",
      "",
      `- case_id: ${plan.caseId ?? "(unavailable)"}`,
      `- executor: ${plan.executor.command}`,
      `- artifact_root: ${plan.executor.artifactRoot}`,
      `- report_path: ${plan.executor.reportPath}`,
      "",
      "## Safety",
      "",
      "- helper 不可寫 result.xlsx。",
      "- helper 不可判 PASS/FAIL/BLOCKED。",
      "- helper 不可一次跑多題。",
      "- helper 不可直接打 BI API 或用內部 JS setter 設狀態。",
      "- helper 不可使用 force: true click 或其他方式繞過 browser actionability check。",
      "- Codex 必須讀 helper evidence 後自行判斷與寫 detail_json。",
      "",
      "## Planned Actions",
      "",
      plan.actions.length > 0
        ? plan.actions
            .map(
              (item) =>
                `### ${item.id}. ${item.template}\n\n- title: ${item.title}\n- requiresToolBridge: ${item.requiresToolBridge}\n- optional: ${item.optional}\n- requiredEvidence: ${item.requiredEvidence.join(", ")}\n- screenshotPolicy: ${item.screenshotPolicy}\n\n\`\`\`json\n${JSON.stringify(item.params, null, 2)}\n\`\`\`\n`
            )
            .join("\n")
        : "(no planned helper actions; use manual Codex UI execution with current-case-pack)",
      "",
      "## Available Optional Templates",
      "",
      plan.availableTemplates.map((item) => `- ${item.template}: ${item.title}; requiresToolBridge=${item.requiresToolBridge}`).join("\n"),
      ""
    ].join("\n")
  );

  return { jsonPath, markdownPath, plan };
};
