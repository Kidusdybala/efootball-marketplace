const {
  getNotifications,
  markRead,
  markAllRead,
  createNotification,
} = require('../services/notificationService');
const { AppError } = require('../middleware/errorHandler');

exports.getMyNotifications = async (req, res, next) => {
  try {
    const { page, limit, onlyUnread } = req.query;
    const result = await getNotifications(req.user._id, {
      page: Number(page),
      limit: Number(limit),
      onlyUnread: onlyUnread === 'true',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

exports.markNotificationRead = async (req, res, next) => {
  try {
    const notif = await markRead(req.user._id, req.params.id);
    if (!notif) return next(new AppError('Notification not found', 404));
    res.json({ success: true, data: notif });
  } catch (err) {
    next(err);
  }
};

exports.markAllRead = async (req, res, next) => {
  try {
    const result = await markAllRead(req.user._id);
    res.json({ success: true, message: `Marked ${result.modifiedCount || 0} notifications as read` });
  } catch (err) {
    next(err);
  }
};

exports.createTestNotification = async (req, res, next) => {
  try {
    const { title, message, type = 'welcome', viaTelegram = false } = req.body;
    const { notifyUser } = require('../services/notificationService');
    const notif = await notifyUser({
      userId: req.user._id,
      type,
      title: title || 'Test Notification',
      message: message || 'This is a test notification',
      viaTelegram,
    });
    res.json({ success: true, data: notif });
  } catch (err) {
    next(err);
  }
};
