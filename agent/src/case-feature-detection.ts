import type { CaseManifestCase } from "./case-manifest";
import type { HelperHints } from "./helper-hints";

export type FrontendObservationType =
  | "userButton"
  | "projectToolbar"
  | "sidebarGroup"
  | "rowDownloadTooltip"
  | "rowDeleteTooltip"
  | "reportModeRadio"
  | "metricRowControls"
  | "metricRowAdd"
  | "metricRowDuplicate"
  | "metricRowDelete"
  | "projectLimitToast"
  | "sourceReportPicker"
  | "fieldPicker"
  | "datePanel"
  | "dateRangePresetSwitch"
  | "validationMessage"
  | "editorDownload"
  | "projectCreateModal"
  | "deleteCancelFlow"
  | "saveModalCancel"
  | "copyModalCancel";

export type FrontendObservationContext = "project" | "project_list" | "editor" | "unknown";

export type CaseFeatureDetection = {
  text: string;
  behaviorText: string;
  cleanupTargets: Record<string, string>;
  mode: "collage" | "record" | "metric" | "unknown";
  hasFilter: boolean;
  hasGroup: boolean;
  isMetadataDropdown: boolean;
  isSaveReopenFlow: boolean;
  observationType: FrontendObservationType | null;
  observationContext: FrontendObservationContext;
};

const normalize = (value: unknown): string => String(value ?? "").trim();

export const parseCleanupTargets = (value: string | null | undefined): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const part of normalize(value).split(/[;；]/)) {
    const [key, ...rest] = part.split("=");
    const normalizedKey = key?.trim();
    if (!normalizedKey) continue;
    result[normalizedKey] = rest.join("=").trim();
  }
  return result;
};

export const isNeutralCleanupTarget = (value: string | null | undefined): boolean => {
  const normalized = normalize(value).replace(/\s+/g, "").toLowerCase();
  return !normalized || ["不影響", "不限", "空", "無", "0", "0組", "none", "n/a", "na"].includes(normalized);
};

const cleanupRequiresFeature = (value: string | null | undefined): boolean => !isNeutralCleanupTarget(value);

const fullTextBlob = (item: CaseManifestCase | null, helperHints: HelperHints | null): string =>
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
    item?.validationMethod,
    helperHints?.operationTemplate,
    helperHints?.automationLevel
  ]
    .filter(Boolean)
    .join("\n");

const behaviorTextBlob = (item: CaseManifestCase | null, helperHints: HelperHints | null): string =>
  [
    item?.caseTitle,
    item?.testType,
    item?.testTarget,
    item?.preconditions,
    item?.stepsSummary,
    item?.expected,
    item?.validationMethod,
    helperHints?.operationTemplate,
    helperHints?.automationLevel
  ]
    .filter(Boolean)
    .join("\n");

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

const detectMode = (text: string, operationTemplate: string | null): CaseFeatureDetection["mode"] => {
  const source = `${operationTemplate ?? ""}\n${text}`;
  const constructionMode = source.match(/建構模式\s*[:：]\s*(拼貼|明細(?:檢視)?|指標(?:趨勢)?)/);
  if (constructionMode?.[1]?.includes("拼貼")) return "collage";
  if (constructionMode?.[1]?.includes("明細")) return "record";
  if (constructionMode?.[1]?.includes("指標")) return "metric";

  if (/collage|拼貼模式|我的自訂\s*>\s*拼貼模式|新增報表|儲存報表|重開|重新檢視/.test(source)) return "collage";
  if (/record_static_fields|明細檢視|record[-_ ]?(?:centric|mode|view)|detail[-_ ]?(?:centric|mode|view)/i.test(source)) return "record";
  if (/metric_(?:date|filter|group)|指標趨勢|metric[-_ ]?(?:centric|mode|view)/i.test(source)) return "metric";
  return "unknown";
};

const hasHardDataEvidenceRequirement = (behaviorText: string): boolean =>
  /(?:preview|預覽|request\s*body|response\s*body|network|API|chart|圖表|表格資料|CSV|下載資料|數值|筆數|sum|max|min|資料正確|後端回傳|資料列|逐日資料)/i.test(behaviorText) &&
  !/(?:不觸發|未觸發|不得觸發|不應觸發|沒有觸發).{0,16}(?:preview|request|API|下載|network)|(?:disabled|反灰|不可點|不能點|防呆|toast|tooltip|提示|警示|彈窗)/i.test(behaviorText);

