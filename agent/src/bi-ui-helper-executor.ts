#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Dialog, type Download, type Page, type Request, type Response } from "playwright";
import { closeChromeDebugSession, diagnoseChromeDebugSession, ensureChromeDebugSession, readBrowserSessionLease, type BrowserSessionLease } from "./browser-session";
import { readConfig } from "./config";

type CliOptions = {
  runDir: string;
  caseId: string;
  action: string;
  params: Record<string, unknown>;
  approvedToolRequestId: string | null;
  closeAfter: boolean;
};

type HelperReport = {
  schemaVersion: "bi-ui-helper-report-v1";
  generatedAt: string;
  runId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  caseId: string;
  action: string;
  status: "ok" | "blocked" | "requires_approval" | "not_implemented" | "error";
  helperCanJudgeResult: false;
  params: Record<string, unknown>;
  evidenceMetadata: {
    source: "mac-agent-bi-ui-helper";
    runId: string;
    caseId: string;
    action: string;
    currentRunEvidence: true;
    artifactRoot: string;
    generatedAt: string;
    startedAt: string;
    endedAt: string;
  };
  evidence: Record<string, unknown>;
  artifacts: Record<string, string>;
  warnings: string[];
  error?: string;
  toolRequest?: Record<string, unknown>;
};

type BrowserSessionRuntimeEvidence = {
  browserSession: {
    schemaVersion: BrowserSessionLease["schemaVersion"];
    runId: string;
    caseNo: string;
    generation: number;
    sessionId: string;
    targetId: string;
    tokenHash: string;
    windowNamePrefix: string;
    endpoint: string;
  };
  targetBinding: {
    resolvedBy: "window.name";
    tokenMatch: boolean;
    urlMatch: boolean;
    targetIdMatch: boolean | "not_checked";
    pageUrl: string;
  };
  foregroundPolicy: {
    mode: "no-activate";
    bringToFrontCalled: false;
    cdpActivateCalled: false;
  };
};

class HelperBlockedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "HelperBlockedError";
    this.reason = reason;
  }
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, reason: string): Promise<T> => {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new HelperBlockedError(`${reason}:${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
};

const isActionabilityFailure = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /locator\.click|Timeout|not visible|not enabled|not stable|receives pointer events|outside of the viewport|strict mode violation/i.test(message);
};

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);
  const get = (name: string): string | null => {
    const index = args.indexOf(name);
    return index === -1 ? null : (args[index + 1] ?? null);
  };
  const paramsJson = get("--params-json") ?? "{}";
  let params: Record<string, unknown>;
  try {
    const parsed = JSON.parse(paramsJson) as unknown;
    params = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch (error) {
    throw new Error(`INVALID_PARAMS_JSON:${error instanceof Error ? error.message : String(error)}`);
  }

  const runDir = get("--run-dir");
  const action = get("--action");
  if (!runDir || !action) {
    throw new Error("Usage: node bi-ui-helper-executor.js --run-dir <runDir> --case <caseId> --action <template> --params-json '<json>' [--approved-tool-request-id <id>] [--close-after]");
  }

  return {
    runDir,
    caseId: get("--case") ?? String(params.caseId ?? "unknown-case"),
    action,
    params,
    approvedToolRequestId: get("--approved-tool-request-id"),
    closeAfter: args.includes("--close-after")
  };
};

const sanitize = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "artifact";

const ensureDir = (dir: string): void => {
  fs.mkdirSync(dir, { recursive: true });
};

const artifactRoot = (options: CliOptions): string => path.join(options.runDir, "output", "helper-artifacts", sanitize(options.caseId));

const runIdFromOptions = (options: CliOptions): string => path.basename(path.resolve(options.runDir));

const writeReport = (options: CliOptions, report: HelperReport): void => {
  const dir = artifactRoot(options);
  ensureDir(dir);
  fs.appendFileSync(path.join(dir, "helper-report.jsonl"), `${JSON.stringify(report)}\n`);
  fs.writeFileSync(path.join(dir, `${sanitize(options.action)}-latest.json`), `${JSON.stringify(report, null, 2)}\n`);
};

const stringParam = (params: Record<string, unknown>, key: string): string | null => {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const firstStringParam = (params: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = stringParam(params, key);
    if (value) return value;
  }
  return null;
};

const stringArrayParam = (params: Record<string, unknown>, key: string): string[] => {
  const value = params[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
};

const splitCompositeMetricFields = (value: string | null): string[] => {
  if (!value) return [];
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of value) {
    if (char === "(" || char === "（" || char === "[" || char === "【") depth += 1;
    if (char === ")" || char === "）" || char === "]" || char === "】") depth = Math.max(0, depth - 1);
    if (depth === 0 && (char === "+" || char === "＋" || char === "、" || char === "," || char === "，")) {
      const part = current.trim();
      if (part) parts.push(part);
      current = "";
      continue;
    }
    current += char;
  }
  const tail = current.trim();
  if (tail) parts.push(tail);
  return [...new Set(parts)];
};

const metricFieldsFromParams = (params: Record<string, unknown>): string[] => {
  const explicit = stringArrayParam(params, "fields");
  if (explicit.length > 0) return [...new Set(explicit)];
  return splitCompositeMetricFields(firstStringParam(params, ["field", "metric", "metricField"]));
};

const timestampId = (): string => new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 12);

const resolveReportName = (options: CliOptions): string => {
  const explicit = firstStringParam(options.params, ["reportName", "reportNamePattern", "name"]);
  if (explicit) return explicit.replace("<timestamp>", timestampId());
  return `${sanitize(options.caseId)}_${timestampId()}`;
};

const savedReportStatePath = (options: CliOptions): string => path.join(artifactRoot(options), "saved-report.json");
const previewEvidencePath = (options: CliOptions): string => path.join(artifactRoot(options), "preview-evidence.json");

const writeSavedReportState = (options: CliOptions, reportName: string, extra: Record<string, unknown> = {}): void => {
  ensureDir(artifactRoot(options));
  fs.writeFileSync(
    savedReportStatePath(options),
    `${JSON.stringify({ reportName, caseId: options.caseId, savedAt: new Date().toISOString(), ...extra }, null, 2)}\n`
  );
};

const readSavedReportName = (options: CliOptions): string | null => {
  const explicit = firstStringParam(options.params, ["reportName", "savedReportName", "name"]);
  if (explicit) return explicit;
  const filePath = savedReportStatePath(options);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as { reportName?: unknown };
    return typeof parsed.reportName === "string" && parsed.reportName.trim() ? parsed.reportName.trim() : null;
  } catch {
    return null;
  }
};

const wildcardPatternToRegExp = (value: string): RegExp => {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped
    .replace(/<timestamp>/gi, "[A-Za-z0-9_-]+")
    .replace(/\\\*/g, ".*");
  return new RegExp(`^${pattern}$`, "i");
};

const reportNameMatchesPattern = (reportName: string, pattern: string): boolean => {
  if (reportName === pattern) return true;
  return wildcardPatternToRegExp(pattern).test(reportName);
};

const readSavedReportStateFiles = (options: CliOptions): Array<{ caseId: string; reportName: string; path: string; savedAt: string | null }> => {
  const root = path.join(options.runDir, "output", "helper-artifacts");
  if (!fs.existsSync(root)) return [];
  const result: Array<{ caseId: string; reportName: string; path: string; savedAt: string | null }> = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(root, entry.name, "saved-report.json");
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
      const reportName = typeof parsed.reportName === "string" ? parsed.reportName.trim() : "";
      if (!reportName) continue;
      result.push({
        caseId: typeof parsed.caseId === "string" && parsed.caseId.trim() ? parsed.caseId.trim() : entry.name,
        reportName,
        path: filePath,
        savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : null
      });
    } catch {
      // Ignore malformed historical helper artifacts.
    }
  }
  return result.sort((a, b) => String(b.savedAt ?? "").localeCompare(String(a.savedAt ?? "")));
};

const resolveExistingReportName = async (options: CliOptions, page: Page): Promise<{ reportName: string; source: string; candidates: unknown[] }> => {
  const explicit = firstStringParam(options.params, ["existingReportName", "savedReportName"]);
  if (explicit) return { reportName: explicit, source: "params.existingReportName", candidates: [] };

  const pattern = firstStringParam(options.params, ["existingReportNamePattern", "reportNamePattern"]) ?? "TOOL_A01_<timestamp>";
  const sourceCaseNo = stringParam(options.params, "existingReportSourceCaseNo");
  const savedReports = readSavedReportStateFiles(options);
  const matchedSaved = savedReports.find((item) => {
    const caseMatches = !sourceCaseNo || item.caseId === sourceCaseNo || item.path.includes(sanitize(sourceCaseNo));
    return caseMatches && reportNameMatchesPattern(item.reportName, pattern);
  }) ?? savedReports.find((item) => reportNameMatchesPattern(item.reportName, pattern));
  if (matchedSaved) {
    return {
      reportName: matchedSaved.reportName,
      source: "helper-artifacts.saved-report",
      candidates: savedReports.map((item) => ({ caseId: item.caseId, reportName: item.reportName, savedAt: item.savedAt }))
    };
  }

  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const bodyCandidate = bodyText
    .split(/\s+/)
    .map((item) => item.trim())
    .find((item) => reportNameMatchesPattern(item, pattern));
  if (bodyCandidate) {
    return {
      reportName: bodyCandidate,
      source: "visible-report-list-text",
      candidates: savedReports.map((item) => ({ caseId: item.caseId, reportName: item.reportName, savedAt: item.savedAt }))
    };
  }

  throw new HelperBlockedError(`EXISTING_REPORT_ROW_NOT_FOUND_PRECONDITION:pattern=${pattern};savedReports=${JSON.stringify(savedReports).slice(0, 1000)}`);
};

const createReport = (
  options: CliOptions,
  status: HelperReport["status"],
  startedAt: string,
  evidence: Record<string, unknown>,
  artifacts: Record<string, string>,
  warnings: string[] = [],
  extra: Partial<HelperReport> = {}
): HelperReport => {
  const generatedAt = new Date().toISOString();
  const endedAt = generatedAt;
  const runId = runIdFromOptions(options);
  return {
    schemaVersion: "bi-ui-helper-report-v1",
    generatedAt,
    runId,
    startedAt,
    endedAt,
    durationMs: Math.max(0, Date.now() - Date.parse(startedAt)),
    caseId: options.caseId,
    action: options.action,
    status,
    helperCanJudgeResult: false,
    params: options.params,
    evidenceMetadata: {
      source: "mac-agent-bi-ui-helper",
      runId,
      caseId: options.caseId,
      action: options.action,
      currentRunEvidence: true,
      artifactRoot: artifactRoot(options),
      generatedAt,
      startedAt,
      endedAt
    },
    evidence,
    artifacts,
    warnings,
    ...extra
  };
};

const browserSessionWindowNamePrefix = (lease: BrowserSessionLease): string =>
  `uat-tool:${lease.runId}:${lease.caseNo}:${lease.generation}`;

const isGalaxyBiDevUrl = (url: string): boolean => /^https:\/\/galaxy\.games\.gamania\.com\/biapi-dev\//i.test(url);

const readPageBrowserSessionMarker = async (page: Page): Promise<{ windowName: string; sessionRaw: string | null; url: string } | null> => {
  try {
    return await page.evaluate(() => ({
      windowName: window.name || "",
      sessionRaw: sessionStorage.getItem("__uatToolBrowserSession"),
      url: location.href
    }));
  } catch {
    return null;
  }
};

const browserSessionEvidence = (
  lease: BrowserSessionLease,
  page: Page
): BrowserSessionRuntimeEvidence => ({
  browserSession: {
    schemaVersion: lease.schemaVersion,
    runId: lease.runId,
    caseNo: lease.caseNo,
    generation: lease.generation,
    sessionId: lease.sessionId,
    targetId: lease.targetId,
    tokenHash: lease.tokenHash,
    windowNamePrefix: browserSessionWindowNamePrefix(lease),
    endpoint: lease.endpoint
  },
  targetBinding: {
    resolvedBy: "window.name",
    tokenMatch: true,
    urlMatch: isGalaxyBiDevUrl(page.url()),
    targetIdMatch: "not_checked",
    pageUrl: page.url()
  },
  foregroundPolicy: {
    mode: "no-activate",
    bringToFrontCalled: false,
    cdpActivateCalled: false
  }
});

const attachBrowserSessionEvidence = (report: HelperReport, evidence: BrowserSessionRuntimeEvidence | null): HelperReport => {
  if (!evidence) return report;
  return {
    ...report,
    evidence: {
      ...report.evidence,
      ...evidence
    }
  };
};

const resolveBrowserSessionPage = async (
  options: CliOptions,
  browser: Browser
): Promise<{ page: Page; runtimeEvidence: BrowserSessionRuntimeEvidence }> => {
  const lease = readBrowserSessionLease(options.runDir);
  if (!lease) throw new HelperBlockedError("BROWSER_SESSION_LEASE_MISSING");
  if (lease.runId !== runIdFromOptions(options)) {
    throw new HelperBlockedError(`BROWSER_SESSION_STALE:leaseRunId=${lease.runId};expectedRunId=${runIdFromOptions(options)}`);
  }
  if (lease.caseNo !== options.caseId) {
    throw new HelperBlockedError(`BROWSER_SESSION_STALE:leaseCaseNo=${lease.caseNo};expectedCaseNo=${options.caseId}`);
  }

  const pages = browser.contexts().flatMap((context) => context.pages());
  const mismatches: Array<{ url: string; windowName: string }> = [];
  for (const page of pages) {
    const marker = await readPageBrowserSessionMarker(page);
    if (!marker) continue;
    if (marker.windowName === lease.windowName) {
      if (!isGalaxyBiDevUrl(marker.url)) {
        throw new HelperBlockedError(`BROWSER_SESSION_URL_MISMATCH:url=${marker.url}`);
      }
      return {
        page,
        runtimeEvidence: browserSessionEvidence(lease, page)
      };
    }
    if (marker.windowName.startsWith("uat-tool:")) {
      mismatches.push({ url: marker.url, windowName: marker.windowName.slice(0, 180) });
    }
  }

  const targetStillExists = pages.some((page) => page.url() === lease.devUrl || isGalaxyBiDevUrl(page.url()));
  if (targetStillExists) {
    throw new HelperBlockedError(
      `BROWSER_SESSION_TOKEN_MISMATCH:expected=${browserSessionWindowNamePrefix(lease)};uatTargets=${JSON.stringify(mismatches).slice(0, 1000)}`
    );
  }
  throw new HelperBlockedError(`BROWSER_SESSION_TARGET_MISSING:targetId=${lease.targetId};caseNo=${lease.caseNo};generation=${lease.generation}`);
};

const isApplicationPage = (page: Page): boolean => /^https?:\/\//i.test(page.url());

const screenshot = async (options: CliOptions, page: Page, label: string): Promise<string | null> => {
  const filePath = path.join(artifactRoot(options), `${sanitize(options.caseId)}-${sanitize(label)}.png`);
  ensureDir(path.dirname(filePath));
  try {
    await page.screenshot({ path: filePath, fullPage: false, timeout: 7000 });
    return filePath;
  } catch {
    return null;
  }
};

type UiDomProfileRef = {
  schemaVersion: "ui-dom-profile-ref-v1";
  context: string;
  status: "ok" | "error";
  signature?: string;
  path?: string;
  relativePath?: string;
  reused?: boolean;
  summary?: Record<string, unknown>;
  error?: string;
};

type UiDomProfile = {
  schemaVersion: "ui-dom-profile-v1";
  generatedAt: string;
  runId: string;
  caseId: string;
  action: string;
  context: string;
  signature: string;
  url: string;
  route: string;
  title: string;
  viewport: { width: number; height: number };
  bodyTextExcerpt: string;
  controls: {
    buttons: Array<Record<string, unknown>>;
    inputs: Array<Record<string, unknown>>;
    selects: Array<Record<string, unknown>>;
  };
  widgets: {
    datePicker: Record<string, unknown>;
    dialogs: Array<Record<string, unknown>>;
  };
  limits: Record<string, unknown>;
  policy: string;
};

const normalizeSignatureText = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  return value
    .replace(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/g, "<date>")
    .replace(/\d{1,3}\s*天/g, "<n>天")
    .replace(/\d{1,2}\s*月\s+\d{4}/g, "<month>")
    .replace(/[一二三四五六七八九十]{1,2}月\s+\d{4}/g, "<month>")
    .replace(/\s+/g, " ")
    .trim();
};

const profileSignature = (profile: Omit<UiDomProfile, "signature">): string => {
  const stable = {
    route: profile.route,
    title: profile.title,
    buttons: profile.controls.buttons.map((button) => ({
      selector: button.selector,
      text: normalizeSignatureText(button.text),
      role: button.role,
      ariaLabel: button.ariaLabel,
      onclick: normalizeSignatureText(button.onclick),
      disabled: button.disabled
    })),
    inputs: profile.controls.inputs.map((input) => ({
      selector: input.selector,
      type: input.type,
      name: input.name,
      placeholder: input.placeholder,
      role: input.role,
      disabled: input.disabled,
      readonly: input.readonly
    })),
    selects: profile.controls.selects.map((select) => ({
      selector: select.selector,
      name: select.name,
      role: select.role,
      optionTexts: Array.isArray(select.options)
        ? select.options.map((option) => typeof option === "object" && option !== null ? normalizeSignatureText((option as { text?: unknown }).text) : null)
        : []
    })),
    datePicker: {
      exists: profile.widgets.datePicker.exists,
      visible: profile.widgets.datePicker.visible,
      hasStartCalendar: profile.widgets.datePicker.hasStartCalendar,
      hasEndCalendar: profile.widgets.datePicker.hasEndCalendar,
      tabButtons: profile.widgets.datePicker.tabButtons,
      navButtons: profile.widgets.datePicker.navButtons,
      startDayCellCount: profile.widgets.datePicker.startDayCellCount,
      endDayCellCount: profile.widgets.datePicker.endDayCellCount
    },
    dialogs: profile.widgets.dialogs.map((dialog) => ({
      selector: dialog.selector,
      role: dialog.role,
      title: dialog.title,
      buttons: dialog.buttons
    }))
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
};

const readUiDomProfile = async (options: CliOptions, page: Page, context: string): Promise<UiDomProfile> => {
  const generatedAt = new Date().toISOString();
  const runId = runIdFromOptions(options);
  const base = await page.evaluate(({ generatedAt: profileGeneratedAt, runId: profileRunId, caseId, action, context: profileContext }) => {
    const truncate = (value: string | null | undefined, length = 160): string | null => {
      const normalized = (value ?? "").trim().replace(/\s+/g, " ");
      if (!normalized) return null;
      return normalized.length > length ? `${normalized.slice(0, length)}...` : normalized;
    };
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const rectFor = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };
    const selectorFor = (element: Element): string => {
      const id = element.getAttribute("id");
      if (id) return `#${id}`;
      const testId = element.getAttribute("data-testid") ?? element.getAttribute("data-test") ?? element.getAttribute("data-cy");
      if (testId) return `${element.tagName.toLowerCase()}[data-testid="${testId}"]`;
      const name = element.getAttribute("name");
      if (name) return `${element.tagName.toLowerCase()}[name="${name}"]`;
      const aria = element.getAttribute("aria-label");
      if (aria) return `${element.tagName.toLowerCase()}[aria-label="${aria}"]`;
      const onclick = element.getAttribute("onclick");
      if (onclick) return `${element.tagName.toLowerCase()}[onclick="${onclick.slice(0, 80)}"]`;
      return element.tagName.toLowerCase();
    };
    const classTokensFor = (element: Element): string[] => {
      const className = typeof (element as HTMLElement).className === "string" ? (element as HTMLElement).className : "";
      return className.split(/\s+/).filter(Boolean).slice(0, 8);
    };
    const elementSummary = (element: HTMLElement, index: number): Record<string, unknown> => ({
      index,
      selector: selectorFor(element),
      tagName: element.tagName.toLowerCase(),
      id: element.id || null,
      role: element.getAttribute("role"),
      ariaLabel: element.getAttribute("aria-label"),
      name: element.getAttribute("name"),
      text: truncate(element.innerText || element.textContent, 120),
      classTokens: classTokensFor(element),
      onclick: truncate(element.getAttribute("onclick"), 140),
      disabled: "disabled" in element ? Boolean((element as HTMLButtonElement).disabled) : element.getAttribute("aria-disabled") === "true",
      rect: rectFor(element)
    });
    const visibleButtons = Array.from(document.querySelectorAll("button"))
      .flatMap((button, index) => isVisible(button) ? [elementSummary(button, index)] : [])
      .slice(0, 100);
    const visibleInputs = Array.from(document.querySelectorAll("input, textarea"))
      .flatMap((input, index) => {
        if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) || !isVisible(input)) return [];
        return [{
          ...elementSummary(input, index),
          type: input instanceof HTMLInputElement ? input.type : "textarea",
          placeholder: truncate(input.placeholder, 120),
          value: truncate(input.value, 120),
          readonly: input.readOnly
        }];
      })
      .slice(0, 80);
    const visibleSelects = Array.from(document.querySelectorAll("select"))
      .flatMap((select, index) => {
        if (!(select instanceof HTMLSelectElement) || !isVisible(select)) return [];
        return [{
          ...elementSummary(select, index),
          value: truncate(select.value, 120),
          selectedText: truncate(select.selectedOptions?.[0]?.textContent, 120),
          options: Array.from(select.options).slice(0, 40).map((option) => ({
            value: truncate(option.value, 80),
            text: truncate(option.textContent, 120),
            selected: option.selected,
            disabled: option.disabled
          }))
        }];
      })
      .slice(0, 40);
    const text = (selector: string): string | null => truncate(document.querySelector(selector)?.textContent, 220);
    const popup = document.querySelector("#datePickerPopup");
    const popupVisible = popup ? isVisible(popup) : false;
    const datePickerButtons = popup
      ? Array.from(popup.querySelectorAll("button")).flatMap((button, index) => isVisible(button) ? [elementSummary(button, index)] : [])
      : [];
    const dialogSelectors = "[role='dialog'], .modal, .ant-modal, .MuiDialog-root, .swal2-popup";
    const dialogs = Array.from(document.querySelectorAll(dialogSelectors))
      .flatMap((dialog, index) => {
        if (!(dialog instanceof HTMLElement) || !isVisible(dialog)) return [];
        const buttons = Array.from(dialog.querySelectorAll("button"))
          .flatMap((button, buttonIndex) => isVisible(button) ? [elementSummary(button, buttonIndex)] : [])
          .slice(0, 20);
        return [{
          index,
          selector: selectorFor(dialog),
          role: dialog.getAttribute("role"),
          title: truncate(dialog.querySelector("h1,h2,h3,.title,.modal-title")?.textContent, 160),
          textExcerpt: truncate(dialog.innerText, 600),
          buttons,
          rect: rectFor(dialog)
        }];
      })
      .slice(0, 10);
    return {
      schemaVersion: "ui-dom-profile-v1" as const,
      generatedAt: profileGeneratedAt,
      runId: profileRunId,
      caseId,
      action,
      context: profileContext,
      signature: "",
      url: location.href,
      route: `${location.origin}${location.pathname}`,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      bodyTextExcerpt: truncate(document.body.innerText, 1400) ?? "",
      controls: {
        buttons: visibleButtons,
        inputs: visibleInputs,
        selects: visibleSelects
      },
      widgets: {
        datePicker: {
          exists: Boolean(popup),
          visible: popupVisible,
          dateRangeButtonText: text("#dateRangeBtn"),
          displayText: text("#dateRangeDisplay"),
          hasStartCalendar: Boolean(document.querySelector("#startCalendar")),
          hasEndCalendar: Boolean(document.querySelector("#endCalendar")),
          startMonth: text("#startCalendarMonth"),
          endMonth: text("#endCalendarMonth"),
          startSelectedDays: Array.from(document.querySelectorAll("#startCalendar .calendar-day.selected")).map((item) => truncate(item.textContent, 20)),
          endSelectedDays: Array.from(document.querySelectorAll("#endCalendar .calendar-day.selected")).map((item) => truncate(item.textContent, 20)),
          startDayCellCount: document.querySelectorAll("#startCalendar .calendar-day").length,
          endDayCellCount: document.querySelectorAll("#endCalendar .calendar-day").length,
          tabButtons: datePickerButtons.filter((button) => /動態|靜態/.test(String(button.text ?? ""))).map((button) => ({
            text: button.text,
            selector: button.selector,
            onclick: button.onclick,
            classTokens: button.classTokens,
            disabled: button.disabled
          })),
          navButtons: datePickerButtons.filter((button) => /prevMonth|nextMonth|‹|›/.test(`${button.onclick ?? ""}\n${button.text ?? ""}`)).map((button) => ({
            text: button.text,
            selector: button.selector,
            onclick: button.onclick,
            disabled: button.disabled
          })),
          buttons: datePickerButtons.slice(0, 60)
        },
        dialogs
      },
      limits: {
        fullHtmlCaptured: false,
        buttonLimit: 100,
        inputLimit: 80,
        selectLimit: 40,
        optionLimitPerSelect: 40,
        bodyTextExcerptChars: 1400
      },
      policy: "Normalized DOM profile captures visible structure only. It is current-run diagnostic/evidence context, not a substitute for visible UI actions or result judgment."
    };
  }, { generatedAt, runId, caseId: options.caseId, action: options.action, context });

  const signature = profileSignature(base);
  return { ...base, signature };
};

