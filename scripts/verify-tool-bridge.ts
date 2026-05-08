import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseToolRequests } from "../src/agent-protocol/tool-bridge";
import { scanToolBridgePolicyViolationsForTest } from "../agent/src/task-runner";

type Fixture = {
  name: string;
  input: string;
  requestCount: number;
  validCount: number;
  warningCodes?: string[];
};

const wrap = (json: string): string => `[TOOL_REQUEST]\n${json}\n[/TOOL_REQUEST]`;

const validIrreversible = (id: string): string =>
  JSON.stringify({
    type: "irreversible_operation",
    request_id: id,
    case: "A-01",
    action: "Delete temporary report",
    reason: "Case requires validating delete confirmation."
  });

const validAmbiguity = (id: string): string =>
  JSON.stringify({
    type: "ambiguity_decision",
    request_id: id,
    case: "B-02",
    context: "Two projects match the requested name.",
    options: ["Use first project", "Pause for PM confirmation"],
    recommendation: "Pause for PM confirmation"
  });

const validRecovery = (id: string): string =>
  JSON.stringify({
    type: "playwright_recovery",
    request_id: id,
    error: "Target page has been closed",
    proposed_action: "Restart Playwright MCP session"
  });

const validMissingPrerequisite = (): string =>
  JSON.stringify({
    type: "missing_prerequisite",
    missing: ["uploaded testcase workbook", "startup instruction markdown"],
    reason: "Cannot execute UAT without the testcase package."
  });

const fixtures: Fixture[] = [
  {
    name: "single irreversible request",
    input: wrap(validIrreversible("req-001")),
    requestCount: 1,
    validCount: 1
  },
  {
    name: "irreversible accepts proposed_action alias and extracts demo case from request id",
    input: wrap(
      JSON.stringify({
        type: "irreversible_operation",
        request_id: "14b6f8b7-a211-43a2-a53b-fd949a3a073d-demo-a01-save",
        reason: "Save flow requires native alert/confirm approval.",
        proposed_action: "Authorize saving timestamped temporary report."
      })
    ),
    requestCount: 1,
    validCount: 1
  },
  {
    name: "irreversible accepts case_no and requested_action aliases",
    input: wrap(
      JSON.stringify({
        type: "irreversible_operation",
        request_id: "req-001b",
        case_no: "DEMO-B-01",
        reason: "Native confirm is expected.",
        requested_action: "Authorize confirm acceptance."
      })
    ),
    requestCount: 1,
    validCount: 1
  },
  {
    name: "single ambiguity request",
    input: wrap(validAmbiguity("req-002")),
    requestCount: 1,
    validCount: 1
  },
  {
    name: "single playwright recovery request",
    input: wrap(validRecovery("req-003")),
    requestCount: 1,
    validCount: 1
  },
  {
    name: "playwright recovery accepts SSO alias fields",
    input: wrap(
      JSON.stringify({
        type: "playwright_recovery",
        request_id: "req-003b",
        reason: "LOGIN_REQUIRED: BI page shows 載入失敗",
        requested_action: "Tommy completes SSO in the persistent Chrome window, then clicks 已處理."
      })
    ),
    requestCount: 1,
    validCount: 1
  },
  {
    name: "diagnostic missing prerequisite request does not require request id",
    input: wrap(validMissingPrerequisite()),
    requestCount: 1,
    validCount: 1
  },
  {
    name: "request in json fence",
    input: wrap(`\`\`\`json\n${validIrreversible("req-004")}\n\`\`\``),
    requestCount: 1,
    validCount: 1
  },
  {
    name: "request in plain fence",
    input: wrap(`\`\`\`\n${validRecovery("req-005")}\n\`\`\``),
    requestCount: 1,
    validCount: 1
  },
  {
    name: "ansi noise around request",
    input: `\u001b[32mstdout\u001b[0m\n${wrap(validIrreversible("req-006"))}`,
    requestCount: 1,
    validCount: 1
  },
  {
    name: "two valid requests",
    input: `${wrap(validIrreversible("req-007"))}\nnoise\n${wrap(validAmbiguity("req-008"))}`,
    requestCount: 2,
    validCount: 2
  },
  {
    name: "duplicate request id invalidates second request",
    input: `${wrap(validIrreversible("req-009"))}\n${wrap(validRecovery("req-009"))}`,
    requestCount: 2,
    validCount: 1,
    warningCodes: ["DUPLICATE_REQUEST_ID"]
  },
  {
    name: "invalid json warning",
    input: wrap("{not-json"),
    requestCount: 0,
    validCount: 0,
    warningCodes: ["INVALID_JSON"]
  },
  {
    name: "truncated request warning",
    input: `[TOOL_REQUEST]\n${validIrreversible("req-010")}`,
    requestCount: 0,
    validCount: 0,
    warningCodes: ["TRUNCATED_REQUEST"]
  },
  {
    name: "unknown type invalid",
    input: wrap(JSON.stringify({ type: "shell_exec", request_id: "req-011", command: "rm -rf /" })),
    requestCount: 1,
    validCount: 0,
    warningCodes: ["UNKNOWN_TYPE"]
  },
  {
    name: "missing request id invalid",
    input: wrap(JSON.stringify({ type: "playwright_recovery", error: "x", proposed_action: "y" })),
    requestCount: 1,
    validCount: 0,
    warningCodes: ["MISSING_REQUEST_ID"]
  },
  {
    name: "irreversible missing action invalid",
    input: wrap(JSON.stringify({ type: "irreversible_operation", request_id: "req-012", case: "A-01", reason: "x" })),
    requestCount: 1,
    validCount: 0,
    warningCodes: ["MISSING_ACTION"]
  },
  {
    name: "ambiguity options too short invalid",
    input: wrap(
      JSON.stringify({
        type: "ambiguity_decision",
        request_id: "req-013",
        case: "B-02",
        context: "x",
        options: ["only one"],
        recommendation: "only one"
      })
    ),
    requestCount: 1,
    validCount: 0,
    warningCodes: ["INVALID_OPTIONS"]
  },
  {
    name: "playwright recovery missing proposed action invalid",
    input: wrap(JSON.stringify({ type: "playwright_recovery", request_id: "req-014", error: "x" })),
    requestCount: 1,
    validCount: 0,
    warningCodes: ["MISSING_PROPOSED_ACTION"]
  },
  {
    name: "missing prerequisite missing list invalid",
    input: wrap(JSON.stringify({ type: "missing_prerequisite", reason: "x" })),
    requestCount: 1,
    validCount: 0,
    warningCodes: ["INVALID_MISSING"]
  },
  {
    name: "empty object invalid",
    input: wrap("{}"),
    requestCount: 1,
    validCount: 0,
    warningCodes: ["MISSING_TYPE", "MISSING_REQUEST_ID"]
  },
  {
    name: "array invalid",
    input: wrap("[]"),
    requestCount: 1,
    validCount: 0,
    warningCodes: ["NOT_OBJECT"]
  },
  {
    name: "plain text has no requests",
    input: "no tool request here",
    requestCount: 0,
    validCount: 0
  },
  {
    name: "markers with whitespace",
    input: `before\n[TOOL_REQUEST]   \n${validIrreversible("req-015")}\n   [/TOOL_REQUEST]\nafter`,
    requestCount: 1,
    validCount: 1
  },
  {
    name: "json fence with uppercase language",
    input: wrap(`\`\`\`JSON\n${validAmbiguity("req-016")}\n\`\`\``),
    requestCount: 1,
    validCount: 1
  }
];

