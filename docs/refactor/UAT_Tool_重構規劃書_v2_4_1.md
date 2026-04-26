# UAT Tool 重構規劃書

**版本**:v2.4.1(取代 v2.4)
**配套 Spec**:UAT_Tool_Spec_v1.2.1.md
**撰寫日期**:2026-04-26
**撰寫者**:Tommy (PM) + Claude (協作) + Codex (技術 review)
**狀態**:active 文件,Codex 開發以此為依據。
**前版狀態**:v1.0 / v2.0 / v2.1 / v2.2 / v2.3 / v2.4 全部歸檔。本版整合 Codex quick check 後的命名、狀態機、Auth、Agent package 與 Codex spawn 對齊修正。

---

## 異動紀錄

| 版本 | 日期 | 修改說明 | 變更原因 | 影響 | 修改人 |
|------|------|----------|----------|------|--------|
| v1.0 | 2026.04.22 | 初版 BI 專用 | - | 已歸檔 | Tommy |
| v2.0 | 2026.04.25 | 改為通用 UAT 控制台 | - | 已歸檔 | Tommy |
| v2.1 | 2026.04.26 | 雲端必然路線 + 抽象層 | - | 已歸檔 | Tommy |
| v2.2 | 2026.04.26 | 核心架構翻新 | 對齊發現:「本機 vs 雲端」指 Codex 跑哪、不是工具跑哪;Railway 工具一直在,第一階段就需要 Mac Agent 當橋樑 | 規劃書重寫;Mac Agent 從「未來規劃」拉到「第一階段必做」 | Tommy |
| v2.3 | 2026.04.26 | 部署架構校正 + 既有 DB 處置 | 確認真實部署是「Vercel 前端 + Railway 後端拆分」(非單 Railway);確認 Railway DB 內 3 筆舊 run 是 4/16 失敗試跑可全丟;確認 `execution_mode` 既有兩值 `offline`(舊棄)/ `interactive`(占位重定義) | 第 1 章三層分工圖加 Vercel 一格;第 4 章 env vars 表加 Vercel 部分;第 4.2 DB 遷移從零開始;`interactive` 模式重新定義為「Mac Agent 模式」 | Tommy |
| v2.4 | 2026.04.26 | 整合 Codex 第一輪 review | Codex 指出:`claude.ts` 是 SDK wrapper 不是 conversation API、`runner.ts` 經驗應移轉而非丟棄、xlsx parser 需多版本支援、第 22 條撞名(現有 BI AGENTS.md v1.8 已用)、case 結果應入庫 + 版本化 result parser、需登入保護、Mac Agent 安全邊界、單一 active run lock、artifact 儲存策略、狀態機補完、Domain Pack 需含 parser adapter | 多處修正(見章節);新增第 12 章 Mac Agent 安全與 Lock、第 13 章 Artifact 儲存、Tool Bridge Protocol 改放 spike 文件 | Tommy + Codex |
| v2.4.1 | 2026.04.26 | Codex quick check 對齊版 | v2.4 仍殘留 `local`、`WAITING_AGENT`、第 22 條命名、Agent package 名稱、Auth 與 status enum 不一致 | 統一 execution_mode=`interactive`;統一 canonical run status;Auth 改為 GitHub OAuth 第一階段必做;Agent package freeze 為 repo `/agent`、package `uat-tool-agent`、binary `uat-agent`;Codex spawn 明確列為 M0 spike 結果決定 | Codex |

---

## 文件目錄

1. 核心架構:三層分工
2. 工具的三個頁籤
3. Mac Agent — 第一階段就要做的橋樑
4. 部署現況與調整
5. Domain Pack 結構(GitHub)
6. 資料儲存策略
7. xlsx 解析:schema-driven + 多版本支援
8. Tool Bridge Protocol(spike 階段)
9. Roadmap(M0 7 項 spike + M1 拆三段)
10. 不可寫死清單(留路給未來)
11. (跳號,內容併入第 9 章)
12. Mac Agent 安全與 Lock(Codex review 新增)
13. Artifact 儲存策略(Codex review 新增)
14. 待後續討論的細節清單
15. 文件結束

---

## 1. 核心架構:三層分工

工具的本質是把三個東西串起來,各司其職:

```
┌────────────────────────────────────────────────┐
│  第一層:Tommy 的瀏覽器(任何裝置)              │
│  - Mac、手機、iPad,任何能開瀏覽器的裝置        │
│  - 入口:https://testtool-eight.vercel.app     │
└────────────────┬───────────────────────────────┘
                 │ 載入靜態 SPA
                 ↓
┌────────────────────────────────────────────────┐
│  第二層 a:Vercel(前端 React/Vite static)      │
│  - 從 GitHub `codex/uat-tool-mvp` branch 自動  │
│    deploy web/ 子目錄                           │
│  - VITE_API_BASE_URL 指向 Railway 後端          │
│  - 不存資料、不跑 server logic                   │
│  - 不放敏感 secrets(VITE_* 會被 bundle 進 JS) │
└────────────────┬───────────────────────────────┘
                 │ 跨域 API 呼叫
                 │ (CORS 已在 Railway 設好)
                 ↓
┌────────────────────────────────────────────────┐
│  第二層 b:Railway(後端 Express + DB)           │
│  - 從同一個 GitHub repo 自動 deploy(全部 src/) │
│  - 路由:/health、/api/runs、/api/conversations │
│         /api/playwright(舊,規劃下線)           │
│  - 環境變數:Anthropic API key、DB 等敏感資訊  │
│  - Mac Agent WebSocket 終點(新增)              │
│  - GitHub 整合(讀 rules、可選寫 results)       │
│  - LLM 整合(Anthropic API,對話頁籤後端用)     │
│                                                  │
│  ⚠ 完全不再跑 Playwright / Chromium             │
│  (existing runner.ts 的 chromium.launch 移除) │
└────────────────┬───────────────────────────────┘
                 │ WebSocket(雙向)
                 │
                 ↓
┌────────────────────────────────────────────────┐
│  第三層:Tommy 的 Mac(執行機)                  │
│  - Mac Agent(常駐 daemon,連 Railway)         │
│  - Codex CLI(被 Mac Agent spawn)              │
│  - Playwright MCP(被 Codex 起)                │
│  - Chrome 實機(Playwright 操作)               │
└────────────────────────────────────────────────┘

未來擴展(同樣架構,換執行機):
  第三層可以是「家用常駐機」、「VPS + noVNC」等,
  但 Agent 的 protocol 跟 Railway 的對接層不變。
```

### 1.1 為什麼是這個架構

對齊以下事實後,只剩這條路是對的:

| 事實 | 推論 |
|------|------|
| 工具已部署:Vercel 前端 + Railway 後端拆分,雙端都在跑 | 沿用,不重起爐灶 |
| Vercel serverless 不支援 long-lived WebSocket / subprocess | Mac Agent 連 Railway,不連 Vercel |
| Railway 容器無實機瀏覽器 | Codex / Chromium 不能在 Railway 跑 |
| Codex 必須有實機 Chrome 才能用 Playwright MCP 代操作 | Codex 必須在「有實機 Chrome」的機器跑 |
| 第一階段:那台機就是 Tommy 的 Mac | Mac 是 Codex 的執行機 |
| Tommy 不想坐在終端機看 Codex,要透過工具介面 | Mac 上需要一個 daemon 接收 Railway 指令、起 Codex、回流輸出 |
| → 這個 daemon 就是 Mac Agent | Mac Agent 第一階段就必做,不是未來才需要 |

