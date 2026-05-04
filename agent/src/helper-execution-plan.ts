import fs from "node:fs";
import path from "node:path";
import type { CaseManifestCase } from "./case-manifest";
import type { HelperHints } from "./helper-hints";
import { detectCaseFeatures, isNeutralCleanupTarget, parseCleanupTargets } from "./case-feature-detection";

export type HelperPlanAction = {
  id: string;
  template: string;
  title: string;
  params: Record<string, unknown>;
  mutatesUi: boolean;
  requiresToolBridge: boolean;
  optional: boolean;
  canJudgeResult: false;
  requiredEvidence: string[];
  screenshotPolicy: "major_step" | "required_if_possible" | "failure_only";
  notes: string[];
};

export type HelperExecutionPlan = {
  schemaVersion: "helper-execution-plan-v1";
  generatedAt: string;
  caseId: string | null;
  mode: "single_case_helper_assisted_uat";
  executor: {
    kind: "mac-agent-playwright-cdp";
    command: string;
    reportPath: string;
    artifactRoot: string;
  };
  policy: string[];
  safety: {
    helperMayWriteResultXlsx: false;
    helperMayJudgePassFail: false;
    helperMayRunMultipleCases: false;
    helperMayUseDirectBiApi: false;
    helperMayUseInternalJsSetter: false;
    helperMayBypassActionabilityCheck: false;
    codexMustJudgeResult: true;
  };
  helperHints: {
    found: boolean;
    operationTemplate: string | null;
    automationLevel: string | null;
    aiDecisionRequired: boolean | null;
  };
  actions: HelperPlanAction[];
  availableTemplates: HelperPlanAction[];
};

type WriteHelperExecutionPlanOptions = {
  runDir: string;
  currentCase: CaseManifestCase | null;
  helperHints: HelperHints | null;
};

const textBlob = (item: CaseManifestCase | null): string =>
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
    item?.validationMethod
  ]
    .filter(Boolean)
    .join("\n");

const firstMatch = (text: string, patterns: RegExp[]): string | null => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return null;
};

const paramsObject = (helperHints: HelperHints | null): Record<string, unknown> => {
  return helperHints?.params && typeof helperHints.params === "object" && !Array.isArray(helperHints.params)
    ? (helperHints.params as Record<string, unknown>)
    : {};
};

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

const nonNeutral = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed || isNeutralCleanupTarget(trimmed)) return null;
  return trimmed;
};

const helperScope = (params: Record<string, unknown>): string | null => stringParam(params, ["scope", "executionScope", "helperScope"]);

const helperRequestsPreviewOnly = (params: Record<string, unknown>): boolean =>
  /^(preview_only|preview-only|preview|d0|d0_only|d0-only)$/i.test(helperScope(params) ?? "");

const helperRequestsNoSave = (params: Record<string, unknown>): boolean =>
  helperRequestsPreviewOnly(params) || booleanishParam(params, ["skipSave", "doNotSave", "noSave", "previewOnly"]);

const helperRequestsNoReopen = (params: Record<string, unknown>): boolean =>
  helperRequestsPreviewOnly(params) || booleanishParam(params, ["skipReopen", "doNotReopen", "noReopen", "previewOnly"]);

const cleanReportNamePattern = (value: string | null): string | null => {
  if (!value) return null;
  const cleaned = value.replace(/[)）]\s*$/, "").trim();
  return cleaned || null;
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

const inferReportNamePattern = (text: string, params: Record<string, unknown>): string | null =>
  cleanReportNamePattern(
    stringParam(params, ["reportName", "reportNamePattern"]) ??
      firstMatch(text, [/報表名[：:]\s*([^\n]+)/, /報表名稱[：:]\s*([^\n]+)/, /(TOOL_[A-Z]\d{2}_<timestamp>)/i, /(TOOL_[A-Z]\d{2}_[A-Za-z0-9_-]+)/i])
  );

