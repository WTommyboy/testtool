import fs from "node:fs";
import path from "node:path";

export type RuleIndexEntry = {
  id: string;
  scope: "platform" | "domain" | "input";
  path: string;
  loadWhen: string[];
  summary: string;
};

export type RuleIndex = {
  generatedAt: string;
  domain: string;
  entries: RuleIndexEntry[];
  loadingPolicy: string[];
  currentCaseRecommendations?: {
    basedOn: string[];
    ruleIds: string[];
    notes: string[];
  };
};

const relativePath = (runDir: string, filePath: string): string => {
  return path.relative(runDir, filePath).replaceAll(path.sep, "/");
};

const exists = (filePath: string): boolean => fs.existsSync(filePath) && fs.statSync(filePath).isFile();

const addIfExists = (
  entries: RuleIndexEntry[],
  runDir: string,
  input: Omit<RuleIndexEntry, "path"> & { filePath: string }
): void => {
  if (!exists(input.filePath)) return;
  entries.push({
    id: input.id,
    scope: input.scope,
    path: relativePath(runDir, input.filePath),
    loadWhen: input.loadWhen,
    summary: input.summary
  });
};

const readCurrentCasePack = (runDir: string): Record<string, unknown> | null => {
  const filePath = path.join(runDir, "input", "current-case-pack.json");
  if (!exists(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const getObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const getStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];

const buildCurrentCaseRecommendations = (runDir: string, entries: RuleIndexEntry[]): RuleIndex["currentCaseRecommendations"] => {
  const pack = readCurrentCasePack(runDir);
  const entryIds = new Set(entries.map((entry) => entry.id));
  const add = (ids: Set<string>, id: string) => {
    if (entryIds.has(id)) ids.add(id);
  };
  const addMatching = (ids: Set<string>, pattern: RegExp) => {
    const matched = entries.find((entry) => pattern.test(`${entry.id}\n${entry.path}\n${entry.summary}`));
    if (matched) ids.add(matched.id);
  };

  const ids = new Set<string>();
  for (const id of [
    "test-package-consistency",
    "document-consistency",
    "preflight-auth-check",
    "current-case",
    "current-case-pack",
    "current-case-pack-json",
    "capability-gate",
    "capability-gate-json",
    "helper-execution-plan",
    "helper-execution-plan-json",
    "run-state",
    "helper-protocol",
    "evidence-policy",
    "codex-runtime",
    "artifacts-and-results",
    "platform-domain-boundary"
  ]) {
    add(ids, id);
  }

  const notes: string[] = ["Base rules keep current-run evidence, one-case guard, and result write discipline active."];
  const basedOn: string[] = [];

  if (pack) {
    const currentCase = getObject(pack.currentCase);
    const helperHints = getObject(pack.helperHints);
    const requiredEvidence = getStringArray(pack.requiredEvidence);
    const mustReadRuleKeys = getStringArray(pack.mustReadRuleKeys);
    const operationTemplate =
      typeof helperHints?.operationTemplate === "string" ? helperHints.operationTemplate : null;
    const riskLevel = typeof currentCase?.riskLevel === "string" ? currentCase.riskLevel : "";
    const testTarget = typeof currentCase?.testTarget === "string" ? currentCase.testTarget : "";
    const cleanupChecklist = typeof currentCase?.cleanupChecklist === "string" ? currentCase.cleanupChecklist : "";
    basedOn.push(
      `riskLevel=${riskLevel || "(missing)"}`,
      `testTarget=${testTarget || "(missing)"}`,
      `cleanupChecklist=${cleanupChecklist || "(missing)"}`,
      `operationTemplate=${operationTemplate ?? "(missing)"}`,
      `requiredEvidence=${requiredEvidence.join(", ") || "(missing)"}`,
      `mustReadRuleKeys=${mustReadRuleKeys.join(", ") || "(missing)"}`
    );
    for (const id of mustReadRuleKeys) add(ids, id);
    if (mustReadRuleKeys.length > 0) {
      notes.push("Current-case pack provides mandatory rule keys; load these before testcase UI execution or result judgment.");
    }
    if (operationTemplate) {
      add(ids, "bi-ui-helper-guidance");
      add(ids, "helper-execution-plan");
      add(ids, "helper-execution-plan-json");
      notes.push("Helper hints are present; load BI UI helper guidance before page exploration.");
    }
    if (requiredEvidence.some((item) => item.startsWith("network."))) {
      add(ids, "network-observation-guidance");
      notes.push("Network evidence is required; observe only UI-triggered requests.");
    }
    if (/刪除|修改|建立/.test(riskLevel) || requiredEvidence.includes("toolBridge.response")) {
      add(ids, "tool-bridge");
      notes.push("Risk level or evidence may require Tool Bridge for irreversible/native dialog actions.");
    }
    if (/metadata|dropdown/i.test(operationTemplate ?? "") || /metadata|欄位清單|可選欄位/i.test(JSON.stringify(currentCase))) {
      add(ids, "reference-index");
      addMatching(ids, /metadata|metadata摘要|BI系統_metadata/i);
      notes.push("Metadata/dropdown behavior may require BI metadata reference.");
    }
    if (/collage|拼貼|metric|field|欄位|source|報表/i.test(`${operationTemplate ?? ""}\n${JSON.stringify(currentCase)}`)) {
      add(ids, "domain-ui-contract");
      add(ids, "domain-action-set-metric-rows");
      add(ids, "domain-evidence-schema");
      notes.push("Official collage UI behavior should use the domain UI/action/evidence contract when available.");
    }
    if (/csv|download|下載|匯出/i.test(`${operationTemplate ?? ""}\n${JSON.stringify(currentCase)}`)) {
      add(ids, "reference-index");
      add(ids, "evidence-template-index");
      add(ids, "bi-ui-helper-guidance");
      notes.push("CSV/download behavior requires UI-triggered CSV evidence, including UI-triggered response-body fallback when needed, or an explicit not-reached reason for earlier workflow failure.");
    }
    if (/前端呈現|前後端整合|功能流程/.test(testTarget)) {
      add(ids, "bi-project-agents-full");
      add(ids, "bi-locator-registry");
      add(ids, "domain-ui-contract");
      add(ids, "domain-discovery-page-map");
      add(ids, "domain-discovery-component-inventory");
    }
  } else {
    basedOn.push("current-case-pack.json=(unavailable)");
    notes.push("No current-case-pack JSON was readable when generating recommendations.");
  }

  return { basedOn, ruleIds: [...ids], notes };
};

export const writeRuleIndex = (runDir: string, domain: string): string => {
  const entries: RuleIndexEntry[] = [];
  const skillRoot = path.join(runDir, "agent-skills", "uat-tool");

  addIfExists(entries, runDir, {
    id: "platform-skill",
    scope: "platform",
    filePath: path.join(skillRoot, "SKILL.md"),
    loadWhen: ["run brief insufficient", "platform policy unclear"],
    summary: "Layer 1 platform overview. Do not load before the compact run brief unless a platform rule is ambiguous."
  });
  addIfExists(entries, runDir, {
    id: "domain-routing",
    scope: "platform",
    filePath: path.join(skillRoot, "rules", "domain-routing.md"),
    loadWhen: ["need domain selection", "feature/domain mapping unclear"],
    summary: "How to route a run to domain rules without mixing BI-specific rules into Layer 1."
  });
  addIfExists(entries, runDir, {
    id: "platform-domain-boundary",
    scope: "platform",
    filePath: path.join(skillRoot, "rules", "platform-domain-boundary.md"),
    loadWhen: [
      "platform/domain/testcase boundary",
      "new helper behavior",
      "domain pack generation",
      "temporary bridge",
      "where a rule belongs"
    ],
    summary:
      "Placement rule for platform runtime, platform vocabulary, domain pack data, testcase package values, and temporary bridges."
  });
  addIfExists(entries, runDir, {
    id: "tool-bridge",
    scope: "platform",
    filePath: path.join(skillRoot, "rules", "tool-bridge.md"),
    loadWhen: ["SSO/login", "native alert/confirm", "irreversible operation", "ambiguous blocker"],
    summary: "Tool Bridge request and waiting-user policy."
  });
  addIfExists(entries, runDir, {
    id: "evidence-policy",
    scope: "platform",
    filePath: path.join(skillRoot, "rules", "evidence-policy.md"),
    loadWhen: ["PASS/FAIL/BLOCKED decision", "stale evidence concern", "evidence sufficiency unclear"],
    summary: "Current-run evidence requirements. Existing data is not proof that this run performed an action."
  });
  addIfExists(entries, runDir, {
    id: "artifacts-and-results",
    scope: "platform",
    filePath: path.join(skillRoot, "rules", "artifacts-and-results.md"),
    loadWhen: ["writing result.xlsx", "partial artifacts", "cancel/fail artifact handling"],
    summary: "Result workbook and artifact expectations."
  });
  addIfExists(entries, runDir, {
    id: "codex-runtime",
    scope: "platform",
    filePath: path.join(skillRoot, "rules", "codex-runtime.md"),
    loadWhen: ["runtime behavior", "progress reporting", "one-case-at-a-time discipline"],
    summary: "Codex execution discipline inside the Agent. Keeps one case per execution/write cycle."
  });
  addIfExists(entries, runDir, {
    id: "agent-security",
    scope: "platform",
    filePath: path.join(skillRoot, "rules", "agent-security.md"),
    loadWhen: ["agent task boundary", "agent_busy", "token/file boundary", "task whitelist"],
    summary: "Mac Agent security boundary and active-run lock."
  });
  addIfExists(entries, runDir, {
    id: "helper-protocol",
    scope: "platform",
    filePath: path.join(skillRoot, "rules", "helper-protocol.md"),
    loadWhen: ["helper evidence", "helper artifact validation", "state delta planner", "warm session safety"],
    summary: "Helper artifact contract, hard rules, current-run evidence gate, and state delta planner boundaries."
  });
  addIfExists(entries, runDir, {
    id: "run-lifecycle",
    scope: "platform",
    filePath: path.join(skillRoot, "rules", "run-lifecycle.md"),
    loadWhen: ["cancel/resume", "state transition unclear"],
    summary: "Run lifecycle, cancellation and resume rules."
  });
  addIfExists(entries, runDir, {
    id: "diagnostic-mode",
    scope: "platform",
    filePath: path.join(skillRoot, "rules", "diagnostic-mode.md"),
    loadWhen: ["diagnostic execution", "run only part of a case", "fast iteration without trusted result"],
    summary: "Non-trusted fast iteration contract. Diagnostic artifacts cannot be uploaded as trusted UAT results."
  });
  addIfExists(entries, runDir, {
    id: "bi-domain-entrypoint",
    scope: "domain",
    filePath: path.join(runDir, "input", "domain_AGENTS.md"),
    loadWhen: [`domain=${domain}`, "BI feature behavior unclear", "BI hard rule needed"],
    summary: "Downloaded domain pack entrypoint for BI."
  });
  addIfExists(entries, runDir, {
    id: "bi-locator-registry",
    scope: "domain",
    filePath: path.join(runDir, "input", "domain_locator_registry.json"),
    loadWhen: ["BI UI operation", "selector exploration would be slow", "locator drift suspected"],
    summary: "BI locator hints for current UI flows. Guidance only; failed locators require visible UI fallback and drift logging."
  });
  addIfExists(entries, runDir, {
    id: "domain-ui-contract",
    scope: "domain",
    filePath: path.join(runDir, "input", "domain_ui_contract.json"),
    loadWhen: ["domain UI flow", "helper action planning", "evidence contract unclear", "official collage behavior"],
    summary: "Domain UI/action/evidence contract shared by testcase generation, helper planning, and result gates."
  });
  addIfExists(entries, runDir, {
    id: "domain-action-set-metric-rows",
    scope: "domain",
    filePath: path.join(runDir, "input", "domain_action_set_metric_rows.json"),
    loadWhen: ["official collage metric setup", "source report plus field selection", "helper setMetricRows params"],
    summary: "Official collage row-scoped metric setup contract. Requires metrics[].sourceReport and metrics[].field."
  });
  addIfExists(entries, runDir, {
    id: "domain-action-observe-frontend-state",
    scope: "domain",
    filePath: path.join(runDir, "input", "domain_action_observe_frontend_state.json"),
    loadWhen: ["official collage frontend observation", "UI state assertion", "I/J/K/L/M/N observation cases"],
    summary: "Official collage frontend observation contract. Defines user button, toolbar, radio, date panel, and validation evidence objects."
  });
  addIfExists(entries, runDir, {
    id: "domain-action-tag-list",
    scope: "domain",
    filePath: path.join(runDir, "input", "domain_action_tag_list.json"),
    loadWhen: ["TAG_TOOL list page", "player tag table", "row actions", "empty state"],
    summary: "TAG_TOOL player tag list observation and row-action contract."
  });
  addIfExists(entries, runDir, {
    id: "domain-action-create-condition-tag",
    scope: "domain",
    filePath: path.join(runDir, "input", "domain_action_create_condition_tag.json"),
    loadWhen: ["TAG_TOOL create page", "condition tag", "date panel", "tag value editor"],
    summary: "TAG_TOOL condition-tag create form and validation contract."
  });
  addIfExists(entries, runDir, {
    id: "domain-action-manual-upload",
    scope: "domain",
    filePath: path.join(runDir, "input", "domain_action_manual_upload.json"),
    loadWhen: ["TAG_TOOL manual tag", "CSV upload", "upload validation", "manual edit file"],
    summary: "TAG_TOOL manual-tag CSV upload and validation contract."
  });
  addIfExists(entries, runDir, {
    id: "domain-action-tag-variable-settings",
    scope: "domain",
    filePath: path.join(runDir, "input", "domain_action_tag_variable_settings.json"),
    loadWhen: ["TAG_TOOL variable settings", "N/Z/Y/X/A/B", "setting history", "variable save validation"],
    summary: "TAG_TOOL variable settings observation and approval-gated save contract."
  });
  addIfExists(entries, runDir, {
    id: "domain-action-dangerous-actions",
    scope: "domain",
    filePath: path.join(runDir, "input", "domain_action_dangerous_actions.json"),
    loadWhen: ["TAG_TOOL delete", "TAG_TOOL terminate", "danger confirmation", "approval gate"],
    summary: "TAG_TOOL destructive or high-risk action contract requiring Tool Bridge approval for confirm flows."
  });
  addIfExists(entries, runDir, {
    id: "domain-case-scope-contracts",
    scope: "domain",
    filePath: path.join(runDir, "input", "domain_case_scope_contracts.json"),
    loadWhen: ["case scope", "action target expected outcome", "PASS/FAIL/BLOCKED judgment", "helper routing"],
    summary: "Structured action/object case scope contracts for the current official BI UI bridge."
  });
  addIfExists(entries, runDir, {
    id: "domain-ui-object-vocabulary",
    scope: "domain",
    filePath: path.join(runDir, "input", "domain_ui_object_vocabulary.json"),
    loadWhen: ["UI object id", "locator semantics", "official BI UI action target", "visual alignment"],
    summary: "Official BI UI object ids, supported platform actions, locator hints, and current known product gaps."
  });
  addIfExists(entries, runDir, {
    id: "domain-evidence-schema",
    scope: "domain",
    filePath: path.join(runDir, "input", "domain_evidence_schema.json"),
    loadWhen: ["domain evidence sufficiency unclear", "Tool Bridge conditional evidence", "result gate ambiguity"],
    summary: "Domain current-run evidence schema, including conditional Tool Bridge rules."
  });
  addIfExists(entries, runDir, {
    id: "domain-lint-rules",
    scope: "domain",
    filePath: path.join(runDir, "input", "domain_lint_rules.json"),
    loadWhen: ["testcase package lint", "helper capability mismatch", "new testcase authoring review"],
    summary: "Domain testcase lint expectations for official collage helper-compatible cases."
  });
  addIfExists(entries, runDir, {
    id: "domain-discovery-page-map",
    scope: "domain",
    filePath: path.join(runDir, "input", "domain_discovery_page_map.json"),
    loadWhen: ["official UI navigation", "page state unclear", "project list or editor entry flow"],
    summary: "Reviewed page map from Domain UI Discovery. Raw DOM remains artifact-only."
  });
  addIfExists(entries, runDir, {
    id: "domain-discovery-component-inventory",
    scope: "domain",
    filePath: path.join(runDir, "input", "domain_discovery_component_inventory.json"),
    loadWhen: ["component locator exploration", "picker row-scoping", "official UI component behavior"],
    summary: "Reviewed component inventory from Domain UI Discovery for official collage flows."
  });
  addIfExists(entries, runDir, {
    id: "bi-project-agents-full",
    scope: "domain",
    filePath: path.join(runDir, "rules", "PROJECT_AGENTS_FULL.md"),
    loadWhen: ["BI domain pack is insufficient", "legacy BI rule detail needed"],
    summary: "Legacy BI-specific AGENTS.md copied from the project root. Use as a domain reference, not a platform rule."
  });

  const biRulesDir = path.join(runDir, "rules", "BI_TEST_RULES");
  if (fs.existsSync(biRulesDir)) {
    for (const entry of fs.readdirSync(biRulesDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const filePath = path.join(biRulesDir, entry.name);
      entries.push({
        id: `bi-rule-${entry.name.replace(/\.md$/i, "")}`,
        scope: "domain",
        path: relativePath(runDir, filePath),
        loadWhen: ["BI case requires exact method", "metadata/background detail needed"],
        summary: `BI rulebook: ${entry.name}`
      });
    }
  }

  addIfExists(entries, runDir, {
    id: "preflight-auth-check",
    scope: "input",
    filePath: path.join(runDir, "input", "preflight-auth-check.md"),
    loadWhen: ["before first browser action", "auth/reachability check", "SSO or login suspected"],
    summary: "Minimal preflight contract. Check DEV URL reachability/login only before deep rule loading or testcase actions."
  });
  addIfExists(entries, runDir, {
    id: "test-package-consistency",
    scope: "input",
    filePath: path.join(runDir, "input", "test-package-consistency.json"),
    loadWhen: ["before browser execution", "testcase package warning/error", "Helper hints conflict"],
    summary: "Whole-package testcase and Helper hints audit. Use document-consistency as the current-case browser gate; package warnings/errors may include future cases."
  });
  addIfExists(entries, runDir, {
    id: "document-consistency",
    scope: "input",
    filePath: path.join(runDir, "input", "document-consistency.json"),
    loadWhen: ["before browser execution", "startup instruction conflicts with workbook", "current case ambiguity"],
    summary: "Document conflict gate. If status=error, stop before browser and emit Tool Bridge ambiguity_decision."
  });
  addIfExists(entries, runDir, {
    id: "reference-index",
    scope: "input",
    filePath: path.join(runDir, "input", "reference-index.json"),
    loadWhen: ["need exact file path", "avoid broad filesystem search", "supporting document lookup"],
    summary: "Exact input/generated/reference paths for this run."
  });
  addIfExists(entries, runDir, {
    id: "supporting-docs-manifest",
    scope: "input",
    filePath: path.join(runDir, "input", "supporting-docs-manifest.json"),
    loadWhen: ["need supporting document role", "startup instruction references extra md", "avoid bulk-read supporting docs"],
    summary: "Downloaded file roles and load policy."
  });
  addIfExists(entries, runDir, {
    id: "run-state",
    scope: "input",
    filePath: path.join(runDir, "input", "run-state.json"),
    loadWhen: ["before current case execution", "carryover needed", "stale evidence concern"],
    summary: "Allowed carryover and isolated evidence policy for this run. Previous-case evidence cannot prove later cases."
  });
  addIfExists(entries, runDir, {
    id: "case-manifest",
    scope: "input",
    filePath: path.join(runDir, "input", "case-manifest.json"),
    loadWhen: ["need case list", "need next case pointer"],
    summary: "Index of testcase rows. Navigation only; never permission to batch-execute multiple cases."
  });
  addIfExists(entries, runDir, {
    id: "current-case",
    scope: "input",
    filePath: path.join(runDir, "input", "current-case.json"),
    loadWhen: ["starting execution", "need current case detail"],
    summary: "The first/current case only. Read this before opening the full workbook."
  });
  addIfExists(entries, runDir, {
    id: "current-case-pack",
    scope: "input",
    filePath: path.join(runDir, "input", "current-case-pack.md"),
    loadWhen: ["starting execution", "need current case summary", "need evidence requirements"],
    summary: "Compact execution card for the current case. Plan only; not a result."
  });
  addIfExists(entries, runDir, {
    id: "current-case-pack-json",
    scope: "input",
    filePath: path.join(runDir, "input", "current-case-pack.json"),
    loadWhen: ["need structured evidence requirements", "need screenshot policy", "case plan cross-check"],
    summary: "Structured current-case pack with required evidence and screenshot policy."
  });
  addIfExists(entries, runDir, {
    id: "capability-gate",
    scope: "input",
    filePath: path.join(runDir, "input", "capability-gate.md"),
    loadWhen: ["before testcase UI execution", "helper support decision", "unsupported filter/group/detail/metric case"],
    summary: "Online trusted-run capability gate. If unsupported, write BLOCKED/UNSUPPORTED_ONLINE_CAPABILITY instead of falling back to unsupported helper/manual paths."
  });
  addIfExists(entries, runDir, {
    id: "capability-gate-json",
    scope: "input",
    filePath: path.join(runDir, "input", "capability-gate.json"),
    loadWhen: ["need structured supportStatus", "deciding helper pre-run", "unsupported capability reason"],
    summary: "Structured capability gate used by Agent helper pre-run and Codex dispatch."
  });
  addIfExists(entries, runDir, {
    id: "helper-execution-plan",
    scope: "input",
    filePath: path.join(runDir, "input", "helper-execution-plan.md"),
    loadWhen: ["helper-assisted UI operation", "need step-scoped helper actions", "avoid ad hoc UI exploration"],
    summary: "Single-case helper execution plan. Helper actions operate UI and collect evidence only; Codex still judges result."
  });
  addIfExists(entries, runDir, {
    id: "helper-execution-plan-json",
    scope: "input",
    filePath: path.join(runDir, "input", "helper-execution-plan.json"),
    loadWhen: ["need structured helper action list", "need helper artifact path", "checking Tool Bridge-required helper action"],
    summary: "Structured helper execution plan with action templates, evidence requirements, and Tool Bridge flags."
  });
  addIfExists(entries, runDir, {
    id: "bi-ui-helper-guidance",
    scope: "domain",
    filePath: path.join(runDir, "input", "bi-ui-helper-guidance.md"),
    loadWhen: ["BI UI operation", "need safe Playwright recipe", "reduce UI exploration"],
    summary: "Safe BI UI recipes. Guidance only; does not permit internal state setters or multi-case batching."
  });
  addIfExists(entries, runDir, {
    id: "evidence-template-index",
    scope: "input",
    filePath: path.join(runDir, "input", "evidence-templates", "index.json"),
    loadWhen: ["need evidence shape", "writing detail_json", "checking required evidence"],
    summary: "Evidence template index. Choose only the template named by current-case-pack."
  });
  addIfExists(entries, runDir, {
    id: "result-template",
    scope: "input",
    filePath: path.join(runDir, "input", "result-template.xlsx"),
    loadWhen: ["writing output/result.xlsx", "need workbook columns"],
    summary: "Template workbook for result shape. Codex must still write output/result.xlsx one case at a time."
  });
  addIfExists(entries, runDir, {
    id: "network-observation-guidance",
    scope: "input",
    filePath: path.join(runDir, "input", "network-observation-guidance.md"),
    loadWhen: ["request body evidence needed", "network observation needed", "avoid direct API use"],
    summary: "Safe network observation guidance. UI-triggered observation only; no direct BI API substitution."
  });

  const index: RuleIndex = {
    generatedAt: new Date().toISOString(),
    domain,
    entries,
    currentCaseRecommendations: buildCurrentCaseRecommendations(runDir, entries),
    loadingPolicy: [
      "Read input/run-brief.md first.",
      "Read input/test-package-consistency.json before browser execution for whole-package context; it is not the current-case browser gate by itself.",
      "Read input/document-consistency.json before browser execution; if status=error, emit Tool Bridge ambiguity_decision.",
      "Read input/capability-gate.md before testcase UI execution; if supportStatus=unsupported, do not run trusted browser testcase steps.",
      "Perform input/preflight-auth-check.md before deep domain rule loading or testcase actions unless successful current-run helper evidence already covers this same case's browser evidence.",
      "Read input/current-case-pack.md before loading full testcase/supporting docs.",
      "Use input/reference-index.json for exact paths before broad searches.",
      "Use input/supporting-docs-manifest.json profiles to identify optional reference CSV/text files before loading them in full.",
      "Read input/run-state.json before using any carryover from prior case actions.",
      "Read input/current-case.json for the current case before the full workbook.",
      "If input/current-case-pack.json has mustReadRuleKeys, load those rule files before testcase UI execution or result judgment.",
      "Use currentCaseRecommendations.ruleIds as the first-pass rule shortlist for the active case.",
      "Use this index to choose the smallest rule file that answers the current question.",
      "Do not read all BI rules before the first UI action unless a blocker requires exact policy text.",
      "Do not use the case manifest to batch execute cases. It is an index only."
    ]
  };

  const outputPath = path.join(runDir, "input", "rule-index.json");
  fs.writeFileSync(outputPath, `${JSON.stringify(index, null, 2)}\n`);
  return outputPath;
};
