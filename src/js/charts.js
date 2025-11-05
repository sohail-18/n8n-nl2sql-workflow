const chartRegistry = new Map();

const COLOR_PALETTE = [
  '#6366f1', '#f97316', '#10b981', '#ec4899', '#0ea5e9',
  '#facc15', '#a855f7', '#14b8a6', '#ef4444', '#8b5cf6'
];

const CHART_TYPE_MAP = {
  column: 'bar',
  bar: 'bar',
  histogram: 'bar',
  pie: 'pie',
  donut: 'doughnut',
  doughnut: 'doughnut',
  line: 'line',
  area: 'line'
};

function normalizeChartType(type) {
  if (!type) return null;
  const normalized = String(type).trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'table') return null;
  const mapped = CHART_TYPE_MAP[normalized] || normalized;
  if (mapped === 'doughnut' || mapped === 'pie' || mapped === 'bar' || mapped === 'line') {
    return mapped;
  }
  return null;
}

function inferHeaders(rows) {
  for (const row of rows) {
    if (!row) continue;
    if (Array.isArray(row)) {
      return row.map((_, idx) => `列${idx + 1}`);
    }
    if (typeof row === 'object') {
      const keys = Object.keys(row);
      if (keys.length) return keys;
    }
  }
  return [];
}

function normalizeRows(rows, headers) {
  const list = [];
  rows.forEach((row) => {
    if (!row) return;
    if (typeof row === 'object' && !Array.isArray(row)) {
      list.push(row);
    } else if (Array.isArray(row) && headers.length) {
      const obj = {};
      headers.forEach((header, idx) => {
        obj[header] = row[idx];
      });
      list.push(obj);
    }
  });
  return list;
}

function parseNumericValue(value) {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  const str = String(value).trim();
  if (!str) return NaN;
  const cleaned = str
    .replace(/[%％]/g, '')
    .replace(/[,+，\s]/g, '')
    .replace(/[^\d.-]/g, '');
  if (!cleaned) return NaN;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function isNumericColumn(rows, key) {
  return rows.some((row) => Number.isFinite(parseNumericValue(row[key])));
}

function buildChartData(meta, chartType) {
  if (!meta || !Array.isArray(meta.rows) || meta.rows.length === 0) return null;
  const headersInput = Array.isArray(meta.headers) ? meta.headers.filter(Boolean) : [];
  const headers = headersInput.length ? headersInput : inferHeaders(meta.rows);
  if (!headers.length) return null;
  const rows = normalizeRows(meta.rows, headers);
  if (!rows.length) return null;

  const numericKeys = headers.filter((key) => isNumericColumn(rows, key));
  if (!numericKeys.length) return null;

  // Heuristic: pick the first non-numeric column as dimension; fallback to the first column.
  let dimensionKey = headers.find((key) => !numericKeys.includes(key));
  if (!dimensionKey) {
    dimensionKey = headers.find((key) => key !== numericKeys[0]) || headers[0];
  }
  if (!dimensionKey) return null;

  const metricKeys = (chartType === 'pie' || chartType === 'doughnut')
    ? [numericKeys[0]]
    : numericKeys;

  const labels = rows.map((row, idx) => {
    const raw = row[dimensionKey];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return `第${idx + 1}项`;
    }
    return String(raw);
  });

  const datasets = metricKeys.map((key, datasetIdx) => {
    const data = rows.map((row) => {
      const value = parseNumericValue(row[key]);
      return Number.isFinite(value) ? value : 0;
    });
    return {
      key,
      label: key,
      data,
      colorIndex: datasetIdx
    };
  }).filter((dataset) => dataset.data.some((value) => Number.isFinite(value) && value !== 0));

  if (!datasets.length) return null;

  return { labels, datasets, dimensionKey };
}

function getColor(index) {
  return COLOR_PALETTE[index % COLOR_PALETTE.length];
}

function hexToRgba(hex, alpha) {
  const parsed = hex.replace('#', '');
  if (parsed.length !== 6) return hex;
  const r = parseInt(parsed.slice(0, 2), 16);
  const g = parseInt(parsed.slice(2, 4), 16);
  const b = parseInt(parsed.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildChartConfig({ chartType, datasetInfo, title }) {
  const isPieLike = chartType === 'pie' || chartType === 'doughnut';
  const datasets = datasetInfo.datasets.map((dataset, idx) => {
    if (isPieLike) {
      return {
        label: dataset.label || title,
        data: dataset.data,
        backgroundColor: dataset.data.map((_, segmentIdx) => getColor(segmentIdx)),
        borderColor: '#ffffff',
        borderWidth: 1
      };
    }

    const baseColor = getColor(idx);
    return {
      label: dataset.label || title,
      data: dataset.data,
      backgroundColor: chartType === 'line' ? hexToRgba(baseColor, 0.25) : baseColor,
      borderColor: baseColor,
      borderWidth: chartType === 'line' ? 2 : 1,
      fill: chartType === 'line' ? false : 'origin',
      tension: chartType === 'line' ? 0.35 : 0
    };
  });

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'bottom' },
      tooltip: {
        callbacks: {
          label(context) {
            const datasetLabel = context.dataset.label || '';
            const value = context.formattedValue;
            if (isPieLike) {
              return `${context.label}: ${value}`;
            }
            return datasetLabel ? `${datasetLabel}: ${value}` : `${context.label}: ${value}`;
          }
        }
      }
    }
  };

  if (!isPieLike) {
    options.scales = {
      x: { title: { display: true, text: datasetInfo.dimensionKey } },
      y: { beginAtZero: true }
    };
  }

  return {
    type: chartType,
    data: {
      labels: datasetInfo.labels,
      datasets
    },
    options
  };
}

export function renderTableChart({ tableElement, meta, tableIndex }) {
  if (!tableElement || !meta) return null;
  const chartType = normalizeChartType(meta.chartType);
  if (!chartType) return null;
  const ChartLib = typeof window !== 'undefined' ? window.Chart : null;
  if (!ChartLib) return null;
  const existing = tableElement.previousElementSibling;
  if (existing && existing.classList && existing.classList.contains('bubble-chart')) {
    return existing.querySelector('canvas') || null;
  }

  const datasetInfo = buildChartData(meta, chartType);
  if (!datasetInfo) return null;

  const wrapper = document.createElement('div');
  wrapper.className = 'bubble-chart';
  const canvas = document.createElement('canvas');
  wrapper.appendChild(canvas);
  const parent = tableElement.parentNode;
  if (!parent) return null;
  parent.insertBefore(wrapper, tableElement);
  const ctx = canvas.getContext('2d');
  const chart = new ChartLib(ctx, buildChartConfig({
    chartType,
    datasetInfo,
    title: meta.label || `chart-${(tableIndex || 0) + 1}`
  }));
  chartRegistry.set(canvas, chart);
  return canvas;
}

export function destroyCharts() {
  chartRegistry.forEach((chart) => {
    if (chart && typeof chart.destroy === 'function') {
      chart.destroy();
    }
  });
  chartRegistry.clear();
}
