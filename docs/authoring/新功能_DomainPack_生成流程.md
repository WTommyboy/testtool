# 新功能 Domain Pack 生成流程

> 目的:把新功能導入 UAT Tool 時,避免每次都靠臨場對話補規則。
> 本流程適用於從既有單一 domain 走向多 domain-pack 的工作。

---

## 1. 產出物總覽

每個新功能 domain-pack 至少要產出三類檔案:

### 1.0 固定樣板

先從樣板複製,再填入本功能內容:

- `docs/authoring/domain-pack-templates/domain_intake_template.md`
- `docs/authoring/domain-pack-templates/boundary_rules_template.md`
- `docs/authoring/domain-pack-templates/claude_testcase_request_template.md`
- `docs/authoring/domain-pack-templates/domain_pack_completion_checklist.md`

### 1.1 Intake / 出題資料包

放在專案資料區,用來給 PM / Claude / Codex 對齊功能邊界。

建議檔案:

- `domain_intake_draft.md`
- `<功能>_Claude出題指令.md`
- `<功能>_邊界規則.md`
- `Claude_<功能>_testcase建立_提供檔案清單.md`

### 1.2 UAT Tool domain pack

放在:

```text
uat-tool/domain-packs/<DOMAIN_PACK_NAME>/
```

必要檔案:

- `AGENTS.md`
- `xlsx_schema.json`
- `result_parser_adapter.json`
- `startup_prompt_template.md`

建議檔案:

- `README.md`
- `locators/README.md`
- `locators/demo001-locator-registry.json`
- `ui-contract.json`
- `action-contracts/<action>.json`
- `evidence-schema.json`
- `lint-rules.json`
- `discovery/page-map.json`
- `discovery/component-inventory.json`

### 1.3 共用規則 / domain common 規則

若新功能暴露出通用規則,要放到較上層,不要塞進單一 domain-pack:

- 跨所有 domain 共用:`uat-tool/docs/authoring/UAT_三文件撰寫規則_vNext_共用草稿.md`
- BI 三模式共用:`BI_TEST_RULES/BI_UAT_三文件撰寫補充規則.md`
- 單一功能特殊規則:`uat-tool/domain-packs/<DOMAIN_PACK_NAME>/AGENTS.md` 或專案資料區的 `<功能>_邊界規則.md`

---

## 2. 標準流程

### 2.0 角色分工

| 角色 | 負責內容 | 不負責內容 |
| --- | --- | --- |
| PM / Tommy | 提供 PRD、UI 參考、舊測試包、規格優先序、資源風險決策 | 不需要手寫 domain pack loader 檔 |
| Codex | 整理 intake、拆規則層級、建立 domain pack、補流程文件、做 dev push / smoke | 不自行決定高風險產品規則,不替 PM 授權刪除 |
| Claude | 依 intake / PRD / 邊界規則產出 UAT 三文件 | 不建立工具 domain pack,不改 UAT Tool runtime |
| UAT Tool / Agent | 載入 domain pack、派工、執行 testcase、收斂 result | 不從 chat 記憶推測缺漏規則 |

交付順序:

1. PM 提供素材。
2. Codex 產出 / 補齊 intake 與 domain pack。
3. Claude 產生 testcase 三文件。
4. Codex / Tool 做 package consistency 與 dev smoke。
5. 通過 dev 後才考慮 prod promote。

### Phase 0:判斷是否需要新 domain pack

符合任一條件,就應傾向建立新 domain pack,而不是把規則塞進既有 pack:

- 功能使用不同 UI 或不同入口。
- 同一資料邏輯改由正式 UI 驗收,導致 UI 狀態 / locator / evidence 規則明顯不同。
- 需要保留舊 case,但新增另一組 UI / flow case。
- 風險規則、不可逆操作、資源政策與既有功能不同。
- 執行前置、SSO、URL、租戶 / game / project 入口不同。

不應建立新 domain pack 的情況:

- 只是同一功能的小型 case 增補。
- 只是更新單輪 testcase 的輸入值。
- 規則完全可由本輪 `Codex_指派文字` 補充,且不會跨輪重用。

### Step 1:收集資料

PM 需提供:

- PRD。
- 正確 UI 截圖或設計稿。
- dev URL。
- 舊版 testcase / BDD / 既有測試包,若有。
- 哪些既有 case 要保留。
- 這次與上一版工具 / UI / testcase 的差異。
- 是否允許建立 / 修改 / 刪除測試資源。
- 是否需要 SSO 或特殊前置。

Codex / Agent 應輸出:

