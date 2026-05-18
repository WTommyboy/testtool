import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyDirectoryIfExists } from "../agent/src/task-runner";

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