const captureUiDomProfile = async (options: CliOptions, page: Page, context: string): Promise<UiDomProfileRef> => {
  try {
    const profile = await readUiDomProfile(options, page, context);
    const dir = path.join(artifactRoot(options), "dom-profiles");
    const filePath = path.join(dir, `${sanitize(context)}-${profile.signature.slice(0, 12)}.json`);
    ensureDir(dir);
    const reused = fs.existsSync(filePath);
    if (!reused) {
      fs.writeFileSync(filePath, `${JSON.stringify(profile, null, 2)}\n`);
    }
    return {
      schemaVersion: "ui-dom-profile-ref-v1",
      context,
      status: "ok",
      signature: profile.signature,
      path: filePath,
      relativePath: path.relative(options.runDir, filePath),
      reused,
      summary: {
        url: profile.url,
        title: profile.title,
        route: profile.route,
        visibleButtonCount: profile.controls.buttons.length,
        visibleInputCount: profile.controls.inputs.length,
        visibleSelectCount: profile.controls.selects.length,
        dialogCount: profile.widgets.dialogs.length,
        datePicker: {
          exists: profile.widgets.datePicker.exists,
          visible: profile.widgets.datePicker.visible,
          startMonth: profile.widgets.datePicker.startMonth,
          endMonth: profile.widgets.datePicker.endMonth,
          startSelectedDays: profile.widgets.datePicker.startSelectedDays,
          endSelectedDays: profile.widgets.datePicker.endSelectedDays
        }
      }
    };
  } catch (error) {
    return {
      schemaVersion: "ui-dom-profile-ref-v1",
      context,
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

const readDomState = async (page: Page): Promise<Record<string, unknown>> => {
  return page.evaluate(() => {
    const text = (selector: string) => document.querySelector(selector)?.textContent?.trim() ?? null;
    const innerText = (selector: string) => (document.querySelector(selector) as HTMLElement | null)?.innerText?.trim() ?? null;
    const buttons = Array.from(document.querySelectorAll("button"))
      .map((item) => item.textContent?.trim())
      .filter(Boolean)
      .slice(0, 80);
    const selects = Array.from(document.querySelectorAll("select")).map((select) => ({
      name: select.getAttribute("name"),
      value: (select as HTMLSelectElement).value,
      text: (select as HTMLSelectElement).selectedOptions?.[0]?.textContent?.trim() ?? null
    }));
    const displaySelect = selects.find((item) => item.name === "displayMode") ?? selects.find((item) => /每天|每日|daily/i.test(`${item.text ?? ""}\n${item.value}`));
    return {
      url: location.href,
      title: document.title,
      bodyTextExcerpt: document.body.innerText.slice(0, 2500),
      reportHeader: text("h1, h2, [class*=title], [class*=header]"),
      cleanupState: {
        dateRangeText: innerText("#dateRangeBtn"),
        fieldSelectionText: innerText("#fieldSelectionContainer"),
        filterText: innerText("#dataFilterContainer"),
        groupText: innerText("#groupDimensionContainer"),
        displayModeValue: displaySelect?.value ?? null,
        displayModeText: displaySelect?.text ?? null
      },
      buttons,
      selects
    };
  });
};

const normalizeDateText = (value: string): string => value.replace(/\s+/g, "").replaceAll("-", "/");
const normalizeUiText = (value: string): string => value.replace(/\s+/g, "");

type CalendarSide = "left" | "right";
type VisibleButton = { index: number; text: string; x: number; y: number; width: number; height: number };
type VisibleTextTarget = {
  index: number;
  text: string;
  tagName: string;
  role: string | null;
  className: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
type VisibleMonthLabel = { text: string; year: number; month: number; x: number; y: number; width: number; height: number };

const calendarDomSide = (side: CalendarSide): "start" | "end" => side === "left" ? "start" : "end";

const parseCalendarMonthText = (text: string | null | undefined): Pick<VisibleMonthLabel, "year" | "month"> | null => {
  const normalized = (text ?? "").trim().replace(/\s+/g, " ");
  const match = normalized.match(/^([一二三四五六七八九十]{1,2})月\s+(\d{4})$/);
  if (!match) return null;
  const monthMap: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    十一: 11,
    十二: 12
  };
  const month = monthMap[match[1] ?? ""];
  if (!month) return null;
  return { year: Number(match[2]), month };
};

const parseDateRange = (value: string | null): { startIso: string; endIso: string; display: string } | null => {
  if (!value) return null;
  const matches = [...value.matchAll(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/g)];
  if (matches.length < 2) return null;
  const toIso = (match: RegExpMatchArray): string => {
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  };
  const startIso = toIso(matches[0]);
  const endIso = toIso(matches[1]);
  return {
    startIso,
    endIso,
    display: `${startIso.replaceAll("-", "/")} ~ ${endIso.replaceAll("-", "/")}`
  };
};

const bodyContainsDateRange = async (page: Page, display: string): Promise<boolean> => {
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return normalizeDateText(bodyText).includes(normalizeDateText(display));
};

const bodyContainsText = async (page: Page, expected: string): Promise<boolean> => {
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return normalizeUiText(bodyText).includes(normalizeUiText(expected));
};

const isDatePickerOpen = async (page: Page): Promise<boolean> => {
  return page.locator("#datePickerPopup").first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }).catch(() => false);
};

const parseCleanupTargets = (value: unknown): Record<string, string> => {
  if (typeof value !== "string") return {};
  const result: Record<string, string> = {};
  for (const part of value.split(";")) {
    const [key, ...rest] = part.split("=");
    const normalizedKey = key?.trim();
    if (!normalizedKey) continue;
    const normalizedValue = rest.join("=").trim();
    if (normalizedValue) result[normalizedKey] = normalizedValue;
  }
  return result;
};

const targetStateFromParams = (params: Record<string, unknown>): Record<string, string | string[] | null> => {
  const cleanup = parseCleanupTargets(params.cleanupChecklist);
  const field = stringParam(params, "field") ?? cleanup["欄位"] ?? null;
  const fields = metricFieldsFromParams({ ...params, field });
  return {
    field,
    fields,
    filter: cleanup["篩選"] ?? null,
    group: cleanup["分組"] ?? null,
    dateRange: stringParam(params, "dateRange") ?? cleanup["時間"] ?? null,
    display: stringParam(params, "display") ?? cleanup["顯示"] ?? null
  };
};

const readStateDelta = async (page: Page, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const targets = targetStateFromParams(params);
  const observed = await page.evaluate(() => {
    const innerText = (selector: string) => (document.querySelector(selector) as HTMLElement | null)?.innerText?.trim() ?? null;
    const selects = Array.from(document.querySelectorAll("select")).map((select) => ({
      name: select.getAttribute("name"),
      value: (select as HTMLSelectElement).value,
      text: (select as HTMLSelectElement).selectedOptions?.[0]?.textContent?.trim() ?? ""
    }));
    const displaySelect = selects.find((item) => item.name === "displayMode") ?? selects.find((item) => /每天|每日|daily/i.test(`${item.text}\n${item.value}`));
    return {
      url: location.href,
      bodyText: document.body.innerText.slice(0, 5000),
      dateRangeText: innerText("#dateRangeBtn"),
      fieldSelectionText: innerText("#fieldSelectionContainer"),
      filterText: innerText("#dataFilterContainer"),
      groupText: innerText("#groupDimensionContainer"),
      displayModeValue: displaySelect?.value ?? null,
      displayModeText: displaySelect?.text ?? null,
      selects
    };
  });
  const contains = (value: unknown, expected: string | null): boolean | null => {
    if (!expected || expected === "不限" || expected === "不影響") return null;
    if (typeof value !== "string") return false;
    return normalizeUiText(value).includes(normalizeUiText(expected));
  };
  const fieldText = `${observed.fieldSelectionText ?? ""}\n${observed.bodyText}`;
  const targetFields = Array.isArray(targets.fields) ? targets.fields.filter((item): item is string => typeof item === "string") : [];
  return {
    targets,
    observed: {
      ...observed,
      bodyText: observed.bodyText.slice(0, 1200)
    },
    checks: {
      field: targetFields.length > 1
        ? targetFields.every((item) => contains(fieldText, item) === true)
        : contains(fieldText, typeof targets.field === "string" ? targets.field : null),
      filter: targets.filter === "0組" || targets.filter === "空"
        ? null
        : contains(observed.filterText, typeof targets.filter === "string" ? targets.filter : null),
      group: targets.group === "0組" || targets.group === "空"
        ? null
        : contains(observed.groupText, typeof targets.group === "string" ? targets.group : null),
      dateRange: contains(`${observed.dateRangeText ?? ""}\n${observed.bodyText}`, typeof targets.dateRange === "string" ? targets.dateRange : null),
      display: contains(`${observed.displayModeText ?? ""}\n${observed.displayModeValue ?? ""}\n${observed.bodyText}`, typeof targets.display === "string" ? targets.display : null)
    },
    policy: "delta planner may skip only when visible UI text/value verifies the target; unknown or false must fall back to UI action or blocked"
  };
};

const clickFirstVisible = async (locators: Array<ReturnType<Page["locator"]>>, timeout = 5000): Promise<boolean> => {
  for (const locator of locators) {
    try {
      const first = locator.first();
      if ((await first.count()) === 0) continue;
      await first.click({ timeout });
      return true;
    } catch {
      // Try the next visible locator candidate.
    }
  }
  return false;
};

const visibleInputIndexes = async (page: Page): Promise<Array<{ index: number; type: string; placeholder: string; value: string }>> => {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("input")).flatMap((input, index) => {
      const rect = input.getBoundingClientRect();
      const style = window.getComputedStyle(input);
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      if (!visible || input.disabled || input.readOnly) return [];
      return [{
        index,
        type: input.type,
        placeholder: input.placeholder,
        value: input.value
      }];
    });
  });
};