const isFrontendObservationEligible = (
  currentCase: CaseManifestCase | null,
  operationTemplate: string | null,
  behaviorText: string
): boolean => {
  if (operationTemplate === "collage.observeFrontendState") return true;
  const target = `${currentCase?.testTarget ?? ""}\n${currentCase?.testType ?? ""}`;
  const frontendTarget = /前端呈現|功能流程/.test(target);
  if (!frontendTarget) return false;
  if (hasHardDataEvidenceRequirement(behaviorText)) return false;
  return /(?:觀察|確認|檢查|顯示|可見|不可見|disabled|enabled|反灰|不可點|不能點|可點|按鈕|icon|頁籤|tab|下拉|picker|選單|modal|dialog|彈窗|toast|tooltip|防呆|文案|側邊欄|展開|收合|hover|滑過|metricRows|新增列|複製列|刪除列|列數|自訂欄位)/i.test(behaviorText);
};

const detectObservationType = (
  currentCase: CaseManifestCase | null,
  helperHints: HelperHints | null,
  behaviorText: string
): FrontendObservationType | null => {
  const operationTemplate = helperHints?.operationTemplate ?? null;
  if (!isFrontendObservationEligible(currentCase, operationTemplate, behaviorText)) return null;
  const params = paramsObject(helperHints);
  const explicitType = stringParam(params, ["observationType", "frontendObservationType", "uiObservationType"]);
  if (
    explicitType &&
    [
      "userButton",
      "projectToolbar",
      "sidebarGroup",
      "rowDownloadTooltip",
      "rowDeleteTooltip",
      "reportModeRadio",
      "metricRowControls",
      "metricRowAdd",
      "metricRowDuplicate",
      "metricRowDelete",
      "projectLimitToast",
      "sourceReportPicker",
      "fieldPicker",
      "datePanel",
      "dateRangePresetSwitch",
      "validationMessage",
      "editorDownload",
      "projectCreateModal",
      "deleteCancelFlow",
      "saveModalCancel",
      "copyModalCancel"
    ].includes(explicitType)
  ) {
    return explicitType as FrontendObservationType;
  }

  if (/右上.{0,16}(?:使用者|登入者|user)|(?:使用者|登入者).{0,16}(?:名稱|button|按鈕)/i.test(behaviorText)) return "userButton";
  if (/側邊欄|公司共享|我的自訂|展開|收合|sidebar/i.test(behaviorText)) return "sidebarGroup";
  if (/最高\s*5\s*個專案|達(?:到)?最高|專案數上限|project\s*limit/i.test(behaviorText)) return "projectLimitToast";
  if (/新增專案.{0,24}(?:modal|dialog|彈窗|取消|防呆|模式)|(?:modal|dialog|彈窗).{0,24}新增專案/i.test(behaviorText)) return "projectCreateModal";
  if (/建構方式|建構模式\s*radio|拼貼模式.{0,20}(?:radio|選中|disabled|enabled)|精算模式.{0,20}(?:radio|選中|disabled|enabled)|明細檢視.{0,20}(?:radio|選中|disabled|enabled)/i.test(behaviorText)) return "reportModeRadio";
  if (/來源報表.{0,24}(?:下拉|選單|picker|搜尋|請選擇報表)|(?:下拉|選單|picker).{0,24}來源報表/i.test(behaviorText)) return "sourceReportPicker";
  if (/(?:\+\s*)?新增欄位|欄位選擇|field\s*picker|可選欄位/i.test(behaviorText)) return "fieldPicker";
  if (/防呆|錯誤訊息|validation|toast|欄位未設置|未設置完成/i.test(behaviorText)) return "validationMessage";
  if (/日期|時間區間|時間面板|date\s*panel|dateRange|靜態時間|動態時間|上週|本週|昨日|今日|上月|本月/i.test(behaviorText)) {
    return /昨日|今日|上週|本週|上月|本月|過去\s*\d+\s*天|最近\s*\d+\s*天|preset/i.test(behaviorText)
      ? "dateRangePresetSwitch"
      : "datePanel";
  }
  if (/未勾選|勾選|toolbar|工具列|專案頁.{0,32}(?:下載|刪除|新增報表)|(?:下載|刪除|新增報表).{0,32}專案頁/i.test(behaviorText)) return "projectToolbar";
  if (/儲存.{0,18}(?:modal|dialog|彈窗|取消)|(?:modal|dialog|彈窗).{0,18}儲存/i.test(behaviorText)) return "saveModalCancel";
  if (/複製.{0,18}(?:modal|dialog|彈窗|取消)|(?:modal|dialog|彈窗).{0,18}複製/i.test(behaviorText)) return "copyModalCancel";
  if (/刪除.{0,18}(?:modal|dialog|confirm|彈窗|取消)|(?:modal|dialog|confirm|彈窗).{0,18}刪除/i.test(behaviorText)) return "deleteCancelFlow";
  if (/(?:editor|報表設定|新增報表頁|設定頁|右上).{0,28}(?:下載|download)|(?:下載報表|download).{0,24}(?:editor|報表設定|新增報表頁|設定頁|右上)/i.test(behaviorText)) return "editorDownload";
  if (/metricRows|欄位列|自訂欄位|新增列|複製列|刪除列|duplicateRow|addRow|deleteRow/i.test(behaviorText)) {
    if (/複製列|duplicateRow|duplicate\s*row|copy\s*row/i.test(behaviorText)) return "metricRowDuplicate";
    if (/刪除列|deleteRow|delete\s*row|非第一列.{0,16}刪除/i.test(behaviorText)) return "metricRowDelete";
    if (/(?:\+|加|新增).{0,8}列|addRow|add\s*row/i.test(behaviorText)) return "metricRowAdd";
    return "metricRowControls";
  }
  if (/(?:tooltip|hover|滑過).{0,24}(?:下載|download)|(?:下載|download).{0,24}(?:tooltip|hover|滑過|icon)/i.test(behaviorText)) return "rowDownloadTooltip";
  if (/(?:tooltip|hover|滑過).{0,24}(?:刪除|delete|trash|remove)|(?:刪除|delete|trash|remove).{0,24}(?:tooltip|hover|滑過|icon)/i.test(behaviorText)) return "rowDeleteTooltip";
  return null;
};