### 1.2 三層各自是什麼

**第一層(瀏覽器)**:不裝 app、不需要做開發。Tommy 在哪都能用工具。

**第二層 a(Vercel)**:現役 deploy 持續跑,**不需大改**。三個頁籤的 React 程式碼隨需求改造(見第 2 章),build 後 push GitHub 自動 deploy。

**第二層 b(Railway)**:現役 deploy 持續跑,**內部要改不少**(見第 4 章)。所有 PM 看得到的 API 在這層。

**第三層(Mac)**:現在沒做 — 必須新做。是 Mac 上一個輕量 daemon,登入後常駐,把 Railway 跟本機 Codex 接起來。

---

## 2. 工具的三個頁籤

工具 web UI 三個主頁籤,各自的責任:

### 2.1 對話生成頁籤

PM 在這頁跟 LLM 對話討論測試案例設計、產出啟動指令草稿、產出 xlsx 草稿。

- 工具邏輯:純 Railway,呼叫 Anthropic API
- 不涉及 Mac,不需要 Mac Agent 在線
- 產出可以下載(.txt / .xlsx),供「測試頁籤」上傳使用

(這頁的細部設計留待後續討論)

### 2.2 測試頁籤(本規劃書核心)

PM 在這頁發起一輪 UAT 執行。流程見第 3 章 Mac Agent 介紹後的流程圖。

#### 2.2.1 介面元件

```
┌────────────────────────────────────────────┐
│ 新增測試輪次                                 │
├────────────────────────────────────────────┤
│                                              │
│ 1. 選擇執行模式                              │
│    ◉ 本機 - Mac Agent(interactive)         │
│    ◯ (未來)雲端 noVNC(cloud_novnc)        │
│    ◯ (未來)遠端機(remote_machine)         │
│    註:舊 offline 模式已棄用                 │
│                                              │
│ 2. 選擇 Domain                               │
│    [BI 工具 ▼]                              │
│    └ Rules 來源:GitHub(commit a3f5b2c)   │
│      [⟳ 同步最新版]                          │
│                                              │
│ 3. Mac Agent 狀態(僅本機模式顯示)           │
│    🟢 Tommy's MacBook Pro 線上              │
│       上次回報:剛才                         │
│    或                                        │
│    🔴 Mac Agent 離線,無法啟動本機任務       │
│       (請先打開 Mac 上的 UAT Tool Agent)   │
│                                              │
│ 4. 輪次 ID                                   │
│    [MR004                ]                   │
│                                              │
│ 5. 上傳輸入物                                 │
│    ▢ 測試案例 xlsx(必填)                  │
│    ▢ 啟動指令 .txt(必填)                  │
│    ▢ Baseline                                │
│                                              │
│ [建立輪次並啟動]                              │
└────────────────────────────────────────────┘
```

#### 2.2.2 執行中介面

啟動後切到「執行中」面板:

```
┌────────────────────────────────────────────┐
│ Run: MR004(BI 工具)— 執行中               │
│ 開始:14:23  執行機:Tommy's MacBook Pro    │
│                                              │
│ 進度:8 / 88                                 │
│                                              │
│ ┌─ Codex 輸出(stream)──────────────────┐ │
│ │ [14:38:22] H-08 完成 → PASS           │ │
│ │ [14:35:11] H-07 完成 → FAIL           │ │
│ │ ...                                    │ │
│ └────────────────────────────────────────┘ │
│                                              │
│ [中止 Run]                                  │
└────────────────────────────────────────────┘
```

當 Codex 輸出 `[TOOL_REQUEST]` 標記時,工具彈 modal 請 PM 處理(見 8.1 草案)。

### 2.3 結果分析頁籤(舊稱:資料總覽)

PM 在這頁看歷史 runs、bugs、跨輪比對、(未來)趨勢分析。

- 工具邏輯:Railway,讀 Railway Postgres
- 不需要 Mac Agent

(這頁的細部設計留待後續討論,初步包含:Runs 列表、Bug 追蹤、跨輪比對)

---

## 3. Mac Agent — 第一階段就要做的橋樑

### 3.1 為什麼必須做

Railway 跟 Mac 之間需要通訊管道,讓「Railway 點啟動 → Mac 跑 Codex → 輸出回 Railway」這個 round-trip 成立。沒有這管道,測試頁籤的「啟動」按鈕沒處可去。

### 3.2 Mac Agent 的責任

```
┌─────────────────────────────────────────┐
│ Mac Agent (常駐 daemon)                  │
├─────────────────────────────────────────┤
│ 1. 啟動 + 認證                           │
│    - PM 開 Mac Agent → 輸入 token       │
│    - WebSocket 連到 Railway             │
│    - 識別自己「Tommy's MacBook Pro」    │
│                                          │
│ 2. 心跳 + 狀態回報                       │
│    - 每 30 秒 ping Railway              │
│    - 回報「在線 / 跑著哪個 run / 閒置」 │
│                                          │
│ 3. 接收任務                              │
│    - Railway push「請跑 MR004」          │
│    - 收到任務 ID + Run 元資料           │
│                                          │
│ 4. 拉取 input                            │
│    - 從 Railway API 拉 xlsx / 啟動指令  │
│    - 從 GitHub clone Domain rules       │
│    - 在 Mac 本地組好工作目錄            │
│                                          │
│ 5. spawn Codex CLI                       │
│    - 啟動 Codex CLI subprocess          │
│    - 把啟動指令寫進 stdin               │
│    - 監聽 stdout                         │
│                                          │
│ 6. 串流輸出                              │
│    - 每行 stdout 即時回傳 Railway       │
│    - 偵測 [TOOL_REQUEST] 標記           │
│    - 收到 Railway 的 [TOOL_RESPONSE]     │
│      → 寫進 Codex stdin                 │
│                                          │
│ 7. 收尾                                  │
│    - Codex exit → 回報 Railway          │
│    - 上傳 result.xlsx 到 Railway        │
│    - 工作目錄保留(Phase X 清理)        │
└─────────────────────────────────────────┘
```

### 3.3 形式選擇

**第一版形式(MVP)**:純 Node daemon

- repo 內 `/agent` 子目錄,package name `uat-tool-agent`,binary `uat-agent`
- MVP 先用 local install / `npm link`;穩定後再考慮 npm publish
- 你在 Mac 終端機 `uat-agent login` 一次設 token
- `uat-agent start` 啟動,跑在前景或用 `pm2 / launchd` 當背景服務
- 工程量最小

**未來可升級成 Tauri tray app**:
- Mac menu bar 圖示
- 點圖示看狀態 / 暫停 / 切換 token
- 工程量加 30-50%
- 排到 Phase X(本規劃書不細寫)

