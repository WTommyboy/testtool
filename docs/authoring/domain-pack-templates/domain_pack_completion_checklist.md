# Domain Pack Completion Checklist

> Purpose: final gate before a new domain pack is considered usable in dev or promotable to prod.

---

## 1. Intake Gate

- [ ] PRD / spec is available.
- [ ] UI screenshots or design reference are available.
- [ ] Live UI visible inventory is available for buttons, tabs, presets, modals, toasts, picker options, and row actions used by testcase assertions.
- [ ] Dev URL is known.
- [ ] SSO / login precondition is known.
- [ ] Existing testcase assets are available, if any.
- [ ] Existing cases to preserve are explicitly listed.
- [ ] Specification priority is written down.
- [ ] Resource create / update / delete policy is written down.
- [ ] Environment-sensitive cases are identified, including upper limits, capacity limits, cross-day checks, tenant/game switching, and cases that require a PM-prepared shared state.
- [ ] Irreversible action approval rule is written down.
- [ ] Open decisions are either answered or marked as non-blocking.

## 2. Authoring Gate

- [ ] `domain_intake_draft.md` exists.
- [ ] `<feature>_boundary_rules.md` exists.
- [ ] `<feature>_Claude_testcase_request.md` or equivalent exists.
- [ ] PRD vs UI conflicts are listed.
- [ ] PRD concepts that are not visible UI objects are listed as composite actions, known gaps, or excluded/focused-package candidates.
- [ ] Old case preservation rules are explicit.
- [ ] New case groups are explicit.
- [ ] Xlsx v2.0 required columns are explicit.
- [ ] Risk level rules are explicit.
- [ ] Test target rules are explicit.

## 3. Tool Domain Pack Gate

- [ ] `domain-packs/<DOMAIN>/README.md`
- [ ] `domain-packs/<DOMAIN>/AGENTS.md`
- [ ] `domain-packs/<DOMAIN>/startup_prompt_template.md`
- [ ] `domain-packs/<DOMAIN>/xlsx_schema.json`
- [ ] `domain-packs/<DOMAIN>/result_parser_adapter.json`
- [ ] `domain-packs/<DOMAIN>/ui-contract.json`, if the domain has visible UI flows.
- [ ] `domain-packs/<DOMAIN>/ui-object-vocabulary.json`, if testcase steps target named UI objects.
- [ ] `domain-packs/<DOMAIN>/action-contracts/*.json`, if testcase steps need reusable domain operations.
- [ ] Shared lifecycle action contracts exist for repeated cross-case user journeys, not only single UI controls.
  Examples: create -> modal -> cancel/save, save -> list -> find row -> reopen, copy -> save -> verify row, delete -> confirm -> cancel/confirm, picker preset -> apply -> verify label/request.
- [ ] `domain-packs/<DOMAIN>/evidence-schema.json`, if PASS/FAIL/BLOCKED depends on structured evidence.
- [ ] `domain-packs/<DOMAIN>/lint-rules.json`, if package consistency should catch missing action/object contracts before live run.
- [ ] `domain-packs/<DOMAIN>/discovery/page-map.json`, if URL/page/modal boundaries matter.
- [ ] `domain-packs/<DOMAIN>/discovery/component-inventory.json`, if UI component semantics matter.
- [ ] `domain-packs/<DOMAIN>/discovery/visual-alignment.json`, if screenshot/visual fallback may be needed.
- [ ] `domain-packs/<DOMAIN>/locators/README.md`, if locators are needed.
- [ ] `domain-packs/<DOMAIN>/locators/demo001-locator-registry.json`, if locator registry is needed by current MVP endpoint.

## 4. Content Gate

- [ ] Platform/domain/testcase placement was checked against `agent-skills/uat-tool/rules/platform-domain-boundary.md`.
- [ ] Generic action verbs are referenced from `contracts/platform-action-vocabulary.v1.json`; no domain action verbs were invented in testcase prose only.
- [ ] Domain-specific UI object ids, aliases, locator hints, state attributes, hazards, and known product gaps live in the domain pack, not platform runtime.
- [ ] Repeated lifecycle flows have been identified across the testcase set and assigned to domain action contracts with required evidence.
- [ ] Full-ready active package excludes cases that intentionally pollute shared environment, unless a safe precondition builder and cleanup policy are explicitly provided.
- [ ] Visible-list assertions only include objects confirmed by live UI, screenshots, design reference, or domain visual-alignment data.
- [ ] Each shared lifecycle contract declares:
  - [ ] precondition page/state
  - [ ] step sequence using platform actions and domain UI object ids
  - [ ] required evidence objects
  - [ ] PASS/FAIL/BLOCKED judgment boundary
  - [ ] safe handling for create/update/delete or irreversible steps
