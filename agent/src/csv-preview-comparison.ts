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
    : previewTable.header.every((expected, index) => comparableHeadersEqual(header[index], expected));
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
