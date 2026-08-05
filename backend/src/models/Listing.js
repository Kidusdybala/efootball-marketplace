const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200, index: true },
    slug: { type: String, unique: true, sparse: true },
    price: { type: Number, required: true, min: 0, index: true },
    currency: { type: String, default: 'ETB' },
    platform: {
      type: String,
      enum: ['Android', 'iOS', 'Steam', 'PlayStation', 'Xbox', 'PC', 'Cross-Platform'],
      required: true,
      index: true,
    },
    overall: { type: Number, min: 0, max: 999, index: true },
    teamName: String,
    featuredPlayers: [String],
    formation: String,
    description: { type: String, required: true, maxlength: 5000 },
    images: [String],
    videoUrl: String,
    status: {
      type: String,
      enum: [
        'pending_review',
        'approved',
        'rejected',
        'available',
        'reserved',
        'sold',
        'deleted',
        'waiting_escrow',
        'paid_submitted',
        'creds_submitted',
        'released',
      ],
      default: 'pending_review',
      index: true,
    },
    reservedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reservedAt: Date,
    rejectionReason: String,
    views: { type: Number, default: 0 },
    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    favoriteCount: { type: Number, default: 0 },
    channelMessageId: String,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    soldAt: Date,
    soldTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    tags: [String],
    negotiable: { type: Boolean, default: true },

    escrowBuyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    paidReceiptFileId: String,
    paidReceiptType: String,
    paidAt: Date,
    paymentVerifiedAt: Date,
    paymentVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    credentialsSubmittedAt: Date,
    releasedAt: Date,
    sellerPaidAt: Date,
    sellerPaidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    credentialsWiped: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

listingSchema.pre('save', function (next) {
  if (this.favorites) {
    this.favoriteCount = this.favorites.length;
  }
  if (this.isModified('status') && this.status === 'sold') {
    this.soldAt = new Date();
  }
  next();
});

listingSchema.index({ status: 1, platform: 1, price: 1, overall: 1 });
listingSchema.index({ createdAt: -1 });

listingSchema.statics.searchListings = function (filters = {}) {
  const query = {};
  query.status = { $in: ['available', 'reserved', 'waiting_escrow', 'paid_submitted', 'creds_submitted'] };
  if (filters.platform) query.platform = filters.platform;
  if (filters.minPrice) query.price = { ...query.price, $gte: Number(filters.minPrice) };
  if (filters.maxPrice) query.price = { ...query.price, $lte: Number(filters.maxPrice) };
  if (filters.minOverall) query.overall = { ...query.overall, $gte: Number(filters.minOverall) };
  if (filters.maxOverall) query.overall = { ...query.overall, $lte: Number(filters.maxOverall) };
  if (filters.verified) {
    query.sellerId = { $exists: true };
  }
  if (filters.featuredPlayers && filters.featuredPlayers.length) {
    query.featuredPlayers = { $in: filters.featuredPlayers };
  }
  if (filters.search) {
    query.$or = [
      { title: { $regex: filters.search, $options: 'i' } },
      { description: { $regex: filters.search, $options: 'i' } },
      { tags: { $in: [new RegExp(filters.search, 'i')] } },
    ];
  }
  const sort = {};
  if (filters.sortBy === 'price_asc') sort.price = 1;
  else if (filters.sortBy === 'price_desc') sort.price = -1;
  else if (filters.sortBy === 'overall_desc') sort.overall = -1;
  else sort.createdAt = -1;

  return this.find(query).sort(sort).populate('sellerId', 'username rating ratingCount completedSales isVerified avatar');
};

module.exports = mongoose.model('Listing', listingSchema);
