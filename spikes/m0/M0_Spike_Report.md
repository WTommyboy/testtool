# M0 Spike Report

**Status**:completed with open gates  
**Scope**:M0-1 to M0-7 feasibility validation before M1 implementation.

## Executive Summary

M0 proves the proposed architecture is technically viable:

- Codex control should use `codex exec --json` + `codex exec resume --json <thread_id>`.
- Tool Bridge marker output is stable enough for M1.
- WebSocket fake agent flow is viable.
- Result xlsx ingestion is viable.
- Full fake E2E flow reaches `COMPLETED`.

Open gates before full M1.1/M1.2 completion:

1. M0-4 real Railway/Postgres migration is still **SKIPPED** because no `M0_DATABASE_URL` / `DATABASE_URL` was available.
2. M0-5 real Galaxy SSO 24h persistence is still **SKIPPED** because M0 cannot automate company login; it must be verified manually with the persistent Chrome profile.

This report is intentionally structured. Each spike must record:

1. Adopted approach.
2. Validation process.
3. PASS / FAIL / PARTIAL verdict.
4. Impact on `UAT_Tool_M1_完整實作Spec_v1.md`.
5. Impact on `UAT_Tool_重構規劃書_v2_4_1.md`.
6. Fallback plan if the same risk appears again.

---

## M0-1 Codex CLI Subprocess / PTY Control

### Goal

Determine how `uat-tool-agent` should control Codex CLI:

| Candidate | Purpose |
|---|---|
| `codex exec --json` | Non-interactive JSONL execution |
| direct spawn | Spawn interactive Codex without a PTY |
| PTY / TTY | Run Codex under a real terminal, then inject prompts/responses |

### Validation Script

```bash
node spikes/m0/codex-control/run-spike.mjs
```

The script writes output under:

```text
spikes/m0/codex-control/output/<timestamp>/
```

### Result Summary

Run directory:

```text
spikes/m0/codex-control/output/2026-04-26T16-33-02-131Z/
```

Summary:

| Candidate | Result | Evidence |
|---|---|---|
| `codex exec --json` | PASS | Returned JSONL events and final assistant message `M0_EXEC_JSON_OK` |
| `codex exec resume --json <thread_id>` | PASS | First turn remembered token `ZEBRA_427`; second turn resumed same thread and returned `M0_EXEC_RESUME_SECOND_OK` |
| `codex exec --json` SIGTERM | PASS | Process stopped within ~1s after SIGTERM; JSONL had `turn.started` but no `turn.completed`, confirming interruption |
| direct spawn without TTY | FAIL | Codex exits with `Error: stdin is not a terminal` |
| PTY via `expect` | FAIL | Codex interactive TUI emits terminal capability queries and exits/EOFs; `expect` is not a full terminal emulator |

### Comparison Table

| Candidate | Launch | stdout complete | mid-run stdin / second turn | SIGTERM cleanup | Complexity | Verdict |
|---|---|---|---|---|---|---|
| `codex exec --json` | PASS | PASS, structured JSONL | PARTIAL: no live stdin, but can continue via `exec resume` | PASS, terminates promptly | Low | Preferred base |
| `codex exec resume --json` | PASS | PASS, structured JSONL | PASS for turn-based continuation | PASS for short-lived process | Low-medium | Preferred human-loop mechanism |
| direct spawn | FAIL | N/A | FAIL | N/A | Low | Reject |
| PTY / TTY via `expect` | FAIL | N/A | FAIL in current PTY harness | Unknown | Medium-high | Reject for M1 |

### Impact on M1 Spec

M1.2 should implement `CodexRunner` around short-lived `codex exec --json` plus `codex exec resume --json <thread_id>`, not around a long-lived interactive TUI subprocess.

This changes the Tool Bridge model slightly:

1. A Codex turn may output `[TOOL_REQUEST]`.
2. The Agent forwards the request to Railway and waits.
3. When PM responds, Agent starts a new `codex exec resume --json <thread_id>` turn containing `[TOOL_RESPONSE]`.
4. Codex continues from conversation memory.

This is not true live stdin injection into a still-running process, but it is currently the most reliable route.

Open follow-up for M1.2: verify whether Playwright MCP / browser session state survives acceptably across `exec resume` turns. If not, Codex must be instructed to re-open the page and rely on persistent Chrome profile.

### Fallback

If `exec resume` later fails with real Playwright work:

1. Use one `codex exec --json` run per case or per case group.
2. Treat human-loop events as run pauses, not live continuation.
3. Resume by launching a new Codex turn with accumulated context and artifact paths.
4. If even resume is unreliable, downgrade Tool Bridge to final structured summary only and keep human approvals in normal Codex chat/manual workflow.

---

## M0-2 Tool Bridge Protocol Stability

### Goal

Verify that Codex can reliably emit Tool Bridge request blocks:

```text
[TOOL_REQUEST]
{ valid JSON }
[/TOOL_REQUEST]
```

Also verify that the Agent-side parser tolerates multiline JSON, ANSI/noise, malformed JSON, truncated output, and duplicate `request_id`.

### Validation Script

```bash
node spikes/m0/tool-bridge/run-spike.mjs --codex-count=20
```

The script writes output under:

```text
spikes/m0/tool-bridge/output/<timestamp>/
```

### Result Summary

Run directory:

```text
spikes/m0/tool-bridge/output/2026-04-26T16-37-45-273Z/
```

Summary:

| Check | Result | Evidence |
|---|---|---|
| Parser fixtures | PASS | Multiline JSON, ANSI/noise, invalid JSON, truncation, duplicate request_id all handled without crash |
| Codex output parse rate | PASS | 20 / 20 valid Tool Bridge requests parsed, parse rate 100% |
| `request_id` missing rate | PASS | 0 missing request_id |
| Duplicate request detection | PASS | Synthetic duplicate fixture emitted warning; 20 Codex runs had no duplicate request_id |
| Three request types | PASS | Covered `irreversible_operation`, `ambiguity_decision`, and `playwright_recovery` |

### Adopted Approach

M1.2 should implement a strict marker parser that:

1. Buffers output text.
2. Strips ANSI escape sequences before marker parsing.
3. Extracts complete `[TOOL_REQUEST] ... [/TOOL_REQUEST]` blocks.
4. Parses JSON only after a complete closing marker exists.
5. Validates request type schema.
6. Emits warnings for malformed/truncated/duplicate requests instead of crashing the Agent.

The prompt/header strategy is viable: when Codex receives an explicit `# Run Context` plus `AGENTS_TOOL_BRIDGE_SPIKE.md` rules, it consistently returns exactly one parseable Tool Bridge block.

### Impact on M1 Spec

M1.2 Tool Bridge can proceed as planned with two adjustments:

1. Implement `agent/src/toolBridge/parser.ts` as a standalone, unit-tested module before wiring it to `CodexRunner`.
2. Keep the protocol prompt strict: standalone markers, valid JSON, no Markdown fences, no prose around the block.

M1.2 only needs production support for `irreversible_operation`, but the parser should already accept/validate all three canonical types because M0-2 proved the schema is stable.

### Impact on Planning Document

No direction change. M0-2 passes the original threshold:

- Parseable format rate >= 90%: actual 100%.
- Missing `request_id` rate = 0: actual 0.
- Parser does not crash on bad format: confirmed.
- Duplicate `request_id` detectable: confirmed by fixture.

### Fallback

If production Codex output later becomes inconsistent:

1. Reject malformed blocks at parser level and write `run.warning`.
2. Resume the Codex thread with a correction prompt containing the parser error.
3. If a second malformed block occurs in the same request, pause the run and surface the raw output to PM.
4. As a lower-risk fallback, require Tool Bridge output in final structured summary only for that run.

