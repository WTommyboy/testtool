#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);
const spikeRoot = path.join(repoRoot, "spikes", "m0", "postgres-drizzle");
const outputRoot = path.join(spikeRoot, "output");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(outputRoot, runId);
const databaseUrl = process.env.M0_DATABASE_URL || process.env.DATABASE_URL || "";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: node spikes/m0/postgres-drizzle/run-spike.mjs");
  console.log("Runs M0-4 Postgres-compatible schema/migration validation with PGlite.");
  console.log("Optional: set M0_DATABASE_URL to also run against a real Postgres dev DB in a temporary schema.");
  process.exit(0);
}

fs.mkdirSync(runDir, { recursive: true });

const migrationSql = `
CREATE TABLE runs (
  id uuid PRIMARY KEY,
  domain text NOT NULL,
  round_id text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'DRAFT',
    'ASSIGNED',
    'AGENT_RUNNING',
    'WAITING_USER',
    'UPLOADING_RESULT',
    'INGESTING_RESULT',
    'COMPLETED',
    'FAILED',
    'INTERRUPTED'
  )),
  execution_mode text NOT NULL CHECK (execution_mode = 'interactive'),
  agent_id uuid,
  domain_rules_commit text,
  xlsx_path text,
  xlsx_schema_version text,
  startup_instruction_path text,
  baseline_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_xlsx_url text,
  result_xlsx_parser_version text,
  log_path text,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE TABLE run_events (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  seq integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX run_events_run_id_idx ON run_events(run_id);
CREATE INDEX run_events_event_type_idx ON run_events(event_type);
CREATE INDEX run_events_payload_gin_idx ON run_events USING gin(payload);

CREATE TABLE run_case_results (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  case_no text NOT NULL,
  group_name text,
  test_type text,
  case_title text,
  status text NOT NULL,
  verdict_reason text,
  detail_json jsonb,
  detail_json_raw text,
  detail_parse_error text,
  related_bug_ids text[] NOT NULL DEFAULT '{}',
  execution_method text,
  tested_at timestamptz
);

CREATE UNIQUE INDEX run_case_results_run_case_unique ON run_case_results(run_id, case_no);
CREATE INDEX run_case_results_detail_gin_idx ON run_case_results USING gin(detail_json);

CREATE TABLE bugs (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  bug_id text NOT NULL,
  severity text NOT NULL,
  related_case_no text,
  title text NOT NULL,
  description text,
  suggestion text,
  status text NOT NULL DEFAULT 'OPEN',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX bugs_run_bug_unique ON bugs(run_id, bug_id);
CREATE INDEX bugs_run_id_idx ON bugs(run_id);

CREATE TABLE agent_tokens (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL,
  device_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY,
  github_login text NOT NULL,
  session_token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
`;

fs.writeFileSync(path.join(runDir, "migration.sql"), migrationSql.trimStart());

