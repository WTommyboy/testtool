import type { ParsedResultCase, ParsedResultXlsx } from "./result-xlsx-parser";

export const RESULT_EVIDENCE_GATE_VERSION = "result-evidence-gate-v1";

export type ResultEvidenceGateSeverity = "warning" | "error";

export type ResultEvidenceGateIssue = {
  severity: ResultEvidenceGateSeverity;
  code: string;
  message: string;
  caseNo?: string;
  context?: Record<string, unknown>;
};

export type ResultEvidenceGateReport = {
  schemaVersion: typeof RESULT_EVIDENCE_GATE_VERSION;
  generatedAt: string;
  status: "ok" | "warning" | "error";
  parserVersion: string;
  resultSource: string | null;
  currentCaseNo: string | null;
  expectedCaseNos: string[];
  requireSingleCase: boolean;
  caseCount: number;
  caseNos: string[];
  issues: ResultEvidenceGateIssue[];
};

export type ExternalToolBridgeEvidence = {
  requestId?: string | null;
  eventType?: string | null;
  approved?: boolean | null;
  resolvedBy?: string | null;
  source?: string | null;
  createdAt?: string | null;
};

export type ResultEvidenceGateInput = {
  parsed: ParsedResultXlsx;
  resultSource?: string | null;
  currentCaseNo?: string | null;
  expectedCaseNos?: string[];
  requireSingleCase?: boolean;
  externalToolBridgeEvidenceByCase?: Record<string, ExternalToolBridgeEvidence[]>;
};

export class ResultEvidenceGateError extends Error {
  readonly report: ResultEvidenceGateReport;

  constructor(report: ResultEvidenceGateReport) {
    super(
      `RESULT_EVIDENCE_GATE_FAILED ${report.issues
        .filter((item) => item.severity === "error")
        .map((item) => item.code)
        .join(",")}`
    );
    this.name = "ResultEvidenceGateError";
    this.report = report;
  }
}

const VALID_RESULT_STATUSES = new Set(["PASS", "FAIL", "BLOCKED", "PARTIAL"]);
const VALID_CASE_SCOPE_ROLES = new Set(["precondition", "under_test", "verification", "cleanup"]);
const VALID_CASE_SCOPE_EXPECTED_OUTCOMES = new Set([
  "succeeded",
  "disabled_or_no_change",
  "visible",
  "hidden",
  "text_matches",
  "value_matches",
  "selected",
  "checked",
  "unchecked",
  "state_changed",
  "state_unchanged",
  "request_sent",
  "request_not_sent",
  "download_started",
  "toast_visible",
  "tooltip_visible"
]);

const PASS_REQUIRED_FIELDS = [
  ["測試目的", "testPurpose", "purpose"],
  ["設定條件", "setting", "setup", "conditions"],
  ["預期行為", "預期結果", "expected", "expectedResult"],
  ["實際行為", "actual", "actualResult"]
];

const FAIL_REQUIRED_FIELDS = [
  ["錯誤原因", "errorReason", "failReason"],
  ["根因層級", "rootCauseLayer", "rootCause"],
  ["驗證方法", "validationMethod", "verificationMethod", "verification"],
  ["RD 分派", "RD分派", "rdAssignment", "rdOwner"]
];

const BLOCKED_REQUIRED_FIELDS = [
  ...PASS_REQUIRED_FIELDS,
  ["blocked_reason", "blockedReason", "阻塞原因", "blocker", "blocked reason"]
];

const PARTIAL_REQUIRED_FIELDS = [
  ["部分符合的子項清單", "partialPassedItems", "passedItems"],
  ["不符的子項清單", "partialFailedItems", "failedItems"]
];

const CURRENT_RUN_EVIDENCE_KEY_PATTERNS = [
  /current[-_ ]?run[-_ ]?evidence/i,
  /current[-_ ]?run/i,
  /執行證據/,
  /本次.*證據/,
  /network/i,
  /requestbody/i,
  /responsebody/i,
  /request_body/i,
  /response_body/i,
  /(?:^|[._-])dom(?:$|[._-])/i,
  /chart/i,
  /dataset/i,
  /screenshot/i,
  /snapshot/i,
  /toolbridge/i,
  /actualjson/i,
  /performanceentries/i
];

const CURRENT_RUN_EVIDENCE_TEXT_PATTERNS = [
  /current[-_ ]?run/i,
  /本次(?:執行|request|network|畫面|截圖|圖表|DOM|證據)/i,
  /preview\s*post/i,
  /request\s*body/i,
  /response\s*body/i,
  /network\s+request/i,
  /chart\.js/i,
  /datasets?/i,
  /\bDOM\b/i,
  /snapshot/i,
  /screenshot/i,
  /performance\.getEntries/i
];

