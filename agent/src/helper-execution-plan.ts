import fs from "node:fs";
import path from "node:path";
import type { CaseManifestCase } from "./case-manifest";
import type { HelperHints } from "./helper-hints";
import { detectCaseFeatures, isNeutralCleanupTarget, parseCleanupTargets } from "./case-feature-detection";
import { inferCaseScope, missingActionTemplateBlocker } from "./case-scope";
import {
  structuredEvidenceList,
  type StructuredCaseScopeAction,
  type StructuredCaseScopeContract
} from "./structured-case-scope";

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
  caseScopeActions: StructuredCaseScopeAction[];
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
  caseScopeContract: StructuredCaseScopeContract | null;
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

const helperRequestsSaveOnly = (params: Record<string, unknown>): boolean =>
  booleanishParam(params, ["saveOnly", "save_only"]) || /^save_only$/i.test(helperScope(params) ?? "");

const helperRequestsDownload = (params: Record<string, unknown>): boolean =>
  booleanishParam(params, ["downloadCsv", "doDownloadCsv", "downloadCSV", "download", "csvDownload", "needCsv"]);

const helperExplicitlyDisablesDownload = (params: Record<string, unknown>): boolean =>
  booleanishParam(params, ["skipDownload", "doNotDownload", "noDownload", "doNotDownloadCsv", "skipCsv", "noCsv"]);

const textExplicitlyRequiresDownload = (text: string): boolean =>
  /(?:下載報表|下載按鈕|下載入口|下載成功|下載\s*CSV|CSV\s*下載|CSV\s*落盤|browser\s+download|download\s+event|downloaded\s+CSV|downloaded_csv|downloadedCsv|csv\.rows)/i.test(text);

const textOnlyExcludesOtherDownloadScope = (text: string): boolean =>
  /(?:不是|非|不從|不走|不點|不觸發|本題不測項目).{0,28}(?:專案頁|清單|列表|row|editor|global).{0,28}(?:下載|download)|(?:專案頁|清單|列表|row|editor|global).{0,28}(?:下載|download).{0,16}(?:屬|不是|非|不測)/i.test(text);

const textExplicitlyDisablesDownload = (text: string): boolean => {
  const disablesDownload =
    /(?:本題不(?:下載|匯出)|不(?:需|用|要|應)?(?:下載|匯出)\s*(?:CSV|報表)?|禁止.{0,12}(?:下載|匯出)|skip\s*(?:download|csv)|doNotDownload|noDownload)/i.test(text) ||
    /(?:不測|不做|不驗).{0,12}(?:CSV|下載|download)/i.test(text);
  if (!disablesDownload) return false;
  return !(textExplicitlyRequiresDownload(text) && textOnlyExcludesOtherDownloadScope(text));
};

const helperRequestsNoDownload = (params: Record<string, unknown>): boolean =>
  helperRequestsDownload(params)
    ? false
    : helperRequestsPreviewOnly(params) || helperExplicitlyDisablesDownload(params);

const textExplicitlyDisablesSave = (text: string): boolean =>
  /(?:本題不測項目|本題不做|本題不測|本題不驗|不測|不做|不驗|本題禁止|禁止|絕不|不要|不用|不需|不應|不點|不離開.*不點).{0,40}(?:save|儲存|保存)|(?:不|勿)\s*(?:save|儲存|保存)|不儲存/i.test(text);

const textExplicitlyDisablesReopen = (text: string): boolean =>
  /(?:本題不測項目|本題不做|本題不測|本題不驗|不測|不做|不驗|本題禁止|禁止|絕不|不要|不用|不需|不應|不點).{0,40}(?:reopen|重開|報表名稱)|(?:不|勿)\s*(?:reopen|重開)|不點報表名稱|不進入\s*editor\s*reopen/i.test(text);

const textRequestsEditorSessionDownload = (text: string): boolean =>
  /同\s*(?:一個\s*)?editor\s*session|editor[-_ ]session|不離開\s*editor|直接點\s*editor\s*內.{0,16}(?:下載|download)|editor\s*內的?「?下載報表/i.test(text);

const textRequestsReportListDownload = (text: string): boolean =>
  /(?:專案頁|清單|列表|該報表\s*row|報表\s*row|row|報表列|project[-_ ]row).{0,32}(?:下載|download|CSV)|(?:下載|download|CSV).{0,32}(?:專案頁|清單|列表|該報表\s*row|報表\s*row|row|報表列|project[-_ ]row)|project_page_row_download_button/i.test(text);

const textRequestsSameCaseSaveAndRowDownload = (text: string): boolean =>
  /同\s*case|同一\s*case/.test(text) && /(?:建立|新增報表).{0,60}(?:儲存|save)|(?:儲存|save).{0,60}(?:專案頁|清單|row|下載)/i.test(text) && textRequestsReportListDownload(text);

const textRequestsSave = (text: string, params: Record<string, unknown>): boolean =>
  booleanishParam(params, ["save", "saveReport", "doSave"]) || /(?:儲存|保存|save)/i.test(text);

const paramsRequestEditorSessionDownload = (params: Record<string, unknown>): boolean => {
  const entry = stringParam(params, ["downloadEntry", "downloadTarget", "downloadSource", "csvEntry"]) ?? "";
  return booleanishParam(params, ["downloadFromEditor", "downloadFromEditorSession", "editorSessionDownload"]) ||
    /editor[-_ ]session|editor[-_ ]global|global[-_ ]download/i.test(entry);
};

const paramsRequestReportListDownload = (params: Record<string, unknown>): boolean => {
  const entry = stringParam(params, ["downloadEntry", "downloadTarget", "downloadSource", "csvEntry"]) ?? "";
  return booleanishParam(params, ["downloadFromProjectRow", "downloadFromReportRow", "projectRowDownload", "reportListDownload"]) ||
    booleanishParam(params, ["doNotUseEditorGlobalDownload"]) ||
    /project[_-]?page[_-]?row|project[-_ ]row|report[_-]?row|row[_-]?download|report[_-]?list|project[_-]?list/i.test(entry);
};

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
    /刪除.*報表|delete\s+(?:temporary\s+)?report|delete-temp-report/i.test(text);
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

type FrontendObservationType =
  | "userButton"
  | "projectToolbar"
  | "reportModeRadio"
  | "datePanel"
  | "validationMessage"
  | "sidebarGroup"
  | "projectCreateModal"
  | "rowDownloadTooltip"
  | "rowDeleteTooltip"
  | "deleteCancelFlow"
  | "projectListPagination"
  | "projectLimitToast"
  | "sourceReportPicker"
  | "fieldPicker"
  | "metricRowControls"
  | "metricRowAdd"
  | "metricRowDuplicate"
  | "metricRowDelete"
  | "dateTimeTypeTab"
  | "datePanelCancel"
  | "dateRangeLimit"
  | "downloadToast"
  | "saveReportDisabled"
  | "saveModalCancel"
  | "copyModalCancel"
  | null;

