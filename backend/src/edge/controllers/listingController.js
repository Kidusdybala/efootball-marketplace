import Listing from '../models/Listing.js';
import AccountCredentials from '../models/AccountCredentials.js';
import { AppError } from '../middleware/errorHandler.js';
import { notifyUser, notifyAdmins } from '../services/notificationService.js';
import { formatMoney } from '../utils/money.js';

async function createListing(c) {
  try {
    const user = c.get('user');
    if (user.status === 'banned') {
      throw new AppError('Account is banned', 403);
    }
    const body = await c.req.json();
    const { credentials, title, price, platform, overall, description, ...rest } = body;
    if (!title || !price || !platform || !description) {
      throw new AppError('Title, price, platform, and description are required', 400);
    }
    const listing = await Listing.create({
      sellerId: user._id,
      title,
      price: Number(price),
      platform,
      overall: overall ? Number(overall) : undefined,
      description,
      status: 'pending_review',
      ...rest,
    });
    if (credentials && (credentials.email || credentials.password)) {
      const creds = await AccountCredentials.create({ listingId: listing._id });
      if (credentials.email) await creds.setEmail(credentials.email);
      if (credentials.password) await creds.setPassword(credentials.password);
      if (credentials.backupCodes) await creds.setBackupCodes(credentials.backupCodes);
      if (credentials.twoFactorSecret) await creds.setTwoFactorSecret(credentials.twoFactorSecret);
      if (credentials.additionalInfo) await creds.setAdditionalInfo(credentials.additionalInfo);
      await creds.save();
    }
    await notifyAdmins('listing_approved', 'New Listing Pending Review',
      `New listing by @${user.username}\n${title}\n${formatMoney(listing.price)} ${platform}`);
    return c.json({ success: true, data: listing, message: 'Listing submitted for review' }, 201);
  } catch (err) {
    throw err;
  }
}

async function getListings(c) {
  try {
    const { page = 1, limit = 20, ...filters } = c.req.query();
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;
    const all = await Listing.searchListings(filters);
    const docs = all.slice(skip, skip + limitNum);
    return c.json({ success: true, data: docs, total: all.length, page: pageNum, limit: limitNum, pages: Math.ceil(all.length / limitNum) });
  } catch (err) {
    throw err;
  }
}

async function getPendingListings(c) {
  try {
    const { page = 1, limit = 20 } = c.req.query();
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;
    const qb = Listing.find({ status: 'pending_review' });
    qb.populate('sellerId', 'username rating completedSales isVerified avatar telegramId');
    qb.sort({ createdAt: 1 });
    qb.skip(skip);
    qb.limit(limitNum);
    const listings = await qb.exec();
    const total = await Listing.countDocuments({ status: 'pending_review' });
    return c.json({ success: true, data: listings, total, page: pageNum, limit: limitNum });
  } catch (err) {
    throw err;
  }
}

async function getListingById(c) {
  try {
    const listing = await Listing.findById(c.req.param('id')).populate('sellerId', 'username rating ratingCount completedSales isVerified avatar');
    if (!listing) throw new AppError('Listing not found', 404);
    listing.views = (listing.views || 0) + 1;
    await listing.save();
    const withFav = { ...listing.toObject() };
    withFav.isFavorited = listing.favorites?.includes(c.get('user')?._id);
    return c.json({ success: true, data: withFav });
  } catch (err) {
    throw err;
  }
}

async function getMyListings(c) {
  try {
    const { status } = c.req.query();
    let qb = Listing.find({ sellerId: c.get('user')._id });
    if (status) qb._filter.status = status;
    qb.sort({ createdAt: -1 });
    const listings = await qb.exec();
    return c.json({ success: true, data: listings });
  } catch (err) {
    throw err;
  }
}

async function updateListing(c) {
  try {
    const body = await c.req.json();
    const { status, views, channelMessageId, approvedBy, approvedAt, soldAt, soldTo, ...allowedFields } = body;
    const listing = await Listing.findById(c.req.param('id'));
    if (!listing) throw new AppError('Listing not found', 404);
    const user = c.get('user');
    if (String(listing.sellerId) !== String(user._id) && user.role !== 'admin') {
      throw new AppError('Not authorized to edit this listing', 403);
    }
    if (['available', 'sold', 'reserved'].includes(listing.status)) {
      throw new AppError('Cannot edit active listing - create a new one', 400);
    }
    Object.assign(listing, allowedFields);
    listing.status = 'pending_review';
    await listing.save();
    return c.json({ success: true, data: listing, message: 'Listing updated and resubmitted for review' });
  } catch (err) {
    throw err;
  }
}

