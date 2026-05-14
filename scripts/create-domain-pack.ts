import fs from "node:fs";
import path from "node:path";

type ParsedArgs = {
  name?: string;
  display?: string;
  scope?: string;
  base?: string;
  schemaVersion?: string;
};

const parseArgs = (): ParsedArgs => {
  const args = process.argv.slice(2);
  const parsed: ParsedArgs = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--name") parsed.name = args[++i];
    else if (arg === "--display") parsed.display = args[++i];
    else if (arg === "--scope") parsed.scope = args[++i];
    else if (arg === "--base") parsed.base = args[++i];
    else if (arg === "--schema-version") parsed.schemaVersion = args[++i];
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
};

const printUsage = (): void => {
  console.log(`Usage:
  npm run create:domain-pack -- --name <DOMAIN> --display "<Display Name>" --scope "<Scope>"

Options:
  --name             Required. Domain pack directory name, e.g. BI_OFFICIAL_UI_COLLAGE.
  --display          Optional. Human-readable display name.
  --scope            Optional. One-line scope description.
  --base             Optional. Reference domain pack name; recorded in README only.
  --schema-version   Optional. Defaults to <domain-name-lowercase>-v0.1.
`);
};

const toSchemaVersion = (name: string): string => `${name.toLowerCase().replaceAll("_", "-")}-v0.1`;

const writeFile = (filePath: string, content: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
};

