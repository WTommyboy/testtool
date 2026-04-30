import fs from "node:fs";
import path from "node:path";
import type { CaseManifestCase } from "./case-manifest";
import type { HelperHints } from "./helper-hints";

type WriteBiUiHelperGuidanceOptions = {
  currentCase?: CaseManifestCase | null;
  helperHints?: HelperHints | null;
};

const templateGuidance: Record<string, string[]> = {
  metadata_dropdown_compare: [
    "用真實 UI 展開指定下拉或欄位 picker。",
    "用 DOM read 擷取 visible list、來源群組、欄位名稱與 count。",
    "需要 metadata 對照時讀 run packet 指定的 metadata/reference，不可打 BI API 補清單。"
  ],
  collage_build_preview_save_reopen: [
    "建立拼貼報表時，每次新增欄位/條件後立刻用 DOM 或 snapshot 驗證狀態。",
    "preview 後以 network/chart/table evidence 證明本次 UI action 有生效。",
    "儲存、重開、刪除臨時報表若涉及 irreversible/native dialog，Agent 模式必須走 Tool Bridge。"
  ],
  record_static_fields_date_payload: [
    "用 UI 進入明細模式並設定指定靜態欄位與日期。",
    "按執行後讀取本次 UI 觸發的 request body，確認 dateRange 與欄位 payload。",
    "只觀察 request/response，不可直接呼叫同一 API 取得資料。"
  ],
  metric_date_display_preview: [
    "用 UI 設定時間區間與顯示方式，設定後讀按鈕文字/select value 逐字驗證。",
    "按執行後用 network performance 或 chart/table data 證明本次 preview 已重跑。",
    "若狀態清理 checklist 與 UI 文字不逐字相符，先修正或 BLOCKED。"
  ],
  metric_filter_operator: [
    "用 UI 清空舊篩選，再點 `+ 新增` 建立本題單一篩選列。",
    "欄位、operator、value 都必須透過 visible UI 設定；每一步用 DOM/select/input value 驗證。",
    "切到不帶值 operator 時，必須驗證 request body 沒殘留前一題 value。"
  ],
  metric_group_series: [
    "用 UI 設定分組欄位，設定後讀分組列文字或 select value。",
    "按執行後讀 chart datasets/legend/series count，確認 series 與分組一致。",
    "若需要互補或 baseline，只能使用本 run current evidence 或 run-state 允許的 carryover。"
  ],
  chart_csv_consistency: [
    "Chart.js datasets 可用 read-only page.evaluate 讀取。",
    "CSV 只能使用 UI 下載或 run packet 提供的本地檔案做一致性驗算。",
    "Chart/CSV 對照是 evidence，不代表可跳過 UI preview。"
  ],
  download_csv_verify: [
    "下載必須由 UI 操作觸發。",
    "下載後可用本地 CSV parser 檢查檔名、表頭、row count、aggregate。",
    "不可用 API 直接產生 CSV 取代 UI 下載。"
  ],
  save_load_flow: [
    "儲存前確認是本輪臨時資源名稱，不覆蓋既有主資源。",
    "Agent 模式遇到 native alert/confirm 或不可逆操作需 Tool Bridge response；非 SSO/login request 會由 Mac Agent 依 policy 自動回覆。",
    "重開後用 DOM/network/chart evidence 驗證設定真的還原。"
  ],
  manual_ai: [
    "此題需要 Codex 判斷或延伸驗證，不應固定腳本化。",
    "仍可使用單步 helper 做讀取與 UI 操作，但不可讓 helper 判結果。",
    "遇到 spec 灰區或文件衝突時停下走 Tool Bridge/回報。"
  ]
};

const formatJson = (value: unknown): string => JSON.stringify(value ?? {}, null, 2);

const currentCaseSection = (options: WriteBiUiHelperGuidanceOptions): string[] => {
  const currentCase = options.currentCase;
  const helperHints = options.helperHints;
  const lines = [
    "## Current Case Helper",
    "",
    `- case_no: ${currentCase?.caseNo ?? "(unavailable)"}`,
    `- risk_level: ${currentCase?.riskLevel ?? "(unavailable)"}`,
    `- test_target: ${currentCase?.testTarget ?? "(unavailable)"}`,
    `- cleanup_checklist: ${currentCase?.cleanupChecklist ?? "(unavailable)"}`
  ];

  if (!helperHints) {
    lines.push(
      "- helper_hints: not found; use current-case-pack inferred evidence templates and keep one-case guard.",
      ""
    );
    return lines;
  }

  const template = helperHints.operationTemplate ?? "manual_ai";
  const recipe = templateGuidance[template] ?? templateGuidance.manual_ai;
  lines.push(
    `- helper_hints_source: ${helperHints.sourceRelativePath ?? helperHints.sourcePath}`,
    `- automationLevel: ${helperHints.automationLevel ?? "(missing)"}`,
    `- operationTemplate: ${template}`,
    `- aiDecisionRequired: ${helperHints.aiDecisionRequired === null ? "(missing)" : String(helperHints.aiDecisionRequired)}`,
    helperHints.requiredEvidence.length > 0
      ? `- explicit_required_evidence: ${helperHints.requiredEvidence.join(", ")}`
      : "- explicit_required_evidence: (none)",
    helperHints.warnings.length > 0 ? `- warnings: ${helperHints.warnings.join(", ")}` : "- warnings: none",
    "",
    "### Template Notes",
    "",
    ...recipe.map((item) => `- ${item}`),
    "",
    "### Helper Params",
    "",
    "```json",
    formatJson(helperHints.params),
    "```",
    ""
  );
  return lines;
};

