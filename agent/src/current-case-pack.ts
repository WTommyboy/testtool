import fs from "node:fs";
import path from "node:path";
import type { CaseManifestCase, CaseManifestResult } from "./case-manifest";
import { findHelperHints, type HelperHints } from "./helper-hints";
import { inferCaseScope } from "./case-scope";

type EvidenceTemplateId =
  | "metadata-dropdown"
  | "network-request"
  | "chart-datasets"
  | "downloaded-csv"
  | "ui-workflow";

const textBlob = (item: CaseManifestCase): string =>
  [
    item.groupId,
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
  if (includesAny(blob, [
    /metadata.{0,40}(對照|一致|規範|比對|compare)/i,
    /(欄位清單|欄位數|可選欄位|下拉|dropdown|picker).{0,40}(metadata|對照|一致|規範|比對|compare)/i,
    /(metadata|對照|一致|規範|比對|compare).{0,40}(欄位清單|欄位數|可選欄位|下拉|dropdown|picker)/i
  ])) {
    templates.add("metadata-dropdown");
  }
  if (includesAny(blob, ["request", "response", "network", "api", "dateRange", "filter", "篩選", "request body"])) {
    templates.add("network-request");
  }
  if (includesAny(blob, ["chart", "圖表", "datasets", "筆數", "sum", "max", "min", "平均", "趨勢"])) {
    templates.add("chart-datasets");
  }
  if (includesAny(blob, ["csv", "下載", "download", "匯出", "downloaded csv"])) {
    templates.add("downloaded-csv");
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
  if (templates.includes("downloaded-csv")) {
    evidence.add("UI-triggered downloaded CSV file path/source and suggested filename");
    evidence.add("CSV header, row count, and numeric summary");
    evidence.add("preview table/chart vs CSV comparison, or not-reached reason when an earlier required workflow subcondition failed");
  }
  if (templates.includes("ui-workflow")) {
    evidence.add("before-state snapshot/DOM read");
    evidence.add("after-action DOM/network evidence");
    evidence.add("Tool Bridge request/response id for native dialog or irreversible operation");
  }
  return [...evidence];
};

const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];

const inferRuleKeys = (
  item: CaseManifestCase | null,
  helperHints: HelperHints | null,
  requiredEvidence: string[]
): string[] => {
  const keys = new Set<string>([
    "document-consistency",
    "preflight-auth-check",
    "current-case",
    "current-case-pack",
    "current-case-pack-json",
    "run-state",
    "evidence-policy",
    "codex-runtime",
    "artifacts-and-results"
  ]);

  const riskLevel = item?.riskLevel ?? "";
  const testTarget = item?.testTarget ?? "";
  const operationTemplate = helperHints?.operationTemplate ?? "";
  if (helperHints) keys.add("bi-ui-helper-guidance");
  if (requiredEvidence.some((evidence) => evidence.startsWith("network."))) keys.add("network-observation-guidance");
  if (requiredEvidence.includes("toolBridge.response") || /刪除|修改|建立/.test(riskLevel)) keys.add("tool-bridge");
  if (/metadata|dropdown/i.test(operationTemplate) || /metadata|欄位清單|可選欄位/.test(textBlob(item ?? ({} as CaseManifestCase)))) {
    keys.add("reference-index");
    keys.add("bi-rule-BI系統_metadata摘要");
  }
  if (/csv|download|下載|匯出/i.test(`${operationTemplate}\n${JSON.stringify(item ?? {})}`)) {
    keys.add("reference-index");
    keys.add("evidence-template-index");
    keys.add("bi-ui-helper-guidance");
  }
  if (/TAG_TOOL|玩家標籤管理|標籤變數設定|人工標籤|條件標籤|子標籤|CSV|tagTool\./i.test(`${operationTemplate}\n${JSON.stringify(item ?? {})}`)) {
    keys.add("domain-ui-contract");
    keys.add("domain-ui-object-vocabulary");
    keys.add("domain-evidence-schema");
    keys.add("domain-action-tag-list");
    keys.add("domain-action-create-condition-tag");
    keys.add("domain-action-manual-upload");
    keys.add("domain-action-tag-variable-settings");
    keys.add("domain-action-dangerous-actions");
  }
  if (/前端呈現|前後端整合|功能流程/.test(testTarget)) keys.add("bi-project-agents-full");
  return [...keys];
};

