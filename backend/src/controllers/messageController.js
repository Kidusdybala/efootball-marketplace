const Message = require('../models/Message');
const User = require('../models/User');
const Listing = require('../models/Listing');
const { AppError } = require('../middleware/errorHandler');
const { notifyUser } = require('../services/notificationService');

exports.sendMessage = async (req, res, next) => {
  try {
    const { receiverId, content, listingId, transactionId, type = 'text', attachments } = req.body;
    if (!receiverId || !content) return next(new AppError('Receiver and content required', 400));
    if (String(receiverId) === String(req.user._id)) return next(new AppError('Cannot message yourself', 400));
    const receiver = await User.findById(receiverId);
    if (!receiver) return next(new AppError('Receiver not found', 404));
    if (req.user.status === 'banned' || receiver.status === 'banned') {
      return next(new AppError('Messaging restricted due to banned account', 403));
    }
    if (listingId) {
      const listing = await Listing.findById(listingId);
      if (!listing) return next(new AppError('Listing not found', 404));
      if (listing.status === 'sold') {
        return next(new AppError('Listing is sold - messaging disabled', 400));
      }
    }
    const conversationId = Message.getConversationId(req.user._id, receiverId, listingId);
    const message = await Message.create({
      conversationId,
      senderId: req.user._id,
      receiverId,
      content,
      type,
      attachments: attachments || [],
      listingId,
      transactionId,
      senderTelegramId: req.user.telegramId,
      receiverTelegramId: receiver.telegramId,
    });
    try {
      const { relayMessageToTelegram } = require('../telegram/bot');
      const relayed = await relayMessageToTelegram(message);
      if (relayed) message.relayedViaTelegram = true;
    } catch (e) {
      console.warn('Telegram relay failed:', e.message);
    }
    if (!message.relayedViaTelegram) {
      await notifyUser({
        userId: receiverId,
        type: 'new_message',
        title: '💬 New Message',
        message: `@${req.user.username}: ${content.slice(0, 80)}${content.length > 80 ? '...' : ''}`,
        senderId: req.user._id,
        listingId,
      });
    }
    await message.save();
    const populated = await Message.findById(message._id)
      .populate('senderId', 'username avatar')
      .populate('receiverId', 'username avatar');
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    next(err);
  }
};

exports.getConversation = async (req, res, next) => {
  try {
    const { otherUserId, listingId } = req.params;
    if (!otherUserId) return next(new AppError('Other user ID required', 400));
    const conversationId = Message.getConversationId(req.user._id, otherUserId, listingId);
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const messages = await Message.find({ conversationId })
      .populate('senderId', 'username avatar isVerified')
      .populate('receiverId', 'username avatar isVerified')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    await Message.updateMany(
      { conversationId, receiverId: req.user._id, isRead: false },
      { isRead: true, readAt: new Date() }
    );
    res.json({ success: true, data: messages.reverse(), conversationId });
  } catch (err) {
    next(err);
  }
};

exports.getConversationsList = async (req, res, next) => {
  try {
    const userId = req.user._id;
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
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

exports.markConversationRead = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    await Message.updateMany(
      { conversationId, receiverId: req.user._id, isRead: false },
      { isRead: true, readAt: new Date() }
    );
    res.json({ success: true, message: 'Marked as read' });
  } catch (err) {
    next(err);
  }
};

exports.getUnreadCount = async (req, res, next) => {
  try {
    const count = await Message.countDocuments({ receiverId: req.user._id, isRead: false });
    res.json({ success: true, unread: count });
  } catch (err) {
    next(err);
  }
};