const TOOL_BRIDGE_ACTION_CLAIM_PATTERNS = [
  /browser_handle_dialog/i,
  /(?:tool\s*bridge|toolbridge|tool_bridge).{0,40}(?:request|approval|authorization|dialog|confirm|alert|授權|回覆|請求)/i,
  /(?:Tommy|PM).{0,40}(?:授權|同意|approved|authorized).{0,80}(?:刪除|删除|delete|覆寫|覆蓋儲存|overwrite|confirm|alert|dialog|不可逆)/i,
  /(?:刪除|删除|delete|覆寫|覆蓋儲存|overwrite|confirm|alert|dialog|不可逆).{0,80}(?:已取得|已收到|已獲|Tommy|PM).{0,40}(?:授權|同意|approval|authorization|approved|authorized)/i,
  /(?:已|完成|成功|按下|clicked?|handled|accepted|confirmed|dismissed).{0,40}(?:browser_handle_dialog|native\s*(?:confirm|alert|dialog)|原生\s*(?:confirm|alert|dialog)|confirm|alert|dialog|刪除|删除|delete|覆寫儲存|覆蓋儲存|不可逆)/i
];

const TOOL_BRIDGE_RESPONSE_PATTERNS = [
  /toolbridge(?:response)?/i,
  /tool[-_ ]response/i,
  /toolBridge\.response/,
  /request_id/i,
  /resolved_by/i,
  /resolution_note/i,
  /approved_by/i,
  /approvalResponse/i,
  /授權回覆/,
  /Tool Bridge response/i
];

const TOOL_BRIDGE_REQUIRED_EXECUTION_STATES = new Set([
  "nativedialogreached",
  "irreversibleactionreached",
  "overwriteconfirmreached",
  "deleteconfirmreached"
]);

const EXECUTION_STATE_PATH_PATTERNS = [
  /(?:^|[._-])executionstate(?:$|[._-])/i,
  /(?:^|[._-])execution_state(?:$|[._-])/i,
  /(?:^|[._-])workflowstate(?:$|[._-])/i,
  /(?:^|[._-])workflow_state(?:$|[._-])/i,
  /(?:^|[._-])nativedialogstate(?:$|[._-])/i,
  /(?:^|[._-])native_dialog_state(?:$|[._-])/i
];

const NON_DESTRUCTIVE_NATIVE_VALIDATION_DIALOG_PATTERN =
  /(?:請至少選擇一個欄位|至少選擇.{0,12}欄位|請選擇.{0,12}欄位|select\s+at\s+least\s+one\s+field|at\s+least\s+one\s+field)/i;
const TOOL_BRIDGE_AUTH_OR_DESTRUCTIVE_PATTERN =
  /(?:Tommy|PM|授權|同意|approved|authorized|authorization|request_id|tool[-_ ]response|刪除|删除|delete|trash|remove|覆寫|覆蓋儲存|overwrite|儲存|保存|save|SSO|login|auth|登入|未授權|不可逆)/i;
const NEGATIVE_OR_MISSING_TOOL_BRIDGE_CLAIM_PATTERNS = [
  /TOOL_BRIDGE_RESPONSE_MISSING/gi,
  /\b(?:clicked|confirmed|handled|accepted|dismissed)\b\s*(?::|=)?\s*(?:true|false|null)\b/gi,
  /(?:tool\s*bridge|toolbridge|tool_bridge).{0,24}(?:response|回覆).{0,24}(?:missing|缺少|缺乏|未取得|沒有取得|無法取得|不足)/gi,
  /(?:missing|without|缺少|缺乏|未取得|沒有取得|無法取得|不足).{0,40}(?:tool\s*bridge|toolbridge|tool_bridge).{0,24}(?:response|回覆|evidence|證據|紀錄)/gi,
  /(?:未附|未提供|未包含|未寫入|未记录|未記錄).{0,40}(?:tool\s*bridge|toolbridge|tool_bridge).{0,24}(?:response|回覆|evidence|證據|紀錄)/gi,
  /(?:tool\s*bridge|toolbridge|tool_bridge).{0,24}(?:response|回覆|evidence|證據|紀錄).{0,40}(?:未附|未提供|未包含|未寫入|未记录|未記錄)/gi,
  /(?:無|未|沒有|不會|不應|不需|不需要|不出現|未出現|沒有出現|未觸發|沒有觸發).{0,24}(?:native\s*)?(?:confirm|alert|dialog|原生\s*(?:confirm|alert|dialog)|確認)/gi,
  /(?:native\s*)?(?:confirm|alert|dialog|原生\s*(?:confirm|alert|dialog)|確認).{0,24}(?:無|未|沒有|不會|不應|不需|不需要|不出現|未出現|沒有出現|未觸發|沒有觸發)/gi,
  /(?:缺少|缺乏|未取得|沒有取得|無法取得|不足).{0,40}(?:tool\s*bridge|toolbridge|tool_bridge|approval|authorization|授權|回覆|response|native\s*)?(?:confirm|alert|dialog|原生\s*(?:confirm|alert|dialog)|證據|驗證|紀錄)/gi,
  /(?:不測|超出本題範圍).{0,80}(?:未儲存|離開警告|native\s*confirm|confirm|alert|dialog|原生\s*(?:confirm|alert|dialog))/gi
];

