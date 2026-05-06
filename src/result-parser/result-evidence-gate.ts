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

const NON_DESTRUCTIVE_NATIVE_VALIDATION_DIALOG_PATTERN =
  /(?:請至少選擇一個欄位|至少選擇.{0,12}欄位|請選擇.{0,12}欄位|select\s+at\s+least\s+one\s+field|at\s+least\s+one\s+field)/i;
const TOOL_BRIDGE_AUTH_OR_DESTRUCTIVE_PATTERN =
  /(?:Tommy|PM|授權|同意|approved|authorized|authorization|request_id|tool[-_ ]response|刪除|删除|delete|trash|remove|覆寫|覆蓋儲存|overwrite|儲存|保存|save|SSO|login|auth|登入|未授權|不可逆)/i;
const NEGATIVE_OR_MISSING_TOOL_BRIDGE_CLAIM_PATTERNS = [
  /(?:無|未|沒有|不會|不應|不需|不需要|不出現|未出現|沒有出現|未觸發|沒有觸發).{0,24}(?:native\s*)?(?:confirm|alert|dialog|原生\s*(?:confirm|alert|dialog)|確認)/gi,
  /(?:native\s*)?(?:confirm|alert|dialog|原生\s*(?:confirm|alert|dialog)|確認).{0,24}(?:無|未|沒有|不會|不應|不需|不需要|不出現|未出現|沒有出現|未觸發|沒有觸發)/gi,
  /(?:缺少|缺乏|未取得|沒有取得|無法取得|不足).{0,40}(?:tool\s*bridge|toolbridge|tool_bridge|approval|authorization|授權|回覆|response|native\s*)?(?:confirm|alert|dialog|原生\s*(?:confirm|alert|dialog)|證據|驗證|紀錄)/gi,
  /(?:不測|超出本題範圍).{0,80}(?:未儲存|離開警告|native\s*confirm|confirm|alert|dialog|原生\s*(?:confirm|alert|dialog))/gi
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
  let text = flattenedDetailText(detail);
  for (const pattern of NEGATIVE_OR_MISSING_TOOL_BRIDGE_CLAIM_PATTERNS) {
    text = text.replace(pattern, "NEGATED_OR_MISSING_EVIDENCE_TEXT");
  }
  const allowlistedNativeValidation =
    /browser_handle_dialog|native\s*(?:alert|dialog)|原生\s*(?:alert|dialog)|alert|dialog/i.test(text) &&
    NON_DESTRUCTIVE_NATIVE_VALIDATION_DIALOG_PATTERN.test(text) &&
    !TOOL_BRIDGE_AUTH_OR_DESTRUCTIVE_PATTERN.test(text);
  if (allowlistedNativeValidation) return false;
  return TOOL_BRIDGE_ACTION_CLAIM_PATTERNS.some((pattern) => pattern.test(text));
};

const hasToolBridgeResponse = (detail: Record<string, unknown>): boolean => {
  const text = flattenedDetailText(detail);
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

    if (!hasCurrentRunEvidence(item.detailJson)) {
      issues.push({
        severity: "error",
        code: "CURRENT_RUN_EVIDENCE_MISSING",
        caseNo: item.caseNo,
        message: "detail_json must include current-run evidence such as DOM/network/chart/screenshot/tool evidence."
      });
    }

    if (
      claimsToolBridgeAction(item.detailJson) &&
      !hasToolBridgeResponse(item.detailJson) &&
      !hasExternalToolBridgeResponse(item.caseNo, externalToolBridgeEvidenceByCase)
    ) {
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
