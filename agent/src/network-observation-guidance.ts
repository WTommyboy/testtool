import fs from "node:fs";
import path from "node:path";

export const writeNetworkObservationGuidance = (runDir: string): string => {
  const filePath = path.join(runDir, "input", "network-observation-guidance.md");
  const content = [
    "# Network Observation Guidance v1",
    "",
    "本檔只定義「觀察 UI 觸發的 network」,不是允許直接打 BI API。",
    "",
    "## Allowed",
    "",
    "- 使用 Playwright network events / request inspection / performance entries 觀察本 run 的 UI 操作觸發了什麼 request。",
    "- 使用 read-only `page.evaluate` 讀 `performance.getEntriesByType('resource')` 或頁面已存在的 request metadata。",
    "- 比對 request body 中與本 case 有關的欄位,例如 filters、dateRange、groupBy、fields。",
    "",
    "## Forbidden",
    "",
    "- 不可自行呼叫 BI API 取代 UI 操作。",
    "- 不可用 DevTools UI 當正式操作步驟。",
    "- 不可用 evaluate 觸發 click/change/input 或內部 setter 來製造 request。",
    "- 不可把舊 request 當成 current-run evidence；必須能連到本 case 的 UI action timestamp。",
    "",
    "## Minimal Evidence Shape",
    "",
    "```json",
    "{",
    "  \"caseNo\": \"<case-no>\",",
    "  \"uiAction\": \"按下執行 / 選擇欄位 / 切換運算子等\",",
    "  \"observedAt\": \"<ISO time>\",",
    "  \"request\": {",
    "    \"method\": \"POST\",",
    "    \"url\": \"<matched URL>\",",
    "    \"bodyRelevantFields\": {}",
    "  },",
    "  \"response\": {",
    "    \"status\": 200,",
    "    \"summary\": {}",
    "  }",
    "}",
    "```",
    "",
    "若無法取得 request body,仍可用 DOM/chart/table evidence 判定;但需要在 detail_json 記錄 network observation unavailable 的原因。",
    ""
  ].join("\n");
  fs.writeFileSync(filePath, content);
  return filePath;
};
