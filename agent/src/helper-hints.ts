import fs from "node:fs";
import path from "node:path";

export type HelperHints = {
  caseId: string | null;
  automationLevel: string | null;
  operationTemplate: string | null;
  params: unknown;
  requiredEvidence: string[];
  forbiddenAutomation: string[];
  aiDecisionRequired: boolean | null;
  raw: Record<string, unknown>;
  sourcePath: string;
  sourceRelativePath: string | null;
  warnings: string[];
};

export type HelperHintsSearchResult = {
  helperHints: HelperHints | null;
  searchedPaths: string[];
  warnings: string[];
};

const ALLOWED_AUTOMATION_LEVELS = new Set(["script_safe", "helper", "manual_ai", "blocked_if_no_helper"]);
const ALLOWED_OPERATION_TEMPLATES = new Set([
  "metadata_dropdown_compare",
  "collage_build_preview_save_reopen",
  "record_static_fields_date_payload",
  "metric_date_display_preview",
  "metric_filter_operator",
  "metric_group_series",
  "chart_csv_consistency",
  "collage_all_zero_field_inspection",
  "collage_date_variants_preview",
  "download_csv_verify",
  "save_load_flow",
  "manual_ai"
]);
const ALLOWED_EVIDENCE = new Set([
  "dom.state",
  "dom.list",
  "date.uiState",
  "date.representedRange",
  "network.requestBody",
  "network.responseBody",
  "chart.datasets",
  "csv.rows",
  "csv.aggregate",
  "screenshot",
  "toolBridge.response",
  "xlsx.readback"
]);
const REQUIRED_FORBIDDEN_AUTOMATION = ["direct_bi_api", "internal_js_setter", "multi_case_batch"];

const isAllowedEvidence = (value: string): boolean =>
  [...ALLOWED_EVIDENCE].some((base) => value === base || value.startsWith(`${base}.`));

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeCaseNo = (value: string): string => value.trim().replace(/\s+/g, "").toUpperCase();

const relativePath = (baseDir: string | undefined, filePath: string): string | null => {
  if (!baseDir) return null;
  return path.relative(baseDir, filePath).replaceAll(path.sep, "/");
};

const stringValue = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

const stringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
};

const PARAM_PASSTHROUGH_KEYS = [
  "referenceCsv",
  "referenceSourceName",
  "referenceSourcePath",
  "referenceIndexKey",
  "matchKey",
  "matchValue",
  "matchValueAliases",
  "compareFields",
  "comparisonScope",
  "expectedReportSourceCount",
  "expectedReportSources",
  "expectedTotalFieldCount",
  "expectedFieldCount"
];

const mergedParams = (raw: Record<string, unknown>): unknown => {
  const params = raw.params && typeof raw.params === "object" && !Array.isArray(raw.params)
    ? { ...(raw.params as Record<string, unknown>) }
    : {};
  for (const key of PARAM_PASSTHROUGH_KEYS) {
    if (raw[key] !== undefined && params[key] === undefined) params[key] = raw[key];
  }
  return params;
};

const firstHeadingSectionForCase = (markdown: string, caseNo: string): string | null => {
  const target = normalizeCaseNo(caseNo);
  const lines = markdown.split(/\r?\n/);
  const headingPattern = /^(#{1,6})\s+(.+?)\s*$/;
  let start = -1;
  let level = 7;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(headingPattern);
    if (!match) continue;
    const headingText = normalizeCaseNo(match[2] ?? "");
    if (!headingText.includes(target)) continue;
    start = index;
    level = match[1]?.length ?? 7;
    break;
  }

  if (start === -1) return null;

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index]?.match(headingPattern);
    if (match && (match[1]?.length ?? 7) <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
};

const extractHelperJsonAfterLabel = (markdown: string): { jsonText: string | null; warning: string | null } => {
  const label = markdown.match(/(^|\n)\s*(?:[-*]\s*)?(?:\*\*)?\s*Helper hints\s*(?:\*\*)?\s*:?\s*(?:\n|$)/i);
  if (!label || label.index === undefined) return { jsonText: null, warning: null };
  const afterLabel = markdown.slice(label.index + label[0].length);
  const block = afterLabel.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!block) return { jsonText: null, warning: "HELPER_HINTS_LABEL_WITHOUT_JSON_BLOCK" };
  return { jsonText: block[1]?.trim() ?? "", warning: null };
};

