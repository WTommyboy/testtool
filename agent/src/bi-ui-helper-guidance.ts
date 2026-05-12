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
    "用 DOM read 擷取 visible list、來源群組、欄位名稱與 count；若 picker 內有多個 source group，正式比較只限 testcase 指定來源群組。",
    "A-03 類 case 可使用 `collage.extractMetadataDropdownFields` helper 收集 current-run evidence；Codex 仍需自行判斷 PASS/FAIL/BLOCKED。",
    "需要 metadata 對照時優先讀 `rules/BI_DATA/metadata.csv`；並用 `input/reference-index.json` 的 `bi_metadata_csv` 或 testcase 指定來源檔名確認來源，不可打 BI API 補清單。"
  ],
  collage_build_preview_save_reopen: [
    "建立拼貼報表時，每次新增欄位/條件後立刻用 DOM 或 snapshot 驗證狀態。",
    "preview 後以 network/chart/table evidence 證明本次 UI action 有生效。",
    "儲存、重開、刪除臨時報表若涉及 irreversible/native dialog，Agent 模式必須先走 Tool Bridge；核准後 helper 只可處理已知 BI save dialog。",
    "`collage.saveReport` 應在儲存後預設補 `reportListEvidence`，包含返回清單 readiness、saved report row 是否找到、row text 與 recovery attempts；testcase 不需要額外要求 helper 才做。"
  ],
  record_static_fields_date_payload: [
    "用 UI 進入明細模式並設定指定靜態欄位與日期。",
    "按執行後讀取本次 UI 觸發的 request body，確認 dateRange 與欄位 payload。",
    "只觀察 request/response，不可直接呼叫同一 API 取得資料。"
  ],
  metric_date_display_preview: [
    "用 UI 設定時間區間與顯示方式，設定後讀按鈕文字/select value 逐字驗證。",
    "日期題必須產出 date UI evidence：包含 testcase 要求 label、UI 正規化 label、目前日期按鈕文字，以及可見或依 baseDate 計算出的代表起訖日期。",
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
  collage_all_zero_field_inspection: [
    "此模板用於 A-06 類「列出全 0 欄位清單」case；helper 只產生 all-zero evidence，不判 PASS/FAIL。",
    "欄位全選必須來自 structured params：`selectAllFields` / `selectAllFieldsInSourceReport`、`sourceReports` 或 `sourceReport`、`expectedFieldCount`；不可把「全選 72 欄」當 UI 文字點擊。",
    "helper 會透過 visible UI 逐欄選取、設定日期與顯示方式，按 `執行` 前先驗證 selected metric field count > 0。",
    "輸出 `all-zero-field-inspection-evidence.json`，包含 selected field labels/codes、request/response observation、chart/table summaries 與全 0 候選欄位。Codex 仍需依 testcase 判定。"
  ],
  download_csv_verify: [
    "下載必須由 UI 操作觸發。",
    "下載成功後可用本地 CSV parser 檢查檔名、表頭、row count、aggregate；Agent 可以讀 UI 下載到本機的檔案。",
    "A-04 類 case 若 testcase 指定從專案/報表清單下載，helper 應鎖定本輪 saved report row 的 CSV/下載控制並比對儲存前 preview evidence，不需重開 editor。",
    "不可用 API 直接產生 CSV 取代 UI 下載；不可把 Google Sheet 開檔流程當正式 evidence；若儲存/清單/preview 前置已失敗，CSV 比對標 not reached，最終判定回到已失敗的必要子條件。"
  ],
  save_load_flow: [
    "儲存前確認是本輪臨時資源名稱，不覆蓋既有主資源。",
    "Agent 模式遇到 native alert/confirm 或不可逆操作需 Tool Bridge response；非 SSO/login request 會由 Mac Agent 依 policy 自動回覆。",
    "save/load 類 case 優先引用 `reportListEvidence.found=true` 作清單 row evidence；若舊 helper 僅提供 save API 200、reportName、已知成功/返回 dialogs 與 current-run DOM/list signals，不可只因缺少該 key 就 BLOCK。",
    "重開後用 DOM/network/chart evidence 驗證設定真的還原；若 testcase 同時含 CSV 下載，設定還原失敗是主要功能流程結果，不可因後續 CSV 未達而改成 BLOCKED。"
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
    `- group_id: ${currentCase?.groupId ?? "(unavailable)"}`,
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
    "- 不可依賴 OS foreground window、active tab 或第一個 Galaxy tab；helper 必須綁定 `input/browser-session.json` 的 token marker。",
    "- 不可在一般 helper action 中把 Chrome 拉到前景；不得使用 `page.bringToFront()`、CDP activate 或 OS focus。",
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
    "- Helper report 應包含 browserSession / targetBinding / foregroundPolicy evidence；若 marker 缺失或不一致，回 `BROWSER_SESSION_*` blocker，不可猜測其他 tab。",
    "- Helper executor 只能由 Mac Agent 執行；Codex 不可透過 shell command_execution 自行呼叫 helper executor 或連 CDP。",
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
    "1a. 若畫面仍顯示 `載入欄位中...`，先等待欄位清單完成載入；timeout 回 `FIELD_LIST_LOAD_TIMEOUT`，不可立刻判 `ADD_FIELD_BUTTON_NOT_CLICKABLE`。",
    "2. 若 testcase 欄位寫成 `A + B + C`,必須拆成多個欄位逐一點 `+ 新增欄位`、逐一選取,不可把整段 composite string 當成單一 clickable text。",
    "3. 在 visible dropdown/list 裡選 testcase 指定欄位。",
    "4. 重新讀 DOM,確認欄位列文字或 select value 已變成目標欄位；多欄位 case 必須逐欄驗證全部存在。",
    "",
    "### 設定時間",
    "",
    "1. 點時間按鈕,用 UI 選擇 testcase 指定區間或日期。",
    "2. 點確認後重新讀按鈕文字。",
    "3. 如果按鈕文字與狀態清理 checklist 逐字不符,不可假設等價,必須修正或 BLOCKED。",
    "4. 日期 case 需保留 `date-ui-evidence.json` 或同等 detail_json 欄位,寫明 UI label 與其代表日期區間；若 UI 只顯示 preset label,必須標明代表區間是依 baseDate 計算,不是直接從畫面讀到。",
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
    "2. 未收到本 run 的 Tool Bridge response 前不可處理 dialog；非 SSO/login request 由 Mac Agent 自動 deliver response。收到 response 後，helper 可處理已知 BI save success / overwrite / return-to-list dialog。",
    "3. 若遇到未知 dialog 且沒有實際 recovery handler,helper 應直接 blocked 並留下 dialog evidence,不可發 recovery 後又立刻 skipped。",
    "4. 儲存新報表要用 timestamped 臨時名稱,不可覆蓋既有主測試資源；修改既有報表 case 只能覆寫本輪前置 case 建立的臨時報表。",
    "",
    "### 下載 CSV",
    "",
    "1. 下載 CSV 是合法輸出,不需 Tool Bridge。",
    "2. CSV helper 只可由 visible UI 點擊下載,不可直接打 BI API。",
    "3. 下載後讀回 CSV row count / numeric series,與本 case preview table/chart evidence 比對；helper 只提供 evidence,不直接判 PASS/FAIL。",
    "4. 若 browser download event 未觸發,但同一次 visible UI click 產生 CSV/attachment response,helper 可保存該 UI-triggered response body 作 CSV evidence 並標示 downloadedCsv.source。",
    "5. 若重開後欄位、日期或 preview 已消失，記錄前置失敗與當前 DOM state；Codex 應先判斷該必要子條件是否已構成 FAIL，再把 CSV 比對記為 not reached。",
    "6. 若 testcase 指定從專案/報表清單下載 CSV，helper 應使用本輪儲存報表名稱定位 row/list control；若 save 後清單 stale,先刷新/重定位,再用儲存前 preview evidence 比對；不需要為 CSV case 重開 editor。",
    "7. 若 helper plan 已列出 save/reopen/download actions 或 save/download actions，不可在只完成 preview 後直接判 `BLOCKED/EVIDENCE_INSUFFICIENT`；需先要求 Tool Bridge/continuation 或明確記錄已失敗的必要子條件。",
    "8. Google Sheet 只可作人工探索 fallback，不作正式 UAT evidence 主路徑。",
    "",
    "### Metadata 對照",
    "",
    "1. Metadata/dropdown case 必須使用 run packet 的 canonical reference：`rules/BI_DATA/metadata.csv`。",
    "2. 若 testcase 寫原始檔名（例如 `metadata＿1.2.5 - 工作表1.csv`），用該檔名與 `input/reference-index.json` 的 `bi_metadata_csv` 確認來源；不要 broad-read 所有 reference CSV 來猜測。",
    "3. 若 capability gate 顯示 helper supported，優先讀 `output/helper-artifacts/<case>/metadata-dropdown-evidence.json`；該 helper 只抽 current-run DOM list 與 metadata expected list，不判 testcase 結果。",
    "4. detail_json 需列 reference_csv、reference_source_name、reference_index_key、source_report、match_key、compare_fields、actualScope，以及命名正規化/已知命名差異後的缺少/多出清單；若有 exactMissingFields/exactExtraFields，也要保留供 PM 判讀。",
    "",
    "## One Case Guard",
    "",
    "此 guidance 不允許加速成批次執行。若當前 case 需要下一個 case 的互補資料,只能讀下一個 case 的 JSON 做判斷依據；正式 UI 操作仍必須逐 case 執行、逐 case 寫入結果。",
    ""
  ].join("\n");
  fs.writeFileSync(filePath, content);
  return filePath;
};
