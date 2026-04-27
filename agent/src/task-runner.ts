import fs from "node:fs";
import path from "node:path";
import { ensureChromeDebugSession } from "./browser-session";
import { CodexRunner } from "./codex-runner";
import type { AgentConfig, AgentMessage } from "./types";
import type { AgentConnection } from "./connection";
import { readFirstInputCase, writeAgentResultXlsx } from "./result-writer";
import { parseToolRequests } from "./tool-bridge";

const getRunId = (message: AgentMessage): string => {
  const runId = message.payload.run_id;
  if (typeof runId !== "string" || !runId.trim()) {
    throw new Error("TASK_DISPATCH_MISSING_RUN_ID");
  }
  return runId;
};

const getStringPayload = (message: AgentMessage, key: string): string | null => {
  const value = message.payload[key];
  return typeof value === "string" && value.trim() ? value : null;
};

const ensureRunWorkspace = (config: AgentConfig, runId: string): string => {
  const runDir = path.join(config.workdir_root, runId);
  fs.mkdirSync(path.join(runDir, "input"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "rules"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "output"), { recursive: true });
  return runDir;
};

const copyIfExists = (source: string, target: string): boolean => {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
};

const prepareCodexContext = (config: AgentConfig, runDir: string): void => {
  const copied: Record<string, string> = {};
  const workspaceRoot = config.codex_workspace_root;
  const agentsSource = path.join(workspaceRoot, "AGENTS.md");
  if (copyIfExists(agentsSource, path.join(runDir, "rules", "PROJECT_AGENTS_FULL.md"))) {
    copied["rules/PROJECT_AGENTS_FULL.md"] = agentsSource;
  }

  const generatedAgents = [
    "# AGENTS.md - Generated UAT Agent Run Workspace",
    "",
    "This file is generated for a single Mac Agent run.",
    "",
    "Rules:",
    "- Follow the task prompt and downloaded input files in `input/`.",
    "- The full project AGENTS.md is copied to `rules/PROJECT_AGENTS_FULL.md` for reference.",
    "- BI testing rulebooks are copied under `rules/BI_TEST_RULES/`.",
    "- Do not execute UAT when the testcase workbook or startup instruction markdown is missing; report the missing prerequisite and exit cleanly.",
    "- Do not perform destructive operations unless an actionable Tool Bridge request is approved.",
    "- Write the final workbook to `output/result.xlsx` when real UAT cases are executed.",
    ""
  ].join("\n");
  fs.writeFileSync(path.join(runDir, "AGENTS.md"), generatedAgents);
  copied["AGENTS.md"] = "generated compact run workspace instructions";

  const rulesDir = path.join(workspaceRoot, "BI_TEST_RULES");
  if (fs.existsSync(rulesDir)) {
    for (const entry of fs.readdirSync(rulesDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const source = path.join(rulesDir, entry.name);
      const target = path.join(runDir, "rules", "BI_TEST_RULES", entry.name);
      if (copyIfExists(source, target)) copied[`BI_TEST_RULES/${entry.name}`] = source;
    }
  }

  writeJson(path.join(runDir, "input", "codex-context.json"), {
    codex_workspace_root: workspaceRoot,
    copied_context: copied
  });
};

const writeJson = (filePath: string, value: unknown): void => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const readJson = <T>(filePath: string): T => {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
};

type DownloadedInputs = Record<string, string>;

export type TaskDispatchHooks = {
  onCancelReady?: (runId: string, cancel: (reason?: string) => void) => void;
  onCancelClear?: (runId: string) => void;
};

const inputFileNameByKey: Record<string, string> = {
  xlsx: "testcase.xlsx",
  md: "testcase.md",
  startup_instruction: "startup_instruction.md",
  baseline: "baseline.csv",
  domain_rules: "domain_AGENTS.md",
  domain_schema: "domain_xlsx_schema.json",
  domain_result_adapter: "domain_result_parser_adapter.json",
  domain_startup_template: "domain_startup_prompt_template.md"
};

const sanitizeInputFileName = (value: string, fallback: string): string => {
  const decoded = decodeURIComponent(value).replace(/[\\/]/g, "_").trim();
  const safe = decoded.replace(/[^a-zA-Z0-9._() -\u4e00-\u9fff\u3040-\u30ff]/g, "_");
  return safe && safe !== "." && safe !== ".." ? safe : fallback;
};

const inputFileNameForKey = (key: string, url: string): string => {
  const fixed = inputFileNameByKey[key];
  if (fixed) return fixed;
  try {
    const basename = path.basename(new URL(url).pathname);
    if (basename) return sanitizeInputFileName(basename, `${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.dat`);
  } catch {
    // Fall through to deterministic key-based name.
  }
  return `${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.dat`;
};

const getInputUrls = (message: AgentMessage): Record<string, string> => {
  const value = message.payload.input_urls;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const urls: Record<string, string> = {};
  for (const [key, url] of Object.entries(value as Record<string, unknown>)) {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      urls[key] = url;
    }
  }
  return urls;
};

