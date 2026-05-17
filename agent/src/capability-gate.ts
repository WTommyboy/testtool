import fs from "node:fs";
import path from "node:path";
import type { CaseManifestCase } from "./case-manifest";
import type { HelperHints } from "./helper-hints";
import { detectCaseFeatures } from "./case-feature-detection";
import { inferCaseScope, missingActionTemplateBlocker, type InferredCaseScope } from "./case-scope";

export type CapabilityGateReport = {
  schemaVersion: "uat-capability-gate-v1";
  generatedAt: string;
  caseId: string | null;
  supportStatus: "supported" | "degraded" | "unsupported";
  executionMode: "helper_assisted" | "codex_visible_ui" | "blocked_unsupported";
  helperPreRunAllowed: boolean;
  blockingReason: string | null;
  unsupportedFeatures: string[];
  supportedHelperTemplates: string[];
  caseScope: InferredCaseScope;
  detected: {
    mode: "collage" | "record" | "metric" | "unknown";
    hasFilter: boolean;
    hasGroup: boolean;
    isMetadataDropdown: boolean;
    isSaveReopenFlow: boolean;
    operationTemplate: string | null;
    automationLevel: string | null;
  };
  codexInstruction: string;
};

export type CapabilityGateFiles = {
  jsonPath: string;
  markdownPath: string;
  report: CapabilityGateReport;
};

type WriteCapabilityGateOptions = {
  runDir: string;
  currentCase: CaseManifestCase | null;
  helperHints: HelperHints | null;
};

const paramsObject = (helperHints: HelperHints | null): Record<string, unknown> =>
  helperHints?.params && typeof helperHints.params === "object" && !Array.isArray(helperHints.params)
    ? (helperHints.params as Record<string, unknown>)
    : {};

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

const helperScope = (params: Record<string, unknown>): string | null => stringParam(params, ["scope", "executionScope", "helperScope"]);

const helperRequestsPreviewOnly = (params: Record<string, unknown>): boolean =>
  /^(preview_only|preview-only|preview|d0|d0_only|d0-only)$/i.test(helperScope(params) ?? "");

const helperRequestsNoSave = (params: Record<string, unknown>): boolean =>
  helperRequestsPreviewOnly(params) || booleanishParam(params, ["skipSave", "doNotSave", "noSave", "previewOnly"]);

const helperRequestsNoReopen = (params: Record<string, unknown>): boolean =>
  helperRequestsPreviewOnly(params) || booleanishParam(params, ["skipReopen", "doNotReopen", "noReopen", "previewOnly"]);

const helperRequestsSaveOnly = (params: Record<string, unknown>): boolean =>
  booleanishParam(params, ["saveOnly", "save_only"]) || /^save_only$/i.test(helperScope(params) ?? "");

const helperRequestsDownload = (params: Record<string, unknown>): boolean =>
  booleanishParam(params, ["downloadCsv", "doDownloadCsv", "downloadCSV", "download", "csvDownload", "needCsv"]);

const helperExplicitlyDisablesDownload = (params: Record<string, unknown>): boolean =>
  booleanishParam(params, ["skipDownload", "doNotDownload", "noDownload", "doNotDownloadCsv", "skipCsv", "noCsv"]);

