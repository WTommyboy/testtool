import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type CaseStatus = "PASS" | "FAIL" | "BLOCKED" | "PARTIAL";

type OracleCase = {
  caseNo: string;
  expectedStatus: CaseStatus;
  manualObservation?: string;
};

type OracleFixture = {
  schemaVersion: string;
  fixtureId: string;
  knownBaseline?: {
    runId: string;
    expectedMatchCount: number;
    expectedMismatchCount: number;
    expectedMatchingCaseNos: string[];
  };
  cases: OracleCase[];
};

type ActualCase = {
  caseNo: string;
  actualStatus: CaseStatus;
  failCategory?: string;
};

type ActualFixture = {
  runId?: string;
  cases: ActualCase[];
};

type ComparisonRow = {
  caseNo: string;
  expectedStatus: CaseStatus;
  actualStatus: CaseStatus | "MISSING";
  matched: boolean;
  manualObservation?: string;
};

type CliOptions = {
  actualPath: string | null;
  actualJsonPath: string | null;
  allowMismatch: boolean;
  expectMatches: number | null;
  expectMismatches: number | null;
};

const fixtureDir = path.join(process.cwd(), "fixtures", "p0-scope-smoke-20260517");
const defaultOraclePath = path.join(fixtureDir, "oracle.json");
const defaultActualPath = path.join(fixtureDir, "run-1762-results.json");

const parseArgs = (): CliOptions => {
  const options: CliOptions = {
    actualPath: null,
    actualJsonPath: null,
    allowMismatch: false,
    expectMatches: null,
    expectMismatches: null
  };

  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    const next = process.argv[index + 1];
    if (arg === "--actual") {
      if (!next) throw new Error("--actual requires a markdown file path");
      options.actualPath = next;
      index += 1;
    } else if (arg === "--actual-json") {
      if (!next) throw new Error("--actual-json requires a JSON file path");
      options.actualJsonPath = next;
      index += 1;
    } else if (arg === "--allow-mismatch") {
      options.allowMismatch = true;
    } else if (arg === "--expect-matches") {
      if (!next) throw new Error("--expect-matches requires a number");
      options.expectMatches = Number(next);
      index += 1;
    } else if (arg === "--expect-mismatches") {
      if (!next) throw new Error("--expect-mismatches requires a number");
      options.expectMismatches = Number(next);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.actualPath && options.actualJsonPath) {
    throw new Error("Use only one of --actual or --actual-json");
  }

  return options;
};

const readJson = <T>(filePath: string): T => JSON.parse(fs.readFileSync(filePath, "utf8")) as T;

const stripMarkdown = (value: string): string =>
  value
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/✅|🚫|❌|⚠️/g, "")
    .trim();

const normalizeStatus = (value: string): CaseStatus | null => {
  const normalized = stripMarkdown(value).toUpperCase();
  if (normalized === "PASS") return "PASS";
  if (normalized === "FAIL" || normalized === "FAILED") return "FAIL";
  if (normalized === "BLOCKED") return "BLOCKED";
  if (normalized === "PARTIAL") return "PARTIAL";
  return null;
};

const splitMarkdownRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

const parseActualMarkdown = (filePath: string): ActualFixture => {
  const content = fs.readFileSync(filePath, "utf8");
  const casesByNo = new Map<string, ActualCase>();

  for (const line of content.split(/\r?\n/)) {
    if (!line.includes("BIUI_COLLAGE_R001-")) continue;
    const cells = splitMarkdownRow(line);
    const caseNoCell = cells.find((cell) => /BIUI_COLLAGE_R001-[A-Z]-\d{2}/.test(cell));
    if (!caseNoCell) continue;
    const caseNo = caseNoCell.match(/BIUI_COLLAGE_R001-[A-Z]-\d{2}/)?.[0];
    if (!caseNo || casesByNo.has(caseNo)) continue;

    const status = cells.map(normalizeStatus).find((item): item is CaseStatus => item !== null);
    if (!status) continue;

    const failCategory = cells.find((cell) =>
      /^(EVIDENCE_INSUFFICIENT|BLOCKED_NEEDS_[A-Z_]+|DATE_RANGE|TOOL_|HELPER_|RESULT_)/.test(stripMarkdown(cell))
    );
    casesByNo.set(caseNo, {
      caseNo,
      actualStatus: status,
      failCategory: failCategory ? stripMarkdown(failCategory) : undefined
    });
  }

  const runId = content.match(/Run ID\s*\|\s*([a-f0-9-]{36})\s*\|/)?.[1] ?? content.match(/輪次ID\s*\|\s*([^|\n]+)\|/)?.[1]?.trim();
  return { runId, cases: [...casesByNo.values()] };
};

