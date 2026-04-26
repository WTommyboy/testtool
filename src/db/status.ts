export const RUN_STATUSES = [
  "DRAFT",
  "ASSIGNED",
  "AGENT_RUNNING",
  "WAITING_USER",
  "UPLOADING_RESULT",
  "INGESTING_RESULT",
  "COMPLETED",
  "FAILED",
  "INTERRUPTED"
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_STATUS_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  DRAFT: ["ASSIGNED", "FAILED"],
  ASSIGNED: ["AGENT_RUNNING", "FAILED", "INTERRUPTED"],
  AGENT_RUNNING: ["WAITING_USER", "UPLOADING_RESULT", "FAILED", "INTERRUPTED"],
  WAITING_USER: ["AGENT_RUNNING", "FAILED", "INTERRUPTED"],
  UPLOADING_RESULT: ["INGESTING_RESULT", "FAILED"],
  INGESTING_RESULT: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
  INTERRUPTED: ["ASSIGNED", "FAILED"]
};

export const isRunStatus = (value: string): value is RunStatus => {
  return RUN_STATUSES.includes(value as RunStatus);
};

export const canTransitionRunStatus = (from: RunStatus, to: RunStatus): boolean => {
  return RUN_STATUS_TRANSITIONS[from].includes(to);
};
