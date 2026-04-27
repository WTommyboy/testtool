import fs from "node:fs";
import path from "node:path";
import type { CaseManifestCase, CaseManifestResult } from "./case-manifest";
import type { StartCaseHint } from "./start-case";

export type DocumentConsistencyIssue = {
  severity: "warning" | "error";
  code: string;
  message: string;
  context?: Record<string, unknown>;
};

const hasResultEvidence = (item: CaseManifestCase): boolean => {
  const status = item.resultStatus?.trim();
  const detailJson = item.detailJson?.trim();
  return Boolean(status && !/^pending$/i.test(status)) || Boolean(detailJson);
};

const writeJson = (filePath: string, value: unknown): void => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

export const writeDocumentConsistency = (
  runDir: string,
  caseManifest: CaseManifestResult,
  startCaseHint: StartCaseHint | null
): string => {
  const issues: DocumentConsistencyIssue[] = [];
  const selectedCaseNo = caseManifest.currentCaseNo;
  const requestedCaseNo = startCaseHint?.caseNo ?? caseManifest.currentCaseSelection?.requestedCaseNo ?? null;
  const selectedCase = caseManifest.cases.find((item) => item.caseNo === selectedCaseNo) ?? null;
  const precedingCases = selectedCase
    ? caseManifest.cases.filter((item) => item.order < selectedCase.order)
    : [];
  const unfinishedPrecedingCases = precedingCases.filter((item) => !hasResultEvidence(item));

  if (caseManifest.currentCaseSelection?.reason === "requested_case_not_found") {
    issues.push({
      severity: "error",
      code: "START_CASE_NOT_FOUND",
      message: `startup instruction requested ${requestedCaseNo ?? "(unknown)"} but that case was not found in the workbook.`,
      context: {
        requestedCaseNo,
        availableCaseNos: caseManifest.cases.map((item) => item.caseNo)
      }
    });
  }

  if (startCaseHint && selectedCase && unfinishedPrecedingCases.length > 0) {
    issues.push({
      severity: "error",
      code: "START_CASE_SKIPS_UNFINISHED_PRECEDING_CASES",
      message:
        "startup instruction selects a later current case, but preceding workbook rows do not contain completed result evidence. This is a document conflict and must be resolved by PM/Tool Bridge before browser execution.",
      context: {
        requestedCaseNo,
        selectedCaseNo,
        selectedCaseOrder: selectedCase.order,
        unfinishedPrecedingCases: unfinishedPrecedingCases.map((item) => ({
          caseNo: item.caseNo,
          order: item.order,
          resultStatus: item.resultStatus,
          hasDetailJson: Boolean(item.detailJson)
        }))
      }
    });
  }

  const status = issues.some((item) => item.severity === "error")
    ? "error"
    : issues.some((item) => item.severity === "warning")
      ? "warning"
      : "ok";

  const filePath = path.join(runDir, "input", "document-consistency.json");
  writeJson(filePath, {
    schemaVersion: "document-consistency-v1",
    generatedAt: new Date().toISOString(),
    status,
    selectedCaseNo,
    requestedCaseNo,
    startCaseHint,
    currentCaseSelection: caseManifest.currentCaseSelection,
    checks: [
      "If status=error, Codex must not touch the browser.",
      "If startup instruction skips earlier workbook cases that are not marked completed in the workbook, emit Tool Bridge ambiguity_decision.",
      "Workbook rows from previous runs are stale evidence unless this run packet explicitly allows same-run carryover."
    ],
    precedingCases: precedingCases.map((item) => ({
      caseNo: item.caseNo,
      order: item.order,
      resultStatus: item.resultStatus,
      hasDetailJson: Boolean(item.detailJson)
    })),
    issues
  });
  return filePath;
};
