import { sql } from "drizzle-orm";
import { bigserial, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { RUN_STATUSES } from "./status";

const runStatusSql = RUN_STATUSES.map((status) => `'${status}'`).join(", ");

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: text("domain").notNull(),
  roundId: text("round_id").notNull(),
  status: text("status").notNull().default("DRAFT"),
  executionMode: text("execution_mode").notNull().default("interactive"),
  agentId: uuid("agent_id"),
  domainRulesCommit: text("domain_rules_commit"),
  xlsxPath: text("xlsx_path"),
  xlsxSchemaVersion: text("xlsx_schema_version"),
  startupInstructionPath: text("startup_instruction_path"),
  supportingDocs: jsonb("supporting_docs").$type<Array<{ path: string; originalName: string; mimeType?: string; size?: number }>>().notNull().default([]),
  baselineData: jsonb("baseline_data").$type<Record<string, unknown>>().notNull().default({}),
  resultXlsxUrl: text("result_xlsx_url"),
  resultXlsxParserVersion: text("result_xlsx_parser_version"),
  aggregateResultXlsxPath: text("aggregate_result_xlsx_path"),
  aggregateResultGeneratedAt: timestamp("aggregate_result_generated_at", { withTimezone: true }),
  logPath: text("log_path"),
  diagnosticConfigJson: jsonb("diagnostic_config_json").$type<Record<string, unknown> | null>(),
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true })
});

export const runEvents = pgTable(
  "run_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    seq: integer("seq"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("run_events_run_id_idx").on(table.runId),
    index("run_events_event_type_idx").on(table.eventType),
    index("run_events_payload_gin_idx").using("gin", table.payload)
  ]
);

export const runArtifacts = pgTable(
  "run_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    caseNo: text("case_no"),
    action: text("action"),
    artifactType: text("artifact_type").notNull(),
    manifestId: text("manifest_id"),
    storagePath: text("storage_path").notNull(),
    originalName: text("original_name"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    checksum: text("checksum"),
    localPath: text("local_path"),
    relativePath: text("relative_path"),
    source: text("source"),
    retentionClass: text("retention_class"),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("run_artifacts_run_id_idx").on(table.runId),
    index("run_artifacts_case_no_idx").on(table.runId, table.caseNo),
    index("run_artifacts_type_idx").on(table.artifactType)
  ]
);

export const runCaseResults = pgTable(
  "run_case_results",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    caseNo: text("case_no").notNull(),
    groupId: text("group_id"),
    groupName: text("group_name"),
    testType: text("test_type"),
    caseTitle: text("case_title"),
    status: text("status").notNull(),
    verdictReason: text("verdict_reason"),
    detailJson: jsonb("detail_json").$type<Record<string, unknown> | null>(),
    detailJsonRaw: text("detail_json_raw"),
    detailParseError: text("detail_parse_error"),
    relatedBugIds: text("related_bug_ids").array().notNull().default(sql`'{}'::text[]`),
    executionMethod: text("execution_method"),
    testedAt: timestamp("tested_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("run_case_results_run_case_unique").on(table.runId, table.caseNo),
    index("run_case_results_run_id_idx").on(table.runId),
    index("run_case_results_detail_gin_idx").using("gin", table.detailJson)
  ]
);

export const bugs = pgTable(
  "bugs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    bugId: text("bug_id").notNull(),
    severity: text("severity").notNull(),
    relatedCaseNo: text("related_case_no"),
    title: text("title").notNull(),
    description: text("description"),
    suggestion: text("suggestion"),
    status: text("status").notNull().default("OPEN"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("bugs_run_bug_unique").on(table.runId, table.bugId),
    index("bugs_run_id_idx").on(table.runId)
  ]
);

export const agentTokens = pgTable("agent_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull(),
  deviceName: text("device_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true })
});

export const userSessions = pgTable("user_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubLogin: text("github_login").notNull(),
  sessionToken: text("session_token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true })
});

export const runStatusCheckSql = sql.raw(`status IN (${runStatusSql})`);
