# UAT Tool M0-MX 整體調整規劃書

**版本**:v1.0  
**日期**:2026-04-27  
**依據文件**:
- `UAT_Tool_重構規劃書_v2_4_1.md`
- `UAT_Tool_Spec_v1_2_1.md`

**目的**:把本次 UAT Tool 重構從 M0 到 MX 的每個階段拆成可執行、可驗收、可回滾的工程計畫。本文不是替代 v2.4.1/Spec v1.2.1,而是把它們轉成開發路線圖。

---

## 0. 核心方向

### 0.1 最終目標

UAT Tool 的核心能力是:

1. PM 只透過 Web UI 建立、啟動、觀察、查詢 UAT run。
2. Railway 後端負責 run 管理、DB、檔案、事件流、權限、Domain Pack。
3. Tommy 的 Mac 透過 `uat-tool-agent` 接收任務,自動啟動 Codex CLI + Playwright MCP。
4. Codex 完成測試後產出的 result.xlsx / log / artifact 自動回流 Railway。
5. Railway 解析 result.xlsx,把 case 結果、detail_json、bug 全部入庫,供歷史查詢與跨輪分析。

### 0.2 這次重構要移除的錯誤方向

- 不再讓 Railway 跑 Playwright / Chromium。
- 不再保留 `offline` 作為新建 run 模式。
- 不再讓 PM 手動打開終端機、手動貼 Codex 啟動指令。
- 不再讓工具只保存 xlsx 連結而不解析 case 結果。
- 不再把 BI 規則寫死在工具 core。

### 0.3 這次重構要保留的既有資產

- 現有 Vercel + Railway 拆分部署。
- 現有 React UI 的主要頁籤概念,但要拆 component。
- 現有 `claude.ts` Anthropic wrapper。
- 現有 `runner.ts` 裡的登入暫停、approval、artifact、detail_json 經驗,但只作為設計參考,不再由 Railway 執行 Playwright。
- 現有 xlsx parser 的 header/fallback 經驗,但升級成 Domain Pack schema adapter。

---

## 1. 階段總覽

| 階段 | 名稱 | 目標 | 產出 | 是否可 Demo |
|---|---|---|---|---|
| M0 | 可行性 Spike | 驗證最大不確定性 | spike 報告、POC code、通過/失敗決策 | 部分可 demo |
| M1.1 | 後端基礎 + 假 Agent round-trip | Postgres/Drizzle、Domain Pack、result parser、Auth、fake agent | Railway 可管理 run 並解析 fake result | 可 demo |
| M1.2 | 真 Mac Agent + Codex 通訊 | 本機 agent 接任務、起 Codex、回傳 stdout/result | Web UI 可觸發本機 Codex | 可 demo |
| M1.3 | 前端三頁籤與歷史分析 | UI 完整可用,run/result/bug/artifact 可查 | Phase 1 完整 demo | 可 demo |
| M2 | 穩定化與完整人機協作 | Tool Bridge 完整化、恢復機制、通知、artifact table | 可長期日常使用 | 可 demo |
| M3 | 雲端/遠端執行模式 | 支援 cloud_novnc / remote_machine | 多執行機架構 | 視需要 |
| MX | 產品化與跨 domain 擴展 | SDK/金流/帳號等 domain,Agent UX 升級 | 工具平台化 | 視需要 |

---

## 2. M0 可行性 Spike

### 2.1 M0 目的

M0 不做正式功能,只回答「這個架構能不能穩定成立」。M0 通過前不進 M1。

### 2.2 M0 必做 Spike

#### M0-1 Codex CLI subprocess / PTY 控制

**目標**:確認 Mac Agent 是否能穩定啟動 Codex CLI、餵入啟動指令、讀 stdout、必要時寫 stdin 回覆。

**要測的方案**:

| 方案 | 說明 | 風險 |
|---|---|---|
| `codex exec --json` | 非互動 JSONL 模式 | 中途 stdin / TOOL_RESPONSE 可能不可行 |
| PTY interactive | 用 pseudo-terminal 模擬人開 Codex | 控制較複雜,但最接近真實 |
| direct spawn | `spawn(codex, args)` 直接操作 stdin/stdout | 可能不是 Codex CLI 預期用法 |

**驗收條件**:

