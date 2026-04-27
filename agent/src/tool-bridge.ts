export type ToolRequestParseWarning = {
  code: string;
  message: string;
  raw?: string;
};

export type ParsedToolRequest = {
  data: unknown;
  valid: boolean;
  warnings: ToolRequestParseWarning[];
  raw: string;
};

export type ToolRequestParseResult = {
  requests: ParsedToolRequest[];
  warnings: ToolRequestParseWarning[];
};

export const stripAnsi = (input: string): string => {
  return input.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
};

export const normalizeToolRequestJson = (raw: string): string => {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch?.[1]?.trim() ?? trimmed;
};

const getRequestId = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const maybe = value as { request_id?: unknown };
  return typeof maybe.request_id === "string" ? maybe.request_id : undefined;
};

const validateString = (value: Record<string, unknown>, key: string, warnings: ToolRequestParseWarning[]): void => {
  if (typeof value[key] !== "string" || !value[key]) {
    warnings.push({
      code: `MISSING_${key.toUpperCase()}`,
      message: `Missing ${key}.`
    });
  }
};

export const validateToolRequest = (
  value: unknown
): { valid: boolean; warnings: ToolRequestParseWarning[] } => {
  const warnings: ToolRequestParseWarning[] = [];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      valid: false,
      warnings: [{ code: "NOT_OBJECT", message: "Tool request must be a JSON object." }]
    };
  }

  const request = value as Record<string, unknown>;
  validateString(request, "type", warnings);
  validateString(request, "request_id", warnings);

  if (request.type === "irreversible_operation") {
    validateString(request, "case", warnings);
    validateString(request, "action", warnings);
    validateString(request, "reason", warnings);
  } else if (request.type === "ambiguity_decision") {
    validateString(request, "case", warnings);
    validateString(request, "context", warnings);
    validateString(request, "recommendation", warnings);
    if (!Array.isArray(request.options) || request.options.length < 2) {
      warnings.push({
        code: "INVALID_OPTIONS",
        message: "options must contain at least two choices."
      });
    }
  } else if (request.type === "playwright_recovery") {
    validateString(request, "error", warnings);
    validateString(request, "proposed_action", warnings);
  } else if (typeof request.type === "string") {
    warnings.push({
      code: "UNKNOWN_TYPE",
      message: `Unknown type: ${request.type}`
    });
  }

  return {
    valid: warnings.length === 0,
    warnings
  };
};

export const parseToolRequests = (input: string): ToolRequestParseResult => {
  const text = stripAnsi(input);
  const requests: ParsedToolRequest[] = [];
  const warnings: ToolRequestParseWarning[] = [];
  const seenIds = new Set<string>();
  const pattern = /\[TOOL_REQUEST\]\s*([\s\S]*?)\s*\[\/TOOL_REQUEST\]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1]?.trim() ?? "";
    const jsonText = normalizeToolRequestJson(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (error) {
      warnings.push({
        code: "INVALID_JSON",
        message: String(error),
        raw
      });
      continue;
    }

    const validation = validateToolRequest(parsed);
    const requestId = getRequestId(parsed);
    if (requestId && seenIds.has(requestId)) {
      validation.warnings.push({
        code: "DUPLICATE_REQUEST_ID",
        message: `Duplicate request_id: ${requestId}`
      });
      validation.valid = false;
    }
    if (requestId) seenIds.add(requestId);

    requests.push({
      data: parsed,
      valid: validation.valid,
      warnings: validation.warnings,
      raw
    });
  }

  if (text.includes("[TOOL_REQUEST]") && !text.includes("[/TOOL_REQUEST]")) {
    warnings.push({
      code: "TRUNCATED_REQUEST",
      message: "Found opening [TOOL_REQUEST] without closing [/TOOL_REQUEST]."
    });
  }

  return { requests, warnings };
};
