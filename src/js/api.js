import { getClientId } from './clientId.js';

let inFlightRequest = null;

function buildHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'X-Client-Id': getClientId(),
    ...extra
  };
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, options);
  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (_) {
      data = null;
    }
  }
  if (!response.ok) {
    const error = new Error(
      (data && data.error) ||
      response.statusText ||
      '请求失败'
    );
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data || {};
}

export async function fetchSessions() {
  try {
    const data = await requestJson('/api/sessions', {
      headers: buildHeaders()
    });
    return {
      sessions: Array.isArray(data.sessions) ? data.sessions : []
    };
  } catch (error) {
    console.error('[api] 获取会话列表失败', error);
    throw error;
  }
}

export async function fetchSessionById(sessionId) {
  if (!sessionId) {
    throw new Error('sessionId 不能为空');
  }
  const data = await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    headers: buildHeaders()
  });
  return data && data.session ? data.session : null;
}

export async function createSession({ title } = {}) {
  const payload = typeof title === 'string' && title.trim()
    ? { title: title.trim() }
    : {};
  payload.clientId = getClientId();
  const data = await requestJson('/api/sessions', {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(payload)
  });
  return data;
}

export async function deleteSession(sessionId) {
  if (!sessionId) return;
  await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: buildHeaders()
  });
}

export async function postChatMessage({ chatInput, sessionId, messageId, messageTime }) {
  if (inFlightRequest) {
    return Promise.reject(new Error('上一条消息尚未完成，稍后再试'));
  }
  const payload = {
    chatInput,
    sessionId,
    messageId,
    messageTime,
    clientId: getClientId()
  };
  const request = fetch('/api/chat', {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(payload)
  });

  inFlightRequest = request;
  try {
    const response = await request;
    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (_) {
      data = { reply: raw };
    }
    return { raw, data };
  } finally {
    inFlightRequest = null;
  }
}
