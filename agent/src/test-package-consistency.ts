import fs from "node:fs";
import path from "node:path";
import type { CaseManifestCase, CaseManifestResult } from "./case-manifest";
import type { DocumentConsistencyIssue } from "./document-consistency";
import { findHelperHints, parseHelperHintsFromMarkdown } from "./helper-hints";
import { detectStartCaseHint, type StartCaseHint } from "./start-case";

export type TestPackageConsistencyReport = {
  schemaVersion: "test-package-consistency-v1";
  generatedAt: string;
  status: "ok" | "warning" | "error";
  sources: {
    xlsxPath: string | null;
    assignmentPath: string | null;
    instructionPath: string | null;
    helperHintSourcePaths: string[];
  };
  caseCount: number;
  caseNos: string[];
  startCaseHints: Array<{ source: string; caseNo: string; excerpt: string }>;
  helperHintsSummary: {
    totalBlocks: number;
    matchedCases: string[];
    missing: boolean;
  };
  issues: DocumentConsistencyIssue[];
};

export type TestPackageConsistencyInput = {
  caseManifest: CaseManifestResult;
  assignmentPath?: string | null;
  instructionPath?: string | null;
  helperHintSourcePaths?: string[];
  startCaseHint?: StartCaseHint | null;
  xlsxPath?: string | null;
  baseDir?: string;
};

const CASE_ID_PATTERN = /\b(?:DEMO-)?[A-Z]+(?:-[A-Z]+)?-\d{1,3}\b/g;
const ALLOWED_RISK_LEVELS = new Set(["🟢 觀察", "🟡 建立", "🟠 修改", "🔴 刪除"]);
const ALLOWED_TEST_TARGETS = new Set(["後端功能", "前端呈現", "前後端整合", "功能流程"]);
const CLEANUP_KEYS = ["欄位", "篩選", "分組", "時間", "顯示"];

const readText = (filePath: string | null | undefined): string | null => {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  return fs.readFileSync(filePath, "utf8");
};

const compact = (value: string): string => value.replace(/\s+/g, " ").trim();