const inferExistingReportNamePattern = (text: string, params: Record<string, unknown>, fallbackReportNamePattern: string | null): string | null =>
  cleanReportNamePattern(
    stringParam(params, ["existingReportName", "existingReportNamePattern", "savedReportName"]) ??
      firstMatch(text, [/(TOOL_A01_<timestamp>)/i, /(TOOL_A01_[A-Za-z0-9_-]+)/i, /(TOOL_[A-Z]\d{2}_<timestamp>)/i]) ??
      fallbackReportNamePattern
  );

const inferCollageParams = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): Record<string, unknown> => {
  const text = textBlob(currentCase);
  const cleanup = parseCleanupTargets(currentCase?.cleanupChecklist);
  const params = paramsObject(helperHints);
  const field =
    nonNeutral(stringParam(params, ["field", "metric", "metricField"])) ??
    nonNeutral(cleanup["欄位"]) ??
    nonNeutral(firstMatch(text, [/欄位[「=：: ]+([^」\n,，;；]+)/]));
  const fields = splitCompositeMetricFields(field);
  const reportNamePattern = inferReportNamePattern(text, params);
  const modifiesExistingReport = /修改既有|既有報表|已儲存報表|儲存覆寫|覆寫/.test(text);
  const existingReportNamePattern = inferExistingReportNamePattern(text, params, reportNamePattern);
  const dateRangeText =
    nonNeutral(stringParam(params, ["dateRange", "timeRange"])) ??
    nonNeutral(cleanup["時間"]) ??
    firstMatch(text, [/(\d{4}\/\d{2}\/\d{2}\s*[~～-]\s*\d{4}\/\d{2}\/\d{2})/]);

  return {
    devUrl: stringParam(params, ["devUrl"]) ?? null,
    projectName: stringParam(params, ["projectName", "project"]) ?? firstMatch(text, [/(拼貼test[_\d]+)/i]),
    source: stringParam(params, ["source", "sourceReport"]) ?? firstMatch(text, [/來源報表[=：: ]*「?([^」\n,， ]+)/]),
    referenceCsv: stringParam(params, ["referenceCsv"]) ?? "rules/BI_DATA/metadata.csv",
    referenceSourceName: stringParam(params, ["referenceSourceName"]) ?? firstMatch(text, [/原始指定檔名[=：: ]+`?([^`\n;]+)/, /source filename[=：: ]+`?([^`\n;]+)/i]),
    referenceIndexKey: stringParam(params, ["referenceIndexKey"]) ?? firstMatch(text, [/reference-index key[=：: ]+`?([^`\n;]+)/i, /reference_index_key[=：: ]+`?([^`\n;]+)/i]) ?? "bi_metadata_csv",
    matchKey: stringParam(params, ["matchKey"]) ?? "欄位名稱",
    compareFields: Array.isArray(params.compareFields) ? params.compareFields : ["欄位名稱", "資料類型"],
    downloadScope: stringParam(params, ["downloadScope"]) ?? (/清單|列表|專案頁|報表列|report list/i.test(text) ? "report_list" : null),
    field,
    fields,
    dateRange: dateRangeText,
    display: nonNeutral(stringParam(params, ["display", "displayMode"])) ?? nonNeutral(cleanup["顯示"]) ?? null,
    cleanupChecklist: currentCase?.cleanupChecklist ?? null,
    cleanupTargets: cleanup,
    reportNamePattern,
    existingReportNamePattern,
    existingReportSourceCaseNo: modifiesExistingReport ? "TOOL-A-01" : null,
    openExistingReport: modifiesExistingReport,
    overwriteExisting: modifiesExistingReport
  };
};

const action = (
  id: string,
  template: string,
  title: string,
  params: Record<string, unknown>,
  overrides: Partial<Omit<HelperPlanAction, "id" | "template" | "title" | "params" | "canJudgeResult">> = {}
): HelperPlanAction => ({
  id,
  template,
  title,
  params,
  mutatesUi: true,
  requiresToolBridge: false,
  optional: false,
  canJudgeResult: false,
  requiredEvidence: ["dom.state", "screenshot"],
  screenshotPolicy: "major_step",
  notes: [],
  ...overrides
});