export const writeBiUiHelperGuidance = (runDir: string, options: WriteBiUiHelperGuidanceOptions = {}): string => {
  const filePath = path.join(runDir, "input", "bi-ui-helper-guidance.md");
  const content = [
    "# BI UI Helper Guidance v1.0",
    "",
    "本檔是 BI domain 的安全 UI 操作備忘,目標是減少 Codex 反覆摸索頁面。它不是測試規則的替代品,也不是批次執行授權。",
    "",
    ...currentCaseSection(options),
    "## 不可越界",
    "",
    "- 不可用內部函式設定狀態,例如 `window.addFilter()`、`window.addFieldToSelection()`、`window.selectDateRangePreset()`。",
    "- 不可用 `browser_evaluate` 觸發 click/change/input 等會改狀態的事件。",
    "- 不可直接打 BI API 取得測試結果。",
    "- 不可在一段 helper 中跑多個 case。helper 只能服務當前 case 的單一操作片段。",
    "- 每個 case 完成後必須先寫入結果與 evidence,再讀下一個 case。",
    "",
    "## 安全讀取",
    "",
    "- 可用 Playwright snapshot/DOM read 確認 UI 狀態。",
    "- 可用 read-only `page.evaluate` 讀 DOM、Chart.js data、network performance entries。",
    "- 讀取不等於 evidence 通過；PASS/FAIL 仍需當前 run 的 UI 操作或觀察鏈。",
    "- Evidence 優先順序: DOM/form state > network observation > chart/table data > screenshot。",
    "- Helper 可用 state delta planner 減少重複設定，但只能跳過已由 visible UI / DOM value 驗證對齊的項目；讀不到或不確定就操作 UI 或 BLOCKED。",
    "- Helper report 必須包含 runId / caseId / action / timestamp / currentRunEvidence metadata，否則 Codex 不可引用。",
    "- Screenshot 用於 Tool Bridge、FAIL/bug、重大狀態轉換、final evidence；bug 若無 screenshot 必須寫明原因。",
    "- 若 DOM/network evidence 已足以支撐 PASS/FAIL，但 screenshot timeout，不可反覆重試 full-page screenshot；最多改試一次較小 viewport/element screenshot。仍失敗就記 `screenshot_unavailable_reason` 並繼續寫結構化 evidence。",
    "",
    "## 常見操作節奏",
    "",
    "### 開啟專案",
    "",
    "1. 先 snapshot 左側 sidebar。",
    "2. 依 testcase 目標模式展開 `我的自訂 > 拼貼模式 / 明細檢視 / 指標趨勢`。",
    "3. 點擊目標專案後重新 snapshot,確認右側出現專案標題或報表列表。",
    "",
    "### 新增欄位",
    "",
    "1. 點 visible `+ 新增欄位` / `+ 選擇主欄位`。",
    "2. 在 visible dropdown/list 裡選 testcase 指定欄位。",
    "3. 重新讀 DOM,確認欄位列文字或 select value 已變成目標欄位。",
    "",
    "### 設定時間",
    "",
    "1. 點時間按鈕,用 UI 選擇 testcase 指定區間或日期。",
    "2. 點確認後重新讀按鈕文字。",
    "3. 如果按鈕文字與狀態清理 checklist 逐字不符,不可假設等價,必須修正或 BLOCKED。",
    "",
    "### 執行與驗證",
    "",
    "1. 按 `執行 / 查詢 / 搜尋` 後,讀 network performance 或頁面結果確認有新的 preview/request/圖表變化。",
    "2. 沒有新的 request 或 DOM/chart 證據時,不要宣稱已執行成功。",
    "3. 結果判定需符合 testcase 的測試標的與 evidence policy。",
    "4. 截圖是人類佐證,不是唯一 evidence；能用結構化資料比對時優先用結構化資料。",
    "5. Metadata/dropdown observation case 以 DOM extraction 的欄位清單與 count 為主 evidence；screenshot 只作輔助,不可因截圖 timeout 阻塞已取得的結構化結論。",
    "",
    "### 儲存/刪除/原生 Dialog",
    "",
    "1. 儲存、刪除、接受 native alert/confirm 前,先輸出 Tool Bridge request。",
    "2. 未收到本 run 的 Tool Bridge response 前不可處理 dialog；非 SSO/login request 由 Mac Agent 自動 deliver response。",
    "3. 儲存新報表要用 timestamped 臨時名稱,不可覆蓋既有主測試資源。",
    "",
    "## One Case Guard",
    "",
    "此 guidance 不允許加速成批次執行。若當前 case 需要下一個 case 的互補資料,只能讀下一個 case 的 JSON 做判斷依據；正式 UI 操作仍必須逐 case 執行、逐 case 寫入結果。",
    ""
  ].join("\n");
  fs.writeFileSync(filePath, content);
  return filePath;
};