const main = (): void => {
  const args = parseArgs();
  const name = args.name?.trim();
  if (!name) {
    printUsage();
    throw new Error("--name is required");
  }
  if (!/^[A-Z0-9_]+$/.test(name)) {
    throw new Error("--name must use uppercase letters, numbers, and underscores only");
  }

  const display = args.display?.trim() || name;
  const scope = args.scope?.trim() || "TODO: define feature scope.";
  const schemaVersion = args.schemaVersion?.trim() || toSchemaVersion(name);
  const packDir = path.resolve(process.cwd(), "domain-packs", name);

  if (fs.existsSync(packDir)) {
    throw new Error(`Domain pack already exists: ${packDir}`);
  }

  writeFile(
    path.join(packDir, "README.md"),
    `# ${display} Domain Pack

Domain pack: \`${name}\`

Scope: ${scope}

Required loader files:

- \`AGENTS.md\`
- \`xlsx_schema.json\`
- \`result_parser_adapter.json\`
- \`startup_prompt_template.md\`

Optional locator guidance:

- \`locators/demo001-locator-registry.json\`

${args.base ? `Reference base pack: \`${args.base}\`\n` : ""}Before using this pack, complete the domain intake and boundary rules described in \`docs/authoring/新功能_DomainPack_生成流程.md\`.
`
  );

  writeFile(
    path.join(packDir, "AGENTS.md"),
    `# ${display}

You are executing UAT cases for this domain pack: \`${name}\`.

## Scope

${scope}

## Out Of Scope

- TODO: list modes, modules, flows, and data sources that must not be tested by this domain.

## Specification Priority

1. TODO: primary PRD / spec.
2. TODO: official UI / design reference.
3. TODO: existing testcase package, if any.
4. Common UAT Tool rules.

If sources conflict, follow the highest-priority source and record lower-priority drift in the case evidence.

## Execution Discipline

- Execute one case at a time.
- Use visible UI operations for setup and execution.
- Do not use direct product APIs as the source of test results.
- Do not use internal JavaScript setters to create UI state.
- Read-only DOM, network, chart, table, and download evidence is allowed after visible UI operations.
- Verify every claimed UI action by checking visible state, DOM state, network activity, or result data.

## Irreversible Actions

- Testcase prose is not approval.
- Before delete, overwrite, permanent clear, native confirm accept, or leaving unsaved changes, request explicit Tommy approval.
- Record approved irreversible operations in \`detail_json\`.

## Result Contract

- Write one single-case \`result.xlsx\` after each case.
- Do not accumulate multiple case results in memory before writing.
- PASS cases may use simplified detail JSON only when allowed by the run-specific instructions.
- FAIL / BLOCKED / PARTIAL cases must include concrete evidence and root-cause context.
`
  );

  writeFile(
    path.join(packDir, "startup_prompt_template.md"),
    `# ${display} Startup Template

You are running a UAT Tool case for domain pack \`${name}\`.

## Startup Checks

1. Read \`input/domain_AGENTS.md\`.
2. Read the uploaded testcase workbook and instruction markdown.
3. Confirm the target URL and SSO/login precondition from the run package.
4. Confirm the current case id before doing any UI action.

## Execution Contract

- Execute exactly one case for the current step.
- Do not run multiple cases in one tool sequence.
- Use visible UI operations for state setup.
- Use read-only DOM/network/table/download evidence only after the UI action occurred.
- Stop and report BLOCKED if the required UI is unavailable.

## Irreversible Actions

For delete, overwrite, permanent clear, native confirm accept, or leaving unsaved changes:

1. State the action and impact.
2. Request explicit Tommy approval.
3. Continue only after approval appears in chat / Tool Bridge.
4. Record the operation in detail JSON.

## Result Output

Write the single-case result workbook expected by the UAT Tool. Include concrete evidence in \`detail_json\`.
`
  );

  writeFile(
    path.join(packDir, "xlsx_schema.json"),
    `${JSON.stringify(
      {
        schemaVersion,
        displayName: display,
        requiredSheets: ["測試案例"],
        resultSheets: ["測試案例", "Bug清單"],
        caseNoColumnCandidates: ["編號", "Case ID", "case_id"],
        resultColumnCandidates: ["結果", "result"],
        detailJsonColumnCandidates: ["詳細紀錄JSON", "detail_json"],
        requiredCaseColumns: [
          "輪次ID",
          "群組ID",
          "群組",
          "編號",
          "測試類型",
          "測試項目",
          "風險等級",
          "測試標的",
          "狀態清理",
          "前置條件",
          "步驟",
          "預期結果",
          "結果",
          "執行方式",
          "測試日",
          "詳細紀錄JSON",
          "驗證方法"
        ]
      },
      null,
      2
    )}\n`
  );

  writeFile(
    path.join(packDir, "result_parser_adapter.json"),
    `${JSON.stringify(
      {
        schemaVersion: `${schemaVersion}-result-adapter`,
        displayName: display,
        caseSheetNameCandidates: ["測試案例"],
        bugSheetNameCandidates: ["Bug清單", "BUG清單", "Bugs"],
        resultValues: ["PASS", "FAIL", "BLOCKED", "PARTIAL"],
        caseKeyColumns: ["編號", "Case ID", "case_id"],
        resultColumns: {
          status: ["結果", "result"],
          testDate: ["測試日", "test_date"],
          detailJson: ["詳細紀錄JSON", "detail_json"],
          verification: ["驗證方法", "verification"]
        },
        detailJsonRequiredForTerminalCases: true
      },
      null,
      2
    )}\n`
  );

  writeFile(
    path.join(packDir, "locators", "README.md"),
    `# Locator Guidance

Add locator guidance only after reading the actual UI. Locator files are hints, not proof.

Current MVP endpoint reads:

\`\`\`text
locators/demo001-locator-registry.json
\`\`\`

Keep the filename until the domain loader supports configurable locator registry names.
`
  );

  writeFile(
    path.join(packDir, "locators", "demo001-locator-registry.json"),
    `${JSON.stringify(
      {
        schemaVersion: `${schemaVersion}-locator-registry`,
        domain: name,
        scope,
        status: "draft_unverified",
        policy: [
          "Locator guidance only; it does not prove PASS/FAIL/BLOCKED.",
          "All candidates must operate visible UI through Playwright locators.",
          "Do not use direct product APIs, internal JS setters, DOM mutation, or force:true clicks.",
          "If candidates fail, fall back to visible UI exploration and record drift.",
          "Read-only DOM or network extraction is allowed only after visible UI state has been set."
        ],
        locators: []
      },
      null,
      2
    )}\n`
  );

  console.log(`Created domain pack: ${packDir}`);
  console.log("Next:");
  console.log(`  npm run verify:domain-pack -- --name ${name}`);
};

main();
