import fs from "node:fs";
import path from "node:path";
import { parseResultXlsx } from "../src/result-parser/result-xlsx-parser";
import { evaluateResultEvidenceGate } from "../src/result-parser/result-evidence-gate";

const args = process.argv.slice(2);

const readArg = (name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
};

const readListArg = (name: string): string[] => {
  const raw = readArg(name);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string" && item.trim()).map((item) => item.trim());
    }
  } catch {
    // Accept comma-separated values for shell convenience.
  }
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
};

const main = async (): Promise<void> => {
  const xlsxPath = readArg("--xlsx");
  if (!xlsxPath) {
    throw new Error("Usage: npm run check:result-evidence -- --xlsx <result.xlsx> [--current-case CASE] [--expected-cases A-01,B-02] [--result-source codex_generated|agent_fallback] [--out report.json]");
  }

  const parsed = await parseResultXlsx(path.resolve(xlsxPath));
  const report = evaluateResultEvidenceGate({
    parsed,
    currentCaseNo: readArg("--current-case") ?? null,
    expectedCaseNos: readListArg("--expected-cases"),
    resultSource: readArg("--result-source") ?? null,
    requireSingleCase: readArg("--allow-multi-case") ? false : true
  });

  const out = readArg("--out");
  if (out) {
    fs.writeFileSync(path.resolve(out), `${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  if (report.status === "error") process.exitCode = 1;
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
