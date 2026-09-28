import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { trimTrailingSlash } from 'hono/trailing-slash';
import { prettyJSON } from 'hono/pretty-json';

import { protect, isAdmin, isSellerOrAdmin, isNotBanned } from './auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { handleWebhook } from './bot.js';

import {
  register,
  login,
  telegramAuth,
  me,
  updateMe,
  changePassword,
  upgradeToSeller,
} from './controllers/authController.js';

import {
  getAllUsers,
  getUserById,
  getUserByUsername,
  getUserStats,
  rateUser,
  submitVerification,
} from './controllers/userController.js';

import {
  createListing,
  getListings,
  getPendingListings,
  getListingById,
  getMyListings,
  updateListing,
  deleteListing,
  reserveListing,
  approveListing,
  rejectListing,
  toggleFavorite,
  getFavorites,
  markAsSold,
} from './controllers/listingController.js';

import {
  createTransaction,
  getMyTransactions,
  getTransaction,
  updateStatus,
  submitPaymentProof,
  submitCredentials,
  getAllTransactions,
  openDispute,
  resolveDispute,
} from './controllers/transactionController.js';

import {
  createReport,
  getMyReports,
  getAllReports,
  getReport,
  assignReport,
  updateReportStatus,
} from './controllers/reportController.js';

import {
  sendMessage,
  getConversation,
  getConversationsList,
  markConversationRead,
  getUnreadCount,
} from './controllers/messageController.js';

import {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  createTestNotification,
} from './controllers/notificationController.js';

import {
  getDashboardStats,
  banUser,
  unbanUser,
  verifyUser,
  setUserRole,
  getCredentials,
  markCredentialsVerified,
  getGrowthStats,
  sendBroadcast,
} from './controllers/adminController.js';

const app = new Hono();

app.use('*', cors({ origin: '*', credentials: true }));
app.use('*', logger());
app.use('*', trimTrailingSlash());
if (process.env.NODE_ENV === 'development') {
  app.use('*', prettyJSON());
}

app.onError((err, c) => errorHandler(err, c));

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.post('/telegram/webhook', async (c) => {
  const update = await c.req.json();
  return handleWebhook(c.env, update);
});

app.get('/telegram/webhook-info', async (c) => {
  const token = c.env.TELEGRAM_BOT_TOKEN;
  if (!token) return c.json({ error: 'No bot token configured' }, 500);
  const r = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const data = await r.json();
  return c.json(data);
});

