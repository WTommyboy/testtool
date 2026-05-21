import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

export type ResultEvidenceEnrichmentRow = {
  rowNo: number;
  caseNo: string;
  status: string;
  action: "added_blocked_current_run_evidence" | "deterministic_helper_pass" | "deterministic_helper_fail" | "unchanged" | "skipped";
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
  const roots = [
    path.join(runDir, "output", "helper-artifacts"),
    path.join(runDir, "output", "helper-artifacts-archive")
  ];
  const matches: string[] = [];
  const visit = (dir: string, depth: number): void => {
    if (!fs.existsSync(dir) || depth > 5) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === fileName && entryPath.includes(`${path.sep}${caseNo}${path.sep}`)) {
        matches.push(entryPath);
      } else if (entry.isDirectory()) {
        visit(entryPath, depth + 1);
      }
    }
  };
  roots.forEach((root) => visit(root, 0));
  return matches.sort().at(-1) ?? null;
};

const objectValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const arrayValue = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.flatMap((item) => objectValue(item) ? [objectValue(item) as Record<string, unknown>] : []) : [];

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
      interactionLog: state.interactionLog ?? null
    }
  };
};

const deterministicHelperPassEvidence = (runDir: string, caseNo: string): Record<string, unknown> | null =>
  deterministicDateVariantPassEvidence(runDir, caseNo) ?? deterministicFrontendObservationPassEvidence(runDir, caseNo);

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

const buildDeterministicPassDetail = (options: {
  runId: string;
  caseNo: string;
  previousDetail: Record<string, unknown>;
  passEvidence: Record<string, unknown>;
}): Record<string, unknown> => ({
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
  實際行為: "Current-run helper evidence was already deterministic and satisfied this case, so the Agent promoted the prior BLOCKED result to PASS instead of leaving it as evidence-insufficient.",
  currentRunEvidence: {
    source: "uat-agent-deterministic-helper-judgment",
    currentRunEvidence: true,
    runId: options.runId,
    caseNo: options.caseNo,
    generatedAt: new Date().toISOString(),
    ...options.passEvidence
  },
  previous_blocked_detail_json: options.previousDetail
});

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
  實際行為: "Current-run helper evidence classified the required frontend observation as FAIL_INTERACTION_FAILED, so the Agent converted the prior BLOCKED result to FAIL instead of leaving it as evidence-insufficient.",
  錯誤原因: "Required frontend interaction or assertion did not reach the expected visible UI state.",
  根因層級: "前端互動/狀態切換",
  驗證方法: "Result evidence enricher read current-run frontend-observation-evidence.json and found recommendedFailureClassification=FAIL_INTERACTION_FAILED.",
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
  set(row, ["Evidence", "evidence"], "Generated by result evidence enricher from current-run frontend-observation-evidence.json.");
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
    if (status !== "BLOCKED") {
      rows.push({ rowNo, caseNo, status, action: "unchanged", reason: "only BLOCKED rows are enriched" });
      continue;
    }

    let detail: Record<string, unknown>;
    try {
      const parsed = JSON.parse(text(row.getCell(detailCol).value)) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
      detail = parsed as Record<string, unknown>;
    } catch {
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
      const deterministicFail = deterministicFrontendObservationFailEvidence(options.runDir, caseNo);
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

    const deterministicFail = deterministicFrontendObservationFailEvidence(options.runDir, caseNo);
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
