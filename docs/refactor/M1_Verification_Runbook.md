# M1 Verification Runbook

This runbook lists the repeatable checks for the Mac Agent / Domain Pack path.

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
