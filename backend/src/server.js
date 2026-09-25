require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const { initTelegramBot } = require('./telegram/bot');

const PORT = process.env.PORT || 5000;

(async () => {
  try {
    await connectDB();
    
    const server = app.listen(PORT, () => {
      console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
    });

    initTelegramBot();

    // Keep-alive: ping our own health endpoint every 10 minutes so
    // Render free tier never puts the service to sleep.
    const appUrl = process.env.APP_URL;
    if (appUrl && appUrl.startsWith('https')) {
      setInterval(async () => {
        try {
          await fetch(`${appUrl}/api/health`);
          console.log('✅ Keep-alive ping sent');
        } catch (e) {
          console.warn('⚠️ Keep-alive ping failed:', e.message);
        }
      }, 10 * 60 * 1000); // every 10 minutes
      console.log('🔁 Keep-alive pinger started (every 10 min)');
    }

    process.on('unhandledRejection', (err) => {
      console.error(`Unhandled Rejection Error: ${err.message}`, err);
      process.exit(1);
    });
  } catch (err) {
    console.error(`Startup Error: ${err.message}`, err);
    process.exit(1);
  }
})();