---

## M0-3 WebSocket Fake Agent

### Goal

Verify the cloud server ↔ Mac Agent WebSocket control loop:

1. Agent token validation.
2. `agent.online`, heartbeat, dispatch, ack, stdout, completed.
3. Sequence/id based dedupe for duplicate messages.
4. Reasonable status handling when an agent disconnects mid-run and reconnects.

### Validation Script

```bash
node spikes/m0/websocket-fake-agent/run-spike.mjs
```

The script starts an in-process fake Railway WebSocket server and a fake Mac Agent client using the same `ws` package planned for M1.

### Result Summary

Run directory:

```text
spikes/m0/websocket-fake-agent/output/2026-04-26T16-45-43-778Z/
```

Summary:

| Check | Result | Evidence |
|---|---|---|
| Agent token rejection | PASS | Bad token connection rejected with 401 |
| Agent connect / online | PASS | Server received `agent.online` with capability payload |
| Heartbeat | PASS | Server received `agent.heartbeat` |
| Dispatch + ack | PASS | `task.dispatch` acked and pending ack queue drained |
| Run event flow | PASS | `run.started` → `run.stdout` → `run.completed` completed for `run_m0_1` |
| Duplicate dispatch dedupe | PASS | Duplicate dispatch was acked but processed once; `run.started` count remained 1 |
| Agent disconnect handling | PASS | Disconnect during `run_m0_2` moved run state to `AGENT_LOST` |
| Reconnect + retry | PASS | Reconnected agent accepted redispatch and completed `run_m0_2` |

### Adopted Approach

M1.2 should use `ws` for both server and agent:

- Server: `WebSocketServer({ noServer: true })` behind Express/HTTP upgrade so the upgrade path can validate `Authorization: Bearer <token>`.
- Agent: `new WebSocket(url, { headers })` because browser-style global `WebSocket` cannot set the Authorization header.
- Every message should use an envelope with `id`, `seq`, `type`, `timestamp`, `ack_required`, and `payload`.
- Dedupe should be based on message `id`; task-level idempotency should also check `payload.run_id`.
- Acks should be tracked with a pending-ack map and retried in production.

### Impact on M1 Spec

M1.2 can proceed with the documented WebSocket protocol. Add/keep these production implementation details:

1. Use explicit HTTP upgrade handling for token rejection, not a normal CORS check.
2. Treat disconnect during `AGENT_RUNNING` as `AGENT_LOST`.
3. Redispatch after reconnect must be idempotent; a duplicate dispatch should not create duplicate run execution.
4. Keep ack tracking in memory for M1; persist/replay can be deferred to M2 unless M0-7 exposes a gap.

### Impact on Planning Document

No direction change. The fake agent validates the planned Mac Agent protocol shape.

### Fallback

If Railway production WebSocket behavior differs from local Node:

1. Add a Railway-deployed M0-3b check before M1.2.
2. If upgrade headers are stripped or unreliable, move agent token into a signed query param only for Agent WebSocket, with short expiry.
3. If long-lived WebSocket is unstable, keep Agent polling `/api/agent/tasks/next` as a fallback transport while preserving the same message envelope.

---

## M0-4 Postgres + Drizzle Schema

### Goal

Validate that the planned Postgres schema can support v2.4.1:

- `runs`
- `run_events`
- `run_case_results`
- `bugs`
- `agent_tokens`
- `user_sessions`

Also validate JSONB, GIN index, seed/query round-trip, and uniqueness constraints.

### Validation Script

```bash
node spikes/m0/postgres-drizzle/run-spike.mjs
```

The script uses PGlite for local Postgres-compatible execution and optionally runs the same migration against a real Postgres DB if `M0_DATABASE_URL` or `DATABASE_URL` is set.

### Result Summary

Run directory:

```text
spikes/m0/postgres-drizzle/output/2026-04-26T16-49-31-774Z/
```

Summary:

| Check | Result | Evidence |
|---|---|---|
| Local migration | PASS | PGlite executed all table/index DDL |
| JSONB | PASS | Inserted/query `baseline_data`, `payload`, and `detail_json` |
| GIN index | PASS | `run_events_payload_gin_idx` and `run_case_results_detail_gin_idx` created |
| Seed round-trip | PASS | Seeded one run + case result + event + bug + token + user session and queried joined row |
| Unique constraint | PASS | Duplicate `(run_id, case_no)` insert failed as expected |
| Real Postgres / Railway dev DB | SKIPPED | No `M0_DATABASE_URL` or `DATABASE_URL` available in local env |

### Verdict

**PARTIAL**.

The schema shape is viable locally, but M0-4 is not fully closed until the same migration is run against a real Railway/Postgres dev database.

### Adopted Approach

M1.1 should proceed with Drizzle + Postgres, but keep DB migration as an early M1.1 task and require a real `DATABASE_URL` before marking DB foundation complete.

Use these production decisions:

- `execution_mode` must be `interactive`.
- `runs.status` should use canonical v2.4.1 status values.
- `run_events.payload` and `run_case_results.detail_json` should be `jsonb`.
- Create GIN indexes on high-query JSONB fields.
- Use `(run_id, case_no)` unique index to prevent duplicated case rows.

### Impact on M1 Spec

No schema direction change, but M1.1 should add one concrete gate:

```text
Do not consider M1.1 DB complete until migration succeeds against Railway/Postgres, not only local PGlite.
```

The current spike script can be reused with:

```bash
M0_DATABASE_URL="<railway-dev-postgres-url>" node spikes/m0/postgres-drizzle/run-spike.mjs
```

### Impact on Planning Document

M0-4 remains partially open. This does not block continuing other M0 spikes, but it should block entering full M1.1 implementation unless Tommy provides/creates a Railway Postgres dev DB URL.

### Fallback

If Railway Postgres migration fails later:

1. Compare failing DDL against the `migration.sql` artifact from this spike.
2. Remove or adjust any PGlite-compatible-but-Postgres-incompatible syntax.
3. If GIN index creation is the only failure, create tables first and add GIN indexes in a second migration.
4. Do not fall back to SQLite for the refactor; SQLite was explicitly retired for this architecture.

---

## M0-5 SSO / Chrome Profile / Agent Doctor

### Goal

Validate the local Mac Agent doctor checks needed before interactive UAT execution:

- Node 20+.
- Codex CLI exists and can run `codex exec --json`.
- Agent workdir is writable.
- Chrome persistent profile directory is writable.
- Playwright can launch a persistent profile and preserve browser state across restarts.
- Identify what cannot be verified until M1.1/M1.2.

### Validation Script

```bash
node spikes/m0/agent-doctor/run-spike.mjs
```

### Result Summary

Run directory:

```text
spikes/m0/agent-doctor/output/2026-04-26T16-52-30-470Z/
```

Summary:

| Check | Result | Evidence |
|---|---|---|
| Node version | PASS | `v24.14.1` |
| Agent config | SKIPPED | `~/.uat-agent/config.json` does not exist yet; M1 `uat-agent login` should create it |
| Workdir writable | PASS | `~/.uat-agent/runs` writable |
| Chrome profile writable | PASS | `~/.uat-agent/chrome-profile` writable |
| Codex CLI | PASS | `codex-cli 0.124.0`; `codex exec --json` returned expected sentinel |
| Persistent browser profile | PASS | localStorage and persistent cookie survived Playwright persistent-context restart |
| Playwright MCP availability | SKIPPED | Plain Node spike cannot verify Codex tool runtime MCP wiring |
| Galaxy SSO session | SKIPPED | M0 does not automate company SSO; only validates persistence mechanism |
| Railway Agent token | SKIPPED | Agent endpoint/token does not exist before M1.1/M1.2 |

### Verdict

**PARTIAL**.