const inferMustReadRuleKeys = (
  item: CaseManifestCase | null,
  helperHints: HelperHints | null,
  requiredEvidence: string[],
  templates: EvidenceTemplateId[]
): string[] => {
  const keys = new Set<string>([
    "current-case",
    "current-case-pack",
    "current-case-pack-json",
    "capability-gate",
    "run-state",
    "evidence-policy",
    "artifacts-and-results",
    "codex-runtime",
    "platform-skill",
    "domain-routing",
    "bi-project-agents-full",
    "bi-rule-BI測試標準_共通方法論",
    "bi-rule-BI測試_系統背景知識",
    "bi-rule-BI系統_metadata摘要"
  ]);
  const operationTemplate = helperHints?.operationTemplate ?? "";
  const caseText = JSON.stringify(item ?? {});

  if (helperHints || operationTemplate || templates.includes("ui-workflow") || templates.includes("downloaded-csv")) {
    keys.add("helper-execution-plan");
    keys.add("helper-execution-plan-json");
    keys.add("helper-protocol");
    keys.add("bi-ui-helper-guidance");
  }
  if (requiredEvidence.some((item) => item.startsWith("network."))) {
    keys.add("network-observation-guidance");
  }
  if (item && inferCaseScope(item, helperHints).caseScopeContract) {
    keys.add("domain-case-scope-contracts");
    keys.add("domain-ui-object-vocabulary");
    keys.add("domain-action-observe-frontend-state");
  }
  if (/TAG_TOOL|玩家標籤管理|標籤變數設定|人工標籤|條件標籤|子標籤|CSV|tagTool\./i.test(`${operationTemplate}\n${caseText}`)) {
    keys.add("domain-ui-contract");
    keys.add("domain-ui-object-vocabulary");
    keys.add("domain-evidence-schema");
    keys.add("domain-action-tag-list");
    keys.add("domain-action-create-condition-tag");
    keys.add("domain-action-manual-upload");
    keys.add("domain-action-tag-variable-settings");
    keys.add("domain-action-dangerous-actions");
    keys.add("tool-bridge");
  }
  if (/儲存|覆寫|重開|重新檢視|刪除|confirm|alert/i.test(caseText) || requiredEvidence.includes("toolBridge.response")) {
    keys.add("tool-bridge");
  }
  if (templates.includes("metadata-dropdown") || /metadata|dropdown/i.test(operationTemplate)) {
    keys.add("reference-index");
    keys.add("bi-rule-BI系統_metadata摘要");
    keys.add("bi-project-agents-full");
  }
  if (templates.includes("downloaded-csv") || /csv|download|下載|匯出/i.test(`${operationTemplate}\n${caseText}`)) {
    keys.add("reference-index");
    keys.add("evidence-template-index");
    keys.add("bi-ui-helper-guidance");
  }
  return [...keys];
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
  documentConsistencyPath: string,
  helperHintSourcePaths: string[] = []
): { jsonPath: string; markdownPath: string; helperHints: HelperHints | null; helperWarnings: string[] } => {
  const currentCase = readCurrentCase(caseManifest);
  const templates = currentCase ? inferEvidenceTemplates(currentCase) : [];
  const inferredRequiredEvidence = currentCase ? inferRequiredEvidence(templates) : [];
  const helperSearch = currentCase
    ? findHelperHints(helperHintSourcePaths, currentCase.caseNo, runDir)
    : { helperHints: null, searchedPaths: [], warnings: [] };
  const helperHints = helperSearch.helperHints;
  const caseScope = currentCase ? inferCaseScope(currentCase, helperHints) : null;
  const explicitRequiredEvidence = helperHints?.requiredEvidence ?? [];
  const requiredEvidence = unique([...inferredRequiredEvidence, ...explicitRequiredEvidence, ...(caseScope?.requiredEvidence ?? [])]);
  const screenshotPolicy = currentCase ? inferScreenshotPolicy(templates, currentCase) : "unavailable";
  const recommendedRuleKeys = inferRuleKeys(currentCase, helperHints, requiredEvidence);
  const mustReadRuleKeys = inferMustReadRuleKeys(currentCase, helperHints, requiredEvidence, templates);
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
    helperHints: helperHints
      ? {
          found: true,
          sourcePath: helperHints.sourceRelativePath ?? helperHints.sourcePath,
          caseId: helperHints.caseId,
          automationLevel: helperHints.automationLevel,
          operationTemplate: helperHints.operationTemplate,
          params: helperHints.params,
          requiredEvidence: helperHints.requiredEvidence,
          forbiddenAutomation: helperHints.forbiddenAutomation,
          aiDecisionRequired: helperHints.aiDecisionRequired,
          warnings: helperHints.warnings
        }
      : {
          found: false,
          searchedPaths: helperSearch.searchedPaths.map((item) => path.relative(runDir, item).replaceAll(path.sep, "/")),
          warnings: helperSearch.warnings
        },
    evidenceTemplates: templates,
    inferredRequiredEvidence,
    explicitRequiredEvidence,
    caseScope: caseScope
      ? {
          testIntent: caseScope.testIntent,
          previewRequired: caseScope.previewRequired,
          executionRequired: caseScope.executionRequired,
          requiredEvidence: caseScope.requiredEvidence,
          caseScopeContract: caseScope.caseScopeContract
        }
      : null,
    requiredEvidence,
    screenshotPolicy,
    mustReadRuleKeys,
    recommendedRuleKeys,
    executionRequirement:
      "Plan 完成不代表 case 完成。必須執行所有 required action 並 capture 對應 required evidence，結果與 expected 比對後才能寫 result。"
  };

  const helperHintMarkdown = helperHints
    ? [
        "## Helper Hints",
        "",
        "Helper hints 是單題 UI 操作輔助，不是授權、不是 PASS/FAIL 判定來源；若與 xlsx 步驟或預期衝突，以 xlsx 為準。",
        "",
        `- source: ${helperHints.sourceRelativePath ?? helperHints.sourcePath}`,
        `- automationLevel: ${helperHints.automationLevel ?? "(missing)"}`,
        `- operationTemplate: ${helperHints.operationTemplate ?? "(missing)"}`,
        `- aiDecisionRequired: ${helperHints.aiDecisionRequired === null ? "(missing)" : String(helperHints.aiDecisionRequired)}`,
        helperHints.warnings.length > 0 ? `- warnings: ${helperHints.warnings.join(", ")}` : "- warnings: none",
        "",
        "### Params",
        "",
        "```json",
        JSON.stringify(helperHints.params ?? {}, null, 2),
        "```",
        "",
        "### Explicit Required Evidence",
        "",
        explicitRequiredEvidence.length > 0 ? explicitRequiredEvidence.map((item) => `- ${item}`).join("\n") : "- (none)",
        ""
      ].join("\n")
    : [
        "## Helper Hints",
        "",
        "未找到本題 Helper hints；本 pack 使用 xlsx row 與關鍵字推斷 evidence templates。不得因此臨時改寫成批次腳本。",
        helperSearch.warnings.length > 0 ? `\nWarnings: ${helperSearch.warnings.join(", ")}` : "",
        ""
      ].join("\n");

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
      `- group_id: ${currentCase?.groupId ?? "(unavailable)"}`,
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
      helperHintMarkdown,
      "",
      "## Required Evidence",
      "",
      requiredEvidence.length > 0 ? requiredEvidence.map((item) => `- ${item}`).join("\n") : "- (unavailable)",
      "",
      "## Must Read Rule Keys",
      "",
      mustReadRuleKeys.map((item) => `- ${item}`).join("\n"),
      "",
      "## Recommended Rule Keys",
      "",
      recommendedRuleKeys.map((item) => `- ${item}`).join("\n"),
      "",
      "## Execution Requirement",
      "",
      "Plan 完成不代表 case 完成。必須執行 UI/觀察、取得 current-run evidence、寫入單一 case 結果,才可進下一題。",
      ""
    ].join("\n")
  );

  return { jsonPath, markdownPath, helperHints, helperWarnings: [...helperSearch.warnings, ...(helperHints?.warnings ?? [])] };
};