const textExplicitlyDisablesDownload = (text: string): boolean =>
  /本題不測項目[^\n]*(?:CSV|下載)|(?:不測|不做|不驗).{0,12}(?:CSV|下載)|(?:CSV|下載).{0,8}[\(（]屬/i.test(text);

const textExplicitlyDisablesSave = (text: string): boolean =>
  /(?:本題不測項目|本題不做|本題不測|本題不驗|不測|不做|不驗|禁止|絕不|不要|不用|不需|不應|不點).{0,40}(?:save|儲存|保存)|(?:不|勿)\s*(?:save|儲存|保存)/i.test(text);

const textExplicitlyDisablesReopen = (text: string): boolean =>
  /(?:本題不測項目|本題不做|本題不測|本題不驗|不測|不做|不驗|本題禁止|禁止|絕不|不要|不用|不需|不應|不點).{0,40}(?:reopen|重開|報表名稱)|(?:不|勿)\s*(?:reopen|重開)|不點報表名稱|不進入\s*editor\s*reopen/i.test(text);

const paramsRequestReportListDownload = (params: Record<string, unknown>): boolean => {
  const entry = stringParam(params, ["downloadEntry", "downloadTarget", "downloadSource", "csvEntry"]) ?? "";
  return booleanishParam(params, ["downloadFromProjectRow", "downloadFromReportRow", "projectRowDownload", "reportListDownload"]) ||
    booleanishParam(params, ["doNotUseEditorGlobalDownload"]) ||
    /project[_-]?page[_-]?row|project[-_ ]row|report[_-]?row|row[_-]?download|report[_-]?list|project[_-]?list/i.test(entry);
};

const textRequestsReportListDownload = (text: string): boolean =>
  /(?:專案頁|清單|列表|該報表\s*row|報表\s*row|row|報表列|project[-_ ]row).{0,32}(?:下載|download|CSV)|(?:下載|download|CSV).{0,32}(?:專案頁|清單|列表|該報表\s*row|報表\s*row|row|報表列|project[-_ ]row)|project_page_row_download_button/i.test(text);

const helperRequestsNoDownload = (params: Record<string, unknown>): boolean =>
  helperRequestsDownload(params)
    ? false
    : helperRequestsPreviewOnly(params) || helperExplicitlyDisablesDownload(params);

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

const recordArrayParam = (params: Record<string, unknown>, key: string): Record<string, unknown>[] =>
  (rawArrayParam(params, key) ?? []).filter((item): item is Record<string, unknown> =>
    Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );

const hasStructuredDateVariantSpecs = (params: Record<string, unknown>): boolean => {
  const variants = recordArrayParam(params, "dateVariants");
  const stages = recordArrayParam(params, "stages");
  return [...variants, ...stages].some((item) =>
    typeof item.label === "string" ||
    typeof item.start === "string" ||
    typeof item.end === "string" ||
    (item.start && typeof item.start === "object" && !Array.isArray(item.start)) ||
    (item.end && typeof item.end === "object" && !Array.isArray(item.end))
  );
};

const dateObjectParam = (value: unknown): string | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const start = typeof record.start === "string" ? record.start.trim() : "";
  const end = typeof record.end === "string" ? record.end.trim() : "";
  if (!start || !end) return null;
  return `${start}~${end}`;
};

const dateRequiresCodexVisibleUi = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  const params = paramsObject(helperHints);
  const cleanupTargets = detectCaseFeatures(currentCase, helperHints).cleanupTargets;
  const dateVariants = firstStringArrayParam(params, ["dateVariants", "uiLabels"]);
  if (dateVariants.length > 1 || recordArrayParam(params, "dateVariants").length > 1 || recordArrayParam(params, "stages").length > 0) return true;
  const dateText = [
    stringParam(params, ["dateRange", "timeRange"]),
    dateObjectParam(params.dateRange),
    ...dateVariants,
    cleanupTargets["時間"],
    currentCase?.stepsSummary,
    currentCase?.expected
  ]
    .filter(Boolean)
    .join("\n");
  return /半動態|自訂動態|動態區間|天前|天後|快捷起點|快捷訖點|快捷終點|跨\s*9[01]\s*天|90\s*天|91\s*天|連續切換|不同區間/.test(dateText);
};

const canRunDatePreviewEvidenceHelper = (params: Record<string, unknown>): boolean => {
  const dateVariants = firstStringArrayParam(params, ["dateVariants", "uiLabels"]);
  const dateMode = String(params.dateMode ?? "").trim().toLowerCase();
  if (dateVariants.length > 0 && (!dateMode || dateMode === "preset")) return true;
  if (hasStructuredDateVariantSpecs(params)) return true;
  if (
    (dateMode === "relative" || dateMode === "hybrid") &&
    (typeof params.startOffsetDays === "number" || typeof params.endOffsetDays === "number" || params.start || params.end)
  ) {
    return true;
  }
  return dateMode === "static" || Boolean(dateObjectParam(params.dateRange));
};

const hasFormulaParams = (params: Record<string, unknown>): boolean =>
  typeof params.formula === "string" && params.formula.trim().length > 0;

