import { app } from './app.js';

export default {
  async fetch(request, env, ctx) {
    if (env && typeof env === 'object') {
      if (env.MONGODB_DATA_API_KEY) process.env.MONGODB_DATA_API_KEY = env.MONGODB_DATA_API_KEY;
      if (env.MONGODB_DATA_API_URL) process.env.MONGODB_DATA_API_URL = env.MONGODB_DATA_API_URL;
      if (env.MONGODB_DATA_SOURCE) process.env.MONGODB_DATA_SOURCE = env.MONGODB_DATA_SOURCE;
      if (env.MONGODB_DATABASE) process.env.MONGODB_DATABASE = env.MONGODB_DATABASE;
      if (env.JWT_SECRET) process.env.JWT_SECRET = env.JWT_SECRET;
      if (env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = env.ENCRYPTION_KEY;
      if (env.TELEGRAM_BOT_TOKEN) process.env.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
      if (env.TELEGRAM_CHANNEL_ID) process.env.TELEGRAM_CHANNEL_ID = env.TELEGRAM_CHANNEL_ID;
      if (env.TELEGRAM_BOT_USERNAME) process.env.TELEGRAM_BOT_USERNAME = env.TELEGRAM_BOT_USERNAME;
      if (env.ADMIN_TELEGRAM_IDS) process.env.ADMIN_TELEGRAM_IDS = env.ADMIN_TELEGRAM_IDS;
      if (env.ADMIN_CHAT_ID) process.env.ADMIN_CHAT_ID = env.ADMIN_CHAT_ID;
      if (env.APP_URL) process.env.APP_URL = env.APP_URL;
      if (env.DEFAULT_CURRENCY) process.env.DEFAULT_CURRENCY = env.DEFAULT_CURRENCY;
      if (env.NODE_ENV) process.env.NODE_ENV = env.NODE_ENV;
    }
    return app.fetch(request, env, ctx);
  },
};
