const Notification = require('../models/Notification');

const createNotification = async ({
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
}) => {
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
};

const notifyUser = async ({
  userId,
  type,
  title,
  message,
  listingId,
  transactionId,
  senderId,
  data,
  viaTelegram = false,
}) => {
  const User = require('../models/User');
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
      const { sendTelegramNotification } = require('../telegram/bot');
      await sendTelegramNotification(user.telegramChatId, `${title}\n\n${message}`);
      notification.telegramSent = true;
      await notification.save();
    } catch (err) {
      console.error('Telegram notification failed:', err.message);
    }
  }
  return notification;
};

const getAdminIds = () => {
  const ids = (process.env.ADMIN_TELEGRAM_IDS || '').split(',').filter(Boolean);
  return ids;
};

const notifyAdmins = async (type, title, message, extra = {}) => {
  const User = require('../models/User');
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
};

const getNotifications = async (userId, { page = 1, limit = 20, onlyUnread = false }) => {
  const query = { userId };
  if (onlyUnread) query.isRead = false;
  const skip = (page - 1) * limit;
  const notifications = await Notification.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
  const total = await Notification.countDocuments(query);
  const unread = await Notification.countDocuments({ userId, isRead: false });
  return { notifications, total, unread, page, limit };
};

const markRead = async (userId, notificationId) => {
  return Notification.findOneAndUpdate(
    { _id: notificationId, userId },
    { isRead: true, readAt: new Date() },
    { new: true }
  );
};

const markAllRead = async (userId) => {
  return Notification.updateMany(
    { userId, isRead: false },
    { isRead: true, readAt: new Date() }
  );
};

module.exports = {
  createNotification,
  notifyUser,
  notifyAdmins,
  getAdminIds,
  getNotifications,
  markRead,
  markAllRead,
};