const inferFrontendObservationType = (currentCase: CaseManifestCase | null): FrontendObservationType => {
  const coreText = [
    currentCase?.caseNo,
    currentCase?.caseTitle,
    currentCase?.stepsSummary,
    currentCase?.validationMethod
  ]
    .filter(Boolean)
    .join("\n");
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
  if (/使用者按鈕|登入者名稱|user\s*button|account\s*button/i.test(text)) return "userButton";
  if (/儲存報表.{0,16}disabled|disabled.{0,16}儲存報表|未輸入報表名稱.*儲存報表|save\s*report.{0,16}disabled/i.test(text)) return "saveReportDisabled";
  if (/報表名稱.{0,40}(?:超過|20|特殊字元|符號|限制)|(?:超過|20|特殊字元|符號|限制).{0,40}報表名稱|儲存專案|save\s*modal/i.test(text)) return "saveModalCancel";
  if (/新增專案\s*modal|新增專案.*名稱輸入|專案名稱輸入|拼貼報表旁新增專案|project\s*create\s*modal|create\s*project/i.test(text)) return "projectCreateModal";
  if (/刪除確認|deleteConfirmModal|取消流程|取消刪除|刪除\s*modal|delete\s*cancel/i.test(text)) return "deleteCancelFlow";
  if (/側欄|公司共享|sidebar/i.test(text)) return "sidebarGroup";
  if (/(?:hover|tooltip).{0,40}(?:下載|download)|(?:下載|download).{0,40}(?:hover|tooltip)|列內.*下載|row.*download/i.test(text)) return "rowDownloadTooltip";
  if (/(?:第一列|唯一一列).{0,80}(?:刪除列|deleteRow|metricRows\.deleteRowButton).{0,80}(?:複製列|duplicateRow|metricRows\.duplicateRowButton)|(?:複製列|duplicateRow|metricRows\.duplicateRowButton).{0,80}(?:第一列|唯一一列).{0,80}(?:刪除列|deleteRow|metricRows\.deleteRowButton)/i.test(coreText)) return "metricRowControls";
  if (/(?:hover|tooltip).{0,40}(?:刪除|delete)|(?:刪除|delete).{0,40}(?:hover|tooltip)|列內.*刪除|row.*delete/i.test(text)) return "rowDeleteTooltip";
  if (/5\s*個上限|最高\s*5\s*個專案|上限阻擋|project.*limit/i.test(text)) return "projectLimitToast";
  if (/複製列|duplicateRow|metricRows\.duplicateRowButton|複製當前列/i.test(coreText)) return "metricRowDuplicate";
  if (/刪除列|deleteRow|metricRows\.deleteRowButton|非第一列.*刪除/i.test(coreText)) return "metricRowDelete";
  if (/新增列|addRow|metricRows\.addRowButton|\+\s*新增列/i.test(coreText)) return "metricRowAdd";
  if (/metricRows|欄位列|列數|第一列|自訂欄位/i.test(text)) return "metricRowControls";
  if (/欄位\s*picker|field\s*picker|欄位選擇.*新增帳號數|選取.*新增帳號數/i.test(text)) return "fieldPicker";
  if (/報表\s*picker|來源報表|source\s*report|搜尋.*每日|每日報表/i.test(text)) return "sourceReportPicker";
  if (/下載\/刪除\s*icon|下載\s*icon|刪除\s*icon|toolbar|工具列|勾選.*下載|未勾選.*下載|disabled|enabled/i.test(text)) {
    return "projectToolbar";
  }
  if (/建構方式\s*radio|拼貼模式|報表模式|report[-_\s]*mode|radio/i.test(text)) return "reportModeRadio";
  if (/分頁|每頁筆數|筆\/頁|下一頁|pagination|page\s*size/i.test(text)) return "projectListPagination";
  if (/時間面板|時間區間\s*button|時間設置|動態|靜態|date\s*panel|date\s*range/i.test(text)) return "datePanel";
  if (/空設定|未完成設定|防呆|欄位未設置完成|點.{0,8}計算|計算.{0,8}按鈕|validation/i.test(text)) return "validationMessage";
  if (/下載.*toast|數據已開始下載|editor.*下載|右上下載/i.test(text)) return "downloadToast";
  if (/儲存\s*modal|儲存.*取消|save\s*modal/i.test(text)) return "saveModalCancel";
  if (/複製副本.*modal|copy\s*modal|複製.*取消/i.test(text)) return "copyModalCancel";
  return null;
};

const observationRequiredEvidence = (observationType: FrontendObservationType): string[] => {
  switch (observationType) {
    case "userButton":
      return ["topbar.userButton.state", "dom.state", "screenshot"];
    case "projectToolbar":
      return ["projectToolbar.buttons.state", "dom.state", "screenshot"];
    case "reportModeRadio":
      return ["reportMode.radio.state", "dom.state", "screenshot"];
    case "datePanel":
      return ["dateRange.panel.state", "dom.state", "screenshot"];
    case "validationMessage":
      return ["validation.message.state", "dom.state", "screenshot"];
    case "sidebarGroup":
      return ["sidebar.companySharedGroup.state", "interactionLog", "screenshot"];
    case "projectCreateModal":
      return ["projectCreateModal.flow.state", "projectCreateModal.state", "interactionLog", "screenshot"];
    case "rowDownloadTooltip":
      return ["projectList.rowActionTooltip.state", "interactionLog", "screenshot"];
    case "rowDeleteTooltip":
      return ["projectList.rowActionTooltip.state", "interactionLog", "screenshot"];
    case "deleteCancelFlow":
      return ["projectList.deleteCancelFlow.state", "deleteConfirmModal.state", "projectList.reportRow.state", "interactionLog", "screenshot"];
    case "projectListPagination":
      return ["projectList.pagination.state", "interactionLog", "screenshot"];
    case "projectLimitToast":
      return ["projectLimit.toast.state", "interactionLog", "screenshot"];
    case "sourceReportPicker":
      return ["sourceReportPicker.state", "sourceControl.after", "interactionLog", "screenshot"];
    case "fieldPicker":
      return ["fieldPicker.state", "fieldPicker.signature", "fieldControl.after", "interactionLog", "screenshot"];
    case "metricRowControls":
      return ["metricRows.state", "dom.state", "screenshot"];
    case "metricRowAdd":
      return ["metricRows.addFlow.state", "interactionLog", "screenshot"];
    case "metricRowDuplicate":
      return ["metricRows.duplicateFlow.state", "interactionLog", "screenshot"];
    case "metricRowDelete":
      return ["metricRows.deleteFlow.state", "interactionLog", "screenshot"];
    case "dateTimeTypeTab":
      return ["dateRange.timeTypeTab.state", "interactionLog", "screenshot"];
    case "datePanelCancel":
      return ["dateRange.cancelFlow.state", "interactionLog", "screenshot"];
    case "dateRangeLimit":
      return ["dateRange.limitValidation.state", "interactionLog", "screenshot"];
    case "downloadToast":
      return ["editorToolbar.download.state", "download.toast.state", "interactionLog", "screenshot"];
    case "saveReportDisabled":
      return ["editorToolbar.saveButton.state", "dom.state", "screenshot"];
    case "saveModalCancel":
      return ["saveModal.cancelFlow.state", "interactionLog", "screenshot"];
    case "copyModalCancel":
      return ["copyModal.cancelFlow.state", "interactionLog", "screenshot"];
    default:
      return ["dom.state", "screenshot"];
  }
};

const fallbackObservationType = (value: string | null): FrontendObservationType => {
  switch (value) {
    case "userButton":
      return "userButton";
    case "projectToolbar":
      return "projectToolbar";
    case "reportModeRadio":
      return "reportModeRadio";
    case "datePanel":
      return "datePanel";
    case "validationMessage":
      return "validationMessage";
    case "sidebarGroup":
    case "sidebarCompanySharedGroup":
      return "sidebarGroup";
    case "projectCreateModal":
      return "projectCreateModal";
    case "rowDownloadTooltip":
      return "rowDownloadTooltip";
    case "rowDeleteTooltip":
    case "rowActionTooltip":
      return "rowDeleteTooltip";
    case "deleteCancelFlow":
      return "deleteCancelFlow";
    case "projectListPagination":
      return "projectListPagination";
    case "projectLimitToast":
      return "projectLimitToast";
    case "sourceReportPicker":
      return "sourceReportPicker";
    case "fieldPicker":
      return "fieldPicker";
    case "metricRowControls":
      return "metricRowControls";
    case "metricRowAdd":
      return "metricRowAdd";
    case "metricRowDuplicate":
      return "metricRowDuplicate";
    case "metricRowDelete":
      return "metricRowDelete";
    case "dateTimeTypeTab":
      return "dateTimeTypeTab";
    case "datePanelCancel":
      return "datePanelCancel";
    case "dateRangeLimit":
      return "dateRangeLimit";
    case "downloadToast":
    case "editorDownload":
      return "downloadToast";
    case "saveReportDisabled":
      return "saveReportDisabled";
    case "saveModalCancel":
      return "saveModalCancel";
    case "copyModalCancel":
      return "copyModalCancel";
    default:
      return null;
  }
};

const actionsForTemplate = (
  contract: StructuredCaseScopeContract | null,
  template: string
): StructuredCaseScopeAction[] => {
  if (!contract) return [];
  if (template === "collage.observeFrontendState") return contract.requiredActions;
  if (template === "collage.configureMetric" || template === "collage.runDateVariantsPreviewEvidence") {
    return contract.requiredActions.filter((item) =>
      item.target.startsWith("metricRows.") ||
      item.target.startsWith("sourceReportPicker.") ||
      item.target.startsWith("dateRange.") ||
      item.target.startsWith("reportMode.")
    );
  }
  if (template === "collage.runPreviewAndCollectEvidence") {
    return contract.requiredActions.filter((item) => item.target === "preview.calculateButton" || item.evidenceRequirements.some((evidence) => evidence.startsWith("network.") || evidence === "chart.datasets"));
  }
  if (template === "collage.downloadCsvAndComparePreview") {
    return contract.requiredActions.filter((item) => item.target.startsWith("editorToolbar.") || item.target.startsWith("download.") || item.evidenceRequirements.includes("downloadArtifact"));
  }
  if (template === "collage.copyReportAndVerify") {
    return contract.requiredActions.filter((item) =>
      item.target.startsWith("editorToolbar.copy") ||
      item.target.startsWith("copyModal.") ||
      item.target.startsWith("projectList.")
    );
  }
  if (template === "collage.updateExistingReportAndReopen") {
    return contract.requiredActions.filter((item) =>
      item.target.startsWith("editorToolbar.update") ||
      item.target.startsWith("dateRange.") ||
      item.target.startsWith("reportPersistence.") ||
      item.target.startsWith("projectList.")
    );
  }
  if (template === "collage.saveReport") {
    return contract.requiredActions.filter((item) =>
      item.target.startsWith("saveModal.") ||
      item.target.startsWith("save.") ||
      item.target.startsWith("projectList.")
    );
  }
  if (template === "collage.reopenReport") {
    return contract.requiredActions.filter((item) =>
      item.target.startsWith("projectList.") ||
      item.target.startsWith("reportPersistence.")
    );
  }
  return [];
};