The local execution machine is suitable for M1 Agent work, but true SSO validity and live Railway token checks require the M1 Agent and a real Galaxy login session.

### Adopted Approach

M1.2 should implement `uat-agent doctor` with these categories:

1. Hard checks: Node, Codex binary, Codex login/exec, workdir writable, Chrome profile writable, Playwright persistent launch.
2. Live checks: server reachable, Agent token valid, WebSocket upgrade works.
3. Session hints: Galaxy SSO page opens without `載入失敗` / dashboard redirect, but never automate SSO credentials.

The profile persistence test should use a persistent cookie, not only localStorage. Session cookies may not survive shutdown depending on Chrome settings.

### Impact on M1 Spec

Keep M1 doctor as required before starting a run. Add one implementation detail:

```text
Doctor should test persistent cookie restoration, not just profile directory writability.
```

### Impact on Planning Document

M0-5 is partially open because SSO itself cannot be certified without Tommy logging in through the persistent profile and re-testing after time passes. This does not block M0-6/M0-7, but M1 should not promise "24h SSO OK" until a real session longevity test is performed.

### Fallback

If real Galaxy SSO still expires frequently:

1. Surface `WAITING_USER` with a login-required message.
2. Keep the persistent browser open during run pauses.
3. Add a doctor command that opens the target Galaxy URL and asks Tommy to confirm login status manually.
4. Avoid automating SSO credentials or OTP.

---

## M0-6 Result XLSX Upload + Parse Round-trip

### Goal

Verify that an Agent-produced `result.xlsx` can be parsed and ingested into DB-shaped rows:

- `run_case_results`
- `bugs`

Also verify `detail_json` handling rules:

1. Empty cell → `detail_json=null`, `detail_json_raw=null`.
2. Valid JSON object → parsed JSON.
3. Valid JSON but not object → raw preserved, `detail_parse_error=NOT_OBJECT`.
4. Invalid JSON → raw preserved, parse error preserved.

### Validation Script

```bash
node spikes/m0/result-xlsx/run-spike.mjs
```

The script creates a fixture workbook with exactly three sheets:

- `索引`
- `測試案例`
- `Bug`

Then it parses the workbook and inserts rows into a local PGlite DB.

### Result Summary

Run directory:

```text
spikes/m0/result-xlsx/output/2026-04-26T16-55-04-182Z/
```

Summary:

| Check | Result | Evidence |
|---|---|---|
| Schema version detected | PASS | `bi-result-v1` read from `索引` |
| Parser version present | PASS | `m0-result-parser-v1` emitted |
| PASS / FAIL / BLOCKED / PARTIAL parsed | PASS | 7 cases parsed across all result statuses |
| Valid detail_json parsed | PASS | 4 valid object rows parsed as JSON |
| Invalid detail_json preserved | PASS | Invalid JSON row kept `detail_json_raw` and parse error |
| Not-object detail_json preserved | PASS | JSON array row marked `NOT_OBJECT` |
| Blank detail_json handled | PASS | Blank row kept JSON/raw as null |
| Bug sheet parsed | PASS | 3 bugs parsed: High / Medium / Low |
| DB write round-trip | PASS | 7 case rows + 3 bug rows inserted into PGlite |

### Adopted Approach

M1.1 should implement result parsing as a dedicated module, separate from the existing testcase parser:

```text
src/result-parser/
  result-xlsx-parser.ts
  detail-json.ts
  adapters/
```

Do not reuse the current `src/xlsx-parser.ts` directly for result ingestion. That parser is testcase-input oriented and merges base test metadata into `detailJson`, which is not correct for result ingestion because invalid result detail must be preserved as raw/error.

### Impact on M1 Spec

M1.1 can proceed with the documented result parser. Keep these concrete rules:

- The result parser must return both parsed case rows and bug rows.
- The parser must expose a parser version.
- Invalid `detail_json` is not fatal for the workbook; it is a row-level parse error.
- Result ingestion should upsert case rows by `(run_id, case_no)`.