const getOutputUrls = (message: AgentMessage): Record<string, string> => {
  const value = message.payload.output_urls;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const urls: Record<string, string> = {};
  for (const [key, url] of Object.entries(value as Record<string, unknown>)) {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      urls[key] = url;
    }
  }
  return urls;
};

const downloadFile = async (url: string, filePath: string, token: string): Promise<void> => {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
  if (!response.ok) {
    throw new Error(`INPUT_DOWNLOAD_FAILED ${response.status} ${url}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, bytes);
};

const uploadResultXlsx = async (url: string, filePath: string, token: string): Promise<unknown> => {
  const form = new FormData();
  const bytes = fs.readFileSync(filePath);
  form.append("resultXlsx", new Blob([new Uint8Array(bytes)]), "result.xlsx");

  const response = await fetch(url, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep raw text for diagnostics.
  }
  if (!response.ok) {
    throw new Error(`RESULT_UPLOAD_FAILED ${response.status} ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
};

const uploadLogFile = async (url: string, filePath: string, token: string): Promise<unknown> => {
  const form = new FormData();
  const bytes = fs.readFileSync(filePath);
  form.append("log", new Blob([new Uint8Array(bytes)], { type: "text/plain" }), "agent.log");

  const response = await fetch(url, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep raw text for diagnostics.
  }
  if (!response.ok) {
    throw new Error(`LOG_UPLOAD_FAILED ${response.status} ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
};

const downloadInputs = async (config: AgentConfig, message: AgentMessage, runDir: string): Promise<DownloadedInputs> => {
  const inputDir = path.join(runDir, "input");
  const urls = getInputUrls(message);
  const downloaded: DownloadedInputs = {};
  const seenUrls = new Map<string, string>();

  for (const [key, url] of Object.entries(urls)) {
    if (seenUrls.has(url)) {
      downloaded[key] = seenUrls.get(url) as string;
      continue;
    }

    const fileName = inputFileNameForKey(key, url);
    const filePath = path.join(inputDir, fileName);
    await downloadFile(url, filePath, config.token);
    downloaded[key] = filePath;
    seenUrls.set(url, filePath);
  }

  return downloaded;
};

const readTextSample = (filePath: string | undefined, maxChars: number): string => {
  if (!filePath || !fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8").slice(0, maxChars);
};

const getCodexGeneratedResultXlsx = (runDir: string): string | null => {
  const filePath = path.join(runDir, "output", "result.xlsx");
  if (!fs.existsSync(filePath)) return null;
  return fs.statSync(filePath).size > 0 ? filePath : null;
};

const buildPrompt = (runId: string, message: AgentMessage, runDir: string, inputs: DownloadedInputs): string => {
  const instruction = getStringPayload(message, "startup_instruction") ?? "Acknowledge this UAT run assignment and finish.";
  const domain = getStringPayload(message, "domain") ?? "BI";
  const roundId = getStringPayload(message, "round_id") ?? runId;
  const inputLines = Object.entries(inputs).map(([key, filePath]) => `- ${key}: ${filePath}`);
  const startupText = readTextSample(inputs.startup_instruction ?? inputs.md, 8000);
  const domainRulesText = readTextSample(inputs.domain_rules, 8000);
  const domainStartupTemplateText = readTextSample(inputs.domain_startup_template, 4000);
  const resultXlsxPath = path.join(runDir, "output", "result.xlsx");

  return [
    "You are running inside the Galaxy UAT Tool Mac Agent.",
    "",
    "Execution constraints:",
    "- Treat this as an automated agent turn, not an interactive chat with Tommy.",
    "- Do not perform destructive operations.",
    "- If required input files or credentials are missing, report the missing prerequisites and exit cleanly.",
    "- Follow the generated AGENTS.md in this run workspace.",
    "- The full project discipline is available at rules/PROJECT_AGENTS_FULL.md; BI rulebooks are under rules/BI_TEST_RULES/.",
    "- If you execute UAT cases, write the complete result workbook to the exact path listed below.",
    "- Keep the final response concise; the workbook and log are the primary artifacts.",
    "- Playwright MCP is configured to connect to a persistent local Chrome session through CDP when available.",
    "- If the Galaxy BI page shows 載入失敗, SSO, login, or API 401/403, do not fail the run and do not create a fallback workbook.",
    "- For SSO/login blockers, emit exactly one actionable Tool Bridge request with type playwright_recovery and fields request_id, error, proposed_action.",
    "- For SSO/login blockers, proposed_action must tell Tommy to complete SSO in the Chrome window opened by UAT Agent, then click 已處理/continue in the UAT Tool.",
    "",
    `Run ID: ${runId}`,
    `Domain: ${domain}`,
    `Round ID: ${roundId}`,
    `Agent workdir: ${runDir}`,
    `Copied context manifest: ${path.resolve(runDir, "input", "codex-context.json")}`,
    `Expected result workbook path: ${resultXlsxPath}`,
    "",
    "Downloaded input files:",
    inputLines.length > 0 ? inputLines.join("\n") : "- none",
    "",
    "Domain startup template excerpt:",
    domainStartupTemplateText || "(no domain startup template downloaded)",
    "",
    "Domain rules excerpt:",
    domainRulesText || "(no domain rules downloaded)",
    "",
    "Startup instruction file excerpt:",
    startupText || "(no startup instruction file downloaded)",
    "",
    "Result workbook contract:",
    "- Preferred: create output/result.xlsx yourself with sheets named 索引, 測試案例, Bug.",
    "- 測試案例 sheet should include at minimum: 群組, 編號, 測試項目, 測試類型, 執行方式, 結果, 失敗分類, 詳細紀錄JSON.",
    "- If you cannot execute the real UAT, explain why; the agent will create a fallback summary workbook.",
    "- Do not use Tool Bridge for missing testcase files; report the missing files and exit cleanly.",
    "- For user approval or SSO/manual blockers, emit only supported actionable Tool Bridge types: irreversible_operation, ambiguity_decision, playwright_recovery.",
    "- Every actionable Tool Bridge block must include request_id and use this envelope: [TOOL_REQUEST]{...}[/TOOL_REQUEST].",
    "- Example SSO Tool Bridge block: [TOOL_REQUEST]{\"type\":\"playwright_recovery\",\"request_id\":\"<uuid>\",\"error\":\"LOGIN_REQUIRED: Galaxy BI DEV shows 載入失敗 or API 401\",\"proposed_action\":\"Tommy completes SSO/login in the persistent Chrome window opened by UAT Agent, then clicks 已處理/continue in the UAT Tool.\"}[/TOOL_REQUEST]",
    "",
    "Startup instruction:",
    instruction
  ].join("\n");
};

const buildResultDetail = (
  runId: string,
  message: AgentMessage,
  runDir: string,
  inputs: DownloadedInputs,
  result: {
    threadId: string | null;
    assistantText: string;
    exitCode: number | null;
    signal: string | null;
    parseErrors: string[];
    events: unknown[];
    stderr: string;
  }
): Record<string, unknown> => ({
  測試目的: "驗證 Mac Agent 可接收雲端派工、下載測試輸入、啟動 Codex CLI 並回傳結果 xlsx。",
  設定條件: {
    runId,
    roundId: getStringPayload(message, "round_id") ?? runId,
    workdir: runDir,
    downloadedInputs: inputs
  },
  預期行為: "Agent 應成功完成 Codex CLI 任務，並上傳可被 API parser 入庫的 result.xlsx。",
  實際行為: result.exitCode === 0 ? "Codex CLI exited with code 0 and produced assistant output." : `Codex CLI failed with exit=${result.exitCode} signal=${result.signal ?? "none"}.`,
  codexThreadId: result.threadId,
  codexExitCode: result.exitCode,
  codexSignal: result.signal,
  codexParseErrorCount: result.parseErrors.length,
  codexEventCount: result.events.length,
  assistantTextExcerpt: result.assistantText.slice(0, 2000),
  stderrExcerpt: result.stderr.slice(0, 2000)
});

const extractToolRequests = (assistantText: string): ReturnType<typeof parseToolRequests> => {
  return parseToolRequests(assistantText);
};

const getToolRequestId = (request: unknown): string | null => {
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;
  const requestId = (request as { request_id?: unknown }).request_id;
  return typeof requestId === "string" && requestId.trim() ? requestId : null;
};

const isActionableToolRequest = (request: unknown): boolean => {
  if (!request || typeof request !== "object" || Array.isArray(request)) return false;
  const type = (request as { type?: unknown }).type;
  return type === "irreversible_operation" || type === "ambiguity_decision" || type === "playwright_recovery";
};

const buildToolResponsePrompt = (runId: string, message: AgentMessage): string => {
  const requestId = getStringPayload(message, "request_id") ?? "unknown";
  const approved = message.payload.approved === true;
  const note = getStringPayload(message, "note") ?? "";
  return [
    "Tool Bridge response received from PM.",
    "",
    `Run ID: ${runId}`,
    `Request ID: ${requestId}`,
    `Approved: ${approved ? "true" : "false"}`,
    note ? `Note: ${note}` : "Note: (empty)",
    "",
    approved
      ? "Continue the prior UAT task from the paused point. Respect the PM note and keep output concise."
      : "The PM did not approve the requested action. Skip or abort the affected step safely, then produce a concise result."
  ].join("\n");
};

const writeCombinedLog = (
  runDir: string,
  result: {
    threadId: string | null;
    assistantText: string;
    exitCode: number | null;
    signal: string | null;
    parseErrors: string[];
    rawStdout: string;
    stderr: string;
  }
): string => {
  const filePath = path.join(runDir, "output", "agent.log");
  const content = [
    `# uat-agent log`,
    `generated_at=${new Date().toISOString()}`,
    `thread_id=${result.threadId ?? ""}`,
    `exit_code=${result.exitCode ?? ""}`,
    `signal=${result.signal ?? ""}`,
    `parse_errors=${result.parseErrors.length}`,
    "",
    "## assistant_text",
    result.assistantText,
    "",
    "## raw_stdout",
    result.rawStdout,
    "",
    "## stderr",
    result.stderr
  ].join("\n");
  fs.writeFileSync(filePath, content);
  return filePath;
};

const summarizeStderr = (stderr: string): string => {
  const pluginWarningIndex = stderr.indexOf("failed to warm featured plugin ids cache");
  const relevant = pluginWarningIndex >= 0 ? stderr.slice(0, pluginWarningIndex) : stderr;
  const cleaned = relevant
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes("Reading additional input from stdin"))
    .filter((line) => !line.includes("codex_core::plugins::manager"))
    .join("\n");
  return cleaned.slice(0, 1200);
};

export const handleTaskDispatch = async (
  connection: AgentConnection,
  config: AgentConfig,
  message: AgentMessage,
  hooks: TaskDispatchHooks = {}
): Promise<void> => {
  const runId = getRunId(message);
  const runDir = ensureRunWorkspace(config, runId);
  prepareCodexContext(config, runDir);
  connection.setRunState("busy", runId);

  try {
    writeJson(path.join(runDir, "input", "dispatch.json"), message);
    writeJson(path.join(runDir, "state.json"), {
      run_id: runId,
      status: "started",
      started_at: new Date().toISOString()
    });
    const downloadedInputs = await downloadInputs(config, message, runDir);
    writeJson(path.join(runDir, "input", "downloaded-inputs.json"), downloadedInputs);
    const chromeCdpEndpoint = await ensureChromeDebugSession(config, getStringPayload(message, "dev_url"));

    connection.send(
      "run.started",
      {
        run_id: runId,
        started_at: new Date().toISOString(),
        device_name: config.device_name,
        workdir: runDir,
        inputs: Object.keys(downloadedInputs)
      },
      true
    );
    connection.send(
      "run.stdout",
      {
        run_id: runId,
        text: chromeCdpEndpoint
          ? `uat-agent starting CodexRunner for ${runId} with persistent Chrome CDP ${chromeCdpEndpoint}`
          : `uat-agent starting CodexRunner for ${runId}; persistent Chrome CDP unavailable, falling back to default Playwright MCP browser`
      },
      false
    );

    const runner = new CodexRunner({
      codexBin: config.codex_bin,
      cwd: runDir,
      playwrightCdpEndpoint: chromeCdpEndpoint,
      playwrightOutputDir: path.join(runDir, "mcp-output")
    });
    hooks.onCancelReady?.(runId, (reason = "cancelled_by_pm") => {
      runner.cancel(reason);
      try {
        connection.send(
          "run.stderr",
          {
            run_id: runId,
            text: `uat-agent cancellation requested: ${reason}`
          },
          false
        );
      } catch {
        // Cancellation must still kill Codex even if the WebSocket is already closing.
      }
    });
    const result = await runner.start(buildPrompt(runId, message, runDir, downloadedInputs));
    const cancelReason = runner.getCancelReason();
    if (cancelReason) {
      throw new Error(`CODEX_RUN_CANCELLED reason=${cancelReason}`);
    }
    fs.writeFileSync(path.join(runDir, "codex.log"), result.rawStdout);
    fs.writeFileSync(path.join(runDir, "codex.stderr.log"), result.stderr);
    writeJson(path.join(runDir, "output", "codex-result.json"), {
      threadId: result.threadId,
      assistantText: result.assistantText,
      exitCode: result.exitCode,
      signal: result.signal,
      stderr: result.stderr,
      parseErrors: result.parseErrors,
      eventCount: result.events.length
    });

    if (result.parseErrors.length > 0) {
      connection.send(
        "run.stderr",
        {
          run_id: runId,
          text: `Codex JSON parse warnings: ${result.parseErrors.length}`
        },
        false
      );
    }

    const stderrSummary = summarizeStderr(result.stderr);
    if (stderrSummary) {
      connection.send(
        "run.stderr",
        {
          run_id: runId,
          text: stderrSummary
        },
        false
      );
    }

    if (result.assistantText.trim()) {
      connection.send(
        "run.stdout",
        {
          run_id: runId,
          text: result.assistantText.slice(0, 8000)
        },
        false
      );
    }

    const toolRequestParse = extractToolRequests(result.assistantText);
    const validToolRequests = toolRequestParse.requests.filter((request) => request.valid && isActionableToolRequest(request.data));
    const diagnosticToolRequests = toolRequestParse.requests.filter((request) => request.valid && !isActionableToolRequest(request.data));
    writeJson(path.join(runDir, "output", "tool-requests.json"), toolRequestParse);

    const parseWarningCodes = [
      ...toolRequestParse.warnings.map((warning) => warning.code),
      ...toolRequestParse.requests.flatMap((request) => request.warnings.map((warning) => warning.code))
    ];
    if (parseWarningCodes.length > 0) {
      connection.send(
        "run.stderr",
        {
          run_id: runId,
          text: `Tool Bridge parse warnings: ${parseWarningCodes.join(", ")}`
        },
        false
      );
    }

    if (diagnosticToolRequests.length > 0) {
      connection.send(
        "run.stdout",
        {
          run_id: runId,
          text: `uat-agent captured ${diagnosticToolRequests.length} diagnostic Tool Bridge request(s); continuing without waiting for PM response.`
        },
        false
      );
    }

    if (validToolRequests.length > 0) {
      for (const request of validToolRequests) {
        connection.send(
          "run.tool_request",
          {
            run_id: runId,
            request_id: getToolRequestId(request.data),
            request: request.data,
            raw: request.raw
          },
          true
        );
      }
      writeJson(path.join(runDir, "state.json"), {
        run_id: runId,
        status: "waiting_user",
        waiting_at: new Date().toISOString(),
        tool_request_count: validToolRequests.length,
        thread_id: result.threadId
      });
      connection.send(
        "run.stdout",
        {
          run_id: runId,
          text: `uat-agent paused for ${validToolRequests.length} Tool Bridge request(s).`
        },
        false
      );
      return;
    }

    const outputUrls = getOutputUrls(message);
    const combinedLogPath = writeCombinedLog(runDir, result);
    if (outputUrls.log) {
      try {
        const logUploadResponse = await uploadLogFile(outputUrls.log, combinedLogPath, config.token);
        writeJson(path.join(runDir, "output", "log-upload.json"), {
          path: combinedLogPath,
          uploaded: true,
          upload_response: logUploadResponse
        });
      } catch (error) {
        writeJson(path.join(runDir, "output", "log-upload.json"), {
          path: combinedLogPath,
          uploaded: false,
          error: error instanceof Error ? error.message : String(error)
        });
        connection.send(
          "run.stderr",
          {
            run_id: runId,
            text: `uat-agent log upload failed: ${error instanceof Error ? error.message : String(error)}`
          },
          false
        );
      }
    }

    const codexGeneratedResultXlsx = getCodexGeneratedResultXlsx(runDir);
    const sourceCase = codexGeneratedResultXlsx ? null : await readFirstInputCase(downloadedInputs.xlsx);
    const resultXlsxPath = codexGeneratedResultXlsx ?? await writeAgentResultXlsx({
      runId,
      roundId: getStringPayload(message, "round_id") ?? runId,
      outputDir: path.join(runDir, "output"),
      sourceCase,
      status: result.exitCode === 0 ? "PASS" : "FAIL",
      failCategory: result.exitCode === 0 ? null : "CODEX_RUN_FAILED",
      detailJson: buildResultDetail(runId, message, runDir, downloadedInputs, result)
    });

    writeJson(path.join(runDir, "output", "result-xlsx.json"), {
      path: resultXlsxPath,
      uploaded: false,
      source: codexGeneratedResultXlsx ? "codex_generated" : "agent_fallback",
      output_url_keys: Object.keys(outputUrls)
    });

    if (outputUrls.result_xlsx) {
      connection.send(
        "run.uploading_result",
        {
          run_id: runId,
          result_xlsx_path: resultXlsxPath
        },
        true
      );
      const uploadResponse = await uploadResultXlsx(outputUrls.result_xlsx, resultXlsxPath, config.token);
      writeJson(path.join(runDir, "output", "result-xlsx.json"), {
        path: resultXlsxPath,
        uploaded: true,
        source: codexGeneratedResultXlsx ? "codex_generated" : "agent_fallback",
        upload_response: uploadResponse
      });
      connection.send(
        "run.stdout",
        {
          run_id: runId,
          text: "uat-agent uploaded result.xlsx"
        },
        false
      );
    } else {
      connection.send(
        "run.stderr",
        {
          run_id: runId,
          text: "No output_urls.result_xlsx provided; result.xlsx was written locally only."
        },
        false
      );
    }

    if (result.exitCode !== 0) {
      throw new Error(`CODEX_RUN_FAILED exit=${result.exitCode} signal=${result.signal ?? "none"}`);
    }

    writeJson(path.join(runDir, "state.json"), {
      run_id: runId,
      status: "completed",
      completed_at: new Date().toISOString(),
      thread_id: result.threadId
    });

    connection.send(
      "run.completed",
      {
        run_id: runId,
        completed_at: new Date().toISOString(),
        result: "codex_completed",
        thread_id: result.threadId,
        workdir: runDir,
        inputs: Object.keys(downloadedInputs),
        result_xlsx_path: resultXlsxPath,
        log_path: combinedLogPath,
        result_xlsx_uploaded: Boolean(outputUrls.result_xlsx)
      },
      true
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const cancelled = errorMessage.startsWith("CODEX_RUN_CANCELLED");
    writeJson(path.join(runDir, "state.json"), {
      run_id: runId,
      status: cancelled ? "cancelled" : "failed",
      failed_at: new Date().toISOString(),
      error: errorMessage
    });
    connection.send(
      cancelled ? "run.cancelled" : "run.failed",
      {
        run_id: runId,
        error: errorMessage,
        workdir: runDir
      },
      true
    );
  } finally {
    hooks.onCancelClear?.(runId);
    connection.setRunState("idle", null);
  }
};

export const handleToolResponse = async (
  connection: AgentConnection,
  config: AgentConfig,
  message: AgentMessage,
  hooks: TaskDispatchHooks = {}
): Promise<void> => {
  const runId = getRunId(message);
  const runDir = ensureRunWorkspace(config, runId);
  prepareCodexContext(config, runDir);
  connection.setRunState("busy", runId);

  try {
    const statePath = path.join(runDir, "state.json");
    if (!fs.existsSync(statePath)) {
      throw new Error(`TOOL_RESPONSE_STATE_NOT_FOUND:${statePath}`);
    }

    const state = readJson<Record<string, unknown>>(statePath);
    const threadId = typeof state.thread_id === "string" && state.thread_id.trim() ? state.thread_id : null;
    if (!threadId) {
      throw new Error("TOOL_RESPONSE_THREAD_ID_MISSING");
    }

    const dispatchPath = path.join(runDir, "input", "dispatch.json");
    const inputsPath = path.join(runDir, "input", "downloaded-inputs.json");
    const originalDispatch = readJson<AgentMessage>(dispatchPath);
    const downloadedInputs = readJson<DownloadedInputs>(inputsPath);
    const chromeCdpEndpoint = await ensureChromeDebugSession(config, getStringPayload(originalDispatch, "dev_url"));

    writeJson(path.join(runDir, "input", `tool-response-${getStringPayload(message, "request_id") ?? Date.now()}.json`), message);
    writeJson(path.join(runDir, "state.json"), {
      ...state,
      status: "resuming",
      resumed_at: new Date().toISOString(),
      tool_response_request_id: getStringPayload(message, "request_id") ?? null
    });

    connection.send(
      "tool_response.delivered",
      {
        run_id: runId,
        request_id: getStringPayload(message, "request_id") ?? null,
        thread_id: threadId
      },
      true
    );
    connection.send(
      "run.stdout",
      {
        run_id: runId,
        text: `uat-agent resuming Codex thread ${threadId}`
      },
      false
    );

    const runner = new CodexRunner({
      codexBin: config.codex_bin,
      cwd: runDir,
      playwrightCdpEndpoint: chromeCdpEndpoint,
      playwrightOutputDir: path.join(runDir, "mcp-output")
    });
    hooks.onCancelReady?.(runId, (reason = "cancelled_by_pm") => {
      runner.cancel(reason);
      try {
        connection.send(
          "run.stderr",
          {
            run_id: runId,
            text: `uat-agent cancellation requested during resume: ${reason}`
          },
          false
        );
      } catch {
        // Cancellation must still kill Codex even if the WebSocket is already closing.
      }
    });

    const result = await runner.resume(threadId, buildToolResponsePrompt(runId, message));
    const cancelReason = runner.getCancelReason();
    if (cancelReason) {
      throw new Error(`CODEX_RUN_CANCELLED reason=${cancelReason}`);
    }

    fs.writeFileSync(path.join(runDir, "codex-resume.log"), result.rawStdout);
    fs.writeFileSync(path.join(runDir, "codex-resume.stderr.log"), result.stderr);
    writeJson(path.join(runDir, "output", "codex-resume-result.json"), {
      threadId: result.threadId,
      assistantText: result.assistantText,
      exitCode: result.exitCode,
      signal: result.signal,
      stderr: result.stderr,
      parseErrors: result.parseErrors,
      eventCount: result.events.length
    });

    if (result.parseErrors.length > 0) {
      connection.send(
        "run.stderr",
        {
          run_id: runId,
          text: `Codex resume JSON parse warnings: ${result.parseErrors.length}`
        },
        false
      );
    }

    const stderrSummary = summarizeStderr(result.stderr);
    if (stderrSummary) {
      connection.send(
        "run.stderr",
        {
          run_id: runId,
          text: stderrSummary
        },
        false
      );
    }

    if (result.assistantText.trim()) {
      connection.send(
        "run.stdout",
        {
          run_id: runId,
          text: result.assistantText.slice(0, 8000)
        },
        false
      );
    }

    const toolRequestParse = extractToolRequests(result.assistantText);
    const validToolRequests = toolRequestParse.requests.filter((request) => request.valid && isActionableToolRequest(request.data));
    const diagnosticToolRequests = toolRequestParse.requests.filter((request) => request.valid && !isActionableToolRequest(request.data));
    writeJson(path.join(runDir, "output", "tool-requests-resume.json"), toolRequestParse);
    if (diagnosticToolRequests.length > 0) {
      connection.send(
        "run.stdout",
        {
          run_id: runId,
          text: `uat-agent captured ${diagnosticToolRequests.length} diagnostic Tool Bridge request(s) during resume; continuing without waiting for PM response.`
        },
        false
      );
    }
    if (validToolRequests.length > 0) {
      for (const request of validToolRequests) {
        connection.send(
          "run.tool_request",
          {
            run_id: runId,
            request_id: getToolRequestId(request.data),
            request: request.data,
            raw: request.raw
          },
          true
        );
      }
      writeJson(path.join(runDir, "state.json"), {
        run_id: runId,
        status: "waiting_user",
        waiting_at: new Date().toISOString(),
        tool_request_count: validToolRequests.length,
        thread_id: result.threadId ?? threadId
      });
      connection.send(
        "run.stdout",
        {
          run_id: runId,
          text: `uat-agent paused again for ${validToolRequests.length} Tool Bridge request(s).`
        },
        false
      );
      return;
    }

    const outputUrls = getOutputUrls(originalDispatch);
    const combinedLogPath = writeCombinedLog(runDir, result);
    if (outputUrls.log) {
      try {
        const logUploadResponse = await uploadLogFile(outputUrls.log, combinedLogPath, config.token);
        writeJson(path.join(runDir, "output", "log-upload.json"), {
          path: combinedLogPath,
          uploaded: true,
          upload_response: logUploadResponse
        });
      } catch (error) {
        writeJson(path.join(runDir, "output", "log-upload.json"), {
          path: combinedLogPath,
          uploaded: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const codexGeneratedResultXlsx = getCodexGeneratedResultXlsx(runDir);
    const sourceCase = codexGeneratedResultXlsx ? null : await readFirstInputCase(downloadedInputs.xlsx);
    const resultXlsxPath = codexGeneratedResultXlsx ?? await writeAgentResultXlsx({
      runId,
      roundId: getStringPayload(originalDispatch, "round_id") ?? runId,
      outputDir: path.join(runDir, "output"),
      sourceCase,
      status: result.exitCode === 0 ? "PASS" : "FAIL",
      failCategory: result.exitCode === 0 ? null : "CODEX_RUN_FAILED",
      detailJson: buildResultDetail(runId, originalDispatch, runDir, downloadedInputs, result)
    });

    if (outputUrls.result_xlsx) {
      connection.send(
        "run.uploading_result",
        {
          run_id: runId,
          result_xlsx_path: resultXlsxPath
        },
        true
      );
      await uploadResultXlsx(outputUrls.result_xlsx, resultXlsxPath, config.token);
    }

    if (result.exitCode !== 0) {
      throw new Error(`CODEX_RUN_FAILED exit=${result.exitCode} signal=${result.signal ?? "none"}`);
    }

    writeJson(path.join(runDir, "state.json"), {
      run_id: runId,
      status: "completed",
      completed_at: new Date().toISOString(),
      thread_id: result.threadId ?? threadId
    });

    connection.send(
      "run.completed",
      {
        run_id: runId,
        completed_at: new Date().toISOString(),
        result: "codex_resumed_completed",
        thread_id: result.threadId ?? threadId,
        workdir: runDir,
        inputs: Object.keys(downloadedInputs),
        result_xlsx_path: resultXlsxPath,
        log_path: combinedLogPath,
        result_xlsx_uploaded: Boolean(outputUrls.result_xlsx)
      },
      true
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const cancelled = errorMessage.startsWith("CODEX_RUN_CANCELLED");
    writeJson(path.join(runDir, "state.json"), {
      run_id: runId,
      status: cancelled ? "cancelled" : "failed",
      failed_at: new Date().toISOString(),
      error: errorMessage
    });
    connection.send(
      cancelled ? "run.cancelled" : "run.failed",
      {
        run_id: runId,
        error: errorMessage,
        workdir: runDir
      },
      true
    );
  } finally {
    hooks.onCancelClear?.(runId);
    connection.setRunState("idle", null);
  }
};
