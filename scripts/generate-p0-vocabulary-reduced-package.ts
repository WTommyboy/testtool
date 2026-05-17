import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

type JsonObject = Record<string, any>;

type PlatformAction = {
  id: string;
  kind: string;
  summary: string;
  defaultEvidence?: string[];
};

type UiObject = {
  id: string;
  page: string;
  objectType: string;
  purpose: string;
  aliases: string[];
  hazards?: string[];
};

type StructuredAction = {
  actionId: string;
  action: string;
  target: string;
  role: string;
  expectedOutcome: string;
  requiredForPass: boolean;
  evidenceRequirements: string[];
};

type StructuredContract = {
  caseNo: string;
  routeIntent: string;
  testTarget: string;
  requiresEditor: boolean;
  observationType: string | null;
  requiredActions: StructuredAction[];
  evidenceRequirements: {
    flow?: string[];
    outcome?: string[];
    observation?: string[];
    network?: string[];
    artifact?: string[];
  };
  judgmentPolicy: {
    failWhen?: string[];
    blockedWhen?: string[];
  };
};

const projectRoot = process.cwd();
const roundDir = "/Users/tommy/Downloads/codex_galaxy/BI_UAT_ROUNDS/p0_scope_smoke_20260517";
const sourceXlsx = path.join(roundDir, "P0_SCOPE_SMOKE_測試案例_BIUI_COLLAGE_R001_20260517.xlsx");
const outputStem = "P0_SCOPE_SMOKE_測試案例_BIUI_COLLAGE_R001_20260518_vocab_v1";
const outputXlsx = path.join(roundDir, `${outputStem}.xlsx`);
const outputInstructionMd = path.join(roundDir, "P0_SCOPE_SMOKE_測試執行說明_BIUI_COLLAGE_R001_20260518_vocab_v1.md");
const outputStartupMd = path.join(roundDir, "P0_SCOPE_SMOKE_Codex_指派文字_BIUI_COLLAGE_R001_20260518_vocab_v1.md");

const contractPath = path.join(projectRoot, "domain-packs", "BI_OFFICIAL_UI_COLLAGE", "case-scope-runtime-contracts.json");
const actionVocabularyPath = path.join(projectRoot, "contracts", "platform-action-vocabulary.v1.json");
const uiObjectVocabularyPath = path.join(projectRoot, "domain-packs", "BI_OFFICIAL_UI_COLLAGE", "ui-object-vocabulary.json");

const readJson = <T>(filePath: string): T => JSON.parse(fs.readFileSync(filePath, "utf8")) as T;

const normalizeText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const rich = value as { richText?: Array<{ text?: string }> };
    if (Array.isArray(rich.richText)) return rich.richText.map((item) => item.text ?? "").join("").trim();
  }
  return String(value).trim();
};

const headerMap = (sheet: ExcelJS.Worksheet): Map<string, number> => {
  const row = sheet.getRow(1);
  const out = new Map<string, number>();
  row.eachCell((cell, col) => out.set(normalizeText(cell.value), col));
  return out;
};

const cellText = (row: ExcelJS.Row, col: number | undefined): string => (col ? normalizeText(row.getCell(col).value) : "");

const setIndexValue = (sheet: ExcelJS.Worksheet | undefined, label: string, value: string): void => {
  if (!sheet) return;
  for (let rowNo = 1; rowNo <= sheet.rowCount; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    if (normalizeText(row.getCell(1).value) === label) {
      row.getCell(2).value = value;
      row.commit();
      return;
    }
  }
  sheet.addRow([label, value]);
};

const styleHeader = (row: ExcelJS.Row): void => {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF174A7C" } };
  row.alignment = { vertical: "middle", wrapText: true };
};

