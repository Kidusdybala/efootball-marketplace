const Listing = require('../models/Listing');
const AccountCredentials = require('../models/AccountCredentials');
const User = require('../models/User');
const { AppError } = require('../middleware/errorHandler');
const { notifyUser, notifyAdmins } = require('../services/notificationService');
const { formatMoney } = require('../utils/money');

exports.createListing = async (req, res, next) => {
  try {
    const sellerId = req.user._id;
    if (req.user.status === 'banned') {
      return next(new AppError('Account is banned', 403));
    }
    const { credentials, title, price, platform, overall, description, ...rest } = req.body;
    if (!title || !price || !platform || !description) {
      return next(new AppError('Title, price, platform, and description are required', 400));
    }
    const listing = await Listing.create({
      sellerId,
      title,
      price: Number(price),
      platform,
      overall: overall ? Number(overall) : undefined,
      description,
      status: 'pending_review',
      ...rest,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 100) + '-' + Date.now(),
    });
    if (credentials && (credentials.email || credentials.password)) {
      const creds = new AccountCredentials({ listingId: listing._id });
      if (credentials.email) creds.setEmail(credentials.email);
      if (credentials.password) creds.setPassword(credentials.password);
      if (credentials.backupCodes) creds.setBackupCodes(credentials.backupCodes);
      if (credentials.twoFactorSecret) creds.setTwoFactorSecret(credentials.twoFactorSecret);
      if (credentials.additionalInfo) creds.setAdditionalInfo(credentials.additionalInfo);
      await creds.save();
    }
    await notifyAdmins('listing_approved', '📝 New Listing Pending Review',
      `New listing #${listing._id} by @${req.user.username}\n${title}\n${formatMoney(listing.price, listing.currency)} ${platform}`);
    res.status(201).json({ success: true, data: listing, message: 'Listing submitted for review' });
  } catch (err) {
    next(err);
  }
};

exports.getListings = async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const filters = req.query;
    const query = Listing.searchListings(filters);
    const docs = await query.skip(skip).limit(limit);
    const baseQuery = Listing.searchListings(filters);
    const total = await baseQuery.countDocuments();
    res.json({ success: true, data: docs, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

exports.getPendingListings = async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const listings = await Listing.find({ status: 'pending_review' })
      .populate('sellerId', 'username rating completedSales isVerified avatar telegramId')
      .sort({ createdAt: 1 })
      .skip(skip).limit(limit);
    const total = await Listing.countDocuments({ status: 'pending_review' });
    res.json({ success: true, data: listings, total, page, limit });
  } catch (err) {
    next(err);
  }
};

exports.getListingById = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id)
      .populate('sellerId', 'username rating ratingCount completedSales isVerified avatar');
    if (!listing) return next(new AppError('Listing not found', 404));
    listing.views += 1;
    await listing.save();
    const withFav = listing.toObject();
    withFav.isFavorited = listing.favorites?.includes(req.user?._id);
    res.json({ success: true, data: withFav });
  } catch (err) {
    next(err);
  }
};

exports.getMyListings = async (req, res, next) => {
  try {
    const { status } = req.query;
    const query = { sellerId: req.user._id };
    if (status) query.status = status;
    const listings = await Listing.find(query).sort({ createdAt: -1 });
    res.json({ success: true, data: listings });
  } catch (err) {
    next(err);
  }
};

exports.updateListing = async (req, res, next) => {
  try {
    const { status, views, channelMessageId, approvedBy, approvedAt, soldAt, soldTo, ...allowedFields } = req.body;
    const listing = await Listing.findById(req.params.id);
    if (!listing) return next(new AppError('Listing not found', 404));
    if (String(listing.sellerId) !== String(req.user._id) && req.user.role !== 'admin') {
      return next(new AppError('Not authorized to edit this listing', 403));
    }
    if (['available', 'sold', 'reserved'].includes(listing.status)) {
      return next(new AppError('Cannot edit active listing - create a new one', 400));
    }
    Object.assign(listing, allowedFields);
    listing.status = 'pending_review';
    await listing.save();
    res.json({ success: true, data: listing, message: 'Listing updated and resubmitted for review' });
  } catch (err) {
    next(err);
  }
};