- 可以讓 Codex 正常啟動並讀到完整 prompt。
- stdout 能逐行捕捉並轉送。
- 可以在 Codex 等待時注入一段 response。
- SIGTERM 後 Codex / Playwright / Chrome 不殘留 zombie process。
- 失敗時有明確替代方案。

**不通過時的決策**:

- 若中途互動不可行,Tool Bridge 改成「最後 summary + 人工 callback」模式。
- 若 Codex CLI 無法可靠被 daemon 控制,需評估改用 Codex MCP/正式 API 能力,或重新設計 agent 邊界。

#### M0-2 Tool Bridge Protocol 穩定度

**目標**:確認 Codex 是否能穩定輸出 `[TOOL_REQUEST]...[/TOOL_REQUEST]` 格式。

**測試方法**:

- 用 `_shared/AGENTS_TOOL_BRIDGE_SPIKE.md` fake prompt 測 20 次以上。
- 故意加入不可逆操作、灰色地帶、Playwright recovery 三類情境。
- 測 parser 對多行 JSON、ANSI、雜訊、截斷輸出的容錯。

**驗收條件**:

- 格式可解析率 >= 90%。
- request_id 缺漏率 = 0 或可自動補救。
- parser 不因壞格式 crash,只寫 warning。
- duplicate request_id 可偵測。

#### M0-3 WebSocket fake agent

**目標**:驗證 Railway WebSocket server 與 Mac fake agent 能可靠連線、派工、ack、重連。

**驗收條件**:

- Agent token 驗證可用。
- `agent.online / heartbeat / task.dispatch / ack / run.stdout / run.completed` 跑通。
- seq/dedupe 對重複訊息有效。
- agent 斷線後 run 狀態可合理處理。

#### M0-4 Postgres + Drizzle schema

**目標**:確認 Railway Postgres + Drizzle migration 可用,且 schema 能支援 v2.4.1。

**要建的表**:

- `runs`
- `run_events`
- `run_case_results`
- `bugs`
- `agent_tokens`
- `user_sessions`

**驗收條件**:

- 本機與 Railway dev DB 都可 migration。
- JSONB 欄位與 GIN index 可用。
- seed 一筆 run + case result + event + bug 後可查詢。
- SQLite 舊資料不遷移,從乾淨 DB 開始。

#### M0-5 SSO / Chrome profile / Agent doctor

**目標**:確認本機執行機可維持 Galaxy SSO session,並能被 doctor 檢查。

**doctor 檢查項**:

- Node 20+。
- Codex CLI 可執行。
- Codex CLI 已登入或可用。
- Playwright MCP 可被 Codex 啟動。
- Chrome persistent profile 目錄存在且可寫。
- Galaxy SSO session 是否仍有效。
- Railway WebSocket token 是否有效。

**驗收條件**:

- 登入後 24 小時內可重開測試頁不被 SSO 擋。
- 若 SSO 失效,工具能明確提示 PM 登入,而不是 silently fail。

#### M0-6 result.xlsx upload + parse round-trip

**目標**:確認 Agent 上傳 result.xlsx 後,Railway 能解析並寫入 `run_case_results`。

**驗收條件**:

- 可解析 PASS / FAIL / BLOCKED / PARTIAL。
- detail_json valid 時寫入 JSONB。
- detail_json invalid 時保留 `detail_json_raw` 與 `detail_parse_error`。
- Bug sheet 可解析到 `bugs`。
- parser 有版本欄位與 fixture 測試。

#### M0-7 Vercel → Railway → Mac Agent → fake Codex E2E

**目標**:把前六項串成一條最小可用流程。

**流程**:

1. Web UI 建 run。
2. Railway 建 DB record 並派 task。
3. fake agent 收 task。
4. fake Codex 印 stdout 與 TOOL_REQUEST。
5. Web UI 回覆 TOOL_RESPONSE。
6. fake Codex 完成並產 fake result.xlsx。
7. Agent 上傳 result.xlsx。
8. Railway parse 入庫。
9. Web UI 查到結果。

**驗收條件**:

- 一條 run 從建立到完成可完整跑通。
- DB 狀態最終為 `COMPLETED`。
- case result 顯示在 UI。
- 所有事件都有 `run_events`。

### 2.3 M0 結束產物

- `M0_Spike_Report.md`
- 各 spike POC code,保留在 `spikes/` 或 branch 內。
- M1 是否照原設計進行的決策。
- 若有重大設計變更,產 `v2.5` 文件;沒有則沿用 v2.4.1。

