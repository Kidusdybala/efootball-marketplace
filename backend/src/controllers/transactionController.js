const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const AccountCredentials = require('../models/AccountCredentials');
const User = require('../models/User');
const { AppError } = require('../middleware/errorHandler');
const { notifyUser, notifyAdmins } = require('../services/notificationService');
const { formatMoney } = require('../utils/money');

exports.createTransaction = async (req, res, next) => {
  try {
    const { listingId, agreedPrice } = req.body;
    const listing = await Listing.findById(listingId);
    if (!listing) return next(new AppError('Listing not found', 404));
    if (listing.status === 'sold') return next(new AppError('Listing already sold', 400));
    if (listing.status === 'reserved' && String(listing.reservedBy) !== String(req.user._id)) {
      return next(new AppError('Listing reserved for another buyer', 400));
    }
    if (String(listing.sellerId) === String(req.user._id)) {
      return next(new AppError('Cannot buy your own listing', 400));
    }
    const price = Number(agreedPrice || listing.price);
    const transaction = await Transaction.create({
      listingId,
      buyerId: req.user._id,
      sellerId: listing.sellerId,
      agreedPrice: price,
      status: 'pending',
      statusHistory: [{ status: 'pending', timestamp: new Date(), note: 'Transaction initiated' }],
    });
    listing.status = 'reserved';
    listing.reservedBy = req.user._id;
    listing.reservedAt = new Date();
    await listing.save();
    await Promise.all([
      notifyUser({
        userId: listing.sellerId,
        type: 'transaction_created',
        title: '💰 New Purchase Request',
        message: `Buyer @${req.user.username} wants to buy "${listing.title}" for ${formatMoney(price, listing.currency)}. Review the request and negotiate.`,
        listingId,
        transactionId: transaction._id,
        senderId: req.user._id,
        viaTelegram: true,
      }),
      notifyUser({
        userId: req.user._id,
        type: 'transaction_created',
        title: '🛒 Purchase Request Sent',
        message: `Your request for "${listing.title}" (${formatMoney(price, listing.currency)}) has been sent. Waiting for seller response.`,
        listingId,
        transactionId: transaction._id,
        viaTelegram: true,
      }),
    ]);
    res.status(201).json({ success: true, data: transaction });
  } catch (err) {
    next(err);
  }
};

exports.getMyTransactions = async (req, res, next) => {
  try {
    const { status, role } = req.query;
    const query = { $or: [{ buyerId: req.user._id }, { sellerId: req.user._id }] };
    if (status) query.status = status;
    if (role === 'buyer') query.buyerId = req.user._id;
    if (role === 'seller') query.sellerId = req.user._id;
    const transactions = await Transaction.find(query)
      .populate('listingId', 'title images price platform overall status')
      .populate('buyerId', 'username rating avatar isVerified')
      .populate('sellerId', 'username rating avatar isVerified')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: transactions });
  } catch (err) {
    next(err);
  }
};

exports.getTransaction = async (req, res, next) => {
  try {
    const tx = await Transaction.findById(req.params.id)
      .populate('listingId', 'title images price platform overall status')
      .populate('buyerId', 'username rating avatar isVerified telegramId')
      .populate('sellerId', 'username rating avatar isVerified telegramId');
    if (!tx) return next(new AppError('Transaction not found', 404));
    const isParticipant = String(tx.buyerId._id) === String(req.user._id) || String(tx.sellerId._id) === String(req.user._id);
    if (!isParticipant && req.user.role !== 'admin') {
      return next(new AppError('Not authorized to view this transaction', 403));
    }
    const txObj = tx.toObject();
    if (req.user.role === 'admin' || String(tx.buyerId._id) === String(req.user._id)) {
      if (tx.status === 'verified' || tx.status === 'credentials_sent' || tx.status === 'buyer_confirmed' || tx.status === 'completed') {
        const creds = await AccountCredentials.findOne({ listingId: tx.listingId._id });
        if (creds) txObj.credentials = creds.getAllDecrypted();
      }
    }
    if (req.user.role === 'admin' && tx.status !== 'completed' && tx.status !== 'cancelled') {
      const creds = await AccountCredentials.findOne({ listingId: tx.listingId._id });
      if (creds) txObj.adminCredentials = creds.getAllDecrypted();
    }
    res.json({ success: true, data: txObj });
  } catch (err) {
    next(err);
  }
};