const NON_DESTRUCTIVE_HOVER_TOOLTIP_PATTERNS = [
  /(?:已|完成|成功)?\s*(?:hover(?:ed)?|滑鼠(?:移入|懸停)|移入|懸停).{0,100}(?:刪除|删除|delete|trash|rowDeleteAction).{0,100}(?:tooltip|工具提示|hover|hovered|tooltipVisible|visibleText|未出現|沒有出現|顯示)/gi,
  /(?:刪除|删除|delete|trash|rowDeleteAction).{0,100}(?:tooltip|工具提示).{0,100}(?:hover(?:ed)?|滑鼠(?:移入|懸停)|移入|懸停|tooltipVisible|visibleText|未出現|沒有出現|顯示)/gi,
  /(?:projectList\.rowDeleteAction|projectList\.rowActionTooltip|rowDeleteTooltip|rowActionTooltip).{0,120}(?:hover(?:ed)?|tooltip|tooltipVisible|visibleText|未出現|沒有出現|顯示)/gi
];

const NON_DESTRUCTIVE_DELETE_CANCEL_FLOW_PATTERNS = [
  /(?:已|完成|成功|按下|clicked?|handled|dismissed|執行|點擊|按了).{0,80}(?:刪除|删除|delete).{0,80}(?:取消|cancel).{0,180}(?:deleteCancelFlow|cancelClicked|modalClosed|rowCountAfterCancel|rowStillVisible|rowCount|sampleRows|before=|after=|未刪除|沒有刪除|未發生刪除|不變|一致|保留|asserted)/gi,
  /(?:deleteCancelFlow|projectList\.deleteCancelFlow|deleteConfirmModal\.cancelButton|deleteClicked|cancelClicked|modalClosed|rowCountAfterCancel|rowStillVisible).{0,160}(?:刪除|删除|delete|取消|cancel|modal|rowCount|rowStillVisible|asserted)/gi,
  /(?:刪除|删除|delete).{0,100}(?:取消|cancel).{0,180}(?:deleteCancelFlow|cancelClicked|modalClosed|rowCountAfterCancel|rowStillVisible|rowCount|sampleRows|before=|after=|未刪除|沒有刪除|未發生刪除|不變|一致|保留|asserted)/gi,
  /(?:取消|cancel).{0,100}(?:刪除|删除|delete).{0,180}(?:deleteCancelFlow|cancelClicked|modalClosed|rowCountAfterCancel|rowStillVisible|rowCount|sampleRows|before=|after=|未刪除|沒有刪除|未發生刪除|不變|一致|保留|asserted)/gi
];

const normalizeStatus = (status: string): string => status.trim().toUpperCase().replace(/\s+/g, "_");

const normalizeCaseNo = (value: string): string =>
  value
    .trim()
    .replace(/\s+/g, "")
    .replace(/^DEMO-/i, "")
    .toUpperCase();

const sameCaseNo = (a: string, b: string): boolean => normalizeCaseNo(a) === normalizeCaseNo(b);

const uniqueStrings = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = normalizeCaseNo(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
};

const isMeaningfulValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return false;
};