const visibleButtons = async (page: Page): Promise<VisibleButton[]> => {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("button")).flatMap((button, index) => {
      const rect = button.getBoundingClientRect();
      const style = window.getComputedStyle(button);
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      if (!visible || button.disabled) return [];
      return [{
        index,
        text: (button.textContent ?? "").trim().replace(/\s+/g, " "),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      }];
    });
  });
};

const visibleExactTextTargets = async (page: Page, expectedText: string): Promise<VisibleTextTarget[]> => {
  return page.evaluate((targetText) => {
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
    const elements = Array.from(document.querySelectorAll("body *"));
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
    };
    return elements.flatMap((element, index) => {
      if (!(element instanceof HTMLElement)) return [];
      const text = normalize(element.textContent);
      if (text !== targetText) return [];
      const hasExactVisibleChild = Array.from(element.children).some((child) => normalize(child.textContent) === targetText && isVisible(child));
      if (hasExactVisibleChild) return [];
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const className = typeof element.className === "string" ? element.className : "";
      const ariaDisabled = element.getAttribute("aria-disabled") === "true";
      const disabled = "disabled" in element && Boolean((element as HTMLButtonElement).disabled);
      const visuallyDisabled = /disabled|disable|unavailable|outside|other-month/i.test(className) || Number.parseFloat(style.opacity || "1") < 0.35;
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      if (!visible || ariaDisabled || disabled || visuallyDisabled) return [];
      return [
        {
          index,
          text,
          tagName: element.tagName.toLowerCase(),
          role: element.getAttribute("role"),
          className,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        }
      ];
    });
  }, expectedText);
};

const visibleTextTargetsMatching = async (page: Page, patternSource: string, flags = "i"): Promise<VisibleTextTarget[]> => {
  return page.evaluate(({ source, flags: regexFlags }) => {
    const pattern = new RegExp(source, regexFlags);
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
    const elements = Array.from(document.querySelectorAll("body *"));
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
    };
    return elements.flatMap((element, index) => {
      if (!(element instanceof HTMLElement)) return [];
      const text = normalize(element.textContent);
      if (!text || text.length > 80 || !pattern.test(text)) return [];
      const hasMatchingVisibleChild = Array.from(element.children).some((child) => {
        const childText = normalize(child.textContent);
        return childText.length > 0 && childText.length <= 80 && pattern.test(childText) && isVisible(child);
      });
      if (hasMatchingVisibleChild) return [];
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const className = typeof element.className === "string" ? element.className : "";
      const ariaDisabled = element.getAttribute("aria-disabled") === "true";
      const disabled = "disabled" in element && Boolean((element as HTMLButtonElement).disabled);
      const visuallyDisabled = /disabled|disable|unavailable|outside|other-month/i.test(className) || Number.parseFloat(style.opacity || "1") < 0.35;
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      if (!visible || ariaDisabled || disabled || visuallyDisabled) return [];
      return [
        {
          index,
          text,
          tagName: element.tagName.toLowerCase(),
          role: element.getAttribute("role"),
          className,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        }
      ];
    });
  }, { source: patternSource, flags });
};

const visibleCalendarMonths = async (page: Page): Promise<VisibleMonthLabel[]> => {
  return page.evaluate(() => {
    const monthMap: Record<string, number> = {
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
      十: 10,
      十一: 11,
      十二: 12
    };
    const seen = new Set<string>();
    return Array.from(document.querySelectorAll("body *")).flatMap((element) => {
      const text = (element.textContent ?? "").trim().replace(/\s+/g, " ");
      const match = text.match(/^([一二三四五六七八九十]{1,2})月\s+(\d{4})$/);
      if (!match) return [];
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      const month = monthMap[match[1] ?? ""];
      if (!visible || !month) return [];
      const key = `${text}:${Math.round(rect.x)}:${Math.round(rect.y)}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        text,
        year: Number(match[2]),
        month,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      }];
    });
  });
};

const monthDiff = (from: Pick<VisibleMonthLabel, "year" | "month">, toYear: number, toMonth: number): number =>
  (toYear - from.year) * 12 + (toMonth - from.month);

const clickVisibleButtonByIndex = async (page: Page, index: number, timeout = 5000): Promise<void> => {
  await page.locator("button").nth(index).click({ timeout });
};

const clickVisibleBodyElementByIndex = async (page: Page, index: number, timeout = 5000): Promise<void> => {
  await page.locator("body *").nth(index).click({ timeout });
};

const clickSideButton = async (page: Page, text: string | RegExp, side: CalendarSide, timeout = 5000): Promise<boolean> => {
  const buttons = await visibleButtons(page);
  const matches = buttons
    .filter((button) => (typeof text === "string" ? button.text === text : text.test(button.text)))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (matches.length === 0) return false;
  const selected = side === "left" ? matches[0] : matches[matches.length - 1];
  if (!selected) return false;
  await clickVisibleButtonByIndex(page, selected.index, timeout);
  return true;
};

const ensureStaticCalendarTabs = async (page: Page): Promise<void> => {
  await clickSideButton(page, "靜態時間", "left", 3000).catch(() => false);
  await page.waitForTimeout(150);
  await clickSideButton(page, "靜態時間", "right", 3000).catch(() => false);
  await page.waitForTimeout(300);
};

const calendarMonthForSide = async (page: Page, side: CalendarSide): Promise<VisibleMonthLabel | null> => {
  const domSide = calendarDomSide(side);
  const selector = `#${domSide}CalendarMonth`;
  const located = await page.locator(selector).first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      text: element.textContent?.trim() ?? "",
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };
  }).catch(() => null);
  if (located) {
    const parsed = parseCalendarMonthText(located.text);
    if (parsed) {
      return {
        text: located.text,
        year: parsed.year,
        month: parsed.month,
        x: located.x,
        y: located.y,
        width: located.width,
        height: located.height
      };
    }
  }
  const months = (await visibleCalendarMonths(page)).sort((a, b) => a.x - b.x || a.y - b.y);
  if (months.length === 0) return null;
  return side === "left" ? months[0] ?? null : months[months.length - 1] ?? null;
};

const moveCalendarToMonth = async (page: Page, side: CalendarSide, targetYear: number, targetMonth: number): Promise<boolean> => {
  const domSide = calendarDomSide(side);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const current = await calendarMonthForSide(page, side);
    if (!current) return false;
    const diff = monthDiff(current, targetYear, targetMonth);
    if (diff === 0) return true;
    const fn = diff < 0 ? "prevMonth" : "nextMonth";
    const clicked = await page
      .locator(`button[onclick="${fn}('${domSide}', event)"]`)
      .first()
      .click({ timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) {
      const direction = diff < 0 ? "‹" : "›";
      const fallbackClicked = await clickSideButton(page, direction, side, 3000);
      if (!fallbackClicked) return false;
    }
    await page.waitForTimeout(250);
  }
  return false;
};

const clickCalendarDay = async (page: Page, side: CalendarSide, day: number): Promise<boolean> => {
  const domSide = calendarDomSide(side);
  const calendarLocator = page.locator(`#${domSide}Calendar .calendar-day`);
  const count = await calendarLocator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const dayLocator = calendarLocator.nth(index);
    const candidate = await dayLocator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        text: element.textContent?.trim() ?? "",
        className: typeof element.className === "string" ? element.className : "",
        visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
      };
    }).catch(() => null);
    if (!candidate || candidate.text !== String(day) || !candidate.visible) continue;
    if (/disabled|disable|unavailable|outside|other-month/i.test(candidate.className)) continue;
    await dayLocator.click({ timeout: 5000 });
    return true;
  }

  const months = (await visibleCalendarMonths(page)).sort((a, b) => a.x - b.x || a.y - b.y);
  if (months.length < 2) return false;
  const left = months[0];
  const right = months[months.length - 1];
  if (!left || !right) return false;
  const splitX = (left.x + left.width / 2 + right.x + right.width / 2) / 2;
  const selectedMonth = side === "left" ? left : right;
  const buttons = await visibleButtons(page);
  const candidates = buttons
    .filter((button) => button.text === String(day))
    .filter((button) => {
      const centerX = button.x + button.width / 2;
      const centerY = button.y + button.height / 2;
      const inSide = side === "left" ? centerX < splitX : centerX > splitX;
      return inSide && centerY > selectedMonth.y + selectedMonth.height && centerY < selectedMonth.y + 280;
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const selected = candidates[0];
  if (selected) {
    await clickVisibleButtonByIndex(page, selected.index, 5000);
    return true;
  }

  const textTargets = await visibleExactTextTargets(page, String(day));
  const targetCandidates = textTargets
    .filter((target) => target.width <= 90 && target.height <= 90)
    .filter((target) => {
      const centerX = target.x + target.width / 2;
      const centerY = target.y + target.height / 2;
      const inSide = side === "left" ? centerX < splitX : centerX > splitX;
      return inSide && centerY > selectedMonth.y + selectedMonth.height && centerY < selectedMonth.y + 320;
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const target = targetCandidates[0];
  if (!target) return false;
  await clickVisibleBodyElementByIndex(page, target.index, 5000);
  return true;
};

type DateRangeUiResult = { ok: boolean; warning?: string; observedAfter?: string; inputs?: unknown; uiProfiles?: UiDomProfileRef[] };

const setStaticDateRangeByCalendar = async (
  options: CliOptions,
  page: Page,
  parsed: { startIso: string; endIso: string; display: string }
): Promise<DateRangeUiResult> => {
  const uiProfiles: UiDomProfileRef[] = [];
  const start = new Date(`${parsed.startIso}T00:00:00Z`);
  const end = new Date(`${parsed.endIso}T00:00:00Z`);
  const startYear = start.getUTCFullYear();
  const startMonth = start.getUTCMonth() + 1;
  const startDay = start.getUTCDate();
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth() + 1;
  const endDay = end.getUTCDate();

  await ensureStaticCalendarTabs(page);
  uiProfiles.push(await captureUiDomProfile(options, page, "dateRange.staticCalendar"));
  const startMonthReady = await moveCalendarToMonth(page, "left", startYear, startMonth);
  if (!startMonthReady) {
    return {
      ok: false,
      warning: `DATE_RANGE_START_CALENDAR_MONTH_NOT_REACHED:startMonth=${startYear}-${startMonth}`,
      observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1000),
      uiProfiles
    };
  }
  uiProfiles.push(await captureUiDomProfile(options, page, "dateRange.startCalendarReady"));

  const startClicked = await clickCalendarDay(page, "left", startDay);
  if (!startClicked) {
    return {
      ok: false,
      warning: `DATE_RANGE_START_DAY_NOT_CLICKABLE:startDay=${startDay};startMonth=${startYear}-${startMonth}`,
      observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1200),
      uiProfiles
    };
  }
  await page.waitForTimeout(250);
  uiProfiles.push(await captureUiDomProfile(options, page, "dateRange.afterStartDay"));

  const endMonthReady = await moveCalendarToMonth(page, "right", endYear, endMonth);
  if (!endMonthReady) {
    return {
      ok: false,
      warning: `DATE_RANGE_END_CALENDAR_MONTH_NOT_REACHED:endMonth=${endYear}-${endMonth}`,
      observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1000),
      uiProfiles
    };
  }
  uiProfiles.push(await captureUiDomProfile(options, page, "dateRange.endCalendarReady"));

  const endClicked = await clickCalendarDay(page, "right", endDay);
  if (!endClicked) {
    return {
      ok: false,
      warning: `DATE_RANGE_END_DAY_NOT_CLICKABLE:endDay=${endDay};endMonth=${endYear}-${endMonth}`,
      observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1200),
      uiProfiles
    };
  }
  uiProfiles.push(await captureUiDomProfile(options, page, "dateRange.afterEndDay"));

  const confirmed = await clickFirstVisible([page.getByText("確認", { exact: true }), page.locator("button").filter({ hasText: "確認" })], 5000);
  if (!confirmed) {
    return {
      ok: false,
      warning: "DATE_RANGE_CONFIRM_NOT_CLICKABLE",
      observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1200),
      uiProfiles
    };
  }
  await page.waitForTimeout(800);
  const ok = await bodyContainsDateRange(page, parsed.display);
  uiProfiles.push(await captureUiDomProfile(options, page, "dateRange.afterConfirm"));
  return {
    ok,
    warning: ok ? undefined : "DATE_RANGE_VERIFY_FAILED_AFTER_CALENDAR_CLICK",
    observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1200),
    uiProfiles
  };
};

