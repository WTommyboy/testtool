import fs from "node:fs";
import path from "node:path";
import type { CaseManifestCase } from "./case-manifest";
import type { HelperHints } from "./helper-hints";
import { detectCaseFeatures } from "./case-feature-detection";

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
  const unsupportedFeatures: string[] = [];
  const supportedHelperTemplates: string[] = [];
  const params = paramsObject(helperHints);
  const noSave = helperRequestsNoSave(params);
  const explicitlyNoReopen =
    helperRequestsNoReopen(params) ||
    /不(?:需|要|應)?重開|不要重開|無需重開|不用重開|不重開\s*editor|不應產生\s*reopen/i.test(text);

  if (mode === "record") unsupportedFeatures.push("record_mode_helper_not_supported");
  if (mode === "metric") unsupportedFeatures.push("metric_mode_helper_not_supported");
  if (hasFilter) unsupportedFeatures.push("filter_helper_not_implemented");
  if (hasGroup) unsupportedFeatures.push("group_helper_not_implemented");

  if (mode === "collage" && !hasFilter && !hasGroup && isMetadataDropdown) {
    supportedHelperTemplates.push(
      "collage.openProject",
      "collage.createReport",
      "collage.extractMetadataDropdownFields"
    );
  } else if (mode === "collage" && !hasFilter && !hasGroup) {
    supportedHelperTemplates.push(
      "collage.openProject",
      "collage.createReport",
      "collage.configureMetric",
      "collage.runPreviewAndCollectEvidence"
    );
    if (/修改既有|既有報表|已儲存報表|儲存覆寫|覆寫/.test(text)) supportedHelperTemplates.push("collage.openExistingReport");
    if (!noSave && /儲存|覆寫/.test(text)) supportedHelperTemplates.push("collage.saveReport");
    if (!explicitlyNoReopen && /重開|重新檢視|還原|載入/.test(text)) supportedHelperTemplates.push("collage.reopenReport");
    if (/下載|CSV/i.test(text)) supportedHelperTemplates.push("collage.downloadCsvAndComparePreview");
  }

  let supportStatus: CapabilityGateReport["supportStatus"] = "degraded";
  let executionMode: CapabilityGateReport["executionMode"] = "codex_visible_ui";
  let helperPreRunAllowed = false;
  let blockingReason: string | null = null;

  if (unsupportedFeatures.length > 0 || (automationLevel === "blocked_if_no_helper" && supportedHelperTemplates.length === 0)) {
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

  const codexInstruction = supportStatus === "unsupported"
    ? "Do not execute trusted browser testcase steps for this case. Write a single-case BLOCKED result with fail_category=UNSUPPORTED_ONLINE_CAPABILITY and detail_json.blocked_reason from this capability gate."
    : supportStatus === "supported"
      ? "Use helper pre-run evidence when status=ok and matching this case; continue with visible UI only for incomplete evidence. Codex still judges PASS/FAIL/BLOCKED."
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