第一版選純 Node daemon,理由:**先讓整個 round-trip 通,UX 之後再優化**。

### 3.4 通訊協議

WebSocket(雙向)為主,fallback 為 long-poll。

訊息類型(Mac → Railway):
- `agent.online` — 上線
- `agent.heartbeat` — 心跳(含當前狀態)
- `run.started` — 開始跑某 run
- `run.stdout` — Codex 輸出某行
- `run.tool_request` — 偵測到授權請求
- `run.completed` — 跑完
- `run.failed` — 跑壞

訊息類型(Railway → Mac):
- `task.dispatch` — 派任務
- `task.cancel` — 取消任務
- `tool_response` — PM 對 TOOL_REQUEST 的回應

詳細 protocol schema 留 Spec v1.2.1 文件寫。

### 3.5 認證與多裝置

**第一階段假設**:只有 Tommy 一個 Mac。token 是手動產生 + 手動填到 Mac Agent。

- Railway 的「設定 → Mac 裝置」頁,Tommy 點「產生新 token」→ 工具產一串 random string
- Tommy 複製,在 Mac 上 `uat-agent login --token=XXX`
- Mac Agent 用這 token 連 Railway WebSocket

未來多 Mac / 多人:同樣機制,設定頁可列多個 token、撤銷某個、看每個對應的裝置名稱。

### 3.6 離線情境

**Mac Agent 沒在線**:
- 工具測試頁籤的「Mac 狀態」顯示 🔴
- 啟動按鈕 disable,顯示「請先打開 Mac Agent」
- 若 PM 已建立但尚未成功派工,run 留在 DB(狀態 `DRAFT` 或 `ASSIGNED`),不刪除

**Mac 跑到一半 Agent 斷線**:
- Railway 端 run 狀態變 `INTERRUPTED`,並在 `run_events` 寫入 reason=`agent_lost`
- Codex 在 Mac 上應該還在跑(subprocess 不受 agent 斷線影響)
- Agent 重連後回報「我還在跑 MR004」→ Railway 接續流式輸出

**Mac 重啟 / Agent 真的死了**:
- Codex subprocess 也被 OS 殺掉
- Agent 重連後發現自己沒在跑任何東西
- Railway 端 run 維持 `INTERRUPTED`,並在 `run_events` 寫入 reason=`agent_restarted_without_process`
- PM 介入決定怎處理(restart? 接續? 廢棄?)

### 3.7 重要邊界

Mac Agent **不**做的事:
- 不解析節拍訊息(只 forward stdout 原始文字到 Railway)
- 不判斷 PASS / FAIL(那是 Codex / xlsx 的事)
- 不啟動 Playwright(那是 Codex 自己會做的事)
- 不寫 DB(只透過 Railway API 寫,DB 在 Railway 那邊)
- 不持久化 run 資料(臨時工作目錄,跑完上傳結果就好)

---

## 4. 部署現況與調整

### 4.0 現役部署事實

| 項目 | Vercel | Railway |
|------|--------|---------|
| URL | testtool-eight.vercel.app | testtool-production.up.railway.app |
| 角色 | 前端 SPA(React/Vite static) | 後端 API + DB + 檔案儲存 |
| Source | GitHub repo `web/` 子目錄 | GitHub repo `src/`(全部) |
| Branch | `codex/uat-tool-mvp` | 同上 |
| 環境變數數 | 1(`VITE_API_BASE_URL`) | 20(規劃下方整理) |
| Volume | 無 | testtool-volume(SQLite + 檔案) |

兩邊都是現役,**v2.3 規劃不重起爐灶,只在這個基礎上調整**。

### 4.1 Vercel 端調整

**保留**:
- 既有 deploy 流程(GitHub push 自動 build 前端)
- `VITE_API_BASE_URL` 指向 Railway

**改造範圍(由前端工程實作,本規劃書不細列)**:
- 三個頁籤的調整(第 2 章已說明)
- 加新的 UI:Mac Agent 連線狀態指示、TOOL_REQUEST modal、模式選擇
- 拿掉「Playwright 連線狀態」相關 UI(因為 Railway 不再跑 Playwright)

**不改的事**:
- 不另設敏感 env(VITE_* 會 bundle 進 JS,所有人可見)
- Anthropic API key 永不放 Vercel

### 4.2 Railway 端調整

#### 4.2.1 Env vars 整理

