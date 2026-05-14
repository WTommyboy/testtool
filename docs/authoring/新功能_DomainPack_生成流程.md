# 新功能 Domain Pack 生成流程

> 目的:把新功能導入 UAT Tool 時,避免每次都靠臨場對話補規則。
> 本流程適用於從既有單一 domain 走向多 domain-pack 的工作。

---

## 1. 產出物總覽

每個新功能 domain-pack 至少要產出三類檔案:

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

### 1.3 共用規則 / domain common 規則

若新功能暴露出通用規則,要放到較上層,不要塞進單一 domain-pack:

- 跨所有 domain 共用:`uat-tool/docs/authoring/UAT_三文件撰寫規則_vNext_共用草稿.md`
- BI 三模式共用:`BI_TEST_RULES/BI_UAT_三文件撰寫補充規則.md`
- 單一功能特殊規則:`uat-tool/domain-packs/<DOMAIN_PACK_NAME>/AGENTS.md` 或專案資料區的 `<功能>_邊界規則.md`

---

## 2. 標準流程

### Step 1:收集資料

PM 需提供:

- PRD。
- 正確 UI 截圖或設計稿。
- dev URL。
- 舊版 testcase / BDD / 既有測試包,若有。
- 哪些既有 case 要保留。
- 是否允許建立 / 修改 / 刪除測試資源。
- 是否需要 SSO 或特殊前置。

Codex / Agent 應輸出:

- `domain_intake_draft.md`
- 已知差異清單。
- 待 PM 決策問題。

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

注意:MVP endpoint 目前只讀:

```text
locators/demo001-locator-registry.json
```

若新功能使用不同檔名,需要先改 domain loader / API / Agent download contract。

### Step 6:本地驗證

最低驗證:

```bash
cd /Users/tommy/Downloads/codex_galaxy/uat-tool
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

未來可新增 scaffold command:

```bash
npm run create:domain-pack -- --name BI_OFFICIAL_UI_COLLAGE --display "Galaxy BI Official UI Collage" --base BI
```

工具應自動產生:

- domain pack 目錄。
- required four files。
- README。
- locator README。
- authoring checklist。
- validation command output。

工具也可檢查:

- required files 是否存在。
- schema JSON 是否可解析。
- adapter JSON 是否有必填欄位。
- startup prompt 是否提到 one-case-at-a-time。
- AGENTS 是否提到 scope、out-of-scope、irreversible actions。
- domain loader 是否能列出該 pack。

目前本流程先以文件化與手動 scaffold 為準,等第二個 domain pack 穩定後再考慮實作 CLI。
