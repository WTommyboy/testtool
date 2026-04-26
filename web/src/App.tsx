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

type RunCase = {
  id: string;
  case_no: string;
  case_title: string;
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

type AgentItem = {
  id: string;
  deviceName: string;
  agentVersion: string | null;
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

const api = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
  const requestUrl = base ? `${base}${url}` : url;
  const resp = await fetch(requestUrl, init);
  const data = (await resp.json()) as T & { error?: string; message?: string };
  if (!resp.ok) {
    throw new Error(data.message || data.error || `HTTP_${resp.status}`);
  }
  return data;
};

const formatDate = (v?: string): string => {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("zh-TW", { hour12: false });
};

const numberOf = (obj: Record<string, number> | undefined, key: string): number => obj?.[key] ?? 0;
const getCaseGroupName = (c: RunCase): string => {
  if (c.group_name && c.group_name.trim()) return c.group_name.trim();
  const m = c.case_no.match(/^[A-Za-z]+/);
  return m ? m[0].toUpperCase() : "未分組";
};

function App() {
  const [tab, setTab] = useState<"conversations" | "execution" | "history">("history");

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
  const [runExecutionMode, setRunExecutionMode] = useState<"interactive" | "offline">("interactive");
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [uploadXlsx, setUploadXlsx] = useState<File | null>(null);
  const [uploadMd, setUploadMd] = useState<File | null>(null);
  const [uploadCsv, setUploadCsv] = useState<File | null>(null);
  const [runRoundId, setRunRoundId] = useState("");
  const [runLocation, setRunLocation] = useState("數據中心");
  const [runFeatureMain, setRunFeatureMain] = useState("BI工具");
  const [runFeatureSub, setRunFeatureSub] = useState("");
  const [runName, setRunName] = useState("Round 1");
  const [runDevUrl, setRunDevUrl] = useState("https://galaxy.games.gamania.com/biapi-dev/testview/home?gameID=541");
  const [runPage, setRunPage] = useState(1);
  const [runTotal, setRunTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [runLogs, setRunLogs] = useState<RunLog[]>([]);
  const [runCases, setRunCases] = useState<RunCase[]>([]);
  const [runBugs, setRunBugs] = useState<BugItem[]>([]);
  const [caseGroupFilter, setCaseGroupFilter] = useState("ALL");
  const [caseStatusFilter, setCaseStatusFilter] = useState("ALL");
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [runBusy, setRunBusy] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [runError, setRunError] = useState("");
  const [startError, setStartError] = useState<string | null>(null);
  const [playwrightStatus, setPlaywrightStatus] = useState<PlaywrightHealthStatus>("checking");
  const [resolvedBy, setResolvedBy] = useState("tommy");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedConversation = conversations.find((x) => x.id === selectedConversationId) ?? null;
  const pendingApprovals = approvals.filter((x) => x.status === "PENDING");

  const totalCases = runCases.length || Object.values(summary?.caseStats ?? {}).reduce((a, b) => a + b, 0);
  const passCases = numberOf(summary?.caseStats, "PASS") + numberOf(summary?.caseStats, "MANUAL_PASS");
  const failCases = numberOf(summary?.caseStats, "FAIL") + numberOf(summary?.caseStats, "MANUAL_FAIL");
  const blockedCases = numberOf(summary?.caseStats, "BLOCKED") + numberOf(summary?.caseStats, "MANUAL_BLOCKED");
  const pendingCases = numberOf(summary?.caseStats, "PENDING") + numberOf(summary?.caseStats, "MANUAL_PENDING");
  const runningCases = totalCases > 0 ? Math.max(0, totalCases - passCases - failCases - blockedCases - pendingCases) : 0;

  const passPct = totalCases > 0 ? (passCases / totalCases) * 100 : 0;
  const failPct = totalCases > 0 ? (failCases / totalCases) * 100 : 0;
  const blockedPct = totalCases > 0 ? (blockedCases / totalCases) * 100 : 0;
  const pendingPct = totalCases > 0 ? (pendingCases / totalCases) * 100 : 0;

  const buildApiUrl = (url: string): string => {
    const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
    return base ? `${base}${url}` : url;
  };

  const checkPlaywrightHealth = async (): Promise<{ status: PlaywrightHealthStatus; message: string }> => {
    try {
      const resp = await fetch(buildApiUrl("/api/playwright/health"));
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
                        {gs?.PASS ? <span className="gs-pass">{gs.PASS} Pass</span> : null}
                        {gs?.FAIL ? <span className="gs-fail">{gs.FAIL} Fail</span> : null}
                        {gs?.BLOCKED ? <span className="gs-blocked">{gs.BLOCKED} Blocked</span> : null}
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
      if (!selectedRunId && data.items[0]) {
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

  const loadRunDetail = async (runId: string) => {
    if (!runId) return;
    try {
      const [summaryData, logsData, casesData, approvalsData] = await Promise.all([
        api<Summary>(`/api/runs/${runId}/summary`),
        api<{ items: RunLog[] }>(`/api/runs/${runId}/logs`),
        api<{ items: RunCase[] }>(`/api/runs/${runId}/cases`),
        api<{ items: Approval[] }>(`/api/runs/${runId}/approvals`),
      ]);
      setSummary(summaryData);
      setRunLogs(logsData.items);
      setRunCases(casesData.items);
      setApprovals(approvalsData.items);
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

  useEffect(() => {
    void loadConversations();
    void loadRuns();
    void loadAgents();
  }, []);

  useEffect(() => {
    if (selectedConversationId) {
      void loadConversationDetail(selectedConversationId);
    }
  }, [selectedConversationId]);

  useEffect(() => {
    void loadRuns();
  }, [runPage]);

  useEffect(() => {
    if (selectedRunId) {
      void loadRunDetail(selectedRunId);
    }
  }, [selectedRunId]);

  useEffect(() => {
    if (!selectedRunId) return;
    if (!(summary?.runStatus === "RUNNING" || summary?.runStatus === "WAITING_APPROVAL")) return;
    const timer = setInterval(() => {
      void loadRunDetail(selectedRunId);
    }, 2500);
    return () => clearInterval(timer);
  }, [selectedRunId, summary?.runStatus]);

  useEffect(() => {
    if (runExecutionMode !== "interactive") return;
    const timer = setInterval(() => {
      void loadAgents();
    }, 10000);
    return () => clearInterval(timer);
  }, [runExecutionMode]);

  useEffect(() => {
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
  }, []);

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
      } else if (!selectedAgentId) {
        setRunError("請先選擇一台在線 Agent");
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

      if (sourceMode === "upload") {
        if (!uploadXlsx || !uploadMd) {
          setRunError("請上傳 xlsx 和 md 檔案");
          return;
        }
        formData.append("testcaseXlsx", uploadXlsx);
        formData.append("testcaseMd", uploadMd);
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

      setUploadXlsx(null);
      setUploadMd(null);
      setUploadCsv(null);
      setSelectedRunId(created.id);
      await loadRuns();
      await loadRunDetail(created.id);

      try {
        if (runExecutionMode === "interactive") {
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
        }),
      });
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
      const resp = await fetch(requestUrl, { method: "POST" });
      if (!resp.ok) {
        const msg = await resp.text().catch(() => "");
        throw new Error(msg || "Export failed");
      }

      const blob = await resp.blob();
      const disposition = resp.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const rawName = match?.[1] ? decodeURIComponent(match[1]) : `UAT_report_${selectedRunId}.md`;
      const downloadName = rawName.replace(/[\/\\]/g, "_");

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
      const resp = await fetch(requestUrl);
      if (!resp.ok) {
        const msg = await resp.text().catch(() => "");
        throw new Error(msg || "尚無可下載的 result.xlsx");
      }

      const blob = await resp.blob();
      const disposition = resp.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const rawName = match?.[1] ? decodeURIComponent(match[1]) : `UAT_result_${selectedRunId}.xlsx`;
      const downloadName = rawName.replace(/[\/\\]/g, "_");

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
      const resp = await fetch(requestUrl);
      if (!resp.ok) {
        const msg = await resp.text().catch(() => "");
        throw new Error(msg || "尚無可下載的 Agent log");
      }

      const blob = await resp.blob();
      const disposition = resp.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const rawName = match?.[1] ? decodeURIComponent(match[1]) : `UAT_agent_log_${selectedRunId}.log`;
      const downloadName = rawName.replace(/[\/\\]/g, "_");

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
                <select value={runExecutionMode} onChange={(e) => setRunExecutionMode(e.target.value as "interactive" | "offline")}>
                  <option value="interactive">Agent 互動執行（推薦）</option>
                  <option value="offline">離線 Runner（批次）</option>
                </select>
              </div>
              <div className="form-group">
                <label>輪次 ID</label>
                <input value={runRoundId} onChange={(e) => setRunRoundId(e.target.value)} placeholder="例如 RC-R001" />
              </div>
            </div>

            {runExecutionMode === "interactive" ? (
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
                  <div className="inline-actions">
                    <span className="muted">
                      {agents.length > 0 ? `${agents.filter((agent) => agent.status === "idle").length} 台可用 / ${agents.length} 台在線` : "沒有在線 Agent"}
                    </span>
                    <button type="button" className="btn sm" onClick={() => void loadAgents()} disabled={runBusy || isStarting}>
                      重新整理
                    </button>
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
                      <input type="file" accept=".xlsx,.xls" onChange={(e) => setUploadXlsx(e.target.files?.[0] || null)} />
                      {uploadXlsx ? (
                        <span className="file-name">
                          📊 {uploadXlsx.name}
                          <button type="button" className="file-remove" onClick={() => setUploadXlsx(null)}>
                            ✕
                          </button>
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="form-group">
                    <label>
                      Testcase MD <span className="required">*</span>
                    </label>
                    <div className="file-input-wrap">
                      <input type="file" accept=".md" onChange={(e) => setUploadMd(e.target.files?.[0] || null)} />
                      {uploadMd ? (
                        <span className="file-name">
                          📄 {uploadMd.name}
                          <button type="button" className="file-remove" onClick={() => setUploadMd(null)}>
                            ✕
                          </button>
                        </span>
                      ) : null}
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
                  <input type="file" accept=".csv" onChange={(e) => setUploadCsv(e.target.files?.[0] || null)} />
                  {uploadCsv ? (
                    <span className="file-name">
                      📋 {uploadCsv.name}
                      <button type="button" className="file-remove" onClick={() => setUploadCsv(null)}>
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
              <button className="btn primary" onClick={() => void handleCreateRun()} disabled={runBusy || isStarting}>
                {isStarting ? (
                  <>
                    <span className="spinner-sm" /> 檢查 Playwright...
                  </>
                ) : (
                  <>▶ 開始執行</>
                )}
              </button>
              <button
                className="btn danger"
                onClick={() => selectedRunId && void handleRunAction("cancel", selectedRunId)}
                disabled={!selectedRunId || runBusy || isStarting}
              >
                取消 Run
              </button>
            </div>
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
              {pendingApprovals.map((a) => (
                <div key={a.id} className="approval-card">
                  <div className="reason">{a.reason}</div>
                  <div className="meta">
                    Case {a.case_no} · Step {a.step_no} · 暫停時間 {formatDate(a.created_at)}
                  </div>
                  {a.snapshot_path ? <div className="screenshot">截圖：{a.snapshot_path}</div> : null}
                  <div className="approval-actions">
                    <button className="btn success sm" onClick={() => void handleResolveApproval(a, "continue")}>
                      ✓ 已處理，繼續執行
                    </button>
                    <button className="btn sm" onClick={() => void handleResolveApproval(a, "skip")}>
                      跳過此 Case
                    </button>
                    <button className="btn danger sm" onClick={() => selectedRunId && void handleRunAction("cancel", selectedRunId)}>
                      取消整個 Run
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {renderCaseResultsCard(340)}
          </div>
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
                    onClick={() => setSelectedRunId(item.id)}
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

              {renderCaseResultsCard(280)}
              {renderBugCard()}

              <div className="card">
                <div className="card-header">
                  <h2>執行 Log</h2>
                  <span className="count">最近 {runLogs.length} 筆</span>
                </div>
                <div className="scroll-y" style={{ maxHeight: 220 }}>
                  {runLogs.map((log) => (
                    <div className="log-entry" key={log.id}>
                      <span className="log-time">{new Date(log.created_at).toLocaleTimeString("zh-TW", { hour12: false })}</span>
                      <span className={`log-level ${log.level}`}>{log.level}</span>
                      <span className="log-msg">{log.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}

export default App;
