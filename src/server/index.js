const path = require('path');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const { loadEnv } = require('./env');
const { initDatabase } = require('./db');
const sessionService = require('./sessionService');

const projectRoot = path.resolve(__dirname, '..', '..');
const srcRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');

loadEnv({ cwd: projectRoot });

const CLIENT_ID_HEADER = 'x-client-id';

function normalizeClientId(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 128);
}

function extractClientId(req) {
  const headerValue = req.get(CLIENT_ID_HEADER) || req.get(CLIENT_ID_HEADER.toUpperCase());
  const bodyValue = req.body && typeof req.body.clientId === 'string' ? req.body.clientId : null;
  return normalizeClientId(headerValue || bodyValue);
}

const app = express();
app.use(cors());
app.use(express.json());

const N8N_WEBHOOK_URL = (process.env.N8N_WEBHOOK_URL || '').trim();
const N8N_API_KEY = (process.env.N8N_API_KEY || '').trim();
const TABLE_DEFAULT_ROWS = resolveIntSetting(process.env.TABLE_DEFAULT_ROWS, {
  fallback: 30,
  name: 'TABLE_DEFAULT_ROWS',
  min: 0,
  max: 5000
});
let tableMaxRowsResolved = resolveIntSetting(process.env.TABLE_MAX_ROWS, {
  fallback: 200,
  name: 'TABLE_MAX_ROWS',
  min: 0,
  max: 5000
});
if (tableMaxRowsResolved && TABLE_DEFAULT_ROWS > 0 && tableMaxRowsResolved < TABLE_DEFAULT_ROWS) {
  console.warn(`⚠️ TABLE_MAX_ROWS (${tableMaxRowsResolved}) 小于 TABLE_DEFAULT_ROWS (${TABLE_DEFAULT_ROWS})，已自动调整为 ${TABLE_DEFAULT_ROWS}。`);
  tableMaxRowsResolved = TABLE_DEFAULT_ROWS;
}
const TABLE_MAX_ROWS = tableMaxRowsResolved;

if (!N8N_WEBHOOK_URL) {
  console.warn('⚠️ N8N_WEBHOOK_URL 未配置，将无法向 n8n 转发消息。请在 .env 或环境变量中设置。');
}

// Serve static UI
app.use('/src', express.static(srcRoot));
app.use(express.static(publicDir));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

function collectHeaders(rows) {
  const headers = [];
  if (!Array.isArray(rows)) return headers;
  rows.forEach((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return;
    Object.keys(row).forEach((key) => {
      if (key && !headers.includes(key)) headers.push(key);
    });
  });
  return headers;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  let str;
  if (typeof value === 'object') {
    try {
      str = JSON.stringify(value);
    } catch {
      str = '';
    }
  } else {
    str = String(value);
  }
  str = str.replace(/\r?\n/g, '\n');
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowsToCsv(rows, headers) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const headerList = Array.isArray(headers) && headers.length ? headers : collectHeaders(rows);
  const lines = [];

  if (headerList.length) {
    lines.push(headerList.map(csvEscape).join(','));
    rows.forEach((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        const empty = headerList.map(() => '');
        lines.push(empty.join(','));
        return;
      }
      const cells = headerList.map((key) => csvEscape(row[key]));
      lines.push(cells.join(','));
    });
  } else {
    rows.forEach((row) => {
      if (Array.isArray(row)) {
        lines.push(row.map(csvEscape).join(','));
      } else {
        lines.push(csvEscape(row));
      }
    });
  }

  return lines.join('\n');
}

function resolveEffectiveMaxRows(maxRowsOption) {
  const fromOption = Number.isFinite(maxRowsOption) && maxRowsOption > 0 ? maxRowsOption : null;
  const fromEnv = Number.isFinite(TABLE_MAX_ROWS) && TABLE_MAX_ROWS > 0 ? TABLE_MAX_ROWS : null;
  return fromOption ?? fromEnv ?? 0;
}

