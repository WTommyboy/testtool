#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { PGlite } from "@electric-sql/pglite";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const spikeRoot = path.join(repoRoot, "spikes", "m0", "result-xlsx");
const outputRoot = path.join(spikeRoot, "output");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(outputRoot, runId);
const parserVersion = "m0-result-parser-v1";
const schemaVersion = "bi-result-v1";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node spikes/m0/result-xlsx/run-spike.mjs");
  console.log("Creates a result.xlsx fixture, parses it, and writes parsed rows to a local PGlite DB.");
  process.exit(0);
}

fs.mkdirSync(runDir, { recursive: true });

function writeJson(name, value) {
  fs.writeFileSync(path.join(runDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function extractText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (typeof value === "object" && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text || "").join("").trim();
  }
  return String(value).trim();
}

function normalizeHeader(value) {
  return extractText(value).toLowerCase().replace(/\s+/g, "");
}

function headerIndex(row, names) {
  const wanted = new Set(names.map((name) => name.toLowerCase().replace(/\s+/g, "")));
  let found = undefined;
  row.eachCell((cell, col) => {
    if (wanted.has(normalizeHeader(cell.value))) found = col;
  });
  return found;
}

function parseDetailJson(raw) {
  if (!raw) {
    return {
      detail_json: null,
      detail_json_raw: null,
      detail_parse_error: null
    };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        detail_json: null,
        detail_json_raw: raw,
        detail_parse_error: "NOT_OBJECT"
      };
    }
    return {
      detail_json: parsed,
      detail_json_raw: raw,
      detail_parse_error: null
    };
  } catch (error) {
    return {
      detail_json: null,
      detail_json_raw: raw,
      detail_parse_error: String(error)
    };
  }
}

async function createFixture(filePath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "M0 result-xlsx spike";

  const index = workbook.addWorksheet("索引");
  index.addRows([
    ["xlsx_schema_version", schemaVersion],
    ["parser_version", parserVersion],
    ["round_id", "M0-R001"],
    ["run_id", "run_m0_result_xlsx"]
  ]);

  const cases = workbook.addWorksheet("測試案例");
  cases.addRow(["群組", "編號", "測試項目", "測試類型", "執行方式", "結果", "失敗分類", "詳細紀錄JSON"]);
  cases.addRows([
    [
      "A",
      "A-01",
      "PASS simple",
      "功能流程",
      "interactive",
      "PASS",
      "",
      JSON.stringify({ 測試目的: "PASS simple", 實際行為: "created row count = 1" })
    ],
    [
      "B",
      "B-01",
      "FAIL full",
      "前後端整合",
      "interactive",
      "FAIL",
      "ASSERTION_FAILED",
      JSON.stringify({
        測試目的: "FAIL full",
        設定條件: "日期=上月",
        預期行為: "31 days",
        實際行為: "30 days",
        錯誤原因: "endDate -1"
      })
    ],
    [
      "C",
      "C-01",
      "BLOCKED reason",
      "後端功能",
      "interactive",
      "BLOCKED",
      "ENV_BLOCKED",
      JSON.stringify({ 測試目的: "BLOCKED reason", blocked_reason: "field missing in DEV" })
    ],
    [
      "D",
      "D-01",
      "PARTIAL case",
      "功能流程",
      "interactive",
      "PARTIAL",
      "PARTIAL_MATCH",
      JSON.stringify({ 測試目的: "PARTIAL case", 部分符合的子項清單: ["A"], 不符的子項清單: ["B"] })
    ],
    ["E", "E-01", "Invalid detail", "功能流程", "interactive", "FAIL", "PARSER_CHECK", "{\"bad\":"],
    ["E", "E-02", "Not object detail", "功能流程", "interactive", "PASS", "", "[1,2,3]"],
    ["F", "F-01", "Blank detail", "功能流程", "interactive", "PASS", "", ""]
  ]);

  const bugs = workbook.addWorksheet("Bug");
  bugs.addRow(["嚴重度", "Bug ID", "關聯編號", "標題", "描述", "建議", "狀態"]);
  bugs.addRows([
    ["High", "BUG-M0-001", "B-01", "High bug", "endDate offset", "check date save logic", "OPEN"],
    ["Medium", "BUG-M0-002", "C-01", "Medium bug", "field missing", "check metadata deploy", "OPEN"],
    ["Low", "BUG-M0-003", "E-01", "Low bug", "invalid detail fixture", "parser should preserve raw", "OPEN"]
  ]);

  await workbook.xlsx.writeFile(filePath);
}