const stripMarkdown = (value: string): string =>
  value.replace(/\*\*/g, "").replace(/`/g, "").replace(/[，,]\s*$/, "").trim();

const stripMarkdownCode = (value: string): string =>
  value.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");

const normalizeCaseNo = (value: string): string => value.trim().replace(/\s+/g, "").toUpperCase();

const resolveCaseNo = (caseNo: string, knownCaseNos: Set<string>): string => {
  const normalized = normalizeCaseNo(caseNo);
  if (knownCaseNos.has(normalized)) return normalized;
  const demoAlias = normalized.startsWith("DEMO-") ? normalized.replace(/^DEMO-/, "") : `DEMO-${normalized}`;
  if (knownCaseNos.has(demoAlias)) return demoAlias;
  const suffixMatches = [...knownCaseNos].filter((known) => known.endsWith(`-${normalized}`));
  return suffixMatches.length === 1 ? suffixMatches[0] ?? normalized : normalized;
};

const normalizeInline = (value: string | null | undefined): string =>
  stripMarkdown(String(value ?? ""))
    .replace(/\s+/g, "")
    .replace(/：/g, ":")
    .replace(/～/g, "~")
    .trim();

const normalizeCleanup = (value: string | null | undefined): string =>
  normalizeInline(value).replace(/；/g, ";");

const issue = (
  issues: DocumentConsistencyIssue[],
  severity: DocumentConsistencyIssue["severity"],
  code: string,
  message: string,
  context?: Record<string, unknown>
): void => {
  issues.push({ severity, code, message, context });
};

const isNonCaseReference = (caseId: string): boolean => /^BUG-\d{1,3}$/i.test(caseId) || /^[A-Z]-\d$/i.test(caseId);

const extractCaseIds = (text: string): string[] =>
  [...new Set([...text.matchAll(CASE_ID_PATTERN)].map((match) => normalizeCaseNo(match[0] ?? "")))]
    .filter(Boolean)
    .filter((caseId) => !isNonCaseReference(caseId));

const extractStartHint = (text: string, source: string): StartCaseHint | null => {
  const explicit = text.match(
    new RegExp(`(?:起始\\s*case|本輪\\s*Codex\\s*起始\\s*case|start\\s*case)\\**\\s*[:：]?\\s*\\**(${CASE_ID_PATTERN.source})\\**`, "i")
  );
  if (explicit?.[1]) {
    return {
      caseNo: normalizeCaseNo(explicit[1]),
      source,
      excerpt: compact(text.slice(Math.max(0, explicit.index ?? 0), Math.min(text.length, (explicit.index ?? 0) + 160)))
    };
  }
  return detectStartCaseHint({ startupInstructionText: text }) ? { ...detectStartCaseHint({ startupInstructionText: text })!, source } : null;
};

const extractOrderLineCaseIds = (text: string): string[] => {
  const line = text.split(/\r?\n/).find((item) => /執行順序|case\s*order|run\s*order/i.test(item));
  if (line && /(?:\.\.\.|…|依\s*xlsx\s*行順序|完整清單見)/i.test(line)) return [];
  return line ? extractCaseIds(line) : [];
};

const headingSectionForCase = (text: string, caseNo: string): string | null => {
  const target = normalizeCaseNo(caseNo);
  const lines = text.split(/\r?\n/);
  let start = -1;
  let level = 7;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!match) continue;
    if (!normalizeCaseNo(match[2] ?? "").includes(target)) continue;
    start = index;
    level = match[1]?.length ?? 7;
    break;
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index]?.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match && (match[1]?.length ?? 7) <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
};

const extractLabeledValue = (section: string, label: string): string | null => {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = section.match(new RegExp(`\\*\\*${escapedLabel}\\*\\*\\s*[:：]\\s*([^\\n]+)`, "i"));
  return match?.[1] ? stripMarkdown(match[1]) : null;
};

const extractCleanupValue = (section: string): string | null => {
  const inline = extractLabeledValue(section, "狀態清理");
  if (inline && inline.includes("欄位=")) return inline;

  const label = section.match(/\*\*狀態清理\*\*[\s\S]*?(?:\n|$)/);
  if (!label?.index && label?.index !== 0) return null;
  const after = section.slice(label.index + label[0].length);
  const block = after.match(/```(?:text)?\s*([\s\S]*?)```/i);
  if (block?.[1]) return block[1].trim();
  const line = after.split(/\r?\n/).find((item) => item.includes("欄位="));
  return line ? stripMarkdown(line) : null;
};

const parseCleanupKeys = (value: string | null | undefined): string[] =>
  String(value ?? "")
    .split(/[;；]/)
    .map((part) => part.split("=")[0]?.trim())
    .filter(Boolean);

const allHelperBlocks = (text: string, sourcePath: string, baseDir?: string) => {
  const blocks: Array<{ caseId: string | null; sourcePath: string; warnings: string[] }> = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const jsonText = match[1]?.trim();
    if (!jsonText || !/"(?:automationLevel|operationTemplate|requiredEvidence)"\s*:/i.test(jsonText)) continue;
    try {
      const parsed = JSON.parse(jsonText) as { caseId?: unknown };
      const caseId = typeof parsed.caseId === "string" ? normalizeCaseNo(parsed.caseId) : null;
      const parsedHints = caseId
        ? parseHelperHintsFromMarkdown(`### ${caseId}\n\nHelper hints:\n\`\`\`json\n${jsonText}\n\`\`\``, caseId, sourcePath, baseDir)
        : { helperHints: null, warnings: ["HELPER_HINTS_CASE_ID_MISSING"] };
      blocks.push({
        caseId,
        sourcePath,
        warnings: parsedHints.helperHints?.warnings ?? parsedHints.warnings
      });
    } catch (error) {
      blocks.push({
        caseId: null,
        sourcePath,
        warnings: [`HELPER_HINTS_JSON_PARSE_FAILED:${error instanceof Error ? error.message : String(error)}`]
      });
    }
  }
  return blocks;
};

