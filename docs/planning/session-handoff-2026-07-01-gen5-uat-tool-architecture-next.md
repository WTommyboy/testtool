# Session Handoff: UAT Tool Gen5 Architecture Pivot

Date: 2026-07-01
Owner: Codex + Tommy
Workspace: `/Users/tommy/Downloads/codex_galaxy_dev/uat-tool`

## 1. Current Saved State

Current dev HEAD was preserved before starting Gen5 planning.

- Dev HEAD: `eefd7fd810ca01f76b2747a338ace9110bc664e8`
- Archive branch pushed: `archive/dev-gen4-tag-tool-before-gen5-20260701-eefd7fd`
- Archive tag pushed: `dev-gen4-tag-tool-before-gen5-20260701`
- Production baseline: `82f46be2d9ec3222b2f606be3e347327297fda91`
- Production branch: `codex/uat-tool-mvp`
- Dev branch: `dev/uat-agent-config-isolation`

Railway `/version` checks during this session:

- Production: `testtool-production`, short SHA `82f46be`, branch `codex/uat-tool-mvp`, environment `production`
- Dev: `testtool-dev`, short SHA `eefd7fd`, branch `dev/uat-agent-config-isolation`, environment `dev`

## 2. Dirty Files At Handoff

These files were already dirty before this handoff work and must not be bundled into unrelated commits unless Tommy explicitly approves:

- `docs/planning/tag-tool-claude-testcase-request.md`
- `domain-packs/TAG_TOOL/AGENTS.md`

This handoff adds new planning files only.

## 3. Why This Pivot Happened

Tommy clarified that the correct comparison is not PRD vs dev product UI. The correct comparison is UAT Tool prod runtime vs UAT Tool dev runtime.

The latest TAG run used the dev runtime and showed poor reliability:

- Run: `7e7f80c9-2698-44f5-a63e-e2888279f7f8`
- Package: `NU_TAG_p0_R0011`
- Total: 88 cases
- PASS: 35
- FAIL: 9
- BLOCKED: 39
- PARTIAL: 5
- Runtime: about 8 hours

Timing evidence showed helper execution was not the main bottleneck:

- helper pre-run total was only about minutes-scale
- Codex turns consumed most of the run time
- Many blockers were tool/runtime/evidence-gate issues, not product failures

Tommy's product assumption is that the live product may have some UI/spec drift, but that should normally explain about 10-15 affected cases or fewer, not nearly half the package.

## 4. Prod vs Dev Main Difference

Dev is not a small extension of prod. It contains 24 commits after prod and changes 111 files, with about 15k added lines.

Key dev changes after prod:

1. Agent config isolation and dev agent runtime fixes.
2. BI official UI P0 helper/contract repairs.
3. TAG_TOOL domain pack.
4. TAG_TOOL runtime helper wiring.
5. Current-case/package gate containment changes.
6. Result evidence upload containment changes.
7. Evidence-first Codex input summary changes.

The important finding: TAG domain pack files exist, but the runtime does not truly execute them as contracts. TAG routing is still hard-coded in platform/BI runtime code.

## 5. Likely Root Cause

The current dev runtime has too much domain behavior in platform code.

Examples:

- `agent/src/current-case-pack.ts`
  - TAG cases still receive BI rulebooks in mandatory rule keys.
  - TAG rule keys are added on top instead of replacing BI-specific context.

- `agent/src/helper-execution-plan.ts`
  - TAG action selection is inferred by regex and case id patterns.
  - This should be contract driven.

- `agent/src/bi-ui-helper-executor.ts`
  - TAG helper logic is embedded in the BI helper executor.
  - TAG row discovery uses hard-coded table selectors such as `tbody tr,[role='row']`.
  - Latest run repeatedly hit `TAG_ROW_NOT_FOUND` while page text showed visible TAG rows.

- `agent/src/task-runner.ts`
  - The run brief still encourages reading whole-package context and full rulebooks for many non-PASS paths.
  - This defeats the intended current-case progressive-disclosure design.

- Runtime/result containment
  - Dev can contain failures by writing BLOCKED result rows.
  - This improves run continuity but pollutes product BLOCKED counts when tool/runtime failures are not separated from product results.

## 6. Corrected Interpretation

It is not enough to "put more information into the domain layer."

Better framing:

- Platform layer should own generic runtime mechanics only.
- Domain layer should provide executable contracts, not just more prompt text.
- Testcase layer should provide values and expected outcomes.
- LLM/Codex should handle ambiguity and explanation, not route every case or rediscover UI structure.

## 7. Recommended Direction

Do not continue patching the current Gen4-ish dev line into shape.

Recommended strategy:

1. Keep prod `82f46be` as stable fallback.
2. Preserve current dev state using the archive branch/tag above.
3. Start a Gen5-first planning and implementation track.
4. Build Gen5 as a vertical slice, not a full rewrite.
5. Use TAG_TOOL and upcoming BI v2 as the proving domains.

## 8. Gen5 Goal In One Sentence

Build a contract-first UAT runner where the Mac Agent executes deterministic domain action contracts, captures structured evidence, separates tool status from product status, and uses LLM only for ambiguity, drift explanation, and bug narration.

## 9. Next Recommended Work

1. Finalize Gen5 planning doc:
   - `docs/refactor/UAT_Tool_Gen5_Contract_Runner_Planning_v0_1.md`
2. Decide whether Gen5 should:
   - keep Codex CLI for early vertical slice, or
   - move directly to an API/Agents-SDK runner spike.
3. Define `productStatus` / `toolStatus` report model.
4. Define domain action contract interpreter MVP.
5. Define smoke gate:
   - 10-15 mixed cases
   - no BI rulebooks for TAG cases
   - no case-id regex routing
   - average case runtime target under 90 seconds
   - tool blockers not counted as product blockers

## 10. Do Not Forget

- Do not push anything to production without Tommy's explicit approval.
- Do not commit unrelated dirty files.
- Dev Railway currently points to `eefd7fd`.
- Current dev state is preserved remotely and can be recovered by branch or tag.