- `domain_intake_draft.md`
- 已知差異清單。
- 待 PM 決策問題。

Intake 不完整時,不要急著 scaffold tool pack。最多只能先做草稿,不得進入 dev smoke。

### Step 2:確認核心決策

至少確認:

- 規格優先序。
- 測試範圍。
- 文案比對標準。
- 是否保留舊 case。
- 是否允許建立 / 修改 / 刪除。
- 不可逆操作授權方式。
- dev/prod URL 與 SSO 前置。
- 測試資源命名規則。

決策確認後,寫回 intake,不要只留在 chat。

Gate:沒有完成核心決策前,Claude 不應正式產三文件;最多只能產群組規劃草稿。

### Step 3:拆規則層級

判斷每條規則應放在哪一層:

- 所有 domain 共用 -> 共用三文件規則。
- 同一產品 / 同一大 domain 共用 -> domain common 規則。
- 只有這個新功能適用 -> domain-pack 邊界規則。
- 只有本輪適用 -> `Codex_指派文字_*.md` 或 `測試執行說明_*.md`。

原則:

- 不複製整份大規則。
- 不把單輪特例寫進共用規則。
- 不讓 domain-pack 依賴 chat 記憶。

### Step 4:建立出題指令

建立 `<功能>_Claude出題指令.md`,至少包含:

- 任務目的。
- 必讀資料。
- 規格優先序。
- 原 case 保留 / 調整規則。
- 新增 case 群組建議。
- xlsx 欄位格式。
- 風險等級 / 測試標的使用方式。
- 輸出要求。
- 禁止事項。

### Step 5:建立工具 domain pack

在 `uat-tool/domain-packs/<DOMAIN_PACK_NAME>/` 建立:

可先用 scaffold 工具產生骨架:

```bash
cd /Users/tommy/Downloads/codex_galaxy/uat-tool
npm run create:domain-pack -- --name <DOMAIN_PACK_NAME> --display "<Display Name>" --scope "<One-line scope>"
```

#### `AGENTS.md`

內容需包含:

- domain scope。
- out-of-scope。
- 規格優先序。
- 固定前置。
- 資源建立 / 修改 / 刪除規則。
- UI / API / helper 禁止事項。
- evidence 規則。
- result writing contract。

#### `startup_prompt_template.md`

內容需包含:

- Agent 執行身份。
- startup checks。
- one-case-at-a-time contract。
- SSO / URL / env readiness。
- 不可逆操作處理。
- result workbook contract。

#### `xlsx_schema.json`

至少包含:

- schemaVersion。
- displayName。
- requiredSheets。
- resultSheets。
- caseNoColumnCandidates。
- detailJsonColumnCandidates。

可加 domainDefaults,但目前 loader 只把 JSON 提供給工具/agent,不會自動執行其中語意。

#### `result_parser_adapter.json`

沿用或調整 result parser contract:

- sheet 名稱。
- result headers。
- bug headers。
- detail_json required fields。

#### locator guidance

若 UI 操作複雜,可新增 locator registry。

目前 runtime 可讀的 legacy locator endpoint:

```text
locators/demo001-locator-registry.json
```

若新功能使用不同 locator 檔名,需要先改 domain loader / API / Agent download contract。UI / action / evidence contract 目前已支援固定 optional 檔名:`ui-contract.json`、`evidence-schema.json`、`lint-rules.json`、`discovery/page-map.json`、`discovery/component-inventory.json`,以及已接線的 `action-contracts/setMetricRows.json`。

#### UI / action / evidence contract

新 domain pack 不能只包含 prompt、xlsx schema 與 locator guidance。若該功能有正式 UI flow 或 helper automation,domain pack 應同步規劃 UI contract:

- page map:URL、入口、頁面狀態、modal/drawer/popover。
- component inventory:表格、row、picker、date panel、save/delete modal、toast。
- action contracts:例如 `setMetricRows`、`setDateRange`、`runPreview`、`saveReport`。
- params schema:例如 BI official collage 的 metric 必須是 `metrics[].sourceReport + metrics[].field`,不可只靠自然語言「加欄位 X」。
- evidence schema:每個 action 的 required / conditional evidence,包含 Tool Bridge response 何時才需要。
- lint rules:package consistency 應在跑測前擋掉 helper 無法執行的 testcase contract。

Discovery 產物應隨 domain pack lifecycle 管理。raw DOM / screenshots 只作 artifact;穩定來源是整理後的 UI / action / evidence contract。

詳見 planning: [domain-ui-contract-helper-gen3-gen4-plan.md](/Users/tommy/Downloads/codex_galaxy_dev/uat-tool/docs/planning/domain-ui-contract-helper-gen3-gen4-plan.md)。

