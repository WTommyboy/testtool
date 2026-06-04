import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

export type ResultEvidenceEnrichmentRow = {
  rowNo: number;
  caseNo: string;
  status: string;
  action:
    | "added_blocked_current_run_evidence"
    | "deterministic_helper_pass"
    | "deterministic_helper_fail"
    | "completed_visual_fallback_contract"
    | "downgraded_fail_to_blocked"
    | "unchanged"
    | "skipped";
  reason?: string;
};

export type ResultEvidenceEnrichmentReport = {
  schemaVersion: "result-evidence-enrichment-v1";
  generatedAt: string;
  filePath: string;
  runId: string;
  status: "updated" | "unchanged";
  rows: ResultEvidenceEnrichmentRow[];
};

const text = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (typeof value === "object") {
    const rich = value as { richText?: Array<{ text?: string }> };
    if (Array.isArray(rich.richText)) return rich.richText.map((item) => item.text ?? "").join("").trim();
  }
  return String(value).trim();
};

const normalizeHeader = (value: unknown): string => text(value).toLowerCase().replace(/\s+/g, "");

const findColumn = (row: ExcelJS.Row, names: string[]): number | null => {
  const expected = new Set(names.map((name) => name.toLowerCase().replace(/\s+/g, "")));
  let found: number | null = null;
  row.eachCell((cell, col) => {
    if (expected.has(normalizeHeader(cell.value))) found = col;
  });
  return found;
};

const isMeaningful = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return false;
};