---

## 3. M1.1 後端基礎 + 假 Agent Round-trip

### 3.1 M1.1 目標

建立正式後端基礎,但 Agent 仍可用 fake agent。這階段先把資料、權限、Domain Pack、result parser 與 fake round-trip 做穩。

### 3.2 主要調整

#### 後端架構

- 導入 Postgres + Drizzle。
- 移除 `better-sqlite3` runtime 依賴。
- 重建 DB schema,不遷移舊 SQLite。
- 拆分 Express routes / services / repositories。

#### Auth

- 加 GitHub OAuth。
- 只允許白名單 `WTommyboy`。
- 所有 PM-facing API 加 auth middleware。
- Agent-facing API 使用 Bearer token。

#### Domain Pack

- 加 `domain-loader.ts`。
- 從 GitHub rules repo clone/pull/cache。
- run 建立時記錄 `domain_rules_commit`。
- xlsx import parser 透過 Domain Pack schema。

#### Result parser

- 新增 `result-parser.ts`。
- 解析 result.xlsx → `run_case_results` / `bugs`。
- 支援 detail_json JSONB + raw fallback。

#### Fake Agent

- 建立 minimal fake agent 或 fake runner。
- 用 fake result.xlsx 測完整 round-trip。

### 3.3 M1.1 驗收

- Web UI 可登入。
- 可建立 run。
- 可上傳 testcase xlsx / startup instruction / baseline。
- 可讀 Domain Pack commit hash。
- fake agent 可上傳 result.xlsx。
- 後端可解析 result.xlsx 並顯示 case results。
- 舊 Playwright health UI/API 已下線或不再影響流程。

---

## 4. M1.2 真 Mac Agent + Codex 通訊

### 4.1 M1.2 目標

把 fake agent 替換為真 `uat-tool-agent`,讓 Web UI 能真正觸發本機 Codex CLI + Playwright MCP。

### 4.2 主要調整

#### Agent package

- repo 子目錄 `/agent`。
- package name `uat-tool-agent`。
- binary `uat-agent`。
- MVP local install / `npm link`,不 public npm。

#### Agent CLI

命令:

- `uat-agent login`
- `uat-agent start`
- `uat-agent status`
- `uat-agent doctor`
- `uat-agent stop`
- `uat-agent install-launchd`
- `uat-agent uninstall-launchd`

#### WebSocket protocol

- `agent.online`
- `agent.heartbeat`
- `task.dispatch`
- `task.cancel`
- `run.started`
- `run.stdout`
- `run.tool_request`
- `tool_response`
- `run.completed`
- `run.failed`

#### Codex Runner

依 M0 結果實作:

- `CodexRunner` interface。
- stdout / stderr line reader。
- TOOL_REQUEST parser。
- stdin writer。
- SIGTERM/SIGKILL cleanup。
- local codex.log 保存。

#### Active run lock

- 同時只允許一個 run。
- 第二個 task 回 `agent_busy`。
- Railway 維持 `ASSIGNED`,等 agent 空閒再派。

### 4.3 M1.2 驗收

- Agent doctor 全綠。
- Web UI 顯示 agent online。
- Web UI 建 run 後 Agent 收到 task。
- Agent 可啟動真 Codex。
- stdout 即時回流 Web UI。
- 至少一個簡單 BI case 可由 Codex 跑完。
- result.xlsx 上傳並入庫。

---

## 5. M1.3 前端三頁籤與歷史分析

### 5.1 M1.3 目標

把工具整理成 PM 可日常使用的介面。

### 5.2 頁籤

#### Tab A 對話生成

- 保留 Anthropic 對話能力。
- 可生成 xlsx 草稿 / startup instruction 草稿。
- 暫不要求完整 domain-aware 生成,但 UI 不應壞。

#### Tab B 測試執行

- Domain 選擇。
- Agent 狀態。
- Run 建立表單。
- input upload。
- 啟動 / 中止。
- run stdout stream。
- TOOL_REQUEST modal。
- 進度統計。

#### Tab C 結果分析

- runs list。
- run summary。
- case results。
- detail_json 展開。
- bug list。
- artifact download。
- 基本 filter:domain、round、status、group、case_no。

### 5.3 前端重構

現有 `web/src/App.tsx` 不再維持單檔巨石。建議拆:

```
web/src/
├── api/
├── components/
├── pages/
│   ├── ConversationPage.tsx
│   ├── ExecutionPage.tsx
│   └── ResultsPage.tsx
├── hooks/
├── types/
└── App.tsx
```

### 5.4 M1.3 驗收

- PM 可從 Vercel UI 完整建立、啟動、觀察、查詢一輪 run。
- 不需要手動開終端機貼 prompt。
- 完成 run 後,case results 直接在工具內可查。
- result.xlsx / log 可下載。

---

## 6. M2 穩定化與完整人機協作

### 6.1 M2 目標

把 M1 可跑的流程變成日常可靠工具。

### 6.2 主要調整

- Tool Bridge 三類 request 完整支援:
  - irreversible_operation
  - ambiguity_decision
  - playwright_recovery
- Agent 斷線重連與 run_snapshot 修復。
- result upload retry / pending upload。
- macOS / LINE / Discord 通知。
- `artifacts` table。
- run resume / restart / cancel policy。
- Agent log tail。
- launchd 安裝穩定化。
- GitHub results auto-commit。

### 6.3 M2 驗收

- Agent 斷線可恢復或清楚標示。
- Codex crash 可清楚回報。
- result 上傳失敗可補傳。
- 工具可安全跑長時間 UAT。

---

## 7. M3 雲端/遠端執行模式

### 7.1 M3 目標

把第三層執行機從 Tommy Mac 擴展到其他機器。

### 7.2 候選方案

| 方案 | 優點 | 風險 |
|---|---|---|
| 家用常駐機 + Agent | 成本低,接近 Mac Agent | 硬體維護 |
| VPS + noVNC | 可遠端看瀏覽器 | GUI/Chrome/SSO 複雜 |
| Tailscale remote machine | 安全連線 | 需網路配置 |
| Railway Pro + noVNC container | 一體化 | 成本與穩定度未知 |

### 7.3 M3 前置條件

- M1/M2 的 Agent protocol 穩定。
- Domain Pack 不依賴 Tommy Mac 本機路徑。
- Artifact 與 result 都已雲端化。

---

## 8. MX 產品化與跨 Domain 擴展

### 8.1 MX 目標

把 UAT Tool 從 BI 專用工具升級成通用 UAT 控制台。

### 8.2 可能調整

- SDK Domain Pack。
- 金流 Domain Pack。
- 帳號/會員 Domain Pack。
- 後台管理 Domain Pack。
- Tauri tray app。
- 多 PM / 多 agent / 多 project。
- 權限角色:admin / tester / viewer。
- run template。
- cross-run analytics。
- bug lifecycle 與 RD handoff。

---

## 9. 開發節奏建議

### 9.1 Branch

- 開新 branch:`refactor/mac-agent-mvp`
- 不直接在 `codex/uat-tool-mvp` 大改。

### 9.2 Commit 原則

- M0 每個 spike 一個或多個 commit。
- M1.1 / M1.2 / M1.3 分 PR 或分批 commit。
- 不混合前端 UI 與 DB migration 在同一個大 commit。

### 9.3 每階段完成後

每階段完成後產一份:

- 完成內容。
- 測試結果。
- 風險與限制。
- 是否需要改規劃書。
- 下一階段開工條件。

---

## 10. 風險總表

| 風險 | 影響 | 提前處理方式 |
---|---|---|
| Codex CLI 不支援穩定中途互動 | Tool Bridge 需改設計 | M0-1 先驗 |
| Galaxy SSO profile 不穩 | 自動測試常被登入擋 | M0-5 先驗 |
| result.xlsx 格式漂移 | 入庫 parser 壞掉 | adapter + fixture |
| Agent 變成遠端 shell 風險 | 安全問題 | task.dispatch 白名單 |
| run status 不一致 | UI/DB/API 混亂 | canonical enum |
| artifact 搬家造成連結壞 | 歷史資料失效 | M2 artifacts table |
| 單檔 App.tsx 持續膨脹 | 前端難維護 | M1.3 拆 component |

---

## 11. 結論

本次重構不是 UI 小改,而是把 UAT Tool 從「本機嘗試跑測平台」轉成「雲端控制台 + 本機執行 Agent + 結果資料庫」架構。M0 的核心是先排除最大技術風險;M1 的核心是做出完整可 demo 的第一版;M2 之後才補穩定性與產品化。

