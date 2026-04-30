import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type EvidenceArtifactUploadStatus = "pending" | "uploaded" | "failed" | "skipped";

export type EvidenceArtifactManifestEntry = {
  artifactId: string;
  runId: string;
  caseId: string | null;
  action: string | null;
  artifactType: string;
  localPath: string;
  relativePath: string;
  checksum: string;
  sizeBytes: number;
  createdAt: string;
  source: string;
  retentionClass: string;
  uploadStatus: EvidenceArtifactUploadStatus;
  uploadedAt?: string | null;
  remoteArtifactId?: string | null;
  remoteUrl?: string | null;
  uploadError?: string | null;
};

export type EvidenceArtifactManifest = {
  schemaVersion: "uat-evidence-artifacts-manifest-v1";
  generatedAt: string;
  runId: string;
  artifactCount: number;
  uploadedCount: number;
  failedCount: number;
  entries: EvidenceArtifactManifestEntry[];
};

export type EvidenceArtifactManifestResult = {
  manifestPath: string;
  manifest: EvidenceArtifactManifest;
};

const MANIFEST_FILE_NAME = "evidence-artifacts-manifest.json";
const MAX_ARTIFACTS = 120;

const sha256File = (filePath: string): string => {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
};

const writeJson = (filePath: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const readPriorManifest = (manifestPath: string, runId: string): EvidenceArtifactManifest | null => {
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as EvidenceArtifactManifest;
    if (parsed.schemaVersion !== "uat-evidence-artifacts-manifest-v1" || parsed.runId !== runId) return null;
    return parsed;
  } catch {
    return null;
  }
};

const walkFiles = (root: string): string[] => {
  if (!fs.existsSync(root)) return [];
  const stat = fs.statSync(root);
  if (stat.isFile()) return [root];
  if (!stat.isDirectory()) return [];

  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
};

const isAllowedEvidenceFile = (filePath: string): boolean => {
  const ext = path.extname(filePath).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".json", ".jsonl", ".log", ".txt"].includes(ext);
};

const inferCaseId = (relativePath: string): string | null => {
  const parts = relativePath.split(path.sep);
  const helperIndex = parts.indexOf("helper-artifacts");
  if (helperIndex >= 0 && parts[helperIndex + 1]) return parts[helperIndex + 1];

  const archiveIndex = parts.indexOf("helper-artifacts-archive");
  if (archiveIndex >= 0 && parts[archiveIndex + 2]) return parts[archiveIndex + 2];

  const match = relativePath.match(/(?:^|[/\\])([A-Z]+-[A-Z]-\d{2}|[A-Z]+-\d{2})(?:[/\\]|-|_)/i);
  return match?.[1] ?? null;
};

const inferArtifactType = (relativePath: string): string => {
  const ext = path.extname(relativePath).toLowerCase();
  const base = path.basename(relativePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return "screenshot";
  if (/locator-drift/.test(base)) return "locator_drift";
  if (base === "helper-report.jsonl") return "helper_report";
  if (relativePath.includes(`${path.sep}helper-artifacts${path.sep}`) && ext === ".json") return "helper_json";
  if (relativePath.includes(`${path.sep}mcp-output${path.sep}`)) return "mcp_artifact";
  if (ext === ".jsonl") return "jsonl";
  if (ext === ".json") return "json";
  if (ext === ".log" || ext === ".txt") return "log";
  return "artifact";
};

const inferAction = (relativePath: string): string | null => {
  const base = path.basename(relativePath);
  if (base === "helper-report.jsonl") return "helper-report";
  const latest = base.match(/^(.+)-latest\.json$/);
  if (latest?.[1]) return latest[1];
  const screenshot = base.match(/^(.+?)\.(png|jpe?g|webp)$/i);
  if (screenshot?.[1]) return screenshot[1];
  if (/locator-drift/i.test(base)) return "locator-drift";
  return null;
};

const sourceForRelativePath = (relativePath: string): string => {
  if (relativePath.includes(`${path.sep}helper-artifacts${path.sep}`)) return "mac-agent-bi-ui-helper";
  if (relativePath.includes(`${path.sep}mcp-output${path.sep}`)) return "codex-playwright-mcp";
  if (/locator-drift/i.test(relativePath)) return "codex-locator-drift";
  return "uat-agent-output";
};

const retentionClassForType = (artifactType: string): string => {
  if (artifactType === "screenshot" || artifactType === "helper_report" || artifactType === "locator_drift") return "uat-evidence";
  return "uat-debug";
};

const candidateFiles = (runDir: string): string[] => {
  const outputDir = path.join(runDir, "output");
  const outputRootFiles = fs.existsSync(outputDir)
    ? fs.readdirSync(outputDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(outputDir, entry.name))
      .filter((filePath) => [".png", ".jpg", ".jpeg", ".webp"].includes(path.extname(filePath).toLowerCase()))
    : [];
  const candidates = [
    ...walkFiles(path.join(outputDir, "helper-artifacts")),
    ...walkFiles(path.join(outputDir, "helper-artifacts-archive")),
    ...walkFiles(path.join(outputDir, "screenshots")),
    ...walkFiles(path.join(runDir, "artifacts")),
    ...walkFiles(path.join(runDir, "mcp-output")),
    ...outputRootFiles,
    path.join(outputDir, "locator-drift.log"),
    path.join(outputDir, "locator-drift.jsonl"),
    path.join(outputDir, "helper-pre-run-summary.json"),
    path.join(outputDir, "helper-artifacts-cleanup.json")
  ];
  return [...new Set(candidates)]
    .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile())
    .filter((filePath) => path.basename(filePath) !== MANIFEST_FILE_NAME)
    .filter(isAllowedEvidenceFile);
};

