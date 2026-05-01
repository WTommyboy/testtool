import fs from "node:fs";
import path from "node:path";

const writeJson = (filePath: string, value: unknown): void => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

export type EvidenceTemplateFiles = {
  indexPath: string;
  directory: string;
};

export const writeEvidenceTemplates = (runDir: string): EvidenceTemplateFiles => {
  const directory = path.join(runDir, "input", "evidence-templates");
  fs.mkdirSync(directory, { recursive: true });

  const templates = [
    {
      id: "metadata-dropdown",
      file: "metadata-dropdown-evidence.json",
      summary: "For dropdown/source-list metadata comparison cases.",
      requiredFields: [
        "caseNo",
        "sourceGroupLabel",
        "actualVisibleItems",
        "actualCount",
        "expectedSource",
        "expectedCount",
        "normalizationNotes",
        "verdict"
      ],
      policy: [
        "DOM extraction is primary evidence.",
        "Screenshot is supplementary and should not block if DOM evidence is complete.",
        "Field naming differences must be normalized before deciding PASS/FAIL."
      ]
    },
    {
      id: "network-request",
      file: "network-request-evidence.json",
      summary: "For request body/response verification cases.",
      requiredFields: [
        "caseNo",
        "uiAction",
        "requestUrl",
        "requestMethod",
        "requestBodyRelevantFields",
        "responseStatus",
        "responseSummary",
        "verdict"
      ],
      policy: [
        "Network observation must be caused by UI action in this run.",
        "Do not call BI API directly as the test action.",
        "When checking stale value cleanup, record the exact filter/value fields observed in request body."
      ]
    },
    {
      id: "chart-datasets",
      file: "chart-datasets-evidence.json",
      summary: "For chart/table numeric result cases.",
      requiredFields: [
        "caseNo",
        "uiAction",
        "dataSource",
        "labels",
        "data",
        "summary",
        "baselineComparison",
        "verdict"
      ],
      policy: [
        "Read chart/table data with read-only DOM/page evaluate.",
        "Do not use internal JS setters to configure state.",
        "Numeric PASS requires concrete values, not screenshot-only evidence."
      ]
    },
    {
      id: "downloaded-csv",
      file: "downloaded-csv-evidence.json",
      summary: "For UI-triggered CSV download and preview consistency cases.",
      requiredFields: [
        "caseNo",
        "uiDownloadAction",
        "downloadedCsvPath",
        "suggestedFilename",
        "csvHeader",
        "csvRowCount",
        "previewEvidencePath",
        "previewComparison",
        "notReachedReason",
        "verdict"
      ],
      policy: [
        "CSV must be produced by a visible UI download action or an explicitly provided run packet file.",
        "The Agent may read the downloaded local CSV file after the UI download succeeds.",
        "If save/reopen or preview preconditions fail before download, record the failed earlier subcondition as the primary result and mark CSV comparison as not reached."
      ]
    },
    {
      id: "ui-workflow",
      file: "ui-workflow-evidence.json",
      summary: "For create/save/reopen/delete or multi-step UI workflow cases.",
      requiredFields: [
        "caseNo",
        "beforeState",
        "actions",
        "afterState",
        "toolBridgeRequestId",
        "screenshotPathOrUnavailableReason",
        "verdict"
      ],
      policy: [
        "Native dialog, confirm, delete, overwrite, and irreversible operation require Tool Bridge approval.",
        "Use timestamped temporary resources for create/delete tests.",
        "Existing resource presence is not evidence that this run created it."
      ]
    }
  ];

  for (const template of templates) {
    writeJson(path.join(directory, template.file), {
      schemaVersion: "evidence-template-v1",
      ...template
    });
  }

  const indexPath = path.join(directory, "index.json");
  writeJson(indexPath, {
    schemaVersion: "evidence-template-index-v1",
    generatedAt: new Date().toISOString(),
    policy: [
      "Templates describe required evidence fields only; they are not testcase results.",
      "Use the current-case-pack evidenceTemplates list to choose the smallest template set.",
      "Do not fill evidence for multiple cases in one payload."
    ],
    templates: templates.map((template) => ({
      id: template.id,
      path: path.join(directory, template.file),
      summary: template.summary
    }))
  });

  return { indexPath, directory };
};
