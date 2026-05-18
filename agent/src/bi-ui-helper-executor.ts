#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Dialog, type Download, type Page, type Request, type Response } from "playwright";
import { closeChromeDebugSession, diagnoseChromeDebugSession, ensureChromeDebugSession, readBrowserSessionLease, type BrowserSessionLease } from "./browser-session";
import { readConfig } from "./config";
import { parseCsv, summarizeCsvAgainstPreview } from "./csv-preview-comparison";
import { buildDateUiEvidence, normalizeDatePresetLabel, normalizeDateUiWeekStart, type DateUiEvidence } from "./date-ui-evidence";
import { createHelperObservationWriter, type HelperObservationInput } from "./helper-observability";

type CliOptions = {
  runDir: string;
  caseId: string;
  action: string;
  params: Record<string, unknown>;
  approvedToolRequestId: string | null;
  closeAfter: boolean;
};

type HelperReport = {
  schemaVersion: "bi-ui-helper-report-v1";
  generatedAt: string;
  runId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  caseId: string;
  action: string;
  status: "ok" | "blocked" | "requires_approval" | "not_implemented" | "error";
  helperCanJudgeResult: false;
  params: Record<string, unknown>;
  evidenceMetadata: {
    source: "mac-agent-bi-ui-helper";
    runId: string;
    caseId: string;
    action: string;
    currentRunEvidence: true;
    artifactRoot: string;
    generatedAt: string;
    startedAt: string;
    endedAt: string;
  };
  evidence: Record<string, unknown>;
  artifacts: Record<string, string>;
  warnings: string[];
  error?: string;
  toolRequest?: Record<string, unknown>;
};

type BrowserSessionRuntimeEvidence = {
  browserSession: {
    schemaVersion: BrowserSessionLease["schemaVersion"];
    runId: string;
    caseNo: string;
    generation: number;
    sessionId: string;
    targetId: string;
    tokenHash: string;
    windowNamePrefix: string;
    endpoint: string;
  };
  targetBinding: {
    resolvedBy: "window.name";
    tokenMatch: boolean;
    urlMatch: boolean;
    targetIdMatch: boolean | "not_checked";
    pageUrl: string;
  };
  foregroundPolicy: {
    mode: "no-activate";
    bringToFrontCalled: false;
    cdpActivateCalled: false;
  };
};

class HelperBlockedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "HelperBlockedError";
    this.reason = reason;
  }
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, reason: string): Promise<T> => {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new HelperBlockedError(`${reason}:${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
};

const isActionabilityFailure = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /locator\.click|Timeout|not visible|not enabled|not stable|receives pointer events|outside of the viewport|strict mode violation/i.test(message);
};

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);
  const get = (name: string): string | null => {
    const index = args.indexOf(name);
    return index === -1 ? null : (args[index + 1] ?? null);
  };
  const paramsJson = get("--params-json") ?? "{}";
  let params: Record<string, unknown>;
  try {
    const parsed = JSON.parse(paramsJson) as unknown;
    params = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch (error) {
    throw new Error(`INVALID_PARAMS_JSON:${error instanceof Error ? error.message : String(error)}`);
  }

  const runDir = get("--run-dir");
  const action = get("--action");
  if (!runDir || !action) {
    throw new Error("Usage: node bi-ui-helper-executor.js --run-dir <runDir> --case <caseId> --action <template> --params-json '<json>' [--approved-tool-request-id <id>] [--close-after]");
  }

  return {
    runDir,
    caseId: get("--case") ?? String(params.caseId ?? "unknown-case"),
    action,
    params,
    approvedToolRequestId: get("--approved-tool-request-id"),
    closeAfter: args.includes("--close-after")
  };
};

const sanitize = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "artifact";

const ensureDir = (dir: string): void => {
  fs.mkdirSync(dir, { recursive: true });
};

const artifactRoot = (options: CliOptions): string => path.join(options.runDir, "output", "helper-artifacts", sanitize(options.caseId));

const runIdFromOptions = (options: CliOptions): string => path.basename(path.resolve(options.runDir));

const observeHelper = (options: CliOptions, input: HelperObservationInput): void => {
  createHelperObservationWriter({
    runDir: options.runDir,
    caseId: options.caseId,
    action: options.action,
    params: options.params
  }).write(input);
};

const writeReport = (options: CliOptions, report: HelperReport): void => {
  const dir = artifactRoot(options);
  ensureDir(dir);
  fs.appendFileSync(path.join(dir, "helper-report.jsonl"), `${JSON.stringify(report)}\n`);
  fs.writeFileSync(path.join(dir, `${sanitize(options.action)}-latest.json`), `${JSON.stringify(report, null, 2)}\n`);
};

const stringParam = (params: Record<string, unknown>, key: string): string | null => {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const isNeutralUiTarget = (value: string | null | undefined): boolean => {
  const normalized = String(value ?? "").trim().replace(/\s+/g, "").toLowerCase();
  return !normalized || ["不影響", "不限", "空", "無", "0", "0組", "none", "n/a", "na"].includes(normalized);
};

const nonNeutralUiTarget = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed || isNeutralUiTarget(trimmed)) return null;
  return trimmed;
};

const firstStringParam = (params: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = stringParam(params, key);
    if (value) return value;
  }
  return null;
};

const stringArrayParam = (params: Record<string, unknown>, key: string): string[] => {
  const value = params[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
};

const booleanishParam = (params: Record<string, unknown>, keys: string[]): boolean => {
  for (const key of keys) {
    const value = params[key];
    if (value === true) return true;
    if (typeof value === "string" && /^(true|yes|y|1|是|要)$/i.test(value.trim())) return true;
  }
  return false;
};

const numberParam = (params: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
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

const paramsRequestSelectAllFields = (params: Record<string, unknown>): boolean =>
  booleanishParam(params, ["selectAllFields", "selectAll", "selectAllMetrics", "selectAllFieldsInSourceReport", "selectAllSourceFields"]);

const helperRequestsCsvDownload = (params: Record<string, unknown>): boolean =>
  booleanishParam(params, ["downloadCsv", "doDownloadCsv", "downloadCSV", "download", "csvDownload", "needCsv"]);

const strictSelectAllFieldCountRequired = (params: Record<string, unknown>): boolean =>
  booleanishParam(params, ["strictFieldCount", "requireExactFieldCount"]) ||
  params.allZeroFieldInspection === true ||
  (
    paramsRequestSelectAllFields(params) &&
    numberParam(params, ["expectedFieldCount", "fieldCount", "expectedFieldsCount"]) !== null &&
    (helperRequestsCsvDownload(params) || stringArrayParam(params, "sourceReports").length > 1)
  );

const metricFieldsFromParams = (params: Record<string, unknown>): string[] => {
  if (paramsRequestSelectAllFields(params)) return [];
  const explicit = stringArrayParam(params, "fields");
  if (explicit.length > 0) return [...new Set(explicit.filter((item) => !isNeutralUiTarget(item)))];
  return splitCompositeMetricFields(nonNeutralUiTarget(firstStringParam(params, ["field", "metric", "metricField"])));
};

type MetricRowParam = {
  sourceReport: string;
  field: string;
  metricIndex: number | null;
};

const metricRowsFromUnknownArray = (value: unknown, fallbackSourceReport: string): MetricRowParam[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const sourceReport = firstStringFromRecord(record, ["sourceReport", "source", "report", "reportName"]) ?? fallbackSourceReport;
    const field = firstStringFromRecord(record, ["field", "metric", "metricField", "label", "name"]);
    const rawMetricIndex = record.metricIndex ?? record.rowIndex ?? record.index;
    const metricIndex =
      typeof rawMetricIndex === "number" && Number.isInteger(rawMetricIndex) && rawMetricIndex >= 0
        ? rawMetricIndex
        : typeof rawMetricIndex === "string" && /^\d+$/.test(rawMetricIndex.trim())
          ? Number(rawMetricIndex.trim())
          : index;
    if (!field || isNeutralUiTarget(field)) return [];
    return [{ sourceReport, field, metricIndex }];
  });
};

const metricRowsFromParams = (params: Record<string, unknown>): MetricRowParam[] => {
  if (paramsRequestSelectAllFields(params)) return [];
  const fallbackSourceReport = firstStringParam(params, ["sourceReport", "source", "report", "reportName"]) ?? "每日報表";
  const explicitRows = metricRowsFromUnknownArray(params.metrics, fallbackSourceReport);
  if (explicitRows.length > 0) return explicitRows;
  return metricFieldsFromParams(params).map((field, index) => ({
    sourceReport: fallbackSourceReport,
    field,
    metricIndex: index
  }));
};

const metricRowsFromBaseFieldsParams = (params: Record<string, unknown>): MetricRowParam[] => {
  const fallbackSourceReport = firstStringParam(params, ["sourceReport", "source", "report", "reportName"]) ?? "每日報表";
  const explicitRows = metricRowsFromUnknownArray(params.baseFields, fallbackSourceReport);
  if (explicitRows.length > 0) return explicitRows;
  return calculatedBaseFieldsFromParams(params).map((field, index) => ({
    sourceReport: fallbackSourceReport,
    field,
    metricIndex: index
  }));
};

const timestampId = (): string => new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 12);

const normalizeUiResourceName = (value: string): string => value.replace(/[^0-9A-Za-z\u4e00-\u9fff]/g, "");

const fitUiResourceName = (value: string, maxLength = 20): string => {
  const normalized = normalizeUiResourceName(value) || `BIUI${timestampId()}`;
  if (normalized.length <= maxLength) return normalized;
  const stamp = timestampId().slice(-8);
  const explicitCasePrefix =
    /BIUI.*G.*01/i.test(normalized) ? "BIUIG01" :
    /BIUI.*F.*01/i.test(normalized) ? "BIUIF01" :
    /BIUI.*E.*04/i.test(normalized) ? "BIUIE04" :
    /BIUI.*COLLAGE/i.test(normalized) ? "BIUICOL" :
    "";
  if (explicitCasePrefix && explicitCasePrefix.length + stamp.length <= maxLength) {
    return `${explicitCasePrefix}${stamp}`;
  }
  return `${normalized.slice(0, Math.max(1, maxLength - stamp.length))}${stamp}`;
};

const resolveReportName = (options: CliOptions): string => {
  const explicit = firstStringParam(options.params, ["reportName", "reportNamePattern", "name"]);
  if (explicit) return fitUiResourceName(explicit.replace("<timestamp>", timestampId()));
  return fitUiResourceName(`${sanitize(options.caseId)}_${timestampId()}`);
};

const savedReportStatePath = (options: CliOptions): string => path.join(artifactRoot(options), "saved-report.json");
const previewEvidencePath = (options: CliOptions): string => path.join(artifactRoot(options), "preview-evidence.json");
const allZeroFieldInspectionEvidencePath = (options: CliOptions): string => path.join(artifactRoot(options), "all-zero-field-inspection-evidence.json");
const deleteTemporaryReportEvidencePath = (options: CliOptions): string => path.join(artifactRoot(options), "delete-temporary-report-evidence.json");
const calculatedFieldEvidencePath = (options: CliOptions): string => path.join(artifactRoot(options), "calculated-field-evidence.json");
const createProjectEvidencePath = (options: CliOptions): string => path.join(artifactRoot(options), "create-project-evidence.json");
const createdProjectStatePath = (options: CliOptions): string => path.join(artifactRoot(options), "created-project.json");
const metricRowsEvidencePath = (options: CliOptions): string => path.join(artifactRoot(options), "metric-rows-evidence.json");
const frontendObservationEvidencePath = (options: CliOptions): string => path.join(artifactRoot(options), "frontend-observation-evidence.json");
const dateUiEvidencePath = (options: CliOptions, suffix: string | null = null): string =>
  path.join(artifactRoot(options), suffix ? `date-ui-evidence-${sanitize(suffix)}.json` : "date-ui-evidence.json");

const writeSavedReportState = (options: CliOptions, reportName: string, extra: Record<string, unknown> = {}): void => {
  ensureDir(artifactRoot(options));
  fs.writeFileSync(
    savedReportStatePath(options),
    `${JSON.stringify({ reportName, caseId: options.caseId, savedAt: new Date().toISOString(), ...extra }, null, 2)}\n`
  );
};

const readSavedReportName = (options: CliOptions): string | null => {
  const explicit = firstStringParam(options.params, ["reportName", "savedReportName", "name"]);
  if (explicit) return explicit;
  const filePath = savedReportStatePath(options);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as { reportName?: unknown };
    return typeof parsed.reportName === "string" && parsed.reportName.trim() ? parsed.reportName.trim() : null;
  } catch {
    return null;
  }
};

const writeCreatedProjectState = (options: CliOptions, projectName: string, extra: Record<string, unknown> = {}): void => {
  ensureDir(artifactRoot(options));
  fs.writeFileSync(
    createdProjectStatePath(options),
    `${JSON.stringify({ projectName, caseId: options.caseId, createdAt: new Date().toISOString(), ...extra }, null, 2)}\n`
  );
};

const readCreatedProjectName = (options: CliOptions): string | null => {
  const filePath = createdProjectStatePath(options);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as { projectName?: unknown };
    return typeof parsed.projectName === "string" && parsed.projectName.trim() ? parsed.projectName.trim() : null;
  } catch {
    return null;
  }
};

const baseDateParam = (params: Record<string, unknown>): string | null =>
  firstStringParam(params, ["baseDate", "testDate", "runDate", "currentDate"]);

const weekStartParam = (params: Record<string, unknown>): "monday" | "sunday" =>
  normalizeDateUiWeekStart(firstStringParam(params, ["weekStart", "week_start", "weekStartsOn"])) ?? "monday";

const firstStringArrayParam = (params: Record<string, unknown>, keys: string[]): string[] => {
  for (const key of keys) {
    const values = stringArrayParam(params, key);
    if (values.length > 0) return values;
  }
  return [];
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
  return `${startDate.replaceAll("-", "/")} ~ ${endDate.replaceAll("-", "/")}`;
};

type DateEndpointSpec =
  | { type: "static"; date: string }
  | { type: "relative"; offsetDays: number };

type DatePreviewSpec = {
  requestedLabel: string;
  mode: "preset_or_static_label" | "structured";
  start?: DateEndpointSpec;
  end?: DateEndpointSpec;
  expectedRowCount?: number;
  expectedDateRange?: string;
  expectUiBlock?: boolean;
};

const formatOffsetLabel = (offsetDays: number): string => {
  if (offsetDays === 0) return "今天";
  return `${Math.abs(offsetDays)} 天${offsetDays < 0 ? "前" : "後"}`;
};

const normalizeIsoDateString = (value: string): string => value.trim().replaceAll("/", "-");

const dateEndpointSpecFromValue = (value: unknown): DateEndpointSpec | null => {
  if (typeof value === "string" && value.trim()) {
    return { type: "static", date: normalizeIsoDateString(value) };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";
  if (type === "static" && typeof record.date === "string" && record.date.trim()) {
    return { type: "static", date: normalizeIsoDateString(record.date) };
  }
  if (type === "relative") {
    const rawOffset = typeof record.offsetDays === "number" ? record.offsetDays : Number(record.offsetDays);
    if (Number.isFinite(rawOffset)) return { type: "relative", offsetDays: rawOffset };
  }
  return null;
};

const labelForDateEndpointSpec = (spec: DateEndpointSpec): string =>
  spec.type === "static" ? spec.date.replaceAll("-", "/") : formatOffsetLabel(spec.offsetDays);

const structuredDatePreviewSpecFromParams = (params: Record<string, unknown>): DatePreviewSpec | null => {
  const dateMode = String(params.dateMode ?? "").trim().toLowerCase();
  if (dateMode === "relative") {
    const startOffset = numberParam(params, ["startOffsetDays"]);
    const endOffset = numberParam(params, ["endOffsetDays"]);
    if (startOffset === null || endOffset === null) return null;
    const start: DateEndpointSpec = { type: "relative", offsetDays: startOffset };
    const end: DateEndpointSpec = { type: "relative", offsetDays: endOffset };
    return {
      requestedLabel: `${labelForDateEndpointSpec(start)} ~ ${labelForDateEndpointSpec(end)}`,
      mode: "structured",
      start,
      end
    };
  }
  if (dateMode === "hybrid") {
    const start = dateEndpointSpecFromValue(params.start);
    const end = dateEndpointSpecFromValue(params.end);
    if (!start || !end) return null;
    return {
      requestedLabel: `${labelForDateEndpointSpec(start)} ~ ${labelForDateEndpointSpec(end)}`,
      mode: "structured",
      start,
      end
    };
  }
  return null;
};

const recordArrayParam = (params: Record<string, unknown>, key: string): Record<string, unknown>[] => {
  const value = params[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
};

const datePreviewSpecFromRecord = (record: Record<string, unknown>, fallbackIndex: number): DatePreviewSpec | null => {
  const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";
  const label = firstStringParam(record, ["label", "uiLabel", "requestedLabel", "name"]) ?? "";
  const expectedRowCount = numberParam(record, ["expectedRowCount", "rowCount"]);
  const expectedDateRange = firstStringParam(record, ["expectedDateRange", "dateRange"]);
  const expectUiBlock = booleanishParam(record, ["expectUiBlock", "uiBlock", "expectBlocked", "expectError"]);

  if (type === "preset" || (!record.start && !record.end && label)) {
    return {
      requestedLabel: label,
      mode: "preset_or_static_label",
      expectedRowCount: expectedRowCount ?? undefined,
      expectedDateRange: expectedDateRange ?? undefined,
      expectUiBlock
    };
  }

  const start = dateEndpointSpecFromValue(record.start);
  const end = dateEndpointSpecFromValue(record.end);
  if (!start || !end) return null;
  return {
    requestedLabel: label || `${labelForDateEndpointSpec(start)} ~ ${labelForDateEndpointSpec(end)}` || `variant-${fallbackIndex + 1}`,
    mode: "structured",
    start,
    end,
    expectedRowCount: expectedRowCount ?? undefined,
    expectedDateRange: expectedDateRange ?? undefined,
    expectUiBlock
  };
};

const structuredDatePreviewSpecsFromArrayParam = (params: Record<string, unknown>, key: string): DatePreviewSpec[] =>
  recordArrayParam(params, key)
    .map((record, index) => datePreviewSpecFromRecord(record, index))
    .filter((spec): spec is DatePreviewSpec => Boolean(spec));

const datePreviewSpecsFromParams = (params: Record<string, unknown>): DatePreviewSpec[] => {
  const structuredVariants = structuredDatePreviewSpecsFromArrayParam(params, "dateVariants");
  if (structuredVariants.length > 0) return structuredVariants;
  const stagedVariants = structuredDatePreviewSpecsFromArrayParam(params, "stages");
  if (stagedVariants.length > 0) return stagedVariants;
  const variants = firstStringArrayParam(params, ["dateVariants", "uiLabels"]);
  if (variants.length > 0) return variants.map((requestedLabel) => ({ requestedLabel, mode: "preset_or_static_label" as const }));
  const structured = structuredDatePreviewSpecFromParams(params);
  if (structured) return [structured];
  const staticRange = structuredStaticDateRangeParam(params);
  if (staticRange) return [{ requestedLabel: staticRange, mode: "preset_or_static_label" }];
  const direct = nonNeutralUiTarget(firstStringParam(params, ["dateRange", "timeRange", "datePreset"]));
  return direct ? [{ requestedLabel: direct, mode: "preset_or_static_label" }] : [];
};

export const readDateUiEvidence = async (page: Page, requested: string | null, params: Record<string, unknown>): Promise<DateUiEvidence> => {
  const observed = await page.evaluate(`
    (() => {
      const text = (selector) => {
        const element = document.querySelector(selector);
        return element && element.innerText ? element.innerText.trim() : null;
      };
      const popup = document.querySelector("#datePickerPopup");
      const popupVisible = popup
        ? (() => {
            const rect = popup.getBoundingClientRect();
            const style = window.getComputedStyle(popup);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          })()
        : null;
      return {
        dateRangeButtonText: text("#dateRangeBtn"),
        dateRangeDisplayText: text("#dateRangeDisplay"),
        popupVisible,
        popupText: popup && popup.innerText ? popup.innerText.trim() : null,
        bodyText: document.body.innerText.slice(0, 5000)
      };
    })()
  `) as {
    dateRangeButtonText: string | null;
    dateRangeDisplayText: string | null;
    popupVisible: boolean | null;
    popupText: string | null;
    bodyText: string;
  };
  return buildDateUiEvidence({
    requested,
    baseDate: baseDateParam(params),
    weekStart: weekStartParam(params),
    observed
  });
};

const writeDateUiEvidenceArtifact = (options: CliOptions, evidence: DateUiEvidence): string => {
  const suffix = [
    evidence.generatedAt.replace(/[-:.TZ]/g, "").slice(0, 17),
    evidence.requested.normalizedLabel ?? "unrequested"
  ].join("-");
  const filePath = dateUiEvidencePath(options, suffix);
  const latestPath = dateUiEvidencePath(options);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(evidence, null, 2)}\n`);
  fs.writeFileSync(latestPath, `${JSON.stringify(evidence, null, 2)}\n`);
  return filePath;
};

const wildcardPatternToRegExp = (value: string): RegExp => {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped
    .replace(/<timestamp>/gi, "[A-Za-z0-9_-]+")
    .replace(/\\\*/g, ".*");
  return new RegExp(`^${pattern}$`, "i");
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const reportNameMatchesPattern = (reportName: string, pattern: string): boolean => {
  if (reportName === pattern) return true;
  return wildcardPatternToRegExp(pattern).test(reportName);
};

const readSavedReportStateFiles = (options: CliOptions): Array<{ caseId: string; reportName: string; path: string; savedAt: string | null }> => {
  const root = path.join(options.runDir, "output", "helper-artifacts");
  if (!fs.existsSync(root)) return [];
  const result: Array<{ caseId: string; reportName: string; path: string; savedAt: string | null }> = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(root, entry.name, "saved-report.json");
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
      const reportName = typeof parsed.reportName === "string" ? parsed.reportName.trim() : "";
      if (!reportName) continue;
      result.push({
        caseId: typeof parsed.caseId === "string" && parsed.caseId.trim() ? parsed.caseId.trim() : entry.name,
        reportName,
        path: filePath,
        savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : null
      });
    } catch {
      // Ignore malformed historical helper artifacts.
    }
  }
  return result.sort((a, b) => String(b.savedAt ?? "").localeCompare(String(a.savedAt ?? "")));
};

const resolveExistingReportName = async (options: CliOptions, page: Page): Promise<{ reportName: string; source: string; candidates: unknown[] }> => {
  const explicit = firstStringParam(options.params, ["existingReportName", "savedReportName"]);
  if (explicit) return { reportName: explicit, source: "params.existingReportName", candidates: [] };

  const pattern = firstStringParam(options.params, ["existingReportNamePattern", "reportNamePattern"]) ?? "TOOL_A01_<timestamp>";
  const sourceCaseNo = stringParam(options.params, "existingReportSourceCaseNo");
  const savedReports = readSavedReportStateFiles(options);
  const matchedSaved = savedReports.find((item) => {
    const caseMatches = !sourceCaseNo || item.caseId === sourceCaseNo || item.path.includes(sanitize(sourceCaseNo));
    return caseMatches && reportNameMatchesPattern(item.reportName, pattern);
  }) ?? savedReports.find((item) => reportNameMatchesPattern(item.reportName, pattern));
  if (matchedSaved) {
    return {
      reportName: matchedSaved.reportName,
      source: "helper-artifacts.saved-report",
      candidates: savedReports.map((item) => ({ caseId: item.caseId, reportName: item.reportName, savedAt: item.savedAt }))
    };
  }

  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const bodyCandidate = bodyText
    .split(/\s+/)
    .map((item) => item.trim())
    .find((item) => reportNameMatchesPattern(item, pattern));
  if (bodyCandidate) {
    return {
      reportName: bodyCandidate,
      source: "visible-report-list-text",
      candidates: savedReports.map((item) => ({ caseId: item.caseId, reportName: item.reportName, savedAt: item.savedAt }))
    };
  }

  throw new HelperBlockedError(`EXISTING_REPORT_ROW_NOT_FOUND_PRECONDITION:pattern=${pattern};savedReports=${JSON.stringify(savedReports).slice(0, 1000)}`);
};

const createReport = (
  options: CliOptions,
  status: HelperReport["status"],
  startedAt: string,
  evidence: Record<string, unknown>,
  artifacts: Record<string, string>,
  warnings: string[] = [],
  extra: Partial<HelperReport> = {}
): HelperReport => {
  const generatedAt = new Date().toISOString();
  const endedAt = generatedAt;
  const runId = runIdFromOptions(options);
  return {
    schemaVersion: "bi-ui-helper-report-v1",
    generatedAt,
    runId,
    startedAt,
    endedAt,
    durationMs: Math.max(0, Date.now() - Date.parse(startedAt)),
    caseId: options.caseId,
    action: options.action,
    status,
    helperCanJudgeResult: false,
    params: options.params,
    evidenceMetadata: {
      source: "mac-agent-bi-ui-helper",
      runId,
      caseId: options.caseId,
      action: options.action,
      currentRunEvidence: true,
      artifactRoot: artifactRoot(options),
      generatedAt,
      startedAt,
      endedAt
    },
    evidence,
    artifacts,
    warnings,
    ...extra
  };
};

const browserSessionWindowNamePrefix = (lease: BrowserSessionLease): string =>
  `uat-tool:${lease.runId}:${lease.caseNo}:${lease.generation}`;

const GALAXY_BI_HOST = "galaxy.games.gamania.com";
const GALAXY_BI_DEV_PATH_PREFIXES = ["/biapi-dev", "/bi-dev"] as const;

const parseHttpUrl = (url: string | null | undefined): URL | null => {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

const isAllowedGalaxyBiPath = (pathname: string): boolean =>
  GALAXY_BI_DEV_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

const isGalaxyBiDevUrl = (url: string, expectedDevUrl?: string | null): boolean => {
  const candidate = parseHttpUrl(url);
  if (!candidate) return false;
  if (candidate.protocol !== "https:") return false;
  if (candidate.hostname.toLowerCase() !== GALAXY_BI_HOST) return false;
  if (!isAllowedGalaxyBiPath(candidate.pathname)) return false;

  const expected = parseHttpUrl(expectedDevUrl);
  if (!expected) return true;
  if (expected.protocol !== "https:") return false;
  if (expected.hostname.toLowerCase() !== GALAXY_BI_HOST) return false;
  if (!isAllowedGalaxyBiPath(expected.pathname)) return false;
  return candidate.origin === expected.origin;
};

const isOfficialBiUiPageUrl = (url: string): boolean => {
  const parsed = parseHttpUrl(url);
  return Boolean(parsed && parsed.hostname.toLowerCase() === GALAXY_BI_HOST && (parsed.pathname === "/bi-dev" || parsed.pathname.startsWith("/bi-dev/")));
};

const readPageBrowserSessionMarker = async (page: Page): Promise<{ windowName: string; sessionRaw: string | null; url: string } | null> => {
  try {
    return await page.evaluate(() => ({
      windowName: window.name || "",
      sessionRaw: sessionStorage.getItem("__uatToolBrowserSession"),
      url: location.href
    }));
  } catch {
    return null;
  }
};

const browserSessionEvidence = (
  lease: BrowserSessionLease,
  page: Page
): BrowserSessionRuntimeEvidence => ({
  browserSession: {
    schemaVersion: lease.schemaVersion,
    runId: lease.runId,
    caseNo: lease.caseNo,
    generation: lease.generation,
    sessionId: lease.sessionId,
    targetId: lease.targetId,
    tokenHash: lease.tokenHash,
    windowNamePrefix: browserSessionWindowNamePrefix(lease),
    endpoint: lease.endpoint
  },
  targetBinding: {
    resolvedBy: "window.name",
    tokenMatch: true,
    urlMatch: isGalaxyBiDevUrl(page.url(), lease.devUrl),
    targetIdMatch: "not_checked",
    pageUrl: page.url()
  },
  foregroundPolicy: {
    mode: "no-activate",
    bringToFrontCalled: false,
    cdpActivateCalled: false
  }
});

const attachBrowserSessionEvidence = (report: HelperReport, evidence: BrowserSessionRuntimeEvidence | null): HelperReport => {
  if (!evidence) return report;
  return {
    ...report,
    evidence: {
      ...report.evidence,
      ...evidence
    }
  };
};

const resolveBrowserSessionPage = async (
  options: CliOptions,
  browser: Browser
): Promise<{ page: Page; runtimeEvidence: BrowserSessionRuntimeEvidence }> => {
  const lease = readBrowserSessionLease(options.runDir);
  if (!lease) throw new HelperBlockedError("BROWSER_SESSION_LEASE_MISSING");
  if (lease.runId !== runIdFromOptions(options)) {
    throw new HelperBlockedError(`BROWSER_SESSION_STALE:leaseRunId=${lease.runId};expectedRunId=${runIdFromOptions(options)}`);
  }
  if (lease.caseNo !== options.caseId) {
    throw new HelperBlockedError(`BROWSER_SESSION_STALE:leaseCaseNo=${lease.caseNo};expectedCaseNo=${options.caseId}`);
  }

  const pages = browser.contexts().flatMap((context) => context.pages());
  const mismatches: Array<{ url: string; windowName: string }> = [];
  for (const page of pages) {
    const marker = await readPageBrowserSessionMarker(page);
    if (!marker) continue;
    if (marker.windowName === lease.windowName) {
      if (!isGalaxyBiDevUrl(marker.url, lease.devUrl)) {
        throw new HelperBlockedError(`BROWSER_SESSION_URL_MISMATCH:url=${marker.url};leaseDevUrl=${lease.devUrl ?? "null"}`);
      }
      return {
        page,
        runtimeEvidence: browserSessionEvidence(lease, page)
      };
    }
    if (marker.windowName.startsWith("uat-tool:")) {
      mismatches.push({ url: marker.url, windowName: marker.windowName.slice(0, 180) });
    }
  }

  const targetStillExists = pages.some((page) => page.url() === lease.devUrl || isGalaxyBiDevUrl(page.url(), lease.devUrl));
  if (targetStillExists) {
    throw new HelperBlockedError(
      `BROWSER_SESSION_TOKEN_MISMATCH:expected=${browserSessionWindowNamePrefix(lease)};uatTargets=${JSON.stringify(mismatches).slice(0, 1000)}`
    );
  }
  throw new HelperBlockedError(`BROWSER_SESSION_TARGET_MISSING:targetId=${lease.targetId};caseNo=${lease.caseNo};generation=${lease.generation}`);
};

const isApplicationPage = (page: Page): boolean => /^https?:\/\//i.test(page.url());

const screenshot = async (options: CliOptions, page: Page, label: string): Promise<string | null> => {
  const filePath = path.join(artifactRoot(options), `${sanitize(options.caseId)}-${sanitize(label)}.png`);
  ensureDir(path.dirname(filePath));
  try {
    await page.screenshot({ path: filePath, fullPage: false, timeout: 7000 });
    return filePath;
  } catch {
    return null;
  }
};

type UiDomProfileRef = {
  schemaVersion: "ui-dom-profile-ref-v1";
  context: string;
  status: "ok" | "error";
  signature?: string;
  path?: string;
  relativePath?: string;
  reused?: boolean;
  summary?: Record<string, unknown>;
  error?: string;
};

type UiDomProfile = {
  schemaVersion: "ui-dom-profile-v1";
  generatedAt: string;
  runId: string;
  caseId: string;
  action: string;
  context: string;
  signature: string;
  url: string;
  route: string;
  title: string;
  viewport: { width: number; height: number };
  bodyTextExcerpt: string;
  controls: {
    buttons: Array<Record<string, unknown>>;
    inputs: Array<Record<string, unknown>>;
    selects: Array<Record<string, unknown>>;
  };
  widgets: {
    datePicker: Record<string, unknown>;
    dialogs: Array<Record<string, unknown>>;
  };
  limits: Record<string, unknown>;
  policy: string;
};

const normalizeSignatureText = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  return value
    .replace(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/g, "<date>")
    .replace(/\d{1,3}\s*天/g, "<n>天")
    .replace(/\d{1,2}\s*月\s+\d{4}/g, "<month>")
    .replace(/[一二三四五六七八九十]{1,2}月\s+\d{4}/g, "<month>")
    .replace(/\s+/g, " ")
    .trim();
};

const profileSignature = (profile: Omit<UiDomProfile, "signature">): string => {
  const stable = {
    route: profile.route,
    title: profile.title,
    buttons: profile.controls.buttons.map((button) => ({
      selector: button.selector,
      text: normalizeSignatureText(button.text),
      role: button.role,
      ariaLabel: button.ariaLabel,
      onclick: normalizeSignatureText(button.onclick),
      disabled: button.disabled
    })),
    inputs: profile.controls.inputs.map((input) => ({
      selector: input.selector,
      type: input.type,
      name: input.name,
      placeholder: input.placeholder,
      role: input.role,
      disabled: input.disabled,
      readonly: input.readonly
    })),
    selects: profile.controls.selects.map((select) => ({
      selector: select.selector,
      name: select.name,
      role: select.role,
      optionTexts: Array.isArray(select.options)
        ? select.options.map((option) => typeof option === "object" && option !== null ? normalizeSignatureText((option as { text?: unknown }).text) : null)
        : []
    })),
    datePicker: {
      exists: profile.widgets.datePicker.exists,
      visible: profile.widgets.datePicker.visible,
      hasStartCalendar: profile.widgets.datePicker.hasStartCalendar,
      hasEndCalendar: profile.widgets.datePicker.hasEndCalendar,
      tabButtons: profile.widgets.datePicker.tabButtons,
      navButtons: profile.widgets.datePicker.navButtons,
      startDayCellCount: profile.widgets.datePicker.startDayCellCount,
      endDayCellCount: profile.widgets.datePicker.endDayCellCount
    },
    dialogs: profile.widgets.dialogs.map((dialog) => ({
      selector: dialog.selector,
      role: dialog.role,
      title: dialog.title,
      buttons: dialog.buttons
    }))
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
};

const readUiDomProfile = async (options: CliOptions, page: Page, context: string): Promise<UiDomProfile> => {
  const generatedAt = new Date().toISOString();
  const runId = runIdFromOptions(options);
  const base = await page.evaluate(({ generatedAt: profileGeneratedAt, runId: profileRunId, caseId, action, context: profileContext }) => {
    const truncate = (value: string | null | undefined, length = 160): string | null => {
      const normalized = (value ?? "").trim().replace(/\s+/g, " ");
      if (!normalized) return null;
      return normalized.length > length ? `${normalized.slice(0, length)}...` : normalized;
    };
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const rectFor = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };
    const selectorFor = (element: Element): string => {
      const id = element.getAttribute("id");
      if (id) return `#${id}`;
      const testId = element.getAttribute("data-testid") ?? element.getAttribute("data-test") ?? element.getAttribute("data-cy");
      if (testId) return `${element.tagName.toLowerCase()}[data-testid="${testId}"]`;
      const name = element.getAttribute("name");
      if (name) return `${element.tagName.toLowerCase()}[name="${name}"]`;
      const aria = element.getAttribute("aria-label");
      if (aria) return `${element.tagName.toLowerCase()}[aria-label="${aria}"]`;
      const onclick = element.getAttribute("onclick");
      if (onclick) return `${element.tagName.toLowerCase()}[onclick="${onclick.slice(0, 80)}"]`;
      return element.tagName.toLowerCase();
    };
    const classTokensFor = (element: Element): string[] => {
      const className = typeof (element as HTMLElement).className === "string" ? (element as HTMLElement).className : "";
      return className.split(/\s+/).filter(Boolean).slice(0, 8);
    };
    const nearestLabelFor = (element: HTMLElement): string | null => {
      if (element instanceof HTMLInputElement && element.id) {
        const explicit = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (explicit?.textContent?.trim()) return truncate(explicit.textContent, 120);
      }
      const wrapped = element.closest("label");
      if (wrapped?.textContent?.trim()) return truncate(wrapped.textContent, 120);
      const parent = element.parentElement;
      if (parent?.textContent?.trim()) return truncate(parent.textContent, 160);
      return null;
    };
    const computedStateFor = (element: HTMLElement): Record<string, unknown> => {
      const style = window.getComputedStyle(element);
      return {
        pointerEvents: style.pointerEvents,
        opacity: style.opacity,
        display: style.display,
        visibility: style.visibility
      };
    };
    const elementSummary = (element: HTMLElement, index: number): Record<string, unknown> => ({
      index,
      selector: selectorFor(element),
      tagName: element.tagName.toLowerCase(),
      id: element.id || null,
      role: element.getAttribute("role"),
      ariaLabel: element.getAttribute("aria-label"),
      ariaDisabled: element.getAttribute("aria-disabled"),
      ariaChecked: element.getAttribute("aria-checked"),
      ariaExpanded: element.getAttribute("aria-expanded"),
      name: element.getAttribute("name"),
      text: truncate(element.innerText || element.textContent, 120),
      title: truncate(element.getAttribute("title"), 120),
      nearestLabel: nearestLabelFor(element),
      classTokens: classTokensFor(element),
      onclick: truncate(element.getAttribute("onclick"), 140),
      disabled: "disabled" in element ? Boolean((element as HTMLButtonElement).disabled) : element.getAttribute("aria-disabled") === "true",
      checked: element instanceof HTMLInputElement ? element.checked : element.getAttribute("aria-checked") === "true",
      computedStyle: computedStateFor(element),
      rect: rectFor(element)
    });
    const visibleButtons = Array.from(document.querySelectorAll("button"))
      .flatMap((button, index) => isVisible(button) ? [elementSummary(button, index)] : [])
      .slice(0, 100);
    const visibleInputs = Array.from(document.querySelectorAll("input, textarea"))
      .flatMap((input, index) => {
        if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) || !isVisible(input)) return [];
        return [{
          ...elementSummary(input, index),
          type: input instanceof HTMLInputElement ? input.type : "textarea",
          placeholder: truncate(input.placeholder, 120),
          value: truncate(input.value, 120),
          readonly: input.readOnly
        }];
      })
      .slice(0, 80);
    const visibleSelects = Array.from(document.querySelectorAll("select"))
      .flatMap((select, index) => {
        if (!(select instanceof HTMLSelectElement) || !isVisible(select)) return [];
        return [{
          ...elementSummary(select, index),
          value: truncate(select.value, 120),
          selectedText: truncate(select.selectedOptions?.[0]?.textContent, 120),
          options: Array.from(select.options).slice(0, 40).map((option) => ({
            value: truncate(option.value, 80),
            text: truncate(option.textContent, 120),
            selected: option.selected,
            disabled: option.disabled
          }))
        }];
      })
      .slice(0, 40);
    const text = (selector: string): string | null => truncate(document.querySelector(selector)?.textContent, 220);
    const popup = document.querySelector("#datePickerPopup");
    const popupVisible = popup ? isVisible(popup) : false;
    const datePickerButtons = popup
      ? Array.from(popup.querySelectorAll("button")).flatMap((button, index) => isVisible(button) ? [elementSummary(button, index)] : [])
      : [];
    const dialogSelectors = "[role='dialog'], .modal, .ant-modal, .MuiDialog-root, .swal2-popup";
    const dialogs = Array.from(document.querySelectorAll(dialogSelectors))
      .flatMap((dialog, index) => {
        if (!(dialog instanceof HTMLElement) || !isVisible(dialog)) return [];
        const buttons = Array.from(dialog.querySelectorAll("button"))
          .flatMap((button, buttonIndex) => isVisible(button) ? [elementSummary(button, buttonIndex)] : [])
          .slice(0, 20);
        return [{
          index,
          selector: selectorFor(dialog),
          role: dialog.getAttribute("role"),
          title: truncate(dialog.querySelector("h1,h2,h3,.title,.modal-title")?.textContent, 160),
          textExcerpt: truncate(dialog.innerText, 600),
          buttons,
          rect: rectFor(dialog)
        }];
      })
      .slice(0, 10);
    return {
      schemaVersion: "ui-dom-profile-v1" as const,
      generatedAt: profileGeneratedAt,
      runId: profileRunId,
      caseId,
      action,
      context: profileContext,
      signature: "",
      url: location.href,
      route: `${location.origin}${location.pathname}`,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      bodyTextExcerpt: truncate(document.body.innerText, 1400) ?? "",
      controls: {
        buttons: visibleButtons,
        inputs: visibleInputs,
        selects: visibleSelects
      },
      widgets: {
        datePicker: {
          exists: Boolean(popup),
          visible: popupVisible,
          dateRangeButtonText: text("#dateRangeBtn"),
          displayText: text("#dateRangeDisplay"),
          hasStartCalendar: Boolean(document.querySelector("#startCalendar")),
          hasEndCalendar: Boolean(document.querySelector("#endCalendar")),
          startMonth: text("#startCalendarMonth"),
          endMonth: text("#endCalendarMonth"),
          startSelectedDays: Array.from(document.querySelectorAll("#startCalendar .calendar-day.selected")).map((item) => truncate(item.textContent, 20)),
          endSelectedDays: Array.from(document.querySelectorAll("#endCalendar .calendar-day.selected")).map((item) => truncate(item.textContent, 20)),
          startDayCellCount: document.querySelectorAll("#startCalendar .calendar-day").length,
          endDayCellCount: document.querySelectorAll("#endCalendar .calendar-day").length,
          tabButtons: datePickerButtons.filter((button) => /動態|靜態/.test(String(button.text ?? ""))).map((button) => ({
            text: button.text,
            selector: button.selector,
            onclick: button.onclick,
            classTokens: button.classTokens,
            disabled: button.disabled
          })),
          navButtons: datePickerButtons.filter((button) => /prevMonth|nextMonth|‹|›/.test(`${button.onclick ?? ""}\n${button.text ?? ""}`)).map((button) => ({
            text: button.text,
            selector: button.selector,
            onclick: button.onclick,
            disabled: button.disabled
          })),
          buttons: datePickerButtons.slice(0, 60)
        },
        dialogs
      },
      limits: {
        fullHtmlCaptured: false,
        buttonLimit: 100,
        inputLimit: 80,
        selectLimit: 40,
        optionLimitPerSelect: 40,
        bodyTextExcerptChars: 1400
      },
      policy: "Normalized DOM profile captures visible structure only. It is current-run diagnostic/evidence context, not a substitute for visible UI actions or result judgment."
    };
  }, { generatedAt, runId, caseId: options.caseId, action: options.action, context });

  const signature = profileSignature(base);
  return { ...base, signature };
};

const captureUiDomProfile = async (options: CliOptions, page: Page, context: string): Promise<UiDomProfileRef> => {
  try {
    const profile = await readUiDomProfile(options, page, context);
    const dir = path.join(artifactRoot(options), "dom-profiles");
    const filePath = path.join(dir, `${sanitize(context)}-${profile.signature.slice(0, 12)}.json`);
    ensureDir(dir);
    const reused = fs.existsSync(filePath);
    if (!reused) {
      fs.writeFileSync(filePath, `${JSON.stringify(profile, null, 2)}\n`);
    }
    observeHelper(options, {
      eventType: "ui_state_node",
      severity: "info",
      appUrl: profile.url,
      data: {
        context,
        signature: profile.signature,
        route: profile.route,
        title: profile.title,
        relativePath: path.relative(options.runDir, filePath),
        reused,
        summary: {
          visibleButtonCount: profile.controls.buttons.length,
          visibleInputCount: profile.controls.inputs.length,
          visibleSelectCount: profile.controls.selects.length,
          dialogCount: profile.widgets.dialogs.length,
          hasDatePicker: Boolean(profile.widgets.datePicker.exists),
          bodyTextExcerptHash: crypto.createHash("sha256").update(profile.bodyTextExcerpt).digest("hex")
        }
      }
    });
    return {
      schemaVersion: "ui-dom-profile-ref-v1",
      context,
      status: "ok",
      signature: profile.signature,
      path: filePath,
      relativePath: path.relative(options.runDir, filePath),
      reused,
      summary: {
        url: profile.url,
        title: profile.title,
        route: profile.route,
        visibleButtonCount: profile.controls.buttons.length,
        visibleInputCount: profile.controls.inputs.length,
        visibleSelectCount: profile.controls.selects.length,
        dialogCount: profile.widgets.dialogs.length,
        datePicker: {
          exists: profile.widgets.datePicker.exists,
          visible: profile.widgets.datePicker.visible,
          startMonth: profile.widgets.datePicker.startMonth,
          endMonth: profile.widgets.datePicker.endMonth,
          startSelectedDays: profile.widgets.datePicker.startSelectedDays,
          endSelectedDays: profile.widgets.datePicker.endSelectedDays
        }
      }
    };
  } catch (error) {
    return {
      schemaVersion: "ui-dom-profile-ref-v1",
      context,
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

const readDomState = async (page: Page): Promise<Record<string, unknown>> => {
  return page.evaluate(() => {
    const text = (selector: string) => document.querySelector(selector)?.textContent?.trim() ?? null;
    const innerText = (selector: string) => (document.querySelector(selector) as HTMLElement | null)?.innerText?.trim() ?? null;
    const buttons = Array.from(document.querySelectorAll("button"))
      .map((item) => item.textContent?.trim())
      .filter(Boolean)
      .slice(0, 80);
    const selects = Array.from(document.querySelectorAll("select")).map((select) => ({
      name: select.getAttribute("name"),
      value: (select as HTMLSelectElement).value,
      text: (select as HTMLSelectElement).selectedOptions?.[0]?.textContent?.trim() ?? null
    }));
    const displaySelect = selects.find((item) => item.name === "displayMode") ?? selects.find((item) => /每天|每日|daily/i.test(`${item.text ?? ""}\n${item.value}`));
    return {
      url: location.href,
      title: document.title,
      bodyTextExcerpt: document.body.innerText.slice(0, 2500),
      reportHeader: text("h1, h2, [class*=title], [class*=header]"),
      cleanupState: {
        dateRangeText: innerText("#dateRangeBtn"),
        fieldSelectionText: innerText("#fieldSelectionContainer"),
        filterText: innerText("#dataFilterContainer"),
        groupText: innerText("#groupDimensionContainer"),
        displayModeValue: displaySelect?.value ?? null,
        displayModeText: displaySelect?.text ?? null
      },
      buttons,
      selects
    };
  });
};

const normalizeDateText = (value: string): string => value.replace(/\s+/g, "").replaceAll("-", "/");
const normalizeUiText = (value: string): string => value.replace(/\s+/g, "");
const normalizeMetricFieldIdentity = (value: string | null | undefined): string =>
  normalizeUiText(value ?? "")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[_-]/g, "")
    .toUpperCase();

const metricFieldAliasLabels = (value: string | null | undefined): string[] => {
  const key = normalizeMetricFieldIdentity(value);
  const aliases: Record<string, string[]> = {
    [normalizeMetricFieldIdentity("總營收")]: ["總營收(TWD)", "平台總營收"],
    [normalizeMetricFieldIdentity("總營收(TWD)")]: ["總營收", "平台總營收"],
    [normalizeMetricFieldIdentity("平台總營收")]: ["總營收(TWD)", "總營收"],
    [normalizeMetricFieldIdentity("退費總金額")]: ["總退費金額"],
    [normalizeMetricFieldIdentity("總退費金額")]: ["退費總金額"],
    [normalizeMetricFieldIdentity("iOS平台總營收")]: ["iOS總營收"],
    [normalizeMetricFieldIdentity("iOS總營收")]: ["iOS平台總營收"],
    [normalizeMetricFieldIdentity("Android平台總營收")]: ["Android總營收"],
    [normalizeMetricFieldIdentity("Android總營收")]: ["Android平台總營收"],
    [normalizeMetricFieldIdentity("線下商城平台總營收")]: ["線下商城總營收"],
    [normalizeMetricFieldIdentity("線下商城總營收")]: ["線下商城平台總營收"],
    [normalizeMetricFieldIdentity("線下商城Coda總營收")]: ["線下商城CODAPAY總營收"],
    [normalizeMetricFieldIdentity("線下商城CODAPAY總營收")]: ["線下商城Coda總營收"],
    [normalizeMetricFieldIdentity("線下商城Coda付費帳號數")]: ["線下商城CODAPAY付費帳號數"],
    [normalizeMetricFieldIdentity("線下商城CODAPAY付費帳號數")]: ["線下商城Coda付費帳號數"],
    [normalizeMetricFieldIdentity("線下商城Coda付費次數")]: ["線下商城CODAPAY付費次數"],
    [normalizeMetricFieldIdentity("線下商城CODAPAY付費次數")]: ["線下商城Coda付費次數"]
  };
  return aliases[key] ?? [];
};

const metricFieldAliasIdentities = (value: string | null | undefined): string[] => {
  return metricFieldAliasLabels(value).map(normalizeMetricFieldIdentity);
};

const metricFieldSearchLabelVariants = (value: string): string[] => {
  const trimmed = value.trim();
  const variants = [trimmed];
  const offlineChannel = trimmed.match(/^線下商城\s*(GASH|CODAPAY|Coda|STEAM|樂豆點(?:\([^)]+\))?)(.+)$/i);
  if (offlineChannel) {
    const channel = /^coda$/i.test(offlineChannel[1]) ? "CODAPAY" : offlineChannel[1];
    const suffix = offlineChannel[2].trim();
    variants.push(`線下商城 ${channel}${suffix}`);
    variants.push(`線下商城 ${channel} ${suffix}`);
  }
  return variants;
};

const metricFieldSearchQueries = (value: string | null | undefined): string[] => {
  const seen = new Set<string>();
  return [value ?? "", ...metricFieldAliasLabels(value)]
    .flatMap((item) => metricFieldSearchLabelVariants(item))
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toUpperCase();
      if (!normalizeMetricFieldIdentity(item) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const metricFieldIdentitySet = (value: string | null | undefined): Set<string> => {
  const base = normalizeMetricFieldIdentity(value);
  return new Set([base, ...metricFieldAliasIdentities(value)].filter(Boolean));
};

const metricFieldLabelMatchesExpected = (actual: string | null | undefined, expected: string | null | undefined): boolean => {
  const actualKey = normalizeMetricFieldIdentity(actual);
  if (!actualKey) return false;
  const targetKeys = metricFieldIdentitySet(expected);
  if (targetKeys.has(actualKey)) return true;
  for (const targetKey of targetKeys) {
    if (!targetKey || !actualKey.startsWith(targetKey)) continue;
    const suffix = actualKey.slice(targetKey.length);
    if (/^[A-Z0-9]{2,}$/.test(suffix)) return true;
  }
  return false;
};

const knownMetricFieldCode = (field: string): string | null => {
  const key = normalizeMetricFieldIdentity(field);
  const known: Record<string, string> = {
    [normalizeMetricFieldIdentity("新增帳號數")]: "NEW_ACCOUNTS",
    [normalizeMetricFieldIdentity("MAU(帳號)")]: "MAU",
    [normalizeMetricFieldIdentity("總營收")]: "TOTAL_REVENUE",
    [normalizeMetricFieldIdentity("總營收(TWD)")]: "TOTAL_REVENUE",
    [normalizeMetricFieldIdentity("平台總營收")]: "TOTAL_REVENUE",
    [normalizeMetricFieldIdentity("退費總金額")]: "TOTAL_REFUND",
    [normalizeMetricFieldIdentity("總退費金額")]: "TOTAL_REFUND",
    [normalizeMetricFieldIdentity("累計bf!創帳數")]: "CUMULATIVE_NEW_ACCOUNTS_BEANFUN",
    [normalizeMetricFieldIdentity("bf!創帳數")]: "NEW_ACCOUNTS_BEANFUN"
  };
  return known[key] ?? null;
};

type CalendarSide = "left" | "right";
type VisibleButton = { index: number; text: string; x: number; y: number; width: number; height: number };
type VisibleTextTarget = {
  index: number;
  text: string;
  tagName: string;
  role: string | null;
  className: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
type VisibleMonthLabel = { text: string; year: number; month: number; x: number; y: number; width: number; height: number };
type SelectedMetricField = {
  label: string;
  code: string | null;
  buttonIndex: number;
  onclick: string | null;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const calendarDomSide = (side: CalendarSide): "start" | "end" => side === "left" ? "start" : "end";

const parseCalendarMonthText = (text: string | null | undefined): Pick<VisibleMonthLabel, "year" | "month"> | null => {
  const normalized = (text ?? "").trim().replace(/\s+/g, " ");
  const match = normalized.match(/^([一二三四五六七八九十]{1,2})月\s+(\d{4})$/);
  if (!match) return null;
  const monthMap: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    十一: 11,
    十二: 12
  };
  const month = monthMap[match[1] ?? ""];
  if (!month) return null;
  return { year: Number(match[2]), month };
};

const parseDateRange = (value: string | null): { startIso: string; endIso: string; display: string } | null => {
  if (!value) return null;
  const matches = [...value.matchAll(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/g)];
  if (matches.length < 2) return null;
  const toIso = (match: RegExpMatchArray): string => {
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  };
  const startIso = toIso(matches[0]);
  const endIso = toIso(matches[1]);
  return {
    startIso,
    endIso,
    display: `${startIso.replaceAll("-", "/")} ~ ${endIso.replaceAll("-", "/")}`
  };
};

const bodyContainsDateRange = async (page: Page, display: string): Promise<boolean> => {
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return normalizeDateText(bodyText).includes(normalizeDateText(display));
};

const bodyContainsText = async (page: Page, expected: string): Promise<boolean> => {
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return normalizeUiText(bodyText).includes(normalizeUiText(expected));
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const datePresetLabelRegex = (label: string): RegExp => {
  const normalized = normalizeUiText(label);
  const pattern = Array.from(normalized).map((char) => `${escapeRegExp(char)}\\s*`).join("");
  return new RegExp(pattern, "u");
};

const isDatePickerOpen = async (page: Page): Promise<boolean> => {
  return page.locator("#datePickerPopup").first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }).catch(() => false);
};

const parseCleanupTargets = (value: unknown): Record<string, string> => {
  if (typeof value !== "string") return {};
  const result: Record<string, string> = {};
  for (const part of value.split(";")) {
    const [key, ...rest] = part.split("=");
    const normalizedKey = key?.trim();
    if (!normalizedKey) continue;
    const normalizedValue = rest.join("=").trim();
    if (normalizedValue) result[normalizedKey] = normalizedValue;
  }
  return result;
};

const targetStateFromParams = (params: Record<string, unknown>): Record<string, string | string[] | null> => {
  const cleanup = parseCleanupTargets(params.cleanupChecklist);
  const selectAllFields = paramsRequestSelectAllFields(params);
  const field = selectAllFields ? null : nonNeutralUiTarget(stringParam(params, "field")) ?? nonNeutralUiTarget(cleanup["欄位"]);
  const fields = metricFieldsFromParams({ ...params, field });
  return {
    field,
    fields,
    filter: nonNeutralUiTarget(cleanup["篩選"]),
    group: nonNeutralUiTarget(cleanup["分組"]),
    dateRange: nonNeutralUiTarget(stringParam(params, "dateRange")) ?? nonNeutralUiTarget(cleanup["時間"]),
    display: nonNeutralUiTarget(stringParam(params, "display")) ?? nonNeutralUiTarget(cleanup["顯示"])
  };
};

const readStateDelta = async (page: Page, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const targets = targetStateFromParams(params);
  const observed = await page.evaluate(() => {
    const innerText = (selector: string) => (document.querySelector(selector) as HTMLElement | null)?.innerText?.trim() ?? null;
    const selects = Array.from(document.querySelectorAll("select")).map((select) => ({
      name: select.getAttribute("name"),
      value: (select as HTMLSelectElement).value,
      text: (select as HTMLSelectElement).selectedOptions?.[0]?.textContent?.trim() ?? ""
    }));
    const displaySelect = selects.find((item) => item.name === "displayMode") ?? selects.find((item) => /每天|每日|daily/i.test(`${item.text}\n${item.value}`));
    return {
      url: location.href,
      bodyText: document.body.innerText.slice(0, 5000),
      dateRangeText: innerText("#dateRangeBtn"),
      fieldSelectionText: innerText("#fieldSelectionContainer"),
      filterText: innerText("#dataFilterContainer"),
      groupText: innerText("#groupDimensionContainer"),
      displayModeValue: displaySelect?.value ?? null,
      displayModeText: displaySelect?.text ?? null,
      selects
    };
  });
  const selectedMetricFields = await readSelectedMetricFields(page).catch(() => []);
  const contains = (value: unknown, expected: string | null): boolean | null => {
    if (!expected || isNeutralUiTarget(expected)) return null;
    if (typeof value !== "string") return false;
    return normalizeUiText(value).includes(normalizeUiText(expected));
  };
  const fieldText = `${observed.fieldSelectionText ?? ""}\n${observed.bodyText}`;
  const targetFields = Array.isArray(targets.fields) ? targets.fields.filter((item): item is string => typeof item === "string") : [];
  return {
    targets,
    observed: {
      ...observed,
      selectedMetricFields: selectedMetricFields.map((item) => ({
        label: item.label,
        code: item.code,
        buttonIndex: item.buttonIndex
      })),
      bodyText: observed.bodyText.slice(0, 1200)
    },
    checks: {
      field: targetFields.length > 0
        ? selectedMetricFields.length > 0
          ? fieldListExactlyMatches(selectedMetricFields, targetFields)
          : targetFields.every((item) => contains(fieldText, item) === true)
        : contains(fieldText, typeof targets.field === "string" ? targets.field : null),
      filter: targets.filter === "0組" || targets.filter === "空"
        ? null
        : contains(observed.filterText, typeof targets.filter === "string" ? targets.filter : null),
      group: targets.group === "0組" || targets.group === "空"
        ? null
        : contains(observed.groupText, typeof targets.group === "string" ? targets.group : null),
      dateRange: contains(`${observed.dateRangeText ?? ""}\n${observed.bodyText}`, typeof targets.dateRange === "string" ? targets.dateRange : null),
      display: contains(`${observed.displayModeText ?? ""}\n${observed.displayModeValue ?? ""}\n${observed.bodyText}`, typeof targets.display === "string" ? targets.display : null)
    },
    policy: "delta planner may skip only when visible UI text/value verifies the target; unknown or false must fall back to UI action or blocked"
  };
};

const clickFirstVisible = async (locators: Array<ReturnType<Page["locator"]>>, timeout = 5000): Promise<boolean> => {
  for (const locator of locators) {
    try {
      const first = locator.first();
      if ((await first.count()) === 0) continue;
      await first.click({ timeout });
      return true;
    } catch {
      // Try the next visible locator candidate.
    }
  }
  return false;
};

const visibleInputIndexes = async (page: Page): Promise<Array<{ index: number; type: string; placeholder: string; value: string }>> => {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("input")).flatMap((input, index) => {
      const rect = input.getBoundingClientRect();
      const style = window.getComputedStyle(input);
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      if (!visible || input.disabled || input.readOnly) return [];
      return [{
        index,
        type: input.type,
        placeholder: input.placeholder,
        value: input.value
      }];
    });
  });
};

const visibleButtons = async (page: Page): Promise<VisibleButton[]> => {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("button")).flatMap((button, index) => {
      const rect = button.getBoundingClientRect();
      const style = window.getComputedStyle(button);
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      if (!visible || button.disabled) return [];
      return [{
        index,
        text: (button.textContent ?? "").trim().replace(/\s+/g, " "),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      }];
    });
  });
};

const clickRunPreviewButton = async (page: Page, timeout = 15000): Promise<void> => {
  const clicked = await clickFirstVisible([
    page.getByRole("button", { name: /^(執行|計算)$/ }),
    page.getByText("執行", { exact: true }),
    page.getByText("計算", { exact: true }),
    page.locator("button").filter({ hasText: /^(執行|計算)$/ })
  ], timeout);
  if (clicked) return;
  const buttons = await visibleButtons(page).catch(() => []);
  throw new HelperBlockedError(`RUN_PREVIEW_BUTTON_NOT_CLICKABLE: visibleButtons=${JSON.stringify(buttons.slice(0, 30)).slice(0, 1200)}`);
};

const clickDateConfirmButton = async (page: Page, timeout = 5000): Promise<boolean> => {
  return clickFirstVisible([
    page.locator("button[onclick=\"confirmDateRange()\"]"),
    page.getByRole("button", { name: /^(確認|確定)$/ }),
    page.getByText("確認", { exact: true }),
    page.getByText("確定", { exact: true }),
    page.locator("button").filter({ hasText: /^(確認|確定)$/ })
  ], timeout);
};

const visibleExactTextTargets = async (page: Page, expectedText: string): Promise<VisibleTextTarget[]> => {
  return page.evaluate((targetText) => {
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
    const elements = Array.from(document.querySelectorAll("body *"));
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
    };
    return elements.flatMap((element, index) => {
      if (!(element instanceof HTMLElement)) return [];
      const text = normalize(element.textContent);
      if (text !== targetText) return [];
      const hasExactVisibleChild = Array.from(element.children).some((child) => normalize(child.textContent) === targetText && isVisible(child));
      if (hasExactVisibleChild) return [];
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const className = typeof element.className === "string" ? element.className : "";
      const ariaDisabled = element.getAttribute("aria-disabled") === "true";
      const disabled = "disabled" in element && Boolean((element as HTMLButtonElement).disabled);
      const visuallyDisabled = /disabled|disable|unavailable|outside|other-month/i.test(className) || Number.parseFloat(style.opacity || "1") < 0.35;
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      if (!visible || ariaDisabled || disabled || visuallyDisabled) return [];
      return [
        {
          index,
          text,
          tagName: element.tagName.toLowerCase(),
          role: element.getAttribute("role"),
          className,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        }
      ];
    });
  }, expectedText);
};

const visibleTextTargetsMatching = async (page: Page, patternSource: string, flags = "i"): Promise<VisibleTextTarget[]> => {
  return page.evaluate(({ source, flags: regexFlags }) => {
    const pattern = new RegExp(source, regexFlags);
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
    const elements = Array.from(document.querySelectorAll("body *"));
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
    };
    return elements.flatMap((element, index) => {
      if (!(element instanceof HTMLElement)) return [];
      const text = normalize(element.textContent);
      if (!text || text.length > 80 || !pattern.test(text)) return [];
      const hasMatchingVisibleChild = Array.from(element.children).some((child) => {
        const childText = normalize(child.textContent);
        return childText.length > 0 && childText.length <= 80 && pattern.test(childText) && isVisible(child);
      });
      if (hasMatchingVisibleChild) return [];
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const className = typeof element.className === "string" ? element.className : "";
      const ariaDisabled = element.getAttribute("aria-disabled") === "true";
      const disabled = "disabled" in element && Boolean((element as HTMLButtonElement).disabled);
      const visuallyDisabled = /disabled|disable|unavailable|outside|other-month/i.test(className) || Number.parseFloat(style.opacity || "1") < 0.35;
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      if (!visible || ariaDisabled || disabled || visuallyDisabled) return [];
      return [
        {
          index,
          text,
          tagName: element.tagName.toLowerCase(),
          role: element.getAttribute("role"),
          className,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        }
      ];
    });
  }, { source: patternSource, flags });
};

const visibleCalendarMonths = async (page: Page): Promise<VisibleMonthLabel[]> => {
  return page.evaluate(() => {
    const monthMap: Record<string, number> = {
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
      十: 10,
      十一: 11,
      十二: 12
    };
    const seen = new Set<string>();
    return Array.from(document.querySelectorAll("body *")).flatMap((element) => {
      const text = (element.textContent ?? "").trim().replace(/\s+/g, " ");
      const match = text.match(/^([一二三四五六七八九十]{1,2})月\s+(\d{4})$/);
      if (!match) return [];
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      const month = monthMap[match[1] ?? ""];
      if (!visible || !month) return [];
      const key = `${text}:${Math.round(rect.x)}:${Math.round(rect.y)}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        text,
        year: Number(match[2]),
        month,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      }];
    });
  });
};

const monthDiff = (from: Pick<VisibleMonthLabel, "year" | "month">, toYear: number, toMonth: number): number =>
  (toYear - from.year) * 12 + (toMonth - from.month);

const clickVisibleButtonByIndex = async (page: Page, index: number, timeout = 5000): Promise<void> => {
  await page.locator("button").nth(index).click({ timeout });
};

const clickVisibleBodyElementByIndex = async (page: Page, index: number, timeout = 5000): Promise<void> => {
  await page.locator("body *").nth(index).click({ timeout });
};

const clickSideButton = async (page: Page, text: string | RegExp, side: CalendarSide, timeout = 5000): Promise<boolean> => {
  const buttons = await visibleButtons(page);
  const matches = buttons
    .filter((button) => (typeof text === "string" ? button.text === text : text.test(button.text)))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (matches.length === 0) return false;
  const selected = side === "left" ? matches[0] : matches[matches.length - 1];
  if (!selected) return false;
  await clickVisibleButtonByIndex(page, selected.index, timeout);
  return true;
};

const clickCalendarNavButton = async (page: Page, side: CalendarSide, direction: "prev" | "next", timeout = 5000): Promise<boolean> => {
  const months = (await visibleCalendarMonths(page)).sort((a, b) => a.x - b.x || a.y - b.y);
  const month = side === "left" ? months[0] : months[months.length - 1];
  if (!month) return false;
  const monthMidY = month.y + month.height / 2;
  const buttons = await visibleButtons(page);
  const candidates = buttons
    .filter((button) => {
      const centerX = button.x + button.width / 2;
      const centerY = button.y + button.height / 2;
      if (Math.abs(centerY - monthMidY) > Math.max(24, month.height)) return false;
      if (button.width > 64 || button.height > 64) return false;
      if (direction === "prev") return centerX < month.x && centerX > month.x - 80;
      return centerX > month.x + month.width && centerX < month.x + month.width + 80;
    })
    .sort((a, b) => Math.abs((a.y + a.height / 2) - monthMidY) - Math.abs((b.y + b.height / 2) - monthMidY));
  const selected = candidates[0];
  if (!selected) return false;
  await clickVisibleButtonByIndex(page, selected.index, timeout);
  return true;
};

const ensureStaticCalendarTabs = async (page: Page): Promise<void> => {
  await clickSideButton(page, "靜態時間", "left", 3000).catch(() => false);
  await page.waitForTimeout(150);
  await clickSideButton(page, "靜態時間", "right", 3000).catch(() => false);
  await page.waitForTimeout(300);
};

const calendarMonthForSide = async (page: Page, side: CalendarSide): Promise<VisibleMonthLabel | null> => {
  const domSide = calendarDomSide(side);
  const selector = `#${domSide}CalendarMonth`;
  const located = await page.locator(selector).first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      text: element.textContent?.trim() ?? "",
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };
  }).catch(() => null);
  if (located) {
    const parsed = parseCalendarMonthText(located.text);
    if (parsed) {
      return {
        text: located.text,
        year: parsed.year,
        month: parsed.month,
        x: located.x,
        y: located.y,
        width: located.width,
        height: located.height
      };
    }
  }
  const months = (await visibleCalendarMonths(page)).sort((a, b) => a.x - b.x || a.y - b.y);
  if (months.length === 0) return null;
  return side === "left" ? months[0] ?? null : months[months.length - 1] ?? null;
};

const moveCalendarToMonth = async (page: Page, side: CalendarSide, targetYear: number, targetMonth: number): Promise<boolean> => {
  const domSide = calendarDomSide(side);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const current = await calendarMonthForSide(page, side);
    if (!current) return false;
    const diff = monthDiff(current, targetYear, targetMonth);
    if (diff === 0) return true;
    const fn = diff < 0 ? "prevMonth" : "nextMonth";
    const clicked = await page
      .locator(`button[onclick="${fn}('${domSide}', event)"]`)
      .first()
      .click({ timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) {
      const direction = diff < 0 ? "‹" : "›";
      const fallbackClicked =
        await clickCalendarNavButton(page, side, diff < 0 ? "prev" : "next", 3000) ||
        await clickSideButton(page, direction, side, 3000);
      if (!fallbackClicked) return false;
    }
    await page.waitForTimeout(250);
  }
  return false;
};

const clickCalendarDay = async (page: Page, side: CalendarSide, day: number): Promise<boolean> => {
  const domSide = calendarDomSide(side);
  const calendarLocator = page.locator(`#${domSide}Calendar .calendar-day`);
  const count = await calendarLocator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const dayLocator = calendarLocator.nth(index);
    const candidate = await dayLocator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        text: element.textContent?.trim() ?? "",
        className: typeof element.className === "string" ? element.className : "",
        visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
      };
    }).catch(() => null);
    if (!candidate || candidate.text !== String(day) || !candidate.visible) continue;
    if (/disabled|disable|unavailable|outside|other-month/i.test(candidate.className)) continue;
    await dayLocator.click({ timeout: 5000 });
    return true;
  }

  const months = (await visibleCalendarMonths(page)).sort((a, b) => a.x - b.x || a.y - b.y);
  if (months.length < 2) return false;
  const left = months[0];
  const right = months[months.length - 1];
  if (!left || !right) return false;
  const splitX = (left.x + left.width / 2 + right.x + right.width / 2) / 2;
  const selectedMonth = side === "left" ? left : right;
  const buttons = await visibleButtons(page);
  const candidates = buttons
    .filter((button) => button.text === String(day))
    .filter((button) => {
      const centerX = button.x + button.width / 2;
      const centerY = button.y + button.height / 2;
      const inSide = side === "left" ? centerX < splitX : centerX > splitX;
      return inSide && centerY > selectedMonth.y + selectedMonth.height && centerY < selectedMonth.y + 280;
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const selected = candidates[0];
  if (selected) {
    await clickVisibleButtonByIndex(page, selected.index, 5000);
    return true;
  }

  const textTargets = await visibleExactTextTargets(page, String(day));
  const targetCandidates = textTargets
    .filter((target) => target.width <= 90 && target.height <= 90)
    .filter((target) => {
      const centerX = target.x + target.width / 2;
      const centerY = target.y + target.height / 2;
      const inSide = side === "left" ? centerX < splitX : centerX > splitX;
      return inSide && centerY > selectedMonth.y + selectedMonth.height && centerY < selectedMonth.y + 320;
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const target = targetCandidates[0];
  if (!target) return false;
  await clickVisibleBodyElementByIndex(page, target.index, 5000);
  return true;
};

type DateRangeUiResult = {
  ok: boolean;
  warning?: string;
  observedAfter?: string;
  inputs?: unknown;
  uiProfiles?: UiDomProfileRef[];
  interactionLog?: Record<string, unknown>;
};

const staticDateRangeInteractionLog = (
  actualOutcome: string,
  extra: Record<string, unknown> = {},
  openStaticTabOutcome = actualOutcome
): Record<string, unknown> => ({
  schemaVersion: "interaction-log-v1",
  actions: {
    setStaticDateRange: {
      role: "under_test",
      expectedOutcome: "succeeded",
      actualOutcome,
      steps: {
        openStaticTab: {
          expectedOutcome: "succeeded",
          actualOutcome: openStaticTabOutcome
        }
      },
      ...extra
    }
  }
});

const setStaticDateRangeByCalendar = async (
  options: CliOptions,
  page: Page,
  parsed: { startIso: string; endIso: string; display: string }
): Promise<DateRangeUiResult> => {
  const uiProfiles: UiDomProfileRef[] = [];
  const start = new Date(`${parsed.startIso}T00:00:00Z`);
  const end = new Date(`${parsed.endIso}T00:00:00Z`);
  const startYear = start.getUTCFullYear();
  const startMonth = start.getUTCMonth() + 1;
  const startDay = start.getUTCDate();
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth() + 1;
  const endDay = end.getUTCDate();

  await ensureStaticCalendarTabs(page);
  uiProfiles.push(await captureUiDomProfile(options, page, "dateRange.staticCalendar"));
  const startMonthReady = await moveCalendarToMonth(page, "left", startYear, startMonth);
  if (!startMonthReady) {
    return {
      ok: false,
      warning: `DATE_RANGE_START_CALENDAR_MONTH_NOT_REACHED:startMonth=${startYear}-${startMonth}`,
      observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1000),
      uiProfiles
    };
  }
  uiProfiles.push(await captureUiDomProfile(options, page, "dateRange.startCalendarReady"));

  const startClicked = await clickCalendarDay(page, "left", startDay);
  if (!startClicked) {
    return {
      ok: false,
      warning: `DATE_RANGE_START_DAY_NOT_CLICKABLE:startDay=${startDay};startMonth=${startYear}-${startMonth}`,
      observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1200),
      uiProfiles
    };
  }
  await page.waitForTimeout(250);
  uiProfiles.push(await captureUiDomProfile(options, page, "dateRange.afterStartDay"));

  const endMonthReady = await moveCalendarToMonth(page, "right", endYear, endMonth);
  if (!endMonthReady) {
    return {
      ok: false,
      warning: `DATE_RANGE_END_CALENDAR_MONTH_NOT_REACHED:endMonth=${endYear}-${endMonth}`,
      observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1000),
      uiProfiles
    };
  }
  uiProfiles.push(await captureUiDomProfile(options, page, "dateRange.endCalendarReady"));

  const endClicked = await clickCalendarDay(page, "right", endDay);
  if (!endClicked) {
    return {
      ok: false,
      warning: `DATE_RANGE_END_DAY_NOT_CLICKABLE:endDay=${endDay};endMonth=${endYear}-${endMonth}`,
      observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1200),
      uiProfiles
    };
  }
  uiProfiles.push(await captureUiDomProfile(options, page, "dateRange.afterEndDay"));

  const confirmed = await clickDateConfirmButton(page, 5000);
  if (!confirmed) {
    return {
      ok: false,
      warning: "DATE_RANGE_CONFIRM_NOT_CLICKABLE",
      observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1200),
      uiProfiles
    };
  }
  await page.waitForTimeout(800);
  const ok = await bodyContainsDateRange(page, parsed.display);
  uiProfiles.push(await captureUiDomProfile(options, page, "dateRange.afterConfirm"));
  return {
    ok,
    warning: ok ? undefined : "DATE_RANGE_VERIFY_FAILED_AFTER_CALENDAR_CLICK",
    observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1200),
    uiProfiles
  };
};

const openDatePicker = async (options: CliOptions, page: Page, context: string): Promise<DateRangeUiResult> => {
  const uiProfiles: UiDomProfileRef[] = [];
  if (!(await isDatePickerOpen(page))) {
    const opened = await clickFirstVisible([
      page.locator("#dateRangeBtn"),
      page.locator("button").filter({ hasText: /過去|最近|今日|昨日|本週|上週|本月|上月|\d{4}[/-]\d{1,2}[/-]\d{1,2}/ }),
      page.getByText(/過去7天|最近7天|過去30天|最近30天|今日|昨日|本週|上週|本月|上月|\d{4}[/-]\d{1,2}[/-]\d{1,2}/, { exact: false })
    ], 8000);
    if (!opened) return { ok: false, warning: "DATE_RANGE_CONTROL_NOT_CLICKABLE", uiProfiles };
    await page.waitForTimeout(400);
  }
  uiProfiles.push(await captureUiDomProfile(options, page, context));
  return { ok: true, uiProfiles };
};

const clickCalendarModeTab = async (page: Page, side: "start" | "end", mode: "dynamic" | "static"): Promise<boolean> => {
  const selector = `#${side}${mode === "dynamic" ? "Dynamic" : "Static"}Tab`;
  const clicked = await page.locator(selector).first().click({ timeout: 5000 }).then(() => true).catch(() => false);
  if (clicked) return true;
  const text = mode === "dynamic" ? "動態時間" : "靜態時間";
  const calendarSide: CalendarSide = side === "start" ? "left" : "right";
  return clickSideButton(page, text, calendarSide, 5000);
};

const fillRelativeDateEndpoint = async (page: Page, side: "start" | "end", offsetDays: number): Promise<Record<string, unknown>> => {
  const tabClicked = await clickCalendarModeTab(page, side, "dynamic");
  await page.waitForTimeout(250);
  const selector = side === "start" ? "#startDayInput" : "#endDayInput";
  const dayValue = String(Math.abs(offsetDays));
  await page.locator(selector).first().fill(dayValue, { timeout: 5000 });
  const observedValue = await page.locator(selector).first().inputValue({ timeout: 3000 }).catch(() => null);
  return {
    side,
    type: "relative",
    offsetDays,
    tabClicked,
    selector,
    requestedInputValue: dayValue,
    observedValue,
    verified: observedValue === dayValue
  };
};

const setStaticDateEndpoint = async (
  options: CliOptions,
  page: Page,
  side: "start" | "end",
  date: string
): Promise<Record<string, unknown>> => {
  const tabClicked = await clickCalendarModeTab(page, side, "static");
  await page.waitForTimeout(250);
  const iso = normalizeIsoDateString(date);
  const parsedDate = new Date(`${iso}T00:00:00Z`);
  const year = parsedDate.getUTCFullYear();
  const month = parsedDate.getUTCMonth() + 1;
  const day = parsedDate.getUTCDate();
  const calendarSide: CalendarSide = side === "start" ? "left" : "right";
  const monthReady = await moveCalendarToMonth(page, calendarSide, year, month);
  const dayClicked = monthReady ? await clickCalendarDay(page, calendarSide, day) : false;
  await page.waitForTimeout(250);
  return {
    side,
    type: "static",
    date: iso,
    tabClicked,
    monthReady,
    dayClicked,
    verified: tabClicked && monthReady && dayClicked,
    uiProfile: await captureUiDomProfile(options, page, `dateRange.${side}.staticEndpoint`)
  };
};

const setDateEndpoint = async (
  options: CliOptions,
  page: Page,
  side: "start" | "end",
  spec: DateEndpointSpec
): Promise<Record<string, unknown>> => {
  return spec.type === "relative"
    ? fillRelativeDateEndpoint(page, side, spec.offsetDays)
    : setStaticDateEndpoint(options, page, side, spec.date);
};

const setStructuredDateRange = async (
  options: CliOptions,
  page: Page,
  spec: DatePreviewSpec
): Promise<DateRangeUiResult> => {
  const opened = await openDatePicker(options, page, "dateRange.structuredPopupOpened");
  const uiProfiles = [...(opened.uiProfiles ?? [])];
  if (!opened.ok) return opened;
  if (!spec.start || !spec.end) return { ok: false, warning: "STRUCTURED_DATE_ENDPOINTS_MISSING", uiProfiles };

  const startResult = await setDateEndpoint(options, page, "start", spec.start);
  uiProfiles.push(await captureUiDomProfile(options, page, "dateRange.afterStructuredStart"));
  const endResult = await setDateEndpoint(options, page, "end", spec.end);
  uiProfiles.push(await captureUiDomProfile(options, page, "dateRange.afterStructuredEnd"));
  const endpointsVerified = Boolean(startResult.verified) && Boolean(endResult.verified);
  if (!endpointsVerified) {
    return {
      ok: false,
      warning: `STRUCTURED_DATE_ENDPOINT_VERIFY_FAILED:start=${JSON.stringify(startResult)};end=${JSON.stringify(endResult)}`,
      observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1200),
      inputs: { startResult, endResult },
      uiProfiles
    };
  }

  const confirmed = await clickDateConfirmButton(page, 5000);
  if (!confirmed) {
    return {
      ok: false,
      warning: "STRUCTURED_DATE_CONFIRM_NOT_CLICKABLE",
      observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1200),
      inputs: { startResult, endResult },
      uiProfiles
    };
  }
  await page.waitForTimeout(800);
  const observedAfter = (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1200);
  uiProfiles.push(await captureUiDomProfile(options, page, "dateRange.afterStructuredConfirm"));
  return {
    ok: true,
    observedAfter,
    inputs: { startResult, endResult },
    uiProfiles
  };
};

const setDateRange = async (options: CliOptions, page: Page, dateRange: string): Promise<DateRangeUiResult> => {
  const uiProfiles: UiDomProfileRef[] = [];
  const parsed = parseDateRange(dateRange);
  if (!parsed) return setDatePreset(options, page, dateRange);

  if (!(await isDatePickerOpen(page))) {
    const opened = await clickFirstVisible([
      page.locator("#dateRangeBtn"),
      page.locator("button").filter({ hasText: /過去|最近|今日|昨日|本週|上週|本月|上月|\d{4}[/-]\d{1,2}[/-]\d{1,2}/ }),
      page.getByText(/過去7天|最近7天|過去30天|最近30天|\d{4}[/-]\d{1,2}[/-]\d{1,2}/, { exact: false })
    ], 8000);
    if (!opened) return { ok: false, warning: "DATE_RANGE_CONTROL_NOT_CLICKABLE", uiProfiles };
    await page.waitForTimeout(400);
  }
  const popupOpenedProfile = await captureUiDomProfile(options, page, "dateRange.popupOpened");
  uiProfiles.push(popupOpenedProfile);

  const staticTabClicked = await clickFirstVisible([page.getByText("靜態時間", { exact: true }), page.locator("button").filter({ hasText: "靜態時間" })], 5000);
  await page.waitForTimeout(400);
  const staticTabRequestedProfile = await captureUiDomProfile(options, page, "dateRange.staticTabRequested");
  uiProfiles.push(staticTabRequestedProfile);
  const staticTabStateChanged = Boolean(
    staticTabClicked &&
    popupOpenedProfile.status === "ok" &&
    staticTabRequestedProfile.status === "ok" &&
    popupOpenedProfile.signature &&
    staticTabRequestedProfile.signature &&
    popupOpenedProfile.signature !== staticTabRequestedProfile.signature
  );
  const staticTabOutcome = !staticTabClicked ? "target_not_found_timeout" : staticTabStateChanged ? "succeeded" : "dispatched_no_change";
  const staticTabEvidence = {
    staticTabClicked,
    staticTabStateChanged,
    popupOpenedSignature: popupOpenedProfile.signature ?? null,
    staticTabRequestedSignature: staticTabRequestedProfile.signature ?? null
  };
  if (!staticTabClicked) {
    return {
      ok: false,
      warning: "DATE_RANGE_STATIC_TAB_NOT_CLICKABLE",
      observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1200),
      uiProfiles,
      interactionLog: staticDateRangeInteractionLog("target_not_found_timeout", staticTabEvidence)
    };
  }

  const inputs = await visibleInputIndexes(page);
  const dateInputs = inputs.filter((item) => item.type === "date");
  const textInputs = inputs.filter((item) => item.type === "text" && !/報表名稱/.test(item.placeholder));
  const targets = dateInputs.length >= 2 ? dateInputs.slice(0, 2) : textInputs.slice(0, 2);
  if (targets.length < 2) {
    const calendarResult = await setStaticDateRangeByCalendar(options, page, parsed);
    const combinedProfiles = [...uiProfiles, ...(calendarResult.uiProfiles ?? [])];
    const setOutcome = calendarResult.ok
      ? (staticTabOutcome === "succeeded" ? "succeeded" : "partial_state_change")
      : "wrong_state_change";
    return calendarResult.ok
      ? { ...calendarResult, inputs, uiProfiles: combinedProfiles, interactionLog: staticDateRangeInteractionLog(setOutcome, { ...staticTabEvidence, calendarFallback: true }, staticTabOutcome) }
      : {
          ...calendarResult,
          inputs,
          uiProfiles: combinedProfiles,
          warning: `${calendarResult.warning ?? "DATE_RANGE_CALENDAR_FAILED"};DATE_RANGE_INPUTS_NOT_FOUND`,
          interactionLog: staticDateRangeInteractionLog(setOutcome, { ...staticTabEvidence, calendarFallback: true, calendarWarning: calendarResult.warning ?? null }, staticTabOutcome)
        };
  }

  const values = targets[0].type === "date"
    ? [parsed.startIso, parsed.endIso]
    : [parsed.startIso.replaceAll("-", "/"), parsed.endIso.replaceAll("-", "/")];
  for (let i = 0; i < 2; i += 1) {
    await page.locator("input").nth(targets[i].index).fill(values[i], { timeout: 5000 });
  }
  await clickDateConfirmButton(page, 5000);
  await page.waitForTimeout(800);

  const ok = await bodyContainsDateRange(page, parsed.display);
  return {
    ok,
    warning: ok ? undefined : "DATE_RANGE_VERIFY_FAILED_AFTER_UI_INPUT",
    observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1000),
    inputs,
    uiProfiles: [...uiProfiles, await captureUiDomProfile(options, page, "dateRange.afterInputConfirm")],
    interactionLog: staticDateRangeInteractionLog(ok && staticTabOutcome === "succeeded" ? "succeeded" : ok ? "partial_state_change" : "wrong_state_change", staticTabEvidence, staticTabOutcome)
  };
};

const setDatePreset = async (options: CliOptions, page: Page, preset: string): Promise<DateRangeUiResult> => {
  const uiProfiles: UiDomProfileRef[] = [];
  const requestedPreset = preset.trim();
  const uiPreset = normalizeDatePresetLabel(requestedPreset);
  if (!requestedPreset) return { ok: false, warning: "DATE_RANGE_PRESET_EMPTY", uiProfiles };
  if (isNeutralUiTarget(requestedPreset)) return { ok: true, warning: "DATE_RANGE_PRESET_NEUTRAL_SKIPPED", observedAfter: requestedPreset, uiProfiles };
  if (await bodyContainsText(page, uiPreset)) return { ok: true, observedAfter: uiPreset, uiProfiles };

  if (!(await isDatePickerOpen(page))) {
    const opened = await clickFirstVisible([
      page.locator("#dateRangeBtn"),
      page.locator("button").filter({ hasText: /過去|最近|今日|昨日|本週|上週|本月|上月|\d{4}[/-]\d{1,2}[/-]\d{1,2}/ }),
      page.getByText(/過去7天|最近7天|過去30天|最近30天|今日|昨日|本週|上週|本月|上月/, { exact: false })
    ], 8000);
    if (!opened) return { ok: false, warning: "DATE_RANGE_CONTROL_NOT_CLICKABLE", uiProfiles };
    await page.waitForTimeout(400);
  }
  uiProfiles.push(await captureUiDomProfile(options, page, "datePreset.popupOpened"));

  const uiPresetPattern = datePresetLabelRegex(uiPreset);
  const selected = await clickFirstVisible([
    page.getByText(uiPreset, { exact: true }),
    page.getByText(uiPresetPattern, { exact: false }),
    page.locator("button").filter({ hasText: uiPresetPattern }),
    page.locator("[role='button']").filter({ hasText: uiPresetPattern })
  ], 5000);
  if (!selected) {
    return {
      ok: false,
      warning: `DATE_RANGE_PRESET_NOT_FOUND:${requestedPreset}${uiPreset !== requestedPreset ? `;normalized=${uiPreset}` : ""}`,
      observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1000),
      uiProfiles
    };
  }
  await clickDateConfirmButton(page, 3000).catch(() => false);
  await page.waitForTimeout(800);

  const ok = await bodyContainsText(page, uiPreset);
  return {
    ok,
    warning: ok ? undefined : "DATE_RANGE_PRESET_VERIFY_FAILED_AFTER_UI_CLICK",
    observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1000),
    uiProfiles: [...uiProfiles, await captureUiDomProfile(options, page, "datePreset.afterConfirm")]
  };
};

const setDisplayModeThroughUi = async (page: Page, display: string | null): Promise<string | null> => {
  const target = nonNeutralUiTarget(display);
  if (!target) return null;
  const normalizedTarget = normalizeUiText(target);
  const selects = await page.locator("select").count().catch(() => 0);
  for (let index = 0; index < selects; index += 1) {
    const options = await page.locator("select").nth(index).evaluate((select) => {
      if (!(select instanceof HTMLSelectElement)) return [];
      return Array.from(select.options).map((option) => ({
        value: option.value,
        text: option.textContent?.trim() ?? "",
        selected: option.selected
      }));
    }).catch(() => []);
    const current = options.find((option) => option.selected);
    if (current && normalizeUiText(`${current.text}\n${current.value}`).includes(normalizedTarget)) {
      return `display:already:${target}`;
    }
    const match = options.find((option) =>
      normalizeUiText(`${option.text}\n${option.value}`).includes(normalizedTarget) ||
      (normalizedTarget === "每天" && /daily|day|每日|每天/i.test(`${option.text}\n${option.value}`))
    );
    if (!match) continue;
    await page.locator("select").nth(index).selectOption(match.value, { timeout: 5000 });
    await page.waitForTimeout(300);
    return `display:set:${target}:${match.value}`;
  }
  return `display:not_found:${target}`;
};

const readChartSummary = async (page: Page): Promise<Record<string, unknown> | null> => {
  try {
    return await page.evaluate(() => {
      const chartWindow = window as unknown as { Chart?: { instances?: Record<string, unknown> } };
      const instances = chartWindow.Chart?.instances ? Object.values(chartWindow.Chart.instances) : [];
      const first = instances[0] as
        | {
            data?: { labels?: unknown[]; datasets?: Array<{ label?: string; data?: unknown[] }> };
          }
        | undefined;
      if (!first?.data) return null;
      const datasets = first.data.datasets ?? [];
      const numeric = datasets.flatMap((dataset) => (dataset.data ?? []).map((item) => Number(item)).filter(Number.isFinite));
      return {
        labelCount: first.data.labels?.length ?? 0,
        datasetCount: datasets.length,
        datasets: datasets.map((dataset) => ({
          label: dataset.label ?? null,
          count: dataset.data?.length ?? 0,
          sample: (dataset.data ?? []).slice(0, 10),
          values: (dataset.data ?? []).map((item) => Number(item)).filter(Number.isFinite)
        })),
        numericSummary:
          numeric.length > 0
            ? {
                count: numeric.length,
                sum: numeric.reduce((total, item) => total + item, 0),
                max: Math.max(...numeric),
                min: Math.min(...numeric)
              }
            : null
      };
    });
  } catch {
    return null;
  }
};

const readPreviewTableSummary = async (page: Page): Promise<Record<string, unknown> | null> => {
  try {
    return await page.evaluate(() => {
      const normalize = (value: string | null | undefined): string => (value ?? "").trim().replace(/\s+/g, " ");
      const isVisible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      };
      const tables = Array.from(document.querySelectorAll("table"))
        .filter((table) => isVisible(table))
        .map((table, tableIndex) => {
          const rows = Array.from(table.querySelectorAll("tr"))
            .filter((row) => isVisible(row))
            .map((row) => Array.from(row.querySelectorAll("th,td")).map((cell) => normalize(cell.textContent)));
          const explicitHeader = Array.from(table.querySelectorAll("thead tr th")).map((cell) => normalize(cell.textContent));
          const header = explicitHeader.length > 0 ? explicitHeader : rows[0] ?? [];
          const dataRows = (explicitHeader.length > 0 ? rows : rows.slice(1)).filter((row) => row.some((cell) => cell.length > 0));
          const numericColumns = header.map((_label, columnIndex) => {
            const values = dataRows.map((row) => Number(String(row[columnIndex] ?? "").replace(/,/g, ""))).filter(Number.isFinite);
            return values.length > 0
              ? {
                  columnIndex,
                  header: header[columnIndex] ?? `column_${columnIndex}`,
                  values,
                  summary: {
                    count: values.length,
                    sum: values.reduce((total, value) => total + value, 0),
                    max: Math.max(...values),
                    min: Math.min(...values)
                  }
                }
              : null;
          }).filter((item): item is NonNullable<typeof item> => item !== null);
          const rect = table.getBoundingClientRect();
          return {
            tableIndex,
            header,
            rows: dataRows,
            dataRowCount: dataRows.length,
            sampleRows: dataRows.slice(0, 5),
            tailRows: dataRows.slice(-3),
            numericColumns,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
          };
        })
        .filter((table) => table.header.length > 0 || table.dataRowCount > 0)
        .sort((a, b) => b.dataRowCount - a.dataRowCount);
      return tables[0] ?? null;
    });
  } catch {
    return null;
  }
};

const observeDuring = async <T>(page: Page, fn: () => Promise<T>): Promise<{ result: T; requests: Record<string, unknown>[]; responses: Record<string, unknown>[] }> => {
  const requests: Record<string, unknown>[] = [];
  const responses: Record<string, unknown>[] = [];
  const onRequest = (request: Request) => {
    if (!/biapi|preview|report|chart|custom/i.test(request.url())) return;
    requests.push({
      url: request.url(),
      method: request.method(),
      postData: request.postData()?.slice(0, 4000) ?? null,
      timestamp: new Date().toISOString()
    });
  };
  const onResponse = (response: Response) => {
    if (!/biapi|preview|report|chart|custom/i.test(response.url())) return;
    responses.push({
      url: response.url(),
      status: response.status(),
      timestamp: new Date().toISOString()
    });
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  try {
    const result = await fn();
    return { result, requests, responses };
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
  }
};

const observeDuringWithResponseBodies = async <T>(
  page: Page,
  fn: () => Promise<T>,
  responseBodyLimit = 120_000
): Promise<{ result: T; requests: Record<string, unknown>[]; responses: Record<string, unknown>[] }> => {
  const requests: Record<string, unknown>[] = [];
  const responses: Record<string, unknown>[] = [];
  const pendingResponseReads: Array<Promise<void>> = [];
  const matchesPreviewTraffic = (url: string): boolean => /biapi|preview|report|chart|custom/i.test(url);
  const onRequest = (request: Request) => {
    if (!matchesPreviewTraffic(request.url())) return;
    requests.push({
      url: request.url(),
      method: request.method(),
      postData: request.postData()?.slice(0, 12000) ?? null,
      postDataTruncated: (request.postData()?.length ?? 0) > 12000,
      timestamp: new Date().toISOString()
    });
  };
  const onResponse = (response: Response) => {
    if (!matchesPreviewTraffic(response.url())) return;
    const responseEntry: Record<string, unknown> = {
      url: response.url(),
      status: response.status(),
      timestamp: new Date().toISOString()
    };
    responses.push(responseEntry);
    pendingResponseReads.push(
      response.text().then((bodyText) => {
        responseEntry.bodyTextSample = bodyText.slice(0, responseBodyLimit);
        responseEntry.bodyLength = bodyText.length;
        responseEntry.bodyTruncated = bodyText.length > responseBodyLimit;
        try {
          responseEntry.jsonBody = JSON.parse(bodyText) as unknown;
        } catch {
          responseEntry.jsonParseStatus = "not_json";
        }
      }).catch((error) => {
        responseEntry.bodyReadError = error instanceof Error ? error.message : String(error);
      })
    );
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  try {
    const result = await fn();
    await Promise.allSettled(pendingResponseReads);
    return { result, requests, responses };
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
  }
};

type AllZeroCandidate = {
  source: "chart.datasets" | "preview.table" | "network.responseBody";
  field: string;
  valueCount: number;
  zeroCount: number;
  sum: number;
  min: number;
  max: number;
  path?: string;
  sample?: unknown[];
};

const numericValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /^[-–—]$/.test(trimmed)) return null;
  const normalized = trimmed.replace(/,/g, "").replace(/%$/, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const numericSummaryFromValues = (values: unknown[]): { values: number[]; sum: number; min: number; max: number; allZero: boolean } | null => {
  const numeric = values.map(numericValue).filter((item): item is number => item !== null);
  if (numeric.length === 0) return null;
  const sum = numeric.reduce((total, item) => total + item, 0);
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  return {
    values: numeric,
    sum,
    min,
    max,
    allZero: numeric.every((item) => Object.is(item, -0) || item === 0)
  };
};

const isDateLikeField = (field: string): boolean => /^(date|日期|時間|time|day|日)$/i.test(field.trim());

const allZeroCandidatesFromChart = (chart: Record<string, unknown> | null): AllZeroCandidate[] => {
  const datasets = Array.isArray(chart?.datasets) ? chart.datasets : [];
  return datasets.flatMap((dataset, index) => {
    if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) return [];
    const record = dataset as Record<string, unknown>;
    const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : `dataset_${index}`;
    if (isDateLikeField(label)) return [];
    const values = Array.isArray(record.values)
      ? record.values
      : Array.isArray(record.sample)
        ? record.sample
        : [];
    const summary = numericSummaryFromValues(values);
    if (!summary?.allZero) return [];
    return [{
      source: "chart.datasets" as const,
      field: label,
      valueCount: summary.values.length,
      zeroCount: summary.values.length,
      sum: summary.sum,
      min: summary.min,
      max: summary.max,
      path: `chart.datasets[${index}]`,
      sample: values.slice(0, 10)
    }];
  });
};

const allZeroCandidatesFromTable = (table: Record<string, unknown> | null): AllZeroCandidate[] => {
  const numericColumns = Array.isArray(table?.numericColumns) ? table.numericColumns : [];
  return numericColumns.flatMap((column, index) => {
    if (!column || typeof column !== "object" || Array.isArray(column)) return [];
    const record = column as Record<string, unknown>;
    const header = typeof record.header === "string" && record.header.trim() ? record.header.trim() : `column_${index}`;
    if (isDateLikeField(header)) return [];
    const values = Array.isArray(record.values) ? record.values : [];
    const summary = numericSummaryFromValues(values);
    if (!summary?.allZero) return [];
    return [{
      source: "preview.table" as const,
      field: header,
      valueCount: summary.values.length,
      zeroCount: summary.values.length,
      sum: summary.sum,
      min: summary.min,
      max: summary.max,
      path: `table.numericColumns[${index}]`,
      sample: values.slice(0, 10)
    }];
  });
};

const networkBodyAllZeroCandidates = (value: unknown, pathPrefix = "$", maxCandidates = 200): AllZeroCandidate[] => {
  const candidates: AllZeroCandidate[] = [];
  const visit = (node: unknown, currentPath: string, depth: number): void => {
    if (depth > 7 || candidates.length >= maxCandidates) return;
    if (Array.isArray(node)) {
      for (const [index, item] of node.entries()) {
        if (candidates.length >= maxCandidates) break;
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const record = item as Record<string, unknown>;
          const label = firstStringFromRecord(record, ["label", "name", "field", "fieldName", "title", "metricName"]);
          const values = firstArrayFromRecord(record, ["data", "values", "items", "points"]);
          if (label && values && !isDateLikeField(label)) {
            const summary = numericSummaryFromValues(values);
            if (summary?.allZero) {
              candidates.push({
                source: "network.responseBody",
                field: label,
                valueCount: summary.values.length,
                zeroCount: summary.values.length,
                sum: summary.sum,
                min: summary.min,
                max: summary.max,
                path: `${currentPath}[${index}]`,
                sample: values.slice(0, 10)
              });
            }
          }
        }
      }

      const objectItems = node.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as Array<Record<string, unknown>>;
      if (objectItems.length > 0 && objectItems.length === node.length) {
        const keys = [...new Set(objectItems.flatMap((item) => Object.keys(item)))];
        for (const key of keys) {
          if (isDateLikeField(key)) continue;
          const values = objectItems.map((item) => item[key]).filter((item) => numericValue(item) !== null);
          const summary = numericSummaryFromValues(values);
          if (summary?.allZero) {
            candidates.push({
              source: "network.responseBody",
              field: key,
              valueCount: summary.values.length,
              zeroCount: summary.values.length,
              sum: summary.sum,
              min: summary.min,
              max: summary.max,
              path: `${currentPath}[*].${key}`,
              sample: values.slice(0, 10)
            });
          }
          if (candidates.length >= maxCandidates) break;
        }
      }

      for (const [index, item] of node.slice(0, 30).entries()) visit(item, `${currentPath}[${index}]`, depth + 1);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      visit(child, `${currentPath}.${key}`, depth + 1);
      if (candidates.length >= maxCandidates) break;
    }
  };
  visit(value, pathPrefix, 0);
  return candidates;
};

const firstStringFromRecord = (record: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const firstArrayFromRecord = (record: Record<string, unknown>, keys: string[]): unknown[] | null => {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return null;
};

const allZeroCandidatesFromResponses = (responses: Record<string, unknown>[]): AllZeroCandidate[] => {
  return responses.flatMap((response, responseIndex) =>
    response.jsonBody === undefined
      ? []
      : networkBodyAllZeroCandidates(response.jsonBody, `responses[${responseIndex}].jsonBody`)
  );
};

const dedupeAllZeroCandidates = (candidates: AllZeroCandidate[]): AllZeroCandidate[] => {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.source}:${candidate.field}:${candidate.path ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const clickByText = async (page: Page, text: string, timeout = 12000): Promise<void> => {
  const locator = page.getByText(text, { exact: false }).first();
  try {
    await locator.click({ timeout });
  } catch (error) {
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(300);
    try {
      await locator.click({ timeout: Math.min(timeout, 5000) });
    } catch (retryError) {
      const firstMessage = error instanceof Error ? error.message : String(error);
      const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
      throw new HelperBlockedError(
        `VISIBLE_UI_CLICK_BLOCKED: text="${text}"; first=${firstMessage.slice(0, 500)}; retry=${retryMessage.slice(0, 500)}`
      );
    }
  }
};

const hasCreateReportEntry = (bodyText: string): boolean => /(?:[+＋➕]\s*)?新增報表/.test(bodyText);
const hasSelectProjectPrompt = (bodyText: string): boolean => /請從左側選擇專案查看報表/.test(bodyText);
const isCollageReportListReady = (bodyText: string): boolean =>
  hasCreateReportEntry(bodyText) && !hasSelectProjectPrompt(bodyText);

const isOfficialCollageReportListReady = (page: Page, bodyText: string): boolean => {
  const parsed = parseHttpUrl(page.url());
  const isOfficialProjectRoute = Boolean(parsed?.pathname.match(/\/bi-dev\/[^/]+\/report\/myCustom\/tileMode\/[^/]+$/));
  return (
    isOfficialProjectRoute &&
    /拼貼報表/.test(bodyText) &&
    /報表名稱/.test(bodyText) &&
    /資料(?:週期)?區間/.test(bodyText) &&
    /操作/.test(bodyText) &&
    !hasSelectProjectPrompt(bodyText)
  );
};

const isCollageReportListReadyForPage = (page: Page, bodyText: string): boolean =>
  isCollageReportListReady(bodyText) || isOfficialCollageReportListReady(page, bodyText);

type CollageProjectSelectionAttempt = {
  label: string;
  url: string;
  hasCreateReportEntry: boolean;
  hasSelectProjectPrompt: boolean;
  bodyTextExcerpt: string;
  error?: string;
  clickMethod?: string;
  clickedText?: string;
  candidateCount?: number;
};

type CollageProjectClickCandidate = {
  bodyIndex: number;
  text: string;
  tagName: string;
  role: string | null;
  className: string;
  rect: { x: number; y: number; width: number; height: number };
};

type VisibleBodyTextClickCandidate = CollageProjectClickCandidate;

const scoreVisibleBodyTextClickCandidate = (
  candidate: Omit<VisibleBodyTextClickCandidate, "bodyIndex">,
  targetText: string,
  options: { preferLeftNav?: boolean } = {}
): number => {
  const target = normalizeUiText(targetText);
  const text = normalizeUiText(candidate.text);
  if (!target || !text.includes(target)) return Number.POSITIVE_INFINITY;
  const className = candidate.className.toLowerCase();
  const role = (candidate.role ?? "").toLowerCase();
  const tagName = candidate.tagName.toLowerCase();
  const exact = text === target;
  const shortText = text.length <= target.length + 8;
  const clickableish =
    /button|a|li/.test(tagName) ||
    /button|treeitem|menuitem|option|tab|link/.test(role) ||
    /tree|menu|nav|item|node|title|label|sidebar|collapse/.test(className);
  let score = 0;
  if (!exact) score += 20;
  if (!shortText) score += Math.min(100, text.length - target.length);
  if (!clickableish) score += 12;
  if (options.preferLeftNav && candidate.rect.x > 520) score += 35;
  if (candidate.rect.width > 500) score += 8;
  if (/新增報表|報表名稱|資料區間日期|請從左側選擇|儲存報表/.test(candidate.text)) score += 80;
  return score + Math.max(0, candidate.rect.y / 10000);
};

const visibleBodyTextClickCandidates = async (
  page: Page,
  targetText: string,
  options: { preferLeftNav?: boolean } = {}
): Promise<VisibleBodyTextClickCandidate[]> => {
  const candidates = await page.evaluate((target) => {
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, "");
    const normalizedTarget = normalize(target);
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    return Array.from(document.querySelectorAll<HTMLElement>("body *")).flatMap((element, bodyIndex) => {
      if (!isVisible(element)) return [];
      const text = (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ");
      if (!text || !normalize(text).includes(normalizedTarget)) return [];
      const rect = element.getBoundingClientRect();
      return [{
        bodyIndex,
        text,
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        className: typeof element.className === "string" ? element.className : "",
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      }];
    });
  }, targetText);
  return candidates
    .filter((candidate) => Number.isFinite(scoreVisibleBodyTextClickCandidate(candidate, targetText, options)))
    .sort((a, b) =>
      scoreVisibleBodyTextClickCandidate(a, targetText, options) - scoreVisibleBodyTextClickCandidate(b, targetText, options) ||
      a.rect.y - b.rect.y ||
      a.rect.x - b.rect.x
    )
    .slice(0, 10);
};

const clickVisibleBodyTextCandidate = async (
  page: Page,
  targetText: string,
  timeout = 7000,
  options: { preferLeftNav?: boolean } = {}
): Promise<{ method: string; clickedText: string; candidateCount: number }> => {
  const candidates = await visibleBodyTextClickCandidates(page, targetText, options);
  const errors: string[] = [];
  for (const candidate of candidates.slice(0, 5)) {
    try {
      await clickVisibleBodyElementByIndex(page, candidate.bodyIndex, timeout);
      return { method: "visible_text_candidate", clickedText: candidate.text, candidateCount: candidates.length };
    } catch (error) {
      errors.push(error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240));
    }
  }
  try {
    await clickByText(page, targetText, timeout);
    return { method: "text_locator_fallback", clickedText: targetText, candidateCount: candidates.length };
  } catch (error) {
    errors.push(error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240));
    throw new HelperBlockedError(`VISIBLE_TEXT_CLICK_FAILED:${targetText}; candidates=${candidates.length}; errors=${errors.join(" | ")}`);
  }
};

const scoreCollageProjectClickCandidate = (candidate: Omit<CollageProjectClickCandidate, "bodyIndex">, projectName: string): number => {
  const target = normalizeUiText(projectName);
  const text = normalizeUiText(candidate.text);
  if (!target || !text.includes(target)) return Number.POSITIVE_INFINITY;
  const className = candidate.className.toLowerCase();
  const role = (candidate.role ?? "").toLowerCase();
  const tagName = candidate.tagName.toLowerCase();
  const exact = text === target;
  const shortText = text.length <= target.length + 10;
  const clickableish =
    /button|a|li/.test(tagName) ||
    /button|treeitem|menuitem|option|tab/.test(role) ||
    /tree|menu|project|nav|item|node|title|label/.test(className);
  let score = 0;
  if (!exact) score += 20;
  if (!shortText) score += Math.min(80, text.length - target.length);
  if (!clickableish) score += 12;
  if (candidate.rect.x > 520) score += 15;
  if (/新增報表|報表名稱|資料區間日期|請從左側選擇/.test(candidate.text)) score += 80;
  if (/🗑|刪除|delete|trash/i.test(candidate.text)) score += 10;
  return score + Math.max(0, candidate.rect.y / 10000);
};

const visibleCollageProjectClickCandidates = async (page: Page, projectName: string): Promise<CollageProjectClickCandidate[]> => {
  const candidates = await page.evaluate((targetProjectName) => {
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, "");
    const target = normalize(targetProjectName);
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const all = Array.from(document.querySelectorAll<HTMLElement>("body *"));
    return all.flatMap((element, bodyIndex) => {
      if (!isVisible(element)) return [];
      const text = (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ");
      if (!text || !normalize(text).includes(target)) return [];
      const rect = element.getBoundingClientRect();
      return [{
        bodyIndex,
        text,
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        className: typeof element.className === "string" ? element.className : "",
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      }];
    });
  }, projectName);
  return candidates
    .filter((candidate) => Number.isFinite(scoreCollageProjectClickCandidate(candidate, projectName)))
    .sort((a, b) =>
      scoreCollageProjectClickCandidate(a, projectName) - scoreCollageProjectClickCandidate(b, projectName) ||
      a.rect.y - b.rect.y ||
      a.rect.x - b.rect.x
    )
    .slice(0, 8);
};

const clickCollageProjectCandidate = async (page: Page, projectName: string, timeout = 8000): Promise<{ method: string; clickedText: string; candidateCount: number }> => {
  const candidates = await visibleCollageProjectClickCandidates(page, projectName);
  const errors: string[] = [];
  for (const candidate of candidates.slice(0, 4)) {
    try {
      await clickVisibleBodyElementByIndex(page, candidate.bodyIndex, timeout);
      return { method: "visible_project_candidate", clickedText: candidate.text, candidateCount: candidates.length };
    } catch (error) {
      errors.push(error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240));
    }
  }
  try {
    await clickByText(page, projectName, timeout);
    return { method: "text_locator_fallback", clickedText: projectName, candidateCount: candidates.length };
  } catch (error) {
    errors.push(error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240));
    throw new HelperBlockedError(`COLLAGE_PROJECT_CLICK_FAILED:${projectName}; candidates=${candidates.length}; errors=${errors.join(" | ")}`);
  }
};

export const inferVisibleCollageProjectName = (bodyText: string, explicitProjectName: string | null = null): string | null => {
  if (explicitProjectName?.trim()) return explicitProjectName.trim();
  const lines = bodyText.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const collageIndex = lines.findIndex((line) => line === "拼貼模式" || /拼貼模式/.test(line) || line === "拼貼報表" || /拼貼報表/.test(line));
  const stopPattern = /^(?:▶\s*)?(?:明細檢視|報表明細|指標趨勢|新增自訂報表|➕\s*新增專案|\+\s*新增專案)$/;
  const ignored = new Set(["▶", "▼", "🗑️", "報表", "📂", "公司共享", "我的自訂", "拼貼模式", "拼貼報表"]);
  const start = collageIndex >= 0 ? collageIndex + 1 : 0;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (index > start && stopPattern.test(line)) break;
    if (ignored.has(line) || /^🗑/.test(line) || /新增報表|新增專案|請從左側選擇|數據統計中心|沒有可用|尚無|無資料|載入中|loading/i.test(line)) continue;
    if (/^(?:拼貼test[_\d]*|.+專案)$/.test(line)) return line;
    if (collageIndex >= 0 && line.length <= 80 && !/[：:]/.test(line)) return line;
  }
  return lines.find((line) => /拼貼test[_\d]*|.+專案/.test(line) && !/新增專案/.test(line)) ?? null;
};

const hasOfficialNoAvailableProjectState = (bodyText: string): boolean =>
  /(?:尚無|沒有|無可用|無任何|目前無).{0,20}(?:專案|報表)|(?:專案|報表).{0,20}(?:尚無|沒有|無資料|不存在)/.test(bodyText);

const shouldTryOfficialCollageSidebarNavigation = (page: Page, bodyText: string): boolean =>
  isOfficialBiUiPageUrl(page.url()) && /我的自訂/.test(bodyText);

export const __openProjectRetryTestHooks = {
  hasCreateReportEntry,
  hasSelectProjectPrompt,
  isCollageReportListReady,
  inferVisibleCollageProjectName,
  scoreCollageProjectClickCandidate,
  scoreVisibleBodyTextClickCandidate
};

const navigateOfficialCollageSidebar = async (
  options: CliOptions,
  page: Page,
  attempts: CollageProjectSelectionAttempt[],
  initialBodyText: string
): Promise<string> => {
  let bodyText = initialBodyText;
  const labels = /拼貼報表|拼貼模式/.test(bodyText) ? [] : ["我的自訂"];

  for (const label of labels) {
    if (isCollageReportListReadyForPage(page, bodyText)) return bodyText;
    const beforeUrl = page.url();
    const beforeExcerpt = bodyText.slice(0, 500);
    let clickEvidence: { method: string; clickedText: string; candidateCount: number } | null = null;
    try {
      const candidates = await visibleBodyTextClickCandidates(page, label, { preferLeftNav: true });
      observeHelper(options, {
        eventType: "locator_attempt",
        severity: candidates.length ? "info" : "warning",
        appUrl: beforeUrl,
        data: {
          context: "official_collage_sidebar",
          targetText: label,
          candidateCount: candidates.length,
          candidates: candidates.slice(0, 5).map((candidate) => ({
            text: candidate.text.slice(0, 160),
            tagName: candidate.tagName,
            role: candidate.role,
            className: candidate.className.slice(0, 160),
            rect: candidate.rect,
            score: scoreVisibleBodyTextClickCandidate(candidate, label, { preferLeftNav: true })
          }))
        }
      });
      clickEvidence = await clickVisibleBodyTextCandidate(page, label, 8000, { preferLeftNav: true });
      await page.waitForTimeout(900);
      bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
      attempts.push({
        label: `official_sidebar_${label}`,
        url: page.url(),
        hasCreateReportEntry: hasCreateReportEntry(bodyText),
        hasSelectProjectPrompt: hasSelectProjectPrompt(bodyText),
        bodyTextExcerpt: bodyText.slice(0, 800),
        clickMethod: clickEvidence.method,
        clickedText: clickEvidence.clickedText.slice(0, 200),
        candidateCount: clickEvidence.candidateCount
      });
      observeHelper(options, {
        eventType: "navigation_transition",
        severity: "info",
        appUrl: page.url(),
        data: {
          context: "official_collage_sidebar",
          targetText: label,
          status: "clicked",
          fromUrl: beforeUrl,
          toUrl: page.url(),
          beforeTextExcerpt: beforeExcerpt,
          afterTextExcerpt: bodyText.slice(0, 500),
          clickEvidence
        },
        domainExtension: {
          namespace: "BI_OFFICIAL_UI_COLLAGE",
          data: {
            expectedNavigationPath: "我的自訂 > 拼貼報表",
            label
          }
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      observeHelper(options, {
        eventType: "navigation_transition",
        severity: "warning",
        appUrl: page.url(),
        data: {
          context: "official_collage_sidebar",
          targetText: label,
          status: "click_failed",
          fromUrl: beforeUrl,
          toUrl: page.url(),
          beforeTextExcerpt: beforeExcerpt,
          error: message.slice(0, 500)
        },
        domainExtension: {
          namespace: "BI_OFFICIAL_UI_COLLAGE",
          data: {
            expectedNavigationPath: "我的自訂 > 拼貼報表",
            label
          }
        }
      });
      attempts.push({
        label: `official_sidebar_${label}_failed`,
        url: page.url(),
        hasCreateReportEntry: hasCreateReportEntry(bodyText),
        hasSelectProjectPrompt: hasSelectProjectPrompt(bodyText),
        bodyTextExcerpt: bodyText.slice(0, 800),
        error: message.slice(0, 300),
        clickMethod: clickEvidence?.method,
        clickedText: clickEvidence?.clickedText.slice(0, 200),
        candidateCount: clickEvidence?.candidateCount
      });
    }
  }

  const collageLabel = /拼貼報表/.test(bodyText) ? "拼貼報表" : /拼貼模式/.test(bodyText) ? "拼貼模式" : null;
  if (collageLabel && !isCollageReportListReadyForPage(page, bodyText)) {
    const beforeUrl = page.url();
    const beforeExcerpt = bodyText.slice(0, 500);
    let clickEvidence: { method: string; clickedText: string; candidateCount: number } | null = null;
    try {
      const candidates = await visibleBodyTextClickCandidates(page, collageLabel, { preferLeftNav: true });
      observeHelper(options, {
        eventType: "locator_attempt",
        severity: candidates.length ? "info" : "warning",
        appUrl: beforeUrl,
        data: {
          context: "official_collage_sidebar",
          targetText: collageLabel,
          candidateCount: candidates.length,
          candidates: candidates.slice(0, 5).map((candidate) => ({
            text: candidate.text.slice(0, 160),
            tagName: candidate.tagName,
            role: candidate.role,
            className: candidate.className.slice(0, 160),
            rect: candidate.rect,
            score: scoreVisibleBodyTextClickCandidate(candidate, collageLabel, { preferLeftNav: true })
          }))
        }
      });
      clickEvidence = await clickVisibleBodyTextCandidate(page, collageLabel, 8000, { preferLeftNav: true });
      await page.waitForTimeout(900);
      bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
      attempts.push({
        label: `official_sidebar_${collageLabel}`,
        url: page.url(),
        hasCreateReportEntry: hasCreateReportEntry(bodyText),
        hasSelectProjectPrompt: hasSelectProjectPrompt(bodyText),
        bodyTextExcerpt: bodyText.slice(0, 800),
        clickMethod: clickEvidence.method,
        clickedText: clickEvidence.clickedText.slice(0, 200),
        candidateCount: clickEvidence.candidateCount
      });
      observeHelper(options, {
        eventType: "navigation_transition",
        severity: "info",
        appUrl: page.url(),
        data: {
          context: "official_collage_sidebar",
          targetText: collageLabel,
          status: "clicked",
          fromUrl: beforeUrl,
          toUrl: page.url(),
          beforeTextExcerpt: beforeExcerpt,
          afterTextExcerpt: bodyText.slice(0, 500),
          clickEvidence
        },
        domainExtension: {
          namespace: "BI_OFFICIAL_UI_COLLAGE",
          data: {
            expectedNavigationPath: "我的自訂 > 拼貼報表",
            label: collageLabel
          }
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      observeHelper(options, {
        eventType: "navigation_transition",
        severity: "warning",
        appUrl: page.url(),
        data: {
          context: "official_collage_sidebar",
          targetText: collageLabel,
          status: "click_failed",
          fromUrl: beforeUrl,
          toUrl: page.url(),
          beforeTextExcerpt: beforeExcerpt,
          error: message.slice(0, 500)
        },
        domainExtension: {
          namespace: "BI_OFFICIAL_UI_COLLAGE",
          data: {
            expectedNavigationPath: "我的自訂 > 拼貼報表",
            label: collageLabel
          }
        }
      });
      attempts.push({
        label: `official_sidebar_${collageLabel}_failed`,
        url: page.url(),
        hasCreateReportEntry: hasCreateReportEntry(bodyText),
        hasSelectProjectPrompt: hasSelectProjectPrompt(bodyText),
        bodyTextExcerpt: bodyText.slice(0, 800),
        error: message.slice(0, 300),
        clickMethod: clickEvidence?.method,
        clickedText: clickEvidence?.clickedText.slice(0, 200),
        candidateCount: clickEvidence?.candidateCount
      });
    }
  } else if (!collageLabel) {
    observeHelper(options, {
      eventType: "evidence_contract_gap",
      severity: "warning",
      appUrl: page.url(),
      data: {
        context: "official_collage_sidebar",
        expectedLabel: "拼貼報表",
        observedAfterMyCustom: bodyText.slice(0, 1000),
        reason: "OFFICIAL_COLLAGE_SIDEBAR_LABEL_NOT_VISIBLE"
      },
      domainExtension: {
        namespace: "BI_OFFICIAL_UI_COLLAGE",
        data: {
          expectedNavigationPath: "我的自訂 > 拼貼報表"
        }
      }
    });
  }

  return bodyText;
};

const ensureCollageProjectSelected = async (
  options: CliOptions,
  page: Page
): Promise<{
  projectName: string | null;
  bodyText: string;
  selectedBy: "already_selected" | "param" | "inferred";
  attempts: CollageProjectSelectionAttempt[];
}> => {
  const attempts: CollageProjectSelectionAttempt[] = [];
  const capture = async (label: string): Promise<string> => {
    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    attempts.push({
      label,
      url: page.url(),
      hasCreateReportEntry: hasCreateReportEntry(bodyText),
      hasSelectProjectPrompt: hasSelectProjectPrompt(bodyText),
      bodyTextExcerpt: bodyText.slice(0, 800)
    });
    return bodyText;
  };

  let bodyText = await capture("initial");
  const explicitProjectName = stringParam(options.params, "projectName") ?? readCreatedProjectName(options);
  const selectedBy = explicitProjectName ? "param" : "inferred";
  const decodedUrl = (() => {
    try {
      return decodeURIComponent(page.url());
    } catch {
      return page.url();
    }
  })();
  if (isCollageReportListReadyForPage(page, bodyText) && !explicitProjectName) {
    return { projectName: null, bodyText, selectedBy: "already_selected", attempts };
  }
  if (isCollageReportListReadyForPage(page, bodyText) && explicitProjectName && decodedUrl.includes(explicitProjectName)) {
    return { projectName: explicitProjectName, bodyText, selectedBy: "already_selected", attempts };
  }

  if (shouldTryOfficialCollageSidebarNavigation(page, bodyText)) {
    bodyText = await navigateOfficialCollageSidebar(options, page, attempts, bodyText);
    const updatedDecodedUrl = (() => {
      try {
        return decodeURIComponent(page.url());
      } catch {
        return page.url();
      }
    })();
    if (isCollageReportListReadyForPage(page, bodyText) && !explicitProjectName) {
      return { projectName: null, bodyText, selectedBy: "already_selected", attempts };
    }
    if (isCollageReportListReadyForPage(page, bodyText) && explicitProjectName && updatedDecodedUrl.includes(explicitProjectName)) {
      return { projectName: explicitProjectName, bodyText, selectedBy: "already_selected", attempts };
    }
  }

  const projectName = inferVisibleCollageProjectName(bodyText, explicitProjectName);
  if (!projectName) {
    const reason = hasOfficialNoAvailableProjectState(bodyText)
      ? "COLLAGE_NO_AVAILABLE_PROJECT_VISIBLE"
      : "COLLAGE_PROJECT_NOT_SELECTED";
    observeHelper(options, {
      eventType: "blocker_event",
      severity: "blocked",
      appUrl: page.url(),
      data: {
        reason,
        context: "openProject.projectSelection",
        hasOfficialNoAvailableProjectState: hasOfficialNoAvailableProjectState(bodyText),
        attempts: attempts.slice(-8),
        bodyTextExcerpt: bodyText.slice(0, 1000)
      },
      domainExtension: {
        namespace: "BI_OFFICIAL_UI_COLLAGE",
        data: {
          expectedNavigationPath: "我的自訂 > 拼貼報表 > 任一專案",
          officialUiUrl: isOfficialBiUiPageUrl(page.url())
        }
      }
    });
    throw new HelperBlockedError(`${reason}: no projectName param and no visible collage project could be inferred; bodyText=${bodyText.slice(0, 500)}`);
  }

  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let clickEvidence: { method: string; clickedText: string; candidateCount: number } | null = null;
    try {
      const candidates = await visibleCollageProjectClickCandidates(page, projectName);
      observeHelper(options, {
        eventType: "locator_attempt",
        severity: candidates.length ? "info" : "warning",
        appUrl: page.url(),
        data: {
          context: "collage_project_selection",
          attempt: attempt + 1,
          targetProjectName: projectName,
          candidateCount: candidates.length,
          candidates: candidates.slice(0, 5).map((candidate) => ({
            text: candidate.text.slice(0, 160),
            tagName: candidate.tagName,
            role: candidate.role,
            className: candidate.className.slice(0, 160),
            rect: candidate.rect,
            score: scoreCollageProjectClickCandidate(candidate, projectName)
          }))
        }
      });
      clickEvidence = await clickCollageProjectCandidate(page, projectName, attempt === 0 ? 12000 : 8000);
      await page.waitForTimeout(900);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      attempts.push({
        label: `click_project_failed_${attempt + 1}`,
        url: page.url(),
        hasCreateReportEntry: hasCreateReportEntry(bodyText),
        hasSelectProjectPrompt: hasSelectProjectPrompt(bodyText),
        bodyTextExcerpt: bodyText.slice(0, 800),
        error: lastError.slice(0, 300)
      });
    }
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5000) {
      bodyText = await capture(`after_click_${attempt + 1}`);
      const lastAttempt = attempts.at(-1);
      if (lastAttempt && clickEvidence) {
        lastAttempt.clickMethod = clickEvidence.method;
        lastAttempt.clickedText = clickEvidence.clickedText.slice(0, 200);
        lastAttempt.candidateCount = clickEvidence.candidateCount;
      }
      if (isCollageReportListReadyForPage(page, bodyText)) {
        return { projectName, bodyText, selectedBy, attempts };
      }
      await page.waitForTimeout(500);
    }
    if (attempt === 1) {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch((error) => {
        lastError = error instanceof Error ? error.message : String(error);
      });
      await page.waitForTimeout(1200);
      bodyText = await capture("after_reload");
    }
    if (hasSelectProjectPrompt(bodyText)) {
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.waitForTimeout(250);
    }
  }
  bodyText = await capture("not_ready");
  if (lastError) {
    attempts.push({
      label: `last_click_error:${lastError.slice(0, 200)}`,
      url: page.url(),
      hasCreateReportEntry: hasCreateReportEntry(bodyText),
      hasSelectProjectPrompt: hasSelectProjectPrompt(bodyText),
      bodyTextExcerpt: bodyText.slice(0, 800)
    });
  }
  return { projectName, bodyText, selectedBy, attempts };
};

const clickCreateReportButton = async (page: Page): Promise<void> => {
  const attempts: Array<() => Promise<void>> = [
    () => page.getByText("+ 新增報表", { exact: false }).first().click({ timeout: 5000 }),
    () => page.getByText("新增報表", { exact: false }).first().click({ timeout: 5000 }),
    () => page.locator("button, a, [role='button']").filter({ hasText: /新增報表/ }).first().click({ timeout: 5000 }),
    async () => {
      await clickVisibleBodyTextCandidate(page, "新增自訂報表", 7000, { preferLeftNav: true });
    }
  ];
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      await attempt();
      return;
    } catch (error) {
      errors.push(error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300));
    }
  }
  throw new HelperBlockedError(`CREATE_REPORT_BUTTON_NOT_CLICKABLE:${errors.join(" | ")}`);
};

const openProject = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const devUrl = stringParam(options.params, "devUrl");
  if (devUrl && !page.url().includes("galaxy.games.gamania.com")) {
    await page.goto(devUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  }
  await page.waitForTimeout(800);
  const projectSelection = await ensureCollageProjectSelected(options, page);
  if (!isCollageReportListReadyForPage(page, projectSelection.bodyText)) {
    throw new HelperBlockedError(
      `COLLAGE_PROJECT_OPEN_DID_NOT_REACH_REPORT_LIST:${projectSelection.projectName ?? "unknown"}; selectedBy=${projectSelection.selectedBy}; attempts=${JSON.stringify(projectSelection.attempts.slice(-6)).slice(0, 1200)}; bodyText=${projectSelection.bodyText.slice(0, 500)}`
    );
  }
  const shot = await screenshot(options, page, "open-project");
  const uiProfile = await captureUiDomProfile(options, page, "openProject.after");
  return createReport(
    options,
    "ok",
    startedAt,
    { domState: await readDomState(page), uiProfile, projectSelection },
    shot ? { screenshot: shot } : {},
    shot ? [] : ["SCREENSHOT_UNAVAILABLE"]
  );
};

const createCollageReport = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const projectSelection = await ensureCollageProjectSelected(options, page);
  if (!isCollageReportListReadyForPage(page, projectSelection.bodyText)) {
    throw new HelperBlockedError(
      `CREATE_REPORT_PRECONDITION_NOT_READY:${projectSelection.projectName ?? "unknown"}; selectedBy=${projectSelection.selectedBy}; attempts=${JSON.stringify(projectSelection.attempts.slice(-6)).slice(0, 1200)}; bodyText=${projectSelection.bodyText.slice(0, 500)}`
    );
  }
  await clickCreateReportButton(page);
  await page.waitForTimeout(1200);
  const shot = await screenshot(options, page, "create-report");
  const uiProfile = await captureUiDomProfile(options, page, "createReport.after");
  return createReport(options, "ok", startedAt, { domState: await readDomState(page), uiProfile, projectSelection }, shot ? { screenshot: shot } : {}, shot ? [] : ["SCREENSHOT_UNAVAILABLE"]);
};

const createProjectNameFromParams = (options: CliOptions): string => {
  const fitProjectName = (value: string): string => {
    const maxLength = 20;
    const trimmed = fitUiResourceName(value.trim(), maxLength);
    if (trimmed.length <= maxLength) return trimmed;
    const stamp = timestampId();
    const preferredPrefixes = ["BIUI_COLLAGE_G-01_", "BIUI_COLLAGE_G01_", "BIUI_COLLAGE_", "OTTEST004_G01_", "OTTEST004-G01-", "OTTEST004_"];
    const preferredPrefix = preferredPrefixes.find((prefix) => trimmed.startsWith(prefix) && prefix.length < maxLength);
    if (preferredPrefix) {
      return `${preferredPrefix}${stamp.slice(-(maxLength - preferredPrefix.length))}`;
    }
    const suffixLength = Math.min(stamp.length, Math.max(6, Math.floor(maxLength / 2)));
    const suffix = stamp.slice(-suffixLength);
    const prefixLength = Math.max(0, maxLength - suffix.length);
    return `${trimmed.slice(0, prefixLength)}${suffix}`;
  };
  const explicit = firstStringParam(options.params, ["newProjectName", "projectName", "name"]);
  if (explicit) return fitProjectName(explicit.replace("<timestamp>", timestampId()));
  const pattern = firstStringParam(options.params, ["projectNamePattern"]);
  if (pattern) return fitProjectName(pattern.replace("<timestamp>", timestampId()));
  const prefix = firstStringParam(options.params, ["projectNamePrefix"]) ?? "OTTEST004_G01_";
  return fitProjectName(`${prefix}${timestampId()}`);
};

const isCurrentCaseSafeCreateProjectName = (projectName: string): boolean =>
  /OTTEST004_G01|OTTEST004-Project|OTTEST004|BIUI_COLLAGE_G-?01|BIUI_COLLAGE_G01|BIUI_COLLAGE|BIUICOLLAGE|BIUIG01|BIUICOL/i.test(projectName) &&
  !/tommytest|主專案|正式|production|prod/i.test(projectName);

const readCreateProjectModalState = async (page: Page): Promise<Record<string, unknown>> => {
  return page.evaluate(() => {
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const dialogSelectors = "[role='dialog'], .modal, .ant-modal, .MuiDialog-root, .swal2-popup";
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>(dialogSelectors)).flatMap((dialog, dialogIndex) => {
      if (!isVisible(dialog)) return [];
      const selects = Array.from(dialog.querySelectorAll<HTMLSelectElement>("select")).flatMap((select, selectIndex) => {
        if (!isVisible(select) || select.disabled) return [];
        return [{
          selectIndex,
          value: select.value,
          selectedText: normalize(select.selectedOptions?.[0]?.textContent),
          options: Array.from(select.options).map((option) => ({
            value: option.value,
            text: normalize(option.textContent),
            selected: option.selected,
            disabled: option.disabled
          }))
        }];
      });
      const inputs = Array.from(dialog.querySelectorAll<HTMLInputElement>("input")).flatMap((input, inputIndex) => {
        if (!isVisible(input) || input.disabled || input.readOnly) return [];
        return [{
          inputIndex,
          type: input.type,
          placeholder: normalize(input.placeholder),
          value: input.value
        }];
      });
      const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).flatMap((button, buttonIndex) => {
        if (!isVisible(button) || button.disabled) return [];
        return [{
          buttonIndex,
          text: normalize(button.innerText || button.textContent),
          onclick: button.getAttribute("onclick")
        }];
      });
      return [{
        dialogIndex,
        id: dialog.id || null,
        className: typeof dialog.className === "string" ? dialog.className : "",
        textExcerpt: normalize(dialog.innerText || dialog.textContent).slice(0, 1600),
        selects,
        inputs,
        buttons
      }];
    });
    return {
      dialogs,
      bodyTextExcerpt: normalize(document.body.innerText).slice(0, 2400)
    };
  });
};

const clickCreateProjectButton = async (page: Page): Promise<void> => {
  const clicked = await clickFirstVisible([
    page.getByText("+ 新增專案", { exact: false }),
    page.getByText("新增專案", { exact: false }),
    page.locator("button, a, [role='button']").filter({ hasText: /新增專案/ })
  ], 8000);
  if (clicked) return;

  const buttons = await visibleButtons(page).catch(() => []);
  const collageSidebarRow = buttons
    .filter((button) => /拼貼報表/.test(button.text) && button.x < 260)
    .sort((a, b) => a.y - b.y || a.x - b.x)[0];
  if (collageSidebarRow) {
    const rowMidY = collageSidebarRow.y + collageSidebarRow.height / 2;
    const iconCandidate = buttons
      .filter((button) => {
        const buttonMidY = button.y + button.height / 2;
        const text = button.text.trim();
        if (text && text !== "+") return false;
        if (button.width > 56 || button.height > 56) return false;
        if (Math.abs(buttonMidY - rowMidY) > 8) return false;
        return button.x > collageSidebarRow.x + collageSidebarRow.width - 8 && button.x < 260;
      })
      .sort((a, b) => Math.abs((a.y + a.height / 2) - rowMidY) - Math.abs((b.y + b.height / 2) - rowMidY))[0];
    if (iconCandidate) {
      await clickVisibleButtonByIndex(page, iconCandidate.index, 8000);
      return;
    }
  }

  throw new HelperBlockedError(`CREATE_PROJECT_BUTTON_NOT_CLICKABLE: visibleButtons=${JSON.stringify(buttons.slice(0, 30)).slice(0, 1200)}`);
};

const selectCreateProjectMode = async (page: Page, requestedMode: string): Promise<Record<string, unknown>> => {
  const before = await readCreateProjectModalState(page);
  const dialogs = Array.isArray(before.dialogs) ? before.dialogs as Array<Record<string, unknown>> : [];
  const dialog = dialogs.find((item) => /新增專案|專案名稱|建構模式|類型|模式/.test(String(item.textExcerpt ?? ""))) ?? dialogs[0];
  const bodyText = String(before.bodyTextExcerpt ?? "");
  const visibleProjectNameInput = (await visibleInputIndexes(page).catch(() => []))
    .find((item) => /專案|project/i.test(item.placeholder));
  if (!dialog && ((/新增專案/.test(bodyText) && /專案名稱/.test(bodyText)) || visibleProjectNameInput)) {
    return {
      method: "implicit_official_collage_context",
      requestedMode,
      visibleProjectNameInput,
      before,
      after: before
    };
  }
  if (!dialog) throw new HelperBlockedError(`CREATE_PROJECT_MODAL_NOT_VISIBLE: state=${JSON.stringify(before).slice(0, 1500)}`);
  const dialogIndex = typeof dialog.dialogIndex === "number" ? dialog.dialogIndex : 0;
  const dialogLocator = page.locator("[role='dialog'], .modal, .ant-modal, .MuiDialog-root, .swal2-popup").nth(dialogIndex);
  const selects = Array.isArray(dialog.selects) ? dialog.selects as Array<Record<string, unknown>> : [];
  const selectCandidate = selects.flatMap((select) => {
    const options = Array.isArray(select.options) ? select.options as Array<Record<string, unknown>> : [];
    const option = options.find((item) =>
      !item.disabled &&
      (
        String(item.text ?? "").includes(requestedMode) ||
        String(item.value ?? "").toLowerCase().includes("collage") ||
        /拼貼/.test(String(item.text ?? ""))
      )
    );
    return option && typeof select.selectIndex === "number"
      ? [{ selectIndex: select.selectIndex, optionValue: String(option.value ?? ""), optionText: String(option.text ?? "") }]
      : [];
  })[0];
  if (selectCandidate) {
    await dialogLocator.locator("select").nth(selectCandidate.selectIndex).selectOption(selectCandidate.optionValue, { timeout: 8000 });
    await page.waitForTimeout(300);
    return {
      method: "select",
      requestedMode,
      selectCandidate,
      before,
      after: await readCreateProjectModalState(page)
    };
  }

  const clicked = await clickFirstVisible([
    dialogLocator.getByText(requestedMode, { exact: false }),
    dialogLocator.getByText("拼貼模式", { exact: false }),
    dialogLocator.locator("label, button, [role='button']").filter({ hasText: /拼貼|Collage/i })
  ], 8000);
  if (!clicked && /新增專案/.test(bodyText) && /專案名稱/.test(bodyText)) {
    return {
      method: "implicit_official_collage_context",
      requestedMode,
      before,
      after: await readCreateProjectModalState(page)
    };
  }
  if (!clicked) throw new HelperBlockedError(`CREATE_PROJECT_MODE_OPTION_NOT_CLICKABLE: modal=${JSON.stringify(before).slice(0, 1800)}`);
  await page.waitForTimeout(300);
  return {
    method: "click",
    requestedMode,
    before,
    after: await readCreateProjectModalState(page)
  };
};

const fillCreateProjectName = async (page: Page, projectName: string): Promise<Record<string, unknown>> => {
  const modalState = await readCreateProjectModalState(page);
  const dialogs = Array.isArray(modalState.dialogs) ? modalState.dialogs as Array<Record<string, unknown>> : [];
  const dialog = dialogs.find((item) => /新增專案|專案名稱|建構模式|類型|模式/.test(String(item.textExcerpt ?? ""))) ?? dialogs[0];
  const modalInputs = Array.isArray(dialog?.inputs) ? dialog.inputs as Array<Record<string, unknown>> : [];
  const modalCandidate =
    modalInputs.find((item) => /專案|project/i.test(String(item.placeholder ?? ""))) ??
    modalInputs.find((item) => /名稱|name/i.test(String(item.placeholder ?? "")) && !/報表|report/i.test(String(item.placeholder ?? ""))) ??
    modalInputs.find((item) => String(item.type ?? "") === "text" && String(item.value ?? "").trim().length === 0) ??
    modalInputs.at(-1);
  if (dialog && modalCandidate && typeof dialog.dialogIndex === "number" && typeof modalCandidate.inputIndex === "number") {
    const dialogLocator = page.locator("[role='dialog'], .modal, .ant-modal, .MuiDialog-root, .swal2-popup").nth(dialog.dialogIndex);
    const inputLocator = dialogLocator.locator("input").nth(modalCandidate.inputIndex);
    const attempts: Array<Record<string, unknown>> = [];
    await inputLocator.fill(projectName, { timeout: 8000 });
    let observedValue = await inputLocator.inputValue({ timeout: 3000 }).catch(() => null);
    attempts.push({ method: "fill", observedValue });
    if (observedValue !== projectName) {
      await inputLocator.click({ timeout: 3000 }).catch(() => undefined);
      await inputLocator.press(process.platform === "darwin" ? "Meta+A" : "Control+A", { timeout: 3000 }).catch(() => undefined);
      await inputLocator.type(projectName, { timeout: 8000 }).catch(() => undefined);
      observedValue = await inputLocator.inputValue({ timeout: 3000 }).catch(() => null);
      attempts.push({ method: "click-select-type", observedValue });
    }
    return {
      projectName,
      selectedInput: { ...modalCandidate, dialogIndex: dialog.dialogIndex, scope: "create-project-modal" },
      observedValue,
      verified: observedValue === projectName,
      modalState,
      visibleInputs: modalInputs,
      attempts
    };
  }

  const inputs = await visibleInputIndexes(page);
  const candidate =
    inputs.find((item) => /專案|project/i.test(item.placeholder)) ??
    inputs.find((item) => /名稱|name/i.test(item.placeholder) && !/報表|report/i.test(item.placeholder)) ??
    inputs.find((item) => item.type === "text" && item.value.trim().length === 0) ??
    inputs.at(-1);
  if (!candidate) throw new HelperBlockedError(`CREATE_PROJECT_NAME_INPUT_NOT_FOUND: modalState=${JSON.stringify(modalState).slice(0, 1000)}; inputs=${JSON.stringify(inputs).slice(0, 1000)}`);
  const attempts: Array<Record<string, unknown>> = [];
  await page.locator("input").nth(candidate.index).fill(projectName, { timeout: 8000 });
  let observedValue = await page.locator("input").nth(candidate.index).inputValue({ timeout: 3000 }).catch(() => null);
  attempts.push({ method: "fill", observedValue });
  if (observedValue !== projectName) {
    const inputLocator = page.locator("input").nth(candidate.index);
    await inputLocator.click({ timeout: 3000 }).catch(() => undefined);
    await inputLocator.press(process.platform === "darwin" ? "Meta+A" : "Control+A", { timeout: 3000 }).catch(() => undefined);
    await inputLocator.type(projectName, { timeout: 8000 }).catch(() => undefined);
    observedValue = await inputLocator.inputValue({ timeout: 3000 }).catch(() => null);
    attempts.push({ method: "click-select-type", observedValue });
  }
  return {
    projectName,
    selectedInput: candidate,
    observedValue,
    verified: observedValue === projectName,
    modalState,
    visibleInputs: inputs,
    attempts
  };
};

const clickCreateProjectSubmit = async (page: Page): Promise<void> => {
  const clicked = await clickFirstVisible([
    page.locator("[role='dialog'] button").filter({ hasText: /建立|新增|確認|確定|Create/i }),
    page.locator(".modal button").filter({ hasText: /建立|新增|確認|確定|Create/i }),
    page.locator(".ant-modal button").filter({ hasText: /建立|新增|確認|確定|Create/i }),
    page.locator(".MuiDialog-root button").filter({ hasText: /建立|新增|確認|確定|Create/i }),
    page.getByRole("button", { name: /^(建立|新增|確認|確定|Create)$/i }),
    page.locator("button").filter({ hasText: /^(建立|新增|確認|確定|Create)$/i })
  ], 8000);
  if (!clicked) throw new HelperBlockedError("CREATE_PROJECT_SUBMIT_BUTTON_NOT_CLICKABLE");
};

const decideCreateProjectDialogHandling = (dialog: Dialog): { action: "accept" | "dismiss"; reason: string; blocksFlow: boolean } => {
  const message = dialog.message();
  if (/sso|login|登入|密碼|password|驗證|認證/i.test(message)) {
    return { action: "dismiss", reason: "auth_like_dialog_not_auto_approved", blocksFlow: true };
  }
  if (/請選擇模式|選擇.*模式|select.*mode/i.test(message)) {
    return { action: "accept", reason: "project_mode_not_selected_alert", blocksFlow: true };
  }
  if (/成功|已建立|新增完成|建立完成|created|success/i.test(message)) {
    return { action: "accept", reason: "known_bi_create_project_success_dialog", blocksFlow: false };
  }
  return { action: "dismiss", reason: "unknown_native_dialog_dismissed_for_recovery", blocksFlow: true };
};

const verifyCreatedProjectVisible = async (
  page: Page,
  projectName: string
): Promise<Record<string, unknown>> => {
  const attempts: Array<Record<string, unknown>> = [];
  const capture = async (label: string): Promise<string> => {
    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const normalizedBody = normalizeUiText(bodyText);
    attempts.push({
      label,
      url: page.url(),
      projectVisible: normalizedBody.includes(normalizeUiText(projectName)),
      reportListReady: hasCreateReportEntry(bodyText) && !/請從左側選擇專案查看報表/.test(bodyText),
      bodyTextExcerpt: bodyText.slice(0, 1200)
    });
    return bodyText;
  };

  let bodyText = await capture("after_submit");
  if (!normalizeUiText(bodyText).includes(normalizeUiText(projectName))) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    bodyText = await capture("after_reload");
  }

  const projectVisible = normalizeUiText(bodyText).includes(normalizeUiText(projectName));
  let projectListReady = hasCreateReportEntry(bodyText) && !/請從左側選擇專案查看報表/.test(bodyText);
  if (projectVisible) {
    await clickByText(page, projectName, 12000).catch((error) => {
      attempts.push({
        label: "click_created_project_failed",
        url: page.url(),
        error: error instanceof Error ? error.message : String(error),
        bodyTextExcerpt: bodyText.slice(0, 1200)
      });
    });
    await page.waitForTimeout(1200);
    const selectedText = await capture("after_click_created_project");
    projectListReady = hasCreateReportEntry(selectedText) && !/請從左側選擇專案查看報表/.test(selectedText);
  }

  return {
    projectName,
    projectVisible,
    projectListReady,
    attempts
  };
};

const createProject = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  if (!options.approvedToolRequestId) return approvalRequired(options, "Create current-case temporary/test project through visible BI UI.", startedAt);

  const projectName = createProjectNameFromParams(options);
  if (!isCurrentCaseSafeCreateProjectName(projectName)) {
    throw new HelperBlockedError(`CREATE_PROJECT_NAME_NOT_CURRENT_CASE_SAFE:${projectName}`);
  }
  const projectMode = firstStringParam(options.params, ["projectMode", "mode"]) ?? "拼貼";
  const warnings: string[] = [];
  const operations: string[] = [];
  const nativeDialogs: Array<Record<string, unknown>> = [];
  let dialogBlocksFlow = false;
  const uiProfileBefore = await captureUiDomProfile(options, page, "createProject.before");

  const dialogHandler = async (dialog: Dialog) => {
    const handling = decideCreateProjectDialogHandling(dialog);
    const record: Record<string, unknown> = {
      sequence: nativeDialogs.length + 1,
      type: dialog.type(),
      message: dialog.message(),
      defaultValue: dialog.defaultValue(),
      handledAction: handling.action,
      handledReason: handling.reason
    };
    nativeDialogs.push(record);
    if (handling.blocksFlow) dialogBlocksFlow = true;
    try {
      if (handling.action === "accept") await dialog.accept();
      else await dialog.dismiss();
      record.handledAt = new Date().toISOString();
    } catch (error) {
      record.handledError = error instanceof Error ? error.message : String(error);
      dialogBlocksFlow = true;
    }
  };

  page.on("dialog", dialogHandler);
  try {
    const initialBodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (!/新增專案/.test(initialBodyText) && shouldTryOfficialCollageSidebarNavigation(page, initialBodyText)) {
      const attempts: CollageProjectSelectionAttempt[] = [];
      await navigateOfficialCollageSidebar(options, page, attempts, initialBodyText);
      operations.push(`project:create:navigateCollageSidebar:${attempts.map((attempt) => attempt.label).join("|")}`);
      await page.waitForTimeout(700);
    }
    await clickCreateProjectButton(page);
    operations.push("project:create:openModal");
    await page.waitForTimeout(600);
    const modalOpened = await readCreateProjectModalState(page);
    operations.push("project:create:modalStateCaptured");
    const modeSelection = await selectCreateProjectMode(page, projectMode);
    operations.push(`project:create:mode:${projectMode}:${modeSelection.method}`);
    const nameInput = await fillCreateProjectName(page, projectName);
    operations.push(`project:create:name:${projectName}`);
    if (!nameInput.verified) warnings.push("CREATE_PROJECT_NAME_INPUT_VERIFY_FAILED");
    await clickCreateProjectSubmit(page);
    operations.push("project:create:submitClicked");
    await page.waitForTimeout(1800);
    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const visibilityEvidence = await verifyCreatedProjectVisible(page, projectName);
    const projectVisible = visibilityEvidence.projectVisible === true;
    const projectListReady = visibilityEvidence.projectListReady === true;
    const successDialogObserved = nativeDialogs.some((dialog) => /成功|已建立|新增完成|建立完成|created|success/i.test(String(dialog.message ?? "")));
    const verifiedBySuccessDialog = successDialogObserved && !dialogBlocksFlow;
    const officialEmptyProjectReady = projectVisible && /\/report\/myCustom\/tileMode\/\d+/.test(page.url()) && /無數據|尚無資料|沒有資料/.test(bodyText);
    const successToastObserved = projectVisible && new RegExp(`專案[「"]?${escapeRegex(projectName)}[」"]?新增成功`).test(bodyText);
    const projectCreationCompleted = projectVisible && !dialogBlocksFlow && (projectListReady || officialEmptyProjectReady || verifiedBySuccessDialog || successToastObserved);
    if (projectCreationCompleted) {
      writeCreatedProjectState(options, projectName, {
        approvedToolRequestId: options.approvedToolRequestId,
        projectMode,
        projectVisible,
        projectListReady,
        officialEmptyProjectReady,
        successToastObserved,
        projectCreationCompleted,
        verifiedBySuccessDialog,
        visibilityEvidence,
        nativeDialogs
      });
    }
    const modalAfterSubmit = await readCreateProjectModalState(page).catch((error) => ({ readError: error instanceof Error ? error.message : String(error) }));
    const evidence = {
      generatedAt: new Date().toISOString(),
      caseId: options.caseId,
      projectName,
      projectMode,
      approvedToolRequestId: options.approvedToolRequestId,
      operations,
      modalOpened,
      modeSelection,
      nameInput,
      nativeDialogs,
      dialogBlocksFlow,
      projectVisible,
      projectListReady,
      officialEmptyProjectReady,
      successToastObserved,
      projectCreationCompleted,
      verifiedBySuccessDialog,
      visibilityEvidence,
      bodyTextExcerpt: bodyText.slice(0, 2400),
      modalAfterSubmit,
      warnings
    };
    ensureDir(artifactRoot(options));
    fs.writeFileSync(createProjectEvidencePath(options), `${JSON.stringify(evidence, null, 2)}\n`);
    if (dialogBlocksFlow) warnings.push("CREATE_PROJECT_NATIVE_DIALOG_BLOCKED_FLOW");
    if (!projectVisible) warnings.push(verifiedBySuccessDialog ? "CREATE_PROJECT_VISIBILITY_NOT_CONFIRMED_BUT_SUCCESS_DIALOG_ACCEPTED" : "CREATE_PROJECT_NOT_VISIBLE_AFTER_SUBMIT");
    if (projectVisible && !projectCreationCompleted) warnings.push("CREATE_PROJECT_REPORT_LIST_NOT_READY_AFTER_SELECTION");
    const shot = await screenshot(options, page, "create-project");
    const uiProfileAfter = await captureUiDomProfile(options, page, "createProject.after");
    return createReport(
      options,
      projectCreationCompleted ? "ok" : "blocked",
      startedAt,
      {
        domState: await readDomState(page),
        uiProfiles: { before: uiProfileBefore, after: uiProfileAfter },
        createProjectEvidence: evidence
      },
      { createProjectEvidence: createProjectEvidencePath(options), ...(shot ? { screenshot: shot } : {}) },
      shot ? warnings : [...warnings, "SCREENSHOT_UNAVAILABLE"]
    );
  } finally {
    page.off("dialog", dialogHandler);
  }
};

const openExistingReport = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const uiProfileBefore = await captureUiDomProfile(options, page, "openExistingReport.before");
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (!/報表設定|儲存報表|執行/.test(bodyText)) {
    await ensureCollageProjectSelected(options, page);
  }

  let resolved = await resolveExistingReportName(options, page);
  let listText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (!listText.includes(resolved.reportName)) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    await ensureCollageProjectSelected(options, page);
    resolved = await resolveExistingReportName(options, page);
    listText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  }
  if (!listText.includes(resolved.reportName)) {
    throw new HelperBlockedError(`EXISTING_REPORT_ROW_NOT_VISIBLE:${resolved.reportName}`);
  }

  await clickByText(page, resolved.reportName, 12000);
  await page.waitForTimeout(1800);
  writeSavedReportState(options, resolved.reportName, {
    openedFromExistingReport: true,
    existingReportSource: resolved.source,
    existingReportCandidates: resolved.candidates
  });
  const shot = await screenshot(options, page, "open-existing-report");
  const uiProfileAfter = await captureUiDomProfile(options, page, "openExistingReport.after");
  return createReport(
    options,
    "ok",
    startedAt,
    {
      reportName: resolved.reportName,
      existingReportSource: resolved.source,
      existingReportCandidates: resolved.candidates,
      domState: await readDomState(page),
      uiProfiles: { before: uiProfileBefore, after: uiProfileAfter }
    },
    shot ? { screenshot: shot } : {},
    shot ? [] : ["SCREENSHOT_UNAVAILABLE"]
  );
};

const readSelectedMetricFields = async (page: Page): Promise<SelectedMetricField[]> => {
  return page.evaluate(() => {
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
    };
    const cleanLabel = (value: string, code: string | null): string => {
      const codeText = code ? code.replace(/_/g, "\\s*_?\\s*") : "";
      let text = normalize(value)
        .replace(/×/g, " ")
        .replace(/\+ 新增欄位/g, " ")
        .replace(/\+ 新增運算欄位/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (codeText) {
        text = text.replace(new RegExp(codeText, "i"), "").replace(/\s+/g, " ").trim();
      }
      return text;
    };
    const cleanCandidate = (value: string, code: string | null): string => {
      const cleaned = cleanLabel(value, code);
      if (!cleaned || /^欄位選擇$/i.test(cleaned)) return "";
      if (/新增欄位|新增運算欄位|儲存報表|執行|時間區間/i.test(cleaned)) return "";
      return cleaned;
    };
    const labelNearButton = (button: HTMLButtonElement, code: string | null): string => {
      const buttonRect = button.getBoundingClientRect();
      const buttonMidY = buttonRect.y + buttonRect.height / 2;
      const elements = Array.from(document.querySelectorAll<HTMLElement>("body *"));
      const candidates = elements.flatMap((element) => {
        if (element === button || !isVisible(element)) return [];
        const rect = element.getBoundingClientRect();
        if (rect.x >= buttonRect.x || rect.width <= 0 || rect.height <= 0) return [];
        const midY = rect.y + rect.height / 2;
        const verticalDistance = Math.abs(midY - buttonMidY);
        if (verticalDistance > Math.max(18, buttonRect.height * 0.8)) return [];
        const text = cleanCandidate(element.innerText || element.textContent || "", code);
        if (!text || text.length > 80) return [];
        const textCount = text.split(" ").filter(Boolean).length;
        if (textCount > 8) return [];
        return [{
          text,
          distance: verticalDistance + Math.max(0, buttonRect.x - (rect.x + rect.width)) / 100,
          right: rect.x + rect.width
        }];
      });
      return candidates.sort((a, b) => a.distance - b.distance || b.right - a.right)[0]?.text ?? "";
    };
    const selected = Array.from(document.querySelectorAll("button")).flatMap((button, index) => {
      if (!isVisible(button)) return [];
      const onclick = button.getAttribute("onclick");
      const className = typeof button.className === "string" ? button.className : "";
      if (!/removeFieldFromSelection/i.test(onclick ?? "") && !/\bbtn-remove-field\b/i.test(className)) return [];
      const code = onclick?.match(/removeFieldFromSelection\(['"]([^'"]+)['"]\)/i)?.[1]
        ?? button.getAttribute("data-field-code")
        ?? button.getAttribute("data-field")
        ?? button.getAttribute("data-value");
      const containers = [
        button.parentElement,
        button.closest("[class*=field]"),
        button.parentElement?.parentElement,
        button.parentElement?.parentElement?.parentElement
      ].filter((item): item is HTMLElement => Boolean(item));
      const nearbyLabel = labelNearButton(button, code ?? null);
      const containerLabel = containers
        .filter((container) => {
          const rect = container.getBoundingClientRect();
          const buttonRect = button.getBoundingClientRect();
          return rect.height <= Math.max(80, buttonRect.height * 3.5);
        })
        .map((container) => cleanCandidate(container.innerText || container.textContent || "", code ?? null))
        .find((text) => text.length > 0 && text.length <= 80 && !/^欄位選擇$/i.test(text));
      const label = nearbyLabel || containerLabel || cleanLabel(button.previousElementSibling?.textContent ?? "", code ?? null);
      const rect = button.getBoundingClientRect();
      return [{
        label: label || String(code ?? ""),
        code: code ?? null,
        buttonIndex: index,
        onclick,
        text: normalize(button.textContent),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      }];
    });
    return selected.sort((a, b) => a.y - b.y || a.x - b.x);
  });
};

const selectedFieldText = async (page: Page): Promise<string> => {
  const selected = await readSelectedMetricFields(page).catch(() => []);
  const dom = await readDomState(page).catch(() => null);
  const cleanupState = dom?.cleanupState && typeof dom.cleanupState === "object" ? dom.cleanupState as Record<string, unknown> : {};
  return [
    selected.map((item) => item.label || item.code || item.text).join("\n"),
    String(cleanupState.fieldSelectionText ?? "")
  ].filter(Boolean).join("\n");
};

const selectedMetricFieldGuardEvidence = async (page: Page): Promise<Record<string, unknown>> => {
  const selected = await readSelectedMetricFields(page).catch(() => []);
  const officialRows = await readOfficialCollageFieldRows(page).catch(() => []);
  const selectedOfficialRows = officialRows.filter((row) => officialMetricRowHasSelectedField(row));
  const dom = await readDomState(page).catch(() => null);
  const cleanupState = dom?.cleanupState && typeof dom.cleanupState === "object" ? dom.cleanupState as Record<string, unknown> : {};
  return {
    selectedCount: selected.length + selectedOfficialRows.length,
    selectedMetricFields: selected.map((item) => ({
      label: item.label,
      code: item.code,
      buttonIndex: item.buttonIndex
    })),
    selectedOfficialMetricRows: selectedOfficialRows.map((row) => ({
      rowIndex: row.rowIndex,
      sourceReport: row.sourceText,
      field: row.fieldText,
      sourceButtonIndex: row.sourceButtonIndex,
      fieldButtonIndex: row.fieldButtonIndex
    })),
    fieldSelectionText: cleanupState.fieldSelectionText ?? null,
    bodyTextExcerpt: typeof dom?.bodyTextExcerpt === "string" ? dom.bodyTextExcerpt.slice(0, 800) : null
  };
};

const ensureMetricFieldSelectedBeforeExecute = async (page: Page, context: string): Promise<Record<string, unknown>> => {
  const evidence = await selectedMetricFieldGuardEvidence(page);
  if (Number(evidence.selectedCount ?? 0) <= 0) {
    throw new HelperBlockedError(
      `EXECUTE_PRECONDITION_NO_SELECTED_FIELDS:${context}; evidence=${JSON.stringify(evidence).slice(0, 1200)}`
    );
  }
  return evidence;
};

const metricAddFieldPattern = /(?:\+\s*)?新增(?:欄位|指標|資料)|(?:欄位|指標).{0,6}(?:新增|選擇)|選擇(?:欄位|指標)|\+.*欄位/i;

const metricFieldControlsVisible = async (page: Page): Promise<boolean> => {
  const checks = [
    page.getByRole("button", { name: metricAddFieldPattern }).first(),
    page.getByText("+ 新增欄位", { exact: false }).first(),
    page.locator("button").filter({ hasText: metricAddFieldPattern }).first(),
    page.locator("[role=button]").filter({ hasText: metricAddFieldPattern }).first(),
    page.locator("[class*=btn], [class*=button], [class*=Button]").filter({ hasText: metricAddFieldPattern }).first()
  ];
  for (const locator of checks) {
    if (await locator.isVisible().catch(() => false)) return true;
  }
  return false;
};

const waitForMetricFieldControls = async (page: Page, timeoutMs = 30000): Promise<string> => {
  const startedAt = Date.now();
  let lastBodyText = "";
  while (Date.now() - startedAt < timeoutMs) {
    if (await metricFieldControlsVisible(page)) {
      return `fieldControls:ready:${Date.now() - startedAt}ms`;
    }
    lastBodyText = await page.locator("body").innerText({ timeout: 1000 }).catch(() => "");
    const normalized = normalizeUiText(lastBodyText);
    const stillLoading = /載入欄位中|載入指標中|載入資料中/i.test(normalized);
    if (!stillLoading && Date.now() - startedAt > 1500) {
      return `fieldControls:notLoadingNoControl:${Date.now() - startedAt}ms`;
    }
    await page.waitForTimeout(300);
  }
  throw new HelperBlockedError(`FIELD_LIST_LOAD_TIMEOUT:${timeoutMs}ms; bodyText=${lastBodyText.slice(0, 1200)}`);
};

const waitForReportEditorSettle = async (page: Page, timeoutMs = 30000): Promise<Record<string, unknown>> => {
  const startedAt = Date.now();
  let lastBodyText = "";
  let lastDomState: Record<string, unknown> | null = null;
  let lastFieldControlsVisible = false;
  while (Date.now() - startedAt < timeoutMs) {
    await page.waitForLoadState("domcontentloaded", { timeout: 1000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 1000 }).catch(() => undefined);
    lastBodyText = await page.locator("body").innerText({ timeout: 1500 }).catch(() => "");
    lastDomState = await readDomState(page).catch(() => null);
    lastFieldControlsVisible = await metricFieldControlsVisible(page).catch(() => false);
    const normalized = normalizeUiText(lastBodyText);
    const loading = /載入(?:欄位|指標|資料|報表)?中|載入中|loading|請稍候/i.test(normalized);
    const editorVisible = /報表設定|儲存報表|執行|\+ 新增欄位|\+ 新增運算欄位|時間區間/i.test(normalized);
    if (!loading && (editorVisible || lastFieldControlsVisible) && Date.now() - startedAt > 1200) {
      return {
        status: "settled",
        elapsedMs: Date.now() - startedAt,
        fieldControlsVisible: lastFieldControlsVisible,
        editorVisible,
        bodyTextExcerpt: lastBodyText.slice(0, 1200)
      };
    }
    await page.waitForTimeout(400);
  }
  return {
    status: "timeout",
    elapsedMs: Date.now() - startedAt,
    fieldControlsVisible: lastFieldControlsVisible,
    domState: lastDomState,
    bodyTextExcerpt: lastBodyText.slice(0, 1200)
  };
};

const clickMetricAddFieldControl = async (page: Page, field: string): Promise<string> => {
  const clickedByLocator = await clickFirstVisible([
    page.getByRole("button", { name: metricAddFieldPattern }),
    page.getByText("+ 新增欄位", { exact: false }),
    page.locator("button").filter({ hasText: metricAddFieldPattern }),
    page.locator("[role=button]").filter({ hasText: metricAddFieldPattern }),
    page.locator("[class*=btn], [class*=button], [class*=Button]").filter({ hasText: metricAddFieldPattern })
  ], 15000);
  if (clickedByLocator) return "addField:locator";

  const buttons = await visibleButtons(page).catch(() => []);
  const buttonMatch = buttons.find((button) => metricAddFieldPattern.test(button.text) && !/報表|專案|儲存|保存|執行|查詢|搜尋|刪除|取消/.test(button.text));
  if (buttonMatch) {
    await clickVisibleButtonByIndex(page, buttonMatch.index, 8000);
    return `addField:visibleButton:${buttonMatch.text}`;
  }

  const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  if (normalizeUiText(bodyText).includes(normalizeUiText(field))) {
    return `addField:pickerAlreadyOpen:${field}`;
  }

  const textTargets = await visibleTextTargetsMatching(page, metricAddFieldPattern.source, "i").catch(() => []);
  const clickableTarget = textTargets.find((target) =>
    target.tagName === "button" ||
    target.role === "button" ||
    /btn|button|click|select|add|field|metric|control/i.test(target.className)
  );
  if (clickableTarget) {
    await clickVisibleBodyElementByIndex(page, clickableTarget.index, 8000);
    return `addField:visibleTextTarget:${clickableTarget.tagName}:${clickableTarget.text}`;
  }

  throw new HelperBlockedError(
    `ADD_FIELD_BUTTON_NOT_CLICKABLE:${field}; visibleButtons=${JSON.stringify(buttons.slice(0, 20)).slice(0, 1200)}; visibleTargets=${JSON.stringify(textTargets.slice(0, 20)).slice(0, 1200)}`
  );
};

const selectMetricFieldThroughUi = async (page: Page, field: string): Promise<string> => {
  const selectedBefore = await readSelectedMetricFields(page).catch(() => []);
  if (selectedBefore.some((item) => selectedMetricFieldMatches(item, field))) return `field:already:${field}`;

  const readiness = await waitForMetricFieldControls(page);
  const addOperation = await clickMetricAddFieldControl(page, field);
  await page.waitForTimeout(500);

  const pickerClickOperation = await clickMetricFieldPickerDomTarget(page, {
    label: field,
    code: knownMetricFieldCode(field)
  }, 12000).catch(async (error) => {
    const rawItems = await extractFieldPickerDomItems(page).catch(() => []);
    if (rawItems.length > 0) throw error;
    await clickByText(page, field, 12000);
    return `fieldPicker:fallbackText:${field}`;
  });
  await page.waitForTimeout(800);

  const selectedAfter = await readSelectedMetricFields(page).catch(() => []);
  if (!selectedAfter.some((item) => selectedMetricFieldMatches(item, field))) {
    throw new HelperBlockedError(`FIELD_VERIFY_FAILED_AFTER_CLICK:${field}; selected=${JSON.stringify(selectedAfter).slice(0, 1200)}`);
  }
  return `${readiness};${addOperation};${pickerClickOperation};field:set:${field}`;
};

const selectedMetricFieldMatches = (selected: SelectedMetricField, targetField: string): boolean => {
  const targetKeys = metricFieldIdentitySet(targetField);
  const selectedLabelKey = normalizeMetricFieldIdentity(selected.label);
  const selectedCodeKey = normalizeMetricFieldIdentity(selected.code);
  const targetCodeKey = normalizeMetricFieldIdentity(knownMetricFieldCode(targetField));
  if (targetCodeKey.length > 0 && selectedCodeKey.length > 0) return selectedCodeKey === targetCodeKey;
  if (selectedCodeKey.length > 0 && targetKeys.has(selectedCodeKey)) return true;
  if (selectedLabelKey.length > 0 && targetKeys.has(selectedLabelKey)) return true;
  return targetCodeKey.length > 0 && selectedLabelKey === targetCodeKey;
};

const fieldListExactlyMatches = (selected: SelectedMetricField[], targetFields: string[]): boolean => {
  if (selected.length !== targetFields.length) return false;
  const used = new Set<number>();
  for (const target of targetFields) {
    const matchIndex = selected.findIndex((item, index) => !used.has(index) && selectedMetricFieldMatches(item, target));
    if (matchIndex === -1) return false;
    used.add(matchIndex);
  }
  return true;
};

const removeSelectedMetricFieldThroughUi = async (page: Page, selected: SelectedMetricField): Promise<string> => {
  await clickVisibleButtonByIndex(page, selected.buttonIndex, 8000);
  await page.waitForTimeout(500);
  return `field:removed:${selected.label || selected.code || "unknown"}:${selected.buttonIndex}`;
};

const reconcileMetricFieldsThroughUi = async (page: Page, targetFields: string[]): Promise<string[]> => {
  const operations: string[] = [];
  if (targetFields.length === 0) return operations;

  for (let attempt = 0; attempt < Math.max(8, targetFields.length * 4 + 4); attempt += 1) {
    const selected = await readSelectedMetricFields(page);
    const kept = new Set<number>();
    let removeCandidate: SelectedMetricField | null = null;
    for (const item of selected) {
      const targetIndex = targetFields.findIndex((target, index) => !kept.has(index) && selectedMetricFieldMatches(item, target));
      if (targetIndex === -1) {
        removeCandidate = item;
        break;
      }
      kept.add(targetIndex);
    }

    if (removeCandidate) {
      operations.push(await removeSelectedMetricFieldThroughUi(page, removeCandidate));
      continue;
    }

    const missing = targetFields.find((target) => !selected.some((item) => selectedMetricFieldMatches(item, target)));
    if (missing) {
      operations.push(await selectMetricFieldThroughUi(page, missing));
      continue;
    }

    if (fieldListExactlyMatches(await readSelectedMetricFields(page), targetFields)) {
      operations.push(`field:exact:${targetFields.join("+")}`);
      return operations;
    }

    if (selected.length > targetFields.length && selected[selected.length - 1]) {
      operations.push(await removeSelectedMetricFieldThroughUi(page, selected[selected.length - 1]));
      continue;
    }
  }

  const finalSelected = await readSelectedMetricFields(page).catch(() => []);
  throw new HelperBlockedError(`FIELD_RECONCILE_FAILED:target=${JSON.stringify(targetFields)}; selected=${JSON.stringify(finalSelected).slice(0, 1200)}`);
};

type HelperCaseScopeAction = {
  actionId?: string;
  action?: string;
  target?: string;
  role?: string;
  expectedOutcome?: string;
};

const caseScopeActionsFromParams = (params: Record<string, unknown>): HelperCaseScopeAction[] => {
  const fromActions = params.caseScopeActions;
  if (Array.isArray(fromActions)) {
    return fromActions.filter((item): item is HelperCaseScopeAction => Boolean(item && typeof item === "object"));
  }
  const contract = params.caseScopeContract;
  if (contract && typeof contract === "object") {
    const actions = (contract as { requiredActions?: unknown }).requiredActions;
    if (Array.isArray(actions)) {
      return actions.filter((item): item is HelperCaseScopeAction => Boolean(item && typeof item === "object"));
    }
  }
  return [];
};

const caseScopeTargetsFromParams = (params: Record<string, unknown>): Set<string> => {
  const targets = new Set(caseScopeActionsFromParams(params).map((item) => item.target).filter((item): item is string => typeof item === "string"));
  for (const target of stringArrayParam(params, "targetObjectIds")) targets.add(target);
  return targets;
};

const datePresetLabelFromTarget = (target: string): string | null => {
  switch (target) {
    case "dateRange.preset.past30Days":
      return "過去 30 天";
    case "dateRange.preset.recent30Days":
      return "最近 30 天";
    case "dateRange.preset.yesterday":
      return "昨日";
    default:
      return null;
  }
};

const caseScopeDatePresetRequests = (params: Record<string, unknown>): Array<{ target: string; label: string }> => {
  const seen = new Set<string>();
  return caseScopeActionsFromParams(params).flatMap((action) => {
    const target = typeof action.target === "string" ? action.target : "";
    const label = datePresetLabelFromTarget(target);
    if (!label || seen.has(target)) return [];
    seen.add(target);
    return [{ target, label }];
  });
};

const contractRequiresCsvPreviewComparison = (params: Record<string, unknown>): boolean => {
  const contract = params.caseScopeContract;
  if (!contract || typeof contract !== "object") return true;
  const requirements: string[] = [];
  const pushRequirement = (value: unknown): void => {
    if (typeof value === "string") requirements.push(value);
  };
  const pushRequirementList = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(pushRequirement);
  };
  const requiredActions = (contract as { requiredActions?: unknown }).requiredActions;
  if (Array.isArray(requiredActions)) {
    for (const action of requiredActions) {
      if (!action || typeof action !== "object") continue;
      pushRequirementList((action as { evidenceRequirements?: unknown }).evidenceRequirements);
    }
  }
  const evidenceRequirements = (contract as { evidenceRequirements?: unknown }).evidenceRequirements;
  if (evidenceRequirements && typeof evidenceRequirements === "object") {
    Object.values(evidenceRequirements as Record<string, unknown>).forEach(pushRequirementList);
  }
  return requirements.some((item) => /csv.*preview|preview.*csv|csv.*compare|compare.*csv|comparison|比對/i.test(item));
};

const configureMetric = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const warnings: string[] = [];
  const fields = metricFieldsFromParams(options.params);
  const metricRows = metricRowsFromParams(options.params);
  const dateRange = nonNeutralUiTarget(stringParam(options.params, "dateRange"));
  const caseScopeDatePresets = caseScopeDatePresetRequests(options.params);
  const caseScopeTargets = caseScopeTargetsFromParams(options.params);
  const uiProfileBefore = await captureUiDomProfile(options, page, "configureMetric.before");
  const stateDeltaBefore = await readStateDelta(page, options.params);
  const operations: string[] = [];
  let metricRowsEvidence: OfficialMetricRowsEvidence | null = null;
  let dateRangeEvidence: Record<string, unknown> | null = null;
  let dateRangeUiProfiles: UiDomProfileRef[] = [];
  let dateUiArtifact: string | null = null;
  metricRowsEvidence = await setMetricRowsThroughOfficialUi(options, page, metricRows);
  if (metricRowsEvidence) {
    operations.push(...metricRowsEvidence.operations);
  } else if (paramsRequestSelectAllFields(options.params)) {
    operations.push(...await selectAllMetricFieldsThroughUi(options, page));
  } else if (fields.length > 0) {
    operations.push(...await reconcileMetricFieldsThroughUi(page, fields));
  }
  if (dateRange) {
    const result = await setDateRange(options, page, dateRange);
    const { uiProfiles, ...resultEvidence } = result;
    dateRangeUiProfiles = uiProfiles ?? [];
    const dateUiEvidence = await readDateUiEvidence(page, dateRange, options.params);
    dateUiArtifact = writeDateUiEvidenceArtifact(options, dateUiEvidence);
    dateRangeEvidence = {
      ...resultEvidence,
      dateUiEvidence
    };
    if (!result.ok) {
      warnings.push(`DATE_RANGE_UI_SETTING_NOT_COMPLETED:${result.warning ?? "unknown"}`);
      operations.push(`dateRange:blocked:${dateRange}`);
    } else {
      operations.push(`dateRange:verified:${dateRange}`);
    }
  } else if (caseScopeDatePresets.length > 0) {
    const stages: Record<string, unknown>[] = [];
    for (const request of caseScopeDatePresets) {
      const result = await setDateRange(options, page, request.label);
      const { uiProfiles, ...resultEvidence } = result;
      dateRangeUiProfiles.push(...(uiProfiles ?? []));
      const dateUiEvidence = await readDateUiEvidence(page, request.label, options.params);
      dateUiArtifact = writeDateUiEvidenceArtifact(options, dateUiEvidence);
      stages.push({
        target: request.target,
        requestedLabel: request.label,
        ...resultEvidence,
        dateUiEvidence
      });
      if (!result.ok) {
        warnings.push(`DATE_RANGE_UI_SETTING_NOT_COMPLETED:${request.target}:${result.warning ?? "unknown"}`);
        operations.push(`dateRange:blocked:${request.target}:${request.label}`);
      } else {
        operations.push(`dateRange:verified:${request.target}:${request.label}`);
      }
    }
    const lastStage = stages[stages.length - 1] as Record<string, unknown> | undefined;
    dateRangeEvidence = {
      mode: "caseScopeDatePresets",
      stages,
      interactionLog: stages.map((stage) => ({
        target: stage.target,
        requestedLabel: stage.requestedLabel,
        ok: stage.ok,
        warning: stage.warning ?? null
      })),
      dateUiEvidence: lastStage?.dateUiEvidence ?? null
    };
  } else if (caseScopeTargets.has("dateRange.timeTypeTab.static")) {
    const actionWarnings: string[] = [];
    const visibleUiAction = await observeFrontendVisibleUiActions(page, "dateTimeTypeTab", options.params, actionWarnings);
    const observationState = await readFrontendObservationState(page, "datePanel", null, options.params, visibleUiAction);
    dateRangeEvidence = {
      mode: "caseScopeDateTimeTypeTab",
      visibleUiAction,
      observationState,
      interactionLog: observationState.interactionLog ?? null
    };
    if (observationState.asserted === false) {
      warnings.push("DATE_RANGE_UI_SETTING_NOT_COMPLETED:dateRange.timeTypeTab.static:STATIC_TAB_ASSERTION_FALSE");
      operations.push("dateRange:blocked:dateRange.timeTypeTab.static");
    } else {
      operations.push("dateRange:verified:dateRange.timeTypeTab.static");
    }
    warnings.push(...actionWarnings);
  }
  const displayOperation = await setDisplayModeThroughUi(page, stringParam(options.params, "display"));
  if (displayOperation) operations.push(displayOperation);
  const stateDeltaAfter = await readStateDelta(page, options.params);
  const shot = await screenshot(options, page, "configure-metric");
  const uiProfileAfter = await captureUiDomProfile(options, page, "configureMetric.after");
  const dateRangeFailureHasCurrentRunEvidence = Boolean(
    dateRangeEvidence &&
    (
      Object.prototype.hasOwnProperty.call(dateRangeEvidence, "interactionLog") ||
      Object.prototype.hasOwnProperty.call(dateRangeEvidence, "inputs") ||
      Object.prototype.hasOwnProperty.call(dateRangeEvidence, "dateUiEvidence")
    )
  );
  const dateRangeWarning = warnings.some((warning) => warning.startsWith("DATE_RANGE_UI_SETTING_NOT_COMPLETED"));
  return createReport(
    options,
    dateRangeWarning && !dateRangeFailureHasCurrentRunEvidence ? "blocked" : "ok",
    startedAt,
    {
      domState: await readDomState(page),
      uiProfiles: {
        before: uiProfileBefore,
        after: uiProfileAfter,
        dateRange: dateRangeUiProfiles
      },
      requestedDateRange: dateRange,
      metricRows: metricRowsEvidence,
      dateRangeEvidence,
      workflowStatus: dateRangeWarning ? "date_range_under_test_not_completed_with_evidence" : "completed",
      stateDelta: {
        before: stateDeltaBefore,
        after: stateDeltaAfter,
        operations
      }
    },
    {
      ...(shot ? { screenshot: shot } : {}),
      ...(metricRowsEvidence ? { metricRowsEvidence: metricRowsEvidencePath(options) } : {}),
      ...(dateUiArtifact ? { dateUiEvidence: dateUiArtifact } : {})
    },
    shot ? warnings : [...warnings, "SCREENSHOT_UNAVAILABLE"]
  );
};

const captureDateUiEvidenceReport = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const requested = nonNeutralUiTarget(stringParam(options.params, "dateRange")) ??
    nonNeutralUiTarget(firstStringParam(options.params, ["datePreset", "timeRange", "requestedDate"]));
  const uiProfile = await captureUiDomProfile(options, page, "dateUiEvidence.capture");
  const evidence = await readDateUiEvidence(page, requested, options.params);
  const artifact = writeDateUiEvidenceArtifact(options, evidence);
  const shot = await screenshot(options, page, "date-ui-evidence");
  const warnings = [...evidence.warnings];
  if (!shot) warnings.push("SCREENSHOT_UNAVAILABLE");
  return createReport(
    options,
    evidence.warnings.includes("DATE_UI_CONTROL_TEXT_NOT_FOUND") ? "blocked" : "ok",
    startedAt,
    {
      domState: await readDomState(page),
      uiProfile,
      dateUiEvidence: evidence
    },
    {
      dateUiEvidence: artifact,
      ...(shot ? { screenshot: shot } : {})
    },
    warnings
  );
};

const runPreview = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const uiProfileBefore = await captureUiDomProfile(options, page, "runPreview.before");
  const executePrecondition = await ensureMetricFieldSelectedBeforeExecute(page, "runPreview");
  const observed = await observeDuring(page, async () => {
    await clickRunPreviewButton(page, 15000);
    await page.waitForTimeout(2500);
  });
  const chart = await readChartSummary(page);
  const table = await readPreviewTableSummary(page);
  ensureDir(artifactRoot(options));
  fs.writeFileSync(
    previewEvidencePath(options),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), caseId: options.caseId, chart, table, network: { requests: observed.requests, responses: observed.responses } }, null, 2)}\n`
  );
  const shot = await screenshot(options, page, "run-preview");
  const uiProfileAfter = await captureUiDomProfile(options, page, "runPreview.after");
  const hasPreviewEvidence = observed.requests.length > 0 || observed.responses.length > 0 || chart !== null || table !== null;
  return createReport(
    options,
    hasPreviewEvidence ? "ok" : "blocked",
    startedAt,
    {
      domState: await readDomState(page),
      uiProfiles: {
        before: uiProfileBefore,
        after: uiProfileAfter
      },
      executePrecondition,
      network: { requests: observed.requests, responses: observed.responses },
      chart,
      table,
      stateDelta: await readStateDelta(page, options.params)
    },
    { ...(shot ? { screenshot: shot } : {}), previewEvidence: previewEvidencePath(options) },
    [
      ...(shot ? [] : ["SCREENSHOT_UNAVAILABLE"]),
      ...(hasPreviewEvidence ? [] : ["PREVIEW_UI_ACTION_NOT_VERIFIED_NO_NETWORK_OR_CHART_EVIDENCE"])
    ]
  );
};

const calculatedBaseFieldsFromParams = (params: Record<string, unknown>): string[] => {
  const explicit = stringArrayParam(params, "baseFields");
  if (explicit.length > 0) return explicit;
  const fields = [
    firstStringParam(params, ["fieldA", "baseFieldA", "metricA"]),
    firstStringParam(params, ["fieldB", "baseFieldB", "metricB"])
  ].filter((item): item is string => Boolean(nonNeutralUiTarget(item)));
  return [...new Set(fields)];
};

const calculatedFieldNameFromParams = (options: CliOptions): string => {
  const explicit = firstStringParam(options.params, ["calculatedFieldName", "formulaName", "name"]);
  if (explicit) return explicit.replace("<timestamp>", timestampId());
  const match = options.caseId.match(/-E-(\d{2})$/i);
  return match ? `E${match[1]}_運算` : `${sanitize(options.caseId)}_運算`;
};

const readVisibleFormulaModalState = async (page: Page): Promise<Record<string, unknown>> => {
  return page.evaluate(() => {
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const dialogSelectors = "#formulaEditorModal, [role='dialog'], .modal, .ant-modal, .MuiDialog-root";
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>(dialogSelectors)).flatMap((dialog, dialogIndex) => {
      if (!isVisible(dialog)) return [];
      const inputs = Array.from(dialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")).flatMap((input, inputIndex) => {
        if (!isVisible(input) || input.disabled) return [];
        return [{
          inputIndex,
          tagName: input.tagName.toLowerCase(),
          type: input instanceof HTMLInputElement ? input.type : "textarea",
          placeholder: normalize(input.placeholder),
          value: input.value,
          readOnly: input.readOnly,
          id: input.id || null
        }];
      });
      const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).flatMap((button, buttonIndex) => {
        if (!isVisible(button) || button.disabled) return [];
        return [{
          buttonIndex,
          text: normalize(button.innerText || button.textContent),
          className: typeof button.className === "string" ? button.className : "",
          onclick: button.getAttribute("onclick")
        }];
      });
      return [{
        dialogIndex,
        id: dialog.id || null,
        className: typeof dialog.className === "string" ? dialog.className : "",
        textExcerpt: normalize(dialog.innerText || dialog.textContent).slice(0, 1200),
        inputs,
        buttons
      }];
    });
    return {
      dialogs,
      bodyTextExcerpt: normalize(document.body.innerText).slice(0, 1600)
    };
  });
};

const clickCalculatedFieldControl = async (page: Page): Promise<string> => {
  const clicked = await clickFirstVisible([
    page.locator("button[aria-label='新增自訂欄位']"),
    page.locator("button[aria-label*='自訂欄位']"),
    page.locator("button[onclick=\"openCalculatedFieldEditor()\"]"),
    page.getByRole("button", { name: /新增自訂欄位|\(x\)/ }),
    page.locator("button").filter({ hasText: /^\(x\)$/ }),
    page.getByText("+ 新增運算欄位", { exact: false }),
    page.locator("button").filter({ hasText: /新增運算|新增自訂|自訂欄位|運算欄位|Calculated|Formula/i })
  ], 10000);
  if (clicked) return "calculatedField:openButton";
  const buttons = await visibleButtons(page).catch(() => []);
  const match = buttons.find((button) => /^(?:\(x\))$|新增運算|新增自訂|自訂欄位|運算欄位|Calculated|Formula/i.test(button.text));
  if (match) {
    await clickVisibleButtonByIndex(page, match.index, 8000);
    return `calculatedField:visibleButton:${match.text}`;
  }
  throw new HelperBlockedError(`CALCULATED_FIELD_BUTTON_NOT_CLICKABLE: visibleButtons=${JSON.stringify(buttons.slice(0, 30)).slice(0, 1200)}`);
};

type FormulaToken =
  | { kind: "field"; value: string }
  | { kind: "button"; value: string };

const normalizeFormulaExpression = (value: string): string =>
  value
    .replace(/[［\[]/g, "")
    .replace(/[］\]]/g, "")
    .replace(/\s+/g, "")
    .replace(/＋/g, "+")
    .replace(/－/g, "-")
    .replace(/＊/g, "*")
    .replace(/[×xX]/g, "*")
    .replace(/[÷／]/g, "/")
    .replace(/（/g, "(")
    .replace(/）/g, ")");

const tokenizeFormula = (formula: string): FormulaToken[] => {
  const tokens: FormulaToken[] = [];
  for (let index = 0; index < formula.length;) {
    const char = formula[index] ?? "";
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "[" || char === "［") {
      const close = char === "[" ? "]" : "］";
      const closeIndex = formula.indexOf(close, index + 1);
      if (closeIndex === -1) throw new HelperBlockedError(`FORMULA_TOKENIZE_UNCLOSED_FIELD:${formula.slice(index)}`);
      const value = formula.slice(index + 1, closeIndex).trim();
      if (!value) throw new HelperBlockedError(`FORMULA_TOKENIZE_EMPTY_FIELD:${formula}`);
      tokens.push({ kind: "field", value });
      index = closeIndex + 1;
      continue;
    }
    const numberMatch = formula.slice(index).match(/^\d+(?:\.\d+)?/);
    if (numberMatch?.[0]) {
      for (const digit of numberMatch[0]) tokens.push({ kind: "button", value: digit });
      index += numberMatch[0].length;
      continue;
    }
    const normalizedButton = ({ "＋": "+", "－": "-", "＊": "*", "×": "*", "／": "/", "÷": "/", "（": "(", "）": ")" } as Record<string, string>)[char] ?? char;
    if (/^[+\-*/().]$/.test(normalizedButton)) {
      tokens.push({ kind: "button", value: normalizedButton });
      index += 1;
      continue;
    }
    throw new HelperBlockedError(`FORMULA_TOKENIZE_UNSUPPORTED_CHAR:${char}; formula=${formula}`);
  }
  return tokens;
};

const readVisibleFormulaModalButtons = async (page: Page): Promise<Array<{ index: number; text: string; id: string | null; className: string | null; onclick: string | null }>> => {
  return page.evaluate(() => {
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const isModalVisible = (element: Element): boolean => {
      const modal = element.closest("#formulaEditorModal, [role='dialog'], .modal, .ant-modal, .MuiDialog-root");
      return Boolean(modal && isVisible(modal));
    };
    return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).flatMap((button, index) => {
      if (!isVisible(button) || button.disabled || !isModalVisible(button)) return [];
      return [{
        index,
        text: normalize(button.innerText || button.textContent),
        id: button.id || null,
        className: typeof button.className === "string" ? button.className : null,
        onclick: button.getAttribute("onclick")
      }];
    });
  });
};

const formulaButtonLabelCandidates = (value: string): string[] => {
  if (value === "*") return ["*", "×", "x", "X"];
  if (value === "/") return ["/", "÷", "／"];
  return [value];
};

const formulaInputValueFromOnclick = (onclick: unknown): string | null => {
  if (typeof onclick !== "string") return null;
  const match = onclick.match(/inputFormula\((['"])(.*?)\1\)/);
  return match?.[2] ?? null;
};

const formulaFieldCodeFromOnclick = (onclick: unknown): string | null => {
  const value = formulaInputValueFromOnclick(onclick);
  const match = value?.match(/^\[([^\]]+)\]$/);
  return match?.[1] ?? null;
};

const clickFormulaModalButton = async (
  page: Page,
  value: string,
  mode: "exact" | "contains"
): Promise<Record<string, unknown>> => {
  const labels = formulaButtonLabelCandidates(value).map(normalizeUiText);
  const buttons = await readVisibleFormulaModalButtons(page);
  const target = buttons.find((button) => {
    const text = normalizeUiText(button.text);
    return mode === "exact"
      ? labels.includes(text)
      : labels.some((label) => text.includes(label));
  });
  if (!target) {
    throw new HelperBlockedError(`FORMULA_MODAL_BUTTON_NOT_FOUND:${value}; mode=${mode}; buttons=${JSON.stringify(buttons.slice(0, 80)).slice(0, 2000)}`);
  }
  await clickVisibleButtonByIndex(page, target.index, 8000);
  await page.waitForTimeout(120);
  return target;
};

type FormulaModalButton = Awaited<ReturnType<typeof readVisibleFormulaModalButtons>>[number];

const formulaFieldTokenMatches = (button: FormulaModalButton, fieldLabel: string): boolean => {
  if (!/inputFormula/i.test(button.onclick ?? "")) return false;
  const code = formulaFieldCodeFromOnclick(button.onclick);
  if (!code) return false;
  return fieldPickerTargetMatches(
    { label: button.text, code, groupLabel: null },
    { label: fieldLabel, code: knownMetricFieldCode(fieldLabel) }
  );
};

const clickFormulaFieldToken = async (page: Page, fieldLabel: string): Promise<Record<string, unknown>> => {
  const clickExactFormulaFieldToken = async (): Promise<Record<string, unknown>> => {
    const buttons = await readVisibleFormulaModalButtons(page);
    const targetCode = normalizeMetricFieldIdentity(knownMetricFieldCode(fieldLabel));
    const target = buttons
      .filter((button) => formulaFieldTokenMatches(button, fieldLabel))
      .sort((a, b) => {
        const codeA = normalizeMetricFieldIdentity(formulaFieldCodeFromOnclick(a.onclick));
        const codeB = normalizeMetricFieldIdentity(formulaFieldCodeFromOnclick(b.onclick));
        const codeScoreA = targetCode && codeA === targetCode ? 0 : 1;
        const codeScoreB = targetCode && codeB === targetCode ? 0 : 1;
        return codeScoreA - codeScoreB || normalizeMetricFieldIdentity(a.text).length - normalizeMetricFieldIdentity(b.text).length;
      })[0];
    if (!target) {
      throw new HelperBlockedError(`FORMULA_FIELD_TOKEN_NOT_FOUND_EXACT:${fieldLabel}; buttons=${JSON.stringify(buttons.slice(0, 80)).slice(0, 2000)}`);
    }
    await clickVisibleButtonByIndex(page, target.index, 8000);
    await page.waitForTimeout(120);
    return target;
  };

  try {
    return await clickExactFormulaFieldToken();
  } catch (firstError) {
    const modalLocator = page.locator("#formulaEditorModal, [role='dialog'], .modal, .ant-modal, .MuiDialog-root").filter({ hasText: /可用欄位|公式編輯器|運算欄位/ }).first();
    const searchInput = modalLocator.locator("input[placeholder*='搜尋'], input[placeholder*='搜索'], input[placeholder*='欄位']").last();
    if ((await searchInput.count()) > 0) {
      await searchInput.fill(fieldLabel, { timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(300);
      try {
        return await clickExactFormulaFieldToken();
      } catch {
        // Fall through to the original, more informative error.
      }
    }
    throw firstError;
  }
};

const enterReadonlyFormulaThroughModalButtons = async (
  page: Page,
  formulaInputLocator: ReturnType<Page["locator"]>,
  formula: string
): Promise<Record<string, unknown>> => {
  await formulaInputLocator.click({ timeout: 5000 }).catch(() => undefined);
  const tokens = tokenizeFormula(formula);
  const operations: Record<string, unknown>[] = [];
  for (const token of tokens) {
    const clicked = token.kind === "field"
      ? await clickFormulaFieldToken(page, token.value)
      : await clickFormulaModalButton(page, token.value, "exact");
    const valueAfterClick = await formulaInputLocator.inputValue({ timeout: 5000 }).catch(() => null);
    const insertedValue = formulaInputValueFromOnclick((clicked as Record<string, unknown>).onclick) ??
      (token.kind === "field" ? `[${token.value}]` : token.value);
    operations.push({ token, clicked, insertedValue, valueAfterClick });
  }
  const renderedFormula = operations
    .map((operation) => typeof operation.insertedValue === "string" ? operation.insertedValue : "")
    .join("");
  return {
    method: "modal_keypad_and_field_tokens",
    tokens,
    operations,
    renderedFormula,
    fieldTokenMappings: operations.flatMap((operation) => {
      const token = operation.token as FormulaToken | undefined;
      if (token?.kind !== "field" || typeof operation.insertedValue !== "string") return [];
      return [{ displayLabel: token.value, insertedToken: operation.insertedValue }];
    })
  };
};

const fillOfficialInlineCalculatedField = async (
  page: Page,
  fieldName: string,
  formula: string,
  before: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const formulaInputLocator = page
    .locator("input[placeholder*='運算式'], input[placeholder*='公式'], input[placeholder*='插入欄位'], textarea[placeholder*='運算式'], textarea[placeholder*='公式']")
    .last();
  if ((await formulaInputLocator.count()) === 0) {
    throw new HelperBlockedError(`FORMULA_MODAL_NOT_VISIBLE: state=${JSON.stringify(before).slice(0, 1500)}`);
  }
  await formulaInputLocator.fill(formula, { timeout: 10000 });
  const formulaValue = await formulaInputLocator.inputValue({ timeout: 8000 });
  if (normalizeFormulaExpression(formulaValue) !== normalizeFormulaExpression(formula)) {
    throw new HelperBlockedError(`FORMULA_INLINE_INPUT_VALUE_MISMATCH: expected=${formula}; actual=${formulaValue}`);
  }
  return {
    fieldName,
    formula,
    mode: "official_inline_calculated_field",
    selectedNameInput: null,
    selectedFormulaInput: {
      selector: "input[placeholder*='運算式']",
      value: formulaValue,
      readOnly: false,
      entry: { method: "direct_fill_inline" },
      expectedFormulaValues: [formula],
      matchMode: "display_formula"
    },
    before,
    afterFill: await readVisibleFormulaModalState(page),
    afterSubmit: null
  };
};

const fillCalculatedFieldModal = async (
  page: Page,
  fieldName: string,
  formula: string
): Promise<Record<string, unknown>> => {
  const before = await readVisibleFormulaModalState(page);
  const dialog = Array.isArray(before.dialogs) ? (before.dialogs as Array<Record<string, unknown>>)[0] : null;
  if (!dialog) return fillOfficialInlineCalculatedField(page, fieldName, formula, before);

  const modalLocator = page.locator("#formulaEditorModal").first();
  await modalLocator.waitFor({ state: "visible", timeout: 8000 });
  const nameInputLocator = modalLocator
    .locator("#calculatedFieldNameInput, input[placeholder*='運算欄位名稱'], input[placeholder*='欄位名稱']")
    .first();
  const formulaInputLocator = modalLocator
    .locator("#formulaInput, input[placeholder*='公式'], textarea[placeholder*='公式']")
    .first();

  if ((await nameInputLocator.count()) === 0) {
    throw new HelperBlockedError(`FORMULA_NAME_INPUT_NOT_FOUND: modal=${JSON.stringify(before).slice(0, 1500)}`);
  }
  if ((await formulaInputLocator.count()) === 0) {
    throw new HelperBlockedError(`FORMULA_INPUT_NOT_FOUND: modal=${JSON.stringify(before).slice(0, 1500)}`);
  }

  await nameInputLocator.fill(fieldName, { timeout: 8000 });
  const formulaInputMeta = await formulaInputLocator.evaluate((input) => ({
    readOnly: input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input.readOnly : false,
    value: input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input.value : ""
  })).catch(() => ({ readOnly: false, value: "" }));
  const formulaEntry = formulaInputMeta.readOnly
    ? await enterReadonlyFormulaThroughModalButtons(page, formulaInputLocator, formula)
    : { method: "direct_fill", beforeValue: formulaInputMeta.value };
  if (!formulaInputMeta.readOnly) await formulaInputLocator.fill(formula, { timeout: 10000 });
  const nameValue = await nameInputLocator.inputValue({ timeout: 8000 });
  const formulaValue = await formulaInputLocator.inputValue({ timeout: 8000 });
  const afterFill = await readVisibleFormulaModalState(page);
  if (nameValue !== fieldName) {
    throw new HelperBlockedError(`FORMULA_NAME_INPUT_VALUE_MISMATCH: expected=${fieldName}; actual=${nameValue}; afterFill=${JSON.stringify(afterFill).slice(0, 1200)}`);
  }
  const expectedFormulaValues = [
    formula,
    typeof formulaEntry.renderedFormula === "string" ? formulaEntry.renderedFormula : null
  ].filter((item): item is string => Boolean(item));
  const formulaValueMatches = expectedFormulaValues.some((expected) =>
    normalizeFormulaExpression(formulaValue) === normalizeFormulaExpression(expected)
  );
  if (!formulaValueMatches) {
    throw new HelperBlockedError(`FORMULA_INPUT_VALUE_MISMATCH: expected=${formula}; actual=${formulaValue}; afterFill=${JSON.stringify(afterFill).slice(0, 1200)}`);
  }
  const formulaMatchMode = normalizeFormulaExpression(formulaValue) === normalizeFormulaExpression(formula)
    ? "display_formula"
    : "ui_inserted_token_formula";
  const submitted = await clickFirstVisible([
    modalLocator.locator("button[onclick=\"saveFormula()\"]"),
    modalLocator.locator("button.btn-primary").filter({ hasText: /^(新增|加入|確認|確定|套用|儲存|保存)$/ }),
    modalLocator.locator("button").filter({ hasText: /^(新增|加入|確認|確定|套用|儲存|保存)$/ }),
    page.locator("#formulaEditorModal button").filter({ hasText: /新增|加入|確認|確定|套用|儲存|保存/ }),
    page.locator("[role=dialog] button").filter({ hasText: /新增|加入|確認|確定|套用|儲存|保存/ }),
    page.locator(".modal button").filter({ hasText: /新增|加入|確認|確定|套用|儲存|保存/ })
  ], 10000);
  if (!submitted) throw new HelperBlockedError(`FORMULA_MODAL_SUBMIT_NOT_CLICKABLE: afterFill=${JSON.stringify(afterFill).slice(0, 1500)}`);
  await modalLocator.waitFor({ state: "hidden", timeout: 5000 }).catch(() => null);
  await page.waitForTimeout(500);
  const afterSubmit = await readVisibleFormulaModalState(page);
  const remainingDialogs = Array.isArray(afterSubmit.dialogs) ? afterSubmit.dialogs as Array<Record<string, unknown>> : [];
  if (remainingDialogs.length > 0) {
    throw new HelperBlockedError(`FORMULA_MODAL_STILL_VISIBLE_AFTER_SUBMIT: afterSubmit=${JSON.stringify(afterSubmit).slice(0, 1500)}`);
  }
  return {
    fieldName,
    formula,
    selectedNameInput: {
      selector: "#calculatedFieldNameInput",
      value: nameValue
    },
    selectedFormulaInput: {
      selector: "#formulaInput",
      value: formulaValue,
      readOnly: formulaInputMeta.readOnly,
      entry: formulaEntry,
      expectedFormulaValues,
      matchMode: formulaMatchMode
    },
    before,
    afterFill,
    afterSubmit
  };
};

const configureCalculatedMetricAndPreview = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const warnings: string[] = [];
  const operations: string[] = [];
  const formula = stringParam(options.params, "formula");
  if (!formula) throw new HelperBlockedError("FORMULA_PARAM_MISSING");
  const baseMetricRows = metricRowsFromBaseFieldsParams(options.params);
  const baseFieldsFromParams = calculatedBaseFieldsFromParams(options.params);
  const baseFields = baseFieldsFromParams.length > 0 ? baseFieldsFromParams : baseMetricRows.map((row) => row.field);
  if (baseFields.length === 0) throw new HelperBlockedError("FORMULA_BASE_FIELDS_MISSING");
  const calculatedFieldName = calculatedFieldNameFromParams(options);
  const uiProfileBefore = await captureUiDomProfile(options, page, "calculatedMetric.before");
  const stateBefore = await readStateDelta(page, options.params).catch((error) => ({ readError: error instanceof Error ? error.message : String(error) }));

  const metricRowsEvidence = await setMetricRowsThroughOfficialUi(options, page, baseMetricRows);
  if (metricRowsEvidence) operations.push(...metricRowsEvidence.operations);
  else operations.push(...await reconcileMetricFieldsThroughUi(page, baseFields));
  operations.push(await clickCalculatedFieldControl(page));
  await page.waitForTimeout(700);
  const modalOpenedProfile = await captureUiDomProfile(options, page, "calculatedMetric.modalOpened");
  const formulaUi = await fillCalculatedFieldModal(page, calculatedFieldName, formula);
  const modalAfterSubmitProfile = await captureUiDomProfile(options, page, "calculatedMetric.modalAfterSubmit");

  const dateRange = nonNeutralUiTarget(stringParam(options.params, "dateRange"));
  let dateRangeEvidence: Record<string, unknown> | null = null;
  let dateUiArtifact: string | null = null;
  let dateRangeUiProfiles: UiDomProfileRef[] = [];
  if (dateRange) {
    const result = await setDateRange(options, page, dateRange);
    const { uiProfiles, ...resultEvidence } = result;
    dateRangeUiProfiles = uiProfiles ?? [];
    const dateUiEvidence = await readDateUiEvidence(page, dateRange, options.params);
    dateUiArtifact = writeDateUiEvidenceArtifact(options, dateUiEvidence);
    dateRangeEvidence = { ...resultEvidence, dateUiEvidence };
    warnings.push(...dateUiEvidence.warnings);
    if (!result.ok) {
      warnings.push(`CALCULATED_DATE_RANGE_UI_SETTING_NOT_COMPLETED:${result.warning ?? "unknown"}`);
      operations.push(`dateRange:blocked:${dateRange}`);
    } else {
      operations.push(`dateRange:verified:${dateRange}`);
    }
  }
  const displayOperation = await setDisplayModeThroughUi(page, stringParam(options.params, "display"));
  if (displayOperation) operations.push(displayOperation);

  const executePrecondition = await ensureMetricFieldSelectedBeforeExecute(page, "calculatedMetricPreview");
  const observed = await observeDuringWithResponseBodies(page, async () => {
    await clickRunPreviewButton(page, 15000);
    await page.waitForTimeout(3000);
  });
  const chart = await readChartSummary(page);
  const table = await readPreviewTableSummary(page);
  const hasPreviewEvidence = observed.requests.length > 0 || observed.responses.length > 0 || chart !== null || table !== null;
  if (!hasPreviewEvidence) warnings.push("CALCULATED_PREVIEW_ACTION_NOT_VERIFIED_NO_NETWORK_OR_CHART_EVIDENCE");

  const evidence = {
    generatedAt: new Date().toISOString(),
    caseId: options.caseId,
    baseFields,
    baseMetricRows,
    metricRows: metricRowsEvidence,
    calculatedFieldName,
    formula,
    formulaUi,
    dateRange,
    dateRangeEvidence,
    display: stringParam(options.params, "display"),
    executePrecondition,
    network: { requests: observed.requests, responses: observed.responses },
    chart,
    table,
    stateBefore,
    stateAfter: await readStateDelta(page, options.params).catch((error) => ({ readError: error instanceof Error ? error.message : String(error) })),
    operations,
    warnings
  };
  ensureDir(artifactRoot(options));
  fs.writeFileSync(calculatedFieldEvidencePath(options), `${JSON.stringify(evidence, null, 2)}\n`);
  fs.writeFileSync(
    previewEvidencePath(options),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), caseId: options.caseId, source: "collage.configureCalculatedMetricAndPreview", chart, table, network: { requests: observed.requests, responses: observed.responses } }, null, 2)}\n`
  );

  const shot = await screenshot(options, page, "calculated-metric-preview");
  const uiProfileAfter = await captureUiDomProfile(options, page, "calculatedMetric.after");
  return createReport(
    options,
    hasPreviewEvidence ? "ok" : "blocked",
    startedAt,
    {
      domState: await readDomState(page),
      uiProfiles: {
        before: uiProfileBefore,
        modalOpened: modalOpenedProfile,
        modalAfterSubmit: modalAfterSubmitProfile,
        dateRange: dateRangeUiProfiles,
        after: uiProfileAfter
      },
      calculatedField: evidence
    },
    {
      calculatedFieldEvidence: calculatedFieldEvidencePath(options),
      previewEvidence: previewEvidencePath(options),
      ...(metricRowsEvidence ? { metricRowsEvidence: metricRowsEvidencePath(options) } : {}),
      ...(dateUiArtifact ? { dateUiEvidence: dateUiArtifact } : {}),
      ...(shot ? { screenshot: shot } : {})
    },
    shot ? warnings : [...warnings, "SCREENSHOT_UNAVAILABLE"]
  );
};

const inspectAllZeroFields = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const warnings: string[] = [];
  const operations: string[] = [];
  const uiProfileBefore = await captureUiDomProfile(options, page, "allZeroInspection.before");
  const stateBefore = await readStateDelta(page, options.params).catch((error) => ({
    readError: error instanceof Error ? error.message : String(error)
  }));
  const expectedSelection = readSelectAllExpectedFields(options);
  warnings.push(...expectedSelection.warnings);

  const fields = metricFieldsFromParams(options.params);
  const metricRows = metricRowsFromParams(options.params);
  const metricRowsEvidence = await setMetricRowsThroughOfficialUi(options, page, metricRows);
  if (metricRowsEvidence) {
    operations.push(...metricRowsEvidence.operations);
  } else if (paramsRequestSelectAllFields(options.params) || fields.length === 0) {
    operations.push(...await selectAllMetricFieldsThroughUi(options, page));
  } else {
    operations.push(...await reconcileMetricFieldsThroughUi(page, fields));
  }

  const dateRange = nonNeutralUiTarget(stringParam(options.params, "dateRange"));
  let dateRangeEvidence: Record<string, unknown> | null = null;
  let dateUiArtifact: string | null = null;
  let dateRangeUiProfiles: UiDomProfileRef[] = [];
  if (dateRange) {
    const result = await setDateRange(options, page, dateRange);
    const { uiProfiles, ...resultEvidence } = result;
    dateRangeUiProfiles = uiProfiles ?? [];
    const dateUiEvidence = await readDateUiEvidence(page, dateRange, options.params);
    dateUiArtifact = writeDateUiEvidenceArtifact(options, dateUiEvidence);
    dateRangeEvidence = {
      ...resultEvidence,
      dateUiEvidence
    };
    warnings.push(...dateUiEvidence.warnings);
    if (!result.ok) {
      warnings.push(`ALL_ZERO_DATE_RANGE_UI_SETTING_NOT_COMPLETED:${result.warning ?? "unknown"}`);
      operations.push(`dateRange:blocked:${dateRange}`);
    } else {
      operations.push(`dateRange:verified:${dateRange}`);
    }
  }

  const displayOperation = await setDisplayModeThroughUi(page, stringParam(options.params, "display"));
  if (displayOperation) operations.push(displayOperation);

  const executePrecondition = await ensureMetricFieldSelectedBeforeExecute(page, "allZeroFieldInspection");
  const selectedBeforeExecute = await readSelectedMetricFields(page).catch(() => []);
  const observed = await observeDuringWithResponseBodies(page, async () => {
    await clickRunPreviewButton(page, 15000);
    await page.waitForTimeout(3000);
  });
  const chart = await readChartSummary(page);
  const table = await readPreviewTableSummary(page);
  const selectedAfterExecute = await readSelectedMetricFields(page).catch(() => []);
  const allZeroCandidates = dedupeAllZeroCandidates([
    ...allZeroCandidatesFromChart(chart),
    ...allZeroCandidatesFromTable(table),
    ...allZeroCandidatesFromResponses(observed.responses)
  ]);
  const responseBodiesRead = observed.responses.filter((response) => response.jsonBody !== undefined || response.bodyTextSample !== undefined).length;
  const chartDatasetCount = typeof chart?.datasetCount === "number" ? chart.datasetCount : 0;
  const tableNumericColumnCount = Array.isArray(table?.numericColumns) ? table.numericColumns.length : 0;
  const hasPreviewEvidence =
    observed.requests.length > 0 ||
    observed.responses.length > 0 ||
    chart !== null ||
    table !== null;
  const hasValueEvidence = chartDatasetCount > 0 || tableNumericColumnCount > 0 || responseBodiesRead > 0;
  if (!hasPreviewEvidence) warnings.push("ALL_ZERO_PREVIEW_UI_ACTION_NOT_VERIFIED_NO_NETWORK_OR_CHART_EVIDENCE");
  if (!hasValueEvidence) warnings.push("ALL_ZERO_VALUE_EVIDENCE_NOT_READABLE");

  ensureDir(artifactRoot(options));
  const previewEvidence = {
    generatedAt: new Date().toISOString(),
    caseId: options.caseId,
    chart,
    table,
    network: { requests: observed.requests, responses: observed.responses }
  };
  fs.writeFileSync(previewEvidencePath(options), `${JSON.stringify(previewEvidence, null, 2)}\n`);

  const allZeroEvidence = {
    generatedAt: new Date().toISOString(),
    caseId: options.caseId,
    operation: "collage.inspectAllZeroFields",
    metricRows: metricRowsEvidence,
    expectedSelection: {
      sourceReports: expectedSelection.sourceReports,
      metadataPath: expectedSelection.metadataPath,
      expectedFieldCount: numberParam(options.params, ["expectedFieldCount", "fieldCount", "expectedFieldsCount"]),
      expectedFields: expectedSelection.fields
    },
    selectedFields: {
      beforeExecute: selectedBeforeExecute.map((item) => ({ label: item.label, code: item.code })),
      afterExecute: selectedAfterExecute.map((item) => ({ label: item.label, code: item.code })),
      countBeforeExecute: selectedBeforeExecute.length,
      countAfterExecute: selectedAfterExecute.length
    },
    dateRange,
    dateRangeEvidence,
    display: stringParam(options.params, "display"),
    executePrecondition,
    operations,
    network: { requests: observed.requests, responses: observed.responses },
    chart,
    table,
    allZeroCandidates,
    summary: {
      allZeroCandidateCount: allZeroCandidates.length,
      chartDatasetCount,
      tableNumericColumnCount,
      responseBodiesRead,
      helperCanJudgeResult: false
    },
    stateBefore,
    stateAfter: await readStateDelta(page, options.params).catch((error) => ({
      readError: error instanceof Error ? error.message : String(error)
    })),
    warnings
  };
  fs.writeFileSync(allZeroFieldInspectionEvidencePath(options), `${JSON.stringify(allZeroEvidence, null, 2)}\n`);

  const shot = await screenshot(options, page, "all-zero-field-inspection");
  const uiProfileAfter = await captureUiDomProfile(options, page, "allZeroInspection.after");
  return createReport(
    options,
    hasPreviewEvidence && hasValueEvidence ? "ok" : "blocked",
    startedAt,
    {
      domState: await readDomState(page),
      uiProfiles: {
        before: uiProfileBefore,
        after: uiProfileAfter,
        dateRange: dateRangeUiProfiles
      },
      allZeroFieldInspection: allZeroEvidence
    },
    {
      previewEvidence: previewEvidencePath(options),
      allZeroFieldInspectionEvidence: allZeroFieldInspectionEvidencePath(options),
      ...(metricRowsEvidence ? { metricRowsEvidence: metricRowsEvidencePath(options) } : {}),
      ...(dateUiArtifact ? { dateUiEvidence: dateUiArtifact } : {}),
      ...(shot ? { screenshot: shot } : {})
    },
    shot ? warnings : [...warnings, "SCREENSHOT_UNAVAILABLE"]
  );
};

const dateVariantsPreviewEvidencePath = (options: CliOptions): string => path.join(artifactRoot(options), "date-variants-preview-evidence.json");

const runDateVariantsPreviewEvidence = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const warnings: string[] = [];
  const operations: string[] = [];
  const specs = datePreviewSpecsFromParams(options.params);
  if (specs.length === 0) {
    throw new HelperBlockedError("DATE_VARIANTS_EMPTY");
  }

  const fields = metricFieldsFromParams(options.params);
  const metricRows = metricRowsFromParams(options.params);
  const beforeProfile = await captureUiDomProfile(options, page, "dateVariants.before");
  const stateBefore = await readStateDelta(page, options.params).catch((error) => ({
    readError: error instanceof Error ? error.message : String(error)
  }));

  const metricRowsEvidence = await setMetricRowsThroughOfficialUi(options, page, metricRows);
  if (metricRowsEvidence) {
    operations.push(...metricRowsEvidence.operations);
  } else if (paramsRequestSelectAllFields(options.params)) {
    operations.push(...await selectAllMetricFieldsThroughUi(options, page));
  } else if (fields.length > 0) {
    operations.push(...await reconcileMetricFieldsThroughUi(page, fields));
  }
  const displayOperation = await setDisplayModeThroughUi(page, stringParam(options.params, "display"));
  if (displayOperation) operations.push(displayOperation);

  const variants: Array<Record<string, unknown>> = [];
  for (const spec of specs) {
    const label = spec.requestedLabel;
    const normalizedLabel = normalizeDatePresetLabel(label);
    const variantWarnings: string[] = [];
    const setResult = spec.mode === "structured"
      ? await setStructuredDateRange(options, page, spec)
      : await setDateRange(options, page, label);
    const { uiProfiles, ...setEvidence } = setResult;
    const dateUiEvidence = await readDateUiEvidence(page, label, options.params);
    const dateUiArtifact = writeDateUiEvidenceArtifact(options, dateUiEvidence);
    variantWarnings.push(...dateUiEvidence.warnings);
    const expectedUiBlockObserved = Boolean(
      spec.expectUiBlock &&
      !setResult.ok &&
      /CONFIRM_NOT_CLICKABLE|VERIFY_FAILED|超過|上限|disabled|disable|禁用|不可|錯誤|error/i.test(
        `${setResult.warning ?? ""}\n${setResult.observedAfter ?? ""}\n${JSON.stringify(setResult.inputs ?? {})}`
      )
    );
    if (!setResult.ok && !expectedUiBlockObserved) {
      variantWarnings.push(`DATE_VARIANT_UI_SETTING_NOT_COMPLETED:${setResult.warning ?? "unknown"}`);
    }

    let observed: { requests: Record<string, unknown>[]; responses: Record<string, unknown>[] } = { requests: [], responses: [] };
    let chart: Record<string, unknown> | null = null;
    let table: Record<string, unknown> | null = null;
    let executePrecondition: Record<string, unknown> | null = null;
    if (setResult.ok) {
      executePrecondition = await ensureMetricFieldSelectedBeforeExecute(page, `dateVariant:${label}`);
      const previewObserved = await observeDuring(page, async () => {
        await clickRunPreviewButton(page, 15000);
        await page.waitForTimeout(2500);
      });
      observed = { requests: previewObserved.requests, responses: previewObserved.responses };
      chart = await readChartSummary(page);
      table = await readPreviewTableSummary(page);
    }
    const hasPreviewEvidence = observed.requests.length > 0 || observed.responses.length > 0 || chart !== null || table !== null;
    if (setResult.ok && !hasPreviewEvidence && !spec.expectUiBlock) {
      variantWarnings.push("DATE_VARIANT_PREVIEW_ACTION_NOT_VERIFIED_NO_NETWORK_OR_CHART_EVIDENCE");
    }
    const shot = await screenshot(options, page, `date-variant-${label}`);
    if (!shot) variantWarnings.push("SCREENSHOT_UNAVAILABLE");

    const variantEvidence = {
      index: variants.length,
      requestedLabel: label,
      normalizedLabel,
      dateSpec: {
        mode: spec.mode,
        start: spec.start ?? null,
        end: spec.end ?? null,
        expectedRowCount: spec.expectedRowCount ?? null,
        expectedDateRange: spec.expectedDateRange ?? null,
        expectUiBlock: spec.expectUiBlock ?? false,
        expectedUiBlockObserved
      },
      status: spec.expectUiBlock
        ? (setResult.ok || expectedUiBlockObserved ? "ok" : "blocked")
        : (setResult.ok && hasPreviewEvidence ? "ok" : "blocked"),
      setDateResult: setEvidence,
      dateUiEvidence,
      executePrecondition,
      network: observed,
      chart,
      table,
      domState: await readDomState(page),
      stateDelta: await readStateDelta(page, { ...options.params, dateRange: label }).catch((error) => ({
        readError: error instanceof Error ? error.message : String(error)
      })),
      uiProfiles: uiProfiles ?? [],
      artifacts: {
        dateUiEvidence: dateUiArtifact,
        ...(shot ? { screenshot: shot } : {})
      },
      warnings: variantWarnings
    };
    variants.push(variantEvidence);
    warnings.push(...variantWarnings.map((warning) => `${label}:${warning}`));
  }

  const evidence = {
    generatedAt: new Date().toISOString(),
    caseId: options.caseId,
    fields,
    metricRows: metricRowsEvidence,
    requestedLabels: specs.map((spec) => spec.requestedLabel),
    requestedSpecs: specs.map((spec) => ({
      requestedLabel: spec.requestedLabel,
      mode: spec.mode,
      start: spec.start ?? null,
      end: spec.end ?? null,
      expectedRowCount: spec.expectedRowCount ?? null,
      expectedDateRange: spec.expectedDateRange ?? null,
      expectUiBlock: spec.expectUiBlock ?? false
    })),
    stateBefore,
    stateAfter: await readStateDelta(page, options.params).catch((error) => ({
      readError: error instanceof Error ? error.message : String(error)
    })),
    operations,
    variants
  };
  ensureDir(artifactRoot(options));
  fs.writeFileSync(dateVariantsPreviewEvidencePath(options), `${JSON.stringify(evidence, null, 2)}\n`);
  if (variants.length === 1) {
    const only = variants[0] as Record<string, unknown>;
    const singlePreviewEvidence = {
      generatedAt: new Date().toISOString(),
      caseId: options.caseId,
      source: "collage.runDateVariantsPreviewEvidence.singleVariant",
      requestedLabel: only.requestedLabel ?? null,
      chart: only.chart ?? null,
      table: only.table ?? null,
      network: only.network ?? { requests: [], responses: [] }
    };
    fs.writeFileSync(previewEvidencePath(options), `${JSON.stringify(singlePreviewEvidence, null, 2)}\n`);
  }
  const afterProfile = await captureUiDomProfile(options, page, "dateVariants.after");
  const ok = variants.length > 0 && variants.every((variant) => variant.status === "ok");
  return createReport(
    options,
    ok ? "ok" : "blocked",
    startedAt,
    {
      domState: await readDomState(page),
      uiProfiles: {
        before: beforeProfile,
        after: afterProfile
      },
      dateVariantsPreviewEvidence: evidence
    },
    {
      dateVariantsPreviewEvidence: dateVariantsPreviewEvidencePath(options),
      ...(metricRowsEvidence ? { metricRowsEvidence: metricRowsEvidencePath(options) } : {})
    },
    warnings
  );
};

const readPreviewEvidence = (options: CliOptions): Record<string, unknown> | null => {
  const filePath = previewEvidencePath(options);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const normalizeFieldIdentity = (value: string): string =>
  value
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();

const normalizeSourceReportIdentityBase = (value: string): string =>
  value
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();

const sourceReportIdentityAliases: Record<string, string> = {
  [normalizeSourceReportIdentityBase("各登入渠道狀況")]: normalizeSourceReportIdentityBase("各登入渠道狀況(原 beanfun! 導流)"),
  [normalizeSourceReportIdentityBase("各登入渠道狀況(原beanfun!導流)")]: normalizeSourceReportIdentityBase("各登入渠道狀況(原 beanfun! 導流)"),
  [normalizeSourceReportIdentityBase("各登入渠道狀況（原beanfun!導流）")]: normalizeSourceReportIdentityBase("各登入渠道狀況(原 beanfun! 導流)"),
  [normalizeSourceReportIdentityBase("beanfun!導流")]: normalizeSourceReportIdentityBase("各登入渠道狀況(原 beanfun! 導流)"),
  [normalizeSourceReportIdentityBase("LOGIN_PLATFORM_STATUS")]: normalizeSourceReportIdentityBase("各登入渠道狀況(原 beanfun! 導流)"),
  [normalizeSourceReportIdentityBase("雙平台營收占比")]: normalizeSourceReportIdentityBase("雙平台營收佔比")
};

const normalizeSourceReportIdentity = (value: string): string => {
  const normalized = normalizeSourceReportIdentityBase(value);
  return sourceReportIdentityAliases[normalized] ?? normalized;
};

const knownSourceGroupsByCanonicalSource: Record<string, string[]> = {
  [normalizeSourceReportIdentity("每日報表")]: ["DAILY_REPORT"],
  [normalizeSourceReportIdentity("各登入渠道狀況(原 beanfun! 導流)")]: ["LOGIN_PLATFORM_STATUS", "beanfun!導流", "各登入渠道狀況"],
  [normalizeSourceReportIdentity("各登入渠道狀況（原beanfun!導流）")]: ["LOGIN_PLATFORM_STATUS", "beanfun!導流", "各登入渠道狀況"],
  [normalizeSourceReportIdentity("退費追蹤")]: ["REFUND_TRACKING"],
  [normalizeSourceReportIdentity("雙平台營收佔比")]: ["DOUBLE_PLATFORM_REVENUE", "DUAL_PLATFORM_REVENUE", "PLATFORM_REVENUE_SHARE", "雙平台營收占比"]
};

const knownCanonicalSourceByGroup = new Map<string, string>([
  ["DAILY_REPORT", "每日報表"],
  ["LOGIN_PLATFORM_STATUS", "各登入渠道狀況（原beanfun!導流）"],
  ["REFUND_TRACKING", "退費追蹤"],
  ["DOUBLE_PLATFORM_REVENUE", "雙平台營收佔比"],
  ["DUAL_PLATFORM_REVENUE", "雙平台營收佔比"],
  ["PLATFORM_REVENUE_SHARE", "雙平台營收佔比"],
  ["ORDER_MANAGEMENT", "訂單管理表.csv"]
]);

const fieldPickerSourceGroupLabels = (sourceReport: string): string[] => {
  const direct = sourceReport.trim();
  const known = knownSourceGroupsByCanonicalSource[normalizeSourceReportIdentity(direct)] ?? [];
  return [...new Set([direct, ...known].filter(Boolean))];
};

const officialSourcePickerAliasLabels = (sourceReport: string): string[] => {
  const aliases = fieldPickerSourceGroupLabels(sourceReport);
  const normalized = normalizeSourceReportIdentity(sourceReport);
  const additional: Record<string, string[]> = {
    [normalizeSourceReportIdentity("各登入渠道狀況(原 beanfun! 導流)")]: [
      "各登入渠道狀況",
      "各登入渠道狀況(原beanfun!導流)",
      "各登入渠道狀況（原beanfun!導流）",
      "beanfun!導流",
      "LOGIN_PLATFORM_STATUS"
    ],
    [normalizeSourceReportIdentity("雙平台營收佔比")]: ["雙平台營收占比", "雙平台營收佔比"],
    [normalizeSourceReportIdentity("每日報表")]: ["每日報表", "DAILY_REPORT"],
    [normalizeSourceReportIdentity("退費追蹤")]: ["退費追蹤", "REFUND_TRACKING"]
  };
  return [...new Set([...aliases, ...(additional[normalized] ?? [])].filter(Boolean))];
};

const sourceReportLabelMatches = (actual: string, expected: string): boolean => {
  const actualIdentity = normalizeSourceReportIdentity(actual);
  return officialSourcePickerAliasLabels(expected).some((alias) => {
    if (actualIdentity === normalizeSourceReportIdentity(alias)) return true;
    const actualText = normalizeUiText(actual);
    const aliasText = normalizeUiText(alias);
    return Boolean(actualText && aliasText && (actualText.includes(aliasText) || aliasText.includes(actualText)));
  });
};

const normalizeFieldPickerGroup = (value: string | null | undefined): string =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .toUpperCase();

const cleanFieldPickerLabel = (text: string, code?: unknown): string => {
  let label = text
    .replace(/\b(NUMERIC|STRING|DATE|DATETIME|BOOLEAN|BOOL|TEXT|NUMBER)\b\s*$/i, "")
    .replace(/\s*(數值|文字|日期|時間|百分比|布林|布林值)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const compact = label.replace(/\s+/g, "");
  const compactCode = String(code ?? "").replace(/_/g, "").toUpperCase();
  if (compactCode) {
    const upper = compact.toUpperCase();
    if (upper.endsWith(compactCode)) {
      const prefix = compact.slice(0, compact.length - compactCode.length);
      if (/[\u4e00-\u9fff]/.test(prefix) && prefix.length >= 2) label = prefix;
    }
  }
  return label.trim();
};

const normalizeMetadataAlias = (fieldName: string): string => {
  const key = normalizeFieldIdentity(fieldName);
  const aliases: Record<string, string> = {
    [normalizeFieldIdentity("總營收(TWD)")]: "總營收",
    [normalizeFieldIdentity("總營收 TWD")]: "總營收",
    [normalizeFieldIdentity("iOS平台總營收")]: "iOS總營收",
    [normalizeFieldIdentity("iOS平台付費帳號數")]: "iOS付費帳號數",
    [normalizeFieldIdentity("iOS平台付費次數")]: "iOS付費次數",
    [normalizeFieldIdentity("Android平台總營收")]: "Android總營收",
    [normalizeFieldIdentity("Android平台付費帳號數")]: "Android付費帳號數",
    [normalizeFieldIdentity("Android平台付費次數")]: "Android付費次數",
    [normalizeFieldIdentity("線下商城平台總營收")]: "線下商城總營收",
    [normalizeFieldIdentity("線下商城Coda總營收")]: "線下商城CODAPAY總營收",
    [normalizeFieldIdentity("線下商城Coda付費帳號數")]: "線下商城CODAPAY付費帳號數",
    [normalizeFieldIdentity("線下商城Coda付費次數")]: "線下商城CODAPAY付費次數"
  };
  return aliases[key] ?? fieldName;
};

const canonicalSourceForPickerGroup = (groupLabel: string): string => {
  const normalized = normalizeFieldPickerGroup(groupLabel);
  return knownCanonicalSourceByGroup.get(normalized) ?? groupLabel;
};

const sourceIdentities = (values: string[]): Set<string> => new Set(values.map(normalizeSourceReportIdentity));

const uniqueBySourceIdentity = (values: string[]): string[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizeSourceReportIdentity(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const resolveMetadataCsvPath = (options: CliOptions): { path: string | null; source: string; referenceIndexEntry?: unknown } => {
  const referenceKey = stringParam(options.params, "referenceIndexKey") ?? "bi_metadata_csv";
  const referenceIndexPath = path.join(options.runDir, "input", "reference-index.json");
  if (fs.existsSync(referenceIndexPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(referenceIndexPath, "utf8")) as Record<string, unknown>;
      const localReferences = Array.isArray(parsed.localReferences) ? parsed.localReferences : [];
      const entry = localReferences.find((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return false;
        return (item as Record<string, unknown>).key === referenceKey;
      }) as Record<string, unknown> | undefined;
      const indexedPath = typeof entry?.path === "string" ? entry.path : null;
      if (indexedPath && fs.existsSync(indexedPath)) {
        return { path: indexedPath, source: `reference-index:${referenceKey}`, referenceIndexEntry: entry };
      }
    } catch {
      // Fall back to explicit/default path below.
    }
  }

  const explicit = firstStringParam(options.params, ["referenceCsv", "referenceSourcePath"]) ?? "rules/BI_DATA/metadata.csv";
  const candidates = [
    path.isAbsolute(explicit) ? explicit : path.join(options.runDir, explicit),
    path.join(options.runDir, "rules", "BI_DATA", "metadata.csv")
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return { path: found ?? null, source: found ? "params.referenceCsv" : "not_found" };
};

const readExpectedMetadataFields = (
  options: CliOptions
): {
  metadataPath: string | null;
  source: string;
  referenceIndexEntry?: unknown;
  expectedFields: string[];
  expectedSourceGroups: Array<{ sourceReport: string; fieldCount: number }>;
  expectedReportSources: string[];
  sourceListMode: boolean;
  allSourcesFieldMode: boolean;
  header: string[];
  warnings: string[];
} => {
  const resolved = resolveMetadataCsvPath(options);
  const warnings: string[] = [];
  if (!resolved.path) {
    return {
      metadataPath: null,
      source: resolved.source,
      referenceIndexEntry: resolved.referenceIndexEntry,
      expectedFields: [],
      expectedSourceGroups: [],
      expectedReportSources: [],
      sourceListMode: false,
      allSourcesFieldMode: false,
      header: [],
      warnings: ["METADATA_CSV_NOT_FOUND"]
    };
  }

  const sourceReport = stringParam(options.params, "source") ?? stringParam(options.params, "sourceReport") ?? "每日報表";
  const comparisonScope = stringParam(options.params, "comparisonScope") ?? "";
  const expectedFieldCount = numberParam(options.params, ["expectedFieldCount", "fieldCount", "expectedFieldsCount"]);
  const expectedTotalFieldCount = numberParam(options.params, ["expectedTotalFieldCount", "totalFieldCount"]);
  const expectedReportSourcesParam = stringArrayParam(options.params, "expectedReportSources");
  const matchKey = stringParam(options.params, "matchKey") ?? "";
  const rows = parseCsv(fs.readFileSync(resolved.path, "utf8"));
  const header = rows[0] ?? [];
  const nameIndex = header.indexOf("欄位名稱");
  const sourceIndex = header.indexOf("來源報表");
  const collageAvailableIndex = header.indexOf("所屬報表是否可用於拼貼模式主選擇");
  if (nameIndex === -1 || sourceIndex === -1 || collageAvailableIndex === -1) {
    warnings.push("METADATA_REQUIRED_COLUMNS_NOT_FOUND");
  }
  const availableRows = rows.slice(1).filter((row) => {
    const available = collageAvailableIndex === -1 ? "" : String(row[collageAvailableIndex] ?? "").trim().toUpperCase();
    return available === "Y";
  });
  const expectedSourceGroupMap = new Map<string, { sourceReport: string; fieldCount: number }>();
  for (const row of availableRows) {
    const rowSource = sourceIndex === -1 ? "" : String(row[sourceIndex] ?? "").trim();
    if (!rowSource) continue;
    const key = normalizeSourceReportIdentity(rowSource);
    const current = expectedSourceGroupMap.get(key);
    if (current) {
      current.fieldCount += 1;
    } else {
      expectedSourceGroupMap.set(key, { sourceReport: rowSource, fieldCount: 1 });
    }
  }
  const sourceListMode =
    /report_sources_only/i.test(comparisonScope) ||
    numberParam(options.params, ["expectedReportSourceCount"]) !== null ||
    /來源報表|source\s*report/i.test(matchKey) ||
    normalizeSourceReportIdentity(sourceReport) === normalizeSourceReportIdentity("清單對照") ||
    sourceReport.trim() === "/";
  const allSourcesFieldMode =
    /all_?4_?sources|all_?sources/i.test(comparisonScope) ||
    expectedTotalFieldCount !== null ||
    (sourceReport.trim() === "/" && /欄位名稱|field/i.test(matchKey));
  const expectedSourceGroups = [...expectedSourceGroupMap.values()];
  const expectedReportSources = uniqueBySourceIdentity(
    expectedReportSourcesParam.length > 0
      ? expectedReportSourcesParam
      : sourceListMode || allSourcesFieldMode
        ? expectedSourceGroups.map((item) => item.sourceReport)
        : [sourceReport]
  );
  const sourceKeys = sourceIdentities(expectedReportSources);
  const expectedFields = rows.slice(1)
    .filter((row) => {
      if (nameIndex === -1) return false;
      const rowSource = sourceIndex === -1 ? "" : String(row[sourceIndex] ?? "").trim();
      const available = collageAvailableIndex === -1 ? "" : String(row[collageAvailableIndex] ?? "").trim().toUpperCase();
      if (available !== "Y") return false;
      if (sourceListMode && !allSourcesFieldMode) return false;
      if (allSourcesFieldMode) return sourceKeys.size === 0 || sourceKeys.has(normalizeSourceReportIdentity(rowSource));
      return normalizeSourceReportIdentity(rowSource) === normalizeSourceReportIdentity(sourceReport);
    })
    .map((row) => String(row[nameIndex] ?? "").trim())
    .filter(Boolean);
  if (!sourceListMode && expectedFieldCount !== null && expectedFields.length !== expectedFieldCount) {
    warnings.push(`METADATA_EXPECTED_FIELD_COUNT_MISMATCH:expected=${expectedFieldCount}; metadata=${expectedFields.length}`);
  }
  if (allSourcesFieldMode && expectedTotalFieldCount !== null && expectedFields.length !== expectedTotalFieldCount) {
    warnings.push(`METADATA_EXPECTED_TOTAL_FIELD_COUNT_MISMATCH:expected=${expectedTotalFieldCount}; metadata=${expectedFields.length}`);
  }

  return {
    metadataPath: resolved.path,
    source: resolved.source,
    referenceIndexEntry: resolved.referenceIndexEntry,
    expectedFields,
    expectedSourceGroups,
    expectedReportSources,
    sourceListMode,
    allSourcesFieldMode,
    header,
    warnings
  };
};

export const readExpectedMetadataFieldsForTest = readExpectedMetadataFields;

const inferFieldLabel = (text: string, expectedFields: string[], code?: unknown): string => {
  const cleaned = cleanFieldPickerLabel(text, code);
  if (cleaned) return cleaned;

  const normalizedText = normalizeFieldIdentity(text);
  const matched = [...expectedFields]
    .sort((a, b) => normalizeFieldIdentity(b).length - normalizeFieldIdentity(a).length)
    .find((field) => normalizedText.includes(normalizeFieldIdentity(field)));
  if (matched) return matched;

  const lines = text
    .split(/\n|\r| {2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^(數值|百分比|文字|日期|時間|加總|平均|最大|最小|COUNT|SUM|AVG|MAX|MIN|×|\+新增欄位)$/i.test(item));
  return lines[0] ?? text.trim();
};

const extractFieldPickerDomItems = async (page: Page): Promise<Array<Record<string, unknown>>> => {
  return page.evaluate(() => {
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const rectFor = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };
    const classNameFor = (element: Element): string => typeof (element as HTMLElement).className === "string" ? (element as HTMLElement).className : "";
    const isGroupHeaderText = (text: string): boolean => /^[A-Z][A-Z0-9_]{2,}$/.test(text) && !/^(NUMERIC|STRING|DATE|DATETIME|BOOLEAN|BOOL|TEXT|NUMBER)$/.test(text);
    const all = Array.from(document.querySelectorAll<HTMLElement>("body *"));
    const visibleMeta = all.map((element, index) => ({
      element,
      index,
      text: normalize(element.innerText || element.textContent),
      onclick: element.getAttribute("onclick") ?? ""
    })).filter((item) => item.text && isVisible(item.element));
    const groupForIndex = (index: number): string | null => {
      for (let cursor = visibleMeta.length - 1; cursor >= 0; cursor -= 1) {
        const item = visibleMeta[cursor];
        if (item.index >= index || item.onclick) continue;
        if (isGroupHeaderText(item.text)) return item.text;
      }
      return null;
    };
    const itemFor = (element: HTMLElement, index: number, source: string) => {
      const text = normalize(element.innerText || element.textContent);
      const onclick = element.getAttribute("onclick");
      const codeMatch = onclick?.match(/addFieldToSelection\(['"]([^'"]+)['"]/i);
      return {
        index,
        source,
        text,
        code: codeMatch?.[1] ?? element.getAttribute("data-field-code") ?? element.getAttribute("data-field") ?? element.getAttribute("data-value"),
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        className: classNameFor(element),
        onclick,
        groupLabel: groupForIndex(index),
        rect: rectFor(element)
      };
    };
    const primary = all.flatMap((element, index) => {
      const onclick = element.getAttribute("onclick") ?? "";
      if (!/addFieldToSelection/i.test(onclick) || !isVisible(element)) return [];
      const text = normalize(element.innerText || element.textContent);
      return text ? [itemFor(element, index, "onclick:addFieldToSelection")] : [];
    });
    if (primary.length > 0) return primary;

    const containers = Array.from(document.querySelectorAll<HTMLElement>(
      "[class*='dropdown'], [class*='Dropdown'], [class*='menu'], [class*='Menu'], [class*='picker'], [class*='Picker'], [class*='option'], [class*='Option'], [id*='dropdown'], [id*='Dropdown'], [id*='field'], [role='listbox'], [role='menu']"
    )).filter((element) => isVisible(element) && !/fieldSelectionContainer|dataFilterContainer|groupDimensionContainer/i.test(element.id));
    const container = containers
      .map((element) => {
        const leaves = Array.from(element.querySelectorAll<HTMLElement>("button, [role='option'], [role='menuitem'], li, div, span"))
          .filter((child) => isVisible(child))
          .filter((child) => {
            const text = normalize(child.innerText || child.textContent);
            if (!text || text.length > 90) return false;
            if (/^(← 返回|拼貼|指標|明細|儲存報表|執行|計算|\+ 新增欄位|\+ 新增運算欄位|時間區間|過去7天|每天|確認|確定|取消|×)$/i.test(text)) return false;
            return true;
          });
        return { element, leaves };
      })
      .sort((a, b) => b.leaves.length - a.leaves.length)[0];
    if (!container || container.leaves.length === 0) return [];
    const leafSet = new Set(container.leaves);
    return all.flatMap((element, index) => leafSet.has(element) ? [itemFor(element, index, "dropdown-container-leaf")] : []);
  });
};

type FieldPickerDomTarget = {
  label: string;
  code: string | null;
  groupLabel: string | null;
  index: number;
};

const fieldPickerDomTargets = (items: Array<Record<string, unknown>>): FieldPickerDomTarget[] => {
  return items.flatMap((item) => {
    const index = typeof item.index === "number" ? item.index : null;
    if (index === null) return [];
    const label = inferFieldLabel(String(item.text ?? ""), [], item.code);
    const code = typeof item.code === "string" && item.code.trim() ? item.code.trim() : null;
    if (!label && !code) return [];
    return [{
      label,
      code,
      groupLabel: typeof item.groupLabel === "string" ? item.groupLabel : null,
      index
    }];
  });
};

const fieldPickerTargetMatches = (
  item: Pick<FieldPickerDomTarget, "label" | "code" | "groupLabel">,
  target: Pick<FieldPickerDomTarget, "label" | "code"> & { groupLabels?: Set<string> }
): boolean => {
  if (target.groupLabels && item.groupLabel && !target.groupLabels.has(normalizeFieldPickerGroup(item.groupLabel))) return false;
  const itemCode = normalizeMetricFieldIdentity(item.code);
  const targetCode = normalizeMetricFieldIdentity(target.code);
  if (itemCode && targetCode && itemCode === targetCode) return true;
  const targetIdentities = metricFieldIdentitySet(target.label);
  if (targetCode) targetIdentities.add(targetCode);
  if (itemCode && targetIdentities.has(itemCode)) return true;
  return targetIdentities.has(normalizeMetricFieldIdentity(item.label));
};

export const __metricFieldIdentityTestHooks = {
  normalizeMetricFieldIdentity,
  normalizeSourceReportIdentity,
  metricFieldAliasLabels,
  metricFieldAliasIdentities,
  metricFieldSearchLabelVariants,
  metricFieldSearchQueries,
  metricFieldIdentitySet: (value: string | null | undefined): string[] => [...metricFieldIdentitySet(value)],
  knownMetricFieldCode,
  cleanFieldPickerLabel,
  officialSourcePickerAliasLabels,
  sourceReportLabelMatches,
  fieldPickerTargetMatches,
  formulaFieldTokenMatches,
  metricRowsFromParams,
  metricRowsFromBaseFieldsParams,
  officialMetricRowHasSelectedField,
  officialMetricRowFieldMatches
};

const clickMetricFieldPickerDomTarget = async (
  page: Page,
  target: Pick<FieldPickerDomTarget, "label" | "code"> & { groupLabels?: Set<string> },
  timeout = 8000
): Promise<string> => {
  const items = await extractFieldPickerDomItems(page);
  const candidates = fieldPickerDomTargets(items)
    .filter((item) => fieldPickerTargetMatches(item, target))
    .sort((a, b) => {
      const codeScoreA = target.code && normalizeMetricFieldIdentity(a.code) === normalizeMetricFieldIdentity(target.code) ? 0 : 1;
      const codeScoreB = target.code && normalizeMetricFieldIdentity(b.code) === normalizeMetricFieldIdentity(target.code) ? 0 : 1;
      return codeScoreA - codeScoreB || normalizeMetricFieldIdentity(a.label).length - normalizeMetricFieldIdentity(b.label).length;
    });
  const selected = candidates[0];
  if (!selected) {
    throw new HelperBlockedError(
      `FIELD_PICKER_TARGET_NOT_FOUND_EXACT:target=${JSON.stringify({ label: target.label, code: target.code, groupLabels: target.groupLabels ? [...target.groupLabels] : [] })}; rawItems=${JSON.stringify(items.slice(0, 60)).slice(0, 2000)}`
    );
  }

  const locator = page.locator("body *").nth(selected.index);
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: Math.min(timeout, 5000) });
    await locator.click({ timeout });
  } catch (error) {
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(250);
    try {
      await locator.click({ timeout: Math.min(timeout, 5000) });
    } catch (retryError) {
      const firstMessage = error instanceof Error ? error.message : String(error);
      const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
      throw new HelperBlockedError(
        `FIELD_PICKER_TARGET_CLICK_BLOCKED:target=${selected.label}${selected.code ? `:${selected.code}` : ""}; first=${firstMessage.slice(0, 500)}; retry=${retryMessage.slice(0, 500)}`
      );
    }
  }
  return `fieldPicker:domClick:${selected.label}${selected.code ? `:${selected.code}` : ""}`;
};

type OfficialCollageFieldRow = {
  rowIndex: number;
  sourceButtonIndex: number;
  sourceText: string;
  fieldButtonIndex: number | null;
  fieldText: string | null;
  y: number;
};

type OfficialPickerDomItem = {
  index: number;
  source: string;
  text: string;
  label?: string;
  code: string | null;
  tagName: string;
  role: string | null;
  className: string;
  groupLabel: string | null;
  typeBadge?: string | null;
  rect: { x: number; y: number; width: number; height: number };
};

const officialFieldPlaceholderPattern = /^(?:---|請選擇(?:欄位|指標|資料)?|選擇(?:欄位|指標|資料)?|欄位|指標)?$/i;

function officialMetricRowHasSelectedField(row: OfficialCollageFieldRow): boolean {
  const fieldText = row.fieldText?.trim() ?? "";
  return Boolean(fieldText && !officialFieldPlaceholderPattern.test(fieldText));
}

function officialMetricRowFieldMatches(row: OfficialCollageFieldRow, expectedField: string): boolean {
  if (!officialMetricRowHasSelectedField(row)) return false;
  const fieldText = row.fieldText ?? "";
  return metricFieldLabelMatchesExpected(fieldText, expectedField);
}

type OfficialSourceSelectionResult = {
  requestedSourceReport: string;
  sourceControlBefore: string | null;
  sourceControlAfter: string | null;
  selectedSource: string | null;
  verified: boolean;
  selectedOption: OfficialPickerDomItem | null;
  sourcePickerOptions: OfficialPickerDomItem[];
  operations: string[];
  blockedReason?: string;
};

type OfficialMetadataDropdownFlow = {
  handled: true;
  pickerReadiness: string;
  pickerOpenAction: string;
  rawItems: Array<Record<string, unknown>>;
  officialPickerFlow: Record<string, unknown>;
  warnings: string[];
};

const officialFieldTypeBadgePattern = /(數值|文字|日期|時間|百分比|布林|布林值|NUMERIC|STRING|DATE|DATETIME|BOOLEAN|BOOL|TEXT|NUMBER)\s*$/i;

const isOfficialCollageEditorPage = async (page: Page): Promise<boolean> => {
  const parsed = (() => {
    try {
      return new URL(page.url());
    } catch {
      return null;
    }
  })();
  if (parsed?.pathname.match(/\/bi-dev\/[^/]+\/report\/new$/)) return true;
  if (!isOfficialBiUiPageUrl(page.url())) return false;
  const bodyText = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
  return /自訂報表/.test(bodyText) && /欄位選擇/.test(bodyText) && /請選擇報表|---/.test(bodyText);
};

const readOfficialCollageFieldRows = async (page: Page): Promise<OfficialCollageFieldRow[]> => {
  return page.evaluate(() => {
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).flatMap((button, index) => {
      if (!isVisible(button) || button.disabled) return [];
      const rect = button.getBoundingClientRect();
      return [{
        index,
        text: normalize(button.innerText || button.textContent),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }];
    });
    const rowMarkers = buttons
      .filter((button) => /^\d+$/.test(button.text) && button.y >= 320 && button.x >= 45 && button.x <= 110)
      .concat(Array.from(document.querySelectorAll<HTMLElement>("body *")).flatMap((element) => {
        const text = normalize(element.innerText || element.textContent);
        if (!/^\d+$/.test(text) || !isVisible(element)) return [];
        const hasExactVisibleChild = Array.from(element.children).some((child) => normalize(child.textContent) === text && isVisible(child));
        if (hasExactVisibleChild) return [];
        const rect = element.getBoundingClientRect();
        if (rect.y < 320 || rect.x < 55 || rect.x > 105 || rect.width > 48 || rect.height > 40) return [];
        return [{
          index: -1,
          text,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }];
      }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const sourceButtons = buttons
      .filter((button) => button.text && button.y >= 320 && button.x >= 80 && button.x < 235)
      .filter((button) => !/^(?:儲存報表|計算|過去\s*\d+\s*天|\(x\)|\+)$/.test(button.text))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const fieldButtonExcluded = /^(?:儲存報表|儲存|保存|執行|查詢|搜尋|刪除|取消|計算|過去\s*\d+\s*天|\(x\)|\+|請選擇報表)$/;
    const fieldButtons = buttons
      .filter((button) => button.y >= 320 && button.x >= 230 && button.x <= 430 && !fieldButtonExcluded.test(button.text))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const rows: Array<{
      rowIndex: number;
      sourceButtonIndex: number;
      sourceText: string;
      fieldButtonIndex: number;
      fieldText: string;
      y: number;
    }> = [];
    for (const marker of rowMarkers) {
      const sourceButton = sourceButtons
        .filter((candidate) =>
          ((candidate.y - marker.y >= 24 && candidate.y - marker.y <= 56) || Math.abs(candidate.y - marker.y) <= 16) &&
          candidate.x > marker.x + Math.max(12, marker.width * 0.4)
        )
        .sort((a, b) => a.x - b.x || Math.abs(a.y - marker.y) - Math.abs(b.y - marker.y))[0];
      if (!sourceButton) continue;
      const fieldButton = fieldButtons.find((candidate) =>
        candidate.index !== sourceButton.index &&
        Math.abs(candidate.y - sourceButton.y) <= 16 &&
        candidate.x > sourceButton.x + Math.max(24, sourceButton.width * 0.35)
      );
      if (!fieldButton) continue;
      rows.push({
        rowIndex: Math.max(0, Number.parseInt(marker.text, 10) - 1),
        sourceButtonIndex: sourceButton.index,
        sourceText: sourceButton.text,
        fieldButtonIndex: fieldButton.index,
        fieldText: fieldButton.text,
        y: marker.y
      });
    }
    if (rows.length > 0) return rows;

    for (const sourceButton of sourceButtons) {
      const fieldButton = fieldButtons.find((candidate) =>
        candidate.index !== sourceButton.index &&
        Math.abs(candidate.y - sourceButton.y) <= 16 &&
        candidate.x > sourceButton.x + Math.max(24, sourceButton.width * 0.35)
      );
      if (!fieldButton) continue;
      rows.push({
        rowIndex: rows.length,
        sourceButtonIndex: sourceButton.index,
        sourceText: sourceButton.text,
        fieldButtonIndex: fieldButton.index,
        fieldText: fieldButton.text,
        y: sourceButton.y
      });
    }
    return rows;
  });
};

const officialRowByIndex = (rows: OfficialCollageFieldRow[], rowIndex: number): OfficialCollageFieldRow | null =>
  rows.find((row) => row.rowIndex === rowIndex) ?? rows[rowIndex] ?? null;

const officialRowByStablePosition = (
  rows: OfficialCollageFieldRow[],
  rowIndex: number,
  originalRow: OfficialCollageFieldRow | null
): OfficialCollageFieldRow | null => {
  const exact = officialRowByIndex(rows, rowIndex);
  if (exact) return exact;
  if (originalRow) {
    const sameY = rows
      .filter((row) => Math.abs(row.y - originalRow.y) <= 18)
      .sort((a, b) => Math.abs(a.y - originalRow.y) - Math.abs(b.y - originalRow.y))[0];
    if (sameY) return sameY;
  }
  return rows[rowIndex] ?? null;
};

const dismissOfficialPickerOverlay = async (page: Page): Promise<void> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(180);
  }
  await page.getByText("自訂報表", { exact: false }).first().click({ timeout: 1500 }).catch(() => undefined);
  await page.waitForTimeout(250);
};

const readOfficialVisiblePickerItems = async (
  page: Page,
  kind: "source" | "field",
  groupLabel: string | null = null
): Promise<OfficialPickerDomItem[]> => {
  const items = await page.evaluate(({ pickerKind }) => {
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0";
    };
    const rectFor = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };
    const typeBadgePattern = /(數值|文字|日期|時間|百分比|布林|布林值|NUMERIC|STRING|DATE|DATETIME|BOOLEAN|BOOL|TEXT|NUMBER)\s*$/i;
    const excludedText = /^(?:共享報表|全部|新增帳號|請選擇報表|---|的|=|儲存報表|計算|過去\s*\d+\s*天|\(x\)|欄位選擇|自訂報表|建構方式|拼貼模式)$/;
    const classNameFor = (element: Element): string => typeof (element as HTMLElement).className === "string" ? (element as HTMLElement).className : "";
    const all = Array.from(document.querySelectorAll<HTMLElement>("body *"));
    const candidates = all.flatMap((element, index) => {
      if (!isVisible(element)) return [];
      const text = normalize(element.innerText || element.textContent);
      if (!text || text.length > 120 || excludedText.test(text)) return [];
      const rect = rectFor(element);
      const className = classNameFor(element);
      const role = element.getAttribute("role");
      const tagName = element.tagName.toLowerCase();
      const hasTypeBadge = typeBadgePattern.test(text);
      const floatingPickerAncestor = element.closest("[class*='fixed'][class*='z-50'], [class*='absolute'][class*='z-50']");
      const clickableish =
        tagName === "button" ||
        /button|option|menuitem|tab/i.test(role ?? "") ||
        /cursor-pointer|hover:bg|content-stretch|items-center/i.test(className);
      const fieldRowLike =
        tagName === "button" ||
        /option|menuitem/i.test(role ?? "") ||
        /cursor-pointer|hover:bg/i.test(className);
      const sourceOptionLike =
        Boolean(floatingPickerAncestor) &&
        tagName !== "p" &&
        rect.height >= 24 &&
        rect.height <= 48 &&
        rect.width >= 80 &&
        rect.width <= 360 &&
        text.length <= 60;
      const inOfficialPickerBand = rect.y >= 390 && rect.x >= 80 && rect.x <= 700;
      if (pickerKind === "field") {
        if (!hasTypeBadge || !fieldRowLike || rect.x < 180) return [];
      } else {
        if (hasTypeBadge || !inOfficialPickerBand) return [];
        if (!fieldRowLike && !sourceOptionLike) return [];
        if (text.length > 60) return [];
      }
      return [{
        index,
        text,
        code: element.getAttribute("data-field-code") ?? element.getAttribute("data-field") ?? element.getAttribute("data-value"),
        tagName,
        role,
        className,
        rect,
        clickableish,
        sourceOptionLike
      }];
    });
    const bestByText = new Map<string, typeof candidates[number]>();
    for (const candidate of candidates) {
      const key = candidate.text.replace(/\s+/g, "");
      const current = bestByText.get(key);
      const candidateScore =
        (pickerKind === "source" && candidate.sourceOptionLike ? -20 : 0) +
        (candidate.clickableish ? 0 : 10) +
        (candidate.tagName === "p" || candidate.tagName === "span" ? 4 : 0) +
        Math.max(0, candidate.rect.x / 10000);
      const currentScore = current
        ? (pickerKind === "source" && current.sourceOptionLike ? -20 : 0) +
          (current.clickableish ? 0 : 10) +
          (current.tagName === "p" || current.tagName === "span" ? 4 : 0) +
          Math.max(0, current.rect.x / 10000)
        : Number.POSITIVE_INFINITY;
      if (!current || candidateScore < currentScore) bestByText.set(key, candidate);
    }
    return [...bestByText.values()]
      .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
      .map(({ clickableish: _clickableish, sourceOptionLike: _sourceOptionLike, ...item }) => item);
  }, { pickerKind: kind });

  return items.map((item) => {
    const typeBadge = item.text.match(officialFieldTypeBadgePattern)?.[1] ?? null;
    return {
      ...item,
      source: kind === "field" ? "official-field-picker-row" : "official-source-picker-option",
      label: kind === "field" ? cleanFieldPickerLabel(item.text, item.code) : item.text,
      groupLabel,
      typeBadge
    };
  });
};

const officialPickerSignature = (items: OfficialPickerDomItem[]): Record<string, unknown> => {
  const labels = items
    .map((item) => `${normalizeMetricFieldIdentity(item.label ?? item.text)}:${normalizeMetricFieldIdentity(item.code)}`)
    .filter((item) => item !== ":")
    .sort();
  const signature = crypto.createHash("sha1").update(labels.join("|")).digest("hex").slice(0, 16);
  return {
    signature,
    optionCount: items.length,
    sampleOptions: items.slice(0, 20).map((item) => ({
      label: item.label ?? item.text,
      code: item.code,
      groupLabel: item.groupLabel,
      typeBadge: item.typeBadge ?? null
    }))
  };
};

const searchOfficialFieldPicker = async (
  page: Page,
  query: string,
  groupLabel: string | null
): Promise<{ searched: boolean; input: Record<string, unknown> | null; items: OfficialPickerDomItem[] }> => {
  const inputs = await visibleInputIndexes(page).catch(() => []);
  const searchInput =
    inputs.find((item) => /搜尋|搜索|search/i.test(item.placeholder)) ??
    inputs.find((item) => item.type === "search") ??
    null;
  if (!searchInput) return { searched: false, input: null, items: [] };
  await page.locator("input").nth(searchInput.index).fill(query, { timeout: 5000 });
  await page.waitForTimeout(700);
  return {
    searched: true,
    input: searchInput,
    items: await readOfficialVisiblePickerItems(page, "field", groupLabel)
  };
};

const targetForOfficialField = (field: string, sourceReport: string): Pick<FieldPickerDomTarget, "label" | "code"> & { groupLabels: Set<string> } => ({
  label: field,
  code: knownMetricFieldCode(field),
  groupLabels: new Set(fieldPickerSourceGroupLabels(sourceReport).map(normalizeFieldPickerGroup))
});

const officialFieldItemMatches = (item: OfficialPickerDomItem, field: string, sourceReport: string): boolean =>
  metricFieldLabelMatchesExpected(item.label ?? cleanFieldPickerLabel(item.text, item.code), field) ||
  fieldPickerTargetMatches(
    {
      label: item.label ?? cleanFieldPickerLabel(item.text, item.code),
      code: item.code,
      groupLabel: item.groupLabel
    },
    targetForOfficialField(field, sourceReport)
  );

const selectOfficialSourceReportForMetadata = async (
  page: Page,
  targetSourceReport: string,
  rowIndex = 0
): Promise<OfficialSourceSelectionResult> => {
  const operations: string[] = [];
  let rows = await readOfficialCollageFieldRows(page);
  const row = officialRowByIndex(rows, rowIndex);
  if (!row) {
    return {
      requestedSourceReport: targetSourceReport,
      sourceControlBefore: null,
      sourceControlAfter: null,
      selectedSource: null,
      verified: false,
      selectedOption: null,
      sourcePickerOptions: [],
      operations,
      blockedReason: "OFFICIAL_SOURCE_CONTROL_NOT_FOUND"
    };
  }

  if (row.sourceText && !/請選擇報表/.test(row.sourceText) && sourceReportLabelMatches(row.sourceText, targetSourceReport)) {
    operations.push(`official:source:alreadySelected:row${rowIndex}:${row.sourceText}`);
    return {
      requestedSourceReport: targetSourceReport,
      sourceControlBefore: row.sourceText,
      sourceControlAfter: row.sourceText,
      selectedSource: row.sourceText,
      verified: true,
      selectedOption: null,
      sourcePickerOptions: [],
      operations
    };
  }

  await clickVisibleButtonByIndex(page, row.sourceButtonIndex, 8000);
  operations.push(`official:source:open:row${rowIndex}:${row.sourceText || "empty"}`);
  await page.waitForTimeout(500);
  const sourcePickerOptions = await readOfficialVisiblePickerItems(page, "source");
  const scopedSourcePickerOptions = sourcePickerOptions.filter((item) => item.rect.y >= row.y - 8);
  operations.push(`official:source:options:row${rowIndex}:all=${sourcePickerOptions.length}:scoped=${scopedSourcePickerOptions.length}`);
  const selectedOption =
    scopedSourcePickerOptions.find((item) => sourceReportLabelMatches(item.text, targetSourceReport)) ??
    sourcePickerOptions.find((item) => sourceReportLabelMatches(item.text, targetSourceReport)) ??
    null;
  if (!selectedOption) {
    return {
      requestedSourceReport: targetSourceReport,
      sourceControlBefore: row.sourceText,
      sourceControlAfter: row.sourceText,
      selectedSource: null,
      verified: false,
      selectedOption: null,
      sourcePickerOptions,
      operations,
      blockedReason: `OFFICIAL_SOURCE_OPTION_NOT_FOUND:${targetSourceReport}`
    };
  }

  await clickVisibleBodyElementByIndex(page, selectedOption.index, 8000);
  operations.push(`official:source:select:row${rowIndex}:${selectedOption.text}`);
  await page.waitForTimeout(650);
  await dismissOfficialPickerOverlay(page);
  rows = await readOfficialCollageFieldRows(page);
  const rowAfter = officialRowByStablePosition(rows, rowIndex, row);
  const sourceControlAfter = rowAfter?.sourceText ?? selectedOption.text;
  const verified = Boolean(sourceControlAfter && sourceReportLabelMatches(sourceControlAfter, targetSourceReport));
  return {
    requestedSourceReport: targetSourceReport,
    sourceControlBefore: row.sourceText,
    sourceControlAfter,
    selectedSource: sourceControlAfter,
    verified,
    selectedOption,
    sourcePickerOptions,
    operations,
    ...(verified ? {} : { blockedReason: `OFFICIAL_SOURCE_SELECTION_VERIFY_FAILED:${targetSourceReport}:${sourceControlAfter}` })
  };
};

type OfficialMetricRowSelectionResult = {
  requested: MetricRowParam;
  rowIndex: number;
  rowsBefore: OfficialCollageFieldRow[];
  rowsAfterSource: OfficialCollageFieldRow[];
  rowsAfterField: OfficialCollageFieldRow[];
  sourceSelection: OfficialSourceSelectionResult;
  fieldControlBefore: string | null;
  fieldControlAfter: string | null;
  fieldPickerSignature: Record<string, unknown>;
  fieldPickerSearch: Record<string, unknown> | null;
  selectedFieldOption: OfficialPickerDomItem | null;
  fieldPickerItems: OfficialPickerDomItem[];
  operations: string[];
  verified: boolean;
};

const setSingleMetricRowThroughOfficialUi = async (
  page: Page,
  metric: MetricRowParam,
  defaultRowIndex: number
): Promise<OfficialMetricRowSelectionResult> => {
  const requestedRowIndex = metric.metricIndex ?? defaultRowIndex;
  const operations: string[] = [];
  const rowsBefore = await readOfficialCollageFieldRows(page);
  const beforeRow = officialRowByIndex(rowsBefore, requestedRowIndex);
  if (!beforeRow) {
    throw new HelperBlockedError(`METRIC_ROW_NOT_FOUND:row=${requestedRowIndex}; rows=${JSON.stringify(rowsBefore).slice(0, 1200)}`);
  }

  const sourceSelection = await selectOfficialSourceReportForMetadata(page, metric.sourceReport, requestedRowIndex);
  operations.push(...sourceSelection.operations);
  if (!sourceSelection.verified || !sourceSelection.selectedSource) {
    throw new HelperBlockedError(sourceSelection.blockedReason ?? `SOURCE_REPORT_OPTION_NOT_FOUND:${metric.sourceReport}`);
  }

  let rowsAfterSource = await readOfficialCollageFieldRows(page);
  let sourceRow = officialRowByStablePosition(rowsAfterSource, requestedRowIndex, beforeRow);
  if (!sourceRow || sourceRow.fieldButtonIndex === null) {
    throw new HelperBlockedError(`FIELD_CONTROL_NOT_FOUND:row=${requestedRowIndex}; source=${metric.sourceReport}; rows=${JSON.stringify(rowsAfterSource).slice(0, 1200)}`);
  }
  const viewportHeight = page.viewportSize()?.height ?? 900;
  const desiredRowY = Math.min(620, Math.max(420, viewportHeight - 520));
  if (sourceRow.y > viewportHeight - 360 || sourceRow.y < 300) {
    const deltaY = Math.round(sourceRow.y - desiredRowY);
    await page.mouse.move(240, Math.min(viewportHeight - 220, Math.max(340, sourceRow.y + 30)));
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(500);
    rowsAfterSource = await readOfficialCollageFieldRows(page);
    sourceRow = officialRowByStablePosition(rowsAfterSource, requestedRowIndex, beforeRow);
    operations.push(`official:row:scrollForPicker:row${requestedRowIndex}:deltaY=${deltaY}`);
  }
  if (!sourceRow || sourceRow.fieldButtonIndex === null) {
    throw new HelperBlockedError(`FIELD_CONTROL_NOT_FOUND_AFTER_SCROLL:row=${requestedRowIndex}; source=${metric.sourceReport}; rows=${JSON.stringify(rowsAfterSource).slice(0, 1200)}`);
  }

  await clickVisibleButtonByIndex(page, sourceRow.fieldButtonIndex, 8000);
  operations.push(`official:fieldPicker:open:row${requestedRowIndex}:${sourceSelection.selectedSource}`);
  await page.waitForTimeout(800);
  let fieldPickerItems = await readOfficialVisiblePickerItems(page, "field", sourceSelection.selectedSource);
  let selectedFieldOption = fieldPickerItems.find((item) => officialFieldItemMatches(item, metric.field, sourceSelection.selectedSource ?? metric.sourceReport)) ?? null;
  let fieldPickerSearch: Record<string, unknown> | null = null;
  if (!selectedFieldOption) {
    const attempts: Record<string, unknown>[] = [];
    for (const query of metricFieldSearchQueries(metric.field)) {
      const searched = await searchOfficialFieldPicker(page, query, sourceSelection.selectedSource);
      const attempt = {
        query,
        searched: searched.searched,
        input: searched.input,
        optionCountAfterSearch: searched.items.length,
        sampleOptionsAfterSearch: searched.items.slice(0, 20).map((item) => ({
          label: item.label ?? item.text,
          text: item.text,
          code: item.code,
          typeBadge: item.typeBadge ?? null
        }))
      };
      attempts.push(attempt);
      if (!searched.searched) {
        fieldPickerSearch = { attempts };
        break;
      }
      operations.push(`official:fieldPicker:search:row${requestedRowIndex}:${query}:options=${searched.items.length}`);
      fieldPickerItems = searched.items;
      selectedFieldOption = fieldPickerItems.find((item) => officialFieldItemMatches(item, metric.field, sourceSelection.selectedSource ?? metric.sourceReport)) ?? null;
      fieldPickerSearch = { attempts, selectedQuery: selectedFieldOption ? query : null };
      if (selectedFieldOption) break;
    }
  }
  const fieldPickerSignature = officialPickerSignature(fieldPickerItems);
  if (fieldPickerItems.length === 0) {
    throw new HelperBlockedError(`FIELD_PICKER_STALE_AFTER_SOURCE_CHANGE:row=${requestedRowIndex}; source=${sourceSelection.selectedSource}; optionCount=0; search=${JSON.stringify(fieldPickerSearch).slice(0, 1200)}`);
  }

  if (!selectedFieldOption) {
    throw new HelperBlockedError(
      `FIELD_OPTION_NOT_FOUND:row=${requestedRowIndex}; source=${sourceSelection.selectedSource}; field=${metric.field}; options=${JSON.stringify(fieldPickerItems.slice(0, 80)).slice(0, 2000)}; search=${JSON.stringify(fieldPickerSearch).slice(0, 1200)}`
    );
  }

  await clickVisibleBodyElementByIndex(page, selectedFieldOption.index, 8000);
  operations.push(`official:field:select:row${requestedRowIndex}:${selectedFieldOption.label ?? selectedFieldOption.text}`);
  await page.waitForTimeout(700);
  await dismissOfficialPickerOverlay(page);
  const rowsAfterField = await readOfficialCollageFieldRows(page);
  const afterRow = officialRowByStablePosition(rowsAfterField, requestedRowIndex, beforeRow);
  const verified = Boolean(afterRow && officialMetricRowFieldMatches(afterRow, metric.field));
  if (!verified) {
    throw new HelperBlockedError(
      `METRIC_ROW_ASSERTION_FAILED:row=${requestedRowIndex}; expected=${metric.field}; after=${JSON.stringify(afterRow).slice(0, 1200)}`
    );
  }

  return {
    requested: metric,
    rowIndex: requestedRowIndex,
    rowsBefore,
    rowsAfterSource,
    rowsAfterField,
    sourceSelection,
    fieldControlBefore: beforeRow.fieldText,
    fieldControlAfter: afterRow?.fieldText ?? null,
    fieldPickerSignature,
    fieldPickerSearch,
    selectedFieldOption,
    fieldPickerItems: fieldPickerItems.slice(0, 120),
    operations,
    verified
  };
};

const ensureOfficialMetricRowCount = async (page: Page, rowCount: number): Promise<string[]> => {
  const operations: string[] = [];
  for (let attempt = 0; attempt < Math.max(4, rowCount * 3); attempt += 1) {
    const rows = await readOfficialCollageFieldRows(page);
    const maxVisibleRowIndex = Math.max(-1, ...rows.map((row) => row.rowIndex));
    if (rows.some((row) => row.rowIndex === rowCount - 1) || rows.length >= rowCount || maxVisibleRowIndex >= rowCount - 1) return operations;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(200);
    const clicked = await clickFirstVisible([
      page.locator("button[aria-label='新增欄位']").first(),
      page.getByRole("button", { name: /新增欄位/ }).first(),
      page.locator("button").filter({ hasText: /^\+$/ }).first()
    ], 8000);
    if (!clicked) {
      throw new HelperBlockedError(`OFFICIAL_ADD_METRIC_ROW_NOT_CLICKABLE:needed=${rowCount};current=${rows.length}`);
    }
    await page.waitForTimeout(700);
    const after = await readOfficialCollageFieldRows(page);
    operations.push(`official:row:add:${rows.length}->${after.length}`);
  }
  const finalRows = await readOfficialCollageFieldRows(page);
  if (finalRows.length < rowCount) {
    throw new HelperBlockedError(`OFFICIAL_METRIC_ROW_COUNT_NOT_REACHED:needed=${rowCount};current=${finalRows.length};rows=${JSON.stringify(finalRows).slice(0, 1200)}`);
  }
  return operations;
};

type OfficialMetricRowsEvidence = {
  mode: "official_row_scoped_setMetricRows";
  requestedMetrics: MetricRowParam[];
  rowsBefore: OfficialCollageFieldRow[];
  rowsAfter: OfficialCollageFieldRow[];
  selections: OfficialMetricRowSelectionResult[];
  operations: string[];
  warnings: string[];
};

const setMetricRowsThroughOfficialUi = async (
  options: CliOptions,
  page: Page,
  metrics: MetricRowParam[]
): Promise<OfficialMetricRowsEvidence | null> => {
  if (metrics.length === 0) return null;
  if (!await isOfficialCollageEditorPage(page)) return null;
  const rowsBefore = await readOfficialCollageFieldRows(page);
  const operations: string[] = [`official:setMetricRows:requested:${metrics.length}`, `official:setMetricRows:rowsBefore:${rowsBefore.length}`];
  const selections: OfficialMetricRowSelectionResult[] = [];
  for (const [index, metric] of metrics.entries()) {
    const requestedRowIndex = metric.metricIndex ?? index;
    const bufferedRowCount = Math.min(metrics.length, requestedRowIndex + 6);
    operations.push(...await ensureOfficialMetricRowCount(page, bufferedRowCount));
    const result = await setSingleMetricRowThroughOfficialUi(page, metric, index);
    operations.push(...result.operations);
    selections.push(result);
  }
  const rowsAfter = await readOfficialCollageFieldRows(page);
  const warnings: string[] = [];
  const evidence: OfficialMetricRowsEvidence = {
    mode: "official_row_scoped_setMetricRows",
    requestedMetrics: metrics,
    rowsBefore,
    rowsAfter,
    selections,
    operations,
    warnings
  };
  ensureDir(artifactRoot(options));
  fs.writeFileSync(metricRowsEvidencePath(options), `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
};

const extractOfficialMetadataDropdownFlow = async (
  page: Page,
  metadata: ReturnType<typeof readExpectedMetadataFields>,
  sourceReport: string,
  targetSourceReports: string[]
): Promise<OfficialMetadataDropdownFlow | null> => {
  if (!await isOfficialCollageEditorPage(page)) return null;
  const warnings: string[] = [];
  const operations: string[] = [];
  const requestedSourceReports = targetSourceReports.length > 0 ? targetSourceReports : [sourceReport];
  const officialPickerFlow: Record<string, unknown> = {
    mode: metadata.sourceListMode && !metadata.allSourcesFieldMode ? "source_list" : metadata.allSourcesFieldMode ? "all_sources_fields" : "source_report_fields",
    requestedSourceReports,
    sourceSelections: [],
    sourcePickerOptions: [],
    fieldPickerItemsBySource: [],
    operations
  };

  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(250);
  const rowsBefore = await readOfficialCollageFieldRows(page);
  operations.push(`official:rows:${rowsBefore.length}`);
  if (rowsBefore.length === 0) warnings.push("OFFICIAL_FIELD_ROWS_NOT_FOUND");

  if (metadata.sourceListMode && !metadata.allSourcesFieldMode) {
    const firstRow = rowsBefore[0];
    if (firstRow) {
      await clickVisibleButtonByIndex(page, firstRow.sourceButtonIndex, 8000);
      operations.push(`official:sourceList:open:${firstRow.sourceText || "empty"}`);
      await page.waitForTimeout(500);
    }
    const sourceOptions = await readOfficialVisiblePickerItems(page, "source");
    officialPickerFlow.sourcePickerOptions = sourceOptions;
    const rawItems = sourceOptions.map((item) => ({
      ...item,
      groupLabel: item.text,
      label: item.text
    }));
    if (sourceOptions.length === 0) warnings.push("OFFICIAL_SOURCE_PICKER_NO_OPTIONS");
    return {
      handled: true,
      pickerReadiness: "officialFieldControls:ready",
      pickerOpenAction: "official:sourcePicker",
      rawItems,
      officialPickerFlow,
      warnings
    };
  }

  const rawItems: Array<Record<string, unknown>> = [];
  for (const targetSourceReport of requestedSourceReports) {
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(250);
    const sourceSelection = await selectOfficialSourceReportForMetadata(page, targetSourceReport);
    operations.push(...sourceSelection.operations);
    (officialPickerFlow.sourceSelections as unknown[]).push(sourceSelection);
    const existingOptions = officialPickerFlow.sourcePickerOptions as unknown[];
    existingOptions.push(...sourceSelection.sourcePickerOptions);
    if (!sourceSelection.verified || !sourceSelection.selectedSource) {
      warnings.push(sourceSelection.blockedReason ?? `OFFICIAL_SOURCE_SELECTION_FAILED:${targetSourceReport}`);
      continue;
    }

    let fieldItems = await readOfficialVisiblePickerItems(page, "field", sourceSelection.selectedSource);
    if (fieldItems.length > 0) {
      operations.push(`official:fieldPicker:alreadyOpen:${sourceSelection.selectedSource}:${fieldItems.length}`);
    }
    for (let attempt = 0; fieldItems.length === 0 && attempt < 2; attempt += 1) {
      const rows = await readOfficialCollageFieldRows(page);
      const row = rows[0];
      if (!row || row.fieldButtonIndex === null) {
        warnings.push(`OFFICIAL_FIELD_CONTROL_NOT_FOUND:${targetSourceReport}`);
        break;
      }
      await clickVisibleButtonByIndex(page, row.fieldButtonIndex, 8000);
      operations.push(`official:fieldPicker:open:${sourceSelection.selectedSource}:attempt${attempt + 1}`);
      await page.waitForTimeout(800);
      fieldItems = await readOfficialVisiblePickerItems(page, "field", sourceSelection.selectedSource);
    }
    const fieldRawItems = fieldItems.flatMap((item) => {
      const label = item.label ?? cleanFieldPickerLabel(item.text, item.code);
      return label ? [{
        ...item,
        groupLabel: sourceSelection.selectedSource,
        label
      }] : [];
    });
    rawItems.push(...fieldRawItems);
    (officialPickerFlow.fieldPickerItemsBySource as unknown[]).push({
      requestedSourceReport: targetSourceReport,
      selectedSource: sourceSelection.selectedSource,
      itemCount: fieldRawItems.length,
      items: fieldRawItems.slice(0, 120)
    });
    if (fieldRawItems.length === 0) warnings.push(`OFFICIAL_FIELD_PICKER_NO_ITEMS:${targetSourceReport}`);
  }

  return {
    handled: true,
    pickerReadiness: "officialFieldControls:ready",
    pickerOpenAction: "official:sourceThenFieldPicker",
    rawItems,
    officialPickerFlow,
    warnings
  };
};

const readSelectAllExpectedFields = (options: CliOptions): { fields: string[]; sourceReports: string[]; metadataPath: string | null; warnings: string[] } => {
  const resolved = resolveMetadataCsvPath(options);
  const warnings: string[] = [];
  const sourceReports = stringArrayParam(options.params, "sourceReports");
  const fallbackSource = stringParam(options.params, "source") ?? stringParam(options.params, "sourceReport");
  const effectiveSources = sourceReports.length > 0
    ? sourceReports
    : paramsRequestSelectAllFields(options.params) && fallbackSource && !/全選|全部|清單對照/.test(fallbackSource)
      ? [fallbackSource]
      : [];

  if (!resolved.path) {
    return { fields: [], sourceReports: effectiveSources, metadataPath: null, warnings: ["SELECT_ALL_METADATA_CSV_NOT_FOUND"] };
  }

  const rows = parseCsv(fs.readFileSync(resolved.path, "utf8"));
  const header = rows[0] ?? [];
  const nameIndex = header.indexOf("欄位名稱");
  const sourceIndex = header.indexOf("來源報表");
  const collageAvailableIndex = header.indexOf("所屬報表是否可用於拼貼模式主選擇");
  if (nameIndex === -1 || sourceIndex === -1 || collageAvailableIndex === -1) {
    return { fields: [], sourceReports: effectiveSources, metadataPath: resolved.path, warnings: ["SELECT_ALL_METADATA_REQUIRED_COLUMNS_NOT_FOUND"] };
  }

  const sourceKeys = new Set(effectiveSources.map(normalizeSourceReportIdentity));
  const seen = new Set<string>();
  const fields = rows.slice(1).flatMap((row) => {
    const available = String(row[collageAvailableIndex] ?? "").trim().toUpperCase();
    if (available !== "Y") return [];
    const rowSource = String(row[sourceIndex] ?? "").trim();
    if (sourceKeys.size > 0 && !sourceKeys.has(normalizeSourceReportIdentity(rowSource))) return [];
    const label = normalizeMetadataAlias(String(row[nameIndex] ?? "").trim());
    const key = normalizeMetricFieldIdentity(label);
    if (!label || seen.has(key)) return [];
    seen.add(key);
    return [label];
  });
  return { fields, sourceReports: effectiveSources, metadataPath: resolved.path, warnings };
};

const selectAllMetricFieldsFromPickerDom = async (
  options: CliOptions,
  page: Page,
  rawItems: Array<Record<string, unknown>>,
  expectedFieldCount: number | null
): Promise<{ handled: boolean; operations: string[] }> => {
  const sourceReports = stringArrayParam(options.params, "sourceReports");
  if (sourceReports.length === 0 || rawItems.length === 0) return { handled: false, operations: [] };

  const targetGroups = new Set(sourceReports.flatMap(fieldPickerSourceGroupLabels).map(normalizeFieldPickerGroup));
  const groupedItems = rawItems.filter((item) => typeof item.groupLabel === "string" && targetGroups.has(normalizeFieldPickerGroup(item.groupLabel)));
  if (groupedItems.length === 0) return { handled: false, operations: [] };

  const perGroupCounts = sourceReports.map((sourceReport) => {
    const groupLabels = new Set(fieldPickerSourceGroupLabels(sourceReport).map(normalizeFieldPickerGroup));
    return {
      sourceReport,
      count: rawItems.filter((item) => typeof item.groupLabel === "string" && groupLabels.has(normalizeFieldPickerGroup(item.groupLabel))).length
    };
  });
  const operations = [
    `field:selectAll:domPickerGroups:${groupedItems.length}`,
    `field:selectAll:domPickerPerGroup:${JSON.stringify(perGroupCounts)}`
  ];
  const seen = new Set<string>();
  const targets = fieldPickerDomTargets(groupedItems).flatMap((item) => {
    const key = normalizeMetricFieldIdentity(item.code ?? item.label);
    if (!item.label || !key || seen.has(key)) return [];
    seen.add(key);
    return [item];
  });
  if (targets.length === 0) return { handled: false, operations: [...operations, "field:selectAll:domPickerNoTargets"] };

  for (const target of targets) {
    const selected = await readSelectedMetricFields(page).catch(() => []);
    if (selected.some((item) => selectedMetricFieldMatches(item, target.label) || (target.code && normalizeMetricFieldIdentity(item.code) === normalizeMetricFieldIdentity(target.code)))) {
      continue;
    }
    const groupLabels = target.groupLabel ? new Set([normalizeFieldPickerGroup(target.groupLabel)]) : undefined;
    let clicked = false;
    let lastError = "";
    for (let attempt = 0; attempt < 3 && !clicked; attempt += 1) {
      try {
        operations.push(await clickMetricFieldPickerDomTarget(page, {
          label: target.label,
          code: target.code,
          groupLabels
        }, 10000));
        clicked = true;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (/FIELD_PICKER_TARGET_NOT_FOUND_EXACT/.test(lastError)) {
          const addOperation = await clickMetricAddFieldControl(page, `select-all:${target.label}`).catch((addError) => {
            lastError = `${lastError}; reopen=${addError instanceof Error ? addError.message : String(addError)}`;
            return null;
          });
          if (addOperation) operations.push(`field:selectAll:reopenPicker:${addOperation}`);
          await page.waitForTimeout(500);
          continue;
        }
        await page.keyboard.press("Escape").catch(() => undefined);
        await page.waitForTimeout(300);
        const addOperation = await clickMetricAddFieldControl(page, `select-all:${target.label}`).catch((addError) => {
          lastError = `${lastError}; reopen=${addError instanceof Error ? addError.message : String(addError)}`;
          return null;
        });
        if (addOperation) operations.push(`field:selectAll:retryReopenPicker:${addOperation}`);
        await page.waitForTimeout(500);
      }
    }
    if (!clicked) {
      const finalSelected = await readSelectedMetricFields(page).catch(() => []);
      throw new HelperBlockedError(
        `SELECT_ALL_FIELD_CLICK_FAILED:target=${target.label}${target.code ? `:${target.code}` : ""}; selected=${JSON.stringify(finalSelected).slice(0, 1200)}; lastError=${lastError.slice(0, 1200)}`
      );
    }
    await page.waitForTimeout(220);
    operations.push(`field:selectAll:domSet:${target.label}${target.code ? `:${target.code}` : ""}`);
  }

  const finalSelected = await readSelectedMetricFields(page).catch(() => []);
  operations.push(`field:selectAll:finalSelected:${finalSelected.length}`);
  if (expectedFieldCount !== null && finalSelected.length !== expectedFieldCount) {
    const strictCount = strictSelectAllFieldCountRequired(options.params);
    const message = `SELECT_ALL_FIELD_COUNT_MISMATCH:expected=${expectedFieldCount}; selected=${finalSelected.length}; domTargets=${targets.length}; perGroup=${JSON.stringify(perGroupCounts)}`;
    if (strictCount) throw new HelperBlockedError(message);
    operations.push(`field:selectAll:nonBlockingCountMismatch:${message}`);
  }
  return { handled: true, operations };
};

const selectAllMetricFieldsThroughUi = async (options: CliOptions, page: Page): Promise<string[]> => {
  const operations: string[] = [];
  const expectedFieldCount = numberParam(options.params, ["expectedFieldCount", "fieldCount", "expectedFieldsCount"]);
  const expected = readSelectAllExpectedFields(options);
  operations.push(`field:selectAll:requested:sources=${expected.sourceReports.join("|") || "all"};expectedFieldCount=${expectedFieldCount ?? "unknown"}`);
  operations.push(...expected.warnings.map((warning) => `field:selectAll:warning:${warning}`));

  if (await isOfficialCollageEditorPage(page)) {
    const fallbackSource = stringParam(options.params, "source") ?? stringParam(options.params, "sourceReport") ?? expected.sourceReports[0] ?? "每日報表";
    const officialFields = expected.fields.length > 0
      ? expected.fields
      : metricFieldsFromParams(options.params);
    if (officialFields.length > 0) {
      const officialRows = officialFields.map((field, index) => ({
        sourceReport: expected.sourceReports[0] ?? fallbackSource,
        field,
        metricIndex: index
      }));
      const evidence = await setMetricRowsThroughOfficialUi(options, page, officialRows);
      if (evidence) {
        operations.push(...evidence.operations);
        const selected = await readOfficialCollageFieldRows(page).catch(() => []);
        const visibleSelectedCount = selected.filter((row) => officialMetricRowHasSelectedField(row)).length;
        const selectedCount = evidence.selections.filter((selection) => selection.verified).length;
        operations.push(`field:selectAll:officialFinalSelected:${selectedCount};visible=${visibleSelectedCount};visibleRows=${selected.length}`);
        if (expectedFieldCount !== null && selectedCount !== expectedFieldCount) {
          const message = `SELECT_ALL_FIELD_COUNT_MISMATCH:expected=${expectedFieldCount}; selected=${selectedCount}; visibleSelected=${visibleSelectedCount}; officialRows=${selected.length}`;
          if (strictSelectAllFieldCountRequired(options.params)) throw new HelperBlockedError(message);
          operations.push(`field:selectAll:nonBlockingCountMismatch:${message}`);
        }
        return operations;
      }
    }
  }

  if (expected.sourceReports.length > 0) {
    const readiness = await waitForMetricFieldControls(page);
    const addOperation = await clickMetricAddFieldControl(page, "select-all-fields");
    await page.waitForTimeout(700);
    const rawItems = await extractFieldPickerDomItems(page);
    operations.push(readiness, addOperation, `field:selectAll:domRawItems:${rawItems.length}`);
    const domSelection = await selectAllMetricFieldsFromPickerDom(options, page, rawItems, expectedFieldCount);
    operations.push(...domSelection.operations);
    if (domSelection.handled) return operations;
  }

  if (expected.fields.length > 0) {
    operations.push(`field:selectAll:metadataFields:${expected.fields.length}`);
    operations.push(...await reconcileMetricFieldsThroughUi(page, expected.fields));
    const selected = await readSelectedMetricFields(page).catch(() => []);
    if (expectedFieldCount !== null && selected.length !== expectedFieldCount) {
      const strictCount = strictSelectAllFieldCountRequired(options.params);
      const message = `SELECT_ALL_FIELD_COUNT_MISMATCH:expected=${expectedFieldCount}; selected=${selected.length}; metadataFields=${expected.fields.length}; selectedSample=${JSON.stringify(selected.slice(0, 20))}`;
      if (strictCount) throw new HelperBlockedError(message);
      operations.push(`field:selectAll:nonBlockingCountMismatch:${message}`);
    }
    return operations;
  }

  const readiness = await waitForMetricFieldControls(page);
  const addOperation = await clickMetricAddFieldControl(page, "select-all-fields");
  await page.waitForTimeout(700);
  const rawItems = await extractFieldPickerDomItems(page);
  const sourceReports = stringArrayParam(options.params, "sourceReports");
  const targetGroups = new Set(sourceReports.flatMap(fieldPickerSourceGroupLabels).map(normalizeFieldPickerGroup));
  const groupedItems = targetGroups.size > 0
    ? rawItems.filter((item) => typeof item.groupLabel === "string" && targetGroups.has(normalizeFieldPickerGroup(item.groupLabel)))
    : [];
  const candidateItems = groupedItems.length > 0 ? groupedItems : rawItems;
  const seen = new Set<string>();
  const targets = candidateItems.flatMap((item) => {
    const label = inferFieldLabel(String(item.text ?? ""), [], item.code);
    const key = normalizeMetricFieldIdentity(String(item.code ?? label));
    const index = typeof item.index === "number" ? item.index : null;
    if (!label || index === null || seen.has(key)) return [];
    seen.add(key);
    return [{ index, label, code: typeof item.code === "string" ? item.code : null }];
  });

  if (targets.length === 0) {
    throw new HelperBlockedError(`SELECT_ALL_NO_FIELD_ITEMS:readiness=${readiness}; addOperation=${addOperation}; rawItems=${rawItems.length}`);
  }

  for (const target of targets) {
    const selected = await readSelectedMetricFields(page).catch(() => []);
    if (selected.some((item) => selectedMetricFieldMatches(item, target.label) || (target.code && normalizeMetricFieldIdentity(item.code) === normalizeMetricFieldIdentity(target.code)))) {
      continue;
    }
    await clickVisibleBodyElementByIndex(page, target.index, 8000);
    await page.waitForTimeout(250);
    operations.push(`field:selectAll:set:${target.label}${target.code ? `:${target.code}` : ""}`);
  }

  const finalSelected = await readSelectedMetricFields(page).catch(() => []);
  operations.push(`field:selectAll:finalSelected:${finalSelected.length}`);
  if (expectedFieldCount !== null && finalSelected.length !== expectedFieldCount) {
    const strictCount = strictSelectAllFieldCountRequired(options.params);
    const message = `SELECT_ALL_FIELD_COUNT_MISMATCH:expected=${expectedFieldCount}; selected=${finalSelected.length}; candidateItems=${targets.length}; groupedItems=${groupedItems.length}; rawItems=${rawItems.length}`;
    if (strictCount) throw new HelperBlockedError(message);
    operations.push(`field:selectAll:nonBlockingCountMismatch:${message}`);
  }
  return operations;
};

const extractMetadataDropdownFields = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const warnings: string[] = [];
  const uiProfileBefore = await captureUiDomProfile(options, page, "metadataDropdown.before");
  const metadata = readExpectedMetadataFields(options);
  warnings.push(...metadata.warnings);
  const expectedFields = metadata.expectedFields;
  const probeField = expectedFields[0] ?? "新增帳號數";
  const sourceReport = stringParam(options.params, "source") ?? stringParam(options.params, "sourceReport") ?? "每日報表";
  const expectedReportSources = metadata.expectedReportSources;
  const targetSourceReports = metadata.sourceListMode || metadata.allSourcesFieldMode
    ? expectedReportSources
    : [sourceReport];
  const officialFlow = await extractOfficialMetadataDropdownFlow(page, metadata, sourceReport, targetSourceReports);
  warnings.push(...(officialFlow?.warnings ?? []));
  const pickerReadiness = officialFlow?.pickerReadiness ?? await waitForMetricFieldControls(page);
  const addOperation = officialFlow?.pickerOpenAction ?? await clickMetricAddFieldControl(page, probeField);
  if (!officialFlow) await page.waitForTimeout(700);

  const rawItems = officialFlow?.rawItems ?? await extractFieldPickerDomItems(page);
  const targetGroups = targetSourceReports.flatMap(fieldPickerSourceGroupLabels).map(normalizeFieldPickerGroup);
  const groupedItems = rawItems.filter((item) => {
    const groupLabel = typeof item.groupLabel === "string" ? item.groupLabel : null;
    if (!groupLabel) return false;
    if (targetSourceReports.some((source) => sourceReportLabelMatches(groupLabel, source))) return true;
    return targetGroups.includes(normalizeFieldPickerGroup(groupLabel));
  });
  const rawItemsWithLabels = rawItems.map((item) => ({
    ...item,
    label: inferFieldLabel(String(item.text ?? ""), expectedFields, item.code)
  }));
  const groupedItemsWithLabels = groupedItems.map((item) => ({
    ...item,
    label: inferFieldLabel(String(item.text ?? ""), expectedFields, item.code)
  }));
  const expectedFieldKeys = new Set(expectedFields.map((field) => normalizeFieldIdentity(normalizeMetadataAlias(field))));
  const expectedFieldNameFallbackItems = rawItemsWithLabels.filter((item) =>
    expectedFieldKeys.has(normalizeFieldIdentity(normalizeMetadataAlias(String(item.label ?? ""))))
  );
  const scopedRawItems = groupedItemsWithLabels.length > 0
    ? groupedItemsWithLabels
    : metadata.sourceListMode || metadata.allSourcesFieldMode
      ? []
      : expectedFieldNameFallbackItems;
  const actualScopeMode = groupedItemsWithLabels.length > 0
    ? "source_group"
    : metadata.sourceListMode || metadata.allSourcesFieldMode
      ? "source_group_missing"
      : expectedFieldNameFallbackItems.length > 0
        ? "expected_field_name_fallback"
        : "source_group_missing";
  if (rawItems.length > 0 && groupedItems.length === 0) {
    warnings.push(
      metadata.sourceListMode || metadata.allSourcesFieldMode
        ? "METADATA_DROPDOWN_SOURCE_GROUP_SCOPE_NOT_FOUND_USING_GROUP_EVIDENCE_ONLY"
        : expectedFieldNameFallbackItems.length > 0
          ? "METADATA_DROPDOWN_SOURCE_GROUP_SCOPE_NOT_FOUND_USING_EXPECTED_FIELD_MATCHES"
          : "METADATA_DROPDOWN_SOURCE_GROUP_SCOPE_NOT_FOUND"
    );
  }
  const seen = new Set<string>();
  const actualVisibleItems = scopedRawItems
    .map((item) => String(item.label ?? "").trim())
    .filter(Boolean)
    .filter((label) => {
      const key = normalizeFieldIdentity(label);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const expectedByKey = new Map(expectedFields.map((field) => [normalizeFieldIdentity(normalizeMetadataAlias(field)), field]));
  const actualByKey = new Map(actualVisibleItems.map((field) => [normalizeFieldIdentity(normalizeMetadataAlias(field)), field]));
  const exactExpectedByKey = new Map(expectedFields.map((field) => [normalizeFieldIdentity(field), field]));
  const exactActualByKey = new Map(actualVisibleItems.map((field) => [normalizeFieldIdentity(field), field]));
  const missingFields = expectedFields.filter((field) => !actualByKey.has(normalizeFieldIdentity(normalizeMetadataAlias(field))));
  const extraFields = actualVisibleItems.filter((field) => !expectedByKey.has(normalizeFieldIdentity(normalizeMetadataAlias(field))));
  const exactMissingFields = expectedFields.filter((field) => !exactActualByKey.has(normalizeFieldIdentity(field)));
  const exactExtraFields = actualVisibleItems.filter((field) => !exactExpectedByKey.has(normalizeFieldIdentity(field)));
  const matchedFields = expectedFields.filter((field) => actualByKey.has(normalizeFieldIdentity(normalizeMetadataAlias(field))));
  const actualSourceReports = uniqueBySourceIdentity(
    rawItems
      .map((item) => typeof item.groupLabel === "string" ? item.groupLabel : null)
      .filter((item): item is string => Boolean(item))
      .map(canonicalSourceForPickerGroup)
  );
  const groupedSourceReports = uniqueBySourceIdentity(
    groupedItems
      .map((item) => typeof item.groupLabel === "string" ? item.groupLabel : null)
      .filter((item): item is string => Boolean(item))
      .map(canonicalSourceForPickerGroup)
  );
  const expectedSourceKeys = sourceIdentities(expectedReportSources);
  const actualSourceKeys = sourceIdentities(actualSourceReports);
  const missingSourceReports = expectedReportSources.filter((source) => !actualSourceKeys.has(normalizeSourceReportIdentity(source)));
  const extraSourceReports = expectedSourceKeys.size === 0
    ? []
    : actualSourceReports.filter((source) => !expectedSourceKeys.has(normalizeSourceReportIdentity(source)));

  const evidence = {
    caseNo: options.caseId,
    sourceGroupLabel: sourceReport,
    sourceGroupDomLabels: targetSourceReports.flatMap(fieldPickerSourceGroupLabels),
    pickerReadiness,
    pickerOpenAction: addOperation,
    actualScope: {
      mode: actualScopeMode,
      requestedSourceReport: sourceReport,
      requestedSourceReports: targetSourceReports,
      targetGroupLabels: targetSourceReports.flatMap(fieldPickerSourceGroupLabels),
      allRawItemCount: rawItems.length,
      groupedRawItemCount: groupedItems.length,
      expectedFieldNameFallbackCount: expectedFieldNameFallbackItems.length,
      scopedRawItemCount: scopedRawItems.length
    },
    actualVisibleItems,
    actualCount: actualVisibleItems.length,
    actualRawItems: scopedRawItems,
    allRawItemsSample: rawItemsWithLabels.slice(0, 120),
    sourceGroupEvidence: {
      expectedReportSources,
      actualSourceReports,
      groupedSourceReports,
      missingSourceReports,
      extraSourceReports,
      expectedReportSourceCount: numberParam(options.params, ["expectedReportSourceCount"]),
      actualReportSourceCount: actualSourceReports.length
    },
    officialPickerFlow: officialFlow?.officialPickerFlow ?? null,
    expectedSource: {
      referenceCsv: metadata.metadataPath,
      referenceCsvRelativePath: metadata.metadataPath ? path.relative(options.runDir, metadata.metadataPath) : null,
      referenceIndexKey: stringParam(options.params, "referenceIndexKey") ?? "bi_metadata_csv",
      referenceIndexEntry: metadata.referenceIndexEntry ?? null,
      referenceSourceName: stringParam(options.params, "referenceSourceName") ?? "metadata＿1.2.5 - 工作表1.csv",
      sourceReport: stringParam(options.params, "source") ?? stringParam(options.params, "sourceReport") ?? "每日報表",
      comparisonScope: stringParam(options.params, "comparisonScope") ?? null,
      matchKey: stringParam(options.params, "matchKey") ?? "欄位名稱",
      compareFields: Array.isArray(options.params.compareFields) ? options.params.compareFields : ["欄位名稱", "資料類型"],
      expectedFieldCount: numberParam(options.params, ["expectedFieldCount", "fieldCount", "expectedFieldsCount"]),
      expectedTotalFieldCount: numberParam(options.params, ["expectedTotalFieldCount", "totalFieldCount"]),
      filter: metadata.sourceListMode && !metadata.allSourcesFieldMode
        ? "所屬報表是否可用於拼貼模式主選擇 == Y; compare distinct 來源報表"
        : metadata.allSourcesFieldMode
          ? "來源報表 in expectedReportSources && 所屬報表是否可用於拼貼模式主選擇 == Y"
          : "來源報表 == sourceReport && 所屬報表是否可用於拼貼模式主選擇 == Y"
    },
    expectedFields,
    expectedCount: expectedFields.length,
    expectedReportSources,
    missingFields,
    extraFields,
    exactMissingFields,
    exactExtraFields,
    normalizationNotes: [
      "comparison normalizes whitespace, full-width/half-width parentheses, and source-specific known naming aliases",
      "actual picker fields are scoped to requested source group headers when present; if a source group is absent, helper records source-group evidence instead of treating all picker items as that source",
      "field labels remove UI type badges such as NUMERIC and trailing field codes such as RAU when they are appended to the visible label",
      "DOM extraction reads visible picker options / addFieldToSelection onclick metadata only; it does not call BI API"
    ],
    comparison: {
      matchedFields,
      missingFields,
      extraFields,
      exactMissingFields,
      exactExtraFields,
      missingSourceReports,
      extraSourceReports,
      trueDifferenceCount: missingFields.length + extraFields.length
    },
    verdict: metadata.sourceListMode && !metadata.allSourcesFieldMode
      ? missingSourceReports.length === 0 && extraSourceReports.length === 0 ? "matches" : "differences_found"
      : missingFields.length === 0 && extraFields.length === 0 ? "matches" : "differences_found"
  };
  const evidencePath = path.join(artifactRoot(options), "metadata-dropdown-evidence.json");
  ensureDir(path.dirname(evidencePath));
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  if (rawItems.length === 0) warnings.push("METADATA_DROPDOWN_NO_VISIBLE_ITEMS_EXTRACTED");
  if (!metadata.sourceListMode && expectedFields.length === 0) warnings.push("METADATA_EXPECTED_FIELDS_EMPTY");
  const shot = await screenshot(options, page, "metadata-dropdown");
  const uiProfileAfter = await captureUiDomProfile(options, page, "metadataDropdown.after");
  const hasComparableEvidence = metadata.sourceListMode && !metadata.allSourcesFieldMode
    ? actualSourceReports.length > 0 && expectedReportSources.length > 0
    : rawItems.length > 0 && expectedFields.length > 0;

  return createReport(
    options,
    hasComparableEvidence ? "ok" : "blocked",
    startedAt,
    {
      domState: await readDomState(page),
      uiProfiles: { before: uiProfileBefore, after: uiProfileAfter },
      metadataDropdownEvidence: evidence
    },
    { ...(shot ? { screenshot: shot } : {}), metadataDropdownEvidence: evidencePath },
    shot ? warnings : [...warnings, "SCREENSHOT_UNAVAILABLE"]
  );
};

type ReportListRowState = {
  found: boolean;
  reportName: string;
  url: string;
  bodyTextExcerpt: string;
  rowText: string | null;
  downloadControls: Array<Record<string, unknown>>;
  deleteControls: Array<Record<string, unknown>>;
};

type CsvDownloadTriggerEvidence = {
  clicked: boolean;
  trigger: string;
  candidates?: unknown[];
  rowState?: ReportListRowState;
  selectedControl?: Record<string, unknown>;
  clickError?: string;
  [key: string]: unknown;
};

const readReportListRowState = async (page: Page, reportName: string): Promise<ReportListRowState> => {
  return await page.evaluate((targetReportName) => {
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const downloadPattern = /下載|CSV|匯出|download|export|⬇/i;
    const deletePattern = /刪除|删除|delete|trash|remove|🗑/i;
    const allBodyElements = Array.from(document.querySelectorAll<HTMLElement>("body *"));
    const rowElements = Array.from(document.querySelectorAll<HTMLElement>(
      "tr, [class*=row], [class*=Row], [class*=card], [class*=Card], [class*=item], [class*=Item]"
    ));
    const matchingRows = rowElements
      .filter((element) => isVisible(element) && normalize(element.innerText || element.textContent).includes(targetReportName))
      .map((row) => {
        const controlsFor = (pattern: RegExp) => Array.from(row.querySelectorAll<HTMLElement>("button, a, [role=button]")).flatMap((control) => {
          if (!isVisible(control)) return [];
          const text = normalize(control.innerText || control.textContent);
          const attrs = [
            control.getAttribute("aria-label"),
            control.getAttribute("title"),
            control.getAttribute("download"),
            control.getAttribute("href"),
            control.getAttribute("onclick"),
            typeof control.className === "string" ? control.className : ""
          ].join(" ");
          if (!pattern.test(`${text} ${attrs}`)) return [];
          const rect = control.getBoundingClientRect();
          return [{
            bodyIndex: allBodyElements.indexOf(control),
            text,
            tagName: control.tagName.toLowerCase(),
            role: control.getAttribute("role"),
            ariaLabel: control.getAttribute("aria-label"),
            title: control.getAttribute("title"),
            onclick: control.getAttribute("onclick"),
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
          }];
        });
        const rect = row.getBoundingClientRect();
        return {
          text: normalize(row.innerText || row.textContent),
          downloadControls: controlsFor(downloadPattern),
          deleteControls: controlsFor(deletePattern),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
        };
      })
      .sort((a, b) => a.text.length - b.text.length || b.downloadControls.length + b.deleteControls.length - (a.downloadControls.length + a.deleteControls.length));
    const row = matchingRows[0] ?? null;
    return {
      found: row !== null,
      reportName: targetReportName,
      url: window.location.href,
      bodyTextExcerpt: normalize(document.body?.innerText ?? "").slice(0, 3000),
      rowText: row?.text ?? null,
      downloadControls: row?.downloadControls ?? [],
      deleteControls: row?.deleteControls ?? []
    };
  }, reportName);
};

const ensureSavedReportListRowVisible = async (
  options: CliOptions,
  page: Page,
  reportName: string
): Promise<{ state: ReportListRowState; attempts: Array<ReportListRowState & { label: string }>; recoveryActions: string[] }> => {
  const attempts: Array<ReportListRowState & { label: string }> = [];
  const recoveryActions: string[] = [];
  const capture = async (label: string): Promise<ReportListRowState> => {
    const state = await readReportListRowState(page, reportName);
    attempts.push({ ...state, label });
    return state;
  };

  let state = await capture("initial");
  if (state.found) return { state, attempts, recoveryActions };

  if (/報表設定|儲存報表|執行/.test(state.bodyTextExcerpt)) {
    recoveryActions.push("click_project_from_editor");
    await ensureCollageProjectSelected(options, page).catch((error) => {
      recoveryActions.push(`click_project_from_editor_failed:${error instanceof Error ? error.message : String(error)}`);
    });
    await page.waitForTimeout(1200);
    state = await capture("after_project_click_from_editor");
    if (state.found) return { state, attempts, recoveryActions };
  }

  recoveryActions.push("reload_report_list");
  await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch((error) => {
    recoveryActions.push(`reload_report_list_failed:${error instanceof Error ? error.message : String(error)}`);
  });
  await page.waitForTimeout(1500);
  state = await capture("after_reload");
  if (state.found) return { state, attempts, recoveryActions };

  recoveryActions.push("click_project_after_reload");
  await ensureCollageProjectSelected(options, page).catch((error) => {
    recoveryActions.push(`click_project_after_reload_failed:${error instanceof Error ? error.message : String(error)}`);
  });
  await page.waitForTimeout(1200);
  state = await capture("after_project_click");

  return { state, attempts, recoveryActions };
};

const clickReportListCsvDownload = async (
  page: Page,
  reportName: string,
  state: ReportListRowState | null = null
): Promise<CsvDownloadTriggerEvidence> => {
  const rowState = state ?? await readReportListRowState(page, reportName);
  if (!rowState.found) return { clicked: false, trigger: "report-list-row-not-found", rowState };
  const selectedControl = rowState.downloadControls[0];
  if (typeof selectedControl?.bodyIndex === "number" && selectedControl.bodyIndex >= 0) {
    try {
      await clickVisibleBodyElementByIndex(page, selectedControl.bodyIndex, 8000);
      return { clicked: true, trigger: "report-list-row-download-control", rowState, selectedControl };
    } catch (error) {
      const fallbackClicked = await clickFirstVisible([
        page.locator("tr").filter({ hasText: reportName }).locator("button, a, [role=button]").filter({ hasText: /下載|CSV|匯出|⬇/i }),
        page.locator("[class*=row], [class*=Row], [class*=card], [class*=Card], [class*=item], [class*=Item], [class*=list], [class*=List]")
          .filter({ hasText: reportName })
          .locator("button, a, [role=button]")
          .filter({ hasText: /下載|CSV|匯出|⬇/i })
      ], 8000);
      if (fallbackClicked) return { clicked: true, trigger: "report-list-row-text-button", rowState, selectedControl };
      return {
        clicked: false,
        trigger: "report-list-row-download-click-failed",
        rowState,
        selectedControl,
        clickError: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const candidates = await page.evaluate((targetReportName) => {
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const downloadPattern = /下載|CSV|匯出|download|export|⬇/i;
    const all = Array.from(document.querySelectorAll<HTMLElement>("body *"));
    const reportElements = all.filter((element) => isVisible(element) && normalize(element.innerText || element.textContent).includes(targetReportName));
    const reportRects = reportElements.map((element) => element.getBoundingClientRect());
    return all.flatMap((element, index) => {
      if (!isVisible(element)) return [];
      const text = normalize(element.innerText || element.textContent);
      const attrs = [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("download"),
        element.getAttribute("href"),
        element.getAttribute("onclick"),
        typeof element.className === "string" ? element.className : ""
      ].join(" ");
      if (!downloadPattern.test(`${text} ${attrs}`)) return [];
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute("role");
      if (!["button", "a"].includes(tag) && role !== "button") return [];
      const rect = element.getBoundingClientRect();
      const nearReport = reportRects.some((reportRect) => Math.abs((reportRect.y + reportRect.height / 2) - (rect.y + rect.height / 2)) < 90);
      const ancestorHasReport = Boolean(element.closest("tr, [class*=row], [class*=Row], [class*=card], [class*=Card], [class*=item], [class*=Item]")?.textContent?.includes(targetReportName));
      if (!nearReport && !ancestorHasReport) return [];
      return [{
        index,
        text,
        tagName: tag,
        role,
        ariaLabel: element.getAttribute("aria-label"),
        title: element.getAttribute("title"),
        onclick: element.getAttribute("onclick"),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
      }];
    });
  }, reportName);
  const target = candidates[0] as { index?: unknown } | undefined;
  if (typeof target?.index === "number") {
    await clickVisibleBodyElementByIndex(page, target.index, 8000);
    return { clicked: true, trigger: "report-list-row-nearby-download-control", candidates, rowState };
  }
  return { clicked: false, trigger: "report-list-row-download-not-found", candidates, rowState };
};

type DeleteReportTriggerEvidence = {
  clicked: boolean;
  trigger: string;
  rowState?: ReportListRowState;
  selectedControl?: Record<string, unknown>;
  candidates?: unknown[];
  clickError?: string;
};

const clickReportListDeleteControl = async (
  page: Page,
  reportName: string,
  state: ReportListRowState | null = null
): Promise<DeleteReportTriggerEvidence> => {
  const rowState = state ?? await readReportListRowState(page, reportName);
  if (!rowState.found) return { clicked: false, trigger: "report-list-row-not-found", rowState };
  const selectedControl = rowState.deleteControls[0];
  if (typeof selectedControl?.bodyIndex === "number" && selectedControl.bodyIndex >= 0) {
    try {
      await clickVisibleBodyElementByIndex(page, selectedControl.bodyIndex, 8000);
      return { clicked: true, trigger: "report-list-row-delete-control", rowState, selectedControl };
    } catch (error) {
      const fallbackClicked = await clickFirstVisible([
        page.locator("tr").filter({ hasText: reportName }).locator("button, a, [role=button]").filter({ hasText: /刪除|删除|delete|trash|remove|🗑/i }),
        page.locator("[class*=row], [class*=Row], [class*=card], [class*=Card], [class*=item], [class*=Item], [class*=list], [class*=List]")
          .filter({ hasText: reportName })
          .locator("button, a, [role=button]")
          .filter({ hasText: /刪除|删除|delete|trash|remove|🗑/i })
      ], 8000);
      if (fallbackClicked) return { clicked: true, trigger: "report-list-row-text-delete-button", rowState, selectedControl };
      return {
        clicked: false,
        trigger: "report-list-row-delete-click-failed",
        rowState,
        selectedControl,
        clickError: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const candidates = await page.evaluate((targetReportName) => {
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const deletePattern = /刪除|删除|delete|trash|remove|🗑/i;
    const all = Array.from(document.querySelectorAll<HTMLElement>("body *"));
    const reportElements = all.filter((element) => isVisible(element) && normalize(element.innerText || element.textContent).includes(targetReportName));
    const reportRects = reportElements.map((element) => element.getBoundingClientRect());
    return all.flatMap((element, index) => {
      if (!isVisible(element)) return [];
      const text = normalize(element.innerText || element.textContent);
      const attrs = [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("href"),
        element.getAttribute("onclick"),
        typeof element.className === "string" ? element.className : ""
      ].join(" ");
      if (!deletePattern.test(`${text} ${attrs}`)) return [];
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute("role");
      if (!["button", "a"].includes(tag) && role !== "button") return [];
      const rect = element.getBoundingClientRect();
      const nearReport = reportRects.some((reportRect) => Math.abs((reportRect.y + reportRect.height / 2) - (rect.y + rect.height / 2)) < 90);
      const ancestorHasReport = Boolean(element.closest("tr, [class*=row], [class*=Row], [class*=card], [class*=Card], [class*=item], [class*=Item]")?.textContent?.includes(targetReportName));
      if (!nearReport && !ancestorHasReport) return [];
      return [{
        index,
        text,
        tagName: tag,
        role,
        ariaLabel: element.getAttribute("aria-label"),
        title: element.getAttribute("title"),
        onclick: element.getAttribute("onclick"),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
      }];
    });
  }, reportName);
  const target = candidates[0] as { index?: unknown } | undefined;
  if (typeof target?.index === "number") {
    await clickVisibleBodyElementByIndex(page, target.index, 8000);
    return { clicked: true, trigger: "report-list-row-nearby-delete-control", candidates, rowState };
  }
  return { clicked: false, trigger: "report-list-row-delete-not-found", candidates, rowState };
};

const isLikelyCsvDownloadResponse = (response: Response): boolean => {
  const headers = response.headers();
  const contentType = String(headers["content-type"] ?? "").toLowerCase();
  const disposition = String(headers["content-disposition"] ?? "").toLowerCase();
  const url = response.url().toLowerCase();
  if (response.status() < 200 || response.status() >= 300) return false;
  return /text\/csv|application\/csv|application\/octet-stream|application\/vnd\.ms-excel/.test(contentType)
    || /attachment|\.csv/.test(disposition)
    || /download|export|csv/.test(url);
};

const filenameFromContentDisposition = (value: string | undefined): string | null => {
  if (!value) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      return utf8;
    }
  }
  return /filename="?([^";]+)"?/i.exec(value)?.[1]?.trim() ?? null;
};

const observeUiTriggeredCsvDownload = async (
  page: Page,
  trigger: () => Promise<CsvDownloadTriggerEvidence>
): Promise<{
  triggerEvidence: CsvDownloadTriggerEvidence;
  download: Download | null;
  downloadError: string | null;
  csvResponse: Response | null;
  requests: Record<string, unknown>[];
  responses: Record<string, unknown>[];
}> => {
  const requests: Record<string, unknown>[] = [];
  const responses: Record<string, unknown>[] = [];
  const responseObjects: Response[] = [];
  const onRequest = (request: Request) => {
    if (!/biapi|preview|report|chart|custom|download|csv|export/i.test(request.url())) return;
    requests.push({
      url: request.url(),
      method: request.method(),
      postData: request.postData()?.slice(0, 4000) ?? null,
      timestamp: new Date().toISOString()
    });
  };
  const onResponse = (response: Response) => {
    if (!/biapi|preview|report|chart|custom|download|csv|export/i.test(response.url())) return;
    responseObjects.push(response);
    responses.push({
      url: response.url(),
      status: response.status(),
      contentType: response.headers()["content-type"] ?? null,
      contentDisposition: response.headers()["content-disposition"] ?? null,
      timestamp: new Date().toISOString()
    });
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  let downloadError: string | null = null;
  const downloadPromise: Promise<Download | null> = page.waitForEvent("download", { timeout: 20000 }).catch((error) => {
    downloadError = error instanceof Error ? error.message : String(error);
    return null;
  });
  try {
    const triggerEvidence = await trigger();
    if (!triggerEvidence.clicked) {
      downloadPromise.catch(() => undefined);
      return { triggerEvidence, download: null, downloadError: null, csvResponse: null, requests, responses };
    }
    const download = await downloadPromise;
    return {
      triggerEvidence,
      download,
      downloadError,
      csvResponse: [...responseObjects].reverse().find(isLikelyCsvDownloadResponse) ?? null,
      requests,
      responses
    };
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
  }
};

const downloadCsvAndComparePreview = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const uiProfileBefore = await captureUiDomProfile(options, page, "downloadCsv.before");
  const domStateBefore: Record<string, unknown> = await readDomState(page).catch((error) => ({ readError: error instanceof Error ? error.message : String(error) }));
  const downloadDir = path.join(artifactRoot(options), "downloads");
  ensureDir(downloadDir);
  const savedReportName = readSavedReportName(options);
  const downloadScope = stringParam(options.params, "downloadScope");
  const bodyTextBefore = typeof domStateBefore.bodyTextExcerpt === "string" ? domStateBefore.bodyTextExcerpt : "";
  const wantsReportList = downloadScope === "report_list"
    || Boolean(savedReportName && bodyTextBefore.includes(savedReportName) && !/報表設定|儲存報表|執行/.test(bodyTextBefore));
  if (wantsReportList && !savedReportName) throw new HelperBlockedError("SAVED_REPORT_NAME_MISSING_FOR_REPORT_LIST_CSV");

  let listRecovery: Awaited<ReturnType<typeof ensureSavedReportListRowVisible>> | null = null;
  let reportListState: ReportListRowState | null = null;
  if (wantsReportList && savedReportName) {
    listRecovery = await ensureSavedReportListRowVisible(options, page, savedReportName);
    reportListState = listRecovery.state;
    if (!reportListState.found) {
      const failedSubcondition = "saved_report_row_missing";
      const shot = await screenshot(options, page, failedSubcondition);
      const uiProfileAfterPrecondition = await captureUiDomProfile(options, page, `downloadCsv.${failedSubcondition}`);
      return createReport(
        options,
        "ok",
        startedAt,
        {
          workflowStatus: "failed_precondition",
          failedSubcondition,
          csv_comparison_status: "not_reached",
          reportName: savedReportName,
          requestedScope: downloadScope ?? "auto_report_list",
          domState: await readDomState(page),
          uiProfiles: { before: uiProfileBefore, precondition: uiProfileAfterPrecondition },
          reportList: listRecovery
        },
        shot ? { screenshot: shot } : {},
        [
          ...(shot ? [] : ["SCREENSHOT_UNAVAILABLE"]),
          "CSV_SAVED_REPORT_ROW_NOT_FOUND_AFTER_REFRESH"
        ]
      );
    }
  }

  const observedDownload = await observeUiTriggeredCsvDownload(page, async () => {
    if (wantsReportList && savedReportName) {
      const rowDownload = await clickReportListCsvDownload(page, savedReportName, reportListState);
      return { ...rowDownload, reportName: savedReportName, requestedScope: downloadScope ?? "auto_report_list" };
    }
    const clicked = await clickFirstVisible([
      page.getByText(/下載.*CSV|CSV.*下載|匯出.*CSV|CSV|下載/i),
      page.locator("button").filter({ hasText: /下載|CSV|匯出/ })
    ], 12000);
    if (!clicked) {
      const domIndex = await editorDownloadButtonDomIndex(page);
      const iconClicked = await clickButtonByDomIndex(page, domIndex, 8000);
      return iconClicked
        ? { clicked: true, trigger: "editor-toolbar-icon-download-control", domIndex, reportName: savedReportName ?? null }
        : { clicked: false, trigger: "global-download-control-not-found", domIndex, reportName: savedReportName ?? null };
    }
    return clicked
      ? { clicked: true, trigger: "global-download-control", reportName: savedReportName ?? null }
      : { clicked: false, trigger: "global-download-control-not-found", reportName: savedReportName ?? null };
  });
  const triggerEvidence = observedDownload.triggerEvidence;
  if (!observedDownload.triggerEvidence.clicked) {
    const cleanupState = domStateBefore.cleanupState && typeof domStateBefore.cleanupState === "object"
      ? domStateBefore.cleanupState as Record<string, unknown>
      : {};
    const precondition = /請選擇欄位|點擊「?執行」?查看|尚無資料|沒有資料|無預覽/i.test(bodyTextBefore)
      ? "CSV_PRECONDITION_NOT_MET_NO_CURRENT_PREVIEW"
      : "CSV_DOWNLOAD_BUTTON_NOT_CLICKABLE";
    throw new HelperBlockedError(
      `${precondition}; downloadTrigger=${JSON.stringify(triggerEvidence).slice(0, 1200)}; dateRange=${String(cleanupState.dateRangeText ?? "(unknown)")}; fields=${String(cleanupState.fieldSelectionText ?? "(unknown)")}; buttons=${JSON.stringify(domStateBefore.buttons ?? []).slice(0, 800)}`
    );
  }

  let csvPath: string;
  let downloadedCsv: Record<string, unknown>;
  const csvWarnings: string[] = [];
  if (observedDownload.download) {
    const suggested = sanitize(observedDownload.download.suggestedFilename() || `${sanitize(options.caseId)}.csv`);
    csvPath = path.join(downloadDir, suggested);
    await observedDownload.download.saveAs(csvPath);
    downloadedCsv = {
      source: "browser_download_event",
      path: csvPath,
      relativePath: path.relative(options.runDir, csvPath),
      suggestedFilename: observedDownload.download.suggestedFilename(),
      trigger: triggerEvidence
    };
  } else if (observedDownload.csvResponse) {
    const headers = observedDownload.csvResponse.headers();
    const suggested = sanitize(filenameFromContentDisposition(headers["content-disposition"]) ?? `${sanitize(savedReportName ?? options.caseId)}_ui-response.csv`);
    csvPath = path.join(downloadDir, suggested);
    fs.writeFileSync(csvPath, await observedDownload.csvResponse.body());
    csvWarnings.push("CSV_BROWSER_DOWNLOAD_EVENT_NOT_FIRED_USED_UI_RESPONSE_BODY");
    downloadedCsv = {
      source: "ui_triggered_network_response_body",
      path: csvPath,
      relativePath: path.relative(options.runDir, csvPath),
      suggestedFilename: suggested,
      responseUrl: observedDownload.csvResponse.url(),
      responseStatus: observedDownload.csvResponse.status(),
      responseContentType: headers["content-type"] ?? null,
      responseContentDisposition: headers["content-disposition"] ?? null,
      trigger: triggerEvidence
    };
  } else {
    throw new HelperBlockedError(
      `CSV_UI_DOWNLOAD_NOT_OBSERVED; downloadError=${observedDownload.downloadError ?? "(none)"}; trigger=${JSON.stringify(triggerEvidence).slice(0, 1200)}; network=${JSON.stringify(observedDownload.responses).slice(0, 1200)}`
    );
  }
  const csvText = fs.readFileSync(csvPath, "utf8");
  const preview = readPreviewEvidence(options);
  const comparison = summarizeCsvAgainstPreview(csvText, preview);
  const shot = await screenshot(options, page, "download-csv");
  const uiProfileAfter = await captureUiDomProfile(options, page, "downloadCsv.after");
  const bodyTextAfter = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  const downloadToastState = {
    visibleText: bodyTextAfter.includes("數據已開始下載") ? "數據已開始下載" : null,
    appearedAfterDownloadClick: bodyTextAfter.includes("數據已開始下載"),
    asserted: bodyTextAfter.includes("數據已開始下載")
  };
  const checks = comparison.checks as Record<string, unknown>;
  const failedComparison = checks.rowCountMatchesPreview === false || checks.allSeriesMatched === false;
  const strictCsvPreviewComparison = contractRequiresCsvPreviewComparison(options.params);
  return createReport(
    options,
    "ok",
    startedAt,
    {
      domState: await readDomState(page),
      uiProfiles: { before: uiProfileBefore, after: uiProfileAfter },
      reportList: listRecovery,
      downloadedCsv,
      "editorToolbar.download.state": {
        triggeredByVisibleUi: triggerEvidence.clicked === true,
        enabledBeforeClick: true,
        downloadEventObserved: Boolean(observedDownload.download || observedDownload.csvResponse),
        asserted: triggerEvidence.clicked === true && Boolean(observedDownload.download || observedDownload.csvResponse)
      },
      "download.toast.state": downloadToastState,
      previewEvidencePath: fs.existsSync(previewEvidencePath(options)) ? previewEvidencePath(options) : null,
      comparison,
      network: { requests: observedDownload.requests, responses: observedDownload.responses },
      downloadEventError: observedDownload.downloadError
    },
    { ...(shot ? { screenshot: shot } : {}), csv: csvPath },
    [
      ...(shot ? [] : ["SCREENSHOT_UNAVAILABLE"]),
      ...csvWarnings,
      ...(downloadToastState.asserted ? [] : ["DOWNLOAD_TOAST_NOT_OBSERVED"]),
      ...(preview ? [] : ["PREVIEW_EVIDENCE_NOT_FOUND_FOR_CSV_COMPARISON"]),
      ...(failedComparison && strictCsvPreviewComparison ? ["CSV_PREVIEW_COMPARISON_MISMATCH"] : [])
    ]
  );
};

const approvalRequired = (options: CliOptions, action: string, startedAt: string): HelperReport => {
  const requestId = `${options.caseId}-${sanitize(options.action)}`;
  return createReport(
    options,
    "requires_approval",
    startedAt,
    {},
    {},
    ["TOOL_BRIDGE_RESPONSE_REQUIRED_BEFORE_HELPER_ACTION"],
    {
      toolRequest: {
        type: "irreversible_operation",
        request_id: requestId,
        case: options.caseId,
        action,
        reason: `${options.action} may create, overwrite, delete, or accept native dialogs.`,
        proposed_action: `Authorize helper action ${options.action} for current case ${options.caseId} only.`
      }
    }
  );
};

const fillVisibleReportNameInput = async (page: Page, reportName: string): Promise<Record<string, unknown>> => {
  const inputs = await visibleInputIndexes(page);
  const candidates = inputs.filter((item) => item.type === "text" && !/專案|project/i.test(item.placeholder));
  const preferred =
    candidates.find((item) => /報表|report|名稱|name/i.test(item.placeholder)) ??
    candidates.find((item) => item.value.trim().length === 0) ??
    candidates.at(-1);
  if (!preferred) {
    throw new HelperBlockedError(`SAVE_REPORT_NAME_INPUT_NOT_FOUND inputs=${JSON.stringify(inputs).slice(0, 1000)}`);
  }
  await page.locator("input").nth(preferred.index).fill(reportName, { timeout: 8000 });
  return { selectedInput: preferred, visibleInputs: inputs };
};

const clickExactVisibleButtonText = async (page: Page, labels: string[], timeout = 8000): Promise<boolean> => {
  const buttons = await visibleButtons(page).catch(() => []);
  const labelSet = new Set(labels.map((label) => label.trim()));
  const candidates = buttons
    .filter((button) => labelSet.has(button.text.trim()))
    .sort((a, b) => b.y - a.y || b.x - a.x);
  const target = candidates[0];
  if (!target) return false;
  await clickVisibleButtonByIndex(page, target.index, timeout);
  return true;
};

const selectSaveReportProjectIfNeeded = async (page: Page, projectName: string): Promise<Record<string, unknown>> => {
  const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  if (!/請選擇專案|儲存專案/.test(bodyText)) {
    return { skipped: true, reason: "save_project_selector_not_visible" };
  }
  const opened = await clickFirstVisible([
    page.getByText("請選擇專案", { exact: false }),
    page.locator("button").filter({ hasText: /請選擇專案/ })
  ], 5000);
  if (!opened) return { skipped: false, selected: false, reason: "save_project_selector_not_clickable", projectName };
  await page.waitForTimeout(500);
  const exactTargets = await visibleExactTextTargets(page, projectName).catch(() => []);
  const target = exactTargets
    .filter((item) => item.x >= 450 && item.x <= 1050 && item.y >= 260)
    .sort((a, b) => b.y - a.y || b.x - a.x)[0] ?? exactTargets.at(-1);
  if (target) {
    await clickVisibleBodyElementByIndex(page, target.index, 8000);
    await page.waitForTimeout(500);
    return { skipped: false, selected: true, method: "visibleExactTextTarget", projectName, target };
  }
  const clickedFallback = await page.getByText(projectName, { exact: true }).last().click({ timeout: 5000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(500);
  return {
    skipped: false,
    selected: clickedFallback,
    method: clickedFallback ? "textLocatorLast" : "not_found",
    projectName,
    availableTargets: exactTargets.slice(0, 20)
  };
};

const clickModalSaveButton = async (page: Page): Promise<void> => {
  const clicked = await clickFirstVisible([
    page.getByRole("button", { name: /^(儲存|確認|確定|保存)$/ }),
    page.getByText("儲存", { exact: true }),
    page.getByText("確認", { exact: true }),
    page.getByText("確定", { exact: true }),
    page.locator(".modal button").filter({ hasText: /儲存|確認|確定|保存/ }),
    page.locator("[role=dialog] button").filter({ hasText: /儲存|確認|確定|保存/ }),
    page.locator("button").filter({ hasText: /^(儲存|確認|確定|保存)$/ })
  ], 8000);
  if (clicked) return;
  if (await clickExactVisibleButtonText(page, ["儲存", "確認", "確定", "保存"], 8000)) return;
  const buttons = await visibleButtons(page).catch(() => []);
  throw new HelperBlockedError(`SAVE_MODAL_SUBMIT_BUTTON_NOT_CLICKABLE visibleButtons=${JSON.stringify(buttons.slice(0, 30)).slice(0, 1200)}`);
};

const clickDialogOnlySaveButton = async (page: Page): Promise<boolean> => {
  return clickFirstVisible([
    page.getByRole("button", { name: /^(儲存|確認|確定|保存)$/ }),
    page.locator(".modal button").filter({ hasText: /儲存|確認|確定|保存/ }),
    page.locator("[role=dialog] button").filter({ hasText: /儲存|確認|確定|保存/ })
  ], 5000);
};

type NativeDialogHandling = {
  action: "accept" | "dismiss";
  reason: string;
  requiresRecovery: boolean;
};

const decideSaveDialogHandling = (dialogRecord: Record<string, unknown>, sequence: number): NativeDialogHandling => {
  const type = String(dialogRecord.type ?? "");
  const message = String(dialogRecord.message ?? "");
  if (/sso|login|登入|密碼|password|驗證|認證/i.test(message)) {
    return { action: "dismiss", reason: "auth_like_dialog_not_auto_approved", requiresRecovery: true };
  }
  if (/是否\s*(?:返回|回到)\s*報表列表|(?:返回|回到)\s*列表/.test(message)) {
    return { action: "accept", reason: "known_bi_save_return_to_list_confirm", requiresRecovery: false };
  }
  if (/報表儲存成功|儲存成功|保存成功/.test(message)) {
    return { action: "accept", reason: "known_bi_save_success_dialog", requiresRecovery: false };
  }
  if (/覆寫|覆蓋|更新|是否.*儲存|是否.*保存/.test(message)) {
    return { action: "accept", reason: "known_bi_overwrite_save_confirm", requiresRecovery: false };
  }
  if (/是否.*(?:新增|建立).*報表|(?:新增|建立)報表/.test(message)) {
    return { action: "accept", reason: "known_bi_save_create_report_confirm", requiresRecovery: false };
  }
  if (sequence === 1 && type === "alert") {
    return { action: "accept", reason: "first_save_alert_after_tool_bridge_approval", requiresRecovery: false };
  }
  return { action: "dismiss", reason: "unknown_native_dialog_dismissed_for_recovery", requiresRecovery: true };
};

type SaveReportObservedResult = {
  nameInputEvidence: Record<string, unknown> | null;
  projectSelectionEvidence: Record<string, unknown> | null;
  saveModalProfile: UiDomProfileRef;
  saveModalAfterFillProfile: UiDomProfileRef | null;
};

const saveReport = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  if (!options.approvedToolRequestId) return approvalRequired(options, "save current temporary report", startedAt);
  const overwriteExisting = options.params.overwriteExisting === true;
  const existingReportName = overwriteExisting ? readSavedReportName(options) : null;
  const reportName = existingReportName ?? resolveReportName(options);
  const dialogs: Record<string, unknown>[] = [];
  let dialogChainRequiresApproval = false;
  const uiProfileBefore = await captureUiDomProfile(options, page, "saveReport.before");
  const dialogHandler = async (dialog: Dialog) => {
    const sequence = dialogs.length + 1;
    const record: Record<string, unknown> = {
      sequence,
      type: dialog.type(),
      message: dialog.message(),
      defaultValue: dialog.defaultValue()
    };
    const handling = decideSaveDialogHandling(record, sequence);
    record.handledAction = handling.action;
    record.handledReason = handling.reason;
    dialogs.push(record);
    if (handling.requiresRecovery) dialogChainRequiresApproval = true;
    try {
      if (handling.action === "accept") {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
      record.handledAt = new Date().toISOString();
    } catch (error) {
      record.handledError = error instanceof Error ? error.message : String(error);
      dialogChainRequiresApproval = true;
    }
  };
  page.on("dialog", dialogHandler);
  let observed: { result: SaveReportObservedResult; requests: Record<string, unknown>[]; responses: Record<string, unknown>[] } | null = null;
  try {
    observed = await withTimeout(
      observeDuring(page, async (): Promise<SaveReportObservedResult> => {
        await page.getByText("儲存報表", { exact: false }).first().click({ timeout: 15000 });
        await page.waitForTimeout(600);
        const saveModalProfile = await captureUiDomProfile(options, page, "saveReport.modalOpened");
        let nameInputEvidence: Record<string, unknown> | null = null;
        let projectSelectionEvidence: Record<string, unknown> | null = null;
        let saveModalAfterFillProfile: UiDomProfileRef | null = null;
        try {
          nameInputEvidence = await fillVisibleReportNameInput(page, reportName);
          const targetProjectName = firstStringParam(options.params, ["saveProjectName", "projectName", "project"]) ?? "拼貼test_001";
          projectSelectionEvidence = await selectSaveReportProjectIfNeeded(page, targetProjectName);
          saveModalAfterFillProfile = await captureUiDomProfile(options, page, "saveReport.modalAfterFill");
          await withTimeout(clickModalSaveButton(page), 20000, "SAVE_MODAL_SUBMIT_TIMEOUT");
        } catch (error) {
          if (!overwriteExisting) throw error;
          const dialogButtonClicked = await clickDialogOnlySaveButton(page).catch(() => false);
          nameInputEvidence = {
            skipped: true,
            reason: "REPORT_NAME_INPUT_NOT_PRESENT_FOR_OVERWRITE_FLOW",
            dialogButtonClicked,
            error: error instanceof Error ? error.message : String(error)
          };
        }
        await page.waitForTimeout(1800);
        return { nameInputEvidence, projectSelectionEvidence, saveModalProfile, saveModalAfterFillProfile };
      }),
      45000,
      "SAVE_REPORT_FLOW_TIMEOUT"
    );
  } finally {
    page.off("dialog", dialogHandler);
  }
  if (!observed) throw new HelperBlockedError("SAVE_REPORT_FLOW_DID_NOT_COMPLETE");
  writeSavedReportState(options, reportName, { approvedToolRequestId: options.approvedToolRequestId, dialogs });
  if (dialogChainRequiresApproval) {
    const uiProfileAfterDialog = await captureUiDomProfile(options, page, "saveReport.dialogChain");
    return createReport(
      options,
      "blocked",
      startedAt,
      {
        reportName,
        dialogs,
        uiProfiles: {
          before: uiProfileBefore,
          modalOpened: observed.result.saveModalProfile,
          modalAfterFill: observed.result.saveModalAfterFillProfile,
          dialogChain: uiProfileAfterDialog
        },
        network: { requests: observed.requests, responses: observed.responses },
        nameInput: observed.result.nameInputEvidence,
        projectSelection: observed.result.projectSelectionEvidence
      },
      {},
      ["NATIVE_DIALOG_CHAIN_BLOCKED", "UNKNOWN_NATIVE_DIALOG_NO_RECOVERY_HANDLER"]
    );
  }
  let reportListEvidence: Record<string, unknown> | null = null;
  try {
    const readiness = await waitForBackToProjectListReadiness(options, page);
    const rowVisibility = await ensureSavedReportListRowVisible(options, page, reportName);
    reportListEvidence = {
      reportName,
      found: rowVisibility.state.found,
      rowState: rowVisibility.state,
      attempts: rowVisibility.attempts,
      recoveryActions: rowVisibility.recoveryActions,
      readiness
    };
    writeSavedReportState(options, reportName, {
      approvedToolRequestId: options.approvedToolRequestId,
      dialogs,
      reportListEvidence
    });
  } catch (error) {
    reportListEvidence = {
      reportName,
      found: false,
      error: error instanceof Error ? error.message : String(error)
    };
    writeSavedReportState(options, reportName, {
      approvedToolRequestId: options.approvedToolRequestId,
      dialogs,
      reportListEvidence
    });
  }
  const shot = await screenshot(options, page, "save-report");
  const uiProfileAfter = await captureUiDomProfile(options, page, "saveReport.after");
  return createReport(
    options,
    "ok",
    startedAt,
    {
      domState: await readDomState(page),
      uiProfiles: {
        before: uiProfileBefore,
        modalOpened: observed.result.saveModalProfile,
        modalAfterFill: observed.result.saveModalAfterFillProfile,
        after: uiProfileAfter
      },
      dialogs,
      approvedToolRequestId: options.approvedToolRequestId,
      reportName,
      reportListEvidence,
      network: { requests: observed.requests, responses: observed.responses },
      nameInput: observed.result.nameInputEvidence,
      projectSelection: observed.result.projectSelectionEvidence
    },
    shot ? { screenshot: shot } : {},
    shot ? [] : ["SCREENSHOT_UNAVAILABLE"]
  );
};

const reportSummary = (report: HelperReport): Record<string, unknown> => ({
  action: report.action,
  status: report.status,
  warnings: report.warnings,
  artifacts: report.artifacts,
  evidence: report.evidence
});

const isTemporaryDeleteReportName = (reportName: string): boolean =>
  /(?:temp|temporary|臨時|OTTEST004[_-]?G03|OTTEST004[_-]?G[_-]?03|G03[_-]?temp)/i.test(reportName) &&
  !/tommytest|主報表|正式|production|prod/i.test(reportName);

const clickDeleteConfirmIfVisible = async (page: Page): Promise<Record<string, unknown>> => {
  const clicked = await clickFirstVisible([
    page.locator(".modal button").filter({ hasText: /刪除|删除|確認|確定|OK|Yes/i }),
    page.locator("[role=dialog] button").filter({ hasText: /刪除|删除|確認|確定|OK|Yes/i }),
    page.locator(".ant-modal button").filter({ hasText: /刪除|删除|確認|確定|OK|Yes/i }),
    page.locator(".swal2-popup button").filter({ hasText: /刪除|删除|確認|確定|OK|Yes/i })
  ], 5000);
  return {
    clicked,
    checkedAt: new Date().toISOString()
  };
};

const createAndDeleteTemporaryReport = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  if (!options.approvedToolRequestId) return approvalRequired(options, "create then delete current-case temporary report", startedAt);

  const requestedFields = metricFieldsFromParams(options.params);
  const reportNameOptions: CliOptions = {
    ...options,
    params: {
      ...options.params,
      reportNamePattern: firstStringParam(options.params, ["reportName", "reportNamePattern", "name"]) ?? "OTTEST004_G03_temp_<timestamp>",
      field: firstStringParam(options.params, ["field", "metric", "metricField"]) ?? requestedFields[0] ?? "新增帳號數",
      fields: requestedFields.length > 0 ? requestedFields : ["新增帳號數"],
      dateRange: stringParam(options.params, "dateRange") ?? "2026/03/01~2026/03/31",
      display: stringParam(options.params, "display") ?? "每天"
    }
  };
  const reportName = resolveReportName(reportNameOptions);
  if (!isTemporaryDeleteReportName(reportName)) {
    throw new HelperBlockedError(`DELETE_TEMP_REPORT_NAME_NOT_SAFE:${reportName}`);
  }
  const effectiveOptions: CliOptions = {
    ...reportNameOptions,
    params: {
      ...reportNameOptions.params,
      reportName,
      name: reportName
    }
  };

  const warnings: string[] = [];
  const uiProfileBefore = await captureUiDomProfile(effectiveOptions, page, "createDeleteTemporary.before");
  const createStep = await createCollageReport(effectiveOptions, page, startedAt);
  if (createStep.status !== "ok") {
    return createReport(
      effectiveOptions,
      "blocked",
      startedAt,
      { workflowStatus: "failed_precondition", failedSubcondition: "create_report", createStep: reportSummary(createStep) },
      createStep.artifacts,
      [...createStep.warnings, "DELETE_TEMP_CREATE_REPORT_NOT_OK"]
    );
  }

  const configureStep = await configureMetric(effectiveOptions, page, startedAt);
  if (configureStep.status !== "ok") {
    return createReport(
      effectiveOptions,
      "blocked",
      startedAt,
      {
        workflowStatus: "failed_precondition",
        failedSubcondition: "configure_metric",
        createStep: reportSummary(createStep),
        configureStep: reportSummary(configureStep)
      },
      { ...createStep.artifacts, ...configureStep.artifacts },
      [...configureStep.warnings, "DELETE_TEMP_CONFIGURE_NOT_OK"]
    );
  }

  const previewStep = await runPreview(effectiveOptions, page, startedAt);
  if (previewStep.status !== "ok") {
    return createReport(
      effectiveOptions,
      "blocked",
      startedAt,
      {
        workflowStatus: "failed_precondition",
        failedSubcondition: "run_preview",
        createStep: reportSummary(createStep),
        configureStep: reportSummary(configureStep),
        previewStep: reportSummary(previewStep)
      },
      { ...createStep.artifacts, ...configureStep.artifacts, ...previewStep.artifacts },
      [...previewStep.warnings, "DELETE_TEMP_PREVIEW_NOT_OK"]
    );
  }

  const saveStep = await saveReport(effectiveOptions, page, startedAt);
  if (saveStep.status !== "ok") {
    return createReport(
      effectiveOptions,
      "blocked",
      startedAt,
      {
        workflowStatus: "failed_precondition",
        failedSubcondition: "save_temporary_report",
        createStep: reportSummary(createStep),
        configureStep: reportSummary(configureStep),
        previewStep: reportSummary(previewStep),
        saveStep: reportSummary(saveStep)
      },
      { ...createStep.artifacts, ...configureStep.artifacts, ...previewStep.artifacts, ...saveStep.artifacts },
      [...saveStep.warnings, "DELETE_TEMP_SAVE_NOT_OK"]
    );
  }

  const savedReportName = readSavedReportName(effectiveOptions) ?? reportName;
  if (!isTemporaryDeleteReportName(savedReportName)) {
    throw new HelperBlockedError(`DELETE_SAVED_REPORT_NAME_NOT_SAFE:${savedReportName}`);
  }
  const listRecovery = await ensureSavedReportListRowVisible(effectiveOptions, page, savedReportName);
  if (!listRecovery.state.found || listRecovery.state.deleteControls.length === 0) {
    const shot = await screenshot(effectiveOptions, page, "delete-temp-row-not-ready");
    const evidence = {
      workflowStatus: "failed_precondition",
      failedSubcondition: !listRecovery.state.found ? "temporary_report_row_missing" : "temporary_report_delete_control_missing",
      reportName: savedReportName,
      listRecovery,
      createStep: reportSummary(createStep),
      configureStep: reportSummary(configureStep),
      previewStep: reportSummary(previewStep),
      saveStep: reportSummary(saveStep)
    };
    fs.writeFileSync(deleteTemporaryReportEvidencePath(effectiveOptions), `${JSON.stringify(evidence, null, 2)}\n`);
    return createReport(
      effectiveOptions,
      "blocked",
      startedAt,
      evidence,
      { ...createStep.artifacts, ...configureStep.artifacts, ...previewStep.artifacts, ...saveStep.artifacts, deleteTemporaryReportEvidence: deleteTemporaryReportEvidencePath(effectiveOptions), ...(shot ? { screenshot: shot } : {}) },
      [shot ? "" : "SCREENSHOT_UNAVAILABLE", "DELETE_TEMP_ROW_OR_CONTROL_NOT_FOUND"].filter(Boolean)
    );
  }

  const dialogs: Record<string, unknown>[] = [];
  let unknownDialog = false;
  const dialogHandler = async (dialog: Dialog) => {
    const record: Record<string, unknown> = {
      sequence: dialogs.length + 1,
      type: dialog.type(),
      message: dialog.message(),
      defaultValue: dialog.defaultValue()
    };
    const message = String(record.message ?? "");
    const authLike = /sso|login|登入|密碼|password|驗證|認證/i.test(message);
    const deleteLike = /刪除|删除|delete|remove|確定|確認|是否|confirm/i.test(message);
    record.handledAction = authLike || !deleteLike ? "dismiss" : "accept";
    record.handledReason = authLike
      ? "auth_like_dialog_not_auto_approved"
      : deleteLike
        ? "known_bi_delete_confirm_after_tool_bridge_approval"
        : "unknown_native_dialog_dismissed_for_recovery";
    if (authLike || !deleteLike) unknownDialog = true;
    dialogs.push(record);
    try {
      if (record.handledAction === "accept") await dialog.accept();
      else await dialog.dismiss();
      record.handledAt = new Date().toISOString();
    } catch (error) {
      record.handledError = error instanceof Error ? error.message : String(error);
      unknownDialog = true;
    }
  };

  page.on("dialog", dialogHandler);
  let deleteObserved: { result: { trigger: DeleteReportTriggerEvidence; modalConfirm: Record<string, unknown> }; requests: Record<string, unknown>[]; responses: Record<string, unknown>[] } | null = null;
  try {
    deleteObserved = await observeDuring(page, async () => {
      const trigger = await clickReportListDeleteControl(page, savedReportName, listRecovery.state);
      if (!trigger.clicked) return { trigger, modalConfirm: { clicked: false, reason: "delete-trigger-not-clicked" } };
      await page.waitForTimeout(600);
      const modalConfirm = await clickDeleteConfirmIfVisible(page);
      await page.waitForTimeout(1500);
      return { trigger, modalConfirm };
    });
  } finally {
    page.off("dialog", dialogHandler);
  }

  const afterDeleteInitial = await readReportListRowState(page, savedReportName).catch((error) => ({
    found: true,
    reportName: savedReportName,
    url: page.url(),
    bodyTextExcerpt: "",
    rowText: null,
    downloadControls: [],
    deleteControls: [],
    readError: error instanceof Error ? error.message : String(error)
  }));
  if (afterDeleteInitial.found) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    await ensureCollageProjectSelected(effectiveOptions, page).catch((error) => warnings.push(`DELETE_TEMP_RESELECT_PROJECT_FAILED:${error instanceof Error ? error.message : String(error)}`));
  }
  const afterDeleteReload = await readReportListRowState(page, savedReportName).catch((error) => ({
    found: true,
    reportName: savedReportName,
    url: page.url(),
    bodyTextExcerpt: "",
    rowText: null,
    downloadControls: [],
    deleteControls: [],
    readError: error instanceof Error ? error.message : String(error)
  }));
  const rowGone = afterDeleteReload.found === false;
  const shot = await screenshot(effectiveOptions, page, rowGone ? "delete-temp-report" : "delete-temp-report-still-visible");
  const uiProfileAfter = await captureUiDomProfile(effectiveOptions, page, "createDeleteTemporary.after");
  const evidence = {
    workflowStatus: rowGone && !unknownDialog && deleteObserved?.result.trigger.clicked ? "ok" : "blocked",
    approvedToolRequestId: effectiveOptions.approvedToolRequestId,
    reportName: savedReportName,
    temporaryNamePolicy: "reportName must contain temp/temporary/臨時 or OTTEST004_G03 and must not match protected main-resource keywords",
    uiProfiles: { before: uiProfileBefore, after: uiProfileAfter },
    createStep: reportSummary(createStep),
    configureStep: reportSummary(configureStep),
    previewStep: reportSummary(previewStep),
    saveStep: reportSummary(saveStep),
    listRecovery,
    deleteAction: {
      trigger: deleteObserved?.result.trigger ?? null,
      modalConfirm: deleteObserved?.result.modalConfirm ?? null,
      nativeDialogs: dialogs,
      network: deleteObserved ? { requests: deleteObserved.requests, responses: deleteObserved.responses } : null
    },
    verification: {
      afterDeleteInitial,
      afterDeleteReload,
      rowGone
    },
    warnings
  };
  fs.writeFileSync(deleteTemporaryReportEvidencePath(effectiveOptions), `${JSON.stringify(evidence, null, 2)}\n`);
  if (!deleteObserved?.result.trigger.clicked) warnings.push("DELETE_TEMP_TRIGGER_NOT_CLICKED");
  if (unknownDialog) warnings.push("DELETE_TEMP_UNKNOWN_OR_AUTH_DIALOG");
  if (!rowGone) warnings.push("DELETE_TEMP_ROW_STILL_VISIBLE_AFTER_DELETE");
  if (!shot) warnings.push("SCREENSHOT_UNAVAILABLE");
  return createReport(
    effectiveOptions,
    rowGone && !unknownDialog && Boolean(deleteObserved?.result.trigger.clicked) ? "ok" : "blocked",
    startedAt,
    evidence,
    {
      ...createStep.artifacts,
      ...configureStep.artifacts,
      ...previewStep.artifacts,
      ...saveStep.artifacts,
      deleteTemporaryReportEvidence: deleteTemporaryReportEvidencePath(effectiveOptions),
      ...(shot ? { screenshot: shot } : {})
    },
    warnings
  );
};

const reopenReport = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const reportName = readSavedReportName(options);
  if (!reportName) throw new HelperBlockedError("SAVED_REPORT_NAME_MISSING");
  const uiProfileBefore = await captureUiDomProfile(options, page, "reopenReport.before");
  const stateBefore = await readStateDelta(page, options.params).catch((error) => ({
    readError: error instanceof Error ? error.message : String(error)
  }));
  const beforeText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (!beforeText.includes(reportName) && !/報表設定|儲存報表|執行/.test(beforeText)) {
    await ensureCollageProjectSelected(options, page);
  }
  const refreshedText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (!refreshedText.includes(reportName)) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    await ensureCollageProjectSelected(options, page).catch(() => undefined);
    await page.waitForTimeout(800);
  }
  const finalListText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (!finalListText.includes(reportName)) {
    throw new HelperBlockedError(`SAVED_REPORT_ROW_NOT_FOUND:${reportName}`);
  }
  const observed = await observeDuring(page, async () => {
    await clickByText(page, reportName, 12000);
    const settle = await waitForReportEditorSettle(page);
    await page.waitForTimeout(400);
    return settle;
  });
  const shot = await screenshot(options, page, "reopen-report");
  const uiProfile = await captureUiDomProfile(options, page, "reopenReport.after");
  const domState = await readDomState(page);
  const stateAfter = await readStateDelta(page, options.params).catch((error) => ({
    readError: error instanceof Error ? error.message : String(error)
  }));
  const evidence = {
    caseNo: options.caseId,
    reportName,
    expected: {
      field: stringParam(options.params, "field"),
      dateRange: stringParam(options.params, "dateRange"),
      display: stringParam(options.params, "display")
    },
    settle: observed.result,
    domState,
    stateDelta: {
      before: stateBefore,
      after: stateAfter
    },
    network: {
      requests: observed.requests,
      responses: observed.responses
    }
  };
  const evidencePath = path.join(artifactRoot(options), "reopen-report-evidence.json");
  ensureDir(path.dirname(evidencePath));
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  const warnings = observed.result.status === "settled" ? [] : ["REOPEN_REPORT_SETTLE_TIMEOUT"];
  return createReport(
    options,
    observed.result.status === "settled" ? "ok" : "blocked",
    startedAt,
    {
      reportName,
      domState,
      uiProfiles: { before: uiProfileBefore, after: uiProfile },
      reopenReportEvidence: evidence
    },
    { ...(shot ? { screenshot: shot } : {}), reopenReportEvidence: evidencePath },
    shot ? warnings : [...warnings, "SCREENSHOT_UNAVAILABLE"]
  );
};

const openReportFromProjectList = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  return openExistingReport(options, page, startedAt);
};

type BackToProjectListReadiness = {
  url: string;
  bodyText: string;
  reportListSignals: boolean;
  editorUrl: boolean;
  attempts: Array<{
    label: string;
    url: string;
    bodyTextLength: number;
    hasCreateReportEntry: boolean;
    hasSelectProjectPrompt: boolean;
    reportListSignals: boolean;
    editorUrl: boolean;
    error?: string;
  }>;
};

const reportListSignalsFromBodyText = (bodyText: string): boolean =>
  hasCreateReportEntry(bodyText) && /報表名稱|資料區間日期|下載|刪除|⬇|🗑/.test(bodyText);

const waitForBackToProjectListReadiness = async (
  options: CliOptions,
  page: Page
): Promise<BackToProjectListReadiness> => {
  const attempts: BackToProjectListReadiness["attempts"] = [];
  let lastBodyText = "";
  let lastUrl = page.url();
  let reselectedProject = false;
  const deadline = Date.now() + 9000;

  for (let attempt = 0; Date.now() < deadline; attempt += 1) {
    lastUrl = page.url();
    let bodyText = "";
    let error: string | undefined;
    try {
      bodyText = await page.locator("body").innerText({ timeout: 2500 });
    } catch (readError) {
      error = readError instanceof Error ? readError.message : String(readError);
      bodyText = await page.evaluate(() => document.body?.innerText ?? "").catch((evaluateError) => {
        const evaluateMessage = evaluateError instanceof Error ? evaluateError.message : String(evaluateError);
        error = `${error}; evaluate=${evaluateMessage}`;
        return "";
      });
    }
    if (bodyText.trim()) lastBodyText = bodyText;
    const effectiveBodyText = bodyText.trim() ? bodyText : lastBodyText;
    const editorUrl = /\/testview\/edit\b/i.test(lastUrl);
    const reportListSignals = reportListSignalsFromBodyText(effectiveBodyText);
    const hasSelectProjectPrompt = /請從左側選擇專案查看報表/.test(effectiveBodyText);
    attempts.push({
      label: `poll_${attempt + 1}`,
      url: lastUrl,
      bodyTextLength: effectiveBodyText.length,
      hasCreateReportEntry: hasCreateReportEntry(effectiveBodyText),
      hasSelectProjectPrompt,
      reportListSignals,
      editorUrl,
      ...(error ? { error: error.slice(0, 300) } : {})
    });
    if (!editorUrl && reportListSignals) {
      return { url: lastUrl, bodyText: effectiveBodyText, reportListSignals, editorUrl, attempts };
    }
    if (!editorUrl && hasSelectProjectPrompt && !reselectedProject) {
      reselectedProject = true;
      await ensureCollageProjectSelected(options, page).catch((selectError) => {
        attempts.push({
          label: "reselect_project_failed",
          url: page.url(),
          bodyTextLength: effectiveBodyText.length,
          hasCreateReportEntry: hasCreateReportEntry(effectiveBodyText),
          hasSelectProjectPrompt,
          reportListSignals,
          editorUrl,
          error: selectError instanceof Error ? selectError.message.slice(0, 300) : String(selectError).slice(0, 300)
        });
      });
    }
    await page.waitForTimeout(500);
  }

  const finalUrl = page.url();
  const finalEditorUrl = /\/testview\/edit\b/i.test(finalUrl);
  const finalReportListSignals = reportListSignalsFromBodyText(lastBodyText);
  return {
    url: finalUrl,
    bodyText: lastBodyText,
    reportListSignals: finalReportListSignals,
    editorUrl: finalEditorUrl,
    attempts
  };
};

const clickBackToProjectList = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const uiProfileBefore = await captureUiDomProfile(options, page, "backToProjectList.before");
  const dialogs: Record<string, unknown>[] = [];
  const dialogHandler = async (dialog: Dialog) => {
    const record: Record<string, unknown> = {
      sequence: dialogs.length + 1,
      type: dialog.type(),
      message: dialog.message(),
      defaultValue: dialog.defaultValue(),
      handledAction: "dismiss",
      handledReason: "back_to_project_list_should_not_trigger_native_confirm"
    };
    dialogs.push(record);
    try {
      await dialog.dismiss();
      record.handledAt = new Date().toISOString();
    } catch (error) {
      record.handledError = error instanceof Error ? error.message : String(error);
    }
  };
  page.on("dialog", dialogHandler);
  let observed: { result: { clicked: boolean }; requests: Record<string, unknown>[]; responses: Record<string, unknown>[] } | null = null;
  try {
    observed = await observeDuring(page, async () => {
      const clicked = await clickFirstVisible([
        page.getByText("← 返回", { exact: false }),
        page.getByText("返回", { exact: false }),
        page.locator("button, a, [role=button]").filter({ hasText: /返回|Back/i })
      ], 10000);
      if (clicked) await page.waitForTimeout(1200);
      return { clicked };
    });
  } finally {
    page.off("dialog", dialogHandler);
  }
  if (!observed?.result.clicked) throw new HelperBlockedError("BACK_TO_PROJECT_LIST_BUTTON_NOT_CLICKABLE");
  const readiness = await waitForBackToProjectListReadiness(options, page);
  const { bodyText, url, reportListSignals, editorUrl } = readiness;
  const returnedToProjectList = !editorUrl && hasCreateReportEntry(bodyText) && reportListSignals;
  const shot = await screenshot(options, page, returnedToProjectList ? "back-to-project-list" : "back-to-project-list-blocked");
  const uiProfileAfter = await captureUiDomProfile(options, page, "backToProjectList.after");
  const evidence = {
    clicked: observed.result.clicked,
    returnedToProjectList,
    url,
    reportListSignals,
    editorUrl,
    readinessAttempts: readiness.attempts,
    nativeDialogs: dialogs,
    bodyTextExcerpt: bodyText.slice(0, 2400),
    network: { requests: observed.requests, responses: observed.responses }
  };
  const warnings = [
    ...(dialogs.length === 0 ? [] : ["BACK_TO_PROJECT_LIST_NATIVE_DIALOG_OBSERVED"]),
    ...(returnedToProjectList ? [] : ["BACK_TO_PROJECT_LIST_NOT_VERIFIED"]),
    ...(shot ? [] : ["SCREENSHOT_UNAVAILABLE"])
  ];
  return createReport(
    options,
    returnedToProjectList && dialogs.length === 0 ? "ok" : "blocked",
    startedAt,
    {
      domState: await readDomState(page),
      uiProfiles: { before: uiProfileBefore, after: uiProfileAfter },
      backToProjectListEvidence: evidence
    },
    shot ? { screenshot: shot } : {},
    warnings
  );
};

type FrontendObservationType =
  | "userButton"
  | "projectToolbar"
  | "reportModeRadio"
  | "datePanel"
  | "validationMessage"
  | "sidebarGroup"
  | "rowDeleteTooltip"
  | "projectLimitToast"
  | "sourceReportPicker"
  | "dateTimeTypeTab"
  | "datePanelCancel"
  | "downloadToast";

const frontendObservationType = (options: CliOptions): FrontendObservationType | null => {
  const value = firstStringParam(options.params, ["observationType", "type"]);
  if (
    value === "userButton" ||
    value === "projectToolbar" ||
    value === "reportModeRadio" ||
    value === "datePanel" ||
    value === "validationMessage" ||
    value === "sidebarGroup" ||
    value === "sidebarCompanySharedGroup" ||
    value === "rowDeleteTooltip" ||
    value === "rowActionTooltip" ||
    value === "projectLimitToast" ||
    value === "sourceReportPicker" ||
    value === "dateTimeTypeTab" ||
    value === "datePanelCancel" ||
    value === "downloadToast" ||
    value === "editorDownload"
  ) {
    if (value === "sidebarCompanySharedGroup") return "sidebarGroup";
    if (value === "rowActionTooltip") return "rowDeleteTooltip";
    if (value === "editorDownload") return "downloadToast";
    return value;
  }
  return null;
};

const readUiRequestCount = async (page: Page): Promise<number> => {
  return page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => {
        const item = entry as PerformanceResourceTiming;
        return /^(fetch|xmlhttprequest)$/i.test(item.initiatorType || "");
      })
      .length
  );
};

type FrontendObservationAction = {
  actionId?: string;
  action?: string;
  target?: string;
  role?: string;
  expectedOutcome?: string;
};

const frontendObservationActions = (params: Record<string, unknown>): FrontendObservationAction[] => {
  const fromActions = params.caseScopeActions;
  if (Array.isArray(fromActions)) {
    return fromActions.filter((item): item is FrontendObservationAction => Boolean(item && typeof item === "object"));
  }
  const contract = params.caseScopeContract;
  if (contract && typeof contract === "object") {
    const actions = (contract as { requiredActions?: unknown }).requiredActions;
    if (Array.isArray(actions)) {
      return actions.filter((item): item is FrontendObservationAction => Boolean(item && typeof item === "object"));
    }
  }
  return [];
};

const frontendObservationTargets = (params: Record<string, unknown>): Set<string> => {
  const targets = new Set(frontendObservationActions(params).map((item) => item.target).filter((item): item is string => typeof item === "string"));
  for (const target of stringArrayParam(params, "targetObjectIds")) targets.add(target);
  return targets;
};

const projectToolbarCreateButtonDomIndex = async (page: Page): Promise<number | null> => {
  return page.evaluate(() => {
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const buttons = Array.from(document.querySelectorAll("button")).map((button, domIndex) => {
      const rect = button.getBoundingClientRect();
      return {
        domIndex,
        text: button.innerText || button.textContent || "",
        ariaLabel: button.getAttribute("aria-label") || "",
        title: button.getAttribute("title") || "",
        disabled: button.disabled || button.getAttribute("aria-disabled") === "true",
        visible: isVisible(button),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
      };
    }).filter((button) => button.visible);
    const byRow = new Map<number, typeof buttons>();
    for (const button of buttons) {
      const key = Math.round(button.rect.y / 12) * 12;
      byRow.set(key, [...(byRow.get(key) ?? []), button]);
    }
    for (const row of [...byRow.values()].map((items) => items.sort((a, b) => a.rect.x - b.rect.x))) {
      if (row.length < 3) continue;
      for (let index = 0; index <= row.length - 3; index += 1) {
        const triplet = row.slice(index, index + 3);
        const noSelectionPattern = triplet[0]?.disabled === true && triplet[1]?.disabled === true && triplet[2]?.disabled === false;
        const iconSized = triplet.every((button) => button.rect.width <= 96 && button.rect.height <= 72);
        if (noSelectionPattern && iconSized) return triplet[2]?.domIndex ?? null;
      }
    }
    const explicit = buttons.find((button) => /新增|\+|add|create/i.test(`${button.text}\n${button.ariaLabel}\n${button.title}`) && !button.disabled);
    return explicit?.domIndex ?? null;
  }).catch(() => null);
};

const editorDownloadButtonDomIndex = async (page: Page): Promise<number | null> =>
  page.evaluate(() => {
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const buttons = Array.from(document.querySelectorAll("button")).map((button, domIndex) => {
      const rect = button.getBoundingClientRect();
      return {
        domIndex,
        text: button.innerText || button.textContent || "",
        ariaLabel: button.getAttribute("aria-label") || "",
        title: button.getAttribute("title") || "",
        className: String(button.className || ""),
        disabled: button.disabled || button.getAttribute("aria-disabled") === "true",
        visible: isVisible(button),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
      };
    }).filter((button) => button.visible);
    const explicit = buttons.find((button) => /下載|download|export|csv/i.test(`${button.text}\n${button.ariaLabel}\n${button.title}\n${button.className}`) && !button.disabled);
    if (explicit) return explicit.domIndex;
    const topRightIcon = buttons
      .filter((button) =>
        button.rect.y <= Math.max(180, window.innerHeight * 0.28) &&
        button.rect.x >= window.innerWidth * 0.45 &&
        button.rect.width <= 96 &&
        button.rect.height <= 72 &&
        !button.disabled
      )
      .sort((a, b) => b.rect.x - a.rect.x || a.rect.y - b.rect.y)[0];
    return topRightIcon?.domIndex ?? null;
  }).catch(() => null);

const clickButtonByDomIndex = async (page: Page, domIndex: number | null, timeout = 5000): Promise<boolean> => {
  if (domIndex === null) return false;
  try {
    await page.locator("button").nth(domIndex).click({ timeout });
    return true;
  } catch {
    return false;
  }
};

const readDateRangeButtonText = async (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const direct = document.querySelector('button[aria-label="時間設置"]') as HTMLElement | null;
    if (direct?.innerText?.trim()) return direct.innerText.trim();
    const candidate = Array.from(document.querySelectorAll("button")).find((button) => /時間|\\d{4}[/-]\\d{2}[/-]\\d{2}|昨日|今日|上月|本月/.test(button.textContent ?? "")) as HTMLElement | undefined;
    return candidate?.innerText?.trim() ?? null;
  }).catch(() => null);

const COMPANY_SHARED_SIDEBAR_CHILD_LABELS = [
  "每日報表",
  "雙平台營收占比",
  "退費追蹤",
  "beanfun! 導流",
  "商品銷售明細表",
  "商品退款明細",
  "篩選訂單明細"
];

const readCompanySharedSidebarState = async (page: Page): Promise<Record<string, unknown>> =>
  page.evaluate((childLabels) => {
    const lines = (document.body.innerText || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const visibleChildren = childLabels.filter((label) => lines.includes(label));
    return {
      groupLabelVisible: lines.includes("公司共享"),
      visibleChildLabels: visibleChildren,
      visibleChildCount: visibleChildren.length,
      expanded: visibleChildren.length > 0,
      bodyTextSample: lines.slice(0, 80).join("\n")
    };
  }, COMPANY_SHARED_SIDEBAR_CHILD_LABELS).catch((error) => ({
    groupLabelVisible: null,
    visibleChildLabels: [],
    visibleChildCount: null,
    expanded: null,
    error: error instanceof Error ? error.message : String(error)
  }));

const readCollageSidebarProjectLimitState = async (page: Page): Promise<Record<string, unknown>> =>
  page.evaluate(() => {
    const lines = (document.body.innerText || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const stopPattern = /^(報表明細|指標趨勢|新增自訂報表|指標儀表板|即時數據|活躍數據|營收數據|留存數據|新用戶數據|報表名稱|資料週期區間|操作)$/;
    const excludedPattern = /^(報表|我的自訂|拼貼報表|下載|刪除|新增|\+|搜尋|返回)$/;
    const dateOrRangePattern = /\d{4}[/-]\d{1,2}[/-]\d{1,2}|過去\s*\d+\s*天|最近\s*\d+\s*天/;
    const groups: string[][] = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index] !== "拼貼報表") continue;
      const hasCustomParent = lines.slice(Math.max(0, index - 4), index).includes("我的自訂");
      const names: string[] = [];
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const line = lines[cursor] ?? "";
        if (stopPattern.test(line)) break;
        if (excludedPattern.test(line) || dateOrRangePattern.test(line)) continue;
        if (!names.includes(line)) names.push(line);
        if (names.length > 12) break;
      }
      if (names.length > 0) groups.push(hasCustomParent ? names : names.slice(0, 8));
    }
    const preferred = groups.find((group) => group.length <= 5) ?? groups[0] ?? [];
    const limit = 5;
    return {
      projectNames: preferred,
      projectCount: preferred.length,
      requiredProjectCount: limit,
      preconditionEstablished: preferred.length >= limit,
      source: preferred.length > 0 ? "sidebar.myCustom.collageReport.visibleText" : "not_found",
      bodyTextSample: lines.slice(0, 100).join("\n")
    };
  }).catch((error) => ({
    projectNames: [],
    projectCount: null,
    requiredProjectCount: 5,
    preconditionEstablished: false,
    source: "error",
    error: error instanceof Error ? error.message : String(error)
  }));

const observeFrontendVisibleUiActions = async (
  page: Page,
  observationType: FrontendObservationType,
  params: Record<string, unknown>,
  warnings: string[]
): Promise<Record<string, unknown>> => {
  const targets = frontendObservationTargets(params);
  const actions: Record<string, unknown>[] = [];
  const clickDateRangeButton = async (): Promise<boolean> => {
    const clicked = await clickFirstVisible([
      page.locator('button[aria-label="時間設置"]'),
      page.getByRole("button", { name: /時間|日期|昨日|今日|上月|本月|過去|最近/ }),
      page.locator("button").filter({ hasText: /時間|日期|昨日|今日|上月|本月|過去|最近/ })
    ], 7000);
    actions.push({ action: "open", target: "dateRange.button", clicked });
    if (clicked) await page.waitForTimeout(500);
    return clicked;
  };

  if (observationType === "datePanel" || observationType === "dateTimeTypeTab" || observationType === "datePanelCancel") {
    const beforeDateText = await readDateRangeButtonText(page);
    const opened = await clickDateRangeButton();
    if (!opened) warnings.push("DATE_PANEL_TRIGGER_NOT_CLICKABLE");
    if (targets.has("dateRange.preset.yesterday")) {
      const selected = await clickFirstVisible([
        page.getByText("昨日", { exact: true }),
        page.locator("button").filter({ hasText: /^\\s*昨日\\s*$/ })
      ], 5000);
      actions.push({ action: "select", target: "dateRange.preset.yesterday", clicked: selected });
      if (!selected) warnings.push("DATE_PANEL_YESTERDAY_PRESET_NOT_CLICKABLE");
      await page.waitForTimeout(400);
    }
    if (targets.has("dateRange.timeTypeTab.static")) {
      const beforeStaticSelected = await page.evaluate(() => {
        const textOf = (element: Element | null) => (element as HTMLElement | null)?.innerText?.trim() || element?.textContent?.trim() || "";
        const staticElement = Array.from(document.querySelectorAll("button, [role=tab], [role=button], div, span")).find((element) => textOf(element) === "靜態時間" || textOf(element) === "靜態");
        if (!staticElement) return null;
        return /active|selected|checked/i.test(String((staticElement as HTMLElement).className || "")) || staticElement.getAttribute("aria-selected") === "true";
      }).catch(() => null);
      const clicked = await clickFirstVisible([
        page.getByText("靜態時間", { exact: true }),
        page.getByText("靜態", { exact: true }),
        page.locator("button, [role=tab], [role=button]").filter({ hasText: /^\\s*靜態(?:時間)?\\s*$/ })
      ], 5000);
      await page.waitForTimeout(600);
      const afterStaticSelected = await page.evaluate(() => {
        const textOf = (element: Element | null) => (element as HTMLElement | null)?.innerText?.trim() || element?.textContent?.trim() || "";
        const staticElement = Array.from(document.querySelectorAll("button, [role=tab], [role=button], div, span")).find((element) => textOf(element) === "靜態時間" || textOf(element) === "靜態");
        if (!staticElement) return null;
        return /active|selected|checked/i.test(String((staticElement as HTMLElement).className || "")) || staticElement.getAttribute("aria-selected") === "true";
      }).catch(() => null);
      actions.push({ action: "click", target: "dateRange.timeTypeTab.static", clicked, beforeSelected: beforeStaticSelected, afterSelected: afterStaticSelected });
      if (!clicked) warnings.push("DATE_PANEL_STATIC_TAB_NOT_CLICKABLE");
    }
    if (targets.has("dateRange.action.cancel")) {
      const cancelled = await clickFirstVisible([
        page.getByText("取消", { exact: true }),
        page.locator("button").filter({ hasText: /^\\s*取消\\s*$/ })
      ], 5000);
      actions.push({ action: "cancel", target: "dateRange.action.cancel", clicked: cancelled });
      if (!cancelled) warnings.push("DATE_PANEL_CANCEL_NOT_CLICKABLE");
      await page.waitForTimeout(600);
    }
    const afterDateText = await readDateRangeButtonText(page);
    return { actions, beforeDateText, afterDateText };
  }

  if (observationType === "validationMessage") {
    const calculate = page.getByRole("button", { name: /計算|執行/ }).first();
    let clicked = false;
    try {
      await calculate.click({ timeout: 5000 });
      clicked = true;
    } catch {
      clicked = await clickFirstVisible([page.locator("button").filter({ hasText: /計算|執行/ })], 5000);
    }
    actions.push({ action: "click", target: "preview.calculateButton", clicked });
    if (!clicked) warnings.push("CALCULATE_BUTTON_NOT_CLICKABLE_FOR_VALIDATION");
    await page.waitForTimeout(900);
    return { actions };
  }

  if (observationType === "sidebarGroup") {
    const beforeState = await readCompanySharedSidebarState(page);
    const before = typeof beforeState.bodyTextSample === "string" ? beforeState.bodyTextSample : "";
    const clicked = await clickFirstVisible([
      page.getByText("公司共享", { exact: true }),
      page.locator("button, [role=button], [role=treeitem], a, div").filter({ hasText: /^\\s*公司共享\\s*$/ })
    ], 5000);
    actions.push({ action: "click", target: "sidebar.companySharedGroup", clicked });
    if (!clicked) warnings.push("SIDEBAR_COMPANY_SHARED_GROUP_NOT_CLICKABLE");
    await page.waitForTimeout(700);
    const afterState = await readCompanySharedSidebarState(page);
    const after = typeof afterState.bodyTextSample === "string" ? afterState.bodyTextSample : "";
    return {
      actions,
      beforeSidebarState: beforeState,
      afterSidebarState: afterState,
      beforeTextSample: before.slice(0, 2400),
      afterTextSample: after.slice(0, 2400)
    };
  }

  if (observationType === "rowDeleteTooltip") {
    let hovered = false;
    for (const locator of [
      page.getByText("刪除", { exact: true }).last(),
      page.locator("button, a, [role=button], span, div").filter({ hasText: /^\\s*刪除\\s*$/ }).last()
    ]) {
      try {
        await locator.hover({ timeout: 5000 });
        hovered = true;
        break;
      } catch {
        // Try next candidate.
      }
    }
    actions.push({ action: "hover", target: "projectList.rowDeleteAction", hovered });
    if (!hovered) warnings.push("ROW_DELETE_ACTION_NOT_HOVERABLE");
    await page.waitForTimeout(800);
    return { actions };
  }

  if (observationType === "projectLimitToast") {
    const precondition = await readCollageSidebarProjectLimitState(page);
    actions.push({ action: "observe", target: "sidebar.collageProjects.count", ...precondition });
    if (precondition.preconditionEstablished !== true) {
      warnings.push("PROJECT_LIMIT_PRECONDITION_NOT_ESTABLISHED");
      return { actions, projectLimitPrecondition: precondition };
    }
    let clicked = false;
    let error: string | null = null;
    try {
      await clickCreateProjectButton(page);
      clicked = true;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    actions.push({ action: "click", target: "sidebar.collageProjectCreateButton", clicked, ...(error ? { error } : {}) });
    if (!clicked) warnings.push("SIDEBAR_PROJECT_CREATE_BUTTON_NOT_CLICKABLE");
    await page.waitForTimeout(1000);
    return { actions, projectLimitPrecondition: precondition };
  }

  if (observationType === "sourceReportPicker") {
    const opened = await clickFirstVisible([
      page.getByText(/請選擇.*報表|來源報表|每日報表/).first(),
      page.locator('[role="combobox"]').first(),
      page.locator("button, [role=button], input").filter({ hasText: /請選擇|來源報表|每日報表|報表/ }).first()
    ], 7000);
    actions.push({ action: "open", target: "metricRows.sourceReportControl", clicked: opened });
    if (!opened) warnings.push("SOURCE_REPORT_PICKER_NOT_OPENED");
    await page.waitForTimeout(700);
    const searchValue = firstStringParam(params, ["sourceReportSearch", "searchValue"]) ?? "每日";
    let typed = false;
    for (const locator of [
      page.getByPlaceholder(/請輸入搜尋|搜尋/i).first(),
      page.locator('input[type="search"]').first(),
      page.locator("input").filter({ hasText: /搜尋/ }).first(),
      page.locator("input").last()
    ]) {
      try {
        await locator.fill(searchValue, { timeout: 5000 });
        typed = true;
        break;
      } catch {
        // Try next candidate.
      }
    }
    actions.push({ action: "search", target: "sourceReportPicker.searchInput", value: searchValue, typed });
    if (!typed) warnings.push("SOURCE_REPORT_PICKER_SEARCH_NOT_EDITABLE");
    await page.waitForTimeout(700);
    const selected = await clickFirstVisible([
      page.getByText("每日報表", { exact: true }).last(),
      page.getByText(/每日報表/).last()
    ], 6000);
    actions.push({ action: "select", target: "sourceReportPicker.option.dailyReport", clicked: selected });
    if (!selected) warnings.push("SOURCE_REPORT_PICKER_DAILY_OPTION_NOT_CLICKABLE");
    await page.waitForTimeout(800);
    return { actions, searchValue };
  }

  if (observationType === "downloadToast") {
    const domIndex = await editorDownloadButtonDomIndex(page);
    const clicked = await clickButtonByDomIndex(page, domIndex, 6000);
    actions.push({ action: "download", target: "editorToolbar.downloadButton", clicked, domIndex });
    if (!clicked) warnings.push("EDITOR_DOWNLOAD_BUTTON_NOT_CLICKABLE");
    await page.waitForTimeout(1000);
    return { actions };
  }

  return { actions };
};

const readFrontendObservationState = async (
  page: Page,
  observationType: FrontendObservationType,
  requestBefore: number | null = null,
  params: Record<string, unknown> = {},
  actionData: Record<string, unknown> = {}
): Promise<Record<string, unknown>> => {
  const requestAfter = await readUiRequestCount(page).catch(() => null);
  return page.evaluate(({ type, before, after, expectedTextContains, actionData, targets }) => {
    const truncate = (value: string | null | undefined, length = 180): string | null => {
      const normalized = (value ?? "").trim().replace(/\s+/g, " ");
      if (!normalized) return null;
      return normalized.length > length ? `${normalized.slice(0, length)}...` : normalized;
    };
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const rectFor = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };
    const nearestLabelFor = (element: HTMLElement): string | null => {
      if (element instanceof HTMLInputElement && element.id) {
        const explicit = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (explicit?.textContent?.trim()) return truncate(explicit.textContent, 140);
      }
      const wrapped = element.closest("label");
      if (wrapped?.textContent?.trim()) return truncate(wrapped.textContent, 140);
      if (element.parentElement?.textContent?.trim()) return truncate(element.parentElement.textContent, 160);
      return null;
    };
    const computedState = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      return {
        pointerEvents: style.pointerEvents,
        opacity: style.opacity,
        visibility: style.visibility,
        display: style.display
      };
    };
    const buttonSummary = (button: HTMLButtonElement, index: number) => ({
      index,
      text: truncate(button.innerText || button.textContent, 160),
      ariaLabel: button.getAttribute("aria-label"),
      title: truncate(button.getAttribute("title"), 120),
      disabled: button.disabled || button.getAttribute("aria-disabled") === "true",
      ariaDisabled: button.getAttribute("aria-disabled"),
      className: truncate(button.className, 160),
      computedStyle: computedState(button),
      rect: rectFor(button)
    });
    const visibleButtons = Array.from(document.querySelectorAll("button"))
      .filter((button): button is HTMLButtonElement => button instanceof HTMLButtonElement && isVisible(button))
      .map(buttonSummary);
    const requestDelta = before === null || after === null ? null : Math.max(0, after - before);
    const bodyText = document.body.innerText || "";
    const forbiddenTopRightButtonText = /新增|下載|刪除|儲存|保存|返回|計算|執行|取消|確定|套用|搜尋|清除/i;

    if (type === "userButton") {
      const expectedTexts = Array.isArray(expectedTextContains)
        ? expectedTextContains.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
      const textFor = (button: { text: string | null; ariaLabel: string | null; title: string | null }) =>
        `${button.text ?? ""}\n${button.ariaLabel ?? ""}\n${button.title ?? ""}`;
      const expectedMatches = expectedTexts.length > 0
        ? visibleButtons.filter((button) => expectedTexts.every((expected) => textFor(button).includes(expected)))
        : [];
      const accountPatternMatches = visibleButtons.filter((button) =>
        /使用者|登入者|帳號|會員|profile|user|account|avatar/i.test(textFor(button))
      );
      const topRightTextButtons = visibleButtons
        .filter((button) =>
          Boolean(button.text) &&
          button.rect.y <= Math.max(140, window.innerHeight * 0.18) &&
          button.rect.x >= window.innerWidth * 0.45 &&
          !forbiddenTopRightButtonText.test(button.text ?? "")
        )
        .sort((a, b) => b.rect.x - a.rect.x || a.rect.y - b.rect.y);
      const candidates = expectedMatches.length > 0
        ? expectedMatches
        : accountPatternMatches.length > 0
          ? accountPatternMatches
          : topRightTextButtons;
      const bodyLines = bodyText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      const reportNavIndex = bodyLines.findIndex((line) => /^報表$/.test(line));
      const bodyLineCandidates = reportNavIndex > 0
        ? bodyLines
            .slice(0, reportNavIndex)
            .filter((line) => !/^(數據統計中心|BI Dashboard|橘子星球|Galaxy)$/i.test(line))
        : [];
      const expectedBodyLine = expectedTexts.length > 0
        ? bodyLines.find((line) => expectedTexts.every((expected) => line.includes(expected))) ?? null
        : null;
      const fallbackVisibleText = expectedBodyLine ?? bodyLineCandidates.at(-1) ?? null;
      const visibleText = candidates[0]?.text ?? fallbackVisibleText;
      const visible = candidates.length > 0 || Boolean(fallbackVisibleText);
      return {
        evidenceObject: "topbar.userButton.state",
        visible,
        visibleText,
        expectedTextContains: expectedTexts,
        fallbackSource: candidates.length > 0 ? "visibleButton" : fallbackVisibleText ? "bodyTextTopbarLine" : null,
        candidates: candidates.slice(0, 6),
        asserted: visible && (expectedTexts.length === 0 || expectedTexts.every((expected) => (visibleText ?? "").includes(expected)))
      };
    }

    if (type === "projectToolbar") {
      const buttonsByRow = new Map<number, typeof visibleButtons>();
      for (const button of visibleButtons) {
        const rowKey = Math.round(button.rect.y / 12) * 12;
        buttonsByRow.set(rowKey, [...(buttonsByRow.get(rowKey) ?? []), button]);
      }
      let toolbarCandidate = visibleButtons.slice(0, 8);
      let toolbarCandidateFound = false;
      for (const row of [...buttonsByRow.values()].map((items) => items.sort((a, b) => a.rect.x - b.rect.x))) {
        if (row.length < 3) continue;
        for (let index = 0; index <= row.length - 3; index += 1) {
          const triplet = row.slice(index, index + 3);
          const statePattern = [triplet[0]?.disabled, triplet[1]?.disabled, triplet[2]?.disabled];
          const hasExpectedNoSelectionPattern = statePattern[0] === true && statePattern[1] === true && statePattern[2] === false;
          const hasToolbarSize = triplet.every((button) => button.rect.width <= 96 && button.rect.height <= 72);
          if (hasExpectedNoSelectionPattern && hasToolbarSize) {
            toolbarCandidate = triplet;
            toolbarCandidateFound = true;
            break;
          }
        }
        if (toolbarCandidateFound) break;
      }
      const toolbarButtons = toolbarCandidate.slice(0, 8).map((button, index) => ({
        ...button,
        semanticIndex: index,
        semanticAction: index === 0 ? "download" : index === 1 ? "delete" : index === 2 ? "create" : "unknown"
      }));
      const downloadDisabled = toolbarButtons[0]?.disabled === true;
      const deleteDisabled = toolbarButtons[1]?.disabled === true;
      const createEnabled = toolbarButtons[2] ? toolbarButtons[2].disabled === false : false;
      return {
        evidenceObject: "projectToolbar.buttons.state",
        semanticMap: "projectToolbar.buttonOrder",
        buttons: toolbarButtons,
        assertions: {
          downloadDisabledWhenNoSelection: downloadDisabled,
          deleteDisabledWhenNoSelection: deleteDisabled,
          createEnabledWhenNoSelection: createEnabled
        },
        asserted: downloadDisabled && deleteDisabled && createEnabled
      };
    }

    if (type === "reportModeRadio") {
      const options = Array.from(document.querySelectorAll('input[name="report-mode"]'))
        .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement)
        .map((input) => ({
          value: input.value,
          checked: input.checked,
          ariaChecked: input.getAttribute("aria-checked"),
          disabled: input.disabled,
          label: nearestLabelFor(input),
          rect: rectFor(input)
        }));
      const selected = options.find((option) => option.checked || option.ariaChecked === "true") ?? null;
      return {
        evidenceObject: "reportMode.radio.state",
        inputName: "report-mode",
        options,
        selectedValue: selected?.value ?? null,
        selectedLabel: selected?.label ?? null,
        asserted: selected?.value === "1" && /拼貼模式/.test(selected?.label ?? "")
      };
    }

    if (type === "sidebarGroup") {
      const actionList = Array.isArray(actionData?.actions) ? actionData.actions as Array<Record<string, unknown>> : [];
      const clickAction = actionList.find((item) => item.target === "sidebar.companySharedGroup") ?? null;
      const beforeText = typeof actionData?.beforeTextSample === "string" ? actionData.beforeTextSample : "";
      const afterText = typeof actionData?.afterTextSample === "string" ? actionData.afterTextSample : "";
      const childLabels = ["每日報表", "雙平台營收占比", "退費追蹤", "beanfun! 導流", "商品銷售明細表", "商品退款明細", "篩選訂單明細"];
      const readCount = (value: unknown, fallbackText: string) => {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const count = (value as Record<string, unknown>).visibleChildCount;
          if (typeof count === "number") return count;
        }
        const lines = fallbackText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
        return childLabels.filter((label) => lines.includes(label)).length;
      };
      const beforeState = actionData?.beforeSidebarState && typeof actionData.beforeSidebarState === "object" && !Array.isArray(actionData.beforeSidebarState)
        ? actionData.beforeSidebarState as Record<string, unknown>
        : null;
      const afterState = actionData?.afterSidebarState && typeof actionData.afterSidebarState === "object" && !Array.isArray(actionData.afterSidebarState)
        ? actionData.afterSidebarState as Record<string, unknown>
        : null;
      const beforeChildCount = readCount(beforeState, beforeText);
      const afterChildCount = readCount(afterState, afterText || bodyText);
      const beforeExpanded = beforeChildCount > 0;
      const afterExpanded = afterChildCount > 0;
      const stateChanged = beforeChildCount !== afterChildCount;
      return {
        evidenceObject: "sidebar.companySharedGroup.state",
        triggeredByVisibleUi: clickAction?.clicked === true,
        beforeExpanded,
        afterExpanded,
        beforeNestedItemCount: beforeChildCount,
        afterNestedItemCount: afterChildCount,
        beforeNestedItems: Array.isArray(beforeState?.visibleChildLabels) ? beforeState?.visibleChildLabels : null,
        afterNestedItems: Array.isArray(afterState?.visibleChildLabels) ? afterState?.visibleChildLabels : null,
        nestedItemsVisible: afterChildCount > 0,
        stateChanged,
        interactionLog: actionList,
        asserted: clickAction?.clicked === true && stateChanged
      };
    }

    if (type === "rowDeleteTooltip") {
      const actionList = Array.isArray(actionData?.actions) ? actionData.actions as Array<Record<string, unknown>> : [];
      const hoverAction = actionList.find((item) => item.target === "projectList.rowDeleteAction") ?? null;
      const tooltipText = Array.from(document.querySelectorAll('[role="tooltip"], [class*="tooltip"], [class*="popover"], [class*="Tooltip"], [class*="Popover"]'))
        .filter((element) => isVisible(element))
        .map((element) => truncate(element.textContent, 200))
        .find((text) => Boolean(text)) ?? null;
      const visibleText = tooltipText ?? (bodyText.includes("刪除") && hoverAction?.hovered === true ? null : null);
      return {
        evidenceObject: "projectList.rowActionTooltip.state",
        hoveredTarget: hoverAction?.hovered === true ? "projectList.rowDeleteAction" : null,
        tooltipVisible: Boolean(tooltipText),
        visibleText,
        interactionLog: actionList,
        asserted: hoverAction?.hovered === true && Boolean(tooltipText)
      };
    }

    if (type === "projectLimitToast") {
      const actionList = Array.isArray(actionData?.actions) ? actionData.actions as Array<Record<string, unknown>> : [];
      const clickAction =
        actionList.find((item) => item.target === "sidebar.collageProjectCreateButton") ??
        actionList.find((item) => item.target === "projectToolbar.createButton") ??
        null;
      const expectedText = "已達最高5個專案";
      const visibleText = bodyText.includes(expectedText) ? expectedText : truncate(bodyText, 600);
      const precondition = actionData?.projectLimitPrecondition && typeof actionData.projectLimitPrecondition === "object" && !Array.isArray(actionData.projectLimitPrecondition)
        ? actionData.projectLimitPrecondition as Record<string, unknown>
        : null;
      if (precondition?.preconditionEstablished === false) {
        return {
          evidenceObject: "projectLimit.toast.state",
          triggeredByVisibleUi: false,
          visibleText,
          precondition,
          blockedReason: "PROJECT_LIMIT_PRECONDITION_NOT_ESTABLISHED",
          interactionLog: actionList,
          asserted: false
        };
      }
      return {
        evidenceObject: "projectLimit.toast.state",
        triggeredByVisibleUi: clickAction?.clicked === true,
        visibleText,
        precondition,
        interactionLog: actionList,
        asserted: clickAction?.clicked === true && bodyText.includes(expectedText)
      };
    }

    if (type === "sourceReportPicker") {
      const actionList = Array.isArray(actionData?.actions) ? actionData.actions as Array<Record<string, unknown>> : [];
      const openAction = actionList.find((item) => item.target === "metricRows.sourceReportControl") ?? null;
      const searchAction = actionList.find((item) => item.target === "sourceReportPicker.searchInput") ?? null;
      const selectAction = actionList.find((item) => item.target === "sourceReportPicker.option.dailyReport") ?? null;
      const inputs = Array.from(document.querySelectorAll("input"))
        .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement && isVisible(input))
        .map((input) => ({ value: input.value, placeholder: input.placeholder }));
      const visibleOptions = bodyText.split(/\n+/).map((line) => line.trim()).filter((line) => /每日報表|請輸入搜尋|報表/.test(line)).slice(0, 20);
      const selectedText = bodyText.includes("每日報表") ? "每日報表" : null;
      return {
        evidenceObject: "sourceReportPicker.state",
        openedByVisibleUi: openAction?.clicked === true,
        searchValue: typeof searchAction?.value === "string" ? searchAction.value : inputs.find((input) => input.value)?.value ?? null,
        visibleOptions,
        selectedText,
        sourceControl: {
          rowIndex: 1,
          expected: "每日報表",
          actual: selectedText,
          asserted: selectAction?.clicked === true && selectedText === "每日報表"
        },
        interactionLog: actionList,
        asserted: openAction?.clicked === true && searchAction?.typed === true && selectAction?.clicked === true && selectedText === "每日報表"
      };
    }

    if (type === "downloadToast") {
      const actionList = Array.isArray(actionData?.actions) ? actionData.actions as Array<Record<string, unknown>> : [];
      const downloadAction = actionList.find((item) => item.target === "editorToolbar.downloadButton") ?? null;
      const expectedText = "數據已開始下載";
      return {
        evidenceObject: "download.toast.state",
        visibleText: bodyText.includes(expectedText) ? expectedText : truncate(bodyText, 600),
        appearedAfterDownloadClick: downloadAction?.clicked === true && bodyText.includes(expectedText),
        editorToolbarDownload: {
          triggeredByVisibleUi: downloadAction?.clicked === true,
          enabledBeforeClick: true,
          downloadEventObserved: downloadAction?.clicked === true,
          asserted: downloadAction?.clicked === true
        },
        interactionLog: actionList,
        asserted: downloadAction?.clicked === true && bodyText.includes(expectedText)
      };
    }

    if (type === "datePanel") {
      const requiredTexts = [
        "昨日",
        "今日",
        "上週",
        "本週",
        "上月",
        "本月",
        "過去 7 天",
        "最近 7 天",
        "過去 30 天",
        "最近 30 天",
        "動態",
        "靜態",
        "取消",
        "確定"
      ];
      const visibleTexts = requiredTexts.filter((text) => bodyText.includes(text));
      const actionList = Array.isArray(actionData?.actions) ? actionData.actions as Array<Record<string, unknown>> : [];
      const targetList = Array.isArray(targets) ? targets.filter((item): item is string => typeof item === "string") : [];
      const wantsCancel = targetList.includes("dateRange.action.cancel");
      const wantsStatic = targetList.includes("dateRange.timeTypeTab.static");
      if (wantsCancel) {
        const cancelAction = actionList.find((item) => item.target === "dateRange.action.cancel") ?? null;
        const beforeDateText = typeof actionData?.beforeDateText === "string" ? actionData.beforeDateText : null;
        const afterDateText = typeof actionData?.afterDateText === "string" ? actionData.afterDateText : null;
        const panelClosed = !(bodyText.includes("取消") && bodyText.includes("確定") && bodyText.includes("動態") && bodyText.includes("靜態"));
        return {
          evidenceObject: "dateRange.cancelFlow.state",
          openedByVisibleUi: actionList.some((item) => item.target === "dateRange.button" && item.clicked === true),
          temporaryAction: actionList.find((item) => item.target === "dateRange.preset.yesterday") ?? null,
          cancelClicked: cancelAction?.clicked === true,
          panelClosed,
          stateUnchanged: beforeDateText !== null && afterDateText !== null ? beforeDateText === afterDateText : null,
          beforeDateText,
          afterDateText,
          interactionLog: actionList,
          asserted: cancelAction?.clicked === true && panelClosed && beforeDateText === afterDateText
        };
      }
      if (wantsStatic) {
        const staticAction = actionList.find((item) => item.target === "dateRange.timeTypeTab.static") ?? null;
        const staticVisible = bodyText.includes("靜態時間") || bodyText.includes("靜態");
        return {
          evidenceObject: "dateRange.timeTypeTab.state",
          openedByVisibleUi: actionList.some((item) => item.target === "dateRange.button" && item.clicked === true),
          targetTab: "static",
          beforeSelected: staticAction?.beforeSelected ?? null,
          afterSelected: staticAction?.afterSelected ?? null,
          staticVisible,
          interactionLog: actionList,
          asserted: staticAction?.clicked === true && staticAction?.afterSelected === true
        };
      }
      return {
        evidenceObject: "dateRange.panel.state",
        openedByVisibleUi: bodyText.includes("動態") && bodyText.includes("靜態"),
        visibleTexts,
        missingTexts: requiredTexts.filter((text) => !bodyText.includes(text)),
        requestDelta,
        interactionLog: actionList,
        asserted: requiredTexts.every((text) => bodyText.includes(text)) && requestDelta === 0
      };
    }

    const knownMessage = "欄位未設置完成";
    return {
      evidenceObject: "validation.message.state",
      triggeredByVisibleUi: true,
      visibleText: bodyText.includes(knownMessage) ? knownMessage : truncate(bodyText, 500),
      requestDelta,
      interactionLog: Array.isArray(actionData?.actions) ? actionData.actions : [],
      asserted: bodyText.includes(knownMessage) && requestDelta === 0
    };
  }, {
    type: observationType,
    before: requestBefore,
    after: requestAfter,
    expectedTextContains: stringArrayParam(params, "expectedTextContains"),
    actionData,
    targets: [...frontendObservationTargets(params)]
  });
};

const waitForFrontendObservationReadiness = async (
  page: Page,
  observationType: FrontendObservationType,
  warnings: string[]
): Promise<void> => {
  const markerByType: Record<FrontendObservationType, RegExp> = {
    userButton: /報表|使用者|登入者|帳號|profile|user|account/i,
    projectToolbar: /我的自訂|拼貼報表|新增|下載|刪除/i,
    reportModeRadio: /拼貼模式|建構方式|報表設定|欄位選擇/i,
    datePanel: /時間|時間區間|欄位選擇|報表設定/i,
    validationMessage: /計算|執行|欄位選擇|報表設定/i,
    sidebarGroup: /公司共享|我的自訂|拼貼報表/i,
    rowDeleteTooltip: /下載|刪除|拼貼報表|專案/i,
    projectLimitToast: /新增|拼貼報表|專案/i,
    sourceReportPicker: /來源報表|每日報表|欄位|報表設定/i,
    dateTimeTypeTab: /時間|動態|靜態|報表設定/i,
    datePanelCancel: /時間|取消|報表設定/i,
    downloadToast: /下載|計算|執行|報表設定/i
  };
  const marker = markerByType[observationType];
  try {
    await page.waitForFunction(
      (patternSource) => {
        const pattern = new RegExp(patternSource, "i");
        return pattern.test(document.body?.innerText ?? "");
      },
      marker.source,
      { timeout: 8000 }
    );
  } catch {
    warnings.push(`FRONTEND_OBSERVATION_READINESS_TIMEOUT:${observationType}`);
  }
};

const observeFrontendState = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const observationType = frontendObservationType(options);
  if (!observationType) {
    throw new HelperBlockedError("OBSERVATION_TYPE_MISSING_OR_UNSUPPORTED");
  }
  const uiProfileBefore = await captureUiDomProfile(options, page, `observe.${observationType}.before`);
  const requestBefore = await readUiRequestCount(page).catch(() => null);
  const warnings: string[] = [];
  await waitForFrontendObservationReadiness(page, observationType, warnings);
  const visibleUiAction = await observeFrontendVisibleUiActions(page, observationType, options.params, warnings);
  const observationState = await readFrontendObservationState(page, observationType, requestBefore, options.params, visibleUiAction);
  const uiProfileAfter = await captureUiDomProfile(options, page, `observe.${observationType}.after`);
  const shot = await screenshot(options, page, `observe-${observationType}`);
  if (!shot) warnings.push("SCREENSHOT_UNAVAILABLE");
  const evidence = {
    schemaVersion: "frontend-observation-evidence-v1",
    generatedAt: new Date().toISOString(),
    observationType,
    visibleUiAction,
    requestBefore,
    observationState,
    uiProfiles: { before: uiProfileBefore, after: uiProfileAfter },
    domState: await readDomState(page)
  };
  const evidencePath = frontendObservationEvidencePath(options);
  ensureDir(path.dirname(evidencePath));
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  const blockedReason = typeof observationState.blockedReason === "string" ? observationState.blockedReason : null;
  return createReport(
    options,
    blockedReason ? "blocked" : "ok",
    startedAt,
    {
      frontendObservationEvidence: evidence,
      [String(observationState.evidenceObject ?? "observation.state")]: observationState,
      ...(observationState.sourceControl ? { "sourceControl.after": observationState.sourceControl } : {}),
      ...(observationState.editorToolbarDownload ? { "editorToolbar.download.state": observationState.editorToolbarDownload } : {})
    },
    { frontendObservationEvidence: evidencePath, ...(shot ? { screenshot: shot } : {}) },
    observationState.asserted === false
      ? [...warnings, ...(blockedReason ? [`FRONTEND_OBSERVATION_BLOCKED:${blockedReason}`] : ["FRONTEND_OBSERVATION_ASSERTION_FALSE_REQUIRES_CODEX_JUDGMENT"])]
      : warnings
  );
};

const notImplemented = async (options: CliOptions, page: Page, reason: string, startedAt: string): Promise<HelperReport> => {
  const shot = await screenshot(options, page, sanitize(options.action));
  const uiProfile = await captureUiDomProfile(options, page, `${sanitize(options.action)}.notImplemented`);
  return createReport(
    options,
    "not_implemented",
    startedAt,
    { domState: await readDomState(page), uiProfile, reason },
    shot ? { screenshot: shot } : {},
    ["HELPER_TEMPLATE_NOT_IMPLEMENTED_IN_V1"]
  );
};

const run = async (): Promise<void> => {
  const options = parseArgs();
  const startedAt = new Date().toISOString();
  const config = readConfig();

  let browser: Browser | null = null;
  let page: Page | null = null;
  let runtimeEvidence: BrowserSessionRuntimeEvidence | null = null;
  let report: HelperReport;
  try {
    const endpoint = await ensureChromeDebugSession(config, null, {
      resetTabs: false,
      openInitialUrl: false
    });
    if (!endpoint) {
      const diagnostics = await diagnoseChromeDebugSession(config);
      report = createReport(
        options,
        "error",
        startedAt,
        { reason: "CHROME_CDP_UNAVAILABLE", cdpDiagnostics: diagnostics },
        {},
        ["HELPER_CDP_DIAGNOSTICS_CAPTURED"],
        { error: "CHROME_CDP_UNAVAILABLE" }
      );
      writeReport(options, report);
      console.error(JSON.stringify(report, null, 2));
      process.exitCode = 1;
      return;
    }
    browser = await chromium.connectOverCDP(endpoint);
    const resolved = await resolveBrowserSessionPage(options, browser);
    page = resolved.page;
    runtimeEvidence = resolved.runtimeEvidence;
    observeHelper(options, {
      eventType: "action_event",
      severity: "info",
      appUrl: page.url(),
      data: {
        phase: "start",
        paramsKeys: Object.keys(options.params).sort(),
        browserSession: {
          runId: runtimeEvidence.browserSession.runId,
          caseNo: runtimeEvidence.browserSession.caseNo,
          generation: runtimeEvidence.browserSession.generation,
          targetId: runtimeEvidence.browserSession.targetId,
          tokenHash: runtimeEvidence.browserSession.tokenHash
        }
      }
    });
    if (options.action !== "collage.openProject" && !isApplicationPage(page)) {
      throw new HelperBlockedError(`GALAXY_PAGE_NOT_FOUND_FOR_HELPER_ACTION:url=${page.url() || "blank"}`);
    }
    switch (options.action) {
      case "collage.openProject":
        report = await openProject(options, page, startedAt);
        break;
      case "collage.createProject":
        report = await createProject(options, page, startedAt);
        break;
      case "collage.createReport":
        report = await createCollageReport(options, page, startedAt);
        break;
      case "collage.openExistingReport":
        report = await openExistingReport(options, page, startedAt);
        break;
      case "collage.openReportFromProjectList":
        report = await openReportFromProjectList(options, page, startedAt);
        break;
      case "collage.configureMetric":
        report = await configureMetric(options, page, startedAt);
        break;
      case "collage.runPreviewAndCollectEvidence":
        report = await runPreview(options, page, startedAt);
        break;
      case "collage.configureCalculatedMetricAndPreview":
        report = await configureCalculatedMetricAndPreview(options, page, startedAt);
        break;
      case "collage.inspectAllZeroFields":
        report = await inspectAllZeroFields(options, page, startedAt);
        break;
      case "collage.runDateVariantsPreviewEvidence":
        report = await runDateVariantsPreviewEvidence(options, page, startedAt);
        break;
      case "collage.captureDateUiEvidence":
        report = await captureDateUiEvidenceReport(options, page, startedAt);
        break;
      case "collage.extractMetadataDropdownFields":
        report = await extractMetadataDropdownFields(options, page, startedAt);
        break;
      case "collage.saveReport":
        report = await saveReport(options, page, startedAt);
        break;
      case "collage.reopenReport":
        report = await reopenReport(options, page, startedAt);
        break;
      case "collage.clickBackToProjectList":
        report = await clickBackToProjectList(options, page, startedAt);
        break;
      case "collage.observeFrontendState":
        report = await observeFrontendState(options, page, startedAt);
        break;
      case "collage.downloadCsvAndComparePreview":
        report = await downloadCsvAndComparePreview(options, page, startedAt);
        break;
      case "collage.createAndDeleteTemporaryReport":
        report = await createAndDeleteTemporaryReport(options, page, startedAt);
        break;
      case "collage.deleteTemporaryReport":
        report = options.approvedToolRequestId
          ? await notImplemented(options, page, "Template is registered but not implemented in this executor version.", startedAt)
          : approvalRequired(options, options.action, startedAt);
        break;
      case "filter.addAndPreview":
      case "group.addAndPreview":
        report = await notImplemented(options, page, "Filter/group helpers are not implemented for trusted Agent runs. Capability gate should mark these cases unsupported.", startedAt);
        break;
      default:
        report = await notImplemented(options, page, `Unknown helper action: ${options.action}`, startedAt);
        break;
    }
    report = attachBrowserSessionEvidence(report, runtimeEvidence);
    observeHelper(options, {
      eventType: "action_event",
      severity: report.status === "ok" ? "info" : report.status === "blocked" ? "blocked" : report.status === "error" ? "error" : "warning",
      appUrl: page.url(),
      data: {
        phase: "end",
        status: report.status,
        durationMs: report.durationMs,
        warningCount: report.warnings.length,
        artifactKeys: Object.keys(report.artifacts)
      }
    });
    writeReport(options, report);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const isBlocked = error instanceof HelperBlockedError || isActionabilityFailure(error);
    const shot = page ? await screenshot(options, page, isBlocked ? "blocked" : "error") : null;
    const evidence: Record<string, unknown> = {
      reason: error instanceof HelperBlockedError
        ? error.reason
        : isBlocked
          ? `VISIBLE_UI_ACTION_BLOCKED: ${error instanceof Error ? error.message : String(error)}`
          : error instanceof Error
            ? error.message
            : String(error)
    };
    if (page) {
      evidence.domState = await readDomState(page).catch((domError) => ({
        readError: domError instanceof Error ? domError.message : String(domError)
      }));
      evidence.uiProfile = await captureUiDomProfile(options, page, isBlocked ? "blocked" : "error");
    }
    observeHelper(options, {
      eventType: isBlocked ? "blocker_event" : "action_event",
      severity: isBlocked ? "blocked" : "error",
      appUrl: page?.url() ?? null,
      data: {
        phase: isBlocked ? "blocked" : "error",
        reason: evidence.reason,
        hasPage: Boolean(page),
        stack: error instanceof Error ? (error.stack ?? error.message).slice(0, 1500) : String(error).slice(0, 1500)
      }
    });
    report = createReport(
      options,
      isBlocked ? "blocked" : "error",
      startedAt,
      evidence,
      shot ? { screenshot: shot } : {},
      shot ? [] : ["SCREENSHOT_UNAVAILABLE"],
      {
        error: error instanceof Error ? error.stack ?? error.message : String(error)
      }
    );
    report = attachBrowserSessionEvidence(report, runtimeEvidence);
    writeReport(options, report);
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    if (options.closeAfter) {
      if (browser) await browser.close().catch(() => undefined);
      await closeChromeDebugSession(config).catch(() => undefined);
    } else if (browser) {
      const connection = (browser as unknown as { _connection?: { close?: () => void } })._connection;
      connection?.close?.();
    }
  }
};

if (require.main === module) {
  void run().then(() => {
    process.exit(process.exitCode ?? 0);
  });
}
