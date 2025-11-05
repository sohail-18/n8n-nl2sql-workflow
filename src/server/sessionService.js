const { getPool } = require('./db');
const { genSessionId, genMessageId } = require('./idGenerators');
const {
  sanitizeBotTables,
  sanitizeTableSummary,
  buildTableSummaryFromData,
  sanitizeMessageRecord,
  constants: sanitizerConstants
} = require('./sessionSanitizer');

const MAX_MESSAGES_PER_SESSION = 200;
const MAX_STORED_SESSIONS = 100;
let tableRowLimit = sanitizerConstants.MAX_TABLE_ROWS;

function setTableRowLimit(limit) {
  if (Number.isFinite(limit) && limit > 0) {
    tableRowLimit = limit;
  } else {
    tableRowLimit = sanitizerConstants.MAX_TABLE_ROWS;
  }
}

function parseJsonSafe(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function toTimestamp(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return Date.now();
}

function ensureClientId(clientId) {
  if (!clientId || typeof clientId !== 'string') return null;
  const trimmed = clientId.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 128);
}

function sessionOwnerMismatch(sessionId) {
  const error = new Error('SESSION_OWNER_MISMATCH');
  error.code = 'SESSION_OWNER_MISMATCH';
  error.sessionId = sessionId;
  return error;
}

async function pruneMessages(sessionId) {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT id FROM messages WHERE session_id = ? ORDER BY time DESC, created_at DESC, id DESC',
    [sessionId]
  );
  if (!rows || rows.length <= MAX_MESSAGES_PER_SESSION) return;
  const idsToDelete = rows.slice(MAX_MESSAGES_PER_SESSION).map((row) => row.id);
  if (idsToDelete.length) {
    await pool.query('DELETE FROM messages WHERE id IN (?)', [idsToDelete]);
  }
}

async function pruneSessionsForClient(clientId) {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT id FROM sessions WHERE client_id = ? ORDER BY updated_at DESC',
    [clientId]
  );
  if (!rows || rows.length <= MAX_STORED_SESSIONS) return;
  const idsToDelete = rows.slice(MAX_STORED_SESSIONS).map((row) => row.id);
  if (idsToDelete.length) {
    await pool.query('DELETE FROM sessions WHERE id IN (?)', [idsToDelete]);
  }
}

