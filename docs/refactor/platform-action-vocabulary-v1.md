# Platform Action Vocabulary v1

Date: 2026-05-18 Asia/Taipei
Status: draft implemented as `contracts/platform-action-vocabulary.v1.json`

## 1. Purpose

The action vocabulary gives testcase authors, package builders, planners, helper execution plans, interaction logs, and result gates the same generic action names.

It is intentionally not a domain UI object map. Platform action names describe what kind of operation is being performed (`click`, `hover`, `assertNoRequest`). Domain packs describe which concrete UI object the action targets.

## 2. Layer Boundary

Platform owns:

- action ids
- action kind taxonomy
- lifecycle roles
- expected outcome names
- interaction logging vocabulary
- assertion semantics that are not domain-specific

Domain pack owns:

- UI object ids
- aliases and locator maps
- domain-specific action templates
- allowed evidence sources per object
- hazards and cleanup semantics

Testcase/run owns:

- case-specific values
- target UI object ids
- `testTarget`
- `judgmentPolicy`
- `requiredActions`
- `expectedOutcome` per action

## 3. Action Kinds

`primitive` actions are atomic user or read actions:

- `navigate`, `open`, `close`, `click`, `hover`, `type`, `clear`, `select`, `confirm`, `cancel`, `search`, `execute`, `create`, `delete`, `download`
- planned generic primitives: `pressKey`, `scroll`, `upload`, `drag`

`assertion` actions check evidence:

- `read`, `assertVisible`, `assertHidden`, `assertText`, `assertValue`, `assertEnabled`, `assertDisabled`, `assertSelected`, `assertChecked`, `assertRequest`, `assertNoRequest`, `assertDownload`, `assertToast`, `assertTooltip`, `assertStateChanged`, `assertStateUnchanged`, `compare`

`composite` actions are reusable generic patterns:

- `openAndSearchPicker`
- `openPanelAndCancel`
- `clickAndAssertToast`
- `hoverAndAssertTooltip`
- `executeAndCollectRequest`
- `downloadAndAssertArtifact`

Composite actions are not domain-specific helpers. They only define generic action sequences. Domain packs still provide the target objects and locators.

## 4. Expected Outcomes

The initial v1 outcome names are:

- `succeeded`
- `disabled_or_no_change`
- `visible`
- `hidden`
- `text_matches`
- `value_matches`
- `selected`
- `checked`
- `unchecked`
- `state_changed`
- `state_unchanged`
- `request_sent`
- `request_not_sent`
- `download_started`
- `toast_visible`
- `tooltip_visible`

Result judgment should compare actual interaction outcome against expected outcome. It must not treat `dispatched_no_change` as always FAIL, because some cases intentionally expect no change.

## 5. Authoring Rule

Future xlsx and md should be generated from the same canonical action/object definitions:

```yaml
requiredActions:
  - action: click
    target: <domain-owned-ui-object-id>
    role: under_test
    expectedOutcome: selected
    evidenceRequirements:
      - assertSelected
      - assertStateChanged
```

The human-readable step can keep domain-specific wording, but the execution package should carry a canonical platform `action` and a domain-owned `target`.

## 6. Verification

Run:

```bash
npm run verify:platform-action-vocabulary
```

The verifier checks:

- action ids are unique.
- required action kinds exist.
- composite actions reference existing primitives/assertions.

Project-specific extraction and coverage checks are intentionally outside this platform document. They live in fixture files and are verified separately:

```bash
npm run verify:action-vocabulary-fixtures
```
