export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }
    current += char;
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }
  return rows.filter((item) => item.some((cell) => cell.trim().length > 0));
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

const comparableDateKey = (value: unknown): string | null => {
  const normalized = normalizeComparableCell(value);
  const dashed = normalized.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (dashed) return `${dashed[1]}-${dashed[2].padStart(2, "0")}-${dashed[3].padStart(2, "0")}`;
  const slashed = normalized.match(/\b(\d{4})\/(\d{1,2})\/(\d{1,2})\b/);
  if (slashed) return `${slashed[1]}-${slashed[2].padStart(2, "0")}-${slashed[3].padStart(2, "0")}`;
  return null;
};

const normalizeComparableHeader = (value: unknown): string => {
  const normalized = normalizeComparableCell(value)
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
  if (normalized === "date" || normalized === "日期") return "date";
  return normalized;
};

const comparableHeadersEqual = (actual: unknown, expected: unknown): boolean =>
  normalizeComparableHeader(actual) === normalizeComparableHeader(expected);

const tableRowLooksLikeHeader = (row: string[], header: string[]): boolean =>
  header.length > 0
    && row.length >= header.length
    && header.every((expected, index) => comparableHeadersEqual(row[index], expected));

const tableRowsFromPreview = (preview: Record<string, unknown> | null): { header: string[]; rows: string[][] } | null => {
  const table = preview?.table && typeof preview.table === "object" && !Array.isArray(preview.table) ? preview.table as Record<string, unknown> : null;
  if (!table) return null;
  const header = Array.isArray(table.header) ? table.header.map((item) => normalizeComparableCell(item)) : [];
  const rawRows = Array.isArray(table.rows)
    ? table.rows.flatMap((row) => Array.isArray(row) ? [row.map((cell) => normalizeComparableCell(cell))] : [])
    : [];
  const rows = rawRows.length > 0 && tableRowLooksLikeHeader(rawRows[0] ?? [], header) ? rawRows.slice(1) : rawRows;
  if (header.length === 0 && rows.length === 0) return null;
  return { header, rows };
};

type PreviewMatrixMismatch = {
  rowIndex: number;
  dateKey: string | null;
  actual: number | null;
  expected: number | null;
  reason: string;
};

const compareDateRowsToPreviewMetricMatrix = (
  csvHeader: string[],
  csvRows: string[][],
  numericColumns: Array<{ columnIndex: number; header: string; values: number[]; summary: Record<string, unknown> | null }>,
  previewTable: { header: string[]; rows: string[][] } | null
): Record<string, unknown> | null => {
  if (!previewTable || csvRows.length === 0 || numericColumns.length === 0) return null;
  const dateColumnIndex = csvHeader.findIndex((header) => normalizeComparableHeader(header) === "date");
  const csvDateIndex = dateColumnIndex >= 0 ? dateColumnIndex : csvRows.every((row) => comparableDateKey(row[0]) !== null) ? 0 : -1;
  if (csvDateIndex < 0) return null;
  const previewDateColumns = previewTable.header.flatMap((header, index) => {
    const dateKey = comparableDateKey(header);
    return dateKey ? [{ index, dateKey }] : [];
  });
  if (previewDateColumns.length === 0) return null;

  const matrixMatches = numericColumns.flatMap((column) => {
    if (column.columnIndex === csvDateIndex) return [];
    const previewRow = previewTable.rows.find((row) => comparableHeadersEqual(row[0], column.header))
      ?? (numericColumns.length === 1 && previewTable.rows.length === 1 ? previewTable.rows[0] : null);
    if (!previewRow) return [];
    const previewValues = new Map<string, number>();
    for (const item of previewDateColumns) {
      const value = comparableNumber(previewRow[item.index]);
      if (value !== null) previewValues.set(item.dateKey, value);
    }
    const mismatches: PreviewMatrixMismatch[] = csvRows.flatMap((row, rowIndex): PreviewMatrixMismatch[] => {
      const dateKey = comparableDateKey(row[csvDateIndex]);
      const actual = comparableNumber(row[column.columnIndex]);
      if (!dateKey || actual === null) return [{ rowIndex, dateKey, actual, expected: null, reason: "csv_date_or_value_unreadable" }];
      const expected = previewValues.get(dateKey);
      if (expected === undefined) return [{ rowIndex, dateKey, actual, expected: null, reason: "preview_date_missing" }];
      return approxEqual(actual, expected) ? [] : [{ rowIndex, dateKey, actual, expected, reason: "value_mismatch" }];
    });
    const csvSum = column.values.reduce((total, value) => total + value, 0);
    const previewTotal = comparableNumber(previewRow[1]);
    const rowCountMatches = csvRows.length === previewValues.size;
    const totalMatches = previewTotal === null || approxEqual(csvSum, previewTotal);
    return [{
      csvColumnIndex: column.columnIndex,
      csvHeader: column.header,
      previewRowLabel: previewRow[0] ?? null,
      csvDateCount: csvRows.length,
      previewDateCount: previewValues.size,
      rowCountMatches,
      totalMatches,
      mismatches: mismatches.slice(0, 20),
      mismatchCount: mismatches.length,
      matched: rowCountMatches && totalMatches && mismatches.length === 0
    }];
  });
  if (matrixMatches.length === 0) return null;
  return {
    format: "csv-date-rows-vs-preview-metric-matrix",
    dateColumnIndex: csvDateIndex,
    previewDateColumnCount: previewDateColumns.length,
    matches: matrixMatches,
    matched: matrixMatches.some((item) => item.matched === true)
  };
};