const sortPriority = (entry: EvidenceArtifactManifestEntry): number => {
  if (entry.artifactType === "screenshot") return 10;
  if (entry.artifactType === "helper_report") return 20;
  if (entry.artifactType === "locator_drift") return 30;
  if (entry.source === "mac-agent-bi-ui-helper") return 40;
  return 50;
};

export const collectEvidenceArtifactManifest = (runDir: string, runId: string): EvidenceArtifactManifestResult => {
  const manifestPath = path.join(runDir, "output", MANIFEST_FILE_NAME);
  const prior = readPriorManifest(manifestPath, runId);
  const priorByKey = new Map(
    (prior?.entries ?? []).map((entry) => [`${entry.relativePath}|${entry.checksum}`, entry])
  );

  const entries = candidateFiles(runDir).map((filePath): EvidenceArtifactManifestEntry => {
    const stat = fs.statSync(filePath);
    const relativePath = path.relative(runDir, filePath);
    const checksum = sha256File(filePath);
    const priorEntry = priorByKey.get(`${relativePath}|${checksum}`);
    const artifactType = inferArtifactType(relativePath);
    return {
      artifactId: priorEntry?.artifactId ?? crypto.randomUUID(),
      runId,
      caseId: inferCaseId(relativePath),
      action: inferAction(relativePath),
      artifactType,
      localPath: filePath,
      relativePath,
      checksum,
      sizeBytes: stat.size,
      createdAt: stat.mtime.toISOString(),
      source: sourceForRelativePath(relativePath),
      retentionClass: retentionClassForType(artifactType),
      uploadStatus: priorEntry?.uploadStatus === "uploaded" ? "uploaded" : "pending",
      uploadedAt: priorEntry?.uploadStatus === "uploaded" ? priorEntry.uploadedAt ?? null : null,
      remoteArtifactId: priorEntry?.uploadStatus === "uploaded" ? priorEntry.remoteArtifactId ?? null : null,
      remoteUrl: priorEntry?.uploadStatus === "uploaded" ? priorEntry.remoteUrl ?? null : null,
      uploadError: priorEntry?.uploadStatus === "uploaded" ? null : priorEntry?.uploadError ?? null
    };
  });

  entries.sort((a, b) => sortPriority(a) - sortPriority(b) || a.relativePath.localeCompare(b.relativePath));
  const limitedEntries = entries.slice(0, MAX_ARTIFACTS);
  const manifest: EvidenceArtifactManifest = {
    schemaVersion: "uat-evidence-artifacts-manifest-v1",
    generatedAt: new Date().toISOString(),
    runId,
    artifactCount: limitedEntries.length,
    uploadedCount: limitedEntries.filter((entry) => entry.uploadStatus === "uploaded").length,
    failedCount: limitedEntries.filter((entry) => entry.uploadStatus === "failed").length,
    entries: limitedEntries
  };
  writeJson(manifestPath, manifest);
  return { manifestPath, manifest };
};

export const writeEvidenceArtifactManifest = (
  manifestPath: string,
  manifest: EvidenceArtifactManifest
): void => {
  manifest.artifactCount = manifest.entries.length;
  manifest.uploadedCount = manifest.entries.filter((entry) => entry.uploadStatus === "uploaded").length;
  manifest.failedCount = manifest.entries.filter((entry) => entry.uploadStatus === "failed").length;
  manifest.generatedAt = new Date().toISOString();
  writeJson(manifestPath, manifest);
};

export const readLocatorDriftArtifacts = (runDir: string): Array<Record<string, unknown>> => {
  const outputDir = path.join(runDir, "output");
  const paths = [path.join(outputDir, "locator-drift.jsonl"), path.join(outputDir, "locator-drift.log")];
  const items: Array<Record<string, unknown>> = [];
  for (const filePath of paths) {
    if (!fs.existsSync(filePath)) continue;
    const relativePath = path.relative(runDir, filePath);
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const [index, line] of lines.entries()) {
      try {
        const parsed = JSON.parse(line) as unknown;
        items.push({
          source: relativePath,
          line: index + 1,
          entry: parsed
        });
      } catch {
        items.push({
          source: relativePath,
          line: index + 1,
          raw: line
        });
      }
    }
  }
  return items;
};
