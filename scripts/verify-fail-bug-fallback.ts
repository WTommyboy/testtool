import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { validateResultWorkbookContract } from "../agent/src/result-contract";
import { writeAgentResultXlsx } from "../agent/src/result-writer";
import { writeFinalAggregateResultXlsx } from "../src/result-aggregate-writer";
import { buildMissingBugCandidates } from "../src/result-parser/fail-bug-fallback";
import { parseResultXlsx, type ParsedBug, type ParsedResultCase } from "../src/result-parser/result-xlsx-parser";

const failDetail = {
  測試目的: "驗證 FAIL 必須進入 Bug 區。",
  設定條件: "fixture FAIL case",
  預期行為: "Bug sheet should contain one linked row.",
  實際行為: "Bug sheet was empty before this fix.",
  錯誤原因: "FAIL result had no linked Bug row.",
  根因層級: "server_ingest_contract",
  驗證方法: "targeted smoke workbook parse",
  "RD 分派": "BI frontend",
  currentRunEvidence: {
    dom: {
      fixture: "fail bug fallback smoke"
    },
    network: {
      requestBody: {
        fixture: true
      }
    }
  }
};

const parsedFailCase = (caseNo = "FIX-A-01"): ParsedResultCase => ({
  groupId: "A",
  groupName: "A:Fixture",
  caseNo,
  caseTitle: "fail bug fallback fixture",
  testType: "功能流程",
  executionMethod: "agent",
  status: "FAIL",
  verdictReason: "fixture",
  detailJson: failDetail,
  detailJsonRaw: JSON.stringify(failDetail),
  detailParseError: null
});

const parsedCase = (caseNo: string, status: string): ParsedResultCase => ({
  ...parsedFailCase(caseNo),
  status,
  verdictReason: status === "PASS" ? null : "fixture",
  detailJson: status === "PASS"
    ? {
        測試目的: "fixture PASS",
        設定條件: "fixture",
        預期行為: "PASS should not create bug",
        實際行為: "PASS stayed out of Bug sheet."
      }
    : {
        測試目的: "fixture BLOCKED",
        設定條件: "fixture",
        預期行為: "BLOCKED should not create bug by default",
        實際行為: "ordinary BLOCKED stayed out of Bug sheet.",
        blocked_reason: "fixture blocked"
      }
});

const writeFailWorkbookWithoutBug = async (filePath: string): Promise<void> => {
  const workbook = new ExcelJS.Workbook();
  const index = workbook.addWorksheet("索引");
  index.getCell("A1").value = "schema_version";
  index.getCell("B1").value = "fixture-result-v1";

  const cases = workbook.addWorksheet("測試案例");
  cases.addRow(["群組ID", "群組", "編號", "測試項目", "測試類型", "執行方式", "結果", "失敗分類", "詳細紀錄JSON"]);
  cases.addRow(["A", "A:Fixture", "FIX-A-01", "fail fixture", "功能流程", "agent", "FAIL", "fixture", JSON.stringify(failDetail)]);

  const bugs = workbook.addWorksheet("Bug");
  bugs.addRow(["嚴重度", "Bug ID", "關聯編號", "標題", "描述", "建議", "狀態"]);
  await workbook.xlsx.writeFile(filePath);
};

