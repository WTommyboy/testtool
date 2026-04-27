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

Expected result:

```text
Agent roundtrip smoke passed.
```

The script creates temporary data under the OS temp directory and removes it after the run.
