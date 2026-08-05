const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Report = require('../models/Report');
const AccountCredentials = require('../models/AccountCredentials');
const Notification = require('../models/Notification');
const Message = require('../models/Message');
const { AppError } = require('../middleware/errorHandler');
const { notifyUser, notifyAdmins } = require('../services/notificationService');

exports.getDashboardStats = async (req, res, next) => {
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
    const recentListings = await Listing.find({ status: 'pending_review' })
      .populate('sellerId', 'username')
      .limit(10).sort({ createdAt: -1 });
    const recentTransactions = await Transaction.find({})
      .populate('buyerId sellerId', 'username')
      .populate('listingId', 'title price')
      .limit(10).sort({ createdAt: -1 });
    const recentReports = await Report.find({ status: 'open' })
      .populate('reporterId', 'username')
      .limit(10).sort({ priority: -1, createdAt: -1 });
    res.json({
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
    next(err);
  }
};

exports.banUser = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError('User not found', 404));
    if (user.role === 'admin') return next(new AppError('Cannot ban admin', 400));
    user.status = 'banned';
    user.banReason = reason || 'Violation of marketplace rules';
    await user.save();
    await Listing.updateMany({ sellerId: user._id, status: { $in: ['available', 'reserved', 'pending_review'] } }, { status: 'deleted' });
    await notifyUser({
      userId: user._id,
      type: 'user_banned',
      title: '🚫 Account Banned',
      message: `Your account has been banned.\nReason: ${user.banReason}\nContact admin to appeal.`,
      viaTelegram: true,
    });
    res.json({ success: true, data: user, message: 'User banned' });
  } catch (err) {
    next(err);
  }
};

exports.unbanUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError('User not found', 404));
    user.status = 'active';
    user.banReason = undefined;
    await user.save();
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};

exports.verifyUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError('User not found', 404));
    user.isVerified = true;
    user.status = 'active';
    await user.save();
    await notifyUser({
      userId: user._id,
      type: 'user_verified',
      title: '✅ Account Verified!',
      message: `Congratulations @${user.username}! Your account has been verified. Verified sellers get more trust and visibility.`,
      viaTelegram: true,
    });
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};

exports.setUserRole = async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!['buyer', 'seller', 'admin'].includes(role)) {
      return next(new AppError('Invalid role', 400));
    }
    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError('User not found', 404));
    user.role = role;
    await user.save();
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};

exports.getCredentials = async (req, res, next) => {
  try {
    const { listingId } = req.params;
    const creds = await AccountCredentials.findOne({ listingId });
    if (!creds) return next(new AppError('No credentials found', 404));
    res.json({ success: true, data: creds.getAllDecrypted(), verificationStatus: creds.verificationStatus });
  } catch (err) {
    next(err);
  }
};

exports.markCredentialsVerified = async (req, res, next) => {
  try {
    const { verified, note } = req.body;
    const { listingId } = req.params;
    const creds = await AccountCredentials.findOne({ listingId });
    if (!creds) return next(new AppError('No credentials found', 404));
    creds.verificationStatus = verified ? 'verified' : 'failed';
    creds.verifiedBy = req.user._id;
    creds.verifiedAt = new Date();
    creds.notes = note;
    await creds.save();
    res.json({ success: true, data: { verificationStatus: creds.verificationStatus } });
  } catch (err) {
    next(err);
  }
};

exports.getGrowthStats = async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
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
    res.json({ success: true, data: { dailyUsers, dailyListings, dailyTransactions, dailyRevenue } });
  } catch (err) {
    next(err);
  }
};

exports.sendBroadcast = async (req, res, next) => {
  try {
    const { title, message, targetRoles = ['buyer', 'seller', 'admin'] } = req.body;
    if (!title || !message) return next(new AppError('Title and message required', 400));
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
    res.json({ success: true, message: `Broadcast sent to ${sent} users` });
  } catch (err) {
    next(err);
  }
};
