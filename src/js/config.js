const defaults = {
  tableDefaultRows: 30,
  tableMaxRows: 200
};

export const config = {
  tableDefaultRows: defaults.tableDefaultRows,
  tableMaxRows: defaults.tableMaxRows
};

function assignInt(target, key, value, { min = 0, max = 5000 } = {}) {
  if (value === undefined || value === null) return;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return;
  if (parsed < min) return;
  if (parsed > max) {
    target[key] = max;
    return;
  }
  target[key] = parsed;
}

export async function loadConfig() {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) return config;
    const data = await response.json();
    assignInt(config, 'tableDefaultRows', data && data.table_default_rows, { min: 0, max: 5000 });
    assignInt(config, 'tableMaxRows', data && data.table_max_rows, { min: 0, max: 5000 });
    if (config.tableMaxRows && config.tableDefaultRows > config.tableMaxRows) {
      config.tableMaxRows = config.tableDefaultRows;
    }
  } catch (error) {
    console.warn('[ui] 配置加载失败，使用默认表格设置。', error);
  }
  return config;
}

export function getTableCollapseLimit() {
  return config.tableDefaultRows;
}

export function getTableMaxRows() {
  return config.tableMaxRows;
}