const evidenceBase = (evidence: string): string => evidence.split(".").slice(0, 2).join(".");

const evidenceAppearsInCaseText = (base: string, text: string): boolean => {
  const lower = text.toLowerCase();
  const checks: Record<string, RegExp> = {
    "dom.state": /dom|頁面|畫面|狀態|select|input/i,
    "dom.list": /dom|list|清單|下拉|欄位/i,
    "date.uiState": /日期|時間|date|preset|快捷|區間/i,
    "date.representedRange": /日期|時間|date|起訖|區間|代表|range/i,
    "network.requestBody": /network|request\s*body|payload|dateRange|filters?|request/i,
    "network.responseBody": /network|response|回應|資料/i,
    "chart.datasets": /chart|chart\.js|datasets?|圖表/i,
    "csv.rows": /csv|row|rows|列/i,
    "csv.aggregate": /csv|sum|avg|max|min|aggregate|加總/i,
    screenshot: /screenshot|截圖/i,
    "toolBridge.response": /tool\s*bridge|授權|confirm|alert/i,
    "xlsx.readback": /xlsx|dump|讀回/i
  };
  return checks[base]?.test(lower) ?? lower.includes(base.toLowerCase());
};

const stringLeaves = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => stringLeaves(item));
  if (value && typeof value === "object") return Object.values(value).flatMap((item) => stringLeaves(item));
  return [];
};

