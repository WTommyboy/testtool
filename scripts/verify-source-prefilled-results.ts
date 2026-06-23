import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { writeCaseManifest } from "../agent/src/case-manifest";
import { parseTestcaseXlsx } from "../src/xlsx-parser";

type CaseRow = {
  case_no: string;
  execution_type: string;
  result_status: string;
  fail_category: string | null;
  detail_json: string | null;
};

type StepRow = {
  case_no: string;
  status: string;
  actual_json: string | null;
};

const writeFixtureWorkbook = async (filePath: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("測試案例");
  sheet.addRow([
    "群組ID",
    "群組",
    "編號",
    "測試類型",
    "測試項目",
    "前置條件",
    "步驟",
    "預期結果",
    "執行方式",
    "結果",
    "失敗分類",
    "測試日",
    "詳細紀錄JSON",
    "驗證方法"
  ]);
  sheet.addRow([
    "A",
    "A:Fixture",
    "A-01",
    "功能流程",
    "PM skip source result",
    "PM 已判定本輪不執行",
    "不需 Agent 執行",
    "報告應保留 BLOCKED",
    "N/A(本輪不執行)",
    "BLOCKED",
    "PM_SKIP",
    "2026-05-05",
    JSON.stringify({
      skip_reason: "PM prefilled source result",
      skip_decided_by: "Tommy",
      skip_decided_at: "2026-05-05",
      preserved_for: "補測"
    }),
    "PM source row prefill"
  ]);
  sheet.addRow([
    "A",
    "A:Fixture",
    "A-02",
    "功能流程",
    "Runnable case with detail seed",
    "前置",
    "照 UI 執行",
    "應由 Agent 執行",
    "auto",
    "",
    "",
    "",
    JSON.stringify({ note: "detail_json seed must not make this case complete" }),
    ""
  ]);
  sheet.addRow([
    "A",
    "A:Fixture",
    "A-03",
    "功能流程",
    "Manual pending case",
    "前置",
    "人工確認",
    "應進入 MANUAL_PENDING",
    "manual",
    "",
    "",
    "",
    "",
    ""
  ]);

  const steps = workbook.addWorksheet("步驟");
  steps.addRow(["案例編號", "步驟序號", "動作類型", "預期值"]);
  steps.addRow(["A-01", 1, "custom", "source result keeps this skipped"]);
  steps.addRow(["A-02", 1, "custom", "agent should run this"]);
  steps.addRow(["A-03", 1, "manual", "manual pending"]);

  await workbook.xlsx.writeFile(filePath);
};

const writeMalformedStatusWorkbook = async (filePath: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("測試案例");
  sheet.addRow([
    "群組ID",
    "群組",
    "編號",
    "測試類型",
    "測試項目",
    "前置條件",
    "步驟",
    "預期結果",
    "執行方式",
    "結果",
    "測試日",
    "詳細紀錄JSON",
    "驗證方法"
  ]);
  sheet.addRow([
    "T",
    "T:Tag",
    "TAG-01",
    "前端呈現",
    "Malformed source result status should still be runnable",
    "前置",
    "照 UI 執行",
    "應由 Agent 執行",
    "auto",
    "Codex + Playwright",
    "tagList.table.state + screenshot",
    "",
    ""
  ]);
  sheet.addRow([
    "T",
    "T:Tag",
    "TAG-02",
    "功能流程",
    "Second malformed status row should also be runnable",
    "前置",
    "照 UI 執行",
    "應由 Agent 執行",
    "auto",
    "tagList.table.state",
    "",
    "",
    ""
  ]);

  const steps = workbook.addWorksheet("步驟");
  steps.addRow(["案例編號", "步驟序號", "動作類型", "預期值"]);
  steps.addRow(["TAG-01", 1, "open/prepare", "agent should run this"]);
  steps.addRow(["TAG-02", 1, "open/prepare", "agent should run this too"]);

  await workbook.xlsx.writeFile(filePath);
};