async function parseResultXlsx(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const index = workbook.getWorksheet("索引");
  const version = index ? extractText(index.getCell("B1").value) : "";

  const caseSheet = workbook.getWorksheet("測試案例");
  if (!caseSheet) throw new Error("CASE_RESULT_SHEET_NOT_FOUND");
  const caseHeader = caseSheet.getRow(1);
  const idx = {
    groupName: headerIndex(caseHeader, ["群組", "group", "group_name"]),
    caseNo: headerIndex(caseHeader, ["編號", "case_no", "caseno", "案例編號"]),
    caseTitle: headerIndex(caseHeader, ["測試項目", "case_title", "title"]),
    testType: headerIndex(caseHeader, ["測試類型", "test_type"]),
    executionMethod: headerIndex(caseHeader, ["執行方式", "execution_method"]),
    status: headerIndex(caseHeader, ["結果", "status", "result_status"]),
    failCategory: headerIndex(caseHeader, ["失敗分類", "fail_category"]),
    detailJson: headerIndex(caseHeader, ["詳細紀錄JSON", "detail_json", "detailjson"])
  };
  for (const [key, value] of Object.entries(idx)) {
    if (!value) throw new Error(`CASE_HEADER_MISSING:${key}`);
  }

  const cases = [];
  for (let rowNo = 2; rowNo <= caseSheet.rowCount; rowNo += 1) {
    const row = caseSheet.getRow(rowNo);
    const caseNo = extractText(row.getCell(idx.caseNo).value);
    if (!caseNo) continue;
    const rawDetail = extractText(row.getCell(idx.detailJson).value);
    cases.push({
      group_name: extractText(row.getCell(idx.groupName).value),
      case_no: caseNo,
      case_title: extractText(row.getCell(idx.caseTitle).value),
      test_type: extractText(row.getCell(idx.testType).value),
      execution_method: extractText(row.getCell(idx.executionMethod).value),
      status: extractText(row.getCell(idx.status).value).toUpperCase(),
      verdict_reason: extractText(row.getCell(idx.failCategory).value),
      ...parseDetailJson(rawDetail)
    });
  }

  const bugSheet = workbook.getWorksheet("Bug");
  const bugs = [];
  if (bugSheet) {
    const bugHeader = bugSheet.getRow(1);
    const bidx = {
      severity: headerIndex(bugHeader, ["嚴重度", "severity"]),
      bugId: headerIndex(bugHeader, ["bug id", "bug_id", "bugid"]),
      relatedCaseNo: headerIndex(bugHeader, ["關聯編號", "related_case_no"]),
      title: headerIndex(bugHeader, ["標題", "title"]),
      description: headerIndex(bugHeader, ["描述", "description"]),
      suggestion: headerIndex(bugHeader, ["建議", "suggestion"]),
      status: headerIndex(bugHeader, ["狀態", "status"])
    };
    for (let rowNo = 2; rowNo <= bugSheet.rowCount; rowNo += 1) {
      const row = bugSheet.getRow(rowNo);
      const bugId = extractText(row.getCell(bidx.bugId).value);
      if (!bugId) continue;
      bugs.push({
        severity: extractText(row.getCell(bidx.severity).value),
        bug_id: bugId,
        related_case_no: extractText(row.getCell(bidx.relatedCaseNo).value),
        title: extractText(row.getCell(bidx.title).value),
        description: extractText(row.getCell(bidx.description).value),
        suggestion: extractText(row.getCell(bidx.suggestion).value),
        status: extractText(row.getCell(bidx.status).value) || "OPEN"
      });
    }
  }

  return { parserVersion, schemaVersion: version, cases, bugs };
}

