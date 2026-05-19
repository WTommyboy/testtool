# Platform / Domain / Testcase Boundary Rule v1.0

This rule defines where UAT Tool behavior belongs. It prevents BI-specific live-run fixes from becoming hidden platform behavior, while still allowing each domain pack to carry the UI semantics needed for reliable future runs.

## Core Principle

Not every capability must be platform-generic. Every capability must be placed at the correct layer:

| Layer | Owns | Must Not Own |
| --- | --- | --- |
| Platform runtime | run lifecycle, browser/session safety, Tool Bridge, artifact capture, evidence gate mechanics, action lifecycle, result aggregation, generic blocked taxonomy | BI field names, BI project names, single-case workarounds, product-specific selectors |
| Platform vocabulary | generic verbs and assertions such as `click`, `hover`, `type`, `select`, `openModal`, `cancelModal`, `assertVisible`, `assertDisabled`, `assertNoRequest`, `addRow`, `duplicateRow`, `deleteRow` | domain object ids, source report names, date preset labels unique to one product |
| Domain pack | UI object vocabulary, locator hints, semantic maps, domain action templates, evidence objects, domain lint rules, known product gaps, hazard notes | arbitrary executable helper code, per-case result decisions, one-off run evidence |
| Testcase package | case purpose, risk level, test target, canonical step/action references, input values, expected outcomes, cleanup expectations | platform workaround rules, reusable UI object definitions, hidden helper instructions |
| Temporary bridge | explicitly named compatibility behavior needed to keep current runs usable while the contract is being generalized | silent permanent behavior, platform-level case-id branches |

## Placement Rules

1. If a rule applies to every domain, put it in Layer 1 platform rules or platform contracts.
2. If a rule is reusable inside one feature/domain but not cross-domain, put it in that domain pack.
3. If a rule is only about one testcase package version or one run, put it in the testcase package or run instructions.
4. If a runtime change contains a concrete case id, BI project name, source report label, or one-off UI phrase, it is suspect. Move the meaning into a domain pack or testcase contract unless it is explicitly documented as a temporary bridge.
5. If a future domain has the same structural need as a BI feature, create the same kind of domain-pack artifact for that domain instead of adding a new runtime branch.

## Domain Pack Authoring Requirements

When a new domain pack is created or a domain pack is materially expanded, the authoring process must decide whether each of these artifacts is needed:

- UI object vocabulary: stable object ids, aliases, locator hints, supported platform actions, state attributes, hazards.
- Page map: entry URLs, route states, modal/drawer/popover states, navigation boundaries.
- Component inventory: important buttons, rows, tables, tabs, pickers, toolbars, toasts, dialogs.
- Action contracts: domain-level operations expressed through platform actions and allowlisted declarative steps.
- Evidence schema: evidence groups, source enum, required/conditional evidence, screenshot fallback policy.
- Lint rules: checks that should fail before a live run when testcase prose cannot map to known domain objects/actions.
- Known product gaps: confirmed UI/product limitations that should be classified consistently and not rediscovered as tool failures.

If a testcase requires an object or operation missing from the domain pack, the correct classification is a contract gap such as `HELPER_CONTRACT_MISSING`, `ACTION_TEMPLATE_MISSING`, or `DOMAIN_OBJECT_MISSING`. Do not fallback to an unrelated helper path just to produce evidence.

## Runtime Boundaries

The platform runtime may execute only generic mechanisms:

- Load the selected domain pack and testcase package.
- Validate package consistency and domain lint rules.
- Route a case to the declared action/evidence contract.
- Execute allowlisted platform actions or helper templates.
- Capture DOM/ARIA/network/screenshot/download artifacts.
- Apply result gate and blocked taxonomy.
- Isolate runtime failures so one case does not kill the whole run when safe.

The platform runtime must not:

- Hard-code a testcase id as ordinary behavior.
- Use BI-specific source report names, field labels, project names, or date labels as platform concepts.
- Add product-specific small helpers or agents as the default answer to a missing contract.
- Treat screenshot evidence as a silent PASS without an explicit visual fallback contract and observed assertion.
- Convert domain contract gaps into generic `EVIDENCE_INSUFFICIENT` when the actual issue is missing routing/template/object data.

## Temporary Bridge Policy

Compatibility bridges are allowed when needed to keep dev UAT moving, but they must be explicit:

- Name the bridge in docs or dev log.
- State why it exists and what long-term contract replaces it.
- Keep it scoped to the smallest behavior necessary.
- Add a fixture or smoke that proves the bridge does not broaden into unrelated cases.
- Track follow-up work to move reusable semantics into platform vocabulary or domain pack data.

Examples:

- A generic result upload retry is platform runtime.
- A BI official date-panel static-tab locator is domain pack data.
- A specific `BIUI_COLLAGE_R001-B-09` branch in runtime is not acceptable as permanent platform behavior.
- A temporary Gen1/Gen2 BI helper bridge may exist only if it is documented and does not become the Gen4 architecture.

## Review Checklist

Before landing a change that affects execution, routing, evidence, or result judgment, answer:

1. Is this behavior platform-generic?
2. If not, can it be declared in a domain pack instead of runtime?
3. If it is only testcase-specific, is it in the testcase package instead of reusable docs?
4. Does the domain pack generation flow now know to produce this kind of artifact for the next similar feature?
5. Does the result taxonomy distinguish product failure, contract gap, PM skip, visual review, and tool/runtime failure?
6. If this is a bridge, where is the bridge documented and what replaces it?
