const mongoose = require('mongoose');

const NOTIFICATION_TYPES = [
  'listing_approved',
  'listing_rejected',
  'listing_sold',
  'listing_reserved',
  'new_listing_favorite',
  'new_message',
  'transaction_created',
  'transaction_paid',
  'transaction_verified',
  'transaction_completed',
  'transaction_disputed',
  'transaction_cancelled',
  'buyer_paid_admin',
  'credentials_request',
  'credentials_verified',
  'credentials_released',
  'payment_released',
  'rating_received',
  'report_received',
  'report_resolved',
  'user_banned',
  'user_verified',
  'welcome',
  'password_reset',
];

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    listingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
    transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
    reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'Report' },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    data: {},
    isRead: { type: Boolean, default: false, index: true },
    readAt: Date,
    channels: {
      inApp: { type: Boolean, default: true },
      telegram: { type: Boolean, default: false },
      email: { type: Boolean, default: false },
    },
    telegramSent: { type: Boolean, default: false },
    emailSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