**砍掉**(7 個 PLAYWRIGHT + 5 個 GOOGLE = 12 個):
- `PLAYWRIGHT_BROWSERS_PATH`
- `PLAYWRIGHT_HEADLESS`
- `PLAYWRIGHT_TIMEOUT_MS`
- `PLAYWRIGHT_HEALTHCHECK_TIMEOUT_MS`
- `PLAYWRIGHT_HEARTBEAT_INTERVAL_MS`
- `PLAYWRIGHT_CRASH_DOWN_MS`
- `PLAYWRIGHT_CRASH_CONSECUTIVE_THRESHOLD`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_SHEET_ID`
- `ENABLE_GOOGLE_SHEETS_SYNC`

**保留**:
- `ANTHROPIC_API_KEY`(對話生成頁籤用)
- `CLAUDE_MODEL`
- `APPROVAL_TTL_MIN`
- `DEFAULT_TIMEZONE`
- `NODE_ENV`
- `NUMERIC_TOLERANCE`
- `STORAGE_ROOT`(Railway volume mount 點)

**調整**:
- `DB_PATH`(舊:SQLite 路徑)→ 改為 `DATABASE_URL`(新:Postgres connection string)
- 既有 SQLite 內 3 筆 4/16 失敗試跑紀錄不遷移(見 4.2.3)

**新增**:
- `RULES_REPO_URL`(GitHub rules repo)
- `RESULTS_REPO_URL`(GitHub results repo,可選)
- `GITHUB_TOKEN`(commit results 用)
- `AGENT_BOOTSTRAP_SECRET`(管理頁首次產生 Agent token 用;正式 token 以 `agent_tokens` DB 表為準)
- `CORS_ALLOWED_ORIGINS`(允許 Vercel 域名打 API,例如 `https://testtool-eight.vercel.app`)
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_OAUTH_CALLBACK_URL`
- `SESSION_SECRET`

#### 4.2.2 程式碼清理

**重要更正(基於 Codex 第一輪 review)**:

- `claude.ts` 是 Anthropic SDK 的 client wrapper(48 行),**保留沿用**,不要與 conversation API 混淆
- `conversations.ts`(270 行)才是 conversation API 主體,目前**凍結邏輯**等待對話頁籤新設計
- `runner.ts` 內累積的設計經驗(登入暫停、截圖證據、detail JSON、approval、artifacts 處理)**不能直接丟棄**,要映射到 Mac Agent / run_events

**移除(實際邏輯下線)**:
- `runner.ts` 裡 `chromium.launch(...)` 段 + step action runner(goto/click/fill/...)+ `executeCustomNaturalStep` 等屬於「Railway 跑 Playwright」的功能
- `playwright-health.ts` 後端 Playwright 健康檢查(改為 Mac Agent 狀態 API,見 Spec)

**凍結(保留檔案,內部邏輯不再被引用)**:
- `runner.ts` 整檔保留為「設計參考」,Mac Agent 開發時應參考其登入暫停 / artifact 收集策略 / approval 流程 / detail JSON 設計
- `conversations.ts` + 路由凍結,等對話生成頁籤新設計再決定如何整合

**保留繼續沿用**:
- `claude.ts`(Anthropic SDK wrapper)
- `xlsx-parser.ts`(改造為 schema-driven + 多版本支援,見 4.2.6)
- `db.ts`(schema 整理 + 切 Postgres,既有資料丟棄不遷移)
- `runs.ts` 大部分 API(瘦身,移除 step / approve 等不再用的端點;**保留 export-md / bugs / history / summary,對齊新架構**)
- `server.ts`(掛新 router,加 WebSocket 升級、CORS、登入保護中介)
- `playwright.ts`(下線健康檢查路由,但檔案本身可作為元件移轉參考)

**新增**:
- `mac-agent-router.ts`(WebSocket 接 Mac Agent 連線)
- `domain-loader.ts`(GitHub clone / pull / cache 管理)
- `tool-bridge.ts`(TOOL_REQUEST / TOOL_RESPONSE 中繼,**舊名 auth-protocol 改名避歧**)
- `auth.ts`(GitHub OAuth 登入保護)
- `result-parser.ts`(版本化 result.xlsx parser,寫入 run_case_results 表,見 4.2.6)
- `artifacts/`(資料夾,儲存策略集中管理,見第 13 章)

#### 4.2.3 DB 遷移:從零開始,不做 migration

**現役 SQLite 內容**(已透過 `/api/runs/history` 確認):
- 3 筆 RC-R001 run,全部 2026-04-16 跑的
- 全部是當時測 `offline` runner 的失敗試跑(SUCCEEDED 的那筆是 3 秒空跑、其他兩筆 BLOCKED / CANCELLED)
- 沒有真實 UAT 結果

**處置**:**全部丟棄**,Postgres 從乾淨 schema 開始。

**ORM 選擇**:
- 現有 code 用 `better-sqlite3`(SQLite-only)
- 切 Postgres 推薦用 Drizzle(輕、TypeScript-first、跨 SQLite/Postgres)
- 不選 Prisma(對個人 project 太重)

#### 4.2.4 `execution_mode` 欄位的重新定義

既有 `runs.execution_mode` 是 string,實際使用過兩個值:

| 值 | 舊定義 | 新定義 | 使用情境 |
|----|--------|--------|----------|
| `offline` | 後端 Railway headless Playwright | **棄用**,不接受新建此模式的 run | 4/16 三筆失敗試跑用過,證明此路不通 |
| `interactive` | Codex 之前留的占位 | **重新定義為「Mac Agent 本機代理」** | Phase 1 預設模式 |
| `cloud_novnc` | 不存在 | 預留 | 未來 |
| `remote_machine` | 不存在 | 預留 | 未來 |

UI 端:測試頁籤的「執行模式」下拉只顯示 `interactive`(本機 Codex CLI + Playwright MCP),其他三個未來才開放。

#### 4.2.5 新版 DB schema(Postgres)

```sql
-- 主表:每輪 UAT 一筆
CREATE TABLE runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL,                   -- BI / SDK / 金流 ...
  round_id TEXT NOT NULL,                 -- MR004
  status TEXT NOT NULL,                   -- 詳見下方狀態機
  execution_mode TEXT NOT NULL,           -- 'interactive' / 'cloud_novnc' / 'remote_machine'
  agent_id TEXT,                          -- 哪台 Mac 跑的(interactive 模式才有)
  domain_rules_commit TEXT NOT NULL,      -- GitHub commit hash
  
  xlsx_path TEXT,                         -- Railway volume 上的暫存 xlsx
  xlsx_schema_version TEXT,               -- 'v2.0' / 'v2.1' 等(從 Domain Pack 對應出來)
  startup_instruction_path TEXT,
  baseline_data JSONB,
  
  result_xlsx_url TEXT,                   -- GitHub URL 或 Railway URL
  result_xlsx_parser_version TEXT,        -- 用哪版 parser 解的
  log_path TEXT,                          -- Railway volume 上的 log
  
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  
  UNIQUE(domain, round_id)
);

-- 事件表:run 過程的時間軸
CREATE TABLE run_events (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,               -- agent_connected / case_started / 
                                          -- tool_request / tool_response / 
                                          -- case_completed / error
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_run_events_run_id ON run_events(run_id);
CREATE INDEX idx_run_events_type ON run_events(event_type);
CREATE INDEX idx_run_events_payload_gin ON run_events USING GIN (payload);

-- Case 結果表(Tommy 選 A 全入庫,Codex 建議的設計)
CREATE TABLE run_case_results (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  case_no TEXT NOT NULL,                  -- E-15 / H-08 等
  group_name TEXT,                        -- A / B / E / H / ...
  test_type TEXT,                         -- 數據邏輯 / UI 互動 / ...
  status TEXT NOT NULL,                   -- PASS / FAIL / BLOCKED / PARTIAL
  verdict_reason TEXT,
  
  -- detail_json 入庫,parse 失敗時保留 raw 避免遺失
  detail_json JSONB,                      -- parse 後的結構化資料
  detail_json_raw TEXT,                   -- 原始 cell 字串(parse 失敗 fallback)
  detail_parse_error TEXT,                -- parse 失敗訊息(若有)
  
  related_bug_ids TEXT[],                 -- 關聯的 BUG-007 等(陣列)
  execution_method TEXT,                  -- Playwright MCP / 人工 / Tommy
  tested_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(run_id, case_no)
);
CREATE INDEX idx_run_case_results_run_id ON run_case_results(run_id);
CREATE INDEX idx_run_case_results_status ON run_case_results(status);
CREATE INDEX idx_run_case_results_group ON run_case_results(group_name);
CREATE INDEX idx_run_case_results_detail_gin ON run_case_results USING GIN (detail_json);

-- Bug 表
CREATE TABLE bugs (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES runs(id),
  bug_id TEXT NOT NULL,                   -- BUG-007
  severity TEXT NOT NULL,                 -- High / Medium / Low / Spec
  related_case_no TEXT,
  title TEXT NOT NULL,
  description TEXT,
  suggestion TEXT,
  status TEXT NOT NULL,                   -- Open / Confirmed / Fixed / Wontfix
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(run_id, bug_id)
);
CREATE INDEX idx_bugs_status ON bugs(status);

-- Mac Agent 認證表(WebSocket 連線用 token)
CREATE TABLE agent_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,        -- bcrypt hash
  device_name TEXT NOT NULL,              -- "Tommy's MacBook Pro"
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

-- PM 登入(GitHub OAuth)session 表(Codex review 新增)
CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_login TEXT NOT NULL,             -- 'WTommyboy'
  session_token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);