const walkDetail = (
  value: unknown,
  visit: (entry: { key: string | null; value: unknown; path: string }) => void,
  path = ""
): void => {
  if (!value || typeof value !== "object") {
    visit({ key: path ? path.split(".").at(-1) ?? null : null, value, path });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkDetail(item, visit, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = path ? `${path}.${key}` : key;
    visit({ key, value: child, path: nextPath });
    walkDetail(child, visit, nextPath);
  }
};

const hasAnyField = (detail: Record<string, unknown>, aliases: string[]): boolean => {
  let found = false;
  const normalizedAliases = new Set(aliases.map((item) => item.toLowerCase().replace(/\s+/g, "")));
  walkDetail(detail, ({ key, value }) => {
    if (!key || found) return;
    const normalizedKey = key.toLowerCase().replace(/\s+/g, "");
    if (normalizedAliases.has(normalizedKey) && isMeaningfulValue(value)) {
      found = true;
    }
  });
  return found;
};

const validateStructuredCaseScopeContracts = (
  item: ParsedResultCase,
  issues: ResultEvidenceGateIssue[]
): void => {
  const detail = item.detailJson;
  if (!detail) return;
  const candidates: Array<{ value: unknown; path: string }> = [];
  walkDetail(detail, ({ key, value, path }) => {
    if (key === "caseScopeContract" && value && typeof value === "object" && !Array.isArray(value)) {
      candidates.push({ value, path });
    }
  });
  for (const candidate of candidates) {
    const contract = candidate.value as Record<string, unknown>;
    if (contract.version !== "v1") {
      issues.push({
        severity: "error",
        code: "DETAIL_JSON_CASE_SCOPE_CONTRACT_INVALID",
        caseNo: item.caseNo,
        message: "caseScopeContract.version must be v1 when included in detail_json.",
        context: { path: candidate.path }
      });
    }
    const requiredActions = contract.requiredActions;
    if (!Array.isArray(requiredActions) || requiredActions.length === 0) {
      issues.push({
        severity: "error",
        code: "DETAIL_JSON_CASE_SCOPE_CONTRACT_INVALID",
        caseNo: item.caseNo,
        message: "caseScopeContract.requiredActions must be a non-empty array when included in detail_json.",
        context: { path: candidate.path }
      });
      continue;
    }
    requiredActions.forEach((rawAction, index) => {
      if (!rawAction || typeof rawAction !== "object" || Array.isArray(rawAction)) {
        issues.push({
          severity: "error",
          code: "DETAIL_JSON_CASE_SCOPE_CONTRACT_INVALID",
          caseNo: item.caseNo,
          message: "caseScopeContract.requiredActions entries must be objects.",
          context: { path: `${candidate.path}.requiredActions[${index}]` }
        });
        return;
      }
      const action = rawAction as Record<string, unknown>;
      const missing = ["action", "target", "role", "expectedOutcome", "evidenceRequirements"].filter((key) => !isMeaningfulValue(action[key]));
      if (missing.length > 0) {
        issues.push({
          severity: "error",
          code: "DETAIL_JSON_CASE_SCOPE_CONTRACT_INVALID",
          caseNo: item.caseNo,
          message: "caseScopeContract.requiredActions entry is missing required action/target/role/expectedOutcome/evidenceRequirements fields.",
          context: { path: `${candidate.path}.requiredActions[${index}]`, missing }
        });
      }
      if (typeof action.role === "string" && !VALID_CASE_SCOPE_ROLES.has(action.role)) {
        issues.push({
          severity: "error",
          code: "DETAIL_JSON_CASE_SCOPE_CONTRACT_INVALID",
          caseNo: item.caseNo,
          message: `Unknown caseScopeContract action role: ${action.role}`,
          context: { path: `${candidate.path}.requiredActions[${index}].role` }
        });
      }
      if (typeof action.expectedOutcome === "string" && !VALID_CASE_SCOPE_EXPECTED_OUTCOMES.has(action.expectedOutcome)) {
        issues.push({
          severity: "error",
          code: "DETAIL_JSON_CASE_SCOPE_CONTRACT_INVALID",
          caseNo: item.caseNo,
          message: `Unknown caseScopeContract expectedOutcome: ${action.expectedOutcome}`,
          context: { path: `${candidate.path}.requiredActions[${index}].expectedOutcome` }
        });
      }
      if (!Array.isArray(action.evidenceRequirements) || action.evidenceRequirements.length === 0) {
        issues.push({
          severity: "error",
          code: "DETAIL_JSON_CASE_SCOPE_CONTRACT_INVALID",
          caseNo: item.caseNo,
          message: "caseScopeContract action evidenceRequirements must be a non-empty array.",
          context: { path: `${candidate.path}.requiredActions[${index}].evidenceRequirements` }
        });
      }
    });
  }
};

const flattenedDetailText = (detail: Record<string, unknown>): string => {
  const parts: string[] = [];
  walkDetail(detail, ({ key, value, path }) => {
    if (key) parts.push(key);
    if (path) parts.push(path);
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      parts.push(String(value));
    }
  });
  return parts.join("\n");
};

const SELECTED_FIELD_PREVIEW_PRECONDITION_PATTERN =
  /EXECUTE_PRECONDITION_NO_SELECTED_FIELDS|selected\s*(?:metric\s*)?fields?\s*(?:=|:|is)?\s*(?:0|\[\])|selectedMetricFields[\s\S]{0,80}(?:\[\]|0)/i;