const structuredStepText = (
  contract: StructuredContract,
  actionMap: Map<string, PlatformAction>,
  objectMap: Map<string, UiObject>
): string => {
  const lines = [
    "【P0.18 vocabulary-aligned steps】",
    "本題步驟以 canonical platform action + domain UI object 撰寫；執行與判定時不得改用未列於本段的 helper fallback 或其他 UI 物件替代。",
    `routeIntent=${contract.routeIntent}; testTarget=${contract.testTarget}; observationType=${contract.observationType ?? "none"}; requiresEditor=${contract.requiresEditor}`,
    "",
    ...contract.requiredActions.flatMap((action, index) => {
      const actionDef = actionMap.get(action.action);
      const objectDef = objectMap.get(action.target);
      return [
        `${index + 1}. ${action.action}(${action.target})`,
        `   actionId=${action.actionId}; role=${action.role}; expectedOutcome=${action.expectedOutcome}; requiredForPass=${action.requiredForPass}`,
        `   actionSummary=${actionDef?.summary ?? "UNKNOWN_ACTION"}`,
        `   uiObject=${objectDef?.purpose ?? "UNKNOWN_UI_OBJECT"}; aliases=${objectDef?.aliases?.join(" / ") ?? ""}`,
        `   evidence=${action.evidenceRequirements.join(", ")}`
      ];
    }),
    "",
    "判定要求:",
    "- 必須逐一比對 actualOutcome 與 expectedOutcome；不能只用最後結果文字推論。",
    "- role=precondition 失敗通常為 BLOCKED；role=under_test/verification 失敗需依測試標的判 FAIL/BLOCKED。",
    "- frontend observation case 不可因 preview-only precondition 如 selectedMetricFields=0 直接 BLOCKED。",
    "- 預期 blocked/no-change 的互動若實際成功，應視為 FAIL_UNEXPECTED_SUCCESS，不可判 PASS。",
    "- 只採 current-run evidence；舊 run、舊 report、oracle 檔不是產品真理。"
  ];
  return lines.join("\n");
};

const validationText = (contract: StructuredContract): string => {
  const evidence = Object.entries(contract.evidenceRequirements)
    .filter(([, values]) => Array.isArray(values) && values.length > 0)
    .map(([key, values]) => `${key}: ${(values ?? []).join(", ")}`)
    .join(" | ");
  const fail = contract.judgmentPolicy.failWhen?.join("；") || "依 action expectedOutcome 與 evidenceRequirements 判定";
  const blocked = contract.judgmentPolicy.blockedWhen?.join("；") || "缺 current-run evidence 或工具不可達";
  return [
    "P0.18 vocabulary contract evidence gate",
    `requiredEvidence={ ${evidence} }`,
    `failWhen=${fail}`,
    `blockedWhen=${blocked}`,
    "resultGate=action.expectedOutcome x actualOutcome, then testTarget policy"
  ].join("\n");
};

const chineseTestTarget = (value: string): string => {
  switch (value) {
    case "backend_function":
      return "後端功能";
    case "frontend_presentation":
      return "前端呈現";
    case "frontend_backend_integration":
      return "前後端整合";
    case "functional_flow":
      return "功能流程";
    default:
      return value;
  }
};