const setDateRange = async (options: CliOptions, page: Page, dateRange: string): Promise<DateRangeUiResult> => {
  const uiProfiles: UiDomProfileRef[] = [];
  const parsed = parseDateRange(dateRange);
  if (!parsed) return setDatePreset(options, page, dateRange);
  if (await bodyContainsDateRange(page, parsed.display)) return { ok: true, observedAfter: parsed.display, uiProfiles };

  if (!(await isDatePickerOpen(page))) {
    const opened = await clickFirstVisible([
      page.locator("#dateRangeBtn"),
      page.locator("button").filter({ hasText: /過去|最近|今日|昨日|本週|上週|本月|上月|\d{4}[/-]\d{1,2}[/-]\d{1,2}/ }),
      page.getByText(/過去7天|最近7天|過去30天|最近30天|\d{4}[/-]\d{1,2}[/-]\d{1,2}/, { exact: false })
    ], 8000);
    if (!opened) return { ok: false, warning: "DATE_RANGE_CONTROL_NOT_CLICKABLE", uiProfiles };
    await page.waitForTimeout(400);
  }
  uiProfiles.push(await captureUiDomProfile(options, page, "dateRange.popupOpened"));

  await clickFirstVisible([page.getByText("靜態時間", { exact: true }), page.locator("button").filter({ hasText: "靜態時間" })], 5000);
  await page.waitForTimeout(400);
  uiProfiles.push(await captureUiDomProfile(options, page, "dateRange.staticTabRequested"));

  const inputs = await visibleInputIndexes(page);
  const dateInputs = inputs.filter((item) => item.type === "date");
  const textInputs = inputs.filter((item) => item.type === "text" && !/報表名稱/.test(item.placeholder));
  const targets = dateInputs.length >= 2 ? dateInputs.slice(0, 2) : textInputs.slice(0, 2);
  if (targets.length < 2) {
    const calendarResult = await setStaticDateRangeByCalendar(options, page, parsed);
    const combinedProfiles = [...uiProfiles, ...(calendarResult.uiProfiles ?? [])];
    return calendarResult.ok
      ? { ...calendarResult, inputs, uiProfiles: combinedProfiles }
      : { ...calendarResult, inputs, uiProfiles: combinedProfiles, warning: `${calendarResult.warning ?? "DATE_RANGE_CALENDAR_FAILED"};DATE_RANGE_INPUTS_NOT_FOUND` };
  }

  const values = targets[0].type === "date"
    ? [parsed.startIso, parsed.endIso]
    : [parsed.startIso.replaceAll("-", "/"), parsed.endIso.replaceAll("-", "/")];
  for (let i = 0; i < 2; i += 1) {
    await page.locator("input").nth(targets[i].index).fill(values[i], { timeout: 5000 });
  }
  await clickFirstVisible([page.getByText("確認", { exact: true }), page.locator("button").filter({ hasText: "確認" })], 5000);
  await page.waitForTimeout(800);

  const ok = await bodyContainsDateRange(page, parsed.display);
  return {
    ok,
    warning: ok ? undefined : "DATE_RANGE_VERIFY_FAILED_AFTER_UI_INPUT",
    observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1000),
    inputs,
    uiProfiles: [...uiProfiles, await captureUiDomProfile(options, page, "dateRange.afterInputConfirm")]
  };
};

const setDatePreset = async (options: CliOptions, page: Page, preset: string): Promise<DateRangeUiResult> => {
  const uiProfiles: UiDomProfileRef[] = [];
  const normalizedPreset = preset.trim();
  if (!normalizedPreset) return { ok: false, warning: "DATE_RANGE_PRESET_EMPTY", uiProfiles };
  if (await bodyContainsText(page, normalizedPreset)) return { ok: true, observedAfter: normalizedPreset, uiProfiles };

  if (!(await isDatePickerOpen(page))) {
    const opened = await clickFirstVisible([
      page.locator("#dateRangeBtn"),
      page.locator("button").filter({ hasText: /過去|最近|今日|昨日|本週|上週|本月|上月|\d{4}[/-]\d{1,2}[/-]\d{1,2}/ }),
      page.getByText(/過去7天|最近7天|過去30天|最近30天|今日|昨日|本週|上週|本月|上月/, { exact: false })
    ], 8000);
    if (!opened) return { ok: false, warning: "DATE_RANGE_CONTROL_NOT_CLICKABLE", uiProfiles };
    await page.waitForTimeout(400);
  }
  uiProfiles.push(await captureUiDomProfile(options, page, "datePreset.popupOpened"));

  const selected = await clickFirstVisible([
    page.getByText(normalizedPreset, { exact: true }),
    page.locator("button").filter({ hasText: normalizedPreset })
  ], 5000);
  if (!selected) {
    return {
      ok: false,
      warning: `DATE_RANGE_PRESET_NOT_FOUND:${normalizedPreset}`,
      observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1000),
      uiProfiles
    };
  }
  await clickFirstVisible([page.getByText("確認", { exact: true }), page.locator("button").filter({ hasText: "確認" })], 3000).catch(() => false);
  await page.waitForTimeout(800);

  const ok = await bodyContainsText(page, normalizedPreset);
  return {
    ok,
    warning: ok ? undefined : "DATE_RANGE_PRESET_VERIFY_FAILED_AFTER_UI_CLICK",
    observedAfter: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 1000),
    uiProfiles: [...uiProfiles, await captureUiDomProfile(options, page, "datePreset.afterConfirm")]
  };
};

const readChartSummary = async (page: Page): Promise<Record<string, unknown> | null> => {
  try {
    return await page.evaluate(() => {
      const chartWindow = window as unknown as { Chart?: { instances?: Record<string, unknown> } };
      const instances = chartWindow.Chart?.instances ? Object.values(chartWindow.Chart.instances) : [];
      const first = instances[0] as
        | {
            data?: { labels?: unknown[]; datasets?: Array<{ label?: string; data?: unknown[] }> };
          }
        | undefined;
      if (!first?.data) return null;
      const datasets = first.data.datasets ?? [];
      const numeric = datasets.flatMap((dataset) => (dataset.data ?? []).map((item) => Number(item)).filter(Number.isFinite));
      return {
        labelCount: first.data.labels?.length ?? 0,
        datasetCount: datasets.length,
        datasets: datasets.map((dataset) => ({
          label: dataset.label ?? null,
          count: dataset.data?.length ?? 0,
          sample: (dataset.data ?? []).slice(0, 10),
          values: (dataset.data ?? []).map((item) => Number(item)).filter(Number.isFinite)
        })),
        numericSummary:
          numeric.length > 0
            ? {
                count: numeric.length,
                sum: numeric.reduce((total, item) => total + item, 0),
                max: Math.max(...numeric),
                min: Math.min(...numeric)
              }
            : null
      };
    });
  } catch {
    return null;
  }
};

const readPreviewTableSummary = async (page: Page): Promise<Record<string, unknown> | null> => {
  try {
    return await page.evaluate(() => {
      const normalize = (value: string | null | undefined): string => (value ?? "").trim().replace(/\s+/g, " ");
      const isVisible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      };
      const tables = Array.from(document.querySelectorAll("table"))
        .filter((table) => isVisible(table))
        .map((table, tableIndex) => {
          const rows = Array.from(table.querySelectorAll("tr"))
            .filter((row) => isVisible(row))
            .map((row) => Array.from(row.querySelectorAll("th,td")).map((cell) => normalize(cell.textContent)));
          const explicitHeader = Array.from(table.querySelectorAll("thead tr th")).map((cell) => normalize(cell.textContent));
          const header = explicitHeader.length > 0 ? explicitHeader : rows[0] ?? [];
          const dataRows = (explicitHeader.length > 0 ? rows : rows.slice(1)).filter((row) => row.some((cell) => cell.length > 0));
          const numericColumns = header.map((_label, columnIndex) => {
            const values = dataRows.map((row) => Number(String(row[columnIndex] ?? "").replace(/,/g, ""))).filter(Number.isFinite);
            return values.length > 0
              ? {
                  columnIndex,
                  header: header[columnIndex] ?? `column_${columnIndex}`,
                  values,
                  summary: {
                    count: values.length,
                    sum: values.reduce((total, value) => total + value, 0),
                    max: Math.max(...values),
                    min: Math.min(...values)
                  }
                }
              : null;
          }).filter((item): item is NonNullable<typeof item> => item !== null);
          const rect = table.getBoundingClientRect();
          return {
            tableIndex,
            header,
            rows: dataRows,
            dataRowCount: dataRows.length,
            sampleRows: dataRows.slice(0, 5),
            tailRows: dataRows.slice(-3),
            numericColumns,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
          };
        })
        .filter((table) => table.header.length > 0 || table.dataRowCount > 0)
        .sort((a, b) => b.dataRowCount - a.dataRowCount);
      return tables[0] ?? null;
    });
  } catch {
    return null;
  }
};

const observeDuring = async <T>(page: Page, fn: () => Promise<T>): Promise<{ result: T; requests: Record<string, unknown>[]; responses: Record<string, unknown>[] }> => {
  const requests: Record<string, unknown>[] = [];
  const responses: Record<string, unknown>[] = [];
  const onRequest = (request: Request) => {
    if (!/biapi|preview|report|chart|custom/i.test(request.url())) return;
    requests.push({
      url: request.url(),
      method: request.method(),
      postData: request.postData()?.slice(0, 4000) ?? null,
      timestamp: new Date().toISOString()
    });
  };
  const onResponse = (response: Response) => {
    if (!/biapi|preview|report|chart|custom/i.test(response.url())) return;
    responses.push({
      url: response.url(),
      status: response.status(),
      timestamp: new Date().toISOString()
    });
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  try {
    const result = await fn();
    return { result, requests, responses };
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
  }
};

const clickByText = async (page: Page, text: string, timeout = 12000): Promise<void> => {
  const locator = page.getByText(text, { exact: false }).first();
  try {
    await locator.click({ timeout });
  } catch (error) {
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(300);
    try {
      await locator.click({ timeout: Math.min(timeout, 5000) });
    } catch (retryError) {
      const firstMessage = error instanceof Error ? error.message : String(error);
      const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
      throw new HelperBlockedError(
        `VISIBLE_UI_CLICK_BLOCKED: text="${text}"; first=${firstMessage.slice(0, 500)}; retry=${retryMessage.slice(0, 500)}`
      );
    }
  }
};

const openProject = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const devUrl = stringParam(options.params, "devUrl");
  const projectName = stringParam(options.params, "projectName");
  if (devUrl && !page.url().includes("galaxy.games.gamania.com")) {
    await page.goto(devUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  }
  await page.waitForTimeout(800);
  if (projectName) {
    await clickByText(page, projectName);
    await page.waitForTimeout(1200);
  }
  const shot = await screenshot(options, page, "open-project");
  const uiProfile = await captureUiDomProfile(options, page, "openProject.after");
  return createReport(
    options,
    "ok",
    startedAt,
    { domState: await readDomState(page), uiProfile },
    shot ? { screenshot: shot } : {},
    shot ? [] : ["SCREENSHOT_UNAVAILABLE"]
  );
};

const createCollageReport = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const projectName = stringParam(options.params, "projectName");
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (!bodyText.includes("+ 新增報表") && projectName) {
    await clickByText(page, projectName);
    await page.waitForTimeout(1200);
  }
  await page.getByText("+ 新增報表", { exact: false }).first().click({ timeout: 15000 });
  await page.waitForTimeout(1200);
  const shot = await screenshot(options, page, "create-report");
  const uiProfile = await captureUiDomProfile(options, page, "createReport.after");
  return createReport(options, "ok", startedAt, { domState: await readDomState(page), uiProfile }, shot ? { screenshot: shot } : {}, shot ? [] : ["SCREENSHOT_UNAVAILABLE"]);
};

const openExistingReport = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const projectName = stringParam(options.params, "projectName");
  const uiProfileBefore = await captureUiDomProfile(options, page, "openExistingReport.before");
  if (projectName) {
    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (!bodyText.includes(projectName) || /報表設定|儲存報表|執行/.test(bodyText)) {
      await clickByText(page, projectName, 8000).catch(() => undefined);
      await page.waitForTimeout(1000);
    }
  }

  let resolved = await resolveExistingReportName(options, page);
  let listText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (!listText.includes(resolved.reportName)) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    if (projectName) {
      await clickByText(page, projectName, 8000).catch(() => undefined);
      await page.waitForTimeout(1000);
    }
    resolved = await resolveExistingReportName(options, page);
    listText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  }
  if (!listText.includes(resolved.reportName)) {
    throw new HelperBlockedError(`EXISTING_REPORT_ROW_NOT_VISIBLE:${resolved.reportName}`);
  }

  await clickByText(page, resolved.reportName, 12000);
  await page.waitForTimeout(1800);
  writeSavedReportState(options, resolved.reportName, {
    openedFromExistingReport: true,
    existingReportSource: resolved.source,
    existingReportCandidates: resolved.candidates
  });
  const shot = await screenshot(options, page, "open-existing-report");
  const uiProfileAfter = await captureUiDomProfile(options, page, "openExistingReport.after");
  return createReport(
    options,
    "ok",
    startedAt,
    {
      reportName: resolved.reportName,
      existingReportSource: resolved.source,
      existingReportCandidates: resolved.candidates,
      domState: await readDomState(page),
      uiProfiles: { before: uiProfileBefore, after: uiProfileAfter }
    },
    shot ? { screenshot: shot } : {},
    shot ? [] : ["SCREENSHOT_UNAVAILABLE"]
  );
};

const selectedFieldText = async (page: Page): Promise<string> => {
  const dom = await readDomState(page).catch(() => null);
  const cleanupState = dom?.cleanupState && typeof dom.cleanupState === "object" ? dom.cleanupState as Record<string, unknown> : {};
  return String(cleanupState.fieldSelectionText ?? "");
};

const metricAddFieldPattern = /(?:\+\s*)?新增(?:欄位|指標|資料)|(?:欄位|指標).{0,6}(?:新增|選擇)|選擇(?:欄位|指標)|\+.*欄位/i;

const metricFieldControlsVisible = async (page: Page): Promise<boolean> => {
  const checks = [
    page.getByRole("button", { name: metricAddFieldPattern }).first(),
    page.getByText("+ 新增欄位", { exact: false }).first(),
    page.locator("button").filter({ hasText: metricAddFieldPattern }).first(),
    page.locator("[role=button]").filter({ hasText: metricAddFieldPattern }).first(),
    page.locator("[class*=btn], [class*=button], [class*=Button]").filter({ hasText: metricAddFieldPattern }).first()
  ];
  for (const locator of checks) {
    if (await locator.isVisible().catch(() => false)) return true;
  }
  return false;
};

const waitForMetricFieldControls = async (page: Page, timeoutMs = 30000): Promise<string> => {
  const startedAt = Date.now();
  let lastBodyText = "";
  while (Date.now() - startedAt < timeoutMs) {
    if (await metricFieldControlsVisible(page)) {
      return `fieldControls:ready:${Date.now() - startedAt}ms`;
    }
    lastBodyText = await page.locator("body").innerText({ timeout: 1000 }).catch(() => "");
    const normalized = normalizeUiText(lastBodyText);
    const stillLoading = /載入欄位中|載入指標中|載入資料中/i.test(normalized);
    if (!stillLoading && Date.now() - startedAt > 1500) {
      return `fieldControls:notLoadingNoControl:${Date.now() - startedAt}ms`;
    }
    await page.waitForTimeout(300);
  }
  throw new HelperBlockedError(`FIELD_LIST_LOAD_TIMEOUT:${timeoutMs}ms; bodyText=${lastBodyText.slice(0, 1200)}`);
};

const waitForReportEditorSettle = async (page: Page, timeoutMs = 30000): Promise<Record<string, unknown>> => {
  const startedAt = Date.now();
  let lastBodyText = "";
  let lastDomState: Record<string, unknown> | null = null;
  let lastFieldControlsVisible = false;
  while (Date.now() - startedAt < timeoutMs) {
    await page.waitForLoadState("domcontentloaded", { timeout: 1000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 1000 }).catch(() => undefined);
    lastBodyText = await page.locator("body").innerText({ timeout: 1500 }).catch(() => "");
    lastDomState = await readDomState(page).catch(() => null);
    lastFieldControlsVisible = await metricFieldControlsVisible(page).catch(() => false);
    const normalized = normalizeUiText(lastBodyText);
    const loading = /載入(?:欄位|指標|資料|報表)?中|載入中|loading|請稍候/i.test(normalized);
    const editorVisible = /報表設定|儲存報表|執行|\+ 新增欄位|\+ 新增運算欄位|時間區間/i.test(normalized);
    if (!loading && (editorVisible || lastFieldControlsVisible) && Date.now() - startedAt > 1200) {
      return {
        status: "settled",
        elapsedMs: Date.now() - startedAt,
        fieldControlsVisible: lastFieldControlsVisible,
        editorVisible,
        bodyTextExcerpt: lastBodyText.slice(0, 1200)
      };
    }
    await page.waitForTimeout(400);
  }
  return {
    status: "timeout",
    elapsedMs: Date.now() - startedAt,
    fieldControlsVisible: lastFieldControlsVisible,
    domState: lastDomState,
    bodyTextExcerpt: lastBodyText.slice(0, 1200)
  };
};

