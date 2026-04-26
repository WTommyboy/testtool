export type ParsedDetailJson = {
  detailJson: Record<string, unknown> | null;
  detailJsonRaw: string | null;
  detailParseError: string | null;
};

export const parseDetailJson = (raw: string): ParsedDetailJson => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      detailJson: null,
      detailJsonRaw: null,
      detailParseError: null
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        detailJson: null,
        detailJsonRaw: trimmed,
        detailParseError: "NOT_OBJECT"
      };
    }
    return {
      detailJson: parsed as Record<string, unknown>,
      detailJsonRaw: trimmed,
      detailParseError: null
    };
  } catch (error) {
    return {
      detailJson: null,
      detailJsonRaw: trimmed,
      detailParseError: String(error)
    };
  }
};
