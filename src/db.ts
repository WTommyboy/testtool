import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config";

const ensureParentDir = (filePath: string): void => {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
};

ensureParentDir(config.dbPath);

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

export const migrate = (): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL,
      location TEXT NOT NULL,
      feature_main TEXT NOT NULL,
      feature_sub TEXT NOT NULL,
      run_name TEXT NOT NULL,
      dev_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS run_cases (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      case_no TEXT NOT NULL,
      case_title TEXT NOT NULL,
      execution_type TEXT NOT NULL,
      result_status TEXT NOT NULL DEFAULT 'PENDING',
      fail_category TEXT,
      detail_json TEXT,
      manual_filled_by TEXT,
      manual_filled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );

    CREATE TABLE IF NOT EXISTS run_logs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      context_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );

    CREATE TABLE IF NOT EXISTS run_case_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      case_no TEXT NOT NULL,
      step_no INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      target_type TEXT,
      target_value TEXT,
      input_value TEXT,
      expected TEXT,
      require_approval INTEGER NOT NULL DEFAULT 0,
      timeout_ms INTEGER NOT NULL DEFAULT 10000,
      retry INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING',
      actual_json TEXT,
      error_message TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      case_no TEXT NOT NULL,
      step_no INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      snapshot_path TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      resolved_by TEXT,
      resolution_note TEXT,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      feature_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      attachments_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    CREATE INDEX IF NOT EXISTS idx_run_cases_run_id ON run_cases(run_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_run_cases_run_case_no ON run_cases(run_id, case_no);
    CREATE INDEX IF NOT EXISTS idx_run_logs_run_id ON run_logs(run_id);
    CREATE INDEX IF NOT EXISTS idx_run_case_steps_run_id ON run_case_steps(run_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_run_case_steps_unique ON run_case_steps(run_id, case_no, step_no);
    CREATE INDEX IF NOT EXISTS idx_approvals_run_id ON approvals(run_id);
    CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
    CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id ON conversation_messages(conversation_id);
  `);
};