const SCREENSHOT_EVIDENCE_PATTERN =
  /(?:\.png\b|\.jpe?g\b|\.webp\b|artifactType["']?\s*[:=]\s*["']?screenshot|截圖(?:路徑|檔案)?["']?\s*[:=]\s*["']?[^"'\s]+\.(?:png|jpe?g|webp)|screenshot(?:Path|File|Artifact|Url)?["']?\s*[:=]\s*["']?[^"'\s]+\.(?:png|jpe?g|webp))/i;
const VISUAL_FALLBACK_MARKER_PATTERN =
  /(?:screenshotVisual|visual_screenshot|visualObservation|visual_observation|domEvidenceGap|dom_evidence_gap|BLOCKED_NEEDS_VISUAL_REVIEW|PASS_VISUAL_EVIDENCE)/i;
const TOOL_EXECUTION_UNAVAILABLE_PATTERN =
  /(?:TOOL_EXECUTION_UNAVAILABLE|browser\s*tool(?:ing)?\s*unavailable|Playwright\s*MCP.{0,40}unavailable|瀏覽器.{0,16}(?:工具|自動化).{0,16}(?:不可用|無法使用)|工具.{0,16}(?:不可用|無法使用))/i;
const STRUCTURED_FRONTEND_PRECONDITION_BLOCKER_PATTERN =
  /PROJECT_LIMIT_PRECONDITION_NOT_ESTABLISHED|PROJECT_CREATE_MODAL_PRECONDITION_PROJECT_LIMIT_REACHED|FRONTEND_OBSERVATION_BLOCKED:(?:PROJECT_LIMIT_PRECONDITION_NOT_ESTABLISHED|PROJECT_CREATE_MODAL_PRECONDITION_PROJECT_LIMIT_REACHED)/i;

const isFalseLike = (value: unknown): boolean =>
  value === false || (typeof value === "string" && value.trim().toLowerCase() === "false");

const detailDeclaresPreviewNotRequired = (detail: Record<string, unknown>): boolean => {
  let found = false;
  walkDetail(detail, ({ key, value, path }) => {
    if (found || !isFalseLike(value)) return;
    const normalizedKey = key?.replace(/\s+/g, "").toLowerCase() ?? "";
    const normalizedPath = path.replace(/\[\d+\]/g, "").replace(/\s+/g, "").toLowerCase();
    if (
      normalizedKey === "previewrequired" &&
      (normalizedPath === "previewrequired" || normalizedPath.endsWith(".previewrequired"))
    ) {
      found = true;
    }
  });
  return found;
};

const parsedCaseImpliesPreviewNotRequired = (item: ParsedResultCase): boolean =>
  /^BIUI_COLLAGE_R001-(?:I|J|K|L|M|N)-/i.test(item.caseNo) && /前端呈現/.test(item.testType ?? "");

const hasOutOfScopeSelectedFieldPreviewBlocker = (item: ParsedResultCase, normalizedStatus: string): boolean => {
  if (normalizedStatus !== "BLOCKED" || !item.detailJson) return false;
  if (!detailDeclaresPreviewNotRequired(item.detailJson) && !parsedCaseImpliesPreviewNotRequired(item)) return false;
  const text = [item.verdictReason, item.detailJsonRaw, flattenedDetailText(item.detailJson)]
    .filter(Boolean)
    .join("\n");
  return SELECTED_FIELD_PREVIEW_PRECONDITION_PATTERN.test(text);
};

const hasScreenshotEvidence = (detail: Record<string, unknown>): boolean => {
  let found = false;
  walkDetail(detail, ({ key, value, path }) => {
    if (found) return;
    const text = [
      key ?? "",
      path,
      typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : ""
    ].join("\n");
    if (SCREENSHOT_EVIDENCE_PATTERN.test(text)) found = true;
  });
  return found;
};

const detailHasStringField = (detail: Record<string, unknown>, fieldName: string, pattern?: RegExp): boolean => {
  let found = false;
  const normalizedFieldName = fieldName.replace(/\s+/g, "").toLowerCase();
  walkDetail(detail, ({ key, value }) => {
    if (found || typeof value !== "string" || value.trim().length === 0) return;
    const normalizedKey = key?.replace(/\s+/g, "").toLowerCase() ?? "";
    if (normalizedKey !== normalizedFieldName) return;
    found = pattern ? pattern.test(value) : true;
  });
  return found;
};

const hasVisualFallbackContract = (item: ParsedResultCase): boolean => {
  if (!item.detailJson) return false;
  const text = [item.verdictReason, item.detailJsonRaw, flattenedDetailText(item.detailJson)]
    .filter(Boolean)
    .join("\n");
  return (
    VISUAL_FALLBACK_MARKER_PATTERN.test(text) &&
    hasScreenshotEvidence(item.detailJson) &&
    detailHasStringField(item.detailJson, "evidenceSource", /^screenshotVisual$/i) &&
    detailHasStringField(item.detailJson, "visualObservation") &&
    detailHasStringField(item.detailJson, "domEvidenceGap")
  );
};

const hasFrontendObservationVisualFallbackGap = (item: ParsedResultCase, normalizedStatus: string): boolean => {
  if (normalizedStatus !== "BLOCKED" || !item.detailJson) return false;
  if (!parsedCaseImpliesPreviewNotRequired(item)) return false;
  if (!hasScreenshotEvidence(item.detailJson)) return false;
  if (hasVisualFallbackContract(item)) return false;
  const text = [item.verdictReason, item.detailJsonRaw, flattenedDetailText(item.detailJson)]
    .filter(Boolean)
    .join("\n");
  if (STRUCTURED_FRONTEND_PRECONDITION_BLOCKER_PATTERN.test(text)) return false;
  return VISUAL_FALLBACK_MARKER_PATTERN.test(text) || /EVIDENCE_INSUFFICIENT/i.test(text);
};

const hasBrowserMcpPreflightEvidence = (detail: Record<string, unknown>): boolean => {
  let found = false;
  walkDetail(detail, ({ key, value, path }) => {
    if (found) return;
    const normalizedPath = path.replace(/\[\d+\]/g, "").replace(/\s+/g, "").toLowerCase();
    const normalizedKey = key?.replace(/\s+/g, "").toLowerCase() ?? "";
    if (normalizedPath.includes("browsermcp.preflight") || normalizedPath.includes("browser_mcp.preflight")) {
      if (typeof value === "string" && /browser_tabs|attempted|failed|ok|success|unavailable/i.test(value)) found = true;
      if (typeof value === "boolean" || typeof value === "number") found = true;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        if (
          record.attempted === true ||
          /browser_tabs/i.test(String(record.tool ?? "")) ||
          /ok|success|failed|unavailable|error/i.test(String(record.status ?? ""))
        ) {
          found = true;
        }
      }
    }
    if ((normalizedKey === "mcptoolcallcount" || normalizedKey === "browsermcptoolcallcount") && typeof value === "number" && value > 0) {
      found = true;
    }
    if (typeof value === "string" && /browser_tabs.{0,80}(?:attempted|called|failed|ok|success|成功|失敗|嘗試)/i.test(value)) {
      found = true;
    }
  });
  return found;
};

const hasToolExecutionUnavailableWithoutPreflight = (item: ParsedResultCase, normalizedStatus: string): boolean => {
  if (normalizedStatus !== "BLOCKED" || !item.detailJson) return false;
  const text = [item.verdictReason, item.detailJsonRaw, flattenedDetailText(item.detailJson)]
    .filter(Boolean)
    .join("\n");
  if (!TOOL_EXECUTION_UNAVAILABLE_PATTERN.test(text)) return false;
  return !hasBrowserMcpPreflightEvidence(item.detailJson);
};

const TOOL_BRIDGE_CONTEXT_EXCLUDED_PATH_PATTERNS = [
  /(?:^|\.)(測試目的|testPurpose|purpose)(?:\.|$)/i,
  /(?:^|\.)(設定條件|setting|setup|conditions)(?:\.|$)/i,
  /(?:^|\.)(預期行為|預期結果|expected|expectedResult)(?:\.|$)/i
];

const isToolBridgeContextExcludedPath = (path: string): boolean => {
  const normalized = path.replace(/\[\d+\]/g, "").replace(/\s+/g, "");
  return TOOL_BRIDGE_CONTEXT_EXCLUDED_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
};

const flattenedToolBridgeExecutionText = (detail: Record<string, unknown>): string => {
  const parts: string[] = [];
  walkDetail(detail, ({ key, value, path }) => {
    if (path && isToolBridgeContextExcludedPath(path)) return;
    if (key) parts.push(key);
    if (path) parts.push(path);
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      parts.push(String(value));
    }
  });
  return parts.join("\n");
};

