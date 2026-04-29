import fs from "node:fs";
import path from "node:path";

export type ReferenceIndexInput = {
  runDir: string;
  inputs: Record<string, string>;
  generated: Record<string, string | null | undefined>;
};

const exists = (filePath: string | null | undefined): boolean =>
  Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile());

const roleForGeneratedKey = (key: string): string => {
  const roles: Record<string, string> = {
    runBrief: "compact run entrypoint",
    testPackageConsistency: "test package design consistency report",
    documentConsistency: "document conflict gate",
    currentCasePack: "current case execution card",
    currentCasePackJson: "current case structured execution card",
    ruleIndex: "progressive disclosure rule index",
    supportingDocsManifest: "downloaded document roles",
    evidenceTemplateIndex: "evidence schema index",
    helperExecutionPlan: "helper-assisted UI execution plan",
    helperExecutionPlanJson: "structured helper-assisted UI execution plan",
    resultTemplate: "result workbook template reference",
    networkObservationGuidance: "network observation guidance",
    preflightGuidance: "auth/reachability preflight",
    runState: "carryover and stale-evidence boundary",
    biUiHelperGuidance: "safe BI UI helper guidance"
  };
  return roles[key] ?? key;
};

export const writeReferenceIndex = ({ runDir, inputs, generated }: ReferenceIndexInput): string => {
  const filePath = path.join(runDir, "input", "reference-index.json");
  const inputEntries = Object.entries(inputs).map(([key, inputPath]) => ({
    key,
    role: key.startsWith("supporting_doc_")
      ? "supporting document"
      : key.startsWith("domain_")
        ? "domain pack"
        : key,
    path: inputPath,
    exists: exists(inputPath)
  }));
  const generatedEntries = Object.entries(generated).map(([key, generatedPath]) => ({
    key,
    role: roleForGeneratedKey(key),
    path: generatedPath ?? null,
    exists: key === "runBrief" ? true : exists(generatedPath)
  }));
  const metadataPath = path.join(runDir, "rules", "BI_DATA", "metadata.csv");
  const projectAgentsPath = path.join(runDir, "rules", "PROJECT_AGENTS_FULL.md");
  const biRulesDir = path.join(runDir, "rules", "BI_TEST_RULES");

  const localReferences = [
    {
      key: "bi_metadata_csv",
      role: "authoritative copied BI metadata CSV when present",
      path: metadataPath,
      exists: exists(metadataPath)
    },
    {
      key: "project_agents_full",
      role: "legacy BI domain reference copied from workspace AGENTS.md",
      path: projectAgentsPath,
      exists: exists(projectAgentsPath)
    },
    {
      key: "bi_test_rules_dir",
      role: "BI rulebook directory copied from workspace",
      path: biRulesDir,
      exists: fs.existsSync(biRulesDir) && fs.statSync(biRulesDir).isDirectory()
    }
  ];

  fs.writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        schemaVersion: "reference-index-v1",
        generatedAt: new Date().toISOString(),
        policy: [
          "Use exact paths from this file before doing broad filesystem search.",
          "Do not bulk-read every reference file during startup.",
          "Only load supporting documents that the current-case-pack or rule-index says are needed.",
          "If a referenced file is missing, report the missing file instead of guessing."
        ],
        inputs: inputEntries,
        generated: generatedEntries,
        localReferences
      },
      null,
      2
    )}\n`
  );
  return filePath;
};
