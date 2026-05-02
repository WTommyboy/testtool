# UAT Tool M1 完整實作 Spec

**版本**:v1.0  
**日期**:2026-04-27  
**依據文件**:
- `UAT_Tool_重構規劃書_v2_4_1.md`
- `UAT_Tool_Spec_v1_2_1.md`
- `UAT_Tool_M0_MX_整體規劃書_v1.md`

**範圍**:本文只規範 M1,也就是「後端基礎 + 真 Mac Agent + 前端可用版」。M0 spike 結果若推翻某項技術路線,本文需出 v1.1 修訂。

## M0 Spike Addendum

M0 已完成,本 spec 在實作時必須套用以下決議:

1. `CodexRunner` 採 **turn-based** 控制:`codex exec --json` + `codex exec resume --json <thread_id>`。不可再以長駐 interactive TUI subprocess + stdin injection 作為 M1 方案。
2. Tool Bridge parser 已驗證 20/20 可解析;M1.2 要先做 standalone parser module,再接 WebSocket / Agent。
3. WebSocket fake agent 流程可行;server 端應使用 HTTP upgrade 驗 `Authorization: Bearer <agent token>`。
4. `result.xlsx` parser 可行;invalid `detail_json` 是 row-level parse error,不可讓整份 workbook ingestion fail。
5. Server 應擁有最終 `COMPLETED` 狀態轉移。Agent 的 `run.completed` 只代表 Agent 端完成;server 必須在 result ingestion 成功後才把 run 標成 `COMPLETED`。
6. M0-4 真 Railway/Postgres migration 尚未跑;M1.1 DB 完成前必須補跑 `M0_DATABASE_URL=<railway-dev-db> node spikes/m0/postgres-drizzle/run-spike.mjs`。
7. M0-5 SSO 只驗證 persistent profile 機制;Galaxy SSO 24h persistence 需 Tommy 實際登入後再驗。

## 2026-05-03 Runtime Addendum

M1 production 線已從「前景可視化 Chrome」調整為 **background-safe Browser Session Lease**:

1. 每個 run/case 產生 `input/browser-session.json`,記錄 `runId`、`caseNo`、`generation`、`sessionId`、CDP `targetId`、random token / tokenHash 與 `windowName`。
2. Agent 在 dedicated Chrome tab 寫入 `window.name = uat-tool:<runId>:<caseNo>:<generation>:<token>` 與 `sessionStorage.__uatToolBrowserSession`。
3. helper 只能用 marker/token resolve 目標 page;禁止 fallback 到第一個 Galaxy tab、active tab、OS foreground window 或 URL-only match。
4. 正常 helper / Codex phase 不得 `page.bringToFront()` 或 CDP `/json/activate`;run/case 一開始建立 Chrome window/tab 仍允許。
5. `collage.configureMetric` 必須等待 `載入欄位中...` 清除後才找 `+ 新增欄位`;timeout 回 `FIELD_LIST_LOAD_TIMEOUT`,載入完成後仍無控制項才回 `ADD_FIELD_BUTTON_NOT_CLICKABLE`。

此 addendum 覆蓋本文早期「讓 Chrome 前景跟動」相關假設。未來若要完全隔離桌面,VM Runner 列為 M2 評估,不屬本 P0。

---

## 0. M1 定義

### 0.1 M1 目標

M1 完成後,Tommy 能在 `testtool-eight.vercel.app` 做以下事:

1. GitHub OAuth 登入。
2. 選 BI Domain Pack。
3. 建立一輪 UAT run。
4. 上傳 testcase xlsx、startup instruction、baseline。
5. 看到 Mac Agent online。
6. 從 Web UI 啟動 run。
7. Mac Agent 自動啟動 Codex CLI + Playwright MCP。
8. Web UI 即時看到 Codex stdout。
9. Codex 需要授權時,Web UI 跳出 modal。
10. Codex 完成後,Agent 上傳 result.xlsx / log。
11. Railway 解析 result.xlsx,case result / detail_json / bugs 入 DB。
12. Web UI 的結果分析頁可查 run history、case detail、bug、artifact。

### 0.2 M1 非目標

