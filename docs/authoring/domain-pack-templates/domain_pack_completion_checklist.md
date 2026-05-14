# Domain Pack Completion Checklist

> Purpose: final gate before a new domain pack is considered usable in dev or promotable to prod.

---

## 1. Intake Gate

- [ ] PRD / spec is available.
- [ ] UI screenshots or design reference are available.
- [ ] Dev URL is known.
- [ ] SSO / login precondition is known.
- [ ] Existing testcase assets are available, if any.
- [ ] Existing cases to preserve are explicitly listed.
- [ ] Specification priority is written down.
- [ ] Resource create / update / delete policy is written down.
- [ ] Irreversible action approval rule is written down.
- [ ] Open decisions are either answered or marked as non-blocking.

## 2. Authoring Gate

- [ ] `domain_intake_draft.md` exists.
- [ ] `<feature>_boundary_rules.md` exists.
- [ ] `<feature>_Claude_testcase_request.md` or equivalent exists.
- [ ] PRD vs UI conflicts are listed.
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
- [ ] `domain-packs/<DOMAIN>/locators/README.md`, if locators are needed.
- [ ] `domain-packs/<DOMAIN>/locators/demo001-locator-registry.json`, if locator registry is needed by current MVP endpoint.

## 4. Content Gate

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
- [ ] Mac Agent downloads domain pack files.
- [ ] Codex sees the domain `AGENTS.md`.
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
