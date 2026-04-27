import { randomUUID } from "node:crypto";
import { db } from "./db";

export type RunEvent = {
  id: string;
  run_id: string;
  event_type: string;
  seq: number | null;
  payload_json: string | null;
  created_at: string;
};

export const insertRunEvent = (
  runId: string,
  eventType: string,
  payload: Record<string, unknown> = {},
  seq: number | null = null
): void => {
  db.prepare(
    `
      INSERT INTO run_events (id, run_id, event_type, seq, payload_json, created_at)
      VALUES (@id, @run_id, @event_type, @seq, @payload_json, @created_at)
    `
  ).run({
    id: randomUUID(),
    run_id: runId,
    event_type: eventType,
    seq,
    payload_json: JSON.stringify(payload),
    created_at: new Date().toISOString()
  });
};

export const listRunEvents = (runId: string, limit: number, afterId?: string): RunEvent[] => {
  const afterRow = afterId
    ? db.prepare("SELECT rowid FROM run_events WHERE run_id = ? AND id = ?").get(runId, afterId) as { rowid: number } | undefined
    : undefined;
  if (afterId && !afterRow) return [];
  if (afterRow) {
    return db
      .prepare(
        `
          SELECT *
          FROM run_events
          WHERE run_id = ? AND rowid > ?
          ORDER BY rowid ASC
          LIMIT ?
        `
      )
      .all(runId, afterRow.rowid, limit) as RunEvent[];
  }
  return db
    .prepare(
      `
        SELECT *
        FROM run_events
        WHERE run_id = ?
        ORDER BY rowid ASC
        LIMIT ?
      `
    )
    .all(runId, limit) as RunEvent[];
};