- [ ] Testcase-specific input values and expected outcomes remain in the testcase package, not the domain vocabulary.
- [ ] Any temporary bridge is named, scoped, and has a follow-up contract that will replace it.
- [ ] `AGENTS.md` has scope and out-of-scope.
- [ ] `AGENTS.md` has specification priority.
- [ ] `AGENTS.md` has irreversible action policy.
- [ ] `AGENTS.md` has UI-only execution policy.
- [ ] `AGENTS.md` has evidence policy.
- [ ] `startup_prompt_template.md` has startup checks.
- [ ] `startup_prompt_template.md` has one-case-at-a-time discipline.
- [ ] `startup_prompt_template.md` has result workbook contract.
- [ ] `xlsx_schema.json` parses as JSON.
- [ ] `result_parser_adapter.json` parses as JSON.
- [ ] UI/action/evidence/lint JSON files parse, if present.
- [ ] Action contracts use platform action ids and domain UI object ids; they do not embed executable helper code.
- [ ] Evidence schema distinguishes DOM/ARIA, network, screenshot, download artifact, toast, URL, and visual review paths when applicable.
- [ ] Locator registry parses as JSON, if present.

## 5. Local Verification Gate

Run from `uat-tool/`:

```bash
npm run verify:domain-pack -- --name <DOMAIN>
npm run typecheck
npm run build
git diff --check
```

Expected:

- [ ] `verify:domain-pack` passes.
- [ ] `typecheck` passes.
- [ ] `build` passes.
- [ ] `git diff --check` passes.

## 6. Dev Environment Gate

- [ ] Commit pushed to dev branch.
- [ ] Dev Railway `/version` shows the new commit.
- [ ] Dev `/api/domains` lists the new domain pack as `valid: true`.
- [ ] Dev `/api/domains/<DOMAIN>/rules` returns markdown.
- [ ] Dev `/api/domains/<DOMAIN>/schema` returns JSON.
- [ ] Dev `/api/domains/<DOMAIN>/result-adapter` returns JSON.
- [ ] Dev `/api/domains/<DOMAIN>/startup-template` returns markdown.
- [ ] Dev locator endpoint works if the domain uses locators.

## 7. Smoke Gate

- [ ] Minimal smoke testcase package exists.
- [ ] Smoke uses low-risk observation cases first.
- [ ] Smoke includes at least one case for each high-risk shared lifecycle contract that appears in the package.
- [ ] Mac Agent downloads domain pack files.
- [ ] Codex sees the domain `AGENTS.md`.
- [ ] Codex sees domain UI/action/evidence/lint files when present.
- [ ] A frontend observation smoke proves DOM/ARIA path or explicit visual fallback contract.
- [ ] A workflow smoke proves required action coverage, not only page navigation.
- [ ] A lifecycle smoke proves repeated flows do not stop at partial evidence.
  Examples: save evidence must include row visibility or an explicit row-search failure; delete-cancel evidence must include modal open, cancel click, and row unchanged; date preset evidence must include before/after label or request body.
- [ ] Any upper-limit/capacity case is smoke-tested in a focused package or explicitly marked out of the main full-ready package.
- [ ] One case completes and uploads `result.xlsx`.
- [ ] Result parser ingests the case.
- [ ] Final aggregate can be downloaded.

## 8. Prod Promote Gate

- [ ] Dev smoke passed.
- [ ] Any testcase package errors fixed.
- [ ] Any domain pack drift fixed.
- [ ] Tommy approved production promote.
- [ ] Production branch push completed.
- [ ] Production `/version` shows promoted commit.
- [ ] Production `/api/domains` lists the domain.
- [ ] Production Mac Agent remains separated from dev Agent config.