const detectObservationContext = (
  observationType: FrontendObservationType | null,
  helperHints: HelperHints | null,
  behaviorText: string
): FrontendObservationContext => {
  const params = paramsObject(helperHints);
  const explicitContext = stringParam(params, ["observationContext", "frontendObservationContext", "uiObservationContext"]);
  if (explicitContext && ["project", "project_list", "editor", "unknown"].includes(explicitContext)) {
    return explicitContext as FrontendObservationContext;
  }
  if (!observationType) return "unknown";
  if (["datePanel", "dateRangePresetSwitch", "validationMessage", "editorDownload", "fieldPicker", "saveModalCancel", "copyModalCancel", "reportModeRadio", "metricRowControls", "metricRowAdd", "metricRowDuplicate", "metricRowDelete"].includes(observationType)) {
    return "editor";
  }
  if (["projectToolbar", "sidebarGroup", "projectLimitToast", "projectCreateModal", "rowDownloadTooltip", "rowDeleteTooltip", "deleteCancelFlow"].includes(observationType)) {
    return /清單|列表|報表列|列內|第\s*\d+\s*(?:列|row)|row/i.test(behaviorText) ? "project_list" : "project";
  }
  if (observationType === "sourceReportPicker") return /報表設定|新增報表頁|editor|設定頁/i.test(behaviorText) ? "editor" : "project";
  return "unknown";
};

export const detectCaseFeatures = (
  currentCase: CaseManifestCase | null,
  helperHints: HelperHints | null
): CaseFeatureDetection => {
  const operationTemplate = helperHints?.operationTemplate ?? null;
  const text = fullTextBlob(currentCase, helperHints);
  const behaviorText = behaviorTextBlob(currentCase, helperHints);
  const cleanupTargets = parseCleanupTargets(currentCase?.cleanupChecklist);
  const mode = detectMode(text, operationTemplate);
  const hasFilter =
    cleanupRequiresFeature(cleanupTargets["篩選"]) ||
    /(?:新增|加入|設定|套用|切換|選擇|輸入|移除|清空).{0,30}(?:篩選|filter)/i.test(behaviorText) ||
    /(?:篩選|filter).{0,30}(?:運算子|operator|等於|不等於|包含|不包含|大於|小於|有值|無值|is_null|is_not_null)/i.test(behaviorText);
  const hasGroup =
    cleanupRequiresFeature(cleanupTargets["分組"]) ||
    /(?:新增|加入|設定|套用|切換|選擇|移除|清空).{0,30}(?:分組|分群|group|series)/i.test(behaviorText) ||
    /(?:分組|分群|group|series).{0,30}(?:維度|dimension|欄位|依據)/i.test(behaviorText);
  const isMetadataDropdown =
    operationTemplate === "metadata_dropdown_compare" ||
    /(?:metadata|欄位清單).{0,24}(?:下拉|dropdown|比對|compare)|(?:下拉|dropdown).{0,24}(?:metadata|欄位清單)/i.test(behaviorText);
  const explicitlyNoReopen = /不(?:需|要|應)?重開|不要重開|無需重開|不用重開|不重開\s*editor|不應產生\s*reopen/i.test(behaviorText);
  const isSaveReopenFlow =
    operationTemplate === "collage_build_preview_save_reopen" ||
    (!explicitlyNoReopen && /儲存報表|重開|重新檢視|還原|載入/.test(behaviorText));
  const observationType = detectObservationType(currentCase, helperHints, behaviorText);
  const observationContext = detectObservationContext(observationType, helperHints, behaviorText);

  return {
    text,
    behaviorText,
    cleanupTargets,
    mode,
    hasFilter,
    hasGroup,
    isMetadataDropdown,
    isSaveReopenFlow,
    observationType,
    observationContext
  };
};