async function writeToDb(parsed) {
  const db = new PGlite(path.join(runDir, "pglite"));
  const runUuid = crypto.randomUUID();
  await db.exec(`
    CREATE TABLE run_case_results (
      id bigserial PRIMARY KEY,
      run_id uuid NOT NULL,
      case_no text NOT NULL,
      group_name text,
      test_type text,
      case_title text,
      status text NOT NULL,
      verdict_reason text,
      detail_json jsonb,
      detail_json_raw text,
      detail_parse_error text,
      execution_method text
    );
    CREATE TABLE bugs (
      id bigserial PRIMARY KEY,
      run_id uuid NOT NULL,
      bug_id text NOT NULL,
      severity text,
      related_case_no text,
      title text,
      description text,
      suggestion text,
      status text
    );
  `);

  for (const item of parsed.cases) {
    await db.query(
      `INSERT INTO run_case_results (
        run_id, case_no, group_name, test_type, case_title, status, verdict_reason,
        detail_json, detail_json_raw, detail_parse_error, execution_method
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
      [
        runUuid,
        item.case_no,
        item.group_name,
        item.test_type,
        item.case_title,
        item.status,
        item.verdict_reason,
        item.detail_json ? JSON.stringify(item.detail_json) : null,
        item.detail_json_raw,
        item.detail_parse_error,
        item.execution_method
      ]
    );
  }

  for (const bug of parsed.bugs) {
    await db.query(
      `INSERT INTO bugs (run_id, bug_id, severity, related_case_no, title, description, suggestion, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [runUuid, bug.bug_id, bug.severity, bug.related_case_no, bug.title, bug.description, bug.suggestion, bug.status]
    );
  }

  const counts = await db.query(`
    SELECT
      (SELECT count(*)::int FROM run_case_results) AS case_count,
      (SELECT count(*)::int FROM bugs) AS bug_count,
      (SELECT count(*)::int FROM run_case_results WHERE detail_json IS NOT NULL) AS parsed_detail_count,
      (SELECT count(*)::int FROM run_case_results WHERE detail_parse_error IS NOT NULL) AS detail_error_count
  `);
  const statuses = await db.query(`SELECT status, count(*)::int AS count FROM run_case_results GROUP BY status ORDER BY status`);
  const severities = await db.query(`SELECT severity, count(*)::int AS count FROM bugs GROUP BY severity ORDER BY severity`);
  await db.close();
  return { runUuid, counts: counts.rows[0], statuses: statuses.rows, severities: severities.rows };
}

async function main() {
  const fixturePath = path.join(runDir, "result_fixture.xlsx");
  await createFixture(fixturePath);
  const parsed = await parseResultXlsx(fixturePath);
  const dbResult = await writeToDb(parsed);

  const expectedStatuses = new Set(["PASS", "FAIL", "BLOCKED", "PARTIAL"]);
  const actualStatuses = new Set(parsed.cases.map((item) => item.status));
  const hasAllStatuses = [...expectedStatuses].every((status) => actualStatuses.has(status));
  const invalidDetail = parsed.cases.find((item) => item.case_no === "E-01");
  const notObjectDetail = parsed.cases.find((item) => item.case_no === "E-02");
  const blankDetail = parsed.cases.find((item) => item.case_no === "F-01");
  const bugSeverities = new Set(parsed.bugs.map((bug) => bug.severity.toLowerCase()));

  const checks = {
    schemaVersionDetected: parsed.schemaVersion === schemaVersion,
    parserVersionPresent: parsed.parserVersion === parserVersion,
    allStatusesParsed: hasAllStatuses,
    validDetailJsonParsed: parsed.cases.filter((item) => item.detail_json).length === 4,
    invalidDetailPreserved:
      invalidDetail?.detail_json === null && Boolean(invalidDetail?.detail_json_raw) && Boolean(invalidDetail?.detail_parse_error),
    notObjectDetailPreserved: notObjectDetail?.detail_parse_error === "NOT_OBJECT",
    blankDetailNull: blankDetail?.detail_json === null && blankDetail?.detail_json_raw === null,
    bugSheetParsed:
      parsed.bugs.length === 3 && ["high", "medium", "low"].every((severity) => bugSeverities.has(severity)),
    dbCaseRowsWritten: dbResult.counts.case_count === 7,
    dbBugRowsWritten: dbResult.counts.bug_count === 3,
    dbDetailErrorRowsWritten: dbResult.counts.detail_error_count === 2
  };

  const summary = {
    environment: {
      runId,
      repoRoot,
      spikeRoot,
      runDir,
      node: process.version,
      platform: `${os.platform()}-${os.arch()}`,
      fixturePath,
      parserVersion,
      schemaVersion
    },
    checks,
    parsedCounts: {
      cases: parsed.cases.length,
      bugs: parsed.bugs.length
    },
    dbResult,
    verdict: Object.values(checks).every(Boolean) ? "PASS" : "FAIL"
  };
  writeJson("parsed.json", parsed);
  writeJson("summary.json", summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