```

**Tommy 選 A 全入庫**:case 結果入庫,含 detail_json 完整內容(JSONB),同時保留 raw 字串避免 parse 失敗時遺失資料。run_events 與 run_case_results 並存:前者是時間軸事件、後者是結構化結果。

#### 4.2.6 xlsx parser 多版本 + result.xlsx parser

**xlsx import parser**(讀 PM 上傳的 case xlsx):

依 Codex review 修正,從「完全一致才收」改為「**多版本支援 + adapter 模式**」:

- 每個 Domain Pack 可宣告 supported_versions(例如 BI: ["v2.0", "v2.1"])
- Parser 讀 xlsx header 後,依 schema_version 找對應 adapter 解析
- 找不到對應版本但 `accept_legacy=true` 時,嘗試 fallback 並產生 warning
- 找不到且不允許 legacy 時拒絕匯入,錯誤訊息明確指出問題欄位

**result.xlsx parser**(讀 Codex 寫好的結果 xlsx):

這是新增功能,**必須版本化**:

- 每個 Domain Pack 帶 `result_parser_adapter.json`(或 `.ts` 如果需要邏輯)
- Parser 依 xlsx_schema_version 找對應 adapter 解 case 結果
- detail_json cell 是「儲存在 cell 裡的 JSON 字串」,parser 解析後存 JSONB,失敗時保留 raw 字串到 `detail_json_raw`
- 工程量估 6-10 天(含 v1.x、v2.0 兩版 adapter + Bug sheet + fixture 測試)

實作要點:
- 不寫「萬用猜欄位 parser」一路撐到底
- 每版本獨立 adapter,fixture xlsx 檔測試
- 升版時新增 adapter,舊版仍可用 accept_legacy 收(產生 warning)

#### 4.2.7 Run 狀態機(Codex review 補完)

從 v2.3 的粗版補成 Codex 建議的細版:

```
DRAFT
  └─ 剛建立、尚未派送
ASSIGNED
  └─ Railway 派出 task,等 Mac Agent ack
AGENT_RUNNING
  └─ Agent 確認接收、Codex 跑著
WAITING_USER
  └─ 收到 TOOL_REQUEST,等 PM 回應 modal
  └─ 回應後回到 AGENT_RUNNING
UPLOADING_RESULT
  └─ Codex 跑完,Agent 上傳 result.xlsx + log
INGESTING_RESULT
  └─ Railway 收到 xlsx,parse 入 run_case_results 表
COMPLETED
  └─ 一切正常結束
FAILED
  └─ 任何階段出錯(原因記在 run_events)
INTERRUPTED
  └─ PM 主動中止 / Agent 失聯超過閾值
```

**Canonical status enum**:
`DRAFT | ASSIGNED | AGENT_RUNNING | WAITING_USER | UPLOADING_RESULT | INGESTING_RESULT | COMPLETED | FAILED | INTERRUPTED`

舊名詞 `WAITING_AGENT / AGENT_LOST / DISPATCHED / RUNNING / COMPLETED_WITH_ISSUES` 不再作為 DB status 使用;若需保留語意,寫入 `run_events.payload.reason` 或前端文案。

前端依狀態顯示 PM 看得懂的進度文案(「等 Agent 接收」/「Codex 跑著」/「等你回應」/「上傳結果」/「分析中」/「完成」)。

---

## 5. Domain Pack 結構(GitHub)

**從 v2.3 的「Domain Profile」升級為「Domain Pack」**(Codex review 盲點 6 採納):每個 domain 不只有 rules 文件,還包含 parser adapter 與 startup prompt template,工具 core 不寫死任何 BI 特定邏輯。

```
github.com/WTommyboy/galaxy-uat-rules/
├── BI/                                  ← BI Domain Pack
│   ├── AGENTS.md                        ← BI 紀律(目前 v1.8,21 條)
│   ├── BI測試標準_共通方法論.md            ← 方法論 v1.3
│   ├── BI測試_系統背景知識.md              
│   ├── BI系統_metadata摘要.md             
│   ├── metadata_v1_2_5.csv               
│   ├── xlsx_schema.json                  ← 結構定義(import xlsx)
│   ├── result_parser_adapter.json        ← 結果 xlsx 解析設定(支援多版本)
│   └── startup_prompt_template.md        ← 啟動指令模板
│
├── _shared/                             ← 跨 domain 共用
│   └── AGENTS_TOOL_BRIDGE_SPIKE.md      ← Tool Bridge protocol(spike 階段,見第 8 章)
│
├── SDK/                                 ← 未來 SDK Domain Pack
│   └── (相同結構)
│
└── 金流/                                ← 未來 金流 Domain Pack
    └── (相同結構)
```

### 5.1 Domain Pack 必含項目

| 檔案 | 必填 | 用途 |
|------|------|------|
| `AGENTS.md` | ✓ | 該 domain 的 Codex 紀律 |
| 共通方法論.md | ✓ | 測試方法論 |
| 系統背景知識.md | ✓ | domain 系統介紹給 Codex 看 |
| metadata 摘要.md | ✓ | metadata 快速參考 |
| `xlsx_schema.json` | ✓ | import xlsx 結構,含 supported_versions |
| `result_parser_adapter.json` | ✓ | result xlsx 解析設定,Codex 寫的 detail_json 怎麼解 |
| `startup_prompt_template.md` | ✓ | 啟動指令模板,工具產 prompt 用 |

### 5.2 工具 core 永遠不寫死任何 domain 邏輯

實作規範:

- xlsx parser 永遠透過 Domain Pack 的 schema 動態解析,不在 code 裡寫死「BI 16 欄」
- result parser 永遠透過 Domain Pack 的 adapter 解析,不在 code 裡寫死 detail_json 結構
- 啟動 prompt 永遠透過 Domain Pack 的 template 產出,不在 code 裡寫死任何 BI 字眼
- 加新 domain → 在 GitHub repo 多一個 `<domain>/` 資料夾 → 工具 sync → 自動可用

### 5.3 工具行為

- 啟動時自動 fetch GitHub 最新 commit hash
- 對比本地 cache(在 Railway volume),不一致提示同步
- 「同步」按鈕 → git pull
- Run record 存當下用的 commit hash,可重現

### 5.4 可選的 Results Repo

- `github.com/WTommyboy/galaxy-uat-results`
- 工具跑完自動 commit `result.xlsx` + `meta.json`
- 給 RD 直接看連結,異地備份

---

## 6. 資料儲存策略

### 6.1 三層儲存

| 層 | 內容 | 位置 |
|---|------|------|
| 結構化資料 | runs / run_events / bugs / agent_tokens | Railway Postgres |
| 結果交付物 | result.xlsx + meta.json | GitHub `galaxy-uat-results` repo(可選) |
| 大型 raw 資料 | codex.log / screenshots | Railway volume(暫時)/ 未來可遷 Cloudflare R2 |

### 6.2 為什麼這樣分

- **Postgres**:結構化、跨輪查詢、JSON 索引 — 用對 DB
- **GitHub**:免費、版本化、給 RD 看連結方便 — 用對工具
- **Volume / R2**:大檔、不常看、無 schema 需求 — 用對儲存

### 6.3 不用 AWS / GCP / S3

明確不採用 AWS / GCP / Azure。對個人小規模用是 over-engineering(複雜度 + 帳單意外風險高),用不到的維運成本高於價值。

未來若大檔規模超出 Railway volume,優先選 Cloudflare R2(S3 相容、無 egress fee、個人友善)。

---

## 7. xlsx 解析:schema-driven + 多版本支援

**v2.4 修正(Codex review)**:從 v2.3「完全一致才收」改為「**多版本支援 + adapter 模式**」。

詳細實作見 4.2.6 節。本章只列總原則:

- Domain Pack 裡帶 `xlsx_schema.json`,定義 supported_versions(例如 BI: ["v2.0", "v2.1"])
- Parser 讀 xlsx header → 找對應 adapter → 解析
- 找不到對應版本但 `accept_legacy=true` → fallback 並 warning
- 完全找不到 → 拒絕匯入,訊息明確指出問題欄位
- 升 v2.1 / v3.0 → 在 GitHub `xlsx_schema.json` 加版本 + adapter,工具同步 → 自動認新版,code 不動

xlsx_schema.json 結構範例(v2.0,16 欄):

```json
{
  "supported_versions": ["v2.0"],
  "default_version": "v2.0",
  "accept_legacy": false,
  "schemas": {
    "v2.0": {
      "columns": [
        {"index": 1, "name": "輪次ID", "filled_by": "designer", "required": true},
        {"index": 2, "name": "群組", "filled_by": "designer", "required": true},
        {"index": 3, "name": "編號", "filled_by": "designer", "required": true, "unique": true},
        ...(其他 13 欄)
      ]
    }
  }
}
```

未來升 v2.1 → 在 `schemas` 加 "v2.1" 條目 + 在 `supported_versions` 加 "v2.1"。

---

## 8. Tool Bridge Protocol(spike 階段)

**重要修正(Codex review)**:v2.3 規劃書原本將此協議命名為「AGENTS.md 第 22 條工具整合條款」,**會與現有 BI AGENTS.md v1.8 第 22 條(detail_json 寫作風格)撞名,造成既有紀律被覆蓋**。v2.4 修正為:

1. **不直接寫進任何 domain 的 AGENTS.md**
2. **獨立成 spike 文件**:`galaxy-uat-rules/_shared/AGENTS_TOOL_BRIDGE_SPIKE.md`
3. **M0 spike 階段測試 20+ 次穩定度**,通過後再決定要不要正式收編
4. **正式收編時放法是「跨 domain 共用文件 `_shared/AGENTS_TOOL_BRIDGE.md`」,不要每個 domain 各寫一份**

### 8.1 Protocol 草案內容(spike 階段)

```
Tool Bridge Protocol(草案,spike 中)

