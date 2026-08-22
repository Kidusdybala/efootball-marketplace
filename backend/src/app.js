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
  const { getBot } = require('./telegram/botInstance');
  try {
    const bot = getBot();
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.sendStatus(500);
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(require('./middleware/errorHandler'));

module.exports = app;
