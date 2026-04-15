import { useEffect, useState } from "react";
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
  execution_type: string;
  result_status: string;
  fail_category?: string | null;
};

type RunStep = {
  id: string;
  case_no: string;
  step_no: number;
  action_type: string;
  status: string;
  error_message?: string | null;
};

type Approval = {
  id: string;
  case_no: string;
  step_no: number;
  reason: string;
  status: string;
  resolved_by?: string | null;
};

const api = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const resp = await fetch(url, init);
  const data = (await resp.json()) as T & { error?: string; message?: string };
  if (!resp.ok) {
    throw new Error(data.message || data.error || `HTTP_${resp.status}`);
  }
  return data;
};

function App() {
  const [tab, setTab] = useState<"conversations" | "runs">("runs");

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string>("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [newConversationTitle, setNewConversationTitle] = useState("BI UAT 對話");
  const [newConversationFeature, setNewConversationFeature] = useState("拼貼模式");
  const [messageInput, setMessageInput] = useState("");
  const [conversationBusy, setConversationBusy] = useState(false);
  const [conversationError, setConversationError] = useState("");
  const [exportPaths, setExportPaths] = useState<{ jsonPath: string; mdPath: string } | null>(null);
  const [pushRoundId, setPushRoundId] = useState("R_CONV_001");
  const [pushCasesJson, setPushCasesJson] = useState(
    '[{"caseNo":"B-08","caseTitle":"半動態區間","executionType":"semi"}]'
  );

  const [history, setHistory] = useState<RunItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [runStatusFilter, setRunStatusFilter] = useState("");
  const [runRoundFilter, setRunRoundFilter] = useState("");
  const [runPage, setRunPage] = useState(1);
  const [runTotal, setRunTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [runLogs, setRunLogs] = useState<RunLog[]>([]);
  const [runCases, setRunCases] = useState<RunCase[]>([]);
  const [runSteps, setRunSteps] = useState<RunStep[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState("");
  const [resolvedBy, setResolvedBy] = useState("tommy");

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

  const loadRunDetail = async (runId: string) => {
    if (!runId) return;
    try {
      const [summaryData, logsData, casesData, stepsData, approvalsData] = await Promise.all([
        api<Summary>(`/api/runs/${runId}/summary`),
        api<{ items: RunLog[] }>(`/api/runs/${runId}/logs`),
        api<{ items: RunCase[] }>(`/api/runs/${runId}/cases`),
        api<{ items: RunStep[] }>(`/api/runs/${runId}/steps`),
        api<{ items: Approval[] }>(`/api/runs/${runId}/approvals`),
      ]);
      setSummary(summaryData);
      setRunLogs(logsData.items);
      setRunCases(casesData.items);
      setRunSteps(stepsData.items);
      setApprovals(approvalsData.items);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    void loadConversations();
    void loadRuns();
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
    if (!selectedConversationId || !messageInput.trim()) return;
    setConversationBusy(true);
    setConversationError("");
    try {
      await api(`/api/conversations/${selectedConversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: messageInput }),
      });
      setMessageInput("");
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
      setTab("runs");
      await loadRuns();
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : String(error));
    } finally {
      setConversationBusy(false);
    }
  };

  const handleRunAction = async (action: "start" | "cancel", runId: string) => {
    setRunBusy(true);
    setRunError("");
    try {
      await api(`/api/runs/${runId}/${action}`, { method: "POST" });
      await loadRuns();
      await loadRunDetail(runId);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunBusy(false);
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

  return (
    <main className="app">
      <header className="topbar">
        <h1>UAT Tool Console</h1>
        <div className="tabs">
          <button className={tab === "runs" ? "active" : ""} onClick={() => setTab("runs")}>
            Tab B-1 執行紀錄
          </button>
          <button className={tab === "conversations" ? "active" : ""} onClick={() => setTab("conversations")}>
            Tab A 對話生成
          </button>
        </div>
      </header>

      {tab === "runs" ? (
        <section className="panel">
          <div className="toolbar">
            <input
              placeholder="roundId 篩選"
              value={runRoundFilter}
              onChange={(e) => setRunRoundFilter(e.target.value)}
            />
            <input
              placeholder="status 篩選"
              value={runStatusFilter}
              onChange={(e) => setRunStatusFilter(e.target.value)}
            />
            <button onClick={() => void loadRuns()} disabled={runBusy}>
              查詢
            </button>
            <button onClick={() => setRunPage((x) => Math.max(1, x - 1))}>上一頁</button>
            <span>第 {runPage} 頁 / 總筆數 {runTotal}</span>
            <button onClick={() => setRunPage((x) => x + 1)}>下一頁</button>
          </div>

          {runError ? <p className="error">{runError}</p> : null}

          <div className="grid two">
            <div className="card">
              <h2>Run History</h2>
              <div className="list">
                {history.map((item) => (
                  <button
                    key={item.id}
                    className={`list-item ${selectedRunId === item.id ? "selected" : ""}`}
                    onClick={() => setSelectedRunId(item.id)}
                  >
                    <div>{item.round_id} / {item.run_name}</div>
                    <div className="muted">{item.status}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              <h2>Run Detail</h2>
              {selectedRunId ? (
                <>
                  <div className="inline-actions">
                    <button onClick={() => void handleRunAction("start", selectedRunId)}>Start</button>
                    <button onClick={() => void handleRunAction("cancel", selectedRunId)}>Cancel</button>
                    <button onClick={() => void loadRunDetail(selectedRunId)}>Refresh Detail</button>
                  </div>
                  <pre>{JSON.stringify(summary, null, 2)}</pre>
                </>
              ) : (
                <p className="muted">請先選擇 run</p>
              )}
            </div>
          </div>

          <div className="grid two">
            <div className="card">
              <h2>Approvals</h2>
              <label className="inline">
                resolvedBy
                <input value={resolvedBy} onChange={(e) => setResolvedBy(e.target.value)} />
              </label>
              <div className="list">
                {approvals.map((a) => (
                  <div key={a.id} className="approval">
                    <div>
                      {a.case_no} / step {a.step_no} / {a.status}
                    </div>
                    <div className="muted">{a.reason}</div>
                    {a.status === "PENDING" ? (
                      <div className="inline-actions">
                        <button onClick={() => void handleResolveApproval(a, "continue")}>Continue</button>
                        <button onClick={() => void handleResolveApproval(a, "skip")}>Skip</button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h2>Cases / Steps / Logs</h2>
              <details>
                <summary>Cases ({runCases.length})</summary>
                <pre>{JSON.stringify(runCases, null, 2)}</pre>
              </details>
              <details>
                <summary>Steps ({runSteps.length})</summary>
                <pre>{JSON.stringify(runSteps, null, 2)}</pre>
              </details>
              <details>
                <summary>Logs ({runLogs.length})</summary>
                <pre>{JSON.stringify(runLogs, null, 2)}</pre>
              </details>
            </div>
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="grid two">
            <div className="card">
              <h2>Create Conversation</h2>
              <form onSubmit={handleCreateConversation} className="form">
                <input
                  value={newConversationTitle}
                  onChange={(e) => setNewConversationTitle(e.target.value)}
                  placeholder="title"
                />
                <input
                  value={newConversationFeature}
                  onChange={(e) => setNewConversationFeature(e.target.value)}
                  placeholder="featureName"
                />
                <button disabled={conversationBusy}>Create</button>
              </form>

              <h3>Conversation List</h3>
              <div className="list">
                {conversations.map((c) => (
                  <button
                    key={c.id}
                    className={`list-item ${selectedConversationId === c.id ? "selected" : ""}`}
                    onClick={() => setSelectedConversationId(c.id)}
                  >
                    <div>{c.title}</div>
                    <div className="muted">{c.feature_name || "-"}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              <h2>Messages</h2>
              {conversationError ? <p className="error">{conversationError}</p> : null}
              <form onSubmit={handleSendMessage} className="form">
                <textarea
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  rows={5}
                  placeholder="輸入訊息給 Claude"
                />
                <button disabled={conversationBusy || !selectedConversationId}>Send</button>
              </form>
              <div className="inline-actions">
                <button onClick={() => void handleExport()} disabled={!selectedConversationId || conversationBusy}>
                  Export JSON + MD
                </button>
              </div>
              {exportPaths ? (
                <pre>{JSON.stringify(exportPaths, null, 2)}</pre>
              ) : null}
              <div className="messages">
                {messages.map((m) => (
                  <article key={m.id} className={`msg ${m.role}`}>
                    <header>{m.role.toUpperCase()} / {m.created_at}</header>
                    <div>{m.content}</div>
                  </article>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Push To Run</h2>
            <div className="form">
              <input value={pushRoundId} onChange={(e) => setPushRoundId(e.target.value)} placeholder="roundId" />
              <textarea
                value={pushCasesJson}
                onChange={(e) => setPushCasesJson(e.target.value)}
                rows={5}
                placeholder='[{"caseNo":"B-08","caseTitle":"...","executionType":"semi"}]'
              />
              <button onClick={() => void handlePushToRun()} disabled={!selectedConversationId || conversationBusy}>
                Push to Run
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
