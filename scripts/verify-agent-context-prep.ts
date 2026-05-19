import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultAgentConfig } from "../agent/src/config";
import { copyDirectoryIfExists, copyIfExists, prepareCodexContext } from "../agent/src/task-runner";

type Failure = {
  check: string;
  message: string;
  observed?: unknown;
};

const root = process.cwd();
const source = path.join(root, "agent-skills", "uat-tool");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-agent-context-prep-"));
const target = path.join(tempRoot, "run", "agent-skills", "uat-tool");
const failures: Failure[] = [];

const fail = (failure: Failure): void => {
  failures.push(failure);
};

try {
  const copied = copyDirectoryIfExists(source, target);
  if (!copied) {
    fail({
      check: "copy_platform_skill",
      message: "Agent context preparation must copy agent-skills/uat-tool without crashing or silently skipping it.",
      observed: { source, target }
    });
  }

  const requiredFiles = [
    "SKILL.md",
    path.join("rules", "domain-routing.md"),
    path.join("rules", "helper-protocol.md"),
    path.join("rules", "artifacts-and-results.md")
  ];
  for (const relativePath of requiredFiles) {
    const filePath = path.join(target, relativePath);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      fail({
        check: "copied_required_skill_file",
        message: "Prepared run workspace is missing a required platform skill file.",
        observed: { relativePath, filePath }
      });
    }
  }

  const taskRunnerSource = fs.readFileSync(path.join(root, "agent", "src", "task-runner.ts"), "utf8");
  if (/fs\.cpSync\(/.test(taskRunnerSource)) {
    fail({
      check: "avoid_launchd_fs_cpsync_regression",
      message: "task-runner must not use fs.cpSync for platform skill copy; launchd hit a native filesystem abort on this path."
    });
  }

  const fileCopySource = path.join(tempRoot, "source-AGENTS.md");
  const fileCopyTarget = path.join(tempRoot, "copy-target", "PROJECT_AGENTS_FULL.md");
  fs.writeFileSync(fileCopySource, "# source agents\n\ncopy fallback fixture\n");
  const originalCopyFileSync = fs.copyFileSync;
  try {
    fs.copyFileSync = ((from: fs.PathOrFileDescriptor, to: fs.PathOrFileDescriptor, mode?: number) => {
      if (String(from) === fileCopySource) {
        const error = new Error("simulated EPERM during copyfile") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      return originalCopyFileSync.call(fs, from, to, mode);
    }) as typeof fs.copyFileSync;
    const copiedWithFallback = copyIfExists(fileCopySource, fileCopyTarget);
    if (!copiedWithFallback || fs.readFileSync(fileCopyTarget, "utf8") !== fs.readFileSync(fileCopySource, "utf8")) {
      fail({
        check: "copy_file_fallback_after_eperm",
        message: "copyIfExists must fall back to readFile/writeFile when copyFileSync hits EPERM.",
        observed: { copiedWithFallback, fileCopySource, fileCopyTarget }
      });
    }
  } finally {
    fs.copyFileSync = originalCopyFileSync;
  }

  const workspaceRoot = path.join(tempRoot, "workspace");
  const runDir = path.join(tempRoot, "run-context");
  fs.mkdirSync(path.join(workspaceRoot, "BI_TEST_RULES"), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "BI_DATA"), { recursive: true });
  const workspaceAgents = path.join(workspaceRoot, "AGENTS.md");
  fs.writeFileSync(workspaceAgents, "# Workspace AGENTS\n\ncontext prep EPERM fixture\n");
  fs.writeFileSync(path.join(workspaceRoot, "BI_TEST_RULES", "rule.md"), "# BI Rule\n");
  fs.writeFileSync(path.join(workspaceRoot, "BI_DATA", "metadata.csv"), "field,name\nA,Alpha\n");
  const config = defaultAgentConfig({
    codex_workspace_root: workspaceRoot,
    workdir_root: path.join(tempRoot, "runs"),
    chrome_profile_dir: path.join(tempRoot, "chrome-profile")
  });
  const originalContextCopyFileSync = fs.copyFileSync;
  try {
    fs.copyFileSync = ((from: fs.PathOrFileDescriptor, to: fs.PathOrFileDescriptor, mode?: number) => {
      if (String(from) === workspaceAgents) {
        const error = new Error("simulated AGENTS.md EPERM during context prep") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      return originalContextCopyFileSync.call(fs, from, to, mode);
    }) as typeof fs.copyFileSync;
    prepareCodexContext(config, runDir);
  } catch (error) {
    fail({
      check: "prepare_context_survives_agents_copyfile_eperm",
      message: "prepareCodexContext must not throw when copying workspace AGENTS.md hits EPERM.",
      observed: error instanceof Error ? error.message : String(error)
    });
  } finally {
    fs.copyFileSync = originalContextCopyFileSync;
  }

  const preparedProjectAgents = path.join(runDir, "rules", "PROJECT_AGENTS_FULL.md");
  const preparedContext = path.join(runDir, "input", "codex-context.json");
  const preparedSkill = path.join(runDir, "agent-skills", "uat-tool", "SKILL.md");
  for (const [check, filePath] of [
    ["prepared_project_agents_after_eperm", preparedProjectAgents],
    ["prepared_codex_context_after_eperm", preparedContext],
    ["prepared_platform_skill_after_eperm", preparedSkill]
  ] as const) {
    if (!fs.existsSync(filePath)) {
      fail({
        check,
        message: "Context prep should leave the run workspace usable even after AGENTS.md copyFileSync EPERM.",
        observed: { filePath }
      });
    }
  }
  if (fs.existsSync(preparedProjectAgents) && fs.readFileSync(preparedProjectAgents, "utf8") !== fs.readFileSync(workspaceAgents, "utf8")) {
    fail({
      check: "prepared_project_agents_content_after_eperm",
      message: "PROJECT_AGENTS_FULL.md should be copied by readFile/writeFile fallback when copyFileSync fails.",
      observed: { preparedProjectAgents }
    });
  }

  const result = {
    ok: failures.length === 0,
    source,
    copied,
    failureCount: failures.length,
    failures
  };
  console.log(JSON.stringify(result, null, 2));
  if (failures.length > 0) process.exitCode = 1;
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
