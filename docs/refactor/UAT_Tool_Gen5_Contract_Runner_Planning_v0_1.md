# UAT Tool Gen5 Contract Runner Planning

Version: v0.1
Date: 2026-07-01
Status: Draft for Tommy review

## 1. Why Gen5

The current dev line tried to extend the production runtime toward multiple domains, but the actual implementation mixed domain behavior into platform code.

Observed failure pattern:

- TAG domain pack exists but runtime still routes by regex/case id.
- TAG helper logic is embedded in BI helper executor.
- TAG cases still load BI rulebooks.
- Result containment lets runs continue but inflates product BLOCKED counts with tool/runtime blockers.
- Full-run timing shows Codex judgment and context loading dominate run time, not helper UI execution.

Tommy expects BI data tool v2 testing to start around 2026-08. That timing makes a Gen5 pivot more useful than spending several weeks stabilizing the current Gen4-ish dev branch.

## 2. Gen5 Objective

Create a contract-first UAT runner that can accept a new feature/domain, load its domain pack, execute declared UI workflows deterministically, collect structured evidence, and use LLM only where judgment genuinely needs interpretation.

Target outcome:

- New domain pack + UI dictionary + action contracts should support at least 80% of ordinary functional/UI cases without custom platform code.
- Domain onboarding should not require editing core runtime for product-specific row actions, labels, or case ids.
- Tool/runtime failures should be distinguishable from product failures.

## 3. Non-Goals

Gen5 is not:

- A full rewrite of Railway/Web UI.
- A replacement for the production fallback before a smoke-proven vertical slice exists.
- A plan to remove all LLM usage.
- A plan to hide more prompt text in domain packs.
- A plan to let product APIs replace visible UI UAT.

## 4. Design Principles

1. Platform is small and generic.
2. Domain packs are executable contracts, not prompt dumps.
3. Testcases carry values and expectations, not UI discovery logic.
4. Evidence is captured before judgment.
5. Tool status and product status are separate.
6. LLM is an interpreter of ambiguous evidence, not the default executor.
7. A new domain should fail early at lint/smoke when contracts are missing.

## 5. Layer Responsibilities

| Layer | Owns | Must Not Own |
| --- | --- | --- |
| Platform Runtime | run lifecycle, browser lease, Tool Bridge, artifact storage, generic action verbs, security, tracing | product labels, field names, row menu variants, case-id routing |
| Domain Pack | UI objects, route map, locator hints, action contracts, evidence schema, known drift, fixture policy | arbitrary executable helper code, platform status machine, per-run hacks |
| Testcase Package | case id, values, expected outcomes, risk level, test target, fixture refs | product-wide UI discovery, platform action semantics |
| Contract Interpreter | execute platform verbs against domain objects, collect evidence, produce action log | product judgment narrative |
| Result Gate | deterministic PASS/FAIL/BLOCKED/PARTIAL rules from scope/evidence | UI execution |
| LLM/Judgment Worker | ambiguity, product drift explanation, bug wording, edge-case arbitration | routine route inference, basic UI execution, workbook repair |

## 6. Proposed Architecture

```text
Web UI / Railway
  - create run
  - store package/artifacts
  - display productStatus/toolStatus
        |
        v
Mac Agent Gen5 Runner
  - prepare run workspace
  - load domain pack
  - compile testcase -> case scope contract
  - execute action contracts
  - capture evidence
  - call deterministic result gate
  - call LLM only for ambiguity/non-deterministic judgment
        |
        v
Browser Action Executor
  - Playwright/browser session
  - generic platform verbs
  - no product-specific hard-code
        |
        v
Domain Contract Interpreter
  - resolves domain UI object ids
  - executes domain action steps
  - validates required evidence schema
```

## 7. Key Runtime Concepts

### 7.1 Case Scope Contract

Each testcase is compiled into a structured contract:

- `domainId`
- `targetPage`
- `testTarget`
- `riskLevel`
- `requiredActions`
- `allowedActions`
- `forbiddenActions`
- `expectedOutcome`
- `requiredEvidence`
- `judgmentPolicy`
- `cleanupPolicy`

This replaces case-id regex routing.

### 7.2 Domain Action Contract

Domain action contracts become executable.

Example conceptual flow:

```json
{
  "actionId": "tagList.openRowActions",
  "steps": [
    { "op": "ensurePage", "target": "tagPlayerList" },
    { "op": "findRow", "target": "tagList.table", "criteriaFrom": "params" },
    { "op": "click", "target": "tagList.rowActions" },
    { "op": "read", "target": "tagList.rowActionMenu", "saveAs": "tagList.rowActionMenu.state" }
  ],
  "requiredEvidence": [
    "navigation.state",
    "tagList.row.state",
    "tagList.rowActionMenu.state",
    "interactionLog"
  ]
}
```

The interpreter executes this, not Codex.

### 7.3 Evidence Schema

Evidence is a typed product of execution:

- `navigation.state`
- `uiObject.state`
- `interactionLog`
- `network.observation`
- `download.artifact`
- `toast.message`
- `screenshot.reference`
- `fixtureRef.state`

Screenshots are supporting artifacts, not primary structured evidence.

### 7.4 Status Model

Gen5 should split result status:

