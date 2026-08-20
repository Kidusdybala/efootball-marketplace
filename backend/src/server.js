require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const { initTelegramBot } = require('./telegram/bot');

const PORT = process.env.PORT || 5000;

connectDB();

const server = app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

initTelegramBot(server);

process.on('unhandledRejection', (err) => {
  console.error(`Unhandled Rejection Error: ${err.message}`, err);
  // We no longer crash the server on unhandled rejections to prevent Telegram bot errors from bringing down the entire application.
});