function writeJson(name, value) {
  fs.writeFileSync(path.join(runDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

async function seedAndVerify(client, label) {
  const runUuid = crypto.randomUUID();
  const agentUuid = crypto.randomUUID();
  const sessionUuid = crypto.randomUUID();
  const tokenUuid = crypto.randomUUID();

  await client.query(
    `INSERT INTO runs (
      id, domain, round_id, status, execution_mode, agent_id, domain_rules_commit,
      xlsx_path, xlsx_schema_version, startup_instruction_path, baseline_data,
      notes, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)`,
    [
      runUuid,
      "galaxy-bi",
      "M0",
      "DRAFT",
      "interactive",
      agentUuid,
      "local-spike",
      "/tmp/input.xlsx",
      "bi-v2",
      "/tmp/startup.md",
      JSON.stringify({ row_count: 47, groups: ["A", "B"] }),
      "m0 postgres drizzle spike",
      "tommy"
    ]
  );

  await client.query(
    `INSERT INTO run_events (run_id, event_type, seq, payload)
     VALUES ($1,$2,$3,$4::jsonb)`,
    [
      runUuid,
      "run.stdout",
      1,
      JSON.stringify({ stream: "stdout", line: "fake case passed", artifact: { path: "/tmp/a.png" } })
    ]
  );

  await client.query(
    `INSERT INTO run_case_results (
      run_id, case_no, group_name, test_type, case_title, status,
      verdict_reason, detail_json, detail_json_raw, related_bug_ids, execution_method, tested_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,now())`,
    [
      runUuid,
      "A-01",
      "A",
      "功能流程",
      "切換建構方式為明細",
      "PASS",
      "m0 seed",
      JSON.stringify({ 測試目的: "schema smoke", 實際行為: "1 case result persisted" }),
      "{\"測試目的\":\"schema smoke\"}",
      ["BUG-M0-001"],
      "interactive"
    ]
  );

  await client.query(
    `INSERT INTO bugs (run_id, bug_id, severity, related_case_no, title, description, suggestion)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [runUuid, "BUG-M0-001", "High", "A-01", "M0 fake bug", "JSONB and join seed", "No action; spike only"]
  );

  await client.query(
    `INSERT INTO agent_tokens (id, token_hash, device_name, last_seen_at)
     VALUES ($1,$2,$3,now())`,
    [tokenUuid, "hash_placeholder", "M0 Fake Agent"]
  );

  await client.query(
    `INSERT INTO user_sessions (id, github_login, session_token, expires_at)
     VALUES ($1,$2,$3,now() + interval '1 hour')`,
    [sessionUuid, "WTommyboy", `session_${crypto.randomUUID()}`]
  );

  const joined = await client.query(
    `SELECT
       r.id::text AS run_id,
       r.status,
       r.execution_mode,
       r.baseline_data->>'row_count' AS baseline_rows,
       c.case_no,
       c.detail_json->>'實際行為' AS actual_behavior,
       b.bug_id,
       e.payload->>'line' AS stdout_line
     FROM runs r
     JOIN run_case_results c ON c.run_id = r.id
     JOIN bugs b ON b.run_id = r.id
     JOIN run_events e ON e.run_id = r.id
     WHERE r.id = $1`,
    [runUuid]
  );

  const jsonbContainment = await client.query(
    `SELECT count(*)::int AS matched
     FROM run_events
     WHERE payload @> $1::jsonb`,
    [JSON.stringify({ stream: "stdout" })]
  );

  const indexes = await client.query(
    `SELECT indexname
     FROM pg_indexes
     WHERE tablename IN ('run_events','run_case_results','bugs')
     ORDER BY indexname`
  );

  let uniqueConstraintWorks = false;
  try {
    await client.query(
      `INSERT INTO run_case_results (run_id, case_no, status)
       VALUES ($1, $2, $3)`,
      [runUuid, "A-01", "PASS"]
    );
  } catch (error) {
    uniqueConstraintWorks = /duplicate key|unique/i.test(String(error));
  }

  return {
    label,
    runUuid,
    joinedRows: joined.rows,
    jsonbContainmentMatched: jsonbContainment.rows[0]?.matched,
    indexes: indexes.rows.map((row) => row.indexname),
    hasGinIndex: indexes.rows.some((row) => row.indexname === "run_events_payload_gin_idx"),
    uniqueConstraintWorks,
    verdict:
      joined.rows.length === 1 &&
      jsonbContainment.rows[0]?.matched === 1 &&
      indexes.rows.some((row) => row.indexname === "run_events_payload_gin_idx") &&
      uniqueConstraintWorks
        ? "PASS"
        : "FAIL"
  };
}

async function runPglite() {
  const client = new PGlite(path.join(runDir, "pglite"));
  await client.exec(migrationSql);
  const result = await seedAndVerify(client, "pglite");
  await client.close();
  return result;
}

async function runRealPostgres() {
  if (!databaseUrl) {
    return {
      label: "real-postgres",
      verdict: "SKIPPED",
      reason: "M0_DATABASE_URL/DATABASE_URL not set"
    };
  }

  const schemaName = `m0_spike_${runId.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${schemaName}`);
    await client.query(`SET search_path TO ${schemaName}`);
    await client.query(migrationSql);
    const result = await seedAndVerify(client, "real-postgres");
    await client.query(`DROP SCHEMA ${schemaName} CASCADE`);
    return { ...result, schemaName };
  } finally {
    await client.end();
  }
}

async function main() {
  const pglite = await runPglite();
  const realPostgres = await runRealPostgres();
  const summary = {
    environment: {
      runId,
      repoRoot,
      spikeRoot,
      runDir,
      node: process.version,
      platform: `${os.platform()}-${os.arch()}`,
      hasDatabaseUrl: Boolean(databaseUrl)
    },
    checks: {
      pgliteMigration: pglite.verdict === "PASS",
      realPostgresMigration: realPostgres.verdict
    },
    pglite,
    realPostgres,
    verdict: pglite.verdict === "PASS" ? (realPostgres.verdict === "PASS" ? "PASS" : "PARTIAL") : "FAIL"
  };
  writeJson("summary.json", summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
