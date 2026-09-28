import { createModel } from './base.js';

const Listing = createModel('listings', {
  populates: {
    sellerId: { collection: 'users', select: 'username rating ratingCount completedSales isVerified avatar telegramChatId telegramId' },
    escrowBuyerId: { collection: 'users', select: 'username rating ratingCount completedSales isVerified avatar telegramChatId telegramId' },
    soldTo: { collection: 'users', select: 'username' },
    approvedBy: { collection: 'users', select: 'username' },
    paymentVerifiedBy: { collection: 'users', select: 'username' },
    sellerPaidBy: { collection: 'users', select: 'username' },
  },

  statics: {
    searchListings: async function(filters = {}) {
      const query = {
        status: {
          $in: ['available', 'reserved', 'waiting_escrow', 'paid_submitted', 'creds_submitted'],
        },
      };
      if (filters.platform) query.platform = filters.platform;
      if (filters.minPrice) query.price = { ...query.price, $gte: Number(filters.minPrice) };
      if (filters.maxPrice) query.price = { ...query.price, $lte: Number(filters.maxPrice) };
      if (filters.minOverall) query.overall = { ...query.overall, $gte: Number(filters.minOverall) };
      if (filters.maxOverall) query.overall = { ...query.overall, $lte: Number(filters.maxOverall) };
      if (filters.featuredPlayers && filters.featuredPlayers.length) {
        query.featuredPlayers = { $in: filters.featuredPlayers };
      }
      if (filters.search) {
        query.$or = [
          { title: { $regex: filters.search, $options: 'i' } },
          { description: { $regex: filters.search, $options: 'i' } },
          { tags: { $in: [filters.search] } },
        ];
      }

      let sort = { createdAt: -1 };
      if (filters.sortBy === 'price_asc') sort = { price: 1 };
      else if (filters.sortBy === 'price_desc') sort = { price: -1 };
      else if (filters.sortBy === 'overall_desc') sort = { overall: -1 };

      const qb = this.find(query, { sort, populate: 'sellerId' });
      return await qb.exec();
    },
  },

  preCreate: (data) => {
    if (!data.slug) data.slug = (data.title?.toLowerCase().replace(/\s+/g, '-') || 'listing') + '-' + Date.now();
    if (data.favorites !== undefined && Array.isArray(data.favorites)) {
      data.favoriteCount = data.favorites.length;
    }
    return data;
  },
});

export default Listing;