async function deleteListing(c) {
  try {
    const listing = await Listing.findById(c.req.param('id'));
    if (!listing) throw new AppError('Listing not found', 404);
    const user = c.get('user');
    if (String(listing.sellerId) !== String(user._id) && user.role !== 'admin') {
      throw new AppError('Not authorized to delete', 403);
    }
    listing.status = 'deleted';
    await listing.save();
    return c.json({ success: true, message: 'Listing deleted' });
  } catch (err) {
    throw err;
  }
}

async function reserveListing(c) {
  try {
    const body = await c.req.json();
    const { buyerId } = body;
    const listing = await Listing.findById(c.req.param('id'));
    if (!listing) throw new AppError('Listing not found', 404);
    if (listing.status !== 'available') throw new AppError('Listing not available', 400);
    const user = c.get('user');
    if (String(listing.sellerId) !== String(user._id)) {
      throw new AppError('Only seller can reserve listing', 403);
    }
    if (!buyerId) throw new AppError('Buyer ID required', 400);
    listing.status = 'reserved';
    listing.reservedBy = buyerId;
    listing.reservedAt = new Date();
    await listing.save();
    await notifyUser({
      userId: buyerId,
      type: 'listing_reserved',
      title: 'Listing Reserved',
      message: `Your offer for "${listing.title}" has been accepted. The listing is now reserved for you.`,
      listingId: listing._id,
      senderId: user._id,
      viaTelegram: true,
    });
    return c.json({ success: true, data: listing });
  } catch (err) {
    throw err;
  }
}

async function approveListing(c) {
  try {
    const listing = await Listing.findById(c.req.param('id')).populate('sellerId');
    if (!listing) throw new AppError('Listing not found', 404);
    if (listing.status !== 'pending_review') throw new AppError('Listing not pending review', 400);
    listing.status = 'available';
    listing.approvedBy = c.get('user')._id;
    listing.approvedAt = new Date();
    await listing.save();
    if (listing.sellerId) {
      await notifyUser({
        userId: listing.sellerId._id,
        type: 'listing_approved',
        title: 'Listing Approved!',
        message: `Your listing "${listing.title}" has been approved and is now live in the marketplace!`,
        listingId: listing._id,
        viaTelegram: true,
      });
    }
    return c.json({ success: true, data: listing });
  } catch (err) {
    throw err;
  }
}

async function rejectListing(c) {
  try {
    const body = await c.req.json();
    const { reason } = body;
    const listing = await Listing.findById(c.req.param('id')).populate('sellerId');
    if (!listing) throw new AppError('Listing not found', 404);
    listing.status = 'rejected';
    listing.rejectionReason = reason || 'Listing did not meet our quality standards';
    await listing.save();
    if (listing.sellerId) {
      await notifyUser({
        userId: listing.sellerId._id,
        type: 'listing_rejected',
        title: 'Listing Rejected',
        message: `Your listing "${listing.title}" was rejected.\nReason: ${listing.rejectionReason}`,
        listingId: listing._id,
        viaTelegram: true,
      });
    }
    return c.json({ success: true, data: listing });
  } catch (err) {
    throw err;
  }
}

async function toggleFavorite(c) {
  try {
    const listing = await Listing.findById(c.req.param('id'));
    if (!listing) throw new AppError('Listing not found', 404);
    const userId = c.get('user')._id;
    const idx = listing.favorites?.indexOf(userId) ?? -1;
    let favorited;
    if (idx >= 0) {
      listing.favorites.splice(idx, 1);
      favorited = false;
    } else {
      if (!listing.favorites) listing.favorites = [];
      listing.favorites.push(userId);
      favorited = true;
    }
    await listing.save();
    return c.json({ success: true, favorited, favoriteCount: listing.favorites.length });
  } catch (err) {
    throw err;
  }
}

async function getFavorites(c) {
  try {
    const qb = Listing.find({ favorites: c.get('user')._id, status: { $in: ['available', 'reserved'] } });
    qb.populate('sellerId', 'username rating completedSales isVerified');
    const listings = await qb.exec();
    return c.json({ success: true, data: listings });
  } catch (err) {
    throw err;
  }
}

async function markAsSold(c) {
  try {
    const body = await c.req.json();
    const { buyerId } = body;
    const listing = await Listing.findById(c.req.param('id'));
    if (!listing) throw new AppError('Listing not found', 404);
    const user = c.get('user');
    if (String(listing.sellerId) !== String(user._id) && user.role !== 'admin') {
      throw new AppError('Not authorized', 403);
    }
    listing.status = 'sold';
    listing.soldAt = new Date();
    if (buyerId) listing.soldTo = buyerId;
    await listing.save();
    return c.json({ success: true, data: listing });
  } catch (err) {
    throw err;
  }
}

export {
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
};
