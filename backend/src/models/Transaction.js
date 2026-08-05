const mongoose = require('mongoose');

const TRANSACTION_STATUS = [
  'pending',
  'negotiating',
  'waiting_payment',
  'paid',
  'credentials_submitted',
  'verified',
  'credentials_sent',
  'buyer_confirmed',
  'completed',
  'cancelled',
  'disputed',
  'refunded',
];

const transactionSchema = new mongoose.Schema(
  {
    listingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      required: true,
      index: true,
    },
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    agreedPrice: { type: Number, required: true, min: 0 },
    serviceFee: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: TRANSACTION_STATUS,
      default: 'pending',
      index: true,
    },
    statusHistory: [
      {
        status: String,
        timestamp: { type: Date, default: Date.now },
        note: String,
        actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
    paymentMethod: String,
    paymentRef: String,
    paymentProof: String,
    paidAt: Date,
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    disputeReason: String,
    disputeEvidence: [String],
    resolution: String,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: Date,
    cancellationReason: String,
    buyerRating: { type: Number, min: 1, max: 5 },
    sellerRating: { type: Number, min: 1, max: 5 },
    buyerFeedback: String,
    sellerFeedback: String,
    releasedAt: Date,
    releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    escrowAddress: String,
    notes: String,
  },
  { timestamps: true }
);

transactionSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    if (!this.statusHistory) this.statusHistory = [];
    const hasLastStatus = this.statusHistory.length
      ? this.statusHistory[this.statusHistory.length - 1].status === this.status
      : false;
    if (!hasLastStatus) {
      this.statusHistory.push({ status: this.status, timestamp: new Date() });
    }
  }
  this.serviceFee = Math.round(this.agreedPrice * 0.05 * 100) / 100;
  this.totalAmount = this.agreedPrice + this.serviceFee;
  next();
});

transactionSchema.index({ buyerId: 1, status: 1 });
transactionSchema.index({ sellerId: 1, status: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
