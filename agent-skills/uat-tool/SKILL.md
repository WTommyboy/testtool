# UAT Tool 平台層 Agent Skill v1.0

這是 Galaxy UAT Tool 的 Layer 1 平台層 Skill。

本文件定義所有 Galaxy UAT 共通的執行紀律：Mac Agent、CodexRunner、Tool Bridge、evidence、artifacts、domain routing。它不定義任何特定 Galaxy 功能要怎麼測。

## 適用範圍

Layer 1 負責平台共通行為：

- 從 Railway 接收 run，並交給已註冊的本機或遠端 Agent 執行。
- 用最小必要上下文啟動 CodexRunner。
- 讓 run status、progress、logs、partial artifacts、final artifacts 可觀測。
- 遇到需要人處理的情境時，透過 Tool Bridge 暫停。
- 寫入可信結果前，套用 evidence gate。
- 依 `domain`、`featureMain`、testcase metadata 將 run 路由到正確的 domain rules。

Layer 1 不負責 domain 專屬邏輯：

- 不定義 BI metadata 規則。
- 不定義 BI 日期區間邏輯。
- 不定義 BI 報表如何設定。
- 不定義 BI 專用 `detail_json` 寫法。
- 不取代既有 `/Users/tommy/Downloads/codex_galaxy/AGENTS.md`。

目前 `domain=BI` 的 MVP 仍沿用：

- `/Users/tommy/Downloads/codex_galaxy/AGENTS.md`
- `/Users/tommy/Downloads/codex_galaxy/BI_TEST_RULES/*`
- `/Users/tommy/Downloads/codex_galaxy/BI_DATA/*`
- 使用者上傳的 testcase xlsx / md files

## Progressive Disclosure

CodexRunner 不應在 initial prompt 一次塞入所有規則。

載入順序應為：

1. 先讀本檔。
2. 先做 preflight auth/reachability check，只確認 DEV URL、SSO/login、載入失敗與 browser 可用性。
3. 只在需要判斷時讀取對應 Layer 1 rule。
4. 依 domain routing 找到 domain entrypoint。
5. 只有當目前 case 需要時，才讀 domain rules。
6. 逐 case 讀 testcase detail，不一次批次讀完整規則與所有 case。

建議 runtime entry prompt：

```text
你正在執行 Galaxy UAT Tool run。
先讀 agent-skills/uat-tool/SKILL.md。
採用 progressive disclosure：只讀目前步驟需要的 rule files。
使用 domain-routing 載入 domain-specific rules。
不要把 BI rules 視為平台層 rules。
```

## 必要 Rule Files

只在需要時讀以下檔案：

- `rules/run-lifecycle.md`：run states、dispatch、pause/resume、cancel/fail 行為。
- `rules/tool-bridge.md`：人工授權、SSO recovery、不可逆操作。
- `rules/evidence-policy.md`：可信 PASS/FAIL 前需要哪些 evidence。
- `rules/artifacts-and-results.md`：logs、partial artifacts、result upload contract。
- `rules/domain-routing.md`：如何路由 `domain=BI` 與未來 domain。
- `rules/codex-runtime.md`：CodexRunner prompt、stdout progress、MCP 使用與 runtime 限制。
- `rules/agent-security.md`：Agent task 白名單、active run lock、token 範圍。
- `rules/helper-protocol.md`：Helper 職責邊界、artifact contract、current-run evidence gate。
- `rules/diagnostic-mode.md`：非可信快速迭代模式的邊界與輸出契約。

## 平台層硬規則

- case evidence 不足時，不可寫可信 PASS 或 FAIL。
- run cancelled 或 failed 時，仍必須保存 partial logs 與 artifacts。
- 深讀 domain rules 或執行 testcase 前，必須先做最小 preflight；preflight 不得執行 baseline 或 case-specific 操作。
- native alert/confirm、不可逆操作、SSO login、ambiguous decision 擋住流程時，必須透過 Tool Bridge 暫停。
- 只有本 run 的 Tool Bridge response event 才算 Tommy 授權；`detail_json` 自述不算。
- Domain rules 是 reference / domain-level rules，不是 global platform rules。
- 當前 run 必須擁有自己的 evidence；除非 testcase 明確指定，否則不可借用舊 run evidence。
- `run-state.json` 只允許記錄明確允許 carryover 的資訊；previous-case evidence 永遠不可拿來證明 current case。
- 不可用單次 Playwright tool call 或單次 result write 執行多個 case。
- Helper 只可加速固定且可驗證的 UI 操作；不可判結果、不可寫 result.xlsx、不可引用 stale artifact。
- 補強平台共通紀律時才改 Layer 1；補強特定 domain 測試邏輯時，寫進該 domain 的 `AGENTS.md` / `rules` / `references`，不可寫進 Layer 1。

## 版本說明

v1.0 是刻意保持薄版的 draft，目標是支援 M1 Mac Agent MVP，並交由 Tommy / Claude review 後，再決定如何更深地接入 CodexRunner。