### Step 6:本地驗證

最低驗證:

```bash
cd /Users/tommy/Downloads/codex_galaxy/uat-tool
npm run verify:domain-pack -- --name <DOMAIN_PACK_NAME>
npx tsx -e "import { listDomainPacks } from './src/domain-loader'; console.log(JSON.stringify(listDomainPacks(), null, 2))"
npm run typecheck
npm run build
git diff --check
```

若已有 testcase:

```bash
npm run check:package-consistency -- <testcase package args>
npm run verify:package-consistency
```

若有 Agent flow:

```bash
npm run verify:capability-gate
npm run verify:helper-hints
npm run verify:result-evidence-gate
```

### Step 7:dev branch / dev 環境 smoke

新 domain pack 第一次不要直接上 prod。

建議流程:

1. commit 到 dev branch。
2. push dev。
3. dev 環境確認 `/api/domains` 看得到新 domain pack。
4. 建一份最小 smoke testcase,只跑 1-3 題低風險觀察 case。
5. 確認 Mac Agent 能下載:
   - `domain_AGENTS.md`
   - `domain_xlsx_schema.json`
   - `domain_result_parser_adapter.json`
   - `domain_startup_prompt_template.md`
   - locator registry,若有。
6. 確認 result workbook 可被 parser ingest。

Gate:dev `/api/domains` 沒看到新 pack 之前,Claude 產出的 testcase 不應送正式 run;最多只做檔案審查。

### Step 8:prod promote

只有 dev smoke 通過後才 promote prod。

prod 前檢查:

- domain pack 在 `/api/domains` 可見。
- startup template 正確。
- schema / adapter 正確。
- SSO 前置清楚。
- 不可逆操作仍需 Tool Bridge / Tommy 授權。
- 測試包 package consistency 沒有 error。

---

## 3. 新功能 Domain Pack Checklist

### Intake

- [ ] PRD 已提供。
- [ ] UI 截圖或設計稿已提供。
- [ ] dev URL 已提供。
- [ ] 舊 testcase 已確認保留 / 不保留範圍。
- [ ] 規格優先序已確認。
- [ ] 文案比對標準已確認。
- [ ] 建立 / 修改 / 刪除資源規則已確認。
- [ ] SSO / 環境前置已確認。

### 出題資料包

- [ ] `domain_intake_draft.md`
- [ ] `<功能>_邊界規則.md`
- [ ] `<功能>_Claude出題指令.md`
- [ ] `Claude_<功能>_testcase建立_提供檔案清單.md`

### Tool domain pack

- [ ] `uat-tool/domain-packs/<DOMAIN>/README.md`
- [ ] `uat-tool/domain-packs/<DOMAIN>/AGENTS.md`
- [ ] `uat-tool/domain-packs/<DOMAIN>/startup_prompt_template.md`
- [ ] `uat-tool/domain-packs/<DOMAIN>/xlsx_schema.json`
- [ ] `uat-tool/domain-packs/<DOMAIN>/result_parser_adapter.json`
- [ ] locator guidance,若需要。

### 驗證

- [ ] domain loader 看得到新 pack。
- [ ] `npm run typecheck` 通過。
- [ ] `npm run build` 通過。
- [ ] `git diff --check` 通過。
- [ ] dev `/api/domains` 看得到新 pack。
- [ ] 最小 smoke testcase 可派工。
- [ ] result workbook 可 ingest。

---

## 4. 可工具化方向

目前已有最小 scaffold / verify command:

```bash
npm run create:domain-pack -- --name BI_OFFICIAL_UI_COLLAGE --display "Galaxy BI Official UI Collage"
npm run verify:domain-pack -- --name BI_OFFICIAL_UI_COLLAGE
```

目前 scaffold 會自動產生:

- domain pack 目錄。
- required four files。
- README。
- locator README。
- placeholder locator registry。

目前 verify 會檢查:

- required files 是否存在。
- schema JSON 是否可解析。
- adapter JSON 是否有必填欄位。
- startup prompt 是否提到 one-case-at-a-time。
- AGENTS 是否提到 scope、out-of-scope、irreversible actions。
- locator registry 是否可解析,若存在。

後續可再加強:

- 從 intake 自動生成 domain pack skeleton。
- 從 domain pack 自動生成 Claude request 草稿。
- 檢查 Claude 產出的 xlsx 是否符合 domain boundary。
- 建立 1-3 題最小 smoke package。
- 自動查 dev `/api/domains` 與 domain endpoints。