const extractHelperJsonByCaseId = (markdown: string, caseNo: string): string | null => {
  const target = normalizeCaseNo(caseNo);
  const codeBlockPattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of markdown.matchAll(codeBlockPattern)) {
    const jsonText = match[1]?.trim();
    if (!jsonText || !/"(?:automationLevel|operationTemplate|requiredEvidence)"\s*:/i.test(jsonText)) continue;
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const caseId = stringValue((parsed as Record<string, unknown>).caseId);
        if (caseId && normalizeCaseNo(caseId) === target) return jsonText;
      }
    } catch {
      // Ignore unrelated invalid JSON blocks during fallback search.
    }
  }
  return null;
};

const buildHelperHints = (
  raw: Record<string, unknown>,
  sourcePath: string,
  caseNo: string,
  baseDir: string | undefined,
  upstreamWarnings: string[]
): HelperHints => {
  const warnings = [...upstreamWarnings];
  const caseId = stringValue(raw.caseId);
  const automationLevel = stringValue(raw.automationLevel);
  const operationTemplate = stringValue(raw.operationTemplate);
  const requiredEvidence = stringArray(raw.requiredEvidence);
  const forbiddenAutomation = stringArray(raw.forbiddenAutomation);
  const aiDecisionRequired = typeof raw.aiDecisionRequired === "boolean" ? raw.aiDecisionRequired : null;

  if (caseId && normalizeCaseNo(caseId) !== normalizeCaseNo(caseNo)) {
    warnings.push(`HELPER_CASE_ID_MISMATCH:${caseId}`);
  }
  if (automationLevel && !ALLOWED_AUTOMATION_LEVELS.has(automationLevel)) {
    warnings.push(`UNKNOWN_AUTOMATION_LEVEL:${automationLevel}`);
  }
  if (operationTemplate && !ALLOWED_OPERATION_TEMPLATES.has(operationTemplate)) {
    warnings.push(`UNKNOWN_OPERATION_TEMPLATE:${operationTemplate}`);
  }
  for (const evidence of requiredEvidence) {
    if (!isAllowedEvidence(evidence)) warnings.push(`UNKNOWN_REQUIRED_EVIDENCE:${evidence}`);
  }
  for (const required of REQUIRED_FORBIDDEN_AUTOMATION) {
    if (!forbiddenAutomation.includes(required)) warnings.push(`MISSING_FORBIDDEN_AUTOMATION:${required}`);
  }

  return {
    caseId,
    automationLevel,
    operationTemplate,
    params: mergedParams(raw),
    requiredEvidence,
    forbiddenAutomation,
    aiDecisionRequired,
    raw,
    sourcePath,
    sourceRelativePath: relativePath(baseDir, sourcePath),
    warnings
  };
};

export const parseHelperHintsFromMarkdown = (
  markdown: string,
  caseNo: string,
  sourcePath: string,
  baseDir?: string
): { helperHints: HelperHints | null; warnings: string[] } => {
  const warnings: string[] = [];
  const caseSection = firstHeadingSectionForCase(markdown, caseNo);
  let jsonText: string | null = null;

  if (caseSection) {
    const extracted = extractHelperJsonAfterLabel(caseSection);
    jsonText = extracted.jsonText;
    if (extracted.warning) warnings.push(extracted.warning);
  }

  if (!jsonText) {
    jsonText = extractHelperJsonByCaseId(markdown, caseNo);
  }

  if (!jsonText) return { helperHints: null, warnings };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return {
      helperHints: null,
      warnings: [...warnings, `HELPER_HINTS_JSON_PARSE_FAILED:${error instanceof Error ? error.message : String(error)}`]
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { helperHints: null, warnings: [...warnings, "HELPER_HINTS_JSON_NOT_OBJECT"] };
  }

  return {
    helperHints: buildHelperHints(parsed as Record<string, unknown>, sourcePath, caseNo, baseDir, warnings),
    warnings: []
  };
};

export const findHelperHints = (sourcePaths: string[], caseNo: string, baseDir?: string): HelperHintsSearchResult => {
  const seen = new Set<string>();
  const searchedPaths: string[] = [];
  const warnings: string[] = [];

  for (const sourcePath of sourcePaths) {
    if (!sourcePath || seen.has(sourcePath)) continue;
    seen.add(sourcePath);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) continue;
    searchedPaths.push(sourcePath);
    const markdown = fs.readFileSync(sourcePath, "utf8");
    const parsed = parseHelperHintsFromMarkdown(markdown, caseNo, sourcePath, baseDir);
    warnings.push(...parsed.warnings.map((warning) => `${path.basename(sourcePath)}:${warning}`));
    if (parsed.helperHints) {
      return { helperHints: parsed.helperHints, searchedPaths, warnings };
    }
  }

  return { helperHints: null, searchedPaths, warnings };
};