exports.deleteListing = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return next(new AppError('Listing not found', 404));
    if (String(listing.sellerId) !== String(req.user._id) && req.user.role !== 'admin') {
      return next(new AppError('Not authorized to delete', 403));
    }
    listing.status = 'deleted';
    await listing.save();
    res.json({ success: true, message: 'Listing deleted' });
  } catch (err) {
    next(err);
  }
};

exports.reserveListing = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return next(new AppError('Listing not found', 404));
    if (listing.status !== 'available') return next(new AppError('Listing not available', 400));
    if (String(listing.sellerId) !== String(req.user._id)) {
      return next(new AppError('Only seller can reserve listing', 403));
    }
    const { buyerId } = req.body;
    if (!buyerId) return next(new AppError('Buyer ID required', 400));
    listing.status = 'reserved';
    listing.reservedBy = buyerId;
    listing.reservedAt = new Date();
    await listing.save();
    const buyer = await User.findById(buyerId);
    if (buyer) {
      await notifyUser({
        userId: buyerId,
        type: 'listing_reserved',
        title: '🟡 Listing Reserved',
        message: `Your offer for "${listing.title}" has been accepted. The listing is now reserved for you. Please proceed with payment.`,
        listingId: listing._id,
        senderId: req.user._id,
        viaTelegram: true,
      });
    }
    res.json({ success: true, data: listing });
  } catch (err) {
    next(err);
  }
};

exports.approveListing = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id).populate('sellerId');
    if (!listing) return next(new AppError('Listing not found', 404));
    if (listing.status !== 'pending_review') return next(new AppError('Listing not pending review', 400));
    listing.status = 'available';
    listing.approvedBy = req.user._id;
    listing.approvedAt = new Date();
    await listing.save();
    try {
      const { publishListingToChannel } = require('../telegram/bot');
      const msgId = await publishListingToChannel(listing);
      if (msgId) {
        listing.channelMessageId = String(msgId);
        await listing.save();
      }
    } catch (e) {
      console.warn('Channel publish failed:', e.message);
    }
    if (listing.sellerId) {
      await notifyUser({
        userId: listing.sellerId._id,
        type: 'listing_approved',
        title: '✅ Listing Approved!',
        message: `Your listing "${listing.title}" has been approved and is now live in the marketplace!`,
        listingId: listing._id,
        viaTelegram: true,
      });
    }
    res.json({ success: true, data: listing });
  } catch (err) {
    next(err);
  }
};

exports.rejectListing = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const listing = await Listing.findById(req.params.id).populate('sellerId');
    if (!listing) return next(new AppError('Listing not found', 404));
    listing.status = 'rejected';
    listing.rejectionReason = reason || 'Listing did not meet our quality standards';
    await listing.save();
    if (listing.sellerId) {
      await notifyUser({
        userId: listing.sellerId._id,
        type: 'listing_rejected',
        title: '❌ Listing Rejected',
        message: `Your listing "${listing.title}" was rejected.\nReason: ${listing.rejectionReason}`,
        listingId: listing._id,
        viaTelegram: true,
      });
    }
    res.json({ success: true, data: listing });
  } catch (err) {
    next(err);
  }
};

exports.toggleFavorite = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return next(new AppError('Listing not found', 404));
    const idx = listing.favorites.indexOf(req.user._id);
    let favorited;
    if (idx >= 0) {
      listing.favorites.splice(idx, 1);
      favorited = false;
    } else {
      listing.favorites.push(req.user._id);
      favorited = true;
    }
    await listing.save();
    res.json({ success: true, favorited, favoriteCount: listing.favorites.length });
  } catch (err) {
    next(err);
  }
};

exports.getFavorites = async (req, res, next) => {
  try {
    const listings = await Listing.find({ favorites: req.user._id, status: { $in: ['available', 'reserved'] } })
      .populate('sellerId', 'username rating completedSales isVerified');
    res.json({ success: true, data: listings });
  } catch (err) {
    next(err);
  }
};

exports.markAsSold = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return next(new AppError('Listing not found', 404));
    if (String(listing.sellerId) !== String(req.user._id) && req.user.role !== 'admin') {
      return next(new AppError('Not authorized', 403));
    }
    const { buyerId } = req.body;
    listing.status = 'sold';
    listing.soldAt = new Date();
    if (buyerId) listing.soldTo = buyerId;
    await listing.save();
    res.json({ success: true, data: listing });
  } catch (err) {
    next(err);
  }
};