- 不做 cloud_novnc。
- 不做多 agent 並行。
- 不做 public npm 發佈。
- 不做完整 Tauri tray app。
- 不做所有 domain 的 production-grade parser,先以 BI v2.0/v2.1 為主。
- 不做進階跨輪趨勢圖,先做查詢與基本統計。
- 不要求 Tool Bridge 三類全部完成,M1.2 先支援 `irreversible_operation`。

### 0.3 M1 拆分

| 階段 | 名稱 | 主要產物 |
|---|---|---|
| M1.1 | 後端基礎 + fake agent round-trip | Postgres/Drizzle、Auth、Domain Pack、result parser、fake agent |
| M1.2 | 真 Mac Agent + Codex 通訊 | `/agent`、WebSocket、CodexRunner、Tool Bridge 基礎 |
| M1.3 | 前端三頁籤 + 歷史分析 | 拆 component、執行頁、結果頁、artifact download |

---

## 1. Repository 與 Branch

### 1.1 Branch

開發 branch:

```bash
git checkout -b refactor/mac-agent-mvp
```

### 1.2 建議目錄結構

```
uat-tool/
├── src/
│   ├── server.ts
│   ├── config.ts
│   ├── db/
│   │   ├── client.ts
│   │   ├── schema.ts
│   │   ├── migrations/
│   │   └── repositories/
│   ├── routes/
│   │   ├── auth.routes.ts
│   │   ├── runs.routes.ts
│   │   ├── agents.routes.ts
│   │   ├── domains.routes.ts
│   │   └── artifacts.routes.ts
│   ├── services/
│   │   ├── auth.service.ts
│   │   ├── runs.service.ts
│   │   ├── domain-loader.service.ts
│   │   ├── result-parser.service.ts
│   │   ├── websocket.service.ts
│   │   └── artifacts.service.ts
│   ├── agent/
│   │   ├── agent-registry.ts
│   │   ├── agent-ws.ts
│   │   └── message-protocol.ts
│   ├── parsers/
│   │   ├── testcase-parser.ts
│   │   ├── result-parser.ts
│   │   └── adapters/
│   └── types/
│       ├── api.ts
│       ├── run.ts
│       └── agent.ts
├── agent/
│   ├── package.json
│   ├── src/
│   └── tsconfig.json
├── web/
│   └── src/
└── package.json
```

### 1.3 Legacy 檔案處理

| 檔案 | M1 處理 |
|---|---|
| `src/runner.ts` | 不再被 runtime 引用;保留作參考,之後可移到 `_archive` |
| `src/playwright-health.ts` | API 下線;用 agent status 替代 |
| `src/db.ts` | 被 `src/db/client.ts` + Drizzle schema 取代 |
| `src/xlsx-parser.ts` | 拆成 testcase parser + adapters |
| `src/runs.ts` | 拆 routes/service/repository |
| `src/conversations.ts` | M1 凍結或最小保留,不作主戰場 |
| `src/claude.ts` | 保留 |

---

## 2. Environment

### 2.1 Railway env

必填:

```env
NODE_ENV=production
DEFAULT_TIMEZONE=Asia/Taipei
CORS_ALLOWED_ORIGINS=https://testtool-eight.vercel.app,http://localhost:5173

DATABASE_URL=postgres://...
STORAGE_ROOT=/app/persist

ANTHROPIC_API_KEY=...
CLAUDE_MODEL=claude-...

GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_OAUTH_CALLBACK_URL=https://testtool-production.up.railway.app/api/auth/github/callback
SESSION_SECRET=...

RULES_REPO_URL=https://github.com/WTommyboy/galaxy-uat-rules.git
RESULTS_REPO_URL=https://github.com/WTommyboy/galaxy-uat-results.git
GITHUB_TOKEN=...

AGENT_BOOTSTRAP_SECRET=...
```

移除:

```env
DB_PATH
PLAYWRIGHT_*
GOOGLE_*
ENABLE_GOOGLE_SHEETS_SYNC
```

### 2.2 Vercel env

```env
VITE_API_BASE_URL=https://testtool-production.up.railway.app
```

不得放:

