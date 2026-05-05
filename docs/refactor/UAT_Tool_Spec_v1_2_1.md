# UAT Tool — 技術規格書

**版本**:Spec v1.2.1
**配套規劃書**:UAT_Tool_重構規劃書_v2.4.1.md
**撰寫日期**:2026-04-26
**讀者**:開發者(Codex)、未來 review 的 Tommy
**範圍**:本 spec 聚焦於規劃書 v2.4.1 沒展開的具體規格。已在規劃書講清楚的不重複(部署、env vars、DB schema 等請查規劃書)。

---

## 0. 本版相對 Spec v1.1 的變動(Codex review 整合)

| 變更 | 說明 |
|------|------|
| `[TOOL_REQUEST]` 條款命名 | 不再叫「AGENTS.md 第 22 條」,改稱「Tool Bridge Protocol」,放 `_shared/AGENTS_TOOL_BRIDGE_SPIKE.md`,避免與既有 BI AGENTS.md v1.8 第 22 條(detail_json 寫作風格)撞名 |
| `auth-protocol.ts` 改名 | 改為 `tool-bridge.ts`,避免與「PM 登入」混淆 |
| 新增 `auth.ts` | 處理 GitHub OAuth 登入(Tommy 採納選項 B,白名單 `WTommyboy`) |
| 新增 `result-parser.ts` | 版本化 result.xlsx parser,寫入 run_case_results 表 |
| Run 狀態機展開 | 從粗版狀態擴成 9 個 canonical status(DRAFT / ASSIGNED / AGENT_RUNNING / WAITING_USER / UPLOADING_RESULT / INGESTING_RESULT / COMPLETED / FAILED / INTERRUPTED) |
| Mac Agent 安全邊界 | 明寫白名單 task.dispatch 唯一指令、單一 active run lock |
| Artifact 儲存 | 集中設計檔案命名規則、生命週期(規劃書第 13 章) |
| WebSocket protocol | 補 ack / sequence number / dedupe / agent_capability / run_snapshot |

### 0.1 Spec v1.2.1 quick check 修正

| 修正 | 說明 |
|------|------|
| `execution_mode` | 統一為 `interactive`;不再使用 `local` |
| Run status | 統一 canonical enum:`DRAFT / ASSIGNED / AGENT_RUNNING / WAITING_USER / UPLOADING_RESULT / INGESTING_RESULT / COMPLETED / FAILED / INTERRUPTED` |
| Auth | GitHub OAuth 白名單 `WTommyboy` 第一階段即實作,不再標成「先不做完整 auth」 |
| Tool Bridge 命名 | 啟動 header 改為 `AGENTS_TOOL_BRIDGE_SPIKE.md`,移除「AGENTS.md 第 22 條 / 第 22.5 條」殘留說法 |
| Agent package | repo 目錄 `/agent`,package `uat-tool-agent`,binary `uat-agent`;MVP 先 local install,不預設 public npm |
| Codex spawn | 範例改為 `CodexRunner` interface + M0 spike 待決;不可把 `spawn(codex, [])` 視為已定案 |

詳細請對照規劃書 v2.4.1 的章節,本 spec 不重複贅述,只列規格細節。

---

## 文件目錄

1. 系統元件與職責邊界
2. 資料流程圖
3. Mac Agent 規格
4. WebSocket 通訊協議
5. REST API 規格
6. TOOL_REQUEST / TOOL_RESPONSE 標記協議
7. 啟動指令 marker 規格
8. 工作目錄結構
9. 錯誤處理與恢復
10. 開發環境設置
11. 待解決議題

---

## 1. 系統元件與職責邊界

### 1.1 元件清單

| 元件 | 跑在哪 | 技術 | 職責 |
|------|--------|------|------|
| Web UI(static) | Vercel | React + Vite | SPA 靜態檔,瀏覽器載入 |
| Web Server | Railway | Express + ws | API + WebSocket server,前端從 Vercel 跨域呼叫 |
| DB | Railway Postgres | Postgres 15+ | 持久化 |
| Domain Loader | Railway | Node + simple-git | GitHub clone / pull |
| LLM Client | Railway | Anthropic SDK | 對話生成頁籤用(後端調用,key 不出後端) |
| Mac Agent | Tommy's Mac | Node 20+ | 接收任務、起 Codex |
| Codex CLI | Tommy's Mac | (外部 binary) | 實際執行 |
| Playwright MCP | Tommy's Mac | (Codex 自啟) | 操作 Chrome |