const isCreateProjectFlow = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  const operationTemplate = helperHints?.operationTemplate ?? "";
  const text = detectCaseFeatures(currentCase, helperHints).text;
  const params = paramsObject(helperHints);
  return /^(?:collage[._-])?create[-_]?project$/i.test(operationTemplate) ||
    Boolean(stringParam(params, ["projectNamePrefix", "projectNamePattern"])) ||
    /新增專案|create\s+project/i.test(text);
};

const isCreateProjectOnlyFlow = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  if (!isCreateProjectFlow(currentCase, helperHints)) return false;
  const params = paramsObject(helperHints);
  if (booleanishParam(params, ["createNewProject", "createProjectThenReport"])) return false;
  const operationTemplate = helperHints?.operationTemplate ?? "";
  if (/collage_build_preview_save_reopen|download_csv_verify|save_load_flow/.test(operationTemplate)) return false;
  const text = detectCaseFeatures(currentCase, helperHints).text;
  if (/^(?:collage[._-])?create[-_]?project$/i.test(operationTemplate) && /只測新增專案|不進入(?:新建)?報表|只測.*專案/i.test(text)) {
    return true;
  }
  return !/新增報表|報表設定|欄位|時間區間|preview|預覽|執行|儲存報表|儲存|下載|CSV|reopen|重開|返回/.test(text);
};

const isSameCaseSaveLoadFlow = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  const operationTemplate = helperHints?.operationTemplate ?? "";
  const params = paramsObject(helperHints);
  const text = `${detectCaseFeatures(currentCase, helperHints).text}\n${helperScope(params) ?? ""}`;
  return /save_load_flow/i.test(operationTemplate) && (
    booleanishParam(params, ["reopenViaClickReportName"]) ||
    Boolean(stringParam(params, ["saveReportNamePrefix", "reportNamePrefix"])) ||
    /同\s*case|同一\s*case|建立.{0,12}儲存.{0,24}(?:reopen|重開|點報表名稱)|不依賴既有報表|depend_on_existing_report/i.test(text)
  );
};

const isOpenReportFromProjectListFlow = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  const params = paramsObject(helperHints);
  const text = `${detectCaseFeatures(currentCase, helperHints).text}\n${stringParam(params, ["action", "verifyOnly"]) ?? ""}`;
  if (helperRequestsSaveOnly(params)) return false;
  if (isSameCaseSaveLoadFlow(currentCase, helperHints)) return false;
  if (
    (booleanishParam(params, ["reopenViaClickReportName", "reopenReport", "doReopen"]) || Boolean(stringParam(params, ["saveReportNamePrefix", "reportNamePrefix", "reportNamePattern"]))) &&
    /同\s*case|同一\s*case|建立.{0,20}儲存|儲存.{0,24}(?:reopen|重開|點報表名稱)|設定還原|不依賴既有報表|depend_on_existing_report/i.test(text)
  ) {
    return false;
  }
  return /報表名稱.{0,24}(?:進入|編輯|reopen|重開|載入|設定頁|editor)|點(?:擊)?.{0,16}報表名稱.{0,24}(?:進入|編輯|reopen|重開|載入|設定頁|editor)|click\s+report\s+name(?:.{0,24}(?:open|enter|edit|editor|reopen))?|enter\s+editor/i.test(text);
};

const isBackToProjectListFlow = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  const params = paramsObject(helperHints);
  const text = `${detectCaseFeatures(currentCase, helperHints).text}\n${stringParam(params, ["action", "verifyOnly"]) ?? ""}`;
  if (helperRequestsSaveOnly(params)) return false;
  return /返回按鈕|點.*返回|click\s+back|return\s+to\s+project/i.test(text);
};

const needsCollageNavigationPrelude = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  const features = detectCaseFeatures(currentCase, helperHints);
  if (features.mode !== "collage" || features.hasFilter || features.hasGroup) return false;
  const text = features.text;
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
    /新增報表頁|報表設定|設定頁|\+\s*新增欄位|欄位選擇|時間區間|dateRange|preview|預覽|按執行|點「?執行|點擊「?計算/.test(titleAndSteps) ||
    /(點|按|點擊|開啟|進入).{0,12}(\+\s*)?新增報表/.test(titleAndSteps);
  if (/專案頁/.test(titleAndSteps) && !explicitlyOpensEditor) return false;
  const text = detectCaseFeatures(currentCase, null).text;
  return explicitlyOpensEditor || /報表設定|設定頁|\+\s*新增欄位|欄位選擇|時間區間|dateRange|preview|預覽|按執行|點「?執行|點擊「?計算/.test(text);
};