### Impact on Planning Document

No direction change.

### Fallback

If real BI result xlsx files differ from this fixture:

1. Use Domain Pack `result_parser_adapter.json` to map headers.
2. If required headers cannot be mapped, reject ingestion with a clear parser error.
3. Keep original uploaded xlsx available for manual recovery.
4. Add a legacy adapter only after a real incompatible file is observed.

---

## M0-7 End-to-End Fake Codex

### Goal

Run the smallest full-system loop:

1. Fake Web UI creates a run.
2. Fake Railway API writes a DB run record.
3. Fake Railway WebSocket dispatches a task to fake Mac Agent.
4. Fake Agent simulates fake Codex stdout and Tool Bridge request.
5. Fake Web UI posts Tool Response.
6. Fake Agent creates and uploads a fake `result.xlsx`.
7. Fake Railway parses result xlsx into DB.
8. Fake Web UI queries summary and sees case result.

### Validation Script

```bash
node spikes/m0/e2e-fake/run-spike.mjs
```

### Result Summary

Run directory:

```text
spikes/m0/e2e-fake/output/2026-04-26T16-57-36-286Z/
```

Summary:

| Check | Result | Evidence |
|---|---|---|
| Run created | PASS | Fake HTTP API returned `ASSIGNED` run |
| Final status | PASS | Final DB status `COMPLETED` |
| Case visible | PASS | `GET /api/runs/:id/summary` returned case `A-01` status `PASS` |
| Tool request event | PASS | `run.tool_request` event stored |
| Tool response event | PASS | `tool_response.sent` event stored |
| Result ingestion event | PASS | `result.ingested` event stored |
| Completed event | PASS | `run.completed` event stored |

### Adopted Approach

M1 can be implemented as the same conceptual flow, with fake pieces replaced by real modules:

| M0 fake piece | M1 real module |
|---|---|
| Fake HTTP API | Express routes |
| PGlite DB | Railway Postgres + Drizzle |
| Fake WebSocket server | `/agent-ws` server |
| Fake Agent | `/agent` package |
| Fake Codex | `CodexRunner` using `codex exec --json` / `resume` |
| Fake result parser | `result-xlsx-parser` |
| Fake Web UI query | React run detail/history page |

### Impact on M1 Spec

M1.1/M1.2/M1.3 split remains correct.

One sequencing detail is now clear: result ingestion should be triggered by `result.uploaded`, but final `COMPLETED` status should only be trusted after ingestion succeeds. In M0 fake flow the Agent sends `run.completed` immediately after upload; production should treat that as "agent done", not "server ingestion done".

Recommended M1 status order:

1. `AGENT_RUNNING`
2. `UPLOADING_RESULT`
3. `INGESTING_RESULT`
4. `COMPLETED`

### Impact on Planning Document

No architecture change. M0-7 confirms the cloud hub + Mac Agent architecture is workable.

### Fallback

If real M1 E2E has race conditions:

1. Make `run.completed` from Agent an event only.
2. Let server own final status transition to `COMPLETED` after result parser succeeds.
3. If result upload finishes but parser fails, status should become `FAILED` or stay `INGESTING_RESULT` with an explicit parser error depending on recoverability.

---

## M0 Final Decision

Proceed to M1 implementation, but keep two explicit gates:

1. Before marking M1.1 DB complete, run M0-4 against a real Railway/Postgres dev DB.
2. Before claiming interactive runs are production-ready, run M0-5 SSO longevity test with Tommy logging into Galaxy through `~/.uat-agent/chrome-profile` and reopening the page later.

M1 spec adjustment required from M0:

- `CodexRunner` must be turn-based (`exec --json` + `resume`), not a long-running TUI process.
- Tool Bridge parser should be implemented as a standalone tested module.
- Server should own final `COMPLETED` transition after result ingestion.