### 1.2 嚴格的職責邊界

**Mac Agent 不該知道的事**:
- DB schema(只走 API,不直連 DB)
- Domain 內部規則(不解析 AGENTS.md / 方法論)
- Codex 的紀律(不檢查 Codex 行為對錯)
- xlsx 內容(只搬檔案,不解析)

**Web Server 不該知道的事**:
- Mac 上的檔案系統路徑
- Codex CLI 在哪、版本多少
- Chrome 怎麼啟動
- Playwright MCP 細節

兩邊靠協議溝通,協議外的事各自封閉。

### 1.3 跨域與 CORS

前端 Vercel(`testtool-eight.vercel.app`)打後端 Railway(`testtool-production.up.railway.app`)是跨域請求,Railway 端要設好 CORS:

```typescript
// server.ts 加上
import cors from 'cors';

app.use(cors({
  origin: process.env.CORS_ALLOWED_ORIGINS?.split(',') ?? ['https://testtool-eight.vercel.app'],
  credentials: true,
}));
```

`CORS_ALLOWED_ORIGINS` 環境變數允許多個域名(逗號分隔),例如:
```
CORS_ALLOWED_ORIGINS=https://testtool-eight.vercel.app,http://localhost:5173
```

(後者是本機開發 Vite dev server 用)

WebSocket upgrade 不適用一般 CORS — 要驗的是 Mac Agent 的 token,不是 origin(Mac Agent 從本機 Node 程式連 Railway,不帶 origin header)。

---

## 2. 資料流程圖

### 2.1 一輪 Run 完整流程

```
[PM 在瀏覽器]
  │
  │ 1. 開啟工具,進測試頁籤
  ↓
[Web UI(Vercel)]
  │
  │ 2. PM 選 Domain、上傳 xlsx + 啟動指令 + baseline、按啟動
  │ 3. Web UI 呼叫 POST /api/runs
  ↓
[Web Server(Railway)]
  │
  │ 4. 寫 run record 到 Postgres,status = DRAFT
  │ 5. 把 xlsx / 啟動指令存 Railway volume
  │ 6. 從 Domain Loader 取得當前 commit hash + rules 內容
  │ 7. 產生 task 訊息
  │ 8. 透過 WebSocket push task.dispatch 給 Mac Agent
  ↓
[Mac Agent(Tommy's Mac)]
  │
  │ 9. 收到 task.dispatch
  │ 10. 從 Web Server 拉 input 檔案(xlsx / 啟動指令 / baseline)
  │ 11. 從 GitHub 拉 Domain rules
  │ 12. 在 Mac 本地組工作目錄 ~/.uat-agent/runs/MR004/
  │ 13. spawn Codex CLI subprocess,working dir 設好
  │ 14. 把啟動指令寫進 stdin
  │ 15. Codex 啟動,讀指令,起 Playwright MCP,操作 Chrome
  ↓
[執行迴圈(每行 stdout)]
  │
  │ 16. Codex stdout 一行
  │ 17. Mac Agent 收到、檢查是不是 [TOOL_REQUEST]
  │ 18a. 不是 → forward 給 Railway(run.stdout 訊息)
  │ 18b. 是 → 解析 JSON、發 run.tool_request 訊息給 Railway
  │ 19. Web Server 收到 stdout/tool_request → 寫 run_events 表
  │ 20. Web UI 透過 SSE / WebSocket 即時看到
  │
  │ TOOL_REQUEST 流程:
  │   21. PM 在 modal 點 yes/no
  │   22. Web UI 呼叫 POST /api/runs/:id/tool-response
  │   23. Web Server 透過 WebSocket push tool_response 給 Agent
  │   24. Agent 把 [TOOL_RESPONSE] 寫進 Codex stdin
  │   25. Codex 收到回應,繼續跑
  ↓
[Codex 跑完]
  │
  │ 26. Codex subprocess exit
  │ 27. Mac Agent 上傳 result.xlsx 到 Web Server
  │ 28. Mac Agent 上傳 codex.log 到 Web Server
  │ 29. Mac Agent 發 run.completed
  ↓
[Web Server]
  │
  │ 30. 更新 run.status = COMPLETED、finished_at
  │ 31. (可選)commit result.xlsx 到 GitHub results repo
  │ 32. 推 macOS 通知 / LINE Notify(M2)
  ↓
[PM]
  │
  │ 33. 在結果分析頁籤看到完成的 run
  │ 34. 下載 result.xlsx,送 RD
```