const buildActions = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): HelperPlanAction[] => {
  if (!currentCase) return [];
  const text = textBlob(currentCase);
  const operationTemplate = helperHints?.operationTemplate ?? "";
  const params = inferCollageParams(currentCase, helperHints);
  const helperParams = paramsObject(helperHints);
  const actions: HelperPlanAction[] = [];
  const features = detectCaseFeatures(currentCase, helperHints);
  const unsupportedHelperTarget =
    features.mode === "record" ||
    features.mode === "metric" ||
    features.hasFilter ||
    features.hasGroup;
  const metadataOnly = features.isMetadataDropdown;
  if (unsupportedHelperTarget) return [];

  if (metadataOnly) {
    return [
      action("H1", "collage.openProject", "開啟指定拼貼專案", params, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"],
        notes: ["只開啟/切換專案，不判斷 testcase 結果。"]
      }),
      action("H2", "collage.createReport", "進入新增報表頁", params, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"]
      }),
      action("H3", "collage.extractMetadataDropdownFields", "展開欄位 picker 並擷取 metadata 對照 evidence", params, {
        requiredEvidence: ["dom.list", "metadata.csv", "comparison", "screenshot"],
        screenshotPolicy: "required_if_possible",
        notes: [
          "helper 只能透過 visible `+ 新增欄位` 開啟 picker，之後用 read-only DOM extraction 擷取欄位清單。",
          "expected list 必須來自 run packet 的 `rules/BI_DATA/metadata.csv` 或 reference-index 指向檔案；不可打 BI API 或 broad-read 所有 CSV。",
          "helper 只產生 actual/expected/missing/extra evidence；Codex 仍需依 testcase 規則判 PASS/FAIL/BLOCKED。"
        ]
      })
    ];
  }
  const isCollageFlow = /collage_build_preview_save_reopen/.test(operationTemplate) || /拼貼|新增報表|儲存報表|重開|重新檢視/.test(text);
  const modifiesExistingReport = params.openExistingReport === true;
  const noSave = helperRequestsNoSave({ ...params, ...helperParams });
  const explicitlyNoReopen =
    helperRequestsNoReopen({ ...params, ...helperParams }) ||
    /不(?:需|要|應)?重開|不要重開|無需重開|不用重開|不重開\s*editor|不應產生\s*reopen/i.test(text);
  const needsReopen = !explicitlyNoReopen && /重開|重新檢視|還原|載入/.test(text);

  if (isCollageFlow) {
    actions.push(
      action("H1", "collage.openProject", "開啟指定拼貼專案", params, {
        requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"],
        notes: ["只開啟/切換專案，不判斷 testcase 結果。"]
      }),
      modifiesExistingReport
        ? action("H2", "collage.openExistingReport", "開啟既有報表進入編輯", params, {
            requiredEvidence: ["dom.state", "screenshot"],
            notes: ["若找不到 TOOL-A-01 建立的報表，helper 必須 blocked 並標記前置失敗，不可改建新報表替代。"]
          })
        : action("H2", "collage.createReport", "進入新增報表頁", params, {
            requiredEvidence: ["dom.url", "dom.pageTitle", "dom.state", "screenshot"]
          }),
      action("H3", "collage.configureMetric", "設定來源、欄位、日期與顯示", params, {
        requiredEvidence: ["dom.state", "state.delta", "screenshot"],
        notes: [
          "所有設定都必須透過 visible UI；不可使用內部 JS setter。",
          "可用 state delta planner 跳過已逐字/DOM 驗證對齊的項目；讀不到或不確定時必須操作 UI 或回 blocked。",
          "多欄位字串必須拆成多個欄位逐一新增/驗證，不可把整段 composite string 當作單一 clickable text。",
          "若 `+ 新增欄位` 文字 locator 失敗，helper 可嘗試其他 visible button/role/class fallback 並留下 locator drift evidence；不可用 force click 或內部 JS setter。"
        ]
      }),
      action("H4", "collage.runPreviewAndCollectEvidence", "執行 preview 並收集 evidence", params, {
        requiredEvidence: ["network.requestBody", "network.responseBody", "chart.datasets", "dom.previewState", "screenshot"],
        screenshotPolicy: "required_if_possible",
        notes: ["preview request 必須由 UI 按執行觸發；network 只作觀察，不可直接呼叫 API。"]
      })
    );

    if (!noSave && /儲存|覆寫/.test(text)) {
      actions.push(
        action("H5", "collage.saveReport", modifiesExistingReport ? "覆寫既有報表" : "儲存本輪臨時報表", params, {
          requiresToolBridge: true,
          requiredEvidence: ["toolBridge.response", "dom.state", "screenshot"],
          screenshotPolicy: "required_if_possible",
          notes: ["Agent 模式需先取得 Tool Bridge response；非 SSO/login request 由 Mac Agent 自動回覆；helper 只可處理已知 BI save/overwrite dialog；未知 native dialog 若沒有實際 recovery handler 必須 blocked 並留下 evidence。"]
        })
      );
    }

    if (needsReopen) {
      actions.push(
        action("H6", "collage.reopenReport", "從清單重開報表並驗證設定", params, {
          requiredEvidence: ["dom.state", "network.requestBody", "screenshot"],
          screenshotPolicy: "required_if_possible"
        })
      );
    }

    if (/下載|CSV/i.test(text)) {
      actions.push(
        action("H7", "collage.downloadCsvAndComparePreview", "下載 CSV 並與 preview evidence 比對", params, {
          requiredEvidence: ["downloaded.csv", "csv.rows", "preview.table_or_chart", "screenshot"],
          screenshotPolicy: "required_if_possible",
          notes: [
            "下載是合法輸出，不需 Tool Bridge；helper 只產生 CSV/preview 比對 evidence，Codex 仍負責最終判定。",
            "若重開後設定或 preview 已不存在，helper 應記錄 failedSubcondition；Codex 應把 CSV 比對記為 not reached，先判斷前置流程失敗是否已構成 FAIL。",
            "若專案/報表清單 stale，helper 應刷新/重定位本輪 saved report row；若 browser download event 未觸發但同一次 UI click 產生 CSV/attachment response，可保存 response body 作 CSV evidence。"
          ]
        })
      );
    }
  }

  return actions;
};