const structuredDatePresetLabelFromTarget = (target: string): string | null => {
  switch (target) {
    case "dateRange.preset.lastWeek":
      return "上週";
    case "dateRange.preset.currentWeek":
      return "本週";
    case "dateRange.preset.past30Days":
      return "過去 30 天";
    case "dateRange.preset.recent30Days":
      return "最近 30 天";
    case "dateRange.preset.yesterday":
      return "昨日";
    case "dateRange.preset.fromDateToYesterday":
      return "自某日至昨日";
    case "dateRange.preset.fromDateToToday":
      return "自某日至今";
    default:
      return null;
  }
};

const structuredDateVariantLabels = (contract: StructuredCaseScopeContract | null): string[] => {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const action of contract?.requiredActions ?? []) {
    const label = structuredDatePresetLabelFromTarget(action.target);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
};

const paramsForStructuredContract = (
  params: Record<string, unknown>,
  contract: StructuredCaseScopeContract | null
): Record<string, unknown> => {
  if (!contract) return params;
  const next = { ...params };
  const variants = structuredDateVariantLabels(contract);
  if (variants.length > 1) {
    next.dateRange = null;
    next.dateVariants = variants;
  }
  if (contract.routeIntent === "download_execution" || contract.routeIntent === "report_mutation_flow") {
    if (typeof next.field !== "string" || !next.field.trim()) next.field = DEFAULT_COLLAGE_METRIC_FIELD;
    if (!Array.isArray(next.fields) || next.fields.length === 0) next.fields = [next.field];
    if (typeof next.source !== "string" || !next.source.trim()) next.source = DEFAULT_COLLAGE_SOURCE_REPORT;
    if (typeof next.sourceReport !== "string" || !next.sourceReport.trim()) next.sourceReport = next.source;
  }
  if (contract.routeIntent === "report_mutation_flow") {
    if (typeof next.dateRange !== "string" || !next.dateRange.trim()) next.dateRange = "2026/03/01~2026/03/31";
    if (typeof next.display !== "string" || !next.display.trim()) next.display = "每天";
    next.skipSave = false;
    if (/M-03$/i.test(contract.caseNo)) {
      next.reportNameValidationMode = "maxLength";
      next.cancelReportNamePattern = "aaaaaaaaaaaaaaaaaaaaa";
    }
    if (/M-04$/i.test(contract.caseNo)) {
      next.reportNameValidationMode = "specialChars";
      next.cancelReportNamePattern = "bad/name?";
    }
    if (/M-05$/i.test(contract.caseNo)) {
      next.reportNameValidationMode = "projectSelector";
      next.cancelReportNamePattern = "BIUIM05PREVIEW";
    }
  }
  if (contract.routeIntent === "download_execution") {
    next.skipDownload = false;
    next.downloadScope = typeof next.downloadScope === "string" && next.downloadScope.trim() ? next.downloadScope : "editor_session";
  }
  return next;
};

const dateRequiresCodexVisibleUi = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  const params = paramsObject(helperHints);
  const cleanup = parseCleanupTargets(currentCase?.cleanupChecklist);
  const dateVariants = firstStringArrayParam(params, ["dateVariants", "uiLabels"]);
  if (dateVariants.length > 1 || recordArrayParam(params, "dateVariants").length > 1 || recordArrayParam(params, "stages").length > 0) return true;
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
  return /全動態|半動態|自訂動態|動態區間|天前|天後|快捷起點|快捷訖點|快捷終點|跨\s*9[01]\s*天|90\s*天|91\s*天|連續切換|不同區間/.test(dateText);
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

const cleanupMetricFieldTarget = (value: string | null | undefined): string | null => {
  const cleaned = nonNeutral(value);
  if (!cleaned) return null;
  if (/^\d+\s*(?:欄|欄位|列|row|rows?)$/i.test(cleaned)) return null;
  if (/^(?:0|無|空)\s*(?:欄|欄位|列|row|rows?)$/i.test(cleaned)) return null;
  return cleaned;
};

const cleanupMetricFieldIsCountOnly = (value: string | null | undefined): boolean => {
  const cleaned = nonNeutral(value);
  return Boolean(cleaned && /^\d+\s*(?:欄|欄位|field|fields?)$/i.test(cleaned));
};

const DEFAULT_COLLAGE_SOURCE_REPORT = "每日報表";
const DEFAULT_COLLAGE_METRIC_FIELD = "新增帳號數";

const caseNeedsDefaultSingleMetric = (
  text: string,
  cleanup: Record<string, string>,
  params: Record<string, unknown>,
  caseScopeContract: StructuredCaseScopeContract | null
): boolean => {
  if (!cleanupMetricFieldIsCountOnly(cleanup["欄位"])) return false;
  if (caseScopeContract?.routeIntent === "download_execution") return true;
  return helperRequestsDownload(params) ||
    textExplicitlyRequiresDownload(text) ||
    /CSV|preview|預覽|計算|最小設置|最小設定|row\s*count|數值.*preview/i.test(text);
};

const isProjectRowDownloadOnlyCase = (currentCase: CaseManifestCase | null, params: Record<string, unknown>): boolean => {
  const text = textBlob(currentCase);
  if (isProjectToolbarBatchDownloadCase(currentCase, params)) return false;
  if (!(textRequestsReportListDownload(text) || paramsRequestReportListDownload(params))) return false;
  if (!/(?:專案頁|清單|列表|row|報表列|列內).{0,40}(?:下載|download)|(?:下載|download).{0,40}(?:專案頁|清單|列表|row|報表列|列內)/i.test(text)) return false;
  const explicitlyExcludesCsvContent = /本題不測項目.{0,32}CSV\s*內容驗證/i.test(text);
  if (!explicitlyExcludesCsvContent && /CSV\s*row\s*count|row\s*count.*preview|CSV\s*數值|數值.*preview|內容驗證|完整輸出|完整比對/i.test(text)) return false;
  return explicitlyExcludesCsvContent || /只驗(?:證)?.{0,16}(?:觸發下載|下載事件|下載檔|download event)|列內下載 icon 觸發下載/i.test(text);
};

const isProjectToolbarBatchDownloadCase = (currentCase: CaseManifestCase | null, params: Record<string, unknown>): boolean => {
  const explicitScope = stringParam(params, ["downloadScope", "downloadEntry", "downloadTarget"]);
  if (explicitScope === "project_toolbar_batch") return true;
  const text = textBlob(currentCase);
  const hasBatchIntent = /多列|多筆|批次|batch|multi/i.test(text);
  const hasDownloadIntent = /下載|download|export|csv|匯出/i.test(text);
  const hasProjectToolbarContext = /專案頁|專案清單|報表清單|toolbar|工具列|右上/i.test(text);
  return hasBatchIntent && hasDownloadIntent && hasProjectToolbarContext;
};

const inferReportNamePattern = (text: string, params: Record<string, unknown>): string | null =>
  cleanReportNamePattern(
    stringParam(params, ["reportName", "reportNamePattern"]) ??
      reportNamePatternFromPrefixParam(params, ["saveReportNamePrefix", "reportNamePrefix"]) ??
      firstMatch(text, [/報表名[：:]\s*([^\n]+)/, /報表名稱[：:]\s*([^\n]+)/, /(OTTEST\d+_[A-Z]\d{2}_<timestamp>)/i, /(OTTEST\d+_[A-Z]\d{2}_[A-Za-z0-9_-]+(?:_<timestamp>)?)/i, /(TOOL_[A-Z]\d{2}_<timestamp>)/i, /(TOOL_[A-Z]\d{2}_[A-Za-z0-9_-]+)/i])
  );

const reportNamePatternFromPrefixParam = (params: Record<string, unknown>, keys: string[]): string | null => {
  const prefix = stringParam(params, keys);
  if (!prefix) return null;
  return prefix.includes("<timestamp>") ? prefix : `${prefix}<timestamp>`;
};