const loadActual = (options: CliOptions): ActualFixture => {
  if (options.actualPath) return parseActualMarkdown(options.actualPath);
  if (options.actualJsonPath) return readJson<ActualFixture>(options.actualJsonPath);
  return readJson<ActualFixture>(defaultActualPath);
};

const compare = (oracle: OracleFixture, actual: ActualFixture): ComparisonRow[] => {
  const actualByCaseNo = new Map(actual.cases.map((item) => [item.caseNo, item]));
  return oracle.cases.map((expected) => {
    const actualCase = actualByCaseNo.get(expected.caseNo);
    return {
      caseNo: expected.caseNo,
      expectedStatus: expected.expectedStatus,
      actualStatus: actualCase?.actualStatus ?? "MISSING",
      matched: actualCase?.actualStatus === expected.expectedStatus,
      manualObservation: expected.manualObservation
    };
  });
};

const printSummary = (actual: ActualFixture, rows: ComparisonRow[]): void => {
  const matches = rows.filter((row) => row.matched);
  const mismatches = rows.filter((row) => !row.matched);
  console.log("P0 scope oracle comparison");
  console.log(`actualRunId=${actual.runId ?? "unknown"}`);
  console.log(`cases=${rows.length}`);
  console.log(`matches=${matches.length}`);
  console.log(`mismatches=${mismatches.length}`);
  console.log(`matchingCaseNos=${matches.map((row) => row.caseNo).join(",") || "(none)"}`);

  if (mismatches.length > 0) {
    console.log("\nMismatches:");
    for (const row of mismatches) {
      console.log(`- ${row.caseNo}: expected=${row.expectedStatus}, actual=${row.actualStatus}`);
    }
  }
};

const main = (): void => {
  const options = parseArgs();
  const oracle = readJson<OracleFixture>(defaultOraclePath);
  const actual = loadActual(options);
  const rows = compare(oracle, actual);
  const matches = rows.filter((row) => row.matched);
  const mismatches = rows.filter((row) => !row.matched);
  const usingBundledActual = !options.actualPath && !options.actualJsonPath;

  assert.equal(oracle.schemaVersion, "p0-scope-smoke-oracle-v1");
  assert.equal(oracle.cases.length, 15, "P0 reduced oracle must remain the 15-case fixture");
  assert.equal(actual.cases.length, 15, "P0 actual fixture/report must contain 15 cases");

  if (usingBundledActual) {
    assert(oracle.knownBaseline, "oracle fixture missing knownBaseline");
    assert.equal(actual.runId, oracle.knownBaseline.runId);
    assert.equal(matches.length, oracle.knownBaseline.expectedMatchCount);
    assert.equal(mismatches.length, oracle.knownBaseline.expectedMismatchCount);
    assert.deepEqual(
      matches.map((row) => row.caseNo),
      oracle.knownBaseline.expectedMatchingCaseNos
    );
  }

  if (options.expectMatches !== null) {
    assert.equal(matches.length, options.expectMatches, `expected ${options.expectMatches} matches`);
  }
  if (options.expectMismatches !== null) {
    assert.equal(mismatches.length, options.expectMismatches, `expected ${options.expectMismatches} mismatches`);
  }

  printSummary(actual, rows);

  if (!usingBundledActual && mismatches.length > 0 && !options.allowMismatch) {
    console.error("\nFAIL actual report does not match the P0 scope oracle");
    process.exit(1);
  }
};

main();