async function insertMessage({
  sessionId,
  messageId = genMessageId(),
  role,
  text,
  time = Date.now(),
  tableSummary = [],
  tableData = [],
  updateSessionTitle = role === 'user'
}) {
  const pool = getPool();
  const sanitizedSummary = sanitizeTableSummary(tableSummary);
  const sanitizedTables = sanitizeBotTables(tableData, { rowLimit: tableRowLimit });

  await pool.query(
    `INSERT INTO messages (id, session_id, role, text, time, table_summary, table_data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      messageId,
      sessionId,
      role === 'user' ? 'user' : 'bot',
      String(text ?? ''),
      Number.isFinite(time) ? Number(time) : Date.now(),
      sanitizedSummary.length ? JSON.stringify(sanitizedSummary) : null,
      sanitizedTables.length ? JSON.stringify(sanitizedTables) : null
    ]
  );

  await pool.query(
    'UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [sessionId]
  );

  if (updateSessionTitle && role === 'user') {
    const [[{ count }]] = await pool.query(
      'SELECT COUNT(*) AS count FROM messages WHERE session_id = ? AND role = ?',
      [sessionId, 'user']
    );
    if (count === 1) {
      const title = String(text ?? '').trim().slice(0, 120) || '新会话';
      await pool.query(
        'UPDATE sessions SET title = ? WHERE id = ?',
        [title, sessionId]
      );
    }
  }

  await pruneMessages(sessionId);
  return messageId;
}

async function fetchSessionRow(sessionId) {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT id, title, client_id, created_at, updated_at FROM sessions WHERE id = ? LIMIT 1',
    [sessionId]
  );
  return rows && rows.length ? rows[0] : null;
}

async function assertSessionOwnership(sessionId, clientId) {
  const normalizedClientId = ensureClientId(clientId);
  const row = await fetchSessionRow(sessionId);
  if (!row) {
    return null;
  }
  if (normalizedClientId && row.client_id !== normalizedClientId) {
    throw sessionOwnerMismatch(sessionId);
  }
  return row;
}

function formatMessageRow(row) {
  const parsedSummary = sanitizeTableSummary(parseJsonSafe(row.table_summary));
  const parsedTables = sanitizeBotTables(parseJsonSafe(row.table_data), { rowLimit: tableRowLimit });
  return sanitizeMessageRecord({
    id: row.id,
    role: row.role,
    text: row.text,
    time: row.time,
    tableSummary: parsedSummary,
    tableData: parsedTables
  });
}

async function createSession({ id, title, clientId }) {
  const normalizedClientId = ensureClientId(clientId);
  if (!normalizedClientId) {
    throw new Error('clientId is required to create session');
  }

  const pool = getPool();
  const sessionId = id || genSessionId();
  const sessionTitle = typeof title === 'string' && title.trim()
    ? title.trim().slice(0, 120)
    : '新会话';

  await pool.query(
    'INSERT INTO sessions (id, title, client_id) VALUES (?, ?, ?)',
    [sessionId, sessionTitle, normalizedClientId]
  );

  await pruneSessionsForClient(normalizedClientId);
  return getSessionWithMessages(sessionId, normalizedClientId);
}

async function ensureSession(sessionId, clientId) {
  const normalizedClientId = ensureClientId(clientId);
  if (!normalizedClientId) {
    throw new Error('clientId is required to ensure session');
  }
  const existing = await fetchSessionRow(sessionId);
  if (!existing) {
    return createSession({ id: sessionId, clientId: normalizedClientId });
  }
  if (existing.client_id !== normalizedClientId) {
    throw sessionOwnerMismatch(sessionId);
  }
  return getSessionWithMessages(sessionId, normalizedClientId);
}

async function getSessionWithMessages(sessionId, clientId) {
  const normalizedClientId = ensureClientId(clientId);
  const row = await assertSessionOwnership(sessionId, normalizedClientId);
  if (!row) return null;

  const pool = getPool();
  const [messageRows] = await pool.query(
    `SELECT id, session_id, role, text, time, table_summary, table_data, created_at
     FROM messages
     WHERE session_id = ?
     ORDER BY time ASC, created_at ASC, id ASC`,
    [sessionId]
  );

  const messages = (messageRows || []).map((item) => formatMessageRow(item)).filter(Boolean);

  return {
    id: row.id,
    title: row.title,
    createdAt: toTimestamp(row.created_at),
    updatedAt: toTimestamp(row.updated_at),
    messages
  };
}

async function listSessions(clientId) {
  const normalizedClientId = ensureClientId(clientId);
  if (!normalizedClientId) {
    return [];
  }

  const pool = getPool();
  const [sessionRows] = await pool.query(
    'SELECT id, title, created_at, updated_at FROM sessions WHERE client_id = ? ORDER BY updated_at DESC',
    [normalizedClientId]
  );
  if (!sessionRows || !sessionRows.length) return [];
  const sessionIds = sessionRows.map((row) => row.id);

  const [messageRows] = await pool.query(
    `SELECT id, session_id, role, text, time, table_summary, table_data, created_at
     FROM messages
     WHERE session_id IN (?)
     ORDER BY session_id ASC, time ASC, created_at ASC, id ASC`,
    [sessionIds]
  );

  const messagesBySession = new Map();
  (messageRows || []).forEach((row) => {
    const list = messagesBySession.get(row.session_id) || [];
    list.push(formatMessageRow(row));
    messagesBySession.set(row.session_id, list);
  });

  return sessionRows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: toTimestamp(row.created_at),
    updatedAt: toTimestamp(row.updated_at),
    messages: messagesBySession.get(row.id) || []
  }));
}

async function deleteSession(sessionId, clientId) {
  const normalizedClientId = ensureClientId(clientId);
  if (!normalizedClientId) return false;
  const pool = getPool();
  const [result] = await pool.query(
    'DELETE FROM sessions WHERE id = ? AND client_id = ?',
    [sessionId, normalizedClientId]
  );
  return result && result.affectedRows > 0;
}

async function addUserMessage({ sessionId, clientId, messageId, text, time }) {
  const normalizedClientId = ensureClientId(clientId);
  if (!normalizedClientId) {
    throw new Error('clientId is required to add user message');
  }
  const session = await assertSessionOwnership(sessionId, normalizedClientId);
  if (!session) {
    throw new Error('SESSION_NOT_FOUND');
  }
  return insertMessage({
    sessionId,
    messageId: messageId || genMessageId(),
    role: 'user',
    text,
    time,
    tableSummary: [],
    tableData: [],
    updateSessionTitle: true
  });
}

async function addBotMessage({ sessionId, clientId, messageId, text, time, tableData }) {
  const normalizedClientId = ensureClientId(clientId);
  if (!normalizedClientId) {
    throw new Error('clientId is required to add bot message');
  }
  const session = await assertSessionOwnership(sessionId, normalizedClientId);
  if (!session) {
    throw new Error('SESSION_NOT_FOUND');
  }
  const sanitizedTables = sanitizeBotTables(tableData, { rowLimit: tableRowLimit });
  const summary = buildTableSummaryFromData(sanitizedTables);
  return insertMessage({
    sessionId,
    messageId: messageId || genMessageId(),
    role: 'bot',
    text,
    time,
    tableSummary: summary,
    tableData: sanitizedTables,
    updateSessionTitle: false
  });
}

module.exports = {
  createSession,
  ensureSession,
  getSessionWithMessages,
  listSessions,
  deleteSession,
  addUserMessage,
  addBotMessage,
  setTableRowLimit,
  sanitizeBotTables,
  buildTableSummaryFromData,
  genSessionId,
  genMessageId
};