export const buildTestPackageConsistencyReport = (input: TestPackageConsistencyInput): TestPackageConsistencyReport => {
  const issues: DocumentConsistencyIssue[] = [];
  const caseNos = input.caseManifest.cases.map((item) => normalizeCaseNo(item.caseNo));
  const caseNoSet = new Set(caseNos);
  const assignmentText = readText(input.assignmentPath);
  const instructionText = readText(input.instructionPath);
  const helperSourcePaths = [...new Set([...(input.helperHintSourcePaths ?? []), input.instructionPath].filter(Boolean) as string[])];
  const helperTexts = helperSourcePaths
    .map((filePath) => ({ filePath, text: readText(filePath) }))
    .filter((item): item is { filePath: string; text: string } => Boolean(item.text));

  if (!input.xlsxPath && !input.caseManifest.manifestPath) {
    issue(issues, "error", "XLSX_SOURCE_MISSING", "No testcase workbook or case manifest path was provided.");
  }
  if (!assignmentText) {
    issue(issues, "error", "ASSIGNMENT_DOC_MISSING", "Codex assignment markdown is missing or unreadable.", {
      assignmentPath: input.assignmentPath
    });
  }
  if (!instructionText) {
    issue(issues, "error", "EXECUTION_INSTRUCTION_DOC_MISSING", "Test execution instruction markdown is missing or unreadable.", {
      instructionPath: input.instructionPath
    });
  }

  for (const item of input.caseManifest.cases) {
    if (!item.riskLevel || !ALLOWED_RISK_LEVELS.has(item.riskLevel)) {
      issue(issues, "error", "XLSX_RISK_LEVEL_INVALID", `Case ${item.caseNo} has missing or non-canonical riskLevel.`, {
        caseNo: item.caseNo,
        riskLevel: item.riskLevel
      });
    }
    if (!item.testTarget || !ALLOWED_TEST_TARGETS.has(item.testTarget)) {
      issue(issues, "error", "XLSX_TEST_TARGET_INVALID", `Case ${item.caseNo} has missing or non-canonical testTarget.`, {
        caseNo: item.caseNo,
        testTarget: item.testTarget
      });
    }
    const cleanupKeys = parseCleanupKeys(item.cleanupChecklist);
    if (CLEANUP_KEYS.some((key, index) => cleanupKeys[index] !== key)) {
      issue(issues, "error", "XLSX_CLEANUP_CHECKLIST_INVALID", `Case ${item.caseNo} cleanupChecklist must use 欄位/篩選/分組/時間/顯示 order.`, {
        caseNo: item.caseNo,
        cleanupChecklist: item.cleanupChecklist,
        parsedKeys: cleanupKeys
      });
    }
  }

  const startHints = [
    assignmentText ? extractStartHint(assignmentText, input.assignmentPath ?? "assignment") : null,
    instructionText ? extractStartHint(instructionText, input.instructionPath ?? "instruction") : null,
    input.startCaseHint ?? null
  ].filter((item): item is StartCaseHint => Boolean(item));
  const uniqueStartCases = [...new Set(startHints.map((item) => resolveCaseNo(item.caseNo, caseNoSet)))];
  if (uniqueStartCases.length > 1) {
    issue(issues, "error", "START_CASE_CONFLICT", "Assignment/instruction/startup hints reference different start cases.", {
      startHints
    });
  }
  for (const hint of startHints) {
    if (!caseNoSet.has(resolveCaseNo(hint.caseNo, caseNoSet))) {
      issue(issues, "error", "START_CASE_NOT_IN_XLSX", `Start case ${hint.caseNo} is not present in testcase workbook.`, {
        hint
      });
    }
  }

  for (const source of [
    { name: "assignment", text: assignmentText },
    { name: "instruction", text: instructionText }
  ]) {
    if (!source.text) continue;
    const orderCaseIds = extractOrderLineCaseIds(source.text).map((caseId) => resolveCaseNo(caseId, caseNoSet));
    const unknownCaseIds = extractCaseIds(stripMarkdownCode(source.text)).filter((caseId) => !caseNoSet.has(resolveCaseNo(caseId, caseNoSet)));
    if (unknownCaseIds.length > 0) {
      issue(issues, "warning", "DOC_REFERENCES_UNKNOWN_CASE", `${source.name} references case ids not found in xlsx.`, {
        source: source.name,
        unknownCaseIds
      });
    }
    if (orderCaseIds.length > 0 && orderCaseIds.join(" > ") !== caseNos.slice(0, orderCaseIds.length).join(" > ")) {
      issue(issues, "error", "EXECUTION_ORDER_CONFLICT", `${source.name} execution order does not match workbook order.`, {
        source: source.name,
        documentOrder: orderCaseIds,
        workbookOrder: caseNos
      });
    }
  }

  if (instructionText) {
    for (const item of input.caseManifest.cases) {
      const section = headingSectionForCase(instructionText, item.caseNo);
      if (!section) {
        issue(issues, "warning", "INSTRUCTION_CASE_SECTION_MISSING", `Instruction markdown has no case section for ${item.caseNo}.`, {
          caseNo: item.caseNo
        });
        continue;
      }
      const instructionRisk = extractLabeledValue(section, "風險等級");
      const instructionTarget = extractLabeledValue(section, "測試標的");
      const instructionCleanup = extractCleanupValue(section);
      if (instructionRisk && normalizeInline(instructionRisk) !== normalizeInline(item.riskLevel)) {
        issue(issues, "error", "RISK_LEVEL_CONFLICT", `Case ${item.caseNo} riskLevel differs between xlsx and instruction.`, {
          caseNo: item.caseNo,
          xlsx: item.riskLevel,
          instruction: instructionRisk
        });
      }
      if (instructionTarget && normalizeInline(instructionTarget) !== normalizeInline(item.testTarget)) {
        issue(issues, "error", "TEST_TARGET_CONFLICT", `Case ${item.caseNo} testTarget differs between xlsx and instruction.`, {
          caseNo: item.caseNo,
          xlsx: item.testTarget,
          instruction: instructionTarget
        });
      }
      if (instructionCleanup && normalizeCleanup(instructionCleanup) !== normalizeCleanup(item.cleanupChecklist)) {
        issue(issues, "error", "CLEANUP_CHECKLIST_CONFLICT", `Case ${item.caseNo} cleanupChecklist differs between xlsx and instruction.`, {
          caseNo: item.caseNo,
          xlsx: item.cleanupChecklist,
          instruction: instructionCleanup
        });
      }
    }
  }

  const helperBlocks = helperTexts.flatMap((item) => allHelperBlocks(item.text, item.filePath, input.baseDir));
  if (helperBlocks.length === 0) {
    issue(issues, "warning", "HELPER_HINTS_NOT_FOUND", "No Helper hints JSON blocks were found. This is allowed for legacy packages but helper guidance will use inference only.");
  }

  const matchedCases: string[] = [];
  for (const block of helperBlocks) {
    if (!block.caseId) {
      issue(issues, "error", "HELPER_HINTS_CASE_ID_MISSING", "Helper hints block is missing caseId.", {
        sourcePath: block.sourcePath
      });
      continue;
    }
    if (!caseNoSet.has(resolveCaseNo(block.caseId, caseNoSet))) {
      issue(issues, "error", "HELPER_HINTS_CASE_NOT_IN_XLSX", `Helper hints caseId ${block.caseId} is not present in xlsx.`, {
        sourcePath: block.sourcePath,
        caseId: block.caseId
      });
      continue;
    }
    matchedCases.push(resolveCaseNo(block.caseId, caseNoSet));
    for (const warning of block.warnings) {
      const severity = /UNKNOWN_|MISSING_FORBIDDEN|MISMATCH|JSON_PARSE|CASE_ID_MISSING/.test(warning) ? "error" : "warning";
      issue(issues, severity, "HELPER_HINTS_INVALID", `Helper hints for ${block.caseId} reported ${warning}.`, {
        sourcePath: block.sourcePath,
        caseId: block.caseId,
        warning
      });
    }
  }

  for (const item of input.caseManifest.cases) {
    const search = findHelperHints(helperSourcePaths, item.caseNo, input.baseDir);
    if (!search.helperHints) continue;
    const caseText = [item.caseTitle, item.preconditions, item.stepsSummary, item.expected, item.validationMethod, item.cleanupChecklist]
      .filter(Boolean)
      .join("\n");
    for (const value of stringLeaves(search.helperHints.params)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value) || value.length < 2) continue;
      if (!caseText.includes(value)) {
        issue(issues, "warning", "HELPER_PARAM_NOT_VISIBLE_IN_XLSX", `Helper param value "${value}" for ${item.caseNo} is not visible in xlsx case text.`, {
          caseNo: item.caseNo,
          value
        });
      }
    }
    for (const evidence of search.helperHints.requiredEvidence) {
      const base = evidenceBase(evidence);
      if (!evidenceAppearsInCaseText(base, caseText)) {
        issue(issues, "warning", "HELPER_EVIDENCE_NOT_VISIBLE_IN_XLSX", `Helper requiredEvidence ${evidence} is not reflected in xlsx validation/steps text.`, {
          caseNo: item.caseNo,
          evidence
        });
      }
    }
  }

  const status = issues.some((item) => item.severity === "error")
    ? "error"
    : issues.some((item) => item.severity === "warning")
      ? "warning"
      : "ok";

  return {
    schemaVersion: "test-package-consistency-v1",
    generatedAt: new Date().toISOString(),
    status,
    sources: {
      xlsxPath: input.xlsxPath ?? input.caseManifest.manifestPath,
      assignmentPath: input.assignmentPath ?? null,
      instructionPath: input.instructionPath ?? null,
      helperHintSourcePaths: helperSourcePaths
    },
    caseCount: input.caseManifest.cases.length,
    caseNos,
    startCaseHints: startHints.map((item) => ({
      source: item.source,
      caseNo: normalizeCaseNo(item.caseNo),
      excerpt: item.excerpt
    })),
    helperHintsSummary: {
      totalBlocks: helperBlocks.length,
      matchedCases: [...new Set(matchedCases)],
      missing: helperBlocks.length === 0
    },
    issues
  };
};

export const writeTestPackageConsistencyReport = (
  outputPath: string,
  input: TestPackageConsistencyInput
): TestPackageConsistencyReport => {
  const report = buildTestPackageConsistencyReport(input);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
};
