import Message from '../models/Message.js';
import User from '../models/User.js';
import Listing from '../models/Listing.js';
import { AppError } from '../middleware/errorHandler.js';
import { notifyUser } from '../services/notificationService.js';
import { relayMessageToTelegram } from '../bot.js';

async function sendMessage(c) {
  try {
    const body = await c.req.json();
    const { receiverId, content, listingId, transactionId, type = 'text', attachments } = body;
    const user = c.get('user');
    if (!receiverId || !content) throw new AppError('Receiver and content required', 400);
    if (String(receiverId) === String(user._id)) throw new AppError('Cannot message yourself', 400);
    const receiver = await User.findById(receiverId);
    if (!receiver) throw new AppError('Receiver not found', 404);
    if (user.status === 'banned' || receiver.status === 'banned') {
      throw new AppError('Messaging restricted due to banned account', 403);
    }
    if (listingId) {
      const listing = await Listing.findById(listingId);
      if (!listing) throw new AppError('Listing not found', 404);
      if (listing.status === 'sold') throw new AppError('Listing is sold - messaging disabled', 400);
    }
    const conversationId = Message.getConversationId(user._id, receiverId, listingId);
    const message = await Message.create({
      conversationId,
      senderId: user._id,
      receiverId,
      content,
      type,
      attachments: attachments || [],
      listingId,
      transactionId,
      senderTelegramId: user.telegramId,
      receiverTelegramId: receiver.telegramId,
    });
    if (receiver.telegramChatId) {
      try {
        const relayed = await relayMessageToTelegram(message, receiver);
        if (relayed) message.relayedViaTelegram = true;
      } catch (e) {
        console.warn('Telegram relay failed:', e.message);
      }
    } else {
      await notifyUser({
        userId: receiverId,
        type: 'new_message',
        title: 'New Message',
        message: `@${user.username}: ${content.slice(0, 80)}${content.length > 80 ? '...' : ''}`,
        senderId: user._id,
        listingId,
      });
    }
    await message.save();
    const populated = await Message.findById(message._id)
      .populate('senderId', 'username avatar')
      .populate('receiverId', 'username avatar');
    return c.json({ success: true, data: populated }, 201);
  } catch (err) {
    throw err;
  }
}

async function getConversation(c) {
  try {
    const { otherUserId, listingId } = c.req.param();
    const user = c.get('user');
    if (!otherUserId) throw new AppError('Other user ID required', 400);
    const conversationId = Message.getConversationId(user._id, otherUserId, listingId);
    const { page = 1, limit = 50 } = c.req.query();
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    const qb = Message.find({ conversationId });
    qb.populate('senderId', 'username avatar isVerified');
    qb.populate('receiverId', 'username avatar isVerified');
    qb.sort({ createdAt: -1 });
    qb.skip(skip);
    qb.limit(limitNum);
    const messages = await qb.exec();
    await Message.updateMany(
      { conversationId, receiverId: user._id, isRead: false },
      { $set: { isRead: true, readAt: new Date().toISOString() } },
    );
    return c.json({ success: true, data: messages.reverse(), conversationId });
  } catch (err) {
    throw err;
  }
}

async function getConversationsList(c) {
  try {
    const userId = c.get('user')._id;
    const conversations = await Message.aggregate([
      { $match: { $or: [{ senderId: userId }, { receiverId: userId }], isSystem: { $ne: true } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$conversationId',
          lastMessage: { $first: '$$ROOT' },
          listingId: { $first: '$listingId' },
          participants: { $addToSet: '$senderId' },
        },
      },
      { $sort: { 'lastMessage.createdAt': -1 } },
    ]);
    const result = [];
    for (const conv of conversations) {
      const otherUserId = [conv.lastMessage.senderId, conv.lastMessage.receiverId]
        .find(id => String(id) !== String(userId));
      const [otherUser, listing, unreadCount] = await Promise.all([
        User.findById(otherUserId).select('username avatar isVerified status'),
        conv.listingId ? Listing.findById(conv.listingId).select('title price status images') : null,
        Message.countDocuments({ conversationId: conv._id, receiverId: userId, isRead: false }),
      ]);
      result.push({
        conversationId: conv._id,
        listing,
        otherUser,
        lastMessage: conv.lastMessage,
        unreadCount,
      });
    }
    return c.json({ success: true, data: result });
  } catch (err) {
    throw err;
  }
}

async function markConversationRead(c) {
  try {
    const { conversationId } = c.req.param();
    const userId = c.get('user')._id;
    await Message.updateMany(
      { conversationId, receiverId: userId, isRead: false },
      { $set: { isRead: true, readAt: new Date().toISOString() } },
    );
    return c.json({ success: true, message: 'Marked as read' });
  } catch (err) {
    throw err;
  }
}

async function getUnreadCount(c) {
  try {
    const count = await Message.countDocuments({ receiverId: c.get('user')._id, isRead: false });
    return c.json({ success: true, unread: count });
  } catch (err) {
    throw err;
  }
}

export {
  sendMessage,
  getConversation,
  getConversationsList,
  markConversationRead,
  getUnreadCount,
};
