import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

type Conversation = {
  id: string;
  title: string;
  feature_name?: string | null;
  created_at: string;
  updated_at: string;
};

type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type RunItem = {
  id: string;
  round_id: string;
  execution_mode?: "offline" | "interactive" | string;
  location: string;
  feature_main: string;
  feature_sub: string;
  run_name: string;
  status: string;
  caseStats?: Record<string, number>;
};

type Summary = {
  runId: string;
  runStatus: string;
  date?: string | null;
  tester?: string | null;
  location?: string | null;
  featureMain?: string | null;
  featureSub?: string | null;
  resultXlsxAvailable?: boolean;
  resultIngestedAt?: string | null;
  resultParserVersion?: string | null;
  logAvailable?: boolean;
  logUploadedAt?: string | null;
  timingSummaryAvailable?: boolean;
  timingSummaryUploadedAt?: string | null;
  diagnosticSummaryAvailable?: boolean;
  diagnosticSummaryUploadedAt?: string | null;
  artifactCount?: number;
  screenshotArtifactCount?: number;
  artifactManifestAvailable?: boolean;
  caseStats: Record<string, number>;
  stepStats: Record<string, number>;
  pendingApprovals: number;
};

type RunLog = {
  id: string;
  level: string;
  message: string;
  context_json: string | null;
  created_at: string;
};

type RunEvent = {
  id: string;
  event_type: string;
  seq: number | null;
  payload_json: string | null;
  payload?: unknown;
  created_at: string;
};

type RunActivityTab = "timeline" | "logs" | "events";

type RunActivityPage<T> = {
  items: T[];
  hasMore?: boolean;
  total?: number;
  nextAfterId?: string | null;
  limit?: number;
};

type RunTimelineItem = {
  id: string;
  createdAt: string;
  type: "event" | "log";
  marker: string;
  message: string;
};

type RunPhase = {
  id: string;
  phase: string;
  title: string;
  detail?: string;
  status: "active" | "done" | "waiting" | "failed" | string;
  createdAt: string;
  durationMs?: number | null;
};

type TimingSummary = {
  schemaVersion?: string;
  generatedAt?: string;
  totalCompletedMs?: number;
  entryCount?: number;
  activeCount?: number;
  byName?: Record<string, { count: number; totalMs: number; maxMs: number; p95Ms: number | null }>;
};

type DiagnosticSummary = {
  schemaVersion?: string;
  generatedAt?: string;
  caseNo?: string | null;
  purpose?: string | null;
  fromStep?: number | null;
  untilStep?: number | null;
  executionMode?: string;
  evidenceGaps?: string[];
  locatorDrift?: unknown[];
  executedSteps?: Array<{ stepNo?: number; template?: string; status?: string; durationMs?: number }>;
  canPromoteToTrustedResult?: boolean;
};

type RunArtifact = {
  id: string;
  caseNo?: string | null;
  action?: string | null;
  artifactType: string;
  originalName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  relativePath?: string | null;
  source?: string | null;
  retentionClass?: string | null;
  uploadedAt?: string | null;
  downloadUrl?: string | null;
};

type RunCase = {
  id: string;
  case_no: string;
  case_title: string;
  group_id?: string | null;
  group_name?: string | null;
  execution_type: string;
  result_status: string;
  detail_json?: string | null;
  fail_category?: string | null;
};

type BugItem = {
  id: string;
  round_id: string;
  severity: string;
  related_case_no: string;
  description: string;
  suggestion: string;
};

type PlaywrightHealthStatus = "checking" | "connected" | "available" | "unavailable";

type PlaywrightHealthResponse = {
  status?: string;
  message?: string;
};

type AgentDoctorCheck = {
  name: string;
  verdict: "PASS" | "FAIL" | "SKIPPED";
  details?: Record<string, unknown>;
};

type AgentItem = {
  id: string;
  deviceName: string;
  agentVersion: string | null;
  platform: string | null;
  codexVersion: string | null;
  nodeVersion: string | null;
  supportedTaskTypes: string[];
  supportedExecutionModes: string[];
  toolBridgeVersions: string[];
  playwrightMcpAvailable: boolean | null;
  chromeProfileReady: boolean | null;
  doctorOk: boolean | null;
  doctorChecks: AgentDoctorCheck[];
  connectedAt: string;
  lastSeenAt: string;
  status: "idle" | "busy" | "unknown";
  currentRunId: string | null;
};

type Approval = {
  id: string;
  case_no: string;
  step_no: number;
  reason: string;
  status: string;
  resolved_by?: string | null;
  created_at?: string;
  snapshot_path?: string | null;
};

type ApprovalRequestInfo = {
  isToolRequest: boolean;
  type: string;
  action: string;
  requestId: string;
  reason: string;
};

type AuthUser = {
  login: string;
  id: string;
  name: string | null;
  avatarUrl: string | null;
};

type AuthMeResponse = {
  authenticated: boolean;
  authRequired: boolean;
  user: AuthUser | null;
  loginUrl?: string;
};

const terminalRunStatuses = new Set(["SUCCEEDED", "FAILED", "CANCELLED", "CANCELED"]);
const cancellableRunStatuses = new Set(["READY", "RUNNING", "WAITING_APPROVAL", "VALIDATING"]);
const defaultRunLocation = "數據中心";
const defaultRunFeatureMain = "BI工具";
const defaultRunName = "Round 1";
const defaultRunDevUrl = "https://galaxy.games.gamania.com/biapi-dev/testview/home?gameID=541";
const runActivityPageSize = 500;

const isTerminalRunStatus = (status?: string | null): boolean => {
  return Boolean(status && terminalRunStatuses.has(status));
};

const isCancellableRunStatus = (status?: string | null): boolean => {
  return Boolean(status && cancellableRunStatuses.has(status));
};

const buildApiUrl = (url: string): string => {
  const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
  return base ? `${base}${url}` : url;
};

const api = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const resp = await fetch(buildApiUrl(url), {
    credentials: "include",
    ...init,
  });
  const data = (await resp.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!resp.ok) {
    throw new Error(data.message || data.error || `HTTP_${resp.status}`);
  }
  return data;
};

const optionalJson = async <T,>(url: string): Promise<T | null> => {
  const resp = await fetch(buildApiUrl(url), { credentials: "include" });
  if (resp.status === 404) return null;
  if (!resp.ok) return null;
  return (await resp.json().catch(() => null)) as T | null;
};

const formatDate = (v?: string): string => {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("zh-TW", { hour12: false });
};