exports.updateStatus = async (req, res, next) => {
  try {
    const { status, note } = req.body;
    const tx = await Transaction.findById(req.params.id).populate('listingId');
    if (!tx) return next(new AppError('Transaction not found', 404));
    const validTransitions = {
      pending: ['negotiating', 'waiting_payment', 'cancelled'],
      negotiating: ['waiting_payment', 'cancelled'],
      waiting_payment: ['paid', 'cancelled'],
      paid: ['credentials_submitted', 'disputed'],
      credentials_submitted: ['verified', 'disputed'],
      verified: ['credentials_sent', 'disputed'],
      credentials_sent: ['buyer_confirmed', 'disputed'],
      buyer_confirmed: ['completed'],
      completed: [],
      disputed: ['resolved', 'refunded', 'completed'],
      cancelled: [],
      refunded: [],
    };
    if (!validTransitions[tx.status]?.includes(status)) {
      return next(new AppError(`Invalid status transition from ${tx.status} to ${status}`, 400));
    }
    const isBuyer = String(tx.buyerId) === String(req.user._id);
    const isSeller = String(tx.sellerId) === String(req.user._id);
    const isAdmin = req.user.role === 'admin';

    if (status === 'waiting_payment' && !isSeller && !isAdmin) return next(new AppError('Only seller can confirm agreement', 403));
    if (status === 'paid' && !isBuyer && !isAdmin) return next(new AppError('Only buyer can mark as paid', 403));
    if (status === 'credentials_submitted' && !isSeller && !isAdmin) return next(new AppError('Only seller can submit credentials', 403));
    if (status === 'verified' && !isAdmin) return next(new AppError('Only admin can verify credentials', 403));
    if (status === 'credentials_sent' && !isAdmin) return next(new AppError('Only admin can send credentials', 403));
    if (status === 'buyer_confirmed' && !isBuyer && !isAdmin) return next(new AppError('Only buyer can confirm receipt', 403));
    if (status === 'completed' && !isAdmin && !isBuyer) return next(new AppError('Only admin or buyer can complete', 403));
    if (status === 'cancelled' && !isParticipantOrAdmin(isBuyer, isSeller, isAdmin)) return next(new AppError('Not authorized', 403));
    if (status === 'disputed' && !isParticipantOrAdmin(isBuyer, isSeller, isAdmin)) return next(new AppError('Not authorized', 403));

    tx.status = status;
    if (note) tx.notes = (tx.notes ? tx.notes + '\n' : '') + note;
    if (status === 'paid') tx.paidAt = new Date();
    if (status === 'completed') {
      tx.releasedAt = new Date();
      tx.releasedBy = req.user._id;
      if (tx.listingId) {
        await Listing.findByIdAndUpdate(tx.listingId._id, { status: 'sold', soldAt: new Date(), soldTo: tx.buyerId });
      }
    }
    if (status === 'cancelled') {
      tx.cancelledAt = new Date();
      tx.cancelledBy = req.user._id;
      tx.cancellationReason = note || '';
      if (tx.listingId && tx.status === 'cancelled') {
        const listing = await Listing.findById(tx.listingId._id);
        if (listing && listing.status === 'reserved') {
          listing.status = 'available';
          listing.reservedBy = null;
          listing.reservedAt = null;
          await listing.save();
        }
      }
    }
    await tx.save();
    const title = getStatusTitle(status);
    const msg = getStatusMessage(status, tx, req.user.username);
    await Promise.all([
      notifyUser({ userId: tx.buyerId, type: `transaction_${status}`, title, message: msg, transactionId: tx._id, listingId: tx.listingId?._id, senderId: req.user._id, viaTelegram: true }),
      notifyUser({ userId: tx.sellerId, type: `transaction_${status}`, title, message: msg, transactionId: tx._id, listingId: tx.listingId?._id, senderId: req.user._id, viaTelegram: true }),
    ]);
    if (status === 'paid') await notifyAdmins('buyer_paid_admin', '💸 Payment Received', `Buyer @${req.user.username} has paid for transaction #${tx._id}\nAmount: ${formatMoney(tx.totalAmount, tx.listingId?.currency)}`);
    if (status === 'disputed') await notifyAdmins('transaction_disputed', '⚠️ Dispute Opened', `Dispute on transaction #${tx._id}\n${note || 'No details'}`);
    res.json({ success: true, data: tx });
  } catch (err) {
    next(err);
  }
};

const isParticipantOrAdmin = (b, s, a) => b || s || a;
const getStatusTitle = (s) => ({
  negotiating: '🤝 Negotiating',
  waiting_payment: '💳 Payment Pending',
  paid: '💰 Payment Confirmed',
  credentials_submitted: '🔐 Credentials Submitted',
  verified: '✅ Credentials Verified',
  credentials_sent: '📬 Credentials Sent',
  buyer_confirmed: '👍 Buyer Confirmed',
  completed: '🎉 Transaction Completed',
  cancelled: '❌ Transaction Cancelled',
  disputed: '⚠️ Dispute Opened',
  refunded: '↩️ Refund Processed',
})[s] || 'Status Updated';

