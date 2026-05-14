# Domain Intake Template

> Purpose: capture the minimum context needed before creating a new UAT Tool domain pack.
> Keep this file factual. Do not leave decisions only in chat.

---

## 1. Basic Info

- Feature / tool name:
- Proposed domain pack name:
- Owner / PM:
- Target environment:
- Dev URL:
- Production URL, if known:
- Required SSO / login precondition:
- Target UAT Tool environment for first run: dev / prod

## 2. Why This Is A New Domain Pack

Explain why this should not reuse an existing domain pack.

- New UI:
- New product area:
- New execution discipline:
- New evidence / result contract:
- Existing cases to preserve:
- Existing helper / locator reuse:

## 3. Source Materials

### PRD / Spec

- Primary PRD:
- Secondary PRD / design spec:
- Business rules source:

### UI References

- Screenshot folder:
- Design file, if any:
- Live preflight notes:
- Known UI drift from PRD:

### Existing Test Assets

- Existing testcase xlsx:
- Existing Codex assignment md:
- Existing execution instruction md:
- Existing BDD / checklist:
- Cases that must be preserved:
- Cases that should be retired or skipped:

## 4. Scope

### In Scope

- Mode / module:
- User flows:
- Data logic:
- UI behavior:
- Download / export:
- Create / update / delete:

### Out Of Scope

- Modes / modules excluded:
- Flows excluded:
- Data sources excluded:
- Cross-mode comparisons excluded:

## 5. Specification Priority

Use concrete order.

1. PRD / spec:
2. Live official UI:
3. Existing testcase:
4. Common UAT rules:

Conflict handling:

- If PRD and UI disagree:
- If existing testcase and PRD disagree:
- If screenshots and live UI disagree:

## 6. Test Data And Resource Policy

- Allowed to create temporary resources: yes / no
- Allowed to update existing resources: yes / no
- Allowed to delete temporary resources: yes / no
- Allowed to delete existing UAT-created resources: yes / no
- Resources that must never be deleted:
- Naming rule for temporary resources:
- Cleanup expectation after run:

## 7. UI Text And Visual Rules

- Text matching: exact / semantic
- Tooltip text required: exact / semantic / appearance only
- Hover-only controls in scope: yes / no
- Disabled / enabled states in scope: yes / no
- Responsive viewport requirements:

## 8. Execution Constraints

- Must use visible UI:
- API usage allowed only for observation:
- Internal JS setters prohibited:
- Read-only DOM / network extraction allowed:
- One-case-at-a-time requirement:
- Irreversible action approval:
- Required screenshots / evidence:

## 9. Case Design Targets

### Existing Case Preservation

- Preserve all existing cases: yes / no
- Existing case count:
- Allowed changes to existing cases:
- Disallowed changes to existing cases:

### New Case Groups

- Group A:
- Group B:
- Group C:
- Group D:

### Required Negative / Edge Cases

- Limit handling:
- Duplicate name:
- Empty state:
- Validation message:
- Cancel path:
- Delete confirmation path:

## 10. Open Decisions

List decisions that block authoring.

| ID | Question | Owner | Decision | Date |
| --- | --- | --- | --- | --- |
| D-01 |  |  |  |  |

## 11. Finalized Decisions

Move answered decisions here.

| ID | Decision | Source | Date |
| --- | --- | --- | --- |
| F-01 |  |  |  |
