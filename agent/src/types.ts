export type AgentConfig = {
  version: 1;
  server: string;
  token: string;
  device_name: string;
  codex_bin: string;
  workdir_root: string;
  chrome_profile_dir: string;
  log_level: "debug" | "info" | "warn" | "error";
};

export type AgentMessage<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  seq: number;
  type: string;
  timestamp: string;
  ack_required: boolean;
  payload: TPayload;
};

export type DoctorCheck = {
  name: string;
  verdict: "PASS" | "FAIL" | "SKIPPED";
  details?: Record<string, unknown>;
};

export type AgentCapability = {
  platform: string;
  codex_version: string | null;
  node_version: string;
  supported_task_types: string[];
  supported_execution_modes: string[];
  tool_bridge_versions: string[];
  playwright_mcp_available: boolean;
  chrome_profile_ready: boolean;
  doctor_ok: boolean;
  doctor_checks: DoctorCheck[];
};