### 2.2 失敗路徑簡覽

| 情境 | 發生時機 | 處理 |
|------|---------|------|
| Mac Agent 不在線 | 步驟 4 之前 | 啟動按鈕 disable,run 不建立 |
| Mac Agent 收到 task 後斷線 | 步驟 9 之後 | run.status → INTERRUPTED,reason=agent_lost,等重連後用 run_snapshot 對齊 |
| Codex spawn 失敗 | 步驟 13 | run.status → FAILED,reason 記到 run_events |
| Codex 跑到一半 crash | 步驟 16 之後 | run.status → FAILED,subprocess exit code 記下 |
| TOOL_REQUEST 超過 30 分鐘沒回 | 步驟 21 | macOS / LINE 推送提醒 |
| TOOL_REQUEST 超過 4 小時沒回 | 步驟 21 | 自動拒絕、中止 run |
| 上傳 result.xlsx 失敗 | 步驟 27 | retry 3 次,失敗則 mark `pending_upload` 等 PM 介入 |

---

## 3. Mac Agent 規格

### 3.1 程式骨架

```
agent/
├── package.json
├── bin/
│   └── uat-agent.js              # CLI 入口
├── src/
│   ├── cli.ts                    # commander.js,login/start/status 等命令
│   ├── config.ts                 # 讀寫 ~/.uat-agent/config.json
│   ├── connection.ts             # WebSocket client
│   ├── codex-runner.ts           # spawn + stdin/stdout 管理
│   ├── parser.ts                 # 偵測 [TOOL_REQUEST] 標記
│   ├── workdir.ts                # 工作目錄管理
│   ├── uploader.ts               # 上傳 result / log 到 Railway
│   └── index.ts
└── tsconfig.json
```

### 3.2 安裝與初始設定

```bash
# MVP:在 monorepo 內 local install / npm link
cd /path/to/testtool/agent
npm install
npm link

# 未來穩定後才考慮 publish package: uat-tool-agent

# 初次設定:登入
uat-agent login --token=<從 Railway 設定頁複製>
# → 寫到 ~/.uat-agent/config.json,模式 600

# 啟動
uat-agent start
# → 連 Railway WebSocket、開始接任務

# (推薦)用 launchd 開機自啟
uat-agent install-launchd
# → 產生 ~/Library/LaunchAgents/com.tommy.uat-agent.plist
# → launchctl load 之
```

### 3.3 Config 結構

`~/.uat-agent/config.json`(模式 600):

```json
{
  "version": 1,
  "server": "wss://testtool-production.up.railway.app",
  "token": "<bcrypt 之前的明文,存本機>",
  "device_name": "Tommy's MacBook Pro",
  "codex_bin": "/usr/local/bin/codex",
  "workdir_root": "/Users/tommy/.uat-agent/runs",
  "log_level": "info"
}
```

`uat-agent login` 互動式設定 token 與 device_name。`codex_bin` 啟動時自動偵測,無法偵測才提示 PM 手動填。

### 3.4 命令列介面

```
uat-agent <command> [options]

Commands:
  login          設定 token 與 device 資訊
  logout         清除 config
  start          啟動 daemon(前景跑)
  status         查當前狀態(連線?跑哪個 run?)
  stop           停掉跑中的 run(SIGTERM Codex)
  install-launchd  產生 launchd plist 開機自啟
  uninstall-launchd 移除 launchd
  doctor         健檢:Codex 路徑、token 有效性、連線測試
```

### 3.5 spawn Codex CLI 的具體做法(M0 spike 後定案)

這段不是最終實作,只是 `CodexRunner` interface 的目標形狀。M0 必須先比較:

1. `codex exec --json` 非互動模式是否能支援中途 TOOL_RESPONSE
2. PTY interactive 模式是否能穩定讀 stdout / 寫 stdin
3. 直接 `spawn(codex, [])` 是否能啟動 Codex app 行為並接上 Playwright MCP

M0 通過後才把其中一條寫成 production runner。M1 不可直接照抄下方 skeleton 當定案。