const hasExplicitHelperTemplate = (helperHints: HelperHints | null): boolean => {
  const template = helperHints?.operationTemplate?.trim();
  return Boolean(template && template !== "manual_ai") || helperHints?.automationLevel === "helper";
};

const isFrontendObservationPreludeCase = (
  currentCase: CaseManifestCase | null,
  helperHints: HelperHints | null
): { matched: boolean; needsEditor: boolean } => {
  if (hasExplicitHelperTemplate(helperHints)) return { matched: false, needsEditor: false };
  const features = detectCaseFeatures(currentCase, helperHints);
  if (features.mode !== "collage" || features.hasFilter || features.hasGroup) return { matched: false, needsEditor: false };
  if (features.isMetadataDropdown) return { matched: false, needsEditor: false };
  const targetText = [currentCase?.testType, currentCase?.testTarget, currentCase?.riskLevel].filter(Boolean).join("\n");
  const isFrontendTarget = /前端呈現/.test(targetText);
  const isObservationRisk = /🟢\s*觀察/.test(targetText);
  if (!isFrontendTarget && !isObservationRisk) return { matched: false, needsEditor: false };
  const text = features.behaviorText;
  const projectOrSidebarObservation =
    /側欄|sidebar|公司共享|我的自訂|拼貼報表|專案頁|專案清單|報表清單|breadcrumb|勾選|全選|hover|tooltip|下載\/刪除\s*icon|刪除\s*icon|下載\s*icon|新增專案|重名|上限|分頁|每頁|game selector|使用者按鈕|入口|disabled|enabled/i.test(text);
  const editorObservation =
    /新增自訂報表入口|新增報表入口|新增報表頁|報表設定頁|建構方式\s*radio|第一列|欄位預設|刪除列|複製列|報表\s*picker|欄位\s*picker|空設定|未完成設定|時間面板|時間區間\s*button|儲存報表.{0,16}disabled|editor\s*右上|preview table/i.test(text);
  const nonDownloadDataExecutionIntent =
    /network\.requestBody|network request body|request body|response|chart\.datasets|preview\s*成功|預覽成功|儲存報表成功|重開還原|公式|運算欄位|後端功能|daily\s*資料|指標\s*ID/i.test(text);
  const downloadDataExecutionIntent =
    /CSV\s*(?:row|數值|表頭)|下載\s*CSV|downloaded\s*CSV/i.test(text) && !textExplicitlyDisablesDownload(text);
  const dataExecutionIntent = nonDownloadDataExecutionIntent || downloadDataExecutionIntent;
  if (!isFrontendTarget && editorObservation) return { matched: false, needsEditor: false };
  if ((!projectOrSidebarObservation && !editorObservation) || dataExecutionIntent) return { matched: false, needsEditor: false };
  return { matched: true, needsEditor: editorObservation };
};

const inferFrontendObservationTemplate = (currentCase: CaseManifestCase | null): string | null => {
  const text = [
    currentCase?.caseNo,
    currentCase?.groupName,
    currentCase?.caseTitle,
    currentCase?.stepsSummary,
    currentCase?.expected,
    currentCase?.validationMethod
  ]
    .filter(Boolean)
    .join("\n");
  if (/使用者按鈕|登入者名稱|user\s*button|account\s*button/i.test(text)) return "collage.observeFrontendState";
  if (/下載\/刪除\s*icon|下載\s*icon|刪除\s*icon|toolbar|工具列|勾選.*下載|未勾選.*下載|disabled|enabled/i.test(text)) {
    return "collage.observeFrontendState";
  }
  if (/建構方式\s*radio|拼貼模式|報表模式|report[-_\s]*mode|radio/i.test(text)) return "collage.observeFrontendState";
  if (/時間面板|時間區間\s*button|時間設置|動態|靜態|date\s*panel|date\s*range/i.test(text)) return "collage.observeFrontendState";
  if (/空設定|未完成設定|防呆|欄位未設置完成|點.{0,8}計算|計算.{0,8}按鈕|validation/i.test(text)) {
    return "collage.observeFrontendState";
  }
  return null;
};

