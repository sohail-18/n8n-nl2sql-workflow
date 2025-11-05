const CLIENT_ID_KEY = 'n8n_client_id';

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return 'client_' + crypto.randomUUID();
  }
  return 'client_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

export function getClientId() {
  try {
    const stored = localStorage.getItem(CLIENT_ID_KEY);
    if (stored && typeof stored === 'string' && stored.trim()) {
      return stored.trim();
    }
    const created = generateId();
    localStorage.setItem(CLIENT_ID_KEY, created);
    return created;
  } catch (_) {
    return generateId();
  }
}