```typescript
import { spawn } from 'node:child_process';
import { config } from './config';

interface SpawnContext {
  workdir: string;
  startupInstruction: string;  // 啟動指令的全文
  env: Record<string, string>;
}

export class CodexRunner {
  private process: ChildProcess | null = null;
  private stdoutBuffer = '';
  
  async spawn(ctx: SpawnContext): Promise<void> {
    // Placeholder only: actual args / PTY choice are decided by M0.
    const child = spawn(config.codexBin, [], {
      cwd: ctx.workdir,
      env: { ...process.env, ...ctx.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    this.process = child;
    
    // 餵啟動指令
    child.stdin?.write(ctx.startupInstruction);
    child.stdin?.write('\n');
    
    // 讀 stdout(line-by-line)
    child.stdout?.on('data', (chunk) => {
      this.stdoutBuffer += chunk.toString('utf-8');
      this.processLines();
    });
    
    child.stderr?.on('data', (chunk) => {
      // stderr 也 forward,但標記為 stderr
      this.emit('stderr', chunk.toString('utf-8'));
    });
    
    child.on('exit', (code) => {
      this.emit('exit', code);
    });
  }
  
  private processLines() {
    // 拆 \n、檢查 [TOOL_REQUEST] 邊界、emit 事件
    // 注意:TOOL_REQUEST 跨多行,要等到 [/TOOL_REQUEST] 才完成
  }
  
  writeStdin(data: string) {
    this.process?.stdin?.write(data);
  }
  
  terminate() {
    this.process?.kill('SIGTERM');
    setTimeout(() => this.process?.kill('SIGKILL'), 5000);
  }
}
```

### 3.6 ANSI escape 處理

Codex 輸出可能含顏色碼。本機 log 保留原樣,**送上 Railway 的 stdout 訊息要去 ANSI**:

```typescript
import stripAnsi from 'strip-ansi';

const cleanLine = stripAnsi(rawLine);
```

### 3.7 [TOOL_REQUEST] 標記偵測

Codex 輸出可能長這樣:

```
✅ E-15 完成 → PASS
✅ E-16 完成 → BLOCKED
[TOOL_REQUEST]
{
  "type": "irreversible_operation",
  "case": "F-03",
  "action": "刪除測試報表 'temp_test_report'",
  "reason": "case 步驟 5 要求驗證刪除流程"
}
[/TOOL_REQUEST]
```

偵測邏輯:
- 維持一個 buffer 累積 stdout
- 每次新行到時,檢查 buffer 裡有沒有完整的 `[TOOL_REQUEST]\n...\n[/TOOL_REQUEST]` 片段
- 找到完整片段 → 抽出中間 JSON、parse → emit `tool_request` 事件
- 同時把這段從 buffer 移除,但**也要 forward 給 Railway 的 stdout log**(完整保留)

正則大致:`/\[TOOL_REQUEST\]\n([\s\S]*?)\n\[\/TOOL_REQUEST\]/`(non-greedy)。

---

## 4. WebSocket 通訊協議

### 4.1 連線生命週期

```
1. Mac Agent → Railway: WS upgrade request,header 帶 token
2. Railway: 驗 token、查 agent_tokens 表、寫 last_seen_at
3. WS 建立成功
4. Agent 發 agent.online(含 device_name、agent_version)
5. Railway 回 ack
6. 進入 idle / busy 狀態
```

### 4.2 認證

WebSocket upgrade 用 HTTP header:

```
GET /agent-ws HTTP/1.1
Upgrade: websocket
Authorization: Bearer <token>
X-Agent-Version: 0.2.7
X-Device-Name: Tommy's MacBook Pro
```

Railway 端:
1. 取出 token
2. bcrypt compare 對 `agent_tokens.token_hash`
3. 找不到或 revoked → 拒絕 upgrade(401)
4. 找到 → 接受連線、更新 `last_seen_at`、寫 connection log

### 4.3 訊息格式

所有訊息都是 JSON:

```json
{
  "id": "msg_<uuid>",
  "type": "<event_type>",
  "timestamp": "2026-04-26T14:23:45Z",
  "payload": { ... }
}
```

`id` 用於 ack 配對。某些訊息要求對方 ack,某些不需要。

### 4.4 Mac Agent → Railway 訊息

**agent.online**(連線後第一個訊息)
```json
{
  "type": "agent.online",
  "payload": {
    "device_name": "Tommy's MacBook Pro",
    "agent_version": "0.2.7",
    "codex_version": "0.42.1",
    "platform": "darwin-arm64"
  }
}
```

