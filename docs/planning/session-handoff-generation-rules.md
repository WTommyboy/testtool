# Session Handoff Generation Rules

Date: 2026-05-06 Asia/Taipei

This file defines the standing rules for manual session handoffs and future daily automated handoff generation.

## Core Rule

Every handoff must begin with the active user question, not with generic repository status.

A handoff is incomplete if a new chat can read it and still not know what Tommy was asking, what decision was open, or what answer should come first.

## Required First Section

Use this as the first substantive section of every handoff:

```md
## Active User Question / Next Conversation Objective

- Tommy is currently asking:
- The next assistant should answer first:
- Current mode: investigation only / implementation allowed / handoff only / waiting for Tommy
- Do not start with generic status inventory. Use repo/run status only to support the question above.
```

This section must preserve the live discussion thread, including:

- the unresolved question or decision Tommy was actively pursuing;
- the expected first action in the new chat;
- whether the new chat should only investigate, or may edit code;
- the most important hypothesis and competing interpretations;
- any user frustration or correction that changes the priority.

## Required Sections

Each handoff should include these sections in this order:

1. `Active User Question / Next Conversation Objective`
2. `Source Threads / Source Folders`
3. `Do Not Read / Do Not Touch`
4. `Confirmed Facts`
5. `Unverified Or Risky Assumptions`
6. `Current Repo / Deployment / Run State`
7. `Work Completed Since Previous Handoff`
8. `Open Issues And Decisions`
9. `Recommended Next Steps`
10. `Ready-To-Paste New Chat Prompt`

Repository status belongs in section 6. It must not replace section 1.

## Multiple-Thread Handoffs

If a handoff combines more than one chat or daily work stream, write one shared memory section and then per-thread deltas.

Required handling:

- Include all relevant thread IDs and names.
- Explain why each source is included.
- Mark which source contains the latest active question.
- Do not collapse multiple threads into a vague "previous context" label.
- If source threads disagree, preserve the conflict explicitly instead of choosing silently.

## Daily Automated Handoff Rules

Future daily automation may generate a shared D-1 handoff, but it must follow the same active-question rule.

Daily generated handoffs must:

- read the configured D-1 source folders and logs;
- detect dirty git state, running deploys, incomplete runs, and non-terminal investigation threads;
- label the handoff as `DRAFT / PARTIAL` when work may still be in progress;
- include the active user question for each work stream, not just file diffs;
- produce ready-to-paste opening prompts for each next-day chat;
- avoid creating or resuming an interactive chat window by itself unless the platform explicitly supports that action and Tommy has approved the workflow.

Daily automation is for shared memory and opening packages. It must not pretend a half-finished run or unresolved discussion is final.

## New Chat Prompt Rule

Every ready-to-paste prompt must explicitly tell the next assistant what to do first.

Bad prompt shape:

```md
Please read this handoff and do a status inventory.
```

Good prompt shape:

```md
Please read this handoff. After a brief status check, answer the Active User Question first. Do not start implementation unless the handoff says implementation is allowed.
```

## Validation Checklist

Before delivering a handoff, verify:

- The first section states Tommy's active question in plain language.
- The next assistant can answer "what should I do first?" without guessing.
- Repo/run/deploy status supports the active question instead of burying it.
- Source thread IDs, run IDs, file paths, and relevant commits are concrete.
- Unknowns are labeled as unknown instead of inferred as fact.
- Raw session JSONL is avoided unless Tommy explicitly asked to inspect it.
- The ready-to-paste prompt includes the active question and the allowed mode.

