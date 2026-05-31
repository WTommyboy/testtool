import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import WebSocket from "ws";
import type { AgentConfig } from "./types";

const defaultDebugPort = 9222;
const chromeLaunchCdpTimeoutMs = 15_000;
const cdpOpenTabTimeoutMs = 5_000;

type CdpTarget = {
  id?: string;
  type?: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

export type ChromeDebugSessionDiagnostics = {
  endpoint: string;
  available: boolean;
  dedicatedPids: number[];
  profileMatched: boolean;
  profileMismatch: boolean;
  targetCount: number;
  targets: CdpTarget[];
  profileDir: string;
  debugPort: string;
  chromeExecutableFound: boolean;
  error: string | null;
};

type ChromeSessionOptions = {
  resetTabs?: boolean;
  openInitialUrl?: boolean;
};

export type BrowserSessionLease = {
  schemaVersion: "uat-browser-session-v1";
  runId: string;
  caseNo: string;
  generation: number;
  sessionId: string;
  endpoint: string;
  targetId: string;
  token: string;
  tokenHash: string;
  windowName: string;
  devUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChromeBrowserSessionPrepareResult = {
  endpoint: string | null;
  lease: BrowserSessionLease | null;
  warning: string | null;
};

export type ChromeOpenUrlResult = {
  endpoint: string | null;
  target: CdpTarget | null;
  profileDir: string;
  warning: string | null;
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

const requestCdpCloseTarget = async (endpoint: string, targetId: string): Promise<void> => {
  const url = `${endpoint}/json/close/${encodeURIComponent(targetId)}`;
  try {
    const response = await withTimeout(fetch(url, { method: "PUT" }), 1000);
    if (!response.ok) throw new Error(`CDP_CLOSE_${response.status}`);
  } catch {
    try {
      const response = await withTimeout(fetch(url), 1000);
      if (!response.ok) throw new Error(`CDP_CLOSE_${response.status}`);
    } catch {
      // CDP close is best-effort. Playwright MCP can still connect and navigate.
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
  const targets = (await listCdpTargets(endpoint)).filter(isClosableExtraPageTarget);
  const targetIds = targets.map((target) => target.id as string);
  for (const targetId of targetIds) {
    await requestCdpCloseTarget(endpoint, targetId);
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

const findTargetById = async (endpoint: string, targetId: string): Promise<CdpTarget | null> => {
  return (await listCdpTargets(endpoint)).find((target) => target.id === targetId) ?? null;
};

const closeExtraPageTabs = async (endpoint: string, keepTargetId: string, options: { closeNewTab?: boolean } = {}): Promise<void> => {
  const targets = await listCdpTargets(endpoint);
  const pages = targets.filter((target) => {
    if (!isClosableExtraPageTarget(target)) return false;
    if (target.id === keepTargetId) return false;
    if (isChromeNewTabTarget(target)) return options.closeNewTab === true;
    return true;
  });

  for (const page of pages) {
    if (page.id) await requestCdpCloseTarget(endpoint, page.id);
  }
};

export const ensureSingleUserPageTab = async (endpoint: string, options: { closeNewTab?: boolean } = {}): Promise<void> => {
  const targets = await listCdpTargets(endpoint);
  const keep = pickBestVisibleTarget(targets);
  if (!keep?.id) return;
  await closeExtraPageTabs(endpoint, keep.id, options);
};

const openCdpTab = async (endpoint: string, url: string): Promise<CdpTarget | null> => {
  try {
    const response = await withTimeout(fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: "PUT" }), cdpOpenTabTimeoutMs);
    if (!response.ok) return null;
    const target = (await response.json()) as CdpTarget;
    return target.id ? target : null;
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

const normalizeChromeDebugPort = (value: unknown): number => {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : defaultDebugPort;
};

const getChromeDebugPort = (config?: AgentConfig): string => {
  const port = normalizeChromeDebugPort(process.env.UAT_AGENT_CHROME_DEBUG_PORT ?? config?.chrome_debug_port ?? defaultDebugPort);
  return String(port);
};

export const getChromeCdpEndpoint = (config?: AgentConfig): string => {
  const port = normalizeChromeDebugPort(process.env.UAT_AGENT_CHROME_DEBUG_PORT ?? config?.chrome_debug_port ?? defaultDebugPort);
  return `http://127.0.0.1:${Number.isFinite(port) ? port : defaultDebugPort}`;
};

export const browserSessionLeasePath = (runDir: string): string => path.join(runDir, "input", "browser-session.json");

export const readBrowserSessionLease = (runDir: string): BrowserSessionLease | null => {
  const filePath = browserSessionLeasePath(runDir);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as BrowserSessionLease;
};

const writeBrowserSessionLease = (runDir: string, lease: BrowserSessionLease): void => {
  const filePath = browserSessionLeasePath(runDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(lease, null, 2)}\n`);
};

const tokenHash = (token: string): string => crypto.createHash("sha256").update(token).digest("hex");

const newBrowserSessionLease = (options: {
  runDir: string;
  caseNo: string | null;
  endpoint: string;
  targetId: string;
  devUrl: string | null;
}): BrowserSessionLease => {
  const previous = readBrowserSessionLease(options.runDir);
  const runId = path.basename(path.resolve(options.runDir));
  const caseNo = options.caseNo?.trim() || "unknown-case";
  const generation = previous ? Number(previous.generation || 0) + 1 : 1;
  const sessionId = typeof previous?.sessionId === "string" && previous.sessionId.trim()
    ? previous.sessionId
    : `bs_${crypto.randomBytes(12).toString("hex")}`;
  const token = crypto.randomBytes(16).toString("hex");
  const now = new Date().toISOString();
  return {
    schemaVersion: "uat-browser-session-v1",
    runId,
    caseNo,
    generation,
    sessionId,
    endpoint: options.endpoint,
    targetId: options.targetId,
    token,
    tokenHash: tokenHash(token),
    windowName: `uat-tool:${runId}:${caseNo}:${generation}:${token}`,
    devUrl: options.devUrl,
    createdAt: now,
    updatedAt: now
  };
};

const sendCdpCommand = async (
  webSocketDebuggerUrl: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 2500
): Promise<unknown> => {
  return await new Promise<unknown>((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    const id = 1;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`CDP_COMMAND_TIMEOUT:${method}`));
    }, timeoutMs);

    ws.once("open", () => {
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.on("message", (data) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      if (parsed.id !== id) return;
      clearTimeout(timer);
      ws.close();
      if (parsed.error) {
        reject(new Error(`CDP_COMMAND_ERROR:${method}:${JSON.stringify(parsed.error)}`));
        return;
      }
      resolve(parsed.result);
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
};

const waitForTarget = async (endpoint: string, targetId: string, timeoutMs: number): Promise<CdpTarget | null> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const target = await findTargetById(endpoint, targetId);
    if (target?.webSocketDebuggerUrl) return target;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return await findTargetById(endpoint, targetId);
};

const markBrowserSessionTarget = async (endpoint: string, lease: BrowserSessionLease): Promise<string | null> => {
  const target = await waitForTarget(endpoint, lease.targetId, 5000);
  if (!target?.webSocketDebuggerUrl) return "BROWSER_SESSION_TARGET_WS_MISSING";
  const sessionMarker = {
    runId: lease.runId,
    caseNo: lease.caseNo,
    generation: lease.generation,
    sessionId: lease.sessionId,
    tokenHash: lease.tokenHash
  };
  const expression = [
    "(() => {",
    `  window.name = ${JSON.stringify(lease.windowName)};`,
    "  try {",
    `    sessionStorage.setItem("__uatToolBrowserSession", ${JSON.stringify(JSON.stringify(sessionMarker))});`,
    "  } catch (error) {}",
    "  return { windowName: window.name, href: location.href };",
    "})()"
  ].join("\n");
  try {
    await sendCdpCommand(target.webSocketDebuggerUrl, "Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    return null;
  } catch (error) {
    return `BROWSER_SESSION_MARK_FAILED:${error instanceof Error ? error.message : String(error)}`;
  }
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
  const port = getChromeDebugPort(config);
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

const listChromeDebugPortPids = async (config: AgentConfig): Promise<number[]> => {
  const port = getChromeDebugPort(config);
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="], { timeout: 1500 });
    return stdout
      .split(/\r?\n/)
      .map((line) => /^\s*(\d+)\s+(.+)$/.exec(line))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .filter((match) => {
        const command = match[2];
        return command.includes(`--remote-debugging-port=${port}`) && /\/(Google Chrome|Chromium)( Canary)?(?:\.app)?\//.test(command);
      })
      .map((match) => Number(match[1]))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
};

const terminateChromePids = async (endpoint: string, pids: number[]): Promise<void> => {
  if (await isCdpAvailable(endpoint)) {
    await closeExistingPageTabs(endpoint);
  }

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process may have already exited.
    }
  }

  if (await waitForProcessesToExit(pids, 3000)) return;

  const remainingPids = pids.filter(processExists);
  for (const pid of remainingPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process may have already exited.
    }
  }
};

export const closeChromeDebugSession = async (config: AgentConfig): Promise<void> => {
  const endpoint = getChromeCdpEndpoint(config);
  const pids = await listDedicatedChromePids(config);
  if (pids.length === 0) return;

  await terminateChromePids(endpoint, pids);
};

export const diagnoseChromeDebugSession = async (config: AgentConfig): Promise<ChromeDebugSessionDiagnostics> => {
  const endpoint = getChromeCdpEndpoint(config);
  try {
    const targets = await listCdpTargets(endpoint);
    const available = await isCdpAvailable(endpoint);
    const dedicatedPids = await listDedicatedChromePids(config);
    const profileMatched = !available || dedicatedPids.length > 0;
    return {
      endpoint,
      available,
      dedicatedPids,
      profileMatched,
      profileMismatch: available && !profileMatched,
      targetCount: targets.length,
      targets: targets.slice(0, 20),
      profileDir: path.resolve(config.chrome_profile_dir),
      debugPort: getChromeDebugPort(config),
      chromeExecutableFound: Boolean(findChromeExecutable()),
      error: null
    };
  } catch (error) {
    return {
      endpoint,
      available: false,
      dedicatedPids: [],
      profileMatched: false,
      profileMismatch: false,
      targetCount: 0,
      targets: [],
      profileDir: path.resolve(config.chrome_profile_dir),
      debugPort: getChromeDebugPort(config),
      chromeExecutableFound: Boolean(findChromeExecutable()),
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

export const ensureChromeDebugSession = async (
  config: AgentConfig,
  initialUrl?: string | null,
  options: ChromeSessionOptions = {}
): Promise<string | null> => {
  const endpoint = getChromeCdpEndpoint(config);
  const openInitialUrl = options.openInitialUrl ?? true;
  if (await isCdpAvailable(endpoint)) {
    const dedicatedPids = await listDedicatedChromePids(config);
    if (dedicatedPids.length > 0) {
      if (options.resetTabs) await closeExistingPageTabs(endpoint);
      if (initialUrl && openInitialUrl) {
        const target = await openCdpTab(endpoint, initialUrl);
        if (target?.id) await closeExtraPageTabs(endpoint, target.id, { closeNewTab: true });
      }
      return endpoint;
    }

    const debugPortPids = await listChromeDebugPortPids(config);
    if (debugPortPids.length === 0) {
      throw new Error(
        `CHROME_CDP_PROFILE_MISMATCH:${endpoint}:expected_profile=${path.resolve(config.chrome_profile_dir)}`
      );
    }

    await terminateChromePids(endpoint, debugPortPids);
    if (await isCdpAvailable(endpoint)) {
      throw new Error(
        `CHROME_CDP_PROFILE_MISMATCH:${endpoint}:expected_profile=${path.resolve(config.chrome_profile_dir)}`
      );
    }
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

  const ready = await waitForCdp(endpoint, chromeLaunchCdpTimeoutMs);
  if (ready) {
    if (options.resetTabs) await closeExistingPageTabs(endpoint);
    if (initialUrl && openInitialUrl) {
      const target = await openCdpTab(endpoint, initialUrl);
      if (target?.id) await closeExtraPageTabs(endpoint, target.id, { closeNewTab: true });
    }
  }
  return ready ? endpoint : null;
};

export const prepareChromeBrowserSession = async (
  config: AgentConfig,
  runDir: string,
  caseNo: string | null,
  initialUrl?: string | null,
  options: ChromeSessionOptions = {}
): Promise<ChromeBrowserSessionPrepareResult> => {
  const endpoint = await ensureChromeDebugSession(config, null, {
    resetTabs: false,
    openInitialUrl: false
  });
  if (!endpoint) return { endpoint: null, lease: null, warning: "CHROME_CDP_UNAVAILABLE" };

  const openInitialUrl = options.openInitialUrl ?? true;
  if (options.resetTabs) await closeExistingPageTabs(endpoint);

  const target = initialUrl && openInitialUrl
    ? await openCdpTab(endpoint, initialUrl)
    : pickBestVisibleTarget(await listCdpTargets(endpoint));
  if (!target?.id) {
    return { endpoint, lease: null, warning: "BROWSER_SESSION_TARGET_CREATE_FAILED" };
  }

  await closeExtraPageTabs(endpoint, target.id, { closeNewTab: true });
  const latestTarget = await waitForTarget(endpoint, target.id, 5000);
  const lease = newBrowserSessionLease({
    runDir,
    caseNo,
    endpoint,
    targetId: latestTarget?.id ?? target.id,
    devUrl: initialUrl ?? latestTarget?.url ?? target.url ?? null
  });
  const markWarning = await markBrowserSessionTarget(endpoint, lease);
  writeBrowserSessionLease(runDir, lease);
  return { endpoint, lease, warning: markWarning };
};

export const openUrlInDedicatedChrome = async (
  config: AgentConfig,
  url: string,
  options: ChromeSessionOptions = {}
): Promise<ChromeOpenUrlResult> => {
  let endpoint = await ensureChromeDebugSession(config, null, {
    resetTabs: false,
    openInitialUrl: false
  });
  const profileDir = path.resolve(config.chrome_profile_dir);
  if (!endpoint) {
    const fallbackEndpoint = getChromeCdpEndpoint(config);
    if (await waitForCdp(fallbackEndpoint, chromeLaunchCdpTimeoutMs)) {
      const dedicatedPids = await listDedicatedChromePids(config);
      if (dedicatedPids.length === 0) {
        throw new Error(
          `CHROME_CDP_PROFILE_MISMATCH:${fallbackEndpoint}:expected_profile=${path.resolve(config.chrome_profile_dir)}`
        );
      }
      endpoint = fallbackEndpoint;
    }
  }

  if (!endpoint) {
    return {
      endpoint: null,
      target: null,
      profileDir,
      warning: "CHROME_CDP_UNAVAILABLE"
    };
  }

  if (options.resetTabs ?? true) await closeExistingPageTabs(endpoint);
  const target = await openCdpTab(endpoint, url);
  if (!target?.id) {
    return {
      endpoint,
      target: null,
      profileDir,
      warning: "BROWSER_TARGET_CREATE_FAILED"
    };
  }

  await closeExtraPageTabs(endpoint, target.id, { closeNewTab: true });
  const latestTarget = await waitForTarget(endpoint, target.id, 5000);
  return {
    endpoint,
    target: latestTarget ?? target,
    profileDir,
    warning: latestTarget ? null : "BROWSER_TARGET_READY_TIMEOUT"
  };
};
