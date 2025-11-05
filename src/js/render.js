import md from './markdown.js';
import { getTableCollapseLimit, getTableMaxRows } from './config.js';
import { renderTableChart, destroyCharts } from './charts.js';

const sessionListEl = document.getElementById('sessionList');
const messagesEl = document.getElementById('messages');
const chatPaneEl = document.querySelector('.chat-pane');
const inputGreetingEl = document.getElementById('inputGreeting');
const PLACEHOLDER_CELL_PATTERN = /^[\-\u2013\u2014]+$/;
const EMPTY_GREETING = '你好👋我是AI问数小助手，请问你想了解什么';

if (inputGreetingEl) {
  inputGreetingEl.textContent = EMPTY_GREETING;
}

export function renderSessions({ sessions = [], currentSessionId, onSelect, onDelete }) {
  if (!sessionListEl) return;
  sessionListEl.innerHTML = '';

  sessions.forEach((session) => {
    if (!session) return;
    const li = document.createElement('li');
    li.className = 'session-item' + (session.id === currentSessionId ? ' active' : '');

    const content = document.createElement('div');
    content.className = 'session-content';

    const firstUserMessage = Array.isArray(session.messages)
      ? session.messages.find((msg) => msg && msg.role === 'user')
      : null;
    const titleText = firstUserMessage
      ? String(firstUserMessage.text || '').trim()
      : (session.title || '新会话');

    const titleEl = document.createElement('div');
    titleEl.className = 'session-title';
    titleEl.textContent = titleText;
    content.appendChild(titleEl);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'session-delete';
    deleteBtn.setAttribute('aria-label', '删除会话');
    const deleteIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    deleteIcon.setAttribute('class', 'session-delete-icon');
    deleteIcon.setAttribute('viewBox', '0 0 24 24');
    deleteIcon.setAttribute('aria-hidden', 'true');
    const deletePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    deletePath.setAttribute('fill', 'currentColor');
    deletePath.setAttribute('d', 'M9 3h6a1 1 0 0 1 1 1v1h4v2h-1v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7H4V5h4V4a1 1 0 0 1 1-1zm7 4H8v11a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1zM10 9h2v9h-2zm4 0h2v9h-2zM10 5v1h4V5z');
    deleteIcon.appendChild(deletePath);
    deleteBtn.appendChild(deleteIcon);

    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const confirmed = window.confirm('确定要删除该会话吗？此操作不可恢复。');
      if (confirmed && typeof onDelete === 'function') {
        onDelete(session.id);
      }
    });

    li.addEventListener('click', () => {
      if (typeof onSelect === 'function') {
        onSelect(session.id);
      }
    });

    li.appendChild(content);
    li.appendChild(deleteBtn);
    sessionListEl.appendChild(li);
  });
}

function setEmptyState() {
  if (!messagesEl) return;
  messagesEl.innerHTML = '';
  messagesEl.classList.add('is-empty');
  const pane = chatPaneEl || messagesEl.closest('.chat-pane');
  if (pane) {
    pane.classList.add('is-empty');
  }
  if (inputGreetingEl) {
    inputGreetingEl.hidden = false;
  }
}

function clearEmptyState() {
  if (!messagesEl) return;
  const pane = chatPaneEl || messagesEl.closest('.chat-pane');
  messagesEl.classList.remove('is-empty');
  if (pane) {
    pane.classList.remove('is-empty');
  }
  if (inputGreetingEl) {
    inputGreetingEl.hidden = true;
  }
}

