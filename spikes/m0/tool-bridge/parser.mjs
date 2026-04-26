export function stripAnsi(input) {
  return String(input || "").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

export function parseToolRequests(input) {
  const text = stripAnsi(input);
  const requests = [];
  const warnings = [];
  const seenIds = new Set();
  const pattern = /\[TOOL_REQUEST\]\s*([\s\S]*?)\s*\[\/TOOL_REQUEST\]/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const rawJson = match[1].trim();
    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch (error) {
      warnings.push({
        code: "INVALID_JSON",
        message: String(error),
        raw: rawJson
      });
      continue;
    }

    const validation = validateToolRequest(parsed);
    if (seenIds.has(parsed.request_id)) {
      validation.warnings.push({
        code: "DUPLICATE_REQUEST_ID",
        message: `Duplicate request_id: ${parsed.request_id}`
      });
    }
    if (parsed.request_id) seenIds.add(parsed.request_id);

    requests.push({
      data: parsed,
      valid: validation.valid,
      warnings: validation.warnings,
      raw: rawJson
    });
  }

  if (text.includes("[TOOL_REQUEST]") && !text.includes("[/TOOL_REQUEST]")) {
    warnings.push({
      code: "TRUNCATED_REQUEST",
      message: "Found opening [TOOL_REQUEST] without closing [/TOOL_REQUEST]."
    });
  }

  return { requests, warnings };
}

export function validateToolRequest(request) {
  const warnings = [];

  if (!request || typeof request !== "object" || Array.isArray(request)) {
    warnings.push({ code: "NOT_OBJECT", message: "Tool request must be a JSON object." });
    return { valid: false, warnings };
  }

  if (!request.type) warnings.push({ code: "MISSING_TYPE", message: "Missing type." });
  if (!request.request_id) warnings.push({ code: "MISSING_REQUEST_ID", message: "Missing request_id." });

  if (request.type === "irreversible_operation") {
    for (const key of ["case", "action", "reason"]) {
      if (!request[key]) warnings.push({ code: `MISSING_${key.toUpperCase()}`, message: `Missing ${key}.` });
    }
  } else if (request.type === "ambiguity_decision") {
    for (const key of ["case", "context", "options", "recommendation"]) {
      if (!request[key]) warnings.push({ code: `MISSING_${key.toUpperCase()}`, message: `Missing ${key}.` });
    }
    if (request.options && (!Array.isArray(request.options) || request.options.length < 2)) {
      warnings.push({ code: "INVALID_OPTIONS", message: "options must contain at least two choices." });
    }
  } else if (request.type === "playwright_recovery") {
    for (const key of ["error", "proposed_action"]) {
      if (!request[key]) warnings.push({ code: `MISSING_${key.toUpperCase()}`, message: `Missing ${key}.` });
    }
  } else if (request.type) {
    warnings.push({ code: "UNKNOWN_TYPE", message: `Unknown type: ${request.type}` });
  }

  return { valid: warnings.length === 0, warnings };
}