**agent.heartbeat**(每 30 秒)
```json
{
  "type": "agent.heartbeat",
  "payload": {
    "status": "idle" | "busy",
    "current_run_id": "<uuid|null>"
  }
}
```

**run.started**
```json
{
  "type": "run.started",
  "payload": {
    "run_id": "<uuid>",
    "started_at": "2026-04-26T14:23:45Z"
  }
}
```

**run.stdout**(每行 Codex 輸出)
```json
{
  "type": "run.stdout",
  "payload": {
    "run_id": "<uuid>",
    "stream": "stdout" | "stderr",
    "line": "✅ E-15 完成 → PASS"
  }
}
```

**run.tool_request**(偵測到授權請求)
```json
{
  "type": "run.tool_request",
  "payload": {
    "run_id": "<uuid>",
    "request_id": "<uuid>",
    "request_type": "irreversible_operation" | "ambiguity_decision" | "playwright_recovery",
    "data": { ... }  // 完整的 [TOOL_REQUEST] JSON
  }
}
```

**run.completed**
```json
{
  "type": "run.completed",
  "payload": {
    "run_id": "<uuid>",
    "exit_code": 0,
    "finished_at": "2026-04-26T16:42:11Z",
    "result_xlsx_uploaded": true,
    "log_uploaded": true
  }
}
```

**run.failed**
```json
{
  "type": "run.failed",
  "payload": {
    "run_id": "<uuid>",
    "reason": "codex_crash" | "timeout" | "agent_terminated" | ...,
    "exit_code": 1,
    "error_message": "..."
  }
}
```

### 4.5 Railway → Mac Agent 訊息

**task.dispatch**
```json
{
  "type": "task.dispatch",
  "payload": {
    "run_id": "<uuid>",
    "domain": "BI",
    "round_id": "MR004",
    "rules_commit": "a3f5b2c",
    "input_urls": {
      "xlsx": "https://railway/api/runs/<uuid>/input/xlsx",
      "startup_instruction": "https://railway/api/runs/<uuid>/input/startup",
      "baseline": "https://railway/api/runs/<uuid>/input/baseline"
    },
    "anthropic_api_key_inject": false
  }
}
```

注意:Anthropic API key 不從 Railway 傳給 Agent(那是 Codex 自己用本機環境變數的)。

**task.cancel**
```json
{
  "type": "task.cancel",
  "payload": {
    "run_id": "<uuid>",
    "reason": "pm_requested" | "timeout" | ...
  }
}
```

Agent 收到後:SIGTERM Codex,5 秒後 SIGKILL,清理工作目錄(可選),回報 `run.failed`。

**tool_response**
```json
{
  "type": "tool_response",
  "payload": {
    "run_id": "<uuid>",
    "request_id": "<uuid>",  // 對應 run.tool_request 的 request_id
    "approved": true,
    "note": ""
  }
}
```

Agent 收到後寫 `[TOOL_RESPONSE]\n{...}\n[/TOOL_RESPONSE]\n` 進 Codex stdin。

### 4.6 重連與訊息保證(Codex review 補完)

**Agent 端**:
- 連線斷 → 立即嘗試重連(指數 backoff:1s, 2s, 4s, 8s, 16s, 30s 上限)
- 重連成功 → 重發 `agent.online`,內含 `run_snapshot`(若有 in-flight run)
- 寫入 stdin 失敗 → 標記 in-flight tool_response 為 `pending_replay`,重連後重送

**Railway 端**:
- agent 斷線 → 把該 agent 持有的 run status 標 `INTERRUPTED`,payload.reason=`agent_lost`(不直接改回 ASSIGNED 避免重複派工)
- agent 重連並送 `run_snapshot` → 比對 Railway 認知 → 同步狀態 → 必要時補發 `tool_response` 給 Agent

**訊息保證機制**(Codex review 五項補完):

1. **ack 機制**:每個重要訊息(task.dispatch / tool_request / tool_response)都有 `ack_required: true`,接收方收到後立即回 `{type: "ack", in_reply_to: "<msg_id>"}`。發送方未收到 ack 則 retry。

2. **sequence number**:每筆訊息帶 `seq` 累加數,接收方驗序、丟棄重複序號。