const inferExistingReportNamePattern = (text: string, params: Record<string, unknown>, fallbackReportNamePattern: string | null): string | null =>
  cleanReportNamePattern(
    stringParam(params, ["existingReportName", "existingReportNamePattern", "savedReportName"]) ??
      firstMatch(text, [/(OTTEST\d+_[A-Z]\d{2}_<timestamp>)/i, /(OTTEST\d+_[A-Z]\d{2}_[A-Za-z0-9_-]+(?:_<timestamp>)?)/i, /(TOOL_A01_<timestamp>)/i, /(TOOL_A01_[A-Za-z0-9_-]+)/i, /(TOOL_[A-Z]\d{2}_<timestamp>)/i]) ??
      fallbackReportNamePattern
  );

const inferExistingReportSelectionMode = (text: string, params: Record<string, unknown>): "visible_first" | null => {
  const explicit = stringParam(params, ["existingReportSelectionMode", "existingReportSelection"]);
  if (explicit === "visible_first") return "visible_first";
  const requestsAnyVisibleReport =
    /任一(?:可見)?既有報表|任一.*報表\s*row|點擊既有報表名稱|使用專案頁任一可見既有報表/.test(text);
  const requiresCurrentRunTestReport =
    /本輪(?:建立|可辨識)|不可動非測試報表|前置資源:.*本輪/.test(text);
  return requestsAnyVisibleReport && !requiresCurrentRunTestReport ? "visible_first" : null;
};

const cleanDateRangeText = (value: string | null): string | null => {
  const trimmed = nonNeutral(value);
  if (!trimmed) return null;
  const cleaned = trimmed
    .replace(/^[\s　]*(?:全動態|全靜態|全静態|半動態|半动态|自訂動態|自订动态)[\s　]*/i, "")
    .replace(/[\s　]*[\(（](?:全動態|全靜態|全静態|半動態|半动态|自訂動態|自订动态|動態|动态|靜態|静态|快捷|快捷起點|快捷訖點|快捷終點)[\)）][\s　]*/gi, "")
    .trim();
  return nonNeutral(cleaned);
};

