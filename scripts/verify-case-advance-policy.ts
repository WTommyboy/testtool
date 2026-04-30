import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateCaseAdvancePolicy } from "../agent/src/case-advance-policy";

const main = (): void => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-case-advance-policy-"));
  try {
    const stopDoc = path.join(tempRoot, "startup.md");
    fs.writeFileSync(stopDoc, [
      "### Agent 模式暫停流程",
      "每次 run 以 `input/current-case.json` 為準,Codex 跑完該題後輸出結果即停止。",
      "若要逐題暫停執行 5 題,由工具/PM 重新派發下一題。",
      "Agent 不會自動 dispatch 下一 case。"
    ].join("\n"));
    const stop = evaluateCaseAdvancePolicy([{ label: "startup_instruction", filePath: stopDoc }]);
    assert.equal(stop.autoAdvance, false);
    assert.equal(stop.matchedSource, "startup_instruction");

    const continuousDoc = path.join(tempRoot, "continuous.md");
    fs.writeFileSync(continuousDoc, "執行順序: A-01 → A-02，未指定 Agent 單題停止。");
    const continuous = evaluateCaseAdvancePolicy([{ label: "startup_instruction", filePath: continuousDoc }]);
    assert.equal(continuous.autoAdvance, true);

    console.log(JSON.stringify({
      ok: true,
      fixture: "case-advance-policy",
      checked: [
        "Agent stop directive disables automatic next-case dispatch",
        "absence of stop directive keeps existing auto-advance behavior"
      ]
    }, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};

main();
