/**
 * Workers KV-based session store
 * Replaces in-memory Map sessions for Cloudflare Workers
 */

const SESSION_PREFIX = 'tg_session:';
const SESSION_TTL = 2 * 3600 * 1000; // 2 hours in ms

async function setSession(env, chatId, state, data = {}) {
  if (!env?.TELEGRAM_SESSIONS) {
    return null;
  }
  const session = { state, data, timestamp: Date.now() };
  await env.TELEGRAM_SESSIONS.put(`${SESSION_PREFIX}${chatId}`, JSON.stringify(session));
  return session;
}

async function getSession(env, chatId) {
  if (!env?.TELEGRAM_SESSIONS) {
    return null;
  }
  const raw = await env.TELEGRAM_SESSIONS.get(`${SESSION_PREFIX}${chatId}`);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (Date.now() - session.timestamp > SESSION_TTL) {
      await env.TELEGRAM_SESSIONS.delete(`${SESSION_PREFIX}${chatId}`);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

async function clearSession(env, chatId) {
  if (env?.TELEGRAM_SESSIONS) {
    await env.TELEGRAM_SESSIONS.delete(`${SESSION_PREFIX}${chatId}`);
  }
}

export { setSession, getSession, clearSession };