const buildAvailableTemplates = (currentCase: CaseManifestCase | null, helperHints: HelperHints | null): HelperPlanAction[] => {
  const params = inferCollageParams(currentCase, helperHints);
  const features = detectCaseFeatures(currentCase, helperHints);
  const available: HelperPlanAction[] = [
    action("T-delete", "collage.deleteTemporaryReport", "刪除本輪臨時報表 helper（需授權）", params, {
      optional: true,
      requiresToolBridge: true,
      requiredEvidence: ["toolBridge.response", "dom.state", "screenshot"],
      screenshotPolicy: "required_if_possible",
      notes: ["只可刪除本輪建立且名稱可比對的臨時資源；不可刪除既有主資源。"]
    })
  ];

  if (features.hasFilter || features.hasGroup) return [];
  return available;
};

export const helperExecutorPath = (): string => {
  const runtimeDir = path.basename(__dirname) === "src" ? path.resolve(__dirname, "../dist") : __dirname;
  return path.join(runtimeDir, "bi-ui-helper-executor.js");
};

export const buildHelperExecutionPlan = ({ runDir, currentCase, helperHints }: WriteHelperExecutionPlanOptions): HelperExecutionPlan => {
  const caseId = currentCase?.caseNo ?? helperHints?.caseId ?? null;
  const artifactRoot = path.join(runDir, "output", "helper-artifacts", caseId ?? "unknown-case");
  return {
    schemaVersion: "helper-execution-plan-v1",
    generatedAt: new Date().toISOString(),
    caseId,
    mode: "single_case_helper_assisted_uat",
    executor: {
      kind: "mac-agent-playwright-cdp",
      command: `node ${helperExecutorPath()} --run-dir "${runDir}" --case "${caseId ?? ""}" --action <template> --params-json '<json>'`,
      reportPath: path.join(artifactRoot, "helper-report.jsonl"),
      artifactRoot
    },
    policy: [
      "Helper plan is an execution aid, not a testcase result.",
      "Helper actions may operate the UI and collect evidence, but Codex must judge PASS/FAIL/BLOCKED.",
      "Helper actions must not write result.xlsx and must not run multiple cases.",
      "Helper actions must not use force:true clicks or bypass browser actionability checks.",
      "Irreversible actions and native dialogs require Tool Bridge response in Agent mode; non-SSO/login authorization requests may be auto-approved by Mac Agent policy, and only known BI save/overwrite dialogs may be handled by helper after approval."
    ],
    safety: {
      helperMayWriteResultXlsx: false,
      helperMayJudgePassFail: false,
      helperMayRunMultipleCases: false,
      helperMayUseDirectBiApi: false,
      helperMayUseInternalJsSetter: false,
      helperMayBypassActionabilityCheck: false,
      codexMustJudgeResult: true
    },
    helperHints: {
      found: Boolean(helperHints),
      operationTemplate: helperHints?.operationTemplate ?? null,
      automationLevel: helperHints?.automationLevel ?? null,
      aiDecisionRequired: helperHints?.aiDecisionRequired ?? null
    },
    actions: buildActions(currentCase, helperHints),
    availableTemplates: buildAvailableTemplates(currentCase, helperHints)
  };
};

