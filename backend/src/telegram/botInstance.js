let botInstance = null;

const setBot = (bot) => {
  botInstance = bot;
};

const getBot = () => {
  if (!botInstance) throw new Error("Bot instance not initialized yet.");
  return botInstance;
};

module.exports = {
  setBot,
  getBot,
};
