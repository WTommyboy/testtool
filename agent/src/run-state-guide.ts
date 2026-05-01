import fs from "node:fs";
import path from "node:path";
import type { CaseManifestCase, CaseManifestResult } from "./case-manifest";

const readCurrentCase = (caseManifest: CaseManifestResult): CaseManifestCase | null => {
  if (!caseManifest.currentCasePath || !fs.existsSync(caseManifest.currentCasePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(caseManifest.currentCasePath, "utf8")) as CaseManifestCase;
  } catch {
    return null;
  }
};

export const writeRunStateGuide = (runDir: string, runId: string, caseManifest: CaseManifestResult): string => {
  const currentCase = readCurrentCase(caseManifest);
  const filePath = path.join(runDir, "input", "run-state.json");
  const state = {
    schemaVersion: "run-state-v1",
    generatedAt: new Date().toISOString(),
    runId,
    currentCase: currentCase
      ? {
          caseNo: currentCase.caseNo,
          order: currentCase.order,
          caseFile: currentCase.currentCaseFile,
          groupId: currentCase.groupId,
          groupName: currentCase.groupName
        }
      : null,
    currentCaseSelection: caseManifest.currentCaseSelection,
    carryover: {
      baseline: {
        value: null,
        allowedFor: ["cases that explicitly require current-run baseline comparison"],
        policy: "Must be captured in this run before use; never inherit from prior run or chat summary."
      },
      createdReports: {
        value: [],
        allowedFor: ["reopen/delete/cleanup cases that explicitly reference a report created earlier in this same run"],
        policy: "Each item must include createdInCase, reportName or reportId, and current-run evidence path."
      },
      userApprovals: {
        value: [],
        allowedFor: ["the exact request_id approved by Tool Bridge"],
        policy: "Approval never carries over to a different action, case, or native dialog."
      }
    },
    isolated: {
      lastCaseEvidence: {
        policy: "STRICTLY_FORBIDDEN_FOR_CARRYOVER",
        reason: "Evidence is per-case. It can be referenced for traceability but cannot prove a later case."
      },
      previousCaseUiState: {
        policy: "RECHECK_BEFORE_USE",
        reason: "UI state may persist, but every case must perform its own state cleanup and verification."
      },
      priorWorkbookRows: {
        policy: "STALE_EVIDENCE",
        reason: "Rows from uploaded workbook or previous outputs are not current-run evidence."
      }
    },
    updateProtocol: [
      "After completing a case, update output/run-state.json if new carryover is created.",
      "Only write carryover that is explicitly allowed above.",
      "Never store per-case evidence as reusable proof for a later case.",
      "Before starting the next case, read only that next case JSON and the allowed carryover needed for it."
    ],
    batchGuard: {
      policy: "ONE_CASE_AT_A_TIME",
      rule: "Do not execute or write results for more than one case in a single Playwright tool call or single result write.",
      manifestIsIndexOnly: true
    }
  };
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
  return filePath;
};