export function renderChat({ session }) {
  if (!messagesEl) return;
  destroyCharts();
  messagesEl.innerHTML = '';
  const hasMessages = session && Array.isArray(session.messages) && session.messages.length > 0;

  if (!hasMessages) {
    setEmptyState();
    return;
  }

  clearEmptyState();

  session.messages.forEach((message) => {
    appendMessageToUI(message.text, message.role, {
      tables: message.tableData || null,
      tableSummary: message.tableSummary || null
    });
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

export function appendMessageToUI(text, role, extra = {}) {
  if (!messagesEl) return { row: null, bubble: null };
  if (messagesEl.classList.contains('is-empty')) {
    clearEmptyState();
    messagesEl.innerHTML = '';
  }

  const row = document.createElement('div');
  row.className = 'row ' + role;

  const isBotLike = (role === 'bot' || role === 'loading');
  const tableDataList = Array.isArray(extra.tables) ? extra.tables : [];
  const tableSummaryList = Array.isArray(extra.tableSummary) ? extra.tableSummary : [];

  const identity = document.createElement('div');
  identity.className = 'identity ' + (isBotLike ? 'ai' : 'user');
  const avatar = document.createElement('div');
  avatar.className = 'avatar ' + (isBotLike ? 'ai' : 'user');
  avatar.setAttribute('aria-label', isBotLike ? 'AI' : '你');
  if (isBotLike) {
    const avatarImg = document.createElement('img');
    avatarImg.src = 'dist/ChatGPT.png';
    avatarImg.alt = 'AI';
    avatarImg.loading = 'lazy';
    avatar.appendChild(avatarImg);
  } else {
    avatar.textContent = '你';
  }
  if (!avatar.textContent && !avatar.childElementCount) avatar.textContent = isBotLike ? 'AI' : '你';

  const bubble = document.createElement('div');
  bubble.className = 'bubble' + (role === 'loading' ? ' loading' : '');
  const safeText = String(text || '');

  if (isBotLike) {
    bubble.innerHTML = md.render(normalizeGfmTables(safeText));

    const tableElements = enhanceTables(bubble);
    if (tableElements.length) {
      const fragment = document.createDocumentFragment();
      while (bubble.firstChild) {
        fragment.appendChild(bubble.firstChild);
      }

      const content = document.createElement('div');
      content.className = 'bubble-content';
      content.appendChild(fragment);

      const actions = document.createElement('div');
      actions.className = 'bubble-actions';
      const blockquotes = Array.from(content.querySelectorAll('blockquote'));
      const summaryQuote = blockquotes.find((el) => /共\s*\d+\s*行/.test(el.textContent || ''));
      if (summaryQuote) {
        summaryQuote.parentElement.removeChild(summaryQuote);
        trimWhitespaceNodes(content);
      }

      tableElements.forEach((table, index) => {
        const meta = tableDataList[index] || null;
        const summary = tableSummaryList[index] || null;
        const totalRows = resolveTableTotalRows(table, meta, summary);
        applyTableDensity(table, meta, totalRows);
        if (meta && meta.chartType) {
          const chartCanvas = renderTableChart({ tableElement: table, meta, tableIndex: index });
          if (chartCanvas) {
            bubble.classList.add('has-chart');
          }
        }
        const collapseMeta = applyTableCollapse(table, getTableCollapseLimit());
        const expandBtn = createExpandButton(table, collapseMeta, totalRows);
        if (expandBtn) actions.appendChild(expandBtn);

        const exportBtn = createExportButton(table, index, meta);
        actions.appendChild(exportBtn);
      });

      const tableRow = document.createElement('div');
      tableRow.className = 'bubble-table-row';
      tableRow.appendChild(content);
      bubble.appendChild(tableRow);
      let summaryWrap = null;
      if (summaryQuote) {
        summaryWrap = document.createElement('div');
        summaryWrap.className = 'bubble-table-summary';
        summaryWrap.appendChild(summaryQuote);
      }
      if (actions.childElementCount) {
        if (!summaryWrap) {
          summaryWrap = document.createElement('div');
          summaryWrap.className = 'bubble-table-summary';
          const placeholder = document.createElement('span');
          placeholder.className = 'bubble-summary-placeholder';
          summaryWrap.appendChild(placeholder);
        }
        summaryWrap.appendChild(actions);
      }
      if (summaryWrap) {
        bubble.appendChild(summaryWrap);
      }
    }
  } else {
    bubble.textContent = safeText;
  }

  if (isBotLike) {
    identity.appendChild(avatar);
    row.appendChild(identity);
    row.appendChild(bubble);
  } else {
    identity.appendChild(avatar);
    row.appendChild(bubble);
    row.appendChild(identity);
  }

  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  return { row, bubble };
}

function normalizeGfmTables(text) {
  const lines = String(text || '').replace(/[—–]/g, '-').split('\n');
  const splitCells = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) return null;
    const inner = trimmed.slice(1, trimmed.endsWith('|') ? -1 : trimmed.length);
    return inner.split('|').map((cell) => cell.trim());
  };

  for (let i = 0; i < lines.length - 1; i++) {
    const headerCells = splitCells(lines[i]);
    const sepCells = splitCells(lines[i + 1]);
    if (!headerCells || !sepCells || !sepCells.some((cell) => /-/.test(cell))) continue;

    const normalized = headerCells.map((_, idx) => {
      const raw = (sepCells[idx] || '').trim();
      const left = raw.startsWith(':');
      const right = raw.endsWith(':');
      return `${left ? ':' : ''}---${right ? ':' : ''}`;
    });

    lines[i + 1] = `| ${normalized.join(' | ')} |`;
  }

  return lines.join('\n');
}

function enhanceTables(root) {
  if (!root) return [];
  const container = root.classList && root.classList.contains('bubble') ? root : root.closest('.bubble');
  const tables = Array.from(root.querySelectorAll('table'));
  const validTables = [];

  tables.forEach((table) => {
    removePlaceholderRows(table);
    if (!table.querySelector('td')) {
      table.remove();
      return;
    }

    table.classList.add('bubble-table');
    const bubble = table.closest('.bubble');
    if (bubble) bubble.classList.add('has-table');

    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    const columnCount = headerRow ? headerRow.children.length : 0;
    const rowCount = table.querySelectorAll('tbody tr').length || table.querySelectorAll('tr').length;
    if (columnCount && columnCount <= 4 && rowCount <= 8) {
      table.classList.add('table-short');
    }

    validTables.push(table);
  });

  if (container) container.classList.toggle('bubble-table', validTables.length > 0);
  return validTables;
}

function removePlaceholderRows(table) {
  if (!table) return;
  const rowSources = table.tBodies && table.tBodies.length
    ? Array.from(table.tBodies).flatMap((tbody) => Array.from(tbody.rows))
    : Array.from(table.querySelectorAll('tr')).filter((row) => row.querySelectorAll('td').length);
  rowSources.forEach((row) => {
    const cells = Array.from(row.querySelectorAll('td'));
    if (!cells.length) return;
    const isPlaceholder = cells.every((cell) => isPlaceholderCellText(cell.textContent));
    if (isPlaceholder && row.parentNode) {
      row.parentNode.removeChild(row);
    }
  });
}

function isPlaceholderCellText(text) {
  const normalized = String(text || '').replace(/\s+/g, '');
  if (!normalized.length) return true;
  return PLACEHOLDER_CELL_PATTERN.test(normalized);
}

function trimWhitespaceNodes(node) {
  if (!node || !node.childNodes) return;
  const toRemove = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE && !child.textContent.trim()) {
      toRemove.push(child);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      trimWhitespaceNodes(child);
    }
  });
  toRemove.forEach((n) => n.parentNode && n.parentNode.removeChild(n));
}

