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
    id: "bi-ui-helper-guidance",
    scope: "domain",
    filePath: path.join(runDir, "input", "bi-ui-helper-guidance.md"),
    loadWhen: ["BI UI operation", "need safe Playwright recipe", "reduce UI exploration"],
    summary: "Safe BI UI recipes. Guidance only; does not permit internal state setters or multi-case batching."
  });

  const index: RuleIndex = {
    generatedAt: new Date().toISOString(),
    domain,
    entries,
    loadingPolicy: [
      "Read input/run-brief.md first.",
      "Read input/current-case.json for the current case before the full workbook.",
      "Use this index to choose the smallest rule file that answers the current question.",
      "Do not read all BI rules before the first UI action unless a blocker requires exact policy text.",
      "Do not use the case manifest to batch execute cases. It is an index only."
    ]
  };

  const outputPath = path.join(runDir, "input", "rule-index.json");
  fs.writeFileSync(outputPath, `${JSON.stringify(index, null, 2)}\n`);
  return outputPath;
};
