#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { readFirstInputCase, writeAgentResultXlsx } from "./result-writer";

type Status = "PASS" | "FAIL" | "BLOCKED" | "PARTIAL";

const usage = (): string => [
  "Usage:",
  "  node agent/dist/result-cli.js write --run-dir <runDir> --case <caseNo> --status <PASS|FAIL|BLOCKED|PARTIAL> --detail-json <detail.json> [--fail-category <category>] [--round-id <roundId>]",
  "",
  "Writes a single-case result-contract workbook to <runDir>/output/result.xlsx."
].join("\n");

const args = process.argv.slice(2);

const readArg = (name: string): string | null => {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : null;
};

const fail = (message: string): never => {
  console.error(`${message}\n\n${usage()}`);
  process.exit(1);
};

const normalizeStatus = (value: string | null): Status | null => {
  const status = value?.trim().toUpperCase();
  return status === "PASS" || status === "FAIL" || status === "BLOCKED" || status === "PARTIAL" ? status : null;
};

const readJsonObject = (filePath: string): Record<string, unknown> => {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`detail-json must be a JSON object: ${filePath}`);
  }
  return parsed as Record<string, unknown>;
};

const readRoundId = (runDir: string): string | null => {
  const dispatchPath = path.join(runDir, "input", "dispatch.json");
  if (!fs.existsSync(dispatchPath)) return null;
  try {
    const dispatch = JSON.parse(fs.readFileSync(dispatchPath, "utf8")) as { payload?: { round_id?: unknown } };
    return typeof dispatch.payload?.round_id === "string" && dispatch.payload.round_id.trim()
      ? dispatch.payload.round_id.trim()
      : null;
  } catch {
    return null;
  }
};

const main = async (): Promise<void> => {
  const command = args[0];
  if (command !== "write") fail("Unknown or missing command.");

  const runDir = readArg("--run-dir") ?? process.cwd();
  const caseNo = readArg("--case") ?? fail("Missing --case.");
  const status = normalizeStatus(readArg("--status")) ?? fail("Missing or invalid --status.");
  const detailJsonPath = readArg("--detail-json") ?? fail("Missing --detail-json.");
  const failCategory = readArg("--fail-category") ?? "";
  const roundId = readArg("--round-id") ?? readRoundId(runDir) ?? path.basename(runDir);
  const detailJson = readJsonObject(detailJsonPath);
  const outputDir = path.join(runDir, "output");
  fs.mkdirSync(outputDir, { recursive: true });

  const sourceCase = await readFirstInputCase(path.join(runDir, "input", "testcase.xlsx"), caseNo) ?? {
    groupId: null,
    groupName: null,
    caseNo,
    caseTitle: null,
    testType: null,
    executionMethod: null
  };

  const filePath = await writeAgentResultXlsx({
    runId: path.basename(runDir),
    roundId,
    outputDir,
    sourceCase,
    status,
    failCategory,
    detailJson,
    fileName: "result.xlsx"
  });

  console.log(JSON.stringify({
    ok: true,
    path: filePath,
    caseNo: sourceCase.caseNo,
    status,
    failCategory
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
