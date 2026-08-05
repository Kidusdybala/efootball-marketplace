const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: ['user', 'listing', 'transaction'],
      required: true,
    },
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    targetListingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
    targetTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
    reason: {
      type: String,
      enum: [
        'scam',
        'fake_listing',
        'stolen_account',
        'inappropriate',
        'misrepresentation',
        'payment_issue',
        'harassment',
        'other',
      ],
      required: true,
    },
    description: { type: String, required: true, maxlength: 2000 },
    evidence: [String],
    priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    status: {
      type: String,
      enum: ['open', 'investigating', 'resolved', 'dismissed'],
      default: 'open',
      index: true,
    },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolution: String,
    resolvedAt: Date,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actionTaken: String,
    adminNotes: String,
  },
  { timestamps: true }
);

reportSchema.index({ status: 1, priority: 1 });

module.exports = mongoose.model('Report', reportSchema);