const markdownActionTable = (contract: StructuredContract, objectMap: Map<string, UiObject>): string => {
  const rows = contract.requiredActions.map((action, index) => {
    const object = objectMap.get(action.target);
    return `| ${index + 1} | \`${action.actionId}\` | \`${action.action}\` | \`${action.target}\` | ${object?.purpose ?? ""} | \`${action.role}\` | \`${action.expectedOutcome}\` | ${action.evidenceRequirements.map((item) => `\`${item}\``).join("<br>")} |`;
  });
  return [
    "| # | actionId | action | target | UI object purpose | role | expectedOutcome | evidence |",
    "|---|---|---|---|---|---|---|---|",
    ...rows
  ].join("\n");
};

const main = async (): Promise<void> => {
  const contractFile = readJson<{ contracts: StructuredContract[] }>(contractPath);
  const actionVocabulary = readJson<{ actions: PlatformAction[] }>(actionVocabularyPath);
  const uiObjectVocabulary = readJson<{ objects: UiObject[] }>(uiObjectVocabularyPath);
  const contracts = contractFile.contracts;
  const contractByCase = new Map(contracts.map((item) => [item.caseNo, item]));
  const actionMap = new Map(actionVocabulary.actions.map((item) => [item.id, item]));
  const objectMap = new Map(uiObjectVocabulary.objects.map((item) => [item.id, item]));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourceXlsx);

  const caseSheet = workbook.getWorksheet("測試案例");
  if (!caseSheet) throw new Error("CASE_SHEET_NOT_FOUND");
  const headers = headerMap(caseSheet);
  const col = (name: string): number => {
    const idx = headers.get(name);
    if (!idx) throw new Error(`CASE_HEADER_NOT_FOUND: ${name}`);
    return idx;
  };

  setIndexValue(workbook.getWorksheet("索引"), "版本", "v1.6-p0-scope-smoke-vocab-v1-20260518");
  setIndexValue(workbook.getWorksheet("索引"), "測試範圍", "P0.18 vocabulary-aligned reduced smoke; generated from platform action vocabulary + BI domain UI object vocabulary + runtime case-scope contracts");
  setIndexValue(workbook.getWorksheet("索引"), "Vocabulary source", "contracts/platform-action-vocabulary.v1.json + BI_OFFICIAL_UI_COLLAGE/ui-object-vocabulary.json + case-scope-runtime-contracts.json");

  const versionSheet = workbook.getWorksheet("版本說明");
  if (versionSheet) {
    const row = versionSheet.addRow([
      9,
      "2026-05-18",
      "P0.18 vocabulary-aligned reduced package: 重寫 15 題步驟欄為 canonical action(target) contract,新增結構化「步驟」sheet 與 Vocabulary Contract sheet。",
      "降低 agent/planner 對中文 prose 的語意猜測,讓 testcase、domain UI object vocabulary、platform action vocabulary 不漂移。",
      "僅用於 P0 reduced smoke;不把 Tommy oracle 寫入 testcase,結果欄保持空白。",
      "Codex"
    ]);
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
    });
  }

  const generatedRows: Array<{ row: ExcelJS.Row; contract: StructuredContract; title: string; group: string; testType: string; risk: string; target: string }> = [];
  for (let rowNo = 2; rowNo <= caseSheet.rowCount; rowNo += 1) {
    const row = caseSheet.getRow(rowNo);
    const caseNo = cellText(row, col("編號"));
    if (!caseNo) continue;
    const contract = contractByCase.get(caseNo);
    if (!contract) throw new Error(`CONTRACT_NOT_FOUND_FOR_CASE: ${caseNo}`);
    row.getCell(col("測試標的")).value = chineseTestTarget(contract.testTarget);
    row.getCell(col("步驟")).value = structuredStepText(contract, actionMap, objectMap);
    row.getCell(col("驗證方法")).value = validationText(contract);
    row.getCell(col("結果")).value = null;
    row.getCell(col("測試日")).value = null;
    row.getCell(col("詳細紀錄JSON")).value = null;
    row.getCell(col("步驟")).alignment = { vertical: "top", wrapText: true };
    row.getCell(col("驗證方法")).alignment = { vertical: "top", wrapText: true };
    row.height = 210;
    generatedRows.push({
      row,
      contract,
      title: cellText(row, col("測試項目")),
      group: cellText(row, col("群組")),
      testType: cellText(row, col("測試類型")),
      risk: cellText(row, col("風險等級")),
      target: chineseTestTarget(contract.testTarget)
    });
  }

  for (const name of ["步驟", "Vocabulary Contract"]) {
    const existing = workbook.getWorksheet(name);
    if (existing) workbook.removeWorksheet(existing.id);
  }

  const stepSheet = workbook.addWorksheet("步驟");
  stepSheet.addRow(["案例編號", "步驟序號", "動作類型", "目標類型", "目標值", "輸入值", "預期值", "需要人工確認", "逾時毫秒", "重試次數", "role", "actionId", "evidenceRequirements"]);
  styleHeader(stepSheet.getRow(1));
  for (const item of generatedRows) {
    item.contract.requiredActions.forEach((action, index) => {
      stepSheet.addRow([
        item.contract.caseNo,
        index + 1,
        action.action,
        "domain_ui_object",
        action.target,
        action.actionId,
        action.expectedOutcome,
        false,
        action.action === "download" ? 20000 : 12000,
        0,
        action.role,
        action.actionId,
        action.evidenceRequirements.join(", ")
      ]);
    });
  }
  stepSheet.columns = [
    { width: 26 },
    { width: 10 },
    { width: 16 },
    { width: 18 },
    { width: 34 },
    { width: 34 },
    { width: 24 },
    { width: 14 },
    { width: 12 },
    { width: 10 },
    { width: 14 },
    { width: 34 },
    { width: 46 }
  ];
  stepSheet.eachRow((row) => {
    row.alignment = { vertical: "top", wrapText: true };
  });

  const contractSheet = workbook.addWorksheet("Vocabulary Contract");
  contractSheet.addRow(["caseNo", "routeIntent", "testTarget", "requiresEditor", "observationType", "requiredActions", "evidenceRequirements", "judgmentPolicy"]);
  styleHeader(contractSheet.getRow(1));
  for (const contract of contracts) {
    contractSheet.addRow([
      contract.caseNo,
      contract.routeIntent,
      contract.testTarget,
      contract.requiresEditor,
      contract.observationType ?? "",
      JSON.stringify(contract.requiredActions),
      JSON.stringify(contract.evidenceRequirements),
      JSON.stringify(contract.judgmentPolicy)
    ]);
  }
  contractSheet.columns = [
    { width: 26 },
    { width: 24 },
    { width: 30 },
    { width: 14 },
    { width: 24 },
    { width: 80 },
    { width: 60 },
    { width: 70 }
  ];
  contractSheet.eachRow((row) => {
    row.alignment = { vertical: "top", wrapText: true };
  });

  caseSheet.columns.forEach((column) => {
    if (column.header === "步驟") column.width = 95;
    if (column.header === "驗證方法") column.width = 65;
  });

  const smokeRows = generatedRows.map((item) => `| ${item.contract.caseNo} | ${item.group} | ${item.title} | ${item.risk} | ${item.target} | \`${item.contract.routeIntent}\` | ${item.contract.requiredActions.length} |`);
  const instructionMd = [
    "---",
    "title: P0 Scope Smoke Vocabulary-aligned 測試執行說明 — BIUI_COLLAGE_R001",
    "tags: [galaxy, uat, p0-scope-smoke, bi-official-ui, collage, vocabulary-aligned]",
    "---",
    "",
    "# P0 Scope Smoke Vocabulary-aligned 測試執行說明 — BIUI_COLLAGE_R001",
    "",
    "## 本輪目的",
    "",
    "本版本是 P0.18 reduced smoke package。它保留 15 題 smoke 範圍,但將每題步驟改寫為 canonical `action(target)` 格式,並同步產生 xlsx 內的結構化「步驟」sheet。",
    "",
    "本版本不包含 Tommy oracle 正確答案,也不預填結果。Oracle 只用於工具離線驗證,不可被 Agent 當成產品真理。",
    "",
    "## Source",
    "",
    `- 原始 reduced xlsx:\`${sourceXlsx}\``,
    "- Platform action vocabulary:`contracts/platform-action-vocabulary.v1.json`",
    "- Domain UI object vocabulary:`domain-packs/BI_OFFICIAL_UI_COLLAGE/ui-object-vocabulary.json`",
    "- Case scope runtime contracts:`domain-packs/BI_OFFICIAL_UI_COLLAGE/case-scope-runtime-contracts.json`",
    "",
    "## Smoke Case 清單",
    "",
    "| Case | 群組 | 測試項目 | 風險 | 測試標的 | routeIntent | actions |",
    "|---|---|---|---|---|---|---|",
    ...smokeRows,
    "",
    "## 共通執行紀律",
    "",
    "- 執行 `步驟` 欄與 `步驟` sheet 時,`動作類型` 必須來自 platform action vocabulary,`目標值` 必須是 BI domain UI object id。",
    "- 不可把 `frontend_observation` case fallback 成 preview/download execution。",
    "- 不可用 `selectedMetricFields=0` 這類 preview-only precondition 直接阻塞 frontend observation case。",
    "- 必須逐一記錄 action actualOutcome,再與 expectedOutcome 比對判定。",
    "- 若 UI object 是 known product gap,需依該 case 的測試標的判 FAIL/BLOCKED,不可把產品缺口混成 helper bug。",
    "",
    "## 逐題 Action Contract",
    "",
    ...generatedRows.flatMap((item) => [
      `### ${item.contract.caseNo} — ${item.title}`,
      "",
      `- routeIntent: \`${item.contract.routeIntent}\``,
      `- testTarget: \`${item.contract.testTarget}\` / xlsx: ${item.target}`,
      `- observationType: \`${item.contract.observationType ?? "none"}\``,
      "",
      markdownActionTable(item.contract, objectMap),
      ""
    ])
  ].join("\n");

  const startupMd = [
    "---",
    "title: P0 Scope Smoke Vocabulary-aligned Codex 指派文字 — BIUI_COLLAGE_R001",
    "tags: [galaxy, uat, codex-brief, p0-scope-smoke, bi-official-ui, collage, vocabulary-aligned]",
    "---",
    "",
    "# P0 Scope Smoke Vocabulary-aligned Codex 指派文字 — BIUI_COLLAGE_R001",
    "",
    "## 本輪目的",
    "",
    "本輪用 P0.18 vocabulary-aligned reduced package 驗證工具是否能依 canonical action/object contract 執行與判定,而不是靠中文 prose 猜測。",
    "",
    "## 執行檔案",
    "",
    `- xlsx:\`${path.basename(outputXlsx)}\``,
    `- 測試執行說明:\`${path.basename(outputInstructionMd)}\``,
    "- Domain Pack:`BI_OFFICIAL_UI_COLLAGE`",
    "- DEV URL:`https://galaxy.games.gamania.com/bi-dev/zh-TW/home`",
    "",
    "## 強制邊界",
    "",
    "- `步驟` sheet 是本輪結構化步驟的權威來源；`測試案例` sheet 的步驟欄是同一份 contract 的人類可讀版。",
    "- 每個 action 必須用 `action(target)` 判讀,例如 `click(dateRange.button)`、`assertToast(validation.toast)`。",
    "- 不可自行替換 target object,不可把 observation case 轉成 preview case。",
    "- 結果判定需引用 current-run evidence,不可引用 Tommy oracle 或過去 UAT_archive 當作產品結果。",
    "- 若 helper/template 缺口導致無法執行,需寫明是 template 缺口；若 real UI interaction 證明產品行為不符,需依測試標的判 FAIL。",
    "",
    "## Smoke Case 清單",
    "",
    "| Case | 測試項目 | routeIntent | action targets |",
    "|---|---|---|---|",
    ...generatedRows.map((item) => `| ${item.contract.caseNo} | ${item.title} | \`${item.contract.routeIntent}\` | ${[...new Set(item.contract.requiredActions.map((action) => `\`${action.target}\``))].join("<br>")} |`)
  ].join("\n");

  fs.writeFileSync(outputInstructionMd, `${instructionMd}\n`);
  fs.writeFileSync(outputStartupMd, `${startupMd}\n`);
  await workbook.xlsx.writeFile(outputXlsx);

  console.log(JSON.stringify({
    ok: true,
    outputXlsx,
    outputInstructionMd,
    outputStartupMd,
    cases: generatedRows.length,
    structuredSteps: generatedRows.reduce((sum, item) => sum + item.contract.requiredActions.length, 0)
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
