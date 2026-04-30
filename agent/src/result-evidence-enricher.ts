import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

export type ResultEvidenceEnrichmentRow = {
  rowNo: number;
  caseNo: string;
  status: string;
  action: "added_blocked_current_run_evidence" | "unchanged" | "skipped";
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
  const caseCol = findColumn(header, ["編號", "case_no", "caseno", "案例編號"]);
  const statusCol = findColumn(header, ["結果", "status"]);
  const detailCol = findColumn(header, ["詳細紀錄JSON", "詳細紀錄json", "detail_json", "detailjson"]);
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
      rows.push({ rowNo, caseNo, status, action: "unchanged", reason: "current-run evidence already present" });
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