const normalizeExecutionState = (value: string): string => value.replace(/[\s._-]+/g, "").toLowerCase();

const collectExecutionStates = (detail: Record<string, unknown>): string[] => {
  const states: string[] = [];
  walkDetail(detail, ({ value, path }) => {
    if (!path) return;
    if (isToolBridgeContextExcludedPath(path)) return;
    const normalizedPath = path.replace(/\[\d+\]/g, "").replace(/\s+/g, "");
    if (!EXECUTION_STATE_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath))) return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      states.push(String(value));
    }
  });
  return states;
};

const hasToolBridgeRequiredExecutionState = (detail: Record<string, unknown>): boolean =>
  collectExecutionStates(detail).some((state) => TOOL_BRIDGE_REQUIRED_EXECUTION_STATES.has(normalizeExecutionState(state)));

const hasCurrentRunEvidence = (detail: Record<string, unknown>): boolean => {
  let keyMatch = false;
  walkDetail(detail, ({ key, path, value }) => {
    if (keyMatch) return;
    const normalizedKey = key?.replace(/\s+/g, "") ?? "";
    const normalizedPath = path.replace(/\s+/g, "");
    if (
      CURRENT_RUN_EVIDENCE_KEY_PATTERNS.some((pattern) => pattern.test(normalizedKey) || pattern.test(normalizedPath)) &&
      isMeaningfulValue(value)
    ) {
      keyMatch = true;
    }
  });
  if (keyMatch) return true;

  const text = flattenedDetailText(detail);
  return CURRENT_RUN_EVIDENCE_TEXT_PATTERNS.some((pattern) => pattern.test(text));
};

const claimsToolBridgeAction = (detail: Record<string, unknown>): boolean => {
  let text = flattenedToolBridgeExecutionText(detail);
  for (const pattern of NEGATIVE_OR_MISSING_TOOL_BRIDGE_CLAIM_PATTERNS) {
    text = text.replace(pattern, "NEGATED_OR_MISSING_EVIDENCE_TEXT");
  }
  for (const pattern of NON_DESTRUCTIVE_HOVER_TOOLTIP_PATTERNS) {
    text = text.replace(pattern, "NON_DESTRUCTIVE_HOVER_TOOLTIP_TEXT");
  }
  for (const pattern of NON_DESTRUCTIVE_DELETE_CANCEL_FLOW_PATTERNS) {
    text = text.replace(pattern, "NON_DESTRUCTIVE_CANCEL_FLOW_TEXT");
  }
  const allowlistedNativeValidation =
    /browser_handle_dialog|native\s*(?:alert|dialog)|原生\s*(?:alert|dialog)|alert|dialog/i.test(text) &&
    NON_DESTRUCTIVE_NATIVE_VALIDATION_DIALOG_PATTERN.test(text) &&
    !TOOL_BRIDGE_AUTH_OR_DESTRUCTIVE_PATTERN.test(text);
  if (allowlistedNativeValidation) return false;
  return TOOL_BRIDGE_ACTION_CLAIM_PATTERNS.some((pattern) => pattern.test(text));
};

