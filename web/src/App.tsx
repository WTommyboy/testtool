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

function App() {
  const [tab, setTab] = useState<"conversations" | "runs" | "history">("history");

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
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState("");
  const [resolvedBy, setResolvedBy] = useState("tommy");

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
          <button className={`tab-btn ${tab === "runs" ? "active" : ""}`} onClick={() => setTab("runs")}>
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
                  <button className="btn sm" disabled>
                    📎 上傳文件
                  </button>
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
                  <button className="btn primary" disabled={conversationBusy || !selectedConversationId}>
                    送出
                  </button>
                </form>
              </div>

              <div className="form-group mt-8">
                <label>Push To Run / 輪次 ID</label>
                <input value={pushRoundId} onChange={(e) => setPushRoundId(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Push To Run / Cases JSON</label>
                <textarea rows={4} value={pushCasesJson} onChange={(e) => setPushCasesJson(e.target.value)} />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tab === "runs" ? (
        <section className="panel">
          <div className="card mb-16">
            <div className="card-header">
              <h2>測試執行設定</h2>
              <span className={`badge ${summary?.runStatus || "pending"}`}>{summary?.runStatus || "未選擇 Run"}</span>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Testcase 來源</label>
                <select defaultValue="conversations">
                  <option value="conversations">從對話推送</option>
                  <option value="upload">上傳 xlsx + md</option>
                </select>
              </div>
              <div className="form-group">
                <label>輪次 ID</label>
                <input value={runRoundFilter} onChange={(e) => setRunRoundFilter(e.target.value)} placeholder="例如 R_CONV_001" />
              </div>
            </div>
            <div className="flex flex-end mt-8 gap-8">
              <button className="btn" onClick={() => void loadRuns()} disabled={runBusy}>
                查詢
              </button>
              <button className="btn primary" onClick={() => selectedRunId && void handleRunAction("start", selectedRunId)} disabled={!selectedRunId || runBusy}>
                ▶ 開始執行
              </button>
              <button className="btn danger" onClick={() => selectedRunId && void handleRunAction("cancel", selectedRunId)} disabled={!selectedRunId || runBusy}>
                取消 Run
              </button>
            </div>
            {runError ? <p className="error-msg">{runError}</p> : null}
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

            <div className="card">
              <div className="card-header">
                <h2>測試案例</h2>
                <span className="count">{runCases.length}</span>
              </div>
              <div className="scroll-y" style={{ maxHeight: 340 }}>
                <table className="case-table">
                  <thead>
                    <tr>
                      <th>編號</th>
                      <th>測試項目</th>
                      <th>類型</th>
                      <th>結果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runCases.map((c) => (
                      <tr key={c.id}>
                        <td className="case-no">{c.case_no}</td>
                        <td>{c.case_title}</td>
                        <td className="exec-type">{c.execution_type}</td>
                        <td>
                          <span className={`badge ${c.result_status}`}>{c.result_status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
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
                    <button className="btn sm">📄 下載 MD</button>
                    <button className="btn sm">📊 下載 XLSX</button>
                  </div>
                </div>
                <div className="run-meta">
                  <span>Run ID: {summary?.runId || "-"}</span>
                  <span>狀態: <span className={`badge ${summary?.runStatus || ""}`}>{summary?.runStatus || "-"}</span></span>
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

              <div className="card mb-16">
                <div className="card-header">
                  <h2>案例結果</h2>
                  <span className="count">{runCases.length}</span>
                </div>
                <div className="scroll-y" style={{ maxHeight: 280 }}>
                  <table className="case-table">
                    <thead>
                      <tr>
                        <th>編號</th>
                        <th>測試項目</th>
                        <th>類型</th>
                        <th>結果</th>
                        <th>失敗分類</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runCases.map((c) => (
                        <tr key={c.id}>
                          <td className="case-no">{c.case_no}</td>
                          <td>{c.case_title}</td>
                          <td className="exec-type">{c.execution_type}</td>
                          <td>
                            <span className={`badge ${c.result_status}`}>{c.result_status}</span>
                          </td>
                          <td>{c.fail_category || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

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
