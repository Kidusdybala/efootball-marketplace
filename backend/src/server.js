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

    process.on('unhandledRejection', (err) => {
      console.error(`Unhandled Rejection Error: ${err.message}`, err);
      process.exit(1);
    });
  } catch (err) {
    console.error(`Startup Error: ${err.message}`, err);
    process.exit(1);
  }
})();
