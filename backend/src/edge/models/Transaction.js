import { createModel } from './base.js';

export const TRANSACTION_STATUS = [
  'pending', 'negotiating', 'waiting_payment', 'paid',
  'credentials_submitted', 'verified', 'credentials_sent',
  'buyer_confirmed', 'completed', 'cancelled', 'disputed', 'refunded',
];

const Transaction = createModel('transactions', {
  populates: {
    listingId: { collection: 'listings', select: 'title price status sellerId' },
    buyerId: { collection: 'users', select: 'username telegramChatId' },
    sellerId: { collection: 'users', select: 'username telegramChatId' },
    confirmedBy: { collection: 'users', select: 'username' },
    resolvedBy: { collection: 'users', select: 'username' },
    cancelledBy: { collection: 'users', select: 'username' },
    releasedBy: { collection: 'users', select: 'username' },
  },

  preCreate: (data) => {
    if (!data.status) data.status = 'pending';
    if (!data.statusHistory) {
      data.statusHistory = [{ status: data.status, timestamp: new Date() }];
    }
    const agreedPrice = data.agreedPrice || 0;
    data.serviceFee = Math.round(agreedPrice * 0.05 * 100) / 100;
    data.totalAmount = agreedPrice + data.serviceFee;
    return data;
  },
});

export default Transaction;
