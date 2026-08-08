const userSessions = new Map();

const setSession = (chatId, state, data = {}) =>
  userSessions.set(String(chatId), { state, data, timestamp: Date.now() });

const getSession = (chatId) => {
  const s = userSessions.get(String(chatId));
  if (!s) return null;
  if (Date.now() - s.timestamp > 2 * 3600 * 1000) { userSessions.delete(String(chatId)); return null; }
  return s;
};

const clearSession = (chatId) => userSessions.delete(String(chatId));

module.exports = {
  setSession,
  getSession,
  clearSession,
};