function arrayToMarkdownTable(rows, { maxRows, collect } = {}) {
  const effectiveMaxRows = resolveEffectiveMaxRows(maxRows);
  const totalRows = Array.isArray(rows) ? rows.length : 0;
  if (!Array.isArray(rows) || rows.length === 0) {
    if (typeof collect === 'function') {
      collect({
        totalRows,
        headers: [],
        rows: Array.isArray(rows) ? rows : [],
        csv: ''
      });
    }
    return { markdown: '', totalRows: 0, headers: [], csv: '' };
  }

  const headers = collectHeaders(rows);
  if (typeof collect === 'function') {
    collect({
      totalRows,
      headers,
      rows,
      csv: rowsToCsv(rows, headers)
    });
  }
  if (headers.length === 0) {
    return { markdown: '', totalRows, headers, csv: rowsToCsv(rows, headers) };
  }

  const escapeCell = (value) => {
    if (value === undefined || value === null) return '';
    return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  };

  const lines = [];
  lines.push(`| ${headers.map((h) => escapeCell(h)).join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);

  const limitedRows = effectiveMaxRows ? rows.slice(0, effectiveMaxRows) : rows;

  limitedRows.forEach((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      lines.push(`| ${headers.map(() => '').join(' | ')} |`);
      return;
    }
    const cells = headers.map((key) => escapeCell(row[key]));
    lines.push(`| ${cells.join(' | ')} |`);
  });

  let markdown = lines.join('\n');
  if (effectiveMaxRows && rows.length > effectiveMaxRows) {
    markdown += `\n> 共 ${rows.length} 行，只展示前 ${effectiveMaxRows} 行`;
  }

  return { markdown, totalRows, headers, csv: rowsToCsv(rows, headers) };
}

const activeSessionRequests = new Map();

app.get('/api/config', (req, res) => {
  let display = '';
  if (N8N_WEBHOOK_URL) {
    try {
      const u = new URL(N8N_WEBHOOK_URL);
      display = u.host || N8N_WEBHOOK_URL;
    } catch (e) {
      display = N8N_WEBHOOK_URL;
    }
  }
  res.json({
    n8n_host: display,
    configured: Boolean(N8N_WEBHOOK_URL),
    table_default_rows: TABLE_DEFAULT_ROWS,
    table_max_rows: TABLE_MAX_ROWS
  });
});

app.get('/api/sessions', async (req, res) => {
  const clientId = extractClientId(req);
  if (!clientId) {
    return res.status(400).json({ error: '缺少客户端标识' });
  }
  try {
    const sessions = await sessionService.listSessions(clientId);
    res.json({ sessions });
  } catch (error) {
    console.error('[sessions] 列表失败', error);
    res.status(500).json({ error: '无法加载会话列表' });
  }
});

app.post('/api/sessions', async (req, res) => {
  const clientId = extractClientId(req);
  if (!clientId) {
    return res.status(400).json({ error: '缺少客户端标识' });
  }
  try {
    const title = req.body && typeof req.body.title === 'string' ? req.body.title : undefined;
    const session = await sessionService.createSession({ title, clientId });
    res.status(201).json({ session });
  } catch (error) {
    console.error('[sessions] 创建失败', error);
    res.status(500).json({ error: '创建会话失败，请稍后重试' });
  }
});

app.get('/api/sessions/:id', async (req, res) => {
  const sessionId = (req.params.id || '').trim();
  if (!sessionId) {
    return res.status(400).json({ error: '会话 ID 不能为空' });
  }
  const clientId = extractClientId(req);
  if (!clientId) {
    return res.status(400).json({ error: '缺少客户端标识' });
  }
  try {
    const session = await sessionService.getSessionWithMessages(sessionId, clientId);
    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }
    res.json({ session });
  } catch (error) {
    console.error('[sessions] 读取失败', error);
    res.status(500).json({ error: '加载会话失败' });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  const sessionId = (req.params.id || '').trim();
  if (!sessionId) {
    return res.status(400).json({ error: '会话 ID 不能为空' });
  }
  const clientId = extractClientId(req);
  if (!clientId) {
    return res.status(400).json({ error: '缺少客户端标识' });
  }
  try {
    const deleted = await sessionService.deleteSession(sessionId, clientId);
    if (!deleted) {
      return res.status(404).json({ error: '会话不存在' });
    }
    res.status(204).end();
  } catch (error) {
    console.error('[sessions] 删除失败', error);
    res.status(500).json({ error: '删除会话失败' });
  }
});

app.post('/api/chat', async (req, res) => {
  let sessionId = '';
  const lockedSessionIds = new Set();
  const clientId = extractClientId(req);
  if (!clientId) {
    return res.status(400).json({ error: '缺少客户端标识' });
  }
  try {
    const data = req.body || {};
    const chatInput = data.chatInput || data.message || '';
    const rawSessionId = typeof data.sessionId === 'string' ? data.sessionId.trim() : '';
    const userMessageId = typeof data.messageId === 'string' && data.messageId.trim()
      ? data.messageId.trim()
      : sessionService.genMessageId();
    const userMessageTime = Number.isFinite(data.messageTime)
      ? Number(data.messageTime)
      : Date.now();

    if (!chatInput) {
      return res.status(400).json({ error: 'chatInput 不能为空' });
    }

    if (!N8N_WEBHOOK_URL) {
      return res.status(500).json({ error: 'N8N_WEBHOOK_URL 未配置，请在 .env 中设置。' });
    }

    sessionId = rawSessionId || sessionService.genSessionId();
    const initialLockKey = sessionId;
    if (activeSessionRequests.get(initialLockKey)) {
      return res.status(429).json({ error: '上一条消息正在处理中，请稍候再试。', sessionId: initialLockKey });
    }
    activeSessionRequests.set(initialLockKey, Date.now());
    lockedSessionIds.add(initialLockKey);

    try {
      await sessionService.ensureSession(sessionId, clientId);
    } catch (error) {
      if (error && error.code === 'SESSION_OWNER_MISMATCH') {
        const replacement = await sessionService.createSession({ clientId });
        sessionId = replacement.id;
        if (sessionId !== initialLockKey) {
          if (activeSessionRequests.get(sessionId)) {
            return res.status(429).json({ error: '上一条消息正在处理中，请稍候再试。', sessionId });
          }
          activeSessionRequests.set(sessionId, Date.now());
          lockedSessionIds.add(sessionId);
        }
      } else {
        throw error;
      }
    }

    await sessionService.addUserMessage({
      sessionId,
      clientId,
      messageId: userMessageId,
      text: chatInput,
      time: userMessageTime
    });

    const payload = {
      chatInput,
      sessionId,
      messageId: userMessageId,
      clientId
    };
    const headers = { 'Content-Type': 'application/json' };
    if (N8N_API_KEY) headers.Authorization = `Bearer ${N8N_API_KEY}`;

    console.log('[chat] -> n8n payload:', JSON.stringify(payload));

    const response = await axios.post(N8N_WEBHOOK_URL, payload, {
      timeout: 60000,
      headers,
      validateStatus: () => true
    });

    console.log('[chat] <- n8n status:', response.status);
    try { console.log('[chat] <- n8n data preview:', JSON.stringify(response.data).slice(0, 500)); } catch { }

    const result = response.data;
    const rawTables = [];
    const logTable = (label, extraMeta = {}) => (info) => {
      if (!info) return;
      const { totalRows, headers: tableHeaders, rows, csv } = info;
      if (Array.isArray(rows)) {
        console.log(`[chat] n8n 数据集 ${label}: ${totalRows} 条`);
        const record = {
          label,
          headers: tableHeaders,
          rows,
          totalRows,
          csv
        };
        Object.entries(extraMeta).forEach(([key, value]) => {
          if (value !== undefined) {
            record[key] = value;
          }
        });
        rawTables.push(record);
      }
    };

    const extractBody = (obj) => {
      if (!obj) return '';

      const appendTable = (text, source, label, extraMeta = {}) => {
        const { markdown } = arrayToMarkdownTable(source, {
          maxRows: TABLE_MAX_ROWS,
          collect: logTable(label, extraMeta)
        });
        if (!markdown) return text;
        return text ? `${text}\n\n${markdown}` : markdown;
      };

      let msg = '';
      if (typeof obj.body === 'string') msg = obj.body;
      else if (typeof obj.text === 'string') msg = obj.text;
      else if (typeof obj.message === 'string') msg = obj.message;
      else if (typeof obj.data === 'string') msg = obj.data;

      const sql = typeof obj.sql === 'string' ? obj.sql.trim() : '';
      const chart = typeof obj.chart_type === 'string' ? obj.chart_type.trim() : '';
      if (sql) {
        msg = `${msg ? msg + '\n\n' : ''}SQL:\n\`\`\`sql\n${sql}\n\`\`\``;
      }
      let pendingChartMeta = chart ? { chartType: chart } : null;

      const consumeChartMeta = () => {
        if (!pendingChartMeta) return undefined;
        const meta = pendingChartMeta;
        pendingChartMeta = null;
        return meta;
      };

      if (Array.isArray(obj.result)) msg = appendTable(msg, obj.result, 'result', consumeChartMeta());
      else if (Array.isArray(obj.body)) msg = appendTable(msg, obj.body, 'body', consumeChartMeta());
      else if (Array.isArray(obj.data)) msg = appendTable(msg, obj.data, 'data', consumeChartMeta());

      if (
        !msg &&
        obj.result &&
        typeof obj.result === 'object' &&
        Array.isArray(obj.result.data)
      ) {
        msg = appendTable(msg, obj.result.data, 'result.data', consumeChartMeta());
      }

      if (!msg) {
        if (obj.body && typeof obj.body === 'object') msg = JSON.stringify(obj.body);
        else if (obj.data && typeof obj.data === 'object') msg = JSON.stringify(obj.data);
      }

      return msg;
    };

    let replyText = '';

    if (Array.isArray(result) && result.length > 0) {
      const first = result[0];
      if (first && first.response && typeof first.response.statusCode === 'number') {
        const { statusCode, body } = first.response;
        if (statusCode >= 200 && statusCode < 300) {
          replyText = typeof body === 'string' ? body : JSON.stringify(body);
        } else {
          return res.status(502).json({ error: `n8n 内部错误: statusCode ${statusCode}`, details: first.response, sessionId });
        }
      } else if (typeof first === 'object') {
        if (typeof first.statusCode === 'number') {
          if (first.statusCode >= 200 && first.statusCode < 300) {
            replyText = extractBody(first) || JSON.stringify(first);
          } else {
            return res.status(502).json({ error: `n8n 内部错误: statusCode ${first.statusCode}`, details: first, sessionId });
          }
        } else {
          replyText = extractBody(first) || JSON.stringify(first);
        }
      } else {
        replyText = String(first);
      }
    } else if (result && typeof result === 'object') {
      if (result.response && typeof result.response.statusCode === 'number') {
        const { statusCode, body } = result.response;
        if (statusCode >= 200 && statusCode < 300) {
          replyText = typeof body === 'string' ? body : JSON.stringify(body);
        } else {
          return res.status(502).json({ error: `n8n 内部错误: statusCode ${statusCode}`, details: result.response, sessionId });
        }
      } else if (typeof result.statusCode === 'number') {
        if (result.statusCode >= 200 && result.statusCode < 300) {
          replyText = extractBody(result) || JSON.stringify(result);
        } else {
          return res.status(502).json({ error: `n8n 内部错误: statusCode ${result.statusCode}`, details: result, sessionId });
        }
      } else {
        replyText = extractBody(result) || JSON.stringify(result);
      }
    } else {
      replyText = String(result || '').trim();
    }

    if (!replyText || !replyText.trim()) {
      replyText = '该问题太复杂小助手暂时无法查询和回答，请换一个问题吧🙏';
    }

    const formattedTables = sessionService.sanitizeBotTables(rawTables, { rowLimit: TABLE_MAX_ROWS });
    const botMessageId = await sessionService.addBotMessage({
      sessionId,
      clientId,
      text: replyText,
      tableData: formattedTables
    });
    const sessionData = await sessionService.getSessionWithMessages(sessionId, clientId);

    return res.json({
      reply: replyText,
      tables: formattedTables,
      sessionId,
      userMessageId,
      botMessageId,
      session: sessionData
    });
  } catch (error) {
    console.error('Chat error:', error);
    if (error.response) {
      const status = error.response.status;
      let details = '';
      try { details = JSON.stringify(error.response.data); } catch { details = String(error.response.data); }
      return res.status(502).json({ error: `n8n 请求失败: ${status}`, details, sessionId });
    }
    return res.status(500).json({ error: `服务错误: ${error.message}`, sessionId });
  } finally {
    lockedSessionIds.forEach((key) => {
      activeSessionRequests.delete(key);
    });
  }
});

