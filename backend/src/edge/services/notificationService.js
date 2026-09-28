import Notification from '../models/Notification.js';
import User from '../models/User.js';
import * as Telegram from '../telegram.js';
import { NOTIFICATION_TYPES } from '../models/Notification.js';

async function createNotification({
  userId,
  type,
  title,
  message,
  listingId = null,
  transactionId = null,
  reportId = null,
  senderId = null,
  data = {},
  channels = { inApp: true, telegram: false, email: false },
}) {
  const notification = await Notification.create({
    userId,
    type,
    title,
    message,
    listingId,
    transactionId,
    reportId,
    senderId,
    data,
    channels,
  });
  return notification;
}

async function notifyUser({
  userId,
  type,
  title,
  message,
  listingId,
  transactionId,
  senderId,
  data,
  viaTelegram = false,
}) {
  const user = await User.findById(userId);
  if (!user) return null;
  const channels = {
    inApp: true,
    telegram: viaTelegram && user.preferences?.notifyTelegram && !!user.telegramChatId,
    email: user.preferences?.notifyEmail && !!user.email,
  };
  const notification = await createNotification({
    userId,
    type,
    title,
    message,
    listingId,
    transactionId,
    senderId,
    data,
    channels,
  });
  if (channels.telegram) {
    try {
      await Telegram.sendMessage(user.telegramChatId, `${title}\n\n${message}`, { parse_mode: 'HTML' });
      notification.telegramSent = true;
      await notification.save();
    } catch (err) {
      console.error('Telegram notification failed:', err.message);
    }
  }
  return notification;
}

function getAdminIds() {
  const ids = (process.env.ADMIN_TELEGRAM_IDS || '').split(',').filter(Boolean);
  return ids;
}

async function notifyAdmins(type, title, message, extra = {}) {
  const admins = await User.find({ role: 'admin' });
  const results = [];
  for (const admin of admins) {
    results.push(await notifyUser({
      userId: admin._id,
      type,
      title,
      message,
      ...extra,
      viaTelegram: true,
    }));
  }
  return results;
}

async function getNotifications(userId, { page = 1, limit = 20, onlyUnread = false }) {
  const query = { userId };
  if (onlyUnread) query.isRead = false;
  const qb = Notification.find(query);
  qb.sort({ createdAt: -1 });
  qb.skip((page - 1) * limit);
  qb.limit(limit);
  const notifications = await qb.exec();
  const total = await Notification.countDocuments(query);
  const unread = await Notification.countDocuments({ userId, isRead: false });
  return { notifications, total, unread, page, limit };
}

async function markRead(userId, notificationId) {
  return Notification.findOneAndUpdate(
    { _id: notificationId, userId },
    { isRead: true, readAt: new Date() },
    { new: true },
  );
}

async function markAllRead(userId) {
  return Notification.updateMany(
    { userId, isRead: false },
    { isRead: true, readAt: new Date() },
  );
}

export {
    createNotification,
    notifyUser,
    notifyAdmins,
    getAdminIds,
    getNotifications,
    markRead,
    markAllRead,
    NOTIFICATION_TYPES,
};
