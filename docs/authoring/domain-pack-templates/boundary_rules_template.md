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

## 7. Risk Rules

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

## 8. Test Target Rules

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

## 9. Evidence Rules

Required evidence by case type:

- UI state:
- DOM state:
- Network request / response:
- Chart / table values:
- Downloaded file:
- Screenshot:

Forbidden evidence:

-

## 10. Resource Policy

- Temporary resource naming:
- Creation allowed:
- Update allowed:
- Delete allowed:
- Explicit approval required before:
- Resources that must never be touched:

## 11. Known Risks And Drift

| ID | Risk / Drift | Impact | Case Design Response |
| --- | --- | --- | --- |
| R-01 |  |  |  |