const clickMetricAddFieldControl = async (page: Page, field: string): Promise<string> => {
  const clickedByLocator = await clickFirstVisible([
    page.getByRole("button", { name: metricAddFieldPattern }),
    page.getByText("+ 新增欄位", { exact: false }),
    page.locator("button").filter({ hasText: metricAddFieldPattern }),
    page.locator("[role=button]").filter({ hasText: metricAddFieldPattern }),
    page.locator("[class*=btn], [class*=button], [class*=Button]").filter({ hasText: metricAddFieldPattern })
  ], 15000);
  if (clickedByLocator) return "addField:locator";

  const buttons = await visibleButtons(page).catch(() => []);
  const buttonMatch = buttons.find((button) => metricAddFieldPattern.test(button.text) && !/報表|專案|儲存|保存|執行|查詢|搜尋|刪除|取消/.test(button.text));
  if (buttonMatch) {
    await clickVisibleButtonByIndex(page, buttonMatch.index, 8000);
    return `addField:visibleButton:${buttonMatch.text}`;
  }

  const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  if (normalizeUiText(bodyText).includes(normalizeUiText(field))) {
    return `addField:pickerAlreadyOpen:${field}`;
  }

  const textTargets = await visibleTextTargetsMatching(page, metricAddFieldPattern.source, "i").catch(() => []);
  const clickableTarget = textTargets.find((target) =>
    target.tagName === "button" ||
    target.role === "button" ||
    /btn|button|click|select|add|field|metric|control/i.test(target.className)
  );
  if (clickableTarget) {
    await clickVisibleBodyElementByIndex(page, clickableTarget.index, 8000);
    return `addField:visibleTextTarget:${clickableTarget.tagName}:${clickableTarget.text}`;
  }

  throw new HelperBlockedError(
    `ADD_FIELD_BUTTON_NOT_CLICKABLE:${field}; visibleButtons=${JSON.stringify(buttons.slice(0, 20)).slice(0, 1200)}; visibleTargets=${JSON.stringify(textTargets.slice(0, 20)).slice(0, 1200)}`
  );
};

const selectMetricFieldThroughUi = async (page: Page, field: string): Promise<string> => {
  const currentText = await selectedFieldText(page);
  if (normalizeUiText(currentText).includes(normalizeUiText(field))) return `field:already_visible:${field}`;

  const readiness = await waitForMetricFieldControls(page);
  const addOperation = await clickMetricAddFieldControl(page, field);
  await page.waitForTimeout(500);

  await clickByText(page, field, 12000);
  await page.waitForTimeout(800);

  const afterText = `${await selectedFieldText(page)}\n${await page.locator("body").innerText({ timeout: 3000 }).catch(() => "")}`;
  if (!normalizeUiText(afterText).includes(normalizeUiText(field))) {
    throw new HelperBlockedError(`FIELD_VERIFY_FAILED_AFTER_CLICK:${field}`);
  }
  return `${readiness};${addOperation};field:set:${field}`;
};

const configureMetric = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const warnings: string[] = [];
  const fields = metricFieldsFromParams(options.params);
  const dateRange = stringParam(options.params, "dateRange");
  const uiProfileBefore = await captureUiDomProfile(options, page, "configureMetric.before");
  const stateDeltaBefore = await readStateDelta(page, options.params);
  const operations: string[] = [];
  let dateRangeEvidence: Record<string, unknown> | null = null;
  let dateRangeUiProfiles: UiDomProfileRef[] = [];
  if (fields.length > 0) {
    for (const field of fields) {
      operations.push(await selectMetricFieldThroughUi(page, field));
    }
  }
  if (dateRange) {
    const result = await setDateRange(options, page, dateRange);
    const { uiProfiles, ...resultEvidence } = result;
    dateRangeUiProfiles = uiProfiles ?? [];
    dateRangeEvidence = resultEvidence;
    if (!result.ok) {
      warnings.push(`DATE_RANGE_UI_SETTING_NOT_COMPLETED:${result.warning ?? "unknown"}`);
      operations.push(`dateRange:blocked:${dateRange}`);
    } else {
      operations.push(`dateRange:verified:${dateRange}`);
    }
  }
  const stateDeltaAfter = await readStateDelta(page, options.params);
  const shot = await screenshot(options, page, "configure-metric");
  const uiProfileAfter = await captureUiDomProfile(options, page, "configureMetric.after");
  return createReport(
    options,
    warnings.some((warning) => warning.startsWith("DATE_RANGE_UI_SETTING_NOT_COMPLETED")) ? "blocked" : "ok",
    startedAt,
    {
      domState: await readDomState(page),
      uiProfiles: {
        before: uiProfileBefore,
        after: uiProfileAfter,
        dateRange: dateRangeUiProfiles
      },
      requestedDateRange: dateRange,
      dateRangeEvidence,
      stateDelta: {
        before: stateDeltaBefore,
        after: stateDeltaAfter,
        operations
      }
    },
    shot ? { screenshot: shot } : {},
    shot ? warnings : [...warnings, "SCREENSHOT_UNAVAILABLE"]
  );
};

const runPreview = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const uiProfileBefore = await captureUiDomProfile(options, page, "runPreview.before");
  const observed = await observeDuring(page, async () => {
    await page.getByText("執行", { exact: true }).first().click({ timeout: 15000 });
    await page.waitForTimeout(2500);
  });
  const chart = await readChartSummary(page);
  const table = await readPreviewTableSummary(page);
  ensureDir(artifactRoot(options));
  fs.writeFileSync(
    previewEvidencePath(options),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), caseId: options.caseId, chart, table, network: { requests: observed.requests, responses: observed.responses } }, null, 2)}\n`
  );
  const shot = await screenshot(options, page, "run-preview");
  const uiProfileAfter = await captureUiDomProfile(options, page, "runPreview.after");
  const hasPreviewEvidence = observed.requests.length > 0 || observed.responses.length > 0 || chart !== null || table !== null;
  return createReport(
    options,
    hasPreviewEvidence ? "ok" : "blocked",
    startedAt,
    {
      domState: await readDomState(page),
      uiProfiles: {
        before: uiProfileBefore,
        after: uiProfileAfter
      },
      network: { requests: observed.requests, responses: observed.responses },
      chart,
      table,
      stateDelta: await readStateDelta(page, options.params)
    },
    { ...(shot ? { screenshot: shot } : {}), previewEvidence: previewEvidencePath(options) },
    [
      ...(shot ? [] : ["SCREENSHOT_UNAVAILABLE"]),
      ...(hasPreviewEvidence ? [] : ["PREVIEW_UI_ACTION_NOT_VERIFIED_NO_NETWORK_OR_CHART_EVIDENCE"])
    ]
  );
};

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char !== "\r") cell += char;
  }
  row.push(cell);
  if (row.some((item) => item.trim().length > 0)) rows.push(row);
  return rows;
};

const numericSummary = (values: number[]): Record<string, unknown> | null => {
  if (values.length === 0) return null;
  return {
    count: values.length,
    sum: values.reduce((total, value) => total + value, 0),
    max: Math.max(...values),
    min: Math.min(...values)
  };
};

const approxEqual = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(0.000001, Math.abs(a) * 0.000001, Math.abs(b) * 0.000001);

const readPreviewEvidence = (options: CliOptions): Record<string, unknown> | null => {
  const filePath = previewEvidencePath(options);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const chartSeriesFromPreview = (preview: Record<string, unknown> | null): { labelCount: number | null; series: number[][] } => {
  const chart = preview?.chart && typeof preview.chart === "object" && !Array.isArray(preview.chart) ? preview.chart as Record<string, unknown> : null;
  const labelCount = typeof chart?.labelCount === "number" ? chart.labelCount : null;
  const datasets = Array.isArray(chart?.datasets) ? chart.datasets : [];
  const series = datasets.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const values = (item as Record<string, unknown>).values;
    if (!Array.isArray(values)) return [];
    const numeric = values.map((value) => Number(value)).filter(Number.isFinite);
    return numeric.length > 0 ? [numeric] : [];
  });
  return { labelCount, series };
};

const normalizeComparableCell = (value: unknown): string =>
  String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, (_all, year: string, month: string, day: string) =>
      `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
    );

const comparableNumber = (value: unknown): number | null => {
  const normalized = normalizeComparableCell(value).replace(/,/g, "");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
};

const comparableCellsEqual = (actual: unknown, expected: unknown): boolean => {
  const actualNumber = comparableNumber(actual);
  const expectedNumber = comparableNumber(expected);
  if (actualNumber !== null && expectedNumber !== null) return approxEqual(actualNumber, expectedNumber);
  return normalizeComparableCell(actual) === normalizeComparableCell(expected);
};

const tableRowsFromPreview = (preview: Record<string, unknown> | null): { header: string[]; rows: string[][] } | null => {
  const table = preview?.table && typeof preview.table === "object" && !Array.isArray(preview.table) ? preview.table as Record<string, unknown> : null;
  if (!table) return null;
  const header = Array.isArray(table.header) ? table.header.map((item) => normalizeComparableCell(item)) : [];
  const rows = Array.isArray(table.rows)
    ? table.rows.flatMap((row) => Array.isArray(row) ? [row.map((cell) => normalizeComparableCell(cell))] : [])
    : [];
  if (header.length === 0 && rows.length === 0) return null;
  return { header, rows };
};

const summarizeCsvAgainstPreview = (csvText: string, preview: Record<string, unknown> | null): Record<string, unknown> => {
  const rows = parseCsv(csvText);
  const header = (rows[0] ?? []).map((cell) => normalizeComparableCell(cell));
  const dataRows = rows.slice(1).map((row) => row.map((cell) => normalizeComparableCell(cell))).filter((row) => row.some((cell) => cell.trim().length > 0));
  const numericColumns = header.map((_header, columnIndex) => {
    const values = dataRows.map((row) => Number(String(row[columnIndex] ?? "").replace(/,/g, ""))).filter(Number.isFinite);
    return { columnIndex, header: header[columnIndex] ?? `column_${columnIndex}`, values, summary: numericSummary(values) };
  }).filter((item) => item.values.length > 0);
  const previewSeries = chartSeriesFromPreview(preview);
  const previewTable = tableRowsFromPreview(preview);
  const comparisons = previewSeries.series.map((series, seriesIndex) => {
    const expected = numericSummary(series);
    const match = numericColumns.find((column) => {
      if (column.values.length !== series.length) return false;
      return series.every((value, index) => approxEqual(value, column.values[index] ?? Number.NaN));
    });
    return {
      seriesIndex,
      expected,
      matchedCsvColumn: match ? { columnIndex: match.columnIndex, header: match.header, summary: match.summary } : null
    };
  });
  const tableHeaderMatches = previewTable === null || previewTable.header.length === 0
    ? null
    : previewTable.header.every((expected, index) => comparableCellsEqual(header[index], expected));
  const tableRowsMatched = previewTable === null
    ? null
    : dataRows.length === previewTable.rows.length
      && previewTable.rows.every((expectedRow, rowIndex) => {
        const actualRow = dataRows[rowIndex] ?? [];
        return expectedRow.every((expectedCell, cellIndex) => comparableCellsEqual(actualRow[cellIndex], expectedCell));
      });
  const rowCountMatchesPreview = previewSeries.labelCount !== null
    ? dataRows.length === previewSeries.labelCount
    : previewTable !== null
      ? dataRows.length === previewTable.rows.length
      : null;
  const allSeriesMatched = comparisons.length > 0
    ? comparisons.every((item) => item.matchedCsvColumn !== null)
    : tableRowsMatched;
  return {
    csv: {
      header,
      dataRowCount: dataRows.length,
      sampleRows: dataRows.slice(0, 5),
      tailRows: dataRows.slice(-3),
      numericColumns: numericColumns.map((item) => ({ columnIndex: item.columnIndex, header: item.header, summary: item.summary }))
    },
    preview: {
      labelCount: previewSeries.labelCount,
      seriesCount: previewSeries.series.length,
      tableRowCount: previewTable?.rows.length ?? null,
      tableHeader: previewTable?.header ?? null,
      tableSampleRows: previewTable?.rows.slice(0, 5) ?? null,
      tableTailRows: previewTable?.rows.slice(-3) ?? null
    },
    comparisons,
    checks: {
      rowCountMatchesPreview,
      allSeriesMatched,
      tableHeaderMatches,
      tableRowsMatched
    }
  };
};

const normalizeFieldIdentity = (value: string): string =>
  value
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();

const fieldPickerSourceGroupLabels = (sourceReport: string): string[] => {
  const direct = sourceReport.trim();
  const known: Record<string, string[]> = {
    "每日報表": ["DAILY_REPORT"]
  };
  return [...new Set([direct, ...(known[direct] ?? [])].filter(Boolean))];
};

const normalizeFieldPickerGroup = (value: string | null | undefined): string =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .toUpperCase();