3. **dedupe**:基於訊息 `id`(uuid)+ 5 分鐘記憶窗,接收方收到重複 id 直接丟棄不重複處理。

4. **agent_capability**:Agent 上線時宣告自己能力(支援的 task types、Codex 版本、Playwright MCP 版本),Railway 派工前驗證。

5. **run_snapshot**:Agent 重連時送當前 in-flight run 的完整狀態(run_id、目前到第幾個 case、有無 pending tool_response),Railway 端比對自己認知,確保不重複派工或漏收結果。

**訊息分類重要性**:
- `run.stdout` 是 fire-and-forget,允許掉一些(網路抖動,反正 raw 在 Mac)
- `run.tool_request` 必須收到 → 用 ack + retry(最多 3 次)
- `task.dispatch` 必須收到 → 用 ack + retry + 7 天內 dedupe(避免 Agent 重啟後重複領任務)
- `tool_response` 必須收到 → 用 ack + retry,Agent 寫進 Codex stdin 後立即發 `tool_response.delivered` 回報

---

## 5. REST API 規格

WebSocket 處理事件流,REST 處理資源 CRUD 與檔案上傳。

### 5.1 主要端點

| Method | Path | 用途 |
|--------|------|------|
| `POST` | `/api/runs` | 建立新 run(觸發 task.dispatch) |
| `GET` | `/api/runs` | 列出所有 runs(過濾) |
| `GET` | `/api/runs/:id` | 單一 run 詳情 |
| `POST` | `/api/runs/:id/cancel` | PM 主動中止 |
| `GET` | `/api/runs/:id/input/xlsx` | Agent 拉 input(需認證) |
| `GET` | `/api/runs/:id/input/startup` | 同上 |
| `GET` | `/api/runs/:id/input/baseline` | 同上 |
| `POST` | `/api/runs/:id/result-xlsx` | Agent 上傳結果 xlsx |
| `POST` | `/api/runs/:id/log` | Agent 上傳 log |
| `POST` | `/api/runs/:id/tool-response` | PM 回應 TOOL_REQUEST |
| `GET` | `/api/runs/:id/events` | 結果頁籤讀事件流 |
| `GET` | `/api/domains` | 列出可用 domains(讀 GitHub) |
| `POST` | `/api/domains/sync` | 觸發 GitHub pull |
| `GET` | `/api/domains/:name/rules` | 取某 domain 的 rules content |
| `POST` | `/api/agents/tokens` | 產生新 agent token |
| `GET` | `/api/agents/tokens` | 列出已知 token(masked) |
| `DELETE` | `/api/agents/tokens/:id` | revoke token |
| `WS` | `/agent-ws` | Mac Agent 連 |

### 5.2 POST /api/runs 詳細

Request body:
```json
{
  "domain": "BI",
  "round_id": "MR004",
  "execution_mode": "interactive",
  "agent_id": "<agent_token_id>",   // interactive 模式必填
  "xlsx_file": <multipart>,
  "startup_instruction_file": <multipart>,
  "baseline_data": { ... } | "<text>",
  "notes": "本輪重點測試 H-J 群組"
}
```

Response 201:
```json
{
  "run_id": "<uuid>",
  "status": "ASSIGNED",
  "websocket_url": "wss://...",   // PM 前端如要直接看 stream 可訂閱
  "rules_commit": "a3f5b2c"
}
```

後續工具自動:
1. 寫 run record(status = DRAFT)
2. 拉 GitHub 確認 commit
3. 找對應 agent
4. 透過 WebSocket push task.dispatch
5. task.dispatch 發出後 status → ASSIGNED
6. agent 回 ack 並送 run.started 後 status → AGENT_RUNNING

### 5.3 認證

PM 使用工具:第一階段即做 GitHub OAuth 登入保護,白名單只允許 `WTommyboy`。

Railway 必要 env:
```
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_OAUTH_CALLBACK_URL=https://testtool-production.up.railway.app/api/auth/github/callback
SESSION_SECRET=...
```

所有 PM-facing REST API 都需 GitHub OAuth session;Agent-facing REST / WebSocket 使用 Agent Bearer token。

Agent 使用 API:Bearer token,跟 WebSocket 同一份。

---

## 6. TOOL_REQUEST / TOOL_RESPONSE 標記協議

### 6.1 編碼規則