const helperSupportsStructuredObservationType = (value: string | null | undefined): boolean =>
  value === "userButton" ||
  value === "projectToolbar" ||
  value === "reportModeRadio" ||
  value === "datePanel" ||
  value === "validationMessage";

const isDeleteReportFlow = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  const operationTemplate = helperHints?.operationTemplate ?? "";
  const text = detectCaseFeatures(currentCase, helperHints).text;
  return operationTemplate === "collage_delete_temporary_report" ||
    /刪除報表|刪除.*臨時報表|delete\s+(?:temporary\s+)?report|delete-temp-report/i.test(text);
};

export const evaluateCapabilityGate = (
  currentCase: CaseManifestCase | null,
  helperHints: HelperHints | null
): CapabilityGateReport => {
  const operationTemplate = helperHints?.operationTemplate ?? null;
  const automationLevel = helperHints?.automationLevel ?? null;
  const detectedFeatures = detectCaseFeatures(currentCase, helperHints);
  const text = detectedFeatures.text;
  const mode = detectedFeatures.mode;
  const hasFilter = detectedFeatures.hasFilter;
  const hasGroup = detectedFeatures.hasGroup;
  const isMetadataDropdown = detectedFeatures.isMetadataDropdown;
  const isSaveReopenFlow = detectedFeatures.isSaveReopenFlow;
  const isA06LikeCase = /(?:^|[-_])A[-_]?06$/i.test(currentCase?.caseNo ?? "");
  const isAllZeroFieldInspection =
    operationTemplate === "collage_all_zero_field_inspection" ||
    (isA06LikeCase && /全為\s*0\s*欄位|全\s*0\s*欄位|值全為\s*0|all[-_ ]?zero/i.test(text));
  const isDeleteReport = isDeleteReportFlow(currentCase, helperHints);
  const unsupportedFeatures: string[] = [];
  const supportedHelperTemplates: string[] = [];
  const params = paramsObject(helperHints);
  const noSave = helperRequestsNoSave(params) || textExplicitlyDisablesSave(text);
  const noDownload =
    helperRequestsSaveOnly(params) ||
    textExplicitlyDisablesDownload(text) ||
    (helperRequestsNoDownload(params) && !(/下載|CSV/i.test(text) && !helperExplicitlyDisablesDownload(params)));
  const explicitlyNoReopen =
    helperRequestsNoReopen(params) ||
    helperRequestsSaveOnly(params) ||
    textExplicitlyDisablesReopen(text) ||
    /不(?:需|要|應)?重開|不要重開|無需重開|不用重開|不重開\s*editor|不應產生\s*reopen/i.test(text);
  const manualAiRequested = automationLevel === "manual_ai" || operationTemplate === "manual_ai";
  const dateNeedsCodexVisibleUi = dateRequiresCodexVisibleUi(currentCase, helperHints);
  const navigationPreludeAllowed = needsCollageNavigationPrelude(currentCase, helperHints);
  const frontendObservationPrelude = isFrontendObservationPreludeCase(currentCase, helperHints);
  const caseScope = inferCaseScope(currentCase, helperHints);
  const helperContractBlocker = missingActionTemplateBlocker(caseScope);
  const frontendObservationTemplate = inferFrontendObservationTemplate(currentCase);
  const scopeFrontendObservationPrelude =
    caseScope.testIntent === "frontend_observation" &&
    !caseScope.previewRequired &&
    !caseScope.executionRequired &&
    !hasExplicitHelperTemplate(helperHints) &&
    /^BIUI_COLLAGE_R001-(?:I|J|K|L|M|N)-/i.test(currentCase?.caseNo ?? "")
      ? { matched: true, needsEditor: needsCollageNavigationPrelude(currentCase, helperHints) && needsReportEditorPrelude(currentCase) }
      : frontendObservationPrelude;
  const structuredObservationTemplate =
    caseScope.caseScopeContract?.routeIntent === "frontend_observation" &&
    helperSupportsStructuredObservationType(caseScope.caseScopeContract.observationType)
      ? "collage.observeFrontendState"
      : null;
  const effectiveFrontendObservationTemplate = caseScope.caseScopeContract
    ? structuredObservationTemplate
    : frontendObservationTemplate;
  const datePreviewEvidenceAllowed = mode === "collage" && !hasFilter && !hasGroup && canRunDatePreviewEvidenceHelper(params);
  const manualDateSaveAllowed =
    !noSave &&
    datePreviewEvidenceAllowed &&
    (
      booleanishParam(params, ["save", "saveReport", "doSave"]) ||
      Boolean(stringParam(params, ["saveReportNamePrefix", "reportNamePrefix", "reportNamePattern", "reportName", "name"])) ||
      /儲存|保存|save/i.test(text)
    );
  const explicitManualDateReopen = booleanishParam(params, ["reopenViaClickReportName", "reopenReport", "doReopen"]);
  const manualDateReportListDownload = paramsRequestReportListDownload(params) || textRequestsReportListDownload(text);
  const manualDateReopenAllowed =
    manualDateSaveAllowed &&
    !explicitlyNoReopen &&
    !textExplicitlyDisablesReopen(text) &&
    (
      explicitManualDateReopen ||
      (!manualDateReportListDownload && /載入已儲存|設定還原|還原|重開|重新檢視|reopen|點報表名稱/i.test(text))
    );
  const formulaHelperAllowed = mode === "collage" && !hasFilter && !hasGroup && hasFormulaParams(params);
  const createProjectAllowed = mode === "collage" && !hasFilter && !hasGroup && isCreateProjectOnlyFlow(currentCase, helperHints);
  const simpleProjectFlowAllowed = mode === "collage" && !hasFilter && !hasGroup && (isOpenReportFromProjectListFlow(currentCase, helperHints) || isBackToProjectListFlow(currentCase, helperHints));

  if (mode === "record") unsupportedFeatures.push("record_mode_helper_not_supported");
  if (mode === "metric") unsupportedFeatures.push("metric_mode_helper_not_supported");
  if (hasFilter) unsupportedFeatures.push("filter_helper_not_implemented");
  if (hasGroup) unsupportedFeatures.push("group_helper_not_implemented");

  if (createProjectAllowed) {
    supportedHelperTemplates.push(
      "collage.openProject",
      "collage.createProject"
    );
  } else if (simpleProjectFlowAllowed) {
    supportedHelperTemplates.push(
      "collage.openProject",
      "collage.openReportFromProjectList",
      ...(isBackToProjectListFlow(currentCase, helperHints) ? ["collage.clickBackToProjectList"] : [])
    );
  } else if (formulaHelperAllowed) {
    supportedHelperTemplates.push(
      "collage.openProject",
      "collage.createReport",
      "collage.configureCalculatedMetricAndPreview"
    );
  } else if (mode === "collage" && !hasFilter && !hasGroup && isMetadataDropdown) {
    supportedHelperTemplates.push(
      "collage.openProject",
      "collage.createReport",
      "collage.extractMetadataDropdownFields"
    );
  } else if (mode === "collage" && !hasFilter && !hasGroup && isAllZeroFieldInspection) {
    supportedHelperTemplates.push(
      "collage.openProject",
      "collage.createReport",
      "collage.inspectAllZeroFields"
    );
  } else if (mode === "collage" && !hasFilter && !hasGroup && isDeleteReport) {
    supportedHelperTemplates.push(
      "collage.openProject",
      "collage.createAndDeleteTemporaryReport"
    );
  } else if (scopeFrontendObservationPrelude.matched && !helperContractBlocker) {
    supportedHelperTemplates.push(
      "collage.openProject",
      ...(scopeFrontendObservationPrelude.needsEditor ? ["collage.createReport"] : []),
      ...(effectiveFrontendObservationTemplate ? [effectiveFrontendObservationTemplate] : [])
    );
  } else if (mode === "collage" && !hasFilter && !hasGroup) {
    supportedHelperTemplates.push(
      "collage.openProject",
      ...(booleanishParam(params, ["createNewProject", "createProjectThenReport"]) ? ["collage.createProject"] : []),
      "collage.createReport",
      "collage.configureMetric",
      "collage.runPreviewAndCollectEvidence"
    );
    if (!helperRequestsSaveOnly(params) && !isSameCaseSaveLoadFlow(currentCase, helperHints) && /修改既有|既有報表|已儲存報表|儲存覆寫|覆寫/.test(text)) {
      supportedHelperTemplates.push("collage.openExistingReport");
    }
    if (!noSave && /儲存|覆寫/.test(text)) supportedHelperTemplates.push("collage.saveReport");
    if (!explicitlyNoReopen && (booleanishParam(params, ["reopenViaClickReportName"]) || /重開|重新檢視|還原|載入|reopen|點報表名稱/i.test(text))) {
      supportedHelperTemplates.push("collage.reopenReport");
    }
    if (!noDownload && /下載|CSV/i.test(text)) supportedHelperTemplates.push("collage.downloadCsvAndComparePreview");
    if (datePreviewEvidenceAllowed) supportedHelperTemplates.push("collage.runDateVariantsPreviewEvidence");
  }

  if ((manualAiRequested || dateNeedsCodexVisibleUi) && !isDeleteReport && !formulaHelperAllowed && !createProjectAllowed && !simpleProjectFlowAllowed) {
    const degradedAllowed = [
      "collage.openProject",
      "collage.createReport",
      ...(datePreviewEvidenceAllowed ? ["collage.runDateVariantsPreviewEvidence"] : []),
      ...(manualDateSaveAllowed ? ["collage.saveReport"] : []),
      ...(manualDateReopenAllowed ? ["collage.reopenReport"] : []),
      ...(!noDownload && /下載|CSV/i.test(text) && datePreviewEvidenceAllowed ? ["collage.downloadCsvAndComparePreview"] : [])
    ];
    const filtered = supportedHelperTemplates.filter((template) => degradedAllowed.includes(template));
    if (navigationPreludeAllowed || datePreviewEvidenceAllowed) {
      for (const template of degradedAllowed) {
        if (!filtered.includes(template)) filtered.push(template);
      }
    }
    supportedHelperTemplates.splice(0, supportedHelperTemplates.length, ...filtered);
  }

  let supportStatus: CapabilityGateReport["supportStatus"] = "degraded";
  let executionMode: CapabilityGateReport["executionMode"] = "codex_visible_ui";
  let helperPreRunAllowed = false;
  let blockingReason: string | null = null;

  if (helperContractBlocker) {
    supportStatus = "unsupported";
    executionMode = "blocked_unsupported";
    helperPreRunAllowed = false;
    blockingReason = helperContractBlocker;
  } else if (scopeFrontendObservationPrelude.matched) {
    supportStatus = "degraded";
    executionMode = "codex_visible_ui";
    helperPreRunAllowed = true;
  } else if (formulaHelperAllowed || createProjectAllowed || simpleProjectFlowAllowed) {
    supportStatus = "supported";
    executionMode = "helper_assisted";
    helperPreRunAllowed = true;
  } else if ((manualAiRequested || dateNeedsCodexVisibleUi) && !isDeleteReport) {
    supportStatus = datePreviewEvidenceAllowed ? "degraded" : "degraded";
    executionMode = "codex_visible_ui";
    helperPreRunAllowed = navigationPreludeAllowed || datePreviewEvidenceAllowed;
  } else if (unsupportedFeatures.length > 0 || (automationLevel === "blocked_if_no_helper" && supportedHelperTemplates.length === 0)) {
    supportStatus = "unsupported";
    executionMode = "blocked_unsupported";
    blockingReason = unsupportedFeatures.length > 0
      ? `Unsupported online trusted-run capability: ${unsupportedFeatures.join(", ")}`
      : "Helper is required by case hints, but no implemented helper template supports this case.";
  } else if (supportedHelperTemplates.length > 0) {
    supportStatus = "supported";
    executionMode = "helper_assisted";
    helperPreRunAllowed = true;
  } else {
    supportStatus = "degraded";
    executionMode = "codex_visible_ui";
    helperPreRunAllowed = false;
  }

  const codexInstruction = helperContractBlocker
    ? "Do not fallback to generic preview/helper actions. Write a single-case BLOCKED result with fail_category=HELPER_CONTRACT_MISSING and detail_json.blocked_reason from this capability gate."
    : supportStatus === "unsupported"
      ? "Do not execute trusted browser testcase steps for this case. Write a single-case BLOCKED result with fail_category=UNSUPPORTED_ONLINE_CAPABILITY and detail_json.blocked_reason from this capability gate."
    : supportStatus === "supported"
      ? "Use helper pre-run evidence when status=ok and matching this case; continue with visible UI only for incomplete evidence. Codex still judges PASS/FAIL/BLOCKED."
      : navigationPreludeAllowed
        ? datePreviewEvidenceAllowed
          ? "Helper pre-run may perform safe collage navigation/setup plus implemented date preview evidence collection for preset/static date cases. Codex must judge PASS/FAIL/BLOCKED from per-variant UI, request body, and preview evidence; do not treat helper output alone as final testcase proof."
          : "Helper pre-run may perform safe collage navigation/setup and implemented observeFrontendState evidence collection. Codex must judge PASS/FAIL/BLOCKED from the case scope and observation evidence; do not treat helper output alone as final testcase proof."
        : "Do not run helper pre-run. Codex may perform visible UI/read-only evidence collection one case at a time. If browser automation is unavailable or the UI path is not reachable, write a single-case BLOCKED result with fail_category=TOOL_EXECUTION_UNAVAILABLE and cite this capability gate/helper skipped state as current-run evidence.";

  return {
    schemaVersion: "uat-capability-gate-v1",
    generatedAt: new Date().toISOString(),
    caseId: currentCase?.caseNo ?? helperHints?.caseId ?? null,
    supportStatus,
    executionMode,
    helperPreRunAllowed,
    blockingReason,
    unsupportedFeatures,
    supportedHelperTemplates,
    caseScope,
    detected: {
      mode,
      hasFilter,
      hasGroup,
      isMetadataDropdown,
      isSaveReopenFlow,
      operationTemplate,
      automationLevel
    },
    codexInstruction
  };
};

