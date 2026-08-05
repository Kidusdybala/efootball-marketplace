const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    listingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      index: true,
    },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      index: true,
    },
    conversationId: {
      type: String,
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    senderTelegramId: String,
    receiverTelegramId: String,
    content: {
      type: String,
      required: true,
      maxlength: 10000,
    },
    type: {
      type: String,
      enum: ['text', 'image', 'file', 'system'],
      default: 'text',
    },
    attachments: [String],
    isRead: { type: Boolean, default: false },
    readAt: Date,
    isSystem: { type: Boolean, default: false },
    relayedViaTelegram: { type: Boolean, default: false },
    telegramMessageId: String,
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1, receiverId: 1 });

messageSchema.statics.getConversationId = (id1, id2, listingId) => {
  const ids = [String(id1), String(id2)].sort();
  return `${ids[0]}_${ids[1]}${listingId ? '_' + String(listingId) : ''}`;
};

module.exports = mongoose.model('Message', messageSchema);