const getStatusMessage = (s, tx, by) => {
  const base = `Transaction #${tx._id?.toString().slice(-6)} status: ${s.toUpperCase()}.`;
  const actor = `Updated by @${by}.`;
  return `${base}\n${actor}`;
};

exports.submitPaymentProof = async (req, res, next) => {
  try {
    const { paymentProof, paymentRef, paymentMethod } = req.body;
    const tx = await Transaction.findById(req.params.id);
    if (!tx) return next(new AppError('Transaction not found', 404));
    if (String(tx.buyerId) !== String(req.user._id) && req.user.role !== 'admin') {
      return next(new AppError('Not authorized', 403));
    }
    if (paymentProof) tx.paymentProof = paymentProof;
    if (paymentRef) tx.paymentRef = paymentRef;
    if (paymentMethod) tx.paymentMethod = paymentMethod;
    await tx.save();
    res.json({ success: true, data: tx });
  } catch (err) {
    next(err);
  }
};

exports.submitCredentials = async (req, res, next) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx) return next(new AppError('Transaction not found', 404));
    if (String(tx.sellerId) !== String(req.user._id) && req.user.role !== 'admin') {
      return next(new AppError('Only seller can submit credentials', 403));
    }
    if (!['paid', 'credentials_submitted'].includes(tx.status)) {
      return next(new AppError('Cannot submit credentials at this stage', 400));
    }
    const { email, password, backupCodes, twoFactorSecret, additionalInfo } = req.body;
    if (!email || !password) return next(new AppError('Email and password required', 400));
    let creds = await AccountCredentials.findOne({ listingId: tx.listingId });
    if (!creds) creds = new AccountCredentials({ listingId: tx.listingId });
    creds.setEmail(email);
    creds.setPassword(password);
    if (backupCodes) creds.setBackupCodes(backupCodes);
    if (twoFactorSecret) creds.setTwoFactorSecret(twoFactorSecret);
    if (additionalInfo) creds.setAdditionalInfo(additionalInfo);
    await creds.save();
    tx.status = 'credentials_submitted';
    await tx.save();
    await notifyAdmins('credentials_request', '🔐 Credentials Submitted',
      `Seller submitted credentials for transaction #${tx._id}. Ready for admin verification.`);
    res.json({ success: true, data: tx });
  } catch (err) {
    next(err);
  }
};

exports.getAllTransactions = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status) query.status = status;
    const skip = (page - 1) * limit;
    const txs = await Transaction.find(query)
      .populate('listingId', 'title price')
      .populate('buyerId', 'username telegramId')
      .populate('sellerId', 'username telegramId')
      .sort({ createdAt: -1 })
      .skip(skip).limit(limit);
    const total = await Transaction.countDocuments(query);
    res.json({ success: true, data: txs, total, page, limit });
  } catch (err) {
    next(err);
  }
};

exports.openDispute = async (req, res, next) => {
  try {
    const { reason, evidence } = req.body;
    const tx = await Transaction.findById(req.params.id);
    if (!tx) return next(new AppError('Transaction not found', 404));
    if (String(tx.buyerId) !== String(req.user._id) && String(tx.sellerId) !== String(req.user._id) && req.user.role !== 'admin') {
      return next(new AppError('Not authorized', 403));
    }
    if (['completed', 'cancelled', 'refunded', 'disputed'].includes(tx.status)) {
      return next(new AppError('Cannot open dispute for this status', 400));
    }
    tx.status = 'disputed';
    tx.disputeReason = reason;
    tx.disputeEvidence = evidence || [];
    await tx.save();
    await notifyAdmins('transaction_disputed', '⚠️ Dispute Opened', `Dispute on transaction #${tx._id}\nReason: ${reason}`);
    res.json({ success: true, data: tx });
  } catch (err) {
    next(err);
  }
};

exports.resolveDispute = async (req, res, next) => {
  try {
    const { resolution, action } = req.body;
    const tx = await Transaction.findById(req.params.id);
    if (!tx) return next(new AppError('Transaction not found', 404));
    if (tx.status !== 'disputed') return next(new AppError('No open dispute', 400));
    tx.resolution = resolution;
    tx.resolvedBy = req.user._id;
    tx.resolvedAt = new Date();
    if (action === 'complete') tx.status = 'completed';
    else if (action === 'refund') tx.status = 'refunded';
    else tx.status = 'resolved';
    await tx.save();
    res.json({ success: true, data: tx });
  } catch (err) {
    next(err);
  }
};
