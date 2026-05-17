import type { CaseManifestCase } from "./case-manifest";
import type { HelperHints } from "./helper-hints";
import {
  inferStructuredCaseScope,
  structuredEvidenceList,
  type StructuredCaseScopeContract
} from "./structured-case-scope";

export type CaseScopeIntent = "frontend_observation" | "preview_execution" | "download_execution" | "unknown";

export type InferredCaseScope = {
  testIntent: CaseScopeIntent;
  previewRequired: boolean;
  executionRequired: boolean;
  requiredEvidence: string[];
  missingActionTemplate: string | null;
  caseScopeContract: StructuredCaseScopeContract | null;
};

const textBlob = (item: CaseManifestCase | null, helperHints: HelperHints | null): string =>
  [
    item?.caseNo,
    item?.groupName,
    item?.caseTitle,
    item?.testType,
    item?.testTarget,
    item?.riskLevel,
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

const isExplicitHelperTemplate = (helperHints: HelperHints | null): boolean => {
  const template = helperHints?.operationTemplate?.trim();
  return Boolean(template && template !== "manual_ai") || helperHints?.automationLevel === "helper";
};

const isOfficialUiCase = (caseNo: string | null | undefined): boolean =>
  /^BIUI_COLLAGE_R001-(?:I|J|K|L|M|N)-/i.test(caseNo ?? "");

const isDatePanelObservation = (text: string): boolean =>
  /時間區間工具|時間\s*button|時間面板|preset\s*清單|動態\/靜態\s*tab|點擊時間區間\s*button|取消\/確定按鈕/i.test(text);

const textExplicitlyDisablesDownload = (text: string): boolean =>
  /(?:本題不測項目|本題不做|本題不測|本題不驗|不測|不做|不驗).{0,40}(?:CSV|下載|download)|(?:CSV|下載|download).{0,20}(?:屬於|屬|不是|非|不測|不做|不驗)/i.test(text);

export const inferCaseScope = (
  currentCase: CaseManifestCase | null,
  helperHints: HelperHints | null
): InferredCaseScope => {
  const structured = inferStructuredCaseScope(currentCase, helperHints);
  if (structured) {
    return {
      testIntent: structured.routeIntent,
      previewRequired: structured.routeIntent === "preview_execution" || structured.routeIntent === "download_execution",
      executionRequired: structured.routeIntent === "preview_execution" || structured.routeIntent === "download_execution",
      requiredEvidence: structuredEvidenceList(structured),
      missingActionTemplate: null,
      caseScopeContract: structured
    };
  }

  const text = textBlob(currentCase, helperHints);
  const isFrontendTarget = /前端呈現/.test(`${currentCase?.testTarget ?? ""}\n${currentCase?.testType ?? ""}`);
  const hasDownloadTerms = /CSV|下載|download/i.test(text);
  const downloadExplicitlyDisabled = textExplicitlyDisablesDownload(text);
  const hasDownloadEvidence =
    /csv\.(?:rows|aggregate)|Playwright\s+download|download\s+API|downloaded\s*CSV|下載檔|CSV\s*檔可取得/i.test(text);
  const requiresDownload =
    hasDownloadTerms &&
    !downloadExplicitlyDisabled &&
    (!isFrontendTarget || /前後端整合/.test(currentCase?.testTarget ?? "") || hasDownloadEvidence);
  const requiresPreview =
    /network\.requestBody|request\s*body|Chart\.js|chart\.datasets|preview|預覽|執行計算|按執行|點計算|觸發下載/i.test(text) ||
    /前後端整合/.test(currentCase?.testTarget ?? "");
  if (requiresDownload) {
    return {
      testIntent: "download_execution",
      previewRequired: true,
      executionRequired: true,
      requiredEvidence: ["dom.state", "csv.rows", "csv.aggregate"],
      missingActionTemplate: null,
      caseScopeContract: null
    };
  }
  if (requiresPreview && !isFrontendTarget) {
    return {
      testIntent: "preview_execution",
      previewRequired: true,
      executionRequired: true,
      requiredEvidence: ["network.requestBody", "chart.datasets"],
      missingActionTemplate: null,
      caseScopeContract: null
    };
  }
  const isDatePanel = isDatePanelObservation(text);
  return {
    testIntent: isFrontendTarget || isOfficialUiCase(currentCase?.caseNo) ? "frontend_observation" : "unknown",
    previewRequired: false,
    executionRequired: false,
    requiredEvidence: isDatePanel ? ["dateRange.panel.state", "dom.state", "screenshot"] : ["dom.state"],
    missingActionTemplate: null,
    caseScopeContract: null
  };
};

export const missingActionTemplateBlocker = (scope: InferredCaseScope): string | null =>
  scope.missingActionTemplate ? `HELPER_CONTRACT_MISSING:${scope.missingActionTemplate}` : null;
