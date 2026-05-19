# Domain Boundary Rules Template

> Purpose: define rules that are specific to one feature domain.
> Do not duplicate the full common UAT rulebook here. Link to common rules and only add feature-specific boundaries.

---

## 1. Domain Identity

- Domain pack:
- Feature:
- Version:
- Applies to:
- Does not apply to:

## 2. Authority And Priority

Specification priority:

1.
2.
3.
4.

Conflict handling:

- PRD vs UI:
- PRD vs old testcase:
- UI screenshot vs live UI:

## 3. Scope

### In Scope

-

### Out Of Scope

-

## 4. Required Preconditions

- URL:
- Login / SSO:
- Game / tenant / project:
- Test data state:
- Project count / limits:
- Browser session:

## 5. Existing Case Handling

- Existing cases to preserve:
- Existing cases allowed to edit:
- Existing cases forbidden to edit:
- Existing skipped / blocked cases:
- Mapping from old UI path to new UI path:

## 6. New Case Design Rules

- Required UI flows:
- Required data flows:
- Required negative cases:
- Required disabled / enabled states:
- Required hover / tooltip checks:
- Required modal / toast checks:
- Required download / export checks:

## 7. Platform / Domain / Testcase Placement

Apply `uat-tool/agent-skills/uat-tool/rules/platform-domain-boundary.md`.

### Platform Reuse

List any requirement that is truly cross-domain and should use platform rules or platform action vocabulary:

| Requirement | Platform artifact |
| --- | --- |
|  |  |

### Domain Pack Ownership

List domain-specific semantics that must be authored in this domain pack:

| Item | Domain pack artifact | Notes |
| --- | --- | --- |
| UI object vocabulary | `ui-object-vocabulary.json` |  |
| Page / modal / route map | `discovery/page-map.json` |  |
| Component semantics | `discovery/component-inventory.json` |  |
| Reusable domain actions | `action-contracts/*.json` |  |
| Evidence requirements | `evidence-schema.json` |  |
| Package lint rules | `lint-rules.json` |  |
| Visual fallback / screenshot alignment | `discovery/visual-alignment.json` |  |
| Known product gaps / hazards | `AGENTS.md` or domain references |  |

### Testcase-Only Ownership

List values or expectations that belong only in this testcase package:

- Input values:
- Expected outcomes:
- Risk levels:
- Test target decisions:
- Cleanup expectations:

### Temporary Bridges

If any current behavior is only a compatibility bridge, name it and define the intended replacement contract:

| Bridge | Why needed | Replacement contract | Follow-up owner |
| --- | --- | --- | --- |
|  |  |  |  |

## 8. Risk Rules

Use the standard risk levels:

- `🟢 觀察`
- `🟡 建立`
- `🟠 修改`
- `🔴 刪除`

Feature-specific interpretation:

- Create:
- Modify:
- Delete:
- Cancel:
- Native confirm / browser dialog:

## 9. Test Target Rules

Use the standard test target values:

- `後端功能`
- `前端呈現`
- `前後端整合`
- `功能流程`

Feature-specific interpretation:

- UI state mismatch:
- Backend / network mismatch:
- Flow interrupted:
- Data unavailable:

## 10. Evidence Rules

Required evidence by case type:

- UI state:
- DOM state:
- Network request / response:
- Chart / table values:
- Downloaded file:
- Screenshot:

Forbidden evidence:

-

## 11. Resource Policy

- Temporary resource naming:
- Creation allowed:
- Update allowed:
- Delete allowed:
- Explicit approval required before:
- Resources that must never be touched:

## 12. Known Risks And Drift

| ID | Risk / Drift | Impact | Case Design Response |
| --- | --- | --- | --- |
| R-01 |  |  |  |
