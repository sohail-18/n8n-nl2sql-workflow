import {
  fetchSessions,
  createSession as apiCreateSession,
  deleteSession as apiDeleteSession
} from './api.js';

const MAX_STORED_SESSIONS = 100;
const MAX_MESSAGES_PER_SESSION = 200;

function clampList(list, limit) {
  if (!Array.isArray(list)) return [];
  if (!Number.isFinite(limit) || limit <= 0) return list.slice();
  return list.slice(0, limit);
}

function genTempMessageId(role) {
  return `${role}_tmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTable(table, index = 0) {
  if (!table || typeof table !== 'object') return null;
  const label = typeof table.label === 'string' && table.label.trim()
    ? table.label.trim()
    : `table-${index + 1}`;
  const chartType = typeof table.chartType === 'string' && table.chartType.trim()
    ? table.chartType.trim().toLowerCase()
    : undefined;
  const headers = Array.isArray(table.headers) ? table.headers.filter(Boolean) : [];
  const rows = Array.isArray(table.rows) ? table.rows.slice() : [];
  const totalRows = Number.isFinite(table.totalRows) ? Number(table.totalRows) : rows.length;
  return {
    label,
    headers,
    rows,
    rowsTruncated: Boolean(table.rowsTruncated),
    totalRows,
    csv: typeof table.csv === 'string' ? table.csv : undefined,
    chartType,
    limit: Number.isFinite(table.limit) ? Number(table.limit) : undefined,
    maxRows: Number.isFinite(table.maxRows) ? Number(table.maxRows) : undefined
  };
}

function normalizeTableSummary(summary) {
  if (!Array.isArray(summary)) return [];
  return summary
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const totalRows = Number.isFinite(item.totalRows) ? Number(item.totalRows) : 0;
      return { totalRows };
    })
    .filter(Boolean);
}

function normalizeMessage(message, index = 0) {
  if (!message || typeof message !== 'object') return null;
  const role = message.role === 'user' ? 'user' : 'bot';
  const id = typeof message.id === 'string' && message.id.trim()
    ? message.id.trim()
    : `msg_${index}_${Date.now()}`;
  const time = Number.isFinite(message.time) ? Number(message.time) : Date.now();
  const text = typeof message.text === 'string' ? message.text : '';
  const tableData = Array.isArray(message.tableData)
    ? message.tableData.map((table, idx) => normalizeTable(table, idx)).filter(Boolean)
    : [];
  const tableSummary = normalizeTableSummary(message.tableSummary);
  return {
    id,
    role,
    text,
    time,
    tableData,
    tableSummary
  };
}

function normalizeSession(session, index = 0) {
  if (!session || typeof session !== 'object') return null;
  const id = typeof session.id === 'string' && session.id.trim()
    ? session.id.trim()
    : `sess_${index}_${Date.now()}`;
  const title = typeof session.title === 'string' && session.title.trim()
    ? session.title.trim()
    : '新会话';
  const updatedAt = Number.isFinite(session.updatedAt)
    ? Number(session.updatedAt)
    : Date.now();
  const messages = Array.isArray(session.messages)
    ? clampList(
      session.messages
        .map((message, msgIdx) => normalizeMessage(message, msgIdx))
        .filter(Boolean),
      MAX_MESSAGES_PER_SESSION
    )
    : [];
  return {
    id,
    title,
    updatedAt,
    messages
  };
}

export class SessionStore {
  constructor() {
    this.sessions = [];
    this.currentSessionId = null;
  }

  async deleteSession(id) {
    if (!id) return;
    await apiDeleteSession(id);
    this.removeSessionLocal(id);
  }

  async load() {
    const result = await fetchSessions();
    const sessions = result && Array.isArray(result.sessions) ? result.sessions : [];
    this.setSessions(sessions);
    return this.getCurrentSession();
  }

  async createSession({ title } = {}) {
    const result = await apiCreateSession({ title });
    if (result && result.session) {
      const session = this.upsertSession(result.session);
      if (session) {
        this.currentSessionId = session.id;
      }
      return session;
    }
    return null;
  }

  setSessions(list) {
    const normalized = Array.isArray(list)
      ? clampList(list.map((session, idx) => normalizeSession(session, idx)).filter(Boolean), MAX_STORED_SESSIONS)
      : [];
    this.sessions = normalized;
    if (this.currentSessionId && !this.getCurrentSession()) {
      this.currentSessionId = normalized.length ? normalized[0].id : null;
    }
    if (!this.currentSessionId && normalized.length) {
      this.currentSessionId = normalized[0].id;
    }
  }

  upsertSession(session) {
    const normalized = normalizeSession(session);
    if (!normalized) return null;
    const index = this.sessions.findIndex((item) => item && item.id === normalized.id);
    if (index === -1) {
      this.sessions.unshift(normalized);
    } else {
      this.sessions.splice(index, 1, normalized);
    }
    this.sessions = clampList(this.sessions, MAX_STORED_SESSIONS);
    if (!this.currentSessionId) {
      this.currentSessionId = normalized.id;
    }
    return normalized;
  }

  removeSessionLocal(id) {
    if (!id) return;
    const index = this.sessions.findIndex((session) => session && session.id === id);
    if (index === -1) return;
    this.sessions.splice(index, 1);
    if (this.currentSessionId === id) {
      this.currentSessionId = this.sessions.length ? this.sessions[0].id : null;
    }
  }

  getSessions() {
    return this.sessions;
  }

  getCurrentSessionId() {
    return this.currentSessionId;
  }

  setCurrentSessionId(id) {
    this.currentSessionId = id;
  }

  getCurrentSession() {
    return this.sessions.find((session) => session && session.id === this.currentSessionId) || null;
  }

  getSessionById(id) {
    return this.sessions.find((session) => session && session.id === id) || null;
  }

  ensureSession(session) {
    const normalized = this.upsertSession(session);
    if (normalized) {
      this.currentSessionId = normalized.id;
    }
    return normalized;
  }

  syncSession(session) {
    return this.upsertSession(session);
  }

  sessionHasUserMessages(session) {
    return Boolean(
      session &&
      Array.isArray(session.messages) &&
      session.messages.some((msg) => msg && msg.role === 'user')
    );
  }

  async pruneEmptySessionById(id) {
    const session = this.getSessionById(id);
    if (session && !this.sessionHasUserMessages(session)) {
      await this.deleteSession(id);
    }
  }

  async pruneIfCurrentSessionEmpty() {
    if (this.currentSessionId) {
      await this.pruneEmptySessionById(this.currentSessionId);
    }
  }

  addUserMessageToSession(sessionId, text, { id, time } = {}) {
    const session = this.getSessionById(sessionId);
    if (!session) return null;
    const message = normalizeMessage({
      id: typeof id === 'string' && id ? id : genTempMessageId('user'),
      role: 'user',
      text,
      time: Number.isFinite(time) ? Number(time) : Date.now(),
      tableData: [],
      tableSummary: []
    });
    session.messages = clampList([...(session.messages || []), message], MAX_MESSAGES_PER_SESSION);
    session.updatedAt = Date.now();
    return message;
  }

  addBotMessageToSession(sessionId, { id, text, time, tableData = [], tableSummary = [] }) {
    const session = this.getSessionById(sessionId);
    if (!session) return null;
    const message = normalizeMessage({
      id: typeof id === 'string' && id ? id : genTempMessageId('bot'),
      role: 'bot',
      text,
      time: Number.isFinite(time) ? Number(time) : Date.now(),
      tableData,
      tableSummary
    });
    session.messages = clampList([...(session.messages || []), message], MAX_MESSAGES_PER_SESSION);
    session.updatedAt = Date.now();
    return message;
  }

  removeMessage(sessionId, messageId) {
    if (!sessionId || !messageId) return;
    const session = this.getSessionById(sessionId);
    if (!session || !Array.isArray(session.messages)) return;
    session.messages = session.messages.filter((msg) => msg && msg.id !== messageId);
  }
}

export function createSessionStore() {
  return new SessionStore();
}
