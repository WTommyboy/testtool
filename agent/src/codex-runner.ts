import { spawn, type ChildProcess } from "node:child_process";

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
};

export type CodexRunnerOptions = {
  codexBin: string;
  cwd: string;
  timeoutMs?: number;
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

export class CodexRunner {
  private child: ChildProcess | null = null;
  private cancelReason: string | null = null;

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

  private run(args: string[]): Promise<CodexTurnResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.codexBin, args, {
        cwd: this.options.cwd,
        env: { ...process.env, NO_COLOR: "1" },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      this.child = child;
      this.cancelReason = null;
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        this.cancel("timeout");
      }, this.options.timeoutMs ?? 30 * 60 * 1000);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        this.child = null;
        reject(error);
      });
      child.on("close", (exitCode, signal) => {
        clearTimeout(timer);
        this.child = null;
        const { events, parseErrors } = parseJsonl(stdout);
        resolve({
          threadId: extractThreadId(events),
          assistantText: extractAssistantText(events),
          events,
          rawStdout: stdout,
          parseErrors,
          exitCode,
          signal,
          stderr
        });
      });
    });
  }

  start(prompt: string): Promise<CodexTurnResult> {
    return this.run(
      [
        "exec",
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
    return this.run(["exec", "resume", "--json", threadId, prompt]);
  }
}