const cleanFieldPickerLabel = (text: string, code?: unknown): string => {
  let label = text
    .replace(/\b(NUMERIC|STRING|DATE|DATETIME|BOOLEAN|BOOL|TEXT|NUMBER)\b\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const compact = label.replace(/\s+/g, "");
  const compactCode = String(code ?? "").replace(/_/g, "").toUpperCase();
  if (compactCode) {
    const upper = compact.toUpperCase();
    if (upper.endsWith(compactCode)) {
      const prefix = compact.slice(0, compact.length - compactCode.length);
      if (/[\u4e00-\u9fff]/.test(prefix) && prefix.length >= 2) label = prefix;
    }
  }
  return label.trim();
};

const normalizeMetadataAlias = (fieldName: string): string => {
  const key = normalizeFieldIdentity(fieldName);
  const aliases: Record<string, string> = {
    [normalizeFieldIdentity("iOS平台總營收")]: "iOS總營收",
    [normalizeFieldIdentity("iOS平台付費帳號數")]: "iOS付費帳號數",
    [normalizeFieldIdentity("iOS平台付費次數")]: "iOS付費次數",
    [normalizeFieldIdentity("Android平台總營收")]: "Android總營收",
    [normalizeFieldIdentity("Android平台付費帳號數")]: "Android付費帳號數",
    [normalizeFieldIdentity("Android平台付費次數")]: "Android付費次數",
    [normalizeFieldIdentity("線下商城平台總營收")]: "線下商城總營收",
    [normalizeFieldIdentity("線下商城Coda總營收")]: "線下商城CODAPAY總營收",
    [normalizeFieldIdentity("線下商城Coda付費帳號數")]: "線下商城CODAPAY付費帳號數",
    [normalizeFieldIdentity("線下商城Coda付費次數")]: "線下商城CODAPAY付費次數"
  };
  return aliases[key] ?? fieldName;
};

const resolveMetadataCsvPath = (options: CliOptions): { path: string | null; source: string; referenceIndexEntry?: unknown } => {
  const referenceKey = stringParam(options.params, "referenceIndexKey") ?? "bi_metadata_csv";
  const referenceIndexPath = path.join(options.runDir, "input", "reference-index.json");
  if (fs.existsSync(referenceIndexPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(referenceIndexPath, "utf8")) as Record<string, unknown>;
      const localReferences = Array.isArray(parsed.localReferences) ? parsed.localReferences : [];
      const entry = localReferences.find((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return false;
        return (item as Record<string, unknown>).key === referenceKey;
      }) as Record<string, unknown> | undefined;
      const indexedPath = typeof entry?.path === "string" ? entry.path : null;
      if (indexedPath && fs.existsSync(indexedPath)) {
        return { path: indexedPath, source: `reference-index:${referenceKey}`, referenceIndexEntry: entry };
      }
    } catch {
      // Fall back to explicit/default path below.
    }
  }

  const explicit = firstStringParam(options.params, ["referenceCsv", "referenceSourcePath"]) ?? "rules/BI_DATA/metadata.csv";
  const candidates = [
    path.isAbsolute(explicit) ? explicit : path.join(options.runDir, explicit),
    path.join(options.runDir, "rules", "BI_DATA", "metadata.csv")
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return { path: found ?? null, source: found ? "params.referenceCsv" : "not_found" };
};

const readExpectedMetadataFields = (
  options: CliOptions
): { metadataPath: string | null; source: string; referenceIndexEntry?: unknown; expectedFields: string[]; header: string[]; warnings: string[] } => {
  const resolved = resolveMetadataCsvPath(options);
  const warnings: string[] = [];
  if (!resolved.path) {
    return {
      metadataPath: null,
      source: resolved.source,
      referenceIndexEntry: resolved.referenceIndexEntry,
      expectedFields: [],
      header: [],
      warnings: ["METADATA_CSV_NOT_FOUND"]
    };
  }

  const sourceReport = stringParam(options.params, "source") ?? stringParam(options.params, "sourceReport") ?? "每日報表";
  const rows = parseCsv(fs.readFileSync(resolved.path, "utf8"));
  const header = rows[0] ?? [];
  const nameIndex = header.indexOf("欄位名稱");
  const sourceIndex = header.indexOf("來源報表");
  const collageAvailableIndex = header.indexOf("所屬報表是否可用於拼貼模式主選擇");
  if (nameIndex === -1 || sourceIndex === -1 || collageAvailableIndex === -1) {
    warnings.push("METADATA_REQUIRED_COLUMNS_NOT_FOUND");
  }
  const expectedFields = rows.slice(1)
    .filter((row) => {
      if (nameIndex === -1) return false;
      const rowSource = sourceIndex === -1 ? "" : String(row[sourceIndex] ?? "").trim();
      const available = collageAvailableIndex === -1 ? "" : String(row[collageAvailableIndex] ?? "").trim().toUpperCase();
      return rowSource === sourceReport && available === "Y";
    })
    .map((row) => String(row[nameIndex] ?? "").trim())
    .filter(Boolean);

  return {
    metadataPath: resolved.path,
    source: resolved.source,
    referenceIndexEntry: resolved.referenceIndexEntry,
    expectedFields,
    header,
    warnings
  };
};

const inferFieldLabel = (text: string, expectedFields: string[], code?: unknown): string => {
  const cleaned = cleanFieldPickerLabel(text, code);
  if (cleaned) return cleaned;

  const normalizedText = normalizeFieldIdentity(text);
  const matched = [...expectedFields]
    .sort((a, b) => normalizeFieldIdentity(b).length - normalizeFieldIdentity(a).length)
    .find((field) => normalizedText.includes(normalizeFieldIdentity(field)));
  if (matched) return matched;

  const lines = text
    .split(/\n|\r| {2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^(數值|百分比|文字|日期|時間|加總|平均|最大|最小|COUNT|SUM|AVG|MAX|MIN|×|\+新增欄位)$/i.test(item));
  return lines[0] ?? text.trim();
};

const extractFieldPickerDomItems = async (page: Page): Promise<Array<Record<string, unknown>>> => {
  return page.evaluate(() => {
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const rectFor = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };
    const classNameFor = (element: Element): string => typeof (element as HTMLElement).className === "string" ? (element as HTMLElement).className : "";
    const isGroupHeaderText = (text: string): boolean => /^[A-Z][A-Z0-9_]{2,}$/.test(text) && !/^(NUMERIC|STRING|DATE|DATETIME|BOOLEAN|BOOL|TEXT|NUMBER)$/.test(text);
    const all = Array.from(document.querySelectorAll<HTMLElement>("body *"));
    const visibleMeta = all.map((element, index) => ({
      element,
      index,
      text: normalize(element.innerText || element.textContent),
      onclick: element.getAttribute("onclick") ?? ""
    })).filter((item) => item.text && isVisible(item.element));
    const groupForIndex = (index: number): string | null => {
      for (let cursor = visibleMeta.length - 1; cursor >= 0; cursor -= 1) {
        const item = visibleMeta[cursor];
        if (item.index >= index || item.onclick) continue;
        if (isGroupHeaderText(item.text)) return item.text;
      }
      return null;
    };
    const itemFor = (element: HTMLElement, index: number, source: string) => {
      const text = normalize(element.innerText || element.textContent);
      const onclick = element.getAttribute("onclick");
      const codeMatch = onclick?.match(/addFieldToSelection\(['"]([^'"]+)['"]/i);
      return {
        index,
        source,
        text,
        code: codeMatch?.[1] ?? element.getAttribute("data-field-code") ?? element.getAttribute("data-field") ?? element.getAttribute("data-value"),
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        className: classNameFor(element),
        onclick,
        groupLabel: groupForIndex(index),
        rect: rectFor(element)
      };
    };
    const primary = all.flatMap((element, index) => {
      const onclick = element.getAttribute("onclick") ?? "";
      if (!/addFieldToSelection/i.test(onclick) || !isVisible(element)) return [];
      const text = normalize(element.innerText || element.textContent);
      return text ? [itemFor(element, index, "onclick:addFieldToSelection")] : [];
    });
    if (primary.length > 0) return primary;

    const containers = Array.from(document.querySelectorAll<HTMLElement>(
      "[class*='dropdown'], [class*='Dropdown'], [class*='menu'], [class*='Menu'], [class*='picker'], [class*='Picker'], [class*='option'], [class*='Option'], [id*='dropdown'], [id*='Dropdown'], [id*='field'], [role='listbox'], [role='menu']"
    )).filter((element) => isVisible(element) && !/fieldSelectionContainer|dataFilterContainer|groupDimensionContainer/i.test(element.id));
    const container = containers
      .map((element) => {
        const leaves = Array.from(element.querySelectorAll<HTMLElement>("button, [role='option'], [role='menuitem'], li, div, span"))
          .filter((child) => isVisible(child))
          .filter((child) => {
            const text = normalize(child.innerText || child.textContent);
            if (!text || text.length > 90) return false;
            if (/^(← 返回|拼貼|指標|明細|儲存報表|執行|\+ 新增欄位|\+ 新增運算欄位|時間區間|過去7天|每天|確認|取消|×)$/i.test(text)) return false;
            return true;
          });
        return { element, leaves };
      })
      .sort((a, b) => b.leaves.length - a.leaves.length)[0];
    if (!container || container.leaves.length === 0) return [];
    const leafSet = new Set(container.leaves);
    return all.flatMap((element, index) => leafSet.has(element) ? [itemFor(element, index, "dropdown-container-leaf")] : []);
  });
};

const extractMetadataDropdownFields = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const warnings: string[] = [];
  const uiProfileBefore = await captureUiDomProfile(options, page, "metadataDropdown.before");
  const metadata = readExpectedMetadataFields(options);
  warnings.push(...metadata.warnings);
  const expectedFields = metadata.expectedFields;
  const probeField = expectedFields[0] ?? "新增帳號數";
  const pickerReadiness = await waitForMetricFieldControls(page);
  const addOperation = await clickMetricAddFieldControl(page, probeField);
  await page.waitForTimeout(700);

  const rawItems = await extractFieldPickerDomItems(page);
  const sourceReport = stringParam(options.params, "source") ?? stringParam(options.params, "sourceReport") ?? "每日報表";
  const targetGroups = fieldPickerSourceGroupLabels(sourceReport).map(normalizeFieldPickerGroup);
  const groupedItems = rawItems.filter((item) => {
    const groupLabel = typeof item.groupLabel === "string" ? item.groupLabel : null;
    return groupLabel ? targetGroups.includes(normalizeFieldPickerGroup(groupLabel)) : false;
  });
  const scopedRawItems = groupedItems.length > 0 ? groupedItems : rawItems;
  if (rawItems.length > 0 && groupedItems.length === 0) warnings.push("METADATA_DROPDOWN_SOURCE_GROUP_SCOPE_NOT_FOUND_USING_ALL_ITEMS");

  const actualItems = scopedRawItems.map((item) => ({
    ...item,
    label: inferFieldLabel(String(item.text ?? ""), expectedFields, item.code)
  }));
  const seen = new Set<string>();
  const actualVisibleItems = actualItems
    .map((item) => String(item.label ?? "").trim())
    .filter(Boolean)
    .filter((label) => {
      const key = normalizeFieldIdentity(label);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const expectedByKey = new Map(expectedFields.map((field) => [normalizeFieldIdentity(normalizeMetadataAlias(field)), field]));
  const actualByKey = new Map(actualVisibleItems.map((field) => [normalizeFieldIdentity(normalizeMetadataAlias(field)), field]));
  const exactExpectedByKey = new Map(expectedFields.map((field) => [normalizeFieldIdentity(field), field]));
  const exactActualByKey = new Map(actualVisibleItems.map((field) => [normalizeFieldIdentity(field), field]));
  const missingFields = expectedFields.filter((field) => !actualByKey.has(normalizeFieldIdentity(normalizeMetadataAlias(field))));
  const extraFields = actualVisibleItems.filter((field) => !expectedByKey.has(normalizeFieldIdentity(normalizeMetadataAlias(field))));
  const exactMissingFields = expectedFields.filter((field) => !exactActualByKey.has(normalizeFieldIdentity(field)));
  const exactExtraFields = actualVisibleItems.filter((field) => !exactExpectedByKey.has(normalizeFieldIdentity(field)));
  const matchedFields = expectedFields.filter((field) => actualByKey.has(normalizeFieldIdentity(normalizeMetadataAlias(field))));

  const evidence = {
    caseNo: options.caseId,
    sourceGroupLabel: sourceReport,
    sourceGroupDomLabels: fieldPickerSourceGroupLabels(sourceReport),
    pickerReadiness,
    pickerOpenAction: addOperation,
    actualScope: {
      mode: groupedItems.length > 0 ? "source_group" : "all_items_fallback",
      requestedSourceReport: sourceReport,
      targetGroupLabels: fieldPickerSourceGroupLabels(sourceReport),
      allRawItemCount: rawItems.length,
      scopedRawItemCount: scopedRawItems.length
    },
    actualVisibleItems,
    actualCount: actualVisibleItems.length,
    actualRawItems: actualItems,
    expectedSource: {
      referenceCsv: metadata.metadataPath,
      referenceCsvRelativePath: metadata.metadataPath ? path.relative(options.runDir, metadata.metadataPath) : null,
      referenceIndexKey: stringParam(options.params, "referenceIndexKey") ?? "bi_metadata_csv",
      referenceIndexEntry: metadata.referenceIndexEntry ?? null,
      referenceSourceName: stringParam(options.params, "referenceSourceName") ?? "metadata＿1.2.5 - 工作表1.csv",
      sourceReport: stringParam(options.params, "source") ?? stringParam(options.params, "sourceReport") ?? "每日報表",
      matchKey: stringParam(options.params, "matchKey") ?? "欄位名稱",
      compareFields: Array.isArray(options.params.compareFields) ? options.params.compareFields : ["欄位名稱", "資料類型"],
      filter: "來源報表 == sourceReport && 所屬報表是否可用於拼貼模式主選擇 == Y"
    },
    expectedFields,
    expectedCount: expectedFields.length,
    missingFields,
    extraFields,
    exactMissingFields,
    exactExtraFields,
    normalizationNotes: [
      "comparison normalizes whitespace, full-width/half-width parentheses, and source-specific known naming aliases",
      "actual picker fields are scoped to the requested source group when a DOM group header such as DAILY_REPORT is present",
      "field labels remove UI type badges such as NUMERIC and trailing field codes such as RAU when they are appended to the visible label",
      "DOM extraction reads visible picker options / addFieldToSelection onclick metadata only; it does not call BI API"
    ],
    comparison: {
      matchedFields,
      missingFields,
      extraFields,
      exactMissingFields,
      exactExtraFields,
      trueDifferenceCount: missingFields.length + extraFields.length
    },
    verdict: missingFields.length === 0 && extraFields.length === 0 ? "matches" : "differences_found"
  };
  const evidencePath = path.join(artifactRoot(options), "metadata-dropdown-evidence.json");
  ensureDir(path.dirname(evidencePath));
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  if (actualVisibleItems.length === 0) warnings.push("METADATA_DROPDOWN_NO_VISIBLE_ITEMS_EXTRACTED");
  if (expectedFields.length === 0) warnings.push("METADATA_EXPECTED_FIELDS_EMPTY");
  const shot = await screenshot(options, page, "metadata-dropdown");
  const uiProfileAfter = await captureUiDomProfile(options, page, "metadataDropdown.after");

  return createReport(
    options,
    actualVisibleItems.length > 0 && expectedFields.length > 0 ? "ok" : "blocked",
    startedAt,
    {
      domState: await readDomState(page),
      uiProfiles: { before: uiProfileBefore, after: uiProfileAfter },
      metadataDropdownEvidence: evidence
    },
    { ...(shot ? { screenshot: shot } : {}), metadataDropdownEvidence: evidencePath },
    shot ? warnings : [...warnings, "SCREENSHOT_UNAVAILABLE"]
  );
};

type ReportListRowState = {
  found: boolean;
  reportName: string;
  url: string;
  bodyTextExcerpt: string;
  rowText: string | null;
  downloadControls: Array<Record<string, unknown>>;
};

type CsvDownloadTriggerEvidence = {
  clicked: boolean;
  trigger: string;
  candidates?: unknown[];
  rowState?: ReportListRowState;
  selectedControl?: Record<string, unknown>;
  clickError?: string;
  [key: string]: unknown;
};

const readReportListRowState = async (page: Page, reportName: string): Promise<ReportListRowState> => {
  return await page.evaluate((targetReportName) => {
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const downloadPattern = /下載|CSV|匯出|download|export|⬇/i;
    const allBodyElements = Array.from(document.querySelectorAll<HTMLElement>("body *"));
    const rowElements = Array.from(document.querySelectorAll<HTMLElement>(
      "tr, [class*=row], [class*=Row], [class*=card], [class*=Card], [class*=item], [class*=Item]"
    ));
    const matchingRows = rowElements
      .filter((element) => isVisible(element) && normalize(element.innerText || element.textContent).includes(targetReportName))
      .map((row) => {
        const controls = Array.from(row.querySelectorAll<HTMLElement>("button, a, [role=button]")).flatMap((control) => {
          if (!isVisible(control)) return [];
          const text = normalize(control.innerText || control.textContent);
          const attrs = [
            control.getAttribute("aria-label"),
            control.getAttribute("title"),
            control.getAttribute("download"),
            control.getAttribute("href"),
            control.getAttribute("onclick"),
            typeof control.className === "string" ? control.className : ""
          ].join(" ");
          if (!downloadPattern.test(`${text} ${attrs}`)) return [];
          const rect = control.getBoundingClientRect();
          return [{
            bodyIndex: allBodyElements.indexOf(control),
            text,
            tagName: control.tagName.toLowerCase(),
            role: control.getAttribute("role"),
            ariaLabel: control.getAttribute("aria-label"),
            title: control.getAttribute("title"),
            onclick: control.getAttribute("onclick"),
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
          }];
        });
        const rect = row.getBoundingClientRect();
        return {
          text: normalize(row.innerText || row.textContent),
          downloadControls: controls,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
        };
      })
      .sort((a, b) => a.text.length - b.text.length || b.downloadControls.length - a.downloadControls.length);
    const row = matchingRows[0] ?? null;
    return {
      found: row !== null,
      reportName: targetReportName,
      url: window.location.href,
      bodyTextExcerpt: normalize(document.body?.innerText ?? "").slice(0, 3000),
      rowText: row?.text ?? null,
      downloadControls: row?.downloadControls ?? []
    };
  }, reportName);
};

const ensureSavedReportListRowVisible = async (
  options: CliOptions,
  page: Page,
  reportName: string
): Promise<{ state: ReportListRowState; attempts: Array<ReportListRowState & { label: string }>; recoveryActions: string[] }> => {
  const attempts: Array<ReportListRowState & { label: string }> = [];
  const recoveryActions: string[] = [];
  const projectName = stringParam(options.params, "projectName");
  const capture = async (label: string): Promise<ReportListRowState> => {
    const state = await readReportListRowState(page, reportName);
    attempts.push({ ...state, label });
    return state;
  };

  let state = await capture("initial");
  if (state.found) return { state, attempts, recoveryActions };

  if (/報表設定|儲存報表|執行/.test(state.bodyTextExcerpt) && projectName) {
    recoveryActions.push("click_project_from_editor");
    await clickByText(page, projectName, 8000).catch((error) => {
      recoveryActions.push(`click_project_from_editor_failed:${error instanceof Error ? error.message : String(error)}`);
    });
    await page.waitForTimeout(1200);
    state = await capture("after_project_click_from_editor");
    if (state.found) return { state, attempts, recoveryActions };
  }

  recoveryActions.push("reload_report_list");
  await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch((error) => {
    recoveryActions.push(`reload_report_list_failed:${error instanceof Error ? error.message : String(error)}`);
  });
  await page.waitForTimeout(1500);
  state = await capture("after_reload");
  if (state.found) return { state, attempts, recoveryActions };

  if (projectName) {
    recoveryActions.push("click_project_after_reload");
    await clickByText(page, projectName, 8000).catch((error) => {
      recoveryActions.push(`click_project_after_reload_failed:${error instanceof Error ? error.message : String(error)}`);
    });
    await page.waitForTimeout(1200);
    state = await capture("after_project_click");
  }

  return { state, attempts, recoveryActions };
};

const clickReportListCsvDownload = async (
  page: Page,
  reportName: string,
  state: ReportListRowState | null = null
): Promise<CsvDownloadTriggerEvidence> => {
  const rowState = state ?? await readReportListRowState(page, reportName);
  if (!rowState.found) return { clicked: false, trigger: "report-list-row-not-found", rowState };
  const selectedControl = rowState.downloadControls[0];
  if (typeof selectedControl?.bodyIndex === "number" && selectedControl.bodyIndex >= 0) {
    try {
      await clickVisibleBodyElementByIndex(page, selectedControl.bodyIndex, 8000);
      return { clicked: true, trigger: "report-list-row-download-control", rowState, selectedControl };
    } catch (error) {
      const fallbackClicked = await clickFirstVisible([
        page.locator("tr").filter({ hasText: reportName }).locator("button, a, [role=button]").filter({ hasText: /下載|CSV|匯出|⬇/i }),
        page.locator("[class*=row], [class*=Row], [class*=card], [class*=Card], [class*=item], [class*=Item], [class*=list], [class*=List]")
          .filter({ hasText: reportName })
          .locator("button, a, [role=button]")
          .filter({ hasText: /下載|CSV|匯出|⬇/i })
      ], 8000);
      if (fallbackClicked) return { clicked: true, trigger: "report-list-row-text-button", rowState, selectedControl };
      return {
        clicked: false,
        trigger: "report-list-row-download-click-failed",
        rowState,
        selectedControl,
        clickError: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const candidates = await page.evaluate((targetReportName) => {
    const normalize = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const downloadPattern = /下載|CSV|匯出|download|export|⬇/i;
    const all = Array.from(document.querySelectorAll<HTMLElement>("body *"));
    const reportElements = all.filter((element) => isVisible(element) && normalize(element.innerText || element.textContent).includes(targetReportName));
    const reportRects = reportElements.map((element) => element.getBoundingClientRect());
    return all.flatMap((element, index) => {
      if (!isVisible(element)) return [];
      const text = normalize(element.innerText || element.textContent);
      const attrs = [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("download"),
        element.getAttribute("href"),
        element.getAttribute("onclick"),
        typeof element.className === "string" ? element.className : ""
      ].join(" ");
      if (!downloadPattern.test(`${text} ${attrs}`)) return [];
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute("role");
      if (!["button", "a"].includes(tag) && role !== "button") return [];
      const rect = element.getBoundingClientRect();
      const nearReport = reportRects.some((reportRect) => Math.abs((reportRect.y + reportRect.height / 2) - (rect.y + rect.height / 2)) < 90);
      const ancestorHasReport = Boolean(element.closest("tr, [class*=row], [class*=Row], [class*=card], [class*=Card], [class*=item], [class*=Item]")?.textContent?.includes(targetReportName));
      if (!nearReport && !ancestorHasReport) return [];
      return [{
        index,
        text,
        tagName: tag,
        role,
        ariaLabel: element.getAttribute("aria-label"),
        title: element.getAttribute("title"),
        onclick: element.getAttribute("onclick"),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
      }];
    });
  }, reportName);
  const target = candidates[0] as { index?: unknown } | undefined;
  if (typeof target?.index === "number") {
    await clickVisibleBodyElementByIndex(page, target.index, 8000);
    return { clicked: true, trigger: "report-list-row-nearby-download-control", candidates, rowState };
  }
  return { clicked: false, trigger: "report-list-row-download-not-found", candidates, rowState };
};

const isLikelyCsvDownloadResponse = (response: Response): boolean => {
  const headers = response.headers();
  const contentType = String(headers["content-type"] ?? "").toLowerCase();
  const disposition = String(headers["content-disposition"] ?? "").toLowerCase();
  const url = response.url().toLowerCase();
  if (response.status() < 200 || response.status() >= 300) return false;
  return /text\/csv|application\/csv|application\/octet-stream|application\/vnd\.ms-excel/.test(contentType)
    || /attachment|\.csv/.test(disposition)
    || /download|export|csv/.test(url);
};

const filenameFromContentDisposition = (value: string | undefined): string | null => {
  if (!value) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      return utf8;
    }
  }
  return /filename="?([^";]+)"?/i.exec(value)?.[1]?.trim() ?? null;
};

const observeUiTriggeredCsvDownload = async (
  page: Page,
  trigger: () => Promise<CsvDownloadTriggerEvidence>
): Promise<{
  triggerEvidence: CsvDownloadTriggerEvidence;
  download: Download | null;
  downloadError: string | null;
  csvResponse: Response | null;
  requests: Record<string, unknown>[];
  responses: Record<string, unknown>[];
}> => {
  const requests: Record<string, unknown>[] = [];
  const responses: Record<string, unknown>[] = [];
  const responseObjects: Response[] = [];
  const onRequest = (request: Request) => {
    if (!/biapi|preview|report|chart|custom|download|csv|export/i.test(request.url())) return;
    requests.push({
      url: request.url(),
      method: request.method(),
      postData: request.postData()?.slice(0, 4000) ?? null,
      timestamp: new Date().toISOString()
    });
  };
  const onResponse = (response: Response) => {
    if (!/biapi|preview|report|chart|custom|download|csv|export/i.test(response.url())) return;
    responseObjects.push(response);
    responses.push({
      url: response.url(),
      status: response.status(),
      contentType: response.headers()["content-type"] ?? null,
      contentDisposition: response.headers()["content-disposition"] ?? null,
      timestamp: new Date().toISOString()
    });
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  let downloadError: string | null = null;
  const downloadPromise: Promise<Download | null> = page.waitForEvent("download", { timeout: 20000 }).catch((error) => {
    downloadError = error instanceof Error ? error.message : String(error);
    return null;
  });
  try {
    const triggerEvidence = await trigger();
    if (!triggerEvidence.clicked) {
      downloadPromise.catch(() => undefined);
      return { triggerEvidence, download: null, downloadError: null, csvResponse: null, requests, responses };
    }
    const download = await downloadPromise;
    return {
      triggerEvidence,
      download,
      downloadError,
      csvResponse: [...responseObjects].reverse().find(isLikelyCsvDownloadResponse) ?? null,
      requests,
      responses
    };
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
  }
};

const downloadCsvAndComparePreview = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const uiProfileBefore = await captureUiDomProfile(options, page, "downloadCsv.before");
  const domStateBefore: Record<string, unknown> = await readDomState(page).catch((error) => ({ readError: error instanceof Error ? error.message : String(error) }));
  const downloadDir = path.join(artifactRoot(options), "downloads");
  ensureDir(downloadDir);
  const savedReportName = readSavedReportName(options);
  const downloadScope = stringParam(options.params, "downloadScope");
  const bodyTextBefore = typeof domStateBefore.bodyTextExcerpt === "string" ? domStateBefore.bodyTextExcerpt : "";
  const wantsReportList = downloadScope === "report_list"
    || Boolean(savedReportName && bodyTextBefore.includes(savedReportName) && !/報表設定|儲存報表|執行/.test(bodyTextBefore));
  if (wantsReportList && !savedReportName) throw new HelperBlockedError("SAVED_REPORT_NAME_MISSING_FOR_REPORT_LIST_CSV");

  let listRecovery: Awaited<ReturnType<typeof ensureSavedReportListRowVisible>> | null = null;
  let reportListState: ReportListRowState | null = null;
  if (wantsReportList && savedReportName) {
    listRecovery = await ensureSavedReportListRowVisible(options, page, savedReportName);
    reportListState = listRecovery.state;
    if (!reportListState.found || reportListState.downloadControls.length === 0) {
      const failedSubcondition = !reportListState.found ? "saved_report_row_missing" : "csv_button_missing_on_saved_report_row";
      const shot = await screenshot(options, page, failedSubcondition);
      const uiProfileAfterPrecondition = await captureUiDomProfile(options, page, `downloadCsv.${failedSubcondition}`);
      return createReport(
        options,
        "ok",
        startedAt,
        {
          workflowStatus: "failed_precondition",
          failedSubcondition,
          csv_comparison_status: "not_reached",
          reportName: savedReportName,
          requestedScope: downloadScope ?? "auto_report_list",
          domState: await readDomState(page),
          uiProfiles: { before: uiProfileBefore, precondition: uiProfileAfterPrecondition },
          reportList: listRecovery
        },
        shot ? { screenshot: shot } : {},
        [
          ...(shot ? [] : ["SCREENSHOT_UNAVAILABLE"]),
          failedSubcondition === "saved_report_row_missing" ? "CSV_SAVED_REPORT_ROW_NOT_FOUND_AFTER_REFRESH" : "CSV_SAVED_REPORT_ROW_DOWNLOAD_CONTROL_NOT_FOUND"
        ]
      );
    }
  }

  const observedDownload = await observeUiTriggeredCsvDownload(page, async () => {
    if (wantsReportList && savedReportName) {
      const rowDownload = await clickReportListCsvDownload(page, savedReportName, reportListState);
      return { ...rowDownload, reportName: savedReportName, requestedScope: downloadScope ?? "auto_report_list" };
    }
    const clicked = await clickFirstVisible([
      page.getByText(/下載.*CSV|CSV.*下載|匯出.*CSV|CSV|下載/i),
      page.locator("button").filter({ hasText: /下載|CSV|匯出/ })
    ], 12000);
    return clicked
      ? { clicked: true, trigger: "global-download-control", reportName: savedReportName ?? null }
      : { clicked: false, trigger: "global-download-control-not-found", reportName: savedReportName ?? null };
  });
  const triggerEvidence = observedDownload.triggerEvidence;
  if (!observedDownload.triggerEvidence.clicked) {
    const cleanupState = domStateBefore.cleanupState && typeof domStateBefore.cleanupState === "object"
      ? domStateBefore.cleanupState as Record<string, unknown>
      : {};
    const precondition = /請選擇欄位|點擊「?執行」?查看|尚無資料|沒有資料|無預覽/i.test(bodyTextBefore)
      ? "CSV_PRECONDITION_NOT_MET_NO_CURRENT_PREVIEW"
      : "CSV_DOWNLOAD_BUTTON_NOT_CLICKABLE";
    throw new HelperBlockedError(
      `${precondition}; downloadTrigger=${JSON.stringify(triggerEvidence).slice(0, 1200)}; dateRange=${String(cleanupState.dateRangeText ?? "(unknown)")}; fields=${String(cleanupState.fieldSelectionText ?? "(unknown)")}; buttons=${JSON.stringify(domStateBefore.buttons ?? []).slice(0, 800)}`
    );
  }

  let csvPath: string;
  let downloadedCsv: Record<string, unknown>;
  const csvWarnings: string[] = [];
  if (observedDownload.download) {
    const suggested = sanitize(observedDownload.download.suggestedFilename() || `${sanitize(options.caseId)}.csv`);
    csvPath = path.join(downloadDir, suggested);
    await observedDownload.download.saveAs(csvPath);
    downloadedCsv = {
      source: "browser_download_event",
      path: csvPath,
      relativePath: path.relative(options.runDir, csvPath),
      suggestedFilename: observedDownload.download.suggestedFilename(),
      trigger: triggerEvidence
    };
  } else if (observedDownload.csvResponse) {
    const headers = observedDownload.csvResponse.headers();
    const suggested = sanitize(filenameFromContentDisposition(headers["content-disposition"]) ?? `${sanitize(savedReportName ?? options.caseId)}_ui-response.csv`);
    csvPath = path.join(downloadDir, suggested);
    fs.writeFileSync(csvPath, await observedDownload.csvResponse.body());
    csvWarnings.push("CSV_BROWSER_DOWNLOAD_EVENT_NOT_FIRED_USED_UI_RESPONSE_BODY");
    downloadedCsv = {
      source: "ui_triggered_network_response_body",
      path: csvPath,
      relativePath: path.relative(options.runDir, csvPath),
      suggestedFilename: suggested,
      responseUrl: observedDownload.csvResponse.url(),
      responseStatus: observedDownload.csvResponse.status(),
      responseContentType: headers["content-type"] ?? null,
      responseContentDisposition: headers["content-disposition"] ?? null,
      trigger: triggerEvidence
    };
  } else {
    throw new HelperBlockedError(
      `CSV_UI_DOWNLOAD_NOT_OBSERVED; downloadError=${observedDownload.downloadError ?? "(none)"}; trigger=${JSON.stringify(triggerEvidence).slice(0, 1200)}; network=${JSON.stringify(observedDownload.responses).slice(0, 1200)}`
    );
  }
  const csvText = fs.readFileSync(csvPath, "utf8");
  const preview = readPreviewEvidence(options);
  const comparison = summarizeCsvAgainstPreview(csvText, preview);
  const shot = await screenshot(options, page, "download-csv");
  const uiProfileAfter = await captureUiDomProfile(options, page, "downloadCsv.after");
  const checks = comparison.checks as Record<string, unknown>;
  const failedComparison = checks.rowCountMatchesPreview === false || checks.allSeriesMatched === false;
  return createReport(
    options,
    "ok",
    startedAt,
    {
      domState: await readDomState(page),
      uiProfiles: { before: uiProfileBefore, after: uiProfileAfter },
      reportList: listRecovery,
      downloadedCsv,
      previewEvidencePath: fs.existsSync(previewEvidencePath(options)) ? previewEvidencePath(options) : null,
      comparison,
      network: { requests: observedDownload.requests, responses: observedDownload.responses },
      downloadEventError: observedDownload.downloadError
    },
    { ...(shot ? { screenshot: shot } : {}), csv: csvPath },
    [
      ...(shot ? [] : ["SCREENSHOT_UNAVAILABLE"]),
      ...csvWarnings,
      ...(preview ? [] : ["PREVIEW_EVIDENCE_NOT_FOUND_FOR_CSV_COMPARISON"]),
      ...(failedComparison ? ["CSV_PREVIEW_COMPARISON_MISMATCH"] : [])
    ]
  );
};

const approvalRequired = (options: CliOptions, action: string, startedAt: string): HelperReport => {
  const requestId = `${options.caseId}-${sanitize(options.action)}`;
  return createReport(
    options,
    "requires_approval",
    startedAt,
    {},
    {},
    ["TOOL_BRIDGE_RESPONSE_REQUIRED_BEFORE_HELPER_ACTION"],
    {
      toolRequest: {
        type: "irreversible_operation",
        request_id: requestId,
        case: options.caseId,
        action,
        reason: `${options.action} may create, overwrite, delete, or accept native dialogs.`,
        proposed_action: `Authorize helper action ${options.action} for current case ${options.caseId} only.`
      }
    }
  );
};

const fillVisibleReportNameInput = async (page: Page, reportName: string): Promise<Record<string, unknown>> => {
  const inputs = await visibleInputIndexes(page);
  const candidates = inputs.filter((item) => item.type === "text" && !/專案|project/i.test(item.placeholder));
  const preferred =
    candidates.find((item) => /報表|report|名稱|name/i.test(item.placeholder)) ??
    candidates.find((item) => item.value.trim().length === 0) ??
    candidates.at(-1);
  if (!preferred) {
    throw new HelperBlockedError(`SAVE_REPORT_NAME_INPUT_NOT_FOUND inputs=${JSON.stringify(inputs).slice(0, 1000)}`);
  }
  await page.locator("input").nth(preferred.index).fill(reportName, { timeout: 8000 });
  return { selectedInput: preferred, visibleInputs: inputs };
};

const clickModalSaveButton = async (page: Page): Promise<void> => {
  const clicked = await clickFirstVisible([
    page.locator(".modal button").filter({ hasText: /儲存|確認|確定|保存/ }),
    page.locator("[role=dialog] button").filter({ hasText: /儲存|確認|確定|保存/ }),
    page.locator("button").filter({ hasText: /儲存|確認|確定|保存/ })
  ], 8000);
  if (!clicked) throw new HelperBlockedError("SAVE_MODAL_SUBMIT_BUTTON_NOT_CLICKABLE");
};

const clickDialogOnlySaveButton = async (page: Page): Promise<boolean> => {
  return clickFirstVisible([
    page.locator(".modal button").filter({ hasText: /儲存|確認|確定|保存/ }),
    page.locator("[role=dialog] button").filter({ hasText: /儲存|確認|確定|保存/ })
  ], 5000);
};

type NativeDialogHandling = {
  action: "accept" | "dismiss";
  reason: string;
  requiresRecovery: boolean;
};

const decideSaveDialogHandling = (dialogRecord: Record<string, unknown>, sequence: number): NativeDialogHandling => {
  const type = String(dialogRecord.type ?? "");
  const message = String(dialogRecord.message ?? "");
  if (/sso|login|登入|密碼|password|驗證|認證/i.test(message)) {
    return { action: "dismiss", reason: "auth_like_dialog_not_auto_approved", requiresRecovery: true };
  }
  if (/是否\s*(?:返回|回到)\s*報表列表|(?:返回|回到)\s*列表/.test(message)) {
    return { action: "accept", reason: "known_bi_save_return_to_list_confirm", requiresRecovery: false };
  }
  if (/報表儲存成功|儲存成功|保存成功/.test(message)) {
    return { action: "accept", reason: "known_bi_save_success_dialog", requiresRecovery: false };
  }
  if (/覆寫|覆蓋|更新|是否.*儲存|是否.*保存/.test(message)) {
    return { action: "accept", reason: "known_bi_overwrite_save_confirm", requiresRecovery: false };
  }
  if (/是否.*(?:新增|建立).*報表|(?:新增|建立)報表/.test(message)) {
    return { action: "accept", reason: "known_bi_save_create_report_confirm", requiresRecovery: false };
  }
  if (sequence === 1 && type === "alert") {
    return { action: "accept", reason: "first_save_alert_after_tool_bridge_approval", requiresRecovery: false };
  }
  return { action: "dismiss", reason: "unknown_native_dialog_dismissed_for_recovery", requiresRecovery: true };
};

type SaveReportObservedResult = {
  nameInputEvidence: Record<string, unknown> | null;
  saveModalProfile: UiDomProfileRef;
  saveModalAfterFillProfile: UiDomProfileRef | null;
};

const saveReport = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  if (!options.approvedToolRequestId) return approvalRequired(options, "save current temporary report", startedAt);
  const overwriteExisting = options.params.overwriteExisting === true;
  const existingReportName = overwriteExisting ? readSavedReportName(options) : null;
  const reportName = existingReportName ?? resolveReportName(options);
  const dialogs: Record<string, unknown>[] = [];
  let dialogChainRequiresApproval = false;
  const uiProfileBefore = await captureUiDomProfile(options, page, "saveReport.before");
  const dialogHandler = async (dialog: Dialog) => {
    const sequence = dialogs.length + 1;
    const record: Record<string, unknown> = {
      sequence,
      type: dialog.type(),
      message: dialog.message(),
      defaultValue: dialog.defaultValue()
    };
    const handling = decideSaveDialogHandling(record, sequence);
    record.handledAction = handling.action;
    record.handledReason = handling.reason;
    dialogs.push(record);
    if (handling.requiresRecovery) dialogChainRequiresApproval = true;
    try {
      if (handling.action === "accept") {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
      record.handledAt = new Date().toISOString();
    } catch (error) {
      record.handledError = error instanceof Error ? error.message : String(error);
      dialogChainRequiresApproval = true;
    }
  };
  page.on("dialog", dialogHandler);
  let observed: { result: SaveReportObservedResult; requests: Record<string, unknown>[]; responses: Record<string, unknown>[] } | null = null;
  try {
    observed = await withTimeout(
      observeDuring(page, async (): Promise<SaveReportObservedResult> => {
        await page.getByText("儲存報表", { exact: false }).first().click({ timeout: 15000 });
        await page.waitForTimeout(600);
        const saveModalProfile = await captureUiDomProfile(options, page, "saveReport.modalOpened");
        let nameInputEvidence: Record<string, unknown> | null = null;
        let saveModalAfterFillProfile: UiDomProfileRef | null = null;
        try {
          nameInputEvidence = await fillVisibleReportNameInput(page, reportName);
          saveModalAfterFillProfile = await captureUiDomProfile(options, page, "saveReport.modalAfterFill");
          await withTimeout(clickModalSaveButton(page), 20000, "SAVE_MODAL_SUBMIT_TIMEOUT");
        } catch (error) {
          if (!overwriteExisting) throw error;
          const dialogButtonClicked = await clickDialogOnlySaveButton(page).catch(() => false);
          nameInputEvidence = {
            skipped: true,
            reason: "REPORT_NAME_INPUT_NOT_PRESENT_FOR_OVERWRITE_FLOW",
            dialogButtonClicked,
            error: error instanceof Error ? error.message : String(error)
          };
        }
        await page.waitForTimeout(1800);
        return { nameInputEvidence, saveModalProfile, saveModalAfterFillProfile };
      }),
      45000,
      "SAVE_REPORT_FLOW_TIMEOUT"
    );
  } finally {
    page.off("dialog", dialogHandler);
  }
  if (!observed) throw new HelperBlockedError("SAVE_REPORT_FLOW_DID_NOT_COMPLETE");
  writeSavedReportState(options, reportName, { approvedToolRequestId: options.approvedToolRequestId, dialogs });
  if (dialogChainRequiresApproval) {
    const uiProfileAfterDialog = await captureUiDomProfile(options, page, "saveReport.dialogChain");
    return createReport(
      options,
      "blocked",
      startedAt,
      {
        reportName,
        dialogs,
        uiProfiles: {
          before: uiProfileBefore,
          modalOpened: observed.result.saveModalProfile,
          modalAfterFill: observed.result.saveModalAfterFillProfile,
          dialogChain: uiProfileAfterDialog
        },
        network: { requests: observed.requests, responses: observed.responses },
        nameInput: observed.result.nameInputEvidence
      },
      {},
      ["NATIVE_DIALOG_CHAIN_BLOCKED", "UNKNOWN_NATIVE_DIALOG_NO_RECOVERY_HANDLER"]
    );
  }
  const shot = await screenshot(options, page, "save-report");
  const uiProfileAfter = await captureUiDomProfile(options, page, "saveReport.after");
  return createReport(
    options,
    "ok",
    startedAt,
    {
      domState: await readDomState(page),
      uiProfiles: {
        before: uiProfileBefore,
        modalOpened: observed.result.saveModalProfile,
        modalAfterFill: observed.result.saveModalAfterFillProfile,
        after: uiProfileAfter
      },
      dialogs,
      approvedToolRequestId: options.approvedToolRequestId,
      reportName,
      network: { requests: observed.requests, responses: observed.responses },
      nameInput: observed.result.nameInputEvidence
    },
    shot ? { screenshot: shot } : {},
    shot ? [] : ["SCREENSHOT_UNAVAILABLE"]
  );
};

const reopenReport = async (options: CliOptions, page: Page, startedAt: string): Promise<HelperReport> => {
  const reportName = readSavedReportName(options);
  const projectName = stringParam(options.params, "projectName");
  if (!reportName) throw new HelperBlockedError("SAVED_REPORT_NAME_MISSING");
  const uiProfileBefore = await captureUiDomProfile(options, page, "reopenReport.before");
  const stateBefore = await readStateDelta(page, options.params).catch((error) => ({
    readError: error instanceof Error ? error.message : String(error)
  }));
  const beforeText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (!beforeText.includes(reportName) && projectName) {
    await clickByText(page, projectName, 8000);
    await page.waitForTimeout(1200);
  }
  const refreshedText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (!refreshedText.includes(reportName)) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    if (projectName) {
      await clickByText(page, projectName, 8000).catch(() => undefined);
      await page.waitForTimeout(800);
    }
  }
  const finalListText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (!finalListText.includes(reportName)) {
    throw new HelperBlockedError(`SAVED_REPORT_ROW_NOT_FOUND:${reportName}`);
  }
  const observed = await observeDuring(page, async () => {
    await clickByText(page, reportName, 12000);
    const settle = await waitForReportEditorSettle(page);
    await page.waitForTimeout(400);
    return settle;
  });
  const shot = await screenshot(options, page, "reopen-report");
  const uiProfile = await captureUiDomProfile(options, page, "reopenReport.after");
  const domState = await readDomState(page);
  const stateAfter = await readStateDelta(page, options.params).catch((error) => ({
    readError: error instanceof Error ? error.message : String(error)
  }));
  const evidence = {
    caseNo: options.caseId,
    reportName,
    expected: {
      field: stringParam(options.params, "field"),
      dateRange: stringParam(options.params, "dateRange"),
      display: stringParam(options.params, "display")
    },
    settle: observed.result,
    domState,
    stateDelta: {
      before: stateBefore,
      after: stateAfter
    },
    network: {
      requests: observed.requests,
      responses: observed.responses
    }
  };
  const evidencePath = path.join(artifactRoot(options), "reopen-report-evidence.json");
  ensureDir(path.dirname(evidencePath));
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  const warnings = observed.result.status === "settled" ? [] : ["REOPEN_REPORT_SETTLE_TIMEOUT"];
  return createReport(
    options,
    observed.result.status === "settled" ? "ok" : "blocked",
    startedAt,
    {
      reportName,
      domState,
      uiProfiles: { before: uiProfileBefore, after: uiProfile },
      reopenReportEvidence: evidence
    },
    { ...(shot ? { screenshot: shot } : {}), reopenReportEvidence: evidencePath },
    shot ? warnings : [...warnings, "SCREENSHOT_UNAVAILABLE"]
  );
};

const notImplemented = async (options: CliOptions, page: Page, reason: string, startedAt: string): Promise<HelperReport> => {
  const shot = await screenshot(options, page, sanitize(options.action));
  const uiProfile = await captureUiDomProfile(options, page, `${sanitize(options.action)}.notImplemented`);
  return createReport(
    options,
    "not_implemented",
    startedAt,
    { domState: await readDomState(page), uiProfile, reason },
    shot ? { screenshot: shot } : {},
    ["HELPER_TEMPLATE_NOT_IMPLEMENTED_IN_V1"]
  );
};

const run = async (): Promise<void> => {
  const options = parseArgs();
  const startedAt = new Date().toISOString();
  const config = readConfig();

  let browser: Browser | null = null;
  let page: Page | null = null;
  let runtimeEvidence: BrowserSessionRuntimeEvidence | null = null;
  let report: HelperReport;
  try {
    const endpoint = await ensureChromeDebugSession(config, null, {
      resetTabs: false,
      openInitialUrl: false
    });
    if (!endpoint) {
      const diagnostics = await diagnoseChromeDebugSession(config);
      report = createReport(
        options,
        "error",
        startedAt,
        { reason: "CHROME_CDP_UNAVAILABLE", cdpDiagnostics: diagnostics },
        {},
        ["HELPER_CDP_DIAGNOSTICS_CAPTURED"],
        { error: "CHROME_CDP_UNAVAILABLE" }
      );
      writeReport(options, report);
      console.error(JSON.stringify(report, null, 2));
      process.exitCode = 1;
      return;
    }
    browser = await chromium.connectOverCDP(endpoint);
    const resolved = await resolveBrowserSessionPage(options, browser);
    page = resolved.page;
    runtimeEvidence = resolved.runtimeEvidence;
    if (options.action !== "collage.openProject" && !isApplicationPage(page)) {
      throw new HelperBlockedError(`GALAXY_PAGE_NOT_FOUND_FOR_HELPER_ACTION:url=${page.url() || "blank"}`);
    }
    switch (options.action) {
      case "collage.openProject":
        report = await openProject(options, page, startedAt);
        break;
      case "collage.createReport":
        report = await createCollageReport(options, page, startedAt);
        break;
      case "collage.openExistingReport":
        report = await openExistingReport(options, page, startedAt);
        break;
      case "collage.configureMetric":
        report = await configureMetric(options, page, startedAt);
        break;
      case "collage.runPreviewAndCollectEvidence":
        report = await runPreview(options, page, startedAt);
        break;
      case "collage.extractMetadataDropdownFields":
        report = await extractMetadataDropdownFields(options, page, startedAt);
        break;
      case "collage.saveReport":
        report = await saveReport(options, page, startedAt);
        break;
      case "collage.reopenReport":
        report = await reopenReport(options, page, startedAt);
        break;
      case "collage.downloadCsvAndComparePreview":
        report = await downloadCsvAndComparePreview(options, page, startedAt);
        break;
      case "collage.deleteTemporaryReport":
        report = options.approvedToolRequestId
          ? await notImplemented(options, page, "Template is registered but not implemented in this executor version.", startedAt)
          : approvalRequired(options, options.action, startedAt);
        break;
      case "filter.addAndPreview":
      case "group.addAndPreview":
        report = await notImplemented(options, page, "Filter/group helpers are not implemented for trusted Agent runs. Capability gate should mark these cases unsupported.", startedAt);
        break;
      default:
        report = await notImplemented(options, page, `Unknown helper action: ${options.action}`, startedAt);
        break;
    }
    report = attachBrowserSessionEvidence(report, runtimeEvidence);
    writeReport(options, report);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const isBlocked = error instanceof HelperBlockedError || isActionabilityFailure(error);
    const shot = page ? await screenshot(options, page, isBlocked ? "blocked" : "error") : null;
    const evidence: Record<string, unknown> = {
      reason: error instanceof HelperBlockedError
        ? error.reason
        : isBlocked
          ? `VISIBLE_UI_ACTION_BLOCKED: ${error instanceof Error ? error.message : String(error)}`
          : error instanceof Error
            ? error.message
            : String(error)
    };
    if (page) {
      evidence.domState = await readDomState(page).catch((domError) => ({
        readError: domError instanceof Error ? domError.message : String(domError)
      }));
      evidence.uiProfile = await captureUiDomProfile(options, page, isBlocked ? "blocked" : "error");
    }
    report = createReport(
      options,
      isBlocked ? "blocked" : "error",
      startedAt,
      evidence,
      shot ? { screenshot: shot } : {},
      shot ? [] : ["SCREENSHOT_UNAVAILABLE"],
      {
        error: error instanceof Error ? error.stack ?? error.message : String(error)
      }
    );
    report = attachBrowserSessionEvidence(report, runtimeEvidence);
    writeReport(options, report);
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    if (options.closeAfter) {
      if (browser) await browser.close().catch(() => undefined);
      await closeChromeDebugSession(config).catch(() => undefined);
    } else if (browser) {
      const connection = (browser as unknown as { _connection?: { close?: () => void } })._connection;
      connection?.close?.();
    }
  }
};

void run().then(() => {
  process.exit(process.exitCode ?? 0);
});
