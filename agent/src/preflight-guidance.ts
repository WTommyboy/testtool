import fs from "node:fs";
import path from "node:path";

export const writePreflightGuidance = (runDir: string, devUrl: string | null): string => {
  const filePath = path.join(runDir, "input", "preflight-auth-check.md");
  const content = [
    "# Preflight Auth Check v1.0",
    "",
    "本檔定義正式讀取深層 domain rules 或執行 testcase 前的最小可達性檢查。",
    "",
    "## Scope",
    "",
    "Preflight 只允許做以下事情:",
    "",
    "- 開啟 DEV URL。",
    "- 確認 persistent Chrome / Playwright page 可用。",
    "- 判斷是否已進入 Galaxy BI 目標頁。",
    "- 偵測 SSO redirect、login page、401/403、`載入失敗`、空白頁或明顯無法測試的 blocker。",
    "- 若本 case 已有同一 run、同一 case 的 successful Agent helper browser evidence,且 helper evidence 已涵蓋本題必要 UI/DOM/network 證據,可直接以該 helper evidence 作為可達性證明,不需要 Codex 再額外呼叫 browser MCP。",
    "",
    "Preflight 不允許:",
    "",
    "- 執行任何 testcase step。",
    "- 新增/刪除/儲存報表或專案。",
    "- 取 baseline。",
    "- 設定欄位、篩選、分組、日期。",
    "- 深讀所有 BI rules。",
    "",
    "## Expected DEV URL",
    "",
    `- ${devUrl ?? "(missing)"}`,
    "",
    "## Failure Handling",
    "",
    "若 preflight 偵測到 SSO/login/recovery blocker,必須立即輸出 Tool Bridge request,然後停止本 turn:",
    "",
    "```text",
    "[TOOL_REQUEST]{\"type\":\"playwright_recovery\",\"request_id\":\"<run-id>-preflight-sso\",\"error\":\"LOGIN_REQUIRED: <what was observed>\",\"proposed_action\":\"Tommy completes SSO/login in the persistent Chrome window opened by UAT Agent, then clicks 已處理/continue in the UAT Tool.\"}[/TOOL_REQUEST]",
    "```",
    "",
    "不可嘗試自動登入,不可繼續讀大量規則,不可把等待登入寫成 case result。",
    "",
    "## Success Handling",
    "",
    "若 preflight 通過,用一句 progress 說明目前 URL / page title / observed app shell,再進入 current case 與 rule-index。",
    "",
    "若是使用 successful current-run helper evidence 當作 preflight replacement,必須在 detail_json/currentRunEvidence 註明 helper-pre-run-summary 與 helper report path。",
    ""
  ].join("\n");
  fs.writeFileSync(filePath, content);
  return filePath;
};