const formatDuration = (ms?: number | null): string => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "進行中";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${hours}h ${restMinutes}m`;
};

const formatBytes = (bytes?: number | null): string => {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};

const numberOf = (obj: Record<string, number> | undefined, key: string): number => obj?.[key] ?? 0;
const objectValue = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
);
const mergeById = <T extends { id: string },>(current: T[], incoming: T[], reset: boolean): T[] => {
  if (reset) return incoming;
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
};

const parseApprovalReason = (reason: string): ApprovalRequestInfo => {
  const lines = reason.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0] ?? reason.trim();
  const toolMatch = firstLine.match(/^TOOL_REQUEST\s+([^:]+):\s*(.*)$/i);
  const lineValue = (prefix: string): string => {
    const found = lines.find((line) => line.toLowerCase().startsWith(prefix.toLowerCase()));
    return found ? found.slice(prefix.length).trim() : "";
  };
  return {
    isToolRequest: Boolean(toolMatch),
    type: toolMatch?.[1] ?? "manual_approval",
    action: toolMatch?.[2] ?? firstLine,
    requestId: lineValue("request_id:"),
    reason: lineValue("reason:")
  };
};

const getCaseGroupName = (c: RunCase): string => {
  if (c.group_name && c.group_name.trim()) return c.group_name.trim();
  const m = c.case_no.match(/^[A-Za-z]+/);
  return m ? m[0].toUpperCase() : "未分組";
};

function App() {
  const [tab, setTab] = useState<"conversations" | "execution" | "history">("history");
  const [authStatus, setAuthStatus] = useState<"checking" | "authenticated" | "unauthenticated">("checking");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [authError, setAuthError] = useState("");

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string>("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [newConversationTitle, setNewConversationTitle] = useState("BI UAT 對話");
  const [newConversationFeature, setNewConversationFeature] = useState("拼貼模式");
  const [messageInput, setMessageInput] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [conversationError, setConversationError] = useState("");
  const [exportPaths, setExportPaths] = useState<{ jsonPath: string; mdPath: string } | null>(null);
  const pushRoundId = "R_CONV_001";
  const pushCasesJson = '[{"caseNo":"B-08","caseTitle":"半動態區間","executionType":"semi"}]';

  const [history, setHistory] = useState<RunItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [runStatusFilter, setRunStatusFilter] = useState("");
  const [runRoundFilter, setRunRoundFilter] = useState("");
  const [sourceMode, setSourceMode] = useState<"upload" | "conversation">("upload");
  const [runExecutionMode, setRunExecutionMode] = useState<"interactive" | "offline" | "diagnostic">("interactive");
  const [diagnosticFromStep, setDiagnosticFromStep] = useState("");
  const [diagnosticUntilStep, setDiagnosticUntilStep] = useState("");
  const [diagnosticPurpose, setDiagnosticPurpose] = useState("");
  const [autoSelectLatestRun, setAutoSelectLatestRun] = useState(true);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [uploadXlsx, setUploadXlsx] = useState<File | null>(null);
  const [uploadDocs, setUploadDocs] = useState<File[]>([]);
  const [uploadCsv, setUploadCsv] = useState<File | null>(null);
  const [runRoundId, setRunRoundId] = useState("");
  const [runLocation, setRunLocation] = useState(defaultRunLocation);
  const [runFeatureMain, setRunFeatureMain] = useState(defaultRunFeatureMain);
  const [runFeatureSub, setRunFeatureSub] = useState("");
  const [runName, setRunName] = useState(defaultRunName);
  const [runDevUrl, setRunDevUrl] = useState(defaultRunDevUrl);
  const [runPage, setRunPage] = useState(1);
  const [runTotal, setRunTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [runLogs, setRunLogs] = useState<RunLog[]>([]);
  const [runActivityTab, setRunActivityTab] = useState<RunActivityTab>("timeline");
  const [runEventsTotal, setRunEventsTotal] = useState(0);
  const [runLogsTotal, setRunLogsTotal] = useState(0);
  const [runEventsHasMore, setRunEventsHasMore] = useState(false);
  const [runLogsHasMore, setRunLogsHasMore] = useState(false);
  const [runActivityBusy, setRunActivityBusy] = useState(false);
  const [runCases, setRunCases] = useState<RunCase[]>([]);
  const [runBugs, setRunBugs] = useState<BugItem[]>([]);
  const [caseGroupFilter, setCaseGroupFilter] = useState("ALL");
  const [caseStatusFilter, setCaseStatusFilter] = useState("ALL");
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [timingSummary, setTimingSummary] = useState<TimingSummary | null>(null);
  const [diagnosticSummary, setDiagnosticSummary] = useState<DiagnosticSummary | null>(null);
  const [runArtifacts, setRunArtifacts] = useState<RunArtifact[]>([]);
  const [runBusy, setRunBusy] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [runError, setRunError] = useState("");
  const [startError, setStartError] = useState<string | null>(null);
  const [playwrightStatus, setPlaywrightStatus] = useState<PlaywrightHealthStatus>("checking");
  const [resolvedBy, setResolvedBy] = useState("tommy");
  const [approvalConfirmations, setApprovalConfirmations] = useState<Record<string, boolean>>({});
  const [approvalNotes, setApprovalNotes] = useState<Record<string, string>>({});
  const [pmReviewNotes, setPmReviewNotes] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadXlsxInputRef = useRef<HTMLInputElement>(null);
  const uploadDocsInputRef = useRef<HTMLInputElement>(null);
  const uploadCsvInputRef = useRef<HTMLInputElement>(null);
  const runEventsRef = useRef<RunEvent[]>([]);
  const runLogsRef = useRef<RunLog[]>([]);

  const selectedConversation = conversations.find((x) => x.id === selectedConversationId) ?? null;
  const selectedRun = history.find((x) => x.id === selectedRunId) ?? null;
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;
  const selectedAgentDoctorStats = selectedAgent?.doctorChecks.reduce(
    (acc, check) => {
      acc[check.verdict] += 1;
      return acc;
    },
    { PASS: 0, FAIL: 0, SKIPPED: 0 } as Record<AgentDoctorCheck["verdict"], number>
  ) ?? { PASS: 0, FAIL: 0, SKIPPED: 0 };
  const selectedAgentFailedChecks = selectedAgent?.doctorChecks.filter((check) => check.verdict === "FAIL") ?? [];
  const selectedAgentMacPermissionCheck = selectedAgent?.doctorChecks.find((check) => check.name === "macos-ui-automation-permissions");
  const pendingApprovals = approvals.filter((x) => x.status === "PENDING");
  const getSelectedAgentBlockingReason = (): string | null => {
    if (runExecutionMode === "offline") return null;
    if (!selectedAgent) return "請先選擇一台在線 Agent";
    if (selectedAgent.status === "busy") return `Agent 正在執行 ${selectedAgent.currentRunId || "其他 Run"}`;
    if (selectedAgent.status !== "idle") return "Agent 尚未 ready";
    if (selectedAgent.doctorOk === false) return "Agent doctor 未通過，請先在本機執行 uat-agent doctor";
    if (selectedAgent.supportedTaskTypes.length > 0 && !selectedAgent.supportedTaskTypes.includes("uat_run")) {
      return "Agent 不支援 uat_run 任務";
    }
    if (selectedAgent.supportedExecutionModes.length > 0 && !selectedAgent.supportedExecutionModes.includes(runExecutionMode)) {
      return `Agent 不支援 ${runExecutionMode} 模式`;
    }
    return null;
  };
  const selectedAgentBlockingReason = getSelectedAgentBlockingReason();

  const totalCases = runCases.length || Object.values(summary?.caseStats ?? {}).reduce((a, b) => a + b, 0);
  const passCases = numberOf(summary?.caseStats, "PASS") + numberOf(summary?.caseStats, "MANUAL_PASS");
  const failCases = numberOf(summary?.caseStats, "FAIL") + numberOf(summary?.caseStats, "MANUAL_FAIL");
  const blockedCases = numberOf(summary?.caseStats, "BLOCKED") + numberOf(summary?.caseStats, "MANUAL_BLOCKED");
  const pendingCases = numberOf(summary?.caseStats, "PENDING") + numberOf(summary?.caseStats, "MANUAL_PENDING");
  const runningCases = totalCases > 0 ? Math.max(0, totalCases - passCases - failCases - blockedCases - pendingCases) : 0;
  const hasSelectedRunDetail = Boolean(selectedRunId && summary);
  const selectedRunIsTerminal = isTerminalRunStatus(summary?.runStatus);
  const selectedRunCanCancel = isCancellableRunStatus(summary?.runStatus);
  const selectedRunLabel = selectedRun?.round_id || summary?.runId || selectedRunId;

  const passPct = totalCases > 0 ? (passCases / totalCases) * 100 : 0;
  const failPct = totalCases > 0 ? (failCases / totalCases) * 100 : 0;
  const blockedPct = totalCases > 0 ? (blockedCases / totalCases) * 100 : 0;
  const pendingPct = totalCases > 0 ? (pendingCases / totalCases) * 100 : 0;
  const rawRunPhases: RunPhase[] = runEvents
    .filter((event) => event.event_type === "run.phase")
    .map((event) => {
      const payload = objectValue(event.payload);
      return {
        id: event.id,
        phase: String(payload?.phase ?? "unknown"),
        title: String(payload?.title ?? payload?.phase ?? "Agent phase"),
        detail: typeof payload?.detail === "string" ? payload.detail : undefined,
        status: String(payload?.status ?? "active"),
        createdAt: event.created_at,
      };
    });
  const nowMs = Date.now();
  const runPhases: RunPhase[] = rawRunPhases.map((phase, index) => {
    const startedAt = new Date(phase.createdAt).getTime();
    const nextStartedAt = rawRunPhases[index + 1] ? new Date(rawRunPhases[index + 1].createdAt).getTime() : null;
    const fallbackEnd = !selectedRunIsTerminal && (phase.status === "active" || phase.status === "waiting") ? nowMs : null;
    const endedAt = nextStartedAt ?? fallbackEnd;
    return {
      ...phase,
      durationMs: Number.isFinite(startedAt) && endedAt !== null && Number.isFinite(endedAt)
        ? Math.max(0, endedAt - startedAt)
        : null
    };
  });
  const latestRunPhase = runPhases.at(-1) ?? null;

  const checkPlaywrightHealth = async (): Promise<{ status: PlaywrightHealthStatus; message: string }> => {
    try {
      const resp = await fetch(buildApiUrl("/api/playwright/health"), { credentials: "include" });
      const data = (await resp.json().catch(() => ({}))) as PlaywrightHealthResponse;
      if (!resp.ok) {
        return {
          status: "unavailable",
          message: data.message || "Playwright 未連線"
        };
      }
      const status = data.status === "connected" || data.status === "available" ? data.status : "available";
      return {
        status,
        message: data.message || "Playwright 可用"
      };
    } catch {
      return {
        status: "unavailable",
        message: "無法連線到 Playwright 服務，請確認服務已啟動。"
      };
    }
  };

  const clearXlsxSelection = () => {
    setUploadXlsx(null);
    if (uploadXlsxInputRef.current) uploadXlsxInputRef.current.value = "";
  };

  const clearDocsSelection = () => {
    setUploadDocs([]);
    if (uploadDocsInputRef.current) uploadDocsInputRef.current.value = "";
  };

  const clearCsvSelection = () => {
    setUploadCsv(null);
    if (uploadCsvInputRef.current) uploadCsvInputRef.current.value = "";
  };

  const clearUploadSelections = () => {
    clearXlsxSelection();
    clearDocsSelection();
    clearCsvSelection();
  };

  const removeUploadDoc = (index: number) => {
    setUploadDocs((current) => current.filter((_, currentIndex) => currentIndex !== index));
    if (uploadDocsInputRef.current) uploadDocsInputRef.current.value = "";
  };

  const resetRunDraftForm = () => {
    setSourceMode("upload");
    setRunExecutionMode("interactive");
    setDiagnosticFromStep("");
    setDiagnosticUntilStep("");
    setDiagnosticPurpose("");
    setRunRoundId("");
    setRunLocation(defaultRunLocation);
    setRunFeatureMain(defaultRunFeatureMain);
    setRunFeatureSub("");
    setRunName(defaultRunName);
    setRunDevUrl(defaultRunDevUrl);
    clearUploadSelections();
    setRunError("");
    setStartError(null);
  };

  const getCaseGroups = (): string[] => [...new Set(runCases.map((c) => getCaseGroupName(c)))];
  const getStatusCounts = (): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const c of runCases) {
      const status = c.result_status || "PENDING";
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return counts;
  };
  const getGroupStats = (groupName: string): Record<string, number> => {
    const items = runCases.filter((c) => getCaseGroupName(c) === groupName);
    const stats: Record<string, number> = { total: items.length };
    for (const c of items) {
      const status = c.result_status || "PENDING";
      stats[status] = (stats[status] ?? 0) + 1;
    }
    return stats;
  };
  const getFilteredRunCases = (): RunCase[] => {
    let items = runCases;
    if (caseGroupFilter !== "ALL") {
      items = items.filter((c) => getCaseGroupName(c) === caseGroupFilter);
    }
    if (caseStatusFilter !== "ALL") {
      items = items.filter((c) => c.result_status === caseStatusFilter);
    }
    return [...items].sort((a, b) => {
      const ga = getCaseGroupName(a);
      const gb = getCaseGroupName(b);
      if (ga !== gb) return ga.localeCompare(gb, "zh-Hant");
      return a.case_no.localeCompare(b.case_no, "en");
    });
  };

  const renderCaseResultsCard = (maxHeight: number) => {
    const filtered = getFilteredRunCases();
    const statusCounts = getStatusCounts();
    let lastGroup = "";

    return (
      <div className="card mb-16">
        <div className="card-header">
          <h2>案例結果</h2>
          <span className="count">{runCases.length}</span>
        </div>

        {runCases.length > 0 ? (
          <div className="case-filters">
            <button className={`filter-pill ${caseGroupFilter === "ALL" ? "active" : ""}`} onClick={() => setCaseGroupFilter("ALL")}>
              全部 <span className="filter-count">{runCases.length}</span>
            </button>
            {getCaseGroups().map((g) => {
              const label = g.split("：")[0] || g;
              const count = runCases.filter((c) => getCaseGroupName(c) === g).length;
              return (
                <button key={g} className={`filter-pill ${caseGroupFilter === g ? "active" : ""}`} onClick={() => setCaseGroupFilter(g)}>
                  {label} <span className="filter-count">{count}</span>
                </button>
              );
            })}
            <div className="filter-sep" />
            <button className={`filter-pill ${caseStatusFilter === "ALL" ? "active" : ""}`} onClick={() => setCaseStatusFilter("ALL")}>
              所有狀態
            </button>
            {Object.entries(statusCounts).map(([status, count]) => (
              <button
                key={status}
                className={`filter-pill ${caseStatusFilter === status ? `active-${status.toLowerCase()}` : ""}`}
                onClick={() => setCaseStatusFilter(status)}
              >
                {status} <span className="filter-count">{count}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="scroll-y" style={{ maxHeight }}>
          {filtered.length === 0 ? (
            <p className="muted" style={{ padding: 24, textAlign: "center" }}>無符合條件的測試案例</p>
          ) : (
            filtered.map((c) => {
              const groupName = getCaseGroupName(c);
              const showGroupHeader = groupName !== lastGroup;
              if (showGroupHeader) lastGroup = groupName;
              const gs = showGroupHeader ? getGroupStats(groupName) : null;
              const isOpen = expandedCaseId === c.id;
              let detailRows: Array<[string, string]> = [];
              if (isOpen && c.detail_json) {
                try {
                  const obj = JSON.parse(c.detail_json) as Record<string, unknown>;
                  detailRows = Object.entries(obj).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v ?? "")]);
                } catch {
                  detailRows = [];
                }
              }

              return (
                <div key={c.id}>
                  {showGroupHeader ? (
                    <div className="group-header">
                      <span className="group-name">{groupName}</span>
                      <span className="group-stats">
                        {(gs?.PASS || gs?.MANUAL_PASS) ? <span className="gs-pass">{(gs.PASS ?? 0) + (gs.MANUAL_PASS ?? 0)} Pass</span> : null}
                        {(gs?.FAIL || gs?.MANUAL_FAIL) ? <span className="gs-fail">{(gs.FAIL ?? 0) + (gs.MANUAL_FAIL ?? 0)} Fail</span> : null}
                        {(gs?.BLOCKED || gs?.MANUAL_BLOCKED) ? <span className="gs-blocked">{(gs.BLOCKED ?? 0) + (gs.MANUAL_BLOCKED ?? 0)} Blocked</span> : null}
                      </span>
                    </div>
                  ) : null}

                  <div className={`case-row ${isOpen ? "open" : ""}`} onClick={() => setExpandedCaseId(isOpen ? null : c.id)}>
                    <span className="case-expand">{isOpen ? "▼" : "▶"}</span>
                    <span className="case-no">{c.case_no}</span>
                    <span className="case-title">{c.case_title}</span>
                    <span className="exec-type">{c.execution_type}</span>
                    <span className={`badge ${c.result_status}`}>{c.result_status || "—"}</span>
                    <span className="fail-cat">{c.fail_category || "—"}</span>
                  </div>

                  {isOpen ? (
                    <div className="case-detail">
                      <table className="detail-table">
                        <tbody>
                          {detailRows.length > 0 ? (
                            detailRows.map(([k, v], i) => (
                              <tr key={`${c.id}-${i}`}>
                                <td className="dt-key">{k}</td>
                                <td className="dt-val">{v}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td className="dt-key">狀態</td>
                              <td className="dt-val muted">尚未有詳細紀錄</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      <div className="pm-review-box">
                        <div className="pm-review-title">PM 最終判定</div>
                        <textarea
                          value={pmReviewNotes[c.id] ?? ""}
                          onChange={(event) => setPmReviewNotes((current) => ({ ...current, [c.id]: event.target.value }))}
                          placeholder="複核備註（選填）"
                        />
                        <div className="pm-review-actions">
                          <button className="btn sm success" onClick={() => void handlePmReview(c, "MANUAL_PASS")} disabled={runBusy}>
                            PM Pass
                          </button>
                          <button className="btn sm danger" onClick={() => void handlePmReview(c, "MANUAL_FAIL")} disabled={runBusy}>
                            PM Fail
                          </button>
                          <button className="btn sm" onClick={() => void handlePmReview(c, "MANUAL_BLOCKED")} disabled={runBusy}>
                            PM Blocked
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const renderApprovalCard = (approval: Approval) => {
    const requestInfo = parseApprovalReason(approval.reason);
    const isIrreversible = requestInfo.type === "irreversible_operation";
    const confirmed = Boolean(approvalConfirmations[approval.id]);
    const note = approvalNotes[approval.id] ?? "";
    const continueDisabled = runBusy || isStarting || !resolvedBy.trim() || (isIrreversible && !confirmed);

    return (
      <div key={approval.id} className={`approval-card ${isIrreversible ? "irreversible" : ""}`}>
        <div className="approval-title-row">
          <span className={`badge ${isIrreversible ? "blocked" : "waiting"}`}>
            {isIrreversible ? "不可逆操作授權" : requestInfo.type}
          </span>
          {requestInfo.requestId ? <span className="approval-request-id">{requestInfo.requestId}</span> : null}
        </div>
        <div className="approval-detail-grid">
          <span>Case</span>
          <strong>{approval.case_no}</strong>
          <span>Step</span>
          <strong>{approval.step_no}</strong>
          <span>動作</span>
          <strong>{requestInfo.action || approval.reason}</strong>
          <span>原因</span>
          <strong>{requestInfo.reason || approval.reason}</strong>
        </div>
        <div className="meta">暫停時間 {formatDate(approval.created_at)}</div>
        {approval.snapshot_path ? <div className="screenshot">截圖：{approval.snapshot_path}</div> : null}

        {isIrreversible ? (
          <label className="approval-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => {
                setApprovalConfirmations((current) => ({
                  ...current,
                  [approval.id]: event.target.checked
                }));
              }}
            />
            <span>我確認授權上述不可逆操作，且只限這個 request id。</span>
          </label>
        ) : null}

        <div className="form-group approval-note">
          <label>授權備註（選填）</label>
          <textarea
            value={note}
            rows={2}
            placeholder={isIrreversible ? "例如：只允許儲存本次臨時測試報表" : "補充給 Agent 的處理說明"}
            onChange={(event) => {
              setApprovalNotes((current) => ({
                ...current,
                [approval.id]: event.target.value
              }));
            }}
          />
        </div>

        <div className="approval-actions">
          <button
            className="btn success sm"
            onClick={() => void handleResolveApproval(approval, "continue")}
            disabled={continueDisabled}
            title={isIrreversible && !confirmed ? "請先勾選明確授權" : undefined}
          >
            {isIrreversible ? "授權並繼續執行" : "繼續執行"}
          </button>
          <button className="btn sm" onClick={() => void handleResolveApproval(approval, "skip")} disabled={runBusy || isStarting}>
            拒絕 / 跳過此 Case
          </button>
          <button
            className="btn danger sm"
            onClick={() => selectedRunId && void handleRunAction("cancel", selectedRunId)}
            disabled={!selectedRunCanCancel || runBusy || isStarting}
            title={!selectedRunCanCancel ? "此 Run 已結束，不能再取消" : undefined}
          >
            取消整個 Run
          </button>
        </div>
      </div>
    );
  };

  const renderBugCard = () => (
    <div className="card">
      <div className="card-header">
        <h2>🐛 已發現 Bug（{runBugs.length}）</h2>
      </div>
      {runBugs.length > 0 ? (
        runBugs.map((b) => (
          <div key={b.id} className="bug-card">
            <div className="bug-header">
              <span className={`sev-badge ${b.severity.toLowerCase()}`}>{b.severity}</span>
              <span className="bug-id">{b.related_case_no}</span>
            </div>
            <div className="bug-desc">{b.description}</div>
            <div className="bug-suggestion">💡 {b.suggestion}</div>
          </div>
        ))
      ) : (
        <p className="muted">目前沒有已記錄的 Bug</p>
      )}
    </div>
  );

  const renderPhaseCard = () => {
    if (runPhases.length === 0) return null;
    const visiblePhases = runPhases.slice(-8);
    return (
      <div className="card phase-card mb-16">
        <div className="card-header">
          <h2>目前執行階段</h2>
          {latestRunPhase ? <span className={`badge phase-${latestRunPhase.status}`}>{latestRunPhase.status}</span> : null}
        </div>
        {latestRunPhase ? (
          <div className="phase-current">
            <div>
              <div className="phase-title">{latestRunPhase.title}</div>
              {latestRunPhase.detail ? <div className="phase-detail">{latestRunPhase.detail}</div> : null}
            </div>
            <div className="phase-time">
              <div>{new Date(latestRunPhase.createdAt).toLocaleTimeString("zh-TW", { hour12: false })}</div>
              <div className="phase-duration">{formatDuration(latestRunPhase.durationMs)}</div>
            </div>
          </div>
        ) : null}
        <div className="phase-list">
          {visiblePhases.map((phase) => (
            <div className={`phase-step ${phase.status}`} key={phase.id}>
              <span className="phase-dot" />
              <span className="phase-step-time">{new Date(phase.createdAt).toLocaleTimeString("zh-TW", { hour12: false })}</span>
              <span className="phase-step-title">{phase.title}</span>
              <span className="phase-step-duration">{formatDuration(phase.durationMs)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderArtifactSummaryCard = () => {
    if (
      !timingSummary
      && !diagnosticSummary
      && runArtifacts.length === 0
      && !summary?.timingSummaryAvailable
      && !summary?.diagnosticSummaryAvailable
      && !summary?.artifactCount
    ) {
      return null;
    }
    const timingRows = Object.entries(timingSummary?.byName ?? {})
      .sort(([, a], [, b]) => (b.totalMs ?? 0) - (a.totalMs ?? 0))
      .slice(0, 5);
    const evidenceRows = [...runArtifacts]
      .sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""))
      .slice(0, 8);
    return (
      <div className="card artifact-card mb-16">
        <div className="card-header">
          <h2>Artifacts 與診斷</h2>
          <span className="count">
            {summary?.artifactCount ? `${summary.artifactCount} files` : timingSummary ? formatDuration(timingSummary.totalCompletedMs) : "—"}
          </span>
        </div>
        <div className="artifact-grid">
          <div>
            <div className="artifact-title">Timing Summary</div>
            {timingSummary ? (
              <div className="artifact-list">
                {timingRows.length === 0 ? <span className="muted">尚無 timing bucket</span> : null}
                {timingRows.map(([name, bucket]) => (
                  <div className="artifact-row" key={name}>
                    <span>{name}</span>
                    <strong>{formatDuration(bucket.totalMs)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">尚未載入 timing summary</p>
            )}
          </div>
          <div>
            <div className="artifact-title">Diagnostic Summary</div>
            {diagnosticSummary ? (
              <div className="artifact-list">
                <div className="artifact-row">
                  <span>Case</span>
                  <strong>{diagnosticSummary.caseNo || "—"}</strong>
                </div>
                <div className="artifact-row">
                  <span>Executed steps</span>
                  <strong>{diagnosticSummary.executedSteps?.length ?? 0}</strong>
                </div>
                <div className="artifact-row">
                  <span>Step range</span>
                  <strong>
                    {diagnosticSummary.fromStep || diagnosticSummary.untilStep
                      ? `${diagnosticSummary.fromStep ?? "start"}-${diagnosticSummary.untilStep ?? "end"}`
                      : "—"}
                  </strong>
                </div>
                <div className="artifact-row">
                  <span>Locator drift</span>
                  <strong>{diagnosticSummary.locatorDrift?.length ?? 0}</strong>
                </div>
                <div className="artifact-row">
                  <span>Trusted result</span>
                  <strong>{diagnosticSummary.canPromoteToTrustedResult ? "可升級" : "不可升級"}</strong>
                </div>
              </div>
            ) : (
              <p className="muted">尚無 diagnostic summary</p>
            )}
          </div>
          <div>
            <div className="artifact-title">Evidence Artifacts</div>
            {evidenceRows.length > 0 ? (
              <div className="artifact-list">
                {evidenceRows.map((artifact) => (
                  <a
                    className="artifact-row artifact-link"
                    key={artifact.id}
                    href={artifact.downloadUrl ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>{artifact.caseNo || "run"} · {artifact.artifactType}</span>
                    <strong>{formatBytes(artifact.sizeBytes)}</strong>
                  </a>
                ))}
              </div>
            ) : (
              <p className="muted">
                {summary?.artifactCount ? "Artifacts 尚未載入" : "尚無 evidence artifact"}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderRunLogCard = (maxHeight: number) => {
    const eventItems: RunTimelineItem[] = runEvents.map((event) => {
        let payloadText = event.payload_json || "";
        if (event.payload) {
          payloadText = typeof event.payload === "object" ? JSON.stringify(event.payload) : String(event.payload);
        }
        return {
          id: `event-${event.id}`,
          createdAt: event.created_at,
          type: "event",
          marker: event.event_type,
          message: payloadText.slice(0, 600)
        };
      });
    const logItems: RunTimelineItem[] = runLogs.map((log) => ({
        id: `log-${log.id}`,
        createdAt: log.created_at,
        type: "log",
        marker: log.level,
        message: log.message
      }));
    const timelineItems = [
      ...eventItems.filter((event) => event.marker !== "run.progress" && event.marker !== "run.phase"),
      ...logItems
    ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const visibleItems = runActivityTab === "logs"
      ? logItems
      : runActivityTab === "events"
        ? eventItems
        : timelineItems;
    const canLoadMore = runLogsHasMore || runEventsHasMore;
    const loadedLabel = `Events ${runEvents.length}/${runEventsTotal || runEvents.length} / Logs ${runLogs.length}/${runLogsTotal || runLogs.length}`;

    return (
      <div className="card mb-16">
        <div className="card-header">
          <h2>即時執行 Log / Events</h2>
          <span className="count">{loadedLabel}</span>
        </div>
        <div className="run-log-toolbar">
          <div className="run-log-tabs" role="tablist" aria-label="Log view">
            <button className={runActivityTab === "timeline" ? "active" : ""} onClick={() => setRunActivityTab("timeline")}>
              Timeline
            </button>
            <button className={runActivityTab === "logs" ? "active" : ""} onClick={() => setRunActivityTab("logs")}>
              Logs
            </button>
            <button className={runActivityTab === "events" ? "active" : ""} onClick={() => setRunActivityTab("events")}>
              Events
            </button>
          </div>
          <button className="btn sm" onClick={() => void loadMoreRunActivity()} disabled={!selectedRunId || !canLoadMore || runActivityBusy}>
            {runActivityBusy ? "載入中" : canLoadMore ? "載入下一批" : "已載入全部"}
          </button>
        </div>
        <div className="scroll-y run-log-list" style={{ maxHeight }}>
          {visibleItems.length === 0 ? (
            <p className="muted" style={{ padding: 24, textAlign: "center" }}>尚未有執行事件</p>
          ) : (
            visibleItems.map((item) => (
              <div className={`log-entry ${item.type === "event" ? "event-entry" : ""}`} key={item.id}>
                <span className="log-time">{new Date(item.createdAt).toLocaleTimeString("zh-TW", { hour12: false })}</span>
                <span className={item.type === "event" ? "event-type" : `log-level ${item.marker}`}>{item.marker}</span>
                <span className="log-msg">{item.message || "—"}</span>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  const loadAuth = async () => {
    setAuthError("");
    try {
      const resp = await fetch(buildApiUrl("/api/auth/me"), { credentials: "include" });
      const data = (await resp.json().catch(() => ({}))) as Partial<AuthMeResponse> & { error?: string; message?: string };
      if (resp.status === 401) {
        setAuthRequired(Boolean(data.authRequired ?? true));
        setAuthUser(null);
        setAuthStatus("unauthenticated");
        return;
      }
      if (!resp.ok) {
        throw new Error(data.message || data.error || `HTTP_${resp.status}`);
      }
      setAuthRequired(Boolean(data.authRequired));
      setAuthUser(data.user ?? null);
      setAuthStatus("authenticated");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
      setAuthStatus("unauthenticated");
    }
  };

  const handleLogin = () => {
    window.location.href = `${buildApiUrl("/api/auth/github/start")}?returnTo=${encodeURIComponent(window.location.href)}`;
  };

  const handleLogout = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      setAuthUser(null);
      setAuthStatus("unauthenticated");
    }
  };

  const loadConversations = async () => {
    try {
      const data = await api<{ items: Conversation[] }>("/api/conversations");
      setConversations(data.items);
      if (!selectedConversationId && data.items[0]) {
        setSelectedConversationId(data.items[0].id);
      }
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : String(error));
    }
  };

  const loadConversationDetail = async (conversationId: string) => {
    if (!conversationId) return;
    try {
      const data = await api<{ messages: ConversationMessage[] }>(`/api/conversations/${conversationId}`);
      setMessages(data.messages);
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : String(error));
    }
  };

  const loadRuns = async () => {
    setRunBusy(true);
    setRunError("");
    try {
      const params = new URLSearchParams({
        page: String(runPage),
        pageSize: "20",
      });
      if (runStatusFilter) params.set("status", runStatusFilter);
      if (runRoundFilter) params.set("roundId", runRoundFilter);
      const data = await api<{ items: RunItem[]; total: number }>(`/api/runs/history?${params.toString()}`);
      setHistory(data.items);
      setRunTotal(data.total);
      if (!selectedRunId && autoSelectLatestRun && data.items[0]) {
        setSelectedRunId(data.items[0].id);
      }
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunBusy(false);
    }
  };

  const loadAgents = async () => {
    try {
      const data = await api<{ items: AgentItem[] }>("/api/agents");
      setAgents(data.items);
      setSelectedAgentId((current) => {
        if (current && data.items.some((agent) => agent.id === current)) return current;
        return data.items.find((agent) => agent.status === "idle")?.id ?? data.items[0]?.id ?? "";
      });
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    }
  };

  const fetchRunActivity = async (
    runId: string,
    resetActivity: boolean
  ): Promise<{ eventsData: RunActivityPage<RunEvent>; logsData: RunActivityPage<RunLog> }> => {
    const buildActivityParams = (afterId?: string) => {
      const params = new URLSearchParams({ limit: String(runActivityPageSize) });
      if (afterId) params.set("after_id", afterId);
      return params;
    };
    const eventAfterId = resetActivity ? undefined : runEventsRef.current.at(-1)?.id;
    const logAfterId = resetActivity ? undefined : runLogsRef.current.at(-1)?.id;
    const [eventsData, logsData] = await Promise.all([
      api<RunActivityPage<RunEvent>>(`/api/runs/${runId}/events?${buildActivityParams(eventAfterId).toString()}`),
      api<RunActivityPage<RunLog>>(`/api/runs/${runId}/logs?${buildActivityParams(logAfterId).toString()}`)
    ]);
    return { eventsData, logsData };
  };

  const applyRunActivity = (
    resetActivity: boolean,
    eventsData: RunActivityPage<RunEvent>,
    logsData: RunActivityPage<RunLog>
  ) => {
    const nextEvents = mergeById(runEventsRef.current, eventsData.items, resetActivity);
    const nextLogs = mergeById(runLogsRef.current, logsData.items, resetActivity);
    runEventsRef.current = nextEvents;
    runLogsRef.current = nextLogs;
    setRunEvents(nextEvents);
    setRunLogs(nextLogs);
    setRunEventsHasMore(Boolean(eventsData.hasMore));
    setRunLogsHasMore(Boolean(logsData.hasMore));
    setRunEventsTotal(eventsData.total ?? nextEvents.length);
    setRunLogsTotal(logsData.total ?? nextLogs.length);
  };

  const loadMoreRunActivity = async () => {
    if (!selectedRunId || runActivityBusy) return;
    setRunActivityBusy(true);
    try {
      const { eventsData, logsData } = await fetchRunActivity(selectedRunId, false);
      applyRunActivity(false, eventsData, logsData);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunActivityBusy(false);
    }
  };

  const loadRunDetail = async (runId: string, options: { resetActivity?: boolean } = {}) => {
    if (!runId) return;
    try {
      const resetActivity = Boolean(options.resetActivity);
      const [summaryData, activityData, casesData, approvalsData, artifactsData] = await Promise.all([
        api<Summary>(`/api/runs/${runId}/summary`),
        fetchRunActivity(runId, resetActivity),
        api<{ items: RunCase[] }>(`/api/runs/${runId}/cases`),
        api<{ items: Approval[] }>(`/api/runs/${runId}/approvals`),
        optionalJson<{ items: RunArtifact[] }>(`/api/runs/${runId}/artifacts`)
      ]);
      const [timingData, diagnosticData] = await Promise.all([
        optionalJson<TimingSummary>(`/api/runs/${runId}/output/timing-summary`),
        optionalJson<DiagnosticSummary>(`/api/runs/${runId}/output/diagnostic-summary`)
      ]);
      setSummary(summaryData);
      applyRunActivity(resetActivity, activityData.eventsData, activityData.logsData);
      setRunCases(casesData.items);
      setApprovals(approvalsData.items);
      setTimingSummary(timingData);
      setDiagnosticSummary(diagnosticData);
      setRunArtifacts(artifactsData?.items ?? []);
      try {
        const bugsData = await api<{ items: BugItem[] }>(`/api/runs/${runId}/bugs`);
        setRunBugs(bugsData.items);
      } catch {
        setRunBugs([]);
      }
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    }
  };

  const clearSelectedRunDetail = () => {
    setAutoSelectLatestRun(false);
    setSelectedRunId("");
    setSummary(null);
    runEventsRef.current = [];
    runLogsRef.current = [];
    setRunEvents([]);
    setRunLogs([]);
    setRunEventsTotal(0);
    setRunLogsTotal(0);
    setRunEventsHasMore(false);
    setRunLogsHasMore(false);
    setRunActivityTab("timeline");
    setRunCases([]);
    setRunBugs([]);
    setApprovals([]);
    setTimingSummary(null);
    setDiagnosticSummary(null);
    setRunArtifacts([]);
    setApprovalConfirmations({});
    setApprovalNotes({});
    setExpandedCaseId(null);
    resetRunDraftForm();
  };

  useEffect(() => {
    void loadAuth();
  }, []);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    void loadConversations();
    void loadRuns();
    void loadAgents();
  }, [authStatus]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    if (selectedConversationId) {
      void loadConversationDetail(selectedConversationId);
    }
  }, [authStatus, selectedConversationId]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    void loadRuns();
  }, [authStatus, runPage]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    if (selectedRunId) {
      void loadRunDetail(selectedRunId, { resetActivity: true });
    }
  }, [authStatus, selectedRunId]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    if (!selectedRunId) return;
    if (!(summary?.runStatus === "RUNNING" || summary?.runStatus === "WAITING_APPROVAL")) return;
    const timer = setInterval(() => {
      void loadRunDetail(selectedRunId, { resetActivity: false });
    }, 2500);
    return () => clearInterval(timer);
  }, [authStatus, selectedRunId, summary?.runStatus]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    if (runExecutionMode === "offline") return;
    const timer = setInterval(() => {
      void loadAgents();
    }, 10000);
    return () => clearInterval(timer);
  }, [authStatus, runExecutionMode]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    let cancelled = false;
    const poll = async () => {
      const health = await checkPlaywrightHealth();
      if (!cancelled) {
        setPlaywrightStatus(health.status);
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [authStatus]);

  const handleCreateConversation = async (e: FormEvent) => {
    e.preventDefault();
    setConversationBusy(true);
    setConversationError("");
    try {
      const created = await api<{ id: string }>("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newConversationTitle,
          featureName: newConversationFeature,
        }),
      });
      await loadConversations();
      setSelectedConversationId(created.id);
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : String(error));
    } finally {
      setConversationBusy(false);
    }
  };

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedConversationId || (!messageInput.trim() && attachedFiles.length === 0)) return;
    setConversationBusy(true);
    setConversationError("");
    try {
      if (attachedFiles.length > 0) {
        const formData = new FormData();
        formData.append("content", messageInput.trim());
        for (const file of attachedFiles) {
          formData.append("attachments", file);
        }
        await api(`/api/conversations/${selectedConversationId}/messages`, {
          method: "POST",
          body: formData
        });
      } else {
        await api(`/api/conversations/${selectedConversationId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: messageInput })
        });
      }
      setMessageInput("");
      setAttachedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadConversationDetail(selectedConversationId);
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : String(error));
    } finally {
      setConversationBusy(false);
    }
  };

  const handleExport = async () => {
    if (!selectedConversationId) return;
    setConversationBusy(true);
    setConversationError("");
    try {
      const data = await api<{ jsonPath: string; mdPath: string }>(`/api/conversations/${selectedConversationId}/export`, {
        method: "POST",
      });
      setExportPaths(data);
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : String(error));
    } finally {
      setConversationBusy(false);
    }
  };

  const handlePushToRun = async () => {
    if (!selectedConversationId) return;
    setConversationBusy(true);
    setConversationError("");
    try {
      const cases = JSON.parse(pushCasesJson) as Array<{ caseNo: string; caseTitle: string; executionType: string }>;
      await api(`/api/conversations/${selectedConversationId}/push-to-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roundId: pushRoundId,
          location: "數據中心",
          featureMain: "BI工具",
          featureSub: "拼貼模式",
          runName: `from-conv-${Date.now()}`,
          devUrl: "https://example.com",
          cases,
        }),
      });
      setTab("execution");
      await loadRuns();
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : String(error));
    } finally {
      setConversationBusy(false);
    }
  };

  const handleRunAction = async (action: "start" | "cancel", runId: string) => {
    if (action === "start") {
      setIsStarting(true);
      setStartError(null);
    } else {
      setRunBusy(true);
      setRunError("");
    }
    try {
      await api(`/api/runs/${runId}/${action}`, { method: "POST" });
      await loadRuns();
      await loadRunDetail(runId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (action === "start") {
        setStartError(message);
      } else {
        setRunError(message);
      }
    } finally {
      if (action === "start") {
        setIsStarting(false);
      } else {
        setRunBusy(false);
      }
    }
  };

  const handleDispatchRunToAgent = async (runId: string) => {
    const blockReason = getSelectedAgentBlockingReason();
    if (blockReason) {
      setStartError(blockReason);
      return;
    }
    if (!selectedAgentId) return;

    setRunBusy(true);
    setIsStarting(true);
    setRunError("");
    setStartError(null);
    try {
      await api(`/api/runs/${runId}/dispatch-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: selectedAgentId })
      });
      await loadAgents();
      await loadRuns();
      await loadRunDetail(runId);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunBusy(false);
      setIsStarting(false);
    }
  };

  const handleCreateRun = async () => {
    setRunBusy(true);
    setIsStarting(true);
    setRunError("");
    setStartError(null);
    try {
      if (runExecutionMode === "offline") {
        const health = await checkPlaywrightHealth();
        setPlaywrightStatus(health.status);
        if (health.status === "unavailable") {
          // Keep creation flow moving; backend /start has the final authoritative health gate.
          setStartError(`預檢查：${health.message || "Playwright 未連線"}，將交由啟動時再次確認。`);
        }
      } else if (selectedAgentBlockingReason) {
        setRunError(selectedAgentBlockingReason);
        return;
      }

      if (!runRoundId.trim()) {
        setRunError("請填寫輪次 ID");
        return;
      }
      const formData = new FormData();
      formData.append("sourceMode", sourceMode);
      formData.append("roundId", runRoundId.trim());
      formData.append("location", runLocation.trim() || "數據中心");
      formData.append("featureMain", runFeatureMain.trim() || "BI工具");
      formData.append("featureSub", runFeatureSub.trim() || "拼貼模式");
      formData.append("runName", runName.trim() || `Run-${Date.now()}`);
      formData.append("devUrl", runDevUrl.trim());
      formData.append("executionMode", runExecutionMode);
      if (runExecutionMode === "diagnostic") {
        if (diagnosticFromStep.trim()) formData.append("diagnosticFromStep", diagnosticFromStep.trim());
        if (diagnosticUntilStep.trim()) formData.append("diagnosticUntilStep", diagnosticUntilStep.trim());
        if (diagnosticPurpose.trim()) formData.append("diagnosticPurpose", diagnosticPurpose.trim());
      }

      if (sourceMode === "upload") {
        if (!uploadXlsx || uploadDocs.length === 0) {
          setRunError("請上傳 xlsx 和至少一份說明文件");
          return;
        }
        formData.append("testcaseXlsx", uploadXlsx);
        for (const file of uploadDocs) {
          formData.append("testcaseMd", file);
        }
      } else {
        if (!selectedConversationId) {
          setRunError("請先選擇對話");
          return;
        }
        formData.append("conversationId", selectedConversationId);
      }

      if (uploadCsv) {
        formData.append("referenceCsv", uploadCsv);
      }

      const created = await api<{ id: string; status: string }>("/api/runs", {
        method: "POST",
        body: formData
      });

      clearUploadSelections();
      setAutoSelectLatestRun(true);
      setSelectedRunId(created.id);
      await loadRuns();
      await loadRunDetail(created.id, { resetActivity: true });

      try {
        if (runExecutionMode !== "offline") {
          await api(`/api/runs/${created.id}/dispatch-agent`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentId: selectedAgentId }),
          });
        } else {
          await api(`/api/runs/${created.id}/start`, { method: "POST" });
        }
        await loadRuns();
        await loadRunDetail(created.id);
      } catch (error) {
        setStartError(error instanceof Error ? error.message : String(error));
      }
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunBusy(false);
      setIsStarting(false);
    }
  };

  const handleResolveApproval = async (approval: Approval, action: "continue" | "skip") => {
    if (!selectedRunId) return;
    const requestInfo = parseApprovalReason(approval.reason);
    const requiresExplicitAuthorization = requestInfo.type === "irreversible_operation";
    if (action === "continue" && requiresExplicitAuthorization && !approvalConfirmations[approval.id]) {
      setRunError("不可逆操作必須先勾選明確授權，才能繼續執行。");
      return;
    }
    const note = approvalNotes[approval.id]?.trim() || (
      action === "continue" && requiresExplicitAuthorization
        ? `UI explicit authorization for request_id=${requestInfo.requestId || "unknown"}`
        : ""
    );
    setRunBusy(true);
    setRunError("");
    try {
      await api(`/api/runs/${selectedRunId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseNo: approval.case_no,
          stepNo: approval.step_no,
          action,
          resolvedBy,
          note,
        }),
      });
      setApprovalConfirmations((current) => {
        const next = { ...current };
        delete next[approval.id];
        return next;
      });
      setApprovalNotes((current) => {
        const next = { ...current };
        delete next[approval.id];
        return next;
      });
      await loadRuns();
      await loadRunDetail(selectedRunId);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunBusy(false);
    }
  };

  const handlePmReview = async (runCase: RunCase, finalStatus: "MANUAL_PASS" | "MANUAL_FAIL" | "MANUAL_BLOCKED") => {
    if (!selectedRunId) return;
    setRunBusy(true);
    setRunError("");
    try {
      await api(`/api/runs/${selectedRunId}/pm-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseNo: runCase.case_no,
          finalStatus,
          reviewedBy: resolvedBy,
          note: pmReviewNotes[runCase.id]?.trim() || undefined,
        }),
      });
      setPmReviewNotes((current) => {
        const next = { ...current };
        delete next[runCase.id];
        return next;
      });
      await loadRuns();
      await loadRunDetail(selectedRunId);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunBusy(false);
    }
  };

  const handleDownloadMd = async () => {
    if (!selectedRunId) return;
      setRunError("");
    try {
      const requestUrl = buildApiUrl(`/api/runs/${selectedRunId}/export-md`);
      const resp = await fetch(requestUrl, { method: "POST", credentials: "include" });
      if (!resp.ok) {
        const msg = await resp.text().catch(() => "");
        throw new Error(msg || "Export failed");
      }

      const blob = await resp.blob();
      const disposition = resp.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const rawName = match?.[1] ? decodeURIComponent(match[1]) : `UAT_report_${selectedRunId}.md`;
      const downloadName = rawName.replace(/[/\\]/g, "_");

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDownloadXlsx = async () => {
    if (!selectedRunId) return;
    setRunError("");
    try {
      const requestUrl = buildApiUrl(`/api/runs/${selectedRunId}/output/result-xlsx`);
      const resp = await fetch(requestUrl, { credentials: "include" });
      if (!resp.ok) {
        const msg = await resp.text().catch(() => "");
        throw new Error(msg || "尚無可下載的 result.xlsx");
      }

      const blob = await resp.blob();
      const disposition = resp.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const rawName = match?.[1] ? decodeURIComponent(match[1]) : `UAT_result_${selectedRunId}.xlsx`;
      const downloadName = rawName.replace(/[/\\]/g, "_");

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDownloadLog = async () => {
    if (!selectedRunId) return;
    setRunError("");
    try {
      const requestUrl = buildApiUrl(`/api/runs/${selectedRunId}/output/log`);
      const resp = await fetch(requestUrl, { credentials: "include" });
      if (!resp.ok) {
        const msg = await resp.text().catch(() => "");
        throw new Error(msg || "尚無可下載的 Agent log");
      }

      const blob = await resp.blob();
      const disposition = resp.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const rawName = match?.[1] ? decodeURIComponent(match[1]) : `UAT_agent_log_${selectedRunId}.log`;
      const downloadName = rawName.replace(/[/\\]/g, "_");

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    }
  };

  if (authStatus === "checking") {
    return (
      <main className="app auth-screen">
        <section className="auth-card card">
          <h1>Galaxy UAT Test Tool</h1>
          <p className="muted">正在檢查登入狀態...</p>
        </section>
      </main>
    );
  }

  if (authStatus === "unauthenticated") {
    return (
      <main className="app auth-screen">
        <section className="auth-card card">
          <h1>Galaxy UAT Test Tool</h1>
          <p className="muted">
            {authRequired ? "線上工具需要 GitHub OAuth 登入後才能使用。" : "目前無法確認登入狀態。"}
          </p>
          {authError ? <p className="error-msg">{authError}</p> : null}
          <button type="button" className="btn primary" onClick={handleLogin}>
            使用 GitHub 登入
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="topbar-left">
          <h1>
            🔬 <span>Galaxy</span> UAT Test Tool
          </h1>
          <span className="env-pill">DEV</span>
        </div>
        <div className="tabs">
          <button className={`tab-btn ${tab === "conversations" ? "active" : ""}`} onClick={() => setTab("conversations")}>
            💬 對話生成
          </button>
          <button className={`tab-btn ${tab === "execution" ? "active" : ""}`} onClick={() => setTab("execution")}>
            ▶️ 測試執行
          </button>
          <button className={`tab-btn ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>
            📋 執行紀錄
          </button>
          {authUser ? (
            <button className="tab-btn auth-user" onClick={() => void handleLogout()} title="登出">
              {authUser.login} 登出
            </button>
          ) : null}
        </div>
      </header>

      {tab === "conversations" ? (
        <section className="panel">
          <div className="grid-sidebar">
            <div>
              <div className="card mb-16">
                <div className="card-header">
                  <h2>建立新對話</h2>
                </div>
                <form className="form-row" onSubmit={handleCreateConversation}>
                  <div className="form-group">
                    <label>對話名稱</label>
                    <input value={newConversationTitle} onChange={(e) => setNewConversationTitle(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>功能模組</label>
                    <input value={newConversationFeature} onChange={(e) => setNewConversationFeature(e.target.value)} />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <button className="btn primary" style={{ width: "100%" }} disabled={conversationBusy}>
                      建立對話
                    </button>
                  </div>
                </form>
              </div>

              <div className="card">
                <div className="card-header">
                  <h2>歷史對話</h2>
                  <span className="count">{conversations.length}</span>
                </div>
                <div className="conv-list">
                  {conversations.map((c) => (
                    <button
                      key={c.id}
                      className={`conv-item ${selectedConversationId === c.id ? "selected" : ""}`}
                      onClick={() => setSelectedConversationId(c.id)}
                    >
                      <div className="title">{c.title}</div>
                      <div className="feature">
                        {c.feature_name || "未分類"} · {formatDate(c.created_at)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h2>{selectedConversation?.title || "請先建立或選擇對話"}</h2>
                <div className="actions">
                  <button className="btn sm" onClick={() => fileInputRef.current?.click()} disabled={!selectedConversationId || conversationBusy}>
                    📎 上傳文件
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".md,.pdf,.xlsx,.csv,.txt"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length > 0) {
                        setAttachedFiles((prev) => [...prev, ...files]);
                      }
                    }}
                  />
                  <button className="btn sm" onClick={() => void handleExport()} disabled={!selectedConversationId || conversationBusy}>
                    📄 匯出 MD
                  </button>
                  <button className="btn sm success" onClick={() => void handlePushToRun()} disabled={!selectedConversationId || conversationBusy}>
                    🚀 推送到執行
                  </button>
                </div>
              </div>

              {conversationError ? <p className="error-msg">{conversationError}</p> : null}
              {exportPaths ? <p className="muted">已匯出：{exportPaths.mdPath}</p> : null}

              <div className="chat-container">
                <div className="chat-messages">
                  {messages.map((m) => (
                    <div key={m.id} className={`chat-bubble ${m.role}`}>
                      {m.content}
                      <div className="time">{formatDate(m.created_at)}</div>
                    </div>
                  ))}
                </div>
                <form className="chat-input" onSubmit={handleSendMessage}>
                  <textarea value={messageInput} onChange={(e) => setMessageInput(e.target.value)} placeholder="輸入訊息..." />
                  <button className="btn primary" disabled={conversationBusy || !selectedConversationId || (!messageInput.trim() && attachedFiles.length === 0)}>
                    送出
                  </button>
                </form>
                {attachedFiles.length > 0 ? (
                  <div className="attached-list">
                    {attachedFiles.map((f, idx) => (
                      <span key={`${f.name}-${idx}`} className="file-name">
                        📎 {f.name}
                        <button
                          type="button"
                          className="file-remove"
                          onClick={() => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

            </div>
          </div>
        </section>
      ) : null}

      {tab === "execution" ? (
        <section className="panel">
          <div className="card mb-16">
            <div className="card-header">
              <div className="card-title-with-status">
                <h2>測試執行設定</h2>
                <span className={`pw-status ${playwrightStatus === "unavailable" ? "is-unavailable" : ""}`}>
                  <span className="pw-dot">●</span>{" "}
                  {playwrightStatus === "checking"
                    ? "檢查中..."
                    : playwrightStatus === "connected"
                      ? "Playwright 已連線"
                      : playwrightStatus === "available"
                        ? "Playwright 可用"
                        : "Playwright 未連線"}
                </span>
              </div>
              <span className={`badge ${summary?.runStatus || "DRAFT"}`}>{summary?.runStatus || "DRAFT"}</span>
            </div>

            {hasSelectedRunDetail ? (
              <div className={`run-selection-notice ${selectedRunIsTerminal ? "is-terminal" : ""}`}>
                <div>
                  <strong>
                    目前下方顯示的是已選取 Run：{selectedRunLabel}
                    {summary?.runStatus ? ` / ${summary.runStatus}` : ""}
                  </strong>
                  <p>
                    {selectedRunIsTerminal
                      ? "這是歷史結果，不會被再次執行。填寫上方欄位後按「開始執行」會建立新的 Run。"
                      : "這是目前追蹤中的 Run。若要建立全新的測試，請先清空結果面板。"}
                  </p>
                </div>
                <button type="button" className="btn sm" onClick={clearSelectedRunDetail} disabled={runBusy || isStarting}>
                  清空為新測試草稿
                </button>
              </div>
            ) : null}

            <div className="form-row">
              <div className="form-group">
                <label>TESTCASE 來源</label>
                <select value={sourceMode} onChange={(e) => setSourceMode(e.target.value as "upload" | "conversation")}>
                  <option value="upload">上傳 xlsx + md</option>
                  <option value="conversation">從對話推送</option>
                </select>
              </div>
              <div className="form-group">
                <label>執行模式</label>
                <select value={runExecutionMode} onChange={(e) => setRunExecutionMode(e.target.value as "interactive" | "offline" | "diagnostic")}>
                  <option value="interactive">Agent 互動執行（推薦）</option>
                  <option value="diagnostic">Diagnostic 快速診斷（不產正式結果）</option>
                  <option value="offline">離線 Runner（批次）</option>
                </select>
              </div>
              <div className="form-group">
                <label>輪次 ID</label>
                <input value={runRoundId} onChange={(e) => setRunRoundId(e.target.value)} placeholder="例如 RC-R001" />
              </div>
	            </div>

	            {runExecutionMode === "diagnostic" ? (
	              <div className="form-row">
	                <div className="form-group">
	                  <label>From Step</label>
	                  <input
	                    type="number"
	                    min="1"
	                    value={diagnosticFromStep}
	                    onChange={(e) => setDiagnosticFromStep(e.target.value)}
	                    placeholder="選填"
	                  />
	                </div>
	                <div className="form-group">
	                  <label>Until Step</label>
	                  <input
	                    type="number"
	                    min="1"
	                    value={diagnosticUntilStep}
	                    onChange={(e) => setDiagnosticUntilStep(e.target.value)}
	                    placeholder="選填"
	                  />
	                </div>
	                <div className="form-group">
	                  <label>Diagnostic 目的</label>
	                  <input
	                    value={diagnosticPurpose}
	                    onChange={(e) => setDiagnosticPurpose(e.target.value)}
	                    placeholder="例如只驗 helper/timing 或 selector drift"
	                  />
	                </div>
	              </div>
	            ) : null}

	            {runExecutionMode !== "offline" ? (
	              <div className="form-row">
                <div className="form-group">
                  <label>執行 Agent</label>
                  <select value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)}>
                    <option value="">尚未偵測到在線 Agent</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id} disabled={agent.status === "busy"}>
                        {agent.deviceName}｜{agent.status}
                        {agent.currentRunId ? `｜${agent.currentRunId}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Agent 狀態</label>
                  <div className="agent-status-panel">
                    <div className="inline-actions">
                      <span className="muted">
                        {agents.length > 0 ? `${agents.filter((agent) => agent.status === "idle").length} 台可用 / ${agents.length} 台在線` : "沒有在線 Agent"}
                      </span>
                      <button type="button" className="btn sm" onClick={() => void loadAgents()} disabled={runBusy || isStarting}>
                        重新整理
                      </button>
                    </div>
                    {selectedAgent ? (
                      <div className="agent-capability">
                        <div>
                          <span className={`badge ${selectedAgent.doctorOk === false ? "FAIL" : selectedAgent.status.toUpperCase()}`}>
                            {selectedAgent.doctorOk === false ? "DOCTOR FAIL" : selectedAgent.status}
                          </span>
                          <span className="muted">最後心跳 {formatDate(selectedAgent.lastSeenAt)}</span>
                        </div>
                        <div className="agent-capability-grid">
                          <span>Codex: {selectedAgent.codexVersion || "unknown"}</span>
                          <span>Node: {selectedAgent.nodeVersion || "unknown"}</span>
                          <span>Platform: {selectedAgent.platform || "unknown"}</span>
                          <span>Doctor: PASS {selectedAgentDoctorStats.PASS} / FAIL {selectedAgentDoctorStats.FAIL} / SKIP {selectedAgentDoctorStats.SKIPPED}</span>
                        </div>
                        {selectedAgentFailedChecks.length > 0 ? (
                          <div className="agent-check-failures">
                            {selectedAgentFailedChecks.map((check) => (
                              <span key={check.name} className="error-msg">
                                {check.name}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {selectedAgentMacPermissionCheck ? (
                          <div className="agent-guidance">
                            macOS 權限建議：Terminal / Codex / Google Chrome 開啟 Accessibility、Screen Recording、Automation。
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {sourceMode === "upload" ? (
              <div className="upload-zone">
                <div className="form-row">
                  <div className="form-group">
                    <label>
                      Testcase XLSX <span className="required">*</span>
                    </label>
                    <div className="file-input-wrap">
                      <input ref={uploadXlsxInputRef} type="file" accept=".xlsx,.xls" onChange={(e) => setUploadXlsx(e.target.files?.[0] || null)} />
                      {uploadXlsx ? (
                        <span className="file-name">
                          📊 {uploadXlsx.name}
                          <button type="button" className="file-remove" onClick={clearXlsxSelection}>
                            ✕
                          </button>
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="form-group">
                    <label>
                      Testcase 文件 <span className="required">*</span>
                    </label>
                    <div className="file-input-wrap">
                      <input
                        ref={uploadDocsInputRef}
                        type="file"
                        accept=".md,.txt,.pdf"
                        multiple
                        onChange={(e) => setUploadDocs(Array.from(e.target.files ?? []))}
                      />
                      {uploadDocs.length > 0 ? (
                        <div className="file-list">
                          {uploadDocs.map((file, index) => (
                            <span className="file-name" key={`${file.name}-${file.lastModified}-${index}`}>
                              📄 {index === 0 ? "主說明：" : "附件："}{file.name}
                              <button
                                type="button"
                                className="file-remove"
                                onClick={() => removeUploadDoc(index)}
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <span className="hint-text">可一次選多檔；第一份會作為 startup instruction，其餘會一併傳給 Mac Agent。</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="form-group">
                <label>選擇對話</label>
                <select value={selectedConversationId} onChange={(e) => setSelectedConversationId(e.target.value)}>
                  <option value="">請選擇對話...</option>
                  {conversations.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} ({c.feature_name || "-"})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-row">
              <div className="form-group">
                <label>位置</label>
                <input value={runLocation} onChange={(e) => setRunLocation(e.target.value)} />
              </div>
              <div className="form-group">
                <label>功能主項</label>
                <input value={runFeatureMain} onChange={(e) => setRunFeatureMain(e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>功能細項</label>
                <input
                  value={runFeatureSub}
                  onChange={(e) => setRunFeatureSub(e.target.value)}
                  placeholder="例如 自訂報表 / 明細模式"
                />
              </div>
              <div className="form-group">
                <label>輪次名稱</label>
                <input value={runName} onChange={(e) => setRunName(e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Dev URL</label>
                <input value={runDevUrl} onChange={(e) => setRunDevUrl(e.target.value)} />
              </div>
              <div className="form-group">
                <label>參考數據 CSV（選填）</label>
                <div className="file-input-wrap">
                  <input ref={uploadCsvInputRef} type="file" accept=".csv" onChange={(e) => setUploadCsv(e.target.files?.[0] || null)} />
                  {uploadCsv ? (
                    <span className="file-name">
                      📋 {uploadCsv.name}
                      <button type="button" className="file-remove" onClick={clearCsvSelection}>
                        ✕
                      </button>
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {runError ? <p className="error-msg">{runError}</p> : null}

            <div className="flex flex-end mt-8 gap-8">
              <button className="btn" onClick={() => void loadRuns()} disabled={runBusy || isStarting}>
                查詢
              </button>
              <button
                className="btn primary"
                onClick={() => void handleCreateRun()}
                disabled={runBusy || isStarting || (runExecutionMode !== "offline" && Boolean(selectedAgentBlockingReason))}
                title={selectedAgentBlockingReason || undefined}
              >
                {isStarting ? (
                  <>
                    <span className="spinner-sm" /> {runExecutionMode !== "offline" ? "派發 Agent..." : "檢查 Playwright..."}
                  </>
                ) : (
                  <>▶ 開始執行</>
                )}
              </button>
              {selectedRunId && summary?.runStatus === "READY" && selectedRun?.execution_mode !== "offline" ? (
                <button
                  className="btn success"
                  onClick={() => void handleDispatchRunToAgent(selectedRunId)}
                  disabled={runBusy || isStarting || Boolean(selectedAgentBlockingReason)}
                  title={selectedAgentBlockingReason || "派發目前選取的 READY Run 到 Agent"}
                >
                  🛰️ 派發目前 Run
                </button>
              ) : null}
              <button
                className="btn danger"
                onClick={() => selectedRunId && void handleRunAction("cancel", selectedRunId)}
                disabled={!selectedRunId || !selectedRunCanCancel || runBusy || isStarting}
                title={selectedRunId && !selectedRunCanCancel ? "此 Run 已結束，不能再取消" : undefined}
              >
                取消 Run
              </button>
            </div>
              {runExecutionMode !== "offline" && selectedAgentBlockingReason ? (
              <p className="muted mt-8">Agent 檢查：{selectedAgentBlockingReason}</p>
            ) : null}
            {startError ? (
              <div className="error-banner">
                <span className="error-icon">⚠️</span>
                <div className="error-body">
                  <strong>無法啟動測試</strong>
                  <p>{startError}</p>
                </div>
                <button className="btn sm" onClick={() => setStartError(null)}>
                  ✕
                </button>
              </div>
            ) : null}
          </div>

          <div className="stats">
            <div className="stat">
              <div className="val">{totalCases}</div>
              <div className="lbl">總案例</div>
            </div>
            <div className="stat pass">
              <div className="val">{passCases}</div>
              <div className="lbl">Pass</div>
            </div>
            <div className="stat fail">
              <div className="val">{failCases}</div>
              <div className="lbl">Fail</div>
            </div>
            <div className="stat blocked">
              <div className="val">{blockedCases}</div>
              <div className="lbl">Blocked</div>
            </div>
            <div className="stat running">
              <div className="val">{runningCases}</div>
              <div className="lbl">執行中</div>
            </div>
            <div className="stat pending">
              <div className="val">{pendingCases}</div>
              <div className="lbl">Pending</div>
            </div>
          </div>

          <div className="progress-bar">
            <div className="seg pass" style={{ width: `${passPct}%` }} />
            <div className="seg fail" style={{ width: `${failPct}%` }} />
            <div className="seg blocked" style={{ width: `${blockedPct}%` }} />
            <div className="seg pending" style={{ width: `${pendingPct}%` }} />
          </div>

          <div className="grid-equal">
            <div className="card">
              <div className="card-header">
                <h2>⚠️ 等待人工處理</h2>
                <span className="badge waiting">{pendingApprovals.length} PENDING</span>
              </div>
              <div className="form-group">
                <label>Resolved By</label>
                <input value={resolvedBy} onChange={(e) => setResolvedBy(e.target.value)} />
              </div>
              {pendingApprovals.length === 0 ? <p className="muted">目前沒有待處理 approval</p> : null}
              {pendingApprovals.map((a) => renderApprovalCard(a))}
            </div>

            {renderCaseResultsCard(340)}
          </div>
          {renderPhaseCard()}
          {renderArtifactSummaryCard()}
          {renderRunLogCard(280)}
          {renderBugCard()}
        </section>
      ) : null}

      {tab === "history" ? (
        <section className="panel">
          <div className="card mb-16">
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>輪次 ID</label>
                <input value={runRoundFilter} onChange={(e) => setRunRoundFilter(e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>狀態</label>
                <select value={runStatusFilter} onChange={(e) => setRunStatusFilter(e.target.value)}>
                  <option value="">全部</option>
                  <option value="SUCCEEDED">SUCCEEDED</option>
                  <option value="FAILED">FAILED</option>
                  <option value="RUNNING">RUNNING</option>
                  <option value="WAITING_APPROVAL">WAITING_APPROVAL</option>
                  <option value="READY">READY</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>分頁</label>
                <div className="flex gap-8">
                  <button className="btn" onClick={() => setRunPage((x) => Math.max(1, x - 1))}>
                    上一頁
                  </button>
                  <button className="btn" onClick={() => setRunPage((x) => x + 1)}>
                    下一頁
                  </button>
                </div>
              </div>
              <button className="btn primary" onClick={() => void loadRuns()} disabled={runBusy}>
                查詢
              </button>
              <span className="muted">第 {runPage} 頁 / 共 {runTotal} 筆</span>
            </div>
          </div>

          {runError ? <p className="error-msg">{runError}</p> : null}

          <div className="grid-sidebar">
            <div className="card">
              <div className="card-header">
                <h2>執行歷史</h2>
                <span className="count">{runTotal} 筆</span>
              </div>
              <div className="run-list">
                {history.map((item) => (
                  <button
                    key={item.id}
                    className={`run-item ${selectedRunId === item.id ? "selected" : ""}`}
                    onClick={() => {
                      setAutoSelectLatestRun(true);
                      setSelectedRunId(item.id);
                    }}
                  >
                    <div className="run-info">
                      <div className="run-id">{item.round_id}</div>
                      <div className="run-name">{item.run_name}</div>
                    </div>
                    <span className={`badge ${item.status}`}>{item.status}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="card mb-16">
                <div className="card-header">
                  <h2>Run 摘要</h2>
                  <div className="actions">
                    <button className="btn sm" onClick={() => void handleDownloadMd()} disabled={!selectedRunId || runBusy}>
                      📄 下載 MD
                    </button>
                    <button
                      className="btn sm"
                      onClick={() => void handleDownloadXlsx()}
                      disabled={!selectedRunId || runBusy || !summary?.resultXlsxAvailable}
                    >
                      📊 下載 XLSX
                    </button>
                    <button
                      className="btn sm"
                      onClick={() => void handleDownloadLog()}
                      disabled={!selectedRunId || runBusy || !summary?.logAvailable}
                    >
                      🧾 下載 Log
                    </button>
                  </div>
                </div>
                <div className="run-meta">
                  <span>Run ID: {summary?.runId || "-"}</span>
                  <span>狀態: <span className={`badge ${summary?.runStatus || ""}`}>{summary?.runStatus || "-"}</span></span>
                  <span>執行日期: {summary?.date || "—"}</span>
                  <span>測試者: {summary?.tester || "—"}</span>
                  <span>位置: {summary?.location || "—"}</span>
                  <span>功能: {summary?.featureMain || "—"} / {summary?.featureSub || "—"}</span>
                  <span>Result XLSX: {summary?.resultXlsxAvailable ? "可下載" : "—"}</span>
                  <span>Agent Log: {summary?.logAvailable ? "可下載" : "—"}</span>
                  <span>Timing: {summary?.timingSummaryAvailable ? "可查看" : "—"}</span>
                  <span>Diagnostic: {summary?.diagnosticSummaryAvailable ? "可查看" : "—"}</span>
                  <span>Artifacts: {summary?.artifactCount ? `${summary.artifactCount} 個` : "—"}</span>
                  <span>Screenshots: {summary?.screenshotArtifactCount ? `${summary.screenshotArtifactCount} 張` : "—"}</span>
                  <span>Pending approvals: {summary?.pendingApprovals ?? 0}</span>
                </div>
                <div className="stats mt-8">
                  <div className="stat pass">
                    <div className="val">{passCases}</div>
                    <div className="lbl">Pass</div>
                  </div>
                  <div className="stat fail">
                    <div className="val">{failCases}</div>
                    <div className="lbl">Fail</div>
                  </div>
                  <div className="stat blocked">
                    <div className="val">{blockedCases}</div>
                    <div className="lbl">Blocked</div>
                  </div>
                  <div className="stat pending">
                    <div className="val">{pendingCases}</div>
                    <div className="lbl">Pending</div>
                  </div>
                </div>
              </div>

              {renderPhaseCard()}
              {renderArtifactSummaryCard()}
              {renderCaseResultsCard(280)}
              {renderBugCard()}
              {renderRunLogCard(260)}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}

export default App;
