import User from '../models/User.js';
import Listing from '../models/Listing.js';
import Transaction from '../models/Transaction.js';
import { AppError } from '../middleware/errorHandler.js';

async function getAllUsers(c) {
  try {
    const { role, status, verified, search, page = 1, limit = 20 } = c.req.query();
    const query = {};
    if (role) query.role = role;
    if (status) query.status = status;
    if (verified === 'true') query.isVerified = true;
    if (verified === 'false') query.isVerified = false;
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { telegramId: search },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const users = await User.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit));
    const total = await User.countDocuments(query);
    return c.json({ success: true, data: users, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    throw err;
  }
}

async function getUserById(c) {
  try {
    const user = await User.findById(c.req.param('id'));
    if (!user) throw new AppError('User not found', 404);
    return c.json({ success: true, data: user });
  } catch (err) {
    throw err;
  }
}

async function getUserByUsername(c) {
  try {
    const user = await User.findOne({ username: c.req.param('username') });
    if (!user) throw new AppError('User not found', 404);
    const listings = await Listing.find({ sellerId: user._id, status: { $in: ['available', 'reserved'] } }).sort({ createdAt: -1 }).limit(20);
    const sales = await Transaction.countDocuments({ sellerId: user._id, status: 'completed' });
    const buys = await Transaction.countDocuments({ buyerId: user._id, status: 'completed' });
    return c.json({ success: true, data: { user, listings, stats: { sales, buys } } });
  } catch (err) {
    throw err;
  }
}

async function getUserStats(c) {
  try {
    const userId = c.req.param('id') || c.get('user')._id;
    const [
      activeListings, soldListings, purchases, sales,
      ratingsGiven, ratingsReceived,
    ] = await Promise.all([
      Listing.countDocuments({ sellerId: userId, status: { $in: ['available', 'reserved'] } }),
      Listing.countDocuments({ sellerId: userId, status: 'sold' }),
      Transaction.countDocuments({ buyerId: userId, status: 'completed' }),
      Transaction.countDocuments({ sellerId: userId, status: 'completed' }),
      Transaction.countDocuments({ buyerId: userId, buyerRating: { $exists: true } }),
      Transaction.countDocuments({ sellerId: userId, sellerRating: { $exists: true } }),
    ]);
    const recentTx = Transaction.find({
      $or: [{ buyerId: userId }, { sellerId: userId }],
      status: 'completed',
    });
    recentTx.sort({ completedAt: -1 });
    recentTx.limit(10);
    recentTx.populate('listingId', 'title images price');
    const recentTransactions = await recentTx.exec();
    return c.json({
      success: true,
      data: {
        activeListings, soldListings, purchases, sales,
        ratingsGiven, ratingsReceived, recentTransactions,
      },
    });
  } catch (err) {
    throw err;
  }
}

async function rateUser(c) {
  try {
    const body = await c.req.json();
    const { transactionId, rating, feedback, targetRole } = body;
    if (!rating || rating < 1 || rating > 5) throw new AppError('Rating must be 1-5', 400);
    if (!transactionId) throw new AppError('Transaction ID required', 400);

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) throw new AppError('Transaction not found', 404);
    if (transaction.status !== 'completed') throw new AppError('Can only rate completed transactions', 400);

    let targetUser;
    if (targetRole === 'seller') {
      if (String(transaction.buyerId) !== String(c.get('user')._id)) {
        throw new AppError('Only buyer can rate seller', 403);
      }
      if (transaction.sellerRating) throw new AppError('Already rated this seller', 400);
      transaction.sellerRating = rating;
      transaction.sellerFeedback = feedback;
      targetUser = await User.findById(transaction.sellerId);
      await targetUser.addRating(rating, 'seller');
    } else {
      if (String(transaction.sellerId) !== String(c.get('user')._id)) {
        throw new AppError('Only seller can rate buyer', 403);
      }
      if (transaction.buyerRating) throw new AppError('Already rated this buyer', 400);
      transaction.buyerRating = rating;
      transaction.buyerFeedback = feedback;
      targetUser = await User.findById(transaction.buyerId);
      await targetUser.addRating(rating, 'buyer');
    }
    await transaction.save();
    return c.json({ success: true, data: transaction, message: 'Rating submitted' });
  } catch (err) {
    throw err;
  }
}

async function submitVerification(c) {
  try {
    const body = await c.req.json();
    const { docs } = body;
    if (!docs || !docs.length) throw new AppError('Please upload verification documents', 400);
    const user = await User.findByIdAndUpdate(
      c.get('user')._id,
      { verificationDocs: docs, status: 'pending' },
      { new: true },
    );
    return c.json({ success: true, data: user, message: 'Verification submitted for review' });
  } catch (err) {
    throw err;
  }
}

export {
  getAllUsers,
  getUserById,
  getUserByUsername,
  getUserStats,
  rateUser,
  submitVerification,
};
