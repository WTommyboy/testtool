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
    "run-state",
    "evidence-policy",
    "codex-runtime",
    "artifacts-and-results"
  ]) {
    add(ids, id);
  }

  const notes: string[] = ["Base rules keep current-run evidence, one-case guard, and result write discipline active."];
  const basedOn: string[] = [];

  if (pack) {
    const currentCase = getObject(pack.currentCase);
    const helperHints = getObject(pack.helperHints);
    const requiredEvidence = getStringArray(pack.requiredEvidence);
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
      `requiredEvidence=${requiredEvidence.join(", ") || "(missing)"}`
    );
    if (operationTemplate) {
      add(ids, "bi-ui-helper-guidance");
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
      addMatching(ids, /metadata|metadata摘要|BI系統_metadata/i);
      notes.push("Metadata/dropdown behavior may require BI metadata reference.");
    }
    if (/前端呈現|前後端整合|功能流程/.test(testTarget)) {
      add(ids, "bi-project-agents-full");
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
    id: "run-lifecycle",
    scope: "platform",
    filePath: path.join(skillRoot, "rules", "run-lifecycle.md"),
    loadWhen: ["cancel/resume", "state transition unclear"],
    summary: "Run lifecycle, cancellation and resume rules."
  });
  addIfExists(entries, runDir, {
    id: "bi-domain-entrypoint",
    scope: "domain",
    filePath: path.join(runDir, "input", "domain_AGENTS.md"),
    loadWhen: [`domain=${domain}`, "BI feature behavior unclear", "BI hard rule needed"],
    summary: "Downloaded domain pack entrypoint for BI."
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
    summary: "Three-file and Helper hints consistency report. If status=error, stop before browser and emit Tool Bridge ambiguity_decision."
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
      "Read input/test-package-consistency.json before browser execution; if status=error, emit Tool Bridge ambiguity_decision.",
      "Read input/document-consistency.json before browser execution; if status=error, emit Tool Bridge ambiguity_decision.",
      "Perform input/preflight-auth-check.md before deep domain rule loading or testcase actions.",
      "Read input/current-case-pack.md before loading full testcase/supporting docs.",
      "Use input/reference-index.json for exact paths before broad searches.",
      "Read input/run-state.json before using any carryover from prior case actions.",
      "Read input/current-case.json for the current case before the full workbook.",
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
