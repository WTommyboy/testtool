import fs from "node:fs";
import path from "node:path";

const requiredFiles = ["AGENTS.md", "xlsx_schema.json", "result_parser_adapter.json", "startup_prompt_template.md"] as const;
const optionalFiles = ["README.md", "locators/README.md", "locators/demo001-locator-registry.json"] as const;

type Finding = {
  level: "error" | "warning";
  message: string;
};

const parseNameArg = (): string | null => {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--name") return args[i + 1] ?? null;
    if (args[i] === "--help" || args[i] === "-h") {
      console.log(`Usage:
  npm run verify:domain-pack -- --name <DOMAIN>

If --name is omitted, all domain packs are verified.
`);
      process.exit(0);
    }
  }
  return null;
};

const parseJson = (filePath: string, findings: Finding[]): Record<string, unknown> | null => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    findings.push({ level: "error", message: `${path.relative(process.cwd(), filePath)} is not valid JSON: ${(error as Error).message}` });
    return null;
  }
};

const includesAny = (content: string, needles: string[]): boolean => {
  const normalized = content.toLowerCase();
  return needles.some((needle) => normalized.includes(needle.toLowerCase()));
};

const verifyPack = (packDir: string): Finding[] => {
  const findings: Finding[] = [];
  const relPackDir = path.relative(process.cwd(), packDir);

  for (const fileName of requiredFiles) {
    const filePath = path.join(packDir, fileName);
    if (!fs.existsSync(filePath)) {
      findings.push({ level: "error", message: `${relPackDir} missing required file: ${fileName}` });
    }
  }

  if (findings.some((finding) => finding.level === "error")) return findings;

  const agents = fs.readFileSync(path.join(packDir, "AGENTS.md"), "utf8");
  const startup = fs.readFileSync(path.join(packDir, "startup_prompt_template.md"), "utf8");
  const schema = parseJson(path.join(packDir, "xlsx_schema.json"), findings);
  const adapter = parseJson(path.join(packDir, "result_parser_adapter.json"), findings);

  if (!includesAny(agents, ["scope"])) findings.push({ level: "warning", message: `${relPackDir}/AGENTS.md should describe scope` });
  if (!includesAny(agents, ["out of scope", "out-of-scope", "不測", "範圍外"])) {
    findings.push({ level: "warning", message: `${relPackDir}/AGENTS.md should describe out-of-scope` });
  }
  if (!includesAny(agents, ["irreversible", "不可逆", "delete", "刪除"])) {
    findings.push({ level: "warning", message: `${relPackDir}/AGENTS.md should define irreversible action policy` });
  }
  if (!includesAny(agents, ["visible ui", "真實 ui", "可見 ui", "ui operations"])) {
    findings.push({ level: "warning", message: `${relPackDir}/AGENTS.md should require visible UI execution` });
  }

  if (!includesAny(startup, ["one case", "one-case", "單題", "exactly one case"])) {
    findings.push({ level: "warning", message: `${relPackDir}/startup_prompt_template.md should mention one-case-at-a-time execution` });
  }
  if (!includesAny(startup, ["result.xlsx", "result workbook"])) {
    findings.push({ level: "warning", message: `${relPackDir}/startup_prompt_template.md should mention result workbook output` });
  }

  if (schema) {
    if (typeof schema.displayName !== "string" || schema.displayName.trim() === "") {
      findings.push({ level: "error", message: `${relPackDir}/xlsx_schema.json missing displayName` });
    }
    if (typeof schema.schemaVersion !== "string" || schema.schemaVersion.trim() === "") {
      findings.push({ level: "error", message: `${relPackDir}/xlsx_schema.json missing schemaVersion` });
    }
  }

  if (adapter) {
    const headers = adapter.headers as { cases?: unknown } | undefined;
    const hasCaseColumns = Array.isArray(adapter.caseKeyColumns) || Array.isArray(headers?.cases);
    const hasResultContract = Array.isArray(adapter.resultValues) || typeof adapter.detailJsonRequiredFields === "object";
    if (!hasCaseColumns) {
      findings.push({ level: "warning", message: `${relPackDir}/result_parser_adapter.json should define case columns` });
    }
    if (!hasResultContract) {
      findings.push({ level: "warning", message: `${relPackDir}/result_parser_adapter.json should define result values or detailJsonRequiredFields` });
    }
  }

  for (const fileName of optionalFiles) {
    const filePath = path.join(packDir, fileName);
    if (!fs.existsSync(filePath)) {
      findings.push({ level: "warning", message: `${relPackDir} optional file missing: ${fileName}` });
      continue;
    }
    if (fileName.endsWith(".json")) parseJson(filePath, findings);
  }

  return findings;
};

const main = (): void => {
  const requestedName = parseNameArg();
  const packsRoot = path.resolve(process.cwd(), "domain-packs");
  if (!fs.existsSync(packsRoot)) throw new Error(`domain-packs directory not found: ${packsRoot}`);

  const packDirs = fs
    .readdirSync(packsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packsRoot, entry.name))
    .filter((packDir) => !requestedName || path.basename(packDir) === requestedName)
    .sort();

  if (packDirs.length === 0) {
    throw new Error(requestedName ? `Domain pack not found: ${requestedName}` : "No domain packs found");
  }

  let errorCount = 0;
  let warningCount = 0;

  for (const packDir of packDirs) {
    const findings = verifyPack(packDir);
    const packName = path.basename(packDir);
    const errors = findings.filter((finding) => finding.level === "error");
    const warnings = findings.filter((finding) => finding.level === "warning");
    errorCount += errors.length;
    warningCount += warnings.length;

    if (findings.length === 0) {
      console.log(`PASS ${packName}`);
      continue;
    }

    console.log(`${errors.length === 0 ? "WARN" : "FAIL"} ${packName}`);
    for (const finding of findings) {
      console.log(`  ${finding.level.toUpperCase()}: ${finding.message}`);
    }
  }

  console.log(`\nDomain pack verification: ${errorCount} error(s), ${warningCount} warning(s)`);
  if (errorCount > 0) process.exit(1);
};

main();
