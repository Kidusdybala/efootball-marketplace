const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.APP_URL || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
});
app.use('/api', limiter);

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/listings', require('./routes/listingRoutes'));
app.use('/api/transactions', require('./routes/transactionRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));
app.use('/api/messages', require('./routes/messageRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));

app.post('/api/telegram/webhook', (req, res) => {
  // Acknowledge Telegram IMMEDIATELY — must respond within 5s or Telegram
  // marks it failed and stops retrying. We process the update after.
  res.sendStatus(200);

  const { getBot } = require('./telegram/botInstance');
  try {
    console.log('📨 Telegram webhook received:', JSON.stringify(req.body).slice(0, 150));
    const bot = getBot();
    bot.processUpdate(req.body);
  } catch (err) {
    console.error('Webhook processing error:', err);
  }
});

// Diagnostic: check webhook status with Telegram
app.get('/api/telegram/webhook-info', async (req, res) => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return res.status(500).json({ error: 'No bot token configured' });
    const r = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Force re-register the webhook (call this if the bot stops responding)
app.get('/api/telegram/set-webhook', async (req, res) => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const appUrl = process.env.APP_URL || process.env.API_URL;
    if (!token) return res.status(500).json({ error: 'No bot token' });
    if (!appUrl) return res.status(500).json({ error: 'No APP_URL set' });
    const webhookUrl = `${appUrl}/api/telegram/webhook`;
    const allowedUpdates = ['message', 'callback_query', 'channel_post', 'edited_message'];
    const r = await fetch(
      `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}&allowed_updates=${encodeURIComponent(JSON.stringify(allowedUpdates))}`
    );
    const data = await r.json();
    console.log('🔗 Webhook manually set:', data);
    res.json({ webhookUrl, allowedUpdates, result: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(require('./middleware/errorHandler'));

module.exports = app;
