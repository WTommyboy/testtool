# M0 Spike Report

**Status**:in progress  
**Scope**:M0-1 to M0-7 feasibility validation before M1 implementation.

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

Pending.

---

## M0-3 WebSocket Fake Agent

Pending.

---

## M0-4 Postgres + Drizzle Schema

Pending.

---

## M0-5 SSO / Chrome Profile / Agent Doctor

Pending.

---

## M0-6 Result XLSX Upload + Parse Round-trip

Pending.

---

## M0-7 End-to-End Fake Codex

Pending.
