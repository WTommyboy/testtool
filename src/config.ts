import dotenv from "dotenv";

dotenv.config();

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parseNumber(process.env.PORT, 3000),
  dbPath: process.env.DB_PATH ?? "./data/uat.db",
  storageRoot: process.env.STORAGE_ROOT ?? "./storage",
  defaultTimezone: process.env.DEFAULT_TIMEZONE ?? "Asia/Taipei",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  claudeModel: process.env.CLAUDE_MODEL ?? "claude-sonnet-4-20250514",
  enableGoogleSheetsSync: parseBoolean(process.env.ENABLE_GOOGLE_SHEETS_SYNC, false),
  playwrightHeadless: parseBoolean(process.env.PLAYWRIGHT_HEADLESS, true),
  playwrightTimeoutMs: parseNumber(process.env.PLAYWRIGHT_TIMEOUT_MS, 30000),
  playwrightHeartbeatIntervalMs: parseNumber(process.env.PLAYWRIGHT_HEARTBEAT_INTERVAL_MS, 15000),
  playwrightHealthcheckTimeoutMs: parseNumber(process.env.PLAYWRIGHT_HEALTHCHECK_TIMEOUT_MS, 5000),
  playwrightCrashDownMs: parseNumber(process.env.PLAYWRIGHT_CRASH_DOWN_MS, 30000),
  playwrightCrashConsecutiveThreshold: parseNumber(process.env.PLAYWRIGHT_CRASH_CONSECUTIVE_THRESHOLD, 3)
};