for (const fixture of fixtures) {
  const result = parseToolRequests(fixture.input);
  assert.equal(result.requests.length, fixture.requestCount, `${fixture.name}: request count`);
  assert.equal(result.requests.filter((request) => request.valid).length, fixture.validCount, `${fixture.name}: valid count`);

  if (fixture.warningCodes) {
    const warningCodes = [
      ...result.warnings.map((warning) => warning.code),
      ...result.requests.flatMap((request) => request.warnings.map((warning) => warning.code))
    ];
    for (const code of fixture.warningCodes) {
      assert.ok(warningCodes.includes(code), `${fixture.name}: missing warning ${code}`);
    }
  }
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uat-tool-bridge-policy-"));
try {
  const runDir = path.join(tempRoot, "run");
  const sessionDir = path.join(runDir, "mcp-output", "browser");
  fs.mkdirSync(path.join(runDir, "input"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "output"), { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionDir, "session.md"),
    [
      "# fixture",
      "browser_handle_dialog accepted native save dialog after Tool Bridge approval",
      "browser_click button text=儲存"
    ].join("\n")
  );

  const missingResponseViolations = scanToolBridgePolicyViolationsForTest(runDir, "已取得授權並處理儲存 dialog。");
  assert.ok(
    missingResponseViolations.some((item) => item.code === "CLAIMED_PM_APPROVAL_WITHOUT_TOOL_BRIDGE_RESPONSE"),
    "policy scan should still block approval claims when no Tool Bridge response evidence exists"
  );
  assert.ok(
    missingResponseViolations.some((item) => item.code === "NATIVE_DIALOG_WITHOUT_TOOL_BRIDGE_RESPONSE"),
    "policy scan should still block native dialog handling when no Tool Bridge response evidence exists"
  );

  fs.writeFileSync(path.join(runDir, "output", "tool-responses-auto-helper-plan.json"), "{not-json");
  const malformedAutoViolations = scanToolBridgePolicyViolationsForTest(runDir, "已取得授權並處理儲存 dialog。");
  assert.ok(
    malformedAutoViolations.some((item) => item.code === "NATIVE_DIALOG_WITHOUT_TOOL_BRIDGE_RESPONSE"),
    "malformed auto-response diagnostics must not satisfy policy evidence"
  );

  fs.writeFileSync(
    path.join(runDir, "output", "tool-responses-auto.json"),
    `${JSON.stringify(
      {
        policy: "mac_agent_auto_non_sso_tool_requests_v1",
        generatedAt: new Date().toISOString(),
        responses: [
          {
            requestId: "OTTEST004-F-04-collage.saveReport",
            request: {
              type: "irreversible_operation",
              request_id: "OTTEST004-F-04-collage.saveReport",
              case: "OTTEST004-F-04",
              action: "Authorize helper saveReport for current case only.",
              reason: "Save report requires known BI native dialog handling."
            },
            raw: "[TOOL_REQUEST]...",
            note: "Auto-approved by Mac Agent policy."
          }
        ]
      },
      null,
      2
    )}\n`
  );
  const autoResponseViolations = scanToolBridgePolicyViolationsForTest(runDir, "已取得授權並處理儲存 dialog。");
  assert.deepEqual(
    autoResponseViolations,
    [],
    "auto-approved Tool Bridge response diagnostics should satisfy task-runner policy scan"
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log(`Tool Bridge parser fixtures passed: ${fixtures.length}/${fixtures.length}`);
