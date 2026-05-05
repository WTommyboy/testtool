export type DateUiRangeEvidence = {
  source: "dateRangeButtonText" | "dateRangeDisplayText" | "popupText" | "bodyText";
  label: string | null;
  startIso: string;
  endIso: string;
  display: string;
  rawText: string;
};

export type DateUiComputedRange = {
  label: string;
  startIso: string;
  endIso: string;
  display: string;
  basis: "static_range" | "preset";
  baseDate: string | null;
  assumptions: string[];
};

export type DateUiEvidence = {
  schemaVersion: "date-ui-evidence-v1";
  generatedAt: string;
  requested: {
    raw: string | null;
    normalizedLabel: string | null;
    baseDate: string | null;
    baseDateSource: "params" | "system_local_date" | null;
  };
  observed: {
    dateRangeButtonText: string | null;
    dateRangeDisplayText: string | null;
    popupVisible: boolean | null;
    popupTextExcerpt: string | null;
    bodyTextExcerpt: string | null;
  };
  representedRanges: DateUiRangeEvidence[];
  requestedRange: DateUiComputedRange | null;
  matchedRepresentedRange: DateUiRangeEvidence | null;
  checks: {
    requestedLabelVisible: boolean | null;
    staticRequestedRangeObserved: boolean | null;
    representedRangeMatchesRequested: boolean | null;
  };
  warnings: string[];
  policy: string;
};

