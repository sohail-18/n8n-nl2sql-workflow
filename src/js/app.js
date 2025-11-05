import { createSessionStore } from './sessionStore.js';
import { renderSessions, renderChat, appendMessageToUI } from './render.js';
import { setupSidebarControls, closeSidebarOnMobile } from './sidebar.js';
import { postChatMessage } from './api.js';
import { loadConfig } from './config.js';

const store = createSessionStore();

const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const newChatBtn = document.getElementById('newChat');
let isSending = false;

function runAsync(fn, contextLabel = '[ui]') {
  return (...args) => {
    Promise.resolve(fn(...args)).catch((error) => {
      console.error(`${contextLabel} 异常:`, error);
    });
  };
}

function renderSessionList() {
  renderSessions({
    sessions: store.getSessions(),
    currentSessionId: store.getCurrentSessionId(),
    onSelect: runAsync(handleSessionSelect, '[ui] 切换会话'),
    onDelete: runAsync(handleSessionDelete, '[ui] 删除会话')
  });
}

function renderChatView() {
  renderChat({ session: store.getCurrentSession() });
}

function renderAll() {
  renderSessionList();
  renderChatView();
}

async function handleSessionSelect(sessionId) {
  const previousId = store.getCurrentSessionId();
  store.setCurrentSessionId(sessionId);
  if (previousId && previousId !== sessionId) {
    await store.pruneEmptySessionById(previousId);
  }
  renderAll();
  closeSidebarOnMobile();
}

async function handleSessionDelete(sessionId) {
  await store.deleteSession(sessionId);
  renderAll();
  closeSidebarOnMobile();
}

async function handleNewChatClick() {
  const created = await store.createSession();
  if (created) {
    renderAll();
  }
  closeSidebarOnMobile();
}

function handleSendClick(event) {
  event.preventDefault();
  if (isSending) return;
  sendMessage();
}

function handleInputKeydown(event) {
  if (!inputEl) return;
  const isPlainEnter = event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey;
  if (isSending && isPlainEnter) {
    event.preventDefault();
    return;
  }
  if (isPlainEnter) {
    event.preventDefault();
    sendMessage();
    return;
  }
  if (event.key === 'Enter') {
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const start = inputEl.selectionStart;
      const end = inputEl.selectionEnd;
      const value = inputEl.value;
      inputEl.value = value.slice(0, start) + '\n' + value.slice(end);
      inputEl.selectionStart = inputEl.selectionEnd = start + 1;
      autoResize();
    }
  }
}

async function handleDocumentClick(event) {
  const chatPane = document.querySelector('.chat-pane');
  if (chatPane && !chatPane.contains(event.target)) {
    const previousLength = store.getSessions().length;
    const previousCurrent = store.getCurrentSessionId();
    await store.pruneIfCurrentSessionEmpty();
    if (
      store.getSessions().length !== previousLength ||
      store.getCurrentSessionId() !== previousCurrent
    ) {
      renderAll();
      closeSidebarOnMobile();
    }
  }
}

function autoResize() {
  if (!inputEl) return;
  const maxHeight = 160;
  inputEl.style.height = 'auto';
  const scroll = inputEl.scrollHeight;
  const height = Math.min(scroll, maxHeight);
  inputEl.style.height = height + 'px';
  inputEl.style.overflowY = scroll > maxHeight ? 'auto' : 'hidden';
}

async function sendMessage() {
  if (isSending) return;
  if (!inputEl || !sendBtn) return;
  const text = inputEl.value.trim();
  if (!text) return;

  const session = store.getCurrentSession();
  if (!session) return;
  let sessionId = session.id;
  const initialSessionId = sessionId;

  setSendingState(true);
  let loading = { row: null, bubble: null };
  let tempMessage = null;

  try {
    tempMessage = store.addUserMessageToSession(sessionId, text);
    const isActiveSession = store.getCurrentSessionId() === sessionId;
    if (isActiveSession) {
      appendMessageToUI(text, 'user');
    }
    renderSessionList();

    inputEl.value = '';
    autoResize();
    loading = isActiveSession ? appendMessageToUI('正在思考...', 'loading') : { row: null, bubble: null };

    const { raw, data } = await postChatMessage({
      chatInput: text,
      sessionId,
      messageId: tempMessage ? tempMessage.id : undefined,
      messageTime: tempMessage ? tempMessage.time : Date.now()
    });
    console.log('[ui] /api/chat raw:', raw.slice(0, 300));
    console.log('[ui] /api/chat parsed:', data);

    if (data && typeof data.sessionId === 'string' && data.sessionId.trim()) {
      sessionId = data.sessionId.trim();
      store.setCurrentSessionId(sessionId);
      if (sessionId !== initialSessionId) {
        store.removeSessionLocal(initialSessionId);
      }
    }

    const replyText = (data && (data.reply || data.error)) || '（无响应）';
    const tableData = Array.isArray(data && data.tables)
      ? data.tables.filter(Boolean)
      : [];

    if (data && data.session) {
      store.syncSession(data.session);
    } else {
      const tableSummary = tableData.map((table) => ({
        totalRows: Number.isFinite(table && table.totalRows)
          ? Number(table.totalRows)
          : (Array.isArray(table && table.rows) ? table.rows.length : 0)
      }));
      store.addBotMessageToSession(sessionId, {
        text: String(replyText),
        tableData,
        tableSummary
      });
    }

    const stillActive = store.getCurrentSessionId() === sessionId;
    if (stillActive) {
      renderAll();
    } else {
      renderSessionList();
    }
  } catch (error) {
    console.error('[ui] 发送消息失败', error);
    const stillActive = store.getCurrentSessionId() === sessionId;
    if (stillActive) {
      renderAll();
      const message = '❌ 出错：' + (error && error.message ? error.message : '未知错误');
      appendMessageToUI(message, 'bot');
    } else {
      renderSessionList();
    }
  } finally {
    setSendingState(false);
    inputEl.focus();
    autoResize();
  }
}

function setSendingState(active) {
  isSending = Boolean(active);
  if (sendBtn) {
    sendBtn.disabled = isSending;
  }
  if (inputEl) {
    inputEl.readOnly = isSending;
    inputEl.classList.toggle('is-busy', isSending);
  }
}

async function init() {
  setupSidebarControls();

  try {
    await store.load();
  } catch (error) {
    console.error('[ui] 会话加载失败，将尝试创建新会话。', error);
    store.setSessions([]);
  }

  if (!store.getSessions().length || !store.getCurrentSession()) {
    await store.createSession();
  }

  renderAll();

  if (newChatBtn) {
    newChatBtn.addEventListener('click', runAsync(handleNewChatClick, '[ui] 新建会话'));
  }
  if (sendBtn) {
    sendBtn.addEventListener('click', handleSendClick);
  }
  if (inputEl) {
    inputEl.addEventListener('input', autoResize);
    inputEl.addEventListener('keydown', handleInputKeydown);
    autoResize();
  }

  document.addEventListener('click', runAsync(handleDocumentClick, '[ui] 点击事件'));
}

loadConfig()
  .catch((error) => {
    console.warn('[ui] 配置加载异常，继续使用默认设置。', error);
  })
  .finally(() => {
    runAsync(init, '[ui] 初始化')();
  });