const hasToolBridgeResponse = (detail: Record<string, unknown>): boolean => {
  let foundStructured = false;
  walkDetail(detail, ({ key, value, path }) => {
    if (foundStructured || !path || isToolBridgeContextExcludedPath(path) || !isMeaningfulValue(value)) return;
    const target = `${key ?? ""}\n${path}`;
    if (TOOL_BRIDGE_RESPONSE_PATTERNS.some((pattern) => pattern.test(target))) foundStructured = true;
  });
  if (foundStructured) return true;
  const primitiveParts: string[] = [];
  walkDetail(detail, ({ value, path }) => {
    if (path && isToolBridgeContextExcludedPath(path)) return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      primitiveParts.push(String(value));
    }
  });
  let text = primitiveParts.join("\n");
  for (const pattern of NEGATIVE_OR_MISSING_TOOL_BRIDGE_CLAIM_PATTERNS) {
    text = text.replace(pattern, "NEGATED_OR_MISSING_EVIDENCE_TEXT");
  }
  return TOOL_BRIDGE_RESPONSE_PATTERNS.some((pattern) => pattern.test(text));
};

const hasExternalToolBridgeResponse = (
  caseNo: string,
  evidenceByCase: Record<string, ExternalToolBridgeEvidence[]>
): boolean => {
  const normalizedCaseNo = normalizeCaseNo(caseNo);
  for (const [key, evidence] of Object.entries(evidenceByCase)) {
    if (normalizeCaseNo(key) !== normalizedCaseNo) continue;
    if (evidence.some((item) => isMeaningfulValue(item.requestId) || isMeaningfulValue(item.eventType))) return true;
  }
  return false;
};

const missingFieldIssues = (
  item: ParsedResultCase,
  label: string,
  requiredGroups: string[][],
  issues: ResultEvidenceGateIssue[]
): void => {
  const detail = item.detailJson;
  if (!detail) return;
  for (const aliases of requiredGroups) {
    if (!hasAnyField(detail, aliases)) {
      issues.push({
        severity: "error",
        code: "DETAIL_JSON_REQUIRED_FIELD_MISSING",
        caseNo: item.caseNo,
        message: `${label} result detail_json is missing required field: ${aliases[0]}`,
        context: { requiredField: aliases[0], aliases }
      });
    }
  }
};