當啟動指令含「執行環境:UAT Tool」header 時,Codex 改用以下結構化輸出:

第 1 類:不可逆操作授權請求
   輸出:
   [TOOL_REQUEST]
   {
     "type": "irreversible_operation",
     "request_id": "<由 Codex 產生的 uuid>",
     "case": "<case_no>",
     "action": "<具體動作描述>",
     "reason": "<為什麼需要做>"
   }
   [/TOOL_REQUEST]
   
   接著等 stdin 收到:
   [TOOL_RESPONSE]
   {"request_id": "<對應的 uuid>", "approved": true|false, "note": "<可選>"}
   [/TOOL_RESPONSE]

第 2 類:灰色地帶判斷請求(對應原 BI AGENTS.md 灰色地帶條款)
   輸出:
   [TOOL_REQUEST]
   {
     "type": "ambiguity_decision",
     "request_id": "<uuid>",
     "case": "<case_no>",
     "context": "<目前看到的狀況>",
     "options": ["<選項A>", "<選項B>", ...],
     "recommendation": "<Codex 自己的建議>"
   }
   [/TOOL_REQUEST]

第 3 類:Playwright 異常恢復授權
   輸出:
   [TOOL_REQUEST]
   {
     "type": "playwright_recovery",
     "request_id": "<uuid>",
     "error": "<錯誤類型>",
     "proposed_action": "<例如 清除 SingletonLock 並重啟>"
   }
   [/TOOL_REQUEST]

第 4 類:節拍訊息保持原樣輸出(不變)
   即使在工具情境下,節拍訊息仍用 markdown 格式 print 到 stdout,
   工具會收進 log。不結構化、不走 [TOOL_REQUEST]。

第 5 類:人工 session 時忽略本協議
   PM 直接開 Codex CLI 跑時,啟動指令沒「執行環境:UAT Tool」,
   此時授權回到標準對話形式("是否授權刪除?請輸入 yes 確認"),
   既有 21 條紀律不受影響。
