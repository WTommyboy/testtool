import type { CaseManifestCase } from "./case-manifest";
import type { HelperHints } from "./helper-hints";

export type CaseFeatureDetection = {
  text: string;
  behaviorText: string;
  cleanupTargets: Record<string, string>;
  mode: "collage" | "record" | "metric" | "tagTool" | "unknown";
  hasFilter: boolean;
  hasGroup: boolean;
  isMetadataDropdown: boolean;
  isSaveReopenFlow: boolean;
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

const detectMode = (text: string, operationTemplate: string | null): CaseFeatureDetection["mode"] => {
  const source = `${operationTemplate ?? ""}\n${text}`;
  if (
    /^tagTool\./i.test(operationTemplate ?? "") ||
    /^playerTag\./i.test(operationTemplate ?? "") ||
    /TAG_TOOL|玩家標籤管理|標籤變數設定|人工標籤|條件標籤|子標籤級距|標籤值設置|tag\/player|tag\/settings/i.test(source)
  ) {
    return "tagTool";
  }
  const constructionMode = source.match(/建構模式\s*[:：]\s*(拼貼|明細(?:檢視)?|指標(?:趨勢)?)/);
  if (constructionMode?.[1]?.includes("拼貼")) return "collage";
  if (constructionMode?.[1]?.includes("明細")) return "record";
  if (constructionMode?.[1]?.includes("指標")) return "metric";

  if (/collage|拼貼模式|拼貼報表|我的自訂\s*>\s*拼貼模式|新增報表|儲存報表|重開|重新檢視/.test(source)) return "collage";
  if (/record_static_fields|明細檢視|record[-_ ]?(?:centric|mode|view)|detail[-_ ]?(?:centric|mode|view)/i.test(source)) return "record";
  if (/metric_(?:date|filter|group)|指標趨勢|metric[-_ ]?(?:centric|mode|view)/i.test(source)) return "metric";
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

  return {
    text,
    behaviorText,
    cleanupTargets,
    mode,
    hasFilter,
    hasGroup,
    isMetadataDropdown,
    isSaveReopenFlow
  };
};
