import fs from "node:fs";
import path from "node:path";

export type SupportingDocEntry = {
  key: string;
  role: "startup_instruction" | "testcase_markdown" | "supporting_doc" | "reference_csv" | "domain_file" | "unknown";
  path: string;
  summary: string;
  profile?: Record<string, unknown>;
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

const parseCsvRows = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
};

const profileFor = (key: string, filePath: string): Record<string, unknown> | undefined => {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return undefined;
  const stat = fs.statSync(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const base = {
    fileName: path.basename(filePath),
    extension,
    sizeBytes: stat.size
  };
  if (extension === ".csv") {
    const rows = parseCsvRows(fs.readFileSync(filePath, "utf8"));
    const header = rows[0] ?? [];
    const normalizedHeader = header.map((item) => item.trim());
    const roleHints = [
      key === "baseline" ? "reference_csv" : null,
      /metadata/i.test(path.basename(filePath)) ||
      (normalizedHeader.includes("欄位名稱") &&
        normalizedHeader.includes("來源報表") &&
        normalizedHeader.includes("所屬報表是否可用於拼貼模式主選擇"))
        ? "metadata_candidate"
        : null
    ].filter(Boolean);
    return {
      ...base,
      csv: {
        rowCount: Math.max(0, rows.length - 1),
        header: normalizedHeader,
        roleHints
      }
    };
  }
  if (extension === ".md" || extension === ".txt") {
    const text = fs.readFileSync(filePath, "utf8");
    const headings = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^#{1,6}\s+\S/.test(line))
      .slice(0, 20);
    return {
      ...base,
      text: {
        lineCount: text.split(/\r?\n/).length,
        headings
      }
    };
  }
  return base;
};

export const writeSupportingDocsManifest = (runDir: string, inputs: Record<string, string>): string => {
  const entries: SupportingDocEntry[] = Object.entries(inputs)
    .map(([key, filePath]) => ({
      key,
      role: roleForKey(key),
      path: filePath,
      summary: summaryFor(key, filePath),
      profile: profileFor(key, filePath)
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
      "Use entry.profile for lightweight file decomposition (CSV headers/row counts, text headings) before deciding which optional support file to read in full.",
      "Do not bulk-read every supporting document before preflight and current-case review."
    ],
    entries
  };

  const filePath = path.join(runDir, "input", "supporting-docs-manifest.json");
  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
  return filePath;
};