export const evaluateResultEvidenceGate = (input: ResultEvidenceGateInput): ResultEvidenceGateReport => {
  const parsed = input.parsed;
  const requireSingleCase = input.requireSingleCase ?? true;
  const resultSource = input.resultSource?.trim().toLowerCase() || null;
  const expectedCaseNos = uniqueStrings(input.expectedCaseNos ?? []);
  const currentCaseNo = input.currentCaseNo?.trim() || (expectedCaseNos.length === 1 ? expectedCaseNos[0] : null);
  const externalToolBridgeEvidenceByCase = input.externalToolBridgeEvidenceByCase ?? {};
  const issues: ResultEvidenceGateIssue[] = [];
  const caseNos = parsed.cases.map((item) => item.caseNo);

  if (!parsed.schemaVersion) {
    issues.push({
      severity: "warning",
      code: "RESULT_XLSX_SCHEMA_VERSION_MISSING",
      message: "result.xlsx does not include schema_version in the 索引 sheet."
    });
  }

  if (resultSource === "agent_fallback") {
    issues.push({
      severity: "error",
      code: "AGENT_FALLBACK_RESULT_NOT_TRUSTED",
      message: "Agent fallback result.xlsx is not a trusted UAT result. Codex must write output/result.xlsx for the current case."
    });
  }

  if (resultSource === "diagnostic") {
    issues.push({
      severity: "error",
      code: "DIAGNOSTIC_RESULT_NOT_TRUSTED",
      message: "Diagnostic output cannot be ingested as trusted UAT result.xlsx."
    });
  }

  if (parsed.cases.length === 0) {
    issues.push({
      severity: "error",
      code: "RESULT_CASES_EMPTY",
      message: "result.xlsx 測試案例 sheet has no completed case rows."
    });
  } else if (requireSingleCase && parsed.cases.length !== 1) {
    issues.push({
      severity: "error",
      code: "RESULT_MULTIPLE_CASES",
      message: "result.xlsx must contain exactly one current-case result row.",
      context: { caseNos }
    });
  }

  if (expectedCaseNos.length > 0) {
    for (const item of parsed.cases) {
      if (!expectedCaseNos.some((expected) => sameCaseNo(item.caseNo, expected))) {
        issues.push({
          severity: "error",
          code: "RESULT_CASE_NOT_IN_ASSIGNMENT",
          caseNo: item.caseNo,
          message: "result.xlsx contains a case that is not in the assigned case set.",
          context: { expectedCaseNos }
        });
      }
    }
  }

  if (currentCaseNo && parsed.cases.length === 1 && !sameCaseNo(parsed.cases[0].caseNo, currentCaseNo)) {
    issues.push({
      severity: "error",
      code: "RESULT_CASE_NOT_CURRENT",
      caseNo: parsed.cases[0].caseNo,
      message: "result.xlsx row does not match the current case selected by the run packet.",
      context: { currentCaseNo }
    });
  }

  for (const item of parsed.cases) {
    const status = normalizeStatus(item.status);
    if (!VALID_RESULT_STATUSES.has(status)) {
      issues.push({
        severity: "error",
        code: "RESULT_STATUS_UNSUPPORTED",
        caseNo: item.caseNo,
        message: `Unsupported result status: ${item.status || "(empty)"}`,
        context: { allowed: [...VALID_RESULT_STATUSES] }
      });
    }

    if (item.detailParseError) {
      issues.push({
        severity: "error",
        code: "DETAIL_JSON_PARSE_ERROR",
        caseNo: item.caseNo,
        message: `detail_json is not valid JSON object: ${item.detailParseError}`
      });
      continue;
    }
    if (!item.detailJson) {
      issues.push({
        severity: "error",
        code: "DETAIL_JSON_MISSING",
        caseNo: item.caseNo,
        message: "detail_json is required for every result row."
      });
      continue;
    }

    if (status === "PASS") {
      missingFieldIssues(item, "PASS", PASS_REQUIRED_FIELDS, issues);
    } else if (status === "FAIL") {
      missingFieldIssues(item, "FAIL", FAIL_REQUIRED_FIELDS, issues);
    } else if (status === "BLOCKED") {
      missingFieldIssues(item, "BLOCKED", BLOCKED_REQUIRED_FIELDS, issues);
    } else if (status === "PARTIAL") {
      missingFieldIssues(item, "PARTIAL", PARTIAL_REQUIRED_FIELDS, issues);
    }

    validateStructuredCaseScopeContracts(item, issues);

    if (hasOutOfScopeSelectedFieldPreviewBlocker(item, status)) {
      issues.push({
        severity: "error",
        code: "RESULT_SCOPE_OUT_OF_SCOPE_PREVIEW_BLOCKER",
        caseNo: item.caseNo,
        message: "A frontend-observation result with previewRequired=false cannot be blocked by selected-field preview precondition evidence.",
        context: {
          rule: "selectedMetricFields=0 / EXECUTE_PRECONDITION_NO_SELECTED_FIELDS is only valid for preview/download execution scopes"
        }
      });
    }

    if (hasFrontendObservationVisualFallbackGap(item, status)) {
      issues.push({
        severity: "error",
        code: "RESULT_FRONTEND_OBSERVATION_VISUAL_FALLBACK_REQUIRED",
        caseNo: item.caseNo,
        message: "A frontend-observation result with screenshot evidence but insufficient DOM/ARIA/URL evidence must use an explicit visual fallback contract.",
        context: {
          rule: "Use BLOCKED_NEEDS_VISUAL_REVIEW or PASS_VISUAL_EVIDENCE with evidenceSource=screenshotVisual, screenshotPath, visualObservation, and domEvidenceGap."
        }
      });
    }

    if (hasToolExecutionUnavailableWithoutPreflight(item, status)) {
      issues.push({
        severity: "error",
        code: "RESULT_TOOL_EXECUTION_UNAVAILABLE_WITHOUT_PREFLIGHT",
        caseNo: item.caseNo,
        message: "A BLOCKED result cannot use TOOL_EXECUTION_UNAVAILABLE unless browserMcp.preflight/browser_tabs was attempted or equivalent current-run helper browser evidence is cited.",
        context: {
          rule: "Before writing TOOL_EXECUTION_UNAVAILABLE, record browserMcp.preflight with attempted=true, tool=browser_tabs, and status."
        }
      });
    }

    if (!hasCurrentRunEvidence(item.detailJson)) {
      issues.push({
        severity: "error",
        code: "CURRENT_RUN_EVIDENCE_MISSING",
        caseNo: item.caseNo,
        message: "detail_json must include current-run evidence such as DOM/network/chart/screenshot/tool evidence."
      });
    }

    const requiresToolBridgeResponse =
      hasToolBridgeRequiredExecutionState(item.detailJson) || claimsToolBridgeAction(item.detailJson);
    if (requiresToolBridgeResponse && !hasToolBridgeResponse(item.detailJson) && !hasExternalToolBridgeResponse(item.caseNo, externalToolBridgeEvidenceByCase)) {
      issues.push({
        severity: "error",
        code: "TOOL_BRIDGE_RESPONSE_MISSING",
        caseNo: item.caseNo,
        message: "detail_json claims an approval, native dialog, or irreversible action but does not include Tool Bridge response evidence."
      });
    }
  }

  const status = issues.some((item) => item.severity === "error")
    ? "error"
    : issues.some((item) => item.severity === "warning")
      ? "warning"
      : "ok";

  return {
    schemaVersion: RESULT_EVIDENCE_GATE_VERSION,
    generatedAt: new Date().toISOString(),
    status,
    parserVersion: parsed.parserVersion,
    resultSource,
    currentCaseNo,
    expectedCaseNos,
    requireSingleCase,
    caseCount: parsed.cases.length,
    caseNos,
    issues
  };
};