export const summarizeCsvAgainstPreview = (csvText: string, preview: Record<string, unknown> | null): Record<string, unknown> => {
  const rows = parseCsv(csvText);
  const header = (rows[0] ?? []).map((cell) => normalizeComparableCell(cell));
  const dataRows = rows.slice(1).map((row) => row.map((cell) => normalizeComparableCell(cell))).filter((row) => row.some((cell) => cell.trim().length > 0));
  const numericColumns = header.map((_header, columnIndex) => {
    const values = dataRows.map((row) => Number(String(row[columnIndex] ?? "").replace(/,/g, ""))).filter(Number.isFinite);
    return { columnIndex, header: header[columnIndex] ?? `column_${columnIndex}`, values, summary: numericSummary(values) };
  }).filter((item) => item.values.length > 0);
  const previewSeries = chartSeriesFromPreview(preview);
  const previewTable = tableRowsFromPreview(preview);
  const previewMatrixComparison = compareDateRowsToPreviewMetricMatrix(header, dataRows, numericColumns, previewTable);
  const previewMatrixMatched = previewMatrixComparison?.matched === true;
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
    : previewMatrixMatched
      ? true
    : previewTable.header.every((expected, index) => comparableHeadersEqual(header[index], expected));
  const tableRowsMatched = previewTable === null
    ? null
    : previewMatrixMatched
      ? true
    : dataRows.length === previewTable.rows.length
      && previewTable.rows.every((expectedRow, rowIndex) => {
        const actualRow = dataRows[rowIndex] ?? [];
        return expectedRow.every((expectedCell, cellIndex) => comparableCellsEqual(actualRow[cellIndex], expectedCell));
      });
  const rowCountMatchesPreview = previewSeries.labelCount !== null
    ? dataRows.length === previewSeries.labelCount
    : previewMatrixMatched
      ? true
    : previewTable !== null
      ? dataRows.length === previewTable.rows.length
      : null;
  const allSeriesMatched = comparisons.length > 0
    ? comparisons.every((item) => item.matchedCsvColumn !== null)
    : previewMatrixMatched
      ? true
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
    previewMatrixComparison,
    checks: {
      rowCountMatchesPreview,
      allSeriesMatched,
      tableHeaderMatches,
      tableRowsMatched
    }
  };
};
