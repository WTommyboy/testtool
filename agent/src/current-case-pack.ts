import fs from "node:fs";
import path from "node:path";
import type { CaseManifestCase, CaseManifestResult } from "./case-manifest";

type EvidenceTemplateId =
  | "metadata-dropdown"
  | "network-request"
  | "chart-datasets"
  | "ui-workflow";

const textBlob = (item: CaseManifestCase): string =>
  [
    item.groupName,
    item.caseNo,
    item.caseTitle,
    item.testType,
    item.executionMethod,
    item.riskLevel,
    item.testTarget,
    item.cleanupChecklist,
    item.preconditions,
    item.stepsSummary,
    item.expected,
    item.validationMethod
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

const includesAny = (value: string, patterns: Array<string | RegExp>): boolean =>
  patterns.some((pattern) => (typeof pattern === "string" ? value.includes(pattern.toLowerCase()) : pattern.test(value)));

const inferEvidenceTemplates = (item: CaseManifestCase): EvidenceTemplateId[] => {
  const blob = textBlob(item);
  const templates = new Set<EvidenceTemplateId>();
  if (includesAny(blob, ["metadata", "欄位清單", "欄位數", "可選欄位", "下拉", "dropdown", "picker"])) {
    templates.add("metadata-dropdown");
  }
  if (includesAny(blob, ["request", "response", "network", "api", "dateRange", "filter", "篩選", "request body"])) {
    templates.add("network-request");
  }
  if (includesAny(blob, ["chart", "圖表", "datasets", "筆數", "sum", "max", "min", "平均", "趨勢"])) {
    templates.add("chart-datasets");
  }
  if (includesAny(blob, ["建立", "儲存", "重開", "重新檢視", "刪除", "修改", "流程", "confirm", "alert", "報表"])) {
    templates.add("ui-workflow");
  }
  if (templates.size === 0) templates.add("ui-workflow");
  return [...templates];
};

const inferScreenshotPolicy = (templates: EvidenceTemplateId[], item: CaseManifestCase): string => {
  const blob = textBlob(item);
  if (includesAny(blob, ["bug", "fail", "失敗", "刪除", "儲存", "confirm", "alert", "重開"])) {
    return "required_if_possible: use screenshot for Tool Bridge, failure/bug, irreversible operation, and final workflow evidence. If screenshot times out, record screenshot_unavailable_reason.";
  }
  if (templates.includes("metadata-dropdown")) {
    return "optional_structured_first: DOM extraction and count comparison are primary evidence. Screenshot is supplementary and must not block when structured evidence is sufficient.";
  }
  return "structured_first: prefer DOM/network/chart evidence; take screenshot only at major state transitions or final evidence when useful.";
};

const inferRequiredEvidence = (templates: EvidenceTemplateId[]): string[] => {
  const evidence = new Set<string>();
  if (templates.includes("metadata-dropdown")) {
    evidence.add("visible dropdown/source group DOM extraction");
    evidence.add("actual selectable field list and count");
    evidence.add("metadata/reference expected list or count");
    evidence.add("normalization notes for field naming differences");
  }
  if (templates.includes("network-request")) {
    evidence.add("UI action that triggered the request");
    evidence.add("request URL/method timestamp");
    evidence.add("request body fields relevant to this case");
    evidence.add("response status and result summary when accessible");
  }
  if (templates.includes("chart-datasets")) {
    evidence.add("chart/table DOM or read-only Chart.js data");
    evidence.add("numeric summary needed for the testcase");
    evidence.add("baseline/current-run comparison when the testcase requires it");
  }
  if (templates.includes("ui-workflow")) {
    evidence.add("before-state snapshot/DOM read");
    evidence.add("after-action DOM/network evidence");
    evidence.add("Tool Bridge request/response id for native dialog or irreversible operation");
  }
  return [...evidence];
};

const readCurrentCase = (caseManifest: CaseManifestResult): CaseManifestCase | null => {
  if (!caseManifest.currentCasePath || !fs.existsSync(caseManifest.currentCasePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(caseManifest.currentCasePath, "utf8")) as CaseManifestCase;
  } catch {
    return null;
  }
};

export const writeCurrentCasePack = (
  runDir: string,
  caseManifest: CaseManifestResult,
  documentConsistencyPath: string
): { jsonPath: string; markdownPath: string } => {
  const currentCase = readCurrentCase(caseManifest);
  const templates = currentCase ? inferEvidenceTemplates(currentCase) : [];
  const requiredEvidence = currentCase ? inferRequiredEvidence(templates) : [];
  const screenshotPolicy = currentCase ? inferScreenshotPolicy(templates, currentCase) : "unavailable";
  const jsonPath = path.join(runDir, "input", "current-case-pack.json");
  const markdownPath = path.join(runDir, "input", "current-case-pack.md");

  const pack = {
    schemaVersion: "current-case-pack-v1",
    generatedAt: new Date().toISOString(),
    policy: [
      "This pack is a plan card, not a result.",
      "A PASS/FAIL/BLOCKED result requires executing the current case and capturing current-run evidence.",
      "Do not use this pack to skip UI execution.",
      "Do not read or execute another case until this case has evidence and a result write."
    ],
    documentConsistencyPath,
    currentCase,
    evidenceTemplates: templates,
    requiredEvidence,
    screenshotPolicy,
    executionRequirement:
      "Plan 完成不代表 case 完成。必須執行所有 required action 並 capture 對應 required evidence，結果與 expected 比對後才能寫 result。"
  };

  fs.writeFileSync(jsonPath, `${JSON.stringify(pack, null, 2)}\n`);
  fs.writeFileSync(
    markdownPath,
    [
      "# Current Case Pack v1",
      "",
      "本檔是目前 case 的輕量執行卡,不是結果。",
      "",
      `- case_no: ${currentCase?.caseNo ?? "(unavailable)"}`,
      `- title: ${currentCase?.caseTitle ?? "(unavailable)"}`,
      `- group: ${currentCase?.groupName ?? "(unavailable)"}`,
      `- risk_level: ${currentCase?.riskLevel ?? "(unavailable)"}`,
      `- test_target: ${currentCase?.testTarget ?? "(unavailable)"}`,
      `- cleanup_checklist: ${currentCase?.cleanupChecklist ?? "(unavailable)"}`,
      `- evidence_templates: ${templates.join(", ") || "(none)"}`,
      `- screenshot_policy: ${screenshotPolicy}`,
      "",
      "## Steps Summary",
      "",
      currentCase?.stepsSummary ?? "(missing)",
      "",
      "## Expected",
      "",
      currentCase?.expected ?? "(missing)",
      "",
      "## Required Evidence",
      "",
      requiredEvidence.length > 0 ? requiredEvidence.map((item) => `- ${item}`).join("\n") : "- (unavailable)",
      "",
      "## Execution Requirement",
      "",
      "Plan 完成不代表 case 完成。必須執行 UI/觀察、取得 current-run evidence、寫入單一 case 結果,才可進下一題。",
      ""
    ].join("\n")
  );

  return { jsonPath, markdownPath };
};
