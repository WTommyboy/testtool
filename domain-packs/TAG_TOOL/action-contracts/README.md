# Action Contracts

Add one declarative action contract per supported helper action after UI discovery.

Action contracts describe params, allowed declarative operations, locator policy, and required evidence. Do not place arbitrary executable helper code in this directory.

## Current Contracts

- `tagList.json`: player tag list, populated/empty state, pagination, and row action menu variants.
- `createConditionTag.json`: condition tag create form, date panel, and sub-tag grade editor.
- `manualUpload.json`: manual tag add/edit CSV upload guidance and upload-state evidence.
- `tagInfoReadOnly.json`: read-only tag information, condition settings, manual member table, and manual edit-form observation.
- `tagVariableSettings.json`: N/Z/Y/X/A/B variable settings and history observation.
- `dangerousActions.json`: approval-gated delete, terminate, variable save, and manual edit submit flows.

## Safety Boundary

Contracts may describe destructive flows, but confirming delete, terminate, variable save, or manual edit submit requires explicit Tommy approval in the active run. Ordinary discovery and smoke should stop at read/cancel evidence.
