import User from '../models/User.js';
import Listing from '../models/Listing.js';
import Transaction from '../models/Transaction.js';
import Report from '../models/Report.js';
import AccountCredentials from '../models/AccountCredentials.js';
import Notification from '../models/Notification.js';
import Message from '../models/Message.js';
import { AppError } from '../middleware/errorHandler.js';
import { notifyUser, notifyAdmins } from '../services/notificationService.js';

async function getDashboardStats(c) {
  try {
    const [
      totalUsers, totalListings, pendingListings,
      totalTransactions, completedTransactions, pendingTransactions, disputedTransactions,
      openReports, totalRevenue, verifiedSellers,
    ] = await Promise.all([
      User.countDocuments(),
      Listing.countDocuments(),
      Listing.countDocuments({ status: 'pending_review' }),
      Transaction.countDocuments(),
      Transaction.countDocuments({ status: 'completed' }),
      Transaction.countDocuments({ status: { $in: ['pending', 'negotiating', 'waiting_payment', 'paid', 'credentials_submitted', 'verified', 'credentials_sent', 'buyer_confirmed'] } }),
      Transaction.countDocuments({ status: 'disputed' }),
      Report.countDocuments({ status: 'open' }),
      Transaction.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$serviceFee' } } },
      ]),
      User.countDocuments({ role: 'seller', isVerified: true }),
    ]);
    const recentListings = await Listing.find({ status: 'pending_review' }).populate('sellerId', 'username').limit(10).sort({ createdAt: -1 });
    const recentTransactions = await Transaction.find({}).populate('buyerId sellerId', 'username').populate('listingId', 'title price').limit(10).sort({ createdAt: -1 });
    const recentReports = await Report.find({ status: 'open' }).populate('reporterId', 'username').limit(10).sort({ priority: -1, createdAt: -1 });
    return c.json({
      success: true,
      data: {
        stats: {
          totalUsers, totalListings, pendingListings,
          totalTransactions, completedTransactions, pendingTransactions, disputedTransactions,
          openReports,
          totalRevenue: totalRevenue[0]?.total || 0,
          verifiedSellers,
        },
        recentListings, recentTransactions, recentReports,
      },
    });
  } catch (err) {
    throw err;
  }
}

async function banUser(c) {
  try {
    const body = await c.req.json();
    const { reason } = body;
    const user = await User.findById(c.req.param('id'));
    if (!user) throw new AppError('User not found', 404);
    if (user.role === 'admin') throw new AppError('Cannot ban admin', 400);
    user.status = 'banned';
    user.banReason = reason || 'Violation of marketplace rules';
    await user.save();
    await Listing.updateMany({ sellerId: user._id, status: { $in: ['available', 'reserved', 'pending_review'] } }, { $set: { status: 'deleted' } });
    await notifyUser({
      userId: user._id,
      type: 'user_banned',
      title: 'Account Banned',
      message: `Your account has been banned.\nReason: ${user.banReason}\nContact admin to appeal.`,
      viaTelegram: true,
    });
    return c.json({ success: true, data: user, message: 'User banned' });
  } catch (err) {
    throw err;
  }
}

async function unbanUser(c) {
  try {
    const user = await User.findById(c.req.param('id'));
    if (!user) throw new AppError('User not found', 404);
    user.status = 'active';
    user.banReason = undefined;
    await user.save();
    return c.json({ success: true, data: user });
  } catch (err) {
    throw err;
  }
}

async function verifyUser(c) {
  try {
    const user = await User.findById(c.req.param('id'));
    if (!user) throw new AppError('User not found', 404);
    user.isVerified = true;
    user.status = 'active';
    await user.save();
    await notifyUser({
      userId: user._id,
      type: 'user_verified',
      title: 'Account Verified!',
      message: `Congratulations @${user.username}! Your account has been verified.`,
      viaTelegram: true,
    });
    return c.json({ success: true, data: user });
  } catch (err) {
    throw err;
  }
}

async function setUserRole(c) {
  try {
    const body = await c.req.json();
    const { role } = body;
    if (!['buyer', 'seller', 'admin'].includes(role)) {
      throw new AppError('Invalid role', 400);
    }
    const user = await User.findById(c.req.param('id'));
    if (!user) throw new AppError('User not found', 404);
    user.role = role;
    await user.save();
    return c.json({ success: true, data: user });
  } catch (err) {
    throw err;
  }
}

async function getCredentials(c) {
  try {
    const { listingId } = c.req.param();
    const creds = await AccountCredentials.findOne({ listingId });
    if (!creds) throw new AppError('No credentials found', 404);
    const decrypted = await creds.getAllDecrypted();
    return c.json({ success: true, data: decrypted, verificationStatus: creds.verificationStatus });
  } catch (err) {
    throw err;
  }
}

async function markCredentialsVerified(c) {
  try {
    const body = await c.req.json();
    const { verified, note } = body;
    const { listingId } = c.req.param();
    const creds = await AccountCredentials.findOne({ listingId });
    if (!creds) throw new AppError('No credentials found', 404);
    creds.verificationStatus = verified ? 'verified' : 'failed';
    creds.verifiedBy = c.get('user')._id;
    creds.verifiedAt = new Date();
    creds.notes = note;
    await creds.save();
    return c.json({ success: true, data: { verificationStatus: creds.verificationStatus } });
  } catch (err) {
    throw err;
  }
}

async function getGrowthStats(c) {
  try {
    const days = Number(c.req.query('days')) || 30;
    const now = new Date();
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const [dailyUsers, dailyListings, dailyTransactions, dailyRevenue] = await Promise.all([
      User.aggregate([
        { $match: { createdAt: { $gte: start } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Listing.aggregate([
        { $match: { createdAt: { $gte: start } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Transaction.aggregate([
        { $match: { createdAt: { $gte: start } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Transaction.aggregate([
        { $match: { status: 'completed', releasedAt: { $gte: start } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$releasedAt' } }, revenue: { $sum: '$serviceFee' } } },
        { $sort: { _id: 1 } },
      ]),
    ]);
    return c.json({ success: true, data: { dailyUsers, dailyListings, dailyTransactions, dailyRevenue } });
  } catch (err) {
    throw err;
  }
}

async function sendBroadcast(c) {
  try {
    const body = await c.req.json();
    const { title, message, targetRoles = ['buyer', 'seller', 'admin'] } = body;
    if (!title || !message) throw new AppError('Title and message required', 400);
    const users = await User.find({ role: { $in: targetRoles }, status: 'active' });
    let sent = 0;
    for (const user of users) {
      try {
        await Notification.create({
          userId: user._id,
          type: 'welcome',
          title,
          message,
          channels: { inApp: true, telegram: !!user.telegramChatId, email: false },
        });
        sent++;
      } catch (e) {
        console.warn(`Failed to notify user ${user._id}`);
      }
    }
    return c.json({ success: true, message: `Broadcast sent to ${sent} users` });
  } catch (err) {
    throw err;
  }
}

export {
  getDashboardStats,
  banUser,
  unbanUser,
  verifyUser,
  setUserRole,
  getCredentials,
  markCredentialsVerified,
  getGrowthStats,
  sendBroadcast,
};