```

### 8.2 Spike 驗證標準(M0 必過)

協議真正寫進 `AGENTS_TOOL_BRIDGE.md` 之前,須通過以下 spike:

- 用 fake prompt 產出 [TOOL_REQUEST] 標記,**測 20 次以上**,觀察:
  - 格式漂移率(%)
  - request_id 漏寫率
  - 跨多行 JSON 是否正確收尾 `[/TOOL_REQUEST]`
  - 中途其他輸出污染 buffer 的次數
- 容錯機制:Mac Agent parser 對殘缺輸出的處理(降級為 log warning,不直接崩)
- Railway 端必須有 request 狀態機 + duplicate request_id 偵測

**通過率達 90% 以上才放行**,否則改用 Codex 建議的 fallback:讓 Codex 最後產 structured summary,中途授權改用其他機制(例如 PM 主動暫停 → 工具 inject 指令)。

### 8.3 啟動指令 marker

啟動指令最上方放標準 header,Codex 讀到自動進入 Tool Bridge 模式:

```
# Run Context
- 執行環境:UAT Tool
- Run ID: <run_id>
- Domain: <domain>
- Mac Agent: <device_name>
- Rules Commit: <commit_hash>
- 適用協議:AGENTS_TOOL_BRIDGE_SPIKE.md
```

Mac Agent spawn Codex 前**自動 prepend 此 header**到 PM 上傳的啟動指令,PM 不用手寫。

---

## 9. Roadmap

**M0 範圍擴大、M1 拆三段**(Codex review 採納)。

### Milestone 0(1-2 週):可行性驗證

驗證 6 項最大不確定性,任何一項不通過就調整 M1 範圍:

1. **Codex CLI subprocess / PTY 控制**(信心最低,2-4 天)
   - 在 Mac 上用 Node.js spawn Codex,試 `codex exec --json` JSONL 模式 vs PTY interactive 兩條路
   - 把啟動指令餵進去,看 Codex 能否正常起 Playwright MCP
   - 確認「**中途等 stdin TOOL_RESPONSE 再繼續**」是否可行(Codex 提示這條最不穩)
   - SIGTERM 是否能乾淨關 Chrome、有無 zombie process
   - **失敗應對**:不可行則 Tool Bridge 中途互動機制要改設計(例如最後 batch summary 模式)

2. **Tool Bridge Protocol 穩定度**(3-5 天)
   - 用 fake prompt(spike 文件 `AGENTS_TOOL_BRIDGE_SPIKE.md`)測 [TOOL_REQUEST] 輸出 20+ 次
   - 觀察格式漂移率、request_id 漏寫率、跨多行 JSON 收尾、buffer 污染次數
   - 通過率 90% 以上才放行
   - **失敗應對**:走 Codex 建議的 fallback,讓中途授權改用其他機制

3. **WebSocket 端到端通訊**(2-3 天)
   - Railway 上一個 endpoint 支援 WebSocket upgrade + Bearer token 驗證
   - Mac 端 minimal client 連得上、ping/pong、訊息傳遞
   - 加上 ack / sequence number / dedupe 三項可靠性機制驗證

4. **DB 遷移可行性**(2-3 天)
   - Railway Postgres add-on 開起來
   - Drizzle 跑通 runs / run_events / run_case_results / bugs / agent_tokens / user_sessions 全 schema migration
   - JSONB / GIN index / 全文檢索都驗一遍

5. **SSO / Chrome profile 持久化 spike**(2 天)
   - 你 Mac 上用 Chrome persistent profile 登入 Galaxy SSO 一次
   - 過 24 小時、48 小時後再開,session 是否還在
   - Codex 跑時用同一個 profile,SSO 是否自動帶過去
   - 確認 Codex 不會因為 profile 已登入就跳過設定步驟

6. **result.xlsx upload + parse round-trip**(2-3 天)
   - Mac Agent 上傳一個 fake result.xlsx → Railway 收到 → result-parser 解析 → 寫 run_case_results
   - 用 BI v2.0 的真實 xlsx 樣本測,含 PASS / FAIL / BLOCKED / detail_json 各類
   - parse 失敗的 cell 是否正確 fallback 到 detail_json_raw

7. **(整合)端到端 fake Codex spike**(2-3 天,M0 收尾)
   - 把 1-6 的成果串起來
   - Mac Agent 用「fake Codex」(echo + delay 的 shell script)當替身
   - 走完整路徑:Vercel 觸發 → Railway 派 task → Mac Agent 接收 → fake Codex 跑 → 結果回流 → 入 DB
   - **這條跑通**才證明架構整體可行,進 M1.1

通過後進 Milestone 1。任一條卡死,先回頭修 v2.5 規劃。

---

### Milestone 1.1(2-3 週):後端基礎 + 結果 round-trip

**範圍**:
- Postgres + Drizzle 切換(從零開始,既有 SQLite 丟棄)
- xlsx import parser 改造為 schema-driven + 多版本支援(讀 Domain Pack)
- result.xlsx parser(版本化,寫入 run_case_results 含 detail_json)
- Domain loader(GitHub clone / pull / cache)
- 工具加 GitHub OAuth 登入保護(允許白名單 `WTommyboy`)
- 既有 API 移除 Playwright 相關路由
- Fake agent 模擬 round-trip(用於整段測試)

**結束時狀態**:
- 工具能透過 web UI 匯入 xlsx
- 列出 runs(歷史頁籤)
- 結果頁能查到完整 case 結果(從 fake agent 模擬上傳的)
- **但「啟動」按鈕還沒接上真正的 Mac Agent**,仍是 fake

**驗收**:用 fake agent 模擬一輪 BI 跑完,工具能完整顯示結果。

---

### Milestone 1.2(2-3 週):真正的 uat-tool-agent + 通訊

**範圍**:
- `uat-tool-agent` package 開發(放工具 repo `/agent` 子目錄,共用 types)
- Codex CLI subprocess / PTY 控制(基於 M0 spike 結果選方案)
- WebSocket 雙向通訊(完整 schema:ack / seq / dedupe / agent_capability / run_snapshot)
- 單一 active run lock(Chrome profile / SSO session 不能並行)
- Mac Agent 安全邊界:只接受 `task.dispatch` 一種白名單指令,不變遠端 shell
- 簡化版 TOOL_REQUEST(只支援 type=irreversible_operation 一類,M2 補其他兩類)
- Result xlsx 真實上傳機制(取代 M1.1 的 fake)

**結束時狀態**:
- 你 Mac 開 Mac Agent,工具能真實觸發 Codex 跑
- 結果回流入庫
- 前端 UI 暫時用簡陋版本(M1.3 才打磨)

**驗收**:用 Mac Agent + 真 Codex 跑完一輪 BI 簡單 case,結果與手動跑一致。

---

### Milestone 1.3(1-2 週):前端三頁籤打磨 + 完整歷史紀錄

**範圍**:
- 三頁籤拆 component(從現有 1273 行單檔 App.tsx 拆分)
- 模式選擇下拉、Mac Agent 連線狀態指示燈
- TOOL_REQUEST modal(完整 UX)
- 完整歷史紀錄查詢(過濾、排序、跨輪)
- 結果分析頁:Bug 追蹤、跨輪比對(基本版)
- Artifact 顯示(下載 xlsx、log、截圖)

**結束時狀態**:完整 demo,Phase 1 完成。

**驗收**:用工具跑完一輪 BI MR004,從匯入到分析整段流程順。

---

### Milestone 2(2-4 週):完整版

- TOOL_REQUEST type=ambiguity_decision、playwright_recovery 補完
- Tool Bridge Protocol 從 spike 升級到正式 `_shared/AGENTS_TOOL_BRIDGE.md`(若 spike 通過)
- Mac Agent 體驗優化:`uat-agent doctor`、`uat-agent status`、log tail 工具
- 異常恢復:agent 斷線重連、Codex crash 偵測、result xlsx 上傳失敗 retry
- Run 中止 / 重啟機制
- 結果分析頁:跨輪比對進階版、趨勢圖
- 通知接入:LINE Notify / Discord webhook(跑完推訊息)

### Milestone 3(待定):雲端執行模式

- noVNC + Docker container 路線(Railway 升 Pro plan)
- 或:遠端機 + Tailscale + agent 路線
- 三選一的決策延到 M2 結束時依實測痛點決定

### Milestone X(視需要):工具集擴展

- 對話生成頁籤完整化
- PRD 撰寫器、Prototype 生成器接入工具集 hub
- Mac Agent 可能升 Tauri tray app(menu bar 圖示)
- 多 agent / 多 user 支援

---

## (新增)9.1 整體時程估計

```
M0  :   1-2 週(spike)
M1.1:   2-3 週
M1.2:   2-3 週
M1.3:   1-2 週
─────────────────────
小計:   6-10 週(從動工到 M1 完成)

