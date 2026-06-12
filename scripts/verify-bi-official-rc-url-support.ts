import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const srcPath = path.join(root, "agent", "src", "bi-ui-helper-executor.ts");
const distPath = path.join(root, "agent", "dist", "bi-ui-helper-executor.js");

const src = fs.readFileSync(srcPath, "utf8");
const dist = fs.readFileSync(distPath, "utf8");

for (const [label, text] of [
  ["src", src],
  ["dist", dist]
] as const) {
  assert(text.includes('"/bi-rc"'), `${label} helper URL allowlist must include /bi-rc`);
  assert(/bi-\(\?:dev\|rc\).*report\\\/myCustom\\\/tileMode/.test(text), `${label} project route matcher must support /bi-rc`);
  assert(/bi-\(\?:dev\|rc\).*report\\\/new/.test(text), `${label} editor route matcher must support /bi-rc`);
}

const rcProjectUrl = "https://galaxy.games.gamania.com/bi-rc/zh-TW/report/myCustom/tileMode/2";
const rcEditorUrl = "https://galaxy.games.gamania.com/bi-rc/zh-TW/report/new";
const devProjectUrl = "https://galaxy.games.gamania.com/bi-dev/zh-TW/report/myCustom/tileMode/2";
const projectRoutePattern = /\/bi-(?:dev|rc)\/[^/]+\/report\/myCustom\/tileMode\/[^/]+$/;
const editorRoutePattern = /\/bi-(?:dev|rc)\/[^/]+\/report\/new$/;

assert(projectRoutePattern.test(new URL(rcProjectUrl).pathname), "RC project deep link should match project route");
assert(editorRoutePattern.test(new URL(rcEditorUrl).pathname), "RC editor route should match editor route");
assert(projectRoutePattern.test(new URL(devProjectUrl).pathname), "dev project route should remain supported");

console.log("BI official RC URL support smoke passed");
console.log(`- rcProjectUrl=${rcProjectUrl}`);
console.log(`- rcEditorUrl=${rcEditorUrl}`);
