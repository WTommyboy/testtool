# M1 Mac Agent MVP Runbook

This runbook describes how to use the Vercel UI + Railway API + local Mac Agent path.

## Architecture

- Vercel hosts the web UI.
- Railway hosts the API, SQLite database, storage volume, and `/agent-ws` WebSocket server.
- Tommy's Mac runs `uat-agent`, connects to Railway through WebSocket, and launches local Codex CLI when a run is dispatched.
- The old offline runner still exists for local/batch fallback, but the intended M1 path is `interactive` execution through Mac Agent.

## Production Auth Setup

Railway API supports GitHub OAuth for PM-facing routes. Configure these Railway env vars before enabling auth:

```bash
GITHUB_CLIENT_ID=<github-oauth-client-id>
GITHUB_CLIENT_SECRET=<github-oauth-client-secret>
GITHUB_OAUTH_CALLBACK_URL=https://testtool-production.up.railway.app/api/auth/github/callback
SESSION_SECRET=<long-random-secret>
APP_ORIGIN=https://testtool-eight.vercel.app
AUTH_REQUIRED=true
```

GitHub OAuth app callback URL must exactly match `GITHUB_OAUTH_CALLBACK_URL`.

Notes:
- Default allowed GitHub login is `WTommyboy`; override with `GITHUB_ALLOWED_LOGINS=WTommyboy,other-login`.
- Because Vercel and Railway are different domains, the frontend uses `credentials: include` and the API sets production cookies as `SameSite=None; Secure`.
- Agent token administration still requires `AGENT_BOOTSTRAP_SECRET`; GitHub session and agent bootstrap are separate trust paths.

## One-Time Local Agent Setup

Build the API and agent:

```bash
cd /Users/tommy/Downloads/codex_galaxy/uat-tool
npm install
npm run build
npm run build --prefix agent
```

Create an agent token from the API.

Railway must have `AGENT_BOOTSTRAP_SECRET` configured first. Keep this value private; it is only used to administer agent tokens.

```bash
printf "Paste AGENT_BOOTSTRAP_SECRET: "
read -rs AGENT_BOOTSTRAP_SECRET
printf "\n"

curl -s -X POST https://testtool-production.up.railway.app/api/agents/tokens \
  -H "Content-Type: application/json" \
  -H "x-agent-bootstrap-token: $AGENT_BOOTSTRAP_SECRET" \
  -d '{"deviceName":"Tommy Mac"}' | jq
```

Copy the returned `token`, then login locally:

```bash
node agent/dist/cli.js login \
  --server wss://testtool-production.up.railway.app/agent-ws \
  --token "<TOKEN_FROM_API>" \
  --device-name "Tommy Mac"
```

Check local prerequisites:

```bash
node agent/dist/cli.js status
node agent/dist/cli.js doctor
```

Doctor should pass for required checks before using interactive execution.

## Start Agent Manually

Use this while testing:

```bash
node agent/dist/cli.js start
```

Expected behavior:

- It prints JSON status logs.
- It reconnects automatically if the WebSocket closes.
- If the Railway API detects a stale heartbeat, the active run is marked `FAILED` with `run.interrupted`.
- If the agent reconnects with a local unfinished run, it reports `run_snapshot` for diagnostics.

Verify from another terminal:

```bash
curl -s https://testtool-production.up.railway.app/api/agents | jq
```

You should see `"deviceName": "Tommy Mac"` and `"status": "idle"` before dispatching a run.

## Start Agent With Launchd

After local login and doctor pass:

```bash
node agent/dist/cli.js install-launchd
```

Logs:

```bash
tail -f ~/.uat-agent/logs/launchd.out.log
tail -f ~/.uat-agent/logs/launchd.err.log
```

Disable launchd:

```bash
node agent/dist/cli.js uninstall-launchd
```

Dry-run verification without loading the service:

```bash
npm run build --prefix agent
node agent/dist/cli.js install-launchd --no-load
test -f "$HOME/Library/LaunchAgents/com.tommy.uat-agent.plist"
node agent/dist/cli.js uninstall-launchd
```

## Run From Web UI

1. Open the Vercel UI.
2. Go to `測試執行`.
3. Set `執行模式` to `Agent 互動執行（推薦）`.
4. Select an idle Agent, normally `Tommy Mac`.
5. Upload testcase `.xlsx` and `.md`, and optionally baseline `.csv`.
6. Fill `輪次 ID`, `位置`, `功能主項`, `功能細項`, `輪次名稱`, and `Dev URL`.
7. Click `開始執行`.

The UI blocks dispatch if:

- No Agent is online.
- The selected Agent is busy.
- Agent doctor failed.
- The selected Agent does not declare `uat_run` or `interactive` support.

If a run was created but remains `READY`, select it and click `派發目前 Run`.

## Human-In-The-Loop Flow

If local Codex emits a Tool Bridge request:

- Railway creates a pending approval.
- UI shows it under `等待人工處理`.
- Tommy handles the action manually, then clicks `已處理，繼續執行`.
- API sends `tool_response` back to the selected Agent.
- Agent resumes the Codex thread from the paused point.

## Result Flow

The Agent writes local files under:

```text
~/.uat-agent/runs/<runId>/
```

Expected output files:

- `input/dispatch.json`
- `input/downloaded-inputs.json`
- `output/result.xlsx`
- `output/agent.log`
- `output/codex-result.json`
- `output/tool-requests.json` when approval is required

Agent uploads:

- `result.xlsx` to `/api/runs/:id/output/result-xlsx`
- `agent.log` to `/api/runs/:id/output/log`

The API ingests result xlsx into run cases, bugs, logs, and summary views.

## Verification Commands

Run all local checks before pushing:

```bash
npm run verify:all
```

Individual checks:

```bash
npm run verify:tool-bridge
npm run verify:agent-roundtrip
npm run build --prefix web
npm run build --prefix agent
```

`verify:agent-roundtrip` covers:

- Domain Pack endpoints.
- Agent token creation.
- WebSocket fake agent connection.
- Tool Bridge approval roundtrip.
- Agent socket disconnect handling.
- Agent heartbeat timeout handling.
- Agent reconnect `run_snapshot` recording.

## Current MVP Limits

- Run status still uses the existing runtime statuses such as `READY`, `RUNNING`, `WAITING_APPROVAL`, `SUCCEEDED`, `FAILED`, and `CANCELLED`. The canonical status migration in the planning docs is not complete yet.
- `run_snapshot` is diagnostic only. It does not automatically resume or re-dispatch an interrupted run.
- Launchd support assumes macOS and a built local `agent/dist/cli.js`.
- GitHub OAuth is planned but not completed in this MVP slice.
- Artifact table is still an M2 item. Current result and log files are stored through existing run output fields.
- `POST /api/agents/:id/dispatch-smoke` and `/api/agents/tokens` require `AGENT_BOOTSTRAP_SECRET`. Normal UI run dispatch still depends on the planned GitHub OAuth layer for production access control.
