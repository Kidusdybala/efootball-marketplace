import { AppError } from '../middleware/errorHandler.js';
import {
  getNotifications,
  markRead,
  markAllRead,
  createNotification,
  notifyUser,
} from '../services/notificationService.js';

async function getMyNotifications(c) {
  try {
    const { page, limit, onlyUnread } = c.req.query();
    const result = await getNotifications(c.get('user')._id, {
      page: Number(page),
      limit: Number(limit),
      onlyUnread: onlyUnread === 'true',
    });
    return c.json({ success: true, ...result });
  } catch (err) {
    throw err;
  }
}

async function markNotificationRead(c) {
  try {
    const notif = await markRead(c.get('user')._id, c.req.param('id'));
    if (!notif) throw new AppError('Notification not found', 404);
    return c.json({ success: true, data: notif });
  } catch (err) {
    throw err;
  }
}

async function markAllNotificationsRead(c) {
  try {
    const result = await markAllRead(c.get('user')._id);
    return c.json({ success: true, message: `Marked ${result.modified || 0} notifications as read` });
  } catch (err) {
    throw err;
  }
}

async function createTestNotification(c) {
  try {
    const body = await c.req.json();
    const { title, message, type = 'welcome', viaTelegram = false } = body;
    const notif = await notifyUser({
      userId: c.get('user')._id,
      type,
      title: title || 'Test Notification',
      message: message || 'This is a test notification',
      viaTelegram,
    });
    return c.json({ success: true, data: notif });
  } catch (err) {
    throw err;
  }
}

export {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  createTestNotification,
};
