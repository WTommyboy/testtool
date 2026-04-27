import fs from "node:fs";
import path from "node:path";

export type SupportingDocEntry = {
  key: string;
  role: "startup_instruction" | "testcase_markdown" | "supporting_doc" | "reference_csv" | "domain_file" | "unknown";
  path: string;
  summary: string;
};

const roleForKey = (key: string): SupportingDocEntry["role"] => {
  if (key === "startup_instruction") return "startup_instruction";
  if (key === "md") return "testcase_markdown";
  if (key === "baseline") return "reference_csv";
  if (key.startsWith("supporting_doc_")) return "supporting_doc";
  if (key.startsWith("domain_")) return "domain_file";
  return "unknown";
};

const summaryFor = (key: string, filePath: string): string => {
  const name = path.basename(filePath);
  if (key === "startup_instruction") return "Primary startup / dispatch instruction. Use for run-specific scope and start-case hints.";
  if (key === "md") return "Uploaded testcase markdown. Use as execution guide when startup instruction points to it.";
  if (key === "baseline") return "Uploaded reference CSV. Use only when the current case requires reference comparison.";
  if (key.startsWith("supporting_doc_")) return `Supporting markdown/reference document: ${name}`;
  if (key.startsWith("domain_")) return `Domain pack file: ${name}`;
  return `Downloaded input file: ${name}`;
};

export const writeSupportingDocsManifest = (runDir: string, inputs: Record<string, string>): string => {
  const entries: SupportingDocEntry[] = Object.entries(inputs)
    .map(([key, filePath]) => ({
      key,
      role: roleForKey(key),
      path: filePath,
      summary: summaryFor(key, filePath)
    }))
    .sort((a, b) => {
      const order = ["startup_instruction", "testcase_markdown", "supporting_doc", "reference_csv", "domain_file", "unknown"];
      return order.indexOf(a.role) - order.indexOf(b.role) || a.key.localeCompare(b.key);
    });

  const manifest = {
    schemaVersion: "supporting-docs-manifest-v1",
    generatedAt: new Date().toISOString(),
    policy: [
      "Use startup_instruction for run-specific scope and start case.",
      "Use testcase_markdown/supporting_doc only when the current case needs details not present in current-case-pack.",
      "Do not bulk-read every supporting document before preflight and current-case review."
    ],
    entries
  };

  const filePath = path.join(runDir, "input", "supporting-docs-manifest.json");
  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
  return filePath;
};