- `ANTHROPIC_API_KEY`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_TOKEN`
- Agent token

### 2.3 Mac Agent config

`~/.uat-agent/config.json`

```json
{
  "version": 1,
  "server": "wss://testtool-production.up.railway.app/agent-ws",
  "token": "<agent token>",
  "device_name": "Tommy's MacBook Pro",
  "codex_bin": "/path/to/codex",
  "workdir_root": "/Users/tommy/.uat-agent/runs",
  "chrome_profile_dir": "/Users/tommy/.uat-agent/chrome-profile",
  "log_level": "info"
}
```

---

## 3. Database

### 3.1 ORM

使用 Drizzle + Postgres。

建議 packages:

```bash
npm install drizzle-orm pg ws bcryptjs cookie jsonwebtoken simple-git
npm install -D drizzle-kit @types/pg @types/ws @types/bcryptjs
```

若使用 OAuth helper 可加:

```bash
npm install express-session
npm install -D @types/express-session
```

### 3.2 Canonical run status

```ts
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
```

合法轉移:

| From | To |
|---|---|
| DRAFT | ASSIGNED, FAILED |
| ASSIGNED | AGENT_RUNNING, FAILED, INTERRUPTED |
| AGENT_RUNNING | WAITING_USER, UPLOADING_RESULT, FAILED, INTERRUPTED |
| WAITING_USER | AGENT_RUNNING, FAILED, INTERRUPTED |
| UPLOADING_RESULT | INGESTING_RESULT, FAILED |
| INGESTING_RESULT | COMPLETED, FAILED |
| COMPLETED | 無 |
| FAILED | 無 |
| INTERRUPTED | ASSIGNED, FAILED |

`INTERRUPTED → ASSIGNED` 僅允許 PM 明確重派或 Agent reconnect snapshot 證實仍可接續。

### 3.3 Tables

#### runs

核心欄位:

- `id uuid`
- `domain text`
- `round_id text`
- `status text`
- `execution_mode text`
- `agent_id uuid nullable`
- `domain_rules_commit text`
- `xlsx_path text`
- `xlsx_schema_version text`
- `startup_instruction_path text`
- `baseline_data jsonb`
- `result_xlsx_url text`
- `result_xlsx_parser_version text`
- `log_path text`
- `notes text`
- `created_by text`
- `created_at timestamptz`
- `started_at timestamptz`
- `finished_at timestamptz`

#### run_events

- `id bigserial`
- `run_id uuid`
- `event_type text`
- `seq integer nullable`
- `payload jsonb`
- `created_at timestamptz`

事件類型初版:

- `run.created`
- `task.dispatched`
- `task.acknowledged`
- `agent.online`
- `agent.heartbeat`
- `agent.lost`
- `run.started`
- `run.stdout`
- `run.stderr`
- `tool_request.created`
- `tool_response.sent`
- `result.upload_started`
- `result.uploaded`
- `result.ingest_started`
- `result.ingested`
- `run.completed`
- `run.failed`
- `run.interrupted`

#### run_case_results

- `id bigserial`
- `run_id uuid`
- `case_no text`
- `group_name text`
- `test_type text`
- `case_title text`
- `status text`
- `verdict_reason text`
- `detail_json jsonb`
- `detail_json_raw text`
- `detail_parse_error text`
- `related_bug_ids text[]`
- `execution_method text`
- `tested_at timestamptz`

唯一鍵:

- `(run_id, case_no)`

#### bugs

- `id bigserial`
- `run_id uuid`
- `bug_id text`
- `severity text`
- `related_case_no text`
- `title text`
- `description text`
- `suggestion text`
- `status text`
- `created_at timestamptz`

#### agent_tokens

- `id uuid`
- `token_hash text`
- `device_name text`
- `created_at timestamptz`
- `last_seen_at timestamptz`
- `revoked_at timestamptz`

#### user_sessions

- `id uuid`
- `github_login text`
- `session_token text`
- `created_at timestamptz`
- `expires_at timestamptz`
- `revoked_at timestamptz`

### 3.4 M1 不建 artifacts table

M1 先用 `runs.result_xlsx_url`、`runs.log_path`、`run_events.payload.path`。M2 再補 `artifacts` table,並讓 `run_events.payload.artifact_id` 取代 raw path。

---

## 4. Auth Spec

### 4.1 GitHub OAuth

白名單:

```ts
const ALLOWED_GITHUB_LOGINS = ["WTommyboy"];
```

### 4.2 Routes

| Method | Path | 說明 |
|---|---|---|
| GET | `/api/auth/github/start` | redirect 到 GitHub OAuth |
| GET | `/api/auth/github/callback` | OAuth callback |
| POST | `/api/auth/logout` | 清 session |
| GET | `/api/auth/me` | 回目前登入者 |

### 4.3 Session cookie

Cookie:

- `httpOnly=true`
- `secure=true` production
- `sameSite=lax`
- max age 建議 7 天

### 4.4 Auth middleware

PM-facing API:

- `/api/runs`
- `/api/domains`
- `/api/agents`
- `/api/artifacts`
- `/api/conversations`

Agent-facing API:

- `/api/runs/:id/input/*`
- `/api/runs/:id/output/*`
- `/agent-ws`

Agent-facing 使用 Bearer token,不使用 GitHub session。

---

## 5. Domain Loader

### 5.1 功能

`domain-loader.service.ts` 負責:

- clone rules repo。
- pull 最新 commit。
- list domains。
- load domain pack files。
- 回傳 commit hash。
- cache 到 Railway volume。

### 5.2 API

| Method | Path | 說明 |
|---|---|---|
| GET | `/api/domains` | 列出可用 domain |
| POST | `/api/domains/sync` | git pull |
| GET | `/api/domains/:name/rules` | 取 rules summary |
| GET | `/api/domains/:name/schema` | 取 xlsx schema |

### 5.3 Domain Pack contract

必填:

- `AGENTS.md`
- `xlsx_schema.json`
- `result_parser_adapter.json`
- `startup_prompt_template.md`

缺任一檔案時,該 domain 不可啟動 run,UI 顯示錯誤。

---

## 6. Testcase Import Parser

### 6.1 Input

- PM 上傳 testcase xlsx。
- Domain Pack 提供 `xlsx_schema.json`。

### 6.2 Output

解析後寫入:

- `runs.xlsx_path`
- `runs.xlsx_schema_version`
- `run_events` 一筆 `input.xlsx_parsed`

M1 不一定要把未執行前的 case 全部寫入 `run_case_results`;正式結果以 result.xlsx 為準。若要顯示 pending case,可另外讀 import parse 結果或建立 `run_import_cases` 暫表。M1 建議先不擴表。

### 6.3 Version strategy

- 優先讀 xlsx 明確 version 欄位。
- 若沒有 version,用 header fingerprint 推斷。
- 推斷失敗且 `accept_legacy=true` 時進 legacy adapter。
- 仍失敗就拒絕匯入。

---

## 7. Result Parser

### 7.1 Input

- Agent 上傳 result.xlsx。
- run 的 `xlsx_schema_version`。
- Domain Pack 的 `result_parser_adapter.json`。

### 7.2 Output

- Upsert `run_case_results`。
- Upsert `bugs`。
- 寫 `run_events`:
  - `result.ingest_started`
  - `result.case_parsed`
  - `result.bug_parsed`
  - `result.ingested`

### 7.3 detail_json handling

規則:

1. cell 空 → `detail_json=null`, `detail_json_raw=null`。
2. valid JSON object → `detail_json=parsed`, `detail_json_raw=original string` 可選保留。
3. valid JSON but not object → `detail_json=null`, `detail_json_raw=original`, `detail_parse_error=NOT_OBJECT`。
4. invalid JSON → `detail_json=null`, `detail_json_raw=original`, `detail_parse_error=<error message>`。

### 7.4 Parser fixture

必備 fixture:

- PASS with simple detail_json。
- FAIL with full detail_json。
- BLOCKED with blocked reason。
- invalid detail_json。
- Bug sheet with High/Medium/Low。

### 7.5 API

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/runs/:id/output/result-xlsx` | Agent 上傳 result.xlsx |
| POST | `/api/runs/:id/ingest-result` | 手動重跑 parser,PM/admin 用 |

---

## 8. Runs API

### 8.1 POST /api/runs

`multipart/form-data`

Fields:

- `domain`
- `round_id`
- `execution_mode=interactive`
- `agent_id`
- `notes`
- `baseline_data` optional JSON string
- `testcase_xlsx` file
- `startup_instruction` file
- `baseline_file` optional

流程:

1. 驗 GitHub OAuth session。
2. 驗 domain pack 存在。
3. 驗 agent online。
4. 儲存 input files。
5. 建 `runs` status=`DRAFT`。
6. 寫 `run.created` event。
7. 取得 domain rules commit。
8. 發 `task.dispatch`。
9. 發出後 status=`ASSIGNED`。

如果 agent offline:

- 不派 task。
- 可選策略 A:拒絕建立 run。
- 可選策略 B:建立 DRAFT run。

M1 建議採策略 A:直接拒絕,避免 PM 以為已排程。

### 8.2 GET /api/runs

Query:

- `domain`
- `round_id`
- `status`
- `page`
- `pageSize`

### 8.3 GET /api/runs/:id

回:

- run metadata。
- summary counts。
- latest agent status。
- artifact links。

### 8.4 GET /api/runs/:id/events

Query:

- `after_id`
- `limit`

M1 可先 polling。M2 再考慮 Web UI 直接 WebSocket/SSE。

### 8.5 GET /api/runs/:id/cases

Query:

- `status`
- `group`
- `case_no`

回 `run_case_results`。

### 8.6 GET /api/runs/:id/bugs

回 `bugs`。

### 8.7 POST /api/runs/:id/cancel

流程:

1. 驗 session。
2. 若 status terminal,回 409。
3. 發 `task.cancel` 給 agent。
4. status=`INTERRUPTED`。
5. event=`run.interrupted`,reason=`pm_cancelled`。

---

## 9. Agent Token API

### 9.1 POST /api/agents/tokens

PM 登入後產生 agent token。

Request:

```json
{
  "device_name": "Tommy's MacBook Pro"
}
```

Response:

```json
{
  "id": "...",
  "token": "uatagt_...",
  "device_name": "Tommy's MacBook Pro"
}
```

Token 只顯示一次。DB 只存 bcrypt hash。

### 9.2 GET /api/agents/tokens

回 masked token list:

- id
- device_name
- created_at
- last_seen_at
- revoked_at
- online status

### 9.3 DELETE /api/agents/tokens/:id

Revoke token。

---

## 10. WebSocket Protocol

### 10.1 Endpoint

`GET /agent-ws`

Headers:

```http
Authorization: Bearer <agent token>
X-Agent-Version: 0.2.0
X-Device-Name: Tommy's MacBook Pro
```

### 10.2 Message envelope

```json
{
  "id": "msg_uuid",
  "seq": 1,
  "type": "agent.online",
  "timestamp": "2026-04-27T00:00:00.000Z",
  "ack_required": true,
  "payload": {}
}
```

### 10.3 Agent capabilities

`agent.online` payload:

```json
{
  "device_name": "Tommy's MacBook Pro",
  "agent_version": "0.2.0",
  "platform": "darwin-arm64",
  "codex_version": "codex-cli 0.124.0",
  "node_version": "v20.x",
  "supported_task_types": ["uat_run"],
  "supported_execution_modes": ["interactive"],
  "tool_bridge_versions": ["spike-v1"],
  "playwright_mcp_available": true,
  "chrome_profile_ready": true,
  "current_run_id": null
}
```

### 10.4 Railway → Agent

#### task.dispatch

```json
{
  "type": "task.dispatch",
  "ack_required": true,
  "payload": {
    "run_id": "...",
    "domain": "BI",
    "round_id": "MR004",
    "rules_commit": "...",
    "input_urls": {
      "xlsx": "...",
      "startup_instruction": "...",
      "baseline": "..."
    }
  }
}
```

#### task.cancel

```json
{
  "type": "task.cancel",
  "ack_required": true,
  "payload": {
    "run_id": "...",
    "reason": "pm_cancelled"
  }
}
```

#### tool_response

```json
{
  "type": "tool_response",
  "ack_required": true,
  "payload": {
    "run_id": "...",
    "request_id": "...",
    "approved": true,
    "note": ""
  }
}
```

### 10.5 Agent → Railway

- `agent.online`
- `agent.heartbeat`
- `run.started`
- `run.stdout`
- `run.stderr`
- `run.tool_request`
- `tool_response.delivered`
- `run.uploading_result`
- `run.completed`
- `run.failed`
- `run.rejected`

### 10.6 Ack

Ack message:

```json
{
  "id": "msg_ack_uuid",
  "type": "ack",
  "timestamp": "...",
  "payload": {
    "in_reply_to": "msg_uuid"
  }
}
```

重要訊息未收到 ack:

- retry 3 次。
- 每次間隔 2s / 5s / 10s。
- 仍失敗則標記 connection unhealthy。

---

## 11. Mac Agent

### 11.1 Package

`/agent/package.json`

```json
{
  "name": "uat-tool-agent",
  "version": "0.2.0",
  "bin": {
    "uat-agent": "dist/cli.js"
  }
}
```

`X-Agent-Version` and `agent_version` are sourced from `/agent/package.json`; runtime code must not hard-code the semantic version.

### 11.2 Commands

#### login

```bash
uat-agent login --server https://testtool-production.up.railway.app --token uatagt_xxx
```

寫入 config,chmod 600。

#### start

```bash
uat-agent start
```

前景啟動 WebSocket client。

#### doctor

```bash
uat-agent doctor
```

檢查:

- config exists。
- server reachable。
- token valid。
- Codex binary exists。
- Codex version readable。
- Node version OK。
- workdir writable。
- Chrome profile writable。
- Playwright MCP availability。
- Galaxy SSO profile hint。

#### status

```bash
uat-agent status
```

顯示:

- connected/disconnected。
- current run。
- last heartbeat。
- workdir。

### 11.3 Workdir

```
~/.uat-agent/runs/<run_id>/
├── input/
├── rules/
├── output/
├── codex.log
├── codex.log.clean
└── state.json
```

### 11.4 Single active run lock

Lock file:

`~/.uat-agent/active-run.lock`

內容:

```json
{
  "run_id": "...",
  "pid": 12345,
  "started_at": "..."
}
```

Agent start 時若 lock 存在:

1. 檢查 pid 是否活著。
2. 活著 → 回報 busy。
3. 不活著 → 標記 stale lock,清除並回報 previous run interrupted。

### 11.5 Codex Runner

M1.2 依 M0 結果實作。

Interface:

```ts
export interface CodexRunner {
  start(ctx: CodexRunContext): Promise<void>;
  writeToolResponse(response: ToolResponse): Promise<void>;
  cancel(reason: string): Promise<void>;
  onStdout(cb: (line: string) => void): void;
  onStderr(cb: (line: string) => void): void;
  onToolRequest(cb: (request: ToolRequest) => void): void;
  onExit(cb: (result: CodexExitResult) => void): void;
}
```

### 11.6 TOOL_REQUEST parser

Parser 規則:

- buffer stdout。
- 找完整 `[TOOL_REQUEST]` 到 `[/TOOL_REQUEST]`。
- parse JSON。
- parse fail 不 crash,發 `run.stderr` warning。
- 成功後發 `run.tool_request`。
- 原始文字仍保留在 codex.log。

M1.2 只要求支援:

```json
{
  "type": "irreversible_operation",
  "request_id": "...",
  "case": "...",
  "action": "...",
  "reason": "..."
}
```

---

## 12. Frontend M1.3

### 12.1 API client

`web/src/api/client.ts`

功能:

- base URL from `VITE_API_BASE_URL`。
- credentials include。
- JSON error handling。
- file upload helper。

### 12.2 Auth UI

若 `/api/auth/me` 401:

- 顯示登入頁。
- 按「GitHub 登入」→ `/api/auth/github/start`。

### 12.3 ExecutionPage

Sections:

1. Agent status card。
2. New run form。
3. Upload inputs。
4. Active run stream。
5. Tool request modal。
6. Run summary cards。

### 12.4 ResultsPage

Sections:

1. Filters。
2. Runs list。
3. Run summary。
4. Case result table。
5. Detail JSON expandable panel。
6. Bugs。
7. Artifacts。

### 12.5 ConversationPage

M1 保持最小可用:

- 顯示既有 conversation。
- 可送 message。
- 可下載/上傳附件若既有功能正常。

不在 M1 重做完整 LLM testcase generator。

---

## 13. Artifact API

M1 endpoints:

| Method | Path | 說明 |
|---|---|---|
| GET | `/api/runs/:id/input/xlsx` | Agent 拉 xlsx |
| GET | `/api/runs/:id/input/startup` | Agent 拉 prompt |
| GET | `/api/runs/:id/input/baseline` | Agent 拉 baseline |
| POST | `/api/runs/:id/output/result-xlsx` | Agent 上傳 result |
| POST | `/api/runs/:id/output/log` | Agent 上傳 log |
| GET | `/api/runs/:id/output/result-xlsx` | PM 下載 result |
| GET | `/api/runs/:id/output/log` | PM 下載 log |

M1 不做 screenshot upload endpoint;若 Codex 產截圖,先由 result.xlsx detail_json 或 log 記 path。M2 再正規化 artifact table。

---

## 14. Testing

### 14.1 Backend tests

最低測:

- auth middleware。
- run status transition。
- result parser fixture。
- domain loader missing files。
- agent token create/revoke。
- WebSocket message parse。

### 14.2 Agent tests

最低測:

- config read/write。
- doctor。
- TOOL_REQUEST parser。
- fake Codex runner。
- lock file。
- upload retry。

### 14.3 Frontend tests

最低測:

- auth redirect state。
- run form validation。
- results filter。
- detail_json render。

### 14.4 E2E

M1.1:

- fake agent E2E。

M1.2:

- true agent + fake Codex。
- true agent + true Codex simple prompt。

M1.3:

- full UI flow。

---

## 15. Acceptance Criteria

### M1.1 Done

- Railway 用 Postgres。
- GitHub OAuth 可登入。
- Domain Pack 可同步。
- Web UI 可建 fake run。
- fake result.xlsx 可解析入庫。
- results page 能看到 case results。

### M1.2 Done

- `uat-agent doctor` 可跑。
- Agent online 狀態可在 Web UI 顯示。
- Web UI 可派 task 到本機 agent。
- Agent 可啟動 Codex。
- stdout 回流。
- result.xlsx 回流入庫。

### M1.3 Done

- PM 可不開終端機完成一輪 run。
- case / detail_json / bug / artifact 可在工具內查看。
- UI 不再依賴單檔巨石 App.tsx。
- M1 demo 可用 BI domain 跑一輪小型 smoke。

---

## 16. Implementation Order

建議順序:

1. 建 branch。
2. 加 Drizzle/Postgres skeleton。
3. 建 schema + migration。
4. 加 auth routes。
5. 加 domain loader。
6. 加 result parser fixture。
7. 拆 runs routes/service。
8. 加 fake agent WebSocket。
9. 做 M1.1 demo。
10. 建 `/agent` package。
11. 加 agent config/doctor/login/start。
12. 加 WebSocket client。
13. 加 CodexRunner。
14. 加 upload result。
15. 做 M1.2 demo。
16. 前端拆 pages/components。
17. 補 ExecutionPage。
18. 補 ResultsPage。
19. 做 M1.3 demo。

---

## 17. Open Decisions after M0

M0 後必須回填:

1. CodexRunner 實作選哪條路。
2. Tool Bridge 是否達 90%。
3. SSO profile 是否穩。
4. result parser adapter 實際欄位 mapping。
5. Web UI stream 用 polling、SSE、還是 WebSocket。

未回填前,M1.2 不能正式開。

---

## 18. 結論

M1 的核心交付不是「重寫工具」,而是讓工具第一次真正具備完整 closed loop:

`Web UI 建 run → Railway 派工 → Mac Agent 起 Codex → Codex 跑測 → result.xlsx 回流 → DB 入庫 → Web UI 查結果`

所有 M1 實作都應服務這條閉環,非必要功能延後到 M2。