const walk = (
  value: unknown,
  visit: (entry: { key: string | null; path: string; value: unknown }) => void,
  pathName = ""
): void => {
  if (!value || typeof value !== "object") {
    visit({ key: pathName ? pathName.split(".").at(-1) ?? null : null, path: pathName, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visit, `${pathName}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = pathName ? `${pathName}.${key}` : key;
    visit({ key, path: childPath, value: child });
    walk(child, visit, childPath);
  }
};

const hasCurrentRunEvidence = (detail: Record<string, unknown>): boolean => {
  let found = false;
  walk(detail, ({ key, path: detailPath, value }) => {
    if (found) return;
    const normalized = `${key ?? ""}\n${detailPath}`.replace(/\s+/g, "");
    if (
      /current[-_]?run[-_]?evidence/i.test(normalized) ||
      /本次.*證據/.test(normalized) ||
      /執行證據/.test(normalized)
    ) {
      found = isMeaningful(value);
    }
  });
  return found;
};

const relativePath = (runDir: string, filePath: string): string => {
  const relative = path.relative(runDir, filePath);
  return relative && !relative.startsWith("..") ? relative : filePath;
};

const existingFiles = (paths: string[]): string[] => paths.filter((item) => fs.existsSync(item));

const firstDetailString = (detail: Record<string, unknown>, keys: string[], fallback: string): string => {
  for (const key of keys) {
    const value = detail[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
};

const readJson = (filePath: string): Record<string, unknown> | null => {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const findCaseArtifact = (runDir: string, caseNo: string, fileName: string): string | null => {
  return findCaseArtifactFiles(runDir, caseNo, (entry) => entry.isFile() && entry.name === fileName).sort().at(-1) ?? null;
};

const findCaseArtifactFiles = (
  runDir: string,
  caseNo: string,
  predicate: (entry: fs.Dirent, entryPath: string) => boolean
): string[] => {
  const roots = [
    path.join(runDir, "output", "helper-artifacts"),
    path.join(runDir, "output", "helper-artifacts-archive")
  ];
  const collected: string[] = [];
  const visit = (dir: string, depth: number): void => {
    if (!fs.existsSync(dir) || depth > 5) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entryPath.includes(`${path.sep}${caseNo}${path.sep}`) && predicate(entry, entryPath)) {
        collected.push(entryPath);
      } else if (entry.isDirectory()) {
        visit(entryPath, depth + 1);
      }
    }
  };
  roots.forEach((root) => visit(root, 0));
  return collected.sort();
};

const objectValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const arrayValue = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.flatMap((item) => objectValue(item) ? [objectValue(item) as Record<string, unknown>] : []) : [];

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];

const normalizeCaseNo = (value: string): string =>
  value.trim().replace(/\s+/g, "").replace(/^DEMO-/i, "").toUpperCase();

const runCaseScopeContract = (runDir: string, caseNo: string): Record<string, unknown> | null => {
  const candidates = [
    path.join(runDir, "input", "domain_case_scope_contracts.json"),
    path.join(process.cwd(), "domain-packs", "BI_OFFICIAL_UI_COLLAGE", "case-scope-runtime-contracts.json")
  ];
  const wanted = normalizeCaseNo(caseNo);
  for (const filePath of candidates) {
    const parsed = readJson(filePath);
    const contracts = arrayValue(parsed?.contracts);
    const contract = contracts.find((item) =>
      typeof item.caseNo === "string" && normalizeCaseNo(item.caseNo) === wanted
    );
    if (contract) return contract;
  }
  return null;
};

const contractAllowsFunctionalFlowStateChangePass = (
  contract: Record<string, unknown> | null,
  passEvidence: Record<string, unknown>
): boolean => {
  if (!contract || contract.testTarget !== "functional_flow") return false;
  const observationState = objectValue(passEvidence.observationState);
  if (observationState?.asserted !== true) return false;
  const evidenceObject = typeof observationState.evidenceObject === "string" ? observationState.evidenceObject : "";
  if (!evidenceObject) return false;
  const requiredActions = arrayValue(contract.requiredActions)
    .filter((item) => (item.role ?? "under_test") === "under_test" && item.requiredForPass !== false);
  if (requiredActions.length === 0) return false;
  return requiredActions.every((item) => {
    const evidenceRequirements = stringArray(item.evidenceRequirements);
    return item.expectedOutcome === "state_changed" &&
      evidenceRequirements.includes(evidenceObject);
  });
};

const deterministicDateVariantPassEvidence = (runDir: string, caseNo: string): Record<string, unknown> | null => {
  const filePath = findCaseArtifact(runDir, caseNo, "date-variants-preview-evidence.json");
  const evidence = filePath ? readJson(filePath) : null;
  const variants = arrayValue(evidence?.variants);
  if (!filePath || !evidence || variants.length === 0) return null;
  const allSatisfied = variants.every((variant) => {
    const status = typeof variant.status === "string" ? variant.status : "";
    const networkEvidence = objectValue(variant.networkEvidence);
    const tableSummary = objectValue(variant.tableSummary);
    const dateUiEvidence = objectValue(variant.dateUiEvidence);
    const checks = objectValue(dateUiEvidence?.checks);
    return status === "ok" &&
      networkEvidence?.responseStatus === 200 &&
      typeof tableSummary?.dateColumnCount === "number" &&
      tableSummary.dateColumnCount > 0 &&
      (
        checks?.representedRangeMatchesRequested === true ||
        checks?.staticRequestedRangeObserved === true ||
        checks?.requestedLabelVisible === true
      );
  });
  if (!allSatisfied) return null;
  const judgmentSummary = objectValue(evidence.judgmentSummary);
  const comparison = objectValue(judgmentSummary?.comparison ?? evidence.comparison);
  return {
    evidenceType: "dateVariantsPreviewEvidence",
    evidencePath: path.relative(runDir, filePath),
    variantCount: variants.length,
    comparison: comparison ?? null,
    variants: variants.map((variant) => ({
      requestedLabel: variant.requestedLabel ?? null,
      requestDateRange: objectValue(variant.networkEvidence)?.requestDateRange ?? null,
      responseStatus: objectValue(variant.networkEvidence)?.responseStatus ?? null,
      tableSummary: variant.tableSummary ?? null,
      dateUiChecks: objectValue(objectValue(variant.dateUiEvidence)?.checks) ?? null,
      warnings: variant.warnings ?? []
    }))
  };
};

const deterministicFrontendObservationPassEvidence = (runDir: string, caseNo: string): Record<string, unknown> | null => {
  const filePath = findCaseArtifact(runDir, caseNo, "frontend-observation-evidence.json");
  const evidence = filePath ? readJson(filePath) : null;
  const state = objectValue(evidence?.observationState);
  if (!filePath || !evidence || state?.asserted !== true) return null;
  return {
    evidenceType: "frontendObservationEvidence",
    evidencePath: path.relative(runDir, filePath),
    observationType: evidence.observationType ?? null,
    observationState: {
      evidenceObject: state.evidenceObject ?? null,
      asserted: state.asserted,
      assertions: state.assertions ?? null,
      presetSwitches: state.presetSwitches ?? null,
      failedPresetSwitches: state.failedPresetSwitches ?? null,
      recommendedFailureClassification: state.recommendedFailureClassification ?? null,
      interactionLog: state.interactionLog ?? null
    }
  };
};

const deterministicHelperPassEvidence = (runDir: string, caseNo: string): Record<string, unknown> | null =>
  deterministicDateVariantPassEvidence(runDir, caseNo) ?? deterministicFrontendObservationPassEvidence(runDir, caseNo);

const jsonText = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const untrustedFormulaFailEvidence = (runDir: string, caseNo: string): Record<string, unknown> | null => {
  const filePath = findCaseArtifact(runDir, caseNo, "calculated-field-evidence.json");
  const evidence = filePath ? readJson(filePath) : null;
  if (!filePath || !evidence) return null;
  const formulaUi = objectValue(evidence.formulaUi);
  const selectedFormulaInput = objectValue(formulaUi?.selectedFormulaInput);
  const entry = objectValue(selectedFormulaInput?.entry);
  const entryMethod = typeof entry?.method === "string" ? entry.method : null;
  const serialized = jsonText(evidence);
  const hasDirectFill = entryMethod === "direct_fill_inline" || /direct_fill_inline/i.test(serialized);
  const hasTrustedEntry =
    /inline_insert_field_picker|inline_keypad_operator|inline_keypad_number/i.test(serialized) ||
    /tokenInserted"\s*:\s*true/i.test(serialized);
  if (!hasDirectFill || hasTrustedEntry) return null;

  const dateRangeEvidence = objectValue(evidence.dateRangeEvidence);
  return {
    evidenceType: "formulaSetupUntrustedEntry",
    blockedClassification: "BLOCKED_TOOL_LIMITATION",
    blockedReason: "Formula setup used direct_fill_inline without trusted visible token/keypad evidence; product PASS/FAIL is unsafe.",
    evidencePath: path.relative(runDir, filePath),
    entryMethod: entryMethod ?? "direct_fill_inline",
    expectedFormula: formulaUi?.formula ?? null,
    selectedFormulaValue: selectedFormulaInput?.value ?? null,
    dateRangeWarning: dateRangeEvidence?.warning ?? null,
    warnings: evidence.warnings ?? []
  };
};

const createProjectSetupBlockedEvidence = (runDir: string, caseNo: string): Record<string, unknown> | null => {
  const filePath = findCaseArtifact(runDir, caseNo, "collage.createProject-latest.json");
  const evidence = filePath ? readJson(filePath) : null;
  if (!filePath || !evidence) return null;
  const serialized = jsonText(evidence);
  const status = typeof evidence.status === "string" ? evidence.status : "";
  if (!/^blocked$/i.test(status) || !/CREATE_PROJECT_MODAL_NOT_VISIBLE/i.test(serialized)) return null;
  const projectLimitReached = /已達最高\s*5\s*個專案|PROJECT_CREATE_MODAL_PRECONDITION_PROJECT_LIMIT_REACHED/i.test(serialized);
  return {
    evidenceType: "createProjectSetupBlocked",
    blockedClassification: projectLimitReached ? "BLOCKED_ENVIRONMENT_PRECONDITION" : "BLOCKED_NEEDS_REJUDGMENT",
    blockedReason: projectLimitReached
      ? "Create-project flow was blocked by the 5-project environment precondition, so this is not product FAIL evidence."
      : "Create-project modal was not visible, but current evidence does not prove whether this is product failure, route mismatch, or helper/precondition gap.",
    evidencePath: path.relative(runDir, filePath),
    helperStatus: status,
    helperError: typeof evidence.error === "string" ? evidence.error.slice(0, 2000) : null,
    projectLimitReached
  };
};

const unsafeFailBlockedEvidence = (runDir: string, caseNo: string): Record<string, unknown> | null =>
  untrustedFormulaFailEvidence(runDir, caseNo) ?? createProjectSetupBlockedEvidence(runDir, caseNo);

const FRONTEND_OBSERVATION_CASE_RE = /^BIUI_COLLAGE_R001-(?:I|J|K|L|M|N)-/i;
const STRUCTURED_FRONTEND_PRECONDITION_BLOCKER_RE =
  /PROJECT_LIMIT_PRECONDITION_NOT_ESTABLISHED|PROJECT_CREATE_MODAL_PRECONDITION_PROJECT_LIMIT_REACHED|FRONTEND_OBSERVATION_BLOCKED:(?:PROJECT_LIMIT_PRECONDITION_NOT_ESTABLISHED|PROJECT_CREATE_MODAL_PRECONDITION_PROJECT_LIMIT_REACHED)/i;

const uniqueStrings = (items: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
};

const extractScreenshotReferences = (value: unknown): string[] => {
  const references: string[] = [];
  const visit = (node: unknown, depth = 0): void => {
    if (depth > 8 || references.length >= 20) return;
    if (typeof node === "string" && /\.(?:png|jpe?g|webp)(?:\b|$)/i.test(node)) {
      references.push(node);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, depth + 1));
      return;
    }
    Object.values(node as Record<string, unknown>).forEach((child) => visit(child, depth + 1));
  };
  visit(value);
  return uniqueStrings(references).slice(0, 10);
};

const caseScreenshotArtifacts = (runDir: string, caseNo: string): string[] =>
  findCaseArtifactFiles(runDir, caseNo, (entry) => entry.isFile() && /\.(?:png|jpe?g|webp)$/i.test(entry.name))
    .map((item) => relativePath(runDir, item))
    .slice(0, 10);

const detailHasCompleteVisualFallbackContract = (detail: Record<string, unknown>, verdictReason: string): boolean => {
  const evidenceSource = typeof detail.evidenceSource === "string" ? detail.evidenceSource : "";
  const hasVisualObservation = typeof detail.visualObservation === "string" && detail.visualObservation.trim().length > 0;
  const hasDomGap = typeof detail.domEvidenceGap === "string" && detail.domEvidenceGap.trim().length > 0;
  const hasBlockedMarker = /BLOCKED_NEEDS_VISUAL_REVIEW|PASS_VISUAL_EVIDENCE/i.test(`${verdictReason}\n${jsonText(detail)}`);
  return evidenceSource === "screenshotVisual" &&
    hasVisualObservation &&
    hasDomGap &&
    extractScreenshotReferences(detail).length > 0 &&
    hasBlockedMarker;
};

const visualObservationStructuredGap = (state: Record<string, unknown> | null, warnings: unknown): string => {
  if (!state) return "No frontend-observation-evidence.json was available for this case, so DOM/ARIA/URL structured assertion was missing.";
  const interactionLog = Array.isArray(state.interactionLog) ? state.interactionLog : [];
  const assertions = objectValue(state.assertions);
  const warningList = stringArray(warnings);
  const gapParts: string[] = [];
  if (state.asserted === false) gapParts.push("frontend observation asserted=false");
  if (typeof state.evidenceObject === "string") gapParts.push(`evidenceObject=${state.evidenceObject}`);
  if (assertions) gapParts.push(`assertions=${jsonText(assertions)}`);
  if (interactionLog.some((item) => objectValue(item)?.hovered === false)) gapParts.push("required hover target was not reached");
  if (interactionLog.some((item) => objectValue(item)?.clicked === false)) gapParts.push("required visible click was not completed");
  if (warningList.length > 0) gapParts.push(`warnings=${warningList.join(",")}`);
  return gapParts.length > 0
    ? `Structured helper evidence was insufficient for automatic PASS/FAIL: ${gapParts.join("; ")}.`
    : "DOM/ARIA/URL structured assertion was present but did not meet the deterministic PASS/FAIL contract.";
};

const visualFallbackBlockedEvidence = (
  runDir: string,
  caseNo: string,
  detail: Record<string, unknown>,
  verdictReason: string
): Record<string, unknown> | null => {
  if (!FRONTEND_OBSERVATION_CASE_RE.test(caseNo)) return null;
  if (detailHasCompleteVisualFallbackContract(detail, verdictReason)) return null;
  const serialized = `${verdictReason}\n${jsonText(detail)}`;
  if (STRUCTURED_FRONTEND_PRECONDITION_BLOCKER_RE.test(serialized)) return null;
  const observationPath = findCaseArtifact(runDir, caseNo, "frontend-observation-evidence.json");
  const observationEvidence = observationPath ? readJson(observationPath) : null;
  const state = objectValue(observationEvidence?.observationState);
  const recommendedFailureClassification = typeof state?.recommendedFailureClassification === "string"
    ? state.recommendedFailureClassification
    : null;
  if (state?.asserted === true || (recommendedFailureClassification && /^FAIL_/i.test(recommendedFailureClassification))) return null;

  const screenshotReferences = uniqueStrings([
    ...extractScreenshotReferences(detail),
    ...caseScreenshotArtifacts(runDir, caseNo)
  ]).slice(0, 10);
  if (screenshotReferences.length === 0) return null;
  const looksLikeVisualBlocker =
    /EVIDENCE_INSUFFICIENT|BLOCKED_NEEDS_VISUAL_REVIEW|screenshot|frontend[_ -]?observation|前端呈現|visual/i.test(serialized) ||
    Boolean(observationPath);
  if (!looksLikeVisualBlocker) return null;

  return {
    evidenceType: "frontendObservationVisualFallback",
    blockedClassification: "BLOCKED_NEEDS_VISUAL_REVIEW",
    evidencePath: observationPath ? relativePath(runDir, observationPath) : null,
    observationType: observationEvidence?.observationType ?? null,
    screenshotReferences,
    structuredEvidence: state
      ? {
        evidenceObject: state.evidenceObject ?? null,
        asserted: state.asserted ?? null,
        assertions: state.assertions ?? null,
        recommendedFailureClassification: recommendedFailureClassification ?? null,
        interactionLog: state.interactionLog ?? null
      }
      : null,
    warnings: observationEvidence?.warnings ?? [],
    domEvidenceGap: visualObservationStructuredGap(state, observationEvidence?.warnings)
  };
};

const deterministicFrontendObservationFailEvidence = (runDir: string, caseNo: string): Record<string, unknown> | null => {
  const filePath = findCaseArtifact(runDir, caseNo, "frontend-observation-evidence.json");
  const evidence = filePath ? readJson(filePath) : null;
  const state = objectValue(evidence?.observationState);
  const classification = typeof state?.recommendedFailureClassification === "string"
    ? state.recommendedFailureClassification
    : null;
  if (!filePath || !evidence || !state || !classification || !/^FAIL_/i.test(classification)) return null;
  return {
    evidenceType: "frontendObservationEvidence",
    evidencePath: path.relative(runDir, filePath),
    observationType: evidence.observationType ?? null,
    failureClassification: classification,
    observationState: {
      evidenceObject: state.evidenceObject ?? null,
      asserted: state.asserted ?? null,
      recommendedFailureClassification: classification,
      failedPresetSwitches: state.failedPresetSwitches ?? null,
      interactionLog: state.interactionLog ?? null
    }
  };
};

const deterministicReportMutationFailEvidence = (runDir: string, caseNo: string): Record<string, unknown> | null => {
  const filePath = findCaseArtifact(runDir, caseNo, "update-reopen-evidence.json");
  const evidence = filePath ? readJson(filePath) : null;
  if (!filePath || !evidence) return null;
  const dateRangeUpdate = objectValue(evidence.dateRangeUpdate);
  const updatePrerequisite = objectValue(evidence.updatePrerequisite);
  const updatePrerequisiteAfter = objectValue(updatePrerequisite?.after);
  const updateAction = objectValue(evidence.updateAction);
  const updateResult = objectValue(updateAction?.result);
  const bodyTextExcerpt = typeof updateResult?.bodyTextExcerpt === "string" ? updateResult.bodyTextExcerpt : "";
  const recommended = typeof evidence.recommendedFailureClassification === "string"
    ? evidence.recommendedFailureClassification
    : typeof updateResult?.recommendedFailureClassification === "string"
      ? updateResult.recommendedFailureClassification
      : null;
  const updateButtonWasVisible = /更新設定|更新|儲存設定/.test(bodyTextExcerpt);
  const updateButtonStillDisabled =
    updatePrerequisiteAfter?.disabled === true ||
    updatePrerequisiteAfter?.ariaDisabled === true ||
    (/請先計算/.test(bodyTextExcerpt) && updatePrerequisite?.calculateClicked !== true);
  const validEditorChangeWasApplied = dateRangeUpdate?.ok === true;
  const updateWasNotClicked = updateResult?.clicked === false;
  const classification = recommended && /^FAIL_/i.test(recommended) && !updateButtonStillDisabled
    ? recommended
    : validEditorChangeWasApplied && updateWasNotClicked && updateButtonWasVisible && !updateButtonStillDisabled
      ? "FAIL_INTERACTION_FAILED"
      : null;
  if (!classification) return null;

  return {
    evidenceType: "reportMutationEvidence",
    evidencePath: path.relative(runDir, filePath),
    failureClassification: classification,
    workflowStatus: evidence.workflowStatus ?? null,
    reportName: evidence.reportName ?? null,
    targetDateRange: evidence.targetDateRange ?? null,
    dateRangeUpdate,
    updatePrerequisite,
    updateAction: {
      result: updateResult,
      network: updateAction?.network ?? null,
      dialogs: updateAction?.dialogs ?? null
    },
    backToList: evidence.backToList ?? null,
    reopen: evidence.reopen ?? null,
    persisted: evidence.persisted ?? null
  };
};

const buildDeterministicPassDetail = (options: {
  runId: string;
  caseNo: string;
  previousDetail: Record<string, unknown>;
  passEvidence: Record<string, unknown>;
  previousStatus?: "BLOCKED" | "FAIL";
}): Record<string, unknown> => {
  const previousStatus = options.previousStatus ?? "BLOCKED";
  return {
    測試目的: firstDetailString(
      options.previousDetail,
      ["測試目的", "testPurpose", "目的"],
      "Current-run helper evidence satisfies the case assertions."
    ),
    設定條件: firstDetailString(
      options.previousDetail,
      ["設定條件", "conditions", "前置條件"],
      "Reused current-run helper artifacts and deterministic evidence contract."
    ),
    預期行為: firstDetailString(
      options.previousDetail,
      ["預期行為", "expected", "預期結果"],
      "Required UI/data assertions are satisfied by helper evidence."
    ),
    實際行為: `Current-run helper evidence was already deterministic and satisfied this case, so the Agent promoted the prior ${previousStatus} result to PASS instead of leaving an evidence-inconsistent judgment.`,
    currentRunEvidence: {
      source: "uat-agent-deterministic-helper-judgment",
      currentRunEvidence: true,
      runId: options.runId,
      caseNo: options.caseNo,
      generatedAt: new Date().toISOString(),
      ...options.passEvidence
    },
    ...(previousStatus === "FAIL"
      ? { previous_fail_detail_json: options.previousDetail }
      : { previous_blocked_detail_json: options.previousDetail })
  };
};

const buildDeterministicFailDetail = (options: {
  runId: string;
  caseNo: string;
  previousDetail: Record<string, unknown>;
  failEvidence: Record<string, unknown>;
}): Record<string, unknown> => ({
  測試目的: firstDetailString(
    options.previousDetail,
    ["測試目的", "testPurpose", "目的"],
    "Current-run helper evidence proves the required frontend interaction/assertion failed."
  ),
  設定條件: firstDetailString(
    options.previousDetail,
    ["設定條件", "conditions", "前置條件"],
    "Reused current-run helper artifacts and deterministic evidence contract."
  ),
  預期行為: firstDetailString(
    options.previousDetail,
    ["預期行為", "expected", "預期結果"],
    "Required under_test frontend interaction should reach its expected outcome."
  ),
  實際行為: "Current-run helper evidence classified the required frontend interaction as FAIL_INTERACTION_FAILED, so the Agent converted the prior BLOCKED result to FAIL instead of leaving it as evidence-insufficient.",
  錯誤原因: "Required frontend interaction or assertion did not reach the expected visible UI state.",
  根因層級: "前端互動/狀態切換",
  驗證方法: "Result evidence enricher read current-run helper evidence and found a deterministic FAIL_INTERACTION_FAILED classification.",
  "RD 分派": "BI 前端",
  currentRunEvidence: {
    source: "uat-agent-deterministic-helper-judgment",
    currentRunEvidence: true,
    runId: options.runId,
    caseNo: options.caseNo,
    generatedAt: new Date().toISOString(),
    ...options.failEvidence
  },
  previous_blocked_detail_json: options.previousDetail
});

const buildUnsafeFailBlockedDetail = (options: {
  runId: string;
  caseNo: string;
  previousDetail: Record<string, unknown>;
  blockedEvidence: Record<string, unknown>;
}): Record<string, unknown> => {
  const classification = typeof options.blockedEvidence.blockedClassification === "string"
    ? options.blockedEvidence.blockedClassification
    : "BLOCKED_NEEDS_REJUDGMENT";
  const blockedReason = typeof options.blockedEvidence.blockedReason === "string"
    ? options.blockedEvidence.blockedReason
    : "Agent result evidence guard found that this FAIL was based on unsafe or insufficient evidence.";
  return {
    測試目的: firstDetailString(
      options.previousDetail,
      ["測試目的", "testPurpose", "目的"],
      "Prevent unsafe product FAIL classification when current-run evidence is not trusted product evidence."
    ),
    設定條件: firstDetailString(
      options.previousDetail,
      ["設定條件", "conditions", "前置條件"],
      "Agent reviewed current-run helper artifacts before result upload."
    ),
    預期行為: firstDetailString(
      options.previousDetail,
      ["預期行為", "expected", "預期結果"],
      "Only trusted product evidence may support a product FAIL and auto Bug row."
    ),
    實際行為: `Agent result evidence guard converted the prior FAIL to BLOCKED because the available current-run evidence is not safe product-failure evidence. Classification=${classification}.`,
    blocked_reason: `${classification}:${blockedReason}`,
    驗證方法: "Result evidence enricher inspected current-run helper artifacts before upload and downgraded an unsafe FAIL to BLOCKED.",
    currentRunEvidence: {
      source: "uat-agent-fail-safety-classifier",
      currentRunEvidence: true,
      runId: options.runId,
      caseNo: options.caseNo,
      generatedAt: new Date().toISOString(),
      ...options.blockedEvidence
    },
    previous_fail_detail_json: options.previousDetail
  };
};

const buildVisualFallbackBlockedDetail = (options: {
  runId: string;
  caseNo: string;
  previousDetail: Record<string, unknown>;
  blockedEvidence: Record<string, unknown>;
}): Record<string, unknown> => {
  const screenshotReferences = stringArray(options.blockedEvidence.screenshotReferences);
  const domEvidenceGap = typeof options.blockedEvidence.domEvidenceGap === "string"
    ? options.blockedEvidence.domEvidenceGap
    : "DOM/ARIA/URL structured assertion was missing or insufficient for an automatic frontend-observation judgment.";
  return {
    測試目的: firstDetailString(
      options.previousDetail,
      ["測試目的", "testPurpose", "目的"],
      "Review frontend observation screenshot evidence when structured helper evidence is insufficient."
    ),
    設定條件: firstDetailString(
      options.previousDetail,
      ["設定條件", "conditions", "前置條件"],
      "Agent reviewed current-run frontend observation helper artifacts before result upload."
    ),
    預期行為: firstDetailString(
      options.previousDetail,
      ["預期行為", "expected", "預期結果"],
      "The frontend observation should be judged only by deterministic structured evidence or an explicit screenshot review contract."
    ),
    實際行為: "Agent completed the visual fallback contract before upload: current-run screenshot evidence exists, but structured DOM/ARIA/URL helper evidence did not prove a deterministic PASS or FAIL, so this remains a review-only BLOCKED_NEEDS_VISUAL_REVIEW result.",
    blocked_reason: "BLOCKED_NEEDS_VISUAL_REVIEW:structured frontend observation evidence is insufficient; screenshot remains review-only evidence.",
    evidenceSource: "screenshotVisual",
    screenshotPath: screenshotReferences.length === 1 ? screenshotReferences[0] : screenshotReferences,
    visualObservation: "Current-run screenshot artifact exists for this frontend observation, but the Agent did not automatically inspect it as product PASS/FAIL evidence. Review the screenshot against the case expectation if manual visual judgment is required.",
    domEvidenceGap,
    currentRunEvidence: {
      source: "uat-agent-visual-fallback-contract",
      currentRunEvidence: true,
      runId: options.runId,
      caseNo: options.caseNo,
      generatedAt: new Date().toISOString(),
      ...options.blockedEvidence
    },
    previous_blocked_detail_json: options.previousDetail
  };
};

const appendGeneratedBugRow = (
  bugSheet: ExcelJS.Worksheet | undefined,
  caseNo: string,
  detail: Record<string, unknown>
): void => {
  if (!bugSheet) return;
  const header = bugSheet.getRow(1);
  const set = (row: ExcelJS.Row, names: string[], value: string): void => {
    const col = findColumn(header, names);
    if (col) row.getCell(col).value = value;
  };
  const existingRelatedCol = findColumn(header, ["關聯編號", "來源 Case", "case_no", "caseno"]);
  if (existingRelatedCol) {
    for (let rowNo = 2; rowNo <= bugSheet.rowCount; rowNo += 1) {
      if (text(bugSheet.getRow(rowNo).getCell(existingRelatedCol).value) === caseNo) return;
    }
  }
  const row = bugSheet.addRow([]);
  const actual = firstDetailString(detail, ["實際行為"], "Current-run helper evidence classified this case as FAIL.");
  set(row, ["嚴重度", "severity"], "P2");
  set(row, ["Bug ID", "bug_id"], `AUTO-${caseNo}`);
  set(row, ["關聯編號", "來源 Case", "case_no", "caseno"], caseNo);
  set(row, ["標題", "title"], `[AUTO] ${caseNo} frontend interaction failed`);
  set(row, ["描述", "description"], actual);
  set(row, ["建議", "suggestion"], "Route to BI frontend. Verify the required visible UI action/state before accepting PASS evidence.");
  set(row, ["狀態", "status"], "OPEN");
  set(row, ["Evidence", "evidence"], "Generated by result evidence enricher from current-run helper evidence.");
};

const removeGeneratedBugRows = (
  bugSheet: ExcelJS.Worksheet | undefined,
  caseNo: string
): number => {
  if (!bugSheet) return 0;
  const header = bugSheet.getRow(1);
  const relatedCol = findColumn(header, ["關聯編號", "來源 Case", "case_no", "caseno"]);
  const bugIdCol = findColumn(header, ["Bug ID", "bug_id"]);
  const titleCol = findColumn(header, ["標題", "title"]);
  if (!relatedCol) return 0;
  let removed = 0;
  for (let rowNo = bugSheet.rowCount; rowNo >= 2; rowNo -= 1) {
    const row = bugSheet.getRow(rowNo);
    const related = text(row.getCell(relatedCol).value);
    const bugId = bugIdCol ? text(row.getCell(bugIdCol).value) : "";
    const title = titleCol ? text(row.getCell(titleCol).value) : "";
    const generated = /^AUTO-/i.test(bugId) || /^\[AUTO\]/i.test(title);
    if (related === caseNo && generated) {
      bugSheet.spliceRows(rowNo, 1);
      removed += 1;
    }
  }
  return removed;
};

const summarizeHelperPreRun = (filePath: string): Record<string, unknown> | null => {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      caseId?: unknown;
      status?: unknown;
      actionCount?: unknown;
      executedCount?: unknown;
      durationMs?: unknown;
      actions?: Array<Record<string, unknown>>;
    };
    return {
      path: filePath,
      caseId: parsed.caseId ?? null,
      status: parsed.status ?? null,
      actionCount: parsed.actionCount ?? null,
      executedCount: parsed.executedCount ?? null,
      durationMs: parsed.durationMs ?? null,
      actions: Array.isArray(parsed.actions)
        ? parsed.actions.map((item) => ({
          actionId: item.actionId ?? null,
          template: item.template ?? null,
          status: item.status ?? null,
          reportPath: item.reportPath ?? null,
          warnings: item.warnings ?? []
        }))
        : []
    };
  } catch {
    return {
      path: filePath,
      parseError: true
    };
  }
};

const buildBlockedEvidence = (options: {
  runId: string;
  runDir: string;
  caseNo: string;
}): Record<string, unknown> => {
  const helperDir = path.join(options.runDir, "output", "helper-artifacts", options.caseNo);
  const helperFiles = fs.existsSync(helperDir)
    ? fs.readdirSync(helperDir)
      .filter((name) => /\.(json|jsonl|png|jpg|jpeg|webp)$/i.test(name))
      .sort()
      .slice(0, 20)
      .map((name) => path.join(helperDir, name))
    : [];
  const helperSummaryPath = path.join(options.runDir, "output", "helper-pre-run-summary.json");
  const candidateFiles = existingFiles([
    helperSummaryPath,
    path.join(options.runDir, "output", "tool-requests.json"),
    path.join(options.runDir, "output", "codex-result.json"),
    path.join(options.runDir, "output", "agent.log"),
    ...helperFiles
  ]);

  return {
    source: "uat-agent-result-evidence-enricher",
    currentRunEvidence: true,
    runId: options.runId,
    caseNo: options.caseNo,
    generatedAt: new Date().toISOString(),
    verdictUnchanged: true,
    reason: "Codex generated a BLOCKED result without current-run evidence; Agent added pointers to current-run helper/preflight artifacts before upload.",
    artifactPaths: candidateFiles.map((item) => relativePath(options.runDir, item)),
    helperPreRunSummary: summarizeHelperPreRun(helperSummaryPath)
  };
};

export const ensureBlockedResultCurrentRunEvidence = async (options: {
  filePath: string;
  runId: string;
  runDir: string;
}): Promise<ResultEvidenceEnrichmentReport> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(options.filePath);
  const sheet = workbook.getWorksheet("測試案例");
  const rows: ResultEvidenceEnrichmentRow[] = [];
  let updated = false;

  if (!sheet) {
    return {
      schemaVersion: "result-evidence-enrichment-v1",
      generatedAt: new Date().toISOString(),
      filePath: options.filePath,
      runId: options.runId,
      status: "unchanged",
      rows: [{ rowNo: 0, caseNo: "", status: "", action: "skipped", reason: "測試案例 sheet not found" }]
    };
  }

  const header = sheet.getRow(1);
  const bugSheet = workbook.getWorksheet("Bug");
  const caseCol = findColumn(header, ["編號", "case_no", "caseno", "案例編號"]);
  const statusCol = findColumn(header, ["結果", "status"]);
  const detailCol = findColumn(header, ["詳細紀錄JSON", "詳細紀錄json", "detail_json", "detailjson"]);
  const verdictCol = findColumn(header, ["失敗分類", "verdictReason", "verdict_reason", "fail_category", "failCategory"]);
  if (!caseCol || !statusCol || !detailCol) {
    return {
      schemaVersion: "result-evidence-enrichment-v1",
      generatedAt: new Date().toISOString(),
      filePath: options.filePath,
      runId: options.runId,
      status: "unchanged",
      rows: [{ rowNo: 0, caseNo: "", status: "", action: "skipped", reason: "required result columns not found" }]
    };
  }

  for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    const caseNo = text(row.getCell(caseCol).value);
    if (!caseNo) continue;
    const status = text(row.getCell(statusCol).value).toUpperCase().replace(/\s+/g, "_");
    const parseDetail = (): Record<string, unknown> | null => {
      try {
        const parsed = JSON.parse(text(row.getCell(detailCol).value)) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
        return parsed as Record<string, unknown>;
      } catch {
        return null;
      }
    };
    if (status !== "BLOCKED") {
      if (status === "FAIL") {
        const detail = parseDetail();
        if (!detail) {
          rows.push({ rowNo, caseNo, status, action: "skipped", reason: "detail_json is not a JSON object" });
          continue;
        }
        const deterministicPass = deterministicHelperPassEvidence(options.runDir, caseNo);
        const deterministicFail = deterministicFrontendObservationFailEvidence(options.runDir, caseNo) ??
          deterministicReportMutationFailEvidence(options.runDir, caseNo);
        const unsafeBlocked = unsafeFailBlockedEvidence(options.runDir, caseNo);
        const contract = runCaseScopeContract(options.runDir, caseNo);
        if (
          deterministicPass &&
          !deterministicFail &&
          contractAllowsFunctionalFlowStateChangePass(contract, deterministicPass)
        ) {
          row.getCell(statusCol).value = "PASS";
          if (verdictCol) row.getCell(verdictCol).value = "";
          row.getCell(detailCol).value = JSON.stringify(buildDeterministicPassDetail({
            runId: options.runId,
            caseNo,
            previousDetail: detail,
            passEvidence: {
              ...deterministicPass,
              judgmentOverride: "functional_flow_state_changed_asserted"
            },
            previousStatus: "FAIL"
          }), null, 2);
          const removedBugRows = removeGeneratedBugRows(bugSheet, caseNo);
          rows.push({
            rowNo,
            caseNo,
            status,
            action: "deterministic_helper_pass",
            reason: `functional_flow_state_changed_asserted${removedBugRows > 0 ? `_removed_${removedBugRows}_generated_bug_rows` : ""}`
          });
          updated = true;
          continue;
        }
        if (unsafeBlocked && !deterministicFail) {
          const blockedClassification = typeof unsafeBlocked.blockedClassification === "string"
            ? unsafeBlocked.blockedClassification
            : "BLOCKED_NEEDS_REJUDGMENT";
          row.getCell(statusCol).value = "BLOCKED";
          if (verdictCol) row.getCell(verdictCol).value = blockedClassification;
          row.getCell(detailCol).value = JSON.stringify(buildUnsafeFailBlockedDetail({
            runId: options.runId,
            caseNo,
            previousDetail: detail,
            blockedEvidence: unsafeBlocked
          }), null, 2);
          const removedBugRows = removeGeneratedBugRows(bugSheet, caseNo);
          rows.push({
            rowNo,
            caseNo,
            status,
            action: "downgraded_fail_to_blocked",
            reason: `${blockedClassification}${removedBugRows > 0 ? `_removed_${removedBugRows}_generated_bug_rows` : ""}`
          });
          updated = true;
          continue;
        }
      }
      rows.push({ rowNo, caseNo, status, action: "unchanged", reason: "only BLOCKED rows are enriched" });
      continue;
    }

    const detail = parseDetail();
    if (!detail) {
      rows.push({ rowNo, caseNo, status, action: "skipped", reason: "detail_json is not a JSON object" });
      continue;
    }

    if (hasCurrentRunEvidence(detail)) {
      const deterministicPass = deterministicHelperPassEvidence(options.runDir, caseNo);
      if (deterministicPass) {
        row.getCell(statusCol).value = "PASS";
        if (verdictCol) row.getCell(verdictCol).value = "";
        row.getCell(detailCol).value = JSON.stringify(buildDeterministicPassDetail({
          runId: options.runId,
          caseNo,
          previousDetail: detail,
          passEvidence: deterministicPass
        }), null, 2);
        rows.push({
          rowNo,
          caseNo,
          status,
          action: "deterministic_helper_pass",
          reason: typeof deterministicPass.evidenceType === "string" ? deterministicPass.evidenceType : "deterministic helper evidence"
        });
        updated = true;
        continue;
      }
      const deterministicFail = deterministicFrontendObservationFailEvidence(options.runDir, caseNo) ??
        deterministicReportMutationFailEvidence(options.runDir, caseNo);
      if (deterministicFail) {
        row.getCell(statusCol).value = "FAIL";
        if (verdictCol) row.getCell(verdictCol).value = "FAIL_INTERACTION_FAILED";
        const failDetail = buildDeterministicFailDetail({
          runId: options.runId,
          caseNo,
          previousDetail: detail,
          failEvidence: deterministicFail
        });
        row.getCell(detailCol).value = JSON.stringify(failDetail, null, 2);
        appendGeneratedBugRow(bugSheet, caseNo, failDetail);
        rows.push({
          rowNo,
          caseNo,
          status,
          action: "deterministic_helper_fail",
          reason: typeof deterministicFail.failureClassification === "string" ? deterministicFail.failureClassification : "deterministic helper failure evidence"
        });
        updated = true;
        continue;
      }
      const visualFallback = visualFallbackBlockedEvidence(
        options.runDir,
        caseNo,
        detail,
        verdictCol ? text(row.getCell(verdictCol).value) : ""
      );
      if (visualFallback) {
        row.getCell(statusCol).value = "BLOCKED";
        if (verdictCol) row.getCell(verdictCol).value = "BLOCKED_NEEDS_VISUAL_REVIEW";
        row.getCell(detailCol).value = JSON.stringify(buildVisualFallbackBlockedDetail({
          runId: options.runId,
          caseNo,
          previousDetail: detail,
          blockedEvidence: visualFallback
        }), null, 2);
        rows.push({
          rowNo,
          caseNo,
          status,
          action: "completed_visual_fallback_contract",
          reason: "BLOCKED_NEEDS_VISUAL_REVIEW"
        });
        updated = true;
        continue;
      }
      rows.push({ rowNo, caseNo, status, action: "unchanged", reason: "current-run evidence already present" });
      continue;
    }

    const deterministicPass = deterministicHelperPassEvidence(options.runDir, caseNo);
    if (deterministicPass) {
      row.getCell(statusCol).value = "PASS";
      if (verdictCol) row.getCell(verdictCol).value = "";
      row.getCell(detailCol).value = JSON.stringify(buildDeterministicPassDetail({
        runId: options.runId,
        caseNo,
        previousDetail: detail,
        passEvidence: deterministicPass
      }), null, 2);
      rows.push({
        rowNo,
        caseNo,
        status,
        action: "deterministic_helper_pass",
        reason: typeof deterministicPass.evidenceType === "string" ? deterministicPass.evidenceType : "deterministic helper evidence"
      });
      updated = true;
      continue;
    }

    const deterministicFail = deterministicFrontendObservationFailEvidence(options.runDir, caseNo) ??
      deterministicReportMutationFailEvidence(options.runDir, caseNo);
    if (deterministicFail) {
      row.getCell(statusCol).value = "FAIL";
      if (verdictCol) row.getCell(verdictCol).value = "FAIL_INTERACTION_FAILED";
      const failDetail = buildDeterministicFailDetail({
        runId: options.runId,
        caseNo,
        previousDetail: detail,
        failEvidence: deterministicFail
      });
      row.getCell(detailCol).value = JSON.stringify(failDetail, null, 2);
      appendGeneratedBugRow(bugSheet, caseNo, failDetail);
      rows.push({
        rowNo,
        caseNo,
        status,
        action: "deterministic_helper_fail",
        reason: typeof deterministicFail.failureClassification === "string" ? deterministicFail.failureClassification : "deterministic helper failure evidence"
      });
      updated = true;
      continue;
    }

    const visualFallback = visualFallbackBlockedEvidence(
      options.runDir,
      caseNo,
      detail,
      verdictCol ? text(row.getCell(verdictCol).value) : ""
    );
    if (visualFallback) {
      row.getCell(statusCol).value = "BLOCKED";
      if (verdictCol) row.getCell(verdictCol).value = "BLOCKED_NEEDS_VISUAL_REVIEW";
      row.getCell(detailCol).value = JSON.stringify(buildVisualFallbackBlockedDetail({
        runId: options.runId,
        caseNo,
        previousDetail: detail,
        blockedEvidence: visualFallback
      }), null, 2);
      rows.push({
        rowNo,
        caseNo,
        status,
        action: "completed_visual_fallback_contract",
        reason: "BLOCKED_NEEDS_VISUAL_REVIEW"
      });
      updated = true;
      continue;
    }

    detail.currentRunEvidence = buildBlockedEvidence({
      runId: options.runId,
      runDir: options.runDir,
      caseNo
    });
    row.getCell(detailCol).value = JSON.stringify(detail, null, 2);
    rows.push({ rowNo, caseNo, status, action: "added_blocked_current_run_evidence" });
    updated = true;
  }

  if (updated) await workbook.xlsx.writeFile(options.filePath);

  return {
    schemaVersion: "result-evidence-enrichment-v1",
    generatedAt: new Date().toISOString(),
    filePath: options.filePath,
    runId: options.runId,
    status: updated ? "updated" : "unchanged",
    rows
  };
};