const main = async (): Promise<void> => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-source-prefilled-results-"));
  const previousDbPath = process.env.DB_PATH;
  const previousStorageRoot = process.env.STORAGE_ROOT;
  let loadedDb: { close: () => void } | null = null;

  try {
    process.env.DB_PATH = path.join(tempRoot, "uat.db");
    process.env.STORAGE_ROOT = path.join(tempRoot, "storage");

    const xlsxPath = path.join(tempRoot, "source-prefilled-fixture.xlsx");
    await writeFixtureWorkbook(xlsxPath);

    const imported = await parseTestcaseXlsx(xlsxPath);
    assert.equal(imported.cases.length, 3);
    assert.equal(imported.steps.length, 3);
    assert.equal(imported.cases[0]?.resultStatusRaw, "BLOCKED");
    assert.equal(imported.cases[0]?.failCategory, "PM_SKIP");

    const manifestDir = path.join(tempRoot, "manifest");
    const manifest = await writeCaseManifest(xlsxPath, manifestDir);
    assert.equal(manifest.currentCaseNo, "A-02");
    assert.equal(manifest.currentCaseSelection?.reason, "first_runnable_case");

    const requestedManifest = await writeCaseManifest(xlsxPath, path.join(tempRoot, "manifest-requested"), {
      preferredStartCaseNo: "A-01",
      preferredStartCaseSource: "fixture"
    });
    assert.equal(requestedManifest.currentCaseNo, "A-02");
    assert.equal(requestedManifest.currentCaseSelection?.reason, "requested_case_has_result");
    assert.ok(requestedManifest.warnings.includes("START_CASE_ALREADY_HAS_RESULT:A-01"));

    const malformedXlsxPath = path.join(tempRoot, "malformed-status-fixture.xlsx");
    await writeMalformedStatusWorkbook(malformedXlsxPath);
    const malformedManifest = await writeCaseManifest(malformedXlsxPath, path.join(tempRoot, "manifest-malformed-status"));
    assert.equal(malformedManifest.currentCaseNo, "TAG-01");
    assert.equal(malformedManifest.currentCaseSelection?.reason, "first_case");
    assert.ok(
      malformedManifest.warnings.some((item) => item.startsWith("UNRECOGNIZED_RESULT_STATUS_IGNORED:TAG-01:Codex + Playwright")),
      "non-terminal source result text should be warned but not treated as completed"
    );

    const requestedMalformedManifest = await writeCaseManifest(
      malformedXlsxPath,
      path.join(tempRoot, "manifest-malformed-requested"),
      {
        preferredStartCaseNo: "TAG-02",
        preferredStartCaseSource: "fixture"
      }
    );
    assert.equal(requestedMalformedManifest.currentCaseNo, "TAG-02");
    assert.equal(requestedMalformedManifest.currentCaseSelection?.reason, "startup_instruction");
    assert.ok(!requestedMalformedManifest.warnings.includes("START_CASE_ALREADY_HAS_RESULT:TAG-02"));

    const dbModule = await import("../src/db");
    const runsModule = await import("../src/runs");
    loadedDb = dbModule.db;
    dbModule.migrate();

    const now = new Date().toISOString();
    dbModule.db
      .prepare(
        `
          INSERT INTO runs (
            id, round_id, domain, location, feature_main, feature_sub, run_name, dev_url, execution_mode, status, created_at, updated_at
          ) VALUES (
            @id, @round_id, @domain, @location, @feature_main, @feature_sub, @run_name, @dev_url, @execution_mode, @status, @created_at, @updated_at
          )
        `
      )
      .run({
        id: "fixture-run",
        round_id: "FIXTURE",
        domain: "BI",
        location: "local",
        feature_main: "fixture",
        feature_sub: "source-prefilled",
        run_name: "source prefilled fixture",
        dev_url: "https://example.test",
        execution_mode: "offline",
        status: "READY",
        created_at: now,
        updated_at: now
      });

    const summary = runsModule.upsertImportedTestcase("fixture-run", imported);
    assert.deepEqual(summary, { manualCases: 1, prefilledCases: 1 });

    const cases = dbModule.db
      .prepare(
        "SELECT case_no, execution_type, result_status, fail_category, detail_json FROM run_cases WHERE run_id = ? ORDER BY case_no"
      )
      .all("fixture-run") as CaseRow[];
    assert.equal(cases.length, 3);

    const a01 = cases.find((item) => item.case_no === "A-01");
    assert.ok(a01);
    assert.equal(a01.execution_type, "N/A(本輪不執行)");
    assert.equal(a01.result_status, "BLOCKED");
    assert.equal(a01.fail_category, "PM_SKIP");
    const a01Detail = JSON.parse(a01.detail_json ?? "{}") as Record<string, unknown>;
    assert.equal(a01Detail.blocked_reason, "PM prefilled source result");
    assert.deepEqual((a01Detail.sourcePrefilledResult as Record<string, unknown>)?.resultStatus, "BLOCKED");

    const a02 = cases.find((item) => item.case_no === "A-02");
    assert.ok(a02);
    assert.equal(a02.result_status, "PENDING");

    const a03 = cases.find((item) => item.case_no === "A-03");
    assert.ok(a03);
    assert.equal(a03.result_status, "MANUAL_PENDING");

    const steps = dbModule.db
      .prepare("SELECT case_no, status, actual_json FROM run_case_steps WHERE run_id = ? ORDER BY case_no")
      .all("fixture-run") as StepRow[];
    assert.equal(steps.find((item) => item.case_no === "A-01")?.status, "SKIPPED");
    assert.equal(steps.find((item) => item.case_no === "A-02")?.status, "PENDING");
    assert.equal(steps.find((item) => item.case_no === "A-03")?.status, "PENDING");
    const skippedStep = JSON.parse(steps.find((item) => item.case_no === "A-01")?.actual_json ?? "{}") as Record<string, unknown>;
    assert.equal(skippedStep.source, "source_prefilled_result");
    assert.equal(skippedStep.resultStatus, "BLOCKED");

    console.log(JSON.stringify({
      ok: true,
      fixture: "source-prefilled-results",
      checked: [
        "source xlsx result=BLOCKED imports as terminal run case",
        "steps for source-prefilled cases are marked SKIPPED",
        "detail_json alone no longer makes Agent skip a runnable case",
        "case manifest advances past source-prefilled rows",
        "unrecognized source result text stays runnable with a warning"
      ]
    }, null, 2));
  } finally {
    loadedDb?.close();
    if (previousDbPath === undefined) {
      delete process.env.DB_PATH;
    } else {
      process.env.DB_PATH = previousDbPath;
    }
    if (previousStorageRoot === undefined) {
      delete process.env.STORAGE_ROOT;
    } else {
      process.env.STORAGE_ROOT = previousStorageRoot;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
