# M1 Verification Runbook

This runbook lists the repeatable checks for the Mac Agent / Domain Pack path.

For daily operation, see `docs/refactor/M1_Mac_Agent_MVP_Runbook.md`.

## Tool Bridge Parser

Run after changing:
- `src/agent-protocol/tool-bridge.ts`
- `agent/src/tool-bridge.ts`
- Tool Bridge prompt format

Command:

```bash
npm run verify:tool-bridge
```

Expected result:

```text
Tool Bridge parser fixtures passed: 20/20
```

## Agent Roundtrip Smoke

Run after changing:
- `src/runs.ts`
- `src/domains.ts`
- `src/agent/*`
- `agent/src/*`
- approval / tool response behavior

Command:

```bash
npm run verify:agent-roundtrip
```

What it validates:
- Builds `dist/server.js`.
- Starts a temporary API server with isolated SQLite and storage.
- Verifies BI Domain Pack endpoints.
- Creates a run and agent token.
- Connects a fake WebSocket agent.
- Sends `run.tool_request`.
- Confirms a pending approval is created.
- Calls `/api/runs/:id/approve`.
- Confirms the fake agent receives `tool_response`.
- Confirms pending approvals return to zero and run status becomes `RUNNING`.
- Confirms agent socket disconnect marks the active run as `FAILED` with `run.interrupted`.
- Confirms heartbeat timeout removes stale agents and marks the active run as `FAILED`.
- Confirms `agent.online` with `run_snapshot` is recorded as event/log for reconnect diagnostics.

Expected result:

```text
Agent roundtrip smoke passed.
```

The script creates temporary data under the OS temp directory and removes it after the run.

## Launchd Agent Dry Run

Run after changing:
- `agent/src/cli.ts`
- `agent/src/launchd.ts`
- agent packaging / CLI entrypoint

Commands:

```bash
npm run build --prefix agent
node agent/dist/cli.js install-launchd --no-load
test -f "$HOME/Library/LaunchAgents/com.tommy.uat-agent.plist"
node agent/dist/cli.js uninstall-launchd
```

Expected result:
- `install-launchd --no-load` writes the plist but does not load it.
- The plist uses `node agent/dist/cli.js start`.
- `uninstall-launchd` removes the plist. `launchctl bootout` may return a non-zero status if the service was never loaded; that is acceptable for the dry run.

To actually enable the background agent after `uat-agent login`:

```bash
node agent/dist/cli.js install-launchd
```

## Production Mac Agent Smoke

Run after changing:
- `Dockerfile`
- `domain-packs/*`
- Railway deployment settings
- `src/runs.ts`
- `src/agent/*`
- `agent/src/*`
- Vercel `VITE_API_BASE_URL`

Prerequisites:
- Railway service has `AGENT_BOOTSTRAP_SECRET` configured.
- Vercel frontend points to `https://testtool-production.up.railway.app`.
- Local agent is logged in to `wss://testtool-production.up.railway.app/agent-ws`.
- One `node agent/dist/cli.js start` process is running.

Checks:

```bash
curl -s https://testtool-production.up.railway.app/api/domains | jq
curl -s https://testtool-production.up.railway.app/api/agents | jq
```

Expected:
- `api/domains` includes `BI` with `valid: true`.
- `api/agents` includes `Tommy Mac` with `status: idle`.
- Agent doctor includes `codex-workspace-root: PASS` and `codex-workspace-agents: PASS`.

Verified smoke runs on 2026-04-27:

| Round ID | Purpose | Expected |
|---|---|---|
| `M1_SMOKE_20260427_183053` | Agent receives cloud dispatch without uploaded testcase package | `SUCCEEDED`, one `AGENT-RESULT / PASS`, log and result xlsx uploaded |
| `M1_UI_SMOKE_20260427_183807` | Agent receives uploaded xlsx/md package, downloads inputs, runs Codex, uploads result xlsx/log, Railway ingests result | `SUCCEEDED`, one `M1-UI-SMOKE-01 / PASS`, Vercel UI shows result xlsx and agent log available |

Important notes:
- The smoke instruction intentionally says not to operate Galaxy BI. This verifies the cloud-to-Mac closed loop, not real BI UI automation.
- In-app Browser currently does not support file uploads, so UI file picker verification must be manual or done through another browser automation surface.
- `POST /api/agents/:id/dispatch-smoke` requires `AGENT_BOOTSTRAP_SECRET`; do not expose this endpoint publicly without the secret.
- New real UAT dispatches should no longer use the smoke-only startup instruction. The agent now lets spawned Codex create `output/result.xlsx`; if absent, it falls back to a one-row summary result.

## Production Auth Smoke

Before setting `AUTH_REQUIRED=true`, make sure GitHub OAuth env vars are present in Railway:

```bash
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
GITHUB_OAUTH_CALLBACK_URL
SESSION_SECRET
APP_ORIGIN
```

Expected unauthenticated behavior after enabling auth:

```bash
curl -i https://testtool-production.up.railway.app/api/auth/me
curl -i https://testtool-production.up.railway.app/api/runs/history
```

Both should return `401 UNAUTHENTICATED`.

Expected agent/admin exceptions:
- `POST /api/agents/tokens` still works only with `x-agent-bootstrap-token: $AGENT_BOOTSTRAP_SECRET`.
- Agent bearer token can read `/api/domains/BI/rules` and run input/output endpoints.
- Agent bearer token cannot read PM-facing `/api/agents`; that still requires GitHub session.
