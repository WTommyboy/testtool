import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFinalAggregateResultXlsx } from "../src/result-aggregate-writer";
import { parseResultXlsx } from "../src/result-parser/result-xlsx-parser";

const main = async (): Promise<void> => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-final-aggregate-result-"));
  try {
    const filePath = path.join(tempRoot, "final-aggregate-result.xlsx");
    await writeFinalAggregateResultXlsx({
      filePath,
      run: {
        id: "fixture-run",
        round_id: "FIXTURE",
        run_name: "final aggregate fixture",
        status: "FAILED",
        created_at: "2026-05-02T00:00:00.000Z",
        updated_at: "2026-05-02T00:05:00.000Z",
        finished_at: "2026-05-02T00:05:00.000Z"
      },
      cases: [
        {
          group_id: "A",
          group_name: "A:Fixture",
          case_no: "FIX-A-01",
          case_title: "first fixture case",
          execution_type: "agent",
          result_status: "PASS",
          fail_category: null,
          detail_json: JSON.stringify({
            測試目的: "fixture",
            設定條件: "A",
            預期行為: "pass",
            實際行為: "passed"
          }),
          created_at: "2026-05-02T00:00:00.000Z",
          updated_at: "2026-05-02T00:01:00.000Z"
        },
        {
          group_id: "B",
          group_name: "B:Fixture",
          case_no: "FIX-B-01",
          case_title: "second fixture case",
          execution_type: "agent",
          result_status: "FAIL",
          fail_category: "fixture",
          detail_json: JSON.stringify({
            測試目的: "fixture",
            設定條件: "B",
            預期行為: "fail",
            實際行為: "failed",
            錯誤原因: "fixture",
            根因層級: "tool",
            驗證方法: "parser readback",
            "RD 分派": "N/A"
          }),
          created_at: "2026-05-02T00:02:00.000Z",
          updated_at: "2026-05-02T00:03:00.000Z"
        }
      ],
      bugs: [
        {
          id: "bug-row-id",
          severity: "HIGH",
          related_case_no: "FIX-B-01",
          description: "BUG-FIXTURE-001 aggregate fixture bug",
          suggestion: "Keep parser readable.",
          created_at: "2026-05-02T00:04:00.000Z"
        }
      ]
    });

    const parsed = await parseResultXlsx(filePath);
    assert.equal(parsed.schemaVersion, "uat-final-aggregate-result-v1");
    assert.equal(parsed.cases.length, 2);
    assert.equal(parsed.cases[0]?.groupId, "A");
    assert.equal(parsed.cases[1]?.groupId, "B");
    assert.equal(parsed.bugs.length, 1);
    assert.equal(parsed.bugs[0]?.relatedCaseNo, "FIX-B-01");

    console.log(JSON.stringify({
      ok: true,
      fixture: "final-aggregate-result",
      checked: [
        "aggregate workbook includes multiple case rows",
        "groupId is preserved before groupName",
        "existing result parser can read aggregate workbook"
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
