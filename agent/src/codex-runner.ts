import { spawn } from "node:child_process";

export type CodexJsonEvent = Record<string, unknown>;

export type CodexTurnResult = {
  threadId: string | null;
  assistantText: string;
  events: CodexJsonEvent[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
};

export type CodexRunnerOptions = {
  codexBin: string;
  cwd: string;
  timeoutMs?: number;
};

const parseJsonl = (stdout: string): CodexJsonEvent[] => {
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CodexJsonEvent);
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

const runCodex = (
  args: string[],
  options: CodexRunnerOptions
): Promise<CodexTurnResult> => {
  return new Promise((resolve, reject) => {
    const child = spawn(options.codexBin, args, {
      cwd: options.cwd,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3_000).unref();
    }, options.timeoutMs ?? 30 * 60 * 1000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      const events = parseJsonl(stdout);
      resolve({
        threadId: extractThreadId(events),
        assistantText: extractAssistantText(events),
        events,
        exitCode,
        signal,
        stderr
      });
    });
  });
};

export class CodexRunner {
  constructor(private readonly options: CodexRunnerOptions) {}

  start(prompt: string): Promise<CodexTurnResult> {
    return runCodex(
      [
        "exec",
        "--json",
        "--sandbox",
        "workspace-write",
        "--skip-git-repo-check",
        "-C",
        this.options.cwd,
        prompt
      ],
      this.options
    );
  }

  resume(threadId: string, prompt: string): Promise<CodexTurnResult> {
    return runCodex(["exec", "resume", "--json", threadId, prompt], this.options);
  }
}