const verifyServerIngestFallback = async (tempRoot: string): Promise<void> => {
  process.env.DB_PATH = path.join(tempRoot, "server-ingest-smoke.db");
  process.env.STORAGE_ROOT = path.join(tempRoot, "server-storage");
  const { db, migrate } = await import("../src/db");
  const { ingestResultXlsx } = await import("../src/runs");
  migrate();

  const now = "2026-05-12T00:00:00.000Z";
  const runId = "00000000-0000-4000-8000-000000000001";
  db.prepare(
    `
      INSERT INTO runs (
        id, round_id, domain, location, feature_main, feature_sub, run_name, dev_url,
        execution_mode, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    runId,
    "FIXTURE",
    "BI",
    "fixture",
    "BI工具",
    "拼貼模式",
    "server ingest fallback fixture",
    "http://localhost/fixture",
    "offline",
    "RUNNING",
    now,
    now
  );

  const filePath = path.join(tempRoot, "server-ingest-fail-without-bug.xlsx");
  await writeFailWorkbookWithoutBug(filePath);
  const ingest = await ingestResultXlsx(runId, filePath, {
    resultSource: "codex_generated",
    currentCaseNo: "FIX-A-01",
    expectedCaseNos: ["FIX-A-01"]
  });
  assert.equal(ingest.bugs, 1);

  const bugRows = db
    .prepare("SELECT related_case_no, description, suggestion FROM bugs WHERE run_id = ? ORDER BY created_at ASC")
    .all(runId) as Array<{ related_case_no: string; description: string; suggestion: string | null }>;
  assert.equal(bugRows.length, 1);
  assert.equal(bugRows[0]?.related_case_no, "FIX-A-01");
  assert.match(bugRows[0]?.description ?? "", /^\[AUTO\]/);
  assert.match(bugRows[0]?.description ?? "", /auto_generated_from_fail=true/);

  const aggregate = db
    .prepare("SELECT aggregate_result_xlsx_path FROM runs WHERE id = ?")
    .get(runId) as { aggregate_result_xlsx_path: string | null } | undefined;
  assert.ok(aggregate?.aggregate_result_xlsx_path);
  const parsedAggregate = await parseResultXlsx(aggregate.aggregate_result_xlsx_path);
  assert.equal(parsedAggregate.bugs.length, 1);
  assert.equal(parsedAggregate.bugs[0]?.relatedCaseNo, "FIX-A-01");
  assert.match(parsedAggregate.bugs[0]?.title ?? "", /^\[AUTO\]/);
  db.close();
};

const main = async (): Promise<void> => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-fail-bug-fallback-"));
  try {
    const contractMissingBug = path.join(tempRoot, "fail-without-bug.xlsx");
    await writeFailWorkbookWithoutBug(contractMissingBug);
    const missingBugReport = await validateResultWorkbookContract(contractMissingBug);
    assert.equal(missingBugReport.status, "error");
    assert.ok(missingBugReport.issues.some((item) => item.code === "RESULT_FAIL_BUG_ROW_MISSING"));

    const writerPath = await writeAgentResultXlsx({
      runId: "fixture-run",
      roundId: "FIXTURE",
      outputDir: tempRoot,
      sourceCase: {
        groupId: "A",
        groupName: "A:Fixture",
        caseNo: "FIX-A-01",
        caseTitle: "fail bug writer fixture",
        testType: "功能流程",
        executionMethod: "agent"
      },
      status: "FAIL",
      failCategory: "fixture",
      detailJson: failDetail,
      fileName: "writer-fail-result.xlsx"
    });
    const writerContract = await validateResultWorkbookContract(writerPath);
    assert.equal(writerContract.status, "ok", JSON.stringify(writerContract.issues));
    const writerParsed = await parseResultXlsx(writerPath);
    assert.equal(writerParsed.bugs.length, 1);
    assert.equal(writerParsed.bugs[0]?.relatedCaseNo, "FIX-A-01");
    assert.match(writerParsed.bugs[0]?.title ?? "", /^\[AUTO\]/);

    const fallback = buildMissingBugCandidates({
      cases: [parsedFailCase()],
      bugs: []
    });
    assert.equal(fallback.length, 1);
    assert.equal(fallback[0]?.relatedCaseNo, "FIX-A-01");
    assert.match(fallback[0]?.title ?? "", /^\[AUTO\]/);
    assert.match(fallback[0]?.description ?? "", /auto_generated_from_fail=true/);

    const codexBug: ParsedBug = {
      severity: "P1",
      bugId: "BUG-CODEX-001",
      relatedCaseNo: "FIX-A-01",
      title: "Codex-authored bug",
      description: "Codex-authored bug should win.",
      suggestion: "Do not duplicate.",
      status: "OPEN"
    };
    assert.equal(buildMissingBugCandidates({ cases: [parsedFailCase()], bugs: [codexBug] }).length, 0);

    const passBlockedFallbacks = buildMissingBugCandidates({
      cases: [parsedCase("FIX-A-02", "PASS"), parsedCase("FIX-A-03", "BLOCKED")],
      bugs: []
    });
    assert.equal(passBlockedFallbacks.length, 0);

    const explicitBlocked = parsedCase("FIX-A-04", "BLOCKED");
    explicitBlocked.detailJson = {
      ...(explicitBlocked.detailJson ?? {}),
      需追蹤缺陷: true
    };
    const explicitBlockedFallbacks = buildMissingBugCandidates({
      cases: [explicitBlocked],
      bugs: []
    });
    assert.equal(explicitBlockedFallbacks.length, 1);
    assert.equal(explicitBlockedFallbacks[0]?.autoGeneratedFromFail, false);
    assert.match(explicitBlockedFallbacks[0]?.description ?? "", /auto_generated_from_blocked_defect=true/);

    const aggregatePath = path.join(tempRoot, "aggregate-with-fallback.xlsx");
    await writeFinalAggregateResultXlsx({
      filePath: aggregatePath,
      aggregateMode: "final",
      run: {
        id: "fixture-run",
        round_id: "FIXTURE",
        run_name: "fail fallback fixture",
        status: "FAILED",
        created_at: "2026-05-12T00:00:00.000Z",
        updated_at: "2026-05-12T00:01:00.000Z"
      },
      cases: [
        {
          group_id: "A",
          group_name: "A:Fixture",
          case_no: "FIX-A-01",
          case_title: "fail bug fallback fixture",
          execution_type: "agent",
          result_status: "FAIL",
          fail_category: "fixture",
          detail_json: JSON.stringify(failDetail),
          created_at: "2026-05-12T00:00:00.000Z",
          updated_at: "2026-05-12T00:01:00.000Z"
        }
      ],
      bugs: [
        {
          id: fallback[0]?.bugId ?? "AUTO-FIX-A-01",
          severity: fallback[0]?.severity ?? "P2",
          related_case_no: fallback[0]?.relatedCaseNo ?? "FIX-A-01",
          description: fallback[0]?.description ?? "",
          suggestion: fallback[0]?.suggestion ?? "",
          created_at: "2026-05-12T00:01:00.000Z"
        }
      ]
    });
    const aggregateParsed = await parseResultXlsx(aggregatePath);
    assert.equal(aggregateParsed.bugs.length, 1);
    assert.equal(aggregateParsed.bugs[0]?.relatedCaseNo, "FIX-A-01");
    assert.match(aggregateParsed.bugs[0]?.title ?? "", /^\[AUTO\]/);

    await verifyServerIngestFallback(tempRoot);

    console.log(JSON.stringify({
      ok: true,
      fixture: "fail-bug-fallback",
      checked: [
        "agent self-check rejects FAIL without linked Bug row",
        "agent result writer adds a linked FAIL Bug row",
        "server fallback helper creates [AUTO] candidate for FAIL without Bug row",
        "server fallback helper does not duplicate Codex-authored Bug row",
        "PASS and ordinary BLOCKED do not auto-create bug candidates",
        "explicit defect-tracking BLOCKED can create an auto bug candidate",
        "final aggregate workbook can carry fallback auto bug candidate",
        "server ingest writes fallback auto bug to DB and aggregate workbook"
      ]
    }, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
