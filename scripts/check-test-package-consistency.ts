import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeCaseManifest } from "../agent/src/case-manifest";
import { writeTestPackageConsistencyReport } from "../agent/src/test-package-consistency";

type Args = {
  xlsx?: string;
  assignment?: string;
  instruction?: string;
  helperSources: string[];
  preferredStartCase?: string;
  out?: string;
  domain?: string;
  domainLintRules?: string;
};

const usage = (): string =>
  [
    "Usage: npm run check:package-consistency -- --xlsx <testcase.xlsx> --assignment <Codex_指派文字.md> --instruction <測試執行說明.md> [--helper-source <file.md>] [--preferred-start-case <case>] [--domain <DOMAIN>] [--domain-lint-rules <file.json>] [--out <report.json>]",
    "",
    "Produces a warning/error report only. It never edits the testcase package."
  ].join("\n");

const parseArgs = (argv: string[]): Args => {
  const args: Args = { helperSources: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--xlsx") {
      args.xlsx = next;
      index += 1;
    } else if (arg === "--assignment") {
      args.assignment = next;
      index += 1;
    } else if (arg === "--instruction") {
      args.instruction = next;
      index += 1;
    } else if (arg === "--helper-source") {
      if (next) args.helperSources.push(next);
      index += 1;
    } else if (arg === "--preferred-start-case") {
      args.preferredStartCase = next;
      index += 1;
    } else if (arg === "--out") {
      args.out = next;
      index += 1;
    } else if (arg === "--domain") {
      args.domain = next;
      index += 1;
    } else if (arg === "--domain-lint-rules") {
      args.domainLintRules = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}\n${usage()}`);
    }
  }
  return args;
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.xlsx) {
    throw new Error(`Missing --xlsx\n${usage()}`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-package-consistency-"));
  try {
    const manifestDir = path.join(tempRoot, "input");
    fs.mkdirSync(manifestDir, { recursive: true });
    const caseManifest = await writeCaseManifest(args.xlsx, manifestDir, {
      preferredStartCaseNo: args.preferredStartCase
    });
    const outputPath = args.out ?? path.join(tempRoot, "test-package-consistency.json");
    const report = writeTestPackageConsistencyReport(outputPath, {
      caseManifest,
      assignmentPath: args.assignment,
      instructionPath: args.instruction,
      helperHintSourcePaths: args.helperSources.length > 0 ? args.helperSources : args.instruction ? [args.instruction] : [],
      xlsxPath: args.xlsx,
      baseDir: path.dirname(args.xlsx),
      domain: args.domain,
      domainLintRulesPath: args.domainLintRules
    });
    console.log(JSON.stringify({ ok: report.status !== "error", status: report.status, outputPath, issueCount: report.issues.length }, null, 2));
    if (report.status === "error") process.exitCode = 2;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
