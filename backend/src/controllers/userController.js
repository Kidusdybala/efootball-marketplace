const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const { AppError } = require('../middleware/errorHandler');

exports.getAllUsers = async (req, res, next) => {
  try {
    const { role, status, verified, search, page = 1, limit = 20 } = req.query;
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
    const skip = (page - 1) * limit;
    const users = await User.find(query).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit);
    const total = await User.countDocuments(query);
    res.json({ success: true, data: users, total, page, limit });
  } catch (err) {
    next(err);
  }
};

exports.getUserById = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return next(new AppError('User not found', 404));
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};

exports.getUserByUsername = async (req, res, next) => {
  try {
    const user = await User.findOne({ username: req.params.username }).select('-password');
    if (!user) return next(new AppError('User not found', 404));
    const listings = await Listing.find({ sellerId: user._id, status: { $in: ['available', 'reserved'] } }).sort({ createdAt: -1 }).limit(20);
    const sales = await Transaction.countDocuments({ sellerId: user._id, status: 'completed' });
    const buys = await Transaction.countDocuments({ buyerId: user._id, status: 'completed' });
    res.json({ success: true, data: { user, listings, stats: { sales, buys } } });
  } catch (err) {
    next(err);
  }
};

exports.getUserStats = async (req, res, next) => {
  try {
    const userId = req.params.id || req.user._id;
    const [activeListings, soldListings, purchases, sales, ratingsGiven, ratingsReceived] = await Promise.all([
      Listing.countDocuments({ sellerId: userId, status: { $in: ['available', 'reserved'] } }),
      Listing.countDocuments({ sellerId: userId, status: 'sold' }),
      Transaction.countDocuments({ buyerId: userId, status: 'completed' }),
      Transaction.countDocuments({ sellerId: userId, status: 'completed' }),
      Transaction.find({ buyerId: userId, buyerRating: { $exists: true } }).countDocuments(),
      Transaction.find({ sellerId: userId, sellerRating: { $exists: true } }).countDocuments(),
    ]);
    const recentTransactions = await Transaction.find({
      $or: [{ buyerId: userId }, { sellerId: userId }],
      status: 'completed',
    }).sort({ completedAt: -1 }).limit(10).populate('listingId', 'title images price');
    res.json({
      success: true,
      data: {
        activeListings, soldListings, purchases, sales,
        ratingsGiven, ratingsReceived, recentTransactions,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.rateUser = async (req, res, next) => {
  try {
    const { transactionId, rating, feedback, targetRole } = req.body;
    if (!rating || rating < 1 || rating > 5) return next(new AppError('Rating must be 1-5', 400));
    if (!transactionId) return next(new AppError('Transaction ID required', 400));

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) return next(new AppError('Transaction not found', 404));
    if (transaction.status !== 'completed') return next(new AppError('Can only rate completed transactions', 400));

    let targetUser;
    if (targetRole === 'seller') {
      if (String(transaction.buyerId) !== String(req.user._id)) {
        return next(new AppError('Only buyer can rate seller', 403));
      }
      if (transaction.sellerRating) return next(new AppError('Already rated this seller', 400));
      transaction.sellerRating = rating;
      transaction.sellerFeedback = feedback;
      targetUser = await User.findById(transaction.sellerId);
      await targetUser.addRating(rating, 'seller');
    } else {
      if (String(transaction.sellerId) !== String(req.user._id)) {
        return next(new AppError('Only seller can rate buyer', 403));
      }
      if (transaction.buyerRating) return next(new AppError('Already rated this buyer', 400));
      transaction.buyerRating = rating;
      transaction.buyerFeedback = feedback;
      targetUser = await User.findById(transaction.buyerId);
      await targetUser.addRating(rating, 'buyer');
    }
    await transaction.save();
    res.json({ success: true, data: transaction, message: 'Rating submitted' });
  } catch (err) {
    next(err);
  }
};

exports.submitVerification = async (req, res, next) => {
  try {
    const { docs } = req.body;
    if (!docs || !docs.length) return next(new AppError('Please upload verification documents', 400));
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { verificationDocs: docs, status: 'pending' },
      { new: true }
    );
    res.json({ success: true, data: user, message: 'Verification submitted for review' });
  } catch (err) {
    next(err);
  }
};