const writeCapabilityGateMarkdown = (filePath: string, report: CapabilityGateReport): void => {
  const lines = [
    "# UAT Capability Gate v1",
    "",
    "This gate is generated before Codex/browser execution. It prevents unsupported online trusted-run cases from silently falling back to slow or unstable manual exploration.",
    "",
    `- case_id: ${report.caseId ?? "(unavailable)"}`,
    `- support_status: ${report.supportStatus}`,
    `- execution_mode: ${report.executionMode}`,
    `- helper_pre_run_allowed: ${report.helperPreRunAllowed}`,
    `- blocking_reason: ${report.blockingReason ?? "none"}`,
    `- unsupported_features: ${report.unsupportedFeatures.length > 0 ? report.unsupportedFeatures.join(", ") : "none"}`,
    `- supported_helper_templates: ${report.supportedHelperTemplates.length > 0 ? report.supportedHelperTemplates.join(", ") : "none"}`,
    `- case_scope: ${report.caseScope.testIntent}; preview_required=${report.caseScope.previewRequired}; execution_required=${report.caseScope.executionRequired}`,
    `- missing_action_template: ${report.caseScope.missingActionTemplate ?? "none"}`,
    report.caseScope.caseScopeContract
      ? `- structured_case_scope: ${report.caseScope.caseScopeContract.source}; targets=${report.caseScope.caseScopeContract.requiredActions.map((item) => item.target).join(", ")}`
      : "- structured_case_scope: none",
    "",
    "## Codex Instruction",
    report.codexInstruction,
    "",
    "## Detected",
    "```json",
    JSON.stringify(report.detected, null, 2),
    "```",
    ""
  ];
  fs.writeFileSync(filePath, lines.join("\n"));
};

export const writeCapabilityGate = (options: WriteCapabilityGateOptions): CapabilityGateFiles => {
  const inputDir = path.join(options.runDir, "input");
  fs.mkdirSync(inputDir, { recursive: true });
  const report = evaluateCapabilityGate(options.currentCase, options.helperHints);
  const jsonPath = path.join(inputDir, "capability-gate.json");
  const markdownPath = path.join(inputDir, "capability-gate.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeCapabilityGateMarkdown(markdownPath, report);
  return { jsonPath, markdownPath, report };
};