function resolveIntSetting(rawValue, { fallback, name, min = 0, max = Number.MAX_SAFE_INTEGER }) {
  const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
    return parsed;
  }
  console.warn(`⚠️ 无效的 ${name} 值 "${value}"，将回退到 ${fallback}。`);
  return fallback;
}

const port = resolveIntSetting(process.env.PORT, {
  fallback: 5000,
  name: 'PORT',
  min: 1,
  max: 65535
});

async function startServer() {
  try {
    await initDatabase();
    sessionService.setTableRowLimit(TABLE_MAX_ROWS);
    app.listen(port, '0.0.0.0', () => {
      console.log('============================================================');
      console.log('🚀 n8n Chat Application (Node.js) Ready');
      console.log('============================================================');
      console.log(`📍 Server: http://127.0.0.1:${port}`);
      console.log(`🔗 n8n Webhook: ${N8N_WEBHOOK_URL || '未配置'}`);
      console.log(`🔑 API Key: ${N8N_API_KEY ? 'Configured' : 'Not configured'}`);
      const defaultRowsLog = TABLE_DEFAULT_ROWS ? TABLE_DEFAULT_ROWS : 'all';
      const maxRowsLog = TABLE_MAX_ROWS ? TABLE_MAX_ROWS : 'all';
      console.log(`📊 Table rows: default ${defaultRowsLog}, max ${maxRowsLog}`);
      console.log('============================================================');
    });
  } catch (error) {
    console.error('❌ Server启动失败，数据库初始化异常。', error);
    process.exit(1);
  }
}

startServer();
