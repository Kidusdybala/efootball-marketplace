import { createModel } from './base.js';
import bcrypt from 'bcryptjs';

const User = createModel('users', {
  populates: {
    sellerId: { collection: 'users', select: 'username rating ratingCount completedSales isVerified avatar telegramChatId telegramId' },
    buyerId: { collection: 'users', select: 'username rating ratingCount completedSales isVerified avatar telegramChatId telegramId' },
    escrowBuyerId: { collection: 'users', select: 'username rating ratingCount completedSales isVerified avatar telegramChatId telegramId' },
    soldTo: { collection: 'users', select: 'username' },
    approvedBy: { collection: 'users', select: 'username' },
    paymentVerifiedBy: { collection: 'users', select: 'username' },
    sellerPaidBy: { collection: 'users', select: 'username' },
    reporterId: { collection: 'users', select: 'username' },
    targetUserId: { collection: 'users', select: 'username' },
    assignedTo: { collection: 'users', select: 'username' },
    resolvedBy: { collection: 'users', select: 'username' },
    cancelledBy: { collection: 'users', select: 'username' },
    senderId: { collection: 'users', select: 'username firstName' },
    receiverId: { collection: 'users', select: 'username firstName' },
  },

  methods: {
    async comparePassword(candidate) {
      if (!this.password) return false;
      return bcrypt.compare(candidate, this.password);
    },

    async addRating(score, role) {
      this.rating = (this.rating || 0) + score;
      this.ratingCount = (this.ratingCount || 0) + 1;
      if (role === 'seller') this.completedSales = (this.completedSales || 0) + 1;
      if (role === 'buyer') this.completedBuys = (this.completedBuys || 0) + 1;
      await this.save();
    },
  },

  preCreate: async (data) => {
    if (data.password && !data.password.startsWith('$2')) {
      data.password = await bcrypt.hash(data.password, 12);
    }
    if (!data.preferences) {
      data.preferences = { notifyTelegram: true, notifyEmail: false };
    }
    if (data.telegramId) data.telegramId = String(data.telegramId);
    if (data.telegramChatId) data.telegramChatId = String(data.telegramChatId);
    return data;
  },

  preSave: async (doc) => {
    if (doc.isModified('password') && doc.password && !doc.password.startsWith('$2')) {
      doc.password = await bcrypt.hash(doc.password, 12);
    }
  },

  preUpdate: async (filter, update) => {
    const setObj = update.$set || {};
    if (setObj.password && !setObj.password.startsWith('$2')) {
      setObj.password = await bcrypt.hash(setObj.password, 12);
    }
  },
});

export default User;