function getTableBodyRows(table) {
  if (!table) return [];
  if (table.tBodies && table.tBodies.length) {
    return Array.from(table.tBodies[0].rows);
  }
  const tbody = table.querySelector('tbody');
  if (tbody) return Array.from(tbody.querySelectorAll('tr'));
  const rows = Array.from(table.querySelectorAll('tr'));
  if (!rows.length) return [];
  if (table.tHead && table.tHead.rows.length) {
    return rows.slice(table.tHead.rows.length);
  }
  return rows.slice(1);
}

function resolveTableTotalRows(table, meta, summary) {
  if (summary && typeof summary.totalRows === 'number') return summary.totalRows;
  if (meta && typeof meta.totalRows === 'number') return meta.totalRows;
  if (meta && Array.isArray(meta.rows)) return meta.rows.length;
  return getTableBodyRows(table).length;
}

function applyTableDensity(table, meta, totalRows) {
  // 始终使用紧凑模式，保持列宽较小且一致
  table.classList.add('table-compact');
}

function applyTableCollapse(table, limit) {
  const bodyRows = getTableBodyRows(table);
  if (!bodyRows.length || !Number.isFinite(limit) || limit <= 0 || bodyRows.length <= limit) {
    return null;
  }
  table.classList.add('collapsible');
  table.classList.add('collapsed');
  bodyRows.forEach((row, index) => {
    if (index >= limit) row.classList.add('is-hidden');
  });
  return { bodyRows, limit, collapsed: true };
}