const sourceReportListFromText = (text: string): string[] => {
  const match = text.match(/來源報表(?:[（(][^)）]+[)）])?[=：: ]*([^\n]+)/);
  const raw = match?.[1]?.trim() ?? "";
  if (!raw) return [];
  return raw
    .split(/[,，、;/；]/)
    .map((item) => item.replace(/[`"'「」]/g, "").trim())
    .map((item) => item.replace(/\s*\(.*?\)\s*$/, "").trim())
    .filter((item) => item && !/多源|固定欄位|授權需求|備註/.test(item));
};

const inferCollageParams = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): Record<string, unknown> => {
  const text = textBlob(currentCase);
  const cleanup = parseCleanupTargets(currentCase?.cleanupChecklist);
  const params = paramsObject(helperHints);
  const caseScopeContract = inferCaseScope(currentCase, helperHints).caseScopeContract;
  const allZeroFieldInspection = isAllZeroFieldInspectionCase(currentCase, helperHints);
  const expectedSourcesParam = stringArrayParam(params, "expectedSources");
  const expectedTotalFieldCountParam = numberParam(params, ["expectedTotalFieldCount", "totalFieldCount"]);
  const selectAllFields =
    allZeroFieldInspection ||
    booleanishParam(params, ["selectAllFields", "selectAll", "selectAllMetrics"]) ||
    booleanishParam(params, ["selectAllFieldsInSourceReport", "selectAllSourceFields"]) ||
    (
      /全選|所有欄位|72\s*欄/.test(text) &&
      (expectedSourcesParam.length > 0 || expectedTotalFieldCountParam !== null || helperRequestsDownload(params))
    );
  const dateVariantLabels = firstStringArrayParam(params, ["dateVariants", "uiLabels"]);
  const rawDateVariants = rawArrayParam(params, "dateVariants");
  const needsDefaultSingleMetric = caseNeedsDefaultSingleMetric(text, cleanup, params, caseScopeContract);
  const field = selectAllFields
    ? null
    : nonNeutral(stringParam(params, ["field", "metric", "metricField"])) ??
      cleanupMetricFieldTarget(cleanup["欄位"]) ??
      cleanupMetricFieldTarget(firstMatch(text, [/欄位[「=：: ]+([^」\n,，;；]+)/])) ??
      (needsDefaultSingleMetric ? DEFAULT_COLLAGE_METRIC_FIELD : null) ??
      (caseScopeContract?.routeIntent === "download_execution" ? DEFAULT_COLLAGE_METRIC_FIELD : null);
  const fields = splitCompositeMetricFields(field);
  const reportNamePattern = inferReportNamePattern(text, params);
  const modifiesExistingReport =
    !helperRequestsSaveOnly(params) &&
    (
      booleanishParam(params, ["openExistingReport", "modifyExistingReport", "overwriteExisting"]) ||
      /修改既有|既有報表.{0,20}(?:修改|覆寫|覆盖)|已儲存報表.{0,20}(?:修改|覆寫|覆盖)|儲存覆寫|覆寫|覆盖/.test(text)
    );
  const existingReportNamePattern = inferExistingReportNamePattern(text, params, reportNamePattern);
  const existingReportSelectionMode = inferExistingReportSelectionMode(text, params);
  const dateRangeText =
    cleanDateRangeText(stringParam(params, ["dateRange", "timeRange"])) ??
    cleanDateRangeText(dateObjectParam(params.dateRange)) ??
    cleanDateRangeText(structuredStaticDateRangeParam(params)) ??
    (dateVariantLabels.length === 1 ? cleanDateRangeText(dateVariantLabels[0]) : null) ??
    cleanDateRangeText(cleanup["時間"]) ??
    firstMatch(text, [/(\d{4}\/\d{2}\/\d{2}\s*[~～-]\s*\d{4}\/\d{2}\/\d{2})/]);
  const explicitSourceReportsParam = stringArrayParam(params, "sourceReports");
  const sourceReportsFromText = sourceReportListFromText(text);
  const sourceReportsParam = explicitSourceReportsParam.length > 0
    ? explicitSourceReportsParam
    : expectedSourcesParam.length > 0
      ? expectedSourcesParam
      : sourceReportsFromText.length > 1
        ? sourceReportsFromText
        : [];
  const explicitSource = stringParam(params, ["source", "sourceReport"]);
  const paramReportListDownload = paramsRequestReportListDownload(params);
  const paramEditorSessionDownload = paramsRequestEditorSessionDownload(params);
  const inferredSource = selectAllFields && sourceReportsParam.length > 0
    ? null
    : firstMatch(text, [/來源報表(?:[（(][^)）]+[)）])?[=：: ]*「?([^」\n,， ]+)/]);
  const cleanInferredSource = inferredSource && !/多源/.test(inferredSource) ? inferredSource : null;
  const effectiveSource = explicitSource ??
    cleanInferredSource ??
    (sourceReportsFromText.length === 1 ? sourceReportsFromText[0] : null) ??
    (needsDefaultSingleMetric ? DEFAULT_COLLAGE_SOURCE_REPORT : null) ??
    (caseScopeContract?.routeIntent === "download_execution" ? DEFAULT_COLLAGE_SOURCE_REPORT : null);
  const sourceReports = sourceReportsParam.length > 0
    ? sourceReportsParam
    : allZeroFieldInspection && effectiveSource
      ? [effectiveSource]
      : sourceReportsParam;

  return {
    ...params,
    devUrl: stringParam(params, ["devUrl"]) ?? null,
    projectName: stringParam(params, ["projectName", "project"]) ?? firstMatch(text, [/(拼貼test[_\d]+)/i]),
    source: effectiveSource,
    referenceCsv: stringParam(params, ["referenceCsv"]) ?? "rules/BI_DATA/metadata.csv",
    referenceSourcePath: stringParam(params, ["referenceSourcePath"]) ?? null,
    referenceSourceName: stringParam(params, ["referenceSourceName"]) ?? firstMatch(text, [/原始指定檔名[=：: ]+`?([^`\n;]+)/, /source filename[=：: ]+`?([^`\n;]+)/i]),
    referenceIndexKey: stringParam(params, ["referenceIndexKey"]) ?? firstMatch(text, [/reference-index key[=：: ]+`?([^`\n;]+)/i, /reference_index_key[=：: ]+`?([^`\n;]+)/i]) ?? "bi_metadata_csv",
    matchKey: stringParam(params, ["matchKey"]) ?? "欄位名稱",
    compareFields: rawArrayParam(params, "compareFields") ?? ["欄位名稱", "資料類型"],
    comparisonScope: stringParam(params, ["comparisonScope"]) ?? null,
    downloadScope: stringParam(params, ["downloadScope"]) ??
      (paramReportListDownload && !paramEditorSessionDownload
        ? "report_list"
        : paramEditorSessionDownload
        ? "editor_session"
        : textRequestsReportListDownload(text) && !textRequestsEditorSessionDownload(text)
        ? "report_list"
        : textRequestsEditorSessionDownload(text)
        ? "editor_session"
        : helperRequestsDownload(params) && helperRequestsNoSave(params)
        ? "editor_session"
        : /同\s*editor|editor\s*session|絕不\s*(?:save|儲存|reopen|重開|回專案頁)|不\s*(?:save|儲存|reopen|重開)/i.test(text)
        ? "editor_session"
        : /清單|列表|專案頁|報表列|report list/i.test(text)
          ? "report_list"
          : null),
    allZeroFieldInspection,
    field,
    fields,
    sourceReports,
    sourceReport: stringParam(params, ["sourceReport"]) ?? stringParam(params, ["source"]) ?? effectiveSource,
    expectedReportSources: stringArrayParam(params, "expectedReportSources").length > 0
      ? stringArrayParam(params, "expectedReportSources")
      : expectedSourcesParam,
    expectedReportSourceCount: numberParam(params, ["expectedReportSourceCount"]),
    expectedTotalFieldCount: expectedTotalFieldCountParam,
    selectAllFields,
    selectAllFieldsInSourceReport: booleanishParam(params, ["selectAllFieldsInSourceReport", "selectAllSourceFields"]),
    expectedFieldCount: numberParam(params, ["expectedFieldCount", "fieldCount", "expectedFieldsCount"]) ??
      (selectAllFields && sourceReports.length > 1 ? expectedTotalFieldCountParam : null),
    dateVariants: rawDateVariants ?? dateVariantLabels,
    dateRange: dateRangeText,
    display: nonNeutral(stringParam(params, ["display", "displayMode"])) ?? nonNeutral(cleanup["顯示"]) ?? null,
    skipSave: helperRequestsNoSave(params) || textExplicitlyDisablesSave(text),
    skipReopen: helperRequestsNoReopen(params) || helperRequestsSaveOnly(params) || textExplicitlyDisablesReopen(text),
    skipDownload: caseScopeContract?.routeIntent === "download_execution"
      ? false
      : helperRequestsNoDownload(params) || helperRequestsSaveOnly(params) || textExplicitlyDisablesDownload(text),
    cleanupChecklist: currentCase?.cleanupChecklist ?? null,
    cleanupTargets: cleanup,
    reportNamePattern,
    existingReportNamePattern,
    existingReportSelectionMode,
    existingReportSourceCaseNo: stringParam(params, ["existingReportSourceCaseNo", "existingReportSourceCase"]) ?? null,
    openExistingReport: modifiesExistingReport,
    overwriteExisting: modifiesExistingReport
  };
};

const canRunDatePreviewEvidenceHelper = (params: Record<string, unknown>, currentCase: CaseManifestCase | null): boolean => {
  const dateVariants = stringArrayParam(params, "dateVariants");
  const dateMode = String(params.dateMode ?? "").trim().toLowerCase();
  const dateRange = typeof params.dateRange === "string" ? params.dateRange.trim() : "";
  const dateEndpointTokens = [...dateRange.matchAll(/\d{4}[/-]\d{1,2}[/-]\d{1,2}|(?:\d+\s*天\s*(?:前|後))|今天|今日|昨日|昨天|明日|明天/g)]
    .map((match) => match[0]);
  const hasHybridDateRangeText =
    dateEndpointTokens.length >= 2 &&
    dateEndpointTokens.some((item) => /天\s*(?:前|後)|今天|今日|昨日|昨天|明日|明天/.test(item));
  if (dateVariants.length > 0 && (!dateMode || dateMode === "preset")) return true;
  if (hasStructuredDateVariantSpecs(params)) return true;
  if (
    (dateMode === "relative" || dateMode === "hybrid") &&
    (typeof params.startOffsetDays === "number" || typeof params.endOffsetDays === "number" || params.start || params.end)
  ) {
    return true;
  }
  if (dateMode === "static" && dateRange) return true;
  if (hasHybridDateRangeText) return true;
  if (/^(?:昨日|今日|上週|本週|上月|本月|過去\s*\d+\s*天|最近\s*\d+\s*天)$/.test(dateRange)) return true;
  if ((dateRange.match(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/g) ?? []).length >= 2) return true;
  if (dateObjectParam(params.dateRange)) return true;
  if (structuredStaticDateRangeParam(params)) return true;
  return /operationTemplate[：:]\s*collage_date_variants_preview/.test(textBlob(currentCase));
};

const previewExecutionPrefersDatePreviewEvidenceHelper = (params: Record<string, unknown>): boolean => {
  const dateMode = String(params.dateMode ?? "").trim().toLowerCase();
  if (dateMode === "relative" || dateMode === "hybrid") return true;
  if (hasStructuredDateVariantSpecs(params)) return true;
  const dateVariants = stringArrayParam(params, "dateVariants");
  if (dateVariants.length > 1) return true;
  const dateRange = typeof params.dateRange === "string" ? params.dateRange.trim() : "";
  const dateEndpointTokens = [...dateRange.matchAll(/\d{4}[/-]\d{1,2}[/-]\d{1,2}|(?:\d+\s*天\s*(?:前|後))|今天|今日|昨日|昨天|明日|明天/g)]
    .map((match) => match[0]);
  return dateEndpointTokens.length >= 2 &&
    dateEndpointTokens.some((item) => /天\s*(?:前|後)|今天|今日|昨日|昨天|明日|明天/.test(item));
};

const hasFormulaParams = (params: Record<string, unknown>): boolean =>
  typeof params.formula === "string" && params.formula.trim().length > 0;

const isCreateProjectFlow = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  const operationTemplate = helperHints?.operationTemplate ?? "";
  const text = textBlob(currentCase);
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
  const text = textBlob(currentCase);
  if (/^(?:collage[._-])?create[-_]?project$/i.test(operationTemplate) && /只測新增專案|不進入(?:新建)?報表|只測.*專案/i.test(text)) {
    return true;
  }
  return !/新增報表|報表設定|欄位|時間區間|preview|預覽|執行|儲存報表|儲存|下載|CSV|reopen|重開|返回/.test(text);
};

const isSameCaseSaveLoadFlow = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  const operationTemplate = helperHints?.operationTemplate ?? "";
  const params = paramsObject(helperHints);
  const text = `${textBlob(currentCase)}\n${helperScope(params) ?? ""}`;
  return /save_load_flow/i.test(operationTemplate) && (
    booleanishParam(params, ["reopenViaClickReportName"]) ||
    Boolean(stringParam(params, ["saveReportNamePrefix", "reportNamePrefix"])) ||
    /同\s*case|同一\s*case|建立.{0,12}儲存.{0,24}(?:reopen|重開|點報表名稱)|不依賴既有報表|depend_on_existing_report/i.test(text)
  );
};

const isOpenReportFromProjectListFlow = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  const params = paramsObject(helperHints);
  const text = `${textBlob(currentCase)}\n${stringParam(params, ["action", "verifyOnly"]) ?? ""}`;
  if (helperRequestsSaveOnly(params)) return false;
  if (isSameCaseSaveLoadFlow(currentCase, helperHints)) return false;
  if (
    (booleanishParam(params, ["reopenViaClickReportName", "reopenReport", "doReopen"]) || Boolean(stringParam(params, ["saveReportNamePrefix", "reportNamePrefix", "reportNamePattern"]))) &&
    /同\s*case|同一\s*case|建立.{0,20}儲存|儲存.{0,24}(?:reopen|重開|點報表名稱)|設定還原|不依賴既有報表|depend_on_existing_report/i.test(text)
  ) {
    return false;
  }
  if (textRequestsSameCaseSaveAndRowDownload(text)) return false;
  if (textExplicitlyDisablesReopen(text) && textRequestsReportListDownload(text)) return false;
  return /報表名稱.{0,24}(?:進入|編輯|reopen|重開|載入|設定頁|editor)|點(?:擊)?.{0,16}報表名稱.{0,24}(?:進入|編輯|reopen|重開|載入|設定頁|editor)|click\s+report\s+name(?:.{0,24}(?:open|enter|edit|editor|reopen))?|enter\s+editor/i.test(text);
};

const isBackToProjectListFlow = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): boolean => {
  const params = paramsObject(helperHints);
  const text = `${textBlob(currentCase)}\n${stringParam(params, ["action", "verifyOnly"]) ?? ""}`;
  if (helperRequestsSaveOnly(params)) return false;
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
  caseScopeActions: [],
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
  const caseScope = inferCaseScope(currentCase, helperHints);
  const caseScopeContract = caseScope.caseScopeContract;
  const contractRequiresDownload = caseScopeContract?.routeIntent === "download_execution";
  if (missingActionTemplateBlocker(caseScope)) return [];
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
  const deleteReportFlow = isDeleteReportFlow(currentCase, helperHints) && caseScopeContract?.routeIntent !== "frontend_observation";
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
  if (caseScopeContract?.routeIntent !== "report_mutation_flow" && isOpenReportFromProjectListFlow(currentCase, helperHints)) {
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
  if (isProjectToolbarBatchDownloadCase(currentCase, params)) {
    const batchDownloadParams = {
      ...params,
      downloadScope: "project_toolbar_batch",
      projectToolbarSelectionCount: numberParam(params, ["projectToolbarSelectionCount", "selectionCount", "selectedRowCount"]) ?? 2,
      skipSave: true,
      skipReopen: true,
      skipDownload: false
    };
    return [
      action("H1", "collage.openProject", "開啟指定拼貼專案", batchDownloadParams, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"],
        notes: ["專案頁批次下載題只定位報表清單，不進新增報表 editor。"]
      }),
      action("H2", "collage.downloadCsvAndComparePreview", "勾選多筆報表後從專案頁 toolbar 觸發批次下載", batchDownloadParams, {
        requiredEvidence: ["downloaded.csv", "projectToolbar.selectionFlow.state", "download.toast.state", "screenshot"],
        screenshotPolicy: "required_if_possible",
        notes: [
          "本題驗證 project toolbar batch download route；不可退回列內 row download。",
          "helper 必須先透過 visible UI 勾選報表列，再點 toolbar download 控制。"
        ]
      })
    ];
  }
  if (isProjectRowDownloadOnlyCase(currentCase, params)) {
    const rowDownloadParams = {
      ...params,
      downloadScope: "report_list",
      allowAnyReportListRowDownload: true,
      skipSave: true,
      skipReopen: true,
      skipDownload: false
    };
    return [
      action("H1", "collage.openProject", "開啟指定拼貼專案", rowDownloadParams, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"],
        notes: ["專案頁列內下載題只定位報表清單，不進新增報表 editor。"]
      }),
      action("H2", "collage.downloadCsvAndComparePreview", "從專案頁第一個可下載報表 row 觸發下載", rowDownloadParams, {
        requiredEvidence: ["downloaded.csv", "projectList.reportRow.state", "download.toast.state", "screenshot"],
        screenshotPolicy: "required_if_possible",
        notes: [
          "本題只驗證 row 下載控制可觸發下載並取得檔案，不做 preview/CSV 內容比對。",
          "若 testcase 未指定 savedReportName，helper 可選第一個可見且有下載控制的報表 row。"
        ]
      })
    ];
  }
  const frontendObservationPrelude = isFrontendObservationPreludeCase(currentCase, helperHints);
  const scopeFrontendObservationPrelude =
    caseScopeContract && caseScopeContract.routeIntent !== "frontend_observation"
      ? { matched: false, needsEditor: false }
      :
    caseScope.testIntent === "frontend_observation" &&
    !caseScope.previewRequired &&
    !caseScope.executionRequired &&
    !hasExplicitHelperTemplate(helperHints) &&
    /^BIUI_COLLAGE_R001-(?:I|J|K|L|M|N)-/i.test(currentCase.caseNo)
      ? { matched: true, needsEditor: caseScopeContract ? caseScopeContract.requiresEditor : needsReportEditorPrelude(currentCase) }
      : frontendObservationPrelude;
  if (scopeFrontendObservationPrelude.matched) {
    const observationType = caseScopeContract
      ? fallbackObservationType(caseScopeContract.observationType)
      : inferFrontendObservationType(currentCase);
    const structuredEvidence = structuredEvidenceList(caseScopeContract);
    const actions: HelperPlanAction[] = [
      action("H1", "collage.openProject", "開啟指定拼貼專案（前端觀察題前置導航）", params, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"],
        notes: [
          "前端觀察 / 專案頁 / 側欄 / list 類 case 僅允許安全前置導航。",
          "不可自動進入 generic configureMetric/runPreview；case-specific UI assertion 必須由 Codex 或後續專用 helper 完成。"
        ]
      })
    ];
    if (scopeFrontendObservationPrelude.needsEditor) {
      actions.push(
        action("H2", "collage.createReport", "進入新增報表頁（前端觀察題前置導航）", params, {
          requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"],
          notes: [
            "只到達 editor 初始狀態，不選欄位、不設定日期、不按計算。",
            "K/L/M/N 類 editor UI assertion 需要專用 helper template 或 Codex visible UI 接手。"
          ]
        })
      );
    }
    if (observationType) {
      actions.push(
        action(`H${actions.length + 1}`, "collage.observeFrontendState", "收集前端觀察狀態 evidence", {
          ...params,
          observationType,
          ...(caseScopeContract
            ? {
                caseScopeContract,
                targetObjectIds: [...new Set(caseScopeContract.requiredActions.map((item) => item.target))],
                expectedOutcomes: [...new Set(caseScopeContract.requiredActions.map((item) => item.expectedOutcome))]
              }
            : {})
        }, {
          mutatesUi: !["userButton", "projectToolbar", "reportModeRadio"].includes(observationType),
          requiredEvidence: structuredEvidence.length > 0 ? structuredEvidence : observationRequiredEvidence(observationType),
          screenshotPolicy: "required_if_possible",
          notes: [
            "只收集 observation evidence，不判 PASS/FAIL。",
            "本 action 帶有 caseScopeContract 的 action/target/role/expectedOutcome，Codex 判定時必須用同一份結構化 scope。",
            "若 observationType 需要點擊，僅允許 visible UI click；不可用 evaluate 觸發互動。",
            "Codex 必須用 helper evidence 與 testcase scope 自行判定。"
          ]
        })
      );
    }
    return actions;
  }

  if (caseScopeContract?.routeIntent === "preview_execution") {
    const structuredParams = paramsForStructuredContract(params, caseScopeContract);
    const structuredDateVariants = structuredDateVariantLabels(caseScopeContract);
    const useDatePreviewEvidenceHelper =
      structuredDateVariants.length > 1 ||
      previewExecutionPrefersDatePreviewEvidenceHelper(structuredParams);
    const structuredActions: HelperPlanAction[] = [
      action("H1", "collage.openProject", "開啟指定拼貼專案", structuredParams, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"],
        notes: ["structured preview_execution 前置導航；不判斷 testcase 結果。"]
      }),
      action("H2", "collage.createReport", "進入新增報表頁", structuredParams, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"]
      })
    ];
    if (useDatePreviewEvidenceHelper) {
      structuredActions.push(
        action("H3", "collage.runDateVariantsPreviewEvidence", "依 structured date variants 逐輪設定日期並收集 preview evidence", structuredParams, {
          requiredEvidence: ["dom.state", "date.uiState", "date.representedRange", "network.requestBody", "chart.datasets", "screenshot"],
          screenshotPolicy: "required_if_possible",
          notes: [
            "dateRange under_test 需由同一 helper 透過 visible UI 設定並按計算；不可只取既有預設 preview。",
            "dateVariants 由 caseScopeContract target 或 structured/hybrid dateRange 推導，不使用 legacy composite cleanup dateRange。"
          ]
        })
      );
    } else {
      structuredActions.push(
        action("H3", "collage.configureMetric", "設定來源、欄位、日期與顯示", structuredParams, {
          requiredEvidence: ["dom.state", "state.delta", "date.uiState", "date.representedRange", "screenshot"]
        }),
        action("H4", "collage.runPreviewAndCollectEvidence", "執行 preview 並收集 evidence", structuredParams, {
          requiredEvidence: ["network.requestBody", "network.responseBody", "chart.datasets", "dom.previewState", "screenshot"],
          screenshotPolicy: "required_if_possible"
        })
      );
    }
    return structuredActions;
  }

  if (caseScopeContract?.routeIntent === "download_execution") {
    const structuredParams = paramsForStructuredContract(params, caseScopeContract);
    return [
      action("H1", "collage.openProject", "開啟指定拼貼專案", structuredParams, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"],
        notes: ["structured download_execution 前置導航；不判斷 testcase 結果。"]
      }),
      action("H2", "collage.createReport", "進入新增報表頁", structuredParams, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"]
      }),
      action("H3", "collage.configureMetric", "建立有效 preview 前置設定", structuredParams, {
        requiredEvidence: ["dom.state", "state.delta", "date.uiState", "date.representedRange", "screenshot"],
        notes: ["若 testcase cleanup 寫的是欄位數量，例如 1欄，不可當作 metric field label。"]
      }),
      action("H4", "collage.runPreviewAndCollectEvidence", "執行 preview 並收集 evidence", structuredParams, {
        requiredEvidence: ["network.requestBody", "network.responseBody", "chart.datasets", "dom.previewState", "screenshot"],
        screenshotPolicy: "required_if_possible"
      }),
      action("H5", "collage.downloadCsvAndComparePreview", "點擊下載並收集 download/toast evidence", structuredParams, {
        requiredEvidence: ["downloaded.csv", "download.toast.state", "screenshot"],
        screenshotPolicy: "required_if_possible",
        notes: [
          "download_execution 代表 UI 下載與 toast 是測試標的；不測 CSV 內容比對不得 suppress download。",
          "若 caseScopeContract 不要求 csv-preview comparison，helper 只需保留下載 artifact/toast evidence。"
        ]
      })
    ];
  }

  if (caseScopeContract?.routeIntent === "report_mutation_flow") {
    const structuredParams = paramsForStructuredContract(params, caseScopeContract);
    const observationType = fallbackObservationType(caseScopeContract.observationType);
    const openProjectAction = action("H1", "collage.openProject", "開啟指定拼貼專案", structuredParams, {
      requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"],
      notes: ["structured report_mutation_flow 前置導航；不判斷 testcase 結果。"]
    });
    const observeParams = observationType
      ? {
          ...structuredParams,
          observationType,
          caseScopeContract,
          targetObjectIds: [...new Set(caseScopeContract.requiredActions.map((item) => item.target))],
          expectedOutcomes: [...new Set(caseScopeContract.requiredActions.map((item) => item.expectedOutcome))]
        }
      : structuredParams;
    if (/M-0[3456]$/i.test(caseScopeContract.caseNo)) {
      return [
        openProjectAction,
        action("H2", "collage.createReport", "進入新增報表頁", structuredParams, {
          requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"]
        }),
        action("H3", "collage.configureMetric", "建立有效 preview 前置設定", structuredParams, {
          requiredEvidence: ["dom.state", "state.delta", "date.uiState", "date.representedRange", "screenshot"],
          notes: ["M-06 驗證儲存 modal 取消流程；開 modal 前必須先讓儲存按鈕進入可點狀態。"]
        }),
        action("H4", "collage.runPreviewAndCollectEvidence", "執行 preview 讓儲存流程可用", structuredParams, {
          requiredEvidence: ["network.requestBody", "network.responseBody", "chart.datasets", "dom.previewState", "screenshot"],
          screenshotPolicy: "required_if_possible"
        }),
        action("H5", "collage.observeFrontendState", "收集儲存 modal 取消 evidence", observeParams, {
          mutatesUi: true,
          requiredEvidence: structuredEvidenceList(caseScopeContract),
          screenshotPolicy: "required_if_possible",
          notes: [
            "本 action 只開啟儲存 modal、輸入/讀取本 case 指定 modal 狀態、按取消並驗證未建立報表。",
            "不點 modal 儲存，不接受 native dialog；Codex 仍依 case scope 判斷。"
          ]
        })
      ];
    }
    if (/M-09$/i.test(caseScopeContract.caseNo)) {
      return [
        openProjectAction,
        action("H2", "collage.openReportFromProjectList", "開啟既有報表進入設定頁", structuredParams, {
          requiredEvidence: ["dom.state", "screenshot"],
          screenshotPolicy: "required_if_possible"
        }),
        action("H3", "collage.observeFrontendState", "收集複製副本 modal 取消 evidence", observeParams, {
          mutatesUi: true,
          requiredEvidence: structuredEvidenceList(caseScopeContract),
          screenshotPolicy: "required_if_possible",
          notes: [
            "本 action 只開啟複製副本 modal、讀取預設值/提示、按取消並驗證未建立副本。",
            "不點 modal 儲存；Codex 仍依 case scope 判斷。"
          ]
        })
      ];
    }
    if (/F-02$/i.test(caseScopeContract.caseNo) || /M-07$/i.test(caseScopeContract.caseNo)) {
      const needsReopen = /F-02$/i.test(caseScopeContract.caseNo);
      const flowActions: HelperPlanAction[] = [
        openProjectAction,
        action("H2", "collage.createReport", "進入新增報表頁", structuredParams, {
          requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"]
        }),
        action("H3", "collage.configureMetric", "設定有效欄位、日期與顯示", structuredParams, {
          requiredEvidence: ["dom.state", "state.delta", "date.uiState", "date.representedRange", "screenshot"],
          notes: [
            "structured report lifecycle flow 必須建立有效 preview 前置條件。",
            "若 testcase checklist 寫欄位=1欄，這是數量要求，不可當成欄位名稱；使用 domain default 每日報表/新增帳號數。"
          ]
        }),
        action("H4", "collage.runPreviewAndCollectEvidence", "執行 preview 並收集 evidence", structuredParams, {
          requiredEvidence: ["network.requestBody", "network.responseBody", "chart.datasets", "dom.previewState", "screenshot"],
          screenshotPolicy: "required_if_possible"
        }),
        action("H5", "collage.saveReport", needsReopen ? "儲存同 case 臨時報表供 reopen 驗證" : "儲存同 case 臨時報表並驗證清單 row", structuredParams, {
          requiresToolBridge: true,
          requiredEvidence: ["toolBridge.response", ...structuredEvidenceList(caseScopeContract), "screenshot"],
          screenshotPolicy: "required_if_possible",
          notes: [
            "helper 必須透過 visible UI 開啟儲存 modal、輸入本 case 臨時報表名稱並儲存。",
            "儲存後必須 best-effort 返回/定位專案清單，輸出 projectList.readiness.state / projectList.reportRow.state evidence。"
          ]
        })
      ];
      if (needsReopen) {
        flowActions.push(
          action("H6", "collage.reopenReport", "從清單重開剛儲存的報表並收集還原 evidence", structuredParams, {
            requiredEvidence: ["dom.state", "network.requestBody", "projectList.reportRow.state", "reportPersistence.reopenState", "screenshot"],
            screenshotPolicy: "required_if_possible",
            notes: ["F-02 必須用同 case saved report row/name 重開，不依賴既有報表。"]
          })
        );
      }
      return flowActions;
    }
    if (/M-10$/i.test(caseScopeContract.caseNo)) {
      return [
        openProjectAction,
        action("H2", "collage.openReportFromProjectList", "開啟既有報表進入設定頁", structuredParams, {
          requiredEvidence: ["dom.state", "screenshot"],
          screenshotPolicy: "required_if_possible"
        }),
        action("H3", "collage.copyReportAndVerify", "複製副本、改名儲存並驗證清單新報表", structuredParams, {
          requiresToolBridge: true,
          requiredEvidence: ["toolBridge.response", ...structuredEvidenceList(caseScopeContract), "screenshot"],
          screenshotPolicy: "required_if_possible",
          notes: [
            "單一授權只允許本 current case 複製既有報表並以本 case 臨時名稱儲存。",
            "helper 必須透過 visible UI 點複製副本、改名、點儲存；未知 native dialog 必須 blocked。"
          ]
        })
      ];
    }
    if (/M-11$/i.test(caseScopeContract.caseNo)) {
      return [
        openProjectAction,
        action("H2", "collage.openReportFromProjectList", "開啟既有報表進入設定頁", structuredParams, {
          requiredEvidence: ["dom.state", "screenshot"],
          screenshotPolicy: "required_if_possible"
        }),
        action("H3", "collage.updateExistingReportAndReopen", "修改設定、更新設定並重開驗證還原", structuredParams, {
          requiresToolBridge: true,
          requiredEvidence: ["toolBridge.response", ...structuredEvidenceList(caseScopeContract), "screenshot"],
          screenshotPolicy: "required_if_possible",
          notes: [
            "單一授權只允許本 current case 修改既有報表設定並點更新設定。",
            "helper 必須留下 before/after setting、更新成功訊號、返回清單與重開後設定 evidence；Codex 仍依 case scope 判斷。"
          ]
        })
      ];
    }
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
          "若 case 是驗證運算欄位公式 wiring/calculation，分母欄位在本資料池全為 0 不等於 evidence 不足；只要 UI/request formula 存在且 preview 運算結果符合 BI divide-by-zero=0 行為，可依 testcase 判 PASS。",
          "若公式 modal 無可見可輸入欄位、關不掉或攔截後續點擊，helper 必須 blocked 並留下 modal DOM profile。"
        ]
      })
    ];
  }
  const datePreviewTemplateRequested = operationTemplate === "collage_date_variants_preview";
  const datePreviewCsvFlowRequested =
    /下載|CSV/i.test(text) &&
    canRunDatePreviewEvidenceHelper(params, currentCase) &&
    (paramsRequestEditorSessionDownload(params) || paramsRequestReportListDownload(params) || textRequestsEditorSessionDownload(text) || textRequestsReportListDownload(text) || datePreviewTemplateRequested);
  const helperMustLeaveCoreToCodex =
    helperHintsRequestManualAi(helperHints) ||
    datePreviewTemplateRequested ||
    datePreviewCsvFlowRequested ||
    dateRequiresCodexVisibleUi(currentCase, helperHints);
  if (helperMustLeaveCoreToCodex) {
    if (!needsCollageNavigationPrelude(currentCase, helperHints)) return [];
    const operationalText = [
      currentCase.caseTitle,
      currentCase.preconditions,
      currentCase.stepsSummary,
      helperScope(helperParams)
    ].filter(Boolean).join("\n");
    const editorPreludeNeeded =
      needsReportEditorPrelude(currentCase) ||
      (
        canRunDatePreviewEvidenceHelper(params, currentCase) &&
        (
          textRequestsSave(operationalText, { ...params, ...helperParams }) ||
          /載入已儲存|設定還原|建立.{0,20}儲存|儲存.{0,24}(?:reopen|重開|點報表名稱)|reopen/i.test(operationalText)
        )
      );
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
      textRequestsSave(operationalText, { ...params, ...helperParams }) &&
      !helperRequestsNoSave({ ...params, ...helperParams }) &&
      !textExplicitlyDisablesSave(operationalText) &&
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
    const explicitManualDateReopen =
      booleanishParam(helperParams, ["reopenViaClickReportName", "reopenReport", "doReopen"]);
    const manualDateReportListDownload =
      paramsRequestReportListDownload({ ...params, ...helperParams }) ||
      textRequestsReportListDownload(operationalText);
    const manualDateNeedsReopen =
      manualDateSave &&
      !helperRequestsNoReopen({ ...params, ...helperParams }) &&
      !textExplicitlyDisablesReopen(text) &&
      (
        explicitManualDateReopen ||
        (!manualDateReportListDownload && /載入已儲存|設定還原|還原|重開|重新檢視|reopen|點報表名稱/i.test(operationalText))
      );
    if (manualDateNeedsReopen) {
      prelude.push(
        action(`H${prelude.length + 1}`, "collage.reopenReport", "儲存後從清單重開報表並收集還原 evidence", params, {
          requiredEvidence: ["dom.state", "network.requestBody", "screenshot"],
          screenshotPolicy: "required_if_possible",
          notes: [
            "適用 F-02 類同 case 建立後載入已儲存報表：必須在 saveReport 後用本 case saved report row/name 重開。",
            "helper 只產生 reopen-report-evidence；Codex 必須比對日期/欄位/顯示狀態是否還原。"
          ]
        })
      );
    }
    const manualDateCsvDownload =
      /下載|CSV/i.test(operationalText) &&
      !helperExplicitlyDisablesDownload(helperParams) &&
      !helperRequestsSaveOnly({ ...params, ...helperParams }) &&
      !textExplicitlyDisablesDownload(operationalText) &&
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
  const modifiesExistingReport = params.openExistingReport === true && !helperRequestsSaveOnly({ ...params, ...helperParams });
  const noSave = helperRequestsNoSave({ ...params, ...helperParams });
  const noDownload =
    helperRequestsSaveOnly({ ...params, ...helperParams }) ||
    textExplicitlyDisablesDownload(text) ||
    (helperRequestsNoDownload({ ...params, ...helperParams }) &&
      !(/下載|CSV/i.test(text) && !helperExplicitlyDisablesDownload({ ...params, ...helperParams })));
  const explicitlyNoReopen =
    helperRequestsNoReopen({ ...params, ...helperParams }) ||
    helperRequestsSaveOnly({ ...params, ...helperParams }) ||
    textExplicitlyDisablesReopen(text) ||
    /不(?:需|要|應)?重開|不要重開|無需重開|不用重開|不重開\s*editor|不應產生\s*reopen/i.test(text);
  const needsReopen =
    !explicitlyNoReopen &&
    (booleanishParam(helperParams, ["reopenViaClickReportName"]) || /重開|重新檢視|還原|載入|reopen|點報表名稱/i.test(text));
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

    if (!noSave && (textRequestsSave(text, { ...params, ...helperParams }) || /覆寫/.test(text))) {
      actions.push(
        action(`H${actions.length + 1}`, "collage.saveReport", modifiesExistingReport ? "覆寫既有報表" : "儲存本輪臨時報表", params, {
          requiresToolBridge: true,
          requiredEvidence: ["toolBridge.response", "dom.state", "reportListEvidence", "screenshot"],
          screenshotPolicy: "required_if_possible",
          notes: [
            "Agent 模式需先取得 Tool Bridge response；非 SSO/login request 由 Mac Agent 自動回覆；helper 只可處理已知 BI save/overwrite dialog；未知 native dialog 若沒有實際 recovery handler 必須 blocked 並留下 evidence。",
            "helper 儲存後必須 best-effort 返回/定位報表清單並輸出 `reportListEvidence`：saved report row found 狀態、row text、readiness attempts 與 recovery actions。"
          ]
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

    if (!noDownload && (contractRequiresDownload || /下載|CSV/i.test(text))) {
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

const attachCaseScopeActions = (
  actions: HelperPlanAction[],
  contract: StructuredCaseScopeContract | null
): HelperPlanAction[] =>
  actions.map((item) => {
    const caseScopeActions = actionsForTemplate(contract, item.template);
    if (caseScopeActions.length === 0) return item;
    return {
      ...item,
      caseScopeActions,
      requiredEvidence: [...new Set([...item.requiredEvidence, ...caseScopeActions.flatMap((actionItem) => actionItem.evidenceRequirements)])],
      params: {
        ...item.params,
        caseScopeActions,
        caseScopeContract: contract
      }
    };
  });

export const helperExecutorPath = (): string => {
  const runtimeDir = path.basename(__dirname) === "src" ? path.resolve(__dirname, "../dist") : __dirname;
  return path.join(runtimeDir, "bi-ui-helper-executor.js");
};

export const buildHelperExecutionPlan = ({ runDir, currentCase, helperHints }: WriteHelperExecutionPlanOptions): HelperExecutionPlan => {
  const caseId = currentCase?.caseNo ?? helperHints?.caseId ?? null;
  const artifactRoot = path.join(runDir, "output", "helper-artifacts", caseId ?? "unknown-case");
  const caseScopeContract = inferCaseScope(currentCase, helperHints).caseScopeContract;
  const actions = attachCaseScopeActions(buildActions(currentCase, helperHints), caseScopeContract);
  const availableTemplates = attachCaseScopeActions(buildAvailableTemplates(currentCase, helperHints), caseScopeContract);
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
    caseScopeContract,
    actions,
    availableTemplates
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
      "- 若本計畫含 caseScopeContract / caseScopeActions，Codex 必須用其中的 action、target、role、expectedOutcome 與 evidenceRequirements 判斷，不可只靠中文 prose 推測。",
      "",
      "## Case Scope Contract",
      "",
      plan.caseScopeContract
        ? `- source: ${plan.caseScopeContract.source}\n- routeIntent: ${plan.caseScopeContract.routeIntent}\n- testTarget: ${plan.caseScopeContract.testTarget}\n- observationType: ${plan.caseScopeContract.observationType ?? "none"}\n- targets: ${[...new Set(plan.caseScopeContract.requiredActions.map((item) => item.target))].join(", ")}`
        : "(no structured case scope contract available for this case)",
      "",
      "## Planned Actions",
      "",
      plan.actions.length > 0
        ? plan.actions
            .map(
              (item) =>
                `### ${item.id}. ${item.template}\n\n- title: ${item.title}\n- requiresToolBridge: ${item.requiresToolBridge}\n- optional: ${item.optional}\n- requiredEvidence: ${item.requiredEvidence.join(", ")}\n- caseScopeActions: ${item.caseScopeActions.length > 0 ? item.caseScopeActions.map((actionItem) => `${actionItem.action}:${actionItem.target}:${actionItem.expectedOutcome}`).join(", ") : "none"}\n- screenshotPolicy: ${item.screenshotPolicy}\n\n\`\`\`json\n${JSON.stringify(item.params, null, 2)}\n\`\`\`\n`
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
