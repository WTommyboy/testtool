import fs from "node:fs";
import path from "node:path";

export type TimingStatus = "active" | "ok" | "failed" | "skipped" | "requires_approval";

export type TimingEntry = {
  id: string;
  name: string;
  type: "agent_phase" | "codex_turn" | "codex_item" | "helper_action" | "artifact";
  status: TimingStatus;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  context?: Record<string, unknown>;
};

type ActiveTiming = Omit<TimingEntry, "status" | "endedAt" | "durationMs"> & {
  startedAtMs: number;
};

const nowIso = (): string => new Date().toISOString();

const percentile = (values: number[], ratio: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? null;
};

export class RunTimingRecorder {
  private sequence = 0;
  private active = new Map<string, ActiveTiming>();
  private entries: TimingEntry[] = [];

  constructor(
    private readonly runDir: string,
    private readonly runId: string
  ) {}

  start(
    name: string,
    type: TimingEntry["type"],
    context?: Record<string, unknown>
  ): string {
    this.sequence += 1;
    const id = `${type}:${name}:${this.sequence}`;
    this.active.set(id, {
      id,
      name,
      type,
      startedAt: nowIso(),
      startedAtMs: Date.now(),
      context
    });
    return id;
  }

  end(id: string, status: Exclude<TimingStatus, "active"> = "ok", context?: Record<string, unknown>): TimingEntry | null {
    const item = this.active.get(id);
    if (!item) return null;
    this.active.delete(id);
    const endedAtMs = Date.now();
    const entry: TimingEntry = {
      id: item.id,
      name: item.name,
      type: item.type,
      status,
      startedAt: item.startedAt,
      endedAt: new Date(endedAtMs).toISOString(),
      durationMs: Math.max(0, endedAtMs - item.startedAtMs),
      context: {
        ...(item.context ?? {}),
        ...(context ?? {})
      }
    };
    this.entries.push(entry);
    this.write();
    return entry;
  }

  instant(
    name: string,
    type: TimingEntry["type"],
    status: Exclude<TimingStatus, "active">,
    context?: Record<string, unknown>
  ): TimingEntry {
    const at = nowIso();
    const entry: TimingEntry = {
      id: `${type}:${name}:instant:${this.sequence + 1}`,
      name,
      type,
      status,
      startedAt: at,
      endedAt: at,
      durationMs: 0,
      context
    };
    this.sequence += 1;
    this.entries.push(entry);
    this.write();
    return entry;
  }

  failActive(context?: Record<string, unknown>): void {
    for (const id of [...this.active.keys()]) {
      this.end(id, "failed", context);
    }
  }

  summary(): Record<string, unknown> {
    const completed = this.entries.filter((entry) => typeof entry.durationMs === "number");
    const byName: Record<string, { count: number; totalMs: number; maxMs: number; p95Ms: number | null }> = {};
    for (const entry of completed) {
      const key = `${entry.type}:${entry.name}`;
      const bucket = byName[key] ?? { count: 0, totalMs: 0, maxMs: 0, p95Ms: null };
      bucket.count += 1;
      bucket.totalMs += entry.durationMs ?? 0;
      bucket.maxMs = Math.max(bucket.maxMs, entry.durationMs ?? 0);
      byName[key] = bucket;
    }

    for (const key of Object.keys(byName)) {
      const values = completed
        .filter((entry) => `${entry.type}:${entry.name}` === key)
        .map((entry) => entry.durationMs ?? 0);
      byName[key].p95Ms = percentile(values, 0.95);
    }

    return {
      schemaVersion: "uat-agent-timing-v1",
      generatedAt: nowIso(),
      runId: this.runId,
      totalCompletedMs: completed.reduce((total, entry) => total + (entry.durationMs ?? 0), 0),
      activeCount: this.active.size,
      entryCount: this.entries.length,
      byName,
      entries: this.entries,
      active: [...this.active.values()].map((entry) => ({
        id: entry.id,
        name: entry.name,
        type: entry.type,
        status: "active",
        startedAt: entry.startedAt,
        context: entry.context
      }))
    };
  }

  write(): string {
    const filePath = path.join(this.runDir, "output", "timing-summary.json");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(this.summary(), null, 2)}\n`);
    return filePath;
  }
}

export const formatDuration = (durationMs: number | null | undefined): string => {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) return "耗時未知";
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
};
