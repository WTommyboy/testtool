import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AgentConfig } from "./types";

const defaultDebugPort = 9222;

const chromeExecutableCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
];

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("TIMEOUT")), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const isCdpAvailable = async (endpoint: string): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 700);
    const response = await fetch(`${endpoint}/json/version`, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
};

const openCdpTab = async (endpoint: string, url: string): Promise<void> => {
  try {
    await withTimeout(
      fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: "PUT" }).then(() => undefined),
      1000
    );
  } catch {
    // Opening the visible window is best-effort; Codex can still navigate through Playwright MCP.
  }
};

const findChromeExecutable = (): string | null => {
  return chromeExecutableCandidates.find((candidate) => fs.existsSync(candidate)) ?? null;
};

const waitForCdp = async (endpoint: string, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isCdpAvailable(endpoint)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
};

export const getChromeCdpEndpoint = (): string => {
  const port = Number(process.env.UAT_AGENT_CHROME_DEBUG_PORT || defaultDebugPort);
  return `http://127.0.0.1:${Number.isFinite(port) ? port : defaultDebugPort}`;
};

export const ensureChromeDebugSession = async (
  config: AgentConfig,
  initialUrl?: string | null
): Promise<string | null> => {
  const endpoint = getChromeCdpEndpoint();
  if (await isCdpAvailable(endpoint)) {
    if (initialUrl) await openCdpTab(endpoint, initialUrl);
    return endpoint;
  }

  const chromeExecutable = findChromeExecutable();
  if (!chromeExecutable) return null;

  fs.mkdirSync(config.chrome_profile_dir, { recursive: true });
  const port = new URL(endpoint).port || String(defaultDebugPort);
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.resolve(config.chrome_profile_dir)}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window"
  ];
  if (initialUrl) args.push(initialUrl);

  const child = spawn(chromeExecutable, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  return (await waitForCdp(endpoint, 5000)) ? endpoint : null;
};
