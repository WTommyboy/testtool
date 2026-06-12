import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type CodexJsonEvent = Record<string, unknown>;

export type CodexTurnResult = {
  threadId: string | null;
  assistantText: string;
  events: CodexJsonEvent[];
  rawStdout: string;
  parseErrors: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
};

export type CodexRunnerOptions = {
  codexBin: string;
  model?: string | null;
  cwd: string;
  timeoutMs?: number;
  reasoningEffort?: string | null;
  ignoreUserConfig?: boolean;
  serviceTier?: "flex" | "fast";
  playwrightMcpCommand?: string | null;
  playwrightCdpEndpoint?: string | null;
  playwrightOutputDir?: string | null;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  onJsonEvent?: (event: CodexJsonEvent, line: string) => void;
};

const browserToolApprovalModes = [
  "browser_evaluate",
  "browser_run_code",
  "browser_handle_dialog",
  "browser_tabs",
  "browser_click",
  "browser_navigate",
  "browser_select_option",
  "browser_type",
  "browser_fill_form",
  "browser_press_key",
  "browser_resize",
  "browser_close"
] as const;

const resolvePlaywrightMcpCommand = (override?: string | null): string => {
  if (override?.trim()) return override.trim();
  const envCommand = process.env.UAT_AGENT_PLAYWRIGHT_MCP_COMMAND?.trim();
  if (envCommand) return envCommand;

  const localUserInstall = path.join(os.homedir(), ".local", "node_modules", ".bin", "playwright-mcp");
  if (fs.existsSync(localUserInstall)) return localUserInstall;

  return "playwright-mcp";
};

const parseJsonl = (stdout: string): { events: CodexJsonEvent[]; parseErrors: string[] } => {
  const events: CodexJsonEvent[] = [];
  const parseErrors: string[] = [];
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    try {
      events.push(JSON.parse(line) as CodexJsonEvent);
    } catch (error) {
      parseErrors.push(error instanceof Error ? `${error.message}: ${line.slice(0, 200)}` : line.slice(0, 200));
    }
  }
  return { events, parseErrors };
};

const extractThreadId = (events: CodexJsonEvent[]): string | null => {
  const started = events.find((event) => event.type === "thread.started") as { thread_id?: unknown } | undefined;
  return typeof started?.thread_id === "string" ? started.thread_id : null;
};

const extractAssistantText = (events: CodexJsonEvent[]): string => {
  return events
    .map((event) => {
      const item = (event as { item?: { type?: unknown; text?: unknown } }).item;
      return event.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string"
        ? item.text
        : "";
    })
    .filter(Boolean)
    .join("\n");
};

const buildCodexChildEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  delete env.CODEX_THREAD_ID;
  delete env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
  return env;
};

export class CodexRunner {
  private child: ChildProcess | null = null;
  private cancelReason: string | null = null;
  private rawStdout = "";
  private rawStderr = "";
  private stdoutLineBuffer = "";
  private stderrLineBuffer = "";

  constructor(private readonly options: CodexRunnerOptions) {}

  private killActiveChild(signal: NodeJS.Signals): void {
    if (!this.child || this.child.killed) return;
    if (typeof this.child.pid === "number") {
      try {
        process.kill(-this.child.pid, signal);
        return;
      } catch {
        // Fall back to killing the direct child if process-group kill is unavailable.
      }
    }
    this.child.kill(signal);
  }

  cancel(reason = "cancelled"): void {
    this.cancelReason = reason;
    this.killActiveChild("SIGTERM");
    setTimeout(() => {
      this.killActiveChild("SIGKILL");
    }, 3_000).unref();
  }

  getCancelReason(): string | null {
    return this.cancelReason;
  }

  getPartialResult(): CodexTurnResult {
    const { events, parseErrors } = parseJsonl(this.rawStdout);
    return {
      threadId: extractThreadId(events),
      assistantText: extractAssistantText(events),
      events,
      rawStdout: this.rawStdout,
      parseErrors,
      exitCode: null,
      signal: null,
      stderr: this.rawStderr,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 0
    };
  }

  private emitStdoutChunk(chunk: Buffer): void {
    const text = chunk.toString("utf8");
    this.rawStdout += text;
    this.stdoutLineBuffer += text;
    this.stdoutLineBuffer = this.emitBufferedLines(this.stdoutLineBuffer, (line) => {
      this.safeCall(() => this.options.onStdoutLine?.(line));
      try {
        const event = JSON.parse(line) as CodexJsonEvent;
        this.safeCall(() => this.options.onJsonEvent?.(event, line));
      } catch {
        // The final parser records malformed JSONL lines. Streaming is best-effort.
      }
    });
  }

