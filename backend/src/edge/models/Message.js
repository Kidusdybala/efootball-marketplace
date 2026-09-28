import { createModel } from './base.js';

const Message = createModel('messages', {
  populates: {
    listingId: { collection: 'listings', select: 'title' },
    transactionId: { collection: 'transactions', select: 'status' },
    senderId: { collection: 'users', select: 'username firstName' },
    receiverId: { collection: 'users', select: 'username firstName' },
  },

  statics: {
    getConversationId: (id1, id2, listingId) => {
      const ids = [String(id1), String(id2)].sort();
      return `${ids[0]}_${ids[1]}${listingId ? '_' + String(listingId) : ''}`;
    },
  },
});

export default Message;