- 標記必須**獨立成行**(前後各一個 \n)
- JSON 內容**可以跨多行**(必須 valid JSON)
- 字元編碼:UTF-8
- 一個 [TOOL_REQUEST] 對應一個 [TOOL_RESPONSE](透過 request_id 配對)

### 6.2 Request 三類 schema

#### 6.2.1 不可逆操作授權

```json
{
  "type": "irreversible_operation",
  "case": "<case_no>",
  "action": "<具體動作描述>",
  "reason": "<為什麼需要做>",
  "request_id": "<由 Codex 產生的 uuid>"
}
```

範例:
```json
{
  "type": "irreversible_operation",
  "case": "F-03",
  "action": "刪除測試報表 'temp_test_report'",
  "reason": "case 步驟 5 要求驗證刪除流程能正確執行",
  "request_id": "req_a3f5"
}
```

#### 6.2.2 灰色地帶判斷

```json
{
  "type": "ambiguity_decision",
  "case": "<case_no>",
  "context": "<目前看到的狀況>",
  "options": ["<選項A>", "<選項B>", ...],
  "recommendation": "<Codex 自己的建議>",
  "request_id": "<uuid>"
}
```

#### 6.2.3 Playwright 異常恢復

```json
{
  "type": "playwright_recovery",
  "error": "<錯誤類型,例如 SingletonLock_blocked>",
  "proposed_action": "<Codex 建議的恢復動作>",
  "request_id": "<uuid>"
}
```

### 6.3 Response schema(僅一種)

```json
{
  "request_id": "<對應 request 的 id>",
  "approved": true | false,
  "note": "<可選,PM 給的補充說明>"
}
```

---

## 7. 啟動指令 marker 規格

啟動指令是 PM 上傳的 `.txt`,Codex 讀進去後決定行為。為了讓 Codex 知道「這次是 UAT Tool 啟動的」,啟動指令最上方要有標準 header:

```
# Run Context
- 執行環境:UAT Tool
- Run ID: <run_id>
- Domain: <domain>
- Mac Agent: <device_name>
- Rules Commit: <commit_hash>
- 適用協議:AGENTS_TOOL_BRIDGE_SPIKE.md

# 接下來是本輪正常的啟動指令...
```

Mac Agent 在 spawn Codex 前,**自動把這個 header prepend 到 PM 上傳的啟動指令**前面。PM 不用每次自己寫 header。

Codex 在 `_shared/AGENTS_TOOL_BRIDGE_SPIKE.md` 會說「沒看到 Run Context 就照原本人工 session 行為跑」。M0 通過前不要把此規則寫入任何 domain 的 AGENTS.md,避免覆蓋既有 BI 第 22 條。

---

## 8. 工作目錄結構

### 8.1 Railway volume(暫存 input)

```
/data/railway-volume/
└── runs/
    └── <run_id>/
        ├── input/
        │   ├── source.xlsx
        │   ├── startup_instruction.txt
        │   └── baseline.json
        └── output/
            ├── result.xlsx           ← Agent 上傳
            └── codex.log             ← Agent 上傳
```

跑完一段時間後可清,只留 result.xlsx(已 commit GitHub)。

### 8.2 Mac Agent 工作目錄

```
~/.uat-agent/
├── config.json                       ← 認證設定
├── logs/
│   └── agent.log                     ← Agent 自己的 log
└── runs/
    └── <run_id>/
        ├── input/
        │   ├── source.xlsx           ← 從 Railway 拉下來
        │   ├── startup_instruction.txt
        │   ├── startup_instruction_with_header.txt  ← Agent 補 header 後的
        │   └── baseline.json
        ├── rules/                    ← 從 GitHub clone(指定 commit)
        │   ├── AGENTS.md
        │   ├── BI測試標準_共通方法論.md
        │   └── ...
        ├── codex.log                 ← Codex 完整 stdout(含 ANSI)
        ├── codex.log.clean           ← 去 ANSI 版,送 Railway 用
        └── result.xlsx               ← Codex 寫好的結果
```

跑完後保留(便於本機 debug),PM 手動清或寫 cron 自動清。

---

## 9. 錯誤處理與恢復

### 9.1 Agent 端錯誤情境