type DateUiEvidenceInput = {
  requested?: string | null;
  baseDate?: string | null;
  generatedAt?: string;
  observed: {
    dateRangeButtonText?: string | null;
    dateRangeDisplayText?: string | null;
    popupVisible?: boolean | null;
    popupText?: string | null;
    bodyText?: string | null;
  };
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

const truncate = (value: string | null | undefined, length: number): string | null => {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  return normalized.length > length ? `${normalized.slice(0, length)}...` : normalized;
};

const localDateIso = (date = new Date()): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const parseIsoDate = (value: string | null | undefined): Date | null => {
  const match = (value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return date;
};

const dateToIso = (date: Date): string =>
  `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const startOfSundayWeek = (date: Date): Date => {
  const day = date.getUTCDay();
  return addDays(date, -day);
};

const firstDayOfMonth = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

const lastDayOfPreviousMonth = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0));

const displayRange = (startIso: string, endIso: string): string =>
  `${startIso.replaceAll("-", "/")} ~ ${endIso.replaceAll("-", "/")}`;

export const normalizeDatePresetLabel = (preset: string): string => {
  let normalized = preset.trim();
  normalized = normalized.replace(/\s*[（(]\s*(?:快捷|快捷起點|快捷訖點|快捷終點|半動態|動態|起點|終點)\s*[）)]\s*$/u, "");
  normalized = normalized.replace(/^(過去|最近)\s+(\d+)\s*天$/u, "$1$2天");
  return normalized.trim();
};

export const normalizeDateUiText = (value: string | null | undefined): string =>
  (value ?? "")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, "")
    .replaceAll("-", "/");

const toIsoFromMatch = (match: RegExpMatchArray): string => {
  const [, year, month, day] = match;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const staticDateRangeFromText = (value: string | null | undefined): DateUiComputedRange | null => {
  const text = value ?? "";
  const matches = [...text.matchAll(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/g)];
  if (matches.length < 2) return null;
  const startIso = toIsoFromMatch(matches[0]);
  const endIso = toIsoFromMatch(matches[1]);
  return {
    label: displayRange(startIso, endIso),
    startIso,
    endIso,
    display: displayRange(startIso, endIso),
    basis: "static_range",
    baseDate: null,
    assumptions: []
  };
};

export const computePresetDateRange = (preset: string, baseDateIso: string): DateUiComputedRange | null => {
  const label = normalizeDatePresetLabel(preset);
  const base = parseIsoDate(baseDateIso);
  if (!base) return null;
  const range = (start: Date, end: Date, assumptions: string[] = []): DateUiComputedRange => {
    const startIso = dateToIso(start);
    const endIso = dateToIso(end);
    return {
      label,
      startIso,
      endIso,
      display: displayRange(startIso, endIso),
      basis: "preset",
      baseDate: baseDateIso,
      assumptions
    };
  };

  if (label === "今日") return range(base, base);
  if (label === "昨日") return range(addDays(base, -1), addDays(base, -1));
  if (label === "本週") return range(startOfSundayWeek(base), base, ["週起始日以 Sunday 計算（週日~週六）"]);
  if (label === "上週") {
    const thisWeekStart = startOfSundayWeek(base);
    return range(addDays(thisWeekStart, -7), addDays(thisWeekStart, -1), ["週起始日以 Sunday 計算（週日~週六）"]);
  }
  if (label === "本月") return range(firstDayOfMonth(base), base);
  if (label === "上月") {
    const previousEnd = lastDayOfPreviousMonth(base);
    const previousStart = firstDayOfMonth(previousEnd);
    return range(previousStart, previousEnd);
  }

  const rolling = label.match(/^(過去|最近)(\d+)天$/u);
  if (rolling) {
    const presetKind = rolling[1];
    const days = Number(rolling[2]);
    if (!Number.isFinite(days) || days <= 0) return null;
    if (presetKind === "最近") {
      return range(addDays(base, -(days - 1)), base, ["最近 N 天包含今日（d-0）"]);
    }
    return range(addDays(base, -days), addDays(base, -1), ["過去 N 天不含今日（d-1 結束）"]);
  }

  return null;
};

const cleanupRangeLabel = (value: string): string | null => {
  const cleaned = value
    .replace(/日期範圍/g, "")
    .replace(/[(:：~～\-→至到年月日0-9/\\]+$/g, "")
    .replace(/^[\s:：,，;；|｜]+|[\s:：,，;；|｜]+$/g, "")
    .trim();
  if (!cleaned || cleaned.length > 40) return null;
  return cleaned;
};

const rangesFromSingleLine = (line: string, source: DateUiRangeEvidence["source"]): DateUiRangeEvidence[] => {
  const matches = [...line.matchAll(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/g)];
  const ranges: DateUiRangeEvidence[] = [];
  for (let index = 0; index < matches.length - 1; index += 1) {
    const first = matches[index];
    const second = matches[index + 1];
    if (first.index === undefined || second.index === undefined) continue;
    const between = line.slice(first.index + first[0].length, second.index);
    if (!/[~～→至到-]/.test(between) || between.length > 40) continue;
    const prefix = line.slice(0, first.index).replace(/[（(]\s*$/u, "");
    const label = cleanupRangeLabel(prefix);
    const startIso = toIsoFromMatch(first);
    const endIso = toIsoFromMatch(second);
    const rawStart = label ? Math.max(0, line.lastIndexOf(label, first.index)) : first.index;
    const rawText = line.slice(rawStart, second.index + second[0].length).trim();
    ranges.push({
      source,
      label,
      startIso,
      endIso,
      display: displayRange(startIso, endIso),
      rawText
    });
  }
  return ranges;
};

export const extractDateUiRanges = (
  text: string | null | undefined,
  source: DateUiRangeEvidence["source"] = "bodyText"
): DateUiRangeEvidence[] => {
  const value = text ?? "";
  if (!value.trim()) return [];
  const lines = value
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .flatMap((line) => line.split(/\s{2,}|\t+/))
    .map((line) => line.trim())
    .filter(Boolean);
  const ranges = lines.flatMap((line) => rangesFromSingleLine(line, source));
  const seen = new Set<string>();
  return ranges.filter((range) => {
    const key = `${range.source}:${range.label ?? ""}:${range.startIso}:${range.endIso}:${range.rawText}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const requestedLabelVisible = (requested: string | null, observedText: string): boolean | null => {
  if (!requested) return null;
  const staticRange = staticDateRangeFromText(requested);
  if (staticRange) {
    return normalizeDateUiText(observedText).includes(normalizeDateUiText(staticRange.display));
  }
  const label = normalizeDatePresetLabel(requested);
  return label ? normalizeDateUiText(observedText).includes(normalizeDateUiText(label)) : null;
};

const findMatchingRange = (
  ranges: DateUiRangeEvidence[],
  requestedRange: DateUiComputedRange | null,
  requestedLabel: string | null
): DateUiRangeEvidence | null => {
  if (requestedRange) {
    return ranges.find((range) => range.startIso === requestedRange.startIso && range.endIso === requestedRange.endIso) ?? null;
  }
  if (!requestedLabel) return null;
  return ranges.find((range) => range.label && normalizeDateUiText(range.label) === normalizeDateUiText(requestedLabel)) ?? null;
};

export const buildDateUiEvidence = (input: DateUiEvidenceInput): DateUiEvidence => {
  const requestedRaw = input.requested?.trim() || null;
  const normalizedLabel = requestedRaw ? normalizeDatePresetLabel(requestedRaw) : null;
  const explicitBaseDate = input.baseDate?.trim() || null;
  const baseDate = explicitBaseDate ?? (requestedRaw ? localDateIso() : null);
  const baseDateSource = explicitBaseDate ? "params" : requestedRaw ? "system_local_date" : null;
  const observedText = [
    input.observed.dateRangeButtonText,
    input.observed.dateRangeDisplayText,
    input.observed.popupText,
    input.observed.bodyText
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  const representedRanges = [
    ...extractDateUiRanges(input.observed.dateRangeButtonText, "dateRangeButtonText"),
    ...extractDateUiRanges(input.observed.dateRangeDisplayText, "dateRangeDisplayText"),
    ...extractDateUiRanges(input.observed.popupText, "popupText"),
    ...extractDateUiRanges(input.observed.bodyText, "bodyText")
  ];
  const staticRequested = staticDateRangeFromText(requestedRaw);
  const presetRequested = !staticRequested && normalizedLabel && baseDate ? computePresetDateRange(normalizedLabel, baseDate) : null;
  const requestedRange = staticRequested ?? presetRequested;
  const matchedRepresentedRange = findMatchingRange(representedRanges, requestedRange, normalizedLabel);
  const labelVisible = requestedLabelVisible(requestedRaw, observedText);
  const staticRequestedRangeObserved = staticRequested
    ? representedRanges.some((range) => range.startIso === staticRequested.startIso && range.endIso === staticRequested.endIso) || labelVisible === true
    : null;
  const representedRangeMatchesRequested = requestedRange
    ? matchedRepresentedRange
      ? true
      : representedRanges.length > 0
        ? false
        : null
    : null;
  const warnings: string[] = [];
  if (requestedRaw && !requestedRange && !normalizedLabel) warnings.push("DATE_UI_REQUESTED_VALUE_UNRECOGNIZED");
  if (requestedRaw && labelVisible === false) warnings.push("DATE_UI_REQUESTED_LABEL_NOT_VISIBLE");
  if (requestedRange && representedRangeMatchesRequested === false) warnings.push("DATE_UI_REPRESENTED_RANGE_MISMATCH");
  if (requestedRange && representedRangeMatchesRequested === null) warnings.push("DATE_UI_REPRESENTED_RANGE_NOT_VISIBLE");
  if (!input.observed.dateRangeButtonText && !input.observed.dateRangeDisplayText) warnings.push("DATE_UI_CONTROL_TEXT_NOT_FOUND");

  return {
    schemaVersion: "date-ui-evidence-v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    requested: {
      raw: requestedRaw,
      normalizedLabel,
      baseDate,
      baseDateSource
    },
    observed: {
      dateRangeButtonText: truncate(input.observed.dateRangeButtonText, 240),
      dateRangeDisplayText: truncate(input.observed.dateRangeDisplayText, 240),
      popupVisible: input.observed.popupVisible ?? null,
      popupTextExcerpt: truncate(input.observed.popupText, 1200),
      bodyTextExcerpt: truncate(input.observed.bodyText, 1800)
    },
    representedRanges,
    requestedRange,
    matchedRepresentedRange,
    checks: {
      requestedLabelVisible: labelVisible,
      staticRequestedRangeObserved,
      representedRangeMatchesRequested
    },
    warnings,
    policy: "Evidence records visible date control text and any visible represented ranges. Preset ranges may be computed from baseDate when Galaxy UI only exposes the preset label; Codex must state when a range is computed rather than directly visible."
  };
};