app.get('/telegram/set-webhook', async (c) => {
  const token = c.env.TELEGRAM_BOT_TOKEN;
  if (!token) return c.json({ error: 'No bot token' }, 500);
  const webhookUrl = c.env.APP_URL;
  if (!webhookUrl) return c.json({ error: 'No APP_URL set' }, 500);
  const webhookEndpoint = `${webhookUrl}/api/telegram/webhook`;
  const allowedUpdates = ['message', 'callback_query', 'channel_post', 'edited_message'];
  const r = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookEndpoint)}&allowed_updates=${encodeURIComponent(JSON.stringify(allowedUpdates))}`,
  );
  const data = await r.json();
  return c.json({ webhookUrl: webhookEndpoint, allowedUpdates, result: data });
});

const authRoutes = new Hono();
authRoutes.post('/register', register);
authRoutes.post('/login', login);
authRoutes.post('/telegram', telegramAuth);
authRoutes.get('/me', protect(), me);
authRoutes.put('/update-me', protect(), updateMe);
authRoutes.put('/change-password', protect(), changePassword);
authRoutes.put('/upgrade-seller', protect(), upgradeToSeller);
app.route('/api/auth', authRoutes);

const userRoutes = new Hono();
userRoutes.get('/', protect(), isAdmin, getAllUsers);
userRoutes.get('/stats/me', protect(), getUserStats);
userRoutes.get('/stats/:id', protect(), getUserStats);
userRoutes.get('/username/:username', getUserByUsername);
userRoutes.get('/:id', protect(), getUserById);
userRoutes.post('/rate', protect(), rateUser);
userRoutes.post('/submit-verification', protect(), submitVerification);
app.route('/api/users', userRoutes);

const listingRoutes = new Hono();
listingRoutes.get('/', getListings);
listingRoutes.get('/pending', protect(), isAdmin, getPendingListings);
listingRoutes.get('/mine', protect(), getMyListings);
listingRoutes.get('/favorites', protect(), getFavorites);
listingRoutes.get('/:id', getListingById);
listingRoutes.post('/', protect(), isNotBanned, isSellerOrAdmin, createListing);
listingRoutes.post('/:id/reserve', protect(), reserveListing);
listingRoutes.post('/:id/favorite', protect(), toggleFavorite);
listingRoutes.post('/:id/sold', protect(), markAsSold);
listingRoutes.put('/:id', protect(), updateListing);
listingRoutes.delete('/:id', protect(), deleteListing);
listingRoutes.post('/:id/approve', protect(), isAdmin, approveListing);
listingRoutes.post('/:id/reject', protect(), isAdmin, rejectListing);
app.route('/api/listings', listingRoutes);

const transactionRoutes = new Hono();
transactionRoutes.get('/', protect(), getMyTransactions);
transactionRoutes.get('/all', protect(), isAdmin, getAllTransactions);
transactionRoutes.get('/:id', protect(), getTransaction);
transactionRoutes.post('/', protect(), createTransaction);
transactionRoutes.put('/:id/status', protect(), updateStatus);
transactionRoutes.put('/:id/payment-proof', protect(), submitPaymentProof);
transactionRoutes.put('/:id/submit-credentials', protect(), submitCredentials);
transactionRoutes.post('/:id/dispute', protect(), openDispute);
transactionRoutes.post('/:id/resolve', protect(), isAdmin, resolveDispute);
app.route('/api/transactions', transactionRoutes);

const reportRoutes = new Hono();
reportRoutes.get('/mine', protect(), getMyReports);
reportRoutes.get('/', protect(), isAdmin, getAllReports);
reportRoutes.get('/:id', protect(), getReport);
reportRoutes.post('/', protect(), createReport);
reportRoutes.put('/:id/assign', protect(), isAdmin, assignReport);
reportRoutes.put('/:id/status', protect(), isAdmin, updateReportStatus);
app.route('/api/reports', reportRoutes);

const messageRoutes = new Hono();
messageRoutes.get('/conversations', protect(), getConversationsList);
messageRoutes.get('/unread-count', protect(), getUnreadCount);
messageRoutes.get('/conversation/:otherUserId/:listingId?', protect(), getConversation);
messageRoutes.get('/conversation/:otherUserId', protect(), getConversation);
messageRoutes.post('/', protect(), sendMessage);
messageRoutes.post('/mark-read/:conversationId', protect(), markConversationRead);
app.route('/api/messages', messageRoutes);

const notificationRoutes = new Hono();
notificationRoutes.get('/', protect(), getMyNotifications);
notificationRoutes.put('/:id/read', protect(), markNotificationRead);
notificationRoutes.put('/read-all', protect(), markAllNotificationsRead);
notificationRoutes.post('/test', protect(), createTestNotification);
app.route('/api/notifications', notificationRoutes);

const adminRoutes = new Hono();
adminRoutes.use('*', protect(), isAdmin);
adminRoutes.get('/stats', getDashboardStats);
adminRoutes.get('/growth', getGrowthStats);
adminRoutes.get('/credentials/:listingId', getCredentials);
adminRoutes.put('/credentials/:listingId/verify', markCredentialsVerified);
adminRoutes.get('/pending-listings', getPendingListings);
adminRoutes.post('/listings/:id/approve', approveListing);
adminRoutes.post('/listings/:id/reject', rejectListing);
adminRoutes.put('/users/:id/ban', banUser);
adminRoutes.put('/users/:id/unban', unbanUser);
adminRoutes.put('/users/:id/verify', verifyUser);
adminRoutes.put('/users/:id/role', setUserRole);
adminRoutes.post('/broadcast', sendBroadcast);
app.route('/api/admin', adminRoutes);

export default app;
export { app };
