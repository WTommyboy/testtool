import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "uat-agent-runtime-file-access-"));
const helperExecutor = path.join(root, "agent", "dist", "bi-ui-helper-executor.js");
const platformSkillDir = path.join(root, "agent-skills", "uat-tool");
const readableStreamAsyncIterator = path.join(root, "node_modules", "readable-stream", "lib", "internal", "streams", "async_iterator.js");

const runNode = (args: string[], options: { cwd?: string } = {}) => {
  return spawnSync(process.execPath, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" }
  });
};

const directReadProbe = [
  "const fs=require('fs');",
  "const path=require('path');",
  `const root=${JSON.stringify(root)};`,
  "const paths=process.argv.slice(1);",
  "for (const p of paths) {",
  "  const s=fs.statSync(p);",
  "  if (s.isDirectory()) fs.readdirSync(p);",
  "  else fs.readFileSync(p);",
  "}",
  "require(require.resolve('exceljs', { paths: [root] }));",
  "require(require.resolve('readable-stream/lib/internal/streams/async_iterator.js', { paths: [root] }));",
  "console.log('runtime-file-access-ok');"
].join(" ");

const readProbe = runNode(["-e", directReadProbe, helperExecutor, platformSkillDir, readableStreamAsyncIterator], { cwd: runDir });
assert.equal(
  readProbe.status,
  0,
  `runtime file read probe failed\nstdout:\n${readProbe.stdout}\nstderr:\n${readProbe.stderr}`
);
assert.match(readProbe.stdout, /runtime-file-access-ok/);

const helperLoadProbe = runNode([helperExecutor, "--help"], { cwd: runDir });
assert.notEqual(helperLoadProbe.status, 0, "helper --help should exit non-zero because the CLI requires run/action args");
assert.match(
  helperLoadProbe.stderr,
  /Usage: node bi-ui-helper-executor\.js/,
  `helper executor did not load far enough to print usage\nstdout:\n${helperLoadProbe.stdout}\nstderr:\n${helperLoadProbe.stderr}`
);
assert.doesNotMatch(
  `${helperLoadProbe.stdout}\n${helperLoadProbe.stderr}`,
  /EPERM: operation not permitted|EACCES: permission denied/,
  "helper executor load hit a filesystem permission error"
);

console.log(JSON.stringify({
  ok: true,
  checked: {
    helperExecutor,
    platformSkillDir,
    readableStreamAsyncIterator,
    exceljs: true
  },
  helperLoadProbe: {
    status: helperLoadProbe.status,
    expectedUsageError: true
  }
}, null, 2));
