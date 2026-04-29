import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentConfig } from "./types";

const defaultDebugPort = 9222;

type CdpTarget = {
  id?: string;
  type?: string;
  title?: string;
  url?: string;
};

type ChromeSessionOptions = {
  resetTabs?: boolean;
  openInitialUrl?: boolean;
};

const chromeExecutableCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
];

const execFileAsync = promisify(execFile);

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

const listCdpTargets = async (endpoint: string): Promise<CdpTarget[]> => {
  try {
    const response = await withTimeout(fetch(`${endpoint}/json/list`), 1000);
    if (!response.ok) return [];
    const targets = (await response.json()) as CdpTarget[];
    return Array.isArray(targets) ? targets : [];
  } catch {
    return [];
  }
};

const requestCdpTargetAction = async (endpoint: string, action: "activate" | "close", targetId: string): Promise<void> => {
  const url = `${endpoint}/json/${action}/${encodeURIComponent(targetId)}`;
  try {
    const response = await withTimeout(fetch(url, { method: "PUT" }), 1000);
    if (!response.ok) throw new Error(`CDP_${action.toUpperCase()}_${response.status}`);
  } catch {
    try {
      const response = await withTimeout(fetch(url), 1000);
      if (!response.ok) throw new Error(`CDP_${action.toUpperCase()}_${response.status}`);
    } catch {
      // CDP target actions are best-effort. Playwright MCP can still connect and navigate.
    }
  }
};

const isChromeNewTabTarget = (target: CdpTarget): boolean => {
  const url = target.url ?? "";
  return url === "chrome://newtab/" || url.startsWith("chrome://new-tab-page");
};

const isUnclosableBrowserTarget = (target: CdpTarget): boolean => {
  const url = target.url ?? "";
  return (
    url.startsWith("devtools://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("chrome://omnibox-popup") ||
    (url.startsWith("chrome://") && !isChromeNewTabTarget(target))
  );
};

const isApplicationPageTarget = (target: CdpTarget): boolean => {
  return target.type === "page" && Boolean(target.id) && !isChromeNewTabTarget(target) && !isUnclosableBrowserTarget(target);
};

const isClosableExtraPageTarget = (target: CdpTarget): boolean => {
  return target.type === "page" && Boolean(target.id) && (isApplicationPageTarget(target) || isChromeNewTabTarget(target));
};

const closeExistingPageTabs = async (endpoint: string): Promise<void> => {
  const targets = (await listCdpTargets(endpoint)).filter(isApplicationPageTarget);
  const targetIds = targets.map((target) => target.id as string);
  for (const targetId of targetIds) {
    await requestCdpTargetAction(endpoint, "close", targetId);
  }

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const remaining = (await listCdpTargets(endpoint)).filter((target) => target.id && targetIds.includes(target.id));
    if (remaining.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
};

const pickBestVisibleTarget = (targets: CdpTarget[]): CdpTarget | null => {
  const pages = targets.filter(isApplicationPageTarget);
  return (
    pages.find((target) => target.url?.includes("/testview/edit")) ??
    pages.find((target) => target.url?.includes("/testview/home")) ??
    pages[0] ??
    null
  );
};

export const activateBestExistingTab = async (endpoint: string): Promise<void> => {
  const target = pickBestVisibleTarget(await listCdpTargets(endpoint));
  if (target?.id) await requestCdpTargetAction(endpoint, "activate", target.id);
};

export const ensureSingleUserPageTab = async (endpoint: string, options: { closeNewTab?: boolean } = {}): Promise<void> => {
  const targets = await listCdpTargets(endpoint);
  const keep = pickBestVisibleTarget(targets);
  if (!keep?.id) return;

  const pages = targets.filter((target) => {
    if (!isClosableExtraPageTarget(target)) return false;
    if (isChromeNewTabTarget(target)) return options.closeNewTab === true;
    return true;
  });

  for (const page of pages) {
    if (page.id && page.id !== keep.id) {
      await requestCdpTargetAction(endpoint, "close", page.id);
    }
  }

  const remainingTargets = await listCdpTargets(endpoint);
  const remainingKeep = remainingTargets.find((target) => target.id === keep.id) ?? pickBestVisibleTarget(remainingTargets);
  if (remainingKeep?.id) await requestCdpTargetAction(endpoint, "activate", remainingKeep.id);
};

const openCdpTab = async (endpoint: string, url: string): Promise<string | null> => {
  try {
    const response = await withTimeout(fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: "PUT" }), 1000);
    if (!response.ok) return null;
    const target = (await response.json()) as CdpTarget;
    if (target.id) await requestCdpTargetAction(endpoint, "activate", target.id);
    return target.id ?? null;
  } catch {
    // Opening the visible window is best-effort; Codex can still navigate through Playwright MCP.
    return null;
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

const getChromeDebugPort = (): string => {
  const port = Number(process.env.UAT_AGENT_CHROME_DEBUG_PORT || defaultDebugPort);
  return String(Number.isFinite(port) ? port : defaultDebugPort);
};

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitForProcessesToExit = async (pids: number[], timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !processExists(pid))) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return pids.every((pid) => !processExists(pid));
};

const listDedicatedChromePids = async (config: AgentConfig): Promise<number[]> => {
  const profileDir = path.resolve(config.chrome_profile_dir);
  const port = getChromeDebugPort();
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="], { timeout: 1500 });
    return stdout
      .split(/\r?\n/)
      .map((line) => /^\s*(\d+)\s+(.+)$/.exec(line))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .filter((match) => {
        const command = match[2];
        return command.includes(`--remote-debugging-port=${port}`) && command.includes(`--user-data-dir=${profileDir}`);
      })
      .map((match) => Number(match[1]))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
};

export const closeChromeDebugSession = async (config: AgentConfig): Promise<void> => {
  const endpoint = getChromeCdpEndpoint();
  if (await isCdpAvailable(endpoint)) {
    await closeExistingPageTabs(endpoint);
  }

  const pids = await listDedicatedChromePids(config);
  if (pids.length === 0) return;

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process may have already exited.
    }
  }

  if (await waitForProcessesToExit(pids, 3000)) return;

  const remainingPids = await listDedicatedChromePids(config);
  for (const pid of remainingPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process may have already exited.
    }
  }
};

export const ensureChromeDebugSession = async (
  config: AgentConfig,
  initialUrl?: string | null,
  options: ChromeSessionOptions = {}
): Promise<string | null> => {
  const endpoint = getChromeCdpEndpoint();
  const openInitialUrl = options.openInitialUrl ?? true;
  if (await isCdpAvailable(endpoint)) {
    if (options.resetTabs) await closeExistingPageTabs(endpoint);
    if (initialUrl && openInitialUrl) {
      await openCdpTab(endpoint, initialUrl);
      await ensureSingleUserPageTab(endpoint, { closeNewTab: true });
    } else {
      await activateBestExistingTab(endpoint);
    }
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
  if (initialUrl && openInitialUrl && !options.resetTabs) args.push(initialUrl);

  const child = spawn(chromeExecutable, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  const ready = await waitForCdp(endpoint, 5000);
  if (ready) {
    if (options.resetTabs) await closeExistingPageTabs(endpoint);
    if (initialUrl && openInitialUrl) {
      await openCdpTab(endpoint, initialUrl);
      await ensureSingleUserPageTab(endpoint, { closeNewTab: true });
    } else {
      await activateBestExistingTab(endpoint);
    }
  }
  return ready ? endpoint : null;
};
