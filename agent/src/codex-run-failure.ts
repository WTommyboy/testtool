export type CodexRunFailureLike = {
  assistantText?: string;
  rawStdout?: string;
  stderr?: string;
  events?: Array<Record<string, unknown>>;
  exitCode?: number | null;
};

export const CODEX_USAGE_LIMIT_CATEGORY = "CODEX_USAGE_LIMIT" as const;

const collectEventMessages = (events: Array<Record<string, unknown>> | undefined): string[] => {
  if (!events) return [];
  const messages: string[] = [];
  for (const event of events) {
    const message = event.message;
    if (typeof message === "string") messages.push(message);
    const error = event.error;
    if (error && typeof error === "object" && !Array.isArray(error)) {
      const errorMessage = (error as { message?: unknown }).message;
      if (typeof errorMessage === "string") messages.push(errorMessage);
    }
  }
  return messages;
};

const usageLimitPattern = /(?:you(?:'|’)?ve hit your usage limit|purchase more credits|try again at \d{1,2}:\d{2}\s*(?:am|pm)?)/i;

const usageLimitText = (result: CodexRunFailureLike): string => [
  result.assistantText ?? "",
  result.rawStdout ?? "",
  result.stderr ?? "",
  ...collectEventMessages(result.events)
].filter(Boolean).join("\n");

export const extractCodexUsageLimitMessage = (result: CodexRunFailureLike): string | null => {
  const lines = usageLimitText(result)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => usageLimitPattern.test(line)) ?? null;
};

export const isCodexUsageLimitFailure = (result: CodexRunFailureLike): boolean => {
  if (result.exitCode === 0) return false;
  return usageLimitPattern.test(usageLimitText(result));
};