```json
{
  "productStatus": "PASS | FAIL | BLOCKED | PARTIAL | SKIPPED",
  "toolStatus": "OK | TOOL_ERROR | CONTRACT_GAP | FIXTURE_MISSING | AUTH_BLOCKED | ENVIRONMENT_BLOCKED",
  "resultStatus": "display-compatible summary for existing reports"
}
```

Rules:

- Product behavior not reached -> do not count as product FAIL/BLOCKED without clear product evidence.
- Tool/runtime failure -> `toolStatus` carries the failure.
- Product report can show both:
  - product view
  - tool quality view

## 8. LLM Usage In Gen5

LLM should be used for:

- ambiguous evidence interpretation
- PRD/live/prod drift explanation
- product bug narrative
- testcase flaw classification
- handoff summary

LLM should not be used for:

- ordinary route selection
- ordinary row action selection
- selecting which rulebooks to load by memory
- repairing workbook structure after every case
- turning tool errors into UAT product blockers

Candidate future implementation:

- Early slice may keep Codex CLI for comparison.
- Long-term runner may use OpenAI Responses API / Agents SDK with structured outputs.
- MCP can expose browser/action/evidence tools as standardized tools.

Decision remains open until a spike compares effort and reliability.

## 9. Migration Plan

### Phase 0: Freeze And Baseline

Status: done for current dev.

- Archive current dev HEAD.
- Keep prod as stable fallback.
- Record prod/dev divergence.

### Phase 1: Gen5 Schema Slice

Deliverables:

- `case-scope-contract.v2.json` draft
- `domain-action-contract.v2.json` draft
- `evidence-schema.v2.json` draft
- `productStatus/toolStatus` draft

Smoke:

- Compile 3 static testcase rows into scope contracts.
- No browser execution required.

### Phase 2: Contract Interpreter MVP

Deliverables:

- Generic platform action interpreter:
  - `ensurePage`
  - `read`
  - `findRow`
  - `click`
  - `select`
  - `type`
  - `uploadFile`
  - `openModal`
  - `cancelModal`
  - `waitForState`
- Domain object resolver.
- Evidence writer.

Smoke:

- TAG list observation case.
- TAG variable settings observation case.
- BI official UI simple observation case.

### Phase 3: Deterministic Result Gate

Deliverables:

- Result gate reads:
  - case scope
  - action log
  - evidence bundle
- Writes product/tool statuses.
- Existing workbook/report adapter remains compatible.

Smoke:

- PASS observation.
- FAIL frontend presentation.
- CONTRACT_GAP.
- FIXTURE_MISSING.
- TOOL_ERROR.

### Phase 4: LLM Judgment Worker

Deliverables:

- Structured output schema for ambiguity/result explanation.
- LLM only called when deterministic gate returns:
  - `NEEDS_REVIEW`
  - `PRODUCT_DRIFT_CANDIDATE`
  - `TESTCASE_FLAW_CANDIDATE`
  - `BUG_NARRATIVE_REQUIRED`

Smoke:

- Same evidence bundle produces stable JSON output on repeated runs.

### Phase 5: TAG + BI v2 Pilot

Deliverables:

- TAG smoke pack 10-15 cases.
- BI data tool v2 pilot pack when available.

Targets:

- Tool status OK >= 90%.
- Product/tool blockers separated.
- Average case runtime under 90 seconds for ordinary observation/functional cases.
- No TAG case loads BI rulebooks.
- No product-specific branch in platform runtime.

## 10. Keep / Remove / Rewrite From Current Dev

| Area | Decision | Notes |
| --- | --- | --- |
| TAG domain pack content | Keep and normalize | Useful source for Gen5 domain contracts |
| TAG helper regex routing | Remove/rewrite | Replace with scope/action contract routing |
| TAG code inside BI helper executor | Remove/rewrite | Replace with generic interpreter + domain resolver |
| BI official UI contract repairs | Keep as reference | Need port into generic contract format |
| Agent config isolation | Keep | Infrastructure stability improvement |
| Runtime containment result | Redesign | Split productStatus/toolStatus |
| Evidence-first input summary | Redesign | Summary should be plan, not broad rule-loading trigger |
| Current-case pack BI defaults | Remove for non-BI | Domain-specific rule selection only |

## 11. Open Decisions

| ID | Decision | Options | Owner |
| --- | --- | --- | --- |
| G5-D01 | Runner implementation path | Keep Codex CLI for first slice / use OpenAI API directly / use Agents SDK | Tommy + Codex |
| G5-D02 | First pilot domain | TAG_TOOL / BI v2 / both | Tommy |
| G5-D03 | Existing report compatibility | Add product/tool status columns / keep old display with extra detail JSON | Tommy + Codex |
| G5-D04 | Production fallback policy | Prod frozen until Gen5 smoke passes / selective prod cherry-picks allowed | Tommy |
| G5-D05 | Domain pack v2 schema strictness | warning-first / fail-fast | Tommy + Codex |

## 12. Proposed Immediate Next Step

Before coding:

1. Review this planning doc with Tommy.
2. Decide G5-D01 and G5-D02.
3. Draft the three Gen5 schemas:
   - case scope
   - action contract
   - evidence bundle
4. Build a no-browser compiler smoke.

Only after that should implementation begin.