export const writeHelperExecutionPlan = (options: WriteHelperExecutionPlanOptions): { jsonPath: string; markdownPath: string; plan: HelperExecutionPlan } => {
  const plan = buildHelperExecutionPlan(options);
  const inputDir = path.join(options.runDir, "input");
  const jsonPath = path.join(inputDir, "helper-execution-plan.json");
  const markdownPath = path.join(inputDir, "helper-execution-plan.md");

  fs.writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(
    markdownPath,
    [
      "# Helper Execution Plan v1",
      "",
      "本檔是 current case 的 helper-assisted UAT 操作計畫。它不是結果，也不是 PASS/FAIL 判定。",
      "",
      `- case_id: ${plan.caseId ?? "(unavailable)"}`,
      `- executor: ${plan.executor.command}`,
      `- artifact_root: ${plan.executor.artifactRoot}`,
      `- report_path: ${plan.executor.reportPath}`,
      "",
      "## Safety",
      "",
      "- helper 不可寫 result.xlsx。",
      "- helper 不可判 PASS/FAIL/BLOCKED。",
      "- helper 不可一次跑多題。",
      "- helper 不可直接打 BI API 或用內部 JS setter 設狀態。",
      "- helper 不可使用 force: true click 或其他方式繞過 browser actionability check。",
      "- Codex 必須讀 helper evidence 後自行判斷與寫 detail_json。",
      "",
      "## Planned Actions",
      "",
      plan.actions.length > 0
        ? plan.actions
            .map(
              (item) =>
                `### ${item.id}. ${item.template}\n\n- title: ${item.title}\n- requiresToolBridge: ${item.requiresToolBridge}\n- optional: ${item.optional}\n- requiredEvidence: ${item.requiredEvidence.join(", ")}\n- screenshotPolicy: ${item.screenshotPolicy}\n\n\`\`\`json\n${JSON.stringify(item.params, null, 2)}\n\`\`\`\n`
            )
            .join("\n")
        : "(no planned helper actions; use manual Codex UI execution with current-case-pack)",
      "",
      "## Available Optional Templates",
      "",
      plan.availableTemplates.map((item) => `- ${item.template}: ${item.title}; requiresToolBridge=${item.requiresToolBridge}`).join("\n"),
      ""
    ].join("\n")
  );

  return { jsonPath, markdownPath, plan };
};