function setTableCollapseState(table, collapseMeta, collapsed) {
  if (!collapseMeta) return;
  collapseMeta.collapsed = collapsed;
  table.classList.toggle('collapsed', collapsed);
  collapseMeta.bodyRows.forEach((row, index) => {
    if (index >= collapseMeta.limit) {
      if (collapsed) row.classList.add('is-hidden');
      else row.classList.remove('is-hidden');
    }
  });
}

function createExpandButton(table, collapseMeta, totalRows) {
  if (!collapseMeta) return null;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'bubble-toggle';
  const knownTotal = totalRows || collapseMeta.bodyRows.length;
  const limit = collapseMeta.limit;
  const tableMaxRows = getTableMaxRows();
  const expandLabel = (tableMaxRows && tableMaxRows > 0 && knownTotal > tableMaxRows)
    ? `展开至${tableMaxRows}条`
    : `展开全部(${Math.max(knownTotal, limit)}条)`;
  const collapseLabel = `收起至${limit}条`;
  const updateLabel = () => {
    btn.textContent = collapseMeta.collapsed ? expandLabel : collapseLabel;
  };
  updateLabel();
  btn.onclick = (evt) => {
    evt.stopPropagation();
    setTableCollapseState(table, collapseMeta, !collapseMeta.collapsed);
    updateLabel();
  };
  return btn;
}

function collectTableHeadersFromRows(rows) {
  const headers = [];
  rows.forEach((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return;
    Object.keys(row).forEach((key) => {
      if (key && !headers.includes(key)) headers.push(key);
    });
  });
  return headers;
}

function createExportButton(table, index, meta) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'bubble-export';
  btn.setAttribute('aria-label', '导出 CSV');
  btn.innerHTML = '⬇️ CSV';
  btn.onclick = (evt) => {
    evt.stopPropagation();
    exportTableToCsv(table, index, meta);
  };
  return btn;
}

function exportTableToCsv(table, index = 0, meta = null) {
  if (!table) return;
  let csvContent = null;

  if (meta && typeof meta.csv === 'string' && meta.csv.length) {
    csvContent = meta.csv.startsWith('\uFEFF') ? meta.csv : '\uFEFF' + meta.csv;
  }

  if (!csvContent) {
    let lines = [];

    if (
      meta &&
      Array.isArray(meta.rows) &&
      meta.rows.length &&
      typeof meta.rows[0] === 'object' &&
      !Array.isArray(meta.rows[0])
    ) {
      const headers = (Array.isArray(meta.headers) && meta.headers.length)
        ? meta.headers
        : collectTableHeadersFromRows(meta.rows);
      if (headers.length) {
        lines.push(headers.map((header) => csvEscape(header)).join(','));
        meta.rows.forEach((row) => {
          const cells = headers.map((key) => csvEscape(row && typeof row === 'object' ? row[key] : ''));
          lines.push(cells.join(','));
        });
      }
    }

    if (!lines.length) {
      const rows = Array.from(table.querySelectorAll('tr'));
      lines = rows.map((row) => {
        const cells = Array.from(row.querySelectorAll('th,td')).map((cell) => csvEscape(cell.textContent || ''));
        return cells.join(',');
      });
    }

    csvContent = '\uFEFF' + lines.join('\n');
  }

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const label = meta && meta.label ? meta.label : `table-${index + 1}`;
  const safeLabel = String(label).trim().replace(/[^\w.-]+/g, '_') || `table-${index + 1}`;
  anchor.href = url;
  anchor.download = `${safeLabel}-${timestamp}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const str = String(value ?? '').replace(/\r?\n/g, '\n');
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