M2  :   2-4 週(完整版)
M3+ :   視需要
```

每段獨立可 demo,bug 來源不混。

---

## 10. 不可寫死清單(留路給未來)

| # | 不可寫死 | 第一階段值 | 未來可能值 | 抽象方式 |
|---|----------|------------|------------|----------|
| 1 | 執行模式 | `interactive` | `cloud_novnc` / `remote_machine` | run.execution_mode 欄位、模式選擇 dropdown 已預留 |
| 2 | Agent 連線數 | 1 個 Mac | 多個裝置 | agent_tokens 表已支援多 token |
| 3 | Domain | BI 一個 | BI / SDK / 金流 / ... | domain 欄位是 string,無 enum 限制 |
| 4 | Codex CLI 二進位路徑 | Mac 上偵測 | 容器內 fixed path | env var `CODEX_BIN`,Agent 啟動時驗證 |
| 5 | 大檔儲存 | Railway volume | Cloudflare R2 | 抽象 `StorageProvider` interface |
| 6 | Subprocess wrap 方式 | Node spawn | 視 M0 結果可能改 PTY | 抽象 `CodexRunner` interface |
| 7 | 通訊協議 | WebSocket | 可加 long-poll fallback | message bus 抽象 |
| 8 | xlsx schema | 16 欄 v2.0 | 未來欄位變動 | schema 在 GitHub repo,動態載入 |

---

## 12. Mac Agent 安全與 Lock(Codex review 新增)

Mac Agent 跑在你 Mac、由 Railway 派任務,**必須有明確的安全邊界**,避免它變成「雲端可任意執行本機指令的通道」。

### 12.1 任務白名單

Mac Agent **只接受一種訊息類型**:`task.dispatch`。

收到任何其他訊息(例如 `shell.exec` / `file.read` / `agent.update_self` 等)一律拒絕並回報 Railway。

`task.dispatch` 訊息的 schema 嚴格限定:

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
    }
  }
}
```

Mac Agent 執行時:
- 只下載指定 URL 的檔案到 `~/.uat-agent/runs/<run_id>/`
- 啟動指令的內容雖來自 PM 上傳,**Agent 不解析內容、不執行 shell**,只當 stdin 餵給 Codex
- Codex 跑時的環境變數只透傳預設清單(ANTHROPIC_API_KEY、PATH 等),不接受 task 帶任意 env

### 12.2 單一 Active Run Lock

Mac Agent **同時只能跑一個 run**:

- Chrome persistent profile 不能並行(SSO session 衝突)
- Playwright MCP 不適合多瀏覽器並行(資源 + 穩定度)
- 並行容易撞 Codex API rate limit

實作:filesystem lock 或 in-memory state。Agent 收到第二個 task.dispatch 時:
- 回報 Railway:`run.rejected`(原因:agent_busy)
- Railway 端把該 run 維持或改回 `ASSIGNED`,並在 `run_events` 寫入 reason=`agent_busy`,等 active run 結束後再派

### 12.3 Token 認證

WebSocket 連線時,Agent 帶 Bearer token,Railway 用 bcrypt compare 對 `agent_tokens.token_hash`。

- Token 存在 Mac 上的 `~/.uat-agent/config.json`(模式 600)
- Token 失效 → Railway 回 401,Agent 停止重連並提示 PM `uat-agent login` 重設
- PM 在工具設定頁可隨時 revoke token、重發新 token

---

## 13. Artifact 儲存策略(Codex review 新增)

每輪 UAT 產生多種 artifact,**不該全部塞 DB**。DB 存 metadata,檔案放 storage。

### 13.1 Artifact 類型與儲存位置

| Artifact 類型 | 大小範圍 | 儲存位置 | DB 記什麼 |
|---|---|---|---|
| 上傳的 xlsx | 10-200 KB | Railway volume `<DATA_ROOT>/runs/<run_id>/input/source.xlsx` | runs.xlsx_path |
| 啟動指令 .md | 5-50 KB | 同上 input/startup.md | runs.startup_instruction_path |
| Baseline | < 10 KB | DB(直接存 baseline_data JSONB) | 直接在 runs 表 |
| Codex 輸出 result.xlsx | 50 KB - 5 MB | Railway volume output/result.xlsx + 可選 GitHub auto-commit | runs.result_xlsx_url |
| Codex log | 100 KB - 50 MB | Railway volume output/codex.log(可壓縮) | runs.log_path |
| Screenshot | 100 KB - 5 MB / 張 | Railway volume output/screenshots/ | run_events.payload 內 path |
| Playwright trace | 1 MB - 50 MB | Railway volume output/trace/ | run_events.payload 內 path |

### 13.2 命名規則

統一檔名格式,方便程式讀寫與人工 debug:

```
<DATA_ROOT>/runs/<run_id>/
├── input/
│   ├── source.xlsx
│   ├── startup_instruction.md
│   └── baseline.json (若 baseline 走檔案而非 JSONB 欄位)
├── output/
│   ├── result.xlsx
│   ├── codex.log
│   ├── codex.log.clean    ← 去 ANSI 版,給前端 stream 用
│   ├── screenshots/
│   │   └── case_<case_no>_<timestamp>_<seq>.png
│   └── trace/
│       └── case_<case_no>.zip
└── meta.json              ← run summary
```

### 13.3 生命週期 / 清理策略

**Phase 1**:暫時不主動清理,Railway volume 80GB 配額個人用 1-2 年內夠。

**未來規劃**:
- 跑完 90 天以上的 run → log + trace + screenshots 壓縮歸檔到 Cloudflare R2(成本低)
- result.xlsx 永久保留(同步到 GitHub `galaxy-uat-results` repo)
- DB 中的 metadata 永不刪(方便跨輪查詢)

### 13.4 取得 artifact 的 API 端點

前端與 Mac Agent 都透過 Railway API 存取 artifact:

```
GET /api/runs/:id/input/xlsx           (Agent 拉 input)
GET /api/runs/:id/input/startup        (Agent 拉 input)
GET /api/runs/:id/output/result        (PM 下載 result.xlsx)
GET /api/runs/:id/output/log           (PM 下載 log,或 stream)
GET /api/runs/:id/output/screenshot/:filename  (前端顯示截圖)
POST /api/runs/:id/output/result-xlsx  (Agent 上傳 result)
POST /api/runs/:id/output/log          (Agent 上傳 log)
POST /api/runs/:id/output/screenshot   (Agent 上傳 screenshot)
```

所有 API 都需要登入(GitHub OAuth session)或 Mac Agent token 認證。

---

## 14. 待後續討論的細節清單

本規劃書還有以下細節沒展開,留給後續一輪一輪討論:

1. **對話生成頁籤的設計** — 怎麼跟 LLM 對話、產 case、產啟動指令、產 xlsx 草稿
2. **結果分析頁籤的進階場景** — 跨輪比對視覺化、趨勢圖
3. **Mac Agent 的具體 CLI / 認證流程** — `uat-agent login` 的 UX
4. **Tool Bridge Protocol 三類授權的 JSON schema 細節**
5. **Tauri tray app 是否要做** — 看 Node daemon 體驗痛點再決定
6. **xlsx schema 升版時的兼容性策略** — accept_legacy 開關的細節
7. **GitHub auto-commit 的 token 管理 + 失敗處理**
8. **跨裝置使用** — Tommy 同時用 Mac + 手機看工具時的同步顯示
9. **未來 Codex 操作標準化** — 例如「執行/篩選/讀取」這類動作能不能變 Codex 主動回報的 metadata
10. **Cloudflare R2 接入時機** — 何時把舊 artifact 從 Railway volume 搬到 R2

---

## 15. 文件結束

下一步:
1. Tommy review v2.4.1
2. 進入 Milestone 0 可行性驗證(7 項 spike)
3. M0 通過後拆 Milestone 1.1 工單,給 Codex 開發
4. M1.1 完成後接 M1.2 → M1.3

如需修訂規劃書,直接走 v2.5 / v2.6 版本迭代。