| 錯誤 | 偵測 | 處理 |
|------|------|------|
| Codex spawn 失敗 | child_process error event | 立即 emit run.failed,reason=spawn_failed |
| Codex 跑到一半 crash | exit code 非 0 | run.failed,reason=codex_crash |
| Codex 卡住不動 | 5 分鐘沒新 stdout | warning,但不主動殺(可能正在 long-running) |
| Codex 卡住超過 30 分鐘 | 30 分鐘沒新 stdout | 報 run_events,讓 PM 決定 |
| WebSocket 斷線 | 心跳超時 | 指數 backoff 重連,buffer 訊息 |
| 上傳 result 失敗 | HTTP 5xx 或網路錯 | retry 3 次,失敗則 mark `pending_upload` |
| Token 失效 | WebSocket 401 | 停止重連,提示 PM `uat-agent login` 重設 |

### 9.2 Railway 端錯誤情境

| 錯誤 | 處理 |
|------|------|
| Agent 心跳超時(60 秒) | run.status → INTERRUPTED,run_events.payload.reason=agent_lost |
| TOOL_REQUEST 30 分鐘無回應 | 推送通知 PM(M2) |
| TOOL_REQUEST 4 小時無回應 | 自動拒絕,送 task.cancel 給 Agent |
| Agent 報告 run.completed 但 result.xlsx 沒上傳 | run.status = FAILED,run_events.payload.reason=result_missing;若已進入上傳流程但可人工補檔,保持 UPLOADING_RESULT 並提示 PM |

### 9.3 PM 干預機制

PM 在 Web UI 隨時可:
- 看單個 run 的 events stream(實時)
- 主動中止 run(發 task.cancel)
- 對 TOOL_REQUEST 回應(yes/no)
- 看歷史 events

---

## 10. 開發環境設置

### 10.1 Web Server(Railway)

```bash
# 本機開發
cd /path/to/testtool
cp .env.example .env  # 填本機 dev 用的 env
npm install
npm run dev  # 啟動 localhost:3000

# 部署
git push  # Railway 自動 deploy
```

### 10.2 Mac Agent

```bash
# 本機開發(monorepo 子套件)
cd /path/to/testtool/agent
npm install
npm run dev -- --server=ws://localhost:3000

# 發布
npm publish  # (未來考慮,初版內部安裝即可)
```

### 10.3 端對端測試

需要的元件:
- Railway 一個 dev project(免費)或本機 server
- Mac Agent 跑在本機
- 一個 fake Codex 替身(可寫個 echo + delay 的小 script,測 protocol)

寫個 e2e test:
1. PM 透過 API 建 run
2. Agent 收到 task.dispatch
3. Fake Codex 印出預定的 [TOOL_REQUEST]
4. Web UI 顯示 modal
5. PM 回應
6. Fake Codex 收到 [TOOL_RESPONSE] 後印 finish
7. Agent 報告 run.completed
8. DB 狀態 = COMPLETED

---

## 11. 待解決議題

需後續討論才能 freeze 的點(本 spec 不下定論):

1. **Web Server 是繼續 Railway 還是改用 Tailscale 內網?** — 跟個人安全偏好相關,先用 Railway public URL 跑,真的擔心再加 layer
2. **Anthropic API key 設在哪?** — 對話生成頁籤需要,但 Mac 上 Codex 自己也需要。前者是 Railway env,後者是 Mac env,兩處,不共用
3. **Result xlsx auto-commit 到 GitHub 的失敗處理** — token rotate / commit conflict / repo 滿了
4. **Mac Agent 第一版要不要支援多 run 並行?** — Codex 限制單 session,所以 agent 也是單 run 一次,但要不要 queue?
5. **節拍訊息結構化 vs 純 forward** — 目前先純 forward,但結果分析頁籤要有「執行進度」展示時可能要 parse,延後決定
6. **TOOL_REQUEST 三類的具體 JSON schema 細節** — 例如 ambiguity_decision 的 options 可不可以包含 input field?
7. **PM 中止 run 後,Codex 已寫到一半的 result.xlsx 怎麼處理?** — 保留 partial?丟棄?讓 PM 決定?
8. **Tauri tray app 升級 v2 的時機** — 跑半年實測後才該想

---

## 12. 文件結束

本 spec 是規劃書 v2.4.1 的工程展開。Codex 開發時:
- 先讀規劃書 v2.4.1 理解定位
- 再讀本 spec 理解技術細節
- 不確定處看「待解決議題」,提出 → Tommy 拍板

Spec 改版規則:每個重大改動都要記錄到「異動紀錄」(本檔暫無,留待 v1.1+)。