  private emitStderrChunk(chunk: Buffer): void {
    const text = chunk.toString("utf8");
    this.rawStderr += text;
    this.stderrLineBuffer += text;
    this.stderrLineBuffer = this.emitBufferedLines(this.stderrLineBuffer, (line) => {
      this.safeCall(() => this.options.onStderrLine?.(line));
    });
  }

  private flushLineBuffers(): void {
    if (this.stdoutLineBuffer) {
      const line = this.stdoutLineBuffer;
      this.stdoutLineBuffer = "";
      this.safeCall(() => this.options.onStdoutLine?.(line));
      try {
        const event = JSON.parse(line) as CodexJsonEvent;
        this.safeCall(() => this.options.onJsonEvent?.(event, line));
      } catch {
        // The final parser records malformed JSONL lines. Streaming is best-effort.
      }
    }
    if (this.stderrLineBuffer) {
      const line = this.stderrLineBuffer;
      this.stderrLineBuffer = "";
      this.safeCall(() => this.options.onStderrLine?.(line));
    }
  }

  private emitBufferedLines(buffer: string, emit: (line: string) => void): string {
    const lines = buffer.split(/\r?\n/);
    const remainder = lines.pop() ?? "";
    for (const line of lines) {
      if (line) emit(line);
    }
    return remainder;
  }

  private safeCall(callback: () => void): void {
    try {
      callback();
    } catch {
      // Progress callbacks must never crash or block the Codex child process.
    }
  }

  private configArgs(): string[] {
    const args: string[] = [];
    if (this.options.model) {
      args.push("-m", this.options.model);
    }
    if (this.options.serviceTier) {
      args.push("-c", `service_tier=${JSON.stringify(this.options.serviceTier)}`);
    }
    if (this.options.reasoningEffort) {
      args.push("-c", `model_reasoning_effort=${JSON.stringify(this.options.reasoningEffort)}`);
    }
    if (this.options.playwrightCdpEndpoint) {
      const playwrightArgs = [
        "--cdp-endpoint",
        this.options.playwrightCdpEndpoint,
        "--shared-browser-context",
        "--save-session",
        "--output-dir",
        this.options.playwrightOutputDir ?? "/tmp/playwright-mcp"
      ];
      args.push("-c", `mcp_servers.playwright.command=${JSON.stringify(resolvePlaywrightMcpCommand(this.options.playwrightMcpCommand))}`);
      args.push("-c", `mcp_servers.playwright.args=${JSON.stringify(playwrightArgs)}`);
      for (const toolName of browserToolApprovalModes) {
        args.push("-c", `mcp_servers.playwright.tools.${toolName}.approval_mode="approve"`);
      }
    }
    return args;
  }

  private run(args: string[]): Promise<CodexTurnResult> {
    return new Promise((resolve, reject) => {
      const startedAtMs = Date.now();
      const startedAt = new Date(startedAtMs).toISOString();
      const child = spawn(this.options.codexBin, [...this.configArgs(), ...args], {
        cwd: this.options.cwd,
        env: buildCodexChildEnv(),
        detached: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      this.child = child;
      this.cancelReason = null;
      this.rawStdout = "";
      this.rawStderr = "";
      this.stdoutLineBuffer = "";
      this.stderrLineBuffer = "";
      const timer = setTimeout(() => {
        this.cancel("timeout");
      }, this.options.timeoutMs ?? 30 * 60 * 1000);

      child.stdout.on("data", (chunk) => {
        this.emitStdoutChunk(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      child.stderr.on("data", (chunk) => {
        this.emitStderrChunk(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        this.child = null;
        reject(error);
      });
      child.on("close", (exitCode, signal) => {
        const endedAtMs = Date.now();
        clearTimeout(timer);
        this.child = null;
        this.flushLineBuffers();
        const { events, parseErrors } = parseJsonl(this.rawStdout);
        resolve({
          threadId: extractThreadId(events),
          assistantText: extractAssistantText(events),
          events,
          rawStdout: this.rawStdout,
          parseErrors,
          exitCode,
          signal,
          stderr: this.rawStderr,
          startedAt,
          endedAt: new Date(endedAtMs).toISOString(),
          durationMs: Math.max(0, endedAtMs - startedAtMs)
        });
      });
    });
  }

  start(prompt: string): Promise<CodexTurnResult> {
    return this.run(
      [
        "exec",
        ...(this.options.ignoreUserConfig !== false ? ["--ignore-user-config"] : []),
        "--json",
        "--sandbox",
        "workspace-write",
        "--skip-git-repo-check",
        "-C",
        this.options.cwd,
        prompt
      ]
    );
  }

  resume(threadId: string, prompt: string): Promise<CodexTurnResult> {
    return this.run(
      [
        "exec",
        ...(this.options.ignoreUserConfig !== false ? ["--ignore-user-config"] : []),
        "--json",
        "--sandbox",
        "workspace-write",
        "--skip-git-repo-check",
        "resume",
        threadId,
        prompt
      ]
    );
  }
}
