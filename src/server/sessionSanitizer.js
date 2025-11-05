const PLACEHOLDER_CELL_PATTERN = /^[\-\u2013\u2014]+$/;
const MAX_TABLE_HEADERS = 40;
const MAX_TABLE_ROWS = 200;
const MAX_LABEL_LENGTH = 120;
const MAX_CELL_LENGTH = 2000;

function isPlaceholderValue(value) {
  const normalized = String(value ?? '').replace(/\s+/g, '');
  if (!normalized.length) return true;
  return PLACEHOLDER_CELL_PATTERN.test(normalized);
}

function isPlaceholderRow(row) {
  if (Array.isArray(row)) {
    if (!row.length) return true;
    return row.every(isPlaceholderValue);
  }
  if (row && typeof row === 'object') {
    const values = Object.values(row);
    if (!values.length) return true;
    return values.every(isPlaceholderValue);
  }
  return isPlaceholderValue(row);
}

function normalizeTableRows(rows) {
  if (!Array.isArray(rows)) {
    return { rows: null, removed: false };
  }
  const cleaned = rows.filter((row) => !isPlaceholderRow(row));
  return {
    rows: cleaned,
    removed: cleaned.length !== rows.length
  };
}

function sanitizeTableCell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.length > MAX_CELL_LENGTH) {
    return str.slice(0, MAX_CELL_LENGTH) + '...';
  }
  return str;
}

function sanitizeHeaders(rawHeaders) {
  if (!Array.isArray(rawHeaders)) return [];
  return rawHeaders
    .slice(0, MAX_TABLE_HEADERS)
    .map((header) => {
      if (header === null || header === undefined) return '';
      return String(header).trim().slice(0, MAX_LABEL_LENGTH);
    })
    .filter((header) => header.length);
}

function sanitizeTableRow(row, headers) {
  if (Array.isArray(row)) {
    return row
      .slice(0, MAX_TABLE_HEADERS)
      .map((cell) => sanitizeTableCell(cell));
  }

  if (row && typeof row === 'object') {
    const result = {};
    const keys = Array.isArray(headers) && headers.length
      ? headers
      : Object.keys(row).slice(0, MAX_TABLE_HEADERS);
    keys.forEach((key) => {
      if (!key) return;
      result[key] = sanitizeTableCell(row[key]);
    });
    return result;
  }

  return sanitizeTableCell(row);
}

function sanitizeLabel(rawLabel, index) {
  if (typeof rawLabel === 'string' && rawLabel.trim()) {
    return rawLabel.trim().slice(0, MAX_LABEL_LENGTH);
  }
  return `table-${index + 1}`;
}

function sanitizeChartType(raw) {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim();
  if (!normalized) return null;
  return normalized.toLowerCase();
}

function sanitizeBotTables(rawTables, { rowLimit = MAX_TABLE_ROWS } = {}) {
  if (!Array.isArray(rawTables)) return [];
  const tables = [];
  rawTables.forEach((table, index) => {
    if (!table || typeof table !== 'object') return;
    const rawRows = Array.isArray(table.rows) ? table.rows : null;
    const { rows: cleanedRows } = normalizeTableRows(rawRows);
    if (rawRows && Array.isArray(cleanedRows) && cleanedRows.length === 0) {
      return;
    }
    const rowsSource = Array.isArray(cleanedRows) && cleanedRows.length
      ? cleanedRows
      : rawRows;

    const limit = Number.isFinite(rowLimit) && rowLimit > 0 ? rowLimit : 0;
    const limitedRows = Array.isArray(rowsSource) && limit
      ? rowsSource.slice(0, limit)
      : (Array.isArray(rowsSource) ? rowsSource : []);
    const rowsTruncated = Boolean(
      Array.isArray(rowsSource) &&
      limit &&
      rowsSource.length > limitedRows.length
    );

    const headers = sanitizeHeaders(table.headers);
    const sanitizedRows = limitedRows.map((row) => sanitizeTableRow(row, headers));

    if (rowsSource && !sanitizedRows.length && !headers.length) {
      return;
    }

    const label = sanitizeLabel(table.label, index);
    const totalRows = Number.isFinite(table.totalRows)
      ? table.totalRows
      : (Array.isArray(rowsSource) ? rowsSource.length : sanitizedRows.length);
    const csv = typeof table.csv === 'string' ? table.csv : null;
    const chartType = sanitizeChartType(table.chartType);

    const meta = {
      label,
      headers,
      rows: sanitizedRows,
      rowsTruncated,
      totalRows,
      csv: csv || undefined,
      chartType: chartType || undefined
    };

    if (limit) {
      meta.limit = limit;
      meta.maxRows = limit;
    }

    tables.push(meta);
  });
  return tables;
}

function sanitizeTableSummary(summary) {
  if (!Array.isArray(summary)) return [];
  const sanitized = [];
  summary.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    if (Number.isFinite(item.totalRows)) {
      sanitized.push({ totalRows: item.totalRows });
    }
  });
  return sanitized;
}

function buildTableSummaryFromData(tableData) {
  if (!Array.isArray(tableData)) return [];
  return tableData.map((table) => ({
    totalRows: Number.isFinite(table && table.totalRows)
      ? table.totalRows
      : (Array.isArray(table && table.rows) ? table.rows.length : 0)
  }));
}

function sanitizeTableData(tableData) {
  if (!Array.isArray(tableData)) return [];
  return tableData.map((table, index) => {
    if (!table || typeof table !== 'object') return null;
    const headers = sanitizeHeaders(table.headers);
    const rows = Array.isArray(table.rows)
      ? table.rows.slice(0, MAX_TABLE_ROWS).map((row) => sanitizeTableRow(row, headers))
      : [];
    return {
      label: sanitizeLabel(table.label, index),
      headers,
      rows,
      rowsTruncated: Boolean(table.rowsTruncated),
      totalRows: Number.isFinite(table.totalRows) ? table.totalRows : rows.length,
      csv: typeof table.csv === 'string' ? table.csv : undefined,
      chartType: sanitizeChartType(table.chartType) || undefined,
      limit: Number.isFinite(table.limit) ? table.limit : undefined,
      maxRows: Number.isFinite(table.maxRows) ? table.maxRows : undefined
    };
  }).filter(Boolean);
}

function sanitizeMessageRecord(row) {
  if (!row || typeof row !== 'object') return null;
  const tableSummary = sanitizeTableSummary(row.tableSummary);
  const tableData = sanitizeTableData(row.tableData);
  const timeValue = Number.isFinite(row.time) ? Number(row.time) : Date.now();
  return {
    id: String(row.id),
    role: row.role === 'user' ? 'user' : 'bot',
    text: typeof row.text === 'string' ? row.text : '',
    time: timeValue,
    tableSummary,
    tableData
  };
}

module.exports = {
  sanitizeBotTables,
  sanitizeTableSummary,
  sanitizeTableData,
  buildTableSummaryFromData,
  sanitizeMessageRecord,
  constants: {
    MAX_TABLE_ROWS
  }
};
