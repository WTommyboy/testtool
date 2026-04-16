# UAT Tool (MVP Bootstrap)

## Quick Start

```bash
cp .env.example .env
npm install
npx playwright install chromium
npm run dev
```

API will start at `http://localhost:3000`.

## Railway Deployment Note (Playwright)

- `postinstall` 會自動執行 `playwright install chromium`
- Docker 部署時請勿設定 `PLAYWRIGHT_BROWSERS_PATH=0`（會改走 `node_modules/.local-browsers`）
- 建議設定 `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` 或直接留空（Dockerfile 已內建）
- 專案已提供 `nixpacks.toml`，會安裝 Playwright Chromium 需要的 Linux 套件（含 `libglib2.0-0`）
- 若 Railway 仍報 `libglib-2.0.so.0` 缺失，請改用專案內 `Dockerfile` 部署（基底為官方 Playwright image）

若仍出現 browser executable 不存在，請在 Railway 重新部署一次（Clear build cache 後再 Deploy）。
若錯誤包含 `error while loading shared libraries`，請確認 Railway 已使用新的 `nixpacks.toml` 重新建置（建議重新部署並清除快取）。

## XLSX Import

Current import endpoint accepts local absolute path:

```bash
curl -X POST http://localhost:3000/api/runs/<runId>/import-xlsx \
  -H "Content-Type: application/json" \
  -d '{"filePath":"/Users/you/Downloads/DEV_UAT_測試案例_v3.3.xlsx"}'
```

Supported sheets:
- `測試案例` (required)
- `步驟` (optional; if missing, parser can fallback to `測試案例` sheet's `步驟` column)

## Runner Notes

- `POST /api/runs/:id/start` will execute `auto/semi` cases.
- If a step has `requireApproval=true`, run moves to `WAITING_APPROVAL` and creates an approval record.
- Resolve it with `POST /api/runs/:id/approve`, then call `POST /api/runs/:id/start` again.
- Step-level retry and timeout are enforced by `retry` and `timeout_ms`.
- Implemented step actions: `goto`, `click`, `fill`, `select`, `press`, `waitFor`, `assertText`, `screenshot`, `download`, `upload`, `runScript`, `assertData`, `compareCSV`.

## Implemented Endpoints

- `GET /health`
- `GET /api/runs`
- `GET /api/runs/history`
- `POST /api/runs`
- `GET /api/runs/:id`
- `POST /api/runs/:id/cases`
- `POST /api/runs/:id/steps`
- `POST /api/runs/:id/import-xlsx`
- `POST /api/runs/:id/start`
- `POST /api/runs/:id/status`
- `POST /api/runs/:id/cancel`
- `POST /api/runs/:id/manual-fill`
- `POST /api/runs/:id/approve`
- `GET /api/runs/:id/cases`
- `GET /api/runs/:id/steps`
- `GET /api/runs/:id/approvals`
- `GET /api/runs/:id/summary`
- `GET /api/runs/:id/logs`

- `POST /api/conversations`
- `GET /api/conversations`
- `GET /api/conversations/:id`
- `POST /api/conversations/:id/messages`
- `POST /api/conversations/:id/export`
- `POST /api/conversations/:id/push-to-run`
- `DELETE /api/conversations/:id`
